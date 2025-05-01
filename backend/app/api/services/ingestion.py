"""
Ingestion service.

This module contains the business logic for data ingestion operations,
abstracting the underlying implementation details from the API layer.
"""
import logging
import hashlib
import json
import uuid # Added for export/import
import fitz # PyMuPDF for metadata extraction
from typing import Any, Dict, List, Optional, Union, Tuple, Literal
from datetime import datetime, timezone
import io
import csv
import asyncio # Add asyncio import
import chardet # Added for CSV processing helper
import dateutil.parser # Added for CSV processing helper
from werkzeug.utils import secure_filename 

from sqlmodel import Session, select, func
from fastapi import UploadFile, HTTPException, status # Added status

from app.models import (
    DataSource,
    DataSourceType,
    DataSourceStatus,
    DataRecord,
    DataRecordCreate,
    Workspace,
    User,
    DataSourceRead,
    DataSourceUpdate,
    CsvRowsOut,
    CsvRowData,
    ClassificationResult, # Added for export/import
    DataSourceTransferRequest, # Add new model
    DataSourceTransferResponse, # Add new model
    DataRecordUpdate,
)
from app.api.services.providers.base import StorageProvider, ScrapingProvider
from app.api.services.service_utils import validate_workspace_access
from app.api.tasks.ingestion import process_datasource

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


# --- Helper Function (Moved from route for PDF metadata) ---
def _extract_pdf_metadata_sync(file_content: bytes, filename: str) -> Dict[str, Any]:
    """Synchronous helper to extract PDF metadata."""
    try:
        with fitz.open(stream=file_content, filetype="pdf") as doc:
            metadata = doc.metadata
            title = metadata.get("title", "")

            # Try extracting title from first page if not in metadata
            if not title and doc.page_count > 0:
                first_page = doc[0]
                first_page_text = first_page.get_text()
                lines = [line.strip() for line in first_page_text.split('\n') if line.strip()]
                if lines and len(lines[0]) < 100:
                    title = lines[0]

            return {
                "title": title or filename.replace(".pdf", ""), # Fallback to filename
                "author": metadata.get("author", ""),
                "subject": metadata.get("subject", ""),
                "page_count": doc.page_count
            }
    except Exception as e:
        logging.error(f"_extract_pdf_metadata_sync failed for {filename}: {e}", exc_info=True)
        # Return default values on error
        return {"title": filename.replace(".pdf", ""), "page_count": 0}
# --- End Helper Function ---


class IngestionService:
    """
    Service for handling data ingestion operations.
    """
    
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        scraping_provider: ScrapingProvider
    ):
        """
        Initialize the ingestion service.
        Requires a database session and providers.
        """
        self.session = session
        self.storage = storage_provider
        self.scraper = scraping_provider
        logger.info("Ingestion service initialized")
    
    # --- Added: Private Helper for CSV Row Sanitization ---
    def _sanitize_csv_row(self, row_dict: Dict[str, Any]) -> Dict[str, Optional[str]]:
        """Removes null bytes and strips whitespace from CSV row values."""
        sanitized = {}
        for key, value in row_dict.items():
            if isinstance(value, str):
                # Remove null bytes and strip leading/trailing whitespace
                sanitized_value = value.replace('\x00', '').strip()
                sanitized[key] = sanitized_value if sanitized_value else None
            else:
                sanitized[key] = value # Keep non-string values as is
        return sanitized
    # --- End Added Helper ---
    
    # --- Start: Private Helper for CSV Processing ---
    async def _process_csv_content(self, file_content_bytes: bytes, datasource_id: int, origin_details: dict) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Parses CSV content and returns record data and metadata updates."""
        source_metadata_update = {}
        records_data = []
        default_encoding = 'utf-8'
        skip_rows = int(origin_details.get('skip_rows', 0))
        if skip_rows < 0: skip_rows = 0
        user_delimiter = origin_details.get('delimiter')
        delimiter = None
        if user_delimiter:
            if user_delimiter == '\\t': delimiter = '\t'
            elif len(user_delimiter) == 1: delimiter = user_delimiter

        # Wrap synchronous parts in a function for asyncio.to_thread
        def process_csv_sync():
            nonlocal source_metadata_update # Allow modification
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
                        raise ValueError(f"Could not determine encoding for CSV: {chardet_err}") from chardet_err
            
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
                    dialect = sniffer.sniff("\n".join(content_lines[:10]))
                    local_delimiter = dialect.delimiter
                except csv.Error: local_delimiter = ','
            source_metadata_update['delimiter_used'] = repr(local_delimiter)

            csv_content_for_reader = header_line + '\n' + '\n'.join(data_lines)
            csv_data_io = io.StringIO(csv_content_for_reader)
            reader = csv.DictReader(csv_data_io, delimiter=local_delimiter)
            columns = reader.fieldnames
            if not columns: raise ValueError("Could not parse header")
            valid_columns = [col for col in columns if col and col.strip()]
            if len(valid_columns) != len(columns): logging.warning("CSV header has empty names")
            columns = valid_columns
            source_metadata_update['columns'] = columns

            row_count = 0
            field_count_mismatches = 0

            for i, row in enumerate(reader):
                original_file_line_num = skip_rows + 1 + (i + 1)
                if row is None: continue
                if len(row) != len(reader.fieldnames):
                    field_count_mismatches += 1
                    if field_count_mismatches <= 5: logging.warning(f"Field count mismatch line ~{original_file_line_num}")

                sanitized_row = self._sanitize_csv_row(row)
                sanitized_row_filtered = {k: v for k, v in sanitized_row.items() if k in columns}
                if not sanitized_row_filtered: continue
                text_content = "\n".join([f"{cn}: {cv}" for cn, cv in sanitized_row_filtered.items()])
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
                        except Exception as parse_err: logging.warning(f"Could not parse timestamp '{timestamp_str}': {parse_err}")

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
            logging.info(f"[Sync] Processed {row_count} CSV rows, {field_count_mismatches} mismatches.")
            return local_records_data
        
        # Run the synchronous part in a thread
        records_data = await asyncio.to_thread(process_csv_sync)
        return records_data, source_metadata_update
    # --- End: Private Helper for CSV Processing ---
    
    # --- Start: Private Helper for PDF Processing ---
    async def _process_pdf_content(self, file_content_bytes: bytes, datasource_id: int, origin_details: dict) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
        """Parses PDF content and returns record data and metadata updates."""
        source_metadata_update = {}
        records_data = []

        # Wrap synchronous fitz processing
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
                            text = page.get_text("text").replace('\x00', '').strip()
                            if text:
                                local_all_pdf_text += text + "\n\n"
                                local_total_processed_pages += 1
                        except Exception as page_err:
                            logging.error(f"Error processing PDF page {page_num + 1}: {page_err}")
                source_metadata_update['page_count'] = local_page_count
                source_metadata_update['processed_page_count'] = local_total_processed_pages
                return local_all_pdf_text
            except (fitz.PyMuPDFError) as specific_err:
                raise ValueError(f"Failed to open/parse PDF: {specific_err}") from specific_err
            except Exception as pdf_err:
                raise ValueError(f"Failed processing PDF: {pdf_err}") from pdf_err

        all_pdf_text = await asyncio.to_thread(process_pdf_sync)
        
        # Use updated metadata
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
    # --- End: Private Helper for PDF Processing ---

    async def create_datasource(
        self,
        workspace_id: int,
        user_id: int,
        name: str,
        type: DataSourceType,
        origin_details_str: Optional[str] = "{}",
        files: Optional[List[UploadFile]] = None,
        skip_rows: Optional[int] = 0,
        delimiter: Optional[str] = None
    ) -> List[DataSource]: # Return list for bulk PDF
        """
        Create a new DataSource. Does not commit - caller must commit the transaction.
        
        Args:
            workspace_id: ID of the workspace
            user_id: ID of the creating user
            name: Name for the datasource
            type: Type of datasource (CSV, PDF, etc.)
            origin_details_str: JSON string of additional parameters
            files: Uploaded files (can be multiple for BULK_PDF)
            skip_rows: Number of rows to skip for CSV (default 0)
            delimiter: Override delimiter for CSV
            
        Returns:
            List of created DataSource objects
            
        Raises:
            ValueError: For validation errors
        """
        # Validate workspace access
        validate_workspace_access(self.session, workspace_id, user_id)
        
        # Parse origin details
        try:
            origin_details = json.loads(origin_details_str) if origin_details_str else {}
        except json.JSONDecodeError as e:
            raise ValueError(f"Invalid origin_details JSON: {e}")
        
        # For CSV/PDF, make sure files are provided
        if type in [DataSourceType.CSV, DataSourceType.BULK_PDF, DataSourceType.PDF]:
            if not files:
                raise ValueError(f"Files are required for datasource type: {type}")
        
        # Add common parameters to origin_details
        if skip_rows and type == DataSourceType.CSV:
            origin_details['skip_rows'] = skip_rows
        if delimiter and type == DataSourceType.CSV:
            origin_details['delimiter'] = delimiter
        
        created_sources = []
        uploaded_object_details = []
        
        try:
            # Handle creation differently based on type
            if type == DataSourceType.CSV:
                # Single CSV file case
                if len(files) != 1:
                    raise ValueError("Exactly one file required for CSV datasource")
                
                file = files[0]
                # Generate a unique storage path for this file
                object_name = f"datasources/{uuid.uuid4()}/{secure_filename(file.filename)}"
                temp_object_name = f"temp/{object_name}"
                
                # First upload to temporary location
                await self.storage.upload_file(file, temp_object_name)
                uploaded_object_details.append({'file': file, 'temp_name': temp_object_name, 'final_name': object_name})
                
                # Add storage information to metadata
                origin_details['filename'] = file.filename
                origin_details['storage_path'] = object_name
                origin_details['content_type'] = file.content_type
                # Store skip_rows and delimiter if provided for CSV
                if type == DataSourceType.CSV:
                    if skip_rows is not None:
                        origin_details['skip_rows'] = skip_rows
                    if delimiter is not None:
                        origin_details['delimiter'] = delimiter
                
                # Create the DataSource object
                datasource = DataSource(
                    name=name,
                    type=type,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    status=DataSourceStatus.PENDING,
                    source_metadata=origin_details,
                    origin_details=origin_details
                )
                self.session.add(datasource)
                # Flush to get ID but don't commit yet
                self.session.flush()
                created_sources.append(datasource)
                
                # Move from temp to final location
                await self.storage.move_file(temp_object_name, object_name)
                # Update details to indicate file is moved
                for detail in uploaded_object_details:
                    if detail['temp_name'] == temp_object_name:
                        detail['temp_name'] = None # Mark as moved
            
            elif type == DataSourceType.PDF:
                # Single PDF file case
                if len(files) != 1:
                    raise ValueError("Exactly one file required for PDF datasource")
                
                file = files[0]
                # Similar pattern to CSV
                object_name = f"datasources/{uuid.uuid4()}/{secure_filename(file.filename)}"
                temp_object_name = f"temp/{object_name}"
                
                await self.storage.upload_file(file, temp_object_name)
                uploaded_object_details.append({'file': file, 'temp_name': temp_object_name, 'final_name': object_name})
                
                origin_details['filename'] = file.filename
                origin_details['storage_path'] = object_name
                origin_details['content_type'] = file.content_type
                
                datasource = DataSource(
                    name=name,
                    type=type,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    status=DataSourceStatus.PENDING,
                    origin_details=origin_details
                )
                self.session.add(datasource)
                self.session.flush() # Get ID but don't commit
                created_sources.append(datasource)
                
                await self.storage.move_file(temp_object_name, object_name)
                for detail in uploaded_object_details:
                    if detail['temp_name'] == temp_object_name:
                        detail['temp_name'] = None # Mark as moved
            
            elif type == DataSourceType.BULK_PDF:
                # Multiple PDF files case
                for i, file in enumerate(files):
                    # Create a unique name per file
                    file_specific_name = f"{name} - {file.filename}" if len(files) > 1 else name
                    
                    object_name = f"datasources/{uuid.uuid4()}/{secure_filename(file.filename)}"
                    temp_object_name = f"temp/{object_name}"
                    
                    await self.storage.upload_file(file, temp_object_name)
                    uploaded_object_details.append({'file': file, 'temp_name': temp_object_name, 'final_name': object_name})
                    
                    # Each file gets its own metadata
                    file_origin_details = origin_details.copy()
                    file_origin_details['filename'] = file.filename
                    file_origin_details['storage_path'] = object_name
                    file_origin_details['content_type'] = file.content_type
                    
                    datasource = DataSource(
                        name=file_specific_name,
                        type=DataSourceType.PDF, # Each becomes a regular PDF type
                        workspace_id=workspace_id,
                        user_id=user_id,
                        status=DataSourceStatus.PENDING,
                        origin_details=file_origin_details
                    )
                    self.session.add(datasource)
                    self.session.flush() # Get ID but don't commit
                    created_sources.append(datasource)
                    
                    await self.storage.move_file(temp_object_name, object_name)
                    for detail in uploaded_object_details:
                        if detail['temp_name'] == temp_object_name:
                            detail['temp_name'] = None # Mark as moved
            
            elif type == DataSourceType.URL:
                # URL datasource doesn't need file upload
                datasource = DataSource(
                    name=name,
                    type=type,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    status=DataSourceStatus.PENDING,
                    origin_details=origin_details
                )
                self.session.add(datasource)
                self.session.flush() # Get ID but don't commit
                created_sources.append(datasource)
            
            elif type == DataSourceType.TEXT_BLOCK:
                if origin_details and 'text_content' in origin_details:
                    origin_details['title'] = origin_details.get('title', "Untitled Text Block")
                    datasource = DataSource(
                        name=name,
                        type=type,
                        workspace_id=workspace_id,
                        user_id=user_id,
                        status=DataSourceStatus.PENDING,
                        origin_details=origin_details
                    )
                    self.session.add(datasource)
                    self.session.flush()
                    created_sources.append(datasource)
                else:
                    raise ValueError("Missing 'text_content' in origin_details for TEXT_BLOCK")
            
            elif type == DataSourceType.URL_LIST:
                if origin_details and 'urls' in origin_details:
                    datasource = DataSource(
                        name=name,
                        type=type,
                        workspace_id=workspace_id,
                        user_id=user_id,
                        status=DataSourceStatus.PENDING,
                        origin_details=origin_details
                    )
                    self.session.add(datasource)
                    self.session.flush()
                    created_sources.append(datasource)
                else:
                    raise ValueError("Missing 'urls' in origin_details for URL_LIST")
            
            else:
                # Other datasource types
                datasource = DataSource(
                    name=name,
                    type=type,
                    workspace_id=workspace_id,
                    user_id=user_id,
                    status=DataSourceStatus.PENDING,
                    origin_details=origin_details
                )
                self.session.add(datasource)
                self.session.flush() # Get ID but don't commit
                created_sources.append(datasource)
            
            # No explicit commit - caller will commit
            return created_sources

        except Exception as e:
            # No explicit rollback - caller will handle transaction
            logger.error(f"Error during DataSource creation service call (workspace {workspace_id}): {e}", exc_info=True)
            # Attempt to clean up uploaded files
            for detail in uploaded_object_details:
                 if detail['temp_name']: # Only delete if not successfully moved
                     try:
                         logger.warning(f"Attempting cleanup of uploaded file due to error: {detail['temp_name']}")
                         await self.storage.delete_file(detail['temp_name'])
                     except Exception as cleanup_err:
                         logger.error(f"Failed to cleanup storage object {detail['temp_name']}: {cleanup_err}", exc_info=True)
            # Re-raise original exception for the route to handle
            raise
    
    async def update_datasource( # Renamed from update_datasource_status
        self,
        datasource_id: int,
        workspace_id: int, # Added for user update validation
        user_id: int, # Added for user update validation
        update_data: DataSourceUpdate, # Use the updated model
        # Removed status, error_message, metadata_updates as separate args
    ) -> DataSource:
        """
        Updates a DataSource. Can handle updates from user API calls
        (name, description, origin_details) or internal task updates (status, etc.).
        Ensures proper authorization for user updates.
        Does not commit the session.
        """

        def _update_sync():
            # Validate workspace access for user-initiated updates
            if update_data.name is not None or update_data.description is not None or update_data.origin_details is not None:
                 validate_workspace_access(self.session, workspace_id, user_id)
            
            # Fetch the datasource within the session
            datasource = self.session.get(DataSource, datasource_id)
            if not datasource:
                logger.error(f"update_datasource: DataSource {datasource_id} not found in session.")
                raise ValueError(f"DataSource {datasource_id} not found")
            
            # Check workspace match if user is updating sensitive fields
            if update_data.name is not None or update_data.description is not None or update_data.origin_details is not None:
                if datasource.workspace_id != workspace_id:
                    raise ValueError(f"DataSource {datasource_id} does not belong to workspace {workspace_id}")

            logger.info(f"Updating DataSource {datasource_id}")
            
            # Apply updates from the DataSourceUpdate model
            updated_fields = False
            for field, value in update_data.model_dump(exclude_unset=True).items():
                 # Only update if the field exists on the model and the value is not None
                 # (model_dump(exclude_unset=True) handles the 'not None' check implicitly)
                 if hasattr(datasource, field):
                     setattr(datasource, field, value)
                     logger.debug(f"Updated field '{field}' for DS {datasource_id}")
                     updated_fields = True
                 else:
                      logger.warning(f"Field '{field}' from update data not found on DataSource model.")

            if not updated_fields:
                 logger.info(f"No fields were updated for DataSource {datasource_id} (update_data was empty or fields didn't change).")
                 return datasource # Return unchanged object if nothing was updated

            # Always update the timestamp if any field was changed
            datasource.updated_at = datetime.now(timezone.utc)

            self.session.add(datasource)
            try:
                 self.session.flush()
                 self.session.refresh(datasource)
                 logger.info(f"Flushed updates for DataSource {datasource_id}")
            except Exception as e:
                 logger.error(f"Failed to flush updates for DataSource {datasource_id}: {e}")
                 raise # Re-raise flush error
            return datasource

        try:
            # Wrap the synchronous DB operations
            updated_datasource = await asyncio.to_thread(_update_sync)
            return updated_datasource
        except ValueError as ve:
             # Propagate specific errors like not found or validation error
             raise ve
        except HTTPException as he:
             # Propagate HTTP exceptions from validate_workspace_access
             raise he
        except Exception as e:
             # Catch other potential errors from the thread/sync code
             logger.exception(f"Error in update_datasource thread for DS {datasource_id}: {e}")
             # Re-raise as a generic server error
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed datasource update: {e}")

    def update_datasource_urls(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int,
        new_urls: List[str]
    ) -> DataSource:
        """
        Updates the URL list in the origin_details for a URL_LIST DataSource.
        Does not commit the session.
        """
        # Use the utility function for validation
        validate_workspace_access(self.session, workspace_id, user_id)

        # Fetch the datasource
        datasource = self.session.get(DataSource, datasource_id)
        if not datasource:
            raise ValueError(f"DataSource {datasource_id} not found")

        # Check workspace match
        if datasource.workspace_id != workspace_id:
            raise ValueError(f"DataSource {datasource_id} workspace mismatch during deletion: {datasource.workspace_id} != {workspace_id}")

        # Check type
        if datasource.type != DataSourceType.URL_LIST:
            raise ValueError("Updating URLs is only supported for URL_LIST datasources")

        # Validate new_urls format (basic check)
        if not isinstance(new_urls, list) or not all(isinstance(url, str) for url in new_urls):
            raise ValueError("Invalid format for new_urls. Expected a list of strings.")

        # Get current details or initialize
        origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}
        old_urls = set(origin_details.get('urls', []))
        new_urls_set = set(new_urls)

        # --- ADDED: Logic to delete records for removed URLs --- 
        urls_to_remove = old_urls - new_urls_set
        if urls_to_remove:
            logger.info(f"URLs to remove from DS {datasource_id}: {urls_to_remove}")
            hashes_to_remove = {hashlib.sha256(url.encode()).hexdigest() for url in urls_to_remove}
            
            # Find records to delete
            records_to_delete = self.session.exec(
                select(DataRecord).where(
                    DataRecord.datasource_id == datasource_id,
                    DataRecord.url_hash.in_(list(hashes_to_remove))
                )
            ).all()
            
            deleted_count = 0
            if records_to_delete:
                logger.info(f"Found {len(records_to_delete)} DataRecords to delete for removed URLs in DS {datasource_id}")
                for record in records_to_delete:
                    self.session.delete(record)
                    deleted_count += 1
                
                # Decrement count on the datasource
                if datasource.data_record_count is not None:
                    datasource.data_record_count = max(0, datasource.data_record_count - deleted_count)
                else:
                    # If count was None, try to recount (though this is less ideal)
                    count_stmt = select(func.count()).select_from(DataRecord).where(DataRecord.datasource_id == datasource_id)
                    current_count = self.session.scalar(count_stmt) or 0
                    datasource.data_record_count = max(0, current_count - deleted_count) # Adjust based on remaining
                logger.info(f"Marked {deleted_count} DataRecords for deletion and updated count for DS {datasource_id} to {datasource.data_record_count}")
        # --- END ADDED --- 

        # Update the URLs in origin_details
        origin_details['urls'] = new_urls

        # IMPORTANT: Reassign the dictionary to trigger SQLAlchemy change detection
        datasource.origin_details = origin_details
        datasource.updated_at = datetime.now(timezone.utc)

        self.session.add(datasource)
        try:
            self.session.flush()
            self.session.refresh(datasource)
            logger.info(f"Flushed updated URL list for DataSource {datasource_id}")
        except Exception as e:
            logger.error(f"Failed to flush URL update for DataSource {datasource_id}: {e}")
            raise # Re-raise flush error
        return datasource

    async def create_record_from_url(
        self,
        datasource_id: int,
        url: str,
        user_id: int # ADDED user_id parameter
    ) -> Optional[DataRecord]:
        """Scrape a single URL and create a DataRecord linked to the datasource."""
        logger.info(f"Creating record from URL {url} for DS {datasource_id}")

        # --- Call sync part ---
        # --- REMOVED original _create_sync which was incorrect ---

        # --- Refactored approach: Scrape first, then call sync DB part ---
        try:
            # 1. Perform scraping (async)
            logger.debug(f"Scraping URL: {url}")
            scraped_data = await self.scraper.scrape_url(url)
            logger.debug(f"Scraping completed for URL: {url}. Title found: {bool(scraped_data.get('title'))}")

            # 2. Define the synchronous DB operation function
            def _create_record_sync(scraped_info: dict):
                datasource = self.get_datasource(datasource_id, workspace_id=None, user_id=None)
                if not datasource: raise ValueError(f"DataSource {datasource_id} not found")
                if datasource.type != DataSourceType.URL_LIST: raise ValueError("Can only add URLs to a URL_LIST DataSource")

                url_hash = hashlib.sha256(url.encode()).hexdigest()
                existing_rec_stmt = select(DataRecord.id).where(DataRecord.datasource_id == datasource_id, DataRecord.url_hash == url_hash)
                if self.session.exec(existing_rec_stmt).first():
                    logger.info(f"URL {url} already exists in DS {datasource_id}, skipping creation.")
                    return None

                text_content = scraped_info.get("text_content")
                record_title = scraped_info.get("title") # Use scraped title
                publication_date = scraped_info.get("publication_date")

                if not text_content:
                    logger.warning(f"No text content scraped from {url}. Skipping record creation.")
                    return None
                
                text_content = text_content.replace('\\x00', '').strip()
                if not text_content:
                    logger.warning(f"Text content is empty after cleaning for {url}. Skipping.")
                    return None
                
                # Use URL as title fallback
                if not record_title: record_title = url 
                
                event_ts = None
                if publication_date:
                    try:
                        parsed_dt = dateutil.parser.parse(publication_date)
                        event_ts = parsed_dt.replace(tzinfo=timezone.utc) if parsed_dt.tzinfo is None else parsed_dt
                    except Exception as parse_err:
                        logging.warning(f"Could not parse publication_date '{publication_date}' for URL {url}: {parse_err}")
                
                # Create DataRecord
                record = DataRecord(
                    datasource_id=datasource_id,
                    title=record_title, # Use scraped/fallback title
                    text_content=text_content,
                    source_metadata={'original_url': url, 'scraped_title': scraped_info.get("title")}, # Store original URL and originally scraped title
                    event_timestamp=event_ts,
                    url_hash=url_hash,
                    created_at=datetime.now(timezone.utc)
                )
                self.session.add(record)
                self.session.commit()
                self.session.refresh(record)
                logger.info(f"Created DataRecord {record.id} from URL {url}")
                return record

            # 3. Run the sync DB function in a thread
            return await asyncio.to_thread(_create_record_sync, scraped_data)

        except (ValueError) as e:
            logger.warning(f"Error creating record from URL {url}: {e}")
            raise e # Re-raise validation/not found errors
        except Exception as e:
            logger.exception(f"Unexpected error creating record from URL {url}: {e}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create record from URL")

    def create_record_from_text(
        self,
        datasource_id: int,
        text_content: str,
        title: Optional[str] = None, # ADDED: Optional title parameter
        metadata: Optional[Dict[str, Any]] = None,
        event_timestamp: Optional[datetime] = None
    ) -> DataRecord:
        """Create a DataRecord from raw text content."""
        logger.info(f"Creating record from text for DS {datasource_id}. Title: '{title}'")
        
        # Ensure the parent DataSource exists and belongs to the user/workspace implicitly via access control on route
        datasource = self.get_datasource(datasource_id)
        if not datasource: raise ValueError(f"DataSource {datasource_id} not found")
        # Optional: Add check if datasource type allows direct text records?
        
        cleaned_text = text_content.replace('\\x00', '').strip()
        if not cleaned_text:
            raise ValueError("Text content cannot be empty after cleaning.")

        # Generate content hash
        content_hash = hashlib.sha256(cleaned_text.encode()).hexdigest()
        
        # Optional: Check for duplicate content hash within the datasource
        existing_rec_stmt = select(DataRecord.id).where(DataRecord.datasource_id == datasource_id, DataRecord.content_hash == content_hash)
        if self.session.exec(existing_rec_stmt).first():
            logger.warning(f"Duplicate text content hash found for DS {datasource_id}. Consider skipping or handling.")
            # Decide: raise error or just return existing? For now, let's allow duplicates if user explicitly adds.
        
        record = DataRecord(
            datasource_id=datasource_id,
            title=title, # ADDED: Use provided title
            text_content=cleaned_text,
            source_metadata=metadata if metadata else {},
            event_timestamp=event_timestamp,
            content_hash=content_hash,
            created_at=datetime.now(timezone.utc)
        )
        self.session.add(record)
        self.session.commit()
        self.session.refresh(record)
        logger.info(f"Created DataRecord {record.id} from text for DS {datasource_id}")
        return record

    async def create_records_batch(
        self,
        records_data: List[Dict[str, Any]]
    ) -> int:
        """
        Creates DataRecords in batch using the current session.
        Does NOT commit the session. Runs DB operations in a thread.
        """
        if not records_data:
            return 0

        def _create_batch_sync():
            records_to_add: List[DataRecord] = []
            count = 0
            for record_dict in records_data:
                try:
                    # Create DataRecord instance from dict
                    record_create_obj = DataRecordCreate(**record_dict)
                    db_record = DataRecord.model_validate(record_create_obj)
                    records_to_add.append(db_record)
                    count += 1
                except Exception as validation_err:
                    # Log validation errors but potentially continue with valid ones?
                    # Or fail the whole batch? For now, log and skip.
                    logger.error(f"Validation error creating DataRecord from dict: {record_dict}, Error: {validation_err}", exc_info=True)
                    # Decide if this should raise an error to stop the batch

            if records_to_add:
                logger.info(f"Adding batch of {len(records_to_add)} records to session.")
                self.session.add_all(records_to_add)
                try:
                     self.session.flush() # Flush to send commands to DB
                     logger.info(f"Flushed batch of {len(records_to_add)} records.")
                except Exception as e:
                     logger.error(f"Failed to flush batch create: {e}")
                     # Don't rollback here, let caller handle transaction
                     raise # Re-raise flush error
            return count

        try:
             # Wrap the synchronous DB operations
             created_count = await asyncio.to_thread(_create_batch_sync)
             return created_count
        except Exception as e:
             # Catch potential errors from the thread/sync code
             logger.exception(f"Error in create_records_batch thread: {e}")
             # Re-raise or handle as appropriate
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed batch record create: {e}")

    def get_datasource(
        self,
        datasource_id: int,
        workspace_id: Optional[int] = None,
        user_id: Optional[int] = None
    ) -> Optional[DataSource]:
        """
        Get a data source by ID, with optional access validation.
        """
        datasource = self.session.get(DataSource, datasource_id)

        if not datasource:
            return None

        # If workspace_id is provided, validate it matches
        if workspace_id is not None and datasource.workspace_id != workspace_id:
            return None

        # If user_id is provided, validate access using utility function
        if user_id is not None:
            try:
                 # Use the utility function for validation
                 validate_workspace_access(self.session, datasource.workspace_id, user_id)
            except HTTPException: # Catch HTTPException raised by the utility
                 return None # Access denied or workspace not found

        return datasource

    def list_datasources(
        self,
        user_id: int,
        workspace_id: int,
        skip: int = 0,
        limit: int = 100,
        include_counts: bool = False
    ) -> Tuple[List[DataSourceRead], int]:
        """List datasources for a workspace, optionally including record counts."""
        # Use the utility function for validation
        workspace = validate_workspace_access(self.session, workspace_id, user_id)

        # Base query
        base_stmt = select(DataSource).where(DataSource.workspace_id == workspace_id)

        # Get total count
        count_stmt = select(func.count()).select_from(base_stmt.subquery())
        total_count = self.session.exec(count_stmt).one()

        # Apply ordering and pagination
        final_stmt = base_stmt.order_by(DataSource.created_at.desc()).offset(skip).limit(limit)
        datasources = self.session.exec(final_stmt).all()

        # Prepare read models, optionally add counts
        datasource_reads = []
        for ds in datasources:
            ds_read = DataSourceRead.model_validate(ds)
            if include_counts:
                # Efficiently get count from metadata if available and complete
                record_count = None
                if ds.status == DataSourceStatus.COMPLETE and ds.source_metadata:
                    if ds.type == DataSourceType.CSV:
                        record_count = ds.source_metadata.get('row_count_processed')
                    elif ds.type == DataSourceType.URL_LIST:
                        record_count = ds.source_metadata.get('processed_count')
                    # Add other types if they store counts in metadata
                    elif ds.type == DataSourceType.PDF and 'processed_page_count' in ds.source_metadata: # PDF exports one record
                         record_count = 1 if ds.source_metadata.get('processed_page_count', 0) > 0 else 0
                    elif ds.type == DataSourceType.TEXT_BLOCK: # Text block exports one record
                         record_count = 1

                # Fallback to DB query if count not in metadata or source is incomplete
                if record_count is None:
                    record_count_stmt = select(func.count()).select_from(DataRecord).where(DataRecord.datasource_id == ds.id)
                    record_count = self.session.scalar(record_count_stmt) or 0

                ds_read.data_record_count = record_count if isinstance(record_count, int) else 0
            datasource_reads.append(ds_read)

        return datasource_reads, total_count

    def get_datasource_details(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int,
        include_counts: bool = False
    ) -> Optional[DataSourceRead]:
        """Get a specific datasource, validating access and optionally adding counts."""
        # Uses existing get_datasource for fetch and basic validation (which now uses the utility)
        datasource = self.get_datasource(datasource_id, workspace_id, user_id)
        if not datasource:
            return None

        datasource_read = DataSourceRead.model_validate(datasource)

        if include_counts:
            # Logic copied from list_datasources
            record_count = None
            if datasource.status == DataSourceStatus.COMPLETE and datasource.source_metadata:
                if datasource.type == DataSourceType.CSV:
                    record_count = datasource.source_metadata.get('row_count_processed')
                elif datasource.type == DataSourceType.URL_LIST:
                    record_count = datasource.source_metadata.get('processed_count')
                elif datasource.type == DataSourceType.PDF and 'processed_page_count' in datasource.source_metadata:
                     record_count = 1 if datasource.source_metadata.get('processed_page_count', 0) > 0 else 0
                elif datasource.type == DataSourceType.TEXT_BLOCK:
                     record_count = 1

            # Fallback to DB query if count not in metadata or source is incomplete
            if record_count is None:
                record_count_stmt = select(func.count()).select_from(DataRecord).where(DataRecord.datasource_id == datasource.id)
                record_count = self.session.scalar(record_count_stmt) or 0

            datasource_read.data_record_count = record_count if isinstance(record_count, int) else 0

        return datasource_read

    async def get_csv_rows(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int,
        skip: int = 0,
        limit: int = 50
    ) -> CsvRowsOut:
        """Retrieve rows from a CSV DataSource with pagination."""
        # Uses existing get_datasource for fetch and basic validation (which now uses the utility)
        datasource = self.get_datasource(datasource_id, workspace_id, user_id)
        if not datasource:
            raise ValueError(f"DataSource {datasource_id} not found or not accessible")
        if datasource.type != DataSourceType.CSV:
            raise ValueError("DataSource is not of type CSV")

        origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}
        source_metadata = datasource.source_metadata if isinstance(datasource.source_metadata, dict) else {}
        filepath = origin_details.get('filepath')
        if not filepath:
            raise ValueError("CSV file path not found in origin details")

        # Configuration from datasource
        try:
            skip_rows_header = int(origin_details.get('skip_rows', 0))
            if skip_rows_header < 0: skip_rows_header = 0
        except (ValueError, TypeError): skip_rows_header = 0

        # Handle delimiter carefully (it might be stored escaped)
        delimiter = origin_details.get('delimiter')
        if delimiter is None: delimiter = ','
        elif delimiter == '\\t': delimiter = '\t' # Handle escaped tab
        elif len(delimiter) > 1: delimiter = delimiter[0] # Ensure single character

        # encoding_used should be reliable if ingestion succeeded
        encoding_used = source_metadata.get('encoding_used', 'utf-8')

        columns = source_metadata.get('columns', [])
        total_rows = source_metadata.get('row_count_processed', 0)

        # Read file from storage
        rows_data: List[CsvRowData] = []
        file_object = None
        try:
            file_object = await self.storage.get_file(filepath)
            # Assume get_file returns a file-like object supporting read()
            file_content_bytes = file_object.read()

            # --- Start: Wrap blocking CSV processing in thread ---
            def process_csv_sync():
                local_rows_data = []
                try:
                    file_content_text = file_content_bytes.decode(encoding_used)
                except Exception as decode_err:
                    logger.error(f"Failed to decode CSV {filepath} with encoding {encoding_used}: {decode_err}")
                    raise ValueError(f"Failed to decode CSV with detected encoding: {encoding_used}. Error: {decode_err}")

                lines = file_content_text.splitlines()
                if not lines or skip_rows_header >= len(lines):
                    return [] # Return empty if no data

                content_lines = lines[skip_rows_header:]
                if not content_lines:
                    return []

                header_line = content_lines[0]
                data_lines_all = content_lines[1:]

                start_data_index = skip
                end_data_index = skip + limit
                data_lines_paginated = data_lines_all[start_data_index:end_data_index]

                if not data_lines_paginated:
                    return []

                csv_content_for_reader = header_line + '\n' + '\n'.join(data_lines_paginated)
                csv_data_io = io.StringIO(csv_content_for_reader)
                reader = csv.DictReader(csv_data_io, delimiter=delimiter)

                if not reader.fieldnames:
                    raise ValueError("Could not parse CSV header.")

                try:
                    for i, row_dict in enumerate(reader):
                        sanitized_row = self._sanitize_csv_row(row_dict)
                        filtered_sanitized = {k: v for k, v in sanitized_row.items() if k in columns}
                        original_data_row_index = skip + i
                        original_file_line_number = skip_rows_header + 1 + original_data_row_index + 1
                        local_rows_data.append(CsvRowData(row_data=filtered_sanitized, row_number=original_file_line_number))
                except csv.Error as csv_err:
                    raise ValueError(f"Failed to parse CSV data: {str(csv_err)}")
                return local_rows_data
            
            rows_data = await asyncio.to_thread(process_csv_sync)
            # --- End: Wrap blocking CSV processing in thread ---

        except FileNotFoundError:
            raise ValueError(f"CSV file not found in storage: {filepath}")
        except Exception as e:
            logger.error(f"Error reading/processing CSV {filepath}: {e}", exc_info=True)
            raise ValueError(f"Failed to process CSV file: {str(e)}")
        finally:
             if file_object:
                 try: file_object.close() # Close the stream from storage provider
                 except Exception: pass

        return CsvRowsOut(data=rows_data, total_rows=total_rows, columns=columns)

    def delete_datasource(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int
    ) -> bool:
        """
        Delete a datasource, verifying access.
        This method does not commit the transaction - the caller must commit explicitly.
        """
        # First, validate access and get datasource
        try:
            # Use validate_workspace_access utility for consistency
            validate_workspace_access(self.session, workspace_id, user_id)
            
            # Get the datasource
            datasource = self.session.get(DataSource, datasource_id)
            if not datasource:
                logger.warning(f"DataSource {datasource_id} not found for deletion request by user {user_id}")
                return False
            
            # Check datasource workspace match (ownership validation)
            if datasource.workspace_id != workspace_id:
                logger.warning(f"DataSource {datasource_id} workspace mismatch during deletion: {datasource.workspace_id} != {workspace_id}")
                return False

            # Get additional metadata from the datasource for potential file deletion
            file_path_to_delete = None
            if datasource.source_metadata and isinstance(datasource.source_metadata, dict):
                storage_path = datasource.source_metadata.get('storage_path')
                if storage_path:
                    file_path_to_delete = storage_path
                    logger.info(f"File path found for deletion: {file_path_to_delete}")

            # Delete the DB record
            self.session.delete(datasource)
            # Do not flush or commit - caller will handle transaction
            logger.info(f"Marked DataSource {datasource_id} for deletion from database.")

            # If DB deletion is prepared, handle file deletion
            if file_path_to_delete:
                try:
                    logger.info(f"Attempting to delete associated storage file: {file_path_to_delete}")
                    # Use the sync delete method from storage provider
                    self.storage.delete_file_sync(file_path_to_delete)
                    logger.info(f"Successfully deleted storage file: {file_path_to_delete}")
                except FileNotFoundError:
                     logger.warning(f"Storage file not found during deletion: {file_path_to_delete}")
                except Exception as storage_err:
                    # Log error but don't fail the overall deletion if DB record is marked for deletion
                    logger.error(f"Failed to delete storage file {file_path_to_delete} for {datasource_id}: {storage_err}", exc_info=True)

            return True
        except Exception as e:
            # No rollback - let the caller handle the transaction
            logger.error(f"Error preparing DataSource {datasource_id} for deletion: {e}", exc_info=True)
            # Re-raise for the caller to handle
            raise ValueError(f"Could not delete DataSource: {str(e)}") from e

    # --- DataRecord Retrieval/Management Methods ---

    def get_datarecord(
        self,
        datarecord_id: int,
        workspace_id: int, # Needed for authorization check via datasource/workspace
        user_id: int
    ) -> Optional[DataRecord]:
        """
        Retrieve a specific DataRecord by ID, verifying ownership.
        """
        logger.info(f"Service: Fetching DataRecord {datarecord_id} for workspace {workspace_id}")

        # Use the utility function for validation
        try:
            validate_workspace_access(self.session, workspace_id, user_id)
        except HTTPException as e:
             logger.warning(f"Service: Access denied for user {user_id} to workspace {workspace_id} when fetching DataRecord {datarecord_id}: {e.detail}")
             return None

        # Query DataRecord and join DataSource to verify ownership
        statement = select(DataRecord).join(DataSource).where(
            DataRecord.id == datarecord_id
        )

        data_record = self.session.exec(statement).first()

        if not data_record:
            logger.warning(f"Service: DataRecord {datarecord_id} not found or not accessible for user {user_id} in workspace {workspace_id}")
            return None

        logger.info(f"Service: Successfully fetched DataRecord {datarecord_id}")
        return data_record

    def list_datarecords(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int,
        skip: int = 0,
        limit: int = 1000
    ) -> List[DataRecord]:
        """
        Retrieve DataRecords associated with a specific DataSource, verifying ownership.
        """
        logger.info(f"Service: Fetching DataRecords for DataSource {datasource_id} in workspace {workspace_id}")

        # Uses existing get_datasource for fetch and basic validation (which now uses the utility)
        datasource = self.get_datasource(datasource_id, workspace_id, user_id)
        if not datasource:
            raise ValueError(f"DataSource {datasource_id} not found or not accessible by user {user_id} in workspace {workspace_id}")

        # Query DataRecords for the given datasource_id
        statement = (
            select(DataRecord)
            .where(DataRecord.datasource_id == datasource_id)
            .offset(skip)
            .limit(limit)
            # Add ordering if needed, e.g., by created_at or event_timestamp
            .order_by(DataRecord.created_at.desc())
        )

        data_records = self.session.exec(statement).all()

        logger.info(f"Service: Found {len(data_records)} DataRecords for DataSource {datasource_id}")
        return data_records

    async def append_record(
        self,
        datasource_id: int,
        workspace_id: int,
        user_id: int,
        content: str,
        content_type: Literal['text', 'url'],
        title: Optional[str] = None, # ADDED: Optional title
        event_timestamp_str: Optional[str] = None
    ) -> DataRecord:
        """Append a record (from URL or text) to an existing DataSource."""
        logger.info(f"Appending {content_type} record to DS {datasource_id} in workspace {workspace_id}. Title: '{title}'")

        # --- Basic Validation --- 
        datasource = self.get_datasource(datasource_id, workspace_id=workspace_id, user_id=user_id)
        if not datasource:
            raise ValueError(f"DataSource {datasource_id} not found or not accessible in workspace {workspace_id}")

        # --- Parse Timestamp --- 
        event_timestamp = None
        if event_timestamp_str:
            try:
                parsed_dt = dateutil.parser.parse(event_timestamp_str)
                event_timestamp = parsed_dt.replace(tzinfo=timezone.utc) if parsed_dt.tzinfo is None else parsed_dt
            except Exception as parse_err:
                raise ValueError(f"Invalid event_timestamp format: {parse_err}")

        # --- Process based on type --- 
        if content_type == 'url':
            if datasource.type != DataSourceType.URL_LIST:
                raise ValueError("Can only append URLs to a URL_LIST DataSource")
            # Call the refactored create_record_from_url
            # Note: create_record_from_url handles scraping, timestamp parsing, duplicate checks, and DB operations.
            # It now implicitly uses the title from scraping, so the 'title' parameter here is ignored for URLs.
            try:
                record = await self.create_record_from_url(datasource_id, content, user_id)
                if record is None:
                    # This means the URL was likely a duplicate
                    raise ValueError(f"URL already exists or could not be processed: {content}")
                return record
            except ValueError as ve:
                raise ve # Propagate specific errors like duplicate URL
            except Exception as e:
                logger.exception(f"Error appending URL record: {e}")
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to process and append URL: {e}")

        elif content_type == 'text':
            # Call create_record_from_text, passing the title
            try:
                return self.create_record_from_text(
                    datasource_id=datasource_id,
                    text_content=content,
                    title=title, # Pass the provided title
                    metadata=None, # Metadata could be added if needed
                    event_timestamp=event_timestamp
                )
            except ValueError as ve:
                 raise ve # Propagate errors like empty content
            except Exception as e:
                logger.exception(f"Error appending text record: {e}")
                raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to append text record: {e}")

        else:
            raise ValueError("Invalid content_type specified")

    def export_datasource(
        self,
        datasource_id: int,
        user_id: int,
        include_records: bool = True,
        include_results: bool = False # Generally not recommended for DS export
    ) -> Dict[str, Any]:
        """
        Export a data source with optional related records.

        Args:
            datasource_id: ID of the data source to export
            user_id: User ID for authorization check
            include_records: Whether to include data records
            include_results: Whether to include classification results (usually large)

        Returns:
            Dictionary containing the exported data

        Raises:
            ValueError: If the data source is not found or access denied
        """
        # Uses existing get_datasource for fetch and basic validation (which now uses the utility)
        datasource = self.get_datasource(datasource_id, user_id=user_id)
        if not datasource:
            raise ValueError(f"Datasource {datasource_id} not found or access denied")


        export_data = {
            "meta": {
                "export_type": "datasource",
                "export_version": "1.0",
                "export_date": datetime.now(timezone.utc).isoformat(),
                "export_id": str(uuid.uuid4()),
                "original_id": datasource.id # Include original ID for reference
            },
            "datasource": {
                "name": datasource.name,
                "type": datasource.type.value,
                "origin_details": datasource.origin_details,
                "source_metadata": datasource.source_metadata
                # Exclude user_id, workspace_id, status, timestamps
            }
        }

        if include_records:
            records = self.session.exec(
                select(DataRecord).where(DataRecord.datasource_id == datasource_id)
            ).all()
            export_data["records"] = [
                {
                    "text_content": r.text_content,
                    "source_metadata": r.source_metadata,
                    "event_timestamp": r.event_timestamp.isoformat() if r.event_timestamp else None,
                    "url_hash": r.url_hash
                    # Exclude id, datasource_id, created_at
                }
                for r in records
            ]

        if include_results and include_records:
            # Note: Including results can make exports very large
            record_ids = [r.id for r in records]
            if record_ids:
                results = self.session.exec(
                    select(ClassificationResult).where(ClassificationResult.datarecord_id.in_(record_ids))
                ).all()
                if results:
                     # Simple list of results, linking might be complex on import
                     export_data["results"] = [
                         {
                              # We need a way to link back to the record on import
                              # Using record index for now, assuming order is preserved
                              "record_index": record_ids.index(res.datarecord_id),
                              "scheme_id": res.scheme_id, # Requires scheme to exist on import
                              "job_id": res.job_id, # Requires job to exist on import
                              "value": res.value,
                              "timestamp": res.timestamp.isoformat() if res.timestamp else None
                         }
                         for res in results if res.datarecord_id in record_ids
                     ]

        return export_data

    def import_datasource(
        self,
        user_id: int,
        workspace_id: int,
        import_data: Dict[str, Any]
    ) -> DataSource:
        """
        Import a datasource from export data into a specified workspace.
        The caller is responsible for committing the transaction.

        Args:
            user_id: ID of the user performing the import
            workspace_id: ID of the workspace to import into
            import_data: The parsed JSON data from the export file

        Returns:
            The newly created DataSource instance

        Raises:
            ValueError: If validation or import fails
        """
        # Use the utility function for validation
        workspace = validate_workspace_access(self.session, workspace_id, user_id)
        meta = import_data.get("meta", {})
        if meta.get("export_type") != "datasource":
            raise ValueError("Import file is not a datasource export")

        ds_data = import_data.get("datasource")
        if not ds_data:
            raise ValueError("Datasource data missing in import file")

        # Create new datasource
        new_datasource = DataSource(
            name=f"{ds_data.get('name', 'Imported DS')} (Imported)",
            type=DataSourceType(ds_data.get("type")),
            description=ds_data.get("description"),
            origin_details=ds_data.get("origin_details", {}),
            source_metadata=ds_data.get("source_metadata", {}),
            workspace_id=workspace_id,
            user_id=user_id,
            status=DataSourceStatus.COMPLETE # Assume imported data is complete
        )
        self.session.add(new_datasource)
        self.session.flush() # Get ID

        # Import records
        records_data = import_data.get("records", [])
        imported_records = []
        for record_data in records_data:
            try:
                 record_timestamp = None
                 if record_data.get("event_timestamp"):
                     record_timestamp = dateutil.parser.isoparse(record_data["event_timestamp"])
                 # Create DataRecordCreate model for validation
                 record_in = DataRecordCreate(
                     datasource_id=new_datasource.id,
                     text_content=record_data.get("text_content", ""),
                     source_metadata=record_data.get("source_metadata", {}),
                     event_timestamp=record_timestamp,
                     url_hash=record_data.get("url_hash")
                 )
                 new_record = DataRecord.model_validate(record_in)
                 imported_records.append(new_record)
            except Exception as e:
                 logger.error(f"Failed to validate/create record during import: {e}. Data: {record_data}", exc_info=True)
                 # Skip invalid records
                 continue

        if imported_records:
            self.session.add_all(imported_records)

        # Note: Importing results linked only to records is complex.
        # The current export format links results to records via index.
        # Re-creating these results accurately requires imported schemes/jobs.
        # Typically, results would be re-generated via a new job on the imported data.
        # We will skip importing results directly attached to a datasource export for now.

        self.session.commit()
        self.session.refresh(new_datasource)
        logger.info(f"Imported DataSource '{new_datasource.name}' ({new_datasource.id}) with {len(imported_records)} records into workspace {workspace_id}")
        return new_datasource

    def find_or_create_datarecord_from_data(
        self,
        workspace_id: int,
        user_id: int,
        record_data: Dict[str, Any],
        conflict_strategy: str = 'skip'
    ) -> DataRecord:
        """
        Finds an existing DataRecord based on content hash or creates a new one.
        Operates within the caller's transaction (does not commit).
        Links the record to the workspace indirectly via user_id (for now).
        DataRecords created here will have datasource_id = None initially.

        Args:
            workspace_id: Target workspace ID (for context).
            user_id: ID of the user performing the import.
            record_data: Dictionary containing record data from export (must include text_content).
            conflict_strategy: How to handle conflicts (currently only 'skip').

        Returns:
            The existing or newly created DataRecord.

        Raises:
            ValueError: If text_content is missing or validation/creation fails.
        """
        text_content = record_data.get("text_content")
        if not text_content:
            # If content wasn't included in export, we can't check hash or create
            raise ValueError("Record data must include 'text_content' for import.")

        # Calculate content hash
        content_hash = hashlib.sha256(text_content.encode()).hexdigest()

        # Check for existing record with the same content hash
        # NOTE: This checks globally. A workspace-specific check is harder as records
        # don't directly link to workspaces. Relying on hash uniqueness for now.
        existing_record = self.session.exec(
            select(DataRecord).where(DataRecord.content_hash == content_hash)
        ).first()

        if existing_record:
            logger.info(f"Found existing DataRecord {existing_record.id} with matching content hash ({content_hash[:8]}...). Using existing.")
            # TODO: Consider if metadata needs merging or updating based on strategy?
            return existing_record
        else:
            logger.info(f"No existing DataRecord found with hash {content_hash[:8]}... Creating new record in workspace {workspace_id}.")
            # Prepare DataRecordCreate model
            try:
                record_timestamp = None
                if record_data.get("event_timestamp"):
                    record_timestamp = dateutil.parser.isoparse(record_data["event_timestamp"])

                record_create_data = DataRecordCreate(
                    text_content=text_content,
                    source_metadata=record_data.get("source_metadata", {}),
                    event_timestamp=record_timestamp,
                    url_hash=record_data.get("url_hash"), # Include if present in export
                    content_hash=content_hash,
                    datasource_id=None # Explicitly set to None
                )
            except Exception as pydantic_error:
                raise ValueError(f"Invalid record data format: {pydantic_error}") from pydantic_error

            # Create the record model instance
            new_record = DataRecord.model_validate(record_create_data)
            # Add to session, but DO NOT COMMIT (caller manages transaction)
            self.session.add(new_record)
            self.session.flush() # Flush to assign an ID to the new record
            self.session.refresh(new_record) # Ensure the ID is loaded
            logger.info(f"Successfully created imported DataRecord {new_record.id} (pending commit). Hash: {content_hash[:8]}...")
            return new_record 

    async def transfer_datasources(
        self,
        user_id: int,
        request_data: DataSourceTransferRequest
    ) -> DataSourceTransferResponse:
        """
        Transfers (moves or copies) DataSources and their associated DataRecords
        between workspaces for a given user. Handles associated file storage.
        """
        source_ws_id = request_data.source_workspace_id
        target_ws_id = request_data.target_workspace_id
        ds_ids_to_transfer = request_data.datasource_ids
        is_copy = request_data.copy

        logger.info(f"Initiating {'copy' if is_copy else 'move'} of {len(ds_ids_to_transfer)} datasources "
                    f"from workspace {source_ws_id} to {target_ws_id} for user {user_id}.")

        new_datasource_ids = []
        failed_transfers: Dict[int, str] = {}

        if source_ws_id == target_ws_id:
            raise ValueError("Source and target workspace IDs cannot be the same.")
        if not ds_ids_to_transfer:
            raise ValueError("No DataSource IDs provided for transfer.")

        # --- Authorization ---
        # Ensure user has access to both workspaces (using self.session)
        try:
            validate_workspace_access(self.session, source_ws_id, user_id)
            validate_workspace_access(self.session, target_ws_id, user_id)
        except HTTPException as auth_err:
            logger.warning(f"Authorization failed for datasource transfer: {auth_err.detail}")
            # Re-raise as ValueError for consistent service-level error handling maybe?
            # Or handle specifically in the route based on HTTPException
            raise ValueError(f"Authorization failed: {auth_err.detail}")


        # --- Transaction ---
        try:
            for ds_id in ds_ids_to_transfer:
                logger.debug(f"Processing DataSource ID: {ds_id}")
                try:
                    # Fetch original DataSource with records
                    original_ds = self.session.get(DataSource, ds_id)

                    if not original_ds:
                        failed_transfers[ds_id] = "Original DataSource not found."
                        logger.warning(f"DataSource {ds_id} not found.")
                        continue
                    if original_ds.workspace_id != source_ws_id:
                        failed_transfers[ds_id] = "DataSource does not belong to the source workspace."
                        logger.warning(f"DataSource {ds_id} belongs to workspace {original_ds.workspace_id}, not {source_ws_id}.")
                        continue

                    # Fetch original records
                    records_statement = select(DataRecord).where(DataRecord.datasource_id == ds_id)
                    original_records = self.session.exec(records_statement).all()
                    logger.debug(f"Found {len(original_records)} records for DataSource {ds_id}.")

                    # --- Handle File Storage ---
                    original_storage_path = original_ds.origin_details.get("storage_path") if isinstance(original_ds.origin_details, dict) else None
                    new_storage_path = None
                    new_origin_details = original_ds.origin_details.copy() if isinstance(original_ds.origin_details, dict) else {}

                    if original_storage_path:
                        # Generate a unique path/name for the new location
                        # Example: target_ws_id/datasources/uuid/original_filename.ext
                        original_filename = original_storage_path.split('/')[-1]
                        new_object_name = f"ws_{target_ws_id}/ds_{uuid.uuid4()}/{original_filename}"

                        try:
                            if is_copy:
                                logger.info(f"Copying storage file from '{original_storage_path}' to '{new_object_name}'")
                                # Assuming storage provider has copy_object or similar
                                await self.storage.copy_object(original_storage_path, new_object_name)
                            else: # Move
                                logger.info(f"Moving storage file from '{original_storage_path}' to '{new_object_name}'")
                                await self.storage.move_file(original_storage_path, new_object_name)
                            new_storage_path = new_object_name
                            new_origin_details["storage_path"] = new_storage_path
                            logger.debug(f"Storage file {'copied' if is_copy else 'moved'} successfully.")
                        except Exception as storage_err:
                            logger.error(f"Storage operation failed for DS {ds_id}: {storage_err}", exc_info=True)
                            failed_transfers[ds_id] = f"Storage operation failed: {storage_err}"
                            # If storage fails, we shouldn't proceed with this DS
                            continue # Skip to next datasource_id


                    # --- Create New DataSource ---
                    new_ds = DataSource(
                        # Copy relevant fields
                        name=f"{original_ds.name}",
                        type=original_ds.type,
                        description=getattr(original_ds, 'description', None), # Use getattr with default None
                        origin_details=new_origin_details, # Use updated details
                        source_metadata=original_ds.source_metadata.copy() if isinstance(original_ds.source_metadata, dict) else {},
                        status=original_ds.status, # Copy status for now
                        # Set new ownership and reset counts/errors
                        workspace_id=target_ws_id,
                        user_id=user_id, # Belongs to the user performing the action
                        data_record_count=0, # Reset count, will be updated
                        error_message=None,
                        entity_uuid=str(uuid.uuid4()), # Generate new UUID
                        imported_from_uuid=original_ds.entity_uuid if is_copy else None, # Link if copying
                    )
                    self.session.add(new_ds)
                    self.session.flush() # Get the new ID
                    new_ds_id = new_ds.id
                    if new_ds_id is None: # Should not happen after flush
                        raise Exception(f"Failed to get new ID for transferred DataSource {ds_id}")
                    new_datasource_ids.append(new_ds_id)
                    logger.debug(f"Created new DataSource {new_ds_id} in workspace {target_ws_id}.")

                    # --- Transfer DataRecords ---
                    new_record_count = 0
                    for record in original_records:
                        new_record = DataRecord(
                            # Copy relevant fields
                            text_content=record.text_content,
                            source_metadata=record.source_metadata.copy() if isinstance(record.source_metadata, dict) else {},
                            event_timestamp=record.event_timestamp,
                            url_hash=record.url_hash,
                            content_hash=record.content_hash,
                            # Link to new DataSource
                            datasource_id=new_ds_id,
                            entity_uuid=str(uuid.uuid4()), # Generate new UUID
                            imported_from_uuid=record.entity_uuid if is_copy else None, # Link if copying
                        )
                        self.session.add(new_record)
                        new_record_count += 1

                        # Delete original record if moving
                        if not is_copy:
                            self.session.delete(record)

                    # Update count on the new DataSource
                    new_ds.data_record_count = new_record_count
                    self.session.add(new_ds) # Add again to track count change
                    logger.debug(f"Transferred {new_record_count} records to new DataSource {new_ds_id}.")

                    # --- Delete Original DataSource (if Moving) ---
                    if not is_copy:
                        # File was already moved/deleted implicitly by storage_provider.move_file
                        # Just delete the DB record
                        self.session.delete(original_ds)
                        logger.info(f"Moved DataSource {ds_id} and its records. Original deleted.")

                except Exception as item_err:
                     # Catch errors processing a single item
                     logger.error(f"Failed to process DataSource ID {ds_id}: {item_err}", exc_info=True)
                     failed_transfers[ds_id] = f"Internal error during processing: {item_err}"
                     # We might be mid-transaction here. The overall rollback will handle it.


            # --- Final Commit / Rollback ---
            if failed_transfers:
                 # If any transfer failed, roll back the entire operation
                 self.session.rollback()
                 logger.warning(f"Datasource transfer failed for some items. Rolling back transaction. Failures: {failed_transfers}")
                 return DataSourceTransferResponse(
                     success=False,
                     message=f"Failed to transfer some DataSources. See errors.",
                     errors=failed_transfers
                 )
            else:
                 # All processed successfully
                 self.session.commit()
                 action = "Copied" if is_copy else "Moved"
                 logger.info(f"Successfully {action.lower()} {len(ds_ids_to_transfer)} datasources from workspace {source_ws_id} to {target_ws_id}.")
                 return DataSourceTransferResponse(
                     success=True,
                     message=f"Successfully {action.lower()} {len(ds_ids_to_transfer)} DataSources.",
                     new_datasource_ids=new_datasource_ids if is_copy else None # Only return new IDs if copied
                 )

        except ValueError as ve: # Catch validation errors raised earlier
            self.session.rollback()
            logger.error(f"Validation error during datasource transfer: {ve}")
            raise ve # Re-raise for the route to handle as 4xx
        except Exception as e:
            self.session.rollback()
            logger.exception(f"Unexpected error during datasource transfer: {e}")
            # Raise a generic internal server error
            raise Exception("An unexpected error occurred during the transfer.") from e 

    def update_datarecord(
        self,
        datarecord_id: int,
        workspace_id: int,
        user_id: int,
        record_in: DataRecordUpdate
    ) -> DataRecord:
        """
        Updates specific fields of an existing DataRecord.

        Args:
            datarecord_id: The ID of the DataRecord to update.
            workspace_id: The ID of the workspace for authorization.
            user_id: The ID of the user making the request.
            record_in: The payload containing the fields to update.

        Returns:
            The updated DataRecord object.

        Raises:
            HTTPException: If the record is not found or the user lacks permission.
        """
        # --- Authorization Check using utility ---
        try:
            validate_workspace_access(self.session, workspace_id, user_id)
        except HTTPException as e:
            # Re-raise the exception from the validation utility
            raise e
        # --- End Authorization Check ---

        db_record = self.session.get(DataRecord, datarecord_id)

        if not db_record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DataRecord not found")

        # --- REMOVED complex authorization block ---

        update_data = record_in.model_dump(exclude_unset=True) # Get only provided fields

        updated = False
        for key, value in update_data.items():
            if hasattr(db_record, key):
                setattr(db_record, key, value)
                updated = True

        if updated:
            # db_record.updated_at = datetime.now(timezone.utc) # Update timestamp if changes were made
            self.session.add(db_record)
            self.session.commit()
            self.session.refresh(db_record)
        else:
             # Optional: Log or inform if no actual changes were made
             print(f"No update applied to DataRecord {datarecord_id} as payload contained no new values.")


        return db_record 