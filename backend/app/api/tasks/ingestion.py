import logging
import time
import csv # Added
import io # Added
import fitz # Added
import chardet # Added
import dateutil.parser
from datetime import datetime, timezone
import asyncio
from typing import List, Dict, Any, Tuple, Optional # Added Tuple, Optional
import traceback
import hashlib

from app.core.celery_app import celery
from sqlmodel import Session, select, func
from sqlalchemy.exc import SQLAlchemyError # Added for specific exception handling

from app.core.db import engine
from app.models import (
    DataSource,
    DataSourceStatus,
    DataSourceType,
    DataRecord,
    DataRecordCreate,
    # Remove ClassificationResult if not used directly here
)
import hashlib
import logging

# Removed IngestionService import
# from app.api.services.ingestion import IngestionService
# Import provider instances directly
from app.api.deps import get_storage_provider, get_scraping_provider
# Import StorageProvider base type for type hinting
from app.api.services.providers.base import StorageProvider, ScrapingProvider


logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- Start: Helper Functions Moved from IngestionService ---
def _sanitize_csv_row(row_dict: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Removes null bytes and strips whitespace from CSV row values."""
    sanitized = {}
    for key, value in row_dict.items():
        if isinstance(value, str):
            sanitized_value = value.replace('\\x00', '').strip()
            sanitized[key] = sanitized_value if sanitized_value else None
        else:
            sanitized[key] = value
    return sanitized

# --- Start: PDF Processing Logic Moved from IngestionService ---
async def _task_process_pdf_content(
    file_content_bytes: bytes,
    datasource_id: int,
    # Accept the override, fall back to actual DS origin_details if not provided
    origin_details_override: Optional[Dict[str, Any]] = None,
    actual_datasource_origin_details: Optional[Dict[str, Any]] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Parses PDF content and returns record data and metadata updates. (Task version)"""
    source_metadata_update = {}
    # Removed: records_data = [] - it will be created inside process_pdf_sync

    # Use the override if provided, otherwise use the actual DS details
    effective_origin_details = origin_details_override or actual_datasource_origin_details or {}
    original_filename_for_record = effective_origin_details.get('filename', 'unknown.pdf')

    def process_pdf_sync():
        nonlocal source_metadata_update
        local_all_pdf_text = ""
        local_total_processed_pages = 0
        local_page_count = 0
        # --- Define local_records_data here ---
        local_records_data: List[Dict[str, Any]] = []
        # --- End Define ---
        try:
            with fitz.open(stream=file_content_bytes, filetype="pdf") as doc:
                local_page_count = doc.page_count
                for page_num in range(local_page_count):
                    try:
                        page = doc.load_page(page_num)
                        text = page.get_text("text").replace('\\x00', '').strip()
                        if text:
                            local_all_pdf_text += text + "\\n\\n" # Changed separator
                            local_total_processed_pages += 1
                    except Exception as page_err:
                        logging.error(f"Error processing PDF page {page_num + 1} for DS {datasource_id}: {page_err}")

            source_metadata_update['page_count'] = local_page_count
            source_metadata_update['processed_page_count'] = local_total_processed_pages

            # --- Move record creation logic inside ---
            if local_all_pdf_text:
                # Use local_records_data
                local_records_data = [{
                    "datasource_id": datasource_id, # Link record to the PARENT datasource ID
                    "text_content": local_all_pdf_text.strip(),
                    "source_metadata": {
                        'processed_page_count': local_total_processed_pages,
                        # Store the specific file's name here
                        'original_filename': original_filename_for_record
                    },
                    "event_timestamp": None
                }]
            else:
                logging.warning(f"No text extracted from PDF (DS: {datasource_id}).")
            # --- End Move ---

            # Return the local variables correctly
            return local_all_pdf_text, local_records_data # Return populated local_records_data

        except (fitz.PyMuPDFError) as specific_err:
            # Ensure local_records_data is returned even on error if needed, or handle differently
            raise ValueError(f"Failed to open/parse PDF for DS {datasource_id}: {specific_err}") from specific_err
        except Exception as pdf_err:
            # Ensure local_records_data is returned even on error if needed, or handle differently
            raise ValueError(f"Failed processing PDF for DS {datasource_id}: {pdf_err}") from pdf_err

    # Capture both returned values correctly
    all_pdf_text, records_data = await asyncio.to_thread(process_pdf_sync)

    logging.info(f"Processed PDF: {source_metadata_update.get('processed_page_count', 0)}/{source_metadata_update.get('page_count', 0)} pages (DS: {datasource_id}). Records created: {len(records_data)}")
    return records_data, source_metadata_update # Return the captured records_data
# --- End: PDF Processing Logic ---

# --- Start: CSV Processing Logic Moved from IngestionService ---
async def _task_process_csv_content(
    datasource_id: int,
    storage_path: str,
    origin_details: Dict[str, Any],
    storage_provider: StorageProvider
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Helper coroutine to process CSV content from storage."""
    logger.info(f"Processing CSV content for DS {datasource_id} from {storage_path}")
    records_data_to_create = []
    source_metadata_update = {}

    try:
        # Get skip_rows and delimiter, handling potential None values
        raw_skip_rows = origin_details.get('skip_rows') # Get value, might be None, string, or number
        skip_rows = int(raw_skip_rows) if raw_skip_rows is not None else 0 # Default to 0 if None

        raw_delimiter = origin_details.get('delimiter')
        delimiter = raw_delimiter if raw_delimiter is not None else ',' # Default to comma if None or missing

        encoding = origin_details.get('encoding', 'utf-8') # Default to utf-8
        text_column = origin_details.get('text_column') # Primary text column (optional)

        logger.debug(f"DS {datasource_id}: CSV options - skip_rows={skip_rows}, delimiter='{delimiter}', encoding='{encoding}', text_column='{text_column}'")

        csv_content_stream = await storage_provider.get_file(storage_path)
        # Decode the stream with the determined encoding
        # Handle potential decoding errors
        decoded_stream = (line.decode(encoding, errors='replace') for line in csv_content_stream)

        # Use csv.reader with the specified delimiter
        csv_reader = csv.reader(decoded_stream, delimiter=delimiter)

        header = []
        processed_row_count = 0
        empty_header_names = False

        # Process rows
        for i, row in enumerate(csv_reader):
            current_row_number = i + 1 # 1-based row number

            # Handle header row
            if i == 0:
                header = [h.strip() for h in row] # Clean header names
                if not all(header): # Check if any header name is empty
                    logger.warning(f"CSV header has empty names (DS {datasource_id})")
                    empty_header_names = True
                if not header: # Handle completely empty header row
                     logger.error(f"CSV file for DS {datasource_id} has an empty or invalid header row. Cannot process.")
                     raise ValueError("Empty or invalid CSV header")
                # Set source metadata immediately after reading header
                source_metadata_update['columns'] = header
                source_metadata_update['delimiter_used'] = delimiter
                source_metadata_update['encoding_used'] = encoding
                source_metadata_update['rows_skipped'] = skip_rows
                continue # Skip header row from data processing

            # Skip initial rows if specified
            if current_row_number <= skip_rows + 1: # +1 because header is row 1
                continue

            # Check for row length mismatch (only if header wasn't empty)
            if not empty_header_names and len(row) != len(header):
                logger.warning(f"Row {current_row_number} length mismatch in DS {datasource_id}. Expected {len(header)}, got {len(row)}. Skipping.")
                source_metadata_update['mismatched_rows'] = source_metadata_update.get('mismatched_rows', 0) + 1
                continue

            # Create row data dictionary
            row_data = {header[j]: (row[j].strip() if row[j] is not None else None) for j in range(len(header)) if j < len(row)}

            # Determine text_content
            text_content_value = ""
            if text_column and text_column in row_data:
                text_content_value = str(row_data[text_column] or "")
            else:
                # Concatenate all values if no specific column or column not found
                text_content_value = " ".join(str(v or "") for v in row_data.values())

            # Add record data to list for bulk creation
            record_data = {
                "datasource_id": datasource_id,
                "text_content": text_content_value,
                "source_metadata": {
                    "row_number": current_row_number,
                    "source_columns": text_column if text_column else list(header) # Indicate source
                },
                "row_data": row_data # Store original row data
            }
            records_data_to_create.append(record_data)
            processed_row_count += 1

            # Optional: Log progress periodically
            if processed_row_count % 1000 == 0:
                logger.info(f"[Async] Processed {processed_row_count} CSV rows for DS {datasource_id}")

        logger.info(f"[Sync] Processed {processed_row_count} CSV rows for DS {datasource_id}, {source_metadata_update.get('mismatched_rows', 0)} mismatches.")
        source_metadata_update['row_count_processed'] = processed_row_count

    except FileNotFoundError:
        logger.error(f"CSV file not found in storage for DS {datasource_id} at path {storage_path}")
        # Re-raise or handle as appropriate for the task status
        raise
    except UnicodeDecodeError as e:
        logger.error(f"Encoding error processing CSV for DS {datasource_id} with encoding '{encoding}': {e}")
        # Re-raise or set specific error message
        raise ValueError(f"Encoding error ({encoding}). Please check file encoding or specify a different one.") from e
    except csv.Error as e:
        logger.error(f"CSV parsing error for DS {datasource_id} (delimiter='{delimiter}'): {e}")
        raise ValueError(f"CSV parsing error. Check delimiter ('{delimiter}') and file format.") from e
    except Exception as e:
        logger.exception(f"Unexpected error processing CSV content for DS {datasource_id}: {e}")
        raise # Re-raise unexpected errors

    return records_data_to_create, source_metadata_update

# --- End: CSV Processing Logic ---

# --- Start: Record Batch Creation Logic Moved from IngestionService ---
def _task_create_records_batch(session: Session, records_data: List[Dict[str, Any]]) -> int:
    """Creates DataRecords in batch using the provided session. (Task version)"""
    if not records_data:
        return 0

    records_to_add: List[DataRecord] = []
    count = 0
    datasource_id = records_data[0].get("datasource_id") if records_data else "N/A" # For logging
    for record_dict in records_data:
        try:
            record_create_obj = DataRecordCreate(**record_dict)
            db_record = DataRecord.model_validate(record_create_obj)
            records_to_add.append(db_record)
            count += 1
        except Exception as validation_err:
            logger.error(f"Validation error creating DataRecord for DS {datasource_id}: {record_dict}, Error: {validation_err}", exc_info=True)

    if records_to_add:
        logger.info(f"Adding batch of {len(records_to_add)} records to session for DS {datasource_id}.")
        session.add_all(records_to_add)
        # Flush within task processing function, commit at the very end
        try:
            session.flush()
            logger.info(f"Flushed batch of {len(records_to_add)} records for DS {datasource_id}.")
        except Exception as e:
            logger.error(f"Failed to flush batch create for DS {datasource_id}: {e}")
            raise # Re-raise flush error to be caught by task handler
    return count
# --- End: Record Batch Creation Logic ---


# --- Start: DataSource Status Update Logic Moved from IngestionService ---
def _task_update_datasource_status(
    session: Session,
    datasource: DataSource, # Pass the fetched datasource object
    status: DataSourceStatus,
    error_message: Optional[str] = None,
    metadata_updates: Optional[Dict[str, Any]] = None,
) -> DataSource:
    """Updates the status and optionally metadata of a DataSource using the provided session. (Task version)"""
    try:
        logger.info(f"Updating DataSource {datasource.id} status to {status}")
        datasource.status = status
        datasource.updated_at = datetime.now(timezone.utc)
        if error_message is not None:
            datasource.error_message = error_message
        if metadata_updates:
            current_metadata = datasource.source_metadata or {}
            current_metadata.update(metadata_updates)
            # Important: Reassign dict to trigger SQLAlchemy change detection
            datasource.source_metadata = current_metadata

        session.add(datasource)
        session.flush()
        session.refresh(datasource)
        logger.info(f"Flushed status update for DataSource {datasource.id} to {status}")
        return datasource
    except SQLAlchemyError as e:
        logger.error(f"Failed to flush status update for DataSource {datasource.id}: {e}")
        raise # Re-raise DB error
    except Exception as e:
        logger.exception(f"Unexpected error updating DataSource {datasource.id} status: {e}")
        raise
# --- End: DataSource Status Update Logic ---


# Base Task Class for Failure Handling (Modified to update status directly)
class BaseIngestionTask(celery.Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(f'Celery task {task_id} failed: {exc!r}')
        datasource_id = args[0] if args else None # Assuming datasource_id is the first arg
        if datasource_id:
            logger.info(f"Attempting to mark DataSource {datasource_id} as FAILED due to task failure.")
            try:
                with Session(engine) as fail_session:
                    datasource = fail_session.get(DataSource, datasource_id)
                    if datasource:
                        # Create a serializable error message
                        error_message = f"Task failed: {type(exc).__name__}: {str(exc)[:250]}"
                        # Use the direct update function
                        _task_update_datasource_status(
                            session=fail_session,
                            datasource=datasource,
                            status=DataSourceStatus.FAILED,
                            error_message=error_message
                        )
                        fail_session.commit() # Commit failure status
                        logger.info(f"Successfully marked DataSource {datasource_id} as FAILED.")
                    else:
                        logger.error(f"DataSource {datasource_id} not found during on_failure handling.")
            except Exception as fail_update_e:
                logger.error(f"CRITICAL: Failed to update DataSource {datasource_id} status to FAILED during on_failure: {fail_update_e}", exc_info=True)
        else:
            logger.error("Could not determine datasource_id from task arguments for failure handling.")


# Make the task asynchronous and use the base class
@celery.task(bind=True, max_retries=3, base=BaseIngestionTask, autoretry_for=(ValueError,), retry_backoff=True, retry_backoff_max=60)
def process_datasource(self, datasource_id: int, task_origin_details_override: Optional[Dict[str, Any]] = None):
    """
    Background task to process a DataSource based on its type,
    extract text content, and create DataRecord entries directly.
    Accepts optional origin_details_override for specific file processing (e.g., bulk PDF).
    The task manages the database transaction and lets exceptions propagate for handling by on_failure.

    Retries up to 3 times with exponential backoff if the datasource is not found,
    to handle race conditions with transaction commits.
    """
    logging.info(f"Starting ingestion task for DataSource ID: {datasource_id}")
    if task_origin_details_override:
        logging.info(f"Task received origin_details_override: {task_origin_details_override}")
    start_time = time.time()
    total_records_created = 0

    # Instantiate providers once
    storage_provider: StorageProvider = get_storage_provider()
    scraping_provider: ScrapingProvider = get_scraping_provider()

    # Use a single session for the entire task logic
    with Session(engine) as session:
        datasource = None # Initialize datasource variable
        records_data_to_create: List[Dict[str, Any]] = []
        source_metadata_update: Dict[str, Any] = {}

        try:
            # Fetch datasource
            datasource = session.get(DataSource, datasource_id)

            if not datasource:
                logging.warning(f"DataSource {datasource_id} not found. Will retry. Attempt {self.request.retries + 1} of {self.max_retries + 1}")
                raise ValueError(f"DataSource {datasource_id} not found.") # Trigger retry

            # --- MODIFIED STATUS CHECK ---
            # Allow processing if it's PENDING OR if it's a specific file task (override is present)
            # We still want to skip if it's FAILED or something unexpected happened before this task ran.
            if datasource.status != DataSourceStatus.PENDING and not task_origin_details_override:
                logging.warning(f"DataSource {datasource_id} status is {datasource.status} and no override present. Skipping task run.")
                return # Task finishes successfully without doing work
            elif datasource.status == DataSourceStatus.FAILED:
                 logging.warning(f"DataSource {datasource_id} is FAILED. Skipping task run.")
                 return
            # --- END MODIFICATION ---


            # === Start: Main Processing Logic ===
            # Update status to PROCESSING (Directly using session)
            # --- MODIFICATION: Only update to PROCESSING if it was PENDING ---
            if datasource.status == DataSourceStatus.PENDING:
                datasource = _task_update_datasource_status(session, datasource, DataSourceStatus.PROCESSING)
            # --- END MODIFICATION ---

            # Get the actual origin details from the fetched datasource object
            actual_origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}

            # --- Process based on type (using internal task helpers) ---
            if datasource.type == DataSourceType.CSV:
                logging.info(f"Processing CSV DataSource: {datasource.id}")
                object_name = actual_origin_details.get('storage_path') # Use storage_path
                if not object_name: raise ValueError(f"Missing 'storage_path' for CSV DS {datasource.id}")
                # Remove fetching file_content_bytes here, helper will handle it
                # file_object = None
                # try:
                    # Use asyncio.run to call async storage method from sync task
                    # async def get_file_content():
                    #      nonlocal file_object
                    #      file_object = await storage_provider.get_file(object_name)
                    #      return file_object.read() # Read the content within async context
                # 
                #    file_content_bytes = asyncio.run(get_file_content())
                # Call the async processing helper correctly with storage_provider
                records_data_to_create, source_metadata_update = asyncio.run(
                     _task_process_csv_content(
                         datasource_id=datasource_id,
                         storage_path=object_name, 
                         origin_details=actual_origin_details,
                         storage_provider=storage_provider
                     )
                )
                # finally:
                #      if file_object:
                #          try: asyncio.run(file_object.close()) # Close async if needed
                #          except Exception: pass

            elif datasource.type == DataSourceType.PDF:
                logging.info(f"Processing PDF DataSource: {datasource.id}")
                # Use the OVERRIDE if provided (for bulk), else use actual details (for single)
                effective_origin_details = task_origin_details_override or actual_origin_details
                object_name = effective_origin_details.get('storage_path')
                if not object_name:
                    # If object_name is missing, especially in bulk override, fail clearly
                    missing_detail = "task_origin_details_override" if task_origin_details_override else "datasource.origin_details"
                    raise ValueError(f"Missing 'storage_path' in {missing_detail} for PDF DS {datasource.id}")
                file_object = None
                try:
                    async def get_pdf_content():
                        nonlocal file_object
                        file_object = await storage_provider.get_file(object_name)
                        return file_object.read()

                    pdf_data = asyncio.run(get_pdf_content())
                    records_data_to_create, source_metadata_update = asyncio.run(
                         _task_process_pdf_content(
                             pdf_data,
                             datasource_id,
                             origin_details_override=task_origin_details_override,
                             actual_datasource_origin_details=actual_origin_details
                         )
                    )
                finally:
                    if file_object:
                        try: asyncio.run(file_object.close())
                        except Exception: pass

            elif datasource.type == DataSourceType.URL_LIST:
                logging.info(f"Processing URL_LIST DataSource: {datasource.id}")
                # Use the correctly fetched origin_details from above
                urls = actual_origin_details.get('urls') 
                if not urls or not isinstance(urls, list): raise ValueError(f"Missing/invalid 'urls' list for DS {datasource.id}")
                processed_count = 0
                failed_urls = []
                # Process URLs one by one (keep existing logic)
                for i, url in enumerate(urls):
                    error_msg = None
                    try:
                        # Use asyncio.run for the scraping call
                        scraped_data = asyncio.run(scraping_provider.scrape_url(url))

                        # --- ADDED DETAILED LOGGING ---
                        logger.info(f"DS {datasource.id} URL {url}: Scraped data raw type: {type(scraped_data)}")
                        logger.info(f"DS {datasource.id} URL {url}: Scraped data raw content: {str(scraped_data)[:500]}") # Log first 500 chars
                        has_text_content = scraped_data.get("text_content") if isinstance(scraped_data, dict) else None
                        logger.info(f"DS {datasource.id} URL {url}: Has 'text_content' key with truthy value?: {bool(has_text_content)}")
                        # --- END ADDED LOGGING ---

                        # --- CORRECTED CONTENT CHECK ---
                        # Check if scraped_data is a dict first
                        text_content = None
                        if isinstance(scraped_data, dict):
                             # Prioritize top-level text_content if it's truthy
                             top_level_content = scraped_data.get("text_content")
                             if top_level_content:
                                 text_content = top_level_content
                             else:
                                 # Fallback to checking inside original_data
                                 original_data = scraped_data.get("original_data")
                                 if isinstance(original_data, dict):
                                      text_content = original_data.get("text_content")
                        
                        # Now check if we actually got some text_content
                        if text_content: 
                            text_content = text_content.replace('\\\\x00', '').strip() # Clean the final content
                            logger.info(f"DS {datasource.id} URL {url}: Text content after cleaning (first 100 chars): {text_content[:100]}") # Log cleaned text
                            
                            if text_content: # Check if non-empty after stripping
                                event_ts = None
                                pub_date_str = None
                                # Check both top-level and original_data for publication_date
                                if isinstance(scraped_data, dict):
                                     pub_date_str = scraped_data.get("publication_date")
                                     if not pub_date_str and isinstance(scraped_data.get("original_data"), dict):
                                         pub_date_str = scraped_data.get("original_data", {}).get("publication_date")

                                if pub_date_str:
                                    try:
                                        parsed_dt = dateutil.parser.parse(pub_date_str)
                                        if parsed_dt.tzinfo is None: event_ts = parsed_dt.replace(tzinfo=timezone.utc)
                                        else: event_ts = parsed_dt
                                    except Exception as parse_err: logging.warning(f"Could not parse pub_date '{pub_date_str}' for URL in DS {datasource.id}: {parse_err}")

                                url_hash = hashlib.sha256(url.encode()).hexdigest()
                                # Check duplicate directly with session
                                existing_rec = session.exec(select(DataRecord.id).where(DataRecord.datasource_id == datasource_id, DataRecord.url_hash == url_hash)).first()
                                if existing_rec:
                                    logger.debug(f"Skipping duplicate URL {url} for DS {datasource.id}")
                                    continue # Skip this URL

                                record_meta = {'original_url': url, 'scraped_title': scraped_data.get("title"), 'index': i}
                                records_data_to_create.append({
                                    "datasource_id": datasource_id,
                                    "text_content": text_content,
                                    "source_metadata": record_meta,
                                    "event_timestamp": event_ts,
                                    "url_hash": url_hash
                                })
                                processed_count += 1
                            else: error_msg = "No text content after cleaning"
                        else: error_msg = "Scraping yielded no text content"
                    except Exception as scrape_err:
                        error_msg = f"Scraping failed: {scrape_err}"
                        logging.error(f"Error processing URL {url} for DS {datasource.id}: {error_msg}", exc_info=True)

                    if error_msg:
                        logging.warning(f"Skipping URL {url} for DS {datasource.id}: {error_msg}")
                        failed_urls.append({"url": url, "error": error_msg})

                    # Use sync sleep in sync task context
                    time.sleep(0.1) # Use time.sleep

                source_metadata_update = {'url_count': len(urls), 'processed_count': processed_count, 'failed_count': len(failed_urls), 'failed_urls': failed_urls}
                logging.info(f"Processed {processed_count}/{len(urls)} URLs for DS {datasource.id}. Failed: {len(failed_urls)}.")

            elif datasource.type == DataSourceType.TEXT_BLOCK:
                logging.info(f"Processing TEXT_BLOCK DataSource: {datasource.id}")
                # Assuming text content is stored in source_metadata by the creation route
                text_content = actual_origin_details.get('text_content')
                if text_content and isinstance(text_content, str):
                    text_content = text_content.strip()
                    if text_content:
                        # Create a single record
                        records_data_to_create = [{
                            "datasource_id": datasource_id,
                            "text_content": text_content,
                            "source_metadata": {},
                            "event_timestamp": None # Or potentially parse from metadata if available
                        }]
                        source_metadata_update['character_count'] = len(text_content)
                        logging.info(f"Prepared 1 record from TEXT_BLOCK DS {datasource.id}")
                    else:
                        logging.warning(f"TEXT_BLOCK DS {datasource.id} has empty text content after stripping.")
                        source_metadata_update['character_count'] = 0
                else:
                    logging.warning(f"Could not find valid 'text_content' in source_metadata for TEXT_BLOCK DS {datasource.id}")
                    source_metadata_update['character_count'] = 0

            else:
                logging.warning(f"Unsupported datasource type '{datasource.type}' for ingestion task (DS {datasource.id}). Marking as failed.")
                raise NotImplementedError(f"Ingestion for type {datasource.type} not implemented in task.")

            # --- Create DataRecords directly ---
            if records_data_to_create:
                total_records_created = _task_create_records_batch(session, records_data_to_create)
                logging.info(f"Successfully created {total_records_created} DataRecords for DataSource {datasource_id}")
                # --- IMPORTANT for Bulk: Update parent count ---
                # We need to update the parent's count potentially incrementally.
                # This is tricky because tasks run in parallel.
                # Option 1: Update count here (prone to race conditions without locking).
                # Option 2: Have a separate task/mechanism to periodically update counts.
                # Option 3 (Chosen): Update the count at the END of the task, but this only reflects THIS task's records.
                # Let's update based on *this task's* contribution.
                # The final status update might need adjustment for bulk.
                try:
                    # Use a SELECT FOR UPDATE if high concurrency is expected, or accept potential minor inaccuracy
                    # For simplicity, just update based on this task's result:
                    datasource = session.get(DataSource, datasource_id) # Re-fetch latest state
                    if datasource:
                        current_count = datasource.data_record_count or 0
                        datasource.data_record_count = current_count + total_records_created
                        session.add(datasource)
                        session.flush()
                        logging.info(f"Incremented data_record_count on DS {datasource_id} by {total_records_created}")
                    else:
                        logging.warning(f"Could not find DS {datasource_id} to update record count after batch creation.")
                except Exception as count_update_err:
                     logging.error(f"Error updating record count for DS {datasource_id}: {count_update_err}", exc_info=True)

            # === End: Main Processing Logic ===

            # Update final status: For BULK PDF, this logic might need refinement.
            # The parent DS should only be marked COMPLETE when ALL its child tasks are done.
            # This simple approach marks it COMPLETE after the *first* task finishes.
            # A more robust solution would involve tracking task completion (e.g., in Redis, DB).
            # For now, let's stick to the simple approach, but acknowledge the limitation.
            # If *this task* had no errors, mark complete (even if others might fail)
            # --- RE-ADDED FINAL STATUS UPDATE ---
            final_status = DataSourceStatus.COMPLETE # Assume success for this task run
            # Re-fetch datasource before final status update to avoid stale state issues
            datasource_final = session.get(DataSource, datasource_id) 
            if not datasource_final:
                 # Should not happen if we got this far, but safety check
                 raise Exception(f"DataSource {datasource_id} disappeared before final status update.")
                 
            datasource_final = _task_update_datasource_status(
                session,
                datasource_final, # Use the re-fetched object
                final_status, # Mark based on this task's success
                error_message=None, # Clear error on success
                metadata_updates=source_metadata_update # Pass final metadata updates
            )
            logging.info(f"Set final status for DataSource {datasource_id} to {final_status}")
            # --- END RE-ADDED ---

            session.commit()
            logging.info(f"Successfully committed final status and ingestion actions for DataSource {datasource_id}")

        except Exception as e:
            # Log error and rollback transaction
            logger.error(f"Error during ingestion task for DataSource {datasource_id}: {e}", exc_info=True)
            session.rollback()
            # Re-raise the exception to trigger the BaseIngestionTask.on_failure handler
            raise e
        finally:
            # Log execution time
            end_time = time.time()
            logger.info(f"Ingestion task for DataSource ID: {datasource_id} finished in {end_time - start_time:.2f} seconds. Records created: {total_records_created}")

# Run the async process function within the sync task context
# Note: Celery tasks are typically synchronous. We use asyncio.run()
# to execute the async parts (storage/scraping calls) within the sync task.
# However, the overall task execution remains synchronous from Celery's perspective.
# A fully async Celery worker setup might be needed for true async task execution.
# For now, this bridges the gap.

# No need for asyncio.run(process()) here as the task function itself is sync
# and calls asyncio.run internally for specific async operations.
