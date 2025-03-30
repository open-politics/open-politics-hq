import logging
import os
from os import fstat, remove, makedirs, path
from typing import List, Annotated
import urllib3

from bson import ObjectId
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
from minio import Minio
from minio.error import S3Error

from app.core.config import settings
from app.api.deps import CurrentUser, SessionDep

# Configure logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

router = APIRouter(prefix="/files", tags=["files"])

# ------------------------------------------------------------------------------
# Custom Exception Classes
# ------------------------------------------------------------------------------
class FileStorageError(HTTPException):
    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)

class InvalidObjectId(ValueError):
    """Custom exception for invalid ObjectId."""
    pass

# ------------------------------------------------------------------------------
# Helper Functions
# ------------------------------------------------------------------------------
def file_size(file: UploadFile) -> int:
    """
    Returns the file size (in bytes) using its file descriptor.
    """
    try:
        return fstat(file.file.fileno()).st_size
    except Exception as e:
        logging.error(f"Error getting file size: {e}")
        file.file.seek(0, 2)  # Move to the end of file
        size = file.file.tell()
        file.file.seek(0)
        return size

def remove_file(filename: str, user_id: int | str) -> None:
    """
    Removes a file from the temporary folder.
    """
    file_path = f"{settings.TEMP_FOLDER}/{user_id}/{filename}"
    if path.exists(file_path):
        try:
            remove(file_path)
            logging.info(f"File {filename} removed from temporary folder.")
        except OSError as e:
            logging.error(f"Error removing file {filename}: {e}")

# ------------------------------------------------------------------------------
# Minimal PyObjectId implementation for schema compatibility
# ------------------------------------------------------------------------------
# class PyObjectId(str):
#     @classmethod
#     def __get_validators__(cls):
#         yield cls.validate

#     @classmethod
#     def validate(cls, v):
#         if not ObjectId.is_valid(v):
#             raise InvalidObjectId("Invalid ObjectId")
#         return str(v)

#     @classmethod
#     def json_schema(cls, *args, **kwargs):
#         return {"type": "string", "format": "ObjectId"}

# ------------------------------------------------------------------------------
# Minio Client Dependency
# ------------------------------------------------------------------------------
class MinioClient:
    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket_name: str):
        # For HTTPS endpoints, we don't need to append the port
        if os.environ.get("MINIO_SECURE", "False") == "True":
            endpoint = endpoint.replace(":443", "") 
            endpoint = endpoint.replace(":80", "")  

        logging.info(f"Connecting to MinIO/S3 at {endpoint}")

        self.client = Minio(
            endpoint=endpoint,
            access_key=access_key,
            secret_key=secret_key,
            secure=os.environ.get("MINIO_SECURE", "False") == "True"
        )
        self.bucket_name = bucket_name
        self._ensure_bucket_exists()

    def _ensure_bucket_exists(self):
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logging.info(f"Bucket '{self.bucket_name}' created.")
        except S3Error as e:
            logging.error(f"Error creating bucket: {e}")
            raise FileStorageError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to create bucket."
            ) 

    async def upload_file(self, file: UploadFile):
        try:
            file_size_bytes = file_size(file)
            await self._upload_file_async(file, file_size_bytes)
            logging.info(f"File '{file.filename}' uploaded successfully.")
        except S3Error as e:
            logging.error(f"Error uploading file: {e}")
            raise FileStorageError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to upload file."
            )
        except Exception as e:
            logging.error(f"Unexpected error during file upload: {e}")
            raise FileStorageError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Unexpected error during file upload."
            )

    async def _upload_file_async(self, file: UploadFile, file_size_bytes: int):
        await self.client.put_object(
            bucket_name=self.bucket_name,
            object_name=file.filename,
            data=file.file,
            length=file_size_bytes,
        )

    async def download_file(self, source: str, destination: str):
        try:
            self.client.fget_object(self.bucket_name, source, destination)
            logging.info(f"File '{source}' downloaded successfully to '{destination}'.")
        except S3Error as e:
            logging.error(f"Error downloading file: {e}")
            raise FileStorageError(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found or could not be downloaded."
            )

    async def delete_file(self, filename: str):
        try:
            self.client.remove_object(self.bucket_name, filename)
            logging.info(f"File '{filename}' deleted successfully.")
        except S3Error as e:
            logging.error(f"Error deleting file: {e}")
            raise FileStorageError(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="File not found or could not be deleted."
            )

    async def list_files(self) -> List[str]:
        try:
            objects = self.client.list_objects(self.bucket_name, recursive=True)
            file_list = [obj.object_name for obj in objects]
            logging.info(f"Listed files: {file_list}")
            return file_list
        except S3Error as e:
            logging.error(f"Error listing files: {e}")
            raise FileStorageError(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to list files."
            )

def get_minio_client():
    logging.info(f"Connecting to MinIO at {settings.MINIO_ENDPOINT}")
    return MinioClient(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ROOT_USER,
        secret_key=settings.MINIO_ROOT_PASSWORD,
        bucket_name=settings.MINIO_BUCKET_NAME,
    )

# ------------------------------------------------------------------------------
# Pydantic Schemas
# ------------------------------------------------------------------------------
class FileDownload(BaseModel):
    storage_id: str = Field(..., description="Storage ID")
    file_path: str = Field(..., description="File path in storage")

class FileUploadResponse(BaseModel):
    filename: str = Field(..., description="Uploaded filename")
    storage_id: str = Field(..., description="Storage ID")

    class Config:
        json_encoders = {ObjectId: str}

# ------------------------------------------------------------------------------
# Endpoints
# ------------------------------------------------------------------------------
@router.post(
    "/",
    response_model=FileUploadResponse,
    status_code=status.HTTP_201_CREATED,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def file_upload(
    session: SessionDep,
    current_user: CurrentUser,
    file: UploadFile = File(..., description="File to upload"),
    minio_client: MinioClient = Depends(get_minio_client),
):
    """
    Upload a file to Minio.
    Expects form-data with a file.
    """
    try:
        await minio_client.upload_file(file)
        # Assuming the filename can be used as a storage_id for simplicity
        return FileUploadResponse(filename=file.filename, storage_id=file.filename)
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file upload: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File upload failed due to an unexpected error."
        )

@router.get(
    "/",
    response_class=FileResponse,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_404_NOT_FOUND: {"description": "Not Found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def file_download(
    background_tasks: BackgroundTasks,
    current_user: CurrentUser,
    file: FileDownload = Depends(),
    minio_client: MinioClient = Depends(get_minio_client),
):
    """
    Download a file from Minio.
    Expects query parameters for storage_id and file_path.
    The file is saved temporarily and a background task deletes the temp file.
    """
    destination_folder = f"{settings.TEMP_FOLDER}/{current_user.id}"
    if not path.exists(destination_folder):
        makedirs(destination_folder, exist_ok=True)

    filename = file.file_path.split("/")[-1]
    destination_file = f"{destination_folder}/{filename}"

    try:
        await minio_client.download_file(source=file.file_path, destination=destination_file)
        background_tasks.add_task(remove_file, filename, current_user.id)
        return FileResponse(destination_file)
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file download: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File download failed due to an unexpected error."
        )

@router.get(
    "/list",
    response_model=List[str],
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def list_files(
    current_user: CurrentUser,
    minio_client: MinioClient = Depends(get_minio_client),
):
    """
    List all files in the storage bucket.
    """
    try:
        return await minio_client.list_files()
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file listing: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list files due to an unexpected error."
        )

@router.delete(
    "/{filename}",
    status_code=status.HTTP_200_OK,
    responses={
        status.HTTP_401_UNAUTHORIZED: {"description": "Unauthorized"},
        status.HTTP_404_NOT_FOUND: {"description": "Not Found"},
        status.HTTP_500_INTERNAL_SERVER_ERROR: {"description": "Internal Server Error"},
    },
)
async def delete_file(
    filename: str,
    current_user: CurrentUser,
    minio_client: MinioClient = Depends(get_minio_client),
):
    """
    Delete a file from the storage bucket.
    """
    try:
        await minio_client.delete_file(filename)
        return {"message": f"File '{filename}' deleted successfully."}
    except FileStorageError as e:
        raise e
    except Exception as e:
        logging.error(f"Unexpected error during file deletion: {e}")
        raise FileStorageError(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="File deletion failed due to an unexpected error."
        )