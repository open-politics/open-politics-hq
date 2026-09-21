"""
Content processing @task functions.

Discoverable work: item_processing, reset_stale, clean_orphans, retry_failed.
These are found by the dispatcher (via check queries) or triggered by events/kicks.

Provider resolution: ctx.provider(StorageProvider), ctx.provider(ScrapingProvider).
Service construction: _processing_service() local helper.

Error handling convention:
- Domain errors (bad PDF, parse failure): catch in function, mark asset FAILED,
  call ctx.item_failed(), do NOT re-raise. Chain continues to next asset.
- Infrastructure errors (DB down, provider unavailable): let bubble to wrapper.
  Wrapper sets backoff, optionally retries. Chain stops, kick/schedule recovers.
"""

import logging
from typing import Any, Dict, List, Optional

from sqlalchemy import update, func, text, or_, exists
from sqlalchemy.orm import aliased
from sqlmodel import Session, select

from app.api.modules.content.contexts import ProcessingContext
from app.api.modules.content.models import Asset, ProcessingStatus
from app.api.modules.foundation_service_providers import StorageProvider, ScrapingProvider
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


async def process_asset(
    session: Session, asset: Asset, *, storage, scraping=None,
    options: Optional[Dict[str, Any]] = None,
) -> List[Asset]:
    """Expand one asset via its ``ContentType.process`` — the single processing primitive
    (folded from the late ProcessingService). Trusts the kind decided at ACQUIRE (no
    post-extraction reclassify): looks up the type, runs its processor (which sets
    ``modalities`` and persists children), flips PROCESSING→READY (FAILED on error), and
    emits ``asset.processed`` per child so the enrichers self-query. Shared by the
    ``item_processing`` @task and the reprocess routes. Owns its commits."""
    from app.api.modules.content.types import get_content_type_registry
    from app.core.config import settings
    from app.core.events import emit

    descriptor = get_content_type_registry().by_kind(asset.kind)
    if descriptor and descriptor.skip_processing:
        return []
    processor_fn = descriptor.processor if descriptor else None
    if processor_fn is None:
        asset.processing_status = ProcessingStatus.READY
        session.add(asset)
        session.commit()
        return []

    asset.processing_status = ProcessingStatus.PROCESSING
    session.add(asset)
    session.commit()
    try:
        opts = dict(options or {})
        # PDF_MAX_PAGES is a ceiling, not a default: a caller may ask for fewer
        # pages than the deployment allows, never more. 0 = no limit, both sides.
        ceiling = settings.PDF_MAX_PAGES
        requested = opts.get("max_pages") or ceiling
        opts["max_pages"] = min(requested, ceiling) if ceiling else requested
        context = ProcessingContext(
            session=session, user_id=asset.user_id, infospace_id=asset.infospace_id,
            storage_provider=storage, scraping_provider=scraping, options=opts,
        )
        children = await processor_fn(context, asset)
        asset.processing_status = ProcessingStatus.READY
        session.add(asset)
        session.commit()
        for c in children:
            emit("asset.processed",
                 {"asset_id": c.id, "kind": c.kind.value, "infospace_id": c.infospace_id})
        logger.info("Processed asset %s (%s), %d children", asset.id, asset.kind.value, len(children))
        return children
    except Exception as e:
        asset.processing_status = ProcessingStatus.FAILED
        asset.processing_error = str(e)
        session.add(asset)
        session.commit()
        logger.error("process_asset failed for asset %s: %s", asset.id, e)
        raise


_ParentAsset = aliased(Asset)


def _pending_with_ready_parent(iid: int):
    """PENDING assets eligible to process: a root (no parent), or a child whose
    parent is already READY. Replaces the old ``parent_asset_id IS NULL`` gate so a
    processable *child* — a PDF inside an email inside an mbox, a file inside a
    nested archive — gets swept once its parent finishes. Recursion falls out of
    pipeline re-entry: ``self_chain`` re-runs this query until it returns nothing, and
    each level becomes eligible the moment its parent flips READY.

    Deliberately no ``kind.in_(processable_kinds())`` filter: whether a kind has a
    processor is decided in ``process_content`` (no processor → mark READY), and the
    legacy directory import still creates non-processable files PENDING. Filtering on
    processable kinds here would strand those PENDING until that handler is retired
    (Phase 8). The filter moves in once creation-time status is authoritative (Phase 6).
    """
    return (
        select(Asset.id)
        .where(
            Asset.infospace_id == iid,
            Asset.processing_status == ProcessingStatus.PENDING,
            or_(
                Asset.parent_asset_id.is_(None),
                exists().where(
                    _ParentAsset.id == Asset.parent_asset_id,
                    _ParentAsset.processing_status == ProcessingStatus.READY,
                ),
            ),
        )
        .order_by(Asset.id)
    )


@task("item_processing",
      check=_pending_with_ready_parent,
      schedule=None,
      triggers=["asset.ingested"],
      self_chain=True,
      batch=50,
      queue="processing",
      # A container type's `process` does real work inside this task: a PDF
      # splits into pages, an archive unrolls (nested, in-process), a feed
      # document runs the whole acquire spine over its entries — which now
      # includes realizing each one from its URL. This was the one heavy task
      # still on the 120 s DEFAULT, not on a considered budget (`ingest` sets
      # 3600, `process_annotation_run` 7200, `source_polling` 600). Still well
      # inside Celery's 3720 s hard limit and the stale-PROCESSING reset window,
      # so a genuinely stuck asset is still recovered.
      timeout=1800,
      tags=frozenset({"content"}))
def item_processing(ctx: TaskContext, asset_ids: list[int]):
    """Process PENDING assets. Atomic claim per asset, then process_asset (the type's processor)."""
    for asset_id in asset_ids:
        # Phase 1: Atomic claim (separate session — survives processing failure)
        with ctx.session() as session:
            claimed = session.execute(
                update(Asset)
                .where(Asset.id == asset_id, Asset.processing_status == ProcessingStatus.PENDING)
                .values(processing_status=ProcessingStatus.PROCESSING, updated_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue  # Already claimed by another chain

        # Phase 2: Process (fresh session — if this fails, claim is preserved)
        try:
            with ctx.session() as session:
                asset = session.get(Asset, asset_id)
                if not asset:
                    continue
                run_async_in_celery(
                    process_asset, session, asset,
                    storage=ctx.provider(StorageProvider),
                    scraping=ctx.provider(ScrapingProvider),
                )
            ctx.stat("done")
        except Exception as e:
            logger.error("item_processing failed for asset %d: %s", asset_id, e, exc_info=True)
            with ctx.session() as session:
                session.execute(
                    update(Asset).where(Asset.id == asset_id)
                    .values(processing_status=ProcessingStatus.FAILED)
                )
                session.commit()
            ctx.item_failed(asset_id)
            ctx.stat("failed")

    from app.core.events import emit
    emit("asset.processed", {"infospace_id": ctx.infospace_id})


@task("reset_stale_processing",
      check=lambda iid: (
          select(Asset.id)
          .where(Asset.infospace_id == iid,
                 Asset.processing_status == ProcessingStatus.PROCESSING,
                 Asset.updated_at < func.now() - text("interval '3720 seconds'"))
      ),
      schedule=3600,
      batch=100,
      queue="default",
      tags=frozenset({"content"}))
def reset_stale(ctx: TaskContext, asset_ids: list[int]):
    """Reset assets stuck in PROCESSING longer than task_time_limit (3720s).
    Recovers from worker crashes where asset was claimed but never completed."""
    with ctx.session() as session:
        session.execute(
            update(Asset).where(Asset.id.in_(asset_ids))
            .values(processing_status=ProcessingStatus.PENDING)
        )
        session.commit()
    ctx.stat("done", len(asset_ids))


@task("clean_orphaned_children",
      check=lambda iid: (
          select(Asset.id)
          .where(
              Asset.infospace_id == iid,
              Asset.parent_asset_id.isnot(None),
              # Orphan = the parent row no longer exists. NOT EXISTS is a pkey
              # antijoin (fast at any scale); the old ``NOT IN (SELECT id …)`` was a
              # catastrophic full-table antijoin that melted large infospaces (it
              # ran for 13+ min on a 471k-asset infospace and exhausted connections).
              ~exists().where(
                  _ParentAsset.id == Asset.parent_asset_id,
                  _ParentAsset.infospace_id == iid,
              ),
          )
      ),
      schedule=86400,
      batch=100,
      queue="default",
      tags=frozenset({"content"}))
def clean_orphans(ctx: TaskContext, asset_ids: list[int]):
    """Delete child assets whose parent no longer exists."""
    with ctx.session() as session:
        for asset_id in asset_ids:
            asset = session.get(Asset, asset_id)
            if asset:
                session.delete(asset)
        session.commit()
    ctx.stat("done", len(asset_ids))


@task("retry_failed_processing",
      check=lambda iid: (
          select(Asset.id)
          .where(Asset.infospace_id == iid,
                 Asset.processing_status == ProcessingStatus.FAILED)
      ),
      schedule=3600,
      batch=50,
      queue="processing",
      tags=frozenset({"content"}))
def retry_failed(ctx: TaskContext, asset_ids: list[int]):
    """Retry FAILED assets by resetting to PENDING. item_failed circuit breaker
    prevents infinite retries (max_item_failures default = 5)."""
    with ctx.session() as session:
        session.execute(
            update(Asset).where(Asset.id.in_(asset_ids))
            .values(processing_status=ProcessingStatus.PENDING)
        )
        session.commit()
    ctx.stat("done", len(asset_ids))
