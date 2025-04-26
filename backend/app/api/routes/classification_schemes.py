import logging
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, Query, status

# Models
from app.models import (
    ClassificationSchemeRead,
    ClassificationSchemeCreate,
    ClassificationSchemeUpdate
)
# Deps - Updated: Use ClassificationServiceDep
from app.api.deps import SessionDep, CurrentUser, ClassificationServiceDep
# Service class for type hint
# from app.api.services.classification import ClassificationService
# Base provider type
# from app.api.services.providers.base import ClassificationProvider

# Remove unused imports
# from app.models import Workspace, ClassificationResult, ClassificationResultRead, ClassificationField, FieldType
# from sqlmodel import Session, select, func
# from datetime import datetime, timezone
# from pydantic import BaseModel, Field, create_model
# import os
# from app.core.opol_config import opol
# from sqlalchemy.orm import joinedload
# from sqlalchemy import distinct

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/classification_schemes",
    tags=["ClassificationSchemes"]
)

@router.post("/", response_model=ClassificationSchemeRead, status_code=status.HTTP_201_CREATED)
@router.post("", response_model=ClassificationSchemeRead, status_code=status.HTTP_201_CREATED)
def create_classification_scheme(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_in: ClassificationSchemeCreate,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> ClassificationSchemeRead:
    """Create a new classification scheme using the service."""
    try:
        # Pass provider - NO, use injected service directly
        scheme = service.create_scheme(
            user_id=current_user.id,
            workspace_id=workspace_id,
            scheme_data=scheme_in
        )
        return scheme
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error creating scheme in workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("")
@router.get("/", response_model=List[ClassificationSchemeRead])
def read_classification_schemes(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> List[ClassificationSchemeRead]:
    """Retrieve classification schemes for the workspace using the service."""
    try:
        # Pass provider - NO, use injected service directly
        schemes = service.list_schemes(
            user_id=current_user.id,
            workspace_id=workspace_id,
            skip=skip,
            limit=limit
        )
        return schemes
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing schemes for workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{scheme_id}", response_model=ClassificationSchemeRead)
def read_classification_scheme(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> ClassificationSchemeRead:
    """Retrieve a specific classification scheme using the service."""
    try:
        # Pass provider - NO, use injected service directly
        scheme = service.get_scheme(
            scheme_id=scheme_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        if not scheme:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classification scheme not found or not accessible")
        return scheme
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting scheme {scheme_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{scheme_id}", response_model=ClassificationSchemeRead)
def update_classification_scheme(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int,
    scheme_in: ClassificationSchemeUpdate,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> ClassificationSchemeRead:
    """Update a classification scheme using the service."""
    try:
        # Pass provider - NO, use injected service directly
        updated_scheme = service.update_scheme(
            scheme_id=scheme_id,
            user_id=current_user.id,
            workspace_id=workspace_id,
            update_data=scheme_in
        )
        if not updated_scheme:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classification scheme not found or update failed")
        return updated_scheme
    except ValueError as ve:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
         raise he
    except Exception as e:
        logger.exception(f"Route: Error updating scheme {scheme_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{scheme_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_classification_scheme(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> None:
    """Delete a classification scheme using the service."""
    try:
        # Pass provider - NO, use injected service directly
        deleted = service.delete_scheme(
            scheme_id=scheme_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        if not deleted:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Classification scheme not found or could not be deleted")
        return None
    except ValueError as ve:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
         raise he
    except Exception as e:
        logger.exception(f"Route: Error deleting scheme {scheme_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

# Note: Deleting all schemes might be better handled by a specific service method
# rather than iterating in the route.
@router.delete("", status_code=status.HTTP_200_OK)
@router.delete("/", status_code=status.HTTP_200_OK)
def delete_all_classification_schemes(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    session: SessionDep,
    # Inject service
    service: ClassificationServiceDep,
) -> Any:
    """Delete all classification schemes in a workspace using the service."""
    try:
        # Pass provider - NO, use injected service directly
        deleted_count = service.delete_all_schemes_in_workspace(
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        return {"message": f"Successfully deleted {deleted_count} classification schemes"}
    except ValueError as ve:
         raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
         raise he
    except Exception as e:
        logger.exception(f"Route: Error deleting all schemes in workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")
