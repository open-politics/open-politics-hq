"""
Storage Browse Routes
====================

Endpoints for browsing local storage (allowed import paths).
Used by the Local Storage Import UI to discover directories before import.
"""

import logging
import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel

from app.api import dependency_injection
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.api.modules.content.types import importable_extensions

logger = logging.getLogger(__name__)

router = APIRouter()


class StorageBrowseEntry(BaseModel):
    """Single entry in a storage directory listing."""
    name: str
    path: str
    is_directory: bool
    file_count: int = 0
    importable_count: int = 0
    size_bytes: int = 0
    counts_capped: bool = False  # True when STORAGE_BROWSE_MAX_COUNT_FILES was hit


class StorageBrowseResponse(BaseModel):
    """Response for storage browse endpoint."""
    current_path: str
    parent_path: Optional[str] = None
    entries: List[StorageBrowseEntry]
    allowed_roots: List[str]
    path_error: Optional[str] = None  # Set when path doesn't exist (mount/config issue)


def _is_allowed_path(path: Path, allowed_roots: List[Path]) -> bool:
    """Check if path is under one of the allowed roots."""
    try:
        resolved = path.resolve()
        for root in allowed_roots:
            if root and resolved.is_relative_to(root):
                return True
    except (ValueError, OSError):
        pass
    return False


@router.get("/infospaces/{infospace_id}/storage/browse", response_model=StorageBrowseResponse)
def browse_storage(
    *,
    infospace_id: int,
    path: Optional[str] = Query(None, description="Directory path to list; defaults to first allowed root"),
    include_counts: bool = Query(
        True,
        description="Include file_count, importable_count, size_bytes for directories (expensive on large trees)",
    ),
    access: Access = Requires(Capability.INGEST),  # browsing storage for import = ingest capability
    db=dependency_injection.Depends(dependency_injection.get_db),
) -> StorageBrowseResponse:
    """
    List immediate children of a directory under allowed import paths.

    Used by the Local Storage Import UI to browse available datasets before import.
    Path must be under ALLOWED_IMPORT_PATHS (or LOCAL_STORAGE_BASE_PATH).
    """
    from app.core.config import settings

    is_owner = access.is_owner

    allowed_str = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
    if not allowed_str:
        allowed_str = [settings.LOCAL_STORAGE_BASE_PATH]

    allowed_roots = []
    for p in allowed_str:
        try:
            allowed_roots.append(Path(p).resolve())
        except (ValueError, OSError):
            pass

    if not allowed_roots:
        roots_for_response = [str(Path(settings.LOCAL_STORAGE_BASE_PATH).resolve())] if is_owner else []
        return StorageBrowseResponse(
            current_path="",
            parent_path=None,
            entries=[],
            allowed_roots=roots_for_response,
        )

    # Resolve target path
    if path and path.strip():
        target = Path(path).resolve()
    else:
        target = allowed_roots[0]

    if not _is_allowed_path(target, allowed_roots):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Path is not under allowed import paths")

    roots_for_response = [str(r) for r in allowed_roots] if is_owner else []

    if not target.exists():
        return StorageBrowseResponse(
            current_path=str(target),
            parent_path=None,
            entries=[],
            allowed_roots=roots_for_response,
            path_error=f"Path {target} does not exist. Ensure ALLOWED_IMPORT_PATHS ({', '.join(allowed_str)}) is mounted in your Docker/container setup.",
        )
    if not target.is_dir():
        return StorageBrowseResponse(
            current_path=str(target),
            parent_path=None,
            entries=[],
            allowed_roots=roots_for_response,
            path_error=f"Path {target} exists but is not a directory.",
        )

    # Parent path: one level up if we're not at a root
    parent_path: Optional[str] = None
    for root in allowed_roots:
        try:
            if target != root and target.is_relative_to(root):
                parent_path = str(target.parent)
                if not _is_allowed_path(target.parent, allowed_roots):
                    parent_path = str(root)
                break
        except ValueError:
            pass

    # Build extensions set for importable count
    exts = importable_extensions()
    exts_lower = {e.lower() for e in exts}

    entries: List[StorageBrowseEntry] = []
    for item in sorted(target.iterdir()):
        try:
            entry_path = item.resolve()
            if not _is_allowed_path(entry_path, allowed_roots):
                continue  # Skip symlinks/mounts outside allowed roots
            if item.name.startswith("."):
                continue

            if item.is_dir():
                file_count = 0
                importable_count = 0
                size_bytes = 0
                counts_capped = False
                if include_counts:
                    max_files = getattr(
                        settings, "STORAGE_BROWSE_MAX_COUNT_FILES", 2000
                    ) or 0
                    try:
                        with os.scandir(item) as it:
                            for entry in it:
                                if entry.is_file(follow_symlinks=False):
                                    file_count += 1
                                    if max_files and file_count >= max_files:
                                        counts_capped = True
                                        break
                                    suf = (Path(entry.name).suffix or "").lower()
                                    if suf in exts_lower:
                                        importable_count += 1
                                    try:
                                        size_bytes += entry.stat(
                                            follow_symlinks=False
                                        ).st_size
                                    except OSError:
                                        pass
                    except OSError:
                        pass
                    if counts_capped:
                        file_count = max_files
                entries.append(
                    StorageBrowseEntry(
                        name=item.name,
                        path=str(entry_path),
                        is_directory=True,
                        file_count=file_count,
                        importable_count=importable_count,
                        size_bytes=size_bytes,
                        counts_capped=counts_capped,
                    )
                )
            else:
                suf = (item.suffix or "").lower()
                importable = suf in exts_lower
                try:
                    size_bytes = item.stat().st_size
                except OSError:
                    size_bytes = 0
                entries.append(
                    StorageBrowseEntry(
                        name=item.name,
                        path=str(entry_path),
                        is_directory=False,
                        file_count=1,
                        importable_count=1 if importable else 0,
                        size_bytes=size_bytes,
                    )
                )
        except (OSError, PermissionError) as e:
            logger.debug(f"Skipping {item}: {e}")
            continue

    return StorageBrowseResponse(
        current_path=str(target),
        parent_path=parent_path,
        entries=entries,
        allowed_roots=roots_for_response,
    )
