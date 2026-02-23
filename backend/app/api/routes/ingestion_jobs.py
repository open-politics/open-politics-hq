"""
Ingestion Job Routes
====================

Endpoints for tracking long-running content ingestion jobs (local directory import,
remote archive ingestion). Provides status streaming for UI progress bars and job management.
"""

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select
from pydantic import BaseModel

from app.api import dependency_injection
from app.models import IngestionJob, IngestionStatus, Bundle, Source, SourceStatus
from app.schemas import Message
from app.api.global_utils import validate_infospace_access

logger = logging.getLogger(__name__)

router = APIRouter()


class IngestionJobRead(BaseModel):
    """Response model for IngestionJob."""
    model_config = {"from_attributes": True}
    
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    source_locator: str
    kind: str
    source_id: Optional[int] = None
    root_bundle_id: Optional[int]
    status: IngestionStatus
    total_files: int
    processed_files: int
    failed_files: int
    total_bytes: Optional[int]
    downloaded_bytes: Optional[int]
    cursor_state: dict
    task_id: Optional[str]
    error_message: Optional[str]
    retry_count: int
    last_error_at: Optional[str]
    created_at: str
    updated_at: str
    started_at: Optional[str]
    completed_at: Optional[str]
    
    # Computed fields for UI
    progress_pct: float = 0.0
    stage_message: str = ""


class IngestionJobCreate(BaseModel):
    """Request to create an ingestion job."""
    source_locator: str
    title: Optional[str] = None
    options: Optional[dict] = None


class DirectoryImportRequest(BaseModel):
    """Request to import files from a local directory."""
    source_path: str
    file_extensions: Optional[List[str]] = None  # e.g. [".pdf", ".csv"]
    preserve_structure: Optional[bool] = True  # Preserve dir structure in object_name (future)
    copy_mode: Optional[bool] = False  # True: copy to storage. False: reference-only (default for local paths)
    reconcile_mode: Optional[bool] = False  # Compare stat, detect changes/deletions, version changed assets
    options: Optional[dict] = None


@router.post("/infospaces/{infospace_id}/import-directory", response_model=IngestionJobRead)
def create_directory_import_job(
    *,
    infospace_id: int,
    request: DirectoryImportRequest,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Import files from a local directory.

    Copy mode (default): Copies files to storage, processes via FileHandler. Works with MinIO or local_fs.
    Reference-only (copy_mode=False): Creates assets with blob_path pointing to source. No copying.

    Source path must be under ALLOWED_IMPORT_PATHS.
    Returns job ID for tracking progress via /ingestion-jobs/{job_id}.
    """
    from pathlib import Path
    from app.core.config import settings
    from app.api.modules.content.tasks.ingestion_tasks import import_directory_task

    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)

    source = Path(request.source_path).resolve()
    if not source.exists() or not source.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source path '{request.source_path}' does not exist or is not a directory"
        )

    allowed_paths = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
    if not allowed_paths:
        allowed_paths = [settings.LOCAL_STORAGE_BASE_PATH]

    allowed_resolved = []
    for p in allowed_paths:
        try:
            allowed_resolved.append(Path(p).resolve())
        except (ValueError, OSError):
            pass
    if not any(source.is_relative_to(a) for a in allowed_resolved):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source path '{request.source_path}' is not under allowed import paths"
        )

    options = request.options or {}
    if request.file_extensions:
        options["file_extensions"] = request.file_extensions
    # Auto-detect reference mode: paths under LOCAL_STORAGE_BASE_PATH must use reference mode
    # to avoid duplicating data that is already on the server filesystem.
    storage_base = Path(settings.LOCAL_STORAGE_BASE_PATH).resolve()
    copy_mode = request.copy_mode if request.copy_mode is not None else False
    if source.is_relative_to(storage_base):
        copy_mode = False
    options["copy_mode"] = copy_mode
    options["reconcile_mode"] = request.reconcile_mode

    job = IngestionJob(
        infospace_id=infospace_id,
        user_id=current_user.id,
        source_locator=request.source_path,
        kind="directory_local",
        status=IngestionStatus.PENDING,
    )
    db.add(job)
    db.commit()
    db.refresh(job)

    task = import_directory_task.delay(
        job_id=job.id,
        source_path=str(source),
        infospace_id=infospace_id,
        user_id=current_user.id,
        options=options,
    )
    job.task_id = task.id
    job.started_at = datetime.now(timezone.utc)
    db.add(job)
    db.commit()
    db.refresh(job)

    job_dict = job.model_dump(mode="json")
    job_dict["progress_pct"] = job.cursor_state.get("progress_pct", 0)
    job_dict["stage_message"] = job.cursor_state.get("message", "")
    return IngestionJobRead(**job_dict)


class BatchProcessResponse(BaseModel):
    """Response for batch process trigger."""
    message: str
    bundle_id: int
    batch_size: int
    task_id: str


class BatchEnrichRequest(BaseModel):
    """Request to trigger batch enrichment."""
    enricher_name: str  # e.g. "language_detection", "quality_score"
    missing_facet: Optional[str] = None  # Override: facet to backfill (default from enricher)
    batch_size: int = 100


class BatchEnrichResponse(BaseModel):
    """Response for batch enrich trigger."""
    message: str
    bundle_id: int
    enricher_name: str
    task_id: str


class ProcessingStatusResponse(BaseModel):
    """Processing status counts per bundle."""
    bundle_id: int
    pending: int
    processing: int
    ready: int
    failed: int
    total: int


@router.post(
    "/infospaces/{infospace_id}/bundles/{bundle_id}/process-pending",
    response_model=BatchProcessResponse,
)
def trigger_batch_process_pending(
    *,
    infospace_id: int,
    bundle_id: int,
    batch_size: int = Query(100, ge=1, le=500),
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Trigger batch processing of PENDING assets in a bundle.

    After directory import (reference mode), assets are created with PENDING status.
    This endpoint starts background processing (PDF extraction, CSV row creation).
    Processing runs in self-chaining batches until all PENDING assets are done.
    """
    from app.api.modules.content.tasks.batch_processing import batch_process_pending

    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)

    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bundle {bundle_id} not found",
        )

    task = batch_process_pending.delay(bundle_id=bundle_id, batch_size=batch_size)
    return BatchProcessResponse(
        message="Batch processing started",
        bundle_id=bundle_id,
        batch_size=batch_size,
        task_id=task.id,
    )


@router.post(
    "/infospaces/{infospace_id}/bundles/{bundle_id}/enrich",
    response_model=BatchEnrichResponse,
)
def trigger_batch_enrich(
    *,
    infospace_id: int,
    bundle_id: int,
    request: BatchEnrichRequest,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Trigger batch enrichment for assets in a bundle missing a facet.

    Runs enrichers (geocoding, etc.) on assets that don't yet have the target
    facet set. Self-chaining until all are enriched.
    """
    from app.api.modules.content.tasks.batch_processing import batch_enrich
    from app.api.modules.content.enrichers import get_enricher
    from app.api.modules.content.facets import (
        CONTENT_HASH_FIELD,
        FACET_LOCATION_LAT,
        FACET_LOCATION_LON,
        FACET_SUMMARY,
        FACET_OCR_USED,
    )

    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)

    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bundle {bundle_id} not found",
        )

    enricher = get_enricher(request.enricher_name)
    if not enricher:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Unknown enricher: {request.enricher_name}",
        )

    target_facet = request.missing_facet or enricher.target_facet
    allowed = {FACET_LOCATION_LAT, FACET_LOCATION_LON, FACET_SUMMARY, FACET_OCR_USED, CONTENT_HASH_FIELD}
    if target_facet not in allowed:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Facet {target_facet} not allowlisted for enrichment",
        )

    filter_criteria = {"missing_facet": target_facet}
    task = batch_enrich.delay(
        enricher_name=request.enricher_name,
        filter_criteria=filter_criteria,
        bundle_id=bundle_id,
        batch_size=request.batch_size,
    )
    return BatchEnrichResponse(
        message="Batch enrichment started",
        bundle_id=bundle_id,
        enricher_name=request.enricher_name,
        task_id=task.id,
    )


@router.get(
    "/infospaces/{infospace_id}/bundles/{bundle_id}/processing-status",
    response_model=ProcessingStatusResponse,
)
def get_processing_status(
    *,
    infospace_id: int,
    bundle_id: int,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Get processing status counts for assets in a bundle.

    Returns counts by processing_status (PENDING, PROCESSING, READY, FAILED).
    """
    from sqlalchemy import func
    from app.models import Asset, ProcessingStatus

    validate_infospace_access(db, infospace_id, current_user.id)

    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bundle {bundle_id} not found",
        )

    # Count by status (parent assets only)
    counts = db.exec(
        select(Asset.processing_status, func.count(Asset.id))
        .where(Asset.bundle_id == bundle_id)
        .where(Asset.parent_asset_id.is_(None))
        .group_by(Asset.processing_status)
    ).all()

    by_status = {str(s): c for s, c in counts}
    pending = by_status.get(str(ProcessingStatus.PENDING), 0)
    processing = by_status.get(str(ProcessingStatus.PROCESSING), 0)
    ready = by_status.get(str(ProcessingStatus.READY), 0)
    failed = by_status.get(str(ProcessingStatus.FAILED), 0)
    total = pending + processing + ready + failed

    return ProcessingStatusResponse(
        bundle_id=bundle_id,
        pending=pending,
        processing=processing,
        ready=ready,
        failed=failed,
        total=total,
    )


@router.get("/infospaces/{infospace_id}/ingestion-jobs", response_model=List[IngestionJobRead])
def list_ingestion_jobs(
    *,
    infospace_id: int,
    status: Optional[IngestionStatus] = Query(None, description="Filter by status"),
    kind: Optional[str] = Query(None, description="Filter by job kind (directory_local, zip, tar.gz, etc.)"),
    source_id: Optional[int] = Query(None, description="Filter by source ID (jobs created by this source poll)"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    List ingestion jobs for an infospace.

    Useful for showing user their ongoing/completed imports (local directory or remote archive).
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    query = select(IngestionJob).where(
        IngestionJob.infospace_id == infospace_id
    )
    
    if status:
        query = query.where(IngestionJob.status == status)
    
    if kind:
        query = query.where(IngestionJob.kind == kind)

    if source_id is not None:
        query = query.where(IngestionJob.source_id == source_id)
    
    query = query.order_by(IngestionJob.created_at.desc()).limit(limit)
    
    jobs = db.exec(query).all()
    
    # Convert to response model with computed fields
    result = []
    for job in jobs:
        job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
        job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
        job_dict['stage_message'] = job.cursor_state.get('message', '')
        result.append(IngestionJobRead(**job_dict))
    
    return result


@router.get("/ingestion-jobs/{job_id}", response_model=IngestionJobRead)
def get_ingestion_job_status(
    *,
    job_id: int,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Get status of a specific ingestion job.

    Frontend polls this endpoint to show real-time progress.
    """
    job = db.get(IngestionJob, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    # Validate user access
    validate_infospace_access(db, job.infospace_id, current_user.id)
    
    # Convert to response with computed fields
    job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
    job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
    job_dict['stage_message'] = job.cursor_state.get('message', '')
    
    return IngestionJobRead(**job_dict)


@router.get("/ingestion-jobs/by-uuid/{job_uuid}", response_model=IngestionJobRead)
def get_ingestion_job_by_uuid(
    *,
    job_uuid: str,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Get job status by UUID (useful when only UUID is known).
    """
    job = db.exec(
        select(IngestionJob).where(IngestionJob.uuid == job_uuid)
    ).first()
    
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_uuid} not found"
        )
    
    # Validate user access
    validate_infospace_access(db, job.infospace_id, current_user.id)
    
    # Convert to response with computed fields
    job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
    job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
    job_dict['stage_message'] = job.cursor_state.get('message', '')
    
    return IngestionJobRead(**job_dict)


@router.post("/infospaces/{infospace_id}/ingestion-jobs/ingest-archive", response_model=IngestionJobRead)
async def create_archive_ingestion_job(
    *,
    infospace_id: int,
    request: IngestionJobCreate,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Create a new archive ingestion job.

    Alternative endpoint to /assets/ingest-url that explicitly creates a job
    and returns job details for frontend progress tracking.
    """
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    
    # Validate it's actually an archive URL
    from app.api.modules.content.processors import is_archive_url
    if not is_archive_url(request.source_locator):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL does not appear to be an archive file (.zip, .tar, etc.)"
        )
    
    # Use ContentIngestionService to trigger ingestion
    from app.api.modules.content.services import ContentIngestionService
    content_service = ContentIngestionService(db)
    
    options = request.options or {}
    options['use_background'] = True  # Always use background for explicit job creation
    
    assets = await content_service.ingest_content(
        locator=request.source_locator,
        infospace_id=infospace_id,
        user_id=current_user.id,
        title=request.title,
        options=options
    )
    
    # Get the created job from the asset's metadata
    if assets and assets[0].source_metadata:
        job_id = assets[0].source_metadata.get('job_id')
        if job_id:
            job = db.get(IngestionJob, job_id)
            if job:
                job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
                job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
                job_dict['stage_message'] = job.cursor_state.get('message', '')
                return IngestionJobRead(**job_dict)
    
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create ingestion job"
    )


@router.post("/ingestion-jobs/{job_id}/cancel", response_model=Message)
def cancel_ingestion_job(
    *,
    job_id: int,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Cancel a running ingestion job.
    """
    job = db.get(IngestionJob, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    # Validate user access
    validate_infospace_access(db, job.infospace_id, current_user.id)
    
    # Can only cancel pending or processing jobs
    if job.status in [IngestionStatus.COMPLETED, IngestionStatus.FAILED]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Cannot cancel job in {job.status} status"
        )
    
    # Revoke celery task if exists
    if job.task_id:
        from app.core.celery_app import celery
        celery.control.revoke(job.task_id, terminate=True)
    
    # Update job status
    from app.models import IngestionStatus
    # Use FAILED instead of CANCELLED to match ProcessingStatus pattern
    job.status = IngestionStatus.CANCELLED if hasattr(IngestionStatus, 'CANCELLED') else IngestionStatus.FAILED
    job.error_message = "Cancelled by user"
    job.completed_at = datetime.now(timezone.utc)
    
    db.add(job)
    db.commit()
    
    logger.info(f"Cancelled ingestion job {job_id}")
    return Message(message=f"Job {job_id} cancelled")


@router.delete("/ingestion-jobs/{job_id}", response_model=Message)
def delete_ingestion_job(
    *,
    job_id: int,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Delete an ingestion job record.

    Note: This only deletes the job tracking record, not the created assets/bundles.
    """
    job = db.get(IngestionJob, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    # Validate user access
    validate_infospace_access(db, job.infospace_id, current_user.id)
    
    db.delete(job)
    db.commit()
    
    logger.info(f"Deleted ingestion job {job_id}")
    return Message(message=f"Job {job_id} deleted")


# ─── On-demand Reconcile ────────────────────────────────────────────────────── #


class ReconcileDirectoryRequest(BaseModel):
    """Request to run on-demand directory reconcile."""
    source_path: str
    bundle_id: int


@router.post("/infospaces/{infospace_id}/reconcile-directory")
async def reconcile_directory(
    *,
    infospace_id: int,
    request: ReconcileDirectoryRequest,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Run on-demand directory reconcile.

    Compares files on disk with existing assets, detects additions, changes, deletions.
    Creates new versions for changed files. Does not poll continuously; call this
    when you want to sync (e.g. after bulk file updates).
    """
    from pathlib import Path
    from app.core.config import settings
    from app.api.modules.content.handlers.directory_import_handler import (
        DirectoryImportHandler,
        _get_dataset_name_from_path,
    )
    from app.api.modules.content.handlers.base import IngestionContext
    from app.api.modules.foundation_service_providers.factory import create_storage_provider, create_scraping_provider
    from app.api.modules.content.services.asset_service import AssetService
    from app.api.modules.content.services.bundle_service import BundleService

    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)

    source = Path(request.source_path).resolve()
    if not source.exists() or not source.is_dir():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source path '{request.source_path}' does not exist or is not a directory",
        )

    allowed_paths = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
    if not allowed_paths:
        allowed_paths = [settings.LOCAL_STORAGE_BASE_PATH]
    if not any(source.is_relative_to(Path(p).resolve()) for p in allowed_paths):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Source path is not under allowed import paths",
        )

    bundle = db.get(Bundle, request.bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bundle {request.bundle_id} not found",
        )

    storage_provider = create_storage_provider(settings)
    scraping_provider = create_scraping_provider(settings)
    asset_service = AssetService(db, storage_provider)
    bundle_service = BundleService(db)
    dataset_name = _get_dataset_name_from_path(str(source), settings.LOCAL_STORAGE_BASE_PATH)

    context = IngestionContext(
        session=db,
        storage_provider=storage_provider,
        scraping_provider=scraping_provider,
        search_provider=None,
        asset_service=asset_service,
        bundle_service=bundle_service,
        user_id=current_user.id,
        infospace_id=infospace_id,
        settings=settings,
        options={"allowed_import_paths": allowed_paths},
    )
    handler = DirectoryImportHandler(context)
    created_assets, root_bundle_id = await handler.handle(
        source_path=str(source),
        options={
            "copy_mode": False,
            "reconcile_mode": True,
            "root_bundle_id": request.bundle_id,
        },
    )
    return {
        "message": "Reconcile completed",
        "bundle_id": root_bundle_id,
        "assets_created": len(created_assets),
    }


# ─── Watch / Inbox configuration ───────────────────────────────────────────── #

_INBOX_README = """\
# Version Inbox

Drop files here to add them to the dataset.

**Automatic version detection:**
- Files with the same name as an existing asset are treated as new versions.
- Add a `{filename}.meta.json` sidecar to explicitly declare what a file supersedes:

```json
{{
  "supersedes": "relative/path/to/old_document.pdf",
  "reason": "Less redacted version",
  "version_label": "v2"
}}
```

- Duplicate files (same content hash) are automatically skipped.
- Files with a version-like suffix (e.g. `report_v2.pdf`) are flagged as
  potential versions of `report.pdf` for confirmation in the UI.

**Processing:**
- Files are checked every 15 minutes (configurable via inbox_interval_seconds).
- After import, files are moved to `_processed/{date}/`.
"""


class EnableWatchRequest(BaseModel):
    """Request to enable watching / inbox for an imported directory."""
    source_path: str
    bundle_id: int
    enable_reconcile: bool = False  # Deprecated: reconcile is on-demand only; kept for UI compatibility
    reconcile_interval_seconds: int = 3600
    enable_inbox: bool = True
    inbox_interval_seconds: int = 900  # 15 min; avoids mid-drop partial imports for batch file drops


class WatchStatusResponse(BaseModel):
    """Current watch/inbox status for a directory."""
    source_path: str
    bundle_id: int
    reconcile_source_id: Optional[int] = None
    reconcile_active: bool = False
    reconcile_last_poll: Optional[str] = None
    inbox_source_id: Optional[int] = None
    inbox_active: bool = False
    inbox_path: Optional[str] = None
    inbox_files_pending: int = 0


@router.post(
    "/infospaces/{infospace_id}/enable-watch",
    response_model=WatchStatusResponse,
)
def enable_directory_watch(
    *,
    infospace_id: int,
    request: EnableWatchRequest,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user=dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Enable watching and/or version inbox for an already-imported directory.

    - ``enable_reconcile``: periodic stat comparison to detect replaced files.
    - ``enable_inbox``: creates ``_inbox/`` subdirectory; new files dropped
      there are auto-imported with smart version detection.

    Idempotent: calling again with the same source_path updates existing Sources.
    """
    from pathlib import Path
    from app.core.config import settings
    from app.api.modules.content.handlers.directory_import_handler import _get_dataset_name_from_path

    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)

    bundle = db.get(Bundle, request.bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Bundle {request.bundle_id} not found",
        )

    source_path = Path(request.source_path).resolve()
    dataset_name = _get_dataset_name_from_path(str(source_path), settings.LOCAL_STORAGE_BASE_PATH)
    reconcile_source = None
    inbox_source = None

    # Reconcile is on-demand only (no continuous poll). enable_reconcile is ignored.
    # Use POST /infospaces/{id}/reconcile-directory to run reconcile manually.
    reconcile_source = None

    # --- Inbox Source ---
    inbox_path_str = None
    inbox_files_pending = 0
    if request.enable_inbox:
        inbox_dir = source_path / "_inbox"
        inbox_dir.mkdir(parents=True, exist_ok=True)

        readme_path = inbox_dir / "README.md"
        if not readme_path.exists():
            readme_path.write_text(_INBOX_README)

        inbox_path_str = str(inbox_dir)

        inbox_source = db.exec(
            select(Source).where(
                Source.infospace_id == infospace_id,
                Source.kind == "directory_inbox",
                Source.output_bundle_id == request.bundle_id,
            )
        ).first()
        if not inbox_source:
            from datetime import timedelta
            inbox_source = Source(
                name=f"Inbox: {dataset_name}",
                kind="directory_inbox",
                details={
                    "inbox_path": str(inbox_dir),
                    "dataset_name": dataset_name,
                    "source_path": str(source_path),
                },
                infospace_id=infospace_id,
                user_id=current_user.id,
                is_active=True,
                poll_interval_seconds=request.inbox_interval_seconds,
                output_bundle_id=request.bundle_id,
                next_poll_at=datetime.now(timezone.utc) + timedelta(
                    seconds=request.inbox_interval_seconds
                ),
            )
            db.add(inbox_source)
        else:
            inbox_source.is_active = True
            inbox_source.poll_interval_seconds = request.inbox_interval_seconds
            db.add(inbox_source)

        # Count pending files
        try:
            from app.api.modules.content.types import importable_extensions
            exts = importable_extensions()
            inbox_files_pending = sum(
                1
                for f in inbox_dir.iterdir()
                if f.is_file() and f.suffix.lower() in exts and not f.name.endswith(".meta.json")
            )
        except OSError:
            pass

    db.commit()
    if reconcile_source:
        db.refresh(reconcile_source)
    if inbox_source:
        db.refresh(inbox_source)

    return WatchStatusResponse(
        source_path=str(source_path),
        bundle_id=request.bundle_id,
        reconcile_source_id=reconcile_source.id if reconcile_source else None,
        reconcile_active=reconcile_source.is_active if reconcile_source else False,
        reconcile_last_poll=(
            reconcile_source.last_poll_at.isoformat()
            if reconcile_source and reconcile_source.last_poll_at
            else None
        ),
        inbox_source_id=inbox_source.id if inbox_source else None,
        inbox_active=inbox_source.is_active if inbox_source else False,
        inbox_path=inbox_path_str,
        inbox_files_pending=inbox_files_pending,
    )


@router.get(
    "/infospaces/{infospace_id}/watch-status",
    response_model=List[WatchStatusResponse],
)
def get_watch_status(
    *,
    infospace_id: int,
    bundle_id: Optional[int] = Query(None),
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user=dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Get watch / inbox status for directories in an infospace.
    Optionally filter by bundle_id.
    """
    validate_infospace_access(db, infospace_id, current_user.id)

    query = select(Source).where(
        Source.infospace_id == infospace_id,
        Source.kind.in_(["directory_local", "directory_inbox"]),
    )
    if bundle_id:
        query = query.where(Source.output_bundle_id == bundle_id)

    sources = db.exec(query).all()

    # Group by output_bundle_id
    by_bundle: dict[int, dict] = {}
    for src in sources:
        bid = src.output_bundle_id
        if bid not in by_bundle:
            by_bundle[bid] = {
                "source_path": src.details.get("source_path", ""),
                "bundle_id": bid,
            }
        entry = by_bundle[bid]
        if src.kind == "directory_local":
            entry["reconcile_source_id"] = src.id
            entry["reconcile_active"] = src.is_active
            entry["reconcile_last_poll"] = (
                src.last_poll_at.isoformat() if src.last_poll_at else None
            )
        elif src.kind == "directory_inbox":
            entry["inbox_source_id"] = src.id
            entry["inbox_active"] = src.is_active
            entry["inbox_path"] = src.details.get("inbox_path")
            try:
                from pathlib import Path as _Path
                from app.api.modules.content.types import importable_extensions
                exts = importable_extensions()
                inbox_dir = _Path(src.details.get("inbox_path", ""))
                if inbox_dir.exists():
                    entry["inbox_files_pending"] = sum(
                        1
                        for f in inbox_dir.iterdir()
                        if f.is_file()
                        and f.suffix.lower() in exts
                        and not f.name.endswith(".meta.json")
                    )
                else:
                    entry["inbox_files_pending"] = 0
            except OSError:
                entry["inbox_files_pending"] = 0

    return [WatchStatusResponse(**v) for v in by_bundle.values()]
