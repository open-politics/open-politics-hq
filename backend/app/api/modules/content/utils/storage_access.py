"""
Storage access helpers — read blobs without leaking provider details.

Processors, enrichers, and handlers need either raw bytes or a filesystem
path to an asset's content. Storage providers expose two shapes:
- ``get_file_path(blob_path) -> Path`` — zero-copy local filesystem path.
  Only local_fs supports it; MinIO/S3 raise NotImplementedError.
- ``get_file(blob_path) -> async stream`` — always works.

Every call site used to dance the same ``hasattr(storage, "get_file_path")``
fallback. The ``hasattr`` check is *wrong* because MinIO defines the method
(it exists at runtime) — it just raises. Callers crash. These helpers centralise
the correct try/except pattern so callers pick bytes or path and forget the
rest.
"""

from __future__ import annotations

import tempfile
from pathlib import Path
from typing import Any


async def read_to_bytes(storage: Any, blob_path: str) -> bytes:
    """Return the blob's bytes. Zero-copy when the provider supports a local path."""
    try:
        path = storage.get_file_path(blob_path)
        return path.read_bytes()
    except (AttributeError, NotImplementedError, FileNotFoundError):
        pass
    fh = await storage.get_file(blob_path)
    try:
        return fh.read()
    finally:
        try:
            fh.close()
        except Exception:
            pass


async def read_to_path(storage: Any, blob_path: str) -> tuple[Path, bool]:
    """Return ``(path, is_temp)``. Caller MUST unlink if ``is_temp`` is True.

    For local_fs providers this returns the direct path (no copy). For remote
    providers (MinIO, S3) this streams the blob to a ``NamedTemporaryFile`` with
    the original suffix preserved — pymupdf and other libraries that sniff the
    extension work transparently.
    """
    try:
        path = storage.get_file_path(blob_path)
        return path, False
    except (AttributeError, NotImplementedError, FileNotFoundError):
        pass
    fh = await storage.get_file(blob_path)
    try:
        suffix = Path(blob_path).suffix
        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
        try:
            tmp.write(fh.read())
        finally:
            tmp.close()
        return Path(tmp.name), True
    finally:
        try:
            fh.close()
        except Exception:
            pass
