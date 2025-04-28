import logging
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status # Added status
# Removed unused imports like select, func

# Models
from app.models import (
    ClassificationJobRead,
    ClassificationJobCreate,
    ClassificationJobUpdate,
    ClassificationJobsOut,
    ClassificationJob,
    ClassificationJobStatus,
    ClassificationScheme,
    DataSource,
    ClassificationResult,
    DataSourceTransferRequest,
    DataSourceTransferResponse
)
# Deps: Remove SessionDep if not needed, keep CurrentUser
from app.api.deps import SessionDep, CurrentUser, ClassificationProviderDep
# Service: Import class directly for DI
# from app.api.services.classification import ClassificationService
# Task import removed, service handles triggering
from app.api.tasks.classification import process_classification_job
from app.api.services.service_utils import validate_workspace_access
from sqlmodel import select, func

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/classification_jobs",
    tags=["ClassificationJobs"]
)

@router.post("", response_model=ClassificationJobRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=ClassificationJobRead, status_code=status.HTTP_201_CREATED)
def create_classification_job(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_in: ClassificationJobCreate,
    session: SessionDep,
    classification_provider: ClassificationProviderDep
) -> Any:
    """
    Create a new Classification Job.
    """
    logger.info(f"Route: Creating ClassificationJob '{job_in.name}' in workspace {workspace_id}")

    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Validate that the datasources exist and belong to the workspace
        datasource_ids = job_in.configuration.get('datasource_ids', [])
        if not datasource_ids:
            raise ValueError("No datasource_ids provided in configuration")
            
        for ds_id in datasource_ids:
            datasource = session.get(DataSource, ds_id)
            if not datasource:
                raise ValueError(f"DataSource with ID {ds_id} not found")
            if datasource.workspace_id != workspace_id:
                raise ValueError(f"DataSource with ID {ds_id} does not belong to workspace {workspace_id}")
        
        # Validate that the classification schemes exist and belong to the workspace
        scheme_ids = job_in.configuration.get('scheme_ids', [])
        if not scheme_ids:
            raise ValueError("No scheme_ids provided in configuration")
            
        for scheme_id in scheme_ids:
            scheme = session.get(ClassificationScheme, scheme_id)
            if not scheme:
                raise ValueError(f"ClassificationScheme with ID {scheme_id} not found")
            if scheme.workspace_id != workspace_id:
                raise ValueError(f"ClassificationScheme with ID {scheme_id} does not belong to workspace {workspace_id}")
        
        # Create the job object
        job = ClassificationJob(
            name=job_in.name,
            description=job_in.description,
            configuration=job_in.configuration,
            status=ClassificationJobStatus.PENDING,
            workspace_id=workspace_id,
            user_id=current_user.id,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        session.add(job)
        session.flush()  # Get ID
        logger.info(f"Created ClassificationJob {job.id}")
        
        # Commit the transaction
        session.commit()
        session.refresh(job)
        
        # Queue the job for processing
        try:
            process_classification_job.delay(job.id)
            logger.info(f"Queued classification task for job {job.id}")
        except Exception as task_error:
            # Log but don't fail the request if task queuing fails
            logger.error(f"Failed to queue classification task for job {job.id}: {task_error}")
        
        # Return the job
        return ClassificationJobRead.model_validate(job)

    except ValueError as ve:
        # Handle validation errors
        session.rollback()
        logger.error(f"Route: Validation error creating job: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_workspace_access
        session.rollback()
        raise he
    except Exception as e:
        # Handle unexpected errors
        session.rollback()
        logger.exception(f"Route: Unexpected error creating job: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("", response_model=ClassificationJobsOut)
@router.get("/", response_model=ClassificationJobsOut)
def list_classification_jobs(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of results and data records"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Classification Jobs for the workspace.
    """
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Build query for jobs
        query = (
            select(ClassificationJob)
            .where(ClassificationJob.workspace_id == workspace_id)
            .offset(skip)
            .limit(limit)
        )
        
        # Execute query
        jobs = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(ClassificationJob.id)).where(
            ClassificationJob.workspace_id == workspace_id
        )
        total_count = session.exec(count_query).one()
        
        # Convert to read models and add counts if requested
        result_jobs = []
        for job in jobs:
            job_read = ClassificationJobRead.model_validate(job)
            
            # Add counts if requested
            if include_counts:
                # Count results for this job
                results_count_query = select(func.count(ClassificationResult.id)).where(
                    ClassificationResult.job_id == job.id
                )
                job_read.result_count = session.exec(results_count_query).one() or 0
                
                # Can also add datasource record count if needed
                # This would require a join to datasource and then to datarecords
            
            result_jobs.append(job_read)
            
        return ClassificationJobsOut(data=result_jobs, count=total_count)
    
    except ValueError as ve:
        # Should not happen if validation is correct
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_workspace_access
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing jobs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/{job_id}", response_model=ClassificationJobRead)
def get_classification_job(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    include_counts: bool = Query(True, description="Include counts of results and data records"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Classification Job by its ID.
    """
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get the job
        job = session.get(ClassificationJob, job_id)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found"
            )
        
        # Verify job belongs to workspace
        if job.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found in this workspace"
            )
        
        # Convert to read model
        job_read = ClassificationJobRead.model_validate(job)
        
        # Add counts if requested
        if include_counts:
            # Count results for this job
            results_count_query = select(func.count(ClassificationResult.id)).where(
                ClassificationResult.job_id == job.id
            )
            job_read.result_count = session.exec(results_count_query).one() or 0
        
        return job_read
    
    except HTTPException as he:
        # Re-raise HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.patch("/{job_id}", response_model=ClassificationJobRead)
def update_classification_job(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    job_in: ClassificationJobUpdate,
    session: SessionDep,
) -> Any:
    """
    Update a Classification Job.
    """
    logger.info(f"Route: Updating ClassificationJob {job_id} in workspace {workspace_id}")
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get the job
        job = session.get(ClassificationJob, job_id)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found"
            )
        
        # Verify job belongs to workspace
        if job.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found in this workspace"
            )
        
        # Apply updates
        update_data = job_in.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid fields provided for update"
            )
        
        # Update fields
        for field, value in update_data.items():
            setattr(job, field, value)
        
        job.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(job)
        session.commit()
        session.refresh(job)
        
        # Return updated job
        return ClassificationJobRead.model_validate(job)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise HTTP exceptions
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_classification_job(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Classification Job.
    """
    logger.info(f"Route: Attempting to delete ClassificationJob {job_id} from workspace {workspace_id}")
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get the job
        job = session.get(ClassificationJob, job_id)
        if not job:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found"
            )
        
        # Verify job belongs to workspace
        if job.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Classification Job not found in this workspace"
            )
        
        # Check if job can be deleted (not in progress)
        if job.status == ClassificationJobStatus.PROCESSING:
            raise ValueError("Cannot delete a job that is currently processing. Cancel it first.")
        
        # Delete the job
        session.delete(job)
        session.commit()
        logger.info(f"Route: ClassificationJob {job_id} successfully deleted")
        
    except ValueError as ve:
        # Handle validation errors
        session.rollback()
        logger.error(f"Route: Validation error deleting job {job_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_workspace_access
        session.rollback()
        raise he
    except Exception as e:
        # Handle unexpected errors
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error") 