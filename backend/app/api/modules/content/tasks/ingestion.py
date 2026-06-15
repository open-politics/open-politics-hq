"""
Content ingestion — the unified, source-driven ``ingest`` @task.

A producer mints a PENDING IngestionJob (``kind`` ∈ ``registered_source_kinds()``,
``cursor_state.config.items``); ``ingest`` claims it and runs the whole spine:

    read(config, cursor) → source_token guard → fetch → detect_kind →
    AssetBuilder.decide → place-in-bundle → count → emit/kick

One-shot = a job with no ``source_id``; a poll = a job with ``source_id`` set
(monitoring is then just a Source minting these jobs on a schedule). Counters come
from ``BuildOutcome.status``, never ``len()``. schedule=None: dispatched via the
``ingestion_job.created`` event or ``kick_tasks()``, never beat-polled.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import update, func
from sqlmodel import Session, select

from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery
from app.models import IngestionJob, IngestionStatus
from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import Asset, ProcessingStatus, Source, SourceStatus
from app.api.modules.content.sources import (
    get_source_handler, registered_source_kinds, RawItem,
)

logger = logging.getLogger(__name__)


# ── The spine ─────────────────────────────────────────────────────────────────
# read → source_token guard (skip unchanged before fetch) → fetch → detect_kind →
# AssetBuilder.decide → place. Counters from BuildOutcome.status, never len(). v1
# idempotency comes from the guard + decide(), so a re-poll / crash-resume is safe.
# Cross-poll cursor *resume* (avoid re-enumerating a 150k-file directory) is deferred.

_INGEST_CHUNK = 200            # items per commit — streams huge sources, bounded txn
_UNSET_TOKEN: Any = object()   # "identifier not previously ingested" (≠ token is None)


def _bulk_guard(session: Session, infospace_id: int, identifiers: List[str]) -> Dict[str, Any]:
    """One query → {source_identifier: source_token} for live rows already ingested.
    Lets the loop skip unchanged items before fetch; build_outcome stays the
    authority for the create/skip/supersede decision."""
    ids = [i for i in identifiers if i]
    if not ids:
        return {}
    rows = session.exec(
        select(Asset.source_identifier, Asset.source_token).where(
            Asset.infospace_id == infospace_id,
            Asset.source_identifier.in_(ids),
            Asset.is_superseded.is_(False),
        )
    ).all()
    return {sid: tok for sid, tok in rows}


async def intake_item(
    item: RawItem, source, sctx: SourceContext, *,
    on_drift: str = "update", source_id: Optional[int] = None,
    dest_id: Optional[int] = None, path_memo: Optional[Dict[str, int]] = None,
) -> "BuildOutcome":
    """Acquire ONE item that already passed the stage-1 guard: fetch → detect_kind →
    build. The per-item half of the acquire spine; ``intake_items`` adds the bulk guard.

    Dedup strategy is a DECLARED knob (``on_drift``: update|supersede|skip) — the source/job
    config picks what a drifted item does; identity = source_identifier, drift = source_token,
    both from the source's ``read()``. Stage 2 (build_outcome → decide) no-ops on unchanged
    content, so re-polls never churn. Flush-never-commit; caller owns the transaction."""
    from app.api.modules.content.asset_builder import AssetBuilder
    from app.api.modules.content.types import needs_processing, detect_kind
    from app.api.modules.content.tree import ensure_path_bundles

    session = sctx.session
    fetched = await source.fetch(item, sctx)
    # Kind: trust the source if it named one at read (filename/assertion); else classify
    # from the fetched bytes via the one detect_kind seam (mimetype → sniff → ext → FILE).
    kind = item.kind or detect_kind(fetched.mimetype, fetched.head, item.title)
    b = (
        AssetBuilder(session, sctx.user_id, sctx.infospace_id)
        .as_kind(kind).with_title(item.title)
        .with_source(item.source_identifier)
        .dedup_on(source_identifier=item.source_identifier)
        .on_match(on_drift)
        .with_metadata(**{**(item.metadata or {}), **(fetched.metadata or {})})
    )
    if item.source_token: b.with_source_token(item.source_token)
    if source_id: b.with_source_id(source_id)
    # Placement: folders become bundles. With a dest the path nests under it; without a
    # dest the path forms top-level bundles (a dropped folder keeps its shape). No path +
    # no dest → ROOT.
    bundle = (ensure_path_bundles(session, dest_id, item.path,
                                  user_id=sctx.user_id, infospace_id=sctx.infospace_id,
                                  memo=path_memo if path_memo is not None else {})
              if (dest_id or item.path) else None)
    if bundle: b.into_bundle(bundle)
    if fetched.text_content: b.with_text(fetched.text_content)
    if fetched.blob_path: b.with_blob(fetched.blob_path)
    if fetched.content_hash: b.with_content_hash(fetched.content_hash)
    ts = item.event_timestamp or fetched.event_timestamp
    if ts: b.with_timestamp(ts)
    if needs_processing(kind):
        b.with_processing_status(ProcessingStatus.PENDING)
    return await b.build_outcome()


async def intake_items(
    items: List[RawItem], source, sctx: SourceContext, *,
    on_drift: str = "update", source_id: Optional[int] = None,
    dest_id: Optional[int] = None, path_memo: Optional[Dict[str, int]] = None,
) -> Dict[str, int]:
    """Acquire a batch: the stage-1 ``source_token`` guard (skip unchanged before fetch),
    then build each survivor via ``intake_item``, counting outcomes. The acquire spine —
    driven by the ``ingest`` @task over a job, but pure enough to call directly (the
    zero-write re-poll test does exactly that). Flush-never-commit; caller commits."""
    counts = {"created": 0, "skipped": 0, "superseded": 0, "updated": 0}
    if not items:
        return counts
    guard = _bulk_guard(sctx.session, sctx.infospace_id, [it.source_identifier for it in items])
    for it in items:
        prior = guard.get(it.source_identifier, _UNSET_TOKEN)
        # Already ingested? Skip — UNLESS the source reports real drift via a CHANGED token.
        # A None token means "no drift signal", so re-seeing the identifier is a no-op; only
        # a present, *different* token re-fetches. This is the whole re-poll dedup (stage 1).
        if prior is not _UNSET_TOKEN and (it.source_token is None or prior == it.source_token):
            counts["skipped"] += 1
            continue
        outcome = await intake_item(
            it, source, sctx, on_drift=on_drift, source_id=source_id,
            dest_id=dest_id, path_memo=path_memo,
        )
        counts[outcome.status] += 1
    return counts


async def _run_ingestion_job(ctx: TaskContext, job_id: int) -> Dict[str, int]:
    """Stream a job's source: read → guard → fetch → build → count, committed in
    chunks (memory-safe for huge sources). One enumeration per job; the @task
    self-chains to the next PENDING job."""
    from app.api.modules.foundation_service_providers import resolve
    from app.core.config import settings

    counts = {"created": 0, "skipped": 0, "superseded": 0, "updated": 0}

    with ctx.session() as session:
        job = session.get(IngestionJob, job_id)
        source_cls = get_source_handler(job.kind)
        if source_cls is None:
            raise ValueError(f"No source handler registered for kind {job.kind!r}")
        source = source_cls()
        cs = dict(job.cursor_state or {})
        config = cs.get("config", {})
        cursor = cs.get("cursor", {})
        dest_id = job.root_bundle_id
        source_id = job.source_id
        on_drift = (config or {}).get("on_drift") or "update"   # dedup policy knob (skip|supersede|update)

        try:
            search = resolve("web_search", infospace_id=job.infospace_id)
        except Exception:
            search = None
        sctx = SourceContext(
            session=session, user_id=job.user_id, infospace_id=job.infospace_id,
            settings=settings, storage_provider=resolve("storage"),
            scraping_provider=resolve("scraping"), search_provider=search,
            options=dict(config or {}),
        )

        total = job.total_files or 0     # known for intake jobs; 0 for streaming polls
        chunk: List[RawItem] = []
        path_memo: Dict[str, int] = {}   # folder-path → bundle id, per job (find-or-create once)

        async def _flush():
            if not chunk:
                return
            c = await intake_items(
                chunk, source, sctx, on_drift=on_drift, source_id=source_id,
                dest_id=dest_id, path_memo=path_memo,
            )
            for k, v in c.items():
                counts[k] += v
            session.commit()
            chunk.clear()
            # Live progress per chunk — ctx.job_progress writes the job row (polled
            # by the frontend) AND pushes the SSE stream event, in one call.
            handled = sum(counts.values())
            ctx.job_progress(
                job_id, stage="acquiring",
                processed=counts["created"] + counts["superseded"] + counts["updated"],
                progress_pct=min(99, round(100 * handled / total)) if total else None,
                message=f"{handled}/{total} items" if total else f"{handled} items",
            )

        async for item in source.read(config, cursor, sctx):
            chunk.append(item)
            if len(chunk) >= _INGEST_CHUNK:
                await _flush()
        await _flush()

    # Finalize: the job half rides the substrate primitive (COMPLETED + pct 100 +
    # counts into cursor_state + stream event); the Source counters are domain state.
    ctx.job_progress(
        job_id, status="completed", stage="completed", progress_pct=100,
        processed=counts["created"] + counts["superseded"] + counts["updated"],
        counts=counts,
        message=f"{counts['created']} new · {counts['superseded']} updated · {counts['skipped']} unchanged",
    )
    if source_id:
        with ctx.session() as session:
            src = session.get(Source, source_id)
            if src:
                fresh = counts["created"] + counts["superseded"]
                src.last_poll_at = datetime.now(timezone.utc)
                src.items_last_poll = fresh
                src.total_items_ingested = (src.total_items_ingested or 0) + fresh
                src.consecutive_failures = 0          # poll succeeded → reset breaker
                src.status = SourceStatus.PENDING      # back to idle/ready (mint set PROCESSING)
                session.add(src)
                session.commit()

    if counts["created"] or counts["superseded"]:
        from app.core.dispatch import kick_tasks
        from app.core.events import emit
        # Both paths reach item_processing: the event (it's subscribed to asset.ingested)
        # and the kick (it's tagged "content"). Producers emit; kick is the sweep.
        emit("asset.ingested", {"infospace_id": ctx.infospace_id})
        kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))
    return counts


@task("ingest",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 IngestionJob.status == IngestionStatus.PENDING,
                 IngestionJob.kind.in_(list(registered_source_kinds())))
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=3600,
      tags=frozenset({"content", "ingestion"}))
def ingest(ctx: TaskContext, job_ids: list[int]):
    """Unified source-driven ingestion. Claim a PENDING IngestionJob, dispatch to its
    Source handler via the registry, run read→guard→fetch→build→count, write accurate
    counters."""
    for job_id in job_ids:
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
            run_async_in_celery(_run_ingestion_job, ctx, job_id)
            ctx.stat("done")
        except Exception as e:
            logger.exception("ingest failed for job %d: %s", job_id, e)
            ctx.job_progress(job_id, status="failed", stage="failed", message=str(e))
            with ctx.session() as session:
                # If this was a Source poll, advance its circuit-breaker so a run of
                # failures eventually trips the source_polling threshold.
                failed_job = session.get(IngestionJob, job_id)
                if failed_job and failed_job.source_id:
                    src = session.get(Source, failed_job.source_id)
                    if src:
                        src.consecutive_failures = (src.consecutive_failures or 0) + 1
                        src.status = SourceStatus.FAILED
                        src.last_error_at = datetime.now(timezone.utc)
                        src.error_message = str(e)[:500]
                        session.add(src)
                        session.commit()
            ctx.item_failed(job_id)
            ctx.stat("failed")
