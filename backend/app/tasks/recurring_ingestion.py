import logging
import time
from typing import List, Dict, Any, Optional
import hashlib
import asyncio

from celery import shared_task
from sqlmodel import Session, select
import dateutil.parser
from datetime import datetime, timezone
from fastapi import HTTPException

from app.core.db import engine
from app.models import (
    RecurringTask,
    RecurringTaskType,
    RecurringTaskStatus,
    DataSource,
    DataRecord,
    DataRecordCreate,
    DataSourceType # Added import
)
# Assuming scrape_article is robust and available
from app.api.routes.utils import scrape_article
# Helper function to create records (can reuse/adapt from ingestion.py if suitable)
from app.tasks.ingestion import create_datarecords_batch
from app.core.scraping_utils import get_article_content # Import the new utility
# Import the status update helper from the new utils module
from app.tasks.utils import update_task_status

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

@shared_task(bind=True, max_retries=1) # Limit retries for scheduled tasks initially
def process_recurring_ingest(self, recurring_task_id: int):
    """
    Processes a recurring ingestion task: scrapes URLs, de-duplicates, creates DataRecords.
    """
    logging.info(f"Starting recurring ingestion task for RecurringTask ID: {recurring_task_id}")
    start_time = time.time()
    processed_count = 0
    created_count = 0
    failed_count = 0
    final_status = "success" # Assume success
    error_message = None

    with Session(engine) as session:
        try:
            # 1. Fetch and validate the RecurringTask
            task = session.get(RecurringTask, recurring_task_id)
            if not task:
                raise ValueError(f"RecurringTask {recurring_task_id} not found.")
            if task.type != RecurringTaskType.INGEST:
                raise ValueError(f"Task {recurring_task_id} is not an INGEST task (type: {task.type}).")
            if task.status != RecurringTaskStatus.ACTIVE:
                 # Should ideally not happen if scheduler only picks ACTIVE, but double-check
                 logging.warning(f"Task {recurring_task_id} is not ACTIVE (status: {task.status}). Skipping execution.")
                 return # Don't process if not active

            # 2. Get configuration
            config = task.configuration or {}
            target_datasource_id = config.get('target_datasource_id')
            source_urls = config.get('source_urls', [])
            deduplication_strategy = config.get('deduplication_strategy', 'url_hash') # Default to url

            if not target_datasource_id or not isinstance(target_datasource_id, int):
                raise ValueError("Missing or invalid 'target_datasource_id' in configuration.")
            if not source_urls or not isinstance(source_urls, list):
                 raise ValueError("Missing or invalid 'source_urls' list in configuration.")

            # 3. Fetch target DataSource
            target_datasource = session.get(DataSource, target_datasource_id)
            if not target_datasource:
                raise ValueError(f"Target DataSource {target_datasource_id} not found.")
            # Ensure the target datasource can accept new records (e.g., it's URL_LIST or maybe TEXT_BLOCK)
            # We might relax this later, but good initial check
            if target_datasource.type not in [DataSourceType.URL_LIST, DataSourceType.TEXT_BLOCK]:
                logging.warning(f"Target DataSource {target_datasource_id} is type '{target_datasource.type}', which might not be ideal for recurring URL ingestion. Proceeding anyway.")


            # 4. Prepare for de-duplication (fetch existing URL hashes)
            existing_url_hashes = set()
            if deduplication_strategy == 'url_hash':
                # Fetch url_hash directly from the indexed column
                stmt = select(DataRecord.url_hash).where( # Select url_hash
                    DataRecord.datasource_id == target_datasource_id, # Use actual ID
                    DataRecord.url_hash != None
                )
                hashes = session.exec(stmt).all()
                existing_url_hashes = set(hashes)
                logger.info(f"Found {len(existing_url_hashes)} existing URL hashes for deduplication in DataSource {target_datasource_id}.")

            # 5. Iterate through URLs, scrape, de-duplicate, and prepare records
            records_to_create = []
            batch_size = 100 # Batch DB inserts

            for url in source_urls:
                processed_count += 1
                scraped_data = None
                scrape_error = None
                url_hash_str = None # Initialize hash variable

                try:
                    # Calculate URL hash for deduplication check - MODIFIED
                    if deduplication_strategy == 'url_hash':
                        url_hash_str = hashlib.sha256(url.encode()).hexdigest() # Calculate hash
                        # Check duplication using hash before scraping
                        if url_hash_str in existing_url_hashes: # Check against fetched hashes
                            logger.debug(f"Skipping duplicate URL (hash: {url_hash_str}): {url}")
                            continue # Skip to next URL

                    # Scrape URL using the new utility
                    try:
                        # Run the async function get_article_content synchronously
                        scraped_data = asyncio.run(get_article_content(url))
                    except HTTPException as http_exc:
                        # Log expected scraping errors (like 404, 501) but don't treat as critical task failure necessarily
                        scrape_error = f"Scraping HTTP Error {http_exc.status_code}: {http_exc.detail}"
                        logger.warning(f"Scraping failed for URL {url}: {scrape_error}")
                    except Exception as e:
                        scrape_error = f"Scraping function error: {e}"
                        logger.error(f"Error calling get_article_content for URL {url}: {e}", exc_info=True)

                    if scrape_error:
                         failed_count += 1
                         continue # Skip this URL if scraping failed

                    if not scraped_data or not scraped_data.get("text_content"):
                        logger.warning(f"No text content found after scraping {url}. Skipping.")
                        failed_count += 1
                        continue

                    text_content = scraped_data["text_content"].replace('\x00', '').strip()
                    if not text_content:
                        logger.warning(f"Empty text content after cleaning for {url}. Skipping.")
                        failed_count += 1
                        continue

                    # Parse event timestamp if available
                    event_ts = None
                    publication_date_str = scraped_data.get("publication_date")
                    if publication_date_str:
                        try:
                            parsed_dt = dateutil.parser.parse(publication_date_str)
                            if parsed_dt.tzinfo is None or parsed_dt.tzinfo.utcoffset(parsed_dt) is None:
                                event_ts = parsed_dt.replace(tzinfo=timezone.utc)
                            else:
                                event_ts = parsed_dt
                        except (ValueError, OverflowError, TypeError) as parse_err:
                            logging.warning(f"Could not parse publication_date '{publication_date_str}' for URL {url}: {parse_err}")


                    # Prepare DataRecord if not duplicate
                    record_meta = {
                        'original_url': url,
                        'scraped_title': scraped_data.get("title"),
                    }
                    record_data = {
                        "datasource_id": target_datasource_id,
                        "text_content": text_content,
                        "source_metadata": record_meta,
                        "event_timestamp": event_ts,
                        "url_hash": url_hash_str # Store the calculated hash
                    }
                    records_to_create.append(record_data)
                    created_count += 1

                    # Add hash to set to prevent duplicates within the same run - MODIFIED
                    if url_hash_str: # Check if hash was calculated
                         existing_url_hashes.add(url_hash_str)


                    # Commit batches periodically
                    if len(records_to_create) >= batch_size:
                        num_added = create_datarecords_batch(session, records_to_create)
                        if num_added == -1: raise ValueError("Error preparing batch of DataRecords.")
                        session.flush() # Flush to ensure records are in session for subsequent checks if needed
                        records_to_create = []
                        logger.info(f"Committed batch of {num_added} records for task {recurring_task_id}.")


                except Exception as url_proc_err:
                     logger.error(f"Failed processing URL {url} within task {recurring_task_id}: {url_proc_err}", exc_info=True)
                     failed_count += 1
                     final_status = "error" # Mark task as error if any URL fails critically within loop
                     error_message = (error_message or "") + f"Failed URL: {url}: {url_proc_err}; "


            # 6. Commit final batch
            if records_to_create:
                 num_added = create_datarecords_batch(session, records_to_create)
                 if num_added == -1: raise ValueError("Error preparing final batch of DataRecords.")
                 session.flush()
                 logger.info(f"Committed final batch of {num_added} records for task {recurring_task_id}.")


            # Update target datasource metadata? (e.g., last_scraped_at) - Optional
            # target_datasource.source_metadata = (target_datasource.source_metadata or {})
            # target_datasource.source_metadata['last_recurring_ingest_at'] = datetime.now(timezone.utc).isoformat()
            # session.add(target_datasource)

            # Commit all changes (new records, potential DS metadata)
            session.commit()

            if failed_count > 0:
                final_status = "error" # Mark as error even if some succeeded
                error_message = (error_message or "") + f"Failed to process {failed_count} URLs."

            logger.info(f"Recurring ingestion task {recurring_task_id} finished. Processed: {processed_count}, Created: {created_count}, Failed: {failed_count}.")


        except Exception as e:
             session.rollback() # Rollback any partial changes on critical error
             logger.exception(f"Critical error during recurring ingestion task {recurring_task_id}: {e}")
             final_status = "error"
             error_message = f"Critical Error: {str(e)}"
             # Use Celery retry mechanism
             try:
                 retry_countdown = 60 * (self.request.retries + 1)
                 self.retry(exc=e, countdown=retry_countdown)
                 logging.warning(f"Retrying task {recurring_task_id} due to error: {e}")
             except self.MaxRetriesExceededError:
                 logging.error(f"Max retries exceeded for task {recurring_task_id}. Will be marked as ERROR.")
                 # Update status to ERROR in the finally block if retry fails


        finally:
            # Ensure status is updated even if retries fail
            # Update status using a separate session to avoid conflicts from the main loop
            with Session(engine) as final_session:
                # Construct the message based on final status
                final_message = error_message
                if final_status == "success":
                    final_message = f"Successfully processed {processed_count} URLs, created {created_count} records."
                elif final_status == "error" and not error_message:
                    final_message = f"Task finished with errors. Processed: {processed_count}, Created: {created_count}, Failed: {failed_count}."
                
                update_task_status(final_session, recurring_task_id, final_status, final_message)

            end_time = time.time()
            logging.info(f"Recurring ingestion task {recurring_task_id} processing time: {end_time - start_time:.2f} seconds.") 