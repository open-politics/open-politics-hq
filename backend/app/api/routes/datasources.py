from typing import Any, List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form
import fitz # PyMuPDF for metadata extraction
import logging # Added logging

from sqlmodel import Session, select, func
from sqlalchemy.orm import joinedload

from app.models import (
    DataSource,
    DataSourceCreate,
    DataSourceRead,
    DataSourceUpdate,
    DataSourceType,
    DataSourceStatus,
    DataSourcesOut,
    Workspace,
    User,
    DataRecord,
    CsvRowsOut,
    CsvRowData
)
from app.api.deps import SessionDep, CurrentUser
from app.tasks.ingestion import process_datasource, sanitize_csv_row
from app.core.minio_utils import minio_client
import io
import csv
import json

# --- Helper Function (Adapted from utils.py) --- 
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

router = APIRouter(
    prefix="/workspaces/{workspace_id}/datasources",
    tags=["DataSources"]
)


@router.post("", response_model=DataSourcesOut)
@router.post("/", response_model=DataSourcesOut)
async def create_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    name: str = Form(...),
    type: DataSourceType = Form(...),
    origin_details: Optional[str] = Form("{}"),
    files: Optional[List[UploadFile]] = File(None),
    skip_rows: Optional[int] = Form(0, ge=0, description="Number of initial rows to skip (for CSV)"),
    delimiter: Optional[str] = Form(None, description="Single character delimiter (for CSV)")
) -> DataSourcesOut:
    """
    Create a new DataSource or multiple DataSources (for bulk PDF upload).
    For PDF uploads, multiple files can be provided; one DataSource will be created per file,
    using extracted PDF title metadata for the name.
    For other types (CSV, URL, Text), only one source is created per request.
    CSV options: skip_rows, delimiter.
    Triggers background task(s) for ingestion.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    created_sources: List[DataSource] = []
    tasks_to_trigger: List[int] = []
    uploaded_object_names: List[str] = [] # Keep track for potential cleanup

    try:
        # --- Handle PDF Bulk Upload --- 
        if type == DataSourceType.PDF:
            if not files:
                raise HTTPException(status_code=400, detail="At least one PDF file upload required for type 'pdf'")

            for pdf_file in files:
                if not pdf_file.filename or not pdf_file.filename.lower().endswith(".pdf"):
                     logging.warning(f"Skipping non-PDF file during bulk upload: {pdf_file.filename}")
                     continue # Skip non-PDF files in the batch
                
                # Generate a temporary unique ID for this source within the batch logic
                # We'll use a placeholder mechanism, assuming DB generates final ID upon add/flush
                temp_id_placeholder = f"pending_{len(created_sources) + 1}" 
                object_name = f"workspace_{workspace_id}/datasource_{temp_id_placeholder}_{pdf_file.filename}"
                
                try:
                    # Read file content for metadata extraction and upload
                    file_content = await pdf_file.read()
                    await pdf_file.seek(0) # Reset file pointer for upload

                    # Extract Metadata (Sync helper used here for simplicity within async route)
                    metadata = _extract_pdf_metadata_sync(file_content, pdf_file.filename)
                    source_name = metadata.get('title') or pdf_file.filename.replace(".pdf", "")
                    
                    # Upload to MinIO
                    uploaded_path = await minio_client.upload_file(pdf_file, object_name)
                    uploaded_object_names.append(object_name) # Track successful uploads

                    # Prepare Origin Details
                    pdf_origin_details = {
                        'filepath': uploaded_path,
                        'filename': pdf_file.filename,
                        'content_type': pdf_file.content_type
                    }
                    
                    # Prepare Source Metadata (optional, can be enriched by ingestion task)
                    pdf_source_metadata = {
                        'page_count': metadata.get('page_count')
                    }

                    # Create DataSource Object
                    ds_data = {
                        "name": source_name,
                        "type": DataSourceType.PDF,
                        "workspace_id": workspace_id,
                        "user_id": current_user.id,
                        "status": DataSourceStatus.PENDING,
                        "origin_details": pdf_origin_details,
                        "source_metadata": pdf_source_metadata
                    }
                    new_datasource = DataSource.model_validate(ds_data)
                    created_sources.append(new_datasource)
                    session.add(new_datasource)
                    # Flush to get IDs before triggering tasks?
                    # Flushing within loop can be inefficient. Let's flush after loop.

                except Exception as pdf_proc_err:
                    logging.error(f"Error processing PDF file {pdf_file.filename}: {pdf_proc_err}", exc_info=True)
                    # Consider how to handle partial failures - skip this file? Fail the whole batch?
                    # For now, let's skip this file and continue with others
                    continue 
            
            if not created_sources:
                 raise HTTPException(status_code=400, detail="No valid PDF files processed successfully.")

        # --- Handle CSV (Single File) --- 
        elif type == DataSourceType.CSV:
            if not files or len(files) != 1:
                raise HTTPException(status_code=400, detail="Exactly one CSV file upload required for type 'csv'")
            file = files[0]
            if not file.filename:
                 raise HTTPException(status_code=400, detail="CSV file must have a name")

            # Use placeholder for ID in object name, actual ID assigned on flush
            object_name = f"workspace_{workspace_id}/datasource_csv_pending/{file.filename}"
            uploaded_path = await minio_client.upload_file(file, object_name)
            uploaded_object_names.append(object_name) # Track upload

            csv_origin_details = {
                'filepath': uploaded_path,
                'filename': file.filename,
                'content_type': file.content_type
            }
            if skip_rows is not None and skip_rows >= 0:
                csv_origin_details['skip_rows'] = skip_rows
            if delimiter is not None and len(delimiter) == 1:
                csv_origin_details['delimiter'] = delimiter
            
            ds_data = {
                "name": name, # Use the provided form name for CSV
                "type": DataSourceType.CSV,
                "workspace_id": workspace_id,
                "user_id": current_user.id,
                "status": DataSourceStatus.PENDING,
                "origin_details": csv_origin_details,
                "source_metadata": {}
            }
            new_datasource = DataSource.model_validate(ds_data)
            created_sources.append(new_datasource)
            session.add(new_datasource)

        # --- Handle URL List --- 
        elif type == DataSourceType.URL_LIST:
            if files: raise HTTPException(status_code=400, detail="File upload not supported for URL_LIST type")
            try:
                parsed_origin_details = json.loads(origin_details or '{}')
            except json.JSONDecodeError:
                 raise HTTPException(status_code=400, detail="Invalid JSON in origin_details")
            if 'urls' not in parsed_origin_details or not isinstance(parsed_origin_details.get('urls'), list):
                 raise HTTPException(status_code=400, detail="'urls' list required in origin_details for type URL_LIST")
            
            ds_data = {
                "name": name, # Use provided form name
                "type": DataSourceType.URL_LIST,
                "workspace_id": workspace_id,
                "user_id": current_user.id,
                "status": DataSourceStatus.PENDING,
                "origin_details": parsed_origin_details,
                "source_metadata": {}
            }
            new_datasource = DataSource.model_validate(ds_data)
            created_sources.append(new_datasource)
            session.add(new_datasource)

        # --- Handle Text Block --- 
        elif type == DataSourceType.TEXT_BLOCK:
            if files: raise HTTPException(status_code=400, detail="File upload not supported for TEXT_BLOCK type")
            try:
                parsed_origin_details = json.loads(origin_details or '{}')
            except json.JSONDecodeError:
                 raise HTTPException(status_code=400, detail="Invalid JSON in origin_details")
            if 'text_content' not in parsed_origin_details or not isinstance(parsed_origin_details.get('text_content'), str):
                 raise HTTPException(status_code=400, detail="'text_content' string required in origin_details for type TEXT_BLOCK")
            
            ds_data = {
                "name": name, # Use provided form name
                "type": DataSourceType.TEXT_BLOCK,
                "workspace_id": workspace_id,
                "user_id": current_user.id,
                "status": DataSourceStatus.PENDING,
                "origin_details": parsed_origin_details,
                "source_metadata": {}
            }
            new_datasource = DataSource.model_validate(ds_data)
            created_sources.append(new_datasource)
            session.add(new_datasource)

        # --- Unsupported Type --- 
        else:
            # This case should ideally be caught by Pydantic validation of the Enum
            raise HTTPException(status_code=400, detail=f"Unsupported DataSource type: {type}")

        # --- Commit and Prepare Tasks --- 
        session.flush() # Assign IDs to all created_sources

        # Update object names with real IDs if needed (important for CSV)
        for i, ds in enumerate(created_sources):
            if ds.id is None: # Should not happen after flush, but check
                 raise ValueError(f"DataSource did not get an ID after flush: {ds.name}")
            tasks_to_trigger.append(ds.id) # Collect IDs for task triggering
            
            # Example: Correcting CSV object name after getting ID (if structure used ID)
            if ds.type == DataSourceType.CSV and 'filepath' in ds.origin_details:
                 old_object_name_base = f"workspace_{workspace_id}/datasource_csv_pending/"
                 original_filename = ds.origin_details.get('filename', 'unknown.csv')
                 # Find the corresponding original upload name 
                 old_object_name = next((n for n in uploaded_object_names if n.endswith(original_filename) and n.startswith(old_object_name_base)), None)
                 
                 if old_object_name: # If we tracked the original upload name correctly
                     new_object_name = f"workspace_{workspace_id}/datasource_{ds.id}/{original_filename}"
                     try:
                         await minio_client.rename_file(old_object_name, new_object_name)
                         ds.origin_details['filepath'] = new_object_name # Update path in DB model
                         uploaded_object_names.remove(old_object_name) # Remove old name from cleanup list
                         uploaded_object_names.append(new_object_name) # Add new name to cleanup list (though unlikely needed now)
                         session.add(ds) # Stage the update to origin_details
                     except Exception as rename_err:
                          logging.error(f"Failed to rename MinIO object from {old_object_name} to {new_object_name}: {rename_err}", exc_info=True)
                          # Decide how to handle - maybe fail the specific source creation?
                          # For now, log error and potentially leave path as temporary one.
                          pass

        session.commit() # Commit all sources and path updates

        # Refresh objects to get final state from DB
        for ds in created_sources:
            session.refresh(ds)

        # --- Trigger Background Tasks --- 
        for ds_id in tasks_to_trigger:
            try:
                process_datasource.delay(ds_id)
            except Exception as task_err:
                # Log this internally. The datasource is created, but ingestion won't start.
                logging.error(f"Failed to trigger ingestion task for DataSource {ds_id}: {task_err}", exc_info=True)
                # Optionally update status to FAILED here?
                try:
                     fail_ds = session.get(DataSource, ds_id)
                     if fail_ds:
                          fail_ds.status = DataSourceStatus.FAILED
                          fail_ds.error_message = f"Failed to queue ingestion task: {str(task_err)[:250]}"
                          session.add(fail_ds)
                          session.commit()
                except Exception as status_update_err:
                     logging.error(f"Failed to mark DataSource {ds_id} as FAILED after task queue error: {status_update_err}")

        # Return the list of created sources
        return DataSourcesOut(data=[DataSourceRead.model_validate(ds) for ds in created_sources], count=len(created_sources))

    except Exception as e:
        session.rollback() # Rollback any partial DB changes
        logging.error(f"Error during DataSource creation (workspace {workspace_id}): {e}", exc_info=True)
        # Attempt to clean up any uploaded files if an error occurred
        for obj_name in uploaded_object_names:
            try:
                logging.warning(f"Attempting cleanup of uploaded file due to error: {obj_name}")
                await minio_client.delete_file(obj_name)
            except Exception as cleanup_err:
                logging.error(f"Failed to cleanup MinIO object {obj_name}: {cleanup_err}", exc_info=True)
        # Re-raise as a 500 error
        if isinstance(e, HTTPException):
             raise e # Preserve original HTTP error if it was one
        else:
             raise HTTPException(status_code=500, detail=f"An unexpected error occurred: {str(e)}")


@router.get("", response_model=DataSourcesOut)
@router.get("/", response_model=DataSourcesOut)
def read_datasources(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(False, description="Include count of data records for each source")
) -> Any:
    """
    Retrieve DataSources for the workspace.
    Optionally include the count of associated DataRecords.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    statement = select(DataSource).where(DataSource.workspace_id == workspace_id)

    count_statement = select(func.count()).select_from(DataSource).where(DataSource.workspace_id == workspace_id)
    total_count = session.exec(count_statement).one()

    statement = statement.offset(skip).limit(limit)

    datasources = session.exec(statement).all()

    datasource_reads = []
    if include_counts:
        for ds in datasources:
            record_count_stmt = select(func.count()).select_from(DataRecord).where(DataRecord.datasource_id == ds.id)
            record_count = session.exec(record_count_stmt).one()
            ds_read = DataSourceRead.model_validate(ds)
            ds_read.data_record_count = record_count
            datasource_reads.append(ds_read)
    else:
         datasource_reads = [DataSourceRead.model_validate(ds) for ds in datasources]


    return DataSourcesOut(data=datasource_reads, count=total_count)


@router.get("/{datasource_id}", response_model=DataSourceRead)
def read_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    include_counts: bool = Query(False, description="Include count of data records")
) -> Any:
    """
    Retrieve a specific DataSource by its ID.
    """
    datasource = session.get(DataSource, datasource_id)
    if (
        not datasource
        or datasource.workspace_id != workspace_id
        or datasource.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="DataSource not found or not accessible")

    datasource_read = DataSourceRead.model_validate(datasource)

    if include_counts:
        record_count = None
        if datasource.source_metadata and isinstance(datasource.source_metadata, dict):
             if datasource.type == DataSourceType.CSV:
                  record_count = datasource.source_metadata.get('row_count_processed')
             elif datasource.type == DataSourceType.URL_LIST:
                  record_count = datasource.source_metadata.get('processed_count')

        if record_count is None or datasource.status in [DataSourceStatus.PENDING, DataSourceStatus.PROCESSING]:
             record_count_stmt = select(func.count()).select_from(DataRecord).where(DataRecord.datasource_id == datasource.id)
             record_count = session.scalar(record_count_stmt) or 0

        datasource_read.data_record_count = record_count if isinstance(record_count, int) else 0


    return datasource_read


@router.get("/{datasource_id}/rows", response_model=CsvRowsOut)
def read_datasource_rows(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    skip: int = Query(0, ge=0, description="Number of rows to skip (relative to data rows, after header)"),
    limit: int = Query(50, ge=1, le=500, description="Number of rows to return")
) -> Any:
    """
    Retrieve rows from a CSV DataSource, with pagination.
    Uses stored configuration and sanitizes row data.
    """
    datasource = session.get(DataSource, datasource_id)
    if ( not datasource or datasource.workspace_id != workspace_id or datasource.user_id != current_user.id ):
        raise HTTPException(status_code=404, detail="DataSource not found or not accessible")

    if datasource.type != DataSourceType.CSV:
        raise HTTPException(status_code=400, detail="DataSource is not of type CSV")

    origin_details = datasource.origin_details if isinstance(datasource.origin_details, dict) else {}
    source_metadata = datasource.source_metadata if isinstance(datasource.source_metadata, dict) else {}

    filepath = origin_details.get('filepath')
    if not filepath:
        raise HTTPException(status_code=500, detail="CSV file path not found in origin details")

    try:
        skip_rows = int(origin_details.get('skip_rows', 0))
        if skip_rows < 0: skip_rows = 0
    except (ValueError, TypeError): skip_rows = 0
    delimiter = origin_details.get('delimiter', ',')
    if delimiter and len(delimiter) > 1: delimiter = delimiter[0]
    elif not delimiter: delimiter = ','
    encoding = origin_details.get('encoding', 'utf-8')
    encoding_used = source_metadata.get('encoding_used', encoding)

    columns = source_metadata.get('columns', [])
    total_rows = source_metadata.get('row_count_processed', 0)

    rows_data: List[CsvRowData] = []
    minio_response = None
    try:
        minio_response = minio_client.get_file_object(filepath)
        file_content_bytes = minio_response.read()
        try:
            file_content_text = file_content_bytes.decode(encoding_used)
        except UnicodeDecodeError:
            try:
                file_content_text = file_content_bytes.decode(encoding)
            except UnicodeDecodeError:
                 raise HTTPException(status_code=500, detail=f"Failed to decode CSV with original or detected encoding.")

        lines = file_content_text.splitlines()
        if not lines or skip_rows >= len(lines):
            return CsvRowsOut(data=[], total_rows=total_rows, columns=columns)

        content_lines = lines[skip_rows:]
        if not content_lines:
             return CsvRowsOut(data=[], total_rows=total_rows, columns=columns)

        header_line = content_lines[0]
        data_lines_all = content_lines[1:]

        start_data_index = skip
        end_data_index = skip + limit
        data_lines_paginated = data_lines_all[start_data_index:end_data_index]

        if not data_lines_paginated:
             return CsvRowsOut(data=[], total_rows=total_rows, columns=columns)

        csv_content_for_reader = header_line + '\n' + '\n'.join(data_lines_paginated)
        csv_data_io = io.StringIO(csv_content_for_reader)
        reader = csv.DictReader(csv_data_io, delimiter=delimiter)

        if not reader.fieldnames:
             raise HTTPException(status_code=500, detail="Could not parse CSV header.")

        try:
            for i, row_dict in enumerate(reader):
                sanitized_row = sanitize_csv_row(row_dict)
                filtered_sanitized = {k: v for k, v in sanitized_row.items() if k in columns}

                original_data_row_index = skip + i
                original_file_line_number = skip_rows + 1 + original_data_row_index + 1

                rows_data.append(CsvRowData(row_data=filtered_sanitized, row_number=original_file_line_number))
        except csv.Error as csv_err:
            raise HTTPException(status_code=500, detail=f"Failed to parse CSV data: {str(csv_err)}")

    except FileNotFoundError:
        raise HTTPException(status_code=404, detail=f"CSV file not found in storage")
    except UnicodeDecodeError:
        raise HTTPException(status_code=500, detail=f"Failed to decode CSV file. Check encoding (expected {encoding}).")
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process CSV file: {str(e)}")
    finally:
         if minio_response:
             try: minio_response.close(); minio_response.release_conn()
             except Exception as e: pass # Log internally if needed

    return CsvRowsOut(data=rows_data, total_rows=total_rows, columns=columns)


@router.delete("/{datasource_id}", status_code=204)
def delete_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int
) -> None:
    """
    Delete a DataSource and its associated DataRecords (due to cascade).
    """
    datasource = session.get(DataSource, datasource_id)
    if (
        not datasource
        or datasource.workspace_id != workspace_id
        or datasource.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="DataSource not found")

    # Add checks here if a datasource should not be deleted under certain conditions

    try:
        session.delete(datasource)
        session.commit()
        return None
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Could not delete DataSource: {str(e)}")