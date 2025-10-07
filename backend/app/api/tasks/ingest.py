import logging
import time
from typing import Dict, Any, Optional

from app.core.celery_app import celery
from sqlmodel import Session
from app.core.db import engine
from app.models import Source, SourceStatus
from app.api.tasks.utils import run_async_in_celery

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class BaseIngestionTask(celery.Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(f'Celery task {task_id} failed: {exc!r}')
        source_id = args[0] if args else None
        if source_id:
            logger.info(f"Attempting to mark Source {source_id} as FAILED due to task failure.")
            try:
                with Session(engine) as fail_session:
                    source_obj = fail_session.get(Source, source_id)
                    if source_obj:
                        error_message = f"Task failed: {type(exc).__name__}: {str(exc)[:250]}"
                        source_obj.status = SourceStatus.FAILED
                        source_obj.error_message = error_message
                        fail_session.add(source_obj)
                        fail_session.commit()
                        logger.info(f"Successfully marked Source {source_id} as FAILED.")
                    else:
                        logger.error(f"Source {source_id} not found during on_failure handling.")
            except Exception as fail_update_e:
                logger.error(f"CRITICAL: Failed to update Source {source_id} status to FAILED: {fail_update_e}", exc_info=True)
        else:
            logger.error("Could not determine source_id from task arguments for failure handling.")

async def _process_source_async(source_id: int, task_origin_details_override: Optional[Dict[str, Any]] = None):
    """
    Asynchronous core logic for processing a source using the unified discovery service.
    """
    with Session(engine) as session:
        from app.api.services.source_service import SourceService
        from app.api.services.content_ingestion_service import ContentIngestionService

        source_service = SourceService(session)
        content_ingestion_service = ContentIngestionService(session)

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
                    from app.api.services.bundle_service import BundleService
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
            
            assets = await content_ingestion_service.ingest_content(
                locator=locator,
                infospace_id=source.infospace_id,
                user_id=source.user_id,
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

@celery.task(bind=True, max_retries=3, base=BaseIngestionTask, autoretry_for=(ValueError,), retry_backoff=True, retry_backoff_max=60)
def process_source(self, source_id: int, task_origin_details_override: Optional[Dict[str, Any]] = None):
    """
    Unified background task to process a Source by dispatching to the AssetDiscoveryService.
    This task is now the single entry point for all source-based ingestion.
    """
    logging.info(f"Starting unified ingestion task for Source ID: {source_id}")
    start_time = time.time()

    try:
        run_async_in_celery(_process_source_async, source_id, task_origin_details_override)
    except Exception as e:
        # The on_failure handler in BaseIngestionTask will catch this
        logging.error(f"Unified ingestion task for Source {source_id} failed after async execution: {e}", exc_info=True)
        raise
    finally:
        end_time = time.time()
        logger.info(f"Unified ingestion task for Source ID: {source_id} finished in {end_time - start_time:.2f} seconds.")
