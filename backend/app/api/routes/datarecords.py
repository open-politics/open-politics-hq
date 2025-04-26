"""
Routes for data record operations.
"""
import logging
from typing import Any, List, Optional, Literal
from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from app.models import DataRecordRead
from app.api.deps import CurrentUser, SessionDep, IngestionServiceDep

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