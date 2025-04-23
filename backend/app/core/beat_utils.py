import logging
from celery import current_app
from sqlalchemy_celery_beat.models import PeriodicTask, CrontabSchedule, IntervalSchedule
from sqlalchemy_celery_beat.session import SessionManager
from sqlmodel import Session # Use SQLModel session if connecting to same DB
from app.core.db import engine # Or your db session setup
from app.models import RecurringTaskStatus # Import status enum
from app.core.celery_app import celery # Import celery instance if needed for dispatch
from sqlalchemy import select, func

logger = logging.getLogger(__name__)

# Initialize SessionManager using the application's Celery instance
# Ensure your Celery app config includes beat_dburi
# session_manager = SessionManager() # Removed as we use the app's engine

def _get_beat_session() -> Session: # Added return type hint
    """Gets a session for the SQLAlchemy-Celery-Beat database."""
    # Using the main app's engine as beat likely uses the same DB
    return Session(engine)

def _generate_task_name(recurring_task_id: int) -> str:
    """Generates a unique name for the periodic task in Beat."""
    return f"recurring-task-{recurring_task_id}"

def add_or_update_schedule(recurring_task_id: int, schedule_str: str, is_enabled: bool):
    """Adds or updates a Celery Beat schedule entry for a RecurringTask."""
    task_name = _generate_task_name(recurring_task_id)
    # Use a context manager for the session
    with _get_beat_session() as session:
        try:
            logger.info(f"Adding/Updating Beat schedule for task {recurring_task_id} ('{task_name}')")
            
            # Validate and parse cron string
            parts = schedule_str.split()
            if len(parts) != 5:
                raise ValueError(f"Invalid cron string format: '{schedule_str}'")
            minute, hour, day_month, month_year, day_week = parts
            
            # Define the schedule timezone (use Celery app's timezone)
            schedule_timezone = celery.conf.timezone
            
            # Find existing CrontabSchedule or create new
            # Query by all parts including timezone to ensure uniqueness
            cron_schedule = session.exec(
                select(CrontabSchedule).where(
                    CrontabSchedule.minute == minute,
                    CrontabSchedule.hour == hour,
                    CrontabSchedule.day_of_week == day_week,
                    CrontabSchedule.day_of_month == day_month,
                    CrontabSchedule.month_of_year == month_year,
                    CrontabSchedule.timezone == schedule_timezone # Ensure timezone match
                )
            ).first()

            if not cron_schedule:
                 logger.debug(f"Crontab schedule '{schedule_str}' not found, creating new.")
                 cron_schedule = CrontabSchedule(
                     minute=minute,
                     hour=hour,
                     day_of_week=day_week,
                     day_of_month=day_month,
                     month_of_year=month_year,
                     timezone=schedule_timezone
                 )
                 session.add(cron_schedule)
                 session.flush() # Get the ID for the periodic task
                 logger.debug(f"Created new CrontabSchedule with ID: {cron_schedule.id}")

            # Find existing PeriodicTask or create new
            periodic_task = session.exec(select(PeriodicTask).where(PeriodicTask.name == task_name)).first()
            
            task_to_run = 'app.tasks.scheduling.check_recurring_tasks' # Master scheduler task
            
            if periodic_task:
                logger.debug(f"Updating existing periodic task '{task_name}' (ID: {periodic_task.id})")
                periodic_task.crontab_id = cron_schedule.id
                periodic_task.interval_id = None # Ensure interval is cleared
                periodic_task.enabled = is_enabled
                periodic_task.task = task_to_run # Ensure correct task name
                # Update other fields if necessary (e.g., args, kwargs, queue)
            else:
                logger.debug(f"Creating new periodic task '{task_name}'")
                periodic_task = PeriodicTask(
                    name=task_name,
                    task=task_to_run,
                    crontab_id=cron_schedule.id,
                    enabled=is_enabled,
                    # Set default args/kwargs/etc. if needed
                    # args='[]', 
                    # kwargs='{}',
                )
                session.add(periodic_task)

            session.commit()
            logger.info(f"Beat schedule for '{task_name}' (PeriodicTask ID: {periodic_task.id}) set to '{schedule_str}' (enabled={is_enabled}).")

        except Exception as e:
            session.rollback()
            logger.error(f"Failed to add/update Celery Beat schedule for '{task_name}': {e}", exc_info=True)
            raise # Re-raise the exception to be caught by API layer
        # Session is automatically closed by context manager

def remove_schedule(recurring_task_id: int):
    """Removes a Celery Beat schedule entry for a RecurringTask."""
    task_name = _generate_task_name(recurring_task_id)
    with _get_beat_session() as session:
        try:
            logger.info(f"Removing Beat schedule for task {recurring_task_id} ('{task_name}')")
            periodic_task = session.exec(select(PeriodicTask).where(PeriodicTask.name == task_name)).first()
            
            if periodic_task:
                pt_id = periodic_task.id
                # Store cron_id before deleting the task
                cron_id_to_check = periodic_task.crontab_id
                
                session.delete(periodic_task)
                session.flush() # Ensure deletion happens before checking usage
                logger.debug(f"Deleted PeriodicTask {pt_id} ('{task_name}').")
                
                # Optionally delete the CrontabSchedule if it's not shared
                if cron_id_to_check:
                    # Check if any *other* tasks use this crontab
                    usage_count = session.exec(
                        select(func.count(PeriodicTask.id)).where(PeriodicTask.crontab_id == cron_id_to_check)
                    ).scalar_one_or_none() or 0
                    
                    if usage_count == 0:
                        logger.debug(f"CrontabSchedule {cron_id_to_check} is no longer used. Deleting.")
                        cron_schedule = session.get(CrontabSchedule, cron_id_to_check)
                        if cron_schedule:
                            session.delete(cron_schedule)
                    else:
                        logger.debug(f"CrontabSchedule {cron_id_to_check} is still used by {usage_count} other tasks. Keeping.")
                        
                session.commit()
                logger.info(f"Successfully removed Beat schedule for '{task_name}'.")
            else:
                 logger.warning(f"Beat schedule for '{task_name}' not found, cannot remove.")
        except Exception as e:
            session.rollback()
            logger.error(f"Failed to remove Celery Beat schedule for '{task_name}': {e}", exc_info=True)
            raise # Re-raise the exception
        # Session automatically closed 