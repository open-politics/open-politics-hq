# backend/app/api/routes/datasets.py
from fastapi import APIRouter, Depends, HTTPException, Query, status, UploadFile, File
from typing import Any, Optional
# Add Response for file download
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
import json
import logging
import tempfile
import os

from app.api.deps import SessionDep, CurrentUser, DatasetServiceDep, ShareableServiceDep, StorageProviderDep
from app.models import (
    DatasetCreate, DatasetRead, DatasetUpdate, DatasetsOut, Message,
    # Import Dataset model for service return type check
    Dataset,
    ResourceType
)
from app.api.services.dataset import DatasetService
from app.api.services.shareable import ShareableService
from app.api.services.package import DataPackage

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/datasets",
    tags=["datasets"],
)

@router.post("", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=DatasetRead, status_code=status.HTTP_201_CREATED)
def create_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    dataset_in: DatasetCreate,
    service: DatasetServiceDep
) -> DatasetRead:
    """
    Create a new dataset within a specific workspace.
    """
    try:
        dataset = service.create_dataset(
            user_id=current_user.id,
            workspace_id=workspace_id,
            dataset_in=dataset_in
        )
        return dataset
    except ValueError as e:
        # Service raises ValueError for validation errors (e.g., missing IDs)
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error creating dataset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("", response_model=DatasetsOut)
@router.get("/", response_model=DatasetsOut)
def list_datasets(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = Query(default=100, le=200),
    service: DatasetServiceDep
) -> DatasetsOut:
    """
    Retrieve datasets within a specific workspace.
    """
    try:
        datasets, count = service.list_datasets(
            user_id=current_user.id,
            workspace_id=workspace_id,
            skip=skip,
            limit=limit
        )
        return DatasetsOut(data=datasets, count=count)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error listing datasets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.get("/{dataset_id}", response_model=DatasetRead)
def get_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    dataset_id: int,
    service: DatasetServiceDep
) -> DatasetRead:
    """
    Get a specific dataset by ID.
    """
    try:
        dataset = service.get_dataset(
            user_id=current_user.id,
            workspace_id=workspace_id,
            dataset_id=dataset_id
        )
        if not dataset:
            # Service returns None if not found/accessible
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or not accessible")
        return dataset
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error getting dataset {dataset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.patch("/{dataset_id}", response_model=DatasetRead)
def update_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    dataset_id: int,
    dataset_in: DatasetUpdate,
    service: DatasetServiceDep
) -> DatasetRead:
    """
    Update a dataset.
    """
    try:
        updated_dataset = service.update_dataset(
            user_id=current_user.id,
            workspace_id=workspace_id,
            dataset_id=dataset_id,
            dataset_in=dataset_in
        )
        if not updated_dataset:
            # Service returns None if not found/accessible
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or not accessible")
        return updated_dataset
    except ValueError as e:
        # Service raises ValueError for validation errors
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error updating dataset {dataset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

@router.delete("/{dataset_id}", response_model=Message)
def delete_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    dataset_id: int,
    service: DatasetServiceDep
) -> Message:
    """
    Delete a dataset.
    """
    try:
        deleted_dataset = service.delete_dataset(
            user_id=current_user.id,
            workspace_id=workspace_id,
            dataset_id=dataset_id
        )
        if not deleted_dataset:
            # Service returns None if not found/accessible
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset not found or not accessible")
        return Message(message=f"Dataset '{deleted_dataset.name}' deleted successfully")
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error deleting dataset {dataset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )


# --- NEW EXPORT ENDPOINT ---
@router.post("/{dataset_id}/export", response_class=FileResponse)
async def export_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    dataset_id: int,
    include_content: bool = Query(False, description="Include full text content of data records"),
    include_results: bool = Query(False, description="Include associated classification results"),
    service: DatasetServiceDep,
) -> Any:
    """
    Export a specific dataset as a self-contained package (ZIP).
    """
    try:
        # Export the dataset to a package
        package = await service.export_dataset_package(
            user_id=current_user.id,
            workspace_id=workspace_id,
            dataset_id=dataset_id,
            include_record_content=include_content,
            include_results=include_results
        )

        # Create a temporary file for the ZIP
        with tempfile.NamedTemporaryFile(suffix='.zip', delete=False) as temp_file:
            temp_path = temp_file.name

        try:
            # Write the package to the ZIP file
            package.to_zip(temp_path)

            # Return the file for download
            filename = f"dataset_export_{dataset_id}.zip"
            return FileResponse(
                path=temp_path,
                filename=filename,
                media_type="application/zip",
                background=lambda: os.unlink(temp_path)
            )

        except Exception as e:
            # Clean up temp file on error
            if os.path.exists(temp_path):
                os.unlink(temp_path)
            raise e

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Error exporting dataset {dataset_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

# --- NEW IMPORT ENDPOINT (Phase B) ---
@router.post("/import", response_model=DatasetRead)
async def import_dataset(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    file: UploadFile = File(..., description="Dataset Package file (.zip)"),
    conflict_strategy: str = Query('skip', description="How to handle conflicts"),
    service: DatasetServiceDep,
) -> DatasetRead:
    """
    Import a dataset from an exported Dataset Package file.
    """
    if not file.filename or not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only .zip allowed.")

    try:
        # Create package from upload
        package = await DataPackage.from_upload(file)

        # Import the package
        imported_dataset = await service.import_dataset_package(
            target_user_id=current_user.id,
            target_workspace_id=workspace_id,
            package=package,
            conflict_resolution_strategy=conflict_strategy
        )
        return imported_dataset

    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except NotImplementedError as e:
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(e))
    except Exception as e:
        logger.exception(f"Error importing dataset: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Internal server error"
        )

# --- NEW IMPORT FROM TOKEN ENDPOINT (Phase E) ---
@router.post("/import_from_token", response_model=DatasetRead)
async def import_dataset_from_token(
    *,
    current_user: CurrentUser,
    workspace_id: int,
    share_token: str = Query(..., description="Share token for the dataset"),
    include_content: bool = Query(False, description="Include full text content if available"),
    include_results: bool = Query(False, description="Include classification results if available"),
    conflict_strategy: str = Query('skip', description="How to handle conflicts"),
    service: DatasetServiceDep,
    shareable_service: ShareableServiceDep
) -> DatasetRead:
    """
    Import a dataset into the target workspace using a share token.
    This internally performs an export from the source and then an import.
    """
    logger.info(f"Attempting import from token {share_token[:5]}... into workspace {workspace_id}")

    # 1. Validate Token & Get Metadata
    try:
        shared_info = shareable_service.access_shared_resource(
            token=share_token,
            requesting_user_id=current_user.id
        )
        if shared_info.get("resource_type") != ResourceType.DATASET.value:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Token does not correspond to a dataset")

        metadata = shared_info.get("metadata")
        if not metadata:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to retrieve dataset metadata from token")

        original_dataset_id = metadata.get("original_dataset_id")
        original_workspace_id = metadata.get("original_workspace_id")

        if not original_dataset_id or not original_workspace_id:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Incomplete dataset metadata from token")

    except HTTPException as he:
        logger.warning(f"Token validation/access failed for token {share_token[:5]}...: {he.detail}")
        raise he
    except Exception as e:
        logger.error(f"Unexpected error during token validation/access for {share_token[:5]}...: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Error validating share token")

    logger.info(f"Token valid. Original dataset ID: {original_dataset_id}, Original workspace: {original_workspace_id}")

    # 2. Internally Export the Dataset Package
    try:
        package = await service.export_dataset_package(
            user_id=current_user.id,
            workspace_id=original_workspace_id,
            dataset_id=original_dataset_id,
            include_record_content=include_content,
            include_results=include_results
        )
        logger.info(f"Internal export successful for dataset {original_dataset_id}")
    except HTTPException as he:
        logger.error(f"Internal export failed for dataset {original_dataset_id}: {he.detail}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to retrieve source dataset data: {he.detail}")
    except Exception as e:
        logger.error(f"Unexpected error during internal export for dataset {original_dataset_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to retrieve source dataset data")

    # 3. Import the Dataset Package into the Target Workspace
    try:
        imported_dataset = await service.import_dataset_package(
            target_user_id=current_user.id,
            target_workspace_id=workspace_id,
            package=package,
            conflict_resolution_strategy=conflict_strategy
        )
        logger.info(f"Import successful. New dataset ID: {imported_dataset.id} in workspace {workspace_id}")
        return imported_dataset
    except ValueError as ve:
        logger.warning(f"Import validation failed into workspace {workspace_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except NotImplementedError as nie:
        logger.warning(f"Import conflict strategy not implemented: {nie}")
        raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=str(nie))
    except HTTPException as he:
        logger.warning(f"HTTP Exception during import into workspace {workspace_id}: {he.detail}")
        raise he
    except Exception as e:
        logger.exception(f"Unexpected error during import into workspace {workspace_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Dataset import from token failed: {str(e)}")

# Placeholder for Import Endpoint (Phase B+)
# @router.post("/import", response_model=DatasetRead)
# def import_dataset(...):
#     ... 