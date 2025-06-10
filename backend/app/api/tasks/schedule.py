"""
Tasks for scheduling recurring operations.
"""
import logging
from datetime import datetime, timezone
from typing import List, Optional, Dict, Any
from croniter import croniter
import asyncio

from celery import shared_task
from sqlmodel import Session, select
from app.core.celery_app import celery
from app.core.db import engine
from app.models import (
    Task as RecurringTask,
    TaskType,
    TaskStatus,
    Source,
    SourceStatus,
)
from app.schemas import AnnotationRunCreate
from app.core.config import settings
from app.api.services.annotation_service import AnnotationService
from app.api.providers.factory import create_classification_provider, create_storage_provider
from app.api.services.asset_service import AssetService
from app.api.tasks.ingest import process_source


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

def _should_execute_task(task: RecurringTask, current_time: datetime) -> bool:
    """
    Determine if a recurring task should be executed based on its schedule.
    Implements robust cron schedule checking.
    """
    try:
        if not task.cron_schedule:
            logger.warning(f"Task {task.id} has no cron schedule")
            return False
        
        # Validate cron expression
        try:
            cron = croniter(task.cron_schedule, current_time)
        except ValueError as e:
            logger.error(f"Invalid cron schedule '{task.cron_schedule}' for task {task.id}: {e}")
            return False
        
        # Check if task has been executed recently
        if task.last_run_at:
            # Get the previous scheduled time based on cron
            prev_cron = croniter(task.cron_schedule, current_time)
            prev_scheduled_time = prev_cron.get_prev(datetime)
            
            # If last run was after the previous scheduled time, don't run again
            if task.last_run_at >= prev_scheduled_time:
                logger.debug(f"Task {task.id} already executed since last scheduled time")
                return False
        
        # Check if current time matches the schedule
        # Get the next scheduled time from the last run (or creation time)
        reference_time = task.last_run_at or task.created_at
        cron = croniter(task.cron_schedule, reference_time)
        next_run_time = cron.get_next(datetime)
        
        # Execute if current time is past the next scheduled run time
        should_run = current_time >= next_run_time
        
        if should_run:
            logger.debug(f"Task {task.id} should run: current={current_time}, next_scheduled={next_run_time}")
        
        return should_run
        
    except Exception as e:
        logger.error(f"Error checking schedule for task {task.id}: {e}")
        return False

def _execute_recurring_task(session: Session, task: RecurringTask, execution_time: datetime):
    """Execute a recurring task by triggering its associated source processing."""
    try:
        # Update task status
        task.status = TaskStatus.RUNNING
        task.last_run_at = execution_time
        task.run_count = (task.run_count or 0) + 1
        session.add(task)
        session.flush()
        
        # Get the associated source
        source = session.get(Source, task.source_id)
        if not source:
            raise ValueError(f"Source {task.source_id} not found for task {task.id}")
        
        # Validate source is processable
        if source.status in [SourceStatus.PROCESSING, SourceStatus.FAILED]:
            logger.warning(f"Skipping task {task.id}: source {source.id} is in {source.status} status")
            task.status = TaskStatus.COMPLETED
            return
        
        # Trigger source processing
        process_source.delay(source.id)
        
        # Update task status
        task.status = TaskStatus.COMPLETED
        task.last_success_at = execution_time
        
        # Log execution details
        logger.info(f"Successfully triggered source {source.id} for recurring task {task.id}")
        
    except Exception as e:
        logger.exception(f"Error executing recurring task {task.id}: {e}")
        _mark_task_failed(session, task, str(e))
        raise

def _mark_task_failed(session: Session, task: RecurringTask, error_message: str):
    """Mark a recurring task as failed with error details."""
    try:
        task.status = TaskStatus.FAILED
        task.error_message = error_message
        task.failure_count = (task.failure_count or 0) + 1
        session.add(task)
        
        # Disable task if it fails too many times
        max_failures = 5
        if task.failure_count >= max_failures:
            task.is_active = False
            logger.error(f"Disabling task {task.id} after {max_failures} consecutive failures")
        
        session.commit()
        
    except Exception as e:
        logger.exception(f"Error marking task {task.id} as failed: {e}")

@celery.task(name="check_and_execute_scheduled_tasks")
def check_and_execute_scheduled_tasks():
    """
    Check for scheduled tasks that need to be executed and trigger them.
    This task should be run periodically (e.g., every minute) via Celery Beat.
    """
    logger.info("Checking for scheduled tasks to execute")
    
    with Session(engine) as session:
        try:
            current_time = datetime.now(timezone.utc)
            
            # Get all active recurring tasks
            active_tasks = session.exec(
                select(RecurringTask).where(
                    RecurringTask.is_active == True,
                    RecurringTask.status != TaskStatus.FAILED
                )
            ).all()
            
            executed_count = 0
            
            for task in active_tasks:
                try:
                    if _should_execute_task(task, current_time):
                        logger.info(f"Executing scheduled task: {task.name} (ID: {task.id})")
                        _execute_recurring_task(session, task, current_time)
                        executed_count += 1
                        
                except Exception as e:
                    logger.error(f"Error checking/executing task {task.id}: {e}")
                    _mark_task_failed(session, task, str(e))
            
            session.commit()
            logger.info(f"Scheduled task check completed. Executed {executed_count} tasks.")
            
        except Exception as e:
            logger.exception(f"Critical error in scheduled task checker: {e}")
            session.rollback()

@celery.task(name="validate_cron_schedules")
def validate_cron_schedules():
    """
    Periodic task to validate all cron schedules and fix/disable invalid ones.
    Should be run daily or weekly.
    """
    logger.info("Validating all cron schedules")
    
    with Session(engine) as session:
        try:
            all_tasks = session.exec(select(RecurringTask)).all()
            invalid_count = 0
            
            for task in all_tasks:
                try:
                    if task.cron_schedule:
                        # Validate cron expression
                        croniter(task.cron_schedule)
                        logger.debug(f"Task {task.id} has valid cron schedule: {task.cron_schedule}")
                    else:
                        logger.warning(f"Task {task.id} has no cron schedule")
                        
                except ValueError as e:
                    logger.error(f"Invalid cron schedule for task {task.id}: {task.cron_schedule} - {e}")
                    task.is_active = False
                    task.status = TaskStatus.FAILED
                    task.error_message = f"Invalid cron schedule: {e}"
                    session.add(task)
                    invalid_count += 1
            
            session.commit()
            logger.info(f"Cron schedule validation completed. Found {invalid_count} invalid schedules.")
            
        except Exception as e:
            logger.exception(f"Error validating cron schedules: {e}")
            session.rollback()

def get_next_run_times(task: RecurringTask, count: int = 5) -> List[datetime]:
    """
    Get the next N run times for a recurring task.
    Useful for displaying schedule information to users.
    """
    try:
        if not task.cron_schedule:
            return []
        
        current_time = datetime.now(timezone.utc)
        reference_time = task.last_run_at or current_time
        
        cron = croniter(task.cron_schedule, reference_time)
        next_runs = []
        
        for _ in range(count):
            next_run = cron.get_next(datetime)
            next_runs.append(next_run)
        
        return next_runs
        
    except Exception as e:
        logger.error(f"Error calculating next run times for task {task.id}: {e}")
        return []

def is_valid_cron_schedule(cron_expression: str) -> bool:
    """
    Validate if a cron expression is valid.
    """
    try:
        croniter(cron_expression)
        return True
    except ValueError:
        return False

def _should_execute_task_old(task: RecurringTask) -> bool:
    """
    Determine if a task should be executed based on its schedule.
    
    Args:
        task: The recurring task to check
        
    Returns:
        True if the task should be executed, False otherwise
    """
    # TODO: Implement proper cron schedule checking
    # For now, just check if it's been more than 24 hours since last run
    if not task.last_run_at:
        return True
    
    now = datetime.now(timezone.utc)
    time_since_last_run = now - task.last_run_at
    
    return time_since_last_run.total_seconds() >= 24 * 60 * 60  # 24 hours 