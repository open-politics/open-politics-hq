"""
Batch Processing Tasks
======================

Self-chaining tasks for processing PENDING assets in batches.
Fans out individual process_content tasks to the processing queue for parallelism.
"""

import logging
from typing import Optional

from sqlmodel import Session, select, func
from sqlalchemy import text

from app.core.celery_app import celery
from app.core.db import engine
from app.core.task_primitives import self_chaining_task
from app.models import Asset, ProcessingStatus
from app.api.modules.content.services.processing_service import ProcessingService
from app.api.modules.content.services.asset_service import AssetService
from app.core.config import settings
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


@celery.task(bind=True, name="batch_process_pending")
@self_chaining_task
def batch_process_pending(
    self,
    bundle_id: int,
    batch_size: int = 100,
    after_id: int = 0,
):
    """
    Process PENDING assets in a bundle by fanning out process_content tasks.

    Dispatches each asset to the processing queue for parallel execution.
    Self-chains to schedule the next batch if more PENDING assets remain.
    Uses cursor-based pagination (after_id) to avoid double-dispatch.
    """
    from app.api.modules.content.tasks.content_tasks import process_content

    with Session(engine) as session:
        assets = session.exec(
            select(Asset)
            .where(
                Asset.bundle_id == bundle_id,
                Asset.processing_status == ProcessingStatus.PENDING,
                Asset.parent_asset_id.is_(None),
                Asset.id > after_id,
            )
            .order_by(Asset.id)
            .limit(batch_size)
        ).all()

        if not assets:
            return {"status": "done", "dispatched": 0, "remaining": 0}

        for asset in assets:
            process_content.delay(asset.id, {})

        last_id = assets[-1].id
        remaining = (
            session.exec(
                select(func.count(Asset.id))
                .where(
                    Asset.bundle_id == bundle_id,
                    Asset.processing_status == ProcessingStatus.PENDING,
                    Asset.parent_asset_id.is_(None),
                    Asset.id > last_id,
                )
            ).one()
            or 0
        )

        if remaining > 0:
            return (
                {"dispatched": len(assets), "remaining": remaining},
                (bundle_id, batch_size),
                {"after_id": last_id},
            )
        return {"dispatched": len(assets), "remaining": 0}


@celery.task(bind=True, name="batch_enrich")
@self_chaining_task
def batch_enrich(
    self,
    enricher_name: str,
    filter_criteria: dict,
    bundle_id: Optional[int] = None,
    batch_size: int = 100,
    after_id: int = 0,
):
    """
    Retroactive facet backfill. Same self-chaining pattern as batch_process_pending.

    Args:
        enricher_name: Name of enricher to run (e.g. "language_detection", "ocr")
        filter_criteria: Dict specifying which assets to enrich, e.g.
            {"missing_facet": "language"} or {"kind": "IMAGE", "missing_facet": "location_lat"}
        bundle_id: Optional bundle to limit scope
        batch_size: Assets per batch
    """
    from app.api.modules.content.enrichers import ENRICHER_REGISTRY
    from app.api.modules.content.facets import CONTENT_HASH_FIELD

    ALLOWED_FACETS = {e.target_facet for e in ENRICHER_REGISTRY.values()}

    logger.info(f"[Batch Enrich] Starting enricher={enricher_name}, batch_size={batch_size}")

    with Session(engine) as session:
        missing_facet = filter_criteria.get("missing_facet")
        kind_filter = filter_criteria.get("kind")

        if not missing_facet or missing_facet not in ALLOWED_FACETS:
            logger.warning("[Batch Enrich] filter_criteria must include valid missing_facet")
            return {"status": "error", "message": "missing_facet required and must be allowlisted"}

        # content_hash is a first-class column; others are in facets
        facet_path = f"metadata->>'{missing_facet}'" if missing_facet != CONTENT_HASH_FIELD else None
        if missing_facet == CONTENT_HASH_FIELD:
            stmt = (
                select(Asset)
                .where(Asset.content_hash.is_(None))
                .where(Asset.blob_path.isnot(None))
                .where(Asset.parent_asset_id.is_(None))
                .where(Asset.id > after_id)
                .order_by(Asset.id)
                .limit(batch_size)
            )
        else:
            stmt = (
                select(Asset)
                .where(text(f"{facet_path} IS NULL"))
                .where(Asset.parent_asset_id.is_(None))
                .where(Asset.id > after_id)
                .order_by(Asset.id)
                .limit(batch_size)
            )
        if bundle_id is not None:
            stmt = stmt.where(Asset.bundle_id == bundle_id)
        if kind_filter is not None:
            stmt = stmt.where(Asset.kind == kind_filter)

        assets = session.exec(stmt).all()

        if not assets:
            logger.info(f"[Batch Enrich] No assets missing facet {missing_facet}")
            return {"status": "done", "processed": 0, "remaining": 0}

        from app.api.modules.content.enrichers import get_enricher

        enricher = get_enricher(enricher_name)
        if not enricher:
            logger.warning(f"[Batch Enrich] Unknown enricher: {enricher_name}")
            return {"status": "error", "message": f"Unknown enricher: {enricher_name}"}

        # Task-based enrichers: dispatch Celery task with asset IDs
        if not (hasattr(enricher, "task_name") and enricher.task_name):
            logger.warning(f"[Batch Enrich] Enricher {enricher_name} has no task_name; cannot dispatch")
            return {"status": "error", "message": f"Enricher {enricher_name} has no task_name"}

        asset_ids = [a.id for a in assets]
        celery.send_task(enricher.task_name, args=[asset_ids])
        logger.info(f"[Batch Enrich] Dispatched {enricher.task_name} for {len(asset_ids)} assets")

        last_id = assets[-1].id

        # Count remaining
        if missing_facet == CONTENT_HASH_FIELD:
            count_stmt = (
                select(func.count(Asset.id))
                .where(Asset.content_hash.is_(None))
                .where(Asset.blob_path.isnot(None))
                .where(Asset.parent_asset_id.is_(None))
                .where(Asset.id > last_id)
            )
        else:
            count_stmt = (
                select(func.count(Asset.id))
                .where(text(f"{facet_path} IS NULL"))
                .where(Asset.parent_asset_id.is_(None))
                .where(Asset.id > last_id)
            )
        if bundle_id is not None:
            count_stmt = count_stmt.where(Asset.bundle_id == bundle_id)
        if kind_filter is not None:
            count_stmt = count_stmt.where(Asset.kind == kind_filter)
        remaining = session.exec(count_stmt).one() or 0

        if remaining > 0:
            return (
                {"processed": len(assets), "remaining": remaining},
                (enricher_name, filter_criteria, bundle_id, batch_size),
                {"after_id": last_id},
            )
        return {"processed": len(assets), "remaining": 0}
