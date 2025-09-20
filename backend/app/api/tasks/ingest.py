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

        source = source_service.get_source(source_id, -1, -1) # Bypassing user check for system task
        if not source:
            raise ValueError(f"Source {source_id} not found.")

        source.status = SourceStatus.PROCESSING
        session.add(source)
        session.commit()

        try:
            locator = source_service._extract_locator_from_source(source)
            
            # The bundle_id to collect assets into might be in the source's details or task config.
            # For simplicity, we assume it's passed or handled within discover_and_create_assets if needed.
            # This example focuses on the core dispatch.
            
            assets = await content_ingestion_service.ingest_content(
                locator=locator,
                infospace_id=source.infospace_id,
                user_id=source.user_id,
                bundle_id=None, # Or get from source details if applicable
                options={**(source.details or {}), **(task_origin_details_override or {})}
            )

            for asset in assets:
                asset.source_id = source.id
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
