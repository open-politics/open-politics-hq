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
    DataSourceType
)
# Remove direct scrape/batch imports
# from app.api.routes.users.utils import scrape_article
# from app.api.tasks.ingestion import create_datarecords_batch
# from app.core.scraping_utils import get_article_content

# Import services and utils directly from deps
# from app.api.services.ingestion import IngestionService # Import service class
# from app.api.deps import get_ingestion_service # Keep factory? No, remove.
# Import providers and base types directly
from app.api.deps import get_storage_provider, get_scraping_provider
from app.api.services.providers.base import StorageProvider, ScrapingProvider

from app.api.tasks.utils import update_task_status

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Make task async as it awaits scraping provider
@shared_task(bind=True, max_retries=1)
def process_recurring_ingest(self, recurring_task_id: int):
    """
    Processes a recurring ingestion task directly.
    Scrapes URLs, handles deduplication, and creates DataRecords.
    """
    logging.info(f"Starting recurring ingestion task for RecurringTask ID: {recurring_task_id}")
    start_time = time.time()
    processed_count = 0
    created_count = 0
    failed_count = 0
    skipped_count = 0 # Track skipped duplicates
    final_status = "success" # Assume success
    error_message = None

    # Get providers once
    scraping_provider: ScrapingProvider = get_scraping_provider()

    # Use a single session for the entire task logic
    with Session(engine) as session:
        try:
            # 1. Fetch and validate the RecurringTask
            task = session.get(RecurringTask, recurring_task_id)
            if not task:
                raise ValueError(f"RecurringTask {recurring_task_id} not found.")
            if task.type != RecurringTaskType.INGEST:
                raise ValueError(f"Task {recurring_task_id} is not an INGEST task (type: {task.type}).")
            if task.status != RecurringTaskStatus.ACTIVE:
                 logging.warning(f"Task {recurring_task_id} is not ACTIVE (status: {task.status}). Skipping execution.")
                 return

            # 2. Get configuration
            config = task.configuration or {}
            target_datasource_id = config.get('target_datasource_id')
            source_urls = config.get('source_urls', [])

            if not target_datasource_id or not isinstance(target_datasource_id, int):
                raise ValueError("Missing or invalid 'target_datasource_id' in configuration.")
            if not source_urls or not isinstance(source_urls, list):
                 raise ValueError("Missing or invalid 'source_urls' list in configuration.")

            # 3. Fetch target DataSource directly
            target_datasource = session.get(DataSource, target_datasource_id)
            if not target_datasource:
                raise ValueError(f"Target DataSource {target_datasource_id} not found.")
            # Validate workspace ownership
            if target_datasource.workspace_id != task.workspace_id:
                 raise ValueError(f"Target DataSource {target_datasource_id} does not belong to task workspace {task.workspace_id}.")

            # Validate datasource type (allow URL_LIST and TEXT_BLOCK)
            if target_datasource.type not in [DataSourceType.URL_LIST, DataSourceType.TEXT_BLOCK]:
                 logging.warning(f"Target DataSource {target_datasource_id} has type '{target_datasource.type}', which might not be ideal for URL ingestion, but proceeding.")

            # 4. Iterate through URLs and process directly
            for url in source_urls:
                processed_count += 1
                try:
                    # --- Start: Logic moved from IngestionService.append_record --- 
                    # Check for duplicates BEFORE scraping
                    url_hash = hashlib.sha256(url.encode()).hexdigest()
                    existing_record = session.exec(
                        select(DataRecord.id).where(
                            DataRecord.datasource_id == target_datasource_id,
                            DataRecord.url_hash == url_hash
                        )
                    ).first()
                    if existing_record:
                        skipped_count += 1
                        logger.debug(f"Skipping duplicate URL: {url} (DS: {target_datasource_id})")
                        continue

                    # Scrape URL
                    # Use asyncio.run since task is sync but scraping is async
                    scraped_data = asyncio.run(scraping_provider.scrape_url(url))

                    if not scraped_data or not scraped_data.get('text_content'):
                        raise ValueError("Scraping yielded no text content.")

                    final_text_content = scraped_data.get('text_content').replace('\\x00', '').strip()
                    if not final_text_content:
                        raise ValueError("Scraping yielded empty text content after cleaning.")

                    # Extract top_image and images
                    top_image = scraped_data.get('top_image')
                    images = scraped_data.get('images')

                    logger.info(f"[RecurringIngest] Scraped data for {url} PRE-SAVE - Title: '{scraped_data.get('title')}', TopImage: '{top_image}', Images: {images}")

                    # Parse Timestamp
                    final_event_timestamp: Optional[datetime] = None
                    scraped_publication_date = scraped_data.get('publication_date')
                    if scraped_publication_date:
                        try:
                            parsed_dt = dateutil.parser.parse(scraped_publication_date)
                            if parsed_dt.tzinfo is None or parsed_dt.tzinfo.utcoffset(parsed_dt) is None:
                                final_event_timestamp = parsed_dt.replace(tzinfo=timezone.utc)
                            else:
                                final_event_timestamp = parsed_dt
                        except (ValueError, OverflowError, TypeError):
                            logger.warning(f"Could not parse scraped publication date '{scraped_publication_date}' for URL: {url}")
                            final_event_timestamp = None

                    # Prepare Metadata
                    source_metadata_extra: Dict[str, Any] = {
                        'append_method': 'recurring_task',
                        'original_input': url,
                        'append_time': datetime.now(timezone.utc).isoformat(),
                        'scraped_title': scraped_data.get('title'),
                        'recurring_task_id': recurring_task_id
                    }

                    # Prepare DataRecordCreate model for validation
                    record_to_create_dict: Dict[str, Any] = {
                        "datasource_id": target_datasource_id,
                        "text_content": final_text_content,
                        "source_metadata": source_metadata_extra,
                        "event_timestamp": final_event_timestamp,
                        "url_hash": url_hash,
                        "top_image": top_image,
                        "images": images
                    }
                    record_create_obj = DataRecordCreate(**record_to_create_dict)
                    db_record = DataRecord.model_validate(record_create_obj)

                    logger.info(f"[RecurringIngest] DataRecord object PRE-ADD for {url}: {db_record.model_dump_json(indent=2)}")
                    # Add and flush within the loop
                    session.add(db_record)
                    session.flush()
                    created_count += 1
                    
                    # --- Increment DataSource Count --- 
                    if target_datasource:
                        if target_datasource.data_record_count is None:
                            target_datasource.data_record_count = 1
                        else:
                            target_datasource.data_record_count += 1
                        session.add(target_datasource) # Ensure the change is tracked
                        session.flush() # Flush the count update immediately
                        logger.debug(f"Incremented count for DataSource {target_datasource_id} to {target_datasource.data_record_count} after URL {url}")
                    # --- End Increment ---
                    
                    # --- End: Logic moved from IngestionService.append_record ---

                except ValueError as ve:
                    # Catch expected errors (duplicate already handled, scrape fail, validation)
                    failed_count += 1
                    logger.warning(f"Failed processing URL {url} for task {recurring_task_id}: {ve}")
                    final_status = "error"
                    error_message = (error_message or "") + f"Failed URL: {url}: {ve}; "
                except Exception as e:
                    # Catch unexpected errors
                    failed_count += 1
                    logger.error(f"Unexpected error processing URL {url} for task {recurring_task_id}: {e}", exc_info=True)
                    final_status = "error"
                    error_message = (error_message or "") + f"Unexpected error for URL {url}: {e}; "

            # Commit transaction if loop finished successfully or with non-critical errors
            if failed_count == 0 or final_status == "error": # Commit even if some URLs failed
                 session.commit()
                 logger.info(f"Committed records for recurring task {recurring_task_id}.")
            # No else needed, handled by main exception block rollback

            # Update final status message if needed
            if failed_count > 0:
                final_status = "error"
                error_message = (error_message or "") + f"Failed to process {failed_count} URLs."

            logger.info(f"Recurring ingestion task {recurring_task_id} finished loop. Processed: {processed_count}, Created: {created_count}, Skipped: {skipped_count}, Failed: {failed_count}.")

        except Exception as e:
             session.rollback() # Rollback on critical error BEFORE loop or during setup
             logger.exception(f"Critical error during recurring ingestion task {recurring_task_id}: {e}")
             final_status = "error"
             error_message = f"Critical Error: {str(e)}"
             # Retry logic
             try:
                 retry_countdown = 60 * (self.request.retries + 1)
                 self.retry(exc=e, countdown=retry_countdown)
                 logging.warning(f"Retrying task {recurring_task_id} due to error: {e}")
             except self.MaxRetriesExceededError:
                 logging.error(f"Max retries exceeded for task {recurring_task_id}. Will be marked as ERROR.")

        finally:
            # Final status update using the main session (or a new one)
            # update_task_status uses its own session now
            final_message = error_message
            if final_status == "success":
                final_message = f"Successfully processed {processed_count} URLs. Created: {created_count}, Skipped: {skipped_count}, Failed: {failed_count}."
            elif final_status == "error" and not error_message:
                final_message = f"Task finished with errors. Processed: {processed_count}, Created: {created_count}, Skipped: {skipped_count}, Failed: {failed_count}."

            # Use utility function which handles its own session
            update_task_status(recurring_task_id, final_status, final_message)

            end_time = time.time()
            logging.info(f"Recurring ingestion task {recurring_task_id} processing time: {end_time - start_time:.2f} seconds.") 