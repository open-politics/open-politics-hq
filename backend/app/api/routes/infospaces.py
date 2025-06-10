"""Routes for infospaces."""
import logging
from typing import Any, List, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    Infospace,
    User,
)
from app.schemas import (
    InfospaceRead,
    InfospaceCreate,
    InfospaceUpdate,
    InfospacesOut,
)
from app.api.deps import (
    CurrentUser,
    get_infospace_service
)
from app.api.services.infospace_service import InfospaceService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces",
    tags=["Infospaces"]
)

@router.post("", response_model=InfospaceRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=InfospaceRead, status_code=status.HTTP_201_CREATED)
def create_infospace(
    *,
    current_user: CurrentUser,
    infospace_in: InfospaceCreate,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> InfospaceRead:
    """
    Create a new Infospace.
    """
    logger.info(f"Route: Creating infospace for user {current_user.id}")
    try:
        infospace = infospace_service.create_infospace(
            user_id=current_user.id,
            infospace_in=infospace_in
        )
        return InfospaceRead.model_validate(infospace)
    except Exception as e:
        logger.exception(f"Route: Error creating infospace: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("", response_model=InfospacesOut)
@router.get("/", response_model=InfospacesOut)
def list_infospaces(
    *,
    current_user: CurrentUser,
    skip: int = 0,
    limit: int = 100,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Retrieve Infospaces for the current user.
    """
    try:
        infospaces, total_count = infospace_service.list_infospaces(
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )
        
        result_infospaces = [
            InfospaceRead.model_validate(infospace)
            for infospace in infospaces
        ]
        
        return InfospacesOut(data=result_infospaces, count=total_count)
    except Exception as e:
        logger.exception(f"Route: Error listing infospaces: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{infospace_id}", response_model=InfospaceRead)
def get_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Retrieve a specific Infospace by its ID.
    """
    try:
        infospace = infospace_service.get_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        if not infospace:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        return InfospaceRead.model_validate(infospace)
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{infospace_id}", response_model=InfospaceRead)
def update_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_in: InfospaceUpdate,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Update an Infospace.
    """
    logger.info(f"Route: Updating Infospace {infospace_id}")
    try:
        infospace = infospace_service.update_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id,
            infospace_in=infospace_in
        )
        if not infospace:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        return InfospaceRead.model_validate(infospace)
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error updating infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{infospace_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> None:
    """
    Delete an Infospace.
    """
    logger.info(f"Route: Attempting to delete Infospace {infospace_id}")
    try:
        success = infospace_service.delete_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Infospace not found"
            )
        logger.info(f"Route: Infospace {infospace_id} successfully deleted")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error deleting infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.get("/{infospace_id}/stats", response_model=dict)
def get_infospace_stats(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Get statistics about an Infospace.
    """
    try:
        stats = infospace_service.get_infospace_stats(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        return stats
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.exception(f"Route: Error getting stats for infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/import", response_model=InfospaceRead)
def import_infospace(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    infospace_service: InfospaceService = Depends(get_infospace_service)
) -> Any:
    """
    Import an Infospace.
    """
    try:
        infospace = infospace_service.import_infospace(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        return InfospaceRead.model_validate(infospace)
    except Exception as e:
        logger.exception(f"Route: Error importing infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")  