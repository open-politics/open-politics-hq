"""
Local filesystem storage provider.

A drop-in replacement for MinIO that stores files on the local filesystem.
Object names map directly to filesystem paths under base_path.
"""

import asyncio
import logging
import mimetypes
import shutil
from pathlib import Path
from typing import List, Optional, Any

from fastapi import UploadFile

from app.api.modules.foundation_service_providers.base import StorageProvider, FileStat

logger = logging.getLogger(__name__)


class LocalFileSystemStorageProvider(StorageProvider):
    """Storage provider that uses local filesystem as a drop-in for MinIO."""

    def __init__(self, base_path: str, allowed_import_paths: Optional[List[str]] = None):
        """
        Args:
            base_path: Root directory for all storage operations. Object names
                       map to paths under this directory.
            allowed_import_paths: Whitelist of directories users can import from.
                                  Paths outside this list are rejected by is_allowed_import_path().
        """
        self.base_path = Path(base_path).resolve()
        self.allowed_import_paths = [
            Path(p).resolve() for p in (allowed_import_paths or [])
        ]
        if not self.base_path.exists():
            self.base_path.mkdir(parents=True, exist_ok=True)
            logger.info(f"Created storage base_path: {self.base_path}")

        logger.info(f"LocalFileSystemStorageProvider initialized: base_path={self.base_path}")

    def is_allowed_import_path(self, source_path: str) -> bool:
        """Check if source_path is under one of the allowed import paths."""
        try:
            resolved = Path(source_path).resolve()
            return any(resolved.is_relative_to(a) for a in self.allowed_import_paths)
        except (OSError, RuntimeError):
            return False

    def _resolve_path(self, object_name: str) -> Path:
        """Resolve and validate path under base_path (prevents path traversal)."""
        path = (self.base_path / object_name).resolve()
        if not path.is_relative_to(self.base_path):
            raise ValueError(f"Path traversal rejected: {object_name}")
        return path

    async def upload_file(self, file: UploadFile, object_name: str) -> None:
        path = self._resolve_path(object_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        chunk_size = 8192

        def _write_chunk(buf: bytes, target: Path, mode: str) -> None:
            with open(target, mode) as f:
                f.write(buf)

        # Truncate on first chunk, append on subsequent ones.
        first = True
        while chunk := await file.read(chunk_size):
            await asyncio.to_thread(_write_chunk, chunk, path, "wb" if first else "ab")
            first = False
        if first:
            # Empty upload — still create the file.
            await asyncio.to_thread(path.write_bytes, b"")
        guessed = file.content_type or (
            mimetypes.guess_type(file.filename or "")[0] if file.filename else "application/octet-stream"
        )
        logger.info(f"Uploaded file '{object_name}' ({guessed}) to {path}")

    async def upload_from_bytes(
        self,
        file_bytes: bytes,
        object_name: str,
        filename: Optional[str] = None,
        content_type: Optional[str] = None,
    ) -> None:
        path = self._resolve_path(object_name)
        path.parent.mkdir(parents=True, exist_ok=True)

        guessed = content_type
        if not guessed and filename:
            guessed = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        elif not guessed:
            guessed = "application/octet-stream"

        await asyncio.to_thread(path.write_bytes, file_bytes)
        logger.info(f"Uploaded bytes as '{object_name}' ({guessed}) to {path}")

    def get_file_path(self, object_name: str) -> Path:
        """Return the local filesystem path for direct file access (zero-copy)."""
        path = self._resolve_path(object_name)
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File '{object_name}' not found")
        return path

    async def get_file(self, object_name: str) -> Any:
        """Returns an open file handle. Caller must close it. Prefer get_file_path() for zero-copy."""
        path = self._resolve_path(object_name)
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File '{object_name}' not found")
        return open(path, "rb")

    def file_exists(self, object_name: str) -> bool:
        """Check if the object exists as a file."""
        try:
            path = self._resolve_path(object_name)
            return path.exists() and path.is_file()
        except ValueError:
            return False

    def file_stat(self, object_name: str) -> Optional[FileStat]:
        """Get file metadata (size, mtime) for change detection."""
        try:
            path = self._resolve_path(object_name)
            if not path.exists() or not path.is_file():
                return None
            stat = path.stat()
            return FileStat(size=stat.st_size, mtime=stat.st_mtime, etag=None)
        except (ValueError, OSError):
            return None

    async def download_file(self, source_object_name: str, destination_local_path: str) -> None:
        path = self._resolve_path(source_object_name)
        if not path.exists() or not path.is_file():
            raise FileNotFoundError(f"File '{source_object_name}' not found")
        await asyncio.to_thread(shutil.copy2, path, destination_local_path)
        logger.info(f"Downloaded '{source_object_name}' to '{destination_local_path}'")

    async def delete_file(self, object_name: str) -> None:
        path = self._resolve_path(object_name)
        if path.exists():
            if path.is_file():
                await asyncio.to_thread(path.unlink)
                logger.info(f"Deleted file '{object_name}'")
            else:
                raise IOError(f"Cannot delete directory: {object_name}")
        else:
            logger.warning(f"Attempted to delete non-existent file '{object_name}'. Idempotent success.")

    def delete_file_sync(self, object_name: str) -> None:
        path = self._resolve_path(object_name)
        if path.exists() and path.is_file():
            path.unlink()
            logger.info(f"Deleted file '{object_name}' (sync)")
        else:
            logger.warning(f"Attempted to sync-delete non-existent file '{object_name}'. Idempotent success.")

    async def list_files(
        self,
        prefix: Optional[str] = None,
        limit: Optional[int] = None,
        offset: int = 0,
    ) -> List[str]:
        search_root = self.base_path / prefix if prefix else self.base_path
        if not search_root.exists():
            return []

        base_path = self.base_path

        def _walk() -> List[str]:
            files: List[str] = []
            for p in search_root.rglob("*"):
                if p.is_file():
                    try:
                        rel = p.relative_to(base_path)
                        files.append(str(rel).replace("\\", "/"))
                    except ValueError:
                        pass
            return sorted(files)

        result = await asyncio.to_thread(_walk)
        if offset > 0:
            result = result[offset:]
        if limit is not None:
            result = result[:limit]
        return result

    async def move_file(self, source_object_name: str, destination_object_name: str) -> None:
        src = self._resolve_path(source_object_name)
        dst = self._resolve_path(destination_object_name)
        if not src.exists():
            raise FileNotFoundError(f"Source '{source_object_name}' not found")
        dst.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.move, str(src), str(dst))
        logger.info(f"Moved '{source_object_name}' to '{destination_object_name}'")
