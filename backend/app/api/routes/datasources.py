from typing import Any, List, Optional, Dict
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File, Form

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


router = APIRouter(
    prefix="/workspaces/{workspace_id}/datasources",
    tags=["DataSources"]
)


@router.post("", response_model=DataSourceRead)
@router.post("/", response_model=DataSourceRead)
async def create_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    name: str = Form(...),
    type: DataSourceType = Form(...),
    origin_details: Optional[str] = Form("{}"),
    file: Optional[UploadFile] = File(None),
    skip_rows: Optional[int] = Form(0, ge=0, description="Number of initial rows to skip (for CSV)"),
    delimiter: Optional[str] = Form(None, description="Single character delimiter (for CSV)")
) -> Any:
    """
    Create a new DataSource. Includes options for CSV header row and delimiter.
    Triggers a background task for ingestion.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    temp_datasource_data = {
        "name": name,
        "type": type,
        "workspace_id": workspace_id,
        "user_id": current_user.id,
        "status": DataSourceStatus.PENDING,
        "origin_details": {},
        "source_metadata": {}
    }

    datasource_id = None
    try:
        temp_datasource = DataSource.model_validate(temp_datasource_data)
        session.add(temp_datasource)
        session.flush()
        datasource_id = temp_datasource.id
        if datasource_id is None: raise ValueError("Failed to obtain DataSource ID after flush.")
    except Exception as e:
        session.rollback()
        raise HTTPException(status_code=500, detail=f"Database error during initial save: {str(e)}")

    final_origin_details = {}
    object_name = None
    try:
        parsed_origin_details = json.loads(origin_details or '{}')
        final_origin_details.update(parsed_origin_details)

        if type == DataSourceType.CSV or type == DataSourceType.PDF:
            if not file:
                raise HTTPException(status_code=400, detail=f"File upload required for type '{type}'")

            object_name = f"workspace_{workspace_id}/datasource_{datasource_id}/{file.filename}"
            uploaded_path = await minio_client.upload_file(file, object_name)

            final_origin_details.update({
                'filepath': uploaded_path,
                'filename': file.filename,
                'content_type': file.content_type
            })

            if type == DataSourceType.CSV:
                if skip_rows is not None and skip_rows >= 0:
                    final_origin_details['skip_rows'] = skip_rows
                if delimiter is not None and len(delimiter) == 1:
                    final_origin_details['delimiter'] = delimiter
                elif delimiter is not None:
                    # Silently ignore invalid delimiter or consider raising 400?
                    pass

        elif type == DataSourceType.URL_LIST:
            if 'urls' not in final_origin_details or not isinstance(final_origin_details.get('urls'), list):
                 raise HTTPException(status_code=400, detail="'urls' list required in origin_details for type URL_LIST")

        elif type == DataSourceType.TEXT_BLOCK:
            if 'text_content' not in final_origin_details or not isinstance(final_origin_details.get('text_content'), str):
                 raise HTTPException(status_code=400, detail="'text_content' string required in origin_details for type TEXT_BLOCK")

        else:
             raise HTTPException(status_code=400, detail=f"Unsupported DataSource type: {type}")

    except HTTPException as http_exc:
        session.rollback()
        raise http_exc
    except Exception as e:
        session.rollback()
        if object_name:
            try:
                await minio_client.delete_file(object_name)
            except Exception as cleanup_err:
                # Log this internally if possible, but don't expose to user
                pass
        raise HTTPException(status_code=500, detail=f"Error processing input: {str(e)}")

    try:
        datasource = session.get(DataSource, datasource_id)
        if not datasource:
             raise ValueError("DataSource lost after flush.")
        datasource.origin_details = final_origin_details
        session.add(datasource)
        session.commit()
        session.refresh(datasource)
    except Exception as e:
        session.rollback()
        if object_name:
            try:
                await minio_client.delete_file(object_name)
            except Exception as cleanup_err:
                # Log this internally if possible
                pass
        raise HTTPException(status_code=500, detail=f"Database error saving final details: {str(e)}")

    try:
        process_datasource.delay(datasource.id)
    except Exception as e:
        # Log this internally. The datasource is created, but ingestion won't start.
        # Consider updating status to FAILED or similar?
        pass

    return datasource


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