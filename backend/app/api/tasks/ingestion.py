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
async def _task_process_pdf_content(file_content_bytes: bytes, datasource_id: int, origin_details: dict) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Parses PDF content and returns record data and metadata updates. (Task version)"""
    source_metadata_update = {}
    records_data = []

    def process_pdf_sync():
        nonlocal source_metadata_update
        local_all_pdf_text = ""
        local_total_processed_pages = 0
        local_page_count = 0
        try:
            with fitz.open(stream=file_content_bytes, filetype="pdf") as doc:
                local_page_count = doc.page_count
                for page_num in range(local_page_count):
                    try:
                        page = doc.load_page(page_num)
                        text = page.get_text("text").replace('\\x00', '').strip()
                        if text:
                            local_all_pdf_text += text + "\\n\\n"
                            local_total_processed_pages += 1
                    except Exception as page_err:
                        logging.error(f"Error processing PDF page {page_num + 1} for DS {datasource_id}: {page_err}")
            source_metadata_update['page_count'] = local_page_count
            source_metadata_update['processed_page_count'] = local_total_processed_pages
            return local_all_pdf_text
        except (fitz.PyMuPDFError) as specific_err:
            raise ValueError(f"Failed to open/parse PDF for DS {datasource_id}: {specific_err}") from specific_err
        except Exception as pdf_err:
            raise ValueError(f"Failed processing PDF for DS {datasource_id}: {pdf_err}") from pdf_err

    all_pdf_text = await asyncio.to_thread(process_pdf_sync)

    total_processed_pages = source_metadata_update.get('processed_page_count', 0)
    page_count = source_metadata_update.get('page_count', 0)

    if all_pdf_text:
        records_data = [{
            "datasource_id": datasource_id,
            "text_content": all_pdf_text.strip(),
            "source_metadata": {'processed_page_count': total_processed_pages, 'original_filename': origin_details.get('filename')},
            "event_timestamp": None
        }]
    else:
        logging.warning(f"No text extracted from PDF (DS: {datasource_id}).")

    logging.info(f"Processed PDF: {total_processed_pages}/{page_count} pages (DS: {datasource_id}).")
    return records_data, source_metadata_update
# --- End: PDF Processing Logic ---

# --- Start: CSV Processing Logic Moved from IngestionService ---
async def _task_process_csv_content(file_content_bytes: bytes, datasource_id: int, origin_details: dict) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Parses CSV content and returns record data and metadata updates. (Task version)"""
    source_metadata_update = {}
    records_data = []
    default_encoding = 'utf-8'
    skip_rows = int(origin_details.get('skip_rows', 0))
    if skip_rows < 0: skip_rows = 0
    user_delimiter = origin_details.get('delimiter')
    delimiter = None
    if user_delimiter:
        if user_delimiter == '\\t': delimiter = '\\t'
        elif len(user_delimiter) == 1: delimiter = user_delimiter

    def process_csv_sync():
        nonlocal source_metadata_update
        local_records_data = []
        encoding_used = None
        try:
            file_content_text = file_content_bytes.decode(default_encoding)
            encoding_used = default_encoding
        except UnicodeDecodeError:
            try:
                file_content_text = file_content_bytes.decode('latin-1')
                encoding_used = 'latin-1'
            except UnicodeDecodeError:
                try:
                    detected = chardet.detect(file_content_bytes)
                    if detected['encoding'] and detected['confidence'] > 0.7:
                        encoding_used = detected['encoding']
                        file_content_text = file_content_bytes.decode(encoding_used)
                    else: raise UnicodeDecodeError("chardet", b'', 0, 0, "Low confidence")
                except Exception as chardet_err:
                    raise ValueError(f"Could not determine encoding for CSV (DS {datasource_id}): {chardet_err}") from chardet_err

        source_metadata_update['encoding_used'] = encoding_used

        lines = file_content_text.splitlines()
        if not lines or skip_rows >= len(lines): raise ValueError("No data/header after skip_rows")
        content_lines = lines[skip_rows:]
        if not content_lines: raise ValueError("No lines remaining after skip")
        header_line = content_lines[0]
        data_lines = content_lines[1:]

        local_delimiter = delimiter
        if local_delimiter is None:
            try:
                sniffer = csv.Sniffer()
                dialect = sniffer.sniff("\\n".join(content_lines[:10]))
                local_delimiter = dialect.delimiter
            except csv.Error: local_delimiter = ','
        source_metadata_update['delimiter_used'] = repr(local_delimiter)

        csv_content_for_reader = header_line + '\\n' + '\\n'.join(data_lines)
        csv_data_io = io.StringIO(csv_content_for_reader)
        reader = csv.DictReader(csv_data_io, delimiter=local_delimiter)
        columns = reader.fieldnames
        if not columns: raise ValueError("Could not parse header")
        valid_columns = [col for col in columns if col and col.strip()]
        if len(valid_columns) != len(columns): logging.warning(f"CSV header has empty names (DS {datasource_id})")
        columns = valid_columns
        source_metadata_update['columns'] = columns

        row_count = 0
        field_count_mismatches = 0

        for i, row in enumerate(reader):
            original_file_line_num = skip_rows + 1 + (i + 1)
            if row is None: continue
            if len(row) != len(reader.fieldnames):
                field_count_mismatches += 1
                if field_count_mismatches <= 5: logging.warning(f"Field count mismatch line ~{original_file_line_num} (DS {datasource_id})")

            sanitized_row = _sanitize_csv_row(row)
            sanitized_row_filtered = {k: v for k, v in sanitized_row.items() if k in columns}
            if not sanitized_row_filtered: continue
            text_content = "\\n".join([f"{cn}: {cv}" for cn, cv in sanitized_row_filtered.items()])
            if not text_content.strip(): continue

            event_ts = None
            timestamp_column = origin_details.get('event_timestamp_column')
            if timestamp_column and timestamp_column in sanitized_row_filtered:
                timestamp_str = sanitized_row_filtered[timestamp_column]
                if timestamp_str:
                    try:
                        parsed_dt = dateutil.parser.parse(timestamp_str)
                        if parsed_dt.tzinfo is None: event_ts = parsed_dt.replace(tzinfo=timezone.utc)
                        else: event_ts = parsed_dt
                    except Exception as parse_err: logging.warning(f"Could not parse timestamp '{timestamp_str}' (DS {datasource_id}): {parse_err}")

            record_meta = {'row_number': original_file_line_num, 'source_columns': sanitized_row_filtered}
            local_records_data.append({
                "datasource_id": datasource_id,
                "text_content": text_content,
                "source_metadata": record_meta,
                "event_timestamp": event_ts
            })
            row_count += 1

        source_metadata_update['row_count_processed'] = row_count
        source_metadata_update['field_count_mismatches'] = field_count_mismatches
        logging.info(f"[Sync] Processed {row_count} CSV rows for DS {datasource_id}, {field_count_mismatches} mismatches.")
        return local_records_data

    records_data = await asyncio.to_thread(process_csv_sync)
    return records_data, source_metadata_update
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
def process_datasource(self, datasource_id: int):
    """
    Background task to process a DataSource based on its type,
    extract text content, and create DataRecord entries directly.
    The task manages the database transaction and lets exceptions propagate for handling by on_failure.

    Retries up to 3 times with exponential backoff if the datasource is not found,
    to handle race conditions with transaction commits.
    """
    logging.info(f"Starting ingestion task for DataSource ID: {datasource_id}")
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

            if datasource.status != DataSourceStatus.PENDING:
                logging.warning(f"DataSource {datasource_id} is not PENDING (status: {datasource.status}). Skipping task run.")
                return # Task finishes successfully without doing work

            # === Start: Main Processing Logic ===
            # Update status to PROCESSING (Directly using session)
            datasource = _task_update_datasource_status(session, datasource, DataSourceStatus.PROCESSING)

            # CORRECTED: Read origin_details directly from the datasource object
            origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}

            # --- Process based on type (using internal task helpers) ---
            if datasource.type == DataSourceType.CSV:
                logging.info(f"Processing CSV DataSource: {datasource.id}")
                object_name = origin_details.get('storage_path') # Use storage_path
                if not object_name: raise ValueError(f"Missing 'storage_path' for CSV DS {datasource.id}")
                file_object = None
                try:
                    # Use asyncio.run to call async storage method from sync task
                    async def get_file_content():
                         nonlocal file_object
                         file_object = await storage_provider.get_file(object_name)
                         return file_object.read() # Read the content within async context

                    file_content_bytes = asyncio.run(get_file_content())
                    # Call the async processing helper (also needs asyncio.run)
                    records_data_to_create, source_metadata_update = asyncio.run(
                         _task_process_csv_content(file_content_bytes, datasource_id, origin_details)
                    )
                finally:
                     if file_object:
                         try: asyncio.run(file_object.close()) # Close async if needed
                         except Exception: pass

            elif datasource.type == DataSourceType.PDF:
                logging.info(f"Processing PDF DataSource: {datasource.id}")
                object_name = origin_details.get('storage_path') # Use storage_path
                if not object_name: raise ValueError(f"Missing 'storage_path' for PDF DS {datasource.id}")
                file_object = None
                try:
                    async def get_pdf_content():
                        nonlocal file_object
                        file_object = await storage_provider.get_file(object_name)
                        return file_object.read()

                    pdf_data = asyncio.run(get_pdf_content())
                    records_data_to_create, source_metadata_update = asyncio.run(
                         _task_process_pdf_content(pdf_data, datasource_id, origin_details)
                    )
                finally:
                    if file_object:
                        try: asyncio.run(file_object.close())
                        except Exception: pass

            elif datasource.type == DataSourceType.URL_LIST:
                logging.info(f"Processing URL_LIST DataSource: {datasource.id}")
                # Use the correctly fetched origin_details from above
                urls = origin_details.get('urls') 
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
                text_content = origin_details.get('text_content')
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

            # === End: Main Processing Logic ===

            # Update the final data_record_count on the datasource object before the final status update
            if datasource and total_records_created >= 0: # Ensure we have a count
                 datasource.data_record_count = total_records_created
                 session.add(datasource) # Make sure the change is tracked
                 session.flush() # Flush this update before the final status change
                 logger.info(f"Set final data_record_count to {total_records_created} for DataSource {datasource_id}")

            # Final status update to COMPLETE
            datasource = _task_update_datasource_status(
                session,
                datasource,
                DataSourceStatus.COMPLETE,
                metadata_updates=source_metadata_update
            )

            # Commit the entire transaction
            session.commit()
            logging.info(f"Successfully committed ingestion for DataSource {datasource_id}")

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
