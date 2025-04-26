"""
Recurring Task service.

This module contains the business logic for recurring task operations,
including managing schedules with Celery Beat.
"""
import logging
from typing import List, Any, Optional, Union, Tuple
from datetime import datetime, timezone

from sqlmodel import Session, select, func
from croniter import croniter # For validation
from fastapi import HTTPException # Removed Depends

# Removed SessionDep import

from app.models import (
    RecurringTask,
    RecurringTaskCreate,
    RecurringTaskRead,
    RecurringTaskUpdate,
    RecurringTaskStatus,
    RecurringTaskType
)
# Restore beat_utils import
from app.core.beat_utils import add_or_update_schedule, remove_schedule
from app.api.services.service_utils import validate_workspace_access

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# Helper validation function (can remain here or move to a validation module)
def validate_task_input(task_in: Union[RecurringTaskCreate, RecurringTaskUpdate]):
    """Validates schedule and configuration."""
    schedule = getattr(task_in, 'schedule', None)
    if schedule and not croniter.is_valid(schedule):
        raise ValueError(f"Invalid cron schedule format: '{schedule}'")

    task_type = getattr(task_in, 'type', None)
    config = getattr(task_in, 'configuration', None)

    if task_type and config is not None:
        if not isinstance(config, dict):
             raise ValueError("Configuration must be a dictionary.")

        if task_type == RecurringTaskType.INGEST:
            if 'target_datasource_id' not in config or not isinstance(config.get('target_datasource_id'), int):
                raise ValueError("INGEST task configuration requires an integer 'target_datasource_id'.")
            if 'source_urls' not in config or not isinstance(config.get('source_urls'), list):
                raise ValueError("INGEST task configuration requires a list 'source_urls'.")

        elif task_type == RecurringTaskType.CLASSIFY:
            if 'target_datasource_ids' not in config or not isinstance(config.get('target_datasource_ids'), list):
                 raise ValueError("CLASSIFY task configuration requires a list 'target_datasource_ids'.")
            if 'target_scheme_ids' not in config or not isinstance(config.get('target_scheme_ids'), list):
                 raise ValueError("CLASSIFY task configuration requires a list 'target_scheme_ids'.")


class RecurringTaskService:
    """
    Service for handling recurring task operations.
    """
    def __init__(self, session: Session): # Use base Session type
        """Initialize with a database session dependency."""
        self.session = session

    def create_recurring_task(
        self,
        # Removed session param, use self.session
        user_id: int,
        workspace_id: int,
        task_in: RecurringTaskCreate
    ) -> RecurringTask:
        """
        Create a new Recurring Task, validate input, and schedule it with Celery Beat.
        MODIFIES DATA - Commits transaction.
        """
        logger.info(f"Service: Creating RecurringTask '{task_in.name}' in workspace {workspace_id}")

        try:
            validate_workspace_access(self.session, workspace_id, user_id) # Use self.session
            validate_task_input(task_in)

            task = RecurringTask(
                workspace_id=workspace_id,
                user_id=user_id,
                status=task_in.status or RecurringTaskStatus.PAUSED,
                **task_in.model_dump()
            )
            self.session.add(task)
            self.session.flush() # Flush to get ID before scheduling
            task_id = task.id # Store the ID

            # Restore Celery Beat schedule update call
            add_or_update_schedule(
                recurring_task_id=task_id,
                schedule_str=task.schedule,
                is_enabled=(task.status == RecurringTaskStatus.ACTIVE)
            )
            logger.info(f"Service: Celery Beat schedule added/updated for task {task_id}.")

            self.session.commit()
            self.session.refresh(task) # Refresh after successful flush and schedule
            logger.info(f"Service: RecurringTask {task_id} created successfully with status {task.status}.")

            return task

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to create recurring task: {str(e)}")

    def list_recurring_tasks(
        self,
        # Removed session param
        user_id: int,
        workspace_id: int,
        skip: int = 0,
        limit: int = 100,
        status: Optional[RecurringTaskStatus] = None
    ) -> Tuple[List[RecurringTaskRead], int]:
        """
        Retrieve Recurring Tasks for the workspace, with optional status filter.
        READ-ONLY - Does not commit.
        """
        validate_workspace_access(self.session, workspace_id, user_id) # Use self.session

        statement = select(RecurringTask).where(
            RecurringTask.workspace_id == workspace_id,
        )

        if status:
            statement = statement.where(RecurringTask.status == status)

        count_statement = select(func.count()).select_from(statement.subquery())
        total_count = self.session.exec(count_statement).one()

        statement = statement.order_by(RecurringTask.created_at.desc()).offset(skip).limit(limit)
        tasks = self.session.exec(statement).all()

        task_reads = [RecurringTaskRead.model_validate(task) for task in tasks]
        return task_reads, total_count

    def get_recurring_task(
        self,
        # Removed session param
        task_id: int,
        user_id: int,
        workspace_id: int
    ) -> Optional[RecurringTaskRead]:
        """
        Retrieve a specific Recurring Task by its ID, validating access.
        READ-ONLY - Does not commit.
        """
        task = self.session.get(RecurringTask, task_id) # Use self.session
        if not task or task.workspace_id != workspace_id:
            return None

        try:
            validate_workspace_access(self.session, workspace_id, user_id) # Use self.session
        except HTTPException:
            return None # Access denied

        return RecurringTaskRead.model_validate(task)

    def update_recurring_task(
        self,
        # Removed session param, use self.session
        task_id: int,
        user_id: int,
        workspace_id: int,
        task_in: RecurringTaskUpdate
    ) -> Optional[RecurringTaskRead]:
        """
        Update a Recurring Task, validate changes, and update the Celery Beat schedule.
        MODIFIES DATA - Commits transaction.
        """
        logger.info(f"Service: Updating RecurringTask {task_id} in workspace {workspace_id}")
        task = self.session.get(RecurringTask, task_id) # Use self.session
        if not task or task.workspace_id != workspace_id:
            return None

        try:
            validate_workspace_access(self.session, workspace_id, user_id) # Use self.session
        except HTTPException:
            return None # Access denied

        validate_task_input(task_in)

        update_data = task_in.model_dump(exclude_unset=True)
        needs_db_update = False
        schedule_changed = False
        status_changed = False

        original_schedule = task.schedule
        original_status = task.status

        for key, value in update_data.items():
            if getattr(task, key) != value:
                setattr(task, key, value)
                needs_db_update = True
                if key == 'schedule':
                    schedule_changed = True
                if key == 'status':
                    status_changed = True

        if needs_db_update:
            task.updated_at = datetime.now(timezone.utc)
            self.session.add(task)
            self.session.commit()
            self.session.refresh(task)

            # Restore Celery Beat schedule update call
            if schedule_changed or status_changed:
                logger.info(f"Service: Updating Celery Beat schedule for task {task_id} due to change.")
                # Use try-except block for schedule update robustness?
                try:
                    add_or_update_schedule(
                        recurring_task_id=task_id,
                        schedule_str=task.schedule,
                        is_enabled=(task.status == RecurringTaskStatus.ACTIVE)
                    )
                except Exception as beat_error:
                     # Log the error but don't necessarily fail the whole update
                     # Depending on desired behavior
                     logger.error(f"Service: Failed to update Celery Beat schedule for task {task_id}: {beat_error}", exc_info=True)
                     # Optionally raise or return an indication of partial success?

            logger.info(f"Service: RecurringTask {task_id} updated successfully.")
            return RecurringTaskRead.model_validate(task)
        else:
             logger.info(f"Service: No changes detected for RecurringTask {task_id}. Update skipped.")

        return RecurringTaskRead.model_validate(task)

    def delete_recurring_task(
        self,
        # Removed session param, use self.session
        task_id: int,
        user_id: int,
        workspace_id: int
    ) -> bool:
        """
        Delete a Recurring Task, remove its schedule from Celery Beat.
        MODIFIES DATA - Commits transaction.
        """
        logger.info(f"Service: Attempting to delete RecurringTask {task_id} from workspace {workspace_id}")
        task = self.session.get(RecurringTask, task_id) # Use self.session
        if not task or task.workspace_id != workspace_id:
            logger.warning(f"Service: Delete request for non-existent/mismatched task {task_id} in workspace {workspace_id}")
            return False

        try:
            validate_workspace_access(self.session, workspace_id, user_id) # Use self.session
        except HTTPException:
            logger.warning(f"Service: Access denied for user {user_id} deleting task {task_id} in workspace {workspace_id}")
            return False # Access denied

        task_id_to_log = task.id # Log ID before deletion
        task_name_to_log = task.name

        try:
            # Restore removing Celery Beat schedule first
            logger.info(f"Service: Removing Celery Beat schedule for task {task_id_to_log}.")
            try:
                remove_schedule(recurring_task_id=task_id_to_log)
            except Exception as beat_error:
                 # Log error, but proceed with DB deletion if schedule removal fails?
                 # Or raise to prevent DB deletion?
                 logger.error(f"Service: Failed to remove Celery Beat schedule for task {task_id_to_log}. Proceeding with DB deletion. Error: {beat_error}", exc_info=True)
                 # Raise ValueError to indicate potential issue, but let deletion be attempted?
                 # raise ValueError(f"Failed to remove schedule for task {task_id_to_log}")

            self.session.delete(task)
            self.session.commit()
            logger.info(f"Service: RecurringTask '{task_name_to_log}' ({task_id_to_log}) deleted successfully.")
            return True

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to delete recurring task: {str(e)}")

# REMOVED Factory function

# REMOVE Singleton instance for service
# recurring_task_service = RecurringTaskService()

# REMOVE Factory function for dependency injection - moved to deps.py
# def get_recurring_task_service() -> RecurringTaskService:
#     """Get the recurring task service instance."""
#     return recurring_task_service 