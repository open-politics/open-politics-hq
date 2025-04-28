"""
Routes for data record operations.
"""
import logging
from typing import Any, List, Optional, Literal
from fastapi import APIRouter, HTTPException, status
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
import urllib.parse

from app.models import DataRecordRead, DataSource, DataSourceType, DataRecord
from app.api.deps import CurrentUser, SessionDep, IngestionServiceDep, StorageProviderDep
from app.api.services.service_utils import validate_workspace_access

logger = logging.getLogger(__name__)

class AppendRecordInput(BaseModel):
    """Input model for appending a record to a datasource."""
    content: str = Field(..., description="The text content or URL to append")
    content_type: Literal['text', 'url'] = Field(..., description="Type of content being appended")
    event_timestamp: Optional[str] = Field(None, description="Optional ISO 8601 timestamp for the event")

router = APIRouter(
    prefix="/workspaces/{workspace_id}/datarecords",
    tags=["datarecords"]
)

@router.get("/{datarecord_id}", response_model=DataRecordRead)
def get_datarecord(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datarecord_id: int,
    service: IngestionServiceDep
) -> DataRecordRead:
    """Get a specific DataRecord."""
    try:
        data_record = service.get_datarecord(
            datarecord_id=datarecord_id,
            workspace_id=workspace_id,
            user_id=current_user.id
        )
        if not data_record:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="DataRecord not found or not accessible"
            )
        return DataRecordRead.model_validate(data_record)

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception(f"Error getting datarecord {datarecord_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("/by_datasource/{datasource_id}", response_model=List[DataRecordRead])
def list_datarecords(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    skip: int = 0,
    limit: int = 1000,
    service: IngestionServiceDep
) -> List[DataRecordRead]:
    """List DataRecords for a specific DataSource."""
    try:
        data_records = service.list_datarecords(
            datasource_id=datasource_id,
            workspace_id=workspace_id,
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )
        return [DataRecordRead.model_validate(record) for record in data_records]

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception(f"Error listing datarecords for datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("/{datarecord_id}/content", response_class=StreamingResponse)
async def get_datarecord_content(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datarecord_id: int,
    session: SessionDep,
    storage_provider: StorageProviderDep
):
    """Get the raw content of the file associated with a DataRecord (primarily for PDFs)."""
    try:
        # Validate workspace access first
        validate_workspace_access(session, workspace_id, current_user.id)

        # Get the DataRecord
        data_record = session.get(DataRecord, datarecord_id)
        if not data_record:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="DataRecord not found")

        # Get the parent DataSource
        if not data_record.datasource_id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="DataRecord is not linked to a DataSource")

        datasource = session.get(DataSource, data_record.datasource_id)
        if not datasource:
            # This should ideally not happen if datasource_id is set
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Parent DataSource not found")

        # Verify the parent DataSource belongs to the correct workspace
        if datasource.workspace_id != workspace_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Access denied to parent DataSource's workspace")

        # --- Determine Storage Path --- 
        # This logic assumes bulk PDF uploads store files under parent DS UUID
        storage_path = None
        original_filename = None

        # --- REFINED LOGIC for Bulk PDF and Single Files ---
        if datasource.type == DataSourceType.PDF:
            # Prioritize info from the DataRecord's metadata (expected for bulk)
            if isinstance(data_record.source_metadata, dict):
                original_filename = data_record.source_metadata.get('original_filename')
            
            # If filename found in record, construct path using parent DS UUID
            if original_filename and datasource.entity_uuid:
                storage_path = f"datasources/{datasource.entity_uuid}/{original_filename}"
                logger.info(f"[Bulk PDF Path Logic] Determined path: {storage_path} for DR {datarecord_id}")
            else:
                # Fallback: Maybe it's a single PDF upload where path is in DS origin_details?
                if isinstance(datasource.origin_details, dict):
                    storage_path = datasource.origin_details.get('storage_path')
                    original_filename = datasource.origin_details.get('filename') # Get filename from DS details too
                    if storage_path:
                        logger.info(f"[Single PDF Path Logic] Found path in DS origin_details: {storage_path} for DR {datarecord_id}")
        
        # Fallback for non-PDF types or if PDF path wasn't found above
        if not storage_path and isinstance(datasource.origin_details, dict):
            storage_path = datasource.origin_details.get('storage_path')
            original_filename = datasource.origin_details.get('filename')
            if storage_path:
                 logger.info(f"[Fallback Path Logic] Found path in DS origin_details: {storage_path} for DR {datarecord_id}")
        # --- END REFINED LOGIC ---

        if not storage_path or not original_filename:
            logger.error(f"Could not determine storage path or filename for DataRecord {datarecord_id}. DS Type: {datasource.type}, DS origin_details: {datasource.origin_details}, DR source_metadata: {data_record.source_metadata}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Could not determine storage path or filename for this DataRecord."
            )

        # --- Get File Stream --- 
        try:
            file_stream = await storage_provider.get_file(storage_path)
            media_type = "application/pdf" # Assume PDF for now, could determine from filename/type
            if '.csv' in original_filename.lower():
                media_type = "text/csv"
            # Add more types if necessary

            # --- MODIFICATION: Encode filename for header ---
            # Provide a simple ASCII fallback for older clients if possible, otherwise just the original name
            simple_filename = original_filename.encode('ascii', 'ignore').decode('ascii')
            if not simple_filename:
                simple_filename = f"file_{datarecord_id}.pdf" # Generic fallback if ASCII version is empty
            
            # Encode the original filename using UTF-8 for modern clients (RFC 6266)
            encoded_filename = urllib.parse.quote(original_filename, safe='')
            content_disposition = f'inline; filename="{simple_filename}"; filename*=UTF-8\'\'{encoded_filename}'
            # --- END MODIFICATION ---

            # Return the stream with appropriate headers for inline viewing
            return StreamingResponse(
                file_stream,
                media_type=media_type,
                headers={
                    "Content-Disposition": content_disposition,
                    "Content-Type": media_type,
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Content-Transfer-Encoding": "binary" # Important for PDF
                }
            )
        except FileNotFoundError:
            logger.error(f"File not found in storage for DataRecord {datarecord_id}: {storage_path}")
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found in storage"
            )
        except Exception as e:
             logger.error(f"Error retrieving file from storage for DR {datarecord_id}: {e}", exc_info=True)
             raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error retrieving file from storage")

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Error getting content for datarecord {datarecord_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error retrieving content"
        )

@router.post("/by_datasource/{datasource_id}/records", response_model=DataRecordRead, status_code=status.HTTP_201_CREATED)
async def append_record(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    record_in: AppendRecordInput,
    service: IngestionServiceDep
) -> DataRecordRead:
    """Append a record to a DataSource."""
    try:
        data_record = await service.append_record(
            datasource_id=datasource_id,
            workspace_id=workspace_id,
            user_id=current_user.id,
            content=record_in.content,
            content_type=record_in.content_type,
            event_timestamp_str=record_in.event_timestamp
        )
        return DataRecordRead.model_validate(data_record)

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Error appending record to datasource {datasource_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        ) 