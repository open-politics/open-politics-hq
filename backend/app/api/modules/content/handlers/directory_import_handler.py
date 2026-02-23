"""
Directory Import Handler
========================

Unified handler for importing files from a local directory into assets.
Creates one root Bundle per dataset, Assets with full blob_path, no nested Bundles.

Supports two modes:
- Reference mode (copy_mode=False): No copying; blob_path points to source.
  Source must be under LOCAL_STORAGE_BASE_PATH (e.g. via volume mount).
- Copy mode (copy_mode=True): Reads files, uploads to managed storage via storage_provider.
  Required when source is outside LOCAL_STORAGE_BASE_PATH.

Reconcile mode (reconcile_mode=True): Compares file stat (size, mtime) for existing blob_paths,
detects additions, changes, deletions. For changed files, recomputes hash; if different,
creates new version via previous_asset_id, sets is_superseded=True on old. Deleted files
are added to bundle_metadata.excluded_blob_paths.
"""

import asyncio
import hashlib
import logging
import mimetypes
import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple

from sqlmodel import Session, select

from app.models import Asset, AssetKind, Bundle, ProcessingStatus
from app.schemas import BundleCreate
from app.api.modules.content.types import (
    detect_asset_kind_from_extension,
    importable_extensions,
)
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


def _is_allowed_path(source_path: str, allowed_paths: List[str]) -> bool:
    """Check if source_path is under one of the allowed paths."""
    try:
        resolved = Path(source_path).resolve()
        for allowed in allowed_paths:
            if allowed:
                allowed_resolved = Path(allowed.strip()).resolve()
                try:
                    resolved.relative_to(allowed_resolved)
                    return True
                except ValueError:
                    pass
    except (OSError, RuntimeError):
        pass
    return False


def _get_dataset_name_from_path(source_path: str, storage_base_path: str) -> str:
    """Extract dataset folder name from path (e.g. data_set_1 from /data/storage/datasets/data_set_1)."""
    try:
        src = Path(source_path).resolve()
        base = Path(storage_base_path).resolve()
        rel = src.relative_to(base)
        parts = rel.parts
        return parts[0] if parts else Path(source_path).name
    except (ValueError, IndexError):
        return Path(source_path).name


class DirectoryImportHandler(BaseHandler):
    """
    Import files from a local directory into assets.
    One root Bundle per dataset; Assets with full blob_path; no nested Bundles.
    Supports reference and copy modes.
    """

    def __init__(self, context: IngestionContext):
        super().__init__(context)
        settings = context.settings
        self.storage_base_path = Path(settings.LOCAL_STORAGE_BASE_PATH).resolve()
        allowed = context.options.get("allowed_import_paths")
        if allowed is not None:
            self.allowed_import_paths = [Path(p.strip()).resolve() for p in allowed if p]
        else:
            allowed_str = settings.ALLOWED_IMPORT_PATHS or ""
            self.allowed_import_paths = [Path(p.strip()).resolve() for p in allowed_str.split(",") if p.strip()]
        self.storage_provider = context.storage_provider

    def _get_or_create_root_bundle(
        self, dataset_name: str, source_path: str, options: Dict[str, Any]
    ) -> Bundle:
        """Get or create root Bundle for dataset."""
        stmt = select(Bundle).where(
            Bundle.infospace_id == self.infospace_id,
            Bundle.parent_bundle_id.is_(None),
            Bundle.name == dataset_name,
        )
        existing = self.session.exec(stmt).first()
        if existing:
            return existing

        bundle_data = BundleCreate(
            name=dataset_name,
            description=f"Dataset: {dataset_name}",
            parent_bundle_id=None,
            bundle_metadata={},
        )
        bundle = self.bundle_service.create_bundle(
            bundle_in=bundle_data,
            infospace_id=self.infospace_id,
            user_id=self.user_id,
        )
        return bundle

    def _existing_blob_paths(self, bundle_id: int) -> Set[str]:
        """Get set of existing blob_paths for idempotency."""
        stmt = select(Asset.blob_path).where(
            Asset.bundle_id == bundle_id,
            Asset.infospace_id == self.infospace_id,
            Asset.blob_path.is_not(None),
        )
        return {r for r in self.session.exec(stmt).all() if r}

    def _load_existing_for_reconcile(self, bundle_id: int) -> Dict[str, Asset]:
        """
        Load top-level assets with blob_path for reconcile.
        Returns {blob_path: asset} for non-superseded assets only.
        """
        stmt = (
            select(Asset)
            .where(
                Asset.bundle_id == bundle_id,
                Asset.infospace_id == self.infospace_id,
                Asset.blob_path.isnot(None),
                Asset.parent_asset_id.is_(None),
            )
        )
        # Filter out superseded; prefer latest per blob_path if duplicates
        assets = self.session.exec(stmt).all()
        result: Dict[str, Asset] = {}
        for a in assets:
            if a.is_superseded:
                continue
            if a.blob_path and a.blob_path not in result:
                result[a.blob_path] = a
        return result

    async def _compute_file_hash(self, blob_path: str, file_path: Optional[Path] = None) -> str:
        """Compute SHA-256 of file. Uses file_path if provided (local), else storage.get_file."""
        if file_path is not None and file_path.exists():
            h = hashlib.sha256()
            with open(file_path, "rb") as f:
                for chunk in iter(lambda: f.read(65536), b""):
                    h.update(chunk)
            return h.hexdigest()
        if self.storage_provider and hasattr(self.storage_provider, "get_file_path"):
            try:
                local_path = self.storage_provider.get_file_path(blob_path)
                if local_path and local_path.exists():
                    h = hashlib.sha256()
                    with open(local_path, "rb") as f:
                        for chunk in iter(lambda: f.read(65536), b""):
                            h.update(chunk)
                    return h.hexdigest()
            except Exception:
                pass
        if self.storage_provider:
            try:
                fh = await self.storage_provider.get_file(blob_path)
                h = hashlib.sha256()
                try:
                    read_fn = getattr(fh, "read", None)
                    if read_fn:
                        while True:
                            chunk = read_fn(65536)
                            if asyncio.iscoroutine(chunk):
                                chunk = await chunk
                            if not chunk:
                                break
                            h.update(chunk)
                finally:
                    if hasattr(fh, "close"):
                        close_fn = fh.close
                        if asyncio.iscoroutinefunction(close_fn):
                            await close_fn()
                        else:
                            close_fn()
                return h.hexdigest()
            except Exception:
                pass
        return ""

    def _archive_old_content(self, asset: Asset) -> Optional[str]:
        """
        Copy old asset content to a content-addressed archive before superseding.
        Returns the archive blob_path, or None if archiving was not possible.

        Archive layout: ``.archive/{hash[:2]}/{hash}``
        """
        if not asset.content_hash:
            logger.warning(
                "Cannot archive asset %d: content_hash is NULL", asset.id,
            )
            return None

        archive_path = f".archive/{asset.content_hash[:2]}/{asset.content_hash}"

        if not self.storage_provider:
            return None

        # If archive entry already exists (another asset with same hash), skip copy
        if hasattr(self.storage_provider, "file_stat"):
            try:
                stat = self.storage_provider.file_stat(archive_path)
                if stat:
                    return archive_path
            except Exception:
                pass

        # Copy from the old blob_path to the archive
        if not asset.blob_path:
            return None

        try:
            if hasattr(self.storage_provider, "get_file_path"):
                src = self.storage_provider.get_file_path(asset.blob_path)
                if src and src.exists():
                    content = src.read_bytes()
                    import asyncio
                    loop = asyncio.get_event_loop()
                    if loop.is_running():
                        import concurrent.futures
                        with concurrent.futures.ThreadPoolExecutor() as pool:
                            pool.submit(
                                lambda: self.storage_provider.upload_from_bytes(
                                    content, archive_path,
                                    filename=asset.content_hash,
                                    content_type="application/octet-stream",
                                )
                            ).result()
                    else:
                        self.storage_provider.upload_from_bytes(
                            content, archive_path,
                            filename=asset.content_hash,
                            content_type="application/octet-stream",
                        )
                    logger.info(
                        "Archived asset %d (%s) to %s",
                        asset.id, asset.blob_path, archive_path,
                    )
                    return archive_path
        except Exception as exc:
            logger.warning(
                "Failed to archive asset %d: %s", asset.id, exc,
            )

        return None

    def _update_excluded_blob_paths(self, bundle: Bundle, to_exclude: List[str]) -> None:
        """Add blob_paths to bundle_metadata.excluded_blob_paths."""
        meta = bundle.bundle_metadata or {}
        excluded: List[str] = list(meta.get("excluded_blob_paths") or [])
        for p in to_exclude:
            if p and p not in excluded:
                excluded.append(p)
        meta["excluded_blob_paths"] = excluded
        bundle.bundle_metadata = meta

    async def _handle_reconcile(
        self,
        source_path: str,
        source: Path,
        dataset_name: str,
        root_bundle: Bundle,
        copy_mode: bool,
        file_extensions: Set[str],
        batch_size: int,
    ) -> List[Asset]:
        """
        Reconcile re-import: compare stat (file_size, mtime) for existing blob_paths,
        detect additions, changes, deletions. Version changed files via previous_asset_id.
        """
        existing_by_blob = self._load_existing_for_reconcile(root_bundle.id)
        initial_blob_paths = set(existing_by_blob.keys())
        seen_on_disk: Set[str] = set()
        created_assets: List[Asset] = []
        errors: List[str] = []
        to_exclude: List[str] = []

        for file_path in source.rglob("*"):
            if not file_path.is_file():
                continue
            ext = file_path.suffix.lower()
            if ext not in file_extensions:
                continue

            rel_path = file_path.relative_to(source)
            logical_path = str(rel_path).replace("\\", "/")

            if copy_mode:
                blob_path = f"managed/imports/{dataset_name}/{logical_path}"
            else:
                blob_path = self._compute_blob_path_reference(file_path, source_path)

            seen_on_disk.add(blob_path)

            try:
                file_stat = file_path.stat()
                file_size = file_stat.st_size
                file_mtime = file_stat.st_mtime
            except OSError:
                file_size = file_mtime = None

            file_meta = {}
            if file_size is not None and file_mtime is not None:
                file_meta = {"file_size": file_size, "file_mtime": file_mtime}

            existing = existing_by_blob.get(blob_path)

            if existing is None:
                # New file
                kind = detect_asset_kind_from_extension(ext)
                title = file_path.name
                source_metadata = {
                    "ingestion_method": "directory_import",
                    "source_path": str(file_path),
                    "copy_mode": copy_mode,
                }
                if file_meta:
                    source_metadata["file"] = file_meta

                if copy_mode and self.storage_provider:
                    try:
                        content = file_path.read_bytes()
                        await self.storage_provider.upload_from_bytes(
                            content,
                            blob_path,
                            filename=file_path.name,
                            content_type=mimetypes.guess_type(file_path.name)[0],
                        )
                    except Exception as e:
                        errors.append(f"Failed to upload {file_path}: {e}")
                        continue

                asset = Asset(
                    title=title,
                    kind=kind,
                    infospace_id=self.infospace_id,
                    user_id=self.user_id,
                    bundle_id=root_bundle.id,
                    blob_path=blob_path,
                    logical_path=logical_path,
                    processing_status=ProcessingStatus.PENDING,
                    source_metadata=source_metadata,
                )
                self.session.add(asset)
                created_assets.append(asset)
                existing_by_blob[blob_path] = asset
                continue

            # Existing file - check for change
            stored = (existing.source_metadata or {}).get("file") or {}
            stored_size = stored.get("file_size")
            stored_mtime = stored.get("file_mtime")

            if file_size is not None and file_mtime is not None and stored_size == file_size and stored_mtime == file_mtime:
                continue  # Unchanged

            # Stat differs - verify with hash; always use file_path (source on disk) for current content
            current_hash = await self._compute_file_hash(blob_path, file_path)

            existing_hash = existing.content_hash
            if current_hash and existing_hash and current_hash == existing_hash:
                # Hash matches - likely mtime-only change, update stored stat
                meta = dict(existing.source_metadata or {})
                meta["file"] = file_meta
                existing.source_metadata = meta
                self.session.add(existing)
                continue

            # Content changed or no hash yet - create new version
            kind = detect_asset_kind_from_extension(ext)
            title = file_path.name
            source_metadata = {
                "ingestion_method": "directory_import",
                "source_path": str(file_path),
                "copy_mode": copy_mode,
                "reconcile_version_of": str(existing.id),
            }
            if file_meta:
                source_metadata["file"] = file_meta

            if copy_mode and self.storage_provider:
                try:
                    content = file_path.read_bytes()
                    await self.storage_provider.upload_from_bytes(
                        content,
                        blob_path,
                        filename=file_path.name,
                        content_type=mimetypes.guess_type(file_path.name)[0],
                    )
                except Exception as e:
                    errors.append(f"Failed to upload {file_path}: {e}")
                    continue

            # Archive old content before superseding (preserves provenance)
            archive_path = self._archive_old_content(existing)
            if archive_path:
                existing.blob_path = archive_path

            existing.is_superseded = True
            self.session.add(existing)

            new_asset = Asset(
                title=title,
                kind=kind,
                infospace_id=self.infospace_id,
                user_id=self.user_id,
                bundle_id=root_bundle.id,
                blob_path=blob_path,
                logical_path=logical_path,
                processing_status=ProcessingStatus.PENDING,
                source_metadata=source_metadata,
                previous_asset_id=existing.id,
            )
            self.session.add(new_asset)
            created_assets.append(new_asset)
            existing_by_blob[blob_path] = new_asset

        # Deleted files: existed before but not seen on disk
        excluded = list(initial_blob_paths - seen_on_disk)
        if excluded:
            self._update_excluded_blob_paths(root_bundle, excluded)
            self.session.add(root_bundle)

        if created_assets or excluded:
            self.session.commit()

        # Update bundle asset count
        from sqlalchemy import func
        count_stmt = select(func.count(Asset.id)).where(Asset.bundle_id == root_bundle.id)
        new_count = self.session.exec(count_stmt).one() or 0
        root_bundle.asset_count = new_count
        self.session.add(root_bundle)
        self.session.commit()

        if errors:
            logger.warning(f"Reconcile import had {len(errors)} errors: {errors[:5]}{'...' if len(errors) > 5 else ''}")

        return created_assets, root_bundle.id

    def _compute_blob_path_reference(self, file_path: Path, source_path: str) -> str:
        """Compute blob_path for reference mode (relative to storage_base_path)."""
        try:
            rel = file_path.relative_to(self.storage_base_path)
            return str(rel).replace("\\", "/")
        except ValueError:
            try:
                rel = file_path.relative_to(Path(source_path).resolve())
                dataset_name = _get_dataset_name_from_path(source_path, str(self.storage_base_path))
                return f"{dataset_name}/{rel}".replace("\\", "/")
            except ValueError:
                dataset_name = _get_dataset_name_from_path(source_path, str(self.storage_base_path))
                return f"{dataset_name}/{file_path.name}"

    async def handle(
        self,
        source_path: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> Tuple[List[Asset], int]:
        """
        Walk source_path and create Assets with blob_path.

        Reference mode: blob_path relative to storage_base_path, no file I/O.
        Copy mode: read files, upload to managed storage, blob_path in managed/imports/.

        Returns (created_assets, root_bundle_id) for task tracking.
        """
        options = options or {}
        copy_mode = options.get("copy_mode", False)
        reconcile_mode = options.get("reconcile_mode", False)
        exts = options.get("file_extensions")
        file_extensions = (
            {e.lower() if e.startswith(".") else f".{e}".lower() for e in exts}
            if exts
            else importable_extensions()
        )
        batch_size = options.get("batch_size", 500)

        if not _is_allowed_path(source_path, [str(p) for p in self.allowed_import_paths]):
            raise ValueError(f"Source path '{source_path}' is not under allowed import paths")

        if copy_mode and not self.storage_provider:
            raise ValueError("storage_provider is required for copy_mode")

        source = Path(source_path)
        if not source.exists() or not source.is_dir():
            raise ValueError(f"Source path '{source_path}' does not exist or is not a directory")

        root_bundle_id = options.get("root_bundle_id")
        if root_bundle_id:
            root_bundle = self.session.get(Bundle, root_bundle_id)
            if not root_bundle:
                raise ValueError(f"Root bundle {root_bundle_id} not found")
            dataset_name = root_bundle.name
        else:
            dataset_name = _get_dataset_name_from_path(source_path, str(self.storage_base_path))
            root_bundle = self._get_or_create_root_bundle(dataset_name, source_path, options)

        if reconcile_mode:
            return await self._handle_reconcile(
                source_path=source_path,
                source=source,
                dataset_name=dataset_name,
                root_bundle=root_bundle,
                copy_mode=copy_mode,
                file_extensions=file_extensions,
                batch_size=batch_size,
            )

        existing_paths = self._existing_blob_paths(root_bundle.id)

        assets_skipped = 0
        errors: List[str] = []
        batch: List[Asset] = []
        created_assets: List[Asset] = []

        for file_path in source.rglob("*"):
            if not file_path.is_file():
                continue

            ext = file_path.suffix.lower()
            if ext not in file_extensions:
                continue

            rel_path = file_path.relative_to(source)
            logical_path = str(rel_path).replace("\\", "/")

            if copy_mode:
                blob_path = f"managed/imports/{dataset_name}/{logical_path}"
            else:
                blob_path = self._compute_blob_path_reference(file_path, source_path)

            if blob_path in existing_paths:
                assets_skipped += 1
                continue

            # Capture file stat at import time for change detection
            try:
                file_stat = file_path.stat()
                file_meta = {"file_size": file_stat.st_size, "file_mtime": file_stat.st_mtime}
            except OSError:
                file_meta = {}

            kind = detect_asset_kind_from_extension(ext)
            title = file_path.name

            if copy_mode:
                try:
                    content = file_path.read_bytes()
                    await self.storage_provider.upload_from_bytes(
                        content,
                        blob_path,
                        filename=file_path.name,
                        content_type=mimetypes.guess_type(file_path.name)[0],
                    )
                except Exception as e:
                    errors.append(f"Failed to upload {file_path}: {e}")
                    continue

            source_metadata = {
                "ingestion_method": "directory_import",
                "source_path": str(file_path),
                "copy_mode": copy_mode,
            }
            if file_meta:
                source_metadata["file"] = file_meta

            asset = Asset(
                title=title,
                kind=kind,
                infospace_id=self.infospace_id,
                user_id=self.user_id,
                bundle_id=root_bundle.id,
                blob_path=blob_path,
                logical_path=logical_path,
                processing_status=ProcessingStatus.PENDING,
                source_metadata=source_metadata,
            )
            batch.append(asset)
            existing_paths.add(blob_path)

            if len(batch) >= batch_size:
                self.session.add_all(batch)
                self.session.commit()
                created_assets.extend(batch)
                batch = []
                logger.info(f"Directory import: committed batch of {batch_size} assets")

        if batch:
            self.session.add_all(batch)
            self.session.commit()
            created_assets.extend(batch)

        # Update root bundle asset count
        from sqlalchemy import func
        count_stmt = select(func.count(Asset.id)).where(Asset.bundle_id == root_bundle.id)
        new_count = self.session.exec(count_stmt).one() or 0
        root_bundle.asset_count = new_count
        self.session.add(root_bundle)
        self.session.commit()

        if errors:
            logger.warning(f"Directory import had {len(errors)} errors: {errors[:5]}{'...' if len(errors) > 5 else ''}")

        return created_assets, root_bundle.id
