"""
Routes for datasource operations.
"""
import asyncio
import csv
import io
import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Literal, Union
from werkzeug.utils import secure_filename

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, status, Depends, Body
from fastapi.responses import StreamingResponse
import chardet
import dateutil.parser
import fitz  # PyMuPDF

from sqlmodel import Session, select, func
from app.models import (
    DataSourceRead,
    DataSourceType,
    DataSourceStatus,
    DataSourcesOut,
    DataSource,
    DataRecord,
    DataRecordCreate,
    CsvRowsOut,
    DataRecordRead,
    DataRecordsOut,
    Message,
    DataSourceUpdate,
    CsvRowData
)
from app.api.deps import (
    CurrentUser,
    SessionDep,
    StorageProviderDep,
    ScrapingProviderDep,
    get_storage_provider,
    get_scraping_provider,
    get_ingestion_service
)
from app.api.services.service_utils import validate_workspace_access
from app.api.services.ingestion import IngestionService
from app.core.celery_app import celery # Import celery app instance
from app.api.tasks.ingestion import process_datasource # Import task

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/datasources",
    tags=["datasources"]
)

# Utility functions moved from service layer
def _extract_pdf_metadata_sync(file_content: bytes, filename: str) -> Dict[str, Any]:
    """Extract basic metadata from PDF file content."""
    metadata = {
        'filename': filename,
        'title': filename.replace('.pdf', ''),
        'page_count': 0
    }
    
    try:
        with fitz.open(stream=file_content, filetype="pdf") as doc:
            metadata['page_count'] = doc.page_count
            
            # Extract document info if available
            if doc.metadata:
                if doc.metadata.get('title'):
                    metadata['title'] = doc.metadata['title']
                if doc.metadata.get('author'):
                    metadata['author'] = doc.metadata['author']
                if doc.metadata.get('subject'):
                    metadata['subject'] = doc.metadata['subject']
    except Exception as e:
        logger.warning(f"Failed to extract PDF metadata for {filename}: {e}")
    
    return metadata

def _sanitize_csv_row(row_dict: Dict[str, Any]) -> Dict[str, Optional[str]]:
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

# Routes

@router.post("", response_model=DataSourcesOut, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=DataSourcesOut, status_code=status.HTTP_201_CREATED)
async def create_datasource(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    name: str = Form(...),
    type: DataSourceType = Form(...),
    origin_details: Optional[str] = Form("{}"),
    files: Optional[List[UploadFile]] = File(None),
    skip_rows: Optional[int] = Form(None, ge=0, description="Number of initial rows to skip (for CSV)"),
    delimiter: Optional[str] = Form(None, description="Single character delimiter (for CSV)"),
    session: SessionDep,
    storage_provider: StorageProviderDep,
    ingestion_service: IngestionService = Depends(get_ingestion_service)
) -> DataSourcesOut:
    """
    Creates a new DataSource. Handles single/bulk PDF uploads based on file count.
    """
    validate_workspace_access(session, workspace_id, current_user.id)
    files = files or [] # Ensure files is a list

    try:
        parsed_origin_details = json.loads(origin_details or "{}")
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON format for origin_details")

    # List to hold created datasources (will be one unless error)
    created_datasources: List[DataSource] = []
    datasource_to_return = None # Will hold the single DS to return

    # --- START MODIFIED PDF HANDLING ---
    if type == DataSourceType.PDF:
        if not files:
            raise HTTPException(status_code=400, detail="No PDF files provided")

        if len(files) == 1:
            # --- Single PDF Upload ---
            file = files[0]
            if file.content_type != 'application/pdf':
                raise HTTPException(status_code=400, detail=f"Invalid file type for PDF: {file.content_type}")

            datasource_uuid = str(uuid.uuid4())
            # Use original filename from UploadFile object
            original_filename = file.filename or f"upload_{datasource_uuid}.pdf"
            storage_path = f"datasources/{datasource_uuid}/{original_filename}"

            # Create origin details for this single file
            file_origin_details = { "filename": original_filename, "storage_path": storage_path }
            file_origin_details.update(parsed_origin_details) # Add any other details passed

            datasource = DataSource(
                name=name, # Use the provided name
                type=DataSourceType.PDF, # Set type explicitly
                origin_details=file_origin_details,
                workspace_id=workspace_id,
                user_id=current_user.id,
                status=DataSourceStatus.PENDING,
                entity_uuid=datasource_uuid,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            session.add(datasource)
            session.flush()
            session.refresh(datasource)
            datasource_to_return = datasource # This is the one we return
            created_datasources.append(datasource)

            # Upload the file
            logger.info(f"Uploading single PDF '{original_filename}' to {storage_path}")
            await storage_provider.upload_file(file=file, object_name=storage_path)

            # --- Commit BEFORE queueing --- 
            # Commit the datasource creation so the task can find it
            try:
                session.commit()
                logger.info(f"Committed single PDF DataSource {datasource.id} before task queueing.")
                # Refresh after commit to ensure the object reflects the committed state
                session.refresh(datasource)
            except Exception as e:
                session.rollback()
                logger.error(f"Error committing single PDF DataSource {datasource.id} before task queueing: {e}", exc_info=True)
                # Attempt to delete the uploaded file if commit failed
                try: await storage_provider.delete_file(storage_path)
                except: logger.error(f"Failed to clean up storage file {storage_path} after commit failure.")
                raise HTTPException(status_code=500, detail="Database error creating DataSource record.")
            # --- End Commit BEFORE queueing ---

            # Queue the single ingestion task
            logger.info(f"Queuing ingestion task for single PDF DataSource {datasource.id}")
            process_datasource.delay(datasource.id)

        else:
            # --- Bulk PDF Upload ---
            # Create ONE parent DataSource
            parent_datasource_uuid = str(uuid.uuid4())
            parent_datasource = DataSource(
                name=name, # Use the provided name
                type=DataSourceType.PDF, # Keep type as PDF, distinguish by metadata/record association
                origin_details={ # Minimal origin details for parent
                     "upload_type": "bulk",
                     "file_count": len(files),
                     **(parsed_origin_details or {}) # Include any other passed details
                 },
                source_metadata={"file_count": len(files)}, # Add file count metadata
                workspace_id=workspace_id,
                user_id=current_user.id,
                status=DataSourceStatus.COMPLETE, 
                entity_uuid=parent_datasource_uuid,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc)
            )
            session.add(parent_datasource)
            session.flush()
            session.refresh(parent_datasource)
            datasource_to_return = parent_datasource # This is the one we return
            created_datasources.append(parent_datasource) # Keep track

            logger.info(f"Created parent DataSource {parent_datasource.id} for bulk PDF upload ({len(files)} files)")

            # Loop through each file, upload, and queue task associated with the PARENT DS
            for file in files:
                if file.content_type != 'application/pdf':
                    # Log warning but continue with others? Or fail whole batch? Let's log and skip.
                    logger.warning(f"Skipping invalid file type '{file.content_type}' in bulk PDF upload for DS {parent_datasource.id}")
                    continue

                individual_uuid = str(uuid.uuid4()) # Unique identifier for storage if needed
                original_filename = file.filename or f"upload_{individual_uuid}.pdf"
                # Store individual files under the PARENT datasource's UUID path
                storage_path = f"datasources/{parent_datasource_uuid}/{original_filename}"

                logger.info(f"Uploading bulk PDF '{original_filename}' to {storage_path} for parent DS {parent_datasource.id}")
                await storage_provider.upload_file(file=file, object_name=storage_path)

                # Queue ingestion task, passing PARENT ID and the specific file details
                task_origin_details = {
                    "filename": original_filename,
                    "storage_path": storage_path,
                    # Add any other details relevant for the *task* if needed
                }
                logger.info(f"Queuing ingestion task for file '{original_filename}' linked to parent DS {parent_datasource.id}")
                # Pass parent ID and details needed by the task to process this specific file
                process_datasource.delay(parent_datasource.id, task_origin_details_override=task_origin_details)

            # The parent DS status will be updated by the tasks as they complete/fail.
            # For now, it remains COMPLETE.

    # --- END MODIFIED PDF HANDLING ---

    elif type == DataSourceType.CSV:
        if not files or len(files) != 1:
            raise HTTPException(status_code=400, detail="Exactly one CSV file is required")
        file = files[0]
        if file.content_type != 'text/csv':
             raise HTTPException(status_code=400, detail=f"Invalid file type for CSV: {file.content_type}")

        datasource_uuid = str(uuid.uuid4())
        original_filename = file.filename or f"upload_{datasource_uuid}.csv"
        storage_path = f"datasources/{datasource_uuid}/{original_filename}"

        # Add CSV specific details to origin_details
        csv_origin_details = {
            "filename": original_filename,
            "storage_path": storage_path,
            "skip_rows": skip_rows, # Will be None if not provided
            "delimiter": delimiter # Will be None if not provided
        }
        csv_origin_details.update(parsed_origin_details)

        datasource = DataSource(
            name=name, type=DataSourceType.CSV, origin_details=csv_origin_details,
            workspace_id=workspace_id, user_id=current_user.id, status=DataSourceStatus.PENDING,
            entity_uuid=datasource_uuid,
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc)
        )
        session.add(datasource)
        session.flush(); session.refresh(datasource)
        datasource_to_return = datasource
        created_datasources.append(datasource)

        logger.info(f"Uploading CSV '{original_filename}' to {storage_path}")
        await storage_provider.upload_file(file=file, object_name=storage_path)
        logger.info(f"Queuing ingestion task for CSV DataSource {datasource.id}")
        process_datasource.delay(datasource.id)

    elif type == DataSourceType.URL_LIST:
        if "urls" not in parsed_origin_details or not isinstance(parsed_origin_details["urls"], list) or not parsed_origin_details["urls"]:
            raise HTTPException(status_code=400, detail="Missing or invalid 'urls' list in origin_details")

        datasource_uuid = str(uuid.uuid4())
        datasource = DataSource(
            name=name, type=DataSourceType.URL_LIST, origin_details=parsed_origin_details,
            workspace_id=workspace_id, user_id=current_user.id, status=DataSourceStatus.PENDING,
            entity_uuid=datasource_uuid,
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc)
        )
        session.add(datasource)
        session.flush(); session.refresh(datasource)
        datasource_to_return = datasource
        created_datasources.append(datasource)
        logger.info(f"Queuing ingestion task for URL_LIST DataSource {datasource.id}")
        process_datasource.delay(datasource.id)

    elif type == DataSourceType.TEXT_BLOCK:
        if "text_content" not in parsed_origin_details or not parsed_origin_details["text_content"].strip():
             raise HTTPException(status_code=400, detail="Missing or empty 'text_content' in origin_details")

        datasource_uuid = str(uuid.uuid4())
        datasource = DataSource(
            name=name, type=DataSourceType.TEXT_BLOCK, origin_details=parsed_origin_details,
            workspace_id=workspace_id, user_id=current_user.id, status=DataSourceStatus.PENDING,
            entity_uuid=datasource_uuid,
            created_at=datetime.now(timezone.utc), updated_at=datetime.now(timezone.utc)
        )
        session.add(datasource)
        session.flush(); session.refresh(datasource)
        datasource_to_return = datasource
        created_datasources.append(datasource)
        logger.info(f"Queuing ingestion task for TEXT_BLOCK DataSource {datasource.id}")
        process_datasource.delay(datasource.id)

    else:
        # Should not happen if using Enum, but good practice
        raise HTTPException(status_code=400, detail=f"Unsupported DataSource type: {type}")

    # Commit transaction
    try:
        session.commit()
        logger.info(f"Committed creation for DataSource(s): {[ds.id for ds in created_datasources]}")
        # Refresh the object we intend to return to ensure it reflects committed state
        if datasource_to_return:
             session.refresh(datasource_to_return)

    except Exception as e:
        session.rollback()
        logger.error(f"Error committing DataSource creation: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Database error during DataSource creation.")

    # Return the single created DataSource (either single PDF/CSV/URL/Text or the parent Bulk PDF)
    if not datasource_to_return:
         # This case should ideally not be reached if validation is correct
         raise HTTPException(status_code=500, detail="Failed to create or retrieve the DataSource object after processing.")

    return DataSourcesOut(data=[datasource_to_return], count=1)

@router.get("", response_model=DataSourcesOut)
@router.get("/", response_model=DataSourcesOut)
def list_datasources(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    session: SessionDep
) -> DataSourcesOut:
    """List DataSources in a workspace."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Build query for datasources
        query = (
            select(DataSource)
            .where(DataSource.workspace_id == workspace_id)
            .order_by(DataSource.created_at.desc()) # Add default ordering
            .offset(skip)
            .limit(limit)
        )
        
        # Execute query
        datasources = session.exec(query).all()
        
        # Get total count (consider optimizing this if performance becomes an issue)
        count_query = select(func.count(DataSource.id)).where(DataSource.workspace_id == workspace_id)
        total_count = session.scalar(count_query) or 0
        
        # Convert to read models
        # The DataSourceRead model should now ideally include the pre-calculated data_record_count
        result_datasources = [DataSourceRead.model_validate(ds) for ds in datasources]
            
        return DataSourcesOut(data=result_datasources, count=total_count)

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception(f"Error listing datasources: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("/{datasource_id}", response_model=DataSourceRead)
def get_datasource(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep
) -> DataSourceRead:
    """Get a specific DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )
        
        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )
        
        # Convert to read model
        # The DataSourceRead model should include the data_record_count field populated by the ingestion task
        result = DataSourceRead.model_validate(datasource)
            
        return result

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("/{datasource_id}/urls", response_model=List[str])
def get_datasource_urls(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep
) -> List[str]:
    """Get the list of URLs for a URL_LIST DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)

        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )

        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )

        # Verify this is a URL_LIST datasource
        if datasource.type != DataSourceType.URL_LIST:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Operation only supported for URL_LIST datasources"
            )

        # Get URLs from origin_details
        origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}
        urls = origin_details.get('urls', [])

        if not isinstance(urls, list):
            logger.error(f"DataSource {datasource_id} origin_details['urls'] is not a list: {type(urls)}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Internal error: URL list format is invalid."
            )

        return urls

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting URLs for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error retrieving URLs"
        )

@router.get("/{datasource_id}/rows", response_model=CsvRowsOut)
async def read_datasource_rows(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    skip: int = Query(0, ge=0, description="Number of rows to skip"),
    limit: int = Query(50, ge=1, le=500, description="Number of rows to return"),
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> CsvRowsOut:
    """Get rows from a CSV DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )
        
        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )
        
        # Verify this is a CSV datasource
        if datasource.type != DataSourceType.CSV:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Operation only supported for CSV datasources"
            )
        
        # Get file path from metadata
        storage_path = None
        if datasource.origin_details and isinstance(datasource.origin_details, dict):
            storage_path = datasource.origin_details.get('storage_path')
        
        if not storage_path and datasource.source_metadata and isinstance(datasource.source_metadata, dict):
             # Fallback (less likely to work based on creation logic)
             storage_path = datasource.source_metadata.get('storage_path')
        
        if not storage_path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="CSV file not found in storage"
            )
        
        # Get file from storage
        file_stream = await storage_provider.get_file(storage_path)
        file_content = file_stream.read()
        
        # Process CSV content
        metadata = datasource.source_metadata or {}
        delimiter = metadata.get('delimiter_used')
        
        # --- CORRECTED delimiter checking logic ---
        is_valid_delimiter = delimiter is not None and len(delimiter) == 1
        if not is_valid_delimiter:
            logger.info(f"Delimiter '{delimiter}' from metadata invalid for DS {datasource_id}. Attempting to sniff or try common delimiters.")
            # If delimiter from metadata is invalid (None or not single char), try to sniff
            sniffed_delimiter = None
            try:
                # Need to decode first for sniffing
                file_content_text_sniff = file_content.decode('utf-8', errors='ignore') # Use ignore for sniffing resilience
                sniffer = csv.Sniffer()
                dialect = sniffer.sniff(file_content_text_sniff[:2048]) # Sniff larger sample
                sniffed_delimiter = dialect.delimiter
                if sniffed_delimiter and len(sniffed_delimiter) == 1:
                     delimiter = sniffed_delimiter
                     logger.info(f"Sniffed delimiter for DS {datasource_id}: '{delimiter}'")
                     is_valid_delimiter = True # Mark as valid now
                else:
                    logger.warning(f"Sniffing yielded invalid delimiter '{sniffed_delimiter}' for DS {datasource_id}.")
            except Exception as sniff_err:
                logger.warning(f"Could not sniff delimiter for DS {datasource_id}. Error: {sniff_err}")

            # If still not valid, try common delimiters
            if not is_valid_delimiter:
                common_delimiters = [ ';', '\t', '|', ','] # Try comma last as it was default
                logger.info(f"Attempting common delimiters for DS {datasource_id}: {common_delimiters}")
                found_common = False
                for common_delim in common_delimiters:
                     try:
                         # Need decoded text to test reading header
                         temp_text_io = io.StringIO(file_content.decode('utf-8', errors='ignore'))
                         temp_reader = csv.reader(temp_text_io, delimiter=common_delim)
                         header = next(temp_reader) # Try reading the header
                         if header and len(header) > 0: # Basic check if header seems valid
                             delimiter = common_delim
                             is_valid_delimiter = True
                             found_common = True
                             logger.info(f"Determined delimiter '{delimiter}' by testing common options for DS {datasource_id}.")
                             break # Use the first one that works
                     except Exception as common_err:
                         logger.debug(f"Testing delimiter '{common_delim}' failed for DS {datasource_id}: {common_err}")
                         continue # Try next delimiter
                
                if not found_common:
                    logger.error(f"Could not determine a valid delimiter for DS {datasource_id} after sniffing and trying common options.")
                    raise ValueError("Could not determine CSV delimiter or parse header.")
        # --- END CORRECTION --- 

        # Decode content using detected or default encoding
        encoding_to_use = 'utf-8' # Start with default
        try:
            file_content_text = file_content.decode(encoding_to_use)
        except UnicodeDecodeError:
            try:
                file_content_text = file_content.decode('latin-1')
            except UnicodeDecodeError:
                detected = chardet.detect(file_content)
                if detected['encoding'] and detected['confidence'] > 0.7:
                    file_content_text = file_content.decode(detected['encoding'])
                else:
                    raise ValueError("Could not determine file encoding")
        
        lines = file_content_text.splitlines()
        header_line = lines[0] if lines else ""
        
        # Parse CSV
        rows_data: List[CsvRowData] = [] # Changed type to CsvRowData
        reader = csv.DictReader(io.StringIO(file_content_text), delimiter=delimiter)
        columns = reader.fieldnames or []
        
        # Skip rows
        for _ in range(skip):
            try:
                next(reader)
            except StopIteration:
                break
        
        # Read requested rows
        for i, row_dict in enumerate(reader):
            if i >= limit:
                break
            # Calculate original file line number (1-based)
            # Assumes header is 1 row, add skip (which is 0-based index of data rows)
            # Add current loop index (i, 0-based within the reader after skipping)
            # Add 1 because header is row 1, add 1 because data starts after header
            original_file_line_number = 1 + skip + i + 1 
            sanitized_row = _sanitize_csv_row(row_dict)
            # Create CsvRowData object
            csv_row_obj = CsvRowData(row_data=sanitized_row, row_number=original_file_line_number)
            rows_data.append(csv_row_obj)
        
        return CsvRowsOut(
            columns=columns,
            data=rows_data, # Pass the list of CsvRowData objects
            total_rows=len(lines) - 1 if lines else 0
        )

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting rows for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.delete("/{datasource_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_datasource(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> None:
    """Delete a DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )
        
        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )
        
        # Get associated file path if available
        file_path_to_delete = None
        if datasource.source_metadata and isinstance(datasource.source_metadata, dict):
            file_path_to_delete = datasource.source_metadata.get('storage_path')
        
        # Delete DB record
        session.delete(datasource)
        session.commit()
        
        # If file path exists, delete file from storage
        if file_path_to_delete:
            try:
                storage_provider.delete_file_sync(file_path_to_delete)
                logger.info(f"Deleted file {file_path_to_delete} for datasource {datasource_id}")
            except Exception as storage_err:
                # Log but don't fail if file deletion fails
                logger.error(f"Failed to delete storage file {file_path_to_delete}: {storage_err}")

    except ValueError as e:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except HTTPException as he:
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Error deleting datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during deletion"
        )

@router.put("/{datasource_id}", response_model=DataSourceRead)
async def update_datasource(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    update_data: DataSourceUpdate,
    session: SessionDep,
    ingestion_service: IngestionService = Depends(get_ingestion_service)
) -> DataSourceRead:
    """Update an existing DataSource."""
    try:
        updated_datasource = await ingestion_service.update_datasource(
            datasource_id=datasource_id,
            workspace_id=workspace_id,
            user_id=current_user.id,
            update_data=update_data
        )
        if not updated_datasource:
            # This case might not happen if service raises exceptions, but good practice
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DataSource not found or update failed")
        
        # Commit transaction after successful service call
        session.commit()
        session.refresh(updated_datasource) # Refresh to get latest DB state after commit
        return updated_datasource
    
    except HTTPException as he:
        session.rollback() # Rollback on known HTTP errors from service/validation
        raise he
    except Exception as e:
        session.rollback() # Rollback on unexpected errors
        logger.exception(f"Error updating datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during update"
        )

@router.post("/{datasource_id}/refetch", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
async def refetch_datasource(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep,
    ingestion_service: IngestionService = Depends(get_ingestion_service)
):
    """Trigger a background re-ingestion task for a DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)

        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )
        
        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )
        
        # --- Set status to PENDING --- 
        # This provides immediate feedback and ensures the task runs
        try:
            updated_datasource = await ingestion_service.update_datasource(
                datasource_id=datasource_id,
                workspace_id=workspace_id,
                user_id=current_user.id,
                update_data=DataSourceUpdate(status=DataSourceStatus.PENDING, error_message=None) # Also clear previous errors
            )
            session.commit() # Commit the status change
            logger.info(f"Set DataSource {datasource_id} status to PENDING for refetch.")
        except Exception as update_err:
             session.rollback()
             logger.error(f"Failed to set DataSource {datasource_id} status to PENDING: {update_err}", exc_info=True)
             # Decide if we should proceed or raise error - let's raise for now
             raise HTTPException(status_code=500, detail="Failed to update DataSource status before queueing refetch.")
        # --- End Status Update ---

        # Queue ingestion task
        process_datasource.delay(datasource_id)
        logger.info(f"Queued refetch ingestion task for DataSource {datasource_id}")

        return Message(message="Datasource refetch task queued successfully.")

    except HTTPException as he:
        # Rollback might not be needed if status update failed and rolled back already
        # session.rollback() 
        raise he
    except Exception as e:
        # session.rollback() # Rollback if status update committed but task queuing failed? Complex.
        logger.exception(f"Error triggering refetch for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error during refetch trigger"
        )

@router.get("/{datasource_id}/content", response_class=StreamingResponse)
async def get_datasource_content(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep,
    storage_provider: StorageProviderDep
):
    """Get the raw content of a PDF DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)

        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found"
            )

        # Verify datasource belongs to workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataSource not found in this workspace"
            )

        # Verify this is a PDF datasource
        if datasource.type != DataSourceType.PDF:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Operation only supported for PDF datasources"
            )

        # Get file path from metadata
        storage_path = None
        if datasource.origin_details and isinstance(datasource.origin_details, dict):
            storage_path = datasource.origin_details.get('storage_path')
        
        if not storage_path:
            # Fallback to origin_details for single PDFs
            if datasource.origin_details and isinstance(datasource.origin_details, dict):
                storage_path = datasource.origin_details.get('storage_path')

        if not storage_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF file storage path not found in metadata or origin details")

        # Get file stream from storage
        try:
            file_stream = await storage_provider.get_file(storage_path)
            filename = datasource.source_metadata.get('filename', f"datasource_{datasource_id}.pdf")
            
            # Return the stream with proper headers
            return StreamingResponse(
                file_stream,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"inline; filename=\"{filename}\"",
                    "Content-Type": "application/pdf",
                    # Add Cache-Control header to prevent caching issues
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    # Add Content-Transfer-Encoding header to ensure binary data is handled correctly
                    "Content-Transfer-Encoding": "binary"
                }
            )
        except FileNotFoundError:
            logger.error(f"PDF file not found in storage for DS {datasource_id}: {storage_path}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="PDF file not found in storage"
            )
        except Exception as e:
             # Catch other storage provider errors
             logger.error(f"Error retrieving file from storage for DS {datasource_id}: {e}", exc_info=True)
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving file from storage")


    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting content for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error retrieving content"
        )

@router.get("/{datasource_id}/pdf_download", response_class=StreamingResponse)
async def download_datasource_pdf(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    session: SessionDep,
    storage_provider: StorageProviderDep
):
    """Download the PDF file for a DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)

        # Get datasource
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DataSource not found")
        if datasource.workspace_id != workspace_id:
             raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DataSource not found in this workspace")
        if datasource.type != DataSourceType.PDF:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Operation only supported for PDF datasources")

        # Get file path from metadata
        storage_path = datasource.source_metadata.get('storage_path') if datasource.source_metadata and isinstance(datasource.source_metadata, dict) else None
        if not storage_path:
            # Fallback to origin_details for single PDFs
            if datasource.origin_details and isinstance(datasource.origin_details, dict):
                storage_path = datasource.origin_details.get('storage_path')

        if not storage_path:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF file storage path not found in metadata or origin details")

        # Get file stream from storage
        try:
            file_stream = await storage_provider.get_file(storage_path)
            filename = datasource.source_metadata.get('filename', f"datasource_{datasource_id}.pdf")
            
            # Return the stream as an attachment download
            return StreamingResponse(
                file_stream,
                media_type="application/pdf",
                headers={
                    "Content-Disposition": f"attachment; filename=\"{filename}\"",
                    "Content-Type": "application/pdf" # Ensure Content-Type is set for download
                }
            )
        except FileNotFoundError:
            logger.error(f"PDF file not found in storage for DS {datasource_id}: {storage_path}")
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="PDF file not found in storage")
        except Exception as e:
             logger.error(f"Error retrieving file for download: {e}", exc_info=True)
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving file from storage")

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error initiating PDF download for datasource {datasource_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error initiating download")



@router.put("/{datasource_id}/urls", response_model=DataSourceRead)
def update_datasource_urls(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    urls_input: List[str] = Body(..., embed=True, description="The complete new list of URLs for the DataSource"),
    session: SessionDep,
    ingestion_service: IngestionService = Depends(get_ingestion_service)
) -> DataSourceRead:
    """
    Update the list of URLs for a URL_LIST DataSource.
    Replaces the existing list entirely. If URLs are removed,
    their corresponding DataRecords will be deleted.
    """
    try:
        # Ensure the input is actually a list, Body(embed=True) requires a key matching the param name
        # The frontend needs to send {"urls_input": ["url1", "url2"]}
        if not isinstance(urls_input, list):
             raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Request body must be a JSON list of URLs under the key 'urls_input'.")
        
        updated_datasource = ingestion_service.update_datasource_urls(
            datasource_id=datasource_id,
            workspace_id=workspace_id,
            user_id=current_user.id,
            new_urls=urls_input # Pass the list directly
        )
        # Commit the transaction after successful service call
        session.commit()
        session.refresh(updated_datasource)
        # Optionally trigger refetch here or leave it to the user?
        # For now, let's not auto-trigger. User can click refetch button.
        # try:
        #     from app.api.tasks.ingestion import process_datasource
        #     process_datasource.delay(updated_datasource.id)
        #     logger.info(f"Queued automatic refetch task for DataSource {updated_datasource.id} after URL update.")
        # except Exception as e:
        #     logger.error(f"Failed to queue automatic refetch task for DataSource {updated_datasource.id} after URL update: {e}")

        return updated_datasource

    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        session.rollback()
        # Re-raise specific HTTPExceptions (like 422 from validation)
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Error updating URLs for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error updating URLs"
        )
# --- END NEW ENDPOINT ---
