# backend/app/api/routes/recurring_tasks.py
import logging
from typing import List, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
# Remove croniter import if validation is fully handled by service
# from croniter import croniter

# Remove DB-related imports if routes don't use them directly
# from sqlmodel import Session, select, func
# from datetime import datetime, timezone

from app.models import (
    Task,
    User,
    TaskStatus,
    TaskType
)
from app.schemas import (
    TaskCreate,
    TaskRead,
    TaskUpdate,
    TasksOut
)
from app.api.deps import (
    CurrentUser,
    TaskServiceDep
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/tasks",
    tags=["Tasks"],
    dependencies=[Depends(CurrentUser)],
)

# Remove validation function if it's now only used within the service
# def validate_task_input(task_in: Union[RecurringTaskCreate, RecurringTaskUpdate]): ...

@router.post("", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=TaskRead, status_code=status.HTTP_201_CREATED)
async def create_task(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    task_in: TaskCreate,
    task_service: TaskServiceDep
) -> TaskRead:
    """
    Create a new Recurring Task in the specified infospace.
    """
    logger.info(f"Route: Creating Task '{task_in.name}' in infospace {infospace_id} via service")
    try:
        created_task_model = task_service.create_task(
            user_id=current_user.id,
            infospace_id=infospace_id,
            task_in=task_in
        )
        return created_task_model
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Route: Error creating task: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.get("", response_model=TasksOut)
@router.get("/", response_model=TasksOut)
async def list_tasks(
    current_user: CurrentUser,
    infospace_id: int,
    task_service: TaskServiceDep,
    skip: int = 0,
    limit: int = 100,
    status: Optional[TaskStatus] = Query(None, description="Filter by task status"),
    type: Optional[TaskType] = Query(None, description="Filter by task type"),
    is_enabled: Optional[bool] = Query(None, description="Filter by is_enabled flag")
) -> TasksOut:
    """
    Retrieve Tasks for the infospace using the service.
    """
    try:
        tasks, total_count = task_service.list_tasks(
            user_id=current_user.id,
            infospace_id=infospace_id,
            skip=skip,
            limit=limit,
            status_filter=status,
            type_filter=type,
            is_enabled_filter=is_enabled
        )
        return TasksOut(data=tasks, count=total_count)
    except Exception as e:
        logger.exception(f"Route: Error listing tasks for infospace {infospace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{task_id}", response_model=TaskRead)
async def get_task(
    current_user: CurrentUser,
    infospace_id: int,
    task_id: int,
    task_service: TaskServiceDep
) -> TaskRead:
    """
    Retrieve a specific Task by its ID from the infospace.
    """
    task = task_service.get_task(
        task_id=task_id,
        user_id=current_user.id,
        infospace_id=infospace_id
    )
    if not task:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found or not accessible")
    return task

@router.put("/{task_id}", response_model=TaskRead)
async def update_task(
    current_user: CurrentUser,
    infospace_id: int,
    task_id: int,
    task_in: TaskUpdate,
    task_service: TaskServiceDep
) -> TaskRead:
    """
    Update a Task in the infospace.
    """
    logger.info(f"Route: Updating Task {task_id} in infospace {infospace_id} via service")
    try:
        updated_task = task_service.update_task(
            task_id=task_id,
            user_id=current_user.id,
            infospace_id=infospace_id,
            task_in=task_in
        )
        if not updated_task:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found or not accessible")
        return updated_task
    except ValueError as ve:
         raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Route: Error updating task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_task(
    current_user: CurrentUser,
    infospace_id: int,
    task_id: int,
    task_service: TaskServiceDep
) -> None:
    """
    Delete a Task from the infospace.
    """
    logger.info(f"Route: Attempting to delete Task {task_id} from infospace {infospace_id} via service")
    try:
        deleted = task_service.delete_task(
            task_id=task_id,
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        if not deleted:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Task not found or not accessible")
        return None
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        logger.error(f"Route: Error deleting task {task_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))

@router.post("/{task_id}/execute", status_code=status.HTTP_202_ACCEPTED)
async def execute_task_manually(
    current_user: CurrentUser,
    infospace_id: int,
    task_id: int,
    task_service: TaskServiceDep,
) -> dict:
    """
    Manually trigger the execution of a specific task.
    """
    logger.info(f"Route: Manually triggering task {task_id}")
    try:
        success = await task_service.execute_task(
            task_id=task_id, user_id=current_user.id, infospace_id=infospace_id
        )
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Failed to trigger task. It may not exist, be disabled, or have an invalid configuration.",
            )
        return {"message": "Task execution successfully triggered."}
    except Exception as e:
        logger.error(
            f"Route: Failed to manually trigger task {task_id}: {e}", exc_info=True
        )
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e)
        ) 