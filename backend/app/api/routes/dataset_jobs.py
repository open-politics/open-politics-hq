"""
Dataset Ingestion Job Routes
=============================

Endpoints for tracking long-running archive/dataset ingestion jobs.
Provides status streaming for UI progress bars and job management.
"""

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select
from pydantic import BaseModel

from app.api import deps
from app.models import DatasetIngestionJob, IngestionStatus, Bundle
from app.schemas import Message
from app.api.services.service_utils import validate_infospace_access

logger = logging.getLogger(__name__)

router = APIRouter()


class DatasetIngestionJobRead(BaseModel):
    """Response model for DatasetIngestionJob."""
    model_config = {"from_attributes": True}
    
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    source_locator: str
    kind: str
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


class DatasetIngestionJobCreate(BaseModel):
    """Request to create a dataset ingestion job."""
    source_locator: str
    title: Optional[str] = None
    options: Optional[dict] = None


class DirectoryImportRequest(BaseModel):
    """Request to import files from a local directory."""
    source_path: str
    file_extensions: Optional[List[str]] = None  # e.g. [".pdf", ".csv"]
    preserve_structure: Optional[bool] = True  # Preserve dir structure in object_name (future)
    copy_mode: Optional[bool] = True  # True: copy to storage + process. False: reference-only
    options: Optional[dict] = None


@router.post("/infospaces/{infospace_id}/import-directory", response_model=DatasetIngestionJobRead)
def create_directory_import_job(
    *,
    infospace_id: int,
    request: DirectoryImportRequest,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Import files from a local directory.

    Copy mode (default): Copies files to storage, processes via FileHandler. Works with MinIO or local_fs.
    Reference-only (copy_mode=False): Creates assets with blob_path pointing to source. No copying.

    Source path must be under ALLOWED_IMPORT_PATHS.
    Returns job ID for tracking progress via /dataset-jobs/{job_id}.
    """
    from pathlib import Path
    from app.core.config import settings
    from app.api.tasks.dataset_tasks import import_directory_task

    validate_infospace_access(db, infospace_id, current_user.id)

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
    options["copy_mode"] = request.copy_mode

    job = DatasetIngestionJob(
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
    return DatasetIngestionJobRead(**job_dict)


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
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Trigger batch processing of PENDING assets in a bundle.

    After directory import (reference mode), assets are created with PENDING status.
    This endpoint starts background processing (PDF extraction, CSV row creation).
    Processing runs in self-chaining batches until all PENDING assets are done.
    """
    from app.api.tasks.batch_processing import batch_process_pending

    validate_infospace_access(db, infospace_id, current_user.id)

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
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Trigger batch enrichment for assets in a bundle missing a facet.

    Runs enrichers (language_detection, quality_score) on assets that don't
    yet have the target facet set. Self-chaining until all are enriched.
    """
    from app.api.tasks.batch_processing import batch_enrich
    from app.api.utils.enrichers import get_enricher
    from app.api.utils.facets import (
        FACET_LANGUAGE,
        FACET_QUALITY_SCORE,
        FACET_LOCATION_LAT,
        FACET_LOCATION_LON,
        FACET_SUMMARY,
        FACET_OCR_USED,
    )

    validate_infospace_access(db, infospace_id, current_user.id)

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
    allowed = {FACET_LANGUAGE, FACET_QUALITY_SCORE, FACET_LOCATION_LAT, FACET_LOCATION_LON, FACET_SUMMARY, FACET_OCR_USED}
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
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
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


@router.get("/infospaces/{infospace_id}/dataset-jobs", response_model=List[DatasetIngestionJobRead])
def list_dataset_jobs(
    *,
    infospace_id: int,
    status: Optional[IngestionStatus] = Query(None, description="Filter by status"),
    limit: int = Query(50, ge=1, le=100),
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    List dataset ingestion jobs for an infospace.
    
    Useful for showing user their ongoing/completed dataset imports.
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    query = select(DatasetIngestionJob).where(
        DatasetIngestionJob.infospace_id == infospace_id
    )
    
    if status:
        query = query.where(DatasetIngestionJob.status == status)
    
    query = query.order_by(DatasetIngestionJob.created_at.desc()).limit(limit)
    
    jobs = db.exec(query).all()
    
    # Convert to response model with computed fields
    result = []
    for job in jobs:
        job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
        job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
        job_dict['stage_message'] = job.cursor_state.get('message', '')
        result.append(DatasetIngestionJobRead(**job_dict))
    
    return result


@router.get("/dataset-jobs/{job_id}", response_model=DatasetIngestionJobRead)
def get_dataset_job_status(
    *,
    job_id: int,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Get status of a specific dataset ingestion job.
    
    Frontend polls this endpoint to show real-time progress.
    """
    job = db.get(DatasetIngestionJob, job_id)
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
    
    return DatasetIngestionJobRead(**job_dict)


@router.get("/dataset-jobs/by-uuid/{job_uuid}", response_model=DatasetIngestionJobRead)
def get_dataset_job_by_uuid(
    *,
    job_uuid: str,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Get job status by UUID (useful when only UUID is known).
    """
    job = db.exec(
        select(DatasetIngestionJob).where(DatasetIngestionJob.uuid == job_uuid)
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
    
    return DatasetIngestionJobRead(**job_dict)


@router.post("/infospaces/{infospace_id}/dataset-jobs/ingest-archive", response_model=DatasetIngestionJobRead)
async def create_archive_ingestion_job(
    *,
    infospace_id: int,
    request: DatasetIngestionJobCreate,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Create a new archive ingestion job.
    
    Alternative endpoint to /assets/ingest-url that explicitly creates a job
    and returns job details for frontend progress tracking.
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    # Validate it's actually an archive URL
    from app.api.processors import is_archive_url
    if not is_archive_url(request.source_locator):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="URL does not appear to be an archive file (.zip, .tar, etc.)"
        )
    
    # Use ContentIngestionService to trigger ingestion
    from app.api.services.content_ingestion_service import ContentIngestionService
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
            job = db.get(DatasetIngestionJob, job_id)
            if job:
                job_dict = job.model_dump(mode='json')  # mode='json' serializes datetimes to ISO strings
                job_dict['progress_pct'] = job.cursor_state.get('progress_pct', 0)
                job_dict['stage_message'] = job.cursor_state.get('message', '')
                return DatasetIngestionJobRead(**job_dict)
    
    raise HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        detail="Failed to create ingestion job"
    )


@router.post("/dataset-jobs/{job_id}/cancel", response_model=Message)
def cancel_dataset_job(
    *,
    job_id: int,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Cancel a running dataset ingestion job.
    """
    job = db.get(DatasetIngestionJob, job_id)
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
    
    logger.info(f"Cancelled dataset ingestion job {job_id}")
    return Message(message=f"Job {job_id} cancelled")


@router.delete("/dataset-jobs/{job_id}", response_model=Message)
def delete_dataset_job(
    *,
    job_id: int,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Delete a dataset ingestion job record.
    
    Note: This only deletes the job tracking record, not the created assets/bundles.
    """
    job = db.get(DatasetIngestionJob, job_id)
    if not job:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found"
        )
    
    # Validate user access
    validate_infospace_access(db, job.infospace_id, current_user.id)
    
    db.delete(job)
    db.commit()
    
    logger.info(f"Deleted dataset ingestion job {job_id}")
    return Message(message=f"Job {job_id} deleted")


