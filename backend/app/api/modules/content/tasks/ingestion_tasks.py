"""
Ingestion Tasks
===============

Background tasks for content ingestion (local directory import, remote archive).
Handles remote ZIP downloads, extraction, and directory structure mirroring.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, Any, List, Optional
from sqlmodel import Session

from app.core.celery_app import celery
from app.core.db import engine
from app.models import Bundle
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


@celery.task(bind=True, name="ingest_archive_task", max_retries=3)
def ingest_archive_task(
    self,
    job_id: int,
    archive_url: str,
    root_bundle_id: int,
    infospace_id: int,
    user_id: int,
    options: Dict[str, Any],
    user_agent: Optional[str] = None
):
    """
    Background task for ingesting large remote archives.

    This task:
    1. Downloads archive (streaming for large files)
    2. Extracts to temporary directory
    3. Creates bundle hierarchy mirroring directory structure
    4. Processes contained files
    5. Cleans up temporary files

    Progress is tracked via IngestionJob and Celery state updates.

    Args:
        job_id: ID of IngestionJob for tracking
        archive_url: URL of the archive to download
        root_bundle_id: ID of root bundle for this dataset
        infospace_id: Target infospace
        user_id: User performing the ingestion
        options: Processing options
    """
    logger.info(f"[Archive Ingestion] Starting task for job {job_id}, archive: {archive_url}")

    # Helper to update both job cursor_state and celery state (aligned with Source pattern)
    def update_progress(session, job, stage: str, message: str, progress_pct: int = 0, **kwargs):
        """Update job cursor_state and Celery task state."""
        job.cursor_state.update({
            'stage': stage,
            'message': message,
            'progress_pct': progress_pct,
            **kwargs
        })

        # Update updated_at timestamp (similar to Source updates)
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()

        self.update_state(
            state='PROGRESS',
            meta={
                'job_id': job_id,
                'job_uuid': str(job.uuid),
                'stage': stage,
                'message': message,
                'progress': progress_pct,
                'processed_files': job.processed_files,
                'total_files': job.total_files,
                'failed_files': job.failed_files,
                'root_bundle_id': job.root_bundle_id
            }
        )
        logger.info(f"[Archive Job {job_id}] {stage}: {message} ({progress_pct}%)")

    # Initialize
    with Session(engine) as session:
        from app.models import IngestionJob, IngestionStatus
        job = session.get(IngestionJob, job_id)
        if not job:
            raise ValueError(f"IngestionJob {job_id} not found")

        update_progress(session, job, 'initializing', 'Starting archive ingestion...', 5)

    async def process_archive_async():
        with Session(engine) as session:
            from app.api.modules.foundation_service_providers.factory import create_storage_provider, create_scraping_provider
            from app.api.modules.content.services.asset_service import AssetService
            from app.api.modules.content.services.bundle_service import BundleService
            from app.api.modules.content.handlers import ArchiveHandler, IngestionContext
            from app.core.config import settings
            from app.models import IngestionJob, IngestionStatus

            # Get job
            job = session.get(IngestionJob, job_id)
            if not job:
                raise ValueError(f"IngestionJob {job_id} not found")

            # Update to downloading
            job.status = IngestionStatus.DOWNLOADING
            update_progress(session, job, 'downloading', 'Downloading archive...', 10)

            # Get root bundle
            root_bundle = session.get(Bundle, root_bundle_id)
            if not root_bundle:
                raise ValueError(f"Root bundle {root_bundle_id} not found")

            # Create handler context
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            asset_service = AssetService(session, storage_provider)
            bundle_service = BundleService(session)

            # Pass user_agent in options for handler to use
            task_options = options.copy()
            if user_agent:
                task_options['user_agent'] = user_agent

            context = IngestionContext(
                session=session,
                storage_provider=storage_provider,
                scraping_provider=scraping_provider,
                search_provider=None,
                asset_service=asset_service,
                bundle_service=bundle_service,
                user_id=user_id,
                infospace_id=infospace_id,
                settings=settings,
                options=task_options
            )

            # Create handler
            handler = ArchiveHandler(context)

            # Update to extracting
            job.status = IngestionStatus.EXTRACTING
            update_progress(session, job, 'extracting', 'Extracting archive...', 30)

            # Update to processing
            job.status = IngestionStatus.PROCESSING
            update_progress(session, job, 'processing', 'Processing files...', 50)

            # Process archive
            created_assets = await handler._process_archive_sync(
                archive_url, root_bundle, infospace_id, user_id, options
            )

            # Update job to completed
            job.status = IngestionStatus.COMPLETED
            job.processed_files = len(created_assets)
            job.completed_at = datetime.now(timezone.utc)
            update_progress(session, job, 'completed', f'Successfully processed {len(created_assets)} files', 100)

            logger.info(f"[Archive Ingestion] Job {job_id} completed: {len(created_assets)} assets created")

            return {
                "job_id": job_id,
                "root_bundle_id": root_bundle_id,
                "assets_created": len(created_assets),
                "status": "completed"
            }

    try:
        result = run_async_in_celery(process_archive_async)
        return result

    except Exception as e:
        logger.exception(f"[Archive Ingestion] Task failed: {e}")

        # Update job status to failed
        with Session(engine) as session:
            from app.models import IngestionJob, IngestionStatus
            job = session.get(IngestionJob, job_id)
            if job:
                job.status = IngestionStatus.FAILED
                job.error_message = str(e)
                job.last_error_at = datetime.now(timezone.utc)
                job.retry_count += 1
                job.cursor_state.update({
                    'stage': 'failed',
                    'message': f'Failed: {str(e)[:200]}',
                    'progress_pct': 0
                })
                session.add(job)
                session.commit()
                logger.error(f"[Archive Job {job_id}] Marked as FAILED: {str(e)[:100]}")

        raise


@celery.task(bind=True, name="import_directory_task", max_retries=3)
def import_directory_task(
    self,
    job_id: int,
    source_path: str,
    infospace_id: int,
    user_id: int,
    options: Dict[str, Any],
):
    """
    Background task for importing files from a local directory.

    Supports two modes (via options["copy_mode"]):
    - copy_mode=True (default): Copies files to managed storage, creates assets with PENDING status
    - copy_mode=False: Reference-only, no copying; source must be under LOCAL_STORAGE_BASE_PATH
    """
    logger.info(f"[Directory Import] Starting task for job {job_id}, source: {source_path}")

    def update_progress(session, job, stage: str, message: str, progress_pct: int = 0, **kwargs):
        job.cursor_state.update({"stage": stage, "message": message, "progress_pct": progress_pct, **kwargs})
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        self.update_state(
            state="PROGRESS",
            meta={
                "job_id": job_id,
                "stage": stage,
                "message": message,
                "progress": progress_pct,
                "processed_files": job.processed_files,
                "total_files": job.total_files,
            },
        )

    copy_mode = options.get("copy_mode", True)

    with Session(engine) as session:
        from app.models import IngestionJob, IngestionStatus
        from app.api.modules.content.services.bundle_service import BundleService
        from app.api.modules.foundation_service_providers.factory import create_storage_provider
        from app.api.modules.content.handlers.directory_import_handler import DirectoryImportHandler
        from app.core.config import settings

        job = session.get(IngestionJob, job_id)
        if not job:
            raise ValueError(f"IngestionJob {job_id} not found")

        update_progress(session, job, "initializing", "Starting directory import...", 5)

        job.status = IngestionStatus.PROCESSING
        update_progress(session, job, "walking", "Walking directory...", 20)

        allowed_paths = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
        if not allowed_paths:
            allowed_paths = [settings.LOCAL_STORAGE_BASE_PATH]

        try:
            from app.api.modules.content.handlers.base import IngestionContext
            from app.api.modules.content.services.asset_service import AssetService
            from app.api.modules.content.services.bundle_service import BundleService
            from app.api.modules.foundation_service_providers.factory import create_storage_provider, create_scraping_provider
            bundle_service = BundleService(session)
            storage_provider = create_storage_provider(settings) if copy_mode else None
            asset_service = AssetService(session, storage_provider or create_storage_provider(settings))
            scraping_provider = create_scraping_provider(settings)
            ctx = IngestionContext(
                session=session,
                storage_provider=storage_provider,
                scraping_provider=scraping_provider,
                search_provider=None,
                asset_service=asset_service,
                bundle_service=bundle_service,
                user_id=user_id,
                infospace_id=infospace_id,
                settings=settings,
                options={"allowed_import_paths": allowed_paths},
            )
            handler = DirectoryImportHandler(ctx)
            result = run_async_in_celery(
                handler.handle,
                source_path=source_path,
                options={**options, "copy_mode": copy_mode},
            )
            created_assets, root_bundle_id = result
        except Exception as e:
            logger.exception(f"[Directory Import] Handler failed: {e}")
            job.status = IngestionStatus.FAILED
            job.error_message = str(e)
            job.last_error_at = datetime.now(timezone.utc)
            job.cursor_state.update({"stage": "failed", "message": str(e)[:200], "progress_pct": 0})
            session.add(job)
            session.commit()
            raise

        job.status = IngestionStatus.COMPLETED
        job.processed_files = len(created_assets)
        job.root_bundle_id = root_bundle_id
        job.completed_at = datetime.now(timezone.utc)
        update_progress(
            session,
            job,
            "completed",
            f"Imported {len(created_assets)} assets",
            100,
        )

        logger.info(f"[Directory Import] Job {job_id} completed: {len(created_assets)} assets created")

    return {
        "job_id": job_id,
        "root_bundle_id": root_bundle_id,
        "assets_created": len(created_assets),
        "assets_skipped": 0,
        "status": "completed",
    }
