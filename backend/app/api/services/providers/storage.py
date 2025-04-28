"""
Storage provider implementations.
"""
import logging
import io
import os
import asyncio
from typing import List, Optional, BinaryIO, Protocol, Any
from os import fstat

from fastapi import HTTPException, UploadFile, status
from minio import Minio
from minio.error import S3Error
from minio.commonconfig import CopySource

# Import base interface and settings
from .base import StorageProvider
from app.core.config import settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

# Custom Exception (can be defined here or centrally)
class FileStorageError(HTTPException):
    def __init__(self, status_code: int, detail: str):
        super().__init__(status_code=status_code, detail=detail)

class MinioStorageProvider(StorageProvider):
    """Implementation of StorageProvider using MinIO/S3."""
    def __init__(self, endpoint: str, access_key: str, secret_key: str, bucket_name: str = os.environ.get("MINIO_BUCKET_NAME", "default")):
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
        """Creates the bucket if it doesn't exist."""
        if not self.client:
            logging.error("MinIO client not initialized, cannot ensure bucket exists.")
            # Optionally raise an exception
            return
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logging.info(f"Bucket '{self.bucket_name}' created.")
        except S3Error as e:
            logging.error(f"MinIO error ensuring bucket exists: {e}")
            # Optionally raise
        except Exception as e:
            logging.error(f"Unexpected error ensuring bucket exists: {e}")
            # Optionally raise

    def _get_file_size(self, file: UploadFile) -> int:
        """Helper to get file size safely."""
        try:
            current_pos = file.file.tell()
            file.file.seek(0, 2)
            size = file.file.tell()
            file.file.seek(current_pos)
            if size >= 0: return size
        except Exception as e:
            logging.warning(f"Could not get file size using seek/tell: {e}")
        try:
            return fstat(file.file.fileno()).st_size
        except Exception as e:
            logging.error(f"Error getting file size via fileno(): {e}")
            raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not determine file size")

    # --- Implementation of StorageProvider Interface --- 

    async def upload_file(self, file: UploadFile, object_name: str):
        try:
            file_size_bytes = self._get_file_size(file)
            def _upload_sync():
                self.client.put_object(
                    bucket_name=self.bucket_name,
                    object_name=object_name,
                    data=file.file,
                    length=file_size_bytes,
                    content_type=file.content_type
                )
            await asyncio.to_thread(_upload_sync)
            logging.info(f"File '{file.filename}' uploaded as '{object_name}' successfully.")
        except S3Error as e:
            logging.error(f"Error uploading file: {e}")
            raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to upload file.")
        except Exception as e:
            logging.error(f"Unexpected error during file upload: {e}")
            raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Unexpected error during file upload.")

    async def get_file(self, object_name: str) -> Any:
        # Minio's get_object returns a stream (urllib3.response.HTTPResponse)
        # This might involve network I/O, so wrap it.
        try:
            def _get_sync():
                return self.client.get_object(self.bucket_name, object_name)
            response = await asyncio.to_thread(_get_sync)
            # Caller is responsible for closing the response stream
            return response
        except S3Error as e:
            logging.error(f"Error getting file object: {e}")
            if e.code == 'NoSuchKey':
                raise FileNotFoundError(f"File object '{object_name}' not found in bucket '{self.bucket_name}'.")
            else:
                raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Could not get file object: {e}")

    async def download_file(self, source_object_name: str, destination_local_path: str):
        try:
            def _download_sync():
                self.client.fget_object(self.bucket_name, source_object_name, destination_local_path)
            await asyncio.to_thread(_download_sync)
            logging.info(f"File '{source_object_name}' downloaded successfully to '{destination_local_path}'.")
        except S3Error as e:
            logging.error(f"Error downloading file: {e}")
            if e.code == 'NoSuchKey':
                raise FileStorageError(status_code=status.HTTP_404_NOT_FOUND, detail="File not found.")
            else:
                 raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not download file.")

    async def delete_file(self, object_name: str):
        try:
            def _delete_sync():
                self.client.remove_object(self.bucket_name, object_name)
            await asyncio.to_thread(_delete_sync)
            logging.info(f"File '{object_name}' deleted successfully.")
        except S3Error as e:
            logging.error(f"Error deleting file: {e}")
            # Check if error indicates not found vs other issue - Minio might not distinguish easily
            # Assume 500 unless we know it's 404
            raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Could not delete file.")

    def delete_file_sync(self, object_name: str):
        # Synchronous version for cleanup tasks
        try:
            self.client.remove_object(self.bucket_name, object_name)
            logging.info(f"Sync delete: File '{object_name}' deleted successfully.")
        except S3Error as e:
            # Log error but don't raise HTTPException from sync context ideally
            logging.error(f"Sync delete error: Error deleting file '{object_name}': {e}")
            if e.code == 'NoSuchKey':
                 logging.warning(f"Sync delete: File '{object_name}' not found.")
            # Re-raise S3Error for caller to handle if needed
            raise
        except Exception as e:
            logging.error(f"Sync delete error: Unexpected error deleting '{object_name}': {e}")
            raise

    async def list_files(self, prefix: Optional[str] = None) -> List[str]:
        try:
            def _list_sync() -> List[str]: 
                objects = self.client.list_objects(self.bucket_name, prefix=prefix, recursive=True)
                return [obj.object_name for obj in objects]
            file_list = await asyncio.to_thread(_list_sync)
            logging.info(f"Listed files: {len(file_list)} (prefix: {prefix})")
            return file_list
        except S3Error as e:
            logging.error(f"Error listing files: {e}")
            raise FileStorageError(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list files.")
            
    async def move_file(self, source_object_name: str, destination_object_name: str) -> None:
        if not self.bucket_name:
            raise ValueError("Bucket name not configured")
        try:
            logging.info(f"Moving object from '{source_object_name}' to '{destination_object_name}'")
            # Copy the object first
            source = CopySource(self.bucket_name, source_object_name)
            self.client.copy_object(
                 bucket_name=self.bucket_name,
                 object_name=destination_object_name,
                 source=source # Correct usage
            )
            # Then delete the original object
            self.client.remove_object(self.bucket_name, source_object_name)
            logging.info(f"Successfully moved object '{source_object_name}' to '{destination_object_name}'")
        except Exception as e: # Catch broadly and log/re-raise
            logging.error(f"Failed to move object '{source_object_name}' to '{destination_object_name}': {e}", exc_info=True)
            raise Exception(f"MinIO move_file failed: {e}") from e

    async def copy_object(self, source_object_name: str, destination_object_name: str) -> None:
        """Copies an object within the same bucket."""
        if not self.bucket_name:
            raise ValueError("Bucket name not configured")
        try:
            logging.info(f"Attempting to copy object from '{source_object_name}' to '{destination_object_name}' in bucket '{self.bucket_name}'")
            # Use client.copy_object for S3 compatible copy
            source = CopySource(self.bucket_name, source_object_name)
            result = self.client.copy_object(
                bucket_name=self.bucket_name,
                object_name=destination_object_name,
                source=source # Pass the CopySource object
            )
            logging.info(f"Successfully copied object '{source_object_name}' to '{destination_object_name}', etag: {result.etag}")
        except Exception as e:
            logging.error(f"Failed to copy object '{source_object_name}' to '{destination_object_name}': {e}", exc_info=True)
            # Re-raise the exception so the calling service knows it failed
            raise Exception(f"MinIO copy_object failed: {e}") from e

# Factory function moved here
def get_storage_provider() -> MinioStorageProvider:
    """Factory function to get the configured MinIO storage provider instance."""
    # Reads settings and returns configured instance
    logging.info(f"Creating MinioStorageProvider for endpoint {settings.MINIO_ENDPOINT}")
    return MinioStorageProvider(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ROOT_USER,
        secret_key=settings.MINIO_ROOT_PASSWORD,
        bucket_name=settings.MINIO_BUCKET_NAME,
    )

