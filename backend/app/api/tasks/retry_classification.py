import logging
import time
from sqlmodel import Session as SQLModelSession, select
from sqlalchemy.orm import selectinload
from datetime import datetime, timezone

from app.core.celery_app import celery
from app.core.db import engine
from app.models import (
    ClassificationJob,
    ClassificationJobStatus,
    ClassificationResult,
    ClassificationResultStatus,
    DataRecord,
    ClassificationScheme
)
from app.api.services.classification import ClassificationService
from app.api.deps import get_classification_provider
from app.api.tasks.utils import update_task_status # For potential recurring task updates

logging.basicConfig(level=logging.DEBUG, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@celery.task(bind=True, max_retries=3)
def retry_failed_classifications_task(self, job_id: int):
    """
    Background task to retry failed classifications for a given job.
    Fetches failed results, attempts re-classification, updates results and final job status.
    """
    logging.debug(f"[RetryTask] Starting batch retry for Job ID: {job_id}")
    start_time = time.time()
    retry_error_count = 0
    retry_success_count = 0
    final_status = ClassificationJobStatus.COMPLETED # Assume success initially
    job = None # Initialize job variable

    # Task manages the session
    with SQLModelSession(engine) as session:
        # Instantiate provider and service
        # Fetch job first to get config
        job = session.get(ClassificationJob, job_id)
        if not job:
             logging.error(f"[RetryTask] Job {job_id} not found when trying to determine provider. Aborting task.")
             return 
        
        config_for_provider = job.configuration or {}
        provider_name = config_for_provider.get('llm_provider')
        model_name = config_for_provider.get('llm_model')
        api_key_from_config = config_for_provider.get('api_key')

        logging.debug(f"[RetryTask] Job {job_id}: Using provider='{provider_name}', model='{model_name}' from original job config.")
        provider = get_classification_provider(provider=provider_name, model_name=model_name, api_key=api_key_from_config)
        
        service = ClassificationService(session=session, classification_provider=provider)

        try:
            # 1. Fetch the Job using service
            if not job:
                logging.error(f"[RetryTask] Job {job_id} not found. Aborting task.")
                return
            # Initial status check (redundant if trigger logic is correct, but safe)
            if job.status != ClassificationJobStatus.COMPLETED_WITH_ERRORS:
                logging.warning(f"[RetryTask] Job {job_id} not in COMPLETED_WITH_ERRORS state (status: {job.status}). Skipping retry task.")
                return

            # 2. Update status to RUNNING (commit immediately)
            # Use service.update_job_status but handle commit here
            try:
                job = service.update_job_status(job, ClassificationJobStatus.RUNNING)
                session.commit()
                session.refresh(job)
                logging.debug(f"[RetryTask] Committed RUNNING status for Job {job_id}")
            except Exception as status_update_err:
                 session.rollback()
                 logging.error(f"[RetryTask] Failed to set Job {job_id} to RUNNING: {status_update_err}", exc_info=True)
                 # Retry the task if status update fails? Or just fail? Let's retry.
                 raise ValueError("Failed to set job status to RUNNING") from status_update_err


            # 3. Query failed ClassificationResult records for this job
            failed_results_stmt = select(ClassificationResult).where(
                ClassificationResult.job_id == job_id,
                ClassificationResult.status == ClassificationResultStatus.FAILED
            )
            failed_results = session.exec(failed_results_stmt).all()

            if not failed_results:
                logging.info(f"[RetryTask] No failed results found for Job {job_id}. Marking as completed.")
                final_status = ClassificationJobStatus.COMPLETED
                # Update final status using service (needs commit handled outside)
                job = service.update_job_status(job, final_status)
                session.commit() # Commit the final status update
                session.refresh(job)
                return # Exit task early

            logging.debug(f"[RetryTask] Found {len(failed_results)} failed results to retry for Job {job_id}.")

            # 4. Fetch necessary DataRecord content and Scheme definitions efficiently
            # Fetch distinct record IDs and scheme IDs from the failed results
            record_ids_to_fetch = list({res.datarecord_id for res in failed_results})
            scheme_ids_to_fetch = list({res.scheme_id for res in failed_results})

            # Fetch DataRecords
            record_content_map = {}
            if record_ids_to_fetch:
                record_stmt = select(DataRecord.id, DataRecord.title, DataRecord.text_content).where(DataRecord.id.in_(record_ids_to_fetch))
                fetched_records = session.exec(record_stmt).all()
                record_content_map = {rec.id: {"title": rec.title, "text_content": rec.text_content} for rec in fetched_records}

            # Fetch ClassificationSchemes with fields
            scheme_map = {}
            if scheme_ids_to_fetch:
                scheme_stmt = select(ClassificationScheme).options(selectinload(ClassificationScheme.fields)).where(ClassificationScheme.id.in_(scheme_ids_to_fetch))
                fetched_schemes = session.exec(scheme_stmt).all()
                scheme_map = {sch.id: sch for sch in fetched_schemes}

            # 5. Loop through failed results and retry classification
            batch_size = 50 # Commit results updates periodically
            processed_count = 0

            for result in failed_results:
                processed_count += 1
                logging.debug(f"[RetryTask] Retrying Result ID: {result.id} (Record: {result.datarecord_id}, Scheme: {result.scheme_id}) - {processed_count}/{len(failed_results)}")

                record_data = record_content_map.get(result.datarecord_id)
                scheme = scheme_map.get(result.scheme_id)

                if not record_data:
                    logging.error(f"[RetryTask] Missing record content for DataRecord ID {result.datarecord_id} (Result ID: {result.id}). Skipping retry.")
                    result.error_message = "Retry skipped: Parent DataRecord content missing."
                    # Keep status FAILED
                    retry_error_count += 1
                    session.add(result) # Add to session to update error message
                    continue
                if not scheme:
                    logging.error(f"[RetryTask] Missing scheme definition for Scheme ID {result.scheme_id} (Result ID: {result.id}). Skipping retry.")
                    result.error_message = "Retry skipped: ClassificationScheme definition missing."
                    # Keep status FAILED
                    retry_error_count += 1
                    session.add(result) # Add to session to update error message
                    continue

                # Attempt re-classification using the core service logic
                try:
                    # api_key = job.configuration.get('api_key') if job.configuration else None
                    new_value = service.classify_text(
                        text=record_data["text_content"],
                        title=record_data["title"],
                        scheme_id=scheme.id,
                        # api_key=api_key # API key handled by provider instance now
                        provider_config={'thinking_budget': config_for_provider.get('actual_thinking_budget')} # Pass thinking budget if needed
                    )

                    # Update result on SUCCESS
                    result.value = new_value
                    result.status = ClassificationResultStatus.SUCCESS
                    result.error_message = None
                    result.timestamp = datetime.now(timezone.utc)
                    retry_success_count += 1
                    logging.debug(f"[RetryTask] SUCCESS - Result {result.id}")

                except Exception as retry_error:
                    # Update result on FAILURE
                    error_str = str(retry_error)[:1000]
                    result.status = ClassificationResultStatus.FAILED
                    result.error_message = f"Retry Failed: {error_str}"
                    result.timestamp = datetime.now(timezone.utc)
                    retry_error_count += 1
                    logging.error(f"[RetryTask] FAILURE - Result {result.id}: {error_str}")

                session.add(result) # Add updated result to session

                # Commit in batches
                if processed_count % batch_size == 0:
                    try:
                        session.commit()
                        logging.debug(f"[RetryTask] Committed batch of {batch_size} result updates for Job {job_id}.")
                        # Refresh objects in the current batch? Might not be necessary if only updating.
                    except Exception as batch_commit_err:
                         session.rollback()
                         logging.error(f"[RetryTask] Error committing results batch for job {job_id}: {batch_commit_err}", exc_info=True)
                         # Decide how to handle batch commit errors - fail the task?
                         raise ValueError("Failed to commit results batch") from batch_commit_err

            # 6. Commit any remaining results updates
            try:
                session.commit()
                logging.debug(f"[RetryTask] Committed final batch of result updates for Job {job_id}.")
            except Exception as final_commit_err:
                session.rollback()
                logging.error(f"[RetryTask] Error committing final results batch for job {job_id}: {final_commit_err}", exc_info=True)
                raise ValueError("Failed to commit final results batch") from final_commit_err

            # 7. Determine final job status based on retry errors
            final_job_message = f"Retry finished. Success: {retry_success_count}, New Errors: {retry_error_count}"
            if retry_error_count > 0:
                final_status = ClassificationJobStatus.COMPLETED_WITH_ERRORS
            else:
                final_status = ClassificationJobStatus.COMPLETED

            # Update final job status using service (commit handled here)
            job = service.update_job_status(job, final_status, error_message=final_job_message if retry_error_count > 0 else None)
            session.commit() # Commit final job status
            session.refresh(job)
            logging.debug(f"[RetryTask] Committed final Job {job_id} status: {final_status}")

        except Exception as e:
            # Catch broad exceptions during task execution
            session.rollback() # Rollback any partial commits
            logging.exception(f"[RetryTask] Critical error during retry task for Job {job_id}: {e}")
            final_status = ClassificationJobStatus.FAILED
            final_job_message = f"Retry Task Error: {str(e)}"

            # Update status to FAILED using service in a separate session if possible
            try:
                 with SQLModelSession(engine) as error_session:
                    error_provider = get_classification_provider()
                    error_service = ClassificationService(session=error_session, classification_provider=error_provider)
                    job_to_fail = error_session.get(ClassificationJob, job_id)
                    if job_to_fail:
                        error_service.update_job_status(job_to_fail, ClassificationJobStatus.FAILED, error_message=final_job_message)
                        # Commit handled by service method if it does
                        logging.debug(f"[RetryTask] Job {job_id} status updated to FAILED after task error.")
                    else:
                         logging.error(f"[RetryTask] Could not find job {job_id} to mark as FAILED after task error.")
            except Exception as final_status_err:
                logging.error(f"[RetryTask] CRITICAL: Failed to update Job {job_id} status to FAILED after task error: {final_status_err}")

            # Retry the task itself for transient errors
            try:
                retry_countdown = 60 * (self.request.retries + 1)
                self.retry(exc=e, countdown=retry_countdown)
                logging.warning(f"[RetryTask] Retrying task for Job {job_id} due to error: {e}")
            except self.MaxRetriesExceededError:
                logging.error(f"[RetryTask] Max retries exceeded for Job {job_id}. Job remains FAILED.")
                # Status is already set to FAILED above

        finally:
             # Optional: Update RecurringTask if applicable
            # Similar logic as in process_classification_job if needed
             if job:
                 recurring_task_id = job.configuration.get('recurring_task_id') if job.configuration else None
                 if recurring_task_id and isinstance(recurring_task_id, int):
                     logging.debug(f"[RetryTask] Updating originating RecurringTask {recurring_task_id} based on final Job {job_id} status: {job.status}")
                     # Map job status to recurring task status
                     recurring_task_status = "success" if job.status == ClassificationJobStatus.COMPLETED else "error"
                     recurring_task_message = job.error_message if job.error_message else f"Retry job {job_id} finished with status {job.status}."
                     try:
                         update_task_status(recurring_task_id, recurring_task_status, recurring_task_message)
                         logging.debug(f"[RetryTask] Successfully updated status for RecurringTask {recurring_task_id}.")
                     except Exception as update_err:
                         logging.error(f"[RetryTask] Failed to update status for RecurringTask {recurring_task_id}: {update_err}", exc_info=True)

             end_time = time.time()
             logging.debug(f"[RetryTask] Batch retry task finished for Job {job_id} in {end_time - start_time:.2f} seconds.") 