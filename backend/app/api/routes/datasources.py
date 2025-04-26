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

from fastapi import APIRouter, HTTPException, Query, UploadFile, File, Form, status, Depends
from fastapi.responses import StreamingResponse
import chardet
import dateutil.parser
import fitz  # PyMuPDF

from sqlmodel import Session, select
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
    skip_rows: Optional[int] = Form(0, ge=0, description="Number of initial rows to skip (for CSV)"),
    delimiter: Optional[str] = Form(None, description="Single character delimiter (for CSV)"),
    session: SessionDep,
    ingestion_service: IngestionService = Depends(get_ingestion_service)
) -> DataSourcesOut:
    """Create a new DataSource."""
    try:
        # Validate workspace access
        validate_workspace_access(session, workspace_id, current_user.id)
        
        # Call the service to handle creation logic
        created_sources = await ingestion_service.create_datasource(
            workspace_id=workspace_id,
            user_id=current_user.id,
            name=name,
            type=type,
            origin_details_str=origin_details,
            files=files,
            skip_rows=skip_rows,
            delimiter=delimiter,
        )
        
        # Commit the transaction (Service does not commit)
        session.commit()

        # Queue ingestion tasks for each created source
        for ds in created_sources:
            try:
                from app.api.tasks.ingestion import process_datasource
                process_datasource.delay(ds.id)
                logger.info(f"Queued ingestion task for DataSource {ds.id}")
            except Exception as e:
                logger.error(f"Failed to queue ingestion task for DataSource {ds.id}: {e}")

        return DataSourcesOut(
            data=[DataSourceRead.model_validate(ds) for ds in created_sources],
            count=len(created_sources)
        )

    except ValueError as ve:
        # Specific validation errors from the service or route
        logger.warning(f"Datasource creation validation error: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as e:
        # Catch-all for unexpected errors during service call or task queuing
        logger.error(f"Error creating DataSource (workspace {workspace_id}): {e}", exc_info=True)
        # Rollback is implicitly handled by FastAPI/SQLModel session management on exception
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An unexpected error occurred: {e}",
        )

@router.get("", response_model=DataSourcesOut)
@router.get("/", response_model=DataSourcesOut)
def list_datasources(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(False, description="Include count of data records for each source"),
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
            .offset(skip)
            .limit(limit)
        )
        
        # Execute query
        datasources = session.exec(query).all()
        
        # Get total count
        count_query = select(DataSource).where(DataSource.workspace_id == workspace_id)
        total_count = len(session.exec(count_query).all())
        
        # Convert to read models
        result_datasources = []
        for ds in datasources:
            ds_read = DataSourceRead.model_validate(ds)
            
            # Add record count if requested
            if include_counts:
                count_query = select(DataRecord).where(DataRecord.datasource_id == ds.id)
                record_count = len(session.exec(count_query).all())
                ds_read.data_record_count = record_count
            
            result_datasources.append(ds_read)
            
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
    include_counts: bool = Query(False, description="Include count of data records"),
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
        result = DataSourceRead.model_validate(datasource)
        
        # Add record count if requested
        if include_counts:
            count_query = select(DataRecord).where(DataRecord.datasource_id == datasource_id)
            record_count = len(session.exec(count_query).all())
            result.data_record_count = record_count
            
        return result

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
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
        if datasource.source_metadata and isinstance(datasource.source_metadata, dict):
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
        if datasource.source_metadata and isinstance(datasource.source_metadata, dict):
            storage_path = datasource.source_metadata.get('storage_path')

        if not storage_path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="PDF file storage path not found in metadata"
            )

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
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="PDF file storage path not found in metadata")

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
