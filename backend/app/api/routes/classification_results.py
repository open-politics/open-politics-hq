from fastapi import APIRouter, Depends, HTTPException, Query, status
from typing import List, Optional
import logging

logger = logging.getLogger(__name__)

from app.models import (
    ClassificationResultRead,
    EnhancedClassificationResultRead,
)
from app.api.deps import SessionDep, CurrentUser, ClassificationServiceDep

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["ClassificationResults"]
)

@router.get("/classification_results/{result_id}", response_model=ClassificationResultRead)
def get_classification_result(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    result_id: int,
    service: ClassificationServiceDep,
) -> ClassificationResultRead:
    """
    Retrieve an individual classification result by its ID using the service.
    The service handles workspace/user authorization.
    """
    try:
        result = service.get_result(
            result_id=result_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        if not result:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="ClassificationResult not found or not accessible")
        return result
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logging.exception(f"Route: Error getting result {result_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/classification_results", response_model=List[EnhancedClassificationResultRead])
@router.get("/classification_results/", response_model=List[EnhancedClassificationResultRead])
def list_classification_results(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: Optional[int] = Query(None, description="Filter results by ClassificationJob ID"),
    datarecord_ids: Optional[List[int]] = Query(None, description="Filter results by DataRecord IDs"),
    scheme_ids: Optional[List[int]] = Query(None, description="Filter results by ClassificationScheme IDs"),
    skip: int = 0,
    limit: int = 100,
    session: SessionDep,
    service: ClassificationServiceDep,
) -> List[EnhancedClassificationResultRead]:
    """
    List classification results for the workspace, with optional filters, using the service.
    The service handles workspace ownership verification and data fetching.
    Returns enhanced results with calculated display_value.
    """
    try:
        results = service.list_results(
            user_id=current_user.id,
            workspace_id=workspace_id,
            job_id=job_id,
            datarecord_ids=datarecord_ids,
            scheme_ids=scheme_ids,
            skip=skip,
            limit=limit
        )
        return results
    except ValueError as ve:
        logging.exception(f"Route: Error listing results for workspace {workspace_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logging.exception(f"Route: Error listing results for workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/classification_jobs/{job_id}/results", response_model=List[EnhancedClassificationResultRead])
def get_job_results(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    skip: int = 0,
    limit: int = 100,
    session: SessionDep,
    service: ClassificationServiceDep,
) -> List[EnhancedClassificationResultRead]:
    """
    Retrieve all classification results for a specific ClassificationJob using the service.
    The service handles job ownership and workspace context verification.
    Returns enhanced results with calculated display_value.
    """
    try:
        results = service.list_results(
            user_id=current_user.id,
            workspace_id=workspace_id,
            job_id=job_id,
            skip=skip,
            limit=limit
        )
        return results
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logging.exception(f"Route: Error listing results for job {job_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

# --- NEW: Endpoint to trigger individual retry --- 
@router.post("/classification_results/{result_id}/retry", response_model=ClassificationResultRead)
def retry_single_classification_result(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    result_id: int,
    session: SessionDep, # SessionDep needed for validate_workspace_access in service
    service: ClassificationServiceDep, # Inject ClassificationService
) -> ClassificationResultRead:
    """
    Retries a single failed classification result synchronously.
    """
    logger.info(f"Route: Received request to retry single classification result {result_id}")
    try:
        # Service method handles fetching, validation, retry logic, and commit
        updated_result = service.retry_single_result(
            result_id=result_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        # Service method raises errors if result not found, access denied, wrong status, or retry fails
        # If it returns, the retry was processed (though it might have failed again)
        return ClassificationResultRead.model_validate(updated_result)

    except ValueError as ve:
        logger.warning(f"Route: Validation or retry error for result {result_id}: {ve}")
        # Service raises ValueError for not found, access denied, wrong status, or DB errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise other HTTP exceptions (e.g., from workspace validation)
        raise he
    except Exception as e:
        # Handle unexpected errors during the retry process
        logger.exception(f"Route: Unexpected error retrying result {result_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during result retry")
# --- END NEW ENDPOINT ---
