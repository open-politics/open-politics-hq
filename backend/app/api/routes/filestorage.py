import logging
import os
from os import fstat, remove, makedirs, path
from typing import List, Annotated, Protocol, Any, Optional, Dict
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
    Query,
)
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from app.core.config import settings
from app.api.deps import CurrentUser, SessionDep, StorageProviderDep
from app.api.providers.factory import create_storage_provider

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

router = APIRouter(tags=["files"])

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
    "/upload",
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
    "/download",
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
    # Basic authorization check - users can only download their own files
    if not file.file_path.startswith(f"user_{current_user.id}/"):
        if not current_user.is_superuser:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to download this file")
    
    destination_folder = f"{settings.TEMP_FOLDER}/{current_user.id}"
    if not path.exists(destination_folder):
        makedirs(destination_folder, exist_ok=True)

    # Extract filename from object name/path for local saving
    local_filename = file.file_path.split("/")[-1]
    destination_file = f"{destination_folder}/{local_filename}"

    try:
        await storage_provider.download_file(source_object_name=file.file_path, destination_local_path=destination_file)
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

@router.get("/list")
async def list_files(
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    prefix: Optional[str] = None,
    max_keys: int = Query(default=100, le=1000)
):
    """
    List files in the storage provider with user authorization.
    Users can only list files in their own directory.
    """
    try:
        logging.info(f"User {current_user.id} listing files with prefix: {prefix}")
        
        # Enforce user directory isolation
        user_prefix = f"user_{current_user.id}/"
        
        if prefix:
            # Ensure user can only access their own files
            if not prefix.startswith(user_prefix):
                # If user provides a prefix, prepend their user prefix
                effective_prefix = user_prefix + prefix.lstrip("/")
            else:
                effective_prefix = prefix
        else:
            effective_prefix = user_prefix
        
        # Validate the effective prefix is within user's directory
        if not effective_prefix.startswith(user_prefix):
            raise HTTPException(
                status_code=403, 
                detail="Access denied: You can only access files in your own directory"
            )
        
        logging.info(f"Listing files with effective prefix: {effective_prefix}")
        
        files = await storage_provider.list_files(
            prefix=effective_prefix,
            max_keys=max_keys
        )
        
        # Remove user prefix from displayed paths for cleaner UX
        for file_info in files:
            if file_info.key.startswith(user_prefix):
                file_info.key = file_info.key[len(user_prefix):]
        
        logging.info(f"Found {len(files)} files for user {current_user.id}")
        return files
        
    except HTTPException:
        raise
    except Exception as e:
        logging.exception(f"Error listing files for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to list files")

@router.delete("/delete")
async def delete_file(
    object_name: str,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
):
    """
    Delete a file with proper authorization checks.
    Users can only delete files in their own directory.
    """
    try:
        logging.info(f"User {current_user.id} attempting to delete file: {object_name}")
        
        # Normalize the object name
        normalized_object_name = object_name.lstrip("/")
        user_prefix = f"user_{current_user.id}/"
        
        # If the object name doesn't start with user prefix, prepend it
        if not normalized_object_name.startswith(user_prefix):
            effective_object_name = user_prefix + normalized_object_name
        else:
            effective_object_name = normalized_object_name
        
        # Security check: Ensure user can only delete their own files
        if not effective_object_name.startswith(user_prefix):
            logging.warning(f"User {current_user.id} attempted to delete unauthorized file: {object_name}")
            raise HTTPException(
                status_code=403,
                detail="Access denied: You can only delete files in your own directory"
            )
        
        # Additional security: Prevent directory traversal
        if ".." in effective_object_name or "//" in effective_object_name:
            logging.warning(f"User {current_user.id} attempted directory traversal: {object_name}")
            raise HTTPException(
                status_code=400,
                detail="Invalid file path: directory traversal not allowed"
            )
        
        logging.info(f"Deleting file: {effective_object_name}")
        await storage_provider.delete_file(effective_object_name)
        
        logging.info(f"Successfully deleted file {effective_object_name} for user {current_user.id}")
        return {"message": f"File '{object_name}' deleted successfully"}
        
    except HTTPException:
        raise
    except FileNotFoundError:
        logging.warning(f"File not found for deletion: {object_name} (user: {current_user.id})")
        raise HTTPException(status_code=404, detail="File not found")
    except Exception as e:
        logging.exception(f"Error deleting file {object_name} for user {current_user.id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete file")

def _validate_user_file_access(current_user: CurrentUser, file_path: str) -> str:
    """
    Validate and normalize file path for user access control.
    Returns the effective file path with user prefix.
    """
    user_prefix = f"user_{current_user.id}/"
    normalized_path = file_path.lstrip("/")
    
    # If path doesn't start with user prefix, prepend it
    if not normalized_path.startswith(user_prefix):
        effective_path = user_prefix + normalized_path
    else:
        effective_path = normalized_path
    
    # Security validations
    if not effective_path.startswith(user_prefix):
        raise HTTPException(
            status_code=403,
            detail="Access denied: You can only access files in your own directory"
        )
    
    if ".." in effective_path or "//" in effective_path:
        raise HTTPException(
            status_code=400,
            detail="Invalid file path: directory traversal not allowed"
        )
    
    return effective_path

@router.get(
    "/stream/{file_path:path}",
    response_class=StreamingResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_404_NOT_FOUND: {"description": "Not Found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def stream_file(
    file_path: str,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
):
    """
    Stream a file directly from storage without creating temporary files.
    This is more efficient for media files (images, videos, PDFs) that need to be displayed in browsers.
    """
    # Basic authorization check - users can only access their own files
    if not file_path.startswith(f"user_{current_user.id}/"):
        if not current_user.is_superuser:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permission denied to access this file")
    
    try:
        # Get file stream from storage provider
        file_stream = await storage_provider.get_file(file_path)
        
        # Determine content type based on file extension
        import mimetypes
        content_type, _ = mimetypes.guess_type(file_path)
        if not content_type:
            content_type = "application/octet-stream"
        
        # Convert the stream to an async generator for FastAPI
        async def generate():
            try:
                chunk_size = 8192  # 8KB chunks
                while True:
                    chunk = file_stream.read(chunk_size)
                    if not chunk:
                        break
                    yield chunk
            except Exception as e:
                logging.error(f"Error reading file stream: {e}")
                raise
            finally:
                # Close the stream when done
                if hasattr(file_stream, 'close'):
                    file_stream.close()
        
        # Return streaming response
        return StreamingResponse(
            generate(),
            media_type=content_type,
            headers={
                "Content-Disposition": f"inline; filename={file_path.split('/')[-1]}",
                "Cache-Control": "public, max-age=3600"  # Cache for 1 hour
            }
        )
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file streaming: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File streaming failed due to an unexpected error."
        )