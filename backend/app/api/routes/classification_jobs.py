import logging
from typing import Any, List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func
from sqlalchemy.orm import joinedload, selectinload
from datetime import datetime, timezone

from app.models import (
    ClassificationJob,
    ClassificationJobCreate,
    ClassificationJobRead,
    ClassificationJobUpdate,
    ClassificationJobStatus,
    ClassificationJobsOut,
    Workspace,
    User,
    DataSource,
    ClassificationScheme,
    ClassificationResult,
    DataRecord,
    ClassificationJobDataSourceLink,
    ClassificationJobSchemeLink
)
from app.api.deps import SessionDep, CurrentUser
from app.tasks.classification import process_classification_job

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/classification_jobs",
    tags=["ClassificationJobs"]
)

@router.post("", response_model=ClassificationJobRead)
@router.post("/", response_model=ClassificationJobRead)
def create_classification_job(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_in: ClassificationJobCreate
) -> Any:
    """
    Create a new Classification Job.

    Validates workspace ownership and required configuration fields.
    Associates the job with target DataSources and ClassificationSchemes.
    Triggers a background task to perform the classification.
    """
    logger.info(f"Creating ClassificationJob '{job_in.name}' in workspace {workspace_id}")

    # 1. Verify Workspace Access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # 2. Validate Configuration and Fetch Related Objects
    datasource_ids = job_in.configuration.get('datasource_ids', [])
    scheme_ids = job_in.configuration.get('scheme_ids', [])

    if not datasource_ids or not scheme_ids:
         raise HTTPException(status_code=400, detail="Configuration must include non-empty 'datasource_ids' and 'scheme_ids' lists")

    # Fetch and validate datasources
    datasources = session.exec(
        select(DataSource).where(
            DataSource.id.in_(datasource_ids),
            DataSource.workspace_id == workspace_id
        )
    ).all()
    if len(datasources) != len(datasource_ids):
        raise HTTPException(status_code=404, detail="One or more specified DataSources not found in this workspace.")

    # Fetch and validate schemes
    schemes = session.exec(
        select(ClassificationScheme).where(
            ClassificationScheme.id.in_(scheme_ids),
            ClassificationScheme.workspace_id == workspace_id
        )
    ).all()
    if len(schemes) != len(scheme_ids):
        raise HTTPException(status_code=404, detail="One or more specified ClassificationSchemes not found in this workspace.")

    # 3. Create ClassificationJob instance
    job = ClassificationJob.model_validate(
        job_in.model_dump(),
        update={
            "workspace_id": workspace_id,
            "user_id": current_user.id,
            "status": ClassificationJobStatus.PENDING,
            "target_datasources": datasources,
            "target_schemes": schemes
        }
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    logger.info(f"ClassificationJob {job.id} created successfully with status PENDING.")

    # 4. Trigger Background Classification Task
    try:
        # Trigger the main task that orchestrates classifications
        process_classification_job.delay(job.id)
        logger.info(f"Queued classification task for Job {job.id}")
    except Exception as e:
        logger.error(f"Failed to trigger classification task for Job {job.id}: {e}")
        # Update job status to failed if trigger fails?
        job.status = ClassificationJobStatus.FAILED
        job.error_message = f"Failed to queue task: {e}"
        session.add(job)
        session.commit()
        session.refresh(job)
        # Don't raise HTTP error here, job is created but task failed

    # 5. Return the created job (frontend will poll for status updates)
    # Populate counts before returning
    job_read = ClassificationJobRead.model_validate(job)
    job_read.result_count = 0 # Initial count
    # Calculate datarecord count (this could be slow for many sources, consider optimizing)
    datarecord_count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataSource.id.in_(datasource_ids))
    job_read.datarecord_count = session.exec(datarecord_count_stmt).one_or_none() or 0

    return job_read


@router.get("", response_model=ClassificationJobsOut)
@router.get("/", response_model=ClassificationJobsOut)
def list_classification_jobs(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of results and data records")
) -> Any:
    """
    Retrieve Classification Jobs for the workspace.
    Optionally includes counts of results and targeted data records.
    """
    # 1. Verify Workspace Access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # 2. Base Query for Jobs
    statement = select(ClassificationJob).where(
        ClassificationJob.workspace_id == workspace_id,
        ClassificationJob.user_id == current_user.id
    ).order_by(ClassificationJob.created_at.desc())

    # 3. Get Total Count for Pagination
    count_statement = select(func.count()).select_from(ClassificationJob).where(
        ClassificationJob.workspace_id == workspace_id,
        ClassificationJob.user_id == current_user.id
    )
    total_count = session.exec(count_statement).one()

    # 4. Apply Pagination
    statement = statement.offset(skip).limit(limit)

    # 5. Execute Query
    jobs = session.exec(statement).all()

    # 6. Prepare response models, optionally fetch counts
    job_reads = []
    for job in jobs:
        job_read = ClassificationJobRead.model_validate(job)
        if include_counts:
            # Result Count
            result_count_stmt = select(func.count()).select_from(ClassificationResult).where(ClassificationResult.job_id == job.id)
            job_read.result_count = session.exec(result_count_stmt).one_or_none() or 0

            # DataRecord Count (extract datasource IDs from job)
            datasource_ids = job.configuration.get('datasource_ids', [])
            if datasource_ids:
                datarecord_count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataSource.id.in_(datasource_ids))
                job_read.datarecord_count = session.exec(datarecord_count_stmt).one_or_none() or 0
            else:
                job_read.datarecord_count = 0 # Should not happen if validation works
        else:
            job_read.result_count = None
            job_read.datarecord_count = None

        job_reads.append(job_read)

    return ClassificationJobsOut(data=job_reads, count=total_count)


@router.get("/{job_id}", response_model=ClassificationJobRead)
def get_classification_job(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    include_counts: bool = Query(True, description="Include counts of results and data records")
) -> Any:
    """
    Retrieve a specific Classification Job by its ID.
    """
    job = session.get(ClassificationJob, job_id)
    if (
        not job
        or job.workspace_id != workspace_id
        or job.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification Job not found")

    job_read = ClassificationJobRead.model_validate(job)

    if include_counts:
        # Result Count
        result_count_stmt = select(func.count()).select_from(ClassificationResult).where(ClassificationResult.job_id == job.id)
        job_read.result_count = session.exec(result_count_stmt).one_or_none() or 0
        # DataRecord Count
        datasource_ids = job.configuration.get('datasource_ids', [])
        if datasource_ids:
            datarecord_count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataSource.id.in_(datasource_ids))
            job_read.datarecord_count = session.exec(datarecord_count_stmt).one_or_none() or 0
        else:
            job_read.datarecord_count = 0
    else:
        job_read.result_count = None
        job_read.datarecord_count = None

    return job_read

@router.patch("/{job_id}", response_model=ClassificationJobRead)
def update_classification_job(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    job_in: ClassificationJobUpdate
) -> Any:
    """
    Update a Classification Job (primarily status or error message).
    Used internally by background tasks or potentially for manual status changes.
    """
    logger.info(f"Updating ClassificationJob {job_id} in workspace {workspace_id}")
    job = session.get(ClassificationJob, job_id)
    if (
        not job
        or job.workspace_id != workspace_id
        or job.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification Job not found")

    update_data = job_in.model_dump(exclude_unset=True)
    needs_update = False
    for key, value in update_data.items():
        if getattr(job, key) != value:
            setattr(job, key, value)
            needs_update = True

    if needs_update:
        job.updated_at = datetime.now(timezone.utc)
        session.add(job)
        session.commit()
        session.refresh(job)
        logger.info(f"ClassificationJob {job_id} updated successfully.")
    else:
         logger.info(f"No changes detected for ClassificationJob {job_id}. Update skipped.")


    # Return the updated job, populating counts like GET
    job_read = ClassificationJobRead.model_validate(job)
    # Result Count
    result_count_stmt = select(func.count()).select_from(ClassificationResult).where(ClassificationResult.job_id == job.id)
    job_read.result_count = session.exec(result_count_stmt).one_or_none() or 0
    # DataRecord Count
    datasource_ids = job.configuration.get('datasource_ids', [])
    if datasource_ids:
        datarecord_count_stmt = select(func.count(DataRecord.id)).join(DataSource).where(DataSource.id.in_(datasource_ids))
        job_read.datarecord_count = session.exec(datarecord_count_stmt).one_or_none() or 0
    else:
        job_read.datarecord_count = 0

    return job_read


@router.delete("/{job_id}", status_code=204)
def delete_classification_job(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int
) -> None:
    """
    Delete a Classification Job and its associated results (due to cascade).
    """
    logger.info(f"Attempting to delete ClassificationJob {job_id} from workspace {workspace_id}")
    job = session.get(ClassificationJob, job_id)
    if (
        not job
        or job.workspace_id != workspace_id
        or job.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification Job not found")

    # TODO: Check if job is RUNNING? Prevent deletion? Or cancel the task?
    # If job.status == "running":
    #    raise HTTPException(status_code=400, detail="Cannot delete a running job. Cancel it first.")

    try:
        # Manually delete links first if cascade delete isn't reliable on link tables
        # session.exec(delete(ClassificationJobDataSourceLink).where(ClassificationJobDataSourceLink.job_id == job_id))
        # session.exec(delete(ClassificationJobSchemeLink).where(ClassificationJobSchemeLink.job_id == job_id))
        # session.flush() # Ensure links are gone before deleting the job

        session.delete(job) # Cascade should handle results
        session.commit()
        logger.info(f"ClassificationJob {job_id} deleted successfully.")
        return None # Return None for 204 response
    except Exception as e:
        session.rollback()
        logger.error(f"Error deleting ClassificationJob {job_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Could not delete Classification Job: {str(e)}") 