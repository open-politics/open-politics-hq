import logging
import io
from fastapi import HTTPException, UploadFile
from minio import Minio
from minio.error import S3Error

from app.core.config import settings # Assuming settings are loaded here

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")

class MinioClientHandler:
    """Handles MinIO connection and operations."""
    def __init__(self):
        try:
            self.client = Minio(
                endpoint=settings.MINIO_ENDPOINT,
                access_key=settings.MINIO_ROOT_USER,
                secret_key=settings.MINIO_ROOT_PASSWORD,
                secure=settings.MINIO_SECURE,
            )
            self.bucket_name = settings.MINIO_BUCKET_NAME
            self._ensure_bucket_exists()
            logging.info("MinIO client initialized.")
        except Exception as e:
            logging.error(f"Failed to initialize MinIO client: {e}")
            # Depending on requirements, you might want to raise an exception
            # or handle the lack of connection gracefully elsewhere.
            self.client = None
            self.bucket_name = None

    def _ensure_bucket_exists(self):
        """Creates the bucket if it doesn't exist."""
        if not self.client:
            logging.error("MinIO client not initialized, cannot ensure bucket exists.")
            return
        try:
            if not self.client.bucket_exists(self.bucket_name):
                self.client.make_bucket(self.bucket_name)
                logging.info(f"Bucket '{self.bucket_name}' created.")
        except S3Error as e:
            logging.error(f"MinIO error ensuring bucket exists: {e}")
            # Consider raising an exception or handling appropriately
        except Exception as e:
            logging.error(f"Unexpected error ensuring bucket exists: {e}")

    async def upload_file(
        self,
        file: UploadFile,
        object_name: str,
        bucket_name: str | None = None
    ):
        """Uploads a file-like object to MinIO."""
        if not self.client:
            raise HTTPException(status_code=503, detail="Storage service not available.")

        target_bucket = bucket_name or self.bucket_name
        try:
            file_content = await file.read()
            file_size = len(file_content)
            self.client.put_object(
                bucket_name=target_bucket,
                object_name=object_name,
                data=io.BytesIO(file_content),
                length=file_size,
                content_type=file.content_type,
            )
            logging.info(f"File '{file.filename}' uploaded successfully to '{target_bucket}/{object_name}'. Size: {file_size} bytes.")
            return object_name # Return the final object name
        except S3Error as e:
            logging.error(f"MinIO error uploading file '{object_name}': {e}")
            raise HTTPException(status_code=500, detail="Failed to upload file to storage.")
        except Exception as e:
            logging.error(f"Unexpected error during file upload '{object_name}': {e}")
            raise HTTPException(status_code=500, detail="Unexpected error during file upload.")

    def get_file_object(self, object_name: str, bucket_name: str | None = None):
        """Retrieves a file object from MinIO."""
        if not self.client:
            logging.error("MinIO client not initialized, cannot get file object.")
            # Raise or return None depending on how you want to handle this in tasks
            raise ConnectionError("Storage service not available.")

        target_bucket = bucket_name or self.bucket_name
        try:
            response = self.client.get_object(target_bucket, object_name)
            logging.info(f"Retrieved file object '{target_bucket}/{object_name}'")
            return response
        except S3Error as e:
            logging.error(f"MinIO error retrieving file '{object_name}': {e}")
            # Handle specific errors like NoSuchKey if needed
            if e.code == "NoSuchKey":
                raise FileNotFoundError(f"File not found in storage: {target_bucket}/{object_name}") from e
            else:
                raise IOError(f"Failed to retrieve file from storage: {e}") from e
        except Exception as e:
             logging.error(f"Unexpected error retrieving file '{object_name}': {e}")
             raise IOError(f"Unexpected error retrieving file: {e}") from e
        finally:
            # Ensure the response stream is closed by the caller
            # if response:
            #     response.close()
            #     response.release_conn()
            pass

    def delete_file(self, object_name: str, bucket_name: str | None = None):
        """Deletes a file object from MinIO."""
        if not self.client:
            logging.error("MinIO client not initialized, cannot delete file object.")
            raise ConnectionError("Storage service not available.")

        target_bucket = bucket_name or self.bucket_name
        try:
            self.client.remove_object(target_bucket, object_name)
            logging.info(f"Successfully deleted file object '{target_bucket}/{object_name}'")
        except S3Error as e:
            logging.error(f"MinIO error deleting file '{object_name}': {e}")
            # Decide if this should raise an error or just log
            raise IOError(f"Failed to delete file from storage: {e}") from e
        except Exception as e:
             logging.error(f"Unexpected error deleting file '{object_name}': {e}")
             raise IOError(f"Unexpected error deleting file: {e}") from e

# Singleton instance (optional, but often convenient)
minio_client = MinioClientHandler() 