"""
Content processing @task functions.

Discoverable work: process_pending, reset_stale, clean_orphans, retry_failed.
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

from sqlalchemy import update, func, text
from sqlmodel import Session, select

from app.api.modules.content.models import Asset, ProcessingStatus
from app.api.modules.content.services.asset_service import AssetService
from app.api.modules.content.services.processing_service import ProcessingService
from app.api.modules.foundation_service_providers.base import StorageProvider, ScrapingProvider
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


def _processing_service(ctx: TaskContext, session: Session) -> ProcessingService:
    """Build ProcessingService from TaskContext. Local helper."""
    storage = ctx.provider(StorageProvider)
    scraping = ctx.provider(ScrapingProvider)
    return ProcessingService(
        session=session,
        storage_provider=storage,
        scraping_provider=scraping,
        asset_service=AssetService(session, storage),
    )


@task("process_pending",
      check=lambda iid: (
          select(Asset.id)
          .where(Asset.infospace_id == iid,
                 Asset.processing_status == ProcessingStatus.PENDING,
                 Asset.parent_asset_id.is_(None))
          .order_by(Asset.id)
      ),
      schedule=None,
      triggers=["asset.ingested"],
      self_chain=True,
      batch=50,
      queue="processing",
      tags=frozenset({"content"}))
def process_pending(ctx: TaskContext, asset_ids: list[int]):
    """Process PENDING assets. Atomic claim per asset, then ProcessingService."""
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
                svc = _processing_service(ctx, session)
                asset = session.get(Asset, asset_id)
                if not asset:
                    continue
                run_async_in_celery(svc.process_content, asset, {})
            ctx.stat("done")
        except Exception as e:
            logger.error("process_pending failed for asset %d: %s", asset_id, e, exc_info=True)
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
              ~Asset.parent_asset_id.in_(
                  select(Asset.id).where(Asset.infospace_id == iid)
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
