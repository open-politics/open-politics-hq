# backend/app/api/routes/recurring_tasks.py
import logging
from typing import List, Any, Optional, Union
from fastapi import APIRouter, Depends, HTTPException, Query
from croniter import croniter # Import croniter

from sqlmodel import Session, select, func
from datetime import datetime, timezone

from app.models import (
    RecurringTask,
    RecurringTaskCreate,
    RecurringTaskRead,
    RecurringTaskUpdate,
    RecurringTasksOut,
    Workspace,
    User,
    RecurringTaskStatus, # Needed for updates
    RecurringTaskType # Needed for config validation
)
from app.api.deps import SessionDep, CurrentUser
from app.core.beat_utils import add_or_update_schedule, remove_schedule

# TODO: Add Celery Beat scheduling/unscheduling logic on create/update/delete

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/recurring_tasks",
    tags=["RecurringTasks"]
)

def validate_task_input(task_in: Union[RecurringTaskCreate, RecurringTaskUpdate]):
    """Validates schedule and configuration."""
    # Validate Schedule
    if task_in.schedule and not croniter.is_valid(task_in.schedule):
        raise HTTPException(status_code=422, detail=f"Invalid cron schedule format: '{task_in.schedule}'")

    # Validate Configuration based on Type (only if type and config are present)
    task_type = getattr(task_in, 'type', None)
    config = getattr(task_in, 'configuration', None)

    if task_type and config is not None:
        if not isinstance(config, dict):
             raise HTTPException(status_code=422, detail="Configuration must be a dictionary.")

        if task_type == RecurringTaskType.INGEST:
            if 'target_datasource_id' not in config or not isinstance(config.get('target_datasource_id'), int):
                raise HTTPException(status_code=422, detail="INGEST task configuration requires an integer 'target_datasource_id'.")
            if 'source_urls' not in config or not isinstance(config.get('source_urls'), list):
                raise HTTPException(status_code=422, detail="INGEST task configuration requires a list 'source_urls'.")
            # Add more checks for URL format etc. if needed

        elif task_type == RecurringTaskType.CLASSIFY:
            if 'target_datasource_ids' not in config or not isinstance(config.get('target_datasource_ids'), list):
                 raise HTTPException(status_code=422, detail="CLASSIFY task configuration requires a list 'target_datasource_ids'.")
            if 'target_scheme_ids' not in config or not isinstance(config.get('target_scheme_ids'), list):
                 raise HTTPException(status_code=422, detail="CLASSIFY task configuration requires a list 'target_scheme_ids'.")
            # Add more checks for ID types etc. if needed


@router.post("", response_model=RecurringTaskRead)
@router.post("/", response_model=RecurringTaskRead)
def create_recurring_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    task_in: RecurringTaskCreate
) -> Any:
    """
    Create a new Recurring Task for the workspace.
    """
    logger.info(f"Creating RecurringTask '{task_in.name}' in workspace {workspace_id}")

    # 1. Verify Workspace Access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # --- Add Validation --- 
    validate_task_input(task_in)

    # 2. Create RecurringTask instance
    task = RecurringTask.model_validate(
        task_in.model_dump(),
        update={
            "workspace_id": workspace_id,
            "user_id": current_user.id,
            # Ensure status defaults correctly if not provided or handle explicitly
            "status": task_in.status if task_in.status else RecurringTaskStatus.PAUSED
        }
    )
    session.add(task)
    session.commit()
    session.refresh(task)
    logger.info(f"RecurringTask {task.id} created successfully with status {task.status}.")

    # Add/Update Celery Beat schedule
    try:
        add_or_update_schedule(
            recurring_task_id=task.id,
            schedule_str=task.schedule,
            is_enabled=(task.status == RecurringTaskStatus.ACTIVE)
        )
        logger.info(f"Celery Beat schedule added/updated for task {task.id}.")
    except Exception as beat_error:
        # Rollback task creation if scheduling fails
        session.rollback()
        logger.error(f"Failed to set Celery Beat schedule for task {task.id}, rolling back task creation: {beat_error}", exc_info=True)
        # Raise HTTP 500 - indicates a server-side issue with scheduling
        raise HTTPException(status_code=500, detail=f"Task created in DB but failed to activate schedule: {beat_error}")

    # 3. Return the created task
    return task


@router.get("", response_model=RecurringTasksOut)
@router.get("/", response_model=RecurringTasksOut)
def read_recurring_tasks(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    status: Optional[RecurringTaskStatus] = Query(None, description="Filter by task status")
) -> Any:
    """
    Retrieve Recurring Tasks for the workspace.
    """
    # 1. Verify Workspace Access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # 2. Base Query for Tasks
    statement = select(RecurringTask).where(
        RecurringTask.workspace_id == workspace_id,
        RecurringTask.user_id == current_user.id # Or check workspace ownership if tasks aren't user-specific
    )

    # Optional status filter
    if status:
        statement = statement.where(RecurringTask.status == status)

    # 3. Get Total Count for Pagination
    count_statement = select(func.count()).select_from(RecurringTask).where(
        RecurringTask.workspace_id == workspace_id,
        RecurringTask.user_id == current_user.id
    )
    if status:
        count_statement = count_statement.where(RecurringTask.status == status)
    total_count = session.exec(count_statement).one()

    # 4. Apply Ordering, Pagination
    statement = statement.order_by(RecurringTask.created_at.desc()).offset(skip).limit(limit)

    # 5. Execute Query
    tasks = session.exec(statement).all()

    return RecurringTasksOut(data=tasks, count=total_count)


@router.get("/{task_id}", response_model=RecurringTaskRead)
def read_recurring_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int
) -> Any:
    """
    Retrieve a specific Recurring Task by its ID.
    """
    task = session.get(RecurringTask, task_id)
    if (
        not task
        or task.workspace_id != workspace_id
        or task.user_id != current_user.id # Verify ownership
    ):
        raise HTTPException(status_code=404, detail="Recurring Task not found")

    return task

@router.patch("/{task_id}", response_model=RecurringTaskRead)
def update_recurring_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int,
    task_in: RecurringTaskUpdate
) -> Any:
    """
    Update a Recurring Task.
    """
    logger.info(f"Updating RecurringTask {task_id} in workspace {workspace_id}")
    task = session.get(RecurringTask, task_id)
    if (
        not task
        or task.workspace_id != workspace_id
        or task.user_id != current_user.id # Verify ownership
    ):
        raise HTTPException(status_code=404, detail="Recurring Task not found")

    # --- Add Validation for updated fields --- 
    validate_task_input(task_in)

    update_data = task_in.model_dump(exclude_unset=True)
    needs_update = False
    schedule_changed = False
    status_changed = False

    for key, value in update_data.items():
        if getattr(task, key) != value:
            setattr(task, key, value)
            needs_update = True
            if key == 'schedule':
                schedule_changed = True
            if key == 'status':
                status_changed = True

    if needs_update:
        task.updated_at = datetime.now(timezone.utc)
        session.add(task)
        # Commit DB changes *before* trying to update schedule
        try:
            session.commit()
            session.refresh(task)
            logger.info(f"RecurringTask {task.id} database fields updated successfully.")
        except Exception as db_exc:
            session.rollback()
            logger.error(f"Database error updating RecurringTask {task.id}: {db_exc}", exc_info=True)
            raise HTTPException(status_code=500, detail="Failed to save task updates to database.")

        # Update Celery Beat schedule if schedule or status changed
        if schedule_changed or status_changed:
            try:
                add_or_update_schedule(
                    recurring_task_id=task.id,
                    schedule_str=task.schedule,
                    is_enabled=(task.status == RecurringTaskStatus.ACTIVE)
                )
                logger.info(f"Celery Beat schedule updated for task {task.id} due to schedule/status change.")
            except Exception as beat_error:
                # Log the error. Since DB update succeeded, don't raise 500 here?
                # Or should we try to revert the DB change? Complex.
                # For now, log error and return the updated task, but the schedule might be inconsistent.
                # A better approach might involve a background task to retry scheduling.
                logger.error(f"Failed to update Celery Beat schedule for task {task.id} after DB update: {beat_error}", exc_info=True)
                # Optionally add an alert/notification mechanism here
                # We will still return the updated task as the DB change was successful

    else:
         logger.info(f"No changes detected for RecurringTask {task.id}. Update skipped.")

    return task

@router.delete("/{task_id}", status_code=204)
def delete_recurring_task(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    task_id: int
) -> None:
    """
    Delete a Recurring Task.
    """
    logger.info(f"Attempting to delete RecurringTask {task_id} from workspace {workspace_id}")
    task = session.get(RecurringTask, task_id)
    if (
        not task
        or task.workspace_id != workspace_id
        or task.user_id != current_user.id # Verify ownership
    ):
        raise HTTPException(status_code=404, detail="Recurring Task not found")

    # 1. Remove Celery Beat schedule first
    try:
        remove_schedule(recurring_task_id=task.id)
        logger.info(f"Celery Beat schedule removed for task {task.id}.")
    except Exception as beat_error:
        # If removing the schedule fails, prevent deletion of the DB record
        logger.error(f"Failed to remove Celery Beat schedule for task {task.id}. Aborting deletion: {beat_error}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Failed to remove task schedule. Cannot delete task {task_id}. Error: {beat_error}")

    # 2. If schedule removal succeeded, delete the task record
    try:
        session.delete(task)
        session.commit()
        logger.info(f"RecurringTask {task_id} deleted successfully from database.")
        return None # Return None for 204 response
    except Exception as e:
        session.rollback()
        logger.error(f"Error deleting RecurringTask {task.id} from database after schedule removal: {e}", exc_info=True)
        # This indicates an inconsistency, as the schedule is gone but the task remains.
        raise HTTPException(status_code=500, detail=f"Schedule removed, but failed to delete task from database: {str(e)}") 