"""
Source ingestion @task: process sources by dispatching to the unified ingestion system.
"""

import logging
import time
from typing import Dict, Any, Optional

from sqlmodel import select

from app.api.modules.content.models import Source, SourceStatus
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


async def _process_source_async(source_id: int, task_origin_details_override: Optional[Dict[str, Any]] = None):
    """
    Asynchronous core logic for processing a source using the unified discovery service.
    """
    from sqlmodel import Session
    from app.core.db import engine

    with Session(engine) as session:
        from app.core.config import settings
        from app.api.modules.content.handlers import IngestionContext
        from app.api.modules.content.ingest import ingest
        from app.api.modules.content.services.source_service import SourceService
        from app.api.modules.foundation_service_providers.registry import (
            get_storage_provider, get_scraping_provider, get_web_search_provider,
        )
        from app.api.modules.content.services.asset_service import AssetService
        from app.api.modules.content.services.bundle_service import BundleService

        source_service = SourceService(session)

        # Get source directly without user validation for system task
        source = session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found.")

        source.status = SourceStatus.PROCESSING
        session.add(source)
        session.commit()

        try:
            locator = source_service._extract_locator_from_source(source)

            # Get bundle_id from source details or task config
            bundle_id = None
            if task_origin_details_override and 'target_bundle_id' in task_origin_details_override:
                bundle_id = task_origin_details_override['target_bundle_id']
            elif source.details and 'target_bundle_id' in source.details:
                bundle_id = source.details['target_bundle_id']

            # Validate that the bundle still exists (it may have been deleted)
            if bundle_id:
                from app.models import Bundle
                bundle = session.get(Bundle, bundle_id)
                if not bundle:
                    logger.warning(f"Bundle {bundle_id} referenced in source {source_id} no longer exists. Finding or creating bundle.")
                    from app.schemas import BundleCreate
                    from app.api.modules.content.services.bundle_service import BundleService
                    from sqlmodel import select

                    bundle_service = BundleService(session)
                    bundle_name = f"Ingestion for {source.name}"

                    # First, try to find existing bundle with this name (reuse it)
                    existing_bundle = session.exec(
                        select(Bundle).where(
                            Bundle.infospace_id == source.infospace_id,
                            Bundle.name == bundle_name
                        )
                    ).first()

                    if existing_bundle:
                        # Reuse existing bundle
                        bundle_id = existing_bundle.id
                        logger.info(f"Reusing existing bundle {bundle_id} ('{bundle_name}') for source {source_id}")
                    else:
                        # Create new bundle (name is safe - doesn't exist yet)
                        new_bundle = bundle_service.create_bundle(
                            bundle_in=BundleCreate(
                                name=bundle_name,
                                description=f"Auto-created bundle for source {source.name}"
                            ),
                            user_id=source.user_id,
                            infospace_id=source.infospace_id
                        )
                        bundle_id = new_bundle.id
                        logger.info(f"Created new bundle {bundle_id} ('{bundle_name}') for source {source_id}")

                    # Update source.details with bundle_id (new or reused)
                    if source.details is None:
                        source.details = {}
                    source.details['target_bundle_id'] = bundle_id
                    session.add(source)
                    session.commit()

            logger.info(f"Ingesting content for source {source_id} into bundle {bundle_id}")

            storage = get_storage_provider(settings)
            context = IngestionContext(
                session=session,
                storage_provider=storage,
                scraping_provider=get_scraping_provider(settings),
                search_provider=get_web_search_provider(settings),
                asset_service=AssetService(session, storage),
                bundle_service=BundleService(session),
                user_id=source.user_id,
                infospace_id=source.infospace_id,
                settings=settings,
                options={**(source.details or {}), **(task_origin_details_override or {})},
            )

            assets = await ingest(
                context,
                locator,
                bundle_id=bundle_id,
                options={**(source.details or {}), **(task_origin_details_override or {})}
            )

            # Link assets to source and ensure bundle_id is set (ingest_content should have done this)
            for asset in assets:
                # Only set source_id on top-level assets (not child assets)
                if asset.parent_asset_id is None:
                    asset.source_id = source.id
                    # Ensure bundle_id is set (defensive check)
                    if bundle_id and not asset.bundle_id:
                        asset.bundle_id = bundle_id
                session.add(asset)

            source.status = SourceStatus.COMPLETE
            if source.source_metadata is None:
                source.source_metadata = {}
            source.source_metadata.update({
                'assets_discovered': len(assets),
                'last_processed_at': time.time()
            })
            session.add(source)
            session.commit()
            logger.info(f"Successfully processed Source {source_id}, created {len(assets)} assets.")

        except Exception as e:
            logger.error(f"Error processing Source {source_id}: {e}", exc_info=True)
            source.status = SourceStatus.FAILED
            source.error_message = str(e)
            session.add(source)
            session.commit()
            raise


@task("process_source",
      check=lambda iid: (
          select(Source.id)
          .where(
              Source.infospace_id == iid,
              Source.status == SourceStatus.PENDING,
          )
          .order_by(Source.created_at)
      ),
      schedule=None,
      triggers=["source.process"],
      batch=5,
      self_chain=True,
      queue="processing",
      timeout=3600,
      retries=3,
      retry_delay=60,
      tags=frozenset({"content", "ingestion"}))
def process_source(ctx: TaskContext, source_ids: list[int]):
    """Process pending sources by dispatching to the unified ingestion system."""
    for source_id in source_ids:
        try:
            run_async_in_celery(_process_source_async, source_id)
            ctx.stat("done")
        except Exception as e:
            logger.error("Source %d processing failed: %s", source_id, e, exc_info=True)
            ctx.item_failed(source_id)
            ctx.stat("failed")
