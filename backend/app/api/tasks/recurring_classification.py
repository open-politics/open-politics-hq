# backend/app/tasks/recurring_classification.py
import logging
import time
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone, timedelta

from celery import shared_task
from sqlmodel import Session, select, func

from app.core.db import engine
from app.models import (
    RecurringTask,
    RecurringTaskType,
    RecurringTaskStatus,
    DataSource,
    DataRecord,
    ClassificationJob,
    ClassificationJobCreate, # Needed to create a new job
    ClassificationJobStatus
)
# Remove direct import of task function
# from app.api.tasks.classification import process_classification_job
from app.core.celery_app import celery # Import celery app instance
# Import the status update helper from the utils module
from app.api.tasks.utils import update_task_status
# Import services and providers directly
from app.api.services.classification import ClassificationService
from app.api.services.recurring_tasks import RecurringTaskService # Keep this?
# Import provider factory
from app.api.deps import get_classification_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=1)
def process_recurring_classify(self, recurring_task_id: int):
    """
    Processes a recurring classification task: determines target records,
    creates a new ClassificationJob using ClassificationService, and triggers its execution.
    """
    logging.info(f"Starting recurring classification task for RecurringTask ID: {recurring_task_id}")
    start_time = time.time()
    final_status = "success" # Status of *this* triggering task
    error_message = None
    new_job_id = None

    # Use a session for fetching the recurring task and potentially updating last_job_id
    with Session(engine) as session:
        # Instantiate provider and services inside the session scope
        classification_provider = get_classification_provider()
        classification_service = ClassificationService(
            session=session,
            classification_provider=classification_provider
        )
        # RecurringTaskService might not be strictly needed if we fetch the task directly
        # recurring_task_service = RecurringTaskService(session=session)

        try:
            # 1. Fetch and validate the RecurringTask
            # Fetch directly for now, service might need adjustment
            task = session.get(RecurringTask, recurring_task_id)
            if not task:
                raise ValueError(f"RecurringTask {recurring_task_id} not found.")
            # Re-validate using fetched task data
            if task.type != RecurringTaskType.CLASSIFY:
                raise ValueError(f"Task {recurring_task_id} is not a CLASSIFY task (type: {task.type}).")
            if task.status != RecurringTaskStatus.ACTIVE:
                 logging.warning(f"Task {recurring_task_id} is not ACTIVE (status: {task.status}). Skipping execution.")
                 return

            # 2. Get configuration from the fetched task
            config = task.configuration or {}
            target_datasource_ids = config.get('target_datasource_ids', [])
            target_scheme_ids = config.get('target_scheme_ids', [])
            process_only_new = config.get('process_only_new', True)
            job_name_template = config.get('job_name_template', "Auto-Classify: {task_name} - {timestamp}")

            if not target_datasource_ids or not isinstance(target_datasource_ids, list):
                raise ValueError("Missing or invalid 'target_datasource_ids' list in configuration.")
            if not target_scheme_ids or not isinstance(target_scheme_ids, list):
                raise ValueError("Missing or invalid 'target_scheme_ids' list in configuration.")

            # 3. Determine if records need processing (keep direct query for now)
            record_statement = select(DataRecord.id).where(DataRecord.datasource_id.in_(target_datasource_ids))
            if process_only_new:
                cutoff_time = task.last_successful_run_at
                if cutoff_time:
                     if cutoff_time.tzinfo is None: cutoff_time = cutoff_time.replace(tzinfo=timezone.utc)
                     record_statement = record_statement.where(DataRecord.created_at > cutoff_time)
                     logger.info(f"Task {recurring_task_id}: Processing records created after {cutoff_time}")
                else:
                     logger.info(f"Task {recurring_task_id}: Processing all records.")

            count_statement = select(func.count()).select_from(record_statement.subquery())
            records_to_process_count = session.exec(count_statement).one()

            if records_to_process_count == 0:
                logger.info(f"No new records found for task {recurring_task_id}. Skipping job creation.")
                final_status = "success"
                error_message = "No new records to process."
                # Update status directly here using the utility function (handles its own session)
                update_task_status(recurring_task_id, final_status, error_message)
                return

            logger.info(f"Task {recurring_task_id}: Found {records_to_process_count} records to potentially classify.")

            # 4. Prepare ClassificationJob data
            timestamp_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            job_name = job_name_template.format(task_name=task.name, timestamp=timestamp_str)
            
            # --- ADDED: Get provider/model from recurring task config --- 
            recurring_task_config = task.configuration or {}
            provider_from_task = recurring_task_config.get('llm_provider') # Optional
            model_from_task = recurring_task_config.get('llm_model')       # Optional
            # Optionally get API key from recurring task config if stored there - requires secure handling
            # api_key_from_task = recurring_task_config.get('api_key') 
            # --- END ADDED ---
            
            job_config = {
                "datasource_ids": target_datasource_ids,
                "scheme_ids": target_scheme_ids,
                "recurring_task_id": recurring_task_id,
                # --- ADDED: Include provider/model in job config --- 
                # Pass them along so the classification task uses the correct ones.
                # If None, the classification task's provider factory will use defaults.
                "llm_provider": provider_from_task, 
                "llm_model": model_from_task,
                # "api_key": api_key_from_task # Include if handling API keys this way
                # --- END ADDED ---
            }
            job_create_data = ClassificationJobCreate(
                name=job_name,
                description=f"Automated run by Task '{task.name}' ({recurring_task_id})",
                configuration=job_config
            )

            # 5. Create ClassificationJob instance using the service
            # The service handles validation and commits the new job.
            new_job = classification_service.create_job(
                workspace_id=task.workspace_id,
                user_id=task.user_id,
                job_data=job_create_data
            )
            new_job_id = new_job.id
            logger.info(f"Created new ClassificationJob {new_job_id} via service for Task {recurring_task_id}.")

            # 6. Update RecurringTask with the new Job ID (Direct update for now)
            task.last_job_id = new_job_id
            session.add(task)
            session.commit() # Commit just the last_job_id update

            # 7. Trigger the actual classification job worker using send_task
            celery.send_task("app.api.tasks.classification.process_classification_job", args=[new_job_id])
            logger.info(f"Dispatched process_classification_job for Job ID: {new_job_id}")

            error_message = f"Successfully triggered ClassificationJob ID: {new_job_id}"

        except Exception as e:
             session.rollback() # Rollback potential last_job_id update if trigger failed
             logger.exception(f"Critical error during recurring classification task {recurring_task_id}: {e}")
             final_status = "error"
             error_message = f"Triggering Error: {str(e)}"
             # Retry logic
             try:
                 retry_countdown = 60 * (self.request.retries + 1)
                 self.retry(exc=e, countdown=retry_countdown)
                 logging.warning(f"Retrying task {recurring_task_id} due to error: {e}")
             except self.MaxRetriesExceededError:
                 logging.error(f"Max retries exceeded for task {recurring_task_id}. Will be marked as ERROR.")

        finally:
            # Update task status using utility (handles its own session)
            final_message = error_message
            if final_status == "success" and not error_message:
                 final_message = f"Successfully triggered job {new_job_id if new_job_id else '(no job created)'}."
            elif final_status == "error" and not error_message:
                final_message = "Recurring task trigger encountered an unspecified error."
            
            update_task_status(recurring_task_id, final_status, final_message)

            end_time = time.time()
            logging.info(f"Recurring classification task {recurring_task_id} triggering process time: {end_time - start_time:.2f} seconds.") 