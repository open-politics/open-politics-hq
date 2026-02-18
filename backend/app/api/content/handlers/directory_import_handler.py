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
"""

import logging
import mimetypes
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

from sqlmodel import Session, select

from app.models import Asset, AssetKind, Bundle, ProcessingStatus
from app.schemas import BundleCreate
from app.api.content.types import (
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

    def _compute_blob_path_reference(self, file_path: Path, source_path: str) -> str:
        """Compute blob_path for reference mode (relative to storage_base_path)."""
        try:
            rel = file_path.relative_to(self.storage_base_path)
            return str(rel).replace("\\", "/")
        except ValueError:
            try:
                rel = file_path.relative_to(Path(source_path).resolve())
                dataset_name = _get_dataset_name_from_path(source_path)
                return f"{dataset_name}/{rel}".replace("\\", "/")
            except ValueError:
                dataset_name = _get_dataset_name_from_path(source_path)
                return f"{dataset_name}/{file_path.name}"

    async def handle(
        self,
        source_path: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Walk source_path and create Assets with blob_path.

        Reference mode: blob_path relative to storage_base_path, no file I/O.
        Copy mode: read files, upload to managed storage, blob_path in managed/imports/.

        Returns list of created assets per BaseHandler contract.
        """
        options = options or {}
        copy_mode = options.get("copy_mode", False)
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
            dataset_name = _get_dataset_name_from_path(source_path)
            root_bundle = self._get_or_create_root_bundle(dataset_name, source_path, options)
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

            asset = Asset(
                title=title,
                kind=kind,
                infospace_id=self.infospace_id,
                user_id=self.user_id,
                bundle_id=root_bundle.id,
                blob_path=blob_path,
                logical_path=logical_path,
                processing_status=ProcessingStatus.PENDING,
                source_metadata={
                    "ingestion_method": "directory_import",
                    "source_path": str(file_path),
                    "copy_mode": copy_mode,
                },
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

        return created_assets
