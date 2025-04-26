import logging
from typing import Optional
from sqlmodel import Session
from app.models import RecurringTask
from app.core.db import engine  # Import engine for session creation

logger = logging.getLogger(__name__)

# Moved from recurring_ingestion.py
def update_task_status(task_id: int, status: str, message: Optional[str] = None):
    """Updates the status, message, timestamps, and failure count of the RecurringTask."""
    try:
        with Session(engine) as session:
            task = session.get(RecurringTask, task_id)
            if task:
                task.last_run_status = status
                task.last_run_message = message
                # last_run_at is set by the scheduler before dispatch

                # Update last_successful_run_at only on success
                if status == "success":
                    # Assuming task.last_run_at was set correctly by the scheduler
                    task.last_successful_run_at = task.last_run_at
                    task.consecutive_failure_count = 0 # Reset counter on success
                else:
                    # Increment failure count, handling None initial value
                    task.consecutive_failure_count = (task.consecutive_failure_count or 0) + 1

                session.add(task)
                session.commit()
                logger.info(f"RecurringTask {task_id} final status updated: {status}. Failures: {task.consecutive_failure_count}")
            else:
                logger.error(f"RecurringTask {task_id} not found during final status update.")
    except Exception as e:
        logger.error(f"Error updating final status for RecurringTask {task_id}: {e}", exc_info=True)
        # We're managing our own session here, so we should handle errors and rollback if needed
        # Re-raise or handle as needed, but logging is important
        # Consider re-raising to allow the calling task to handle it
        raise e 
