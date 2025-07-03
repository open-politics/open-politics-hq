"""Routes for annotation runs."""
import logging
from typing import Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    AnnotationRun,
    RunStatus,
    Annotation,
)
from app.schemas import (
    AnnotationRunRead,
    AnnotationRunCreate,
    AnnotationRunUpdate,
    AnnotationRunsOut,
    Message,
    PackageRead,
    CreatePackageFromRunRequest,
)
from app.api.deps import (
    SessionDep,
    CurrentUser,
    get_annotation_service,
    get_package_service
)
from app.api.services.annotation_service import AnnotationService
from app.api.services.package_service import PackageService
from app.api.services.service_utils import validate_infospace_access
from sqlmodel import select, func

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/runs",
    tags=["Runs"]
)

@router.post("", response_model=AnnotationRunRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AnnotationRunRead, status_code=status.HTTP_201_CREATED)
def create_run(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_in: AnnotationRunCreate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> AnnotationRunRead:
    """
    Create a new Run.
    """
    logger.info(f"Route: Creating run in infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Create the run
        run = annotation_service.create_run(
            user_id=current_user.id,
            infospace_id=infospace_id,
            run_in=run_in
        )
        
        return run
        
    except ValueError as e:
        logger.error(f"Route: Validation error creating run: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating run: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("", response_model=AnnotationRunsOut)
@router.get("/", response_model=AnnotationRunsOut)
def list_runs(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Runs for the infospace.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Build query for runs
        query = (
            select(AnnotationRun)
            .where(AnnotationRun.infospace_id == infospace_id)
            .offset(skip)
            .limit(limit)
        )
        
        # Execute query
        runs = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(AnnotationRun.id)).where(
            AnnotationRun.infospace_id == infospace_id
        )
        total_count = session.exec(count_query).one()
        
        # Convert to read models and add counts if requested
        result_runs = []
        for run in runs:
            run_read = AnnotationRunRead.model_validate(run)
            
            # Populate schema_ids from target_schemas relationship
            run_read.schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []
            
            # Add counts if requested
            if include_counts:
                # Count annotations for this run
                annotations_count_query = select(func.count(Annotation.id)).where(
                    Annotation.run_id == run.id
                )
                run_read.annotation_count = session.exec(annotations_count_query).one() or 0
            
            result_runs.append(run_read)
            
        return AnnotationRunsOut(data=result_runs, count=total_count)
    
    except ValueError as ve:
        # Should not happen if validation is correct
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_infospace_access
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing runs: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{run_id}", response_model=AnnotationRunRead)
def get_run(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Run by its ID.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Convert to read model
        run_read = AnnotationRunRead.model_validate(run)
        
        # Populate schema_ids from target_schemas relationship
        run_read.schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []
        
        # Add counts if requested
        if include_counts:
            # Count annotations for this run
            annotations_count_query = select(func.count(Annotation.id)).where(
                Annotation.run_id == run.id
            )
            run_read.annotation_count = session.exec(annotations_count_query).one() or 0
        
        return run_read
    
    except HTTPException as he:
        # Re-raise HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{run_id}", response_model=AnnotationRunRead)
def update_run(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    run_in: AnnotationRunUpdate,
    session: SessionDep,
) -> Any:
    """
    Update a Run.
    """
    logger.info(f"Route: Updating Run {run_id} in infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Apply updates
        update_data = run_in.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid fields provided for update"
            )
        
        # Update fields
        for field, value in update_data.items():
            setattr(run, field, value)
        
        if "description" in update_data:
            run.description = update_data["description"]

        run.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(run)
        session.commit()
        session.refresh(run)
        
        # Return updated run
        return AnnotationRunRead.model_validate(run)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise HTTP exceptions
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Run.
    """
    logger.info(f"Route: Attempting to delete Run {run_id} from infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Check if run can be deleted (not in progress)
        if run.status == RunStatus.RUNNING:
            raise ValueError("Cannot delete a run that is currently processing. Cancel it first.")
        
        # Delete the run
        session.delete(run)
        session.commit()
        logger.info(f"Route: Run {run_id} successfully deleted")
        
    except ValueError as ve:
        # Handle validation errors
        session.rollback()
        logger.error(f"Route: Validation error deleting run {run_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_infospace_access
        session.rollback()
        raise he
    except Exception as e:
        # Handle unexpected errors
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.post("/{run_id}/retry_failures", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
def retry_failed_annotations(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    session: SessionDep,
    service: AnnotationService = Depends(get_annotation_service),
) -> Message:
    """
    Retry failed annotations in a run.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Trigger retry
        success = service.trigger_retry_failed_annotations(
            run_id=run_id,
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to trigger retry of failed annotations"
            )
        
        return Message(message="Retry of failed annotations triggered successfully")
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error triggering retry for run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.post("/{run_id}/create_package", response_model=PackageRead, status_code=status.HTTP_201_CREATED)
async def create_package_from_run_endpoint(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    request_data: CreatePackageFromRunRequest,
    session: SessionDep,
    package_service: PackageService = Depends(get_package_service)
):
    """
    Create a package from a run.
    """
    logger.info(f"Route: Creating package from run {run_id} in infospace {infospace_id} with name '{request_data.name}'")
    try:
        # Validate infospace access early
        validate_infospace_access(session, infospace_id, current_user.id)

        # The service method get_run_details (called by package_service.create_package_from_run)
        # will also validate run existence and access within the infospace.
        # No need to fetch run object here separately.

        package = await package_service.create_package_from_run(
            run_id=run_id,
            user_id=current_user.id,
            infospace_id=infospace_id,
            name=request_data.name,
            description=request_data.description
        )

        # FastAPI will automatically validate the returned 'package' (DB model instance)
        # against the PackageRead response_model.
        return package

    except ValueError as ve:
        # Service methods might raise ValueError for business logic errors (e.g., not found, bad state)
        logger.error(f"Route: Value error creating package from run {run_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise known HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating package from run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error while creating package from run") 