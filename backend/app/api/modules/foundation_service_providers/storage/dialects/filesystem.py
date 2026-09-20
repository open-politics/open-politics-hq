"""
filesystem.py — a directory on disk.
====================================

  UploadFile ──► stream in 8KB chunks ──► base_path/<object_name>
                        │
                        └─ first chunk truncates, rest append
                           (so an upload can exceed memory)

  get_file_path  ──►  a REAL local Path   ◄── the one thing s3 cannot do
                                              (open a PDF in place, no copy)

  _path()  ──►  resolves under base_path, rejects ".." traversal
                (an object_name is untrusted: uploads, imported listings)

The fully-local option: no object store, no network, no credentials.
"""

from __future__ import annotations

import asyncio
import logging
import mimetypes
import shutil
from pathlib import Path
from typing import Any, List, Optional

from fastapi import UploadFile

from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)

CHUNK = 8192


class FilesystemStorage(Adapter):
    """Local filesystem storage."""

    def __init__(self, base_path: str, **kw):
        super().__init__(**kw)
        self.root = Path(base_path).resolve()
        if not self.root.exists():
            self.root.mkdir(parents=True, exist_ok=True)
            logger.info("Created storage root %s", self.root)
        logger.info("Filesystem storage ready: root=%s", self.root)

    def _path(self, object_name: str) -> Path:
        """Resolve under the root, refusing traversal.

        An object name is untrusted input — it can come from an uploaded
        filename or an imported directory listing — so ``..`` must not escape.
        """
        path = (self.root / object_name).resolve()
        if not path.is_relative_to(self.root):
            raise ValueError(f"Path traversal rejected: {object_name}")
        return path

    # ── writes ───────────────────────────────────────────────────────────────

    async def upload_file(self, file: UploadFile, object_name: str) -> None:
        path = self._path(object_name)
        path.parent.mkdir(parents=True, exist_ok=True)

        def _write(buf: bytes, mode: str) -> None:
            with open(path, mode) as f:
                f.write(buf)

        # Stream: an upload can exceed memory. Truncate first chunk, append after.
        first = True
        while chunk := await file.read(CHUNK):
            await asyncio.to_thread(_write, chunk, "wb" if first else "ab")
            first = False
        if first:
            await asyncio.to_thread(path.write_bytes, b"")   # empty upload still lands

        logger.info("Uploaded %r to %s", object_name, path)

    async def upload_from_bytes(self, file_bytes: bytes, object_name: str,
                                filename: Optional[str] = None,
                                content_type: Optional[str] = None) -> None:
        path = self._path(object_name)
        path.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(path.write_bytes, file_bytes)
        guessed = content_type or (
            mimetypes.guess_type(filename)[0] if filename else None
        ) or "application/octet-stream"
        logger.info("Uploaded %r (%s, %d bytes) to %s",
                    object_name, guessed, len(file_bytes), path)

    # ── reads ────────────────────────────────────────────────────────────────

    def get_file_path(self, object_name: str) -> Path:
        path = self._path(object_name)
        if not path.is_file():
            raise FileNotFoundError(f"{object_name!r} not found")
        return path

    async def get_file(self, object_name: str) -> Any:
        """An open handle. Prefer ``get_file_path`` here — it avoids the copy."""
        return open(self.get_file_path(object_name), "rb")

    def file_exists(self, object_name: str) -> bool:
        try:
            return self._path(object_name).is_file()
        except ValueError:
            return False

    async def download_file(self, source_object_name: str,
                            destination_local_path: str) -> None:
        path = self.get_file_path(source_object_name)
        await asyncio.to_thread(shutil.copy2, path, destination_local_path)
        logger.info("Copied %r to %r", source_object_name, destination_local_path)

    async def list_files(self, prefix: Optional[str] = None,
                         limit: Optional[int] = None, offset: int = 0) -> List[str]:
        search_root = self.root / prefix if prefix else self.root
        if not search_root.exists():
            return []
        root = self.root

        def _walk() -> List[str]:
            found: List[str] = []
            for p in search_root.rglob("*"):
                if p.is_file():
                    try:
                        found.append(str(p.relative_to(root)).replace("\\", "/"))
                    except ValueError:
                        pass
            return sorted(found)

        names = await asyncio.to_thread(_walk)
        if offset:
            names = names[offset:]
        return names[:limit] if limit is not None else names

    # ── mutations ────────────────────────────────────────────────────────────

    async def delete_file(self, object_name: str) -> None:
        path = self._path(object_name)
        if not path.exists():
            logger.warning("Delete of absent %r — idempotent success", object_name)
            return
        if not path.is_file():
            raise IOError(f"Cannot delete a directory: {object_name}")
        await asyncio.to_thread(path.unlink)
        logger.info("Deleted %r", object_name)

    def delete_file_sync(self, object_name: str) -> None:
        path = self._path(object_name)
        if path.is_file():
            path.unlink()
            logger.info("Deleted %r (sync)", object_name)

    async def move_file(self, source_object_name: str,
                        destination_object_name: str) -> None:
        src = self._path(source_object_name)
        dst = self._path(destination_object_name)
        if not src.exists():
            raise FileNotFoundError(f"{source_object_name!r} not found")
        dst.parent.mkdir(parents=True, exist_ok=True)
        await asyncio.to_thread(shutil.move, str(src), str(dst))
        logger.info("Moved %r → %r", source_object_name, destination_object_name)
