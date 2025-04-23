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
# Import the actual classification job worker
from app.tasks.classification import process_classification_job
# Import the status update helper from the utils module
from app.tasks.utils import update_task_status

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=1) # Limit retries for the trigger task
def process_recurring_classify(self, recurring_task_id: int):
    """
    Processes a recurring classification task: determines target records,
    creates a new ClassificationJob, and triggers its execution.
    """
    logging.info(f"Starting recurring classification task for RecurringTask ID: {recurring_task_id}")
    start_time = time.time()
    final_status = "success" # Status of *this* triggering task
    error_message = None
    new_job_id = None

    with Session(engine) as session:
        try:
            # 1. Fetch and validate the RecurringTask
            task = session.get(RecurringTask, recurring_task_id)
            if not task:
                raise ValueError(f"RecurringTask {recurring_task_id} not found.")
            if task.type != RecurringTaskType.CLASSIFY:
                raise ValueError(f"Task {recurring_task_id} is not a CLASSIFY task (type: {task.type}).")
            if task.status != RecurringTaskStatus.ACTIVE:
                 logging.warning(f"Task {recurring_task_id} is not ACTIVE (status: {task.status}). Skipping execution.")
                 return

            # 2. Get configuration
            config = task.configuration or {}
            target_datasource_ids = config.get('target_datasource_ids', [])
            target_scheme_ids = config.get('target_scheme_ids', [])
            process_only_new = config.get('process_only_new', True) # Default to only processing new
            job_name_template = config.get('job_name_template', "Auto-Classify: {task_name} - {timestamp}")

            if not target_datasource_ids or not isinstance(target_datasource_ids, list):
                raise ValueError("Missing or invalid 'target_datasource_ids' list in configuration.")
            if not target_scheme_ids or not isinstance(target_scheme_ids, list):
                raise ValueError("Missing or invalid 'target_scheme_ids' list in configuration.")

            # 3. Determine target DataRecords (Using last_successful_run_at)
            record_statement = select(DataRecord.id).where(DataRecord.datasource_id.in_(target_datasource_ids))

            if process_only_new:
                # Use last_successful_run_at as the cutoff.
                # Process all records if last_successful_run_at is null (first run or previous runs failed).
                cutoff_time = task.last_successful_run_at # Use the new field
                if cutoff_time:
                     if cutoff_time.tzinfo is None: # Ensure timezone aware
                         cutoff_time = cutoff_time.replace(tzinfo=timezone.utc)
                     record_statement = record_statement.where(DataRecord.created_at > cutoff_time)
                     logger.info(f"Task {recurring_task_id}: Processing records created after last successful run: {cutoff_time}")
                else:
                     logger.info(f"Task {recurring_task_id}: Processing all records (first run or no previous successful run).")


            # Check if any records match the criteria (just check count)
            count_statement = select(func.count()).select_from(record_statement.subquery())
            records_to_process_count = session.exec(count_statement).one()

            if records_to_process_count == 0:
                logger.info(f"No new records found since last successful run for task {recurring_task_id}. Skipping job creation.")
                final_status = "success"
                error_message = "No new records to process since last successful run."
                # Update status directly here and return
                update_task_status(session, recurring_task_id, final_status, error_message)
                return # Exit task successfully

            logger.info(f"Task {recurring_task_id}: Found {records_to_process_count} records potentially needing classification.")

            # 4. Create ClassificationJob instance
            timestamp_str = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")
            job_name = job_name_template.format(task_name=task.name, timestamp=timestamp_str)

            job_config = {
                "datasource_ids": target_datasource_ids,
                "scheme_ids": target_scheme_ids,
                # Add link back to the recurring task for traceability
                "recurring_task_id": recurring_task_id,
                # Add any other relevant LLM/classification params if needed
            }

            job_create_data = ClassificationJobCreate(
                name=job_name,
                description=f"Automated classification run triggered by Recurring Task '{task.name}' (ID: {recurring_task_id})",
                configuration=job_config
                # status will default to PENDING
            )

            new_job = ClassificationJob.model_validate(
                 job_create_data.model_dump(),
                 update={
                     "workspace_id": task.workspace_id,
                     "user_id": task.user_id, # Assign job to the user who created the recurring task
                     "status": ClassificationJobStatus.PENDING,
                     # Relationships target_datasources/schemes are not set here directly
                     # The IDs are in the configuration dict which process_classification_job uses
                 }
            )

            session.add(new_job)
            session.flush() # Flush to get the new_job.id
            new_job_id = new_job.id
            logger.info(f"Created new ClassificationJob {new_job_id} for RecurringTask {recurring_task_id}.")

            # 5. Update RecurringTask with the new Job ID
            task.last_job_id = new_job_id
            session.add(task)
            session.commit() # Commit the last_job_id update before triggering

            # 6. Trigger the actual classification job worker
            process_classification_job.delay(new_job_id)
            logger.info(f"Dispatched process_classification_job for Job ID: {new_job_id}")

            # This task's job is done (triggering), mark as success for now.
            # The actual result reporting happens in process_classification_job (needs modification)
            error_message = f"Successfully triggered ClassificationJob ID: {new_job_id}"


        except Exception as e:
             session.rollback()
             logger.exception(f"Critical error during recurring classification task {recurring_task_id}: {e}")
             final_status = "error"
             error_message = f"Triggering Error: {str(e)}"
             try:
                 retry_countdown = 60 * (self.request.retries + 1)
                 self.retry(exc=e, countdown=retry_countdown)
                 logging.warning(f"Retrying task {recurring_task_id} due to error: {e}")
             except self.MaxRetriesExceededError:
                 logging.error(f"Max retries exceeded for task {recurring_task_id}. Will be marked as ERROR.")
                 # Update status to ERROR in the finally block

        finally:
            # Update task status based on the outcome *of this triggering task*
            # The actual job outcome updates the recurring task status from within process_classification_job
            # This section updates the status of the *triggering* step itself.
            with Session(engine) as final_session:
                # Ensure final_message reflects the trigger status
                final_message = error_message
                if final_status == "success" and not error_message:
                     # Default success message if no specific one was set
                     final_message = f"Successfully triggered job {new_job_id if new_job_id else '(no job created)'}."
                elif final_status == "error" and not error_message:
                    final_message = "Recurring task trigger encountered an unspecified error."
                # Note: update_task_status now handles last_successful_run_at and consecutive_failure_count
                update_task_status(final_session, recurring_task_id, final_status, final_message)

            end_time = time.time()
            logging.info(f"Recurring classification task {recurring_task_id} triggering process time: {end_time - start_time:.2f} seconds.") 