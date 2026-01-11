"""
Dataset Ingestion Job Routes
=============================

Endpoints for tracking long-running archive/dataset ingestion jobs.
Provides status streaming for UI progress bars and job management.
"""

import logging
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
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    source_url: str
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
    
    class Config:
        from_attributes = True


class DatasetIngestionJobCreate(BaseModel):
    """Request to create a dataset ingestion job."""
    source_url: str
    title: Optional[str] = None
    options: Optional[dict] = None


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
        job_dict = job.model_dump()
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
    job_dict = job.model_dump()
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
    job_dict = job.model_dump()
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
    if not is_archive_url(request.source_url):
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
        locator=request.source_url,
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
                job_dict = job.model_dump()
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


