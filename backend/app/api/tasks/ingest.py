import logging
import time
import csv
import io
import fitz
import chardet
import dateutil.parser
from datetime import datetime, timezone
import asyncio
from typing import List, Dict, Any, Tuple, Optional
import traceback
import hashlib

from app.core.celery_app import celery
from sqlmodel import Session, select, func
from sqlalchemy.exc import SQLAlchemyError

from app.core.db import engine
from app.models import (
    Source,
    SourceStatus,
    Asset,
    AssetKind,
)
from app.schemas import AssetCreate

# Import provider instances directly
from app.core.config import settings
from app.api.providers.factory import create_storage_provider, create_scraping_provider
from app.api.providers.base import StorageProvider, ScrapingProvider # Import protocols for type hinting
from app.api.tasks.utils import run_async_in_celery

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
    source_id: int,
    origin_details_override: Optional[Dict[str, Any]] = None,
    actual_source_origin_details: Optional[Dict[str, Any]] = None
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Parses PDF content and returns asset data and metadata updates. (Task version)"""
    source_metadata_update = {}
    effective_origin_details = origin_details_override or actual_source_origin_details or {}
    original_filename_for_record = effective_origin_details.get('filename', 'unknown.pdf')
    should_extract_title = effective_origin_details.get('extract_title', True)

    def process_pdf_sync():
        nonlocal source_metadata_update
        local_all_pdf_text = ""
        local_total_processed_pages = 0
        local_page_count = 0
        local_pdf_title = None
        local_assets_data: List[Dict[str, Any]] = []

        try:
            with fitz.open(stream=file_content_bytes, filetype="pdf") as doc:
                local_page_count = doc.page_count
                if should_extract_title and doc.metadata:
                    local_pdf_title = doc.metadata.get('title')
                    if local_pdf_title:
                        local_pdf_title = local_pdf_title.strip()
                        logging.info(f"Extracted PDF title: '{local_pdf_title}' for Source {source_id}")
                    else:
                        logging.info(f"PDF metadata found but no 'title' key for Source {source_id}")
                
                if not local_pdf_title and original_filename_for_record:
                    local_pdf_title = original_filename_for_record.rsplit('.', 1)[0]

                page_asset_create_list: List[Dict[str, Any]] = []

                for page_num in range(local_page_count):
                    try:
                        page = doc.load_page(page_num)
                        text = page.get_text("text").replace('\\x00', '').strip()
                        if text:
                            page_asset_data = {
                                "title": f"Page {page_num + 1} of {local_pdf_title or 'document'}",
                                "kind": AssetKind.PDF_PAGE,
                                "part_index": page_num,
                                "text_content": text,
                                "source_metadata": {
                                    'original_filename': original_filename_for_record,
                                    'page_number': page_num + 1
                                },
                                "source_id": source_id,
                            }
                            page_asset_create_list.append(page_asset_data)
                            local_all_pdf_text += text + "\\n\\n"
                            local_total_processed_pages += 1
                    except Exception as page_err:
                        logging.error(f"Error processing PDF page {page_num + 1} for Source {source_id}: {page_err}")

                source_metadata_update['page_count'] = local_page_count
                source_metadata_update['processed_page_count'] = local_total_processed_pages
                if local_pdf_title:
                    source_metadata_update['extracted_title'] = local_pdf_title

                if local_all_pdf_text or local_page_count > 0:
                    parent_pdf_asset_data = {
                        "title": local_pdf_title or original_filename_for_record.rsplit('.',1)[0],
                        "kind": AssetKind.PDF,
                        "text_content": local_all_pdf_text.strip() if local_all_pdf_text else None,
                        "source_metadata": { 
                            'original_filename': original_filename_for_record,
                            'page_count': local_page_count,
                            'processed_page_count': local_total_processed_pages
                        },
                        "source_id": source_id,
                    }
                    local_assets_data.append(parent_pdf_asset_data)
                    local_assets_data.extend(page_asset_create_list)

                else:
                    logging.warning(f"No text extracted and zero pages from PDF (Source: {source_id}). No assets created.")

                # Return both assets data and metadata update
                return local_assets_data, source_metadata_update

        except Exception as pdf_err:
            raise ValueError(f"Failed processing PDF for Source {source_id}: {pdf_err}") from pdf_err

    assets_to_create_data, processed_metadata = await asyncio.to_thread(process_pdf_sync)
    logging.info(f"Processed PDF: {processed_metadata.get('processed_page_count', 0)}/{processed_metadata.get('page_count', 0)} pages (Source: {source_id}). Assets to create: {len(assets_to_create_data)}")
    return assets_to_create_data, processed_metadata

# --- End: PDF Processing Logic ---

# --- Start: CSV Processing Logic Moved from IngestionService ---
async def _task_process_csv_content(
    source_id: int,
    storage_path: str,
    origin_details: Dict[str, Any],
    storage_provider: StorageProvider
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    """Helper coroutine to process CSV content from storage."""
    logger.info(f"Processing CSV content for Source {source_id} from {storage_path}")
    asset_create_payloads: List[Dict[str, Any]] = []
    source_metadata_update = {}

    try:
        raw_skip_rows = origin_details.get('skip_rows')
        skip_rows = int(raw_skip_rows) if raw_skip_rows is not None else 0
        raw_delimiter = origin_details.get('delimiter')
        encoding = origin_details.get('encoding', 'utf-8')
        text_column = origin_details.get('text_column')
        title_column = origin_details.get('title_column')

        # Get CSV content first to detect delimiter if not provided
        csv_content_stream = await storage_provider.get_file(storage_path)
        csv_content_bytes = await asyncio.to_thread(csv_content_stream.read)
        csv_content_text = csv_content_bytes.decode(encoding, errors='replace')
        
        # Auto-detect delimiter if not specified
        if raw_delimiter is None:
            try:
                # Use a larger sample for better sniffer detection
                sample_lines = csv_content_text.split('\n')[:50]  # Use more lines for better detection
                sample = '\n'.join(sample_lines)
                sniffer = csv.Sniffer()
                dialect = sniffer.sniff(sample, delimiters=',;\t|')
                delimiter = dialect.delimiter
                
                # Validate the detected delimiter by checking consistency
                test_reader = csv.reader(sample_lines[:10], delimiter=delimiter)
                test_rows = [row for row in test_reader if row]
                if len(test_rows) >= 2:
                    field_counts = [len(row) for row in test_rows]
                    # Check if field counts are consistent (within reasonable range)
                    min_fields, max_fields = min(field_counts), max(field_counts)
                    if max_fields > 1 and (max_fields - min_fields) <= 2:  # Allow small variation
                        logger.info(f"Auto-detected CSV delimiter '{delimiter}' using sniffer for Source {source_id} (validated with {len(test_rows)} rows)")
                    else:
                        raise csv.Error("Inconsistent field counts with sniffer-detected delimiter")
                else:
                    raise csv.Error("Insufficient data to validate sniffer result")
                    
            except csv.Error:
                logger.warning(f"CSV sniffer could not detect delimiter for Source {source_id}. Falling back to manual check.")
                # Enhanced manual delimiter detection
                lines_for_detection = csv_content_text.split('\n')[:20]  # Use more lines
                # Filter out empty lines for better detection
                lines_for_detection = [line for line in lines_for_detection if line.strip()]
                
                if len(lines_for_detection) < 2:
                    delimiter = ','  # Fallback if insufficient data
                    logger.warning(f"Insufficient data for delimiter detection in Source {source_id}, using comma as fallback")
                else:
                    sample_text = '\n'.join(lines_for_detection[:10])  # Use first 10 non-empty lines
                    
                    # Try common delimiters and score them
                    delimiter_candidates = [',', ';', '\t', '|', ':', '~']
                    delimiter_scores = {}
                    
                    for candidate in delimiter_candidates:
                        try:
                            reader = csv.reader(lines_for_detection, delimiter=candidate)
                            rows = [row for row in reader if row]  # Filter empty rows
                            
                            if len(rows) >= 2:  # Need at least header + 1 data row
                                field_counts = [len(row) for row in rows if any(cell.strip() for cell in row)]
                                
                                if field_counts:
                                    # Score based on consistency and field count
                                    min_fields, max_fields = min(field_counts), max(field_counts)
                                    avg_fields = sum(field_counts) / len(field_counts)
                                    
                                    # Better scoring: prefer higher field counts with consistency
                                    if avg_fields > 1:  # Must have more than 1 field
                                        consistency_score = 1.0 / (1.0 + (max_fields - min_fields))  # Higher for more consistent
                                        field_count_score = min(avg_fields / 10.0, 1.0)  # Normalize field count bonus
                                        final_score = consistency_score * 0.7 + field_count_score * 0.3
                                        delimiter_scores[candidate] = {
                                            'score': final_score,
                                            'avg_fields': avg_fields,
                                            'consistency': consistency_score,
                                            'field_range': f"{min_fields}-{max_fields}"
                                        }
                        except Exception:
                            continue
                    
                    if delimiter_scores:
                        # Choose delimiter with highest score
                        best_delimiter = max(delimiter_scores.items(), key=lambda x: x[1]['score'])[0]
                        best_info = delimiter_scores[best_delimiter]
                        delimiter = best_delimiter
                        logger.info(f"Auto-detected CSV delimiter '{delimiter}' for Source {source_id} "
                                  f"(avg_fields: {best_info['avg_fields']:.1f}, range: {best_info['field_range']}, "
                                  f"score: {best_info['score']:.3f})")
                        logger.debug(f"All delimiter scores for Source {source_id}: {delimiter_scores}")
                    else:
                        delimiter = ','  # Fallback to comma
                        logger.warning(f"Could not auto-detect CSV delimiter for Source {source_id}, using comma as fallback")
        else:
            delimiter = raw_delimiter

        logger.debug(f"Source {source_id}: CSV options - skip_rows={skip_rows}, delimiter='{delimiter}', encoding='{encoding}', text_column='{text_column}', title_column='{title_column}'")

        # Process CSV content
        csv_reader = csv.reader(csv_content_text.split('\n'), delimiter=delimiter)

        # Skip initial rows
        for _ in range(skip_rows):
            try:
                next(csv_reader)
            except StopIteration:
                logger.warning(f"CSV for Source {source_id} has fewer rows than skip_rows={skip_rows}. No data to process.")
                return [], {"rows_skipped": skip_rows, "row_count_processed": 0}

        # Process header row
        try:
            header = [h.strip() for h in next(csv_reader) if h.strip()]
            if not header:
                raise ValueError("CSV header is empty or invalid after stripping.")
        except StopIteration:
            logger.error(f"CSV file for Source {source_id} is empty or has no header after skipping rows.")
            raise ValueError("CSV is empty or has no header.")

        if len(header) == 1 and delimiter != ',':
            logger.warning(f"CSV for Source {source_id} has only 1 column with delimiter '{delimiter}'. Header: {header}")
        
        source_metadata_update['columns'] = header
        source_metadata_update['delimiter_used'] = delimiter
        source_metadata_update['delimiter_auto_detected'] = raw_delimiter is None
        source_metadata_update['encoding_used'] = encoding
        source_metadata_update['rows_skipped'] = skip_rows
        
        title_column_index = -1
        if title_column and title_column in header:
            title_column_index = header.index(title_column)
        elif not title_column and header:
            title_column_index = 0

        processed_row_count = 0
        data_row_index = 0
        
        for row in csv_reader:
            # Skip empty rows
            if not any(cell.strip() for cell in row if cell):
                continue

            # Ensure row has enough fields, pad with empty strings if needed
            while len(row) < len(header):
                row.append('')

            if len(row) > len(header):
                current_row_number_for_log = skip_rows + data_row_index + 2 # +1 for header, +1 for 1-based index
                logger.warning(f"Row {current_row_number_for_log} in Source {source_id} has more fields ({len(row)}) than header ({len(header)}). Truncating excess fields.")
                row = row[:len(header)]
            
            row_data = {header[j]: (row[j].strip() if row[j] is not None else '') for j in range(len(header))}

            record_title = None
            if title_column_index != -1 and title_column_index < len(row):
                 record_title = row[title_column_index].strip()
            if not record_title:
                 record_title = f"Row {data_row_index + 1} from Source {source_id}"
            
            text_content_value = f"| {' | '.join(cell.strip() for cell in row)} |"

            asset_payload = {
                "title": record_title,
                "kind": AssetKind.CSV_ROW,
                "part_index": data_row_index,
                "text_content": text_content_value,
                "source_metadata": {
                    'row_number': skip_rows + data_row_index + 2, # +1 header, +1 for 1-based index
                    'data_row_index': data_row_index,
                    'original_row_data': row_data
                },
                "source_id": source_id,
            }
            asset_create_payloads.append(asset_payload)
            processed_row_count += 1
            data_row_index += 1

            if processed_row_count % 1000 == 0:
                logger.info(f"[Async] Processed {processed_row_count} CSV rows for Source {source_id}")

        logger.info(f"[Sync] Processed {processed_row_count} CSV rows for Source {source_id} with {len(header)} columns using delimiter '{delimiter}'")
        source_metadata_update['row_count_processed'] = processed_row_count
        source_metadata_update['column_count'] = len(header)

    except FileNotFoundError:
        logger.error(f"CSV file not found in storage for Source {source_id} at path {storage_path}")
        raise
    except UnicodeDecodeError as e:
        logger.error(f"Encoding error processing CSV for Source {source_id} with encoding '{encoding}': {e}")
        raise ValueError(f"Encoding error ({encoding}). Please check file encoding or specify a different one.") from e
    except csv.Error as e:
        logger.error(f"CSV parsing error for Source {source_id} (delimiter='{delimiter}'): {e}")
        raise ValueError(f"CSV parsing error. Check delimiter ('{delimiter}') and file format.") from e
    except Exception as e:
        logger.exception(f"Unexpected error processing CSV content for Source {source_id}: {e}")
        raise 

    return asset_create_payloads, source_metadata_update

# --- End: CSV Processing Logic ---

# --- Start: Asset Batch Creation Logic (was Record Batch Creation) ---
def _task_create_assets_batch(session: Session, asset_create_payloads: List[Dict[str, Any]], source_infospace_id: int, source_user_id: int, parent_asset_id_for_children: Optional[int] = None) -> int:
    """Creates Assets in batch using the provided session. (Task version)"""
    if not asset_create_payloads:
        return 0

    assets_to_add: List[Asset] = []
    count = 0
    source_id_for_log = asset_create_payloads[0].get("source_id", "None") if asset_create_payloads else "N/A"

    for asset_dict in asset_create_payloads:
        try:
            asset_dict["infospace_id"] = source_infospace_id
            asset_dict["user_id"] = source_user_id
            
            # Set parent_asset_id for child asset types (CSV_ROW and PDF_PAGE)
            if parent_asset_id_for_children and asset_dict.get("kind") in [AssetKind.CSV_ROW, AssetKind.PDF_PAGE]:
                asset_dict["parent_asset_id"] = parent_asset_id_for_children

            # Handle source_id - if it's None, don't set it (let the database handle the nullable foreign key)
            if "source_id" not in asset_dict or asset_dict.get("source_id") is None:
                asset_dict.pop("source_id", None)  # Remove source_id if it's None

            db_asset = Asset(**asset_dict)
            assets_to_add.append(db_asset)
            count += 1
        except Exception as validation_err:
            logger.error(f"Validation error creating Asset for Source {source_id_for_log}: {asset_dict}, Error: {validation_err}", exc_info=True)

    if assets_to_add:
        logger.info(f"Adding batch of {len(assets_to_add)} assets to session for Source {source_id_for_log}.")
        session.add_all(assets_to_add)
        try:
            session.flush()
            logger.info(f"Flushed batch of {len(assets_to_add)} assets for Source {source_id_for_log}.")
        except Exception as e:
            logger.error(f"Failed to flush batch create for Source {source_id_for_log}: {e}")
            raise 
    return count
# --- End: Asset Batch Creation Logic ---


# --- Start: Source Status Update Logic ---
def _task_update_source_status(
    session: Session,
    source_obj: Source,
    status: SourceStatus,
    error_message: Optional[str] = None,
    metadata_updates: Optional[Dict[str, Any]] = None,
) -> Source:
    """Updates the status and optionally metadata of a Source using the provided session. (Task version)"""
    try:
        logger.info(f"Updating Source {source_obj.id} status to {status}")
        source_obj.status = status
        if error_message is not None:
            source_obj.error_message = error_message
        if metadata_updates:
            current_metadata = source_obj.source_metadata or {}
            current_metadata.update(metadata_updates)
            source_obj.source_metadata = current_metadata

        session.add(source_obj)
        session.flush()
        session.refresh(source_obj)
        logger.info(f"Flushed status update for Source {source_obj.id} to {status}")
        return source_obj
    except SQLAlchemyError as e:
        logger.error(f"Failed to flush status update for Source {source_obj.id}: {e}")
        raise 
    except Exception as e:
        logger.exception(f"Unexpected error updating Source {source_obj.id} status: {e}")
        raise
# --- End: Source Status Update Logic ---


# Base Task Class for Failure Handling
class BaseIngestionTask(celery.Task):
    def on_failure(self, exc, task_id, args, kwargs, einfo):
        logger.error(f'Celery task {task_id} failed: {exc!r}')
        source_id = args[0] if args else None # Assuming source_id is the first arg
        if source_id:
            logger.info(f"Attempting to mark Source {source_id} as FAILED due to task failure.")
            try:
                with Session(engine) as fail_session:
                    source_obj = fail_session.get(Source, source_id)
                    if source_obj:
                        error_message = f"Task failed: {type(exc).__name__}: {str(exc)[:250]}"
                        _task_update_source_status(
                            session=fail_session,
                            source_obj=source_obj,
                            status=SourceStatus.FAILED,
                            error_message=error_message
                        )
                        fail_session.commit()
                        logger.info(f"Successfully marked Source {source_id} as FAILED.")
                    else:
                        logger.error(f"Source {source_id} not found during on_failure handling.")
            except Exception as fail_update_e:
                logger.error(f"CRITICAL: Failed to update Source {source_id} status to FAILED during on_failure: {fail_update_e}", exc_info=True)
        else:
            logger.error("Could not determine source_id from task arguments for failure handling.")


@celery.task(bind=True, max_retries=3, base=BaseIngestionTask, autoretry_for=(ValueError,), retry_backoff=True, retry_backoff_max=60)
def process_source(self, source_id: int, task_origin_details_override: Optional[Dict[str, Any]] = None):
    """
    Background task to process a Source based on its kind,
    extract text content, and create Asset entries directly.
    Accepts optional origin_details_override for specific file processing (e.g., bulk PDF).
    The task manages the database transaction and lets exceptions propagate for handling by on_failure.
    Retries up to 3 times if the source is not found.
    """
    logging.info(f"Starting ingestion task for Source ID: {source_id}")
    if task_origin_details_override:
        logging.info(f"Task received origin_details_override: {task_origin_details_override}")
    start_time = time.time()
    total_assets_created = 0

    storage_provider: StorageProvider = create_storage_provider(settings=settings)
    scraping_provider: ScrapingProvider = create_scraping_provider(settings=settings)

    with Session(engine) as session:
        source_obj = None
        asset_creation_payloads: List[Dict[str, Any]] = []
        processed_source_metadata_update: Dict[str, Any] = {}

        try:
            source_obj = session.get(Source, source_id)

            if not source_obj:
                logging.warning(f"Source {source_id} not found. Will retry. Attempt {self.request.retries + 1} of {self.max_retries + 1}")
                raise ValueError(f"Source {source_id} not found.")

            if source_obj.status != SourceStatus.PENDING and not task_origin_details_override:
                logging.warning(f"Source {source_id} status is {source_obj.status} and no override present. Skipping task run.")
                return 
            elif source_obj.status == SourceStatus.FAILED:
                 logging.warning(f"Source {source_id} is FAILED. Skipping task run.")
                 return

            if source_obj.status == SourceStatus.PENDING:
                source_obj = _task_update_source_status(session, source_obj, SourceStatus.PROCESSING)
            
            actual_source_details = source_obj.details if isinstance(source_obj.details, dict) else {}
            source_infospace_id = source_obj.infospace_id
            source_user_id = source_obj.user_id

            if source_obj.kind == "upload_csv":
                logging.info(f"Processing CSV Source: {source_obj.id}")
                object_name = actual_source_details.get('storage_path')
                if not object_name: raise ValueError(f"Missing 'storage_path' for CSV Source {source_obj.id}")
                asset_creation_payloads, processed_source_metadata_update = run_async_in_celery(
                     _task_process_csv_content,
                     source_id=source_id,
                     storage_path=object_name,
                     origin_details=actual_source_details,
                     storage_provider=storage_provider
                 )
                if asset_creation_payloads:
                    parent_csv_asset_title = actual_source_details.get('filename', f"CSV Data from Source {source_id}")
                    parent_csv_asset_payload = {
                        "title": parent_csv_asset_title,
                        "kind": AssetKind.CSV,
                        "source_id": source_id,
                        "infospace_id": source_infospace_id,
                        "user_id": source_user_id,
                        "source_metadata": { 
                            'columns': processed_source_metadata_update.get('columns', []),
                            'row_count': processed_source_metadata_update.get('row_count_processed', 0),
                            'delimiter_used': processed_source_metadata_update.get('delimiter_used', ','),
                            'encoding_used': processed_source_metadata_update.get('encoding_used', 'utf-8')
                        }
                    }
                    db_parent_csv_asset = Asset(**parent_csv_asset_payload)
                    session.add(db_parent_csv_asset)
                    session.flush()
                    
                    total_assets_created += 1  # Count the parent asset
                    total_assets_created += _task_create_assets_batch(session, asset_creation_payloads, source_infospace_id, source_user_id, parent_asset_id_for_children=db_parent_csv_asset.id)
                    asset_creation_payloads = []
                

            elif source_obj.kind == "upload_pdf":
                logging.info(f"Processing PDF Source: {source_obj.id}")
                effective_origin_details = task_origin_details_override or actual_source_details
                object_name = effective_origin_details.get('storage_path')
                if not object_name:
                    missing_detail = "task_origin_details_override" if task_origin_details_override else "source.details"
                    raise ValueError(f"Missing 'storage_path' in {missing_detail} for PDF Source {source_obj.id}")
                file_object = None
                try:
                    async def get_pdf_content():
                        nonlocal file_object
                        file_object = await storage_provider.get_file(object_name)
                        return await asyncio.to_thread(file_object.read)

                    pdf_bytes_content = run_async_in_celery(get_pdf_content)
                    all_pdf_asset_payloads, processed_source_metadata_update = run_async_in_celery(
                         _task_process_pdf_content,
                         pdf_bytes_content,
                         source_id,
                         origin_details_override=task_origin_details_override,
                         actual_source_origin_details=actual_source_details
                     )
                    if all_pdf_asset_payloads:
                        parent_pdf_asset_payload = all_pdf_asset_payloads[0]
                        page_asset_payloads = all_pdf_asset_payloads[1:]

                        parent_pdf_asset_payload["infospace_id"] = source_infospace_id
                        parent_pdf_asset_payload["user_id"] = source_user_id
                        db_parent_pdf_asset = Asset(**parent_pdf_asset_payload)
                        session.add(db_parent_pdf_asset)
                        session.flush()
                        total_assets_created += 1

                        if page_asset_payloads:
                            total_assets_created += _task_create_assets_batch(session, page_asset_payloads, source_infospace_id, source_user_id, parent_asset_id_for_children=db_parent_pdf_asset.id)
                    asset_creation_payloads = []

                finally:
                    if file_object and hasattr(file_object, 'close'):
                        try: 
                            run_async_in_celery(asyncio.to_thread, file_object.close)
                        except Exception: 
                            pass
            
            elif source_obj.kind == "url_list_scrape":
                logging.info(f"Processing URL_LIST Source: {source_obj.id}")
                urls = actual_source_details.get('urls')
                if not urls or not isinstance(urls, list): raise ValueError(f"Missing/invalid 'urls' list for Source {source_obj.id}")
                processed_url_count = 0
                failed_urls_info: List[Dict[str, str]] = []
                
                temp_asset_payloads_for_urls = []

                for i, url in enumerate(urls):
                    error_msg_url = None
                    record_title_url = None 
                    try:
                        scraped_data_url = run_async_in_celery(scraping_provider.scrape_url, url)
                        
                        text_content_url = None
                        if isinstance(scraped_data_url, dict):
                             top_level_content_url = scraped_data_url.get("text_content")
                             if top_level_content_url:
                                 text_content_url = top_level_content_url
                             else:
                                 original_data_url = scraped_data_url.get("original_data")
                                 if isinstance(original_data_url, dict):
                                      text_content_url = original_data_url.get("text_content")
                             record_title_url = scraped_data_url.get("title")
                             if record_title_url: record_title_url = record_title_url.strip()
                             if not record_title_url: record_title_url = url 

                        if text_content_url:
                            text_content_url = text_content_url.replace('\\x00', '').strip()
                            if text_content_url: 
                                event_ts_url = None
                                pub_date_str_url = None
                                if isinstance(scraped_data_url, dict):
                                     pub_date_str_url = scraped_data_url.get("publication_date")
                                     if not pub_date_str_url and isinstance(scraped_data_url.get("original_data"), dict):
                                         pub_date_str_url = scraped_data_url.get("original_data", {}).get("publication_date")

                                if pub_date_str_url:
                                    try:
                                        parsed_dt_url = dateutil.parser.parse(pub_date_str_url)
                                        if parsed_dt_url.tzinfo is None: event_ts_url = parsed_dt_url.replace(tzinfo=timezone.utc)
                                        else: event_ts_url = parsed_dt_url
                                    except Exception as parse_err_url: logging.warning(f"Could not parse pub_date '{pub_date_str_url}' for URL in Source {source_obj.id}: {parse_err_url}")

                                url_hash_val = hashlib.sha256(url.encode()).hexdigest()
                                existing_asset_stmt = select(Asset.id).where(
                                    Asset.source_id == source_id, 
                                    Asset.kind == AssetKind.WEB, 
                                    Asset.source_identifier == url
                                )
                                if session.exec(existing_asset_stmt).first():
                                    logger.debug(f"Skipping duplicate URL (Asset exists) {url} for Source {source_obj.id}")
                                    continue 

                                asset_meta_url = {'original_url': url, 'scraped_title': scraped_data_url.get("title"), 'index': i}
                                temp_asset_payloads_for_urls.append({
                                    "title": record_title_url, 
                                    "kind": AssetKind.WEB,
                                    "text_content": text_content_url,
                                    "source_metadata": asset_meta_url,
                                    "event_timestamp": event_ts_url,
                                    "source_identifier": url,
                                    "source_id": source_id,
                                })
                                processed_url_count += 1
                            else: error_msg_url = "No text content after cleaning"
                        else: error_msg_url = "Scraping yielded no text content"
                    except Exception as scrape_err_url:
                        error_msg_url = f"Scraping failed: {scrape_err_url}"
                        logging.error(f"Error processing URL {url} for Source {source_obj.id}: {error_msg_url}", exc_info=True)

                    if error_msg_url:
                        logging.warning(f"Skipping URL {url} for Source {source_obj.id}: {error_msg_url}")
                        failed_urls_info.append({"url": url, "error": error_msg_url})

                    time.sleep(0.1)
                
                asset_creation_payloads.extend(temp_asset_payloads_for_urls)
                processed_source_metadata_update = {'url_count': len(urls), 'processed_count': processed_url_count, 'failed_count': len(failed_urls_info), 'failed_urls': failed_urls_info}
                logging.info(f"Processed {processed_url_count}/{len(urls)} URLs for Source {source_obj.id}. Failed: {len(failed_urls_info)}.")

            elif source_obj.kind == "text_block_ingest":
                logging.info(f"Processing TEXT_BLOCK Source: {source_obj.id}")
                text_content_block = actual_source_details.get('text_content')
                record_title_block = actual_source_details.get('title')  
                if text_content_block and isinstance(text_content_block, str):
                    text_content_block = text_content_block.strip()
                    if text_content_block:
                        asset_creation_payloads = [{
                            "title": record_title_block or "Text Block Asset", 
                            "kind": AssetKind.TEXT_CHUNK,
                            "text_content": text_content_block,
                            "source_metadata": {},
                            "source_id": source_id,
                        }]
                        processed_source_metadata_update['character_count'] = len(text_content_block)
                        logging.info(f"Prepared 1 asset from TEXT_BLOCK Source {source_obj.id}")
                    else:
                        logging.warning(f"TEXT_BLOCK Source {source_obj.id} has empty text content after stripping.")
                        processed_source_metadata_update['character_count'] = 0
                else:
                    logging.warning(f"Could not find valid 'text_content' in details for TEXT_BLOCK Source {source_obj.id}")
                    processed_source_metadata_update['character_count'] = 0

            else:
                logging.warning(f"Unsupported Source kind '{source_obj.kind}' for ingestion task (Source {source_obj.id}). Marking as failed.")
                raise NotImplementedError(f"Ingestion for Source kind {source_obj.kind} not implemented in task.")

            if asset_creation_payloads:
                total_assets_created += _task_create_assets_batch(session, asset_creation_payloads, source_infospace_id, source_user_id)
                logging.info(f"Successfully created {total_assets_created} Assets for Source {source_id}")
                
            final_status_update = SourceStatus.COMPLETE 
            source_obj_final = session.get(Source, source_id) 
            if not source_obj_final:
                 raise Exception(f"Source {source_id} disappeared before final status update.")
                 
            source_obj_final = _task_update_source_status(
                session,
                source_obj_final, 
                final_status_update, 
                error_message=None, 
                metadata_updates=processed_source_metadata_update 
            )
            logging.info(f"Set final status for Source {source_id} to {final_status_update}")

            session.commit()
            logging.info(f"Successfully committed final status and ingestion actions for Source {source_id}")

        except Exception as e:
            logger.error(f"Error during ingestion task for Source {source_id}: {e}", exc_info=True)
            session.rollback()
            raise e
        finally:
            end_time = time.time()
            logger.info(f"Ingestion task for Source ID: {source_id} finished in {end_time - start_time:.2f} seconds. Assets created: {total_assets_created}")
