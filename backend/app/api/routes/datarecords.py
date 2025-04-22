import logging
from typing import Any, List
from fastapi import APIRouter, Depends, HTTPException
from sqlmodel import Session, select

from app.models import DataRecord, DataRecordRead, Workspace, DataSource
from app.api.deps import SessionDep, CurrentUser

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

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