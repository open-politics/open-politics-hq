"""
Content ingestion @task functions.

All ingestion work is discoverable via IngestionJob records with PENDING status.
Routes/handlers create the IngestionJob, @task finds and processes it.

- run_directory_import: local directory → assets
- run_archive_import: remote archive (zip/tar) → download, extract, assets
- run_bulk_url_import: list of URLs → assets
- run_bulk_file_import: list of uploaded file paths → assets

schedule=None on all: not beat-polled. Dispatched via events or kick_tasks().
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import update, func
from sqlmodel import Session, select

from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery
from app.models import IngestionJob, IngestionStatus

logger = logging.getLogger(__name__)


# ── Helpers ─────────────────────────────────────────────────────────────────

def _update_progress(session: Session, job_id: int, stage: str, message: str,
                     progress_pct: int = 0, **extra):
    """Update IngestionJob cursor_state and status fields."""
    job = session.get(IngestionJob, job_id)
    if not job:
        return
    cs = dict(job.cursor_state or {})
    cs.update({"stage": stage, "message": message, "progress_pct": progress_pct, **extra})
    job.cursor_state = cs
    job.updated_at = datetime.now(timezone.utc)
    session.add(job)
    session.commit()


def _fail_job(session: Session, job_id: int, error: str):
    """Mark job FAILED with error message."""
    job = session.get(IngestionJob, job_id)
    if not job:
        return
    job.status = IngestionStatus.FAILED
    job.error_message = error[:500]
    job.last_error_at = datetime.now(timezone.utc)
    job.retry_count += 1
    cs = dict(job.cursor_state or {})
    cs.update({"stage": "failed", "message": error[:200], "progress_pct": 0})
    job.cursor_state = cs
    session.add(job)
    session.commit()


def _complete_job(session: Session, job_id: int, asset_count: int):
    """Mark job COMPLETED."""
    job = session.get(IngestionJob, job_id)
    if not job:
        return
    job.status = IngestionStatus.COMPLETED
    job.processed_files = asset_count
    job.completed_at = datetime.now(timezone.utc)
    cs = dict(job.cursor_state or {})
    cs.update({"stage": "completed", "message": f"Processed {asset_count} files", "progress_pct": 100})
    job.cursor_state = cs
    session.add(job)
    session.commit()


def _ingestion_context(session, user_id, infospace_id, options):
    """Build IngestionContext from registry providers."""
    from app.api.modules.content.handlers import IngestionContext
    from app.api.modules.content.services.bundle_service import BundleService
    from app.api.modules.foundation_service_providers import resolve
    from app.core.config import settings

    storage = resolve("storage")
    scraping = resolve("scraping")
    try:
        search = resolve("web_search", infospace_id=infospace_id)
    except Exception:
        search = None

    return IngestionContext(
        session=session,
        storage_provider=storage,
        scraping_provider=scraping,
        search_provider=search,
        bundle_service=BundleService(session),
        user_id=user_id,
        infospace_id=infospace_id,
        settings=settings,
        options=options or {},
    )


def _archive_stem_from_url(url: str) -> str:
    """Extract a human-friendly bundle name from an archive URL.

    Strips query/fragment, takes the filename, removes the archive suffix
    (.zip, .tar, .tar.gz, etc.). Falls back to "archive" if nothing survives.
    """
    from urllib.parse import urlparse, unquote
    import re as _re

    path = urlparse(url).path
    filename = unquote(path.rsplit("/", 1)[-1]) or "archive"
    # Strip archive suffixes (longest first so .tar.gz beats .gz)
    for suffix in (".tar.gz", ".tar.bz2", ".tgz", ".tbz2", ".zip", ".tar", ".gz", ".bz2"):
        if filename.lower().endswith(suffix):
            filename = filename[: -len(suffix)]
            break
    cleaned = _re.sub(r"[\s_]+", " ", filename).strip()
    return cleaned or "archive"


async def _archive_download_and_extract(
    ctx: TaskContext,
    job_id: int,
    source_locator: str,
    parent_bundle_id: Optional[int],
    user_id: int,
    options: Dict[str, Any],
) -> tuple[int, int]:
    """Download an archive and extract it into a new sub-bundle.

    Always nests: creates a bundle named from the archive stem under
    ``parent_bundle_id`` (or at ROOT if ``None``), then extracts the archive
    tree into it. Matches the "destination is parent; input unrolls naturally
    underneath" contract used everywhere else in ingestion.

    On download/extract failure, deletes the empty sub-bundle so the tree
    doesn't accumulate orphans.

    Returns ``(asset_count, new_bundle_id)``. Shared between
    ``run_archive_import`` (legacy single-archive job) and ``run_batch_ingest``
    (archive_url items inside a batch).
    """
    from app.models import Bundle
    from app.api.modules.content.handlers import ArchiveHandler, IngestionContext
    from app.api.modules.content.services.bundle_service import BundleService
    from app.schemas import BundleCreate
    from app.api.modules.foundation_service_providers import resolve
    from app.core.config import settings
    from app.core.tree import ROOT, delete as tree_delete

    archive_name = _archive_stem_from_url(source_locator)

    # Create the archive's sub-bundle up front so `_process_archive_sync` has a
    # destination; clean up on failure.
    with ctx.session() as session:
        sub_bundle = BundleService(session).create_bundle(
            bundle_in=BundleCreate(
                name=archive_name,
                parent_bundle_id=parent_bundle_id if parent_bundle_id else ROOT,
                description=f"Extracted from {source_locator}",
            ),
            infospace_id=ctx.infospace_id,
            user_id=user_id,
        )
        sub_bundle_id = sub_bundle.id

    try:
        with ctx.session() as session:
            parent_bundle = session.get(Bundle, sub_bundle_id)
            storage = resolve("storage")
            scraping = resolve("scraping")
            ing_ctx = IngestionContext(
                session=session,
                storage_provider=storage,
                scraping_provider=scraping,
                search_provider=None,
                bundle_service=BundleService(session),
                user_id=user_id,
                infospace_id=ctx.infospace_id,
                settings=settings,
                options=options,
            )
            handler = ArchiveHandler(ing_ctx)

            def _on_download(done: int, total: int | None):
                # Download phase = 10–60% of the job's budget. Called at ~2 Hz
                # by the handler. ctx.job_progress coalesces DB write + stream
                # event.
                if total and total > 0:
                    pct = 10 + int((done / total) * 50)
                    msg = f"Downloading {done // 1024 // 1024}MB / {total // 1024 // 1024}MB"
                else:
                    pct = min(55, 10 + done // (1024 * 1024))
                    msg = f"Downloading {done // 1024 // 1024}MB"
                ctx.job_progress(
                    job_id, stage="downloading", message=msg, progress_pct=pct,
                    bytes_downloaded=done, bytes_total=total,
                )

            ctx.job_progress(
                job_id, stage="downloading", message="Starting download...",
                progress_pct=10,
            )

            created_assets = await handler._process_archive_sync(
                source_locator, parent_bundle, ctx.infospace_id, user_id, options,
                on_download_progress=_on_download,
            )

            return len(created_assets), sub_bundle_id
    except Exception:
        # Clean up the empty sub-bundle we speculatively created.
        try:
            with ctx.session() as session:
                tree_delete(session, bundle_ids=[sub_bundle_id], out_of=ROOT, confirm=True)
                session.commit()
        except Exception as cleanup_err:
            logger.warning("Failed to clean up empty archive bundle %d: %s", sub_bundle_id, cleanup_err)
        raise


# ── @task: directory import ─────────────────────────────────────────────────

@task("run_directory_import",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind == "directory_local")
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=3600,
      tags=frozenset({"content", "ingestion"}))
def run_directory_import(ctx: TaskContext, job_ids: list[int]):
    """Process PENDING directory import jobs."""
    from app.core.config import settings

    for job_id in job_ids:
        # Atomic claim
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id, IngestionJob.status == IngestionStatus.PENDING)
                .values(status=IngestionStatus.PROCESSING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue

        try:
            with ctx.session() as session:
                job = session.get(IngestionJob, job_id)
                source_path = job.source_locator
                user_id = job.user_id
                options = (job.cursor_state or {}).get("options", {})

                _update_progress(session, job_id, "walking", "Walking directory...", 20)

                copy_mode = options.get("copy_mode", False)
                allowed_paths = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
                if not allowed_paths:
                    allowed_paths = [settings.LOCAL_STORAGE_BASE_PATH]

                from app.api.modules.content.handlers.directory_import_handler import DirectoryImportHandler
                from app.api.modules.content.handlers.base import IngestionContext
                from app.api.modules.content.services.bundle_service import BundleService
                from app.api.modules.foundation_service_providers import resolve
                from app.core.db import engine

                bundle_service = BundleService(session)
                storage_provider = resolve("storage") if copy_mode else None
                scraping_provider = resolve("scraping")

                cursor_state = job.cursor_state or {}
                resume_from_path = cursor_state.get("last_processed_path")

                def on_batch_complete(last_path: str, total_processed: int):
                    with Session(engine) as batch_session:
                        batch_job = batch_session.get(IngestionJob, job_id)
                        if batch_job:
                            cs = dict(batch_job.cursor_state or {})
                            cs["last_processed_path"] = last_path
                            total = batch_job.total_files or 0
                            progress = (
                                min(95, 20 + int(70 * total_processed / total))
                                if total > 0
                                else min(95, 20 + total_processed // 500)
                            )
                            cs["progress_pct"] = progress
                            cs["message"] = f"Imported {total_processed} files"
                            batch_job.cursor_state = cs
                            batch_job.processed_files = total_processed
                            batch_session.add(batch_job)
                            batch_session.commit()

                handler_options = {
                    **options,
                    "copy_mode": copy_mode,
                    "allowed_import_paths": allowed_paths,
                    "resume_from_path": resume_from_path,
                    "on_batch_complete": on_batch_complete,
                }
                ing_ctx = IngestionContext(
                    session=session,
                    storage_provider=storage_provider,
                    scraping_provider=scraping_provider,
                    search_provider=None,
                    bundle_service=bundle_service,
                    user_id=user_id,
                    infospace_id=ctx.infospace_id,
                    settings=settings,
                    options=handler_options,
                )
                handler = DirectoryImportHandler(ing_ctx)
                result = run_async_in_celery(
                    handler.handle,
                    source_path=source_path,
                    options=handler_options,
                )
                created_assets, root_bundle_id = result

                job = session.get(IngestionJob, job_id)
                job.root_bundle_id = root_bundle_id
                _complete_job(session, job_id, len(created_assets))

                if created_assets:
                    from app.core.dispatch import kick_tasks
                    kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))

            ctx.stat("done")

        except Exception as e:
            logger.exception("run_directory_import failed for job %d: %s", job_id, e)
            with ctx.session() as session:
                _fail_job(session, job_id, str(e))
            ctx.item_failed(job_id)
            ctx.stat("failed")


# ── @task: archive import ───────────────────────────────────────────────────

@task("run_archive_import",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind.in_(["zip", "tar.gz", "tar.bz2", "archive_zip"]))
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=3600,
      tags=frozenset({"content", "ingestion"}))
def run_archive_import(ctx: TaskContext, job_ids: list[int]):
    """Process PENDING archive ingestion jobs."""
    for job_id in job_ids:
        # Atomic claim
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id, IngestionJob.status == IngestionStatus.PENDING)
                .values(status=IngestionStatus.DOWNLOADING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue

        try:
            with ctx.session() as session:
                job = session.get(IngestionJob, job_id)
                source_locator = job.source_locator
                user_id = job.user_id
                root_bundle_id = job.root_bundle_id
                options = (job.cursor_state or {}).get("options", {})

            count, _sub_bundle_id = run_async_in_celery(
                _archive_download_and_extract,
                ctx, job_id, source_locator, root_bundle_id, user_id, options,
            )

            ctx.job_progress(
                job_id, status="completed", stage="completed",
                message=f"Imported {count} files", progress_pct=100,
                asset_count=count,
            )

            if count:
                from app.core.dispatch import kick_tasks
                kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))

            ctx.stat("done")
            logger.info("run_archive_import completed job %d: %d assets", job_id, count)

        except Exception as e:
            logger.exception("run_archive_import failed for job %d: %s", job_id, e)
            ctx.job_progress(
                job_id, status="failed", stage="failed",
                message=str(e)[:200], progress_pct=0,
            )
            ctx.item_failed(job_id)
            ctx.stat("failed")


# ── @task: bulk URL import ──────────────────────────────────────────────────

@task("run_bulk_url_import",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind == "bulk_urls")
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=1800,
      tags=frozenset({"content", "ingestion"}))
def run_bulk_url_import(ctx: TaskContext, job_ids: list[int]):
    """Process PENDING bulk URL import jobs."""
    import asyncio

    for job_id in job_ids:
        # Atomic claim
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id, IngestionJob.status == IngestionStatus.PENDING)
                .values(status=IngestionStatus.PROCESSING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue

        try:
            async def process_urls():
                with ctx.session() as session:
                    job = session.get(IngestionJob, job_id)
                    cs = job.cursor_state or {}
                    urls = cs.get("urls", [])
                    options = cs.get("options", {})
                    base_title = cs.get("base_title")
                    scrape_immediately = cs.get("scrape_immediately", True)
                    user_id = job.user_id

                    from app.api.modules.content.ingest import ingest

                    ing_ctx = _ingestion_context(session, user_id, ctx.infospace_id, options)

                    assets_created = []
                    errors = []

                    for i, url in enumerate(urls):
                        try:
                            url_title = f"{base_title} #{i+1}" if base_title else None
                            url_options = {**(options or {}), "batch_index": i, "batch_total": len(urls)}
                            ing_ctx.options = url_options

                            assets = await ingest(ing_ctx, url, title=url_title, options=url_options)
                            assets_created.append(assets[0].id)

                            if scrape_immediately:
                                await asyncio.sleep(0.5)

                            # Stream progress to subscribers (replaces _update_progress —
                            # ctx.job_progress writes the IngestionJob row AND emits the
                            # matching `ingestion_job:{id}` stream event in one call).
                            progress = min(95, int(100 * (i + 1) / len(urls)))
                            ctx.job_progress(
                                job_id,
                                status="progress",
                                stage="processing",
                                message=f"Ingested {i+1}/{len(urls)} URLs",
                                progress_pct=progress,
                                processed=i + 1,
                                total=len(urls),
                            )

                        except Exception as e:
                            logger.error("Failed to process URL %s: %s", url, e)
                            errors.append({"url": url, "error": str(e)})
                            continue

                    ctx.job_progress(
                        job_id,
                        status="completed",
                        stage="completed",
                        message=f"Processed {len(assets_created)} URLs",
                        progress_pct=100,
                        processed=len(assets_created),
                        failed=len(errors),
                        total=len(urls),
                        asset_ids=assets_created,
                    )

                    return len(assets_created)

            count = run_async_in_celery(process_urls)
            ctx.stat("done")

        except Exception as e:
            logger.exception("run_bulk_url_import failed for job %d: %s", job_id, e)
            ctx.job_progress(job_id, status="failed", stage="failed", message=str(e)[:500])
            ctx.item_failed(job_id)
            ctx.stat("failed")


# ── @task: bulk file import ─────────────────────────────────────────────────

@task("run_bulk_file_import",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind == "bulk_files")
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=1800,
      tags=frozenset({"content", "ingestion"}))
def run_bulk_file_import(ctx: TaskContext, job_ids: list[int]):
    """Process PENDING bulk file import jobs."""
    for job_id in job_ids:
        # Atomic claim
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id, IngestionJob.status == IngestionStatus.PENDING)
                .values(status=IngestionStatus.PROCESSING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue

        try:
            async def process_files():
                with ctx.session() as session:
                    from starlette.datastructures import UploadFile
                    from app.api.modules.content.ingest import ingest

                    job = session.get(IngestionJob, job_id)
                    cs = job.cursor_state or {}
                    file_paths = cs.get("file_paths", [])
                    options = cs.get("options", {})
                    process_immediately = cs.get("process_immediately", True)
                    user_id = job.user_id

                    ing_ctx = _ingestion_context(session, user_id, ctx.infospace_id, options)

                    assets_created = []
                    errors = []

                    for i, file_path in enumerate(file_paths):
                        try:
                            file_options = {
                                **(options or {}),
                                "batch_index": i,
                                "batch_total": len(file_paths),
                                "process_immediately": process_immediately,
                            }

                            with open(file_path, 'rb') as file:
                                upload_file = UploadFile(
                                    file=file,
                                    filename=os.path.basename(file_path)
                                )
                                assets = await ingest(
                                    ing_ctx, upload_file,
                                    title=os.path.basename(file_path),
                                    options=file_options,
                                )
                                assets_created.append(assets[0].id)

                            try:
                                os.unlink(file_path)
                            except OSError:
                                pass

                            progress = min(95, int(100 * (i + 1) / len(file_paths)))
                            _update_progress(session, job_id, "processing",
                                             f"Ingested {i+1}/{len(file_paths)} files", progress)

                        except Exception as e:
                            logger.error("Failed to process file %s: %s", file_path, e)
                            errors.append({"file_path": file_path, "error": str(e)})
                            continue

                    job = session.get(IngestionJob, job_id)
                    job.failed_files = len(errors)
                    _complete_job(session, job_id, len(assets_created))

                    return len(assets_created)

            count = run_async_in_celery(process_files)
            ctx.stat("done")

        except Exception as e:
            logger.exception("run_bulk_file_import failed for job %d: %s", job_id, e)
            with ctx.session() as session:
                _fail_job(session, job_id, str(e))
            ctx.item_failed(job_id)
            ctx.stat("failed")


# ── @task: unified batch ingest (mixed web URLs + archive URLs) ──────────────

@task("run_batch_ingest",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind == "batch")
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=3600,
      tags=frozenset({"content", "ingestion"}))
def run_batch_ingest(ctx: TaskContext, job_ids: list[int]):
    """Process a PENDING ``kind="batch"`` ingestion job.

    Heterogeneous item list stored in ``cursor_state.items``, each
    ``{kind: "web_url"|"archive_url", locator, title?, options?}``.
    Destination is ``job.root_bundle_id`` (resolved by the route). Items
    unroll into their natural shape beneath: archive URLs extract into a
    sub-bundle, web URLs become direct children.

    Per-item progress flows through ``ctx.job_progress`` as ``item_started``
    / ``item_done`` / ``item_failed`` events; the job's overall
    ``progress_pct`` is recomputed on each item terminal. Catastrophic
    failures (not per-item) mark the job FAILED and stop.
    """
    for job_id in job_ids:
        # Atomic claim
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id, IngestionJob.status == IngestionStatus.PENDING)
                .values(status=IngestionStatus.PROCESSING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue

        try:
            with ctx.session() as session:
                job = session.get(IngestionJob, job_id)
                cs = job.cursor_state or {}
                items = list(cs.get("items", []))
                options = cs.get("options", {}) or {}
                user_id = job.user_id
                root_bundle_id = job.root_bundle_id
                total = len(items)

            if not items:
                ctx.job_progress(job_id, status="completed", stage="completed",
                                 message="No items.", progress_pct=100,
                                 total=0, processed=0, failed=0)
                ctx.stat("done")
                continue

            ctx.job_progress(job_id, stage="processing", message=f"Starting {total} items...",
                             progress_pct=1, total=total, processed=0, failed=0)

            processed = 0
            failed = 0

            async def process_one(item: dict, index: int) -> bool:
                """Returns True on success, False on per-item failure."""
                nonlocal root_bundle_id
                kind = item.get("kind")
                locator = item.get("locator")
                title = item.get("title")
                item_options = {**options, **(item.get("options") or {})}
                ctx.job_progress(
                    job_id, status="item_started",
                    item_index=index, item_kind=kind, item_locator=locator,
                )

                if kind == "archive_url":
                    # Always nest: helper creates a sub-bundle named from the
                    # archive stem under root_bundle_id (or at ROOT if none).
                    n, created_bundle_id = await _archive_download_and_extract(
                        ctx, job_id, locator, root_bundle_id, user_id, item_options,
                    )
                    # If the job had no destination, anchor progress to the first
                    # archive's new bundle so the tree's inline indicator can find
                    # the job. Later archives nest alongside.
                    if root_bundle_id is None:
                        with ctx.session() as session:
                            j = session.get(IngestionJob, job_id)
                            if j and j.root_bundle_id is None:
                                j.root_bundle_id = created_bundle_id
                                session.add(j)
                                session.commit()
                        root_bundle_id = created_bundle_id
                    ctx.job_progress(
                        job_id, status="item_done",
                        item_index=index, item_kind=kind, item_locator=locator,
                        asset_count=n, created_bundle_id=created_bundle_id,
                    )
                    return True

                if kind == "web_url":
                    from app.api.modules.content.ingest import ingest
                    with ctx.session() as session:
                        ing_ctx = _ingestion_context(session, user_id, ctx.infospace_id, item_options)
                        ing_ctx.options = {**item_options, "scrape_immediately": True}
                        assets = await ingest(
                            ing_ctx, locator, title=title,
                            bundle_id=root_bundle_id, options=ing_ctx.options,
                        )
                        session.commit()
                    ctx.job_progress(
                        job_id, status="item_done",
                        item_index=index, item_kind=kind, item_locator=locator,
                        asset_count=len(assets),
                    )
                    return True

                raise ValueError(f"Unknown batch item kind: {kind!r}")

            async def run_all():
                nonlocal processed, failed
                for i, item in enumerate(items):
                    try:
                        ok = await process_one(item, i)
                    except Exception as e:
                        logger.exception("Batch item %d failed (%s): %s", i, item.get("locator"), e)
                        ctx.job_progress(
                            job_id, status="item_failed",
                            item_index=i, item_kind=item.get("kind"),
                            item_locator=item.get("locator"), error=str(e)[:300],
                        )
                        failed += 1
                        ok = False
                    if ok:
                        processed += 1
                    terminal = processed + failed
                    pct = min(99, int(100 * terminal / total)) if total else 99
                    ctx.job_progress(
                        job_id, stage="processing",
                        message=f"{terminal}/{total} items",
                        progress_pct=pct, processed=processed, failed=failed, total=total,
                    )

            run_async_in_celery(run_all)

            ctx.job_progress(
                job_id, status="completed", stage="completed",
                message=f"Ingested {processed}/{total} items"
                        + (f" ({failed} failed)" if failed else ""),
                progress_pct=100, processed=processed, failed=failed, total=total,
            )

            if processed:
                from app.core.dispatch import kick_tasks
                kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))

            ctx.stat("done")

        except Exception as e:
            logger.exception("run_batch_ingest failed for job %d: %s", job_id, e)
            ctx.job_progress(
                job_id, status="failed", stage="failed",
                message=str(e)[:200], progress_pct=0,
            )
            ctx.item_failed(job_id)
            ctx.stat("failed")
