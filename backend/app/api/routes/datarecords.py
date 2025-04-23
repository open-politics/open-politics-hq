import logging
from typing import Any, List, Optional, Literal, Dict
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select
from datetime import datetime, timezone
import dateutil.parser

from app.models import DataRecord, DataRecordRead, Workspace, DataSource, DataSourceType, DataRecordCreate
from app.api.deps import SessionDep, CurrentUser
from app.api.routes.utils import scrape_article
from pydantic import BaseModel, Field

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# --- NEW: Input Model for Appending Record ---
class AppendRecordInput(BaseModel):
    content: str
    content_type: Literal['text', 'url']
    event_timestamp: Optional[str] = Field(None, description="Optional ISO 8601 timestamp for the event")

# --- End Input Model ---

router = APIRouter(
    prefix="/workspaces/{workspace_id}/datarecords",
    tags=["DataRecords"]
)

@router.get("/{datarecord_id}", response_model=DataRecordRead)
def get_data_record(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    datarecord_id: int
) -> Any:
    """
    Retrieve a specific DataRecord by its ID.
    Verifies workspace ownership by checking the associated DataSource.
    """
    logger.info(f"Fetching DataRecord {datarecord_id} for workspace {workspace_id}")

    # Query DataRecord and join DataSource and Workspace to verify ownership
    statement = select(DataRecord).join(DataSource).where(
        DataRecord.id == datarecord_id,
        DataSource.workspace_id == workspace_id
    ).join(Workspace).where(
        Workspace.user_id_ownership == current_user.id
    )

    data_record = session.exec(statement).first()

    if not data_record:
        logger.warning(f"DataRecord {datarecord_id} not found or not accessible in workspace {workspace_id} for user {current_user.id}")
        raise HTTPException(status_code=404, detail="DataRecord not found")

    logger.info(f"Successfully fetched DataRecord {datarecord_id}")
    return DataRecordRead.model_validate(data_record)

# New endpoint to list DataRecords for a specific DataSource
@router.get("/by_datasource/{datasource_id}", response_model=List[DataRecordRead])
def list_data_records_for_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int, # workspace_id is still in the path prefix
    datasource_id: int,
    skip: int = 0,
    limit: int = 1000 # Allow fetching more records if needed
) -> Any:
    """
    Retrieve DataRecords associated with a specific DataSource.
    Verifies workspace ownership by checking the DataSource.
    """
    logger.info(f"Fetching DataRecords for DataSource {datasource_id} in workspace {workspace_id}")

    # 1. Verify access to the DataSource and workspace
    datasource = session.get(DataSource, datasource_id)
    if (
        not datasource
        or datasource.workspace_id != workspace_id
        # Check ownership via workspace, assuming DataSource doesn't directly store user_id_ownership
        # If DataSource *does* store user_id, add that check too.
        # Let's assume workspace check is sufficient via the join in the query below.
    ):
        raise HTTPException(status_code=404, detail="DataSource not found or not accessible")

    # Verify workspace ownership more explicitly if needed, though the query implicitly does it
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
         raise HTTPException(status_code=403, detail="User does not have ownership of this workspace")

    # 2. Query DataRecords for the given datasource_id, ensuring workspace ownership
    statement = (
        select(DataRecord)
        .join(DataSource)
        .where(DataRecord.datasource_id == datasource_id)
        .where(DataSource.workspace_id == workspace_id)
        .join(Workspace) # Join workspace to verify ownership
        .where(Workspace.user_id_ownership == current_user.id)
        .offset(skip)
        .limit(limit)
    )

    data_records = session.exec(statement).all()

    logger.info(f"Found {len(data_records)} DataRecords for DataSource {datasource_id}")
    # Validate each record before returning - model_validate automatically handles this with List[DataRecordRead]
    return data_records

# --- NEW: Endpoint to Append a Record to a DataSource ---
@router.post("/by_datasource/{datasource_id}/records", response_model=DataRecordRead)
async def append_record_to_datasource(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    datasource_id: int,
    record_in: AppendRecordInput
) -> Any:
    """
    Append a single new record (text or URL) to an existing DataSource.
    Only supports TEXT_BLOCK and URL_LIST types.
    If content_type is 'url', it will be scraped.
    An optional event_timestamp (ISO 8601) can be provided.
    """
    logger.info(f"Attempting to append record to DataSource {datasource_id} in workspace {workspace_id}")

    # 1. Verify access to the DataSource and workspace
    datasource = session.get(DataSource, datasource_id)
    if not datasource or datasource.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="DataSource not found in this workspace")

    # Verify workspace ownership explicitly
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=403, detail="User does not have ownership of this workspace")

    # 2. Check if DataSource type is supported
    if datasource.type not in [DataSourceType.TEXT_BLOCK, DataSourceType.URL_LIST]:
        raise HTTPException(
            status_code=400,
            detail=f"Appending records is only supported for {DataSourceType.TEXT_BLOCK.value} and {DataSourceType.URL_LIST.value} types. Found {datasource.type.value}."
        )

    # 3. Process content based on type
    final_text_content: str | None = None
    scraped_publication_date: Optional[str] = None
    source_metadata_extra: Dict[str, Any] = {
        'append_method': 'manual_api',
        'original_input': record_in.content,
        'append_time': datetime.now(timezone.utc).isoformat()
    }

    if record_in.content_type == 'url':
        if datasource.type != DataSourceType.URL_LIST:
            raise HTTPException(status_code=400, detail=f"Cannot append URL content to a {datasource.type.value} DataSource.")
        try:
            logger.info(f"Scraping URL for appending: {record_in.content}")
            # Use await here as scrape_article is an async function
            scraped_data = await scrape_article(record_in.content)
            final_text_content = scraped_data.get('text_content')
            scraped_publication_date = scraped_data.get('publication_date') # From updated util
            source_metadata_extra['scraped_title'] = scraped_data.get('title')
            source_metadata_extra['original_scrape_data'] = scraped_data.get('original_data')

            if not final_text_content:
                logger.warning(f"Scraping URL {record_in.content} yielded no text content.")
                # Decide whether to raise an error or create a record with empty text
                # Let's raise for now, as an empty record is usually not useful
                raise HTTPException(status_code=400, detail="Scraping yielded no text content.")

        except HTTPException as http_exc:
            # Re-raise HTTP exceptions from scrape_article
            raise http_exc
        except Exception as e:
            logger.error(f"Failed to scrape URL {record_in.content}: {e}", exc_info=True)
            raise HTTPException(status_code=500, detail=f"Failed to scrape URL: {e}")

    elif record_in.content_type == 'text':
        if datasource.type != DataSourceType.TEXT_BLOCK:
             # Allow adding text to URL_LIST sources too?
             # Let's allow it for flexibility, e.g. adding notes or summaries related to the URLs.
             # if datasource.type != DataSourceType.TEXT_BLOCK:
             # raise HTTPException(status_code=400, detail=f"Cannot append text content to a {datasource.type.value} DataSource.")
             pass # Allow appending text to URL_LIST as well
        final_text_content = record_in.content

    if not final_text_content:
        # Should not happen if URL scraping error is raised, but as a safeguard
        raise HTTPException(status_code=400, detail="No content available to create record.")

    # 4. Determine Event Timestamp
    final_event_timestamp: Optional[datetime] = None
    if record_in.event_timestamp:
        try:
            parsed_dt = dateutil.parser.isoparse(record_in.event_timestamp) # Use isoparse for stricter ISO 8601
            if parsed_dt.tzinfo is None or parsed_dt.tzinfo.utcoffset(parsed_dt) is None:
                final_event_timestamp = parsed_dt.replace(tzinfo=timezone.utc)
            else:
                final_event_timestamp = parsed_dt
            logger.info(f"Using provided event timestamp: {final_event_timestamp}")
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid format for event_timestamp. Use ISO 8601.")
    elif scraped_publication_date:
        try:
            parsed_dt = dateutil.parser.parse(scraped_publication_date)
            if parsed_dt.tzinfo is None or parsed_dt.tzinfo.utcoffset(parsed_dt) is None:
                final_event_timestamp = parsed_dt.replace(tzinfo=timezone.utc)
            else:
                final_event_timestamp = parsed_dt
            logger.info(f"Using scraped event timestamp: {final_event_timestamp}")
        except (ValueError, OverflowError, TypeError):
            logger.warning(f"Could not parse scraped publication date '{scraped_publication_date}', leaving event_timestamp null.")
            final_event_timestamp = None # Explicitly set to None

    # 5. Create DataRecord
    record_to_create = DataRecordCreate(
        datasource_id=datasource_id,
        text_content=final_text_content,
        source_metadata=source_metadata_extra,
        event_timestamp=final_event_timestamp
    )

    db_record = DataRecord.model_validate(record_to_create)
    session.add(db_record)
    session.commit()
    session.refresh(db_record)

    logger.info(f"Successfully appended DataRecord {db_record.id} to DataSource {datasource_id}")
    return DataRecordRead.model_validate(db_record)
# --- End Append Endpoint --- 