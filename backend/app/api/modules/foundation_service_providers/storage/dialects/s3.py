"""
s3.py — any S3-compatible object store.

  UploadFile / bytes ──► asyncio.to_thread( Minio, sync SDK ) ──► bucket

  Speaks the S3 protocol, not one product:
    MinIO · Garage · Ceph · R2 · B2 · Wasabi · AWS
    (differ in URL, credentials, TLS — a declaration, not code)

  get_file_path  ──►  NotImplementedError   (no local path; use get_file())

The ``minio`` package is used as a generic S3 client, not a MinIO-only one,
and its API is synchronous, so every call goes through a thread.
"""

from __future__ import annotations

import asyncio
import io
import logging
import mimetypes
from pathlib import Path
from typing import Any, List, Optional

from fastapi import UploadFile
from minio import Minio
from minio.error import S3Error

from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)


class S3Storage(Adapter):
    """Any S3-compatible object store."""

    def __init__(self, endpoint_url: str, access_key: str, secret_key: str,
                 bucket_name: str, use_ssl: bool = False,
                 region: Optional[str] = None, **kw):
        super().__init__(**kw)
        self.bucket = bucket_name
        try:
            self.s3 = Minio(endpoint=endpoint_url, access_key=access_key,
                            secret_key=secret_key, secure=use_ssl, region=region)
            if self.quirks.create_bucket:
                self._ensure_bucket()
            logger.info("S3 storage ready: bucket=%r endpoint=%r ssl=%s",
                        self.bucket, endpoint_url, use_ssl)
        except Exception as e:
            logger.error("S3 storage init failed: %s", e, exc_info=True)
            raise ConnectionError(f"S3 connection failed: {e}") from e

    def _ensure_bucket(self) -> None:
        try:
            if not self.s3.bucket_exists(self.bucket):
                self.s3.make_bucket(self.bucket)
                logger.info("Created bucket %r", self.bucket)
        except S3Error as e:
            raise ConnectionError(f"S3 bucket operation failed: {e}") from e

    # ── writes ───────────────────────────────────────────────────────────────

    async def upload_file(self, file: UploadFile, object_name: str) -> None:
        content = await file.read()
        await file.seek(0)          # caller may read it again
        await self._put(content, object_name, file.content_type)

    async def upload_from_bytes(self, file_bytes: bytes, object_name: str,
                                filename: Optional[str] = None,
                                content_type: Optional[str] = None) -> None:
        if not content_type:
            content_type = (mimetypes.guess_type(filename)[0] if filename else None) \
                or "application/octet-stream"
        await self._put(file_bytes, object_name, content_type)

    async def _put(self, content: bytes, object_name: str, content_type: Optional[str]) -> None:
        try:
            await asyncio.to_thread(
                self.s3.put_object,
                bucket_name=self.bucket, object_name=object_name,
                data=io.BytesIO(content), length=len(content),
                content_type=content_type or "application/octet-stream",
            )
            logger.info("Uploaded %r (%d bytes) to %r", object_name, len(content), self.bucket)
        except S3Error as e:
            logger.error("S3 upload failed for %r: %s", object_name, e, exc_info=True)
            raise IOError(f"Upload failed: {e}") from e

    # ── reads ────────────────────────────────────────────────────────────────

    def get_file_path(self, object_name: str) -> Path:
        raise NotImplementedError("Object storage has no local path; use get_file()")

    async def get_file(self, object_name: str) -> Any:
        try:
            return await asyncio.to_thread(
                self.s3.get_object, bucket_name=self.bucket, object_name=object_name
            )
        except S3Error as e:
            if e.code == "NoSuchKey":
                raise FileNotFoundError(f"{object_name!r} not found") from e
            raise IOError(f"Read failed: {e}") from e

    def file_exists(self, object_name: str) -> bool:
        try:
            self.s3.stat_object(bucket_name=self.bucket, object_name=object_name)
            return True
        except S3Error as e:
            if e.code == "NoSuchKey":
                return False
            raise

    async def download_file(self, source_object_name: str,
                            destination_local_path: str) -> None:
        try:
            await asyncio.to_thread(
                self.s3.fget_object, bucket_name=self.bucket,
                object_name=source_object_name, file_path=destination_local_path,
            )
            logger.info("Downloaded %r to %r", source_object_name, destination_local_path)
        except S3Error as e:
            if e.code == "NoSuchKey":
                raise FileNotFoundError(f"{source_object_name!r} not found") from e
            raise IOError(f"Download failed: {e}") from e

    async def list_files(self, prefix: Optional[str] = None,
                         limit: Optional[int] = None, offset: int = 0) -> List[str]:
        def _collect() -> List[str]:
            # list_objects is lazy — iterating it is what makes the HTTP calls.
            return [o.object_name for o in self.s3.list_objects(
                bucket_name=self.bucket, prefix=prefix, recursive=True)]

        try:
            names = await asyncio.to_thread(_collect)
        except S3Error as e:
            logger.error("S3 list failed for prefix %r: %s", prefix, e, exc_info=True)
            raise IOError(f"List failed: {e}") from e

        if offset:
            names = names[offset:]
        return names[:limit] if limit is not None else names

    # ── mutations ────────────────────────────────────────────────────────────

    async def delete_file(self, object_name: str) -> None:
        try:
            await asyncio.to_thread(self.s3.remove_object,
                                    bucket_name=self.bucket, object_name=object_name)
            logger.info("Deleted %r", object_name)
        except S3Error as e:
            if e.code == "NoSuchKey":
                logger.warning("Delete of absent %r — idempotent success", object_name)
                return
            raise IOError(f"Delete failed: {e}") from e

    def delete_file_sync(self, object_name: str) -> None:
        try:
            self.s3.remove_object(bucket_name=self.bucket, object_name=object_name)
            logger.info("Deleted %r (sync)", object_name)
        except S3Error as e:
            if e.code == "NoSuchKey":
                return
            # Never raises: this runs in cleanup paths.
            logger.error("Sync delete failed for %r: %s", object_name, e, exc_info=True)

    async def move_file(self, source_object_name: str,
                        destination_object_name: str) -> None:
        from minio.commonconfig import CopySource
        try:
            await asyncio.to_thread(
                self.s3.copy_object, bucket_name=self.bucket,
                object_name=destination_object_name,
                source=CopySource(bucket=self.bucket, object=source_object_name),
            )
            await asyncio.to_thread(self.s3.remove_object,
                                    bucket_name=self.bucket, object_name=source_object_name)
            logger.info("Moved %r → %r", source_object_name, destination_object_name)
        except S3Error as e:
            logger.error("S3 move failed %r → %r: %s",
                         source_object_name, destination_object_name, e, exc_info=True)
            raise IOError(f"Move failed: {e}") from e
