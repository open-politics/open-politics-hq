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
from typing import Any, Dict

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
    from app.api.modules.content.services.asset_service import AssetService
    from app.api.modules.content.services.bundle_service import BundleService
    from app.api.modules.foundation_service_providers.registry import (
        get_storage_provider, get_scraping_provider, get_web_search_provider,
    )
    from app.core.config import settings

    storage = get_storage_provider(settings)
    scraping = get_scraping_provider(settings)
    try:
        search = get_web_search_provider(settings)
    except Exception:
        search = None

    return IngestionContext(
        session=session,
        storage_provider=storage,
        scraping_provider=scraping,
        search_provider=search,
        asset_service=AssetService(session, storage),
        bundle_service=BundleService(session),
        user_id=user_id,
        infospace_id=infospace_id,
        settings=settings,
        options=options or {},
    )


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
                from app.api.modules.content.services.asset_service import AssetService
                from app.api.modules.content.services.bundle_service import BundleService
                from app.api.modules.foundation_service_providers.registry import (
                    get_storage_provider, get_scraping_provider,
                )
                from app.core.db import engine

                bundle_service = BundleService(session)
                storage_provider = get_storage_provider(settings) if copy_mode else None
                asset_service = AssetService(session, storage_provider or get_storage_provider(settings))
                scraping_provider = get_scraping_provider(settings)

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
                    asset_service=asset_service,
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
            async def process_archive():
                with ctx.session() as session:
                    job = session.get(IngestionJob, job_id)
                    archive_url = job.source_locator
                    user_id = job.user_id
                    root_bundle_id = job.root_bundle_id
                    options = (job.cursor_state or {}).get("options", {})

                    _update_progress(session, job_id, "downloading", "Downloading archive...", 10)

                    from app.models import Bundle
                    root_bundle = session.get(Bundle, root_bundle_id)
                    if not root_bundle:
                        raise ValueError(f"Root bundle {root_bundle_id} not found")

                    from app.api.modules.content.handlers import ArchiveHandler, IngestionContext
                    from app.api.modules.content.services.asset_service import AssetService
                    from app.api.modules.content.services.bundle_service import BundleService
                    from app.api.modules.foundation_service_providers.registry import (
                        get_storage_provider, get_scraping_provider,
                    )
                    from app.core.config import settings

                    storage = get_storage_provider(settings)
                    scraping = get_scraping_provider(settings)
                    ing_ctx = IngestionContext(
                        session=session,
                        storage_provider=storage,
                        scraping_provider=scraping,
                        search_provider=None,
                        asset_service=AssetService(session, storage),
                        bundle_service=BundleService(session),
                        user_id=user_id,
                        infospace_id=ctx.infospace_id,
                        settings=settings,
                        options=options,
                    )
                    handler = ArchiveHandler(ing_ctx)

                    job.status = IngestionStatus.EXTRACTING
                    _update_progress(session, job_id, "extracting", "Extracting archive...", 30)
                    job.status = IngestionStatus.PROCESSING
                    _update_progress(session, job_id, "processing", "Processing files...", 50)

                    created_assets = await handler._process_archive_sync(
                        archive_url, root_bundle, ctx.infospace_id, user_id, options
                    )

                    _complete_job(session, job_id, len(created_assets))

                    if created_assets:
                        from app.core.dispatch import kick_tasks
                        kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))

                    return len(created_assets)

            count = run_async_in_celery(process_archive)
            ctx.stat("done")
            logger.info("run_archive_import completed job %d: %d assets", job_id, count)

        except Exception as e:
            logger.exception("run_archive_import failed for job %d: %s", job_id, e)
            with ctx.session() as session:
                _fail_job(session, job_id, str(e))
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

                            # Update progress
                            progress = min(95, int(100 * (i + 1) / len(urls)))
                            _update_progress(session, job_id, "processing",
                                             f"Ingested {i+1}/{len(urls)} URLs", progress)

                        except Exception as e:
                            logger.error("Failed to process URL %s: %s", url, e)
                            errors.append({"url": url, "error": str(e)})
                            continue

                    job = session.get(IngestionJob, job_id)
                    job.failed_files = len(errors)
                    _complete_job(session, job_id, len(assets_created))

                    return len(assets_created)

            count = run_async_in_celery(process_urls)
            ctx.stat("done")

        except Exception as e:
            logger.exception("run_bulk_url_import failed for job %d: %s", job_id, e)
            with ctx.session() as session:
                _fail_job(session, job_id, str(e))
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
