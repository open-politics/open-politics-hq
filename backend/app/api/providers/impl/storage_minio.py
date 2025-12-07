import logging
from typing import List, Optional, Any
from minio import Minio
from minio.error import S3Error
from fastapi import UploadFile
import io

from app.api.providers.base import StorageProvider # Protocol

logger = logging.getLogger(__name__)

class MinioStorageProvider(StorageProvider):
    def __init__(self, endpoint_url: str, access_key: str, secret_key: str, bucket_name: str, use_ssl: bool):
        try:
            self.client = Minio(
                endpoint=endpoint_url,
                access_key=access_key,
                secret_key=secret_key,
                secure=use_ssl
            )
            self.bucket_name = bucket_name
            self._ensure_bucket_exists()
            logger.info(f"MinioStorageProvider initialized for bucket '{self.bucket_name}' at '{endpoint_url}'. SSL: {use_ssl}")
        except Exception as e:
            logger.error(f"Failed to initialize MinioStorageProvider: {e}", exc_info=True)
            raise ConnectionError(f"Minio connection failed: {e}") from e

    def _ensure_bucket_exists(self):
        try:
            found = self.client.bucket_exists(bucket_name=self.bucket_name)
            if not found:
                self.client.make_bucket(bucket_name=self.bucket_name)
                logger.info(f"Bucket '{self.bucket_name}' created.")
            else:
                logger.debug(f"Bucket '{self.bucket_name}' already exists.")
        except S3Error as e:
            logger.error(f"S3Error ensuring bucket '{self.bucket_name}' exists: {e}", exc_info=True)
            raise ConnectionError(f"Minio bucket operation failed: {e}") from e

    async def upload_file(self, file: UploadFile, object_name: str) -> None:
        try:
            content = await file.read()
            await file.seek(0) # Reset pointer in case it needs to be read again by caller
            self.client.put_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                data=io.BytesIO(content),
                length=len(content),
                content_type=file.content_type
            )
            logger.info(f"File '{file.filename}' uploaded as '{object_name}' to bucket '{self.bucket_name}'.")
        except S3Error as e:
            logger.error(f"S3Error uploading file '{object_name}': {e}", exc_info=True)
            raise IOError(f"Minio upload failed: {e}") from e

    async def upload_from_bytes(self, file_bytes: bytes, object_name: str, filename: Optional[str] = None, content_type: Optional[str] = None) -> None:
        try:
            guessed_content_type = content_type
            if not guessed_content_type and filename:
                import mimetypes
                guessed_content_type = mimetypes.guess_type(filename)[0] or 'application/octet-stream'
            elif not guessed_content_type:
                guessed_content_type = 'application/octet-stream'

            self.client.put_object(
                bucket_name=self.bucket_name,
                object_name=object_name,
                data=io.BytesIO(file_bytes),
                length=len(file_bytes),
                content_type=guessed_content_type
            )
            logger.info(f"Bytes uploaded as '{object_name}' (content-type: {guessed_content_type}) to bucket '{self.bucket_name}'.")
        except S3Error as e:
            logger.error(f"S3Error uploading bytes as '{object_name}': {e}", exc_info=True)
            raise IOError(f"Minio bytes upload failed: {e}") from e

    async def get_file(self, object_name: str) -> Any: # Should return a file-like object (stream)
        try:
            response = self.client.get_object(bucket_name=self.bucket_name, object_name=object_name)
            logger.debug(f"Retrieved file object '{object_name}' from bucket '{self.bucket_name}'.")
            # The response itself is a stream (urllib3.response.HTTPResponse)
            return response
        except S3Error as e:
            if e.code == "NoSuchKey":
                logger.warning(f"File '{object_name}' not found in bucket '{self.bucket_name}'.")
                raise FileNotFoundError(f"File '{object_name}' not found in Minio.") from e
            logger.error(f"S3Error getting file '{object_name}': {e}", exc_info=True)
            raise IOError(f"Minio get_file failed: {e}") from e

    async def download_file(self, source_object_name: str, destination_local_path: str) -> None:
        try:
            self.client.fget_object(bucket_name=self.bucket_name, object_name=source_object_name, file_path=destination_local_path)
            logger.info(f"File '{source_object_name}' downloaded to '{destination_local_path}'.")
        except S3Error as e:
            if e.code == "NoSuchKey":
                raise FileNotFoundError(f"File '{source_object_name}' not found for download.") from e
            logger.error(f"S3Error downloading file '{source_object_name}': {e}", exc_info=True)
            raise IOError(f"Minio download_file failed: {e}") from e

    async def delete_file(self, object_name: str) -> None:
        try:
            self.client.remove_object(bucket_name=self.bucket_name, object_name=object_name)
            logger.info(f"File '{object_name}' deleted from bucket '{self.bucket_name}'.")
        except S3Error as e:
            # Idempotency: if it's already gone, don't raise error, just log
            if e.code == "NoSuchKey":
                logger.warning(f"Attempted to delete non-existent file '{object_name}'. Idempotent success.")
                return
            logger.error(f"S3Error deleting file '{object_name}': {e}", exc_info=True)
            raise IOError(f"Minio delete_file failed: {e}") from e
    
    def delete_file_sync(self, object_name: str) -> None:
        """Synchronous version for specific non-async contexts like cleanup."""
        try:
            self.client.remove_object(bucket_name=self.bucket_name, object_name=object_name)
            logger.info(f"File '{object_name}' deleted synchronously from bucket '{self.bucket_name}'.")
        except S3Error as e:
            if e.code == "NoSuchKey":
                logger.warning(f"Attempted to sync-delete non-existent file '{object_name}'. Idempotent success.")
                return
            logger.error(f"S3Error sync-deleting file '{object_name}': {e}", exc_info=True)
            # Not raising IOError here as it might be called in cleanup paths where exceptions are problematic
            # but logging the error is important.

    async def list_files(self, prefix: Optional[str] = None) -> List[str]:
        try:
            objects = self.client.list_objects(bucket_name=self.bucket_name, prefix=prefix, recursive=True)
            return [obj.object_name for obj in objects]
        except S3Error as e:
            logger.error(f"S3Error listing files with prefix '{prefix}': {e}", exc_info=True)
            raise IOError(f"Minio list_files failed: {e}") from e
        
    async def move_file(self, source_object_name: str, destination_object_name: str) -> None:
        from minio.commonconfig import CopySource # Local import
        try:
            copy_source = CopySource(bucket=self.bucket_name, object=source_object_name)
            self.client.copy_object(bucket_name=self.bucket_name, object_name=destination_object_name, source=copy_source)
            self.client.remove_object(bucket_name=self.bucket_name, object_name=source_object_name) # Delete original after copy
            logger.info(f"File moved from '{source_object_name}' to '{destination_object_name}' in bucket '{self.bucket_name}'.")
        except S3Error as e:
            logger.error(f"S3Error moving file from '{source_object_name}' to '{destination_object_name}': {e}", exc_info=True)
            raise IOError(f"Minio move_file failed: {e}") from e

    async def copy_object(self, source_object_name: str, destination_object_name: str, source_bucket_name: Optional[str] = None) -> None:
        from minio.commonconfig import CopySource # Local import
        src_bucket = source_bucket_name if source_bucket_name else self.bucket_name
        try:
            copy_source = CopySource(bucket=src_bucket, object=source_object_name)
            self.client.copy_object(bucket_name=self.bucket_name, object_name=destination_object_name, source=copy_source)
            logger.info(f"File copied from '{src_bucket}/{source_object_name}' to '{self.bucket_name}/{destination_object_name}'.")
        except S3Error as e:
            logger.error(f"S3Error copying file from '{src_bucket}/{source_object_name}' to '{self.bucket_name}/{destination_object_name}': {e}", exc_info=True)
            raise IOError(f"Minio copy_object failed: {e}") from e