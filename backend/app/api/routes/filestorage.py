import logging
import os
from os import fstat, remove, makedirs, path
from typing import List, Annotated, Protocol, Any
import urllib3
import uuid
import asyncio

from fastapi import (
    APIRouter,
    Depends,
    UploadFile,
    HTTPException,
    status,
    BackgroundTasks,
    Form,
    File,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.api.deps import CurrentUser, SessionDep, StorageProviderDep
from app.api.services.providers.base import StorageProvider

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

router = APIRouter(prefix="/files", tags=["files"])

# ------------------------------------------------------------------------------
# Custom Exception Classes
# ------------------------------------------------------------------------------
class FileStorageError(HTTPException):
    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)

# ------------------------------------------------------------------------------
# Helper Functions (Keep remove_file for background task)
# ------------------------------------------------------------------------------
# file_size moved into provider

def remove_file(filename: str, user_id: int | str) -> None:
    """
    Removes a file from the temporary folder.
    """
    file_path = f"{settings.TEMP_FOLDER}/{user_id}/{filename}"
    if path.exists(file_path):
        try:
            remove(file_path)
            logging.info(f"Temp file {filename} removed.")
        except OSError as e:
            logging.error(f"Error removing temp file {filename}: {e}")

# ------------------------------------------------------------------------------
# Pydantic Schemas
# ------------------------------------------------------------------------------
class FileDownload(BaseModel):
    # storage_id: str = Field(..., description="Storage ID") # No longer needed?
    file_path: str = Field(..., description="File path in storage (object name)")

class FileUploadResponse(BaseModel):
    filename: str = Field(..., description="Original uploaded filename")
    object_name: str = Field(..., description="Object name in storage")

    # class Config:
    #     json_encoders = {ObjectId: str} # Keep if ObjectId is used elsewhere

# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------
@router.post(
    "/",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    responses={ # Add responses dict
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def file_upload(
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    file: UploadFile = File(..., description="File to upload"),
):
    """
    Upload a file to the configured storage provider.
    Expects form-data with a file.
    Generates a unique object name based on user ID and filename.
    """
    try:
        # Generate a unique object name (e.g., user_id/uuid_filename)
        # This prevents collisions and organizes files
        _, file_extension = os.path.splitext(file.filename)
        object_name = f"user_{current_user.id}/{uuid.uuid4()}{file_extension}"

        await storage_provider.upload_file(file, object_name)
        return FileUploadResponse(filename=file.filename, object_name=object_name)
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file upload route: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File upload failed due to an unexpected error."
        )

@router.get(
    "/",
    response_class=FileResponse,
    responses={ # Add responses dict
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_404_NOT_FOUND: {"description": "Not Found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def file_download(
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    file: FileDownload = Depends(), # Use Pydantic model for query params
):
    """
    Download a file from the storage provider.
    Expects query parameter 'file_path' (the object name).
    The file is saved temporarily and a background task deletes the temp file.
    """
    destination_folder = f"{settings.TEMP_FOLDER}/{current_user.id}"
    if not path.exists(destination_folder):
        makedirs(destination_folder, exist_ok=True)

    # Extract filename from object name/path for local saving
    local_filename = file.file_path.split("/")[-1]
    destination_file = f"{destination_folder}/{local_filename}"

    try:
        await storage_provider.download_file(source=file.file_path, destination=destination_file)
        # Ensure the background task uses the locally saved filename
        background_tasks.add_task(remove_file, local_filename, current_user.id)
        # Return the temporary file
        return FileResponse(path=destination_file, filename=local_filename)
    except FileStorageError as e:
        # Clean up temp file if download fails
        if path.exists(destination_file):
            remove_file(local_filename, current_user.id)
        raise e
    except Exception as e:
        if path.exists(destination_file):
            remove_file(local_filename, current_user.id)
        logging.error(f"Unexpected error during file download route: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File download failed due to an unexpected error."
        )

@router.get(
    "/list",
    response_model=List[str],
    responses={ # Add responses dict
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def list_files(
    current_user: CurrentUser,
    # Correct dependency definition
    storage_provider: StorageProviderDep,
):
    """
    List all files in the storage bucket.
    Note: This might list files for all users depending on bucket setup.
    Consider adding user-specific prefix filtering if needed.
    """
    try:
        # TODO: Add prefix filtering? e.g., prefix=f"user_{current_user.id}/"
        return await storage_provider.list_files()
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file listing route: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list files due to an unexpected error."
        )

@router.delete(
    "/{object_name:path}", # Use path parameter to capture full object name
    status_code=status.HTTP_200_OK, # Return 200 on success
    responses={ # Add responses dict
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_404_NOT_FOUND: {"description": "Not Found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def delete_file(
    object_name: str,
    current_user: CurrentUser,
    # Correct dependency definition
    storage_provider: StorageProviderDep,
):
    """
    Delete a file (object) from the storage provider.
    Requires the full object name/path.
    TODO: Add authorization check - does this user own this file?
          (e.g., check if object_name starts with f"user_{current_user.id}/")
    """
    # Basic authorization check (example)
    if not object_name.startswith(f"user_{current_user.id}/"):
        # Allow superusers to delete anything? Or enforce strict ownership?
        if not current_user.is_superuser:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to delete this file")

    try:
        await storage_provider.delete_file(object_name)
        return {"message": f"File '{object_name}' deleted successfully."}
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file deletion route: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File deletion failed due to an unexpected error."
        )