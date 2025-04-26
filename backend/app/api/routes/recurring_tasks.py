# backend/app/api/routes/recurring_tasks.py
import logging
from typing import List, Any, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query, status
# Remove croniter import if validation is fully handled by service
# from croniter import croniter

# Remove DB-related imports if routes don't use them directly
# from sqlmodel import Session, select, func
# from datetime import datetime, timezone

from app.models import (
    RecurringTask,
    RecurringTaskCreate,
    RecurringTaskRead,
    RecurringTaskUpdate,
    RecurringTasksOut,
    Workspace,
    User,
    RecurringTaskStatus,
    RecurringTaskType
)
from app.api.deps import SessionDep, CurrentUser
# Remove beat_utils imports
# from app.core.beat_utils import add_or_update_schedule, remove_schedule
# Import the service factory
from app.api.services.recurring_tasks import RecurringTaskService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/recurring_tasks",
    tags=["RecurringTasks"]
)

# Remove validation function if it's now only used within the service
# def validate_task_input(task_in: Union[RecurringTaskCreate, RecurringTaskUpdate]): ...

@router.post("", response_model=RecurringTaskRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=RecurringTaskRead, status_code=status.HTTP_201_CREATED)
def create_recurring_task(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    task_in: RecurringTaskCreate,
    session: SessionDep,
) -> Any:
    """
    Create a new Recurring Task using the service.
    """
    logger.info(f"Route: Creating RecurringTask '{task_in.name}' in workspace {workspace_id} via service")
    try:
        service = RecurringTaskService(session=session)
        task = service.create_recurring_task(
            user_id=current_user.id,
            workspace_id=workspace_id,
            task_in=task_in
        )
        return task
    except ValueError as ve:
        # Service raises ValueError for validation errors or access issues
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise from validate_workspace_access
        raise he
    except Exception as e:
        # Catch potential scheduling errors from the service
        logger.error(f"Route: Error creating recurring task: {e}", exc_info=True)
        # Map scheduling or other unexpected errors to 500
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


@router.get("", response_model=RecurringTasksOut)
@router.get("/", response_model=RecurringTasksOut)
def read_recurring_tasks(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    status: Optional[RecurringTaskStatus] = Query(None, description="Filter by task status"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Recurring Tasks for the workspace using the service.
    """
    try:
        service = RecurringTaskService(session=session)
        tasks, total_count = service.list_recurring_tasks(
            user_id=current_user.id,
            workspace_id=workspace_id,
            skip=skip,
            limit=limit,
            status=status
        )
        return RecurringTasksOut(data=tasks, count=total_count)
    except ValueError as ve:
        # Should not happen
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        # Re-raise from validate_workspace_access
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing recurring tasks for workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


@router.get("/{task_id}", response_model=RecurringTaskRead)
def read_recurring_task(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int,
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Recurring Task by its ID using the service.
    """
    try:
        service = RecurringTaskService(session=session)
        task = service.get_recurring_task(
            task_id=task_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        if not task:
            # Service returns None if not found/accessible
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring Task not found or not accessible")
        return task
    except HTTPException as he:
        # Re-raise from validate_workspace_access
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting recurring task {task_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{task_id}", response_model=RecurringTaskRead)
def update_recurring_task(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int,
    task_in: RecurringTaskUpdate,
    session: SessionDep,
) -> Any:
    """
    Update a Recurring Task using the service.
    """
    logger.info(f"Route: Updating RecurringTask {task_id} in workspace {workspace_id} via service")
    try:
        service = RecurringTaskService(session=session)
        updated_task = service.update_recurring_task(
            task_id=task_id,
            user_id=current_user.id,
            workspace_id=workspace_id,
            task_in=task_in
        )
        if not updated_task:
             # Service returns None if not found/accessible
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring Task not found or not accessible")
        return updated_task
    except ValueError as ve:
         # Service raises ValueError for validation errors
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise from validate_workspace_access
        raise he
    except Exception as e:
        # Catch potential scheduling errors or critical DB issues from the service
        logger.error(f"Route: Error updating recurring task {task_id}: {e}", exc_info=True)
        # Map scheduling/other errors to 500
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_recurring_task(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Recurring Task using the service.
    """
    logger.info(f"Route: Attempting to delete RecurringTask {task_id} from workspace {workspace_id} via service")
    try:
        service = RecurringTaskService(session=session)
        deleted = service.delete_recurring_task(
            task_id=task_id,
            user_id=current_user.id,
            workspace_id=workspace_id
        )
        if not deleted:
            # Service returns False if not found/accessible
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Recurring Task not found or not accessible")
        return None # Return None for 204 response
    except HTTPException as he:
        # Re-raise from validate_workspace_access
        raise he
    except Exception as e:
        # Catch potential schedule removal errors from service
        logger.error(f"Route: Error deleting recurring task {task_id}: {e}", exc_info=True)
        # Map scheduling/other errors to 500
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)) 