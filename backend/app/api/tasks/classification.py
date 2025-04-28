import logging
import time
from typing import List, Dict, Any

from sqlalchemy.orm import selectinload # Use selectinload for relationships
from sqlmodel import Session as SQLModelSession # Alias to avoid confusion with local 'session' variable
from sqlmodel import select

from app.core.celery_app import celery
from app.core.db import engine # Import engine for creating a new session
from app.models import (
    ClassificationJob,
    ClassificationJobStatus,
    DataRecord,
    ClassificationScheme,
    ClassificationResult,
    ClassificationResultCreate,
    RecurringTask # Import RecurringTask model
)
# Import the status update helper function from the new utils module
from app.api.tasks.utils import update_task_status
# Import Classification Service and provider factory directly
from app.api.services.classification import ClassificationService
# from app.api.services.providers.classification import OpolClassificationProvider # Keep if using directly
from app.api.deps import get_classification_provider

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@celery.task(bind=True, max_retries=3)
def process_classification_job(self, job_id: int):
    """
    Background task to run a ClassificationJob using ClassificationService.
    Fetches DataRecords and Schemes, runs classification, stores Results.
    Manages the database transaction for the job processing.
    """
    logging.info(f"Starting classification task for Job ID: {job_id}")
    start_time = time.time()
    error_count = 0
    success_count = 0
    final_status = ClassificationJobStatus.COMPLETED # Assume success initially
    job = None # Initialize job variable outside try block

    # Task manages the session
    with SQLModelSession(engine) as session:
        # Instantiate provider using factory and service with session/provider
        provider = get_classification_provider()
        service = ClassificationService(session=session, classification_provider=provider)

        try:
            # 1. Fetch the Job and check status using the service
            # Service's get_job doesn't check status, so we check after fetching
            job = service.get_job(job_id)
            if not job:
                logging.error(f"ClassificationJob {job_id} not found. Aborting task.")
                return
            if job.status != ClassificationJobStatus.PENDING:
                logging.warning(f"ClassificationJob {job_id} is not PENDING (status: {job.status}). Skipping task.")
                return

            # 2. Update status to RUNNING using the service (DO NOT COMMIT)
            # service.update_job_status(job_id, ClassificationJobStatus.RUNNING)
            # PASS Job OBJECT instead of ID
            job = service.update_job_status(job, ClassificationJobStatus.RUNNING)
            # --- FIX: Commit the status update immediately ---
            session.commit()
            logging.info(f"Committed RUNNING status for Job {job_id}")
            # --- FIX: Refresh job object AFTER commit to get updated status ---
            session.refresh(job)
            # --- END FIX ---

            # 3. Load Configuration
            config = job.configuration or {}
            datasource_ids = config.get('datasource_ids', [])
            scheme_ids = config.get('scheme_ids', [])
            api_key = config.get('api_key') # Get API key from job config

            if not datasource_ids or not scheme_ids:
                 # Mark as failed immediately if config is invalid
                 # Use service to update status (method will commit failure)
                 service.update_job_status(job, ClassificationJobStatus.FAILED, error_message="Job configuration missing datasource_ids or scheme_ids")
                 raise ValueError("Job configuration missing datasource_ids or scheme_ids")

            # 4. Fetch Target DataRecords (Keep direct query for now)
            datarecord_stmt = select(DataRecord).where(DataRecord.datasource_id.in_(datasource_ids))
            data_records = session.exec(datarecord_stmt).all()
            if not data_records:
                 logging.warning(f"No DataRecords found for Job {job_id}. Marking as complete.")
                 final_status = ClassificationJobStatus.COMPLETED
                 # Update final status using service (method will commit)
                 service.update_job_status(job, final_status)
                 # Need to handle recurring task update in finally block even in this case
                 return
            logging.info(f"Found {len(data_records)} DataRecords to classify for Job {job_id}.")

            # 5. Fetch Target ClassificationSchemes (Keep direct query for now)
            scheme_stmt = select(ClassificationScheme).where(ClassificationScheme.id.in_(scheme_ids)).options(selectinload(ClassificationScheme.fields))
            schemes = session.exec(scheme_stmt).all()
            if len(schemes) != len(scheme_ids):
                 error_msg = f"Could not find all specified ClassificationSchemes: {scheme_ids}"
                 service.update_job_status(job, ClassificationJobStatus.FAILED, error_message=error_msg)
                 raise ValueError(error_msg)
            logging.info(f"Loaded {len(schemes)} ClassificationSchemes for Job {job_id}.")
            
            # 6. Iterate and Classify
            results_batch_data = [] # Store dicts
            batch_size = 100
            total_classifications = len(data_records) * len(schemes)
            processed_classifications = 0
            
            for record in data_records:
                for scheme in schemes:
                    processed_classifications += 1
                    logging.debug(f"Classifying Record {record.id} with Scheme {scheme.id} ({processed_classifications}/{total_classifications}) for Job {job_id}")
                    try:
                        # Optional: Check for existing result via direct query or a potential service method
                        existing_result_check = session.exec(select(ClassificationResult.id).where(
                            ClassificationResult.job_id == job_id,
                            ClassificationResult.datarecord_id == record.id,
                            ClassificationResult.scheme_id == scheme.id
                        )).first()
                        if existing_result_check:
                            logging.debug(f"Skipping existing result for Record {record.id}, Scheme {scheme.id}")
                            success_count += 1
                            continue
                        
                        # --- Call Core Classification Logic via Service --- 
                        classification_value = service.classify_text(
                            text=record.text_content, 
                            scheme_id=scheme.id,
                            api_key=api_key
                        )
                        # --- End Core Classification Logic --- 
                        
                        # Add result data dict to batch
                        results_batch_data.append({
                            "job_id": job_id,
                            "datarecord_id": record.id,
                            "scheme_id": scheme.id,
                            "value": classification_value
                        })
                        success_count += 1

                        # Write batch to DB periodically using service (DO NOT COMMIT)
                        if len(results_batch_data) >= batch_size:
                            # Pass job_id to the service method
                            service.create_results_batch(job_id=job_id, results_data=results_batch_data)
                            results_batch_data = [] # Reset batch
                    
                    except Exception as classify_error:
                        logging.error(f"Classification failed for Record {record.id}, Scheme {scheme.id}, Job {job_id}: {classify_error}")
                        error_count += 1
                        final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
                        # Optionally store error details in result?
                        # results_batch_data.append({... "value": {"error": str(classify_error)} ...})

            # 7. Create final batch of results using service (DO NOT COMMIT)
            if results_batch_data:
                # Pass job_id to the service method
                service.create_results_batch(job_id=job_id, results_data=results_batch_data)
            
            # 8. Update final job status using service (DO NOT COMMIT)
            final_job_message = f"Classification finished. Success: {success_count}, Errors: {error_count}"
            if error_count > 0:
                 final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
            else:
                 final_status = ClassificationJobStatus.COMPLETED
            # service.update_job_status(job_id, final_status, error_message=final_job_message if error_count > 0 else None)
            # PASS Job OBJECT instead of ID
            job = service.update_job_status(job, final_status, error_message=final_job_message if error_count > 0 else None)
            
            # 9. Commit the entire transaction for this job run
            session.commit()
            logging.info(f"Committed final state for Job {job_id}. Status: {final_status}. Message: {final_job_message}")
            # Refresh job state if needed after commit for finally block?
            session.refresh(job) 

        except Exception as e:
            session.rollback() # Rollback the main transaction on critical error
            logging.exception(f"Critical error during classification task for Job {job_id}: {e}")
            final_status = ClassificationJobStatus.FAILED
            final_job_message = str(e)
            # Update status to FAILED using service in a separate session (which commits)
            try:
                with SQLModelSession(engine) as error_session:
                    error_provider = get_classification_provider()
                    error_service = ClassificationService(session=error_session, classification_provider=error_provider)
                    # Fetch job again in separate session before passing to update_job_status
                    job_to_fail = error_session.get(ClassificationJob, job_id)
                    if job_to_fail:
                        error_service.update_job_status(job_to_fail, ClassificationJobStatus.FAILED, error_message=final_job_message)
                        logging.info(f"Job {job_id} status updated to FAILED.")
                    else:
                        logging.error(f"Could not find job {job_id} to mark as FAILED.")
                logging.info(f"Job {job_id} status updated to FAILED.")
            except Exception as final_status_err:
                logging.error(f"CRITICAL: Failed to update Job {job_id} status to FAILED after error: {final_status_err}")

            # Retry logic
            try:
                self.retry(exc=e, countdown=60 * (self.request.retries + 1))
                logging.warning(f"Retrying task for Job {job_id} due to error: {e}")
            except self.MaxRetriesExceededError:
                logging.error(f"Max retries exceeded for Job {job_id}. Remains FAILED.")
                # Status is already set to FAILED

        finally:
            # Update RecurringTask status only if the job finished (or failed after retries)
            is_final_attempt = True
            if final_status == ClassificationJobStatus.FAILED:
                try:
                    if self.request.retries < self.max_retries: is_final_attempt = False
                except AttributeError: pass 

            if job and is_final_attempt: 
                recurring_task_id = job.configuration.get('recurring_task_id')
                if recurring_task_id and isinstance(recurring_task_id, int):
                    logging.info(f"Updating originating RecurringTask {recurring_task_id} based on final Job {job_id} status: {job.status}")
                    # Use job status AFTER potential commit/refresh or final FAILED update
                    final_job_status = job.status if job else final_status # Get latest known status
                    recurring_task_status = "success" if final_job_status == ClassificationJobStatus.COMPLETED else "error"
                    recurring_task_message = job.error_message if job and job.error_message else f"Job {job_id} finished with status {final_job_status}."
                    
                    try:
                        # Use utility function which handles its own session
                        update_task_status(recurring_task_id, recurring_task_status, recurring_task_message)
                        logging.info(f"Successfully updated status for RecurringTask {recurring_task_id}.")
                    except Exception as update_err:
                        logging.error(f"Failed to update status for RecurringTask {recurring_task_id}: {update_err}", exc_info=True)
                else:
                    logging.debug(f"Job {job_id} not linked to a recurring task. Skipping update.")
            
            end_time = time.time()
            logging.info(f"Classification task finished for Job {job_id} in {end_time - start_time:.2f} seconds.")

# Example of how to potentially call the task
# Needs integration via API route
# if __name__ == "__main__":
#     test_job_id = 1 # Assuming a Job with ID 1 exists and is PENDING
#     print(f"Manually triggering task for Job ID: {test_job_id}")
#     process_classification_job(test_job_id) 