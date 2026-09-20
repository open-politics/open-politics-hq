"""
storage/base.py — the contract.
===============================

  upload_file / upload_from_bytes   ──►  put
  get_file                          ──►  an open, caller-closed stream
  get_file_path                     ──►  a local Path
  file_exists · list_files          ──►  read
  delete_file · delete_file_sync    ──►  mutate (idempotent delete)
  move_file                         ──►  mutate

                  filesystem        s3
  get_file_path     a Path          raises NotImplementedError

  s3          MinIO · Garage · R2 · B2 · Wasabi · AWS
  filesystem  a local volume

hasattr(provider, "get_file_path") is the WRONG test for "can I get a
local path": s3 HAS the method and refuses at call time instead of
lacking it. ../content/utils/storage_access.py is the shim that knows.
"""

from __future__ import annotations
from pathlib import Path
from typing import Any, List, Optional, Protocol, runtime_checkable
from fastapi import UploadFile


@runtime_checkable
class StorageProvider(Protocol):
    """Object storage."""

    async def upload_file(self, file: UploadFile, object_name: str) -> None: ...

    async def upload_from_bytes(self, file_bytes: bytes, object_name: str,
                                filename: Optional[str] = None,
                                content_type: Optional[str] = None) -> None: ...

    async def get_file(self, object_name: str) -> Any:
        """An open, readable stream. The caller closes it."""
        ...

    def get_file_path(self, object_name: str) -> Path:
        """Local path for zero-copy access.

        Filesystem storage only. Object storage raises ``NotImplementedError``,
        and ``content/utils/storage_access.py`` is the shim that handles both —
        note that ``hasattr`` is the *wrong* test here, because object storage
        has the method and refuses at call time.
        """
        ...

    def file_exists(self, object_name: str) -> bool: ...

    async def download_file(self, source_object_name: str,
                            destination_local_path: str) -> None: ...

    async def delete_file(self, object_name: str) -> None:
        """Idempotent — deleting what is already gone is success."""
        ...

    def delete_file_sync(self, object_name: str) -> None:
        """Synchronous delete, for cleanup paths that are not async."""
        ...

    async def list_files(self, prefix: Optional[str] = None,
                         limit: Optional[int] = None, offset: int = 0) -> List[str]: ...

    async def move_file(self, source_object_name: str,
                        destination_object_name: str) -> None: ...
