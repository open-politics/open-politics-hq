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
    RecurringTask, 
    ClassificationResultStatus
)
# Import the status update helper function from the new utils module
from app.api.tasks.utils import update_task_status
# Import Classification Service and provider factory directly
from app.api.services.classification import ClassificationService
# --- ADDED: Import the core function for batch creation --- 
from app.api.services.classification import _core_create_results_batch 
# --- END ADDED ---
# from app.api.services.providers.classification import OpolClassificationProvider # Keep if using directly
from app.api.deps import get_classification_provider

logging.basicConfig(level=logging.debug, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@celery.task(bind=True, max_retries=3)
def process_classification_job(self, job_id: int):
    """
    Background task to run a ClassificationJob using ClassificationService.
    Fetches DataRecords and Schemes, runs classification, stores Results.
    Manages the database transaction for the job processing.
    """
    logging.debug(f"Starting classification task for Job ID: {job_id}")
    start_time = time.time()
    job = None # Initialize job variable

    with SQLModelSession(engine) as session:
        # --- Setup Provider and Service ---
        job_for_config = session.get(ClassificationJob, job_id)
        if not job_for_config: # Initial check
            logging.error(f"Job {job_id} not found. Aborting.")
            return
        if job_for_config.status != ClassificationJobStatus.PENDING:
             logging.warning(f"Job {job_id} is not PENDING (status: {job_for_config.status}). Skipping.")
             return

        config = job_for_config.configuration or {}
        provider_name = config.get('llm_provider')
        model_name = config.get('llm_model')
        api_key_from_config = config.get('api_key')

        provider = get_classification_provider(provider=provider_name, model_name=model_name, api_key=api_key_from_config)
        service = ClassificationService(session=session, classification_provider=provider)
        # --- End Setup ---

        # --- Set to RUNNING Robustly --- 
        try:
            # Use the already fetched job object
            job = service.update_job_status(job_for_config, ClassificationJobStatus.RUNNING)
            session.commit() # Commit RUNNING status immediately
            session.refresh(job) # Ensure job object reflects RUNNING status
            logging.debug(f"Job {job_id} status confirmed as RUNNING.")
        except Exception as status_err:
            session.rollback()
            logging.exception(f"Failed to set Job {job_id} to RUNNING status: {status_err}")
            # Attempt to mark as FAILED in a separate session
            try:
                 with SQLModelSession(engine) as error_session:
                    job_to_fail = error_session.get(ClassificationJob, job_id)
                    if job_to_fail and job_to_fail.status == ClassificationJobStatus.PENDING:
                        error_provider = get_classification_provider(provider=provider_name, model_name=model_name, api_key=api_key_from_config)
                        error_service = ClassificationService(session=error_session, classification_provider=error_provider)
                        error_service.update_job_status(job_to_fail, ClassificationJobStatus.FAILED, error_message=f"Failed to start: {status_err}")
                        error_session.commit()
            except Exception as fail_err:
                 logging.error(f"CRITICAL: Failed to mark Job {job_id} as FAILED after startup error: {fail_err}")
            # Re-raise the original error to trigger Celery retry if applicable
            raise status_err 
        # --- End Set to RUNNING --- 

        # --- Main Classification Logic --- 
        error_count = 0
        success_count = 0
        final_status = ClassificationJobStatus.COMPLETED # Assume success
        final_job_message = "Classification completed successfully."

        try:
            # Re-read config needed for the loop (API key passed via provider now)
            actual_thinking_budget = config.get('actual_thinking_budget')
            perform_image_analysis = config.get('perform_image_analysis', False)
            datasource_ids = config.get('datasource_ids', [])
            scheme_ids = config.get('scheme_ids', [])

            if not datasource_ids or not scheme_ids:
                 # This should ideally be caught during job validation, but double-check
                 raise ValueError("Job configuration missing datasource_ids or scheme_ids") 

            data_records = session.exec(select(DataRecord).where(DataRecord.datasource_id.in_(datasource_ids))).all()
            schemes = session.exec(select(ClassificationScheme).options(selectinload(ClassificationScheme.fields)).where(ClassificationScheme.id.in_(scheme_ids))).all()

            if not data_records:
                 logging.warning(f"No DataRecords found for Job {job_id}. Marking as complete.")
                 # Status is RUNNING, transition to COMPLETED is valid
                 final_status = ClassificationJobStatus.COMPLETED
                 final_job_message = "No data records found to classify."
                 # Skip the loop by letting the code proceed to final status update

            elif len(schemes) != len(scheme_ids):
                 # Invalid config found after starting
                 raise ValueError(f"Could not find all specified ClassificationSchemes: {scheme_ids}") 
            
            else: # Records and schemes are valid, proceed with classification
                logging.debug(f"Found {len(data_records)} DataRecords and {len(schemes)} Schemes for Job {job_id}.")
                # Prepare map for efficient lookup (only fetch necessary fields)
                record_content_map = {rec.id: {"title": rec.title, "text_content": rec.text_content} 
                                      for rec in session.exec(select(DataRecord.id, DataRecord.title, DataRecord.text_content)
                                                              .where(DataRecord.id.in_(dr.id for dr in data_records)))} # Efficiently fetch only needed fields
                
                results_batch_data = []
                batch_size = 100 # Adjust as needed
                total_classifications = len(data_records) * len(schemes)
                processed_classifications = 0

                for record_id, record_data in record_content_map.items():
                    current_datarecord_obj = next((dr for dr in data_records if dr.id == record_id), None) # Still needed for image URLs
                    for scheme in schemes:
                        processed_classifications += 1
                        
                        # --- Prepare provider_config using the job's main 'config' dict --- 
                        current_provider_config = {}
                        # 'config' was fetched before the try block and holds the job.configuration
                        thinking_budget_from_job_config = config.get('actual_thinking_budget') 
                        if thinking_budget_from_job_config is not None:
                            current_provider_config['thinking_budget'] = thinking_budget_from_job_config
                            logger.info(f"Job {job_id}, Record {record_id}, Scheme {scheme.id}: Adding thinking_budget={thinking_budget_from_job_config} to provider_config.") 
                        else:
                            logger.debug(f"Job {job_id}, Record {record_id}, Scheme {scheme.id}: No actual_thinking_budget found in job config.")
                        
                        # Image Analysis Placeholder
                        perform_image_analysis_from_job = config.get('perform_image_analysis', False)
                        if perform_image_analysis_from_job and current_datarecord_obj and current_datarecord_obj.images:
                            logger.info(f"Image analysis requested for record {record_id}, scheme {scheme.id}. Image URLs: {current_datarecord_obj.images}. Actual image fetching not implemented.")
                            # Placeholder: 
                            # image_bytes_list = fetch_images(current_datarecord_obj.images)
                            # current_provider_config['images'] = image_bytes_list
                        
                        logger.info(f"Job {job_id}, Record {record_id}, Scheme {scheme.id}: Final provider_config before classify_text: {current_provider_config}")

                        try:
                            existing_result_check = session.exec(select(ClassificationResult.id).where(
                                ClassificationResult.job_id == job_id,
                                ClassificationResult.datarecord_id == record_id,
                                ClassificationResult.scheme_id == scheme.id
                            )).first()
                            if existing_result_check:
                                # logging.debug(f"Skipping existing result for Record {record_id}, Scheme {scheme.id}")
                                success_count += 1 # Count skipped as success for job status
                                continue
                            
                            classification_value = service.classify_text(
                                text=record_data["text_content"],
                                title=record_data["title"],
                                scheme_id=scheme.id,
                                provider_config=current_provider_config
                            )
                            results_batch_data.append({
                                "job_id": job_id,
                                "datarecord_id": record_id,
                                "scheme_id": scheme.id,
                                "value": classification_value,
                                "status": ClassificationResultStatus.SUCCESS,
                                "error_message": None
                            })
                            success_count += 1

                        except Exception as classify_error:
                            logging.error(f"Classification failed for Record {record_id}, Scheme {scheme.id}, Job {job_id}: {classify_error}")
                            error_count += 1
                            failure_data = {
                                "job_id": job_id,
                                "datarecord_id": record_id,
                                "scheme_id": scheme.id,
                                "value": {}, 
                                "status": ClassificationResultStatus.FAILED,
                                "error_message": str(classify_error)[:1000]
                            }
                            results_batch_data.append(failure_data)
                        
                        # Write batch periodically (NO commit inside service)
                        if len(results_batch_data) >= batch_size:
                             # Use internal core function to add to session without commit
                            _core_create_results_batch(session, results_batch_data)
                            # service.create_results_batch(job_id=job_id, results_data=results_batch_data) # Avoid this if it commits
                            results_batch_data = [] # Reset batch
                
                # Create final batch (NO commit inside service)
                if results_batch_data:
                    _core_create_results_batch(session, results_batch_data)
                    # service.create_results_batch(job_id=job_id, results_data=results_batch_data)

                # Determine final status based on errors AFTER loop
                if error_count > 0:
                    final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
                    final_job_message = f"Classification finished. Success: {success_count}, Errors: {error_count}"
                else:
                    final_status = ClassificationJobStatus.COMPLETED
                    final_job_message = "Classification finished successfully."

            # --- Update Final Status --- 
            # Ensure the job object reflects the RUNNING status before this call
            if job.status != ClassificationJobStatus.RUNNING:
                 # This shouldn't happen with the new structure, but log a warning if it does
                 logging.warning(f"Job {job_id} status was unexpectedly {job.status} before final update to {final_status}. Attempting update anyway.")
            
            # Call update_job_status (which doesn't commit) using the 'job' variable (now guaranteed to be RUNNING)
            job_updated_in_session = service.update_job_status(job, final_status, error_message=final_job_message if error_count > 0 else None)
            
            # --- Commit Everything --- 
            session.commit() # Commit final status update AND all batched results
            logging.debug(f"Committed final state for Job {job_id}. Status: {final_status}. Message: {final_job_message}")
            session.refresh(job_updated_in_session) # Refresh job state with the final committed status
            job = job_updated_in_session # Ensure 'job' variable holds the latest state for finally block

        except Exception as e:
            session.rollback() # Rollback classification work if error occurred in main logic
            logging.exception(f"Critical error during classification task main logic for Job {job_id}: {e}")
            final_status_on_error = ClassificationJobStatus.FAILED
            final_message_on_error = f"Processing Error: {str(e)[:500]}"
            
            # Attempt to update status to FAILED in a separate transaction
            try:
                 with SQLModelSession(engine) as error_session:
                     job_to_fail = error_session.get(ClassificationJob, job_id)
                     if job_to_fail:
                         # Check current status before trying to fail
                         if job_to_fail.status not in [ClassificationJobStatus.COMPLETED, ClassificationJobStatus.FAILED, ClassificationJobStatus.COMPLETED_WITH_ERRORS]:
                              error_provider = get_classification_provider(provider=provider_name, model_name=model_name, api_key=api_key_from_config)
                              error_service = ClassificationService(session=error_session, classification_provider=error_provider)
                              # Pass the job *object* to the service method
                              error_service.update_job_status(job_to_fail, final_status_on_error, error_message=final_message_on_error)
                              error_session.commit() # Commit the FAILED status
                              logging.debug(f"Job {job_id} status updated to FAILED after error.")
                              # Update the main 'job' variable status for the finally block if possible
                              if job: job.status = ClassificationJobStatus.FAILED 
                         else:
                              logging.warning(f"Job {job_id} was already in a terminal state ({job_to_fail.status}) when trying to mark as FAILED.")
                     else:
                         logging.error(f"Could not find job {job_id} to mark as FAILED after error.")
            except Exception as final_status_err:
                 logging.error(f"CRITICAL: Failed to update Job {job_id} status to FAILED after error: {final_status_err}")

            # Celery Retry Logic - re-raise the original exception to trigger retry
            raise e

        finally:
            # Update RecurringTask status if needed
            # Ensure 'job' is the most up-to-date version possible here
            is_final_attempt = True
            if isinstance(self.request.retries, int) and isinstance(self.max_retries, int):
                if self.request.retries < self.max_retries: is_final_attempt = False
            
            if job and is_final_attempt: # Only update recurring task on final attempt (success or fail)
                recurring_task_id = job.configuration.get('recurring_task_id')
                if recurring_task_id and isinstance(recurring_task_id, int):
                    logging.debug(f"Updating originating RecurringTask {recurring_task_id} based on final Job {job_id} status: {job.status}")
                    # Use the final committed/refreshed job status
                    final_job_status_for_recur = job.status
                    recurring_task_status = "success" if final_job_status_for_recur == ClassificationJobStatus.COMPLETED else "error"
                    recurring_task_message = job.error_message if job.error_message else f"Job {job_id} finished with status {final_job_status_for_recur}."
                    
                    try:
                        update_task_status(recurring_task_id, recurring_task_status, recurring_task_message)
                        logging.debug(f"Successfully updated status for RecurringTask {recurring_task_id}.")
                    except Exception as update_err:
                        logging.error(f"Failed to update status for RecurringTask {recurring_task_id}: {update_err}", exc_info=True)
                else:
                    logging.debug(f"Job {job_id} not linked to a recurring task. Skipping update.")
            
            end_time = time.time()
            logging.debug(f"Classification task finished processing for Job {job_id} in {end_time - start_time:.2f} seconds.")

# Example of how to potentially call the task
# Needs integration via API route
# if __name__ == "__main__":
#     test_job_id = 1 # Assuming a Job with ID 1 exists and is PENDING
#     print(f"Manually triggering task for Job ID: {test_job_id}")
#     process_classification_job(test_job_id) 