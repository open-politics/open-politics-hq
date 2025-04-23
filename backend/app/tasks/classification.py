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
from app.tasks.utils import update_task_status
# TODO: Import the actual classification function after refactoring
# from app.api.v2.classification import classify_data_record_text
# Import the refactored helper function
from app.api.v2.classification import classify_text

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)
# Helper function to update Job status
def update_job_status(session: SQLModelSession, job_id: int, status: ClassificationJobStatus, error_message: str | None = None):
    try:
        job = session.get(ClassificationJob, job_id)
        if job:
            job.status = status
            job.error_message = error_message
            session.add(job)
            session.commit()
            session.refresh(job)
            logging.info(f"ClassificationJob {job_id} status updated to {status}")
        else:
            logging.error(f"ClassificationJob {job_id} not found during status update.")
    except Exception as e:
        session.rollback()
        logging.error(f"Error updating status for ClassificationJob {job_id}: {e}")

# Helper function to create ClassificationResults in batch
def create_results_batch(session: SQLModelSession, results_data: List[Dict[str, Any]]):
    # Check for duplicates based on the unique constraint (datarecord_id, scheme_id, job_id)
    # This prevents errors if the task is retried and tries to insert the same result again.
    existing_keys = set()
    if results_data:
        job_id = results_data[0]['job_id'] # All results in batch share the same job_id
        record_ids = list({r['datarecord_id'] for r in results_data})
        scheme_ids = list({r['scheme_id'] for r in results_data})
        
        existing_stmt = select(ClassificationResult.datarecord_id, ClassificationResult.scheme_id).where(
            ClassificationResult.job_id == job_id,
            ClassificationResult.datarecord_id.in_(record_ids),
            ClassificationResult.scheme_id.in_(scheme_ids)
        )
        existing_results = session.exec(existing_stmt).all()
        existing_keys = {(res[0], res[1]) for res in existing_results}

    results_to_create = []
    skipped_count = 0
    for data in results_data:
        key = (data['datarecord_id'], data['scheme_id'])
        if key not in existing_keys:
            results_to_create.append(ClassificationResult(**data))
        else:
            skipped_count += 1
            
    if skipped_count > 0:
        logging.warning(f"Skipped {skipped_count} existing results during batch creation for job {job_id}.")

    if not results_to_create:
        logging.info(f"No new results to create in this batch for job {job_id}.")
        return 0 # Return number of created results

    try:
        session.add_all(results_to_create)
        session.commit()
        # No need to refresh individual results usually
        logging.info(f"Successfully created batch of {len(results_to_create)} ClassificationResults for job {job_id}.")
        return len(results_to_create)
    except Exception as e:
        session.rollback()
        logging.error(f"Error creating batch of ClassificationResults for job {job_id}: {e}")
        raise # Re-raise the exception


@celery.task(bind=True, max_retries=3)
def process_classification_job(self, job_id: int):
    """
    Background task to run a ClassificationJob.
    Fetches DataRecords and Schemes, runs classification, stores Results.
    """
    logging.info(f"Starting classification task for Job ID: {job_id}")
    start_time = time.time()
    error_count = 0
    success_count = 0
    final_status = ClassificationJobStatus.COMPLETED # Assume success initially
    job = None # Initialize job variable outside try block

    with SQLModelSession(engine) as session: # Use the alias here for clarity
        try:
            # 1. Fetch the Job and check status
            job = session.get(ClassificationJob, job_id) # Assign to outer scope variable
            if not job:
                logging.error(f"ClassificationJob {job_id} not found. Aborting task.")
                return
            if job.status != ClassificationJobStatus.PENDING:
                logging.warning(f"ClassificationJob {job_id} is not PENDING (status: {job.status}). Skipping task.")
                return

            # 2. Update status to RUNNING
            update_job_status(session, job_id, ClassificationJobStatus.RUNNING)
            session.refresh(job) # Refresh job to get the updated status if needed elsewhere

            # 3. Load Configuration
            config = job.configuration or {}
            datasource_ids = config.get('datasource_ids', [])
            scheme_ids = config.get('scheme_ids', [])
            # TODO: Load LLM provider/model/API key from config if needed
            # api_key = config.get('api_key') # Needs secure handling
            api_key = None # Placeholder - Get API key securely if required

            if not datasource_ids or not scheme_ids:
                 raise ValueError("Job configuration missing datasource_ids or scheme_ids")

            # 4. Fetch Target DataRecords
            # Use selectinload for efficiency if accessing datasource details later
            datarecord_stmt = select(DataRecord).where(
                DataRecord.datasource_id.in_(datasource_ids)
            ).options(selectinload(DataRecord.datasource))
            
            # TODO: Consider streaming results for very large jobs
            data_records = session.exec(datarecord_stmt).all()
            if not data_records:
                 logging.warning(f"No DataRecords found for target DataSources {datasource_ids} in Job {job_id}. Marking as complete.")
                 final_status = ClassificationJobStatus.COMPLETED # Set final status before update
                 update_job_status(session, job_id, final_status)
                 return
            
            logging.info(f"Found {len(data_records)} DataRecords to classify for Job {job_id}.")

            # 5. Fetch Target ClassificationSchemes (with fields)
            scheme_stmt = select(ClassificationScheme).where(
                ClassificationScheme.id.in_(scheme_ids)
            ).options(selectinload(ClassificationScheme.fields))
            schemes = session.exec(scheme_stmt).all()
            if len(schemes) != len(scheme_ids):
                 # Update status before raising error
                 update_job_status(session, job_id, ClassificationJobStatus.FAILED, error_message=f"Could not find all specified ClassificationSchemes: {scheme_ids}")
                 raise ValueError(f"Could not find all specified ClassificationSchemes: {scheme_ids}")
            
            logging.info(f"Loaded {len(schemes)} ClassificationSchemes for Job {job_id}.")
            
            # 6. Iterate and Classify
            results_batch = []
            batch_size = 100 # Batch size for DB insertion
            total_classifications = len(data_records) * len(schemes)
            processed_classifications = 0
            
            for record in data_records:
                for scheme in schemes:
                    processed_classifications += 1
                    logging.debug(f"Classifying Record {record.id} with Scheme {scheme.id} ({processed_classifications}/{total_classifications}) for Job {job_id}")
                    try:
                        # Check if result already exists (e.g., from a previous failed run/retry)
                        # This is also handled by create_results_batch, but checking early might save API calls
                        existing_result_check = session.exec(select(ClassificationResult.id).where(
                            ClassificationResult.job_id == job_id,
                            ClassificationResult.datarecord_id == record.id,
                            ClassificationResult.scheme_id == scheme.id
                        )).first()
                        
                        if existing_result_check:
                            logging.debug(f"Skipping existing result for Record {record.id}, Scheme {scheme.id}")
                            success_count += 1 # Count existing as success for progress tracking
                            continue
                        
                        # --- Call Core Classification Logic --- 
                        # TODO: Replace placeholder with actual call after refactoring v2/classification.py
                        # classification_value = classify_data_record_text(record.text_content, scheme)
                        # Placeholder logic:
                        # time.sleep(0.05) # Simulate work
                        # if "fail" in record.text_content.lower() and scheme.id % 2 != 0: # Simulate some failures
                        #     raise ValueError("Simulated classification failure")
                        # classification_value = {"placeholder_result": f"Result for record {record.id} / scheme {scheme.id}", "text_length": len(record.text_content)}
                        
                        # Call the refactored classification function
                        classification_value = classify_text(
                            text=record.text_content, 
                            scheme_id=scheme.id, 
                            api_key=api_key # Pass API key if needed
                        )
                        # --- End Core Classification Logic --- 
                        
                        # Add result to batch
                        results_batch.append({
                            "job_id": job_id,
                            "datarecord_id": record.id,
                            "scheme_id": scheme.id,
                            "value": classification_value
                            # timestamp is handled by default in the model
                        })
                        success_count += 1

                        # Write batch to DB periodically
                        if len(results_batch) >= batch_size:
                            create_results_batch(session, results_batch)
                            results_batch = [] # Reset batch
                    
                    except Exception as classify_error:
                        logging.error(f"Classification failed for Record {record.id}, Scheme {scheme.id}, Job {job_id}: {classify_error}")
                        error_count += 1
                        final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
                        # Optional: Store individual errors? Maybe in ClassificationResult.value itself?
                        # results_batch.append({ ... "value": {"error": str(classify_error)} ... })
                        # For now, just count errors and mark job status.

            # 7. Create final batch of results
            if results_batch:
                create_results_batch(session, results_batch)
            
            # 8. Update final job status (within the main try block)
            final_job_message = f"Classification finished. Success: {success_count}, Errors: {error_count}"
            if error_count > 0:
                 final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
            else:
                 final_status = ClassificationJobStatus.COMPLETED
            
            logging.info(f"Classification for Job {job_id} finished. Status: {final_status}. Message: {final_job_message}")
            # Pass the message to the job update
            update_job_status(session, job_id, final_status, error_message=final_job_message if error_count > 0 else None)
            session.refresh(job) # Refresh job state after final status update

        except Exception as e:
            logging.exception(f"Critical error during classification task for Job {job_id}: {e}")
            final_status = ClassificationJobStatus.FAILED
            final_job_message = str(e) # Capture the critical error message
            if job_id:
                 update_job_status(session, job_id, ClassificationJobStatus.FAILED, error_message=final_job_message)
                 if job: session.refresh(job)
            try:
                self.retry(exc=e, countdown=60 * (self.request.retries + 1))
                logging.warning(f"Retrying task for Job {job_id} due to error: {e}")
            except self.MaxRetriesExceededError:
                logging.error(f"Max retries exceeded for Job {job_id}. Marking as FAILED.")
                # Status already set to FAILED, job status updated in DB

        finally:
            # This block executes after try/except, even if retries are scheduled
            # We only want to update the RecurringTask if the job has definitively finished (succeeded, failed after retries, or completed with errors)
            # If self.request.retries < self.max_retries and final_status == ClassificationJobStatus.FAILED, it means a retry might happen.
            
            is_final_attempt = True # Assume final unless a retry is pending
            if final_status == ClassificationJobStatus.FAILED:
                try:
                    # Check if we are within retry limits
                    if self.request.retries < self.max_retries:
                         is_final_attempt = False
                         logging.info(f"Job {job_id} failed but retry is pending. Skipping RecurringTask status update.")
                except AttributeError: # Might happen if task isn't bound correctly in some test scenarios
                    pass 

            # Update RecurringTask status only if the job is truly finished
            if job and is_final_attempt: # Check if job object exists and it's the final attempt
                recurring_task_id = job.configuration.get('recurring_task_id')
                if recurring_task_id and isinstance(recurring_task_id, int):
                    logging.info(f"Updating originating RecurringTask {recurring_task_id} based on final Job {job_id} status: {job.status}")
                    # Map Job status to RecurringTask status ('success' or 'error')
                    recurring_task_status = "success" if job.status == ClassificationJobStatus.COMPLETED else "error"
                    # Use the job's final error/completion message
                    recurring_task_message = job.error_message or f"Job {job_id} finished with status {job.status}."
                    
                    # Use a new session for safety in the finally block
                    try:
                        with SQLModelSession(engine) as final_session:
                             # update_task_status handles fetching the task and committing
                             update_task_status(final_session, recurring_task_id, recurring_task_status, recurring_task_message)
                             logging.info(f"Successfully updated status for RecurringTask {recurring_task_id}.")
                    except Exception as update_err:
                         logging.error(f"Failed to update status for RecurringTask {recurring_task_id} from Job {job_id}: {update_err}", exc_info=True)
                else:
                    logging.debug(f"Job {job_id} was not triggered by a recurring task or ID is missing/invalid. Skipping RecurringTask status update.")
            
            end_time = time.time()
            logging.info(f"Classification task processing finished for Job {job_id} in {end_time - start_time:.2f} seconds.")

# Example of how to potentially call the task
# Needs integration via API route
# if __name__ == "__main__":
#     test_job_id = 1 # Assuming a Job with ID 1 exists and is PENDING
#     print(f"Manually triggering task for Job ID: {test_job_id}")
#     process_classification_job(test_job_id) 