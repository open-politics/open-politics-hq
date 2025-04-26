import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.services.workspace import WorkspaceService
from app.api.deps import CurrentUser, SessionDep
from app.models import (
    WorkspaceCreate,
    WorkspaceRead,
    WorkspaceUpdate,
    WorkspacesOut,
    Message
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/workspaces")

# Workspace Routes

@router.post("", response_model=WorkspaceRead)
@router.post("/", response_model=WorkspaceRead)
def create_workspace(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_in: WorkspaceCreate
) -> WorkspaceRead:
    """Create a new workspace."""
    workspace_service = WorkspaceService(session=session)
    try:
        workspace = workspace_service.create_workspace(
            user_id=current_user.id,
            workspace_data=workspace_in,
        )
        return workspace
    except ValueError as e:
        logger.error(f"Route: Error creating workspace: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating workspace: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.get("", response_model=List[WorkspaceRead])
@router.get("/", response_model=List[WorkspaceRead])
def read_workspaces(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1),
) -> List[WorkspaceRead]:
    """Retrieve all workspaces for the current user."""
    workspace_service = WorkspaceService(session=session)
    workspaces = workspace_service.get_user_workspaces(
        user_id=current_user.id,
        skip=skip,
        limit=limit,
    )
    return workspaces


@router.get("/{workspace_id}", response_model=WorkspaceRead)
def read_workspace_by_id(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
) -> WorkspaceRead:
    """Get a specific workspace by ID."""
    workspace_service = WorkspaceService(session=session)
    workspace = workspace_service.get_workspace(
        workspace_id=workspace_id,
        user_id=current_user.id,
    )
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found or not accessible")
    return workspace


@router.patch("/{workspace_id}", response_model=WorkspaceRead)
def update_workspace(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    workspace_in: WorkspaceUpdate,
) -> WorkspaceRead:
    """Update an existing workspace."""
    workspace_service = WorkspaceService(session=session)
    update_data = workspace_in.model_dump(exclude_unset=True)

    if not update_data:
        raise HTTPException(status_code=400, detail="No fields provided for update.")

    try:
        workspace = workspace_service.update_workspace(
            workspace_id=workspace_id,
            user_id=current_user.id,
            **update_data,
        )
        if not workspace:
            logger.error(f"Route: Update workspace {workspace_id} returned None unexpectedly.")
            raise HTTPException(status_code=404, detail="Workspace not found or update failed")

        return workspace
    except HTTPException as he:
        raise he
    except ValueError as e:
        logger.error(f"Route: Error updating workspace {workspace_id}: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error updating workspace {workspace_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.delete("/{workspace_id}", response_model=Message)
def delete_workspace(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
) -> Message:
    """Delete a workspace."""
    try:
        workspace_service = WorkspaceService(session=session)
        success = workspace_service.delete_workspace(
            workspace_id=workspace_id,
            user_id=current_user.id,
        )
        if not success:
            logger.error(f"Route: Delete workspace {workspace_id} returned False unexpectedly.")
            raise HTTPException(status_code=404, detail="Workspace not found or could not be deleted")

        return Message(message="Workspace deleted successfully")
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error deleting workspace {workspace_id}: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")


@router.post("/ensure-default", response_model=WorkspaceRead)
def ensure_default_workspace(
    *,
    session: SessionDep,
    current_user: CurrentUser,
) -> WorkspaceRead:
    """Ensure a default workspace exists for the user."""
    try:
        workspace_service = WorkspaceService(session=session)
        workspace = workspace_service.ensure_default_workspace(
            user_id=current_user.id,
        )
        return workspace
    except ValueError as e:
        logger.error(f"Route: Error ensuring default workspace: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error ensuring default workspace: {e}")
        raise HTTPException(status_code=500, detail="Internal server error")