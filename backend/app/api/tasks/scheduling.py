import logging
from datetime import datetime, timezone

from celery import shared_task
from croniter import croniter
from sqlmodel import Session, select

from app.core.db import engine
from app.models import RecurringTask, RecurringTaskStatus, RecurringTaskType
# Remove direct task imports
# from app.api.tasks.recurring_ingestion import process_recurring_ingest
# from app.api.tasks.recurring_classification import process_recurring_classify
from app.core.celery_app import celery # Ensure celery instance is imported

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@shared_task(name="app.api.tasks.scheduling.check_recurring_tasks")
def check_recurring_tasks():
    """
    Checks for active recurring tasks that are due to run and dispatches them.
    Executed periodically by Celery Beat.
    """
    logger.info("Checking for due recurring tasks...")
    now = datetime.now(timezone.utc)
    dispatched_count = 0

    with Session(engine) as session:
        try:
            # Select active tasks
            statement = select(RecurringTask).where(RecurringTask.status == RecurringTaskStatus.ACTIVE)
            active_tasks = session.exec(statement).all()

            logger.debug(f"Found {len(active_tasks)} active tasks.")

            for task in active_tasks:
                try:
                    # Use croniter to check if the task is due based on its schedule
                    # Base the check on the last run time, or creation time if never run
                    base_time = task.last_run_at if task.last_run_at else task.created_at
                    # Ensure base_time is timezone-aware (should be due to model defaults)
                    if base_time.tzinfo is None:
                       base_time = base_time.replace(tzinfo=timezone.utc)

                    # Check if schedule is valid cron format before creating iterator
                    if not croniter.is_valid(task.schedule):
                        logger.error(f"Invalid cron schedule '{task.schedule}' for task {task.id}. Skipping.")
                        # Optionally update task status to ERROR here
                        continue

                    cron = croniter(task.schedule, base_time)
                    next_run_time = cron.get_next(datetime)

                    if next_run_time <= now:
                        logger.info(f"Task {task.id} ('{task.name}') is due. Dispatching...")

                        # Dispatch the appropriate worker task based on type
                        if task.type == RecurringTaskType.INGEST:
                            # Use send_task with task name string
                            celery.send_task("app.api.tasks.recurring_ingestion.process_recurring_ingest", args=[task.id])
                            # logger.info(f"Dispatching INGEST task for {task.id} (Placeholder)")
                            # pass # Placeholder for actual dispatch
                        elif task.type == RecurringTaskType.CLASSIFY:
                            # Use send_task with task name string
                            celery.send_task("app.api.tasks.recurring_classification.process_recurring_classify", args=[task.id])
                            # logger.info(f"Dispatching CLASSIFY task for {task.id} (Placeholder)")
                            # pass # Placeholder for actual dispatch
                        else:
                            logger.warning(f"Unknown task type '{task.type}' for task {task.id}. Skipping.")
                            continue # Skip unknown types

                        # Update last_run_at immediately to prevent re-triggering in the same minute
                        # The worker task will update status/message upon completion/failure
                        task.last_run_at = now
                        session.add(task)
                        session.commit() # Commit the last_run_at update
                        dispatched_count += 1
                    else:
                         logger.debug(f"Task {task.id} not due yet (next run: {next_run_time}).")

                except Exception as task_dispatch_err:
                    logger.error(f"Error processing or dispatching task {task.id}: {task_dispatch_err}", exc_info=True)
                    # Consider updating task status to ERROR here

            logger.info(f"Finished checking recurring tasks. Dispatched {dispatched_count} tasks.")

        except Exception as e:
            logger.exception(f"Critical error during check_recurring_tasks: {e}") 