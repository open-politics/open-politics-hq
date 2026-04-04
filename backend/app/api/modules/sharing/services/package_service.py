"""
Package handling for universal data transfer.

This module defines the package format and provides utilities for
creating and processing data packages.
"""
import logging
import json
import zipfile
import tempfile
import os
from typing import Dict, Any, Optional, List, Tuple, Union
from datetime import datetime, timezone, date
import uuid
from pathlib import Path
from sqlalchemy import select, text
from sqlmodel import Session
from fastapi import UploadFile
import asyncio
from collections import defaultdict
from werkzeug.utils import secure_filename
import dateutil.parser

from app.models import (
    Source, AnnotationSchema, AnnotationRun, Dataset, ResourceType, 
    Annotation, Asset, Bundle, Infospace, User, AssetKind, SourceStatus, 
    AnnotationSchemaTargetLevel, RunStatus, ResultStatus, Justification, Source
)
from app.api.modules.foundation_service_providers.base import StorageProvider
from app.core.config import AppSettings
from app.schemas import AssetRead, SourceRead, InfospaceCreate, InfospaceRead

from app.api.modules.content.services.asset_service import AssetService
from app.api.modules.annotation.services.annotation_service import AnnotationService
from app.api.modules.content.services.bundle_service import BundleService
from app.api.modules.content.services.dataset_service import DatasetService

logger = logging.getLogger(__name__)


def _extract_facets_from_asset_data(asset_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract facets from asset data (supports old source_metadata format)."""
    if "facets" in asset_data:
        return asset_data["facets"]
    sm = asset_data.get("source_metadata") or {}
    facets = sm.get("facets")
    return facets if facets else None


def _extract_file_info_from_asset_data(asset_data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Extract file_info from asset data (supports old source_metadata format)."""
    if "file_info" in asset_data:
        return asset_data["file_info"]
    sm = asset_data.get("source_metadata") or {}
    file_info = {k: v for k, v in sm.items() if k != "facets"}
    if "file" in sm and isinstance(sm["file"], dict):
        file_info.update(sm["file"])
    return file_info if file_info else None


class PackageMetadata:
    """Metadata for a data package."""
    def __init__(
        self,
        package_type: ResourceType,
        source_entity_uuid: Optional[str] = None,
        source_entity_id: Optional[Union[int, str]] = None,
        source_entity_name: Optional[str] = None,
        source_instance_id: Optional[str] = None,
        format_version: str = "1.0",
        created_at: Optional[datetime] = None,
        created_by: Optional[str] = None,
        description: Optional[str] = None,
    ):
        self.package_type = package_type
        self.source_entity_uuid = source_entity_uuid or str(uuid.uuid4())
        self.source_entity_id = source_entity_id
        self.source_entity_name = source_entity_name
        self.source_instance_id = source_instance_id or "unknown_instance"
        self.format_version = format_version
        self.created_at = created_at or datetime.now(timezone.utc)
        self.created_by = created_by
        self.description = description
        self.package_uuid = str(uuid.uuid4())

    def to_dict(self) -> Dict[str, Any]:
        """Convert metadata to dictionary."""
        return {
            "package_uuid": self.package_uuid,
            "package_type": self.package_type.value,
            "format_version": self.format_version,
            "created_at": self.created_at.isoformat(),
            "created_by": self.created_by,
            "description": self.description,
            "source_instance_id": self.source_instance_id,
            "source_entity_uuid": self.source_entity_uuid,
            "source_entity_id": self.source_entity_id,
            "source_entity_name": self.source_entity_name,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "PackageMetadata":
        """Create metadata from dictionary."""
        # Safely parse created_at field
        created_at_raw = data.get("created_at")
        created_at = None
        if created_at_raw:
            if isinstance(created_at_raw, str):
                try:
                    created_at = dateutil.parser.isoparse(created_at_raw)
                except (ValueError, TypeError):
                    logger.warning(f"Could not parse created_at string '{created_at_raw}' in PackageMetadata")
                    created_at = datetime.now(timezone.utc)
            elif isinstance(created_at_raw, datetime):
                created_at = created_at_raw
            else:
                logger.warning(f"Unexpected type for created_at: {type(created_at_raw)}")
                created_at = datetime.now(timezone.utc)
        else:
            created_at = datetime.now(timezone.utc)

        return cls(
            package_type=ResourceType(data["package_type"]),
            source_entity_uuid=data.get("source_entity_uuid"),
            source_entity_id=data.get("source_entity_id"),
            source_entity_name=data.get("source_entity_name"),
            source_instance_id=data.get("source_instance_id"),
            format_version=data.get("format_version", "1.0"),
            created_at=created_at,
            created_by=data.get("created_by"),
            description=data.get("description")
        )

class DataPackage:
    """
    Represents a self-contained data package for transfer.
    
    The package consists of:
    - manifest.json: Contains metadata and entity definitions
    - files/: Directory containing associated files (PDFs, CSVs, etc.)
    """
    def __init__(
        self,
        metadata: PackageMetadata,
        content: Dict[str, Any],
        files: Optional[Dict[str, bytes]] = None
    ):
        self.metadata = metadata
        self.content = content
        self.files = files or {}

    def to_zip(self, output_path: str) -> None:
        """Serializes the package to a ZIP file."""
        temp_files_dir = None
        try:
            if self.files:
                temp_files_dir = tempfile.mkdtemp(prefix="pkg_zip_files_")
            
            with zipfile.ZipFile(output_path, 'w', zipfile.ZIP_DEFLATED) as zf:
                manifest_content = {
                    "metadata": self.metadata.to_dict(),
                    "content": self.content,
                }
                
                def default_serializer(o):
                    if isinstance(o, (datetime, date)):
                        return o.isoformat()
                    if hasattr(o, 'hex'): 
                        return str(o)
                    logger.debug(f"Attempting to stringify unknown type in manifest: {type(o)}")
                    return str(o) 

                try:
                    manifest_str = json.dumps(manifest_content, indent=2, default=default_serializer)
                    if not manifest_str: raise ValueError("Generated manifest string is empty.")
                    zf.writestr("manifest.json", manifest_str)
                except TypeError as e:
                    logger.error(f"MANIFEST_SERIALIZATION_ERROR for zip {output_path}: {e}", exc_info=True)
                    raise

                if self.files and temp_files_dir:
                    _ALLOWED_PREFIXES = ("files/", "assets/", "analysis_results/", "schemas/", "provenance/")
                    _ALLOWED_ROOT = ("explore.py",)
                    for zip_internal_path, content_bytes in self.files.items():
                        if (
                            not any(zip_internal_path.startswith(p) for p in _ALLOWED_PREFIXES)
                            and zip_internal_path not in _ALLOWED_ROOT
                        ):
                            logger.warning(f"Skipping file with unexpected path for zip: {zip_internal_path}")
                            continue

                        # Use a unique temp name to avoid collisions across directories
                        safe_name = zip_internal_path.replace("/", "__")
                        temp_file_local_path = Path(temp_files_dir) / safe_name

                        with open(temp_file_local_path, 'wb') as f_temp:
                            f_temp.write(content_bytes)

                        zf.write(temp_file_local_path, arcname=zip_internal_path)
                        logger.debug(f"Added file to zip as {zip_internal_path}")
            
            logger.info(f"Successfully created package zip: {output_path}")

        except Exception as e:
            logger.error(f"Failed to create package zip {output_path}: {e}", exc_info=True)
            if os.path.exists(output_path):
                try: os.remove(output_path)
                except OSError as oe: logger.error(f"Error cleaning up partial zip {output_path}: {oe}")
            raise
        finally:
            if temp_files_dir and os.path.exists(temp_files_dir):
                import shutil
                try: shutil.rmtree(temp_files_dir)
                except OSError as oe: logger.error(f"Error cleaning up temp files directory {temp_files_dir}: {oe}")

    @classmethod
    def from_zip(cls, zip_path: str) -> "DataPackage":
        """Create package from a ZIP file."""
        with zipfile.ZipFile(zip_path, 'r') as zf:
            all_files = zf.namelist()
            
            # Check if archive contains a single root directory
            prefix = ""
            if all_files:
                top_level_entries = {p.split('/')[0] for p in all_files if p}
                if len(top_level_entries) == 1:
                    root_dir = list(top_level_entries)[0]
                    # Check if all non-empty file paths start with this single root directory.
                    if all(p.startswith(root_dir + '/') for p in all_files if p and not p.endswith('/')):
                        prefix = root_dir + '/'

            manifest_path = prefix + "manifest.json"
            
            try:
                manifest_data = json.loads(zf.read(manifest_path))
            except KeyError:
                raise KeyError("There is no item named 'manifest.json' in the archive's root or single-folder root.")

            metadata = PackageMetadata.from_dict(manifest_data["metadata"])
            content = manifest_data["content"]
            files = {}
            files_dir_path = prefix + "files/"

            for member_info in zf.infolist():
                if not member_info.is_dir() and member_info.filename.startswith(files_dir_path):
                    # Make path relative to the prefix, should be "files/..."
                    relative_path = member_info.filename[len(prefix):]
                    files[relative_path] = zf.read(member_info.filename)
            
            return cls(metadata, content, files)

    @classmethod
    async def from_upload(cls, file: UploadFile) -> "DataPackage":
        """Create package from an uploaded file."""
        suffix = Path(file.filename).suffix if file.filename else '.tmp'
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as temp_file:
            content_bytes = await file.read()
            temp_file.write(content_bytes)
            temp_path = temp_file.name
        
        package = None
        try:
            package = cls.from_zip(temp_path)
        except Exception as e_zip:
            logger.error(f"Failed to create DataPackage from uploaded zip file {file.filename}: {e_zip}", exc_info=True)
            raise ValueError(f"Uploaded file {file.filename} is not a valid package zip: {e_zip}") from e_zip
        finally:
            if os.path.exists(temp_path):
                try:
                    os.unlink(temp_path)
                except Exception as e_unlink:
                    logger.error(f"Error deleting temporary upload file {temp_path}: {e_unlink}")
        return package

class PackageBuilder:
    """
    Helper class for building data packages.
    """
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        source_instance_id: Optional[str] = None,
        settings: Optional[AppSettings] = None
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.source_instance_id = source_instance_id or (settings.INSTANCE_ID if settings and hasattr(settings, 'INSTANCE_ID') else "unknown_builder_instance")
        self.files: Dict[str, bytes] = {}
        self.settings = settings

    async def _fetch_file_content_from_storage(self, storage_path: str) -> Optional[bytes]:
        """Fetch file content from storage provider if path is valid."""
        if not storage_path or not self.storage_provider:
            return None
        try:
            file_obj = await self.storage_provider.get_file(storage_path)
            # Ensure read is in thread for sync file obj if provider returns one
            content = await asyncio.to_thread(file_obj.read) 
            if hasattr(file_obj, 'close') and callable(getattr(file_obj, 'close')):
                await asyncio.to_thread(file_obj.close)
            return content
        except Exception as e:
            logger.error(f"Failed to fetch file '{storage_path}' from storage: {e}", exc_info=True)
            return None

    def _add_file_to_package(self, original_filename: str, content_bytes: bytes) -> str:
        """Adds file content to self.files and returns the path used in the zip."""
        safe_filename = secure_filename(original_filename)
        if not safe_filename:
            safe_filename = f"unnamed_file_{uuid.uuid4().hex[:8]}"

        zip_path = f"files/{safe_filename}"
        
        if zip_path in self.files:
            stem = Path(safe_filename).stem
            suffix = Path(safe_filename).suffix
            counter = 1
            while True:
                if not stem:
                    stem = f"unnamed_file_{uuid.uuid4().hex[:8]}"
                new_filename = f"{stem}_{counter}{suffix}"
                new_zip_path = f"files/{new_filename}"
                if new_zip_path not in self.files:
                    zip_path = new_zip_path
                    break
                counter += 1
        
        self.files[zip_path] = content_bytes
        return zip_path
    
    async def _export_asset_chunks(
        self,
        asset: Asset,
        include_embeddings: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Export chunks (and optionally embeddings) for an asset.
        
        Args:
            asset: The asset whose chunks to export
            include_embeddings: Whether to include vector embeddings
            
        Returns:
            List of chunk dictionaries with text content and optional embeddings
        """
        from app.models import AssetChunk
        
        chunks_data = []
        
        # Get all chunks for this asset
        chunks = self.session.exec(
            select(AssetChunk)
            .where(AssetChunk.asset_id == asset.id)
            .order_by(AssetChunk.chunk_index)
        ).all()
        
        for chunk in chunks:
            chunk_dict = {
                "chunk_index": chunk.chunk_index,
                "text_content": chunk.text_content,
                "blob_reference": chunk.blob_reference,
                "chunk_metadata": chunk.chunk_metadata,
            }
            
            # Include embeddings if requested and available
            if include_embeddings:
                from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

                emb_val = None
                for dim in EMBEDDING_SUPPORTED_DIMS:
                    col = getattr(chunk, f"embedding_{dim}", None)
                    if col is not None:
                        emb_val = list(col) if not isinstance(col, list) else col
                        break
                if emb_val is not None:
                    chunk_dict["embedding"] = emb_val
                    chunk_dict["embedding_model_id"] = chunk.embedding_model_id
            
            chunks_data.append(chunk_dict)
        
        logger.debug(f"Exported {len(chunks_data)} chunks for asset {asset.id}, embeddings included: {include_embeddings}")
        return chunks_data

    async def build_asset_package(
        self, 
        asset: Asset, 
        include_text_content_as_file: bool = False,
        include_annotations: bool = False,
        include_justifications: bool = False
    ) -> DataPackage:
        logger.debug(f"Building package for Asset ID: {asset.id}, UUID: {asset.uuid}")
        asset_content = AssetRead.model_validate(asset).model_dump(exclude_none=True)
        file_reference_in_zip = None

        if asset.blob_path:
            file_bytes = await self._fetch_file_content_from_storage(asset.blob_path)
            if file_bytes:
                original_filename = (asset.file_info or {}).get("original_filename") or (asset.file_info or {}).get("filename") or asset.title or Path(asset.blob_path).name
                file_reference_in_zip = self._add_file_to_package(original_filename, file_bytes)
                asset_content["blob_file_reference"] = file_reference_in_zip
            else:
                asset_content["blob_path_fetch_failed"] = True
        
        if include_text_content_as_file and asset.text_content and len(asset.text_content) > 1024: 
            text_filename = f"{secure_filename(asset.title)}_content.txt"
            file_reference_in_zip = self._add_file_to_package(text_filename, asset.text_content.encode('utf-8'))
            asset_content["text_content_file_reference"] = file_reference_in_zip
            asset_content.pop("text_content", None) 

        if include_annotations:
            asset_content["annotations"] = []
            annotations = asset.annotations if hasattr(asset, 'annotations') and asset.annotations else self.session.exec(select(Annotation).where(Annotation.asset_id == asset.id)).all()
            for ann in annotations:
                ann_data = ann.model_dump(exclude_none=True, exclude={'justifications'}) 
                justifications_for_ann = ann.justifications if hasattr(ann, 'justifications') and ann.justifications else []
                if not justifications_for_ann and include_justifications: # Fetch if not loaded and requested
                    justifications_for_ann = self.session.exec(select(Justification).where(Justification.annotation_id == ann.id)).all()

                if include_justifications and justifications_for_ann:
                    ann_data["justifications"] = [j.model_dump(exclude_none=True) for j in justifications_for_ann]
                
                asset_content["annotations"].append(ann_data)
        
        package_metadata = PackageMetadata(
            package_type=ResourceType.ASSET,
            source_entity_uuid=str(asset.uuid),
            source_entity_id=asset.id,
            source_entity_name=asset.title,
            source_instance_id=self.source_instance_id,
            description=f"Asset: {asset.title or asset.uuid}"
        )
        return DataPackage(metadata=package_metadata, content={"asset": asset_content}, files=self.files)

    async def build_source_package(
        self,
        source: Source,
        include_assets: bool = True,
        include_chunks: bool = False,
        include_embeddings: bool = False
    ) -> DataPackage:
        logger.debug(f"Building package for Source ID: {source.id}, Name: {source.name}")
        # Using direct model_dump from the Source model for package content.
        # Exclude 'assets' relationship as we'll handle them separately if include_assets is True.
        source_content = source.model_dump(exclude_none=True, exclude={'assets'}) 

        # Handle the primary file associated with the Source itself, if applicable (e.g., the uploaded CSV/PDF)
        if isinstance(source.details, dict) and source.details.get("storage_path"):
            storage_path = source.details["storage_path"]
            file_bytes = await self._fetch_file_content_from_storage(storage_path)
            if file_bytes:
                filename = source.details.get("filename", Path(storage_path).name)
                file_ref = self._add_file_to_package(filename, file_bytes)
                source_content["main_file_reference"] = file_ref
            else:
                source_content["main_file_fetch_failed"] = True # Indicate failure to fetch the main source file

        if include_assets:
            source_content["assets"] = []
            BATCH_SIZE = 500
            offset = 0
            while True:
                batch = self.session.exec(
                    select(Asset)
                    .where(Asset.source_id == source.id)
                    .order_by(Asset.id)
                    .offset(offset)
                    .limit(BATCH_SIZE)
                ).all()
                if not batch:
                    break
                for asset_item in batch:
                    asset_data = AssetRead.model_validate(asset_item).model_dump(exclude_none=True)
                    asset_data.pop("text_content", None)
                    if asset_item.text_content and len(asset_item.text_content) < 5000:
                        asset_data["text_content"] = asset_item.text_content
                    elif asset_item.text_content:
                        text_file_ref = self._add_file_to_package(f"asset_{asset_item.uuid}_content.txt", asset_item.text_content.encode("utf-8"))
                        asset_data["text_content_file_reference"] = text_file_ref
                    if asset_item.blob_path:
                        asset_file_bytes = await self._fetch_file_content_from_storage(asset_item.blob_path)
                        if asset_file_bytes:
                            original_filename = (asset_item.file_info or {}).get("original_filename") or (asset_item.file_info or {}).get("filename") or asset_item.title or Path(asset_item.blob_path).name
                            asset_data["blob_file_reference"] = self._add_file_to_package(original_filename, asset_file_bytes)
                        else:
                            asset_data["blob_path_fetch_failed"] = True
                    if include_chunks or include_embeddings:
                        asset_data["chunks"] = await self._export_asset_chunks(asset_item, include_embeddings=include_embeddings)
                    source_content["assets"].append(asset_data)
                offset += BATCH_SIZE

        package_metadata = PackageMetadata(
            package_type=ResourceType.SOURCE,
            source_entity_uuid=str(source.uuid),
            source_entity_id=source.id,
            source_entity_name=source.name,
            source_instance_id=self.source_instance_id,
            description=f"Source: {source.name}"
        )
        return DataPackage(metadata=package_metadata, content={"source": source_content}, files=self.files)

    async def build_annotation_schema_package(
        self,
        schema: AnnotationSchema,
    ) -> DataPackage:
        logger.debug(f"Building package for AnnotationSchema ID: {schema.id}, Name: {schema.name}")
        schema_content = schema.model_dump(exclude_none=True)

        package_metadata = PackageMetadata(
            package_type=ResourceType.SCHEMA,
            source_entity_uuid=str(schema.uuid),
            source_entity_id=schema.id,
            source_entity_name=schema.name,
            source_instance_id=self.source_instance_id,
            description=f"AnnotationSchema: {schema.name} v{schema.version}"
        )
        return DataPackage(metadata=package_metadata, content={"annotation_schema": schema_content}, files=self.files)

    async def build_annotation_run_package(
        self,
        run: AnnotationRun,
        include_annotations: bool = True,
        include_justifications: bool = True,
        include_chunks: bool = False,
        include_embeddings: bool = False
    ) -> DataPackage:
        logger.debug(f"Building package for AnnotationRun ID: {run.id}, Name: {run.name}")
        run_content = run.model_dump(exclude_none=True, exclude={'annotations', 'target_schemas'})
        
        # Ensure views_config is included in the export
        if hasattr(run, 'views_config') and run.views_config:
            run_content['views_config'] = run.views_config

        # Include full schema definitions (not just references)
        run_content["annotation_schemas"] = []
        for schema in run.target_schemas:
            schema_data = schema.model_dump(exclude_none=True)
            run_content["annotation_schemas"].append(schema_data)

        # Collect all unique assets used in this run
        unique_assets = {}
        run_content["assets"] = []
        
        if include_annotations:
            run_content["annotations"] = []
            annotations = []
            BATCH_SIZE = 500
            ann_offset = 0
            while True:
                ann_batch = self.session.exec(
                    select(Annotation)
                    .where(Annotation.run_id == run.id)
                    .order_by(Annotation.id)
                    .offset(ann_offset)
                    .limit(BATCH_SIZE)
                ).all()
                if not ann_batch:
                    break
                annotations.extend(ann_batch)
                ann_offset += BATCH_SIZE

            # First pass: collect all unique assets
            for ann in annotations:
                asset = self.session.get(Asset, ann.asset_id)
                if asset and asset.id not in unique_assets:
                    unique_assets[asset.id] = asset
            
            # Second pass: collect parent assets for any child assets
            # This ensures parent-child relationships are preserved during export
            assets_to_check_for_parents = list(unique_assets.values())
            for asset in assets_to_check_for_parents:
                if asset.parent_asset_id:
                    parent_asset = self.session.get(Asset, asset.parent_asset_id)
                    if parent_asset and parent_asset.id not in unique_assets:
                        unique_assets[parent_asset.id] = parent_asset
                        logger.debug(f"Added parent asset '{parent_asset.title}' (ID {parent_asset.id}) to export package for child asset '{asset.title}' (ID {asset.id})")
            
            # Third pass: include full asset content for all unique assets
            for asset_id, asset in unique_assets.items():
                asset_data = AssetRead.model_validate(asset).model_dump(exclude_none=True, exclude={'text_content'})
                
                # Include parent-child relationship information
                if asset.parent_asset_id:
                    asset_data['parent_asset_id'] = asset.parent_asset_id
                    asset_data['part_index'] = asset.part_index
                    # Include parent UUID for reference resolution during import
                    parent_asset = self.session.get(Asset, asset.parent_asset_id)
                    if parent_asset:
                        asset_data['parent_asset_uuid'] = str(parent_asset.uuid)
                
                # Include text content inline if short, or as file if long
                if asset.text_content and len(asset.text_content) < 5000:
                    asset_data['text_content'] = asset.text_content
                elif asset.text_content:
                    text_file_ref = self._add_file_to_package(f"asset_{asset.uuid}_content.txt", asset.text_content.encode('utf-8'))
                    asset_data['text_content_file_reference'] = text_file_ref
                
                # Include blob content as file if available
                if asset.blob_path:
                    file_bytes = await self._fetch_file_content_from_storage(asset.blob_path)
                    if file_bytes:
                        original_filename = (asset.file_info or {}).get("original_filename") or (asset.file_info or {}).get("filename") or asset.title or Path(asset.blob_path).name
                        blob_file_ref = self._add_file_to_package(original_filename, file_bytes)
                        asset_data["blob_file_reference"] = blob_file_ref
                
                # Handle chunks and embeddings if requested
                if include_chunks or include_embeddings:
                    asset_data["chunks"] = await self._export_asset_chunks(
                        asset, 
                        include_embeddings=include_embeddings
                    )
                
                run_content["assets"].append(asset_data)
            
            # Fourth pass: build annotations with proper references
            for ann in annotations:
                ann_data = ann.model_dump(exclude_none=True, exclude={'justifications'})
                justifications_for_ann = ann.justifications if hasattr(ann, 'justifications') else []
                if include_justifications and justifications_for_ann:
                    ann_data["justifications"] = [j.model_dump(exclude_none=True) for j in justifications_for_ann]
                
                # Include asset reference
                asset = self.session.get(Asset, ann.asset_id)
                if asset:
                    ann_data["asset_reference"] = {"uuid": str(asset.uuid), "id": asset.id, "title": asset.title}
                
                # Include schema reference
                schema = self.session.get(AnnotationSchema, ann.schema_id)
                if schema:
                    ann_data["schema_reference"] = {"uuid": str(schema.uuid), "id": schema.id, "name": schema.name, "version": schema.version}
                
                run_content["annotations"].append(ann_data)
        
        package_metadata = PackageMetadata(
            package_type=ResourceType.RUN,
            source_entity_uuid=str(run.uuid),
            source_entity_id=run.id,
            source_entity_name=run.name,
            source_instance_id=self.source_instance_id,
            description=f"AnnotationRun: {run.name}"
        )
        return DataPackage(metadata=package_metadata, content={"annotation_run": run_content}, files=self.files)

    async def build_bundle_package(
        self,
        bundle: Bundle,
        include_assets_content: bool = False,
        include_asset_annotations: bool = False
    ) -> DataPackage:
        logger.debug(f"Building package for Bundle ID: {bundle.id}, Name: {bundle.name}")
        bundle_content = bundle.model_dump(exclude_none=True, exclude={'assets'})
        bundle_content["asset_references"] = []

        assets_in_bundle = list(self.session.exec(
            select(Asset).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle.id))
        ).all())
        for asset_item_in_bundle in assets_in_bundle:
            asset_ref = {"uuid": str(asset_item_in_bundle.uuid), "id": asset_item_in_bundle.id, "title": asset_item_in_bundle.title, "kind": asset_item_in_bundle.kind.value}
            if include_assets_content:
                asset_data = AssetRead.model_validate(asset_item_in_bundle).model_dump(exclude_none=True)
                if asset_item_in_bundle.blob_path:
                    file_bytes = await self._fetch_file_content_from_storage(asset_item_in_bundle.blob_path)
                    if file_bytes:
                        original_filename = (asset_item_in_bundle.file_info or {}).get("original_filename") or (asset_item_in_bundle.file_info or {}).get("filename") or asset_item_in_bundle.title or Path(asset_item_in_bundle.blob_path).name
                        file_ref = self._add_file_to_package(original_filename, file_bytes)
                        asset_data["blob_file_reference"] = file_ref
                asset_ref["full_content"] = asset_data
                if include_asset_annotations:
                    asset_ref["full_content"]["annotations"] = []
                    annotations_for_asset = asset_item_in_bundle.annotations if hasattr(asset_item_in_bundle, 'annotations') else self.session.exec(select(Annotation).where(Annotation.asset_id == asset_item_in_bundle.id)).all()
                    for ann in annotations_for_asset:
                        ann_data = ann.model_dump(exclude_none=True, exclude={'justifications'})
                        justifications_for_ann = ann.justifications if hasattr(ann, 'justifications') else []
                        if justifications_for_ann:
                             ann_data["justifications"] = [j.model_dump(exclude_none=True) for j in justifications_for_ann]
                        asset_ref["full_content"]["annotations"].append(ann_data)
            
            bundle_content["asset_references"].append(asset_ref)

        package_metadata = PackageMetadata(
            package_type=ResourceType.BUNDLE,
            source_entity_uuid=str(bundle.uuid),
            source_entity_id=bundle.id,
            source_entity_name=bundle.name,
            source_instance_id=self.source_instance_id,
            description=f"Bundle: {bundle.name}"
        )
        return DataPackage(metadata=package_metadata, content={"bundle": bundle_content}, files=self.files)

    async def build_dataset_package(
        self,
        dataset: Dataset,
        include_assets: bool = True,
        include_annotations: bool = True,
        include_chunks: bool = False,
        include_embeddings: bool = False
    ) -> DataPackage:
        logger.debug(f"Building package for Dataset ID: {dataset.id}, Name: {dataset.name}")
        dataset_content = dataset.model_dump(exclude_none=True, exclude={'assets', 'source_jobs', 'source_schemas'})
        if include_assets and dataset.asset_ids:
            dataset_content["assets"] = []
            assets = dataset.assets if hasattr(dataset, 'assets') and dataset.assets else self.session.exec(select(Asset).where(Asset.id.in_(dataset.asset_ids))).all()
            for asset_item_in_ds in assets:
                asset_data = AssetRead.model_validate(asset_item_in_ds).model_dump(exclude_none=True, exclude={'text_content'})
                if asset_item_in_ds.text_content and len(asset_item_in_ds.text_content) < 5000:
                    asset_data['text_content'] = asset_item_in_ds.text_content
                elif asset_item_in_ds.text_content:
                    text_file_ref = self._add_file_to_package(f"asset_{asset_item_in_ds.uuid}_content.txt", asset_item_in_ds.text_content.encode('utf-8'))
                    asset_data['text_content_file_reference'] = text_file_ref
                
                if asset_item_in_ds.blob_path:
                    file_bytes = await self._fetch_file_content_from_storage(asset_item_in_ds.blob_path)
                    if file_bytes:
                        original_filename = (asset_item_in_ds.file_info or {}).get("original_filename") or (asset_item_in_ds.file_info or {}).get("filename") or asset_item_in_ds.title or Path(asset_item_in_ds.blob_path).name
                        blob_file_ref = self._add_file_to_package(original_filename, file_bytes)
                        asset_data["blob_file_reference"] = blob_file_ref
                
                # Handle chunks and embeddings if requested
                if include_chunks or include_embeddings:
                    asset_data["chunks"] = await self._export_asset_chunks(
                        asset_item_in_ds, 
                        include_embeddings=include_embeddings
                    )
                
                if include_annotations:
                    asset_data["annotations"] = []
                    annotations_for_asset = asset_item_in_ds.annotations if hasattr(asset_item_in_ds, 'annotations') else self.session.exec(select(Annotation).where(Annotation.asset_id == asset_item_in_ds.id)).all()
                    for ann in annotations_for_asset:
                        ann_dump = ann.model_dump(exclude_none=True, exclude={'justifications'})
                        justifications_for_ann = ann.justifications if hasattr(ann, 'justifications') else []
                        if justifications_for_ann:
                            ann_dump["justifications"] = [j.model_dump(exclude_none=True) for j in justifications_for_ann]
                        schema_ref = self.session.get(AnnotationSchema, ann.schema_id)
                        if schema_ref: ann_dump["schema_reference"] = {"uuid": str(schema_ref.uuid), "id": schema_ref.id, "name": schema_ref.name, "version": schema_ref.version}
                        asset_data["annotations"].append(ann_dump)
                dataset_content["assets"].append(asset_data)

        if dataset.source_job_ids:
            dataset_content["annotation_runs"] = []
            runs = dataset.source_jobs if hasattr(dataset, 'source_jobs') and dataset.source_jobs else self.session.exec(select(AnnotationRun).where(AnnotationRun.id.in_(dataset.source_job_ids))).all()
            for run in runs:
                dataset_content["annotation_runs"].append(run.model_dump(exclude_none=True, exclude={'annotations', 'target_schemas'}))
        
        if dataset.source_schema_ids:
            dataset_content["annotation_schemas"] = []
            schemas = dataset.source_schemas if hasattr(dataset, 'source_schemas') and dataset.source_schemas else self.session.exec(select(AnnotationSchema).where(AnnotationSchema.id.in_(dataset.source_schema_ids))).all()
            for schema_item in schemas:
                 dataset_content["annotation_schemas"].append(schema_item.model_dump(exclude_none=True))

        package_metadata = PackageMetadata(
            package_type=ResourceType.DATASET,
            source_entity_uuid=str(dataset.uuid),
            source_entity_id=dataset.id,
            source_entity_name=dataset.name,
            source_instance_id=self.source_instance_id,
            description=f"Dataset: {dataset.name}"
        )
        return DataPackage(metadata=package_metadata, content={"dataset": dataset_content}, files=self.files)

    async def build_mixed_package(
        self,
        assets: List[Asset],
        bundles: List[Bundle],
        include_assets_content: bool = True,
        include_asset_annotations: bool = True
    ) -> DataPackage:
        """Builds a package containing a mix of assets and bundles."""
        logger.debug(f"Building mixed package with {len(assets)} assets and {len(bundles)} bundles.")
        
        content = {"assets": [], "bundles": []}
        
        # Process standalone assets
        for asset in assets:
            asset_data = AssetRead.model_validate(asset).model_dump(exclude_none=True)
            if asset.blob_path:
                file_bytes = await self._fetch_file_content_from_storage(asset.blob_path)
                if file_bytes:
                    original_filename = (asset.file_info or {}).get("original_filename") or (asset.file_info or {}).get("filename") or asset.title or Path(asset.blob_path).name
                    asset_data["blob_file_reference"] = self._add_file_to_package(original_filename, file_bytes)
            
            # Fetch and include child assets for hierarchical assets
            if asset.kind in ['pdf', 'csv', 'web', 'mbox', 'article'] or asset.is_container:
                child_assets_query = select(Asset).where(Asset.parent_asset_id == asset.id).order_by(Asset.part_index, Asset.created_at)
                child_assets_result = self.session.exec(child_assets_query)
                child_assets = list(child_assets_result)
                
                if child_assets:
                    logger.debug(f"Found {len(child_assets)} child assets for asset {asset.id}")
                    children_data = []
                    
                    for child_asset in child_assets:
                        # Ensure we have a proper Asset object, not a tuple or Row
                        if isinstance(child_asset, tuple):
                            # Handle tuple format (Asset, other_fields...)
                            child_asset = child_asset[0]
                        elif hasattr(child_asset, '_mapping'):
                            # Handle SQLAlchemy Row objects
                            child_asset = child_asset[0] if len(child_asset) > 0 else child_asset
                        elif not hasattr(child_asset, 'id'):
                            # If it's not a proper Asset object, log and skip
                            logger.error(f"Unexpected child asset type: {type(child_asset)} - {child_asset}")
                            continue
                        
                        child_data = AssetRead.model_validate(child_asset).model_dump(exclude_none=True)
                        # Include child asset files if they have blob_path
                        if child_asset.blob_path:
                            child_file_bytes = await self._fetch_file_content_from_storage(child_asset.blob_path)
                            if child_file_bytes:
                                child_filename = (child_asset.file_info or {}).get("original_filename") or (child_asset.file_info or {}).get("filename") or child_asset.title or Path(child_asset.blob_path).name
                                child_data["blob_file_reference"] = self._add_file_to_package(child_filename, child_file_bytes)
                        children_data.append(child_data)
                    
                    asset_data["children_assets"] = children_data
                    logger.debug(f"Added {len(children_data)} children to asset {asset.id} export data")
            
            content["assets"].append(asset_data)
            
        # Process bundles and their assets
        for bundle in bundles:
            bundle_content = bundle.model_dump(exclude_none=True, exclude={'assets'})
            bundle_content["asset_references"] = []
            assets_in_bundle = list(self.session.exec(
                select(Asset).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle.id))
            ).all())
            for asset_item in assets_in_bundle:
                asset_ref = {"uuid": str(asset_item.uuid), "id": asset_item.id, "title": asset_item.title, "kind": asset_item.kind.value}
                if include_assets_content:
                    asset_data = AssetRead.model_validate(asset_item).model_dump(exclude_none=True)
                    if asset_item.blob_path:
                        file_bytes = await self._fetch_file_content_from_storage(asset_item.blob_path)
                        if file_bytes:
                            original_filename = (asset_item.file_info or {}).get("original_filename") or (asset_item.file_info or {}).get("filename") or asset_item.title or Path(asset_item.blob_path).name
                            asset_data["blob_file_reference"] = self._add_file_to_package(original_filename, file_bytes)
                    
                    # Include child assets for hierarchical assets in bundles too
                    if asset_item.kind in ['pdf', 'csv', 'web', 'mbox', 'article'] or asset_item.is_container:
                        child_assets_query = select(Asset).where(Asset.parent_asset_id == asset_item.id).order_by(Asset.part_index, Asset.created_at)
                        child_assets_result = self.session.exec(child_assets_query)
                        child_assets = list(child_assets_result)
                        
                        if child_assets:
                            logger.debug(f"Found {len(child_assets)} child assets for bundle asset {asset_item.id}")
                            children_data = []
                            
                            for child_asset in child_assets:
                                # Ensure we have a proper Asset object, not a tuple or Row
                                if isinstance(child_asset, tuple):
                                    # Handle tuple format (Asset, other_fields...)
                                    child_asset = child_asset[0]
                                elif hasattr(child_asset, '_mapping'):
                                    # Handle SQLAlchemy Row objects
                                    child_asset = child_asset[0] if len(child_asset) > 0 else child_asset
                                elif not hasattr(child_asset, 'id'):
                                    # If it's not a proper Asset object, log and skip
                                    logger.error(f"Unexpected child asset type: {type(child_asset)} - {child_asset}")
                                    continue
                                
                                child_data = AssetRead.model_validate(child_asset).model_dump(exclude_none=True)
                                # Include child asset files if they have blob_path
                                if child_asset.blob_path:
                                    child_file_bytes = await self._fetch_file_content_from_storage(child_asset.blob_path)
                                    if child_file_bytes:
                                        child_filename = (child_asset.file_info or {}).get("original_filename") or (child_asset.file_info or {}).get("filename") or child_asset.title or Path(child_asset.blob_path).name
                                        child_data["blob_file_reference"] = self._add_file_to_package(child_filename, child_file_bytes)
                                children_data.append(child_data)
                            
                            asset_data["children_assets"] = children_data
                            logger.debug(f"Added {len(children_data)} children to bundle asset {asset_item.id} export data")
                    
                    asset_ref["full_content"] = asset_data
                bundle_content["asset_references"].append(asset_ref)
            content["bundles"].append(bundle_content)
            
        package_metadata = PackageMetadata(
            package_type=ResourceType.MIXED,
            source_entity_name="Mixed Export",
            description=f"Mixed export containing {len(assets)} assets and {len(bundles)} bundles."
        )
        
        return DataPackage(metadata=package_metadata, content=content, files=self.files)

    # ─── Structured package export ───

    async def build_package_export(
        self,
        package,
        scope,
        *,
        include_csvs: bool = True,
        include_explore_script: bool = True,
        include_justifications: bool = True,
        batch_size: int = 500,
    ) -> DataPackage:
        """Build a self-contained intelligence product from a Package.

        Produces a ZIP with:
        - manifest.json   — full HQ-native data for round-trip import
        - files/           — original source documents
        - data/*.csv       — human-readable analysis results
        - provenance/      — audit trail
        - explore.py       — self-documenting script

        Args:
            package: Package model with items loaded.
            scope: Pre-resolved PackageScope (route is the gatekeeper).
            include_csvs: Whether to generate the data/ and provenance/ CSVs.
            include_explore_script: Whether to embed explore.py.
            include_justifications: Whether to include justification text.
            batch_size: DB query batch size for annotations.
        """
        from app.api.modules.sharing.serializers import (
            serialize_asset, serialize_annotation, serialize_schema,
            serialize_run, serialize_bundle, _resolve_original_filename,
            _make_asset_ref, _make_schema_ref,
        )
        from app.api.modules.sharing.csv_writers import (
            build_assets_csv, build_annotations_csv, build_schemas_csv,
            build_lineage_csv, safe_csv_filename,
        )

        # ── Phase 1: Collect & dedup into UUID-keyed registries ──

        schema_registry: dict[str, AnnotationSchema] = {}  # uuid → model
        run_registry: dict[str, AnnotationRun] = {}
        bundle_registry: dict[str, Bundle] = {}
        asset_registry: dict[str, Asset] = {}

        for item in package.items:
            if item.schema_id and item.schema_id in (scope.schema_ids or ()):
                schema = self.session.get(AnnotationSchema, item.schema_id)
                if schema:
                    schema_registry.setdefault(str(schema.uuid), schema)

            if item.run_id and item.run_id in (scope.run_ids or ()):
                run = self.session.get(AnnotationRun, item.run_id)
                if run:
                    run_registry.setdefault(str(run.uuid), run)
                    # Pull schemas from this run
                    for s in (run.target_schemas or []):
                        schema_registry.setdefault(str(s.uuid), s)

            if item.bundle_id and item.bundle_id in (scope.bundle_ids or ()):
                bundle = self.session.get(Bundle, item.bundle_id)
                if bundle:
                    bundle_registry.setdefault(str(bundle.uuid), bundle)

            if item.asset_id and item.asset_id in (scope.asset_ids or ()):
                asset = self.session.get(Asset, item.asset_id)
                if asset:
                    asset_registry.setdefault(str(asset.uuid), asset)

        # Collect assets from bundles
        for bundle_uuid, bundle in bundle_registry.items():
            bundle_assets = list(self.session.execute(
                select(Asset).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle.id))
            ).scalars().all())
            for asset in bundle_assets:
                asset_registry.setdefault(str(asset.uuid), asset)
                # Also collect child assets (PDF pages, CSV rows, etc.)
                if hasattr(asset, 'is_container') and asset.is_container:
                    children = list(self.session.execute(
                        select(Asset)
                        .where(Asset.parent_asset_id == asset.id)
                        .order_by(Asset.part_index)
                    ).scalars().all())
                    for child in children:
                        asset_registry.setdefault(str(child.uuid), child)

        # Collect assets from runs (via annotations)
        run_annotations: dict[str, list] = {}  # run_uuid → [Annotation, ...]
        visible_asset_ids = set(scope.downloadable_asset_ids or ()) | set(scope.asset_ids or ())

        for run_uuid, run in run_registry.items():
            annotations: list[Annotation] = []
            offset = 0
            while True:
                # Use execute+scalars to guarantee ORM model instances (not Row objects)
                batch = list(self.session.execute(
                    select(Annotation)
                    .where(Annotation.run_id == run.id)
                    .order_by(Annotation.id)
                    .offset(offset)
                    .limit(batch_size)
                ).scalars().all())
                if not batch:
                    break
                annotations.extend(batch)
                offset += batch_size

            run_annotations[run_uuid] = annotations

            for ann in annotations:
                if ann.asset_id in visible_asset_ids:
                    asset = self.session.get(Asset, ann.asset_id)
                    if asset:
                        asset_registry.setdefault(str(asset.uuid), asset)
                        # Include parent asset for hierarchy preservation
                        if asset.parent_asset_id:
                            parent = self.session.get(Asset, asset.parent_asset_id)
                            if parent:
                                asset_registry.setdefault(str(parent.uuid), parent)

        # ── Phase 2: Determine which assets get their blobs included ──
        # Assets in downloadable_asset_ids get their files. Assets not in
        # that set still get metadata in the manifest/CSV but no blob.

        downloadable_ids = set(scope.downloadable_asset_ids or ())
        # If scope has no downloadable restrictions (e.g. owner export), include all
        if not downloadable_ids:
            downloadable_ids = {a.id for a in asset_registry.values()}

        # Build parent lookup from registry for hierarchy context
        _id_to_asset = {a.id: a for a in asset_registry.values()}

        # ── Phase 3: Resolve blobs and serialize assets ──

        serialized_assets: list[dict] = []
        for asset_uuid, asset in asset_registry.items():
            blob_ref = None

            if asset.id in downloadable_ids and asset.blob_path:
                file_bytes = await self._fetch_file_content_from_storage(asset.blob_path)
                if file_bytes:
                    filename = _resolve_original_filename(asset)
                    blob_ref = self._add_file_to_package(filename, file_bytes)

            # Resolve parent for hierarchy context in CSV
            parent = _id_to_asset.get(asset.parent_asset_id) if asset.parent_asset_id else None

            serialized_assets.append(serialize_asset(
                asset, blob_ref=blob_ref, parent_asset=parent,
            ))

        # ── Phase 4: Serialize schemas, runs, bundles ──

        serialized_schemas = [serialize_schema(s) for s in schema_registry.values()]

        serialized_runs = []
        # annotations_by_run_schema: (run_uuid, schema_uuid) → [annotation_dict]
        annotations_by_run_schema: dict[tuple[str, str], list[dict]] = {}

        for run_uuid, run in run_registry.items():
            schema_dicts = [
                serialize_schema(s) for s in (run.target_schemas or [])
            ]
            serialized_runs.append(serialize_run(run, schema_dicts=schema_dicts))

            # Serialize this run's annotations grouped by schema
            for ann in run_annotations.get(run_uuid, []):
                schema = self.session.get(AnnotationSchema, ann.schema_id)
                asset = self.session.get(Asset, ann.asset_id)
                s_uuid = str(schema.uuid) if schema else "unknown"

                # Fetch justifications if needed
                justifications = None
                if include_justifications:
                    justifications = (
                        ann.justifications
                        if hasattr(ann, "justifications") and ann.justifications
                        else list(self.session.execute(
                            select(Justification).where(Justification.annotation_id == ann.id)
                        ).scalars().all())
                    )

                ann_dict = serialize_annotation(
                    ann,
                    include_justifications=include_justifications,
                    justifications=justifications,
                    asset_ref=_make_asset_ref(asset) if asset else None,
                    schema_ref=_make_schema_ref(schema) if schema else None,
                )

                key = (run_uuid, s_uuid)
                annotations_by_run_schema.setdefault(key, []).append(ann_dict)

            # Attach annotations to the run dict
            all_run_anns = []
            for (ru, _), anns in annotations_by_run_schema.items():
                if ru == run_uuid:
                    all_run_anns.extend(anns)
            serialized_runs[-1]["annotations"] = all_run_anns
            serialized_runs[-1]["assets"] = [
                a for a in serialized_assets
                if any(
                    ann.get("asset_reference", {}).get("uuid") == a.get("uuid")
                    for ann in all_run_anns
                )
            ]

        serialized_bundles = []
        for bundle_uuid, bundle in bundle_registry.items():
            assets_in_bundle = list(self.session.execute(
                select(Asset).where(text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle.id))
            ).scalars().all())
            refs = [_make_asset_ref(a) for a in assets_in_bundle]
            serialized_bundles.append(serialize_bundle(bundle, asset_refs=refs))

        # ── Phase 5: Build manifest content ──

        manifest_content = {
            "assets": serialized_assets,
            "bundles": serialized_bundles,
            "annotation_runs": serialized_runs,
            "annotation_schemas": serialized_schemas,
        }

        # ── Phase 6: Generate structured output ──
        #
        # ZIP layout:
        #   assets/           — asset inventory CSV
        #   analysis_results/ — per-(run, schema) annotation CSVs
        #   files/            — original source documents
        #   schemas/          — index CSV + individual JSON definitions
        #   provenance/       — lineage CSV
        #   manifest.json     — full HQ-native data
        #   explore.py        — self-documenting script

        if include_csvs:
            if serialized_assets:
                self.files["assets/assets.csv"] = build_assets_csv(serialized_assets)

            if serialized_schemas:
                self.files["schemas/schemas.csv"] = build_schemas_csv(serialized_schemas)
                for s in serialized_schemas:
                    s_name = s.get("name", "unnamed")
                    s_version = s.get("version", "0")
                    fname = safe_csv_filename(f"{s_name}_v{s_version}", ".json")
                    schema_json = json.dumps(s, indent=2, default=str).encode("utf-8")
                    self.files[f"schemas/{fname}"] = schema_json

            # One CSV per (run, schema) pair
            for (run_uuid, schema_uuid), anns in annotations_by_run_schema.items():
                run_obj = run_registry.get(run_uuid)
                schema_obj = schema_registry.get(schema_uuid)
                run_name = run_obj.name if run_obj else run_uuid[:8]
                schema_name = schema_obj.name if schema_obj else schema_uuid[:8]
                fname = safe_csv_filename(f"{run_name}__{schema_name}")
                self.files[f"analysis_results/{fname}"] = build_annotations_csv(
                    anns,
                    include_justifications=include_justifications,
                )

            # Lineage CSV
            lineage_entries = []
            for ann_list in annotations_by_run_schema.values():
                for ann in ann_list:
                    lineage_entries.append({
                        "entity_type": "annotation",
                        "entity_uuid": ann.get("uuid"),
                        "entity_name": ann.get("asset_reference", {}).get("title", ""),
                        "action": "annotated",
                        "timestamp": ann.get("timestamp"),
                        "source_run": ann.get("run_id"),
                        "source_schema": ann.get("schema_reference", {}).get("name", ""),
                        "model_name": ann.get("model_name", ""),
                    })
            if lineage_entries:
                self.files["provenance/lineage.csv"] = build_lineage_csv(lineage_entries)

        # ── Phase 7: Embed explore.py ──

        if include_explore_script:
            try:
                script_path = Path(__file__).parent.parent / "static" / "explore.py"
                if script_path.exists():
                    self.files["explore.py"] = script_path.read_bytes()
            except Exception as e:
                logger.warning(f"Could not embed explore.py: {e}")

        # ── Phase 8: Assemble DataPackage ──

        metadata = PackageMetadata(
            package_type=ResourceType.PACKAGE,
            source_entity_uuid=str(package.uuid),
            source_entity_id=package.id,
            source_entity_name=package.name,
            source_instance_id=self.source_instance_id,
            description=f"Package export: {package.name}",
        )
        return DataPackage(metadata=metadata, content=manifest_content, files=self.files)


class PackageImporter:
    """
    Helper class for importing data packages.
    """
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        target_infospace_id: int,
        target_user_id: int,
        settings: AppSettings,
        asset_service: AssetService
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.target_infospace_id = target_infospace_id
        self.target_user_id = target_user_id
        self.settings = settings
        self.asset_service = asset_service
        self.uuid_map: Dict[str, Dict[str, Dict[str, Any]]] = defaultdict(lambda: defaultdict(dict)) # Ensure defaultdict for inner dicts too
        self.source_instance_id_from_package: Optional[str] = None

    async def _store_file_from_package(self, zip_file_path_in_package: str, package_files: Dict[str, bytes]) -> Optional[str]:
        """Stores a file from the package's file dict into the target storage provider."""
        file_bytes = package_files.get(zip_file_path_in_package)
        if not file_bytes:
            logger.warning(f"File '{zip_file_path_in_package}' referenced in manifest but not found in package files.")
            return None
        
        original_filename = Path(zip_file_path_in_package).name # Get the original filename from the path in zip
        # Create a more structured and unique path in storage
        new_storage_path = f"infospaces/{self.target_infospace_id}/imported_package_files/{uuid.uuid4().hex[:10]}_{secure_filename(original_filename)}"
        
        await self.storage_provider.upload_from_bytes(file_bytes, new_storage_path, filename=original_filename)
        logger.info(f"Stored file '{original_filename}' from package to '{new_storage_path}'")
        return new_storage_path

    def _register_imported_entity(self, entity_type_str: str, source_uuid: str, local_entity: Any) -> None:
        """Register an imported entity for reference by its source UUID."""
        if not hasattr(local_entity, 'id') or not hasattr(local_entity, 'uuid'):
            logger.warning(f"Cannot register entity type '{entity_type_str}' (source UUID: {source_uuid}) due to missing id or uuid on local_entity.")
            return
        self.uuid_map[entity_type_str][source_uuid] = {
            "local_id": local_entity.id,
            "local_uuid": str(local_entity.uuid)
        }
        logger.debug(f"Registered import: {entity_type_str} '{source_uuid}' -> local_id={local_entity.id}, local_uuid={local_entity.uuid}")

    def _get_local_id_from_source_uuid(self, entity_type_str: str, source_uuid: Optional[str]) -> Optional[int]:
        if not source_uuid: return None
        # Updated to handle defaultdict structure properly
        entity_type_map = self.uuid_map.get(entity_type_str)
        if entity_type_map is None: return None
        source_uuid_entry = entity_type_map.get(source_uuid)
        if source_uuid_entry is None: return None
        return source_uuid_entry.get("local_id")
    
    def _sort_assets_by_parent_child_order(self, assets_data: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Sort assets to ensure parent assets are imported before their children.
        Returns a list of assets in the correct import order.
        """
        # Create a mapping of UUID to asset data for quick lookup
        uuid_to_asset = {}
        for asset_data in assets_data:
            asset_uuid = str(asset_data.get("uuid", asset_data.get("entity_uuid", "")))
            uuid_to_asset[asset_uuid] = asset_data
        
        # Separate parent and child assets
        parent_assets = []
        child_assets = []
        
        for asset_data in assets_data:
            if asset_data.get("parent_asset_uuid"):
                child_assets.append(asset_data)
            else:
                parent_assets.append(asset_data)
        
        # Start with parent assets
        ordered_assets = parent_assets.copy()
        
        # Add children in order, ensuring their parents have been processed
        remaining_children = child_assets.copy()
        max_iterations = len(child_assets) + 1  # Prevent infinite loops
        iteration = 0
        
        while remaining_children and iteration < max_iterations:
            added_in_this_iteration = []
            
            for child_asset in remaining_children:
                parent_uuid = child_asset.get("parent_asset_uuid")
                
                # Check if parent has already been processed
                parent_already_processed = any(
                    str(processed_asset.get("uuid", processed_asset.get("entity_uuid", ""))) == parent_uuid
                    for processed_asset in ordered_assets
                )
                
                if parent_already_processed:
                    ordered_assets.append(child_asset)
                    added_in_this_iteration.append(child_asset)
            
            # Remove processed children from remaining list
            for added_asset in added_in_this_iteration:
                remaining_children.remove(added_asset)
            
            iteration += 1
        
        # Add any remaining children that couldn't be ordered (orphans)
        if remaining_children:
            logger.warning(f"Found {len(remaining_children)} child assets with missing parent references. Adding them at the end.")
            ordered_assets.extend(remaining_children)
        
        logger.debug(f"Ordered {len(assets_data)} assets: {len(parent_assets)} parents, {len(child_assets)} children")
        return ordered_assets

    async def import_source_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> Source:
        if package.metadata.package_type != ResourceType.SOURCE:
            raise ValueError("Invalid package type for import_source_package")
        self.source_instance_id_from_package = package.metadata.source_instance_id

        s_data = package.content["source"]
        # Ensure source_uuid is a string. Fallback to entity_uuid if uuid is missing.
        source_uuid = str(s_data.get("uuid") or s_data.get("entity_uuid", uuid.uuid4()))

        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.SOURCE.value, source_uuid)
        if existing_local_id and conflict_strategy == 'skip':
            logger.info(f"Skipping import of already imported Source UUID {source_uuid} (local ID: {existing_local_id})" )
            existing_src = self.session.get(Source, existing_local_id) # Use Source model
            if not existing_src:
                # This case implies an inconsistency in the uuid_map or DB state
                logger.error(f"Mapped Source ID {existing_local_id} for UUID {source_uuid} not found in DB. Re-importing.")
            else:
                return existing_src # Return the found source
        
        origin_details = s_data.get("details", {})
        # If a main_file_reference exists, process it
        if s_data.get("main_file_reference") and package.files:
            new_storage_path = await self._store_file_from_package(s_data["main_file_reference"], package.files)
            if new_storage_path:
                origin_details["storage_path"] = new_storage_path
                # Ensure filename in details matches the basename of the file reference from zip
                origin_details["filename"] = Path(s_data["main_file_reference"]).name 
            else:
                logger.warning(f"Main file '{s_data['main_file_reference']}' for Source '{s_data['name']}' could not be stored.")
                origin_details.pop("storage_path", None) # Remove if storage failed
                # Do not pop filename if it was already there and unrelated to a failed main_file_reference storage attempt

        new_src = Source( # Use Source model
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            imported_from_uuid=source_uuid, # Store the original UUID from the package
            name=s_data.get("name", f"Imported Source {source_uuid[:8]}"),
            kind=s_data.get("kind", "unknown"), # Get kind as string, default to unknown
            description=s_data.get("description"),
            details=origin_details,
            source_metadata=s_data.get("source_metadata", {}),
            status=SourceStatus.PENDING # Default to PENDING for potential re-processing
            # uuid will be auto-generated by the model
        )
        self.session.add(new_src)
        self.session.flush() # Flush to get the new_src.id before using it for assets
        self._register_imported_entity(ResourceType.SOURCE.value, source_uuid, new_src)
        logger.info(f"Imported Source '{new_src.name}' (ID {new_src.id}, Original UUID {source_uuid}) into infospace {self.target_infospace_id}")

        if s_data.get("assets") and isinstance(s_data["assets"], list):
            logger.info(f"Importing {len(s_data['assets'])} assets linked to source '{new_src.name}'")
            for asset_data_in_pkg in s_data["assets"]:
                # Pass new_src.id as parent_source_id for these assets
                await self._import_asset_data(asset_data_in_pkg, package.files, parent_source_id=new_src.id)
        
        return new_src

    async def _import_asset_data(self, asset_data_in_pkg: Dict[str, Any], package_files: Dict[str, bytes], parent_source_id: Optional[int], parent_asset_id: Optional[int] = None) -> Asset:
        # Ensure asset_uuid is a string. Fallback if uuid is missing.
        asset_uuid = str(asset_data_in_pkg.get("uuid") or asset_data_in_pkg.get("entity_uuid", uuid.uuid4()))
        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.ASSET.value, asset_uuid)
        if existing_local_id: 
            logger.info(f"Skipping import of already processed Asset UUID {asset_uuid} (local ID: {existing_local_id})" )
            existing_asset = self.session.get(Asset, existing_local_id)
            if not existing_asset: 
                logger.error(f"Mapped Asset ID {existing_local_id} for UUID {asset_uuid} not found. Re-importing.")
            else:
                return existing_asset

        new_blob_path = None
        if asset_data_in_pkg.get("blob_file_reference") and package_files:
            new_blob_path = await self._store_file_from_package(asset_data_in_pkg["blob_file_reference"], package_files)
        
        text_content = asset_data_in_pkg.get("text_content")
        if asset_data_in_pkg.get("text_content_file_reference") and package_files:
            text_file_bytes = package_files.get(asset_data_in_pkg["text_content_file_reference"])
            if text_file_bytes: text_content = text_file_bytes.decode('utf-8', errors='replace')
            else: logger.warning(f"Text content file '{asset_data_in_pkg['text_content_file_reference']}' not found in package for asset {asset_uuid}")

        # Handle parent asset relationship resolution
        resolved_parent_asset_id = parent_asset_id  # Use explicitly passed parent_asset_id if available
        if asset_data_in_pkg.get("parent_asset_uuid") and resolved_parent_asset_id is None:
            # Look up parent asset by UUID
            parent_uuid = asset_data_in_pkg["parent_asset_uuid"]
            resolved_parent_asset_id = self._get_local_id_from_source_uuid(ResourceType.ASSET.value, parent_uuid)
            if resolved_parent_asset_id:
                logger.debug(f"Resolved parent asset UUID {parent_uuid} to local ID {resolved_parent_asset_id} for asset {asset_uuid}")
            else:
                logger.warning(f"Could not resolve parent asset UUID {parent_uuid} for asset {asset_uuid}. Parent relationship will be lost.")
        
        # Handle bundle relationship resolution
        resolved_bundle_id = None
        if asset_data_in_pkg.get("bundle_id"):
            # Asset was in a bundle in the original infospace
            # We need to find the imported bundle by its original UUID
            # The bundle export includes the UUID, and we track it during import
            original_bundle_id = asset_data_in_pkg.get("bundle_id")
            
            # Try to find bundle by checking if we have bundle UUID in asset data
            # AssetRead includes bundle_id but not bundle UUID, so we need to query
            # Check if bundle was already imported by looking through our uuid_map
            for source_uuid, mapping in self.uuid_map.get(ResourceType.BUNDLE.value, {}).items():
                # We don't have the original bundle UUID here directly, so we'll try a different approach
                # We'll set this after all bundles are imported, or resolve via asset_data if available
                pass
            
            # For now, we'll leave bundle_ids as None and rely on the bundle import setting it
            # via array_append in import_bundle_package
            logger.debug(f"Asset {asset_uuid} had bundle_id {original_bundle_id} in original infospace, will be linked during bundle import")
        
        if parent_source_id is None and asset_data_in_pkg.get("kind") != "INFOSPACE_EXPORT_ANCHOR": # Example of a special kind
            logger.debug(f"Asset UUID {asset_uuid} is being imported without a direct parent_source_id. This is expected for bundle-only assets.")
        
        asset_kind_str = asset_data_in_pkg.get("kind", AssetKind.TEXT.value) # Default to TEXT if kind missing
        try:
            asset_kind_enum = AssetKind(asset_kind_str)
        except ValueError:
            logger.warning(f"Invalid AssetKind '{asset_kind_str}' for asset UUID {asset_uuid}. Defaulting to {AssetKind.TEXT.value}.")
            asset_kind_enum = AssetKind.TEXT

        event_timestamp_raw = asset_data_in_pkg.get("event_timestamp")
        parsed_event_timestamp = None
        if isinstance(event_timestamp_raw, str):
            try:
                parsed_event_timestamp = dateutil.parser.isoparse(event_timestamp_raw)
            except (ValueError, TypeError):
                logger.warning(f"Could not parse event_timestamp string '{event_timestamp_raw}' for asset {asset_uuid}")
                parsed_event_timestamp = None
        elif isinstance(event_timestamp_raw, datetime):
            # It's already a datetime object, use it directly
            parsed_event_timestamp = event_timestamp_raw

        new_asset = Asset(
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            source_id=parent_source_id, # Link to the source it belongs to
            parent_asset_id=resolved_parent_asset_id, # Link to parent asset if it's a child asset
            part_index=asset_data_in_pkg.get("part_index"), # Include part index for ordered children
            imported_from_uuid=asset_uuid,
            title=asset_data_in_pkg.get("title", f"Imported Asset {asset_uuid[:8]}"),
            kind=asset_kind_enum, # Use validated enum
            text_content=text_content,
            blob_path=new_blob_path,
            source_identifier=asset_data_in_pkg.get("source_identifier"),
            facets=_extract_facets_from_asset_data(asset_data_in_pkg),
            file_info=_extract_file_info_from_asset_data(asset_data_in_pkg),
            content_hash=asset_data_in_pkg.get("content_hash"),
            event_timestamp=parsed_event_timestamp
            # uuid will be auto-generated
        )
        self.session.add(new_asset)
        self.session.flush() # Flush to get ID before registering or using for children
        self._register_imported_entity(ResourceType.ASSET.value, asset_uuid, new_asset)

        logger.debug(f"Imported Asset '{new_asset.title}' (ID {new_asset.id}, Original UUID {asset_uuid}) linked to Source ID {parent_source_id}")

        # Recursively import child assets if present in this asset's data (not typical for flat asset lists under source)
        if asset_data_in_pkg.get("children_assets") and isinstance(asset_data_in_pkg["children_assets"], list):
            logger.info(f"Importing {len(asset_data_in_pkg['children_assets'])} child assets for asset {new_asset.title} (ID: {new_asset.id})")
            for child_asset_data in asset_data_in_pkg["children_assets"]:
                await self._import_asset_data(child_asset_data, package_files, parent_source_id=parent_source_id, parent_asset_id=new_asset.id)
        
        annotations_to_import = asset_data_in_pkg.get("annotations", [])
        if annotations_to_import and isinstance(annotations_to_import, list):
            await self._import_annotations_for_asset(new_asset.id, annotations_to_import)
        elif annotations_to_import: # Check if it's not None but also not a list
            logger.warning(f"Annotations data for asset {asset_uuid} is not a list, skipping annotation import. Data: {annotations_to_import}")

        return new_asset

    async def _import_annotations_for_asset(self, local_asset_id: int, annotations_data: List[Dict[str, Any]]):
        """
        Imports a batch of annotations for a specific asset, skipping any that already exist.
        This method is transaction-safe and designed to be called within a larger import process.
        """
        if not annotations_data:
            return

        logger.debug(f"Starting batch import of {len(annotations_data)} annotations for asset ID {local_asset_id}.")

        # 1. Collect all annotation UUIDs from the incoming package data.
        ann_uuids_to_import = {str(ann_data.get("uuid")) for ann_data in annotations_data if ann_data.get("uuid")}
        if not ann_uuids_to_import:
            logger.warning(f"No annotation UUIDs found in data for asset {local_asset_id}, skipping.")
            return

        # 2. Find which of these annotations already exist in the database in a single query.
        existing_uuids_query = select(Annotation.imported_from_uuid).where(Annotation.imported_from_uuid.in_(ann_uuids_to_import))
        existing_uuids = set(self.session.exec(existing_uuids_query).all())
        
        if existing_uuids:
            logger.info(f"Skipping {len(existing_uuids)} annotations that already exist for asset {local_asset_id}.")

        # 3. Create new Annotation objects for those that don't exist.
        annotations_to_create: List[Annotation] = []
        for ann_data in annotations_data:
            ann_uuid = str(ann_data.get("uuid"))
            if not ann_uuid or ann_uuid in existing_uuids:
                continue

            # Resolve schema and run references to their local IDs
            schema_ref_uuid = ann_data.get("schema_reference", {}).get("uuid")
            local_schema_id = self._get_local_id_from_source_uuid(ResourceType.SCHEMA.value, str(schema_ref_uuid) if schema_ref_uuid else None)
            
            local_run_id = ann_data.get("run_id")
            if local_run_id is None:
                run_ref_uuid = ann_data.get("run_reference", {}).get("uuid")
                local_run_id = self._get_local_id_from_source_uuid(ResourceType.RUN.value, str(run_ref_uuid) if run_ref_uuid else None)

            if not local_schema_id:
                logger.warning(f"Skipping annotation (UUID: {ann_uuid}) for asset {local_asset_id} due to unmapped schema: {schema_ref_uuid}")
                continue

            event_timestamp = self._safe_parse_datetime(ann_data.get("event_timestamp"), "event_timestamp")
            timestamp = self._safe_parse_datetime(ann_data.get("timestamp"), "timestamp") or datetime.now(timezone.utc)

            new_ann = Annotation(
                asset_id=local_asset_id,
                schema_id=local_schema_id,
                run_id=local_run_id,
                infospace_id=self.target_infospace_id,
                user_id=self.target_user_id,
                imported_from_uuid=ann_uuid,
                value=ann_data.get("value", {}),
                status=ResultStatus(ann_data.get("status", "success")) if ann_data.get("status") else ResultStatus.SUCCESS,
                region=ann_data.get("region"),
                links=ann_data.get("links"),
                event_timestamp=event_timestamp,
                timestamp=timestamp
            )
            annotations_to_create.append(new_ann)

        # 4. Add all new annotations to the session and flush to assign IDs.
        if not annotations_to_create:
            logger.info(f"No new annotations to import for asset {local_asset_id}.")
            return

        self.session.add_all(annotations_to_create)
        self.session.flush()
        logger.info(f"Imported {len(annotations_to_create)} new annotations for asset {local_asset_id}.")
        
        # 5. Handle justifications for the newly created annotations.
        ann_uuid_to_id_map = {str(ann.imported_from_uuid): ann.id for ann in annotations_to_create}
        justifications_to_create = []
        
        for ann_data in annotations_data:
            ann_uuid = str(ann_data.get("uuid"))
            new_ann_id = ann_uuid_to_id_map.get(ann_uuid)
            if not new_ann_id:
                continue
            
            if ann_data.get("justifications") and isinstance(ann_data["justifications"], list):
                from app.models import Justification
                for just_data in ann_data["justifications"]:
                    justifications_to_create.append(Justification(
                        annotation_id=new_ann_id,
                        field_name=just_data.get("field_name"),
                        reasoning=just_data.get("reasoning"),
                        evidence_payload=just_data.get("evidence_payload", {}),
                        model_name=just_data.get("model_name"),
                        score=just_data.get("score")
                    ))
        
        if justifications_to_create:
            self.session.add_all(justifications_to_create)
            logger.info(f"Added {len(justifications_to_create)} justifications for newly imported annotations.")

    async def import_annotation_schema_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> AnnotationSchema:
        if package.metadata.package_type != ResourceType.SCHEMA:
            raise ValueError("Invalid package type for import_annotation_schema_package")
        self.source_instance_id_from_package = package.metadata.source_instance_id

        schema_data = package.content["annotation_schema"]
        source_uuid = str(schema_data.get("uuid", schema_data.get("entity_uuid")))

        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.SCHEMA.value, source_uuid)
        if existing_local_id and conflict_strategy == 'skip':
            logger.info(f"Skipping import of already imported AnnotationSchema UUID {source_uuid} (local ID: {existing_local_id})")
            existing_schema = self.session.get(AnnotationSchema, existing_local_id)
            if not existing_schema: raise RuntimeError(f"Mapped Schema ID {existing_local_id} not found.")
            return existing_schema

        # Also check for existing schema with same name and version in target infospace
        schema_name = schema_data.get("name", f"Imported Schema {source_uuid[:8]}")
        schema_version = schema_data.get("version", "1.0")
        
        # Query for existing schema with same name and version
        existing_schema_by_name = self.session.query(AnnotationSchema).filter(
            AnnotationSchema.infospace_id == self.target_infospace_id,
            AnnotationSchema.name == schema_name,
            AnnotationSchema.version == schema_version,
            AnnotationSchema.is_active == True
        ).first()
        
        if existing_schema_by_name and conflict_strategy == 'skip':
            try:
                schema_id = existing_schema_by_name.id
                logger.info(f"Skipping import of schema '{schema_name}' v{schema_version} - already exists in target infospace (ID: {schema_id})")
                # Register this schema in our mapping so other imports can find it
                self._register_imported_entity(ResourceType.SCHEMA.value, source_uuid, existing_schema_by_name)
                return existing_schema_by_name
            except AttributeError as e:
                logger.error(f"Existing schema object missing expected attributes: {e}. Object type: {type(existing_schema_by_name)}")
                logger.error(f"Object attributes: {dir(existing_schema_by_name) if hasattr(existing_schema_by_name, '__dict__') else 'No attributes'}")
                # Fall through to create new schema

        target_level_str = schema_data.get("target_level", "asset")
        try:
            target_level_enum = AnnotationSchemaTargetLevel(target_level_str)
        except ValueError:
            logger.warning(f"Invalid target_level '{target_level_str}' for schema {source_uuid}. Defaulting to 'asset'.")
            target_level_enum = AnnotationSchemaTargetLevel.ASSET

        new_schema = AnnotationSchema(
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            imported_from_uuid=source_uuid,
            name=schema_name,
            description=schema_data.get("description"),
            output_contract=schema_data.get("output_contract", {}),
            instructions=schema_data.get("instructions"),
            target_level=target_level_enum,
            version=schema_version
        )
        self.session.add(new_schema)
        self.session.flush()
        self._register_imported_entity(ResourceType.SCHEMA.value, source_uuid, new_schema)
        logger.info(f"Imported AnnotationSchema '{new_schema.name}' (ID {new_schema.id}, Source UUID {source_uuid})")
        return new_schema

    def _safe_parse_datetime(self, value: Any, field_name: str = "datetime") -> Optional[datetime]:
        """Safely parse a datetime field that might be a string or datetime object."""
        if value is None:
            return None
        if isinstance(value, str):
            try:
                return dateutil.parser.isoparse(value)
            except (ValueError, TypeError):
                logger.warning(f"Could not parse {field_name} string '{value}'")
                return None
        elif isinstance(value, datetime):
            return value
        else:
            logger.warning(f"Unexpected type for {field_name}: {type(value)}")
            return None

    async def import_annotation_run_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> AnnotationRun:
        if package.metadata.package_type != ResourceType.RUN:
            raise ValueError("Invalid package type for import_annotation_run_package")
        self.source_instance_id_from_package = package.metadata.source_instance_id

        run_data = package.content["annotation_run"]
        source_uuid = str(run_data.get("uuid", run_data.get("entity_uuid")))

        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.RUN.value, source_uuid)
        if existing_local_id and conflict_strategy == 'skip':
            logger.info(f"Skipping import of already imported AnnotationRun UUID {source_uuid} (local ID: {existing_local_id})")
            existing_run = self.session.get(AnnotationRun, existing_local_id)
            if not existing_run: raise RuntimeError(f"Mapped Run ID {existing_local_id} not found.")
            return existing_run

        # First, import annotation schemas included in the package
        local_target_schema_ids = []
        if run_data.get("annotation_schemas") and isinstance(run_data["annotation_schemas"], list):
            logger.info(f"Importing {len(run_data['annotation_schemas'])} annotation schemas for run '{run_data.get('name', source_uuid[:8])}'")
            for schema_data_in_pkg in run_data["annotation_schemas"]:
                schema_meta = PackageMetadata(
                    package_type=ResourceType.SCHEMA, 
                    source_entity_uuid=str(schema_data_in_pkg.get("uuid"))
                )
                temp_schema_pkg = DataPackage(
                    metadata=schema_meta, 
                    content={"annotation_schema": schema_data_in_pkg}, 
                    files={}
                )
                imported_schema = await self.import_annotation_schema_package(temp_schema_pkg, conflict_strategy='skip')
                if imported_schema:
                    local_target_schema_ids.append(imported_schema.id)
                    logger.debug(f"Imported schema '{imported_schema.name}' (ID {imported_schema.id}) for run")
        
        # Flush after importing all schemas to ensure they're persisted
        if local_target_schema_ids:
            self.session.flush()
        
        # Get the actual schema objects for the run (refresh from DB to ensure proper session attachment)
        local_target_schemas = []
        if local_target_schema_ids:
            # Refresh the session to ensure all imported objects are properly attached
            self.session.expire_all()
            for schema_id in local_target_schema_ids:
                schema_obj = self.session.get(AnnotationSchema, schema_id)
                if schema_obj:
                    # Ensure the object is fully loaded and attached to this session
                    self.session.refresh(schema_obj)
                    local_target_schemas.append(schema_obj)
                    logger.debug(f"Loaded schema '{schema_obj.name}' (ID {schema_obj.id}) for run relationship")
                else:
                    logger.warning(f"Could not find imported schema with ID {schema_id} for run {source_uuid}")
            
            if len(local_target_schemas) != len(local_target_schema_ids):
                logger.warning(f"Mismatch in resolved local target schemas for run {source_uuid}. Expected {len(local_target_schema_ids)}, found {len(local_target_schemas)}.")

        # Second, import assets included in the package (ordered by parent-child relationships)
        local_asset_ids = []
        if run_data.get("assets") and isinstance(run_data["assets"], list):
            logger.info(f"Importing {len(run_data['assets'])} assets for run '{run_data.get('name', source_uuid[:8])}'")
            # Sort assets to ensure parents are imported before children
            ordered_assets = self._sort_assets_by_parent_child_order(run_data["assets"])
            for asset_data_in_pkg in ordered_assets:
                # Import each asset - they are not tied to a specific source in this context
                imported_asset = await self._import_asset_data(asset_data_in_pkg, package.files, parent_source_id=None)
                if imported_asset:
                    local_asset_ids.append(imported_asset.id)
                    logger.debug(f"Imported asset '{imported_asset.title}' (ID {imported_asset.id}) for run")
        
        # Flush after importing all assets to ensure they're persisted
        if local_asset_ids:
            self.session.flush()

        # Parse datetime fields safely
        created_at = self._safe_parse_datetime(run_data.get("created_at"), "created_at") or datetime.now(timezone.utc)
        started_at = self._safe_parse_datetime(run_data.get("started_at"), "started_at")
        completed_at = self._safe_parse_datetime(run_data.get("completed_at"), "completed_at")

        # Create the annotation run
        new_run = AnnotationRun(
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            imported_from_uuid=source_uuid,
            name=run_data.get("name", f"Imported Run {source_uuid[:8]}"),
            configuration=run_data.get("configuration", {}),
            status=RunStatus(run_data.get("status", "completed")) if run_data.get("status") else RunStatus.COMPLETED,
            include_parent_context=run_data.get("include_parent_context", False),
            context_window=run_data.get("context_window", 0),
            error_message=run_data.get("error_message"),
            views_config=run_data.get("views_config", []),  # Import the views configuration
            target_schemas=local_target_schemas,
            created_at=created_at,
            started_at=started_at,
            completed_at=completed_at,
        )
        self.session.add(new_run)
        self.session.flush()
        self._register_imported_entity(ResourceType.RUN.value, source_uuid, new_run)
        logger.info(f"Imported AnnotationRun '{new_run.name}' (ID {new_run.id}, Source UUID {source_uuid})")

        # Finally, import annotations for the run in a single batch
        annotations_data = run_data.get("annotations")
        if annotations_data and isinstance(annotations_data, list):
            logger.info(f"Starting batch import of {len(annotations_data)} annotations for run '{new_run.name}'...")
            
            # 1. Collect all annotation UUIDs from the incoming package data.
            ann_uuids_to_import = {str(ann_data.get("uuid")) for ann_data in annotations_data if ann_data.get("uuid")}
            
            # 2. Find which of these annotations already exist in the database.
            existing_uuids_query = select(Annotation.imported_from_uuid).where(Annotation.imported_from_uuid.in_(ann_uuids_to_import))
            existing_uuids = set(self.session.exec(existing_uuids_query).all())
            if existing_uuids:
                logger.info(f"Skipping {len(existing_uuids)} annotations that already exist.")

            # 3. Create new Annotation objects for those that do not exist.
            annotations_to_create: List[Annotation] = []
            for ann_data in annotations_data:
                ann_uuid = str(ann_data.get("uuid"))
                if not ann_uuid or ann_uuid in existing_uuids:
                    continue

                # Resolve asset and schema references to their local IDs
                asset_ref_uuid = ann_data.get("asset_reference", {}).get("uuid")
                local_asset_id = self._get_local_id_from_source_uuid(ResourceType.ASSET.value, str(asset_ref_uuid) if asset_ref_uuid else None)
                
                schema_ref_uuid = ann_data.get("schema_reference", {}).get("uuid")
                local_schema_id = self._get_local_id_from_source_uuid(ResourceType.SCHEMA.value, str(schema_ref_uuid) if schema_ref_uuid else None)

                if not local_asset_id or not local_schema_id:
                    logger.warning(f"Skipping annotation (UUID: {ann_uuid}) due to unmapped asset ({asset_ref_uuid}) or schema ({schema_ref_uuid}).")
                    continue
                
                event_timestamp = self._safe_parse_datetime(ann_data.get("event_timestamp"), "event_timestamp")
                timestamp = self._safe_parse_datetime(ann_data.get("timestamp"), "timestamp") or datetime.now(timezone.utc)

                annotations_to_create.append(Annotation(
                    asset_id=local_asset_id,
                    schema_id=local_schema_id,
                    run_id=new_run.id,
                    infospace_id=self.target_infospace_id,
                    user_id=self.target_user_id,
                    imported_from_uuid=ann_uuid,
                    value=ann_data.get("value", {}),
                    status=ResultStatus(ann_data.get("status", "success")) if ann_data.get("status") else ResultStatus.SUCCESS,
                    region=ann_data.get("region"),
                    links=ann_data.get("links"),
                    event_timestamp=event_timestamp,
                    timestamp=timestamp
                ))

            # 4. Add all new annotations to the session and flush to assign IDs.
            if annotations_to_create:
                self.session.add_all(annotations_to_create)
                self.session.flush()
                logger.info(f"Successfully imported {len(annotations_to_create)} new annotations for run '{new_run.name}'.")

        # Final commit for the entire run import transaction
        self.session.commit()
        
        # Refresh the run object to reflect all newly added relationships
        self.session.refresh(new_run)
        final_annotation_count = len(new_run.annotations) if new_run.annotations else 0
        logger.info(f"Completed import of run '{new_run.name}'. Final annotation count: {final_annotation_count}")

        return new_run

    async def import_dataset_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> Dataset:
        """Imports a dataset from a package into the database."""
        if package.metadata.package_type != ResourceType.DATASET:
            raise ValueError("Invalid package type for import_dataset_package")
        self.source_instance_id_from_package = package.metadata.source_instance_id

        ds_data = package.content["dataset"]
        source_uuid = str(ds_data.get("uuid", ds_data.get("entity_uuid")))

        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.DATASET.value, source_uuid)
        if existing_local_id and conflict_strategy == 'skip':
            logger.info(f"Skipping import of already imported Dataset UUID {source_uuid} (local ID: {existing_local_id})")
            existing_dataset = self.session.get(Dataset, existing_local_id)
            if not existing_dataset: raise RuntimeError(f"Mapped Dataset ID {existing_local_id} not found.")
            return existing_dataset

        local_asset_ids = []
        if ds_data.get("assets") and isinstance(ds_data["assets"], list):
            for asset_data_in_pkg in ds_data["assets"]:
                asset_parent_source_id = None
                original_asset_source_id_from_pkg = asset_data_in_pkg.get("source_id")
                if original_asset_source_id_from_pkg:
                    pass

                imported_asset = await self._import_asset_data(asset_data_in_pkg, package.files, parent_source_id=asset_parent_source_id)
                if imported_asset: local_asset_ids.append(imported_asset.id)

        local_schema_ids = []
        if ds_data.get("annotation_schemas") and isinstance(ds_data["annotation_schemas"], list):
            for schema_data_in_pkg in ds_data["annotation_schemas"]:
                schema_meta = PackageMetadata(package_type=ResourceType.SCHEMA, source_entity_uuid=str(schema_data_in_pkg.get("uuid")))
                temp_schema_pkg = DataPackage(metadata=schema_meta, content={"annotation_schema": schema_data_in_pkg}, files={})
                imported_schema = await self.import_annotation_schema_package(temp_schema_pkg, conflict_strategy='skip')
                if imported_schema: local_schema_ids.append(imported_schema.id)
        
        local_run_ids = []
        if ds_data.get("annotation_runs") and isinstance(ds_data["annotation_runs"], list):
            for run_data_in_pkg in ds_data["annotation_runs"]:
                run_meta = PackageMetadata(package_type=ResourceType.RUN, source_entity_uuid=str(run_data_in_pkg.get("uuid")))
                temp_run_pkg = DataPackage(metadata=run_meta, content={"annotation_run": run_data_in_pkg}, files={})
                imported_run = await self.import_annotation_run_package(temp_run_pkg, conflict_strategy='skip')
                if imported_run: local_run_ids.append(imported_run.id)

        new_dataset = Dataset(
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            imported_from_uuid=source_uuid,
            uuid=uuid.uuid4(),
            name=ds_data.get("name", f"Imported Dataset {source_uuid[:8]}"),
            description=ds_data.get("description"),
            custom_metadata=ds_data.get("custom_metadata", {}),
            asset_ids=local_asset_ids,
            source_job_ids=local_run_ids,
            source_schema_ids=local_schema_ids
        )
        self.session.add(new_dataset)
        self.session.flush()
        self._register_imported_entity(ResourceType.DATASET.value, source_uuid, new_dataset)
        logger.info(f"Imported Dataset '{new_dataset.name}' (ID {new_dataset.id}, Source UUID {source_uuid})")
        return new_dataset 

    async def import_bundle_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> Bundle:
        if package.metadata.package_type != ResourceType.BUNDLE:
            raise ValueError("Invalid package type for import_bundle_package")
        self.source_instance_id_from_package = package.metadata.source_instance_id

        b_data = package.content["bundle"]
        source_uuid = str(b_data.get("uuid") or b_data.get("entity_uuid", uuid.uuid4()))

        existing_local_id = self._get_local_id_from_source_uuid(ResourceType.BUNDLE.value, source_uuid)
        if existing_local_id and conflict_strategy == 'skip':
            logger.info(f"Skipping import of already imported Bundle UUID {source_uuid} (local ID: {existing_local_id})")
            existing_bundle = self.session.get(Bundle, existing_local_id)
            if not existing_bundle:
                logger.error(f"Mapped Bundle ID {existing_local_id} for UUID {source_uuid} not found in DB. Re-importing.")
            else:
                return existing_bundle

        original_name = b_data.get("name", f"Imported Bundle {source_uuid[:8]}")
        bundle_name = original_name
        counter = 1
        while True:
            statement = select(Bundle).where(
                Bundle.infospace_id == self.target_infospace_id,
                Bundle.name == bundle_name
            )
            if not self.session.exec(statement).first():
                break
            bundle_name = f"{original_name} ({counter})"
            counter += 1

        if bundle_name != original_name:
            logger.info(f"Bundle name collision for '{original_name}'. Renaming to '{bundle_name}'")

        new_bundle = Bundle(
            infospace_id=self.target_infospace_id,
            user_id=self.target_user_id,
            imported_from_uuid=source_uuid,
            name=bundle_name,
            description=b_data.get("description"),
            purpose=b_data.get("purpose"),
            bundle_metadata=b_data.get("bundle_metadata", {}),
        )
        self.session.add(new_bundle)
        self.session.flush()

        local_asset_ids = []
        if b_data.get("asset_references") and isinstance(b_data["asset_references"], list):
            for asset_ref in b_data["asset_references"]:
                if asset_ref.get("full_content"):
                    # Full asset content provided - import the asset
                    asset_data_in_pkg = asset_ref["full_content"]
                    imported_asset = await self._import_asset_data(asset_data_in_pkg, package.files, parent_source_id=None)
                    if imported_asset:
                        local_asset_ids.append(imported_asset.id)
                else:
                    # Just a reference - try to find the asset by UUID
                    asset_uuid = str(asset_ref.get("uuid"))
                    if asset_uuid:
                        local_asset_id = self._get_local_id_from_source_uuid(ResourceType.ASSET.value, asset_uuid)
                        if local_asset_id:
                            local_asset_ids.append(local_asset_id)
                            logger.debug(f"Linked existing asset {asset_uuid} to bundle {new_bundle.name}")
                        else:
                            logger.warning(f"Bundle asset reference UUID {asset_uuid} not found in imported assets. Asset will be skipped from bundle.")
                    else:
                        logger.warning(f"Bundle asset reference without UUID or full_content. Asset will be skipped.")
        
        if local_asset_ids:
            # Add bundle to each asset's bundle_ids array
            self.session.add(new_bundle)
            self.session.flush()  # Ensure new_bundle.id is assigned
            from app.core.tree import copy as tree_copy
            result = tree_copy(self.session, asset_ids=local_asset_ids, to=new_bundle.id)
            new_bundle.asset_count = result.assets

        self.session.add(new_bundle)
        self.session.flush()
        self._register_imported_entity(ResourceType.BUNDLE.value, source_uuid, new_bundle)
        logger.info(f"Imported Bundle '{new_bundle.name}' (ID {new_bundle.id}, Original UUID {source_uuid}) into infospace {self.target_infospace_id}")
        return new_bundle

    async def import_mixed_package(self, package: DataPackage, conflict_strategy: str = 'skip') -> Dict[str, List[Any]]:
        if package.metadata.package_type != ResourceType.MIXED:
            raise ValueError("Invalid package type for import_mixed_package")

        imported_entities = {"assets": [], "bundles": []}

        for asset_data in package.content.get("assets", []):
            try:
                imported_asset = await self._import_asset_data(asset_data, package.files, parent_source_id=None)
                if imported_asset:
                    imported_entities["assets"].append(imported_asset)
            except Exception as e:
                logger.error(f"Failed to import a standalone asset from mixed package: {e}", exc_info=True)

        for bundle_data in package.content.get("bundles", []):
            try:
                bundle_meta = PackageMetadata(package_type=ResourceType.BUNDLE, source_entity_uuid=str(bundle_data.get("uuid")))
                temp_bundle_pkg = DataPackage(metadata=bundle_meta, content={"bundle": bundle_data}, files=package.files)
                imported_bundle = await self.import_bundle_package(temp_bundle_pkg, conflict_strategy)
                if imported_bundle:
                    imported_entities["bundles"].append(imported_bundle)
            except Exception as e:
                logger.error(f"Failed to import a bundle from mixed package: {e}", exc_info=True)
        
        logger.info(f"Imported {len(imported_entities['assets'])} assets and {len(imported_entities['bundles'])} bundles from mixed package.")
        return imported_entities

    async def import_package_export(
        self, package: DataPackage, conflict_strategy: str = "skip"
    ) -> Dict[str, List[Any]]:
        """Import a structured package export (ResourceType.PACKAGE).

        Import order matters for FK resolution:
        1. Schemas first (dedup by UUID/name+version)
        2. Bundles (dedup by UUID)
        3. Assets with blobs (dedup by UUID, hierarchy preserved)
        4. Runs with annotations + justifications (resolve refs via UUID map)
        """
        if package.metadata.package_type not in (ResourceType.PACKAGE, ResourceType.MIXED):
            raise ValueError(f"Unexpected package type: {package.metadata.package_type}")

        imported = {"schemas": [], "bundles": [], "assets": [], "runs": []}

        # 1. Schemas
        for schema_data in package.content.get("annotation_schemas", []):
            try:
                meta = PackageMetadata(
                    package_type=ResourceType.SCHEMA,
                    source_entity_uuid=str(schema_data.get("uuid")),
                )
                temp_pkg = DataPackage(metadata=meta, content={"annotation_schema": schema_data}, files={})
                schema = await self.import_annotation_schema_package(temp_pkg, conflict_strategy)
                if schema:
                    imported["schemas"].append(schema)
            except Exception as e:
                logger.error(f"Failed to import schema from package export: {e}", exc_info=True)

        # 2. Bundles
        for bundle_data in package.content.get("bundles", []):
            try:
                meta = PackageMetadata(
                    package_type=ResourceType.BUNDLE,
                    source_entity_uuid=str(bundle_data.get("uuid")),
                )
                temp_pkg = DataPackage(metadata=meta, content={"bundle": bundle_data}, files=package.files)
                bundle = await self.import_bundle_package(temp_pkg, conflict_strategy)
                if bundle:
                    imported["bundles"].append(bundle)
            except Exception as e:
                logger.error(f"Failed to import bundle from package export: {e}", exc_info=True)

        # 3. Assets
        for asset_data in package.content.get("assets", []):
            try:
                asset = await self._import_asset_data(asset_data, package.files, parent_source_id=None)
                if asset:
                    imported["assets"].append(asset)
            except Exception as e:
                logger.error(f"Failed to import asset from package export: {e}", exc_info=True)

        # 4. Runs (with annotations)
        for run_data in package.content.get("annotation_runs", []):
            try:
                meta = PackageMetadata(
                    package_type=ResourceType.RUN,
                    source_entity_uuid=str(run_data.get("uuid")),
                )
                # Build a run-shaped content dict for import_annotation_run_package
                run_content = dict(run_data)
                temp_pkg = DataPackage(
                    metadata=meta,
                    content={"annotation_run": run_content},
                    files=package.files,
                )
                run = await self.import_annotation_run_package(temp_pkg, conflict_strategy)
                if run:
                    imported["runs"].append(run)
            except Exception as e:
                logger.error(f"Failed to import run from package export: {e}", exc_info=True)

        total = sum(len(v) for v in imported.values())
        logger.info(f"Imported {total} entities from package export: {', '.join(f'{k}={len(v)}' for k, v in imported.items())}")
        return imported


class PackageService:
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        asset_service: AssetService,
        annotation_service: AnnotationService,
        bundle_service: BundleService,
        dataset_service: DatasetService,
        settings: AppSettings
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.asset_service = asset_service
        self.annotation_service = annotation_service
        self.bundle_service = bundle_service
        self.dataset_service = dataset_service
        self.settings = settings
        self.source_instance_id = settings.INSTANCE_ID if hasattr(settings, 'INSTANCE_ID') else "unknown_instance"
        logger.info(f"PackageService initialized. Source Instance ID: {self.source_instance_id}")

    async def export_resource_package(
        self,
        resource_type: ResourceType,
        resource_id: int,
        user_id: int,
        infospace_id: int
    ) -> DataPackage:
        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider,
            source_instance_id=self.source_instance_id,
            settings=self.settings
        )

        if resource_type == ResourceType.ASSET:
            asset = self.asset_service.get_asset_by_id(asset_id=resource_id, infospace_id=infospace_id, user_id=user_id)
            if not asset: raise ValueError(f"Asset {resource_id} not found or not accessible.")
            return await builder.build_asset_package(asset, include_annotations=True, include_justifications=True)
        elif resource_type == ResourceType.SOURCE:
            # Direct database access for Sources with validation
            source = self.session.get(Source, resource_id)
            if not source or source.infospace_id != infospace_id:
                raise ValueError(f"Source {resource_id} not found or not accessible.")
            return await builder.build_source_package(source, include_assets=True)
        elif resource_type == ResourceType.SCHEMA:
            schema = self.annotation_service.get_schema(schema_id=resource_id, infospace_id=infospace_id, user_id=user_id)
            if not schema or schema.infospace_id != infospace_id: 
                raise ValueError(f"Schema {resource_id} not found or not accessible in infospace {infospace_id}.")
            return await builder.build_annotation_schema_package(schema)
        elif resource_type == ResourceType.RUN:
            run = self.annotation_service.get_run_details(run_id=resource_id, infospace_id=infospace_id, user_id=user_id)
            if not run or run.infospace_id != infospace_id: 
                raise ValueError(f"Run {resource_id} not found or not accessible in infospace {infospace_id}.")
            return await builder.build_annotation_run_package(run, include_annotations=True, include_justifications=True)
        elif resource_type == ResourceType.BUNDLE:
            bundle = self.bundle_service.get_bundle(bundle_id=resource_id, infospace_id=infospace_id, user_id=user_id)
            if not bundle: raise ValueError(f"Bundle {resource_id} not found or not accessible.")
            return await builder.build_bundle_package(bundle, include_assets_content=True, include_asset_annotations=True)
        elif resource_type == ResourceType.DATASET:
            dataset = self.dataset_service.get_dataset(dataset_id=resource_id, user_id=user_id, infospace_id=infospace_id)
            if not dataset or dataset.infospace_id != infospace_id: 
                raise ValueError(f"Dataset {resource_id} not found or not accessible in infospace {infospace_id}.")
            return await builder.build_dataset_package(dataset, include_assets=True, include_annotations=True)
        else:
            raise NotImplementedError(f"Export for resource type {resource_type} not implemented in PackageService.")

    async def import_resource_package(
        self,
        package: DataPackage,
        target_user_id: int,
        target_infospace_id: int,
        conflict_strategy: str = 'skip'
    ) -> Any:
        importer = PackageImporter(
            session=self.session,
            storage_provider=self.storage_provider,
            target_infospace_id=target_infospace_id,
            target_user_id=target_user_id,
            settings=self.settings,
            asset_service=self.asset_service
        )
        
        pt = package.metadata.package_type
        imported_entity: Optional[Any] = None

        if pt == ResourceType.SOURCE:
            imported_entity = await importer.import_source_package(package, conflict_strategy)
            if imported_entity and imported_entity.kind in ["upload_csv", "upload_pdf", "url_list_scrape", "rss_feed"]:
                from app.api.modules.content.tasks.ingest import process_source
                process_source.delay([imported_entity.id], imported_entity.infospace_id)
                logger.info(f"Queued process_source task for imported Source ID: {imported_entity.id} (Kind: {imported_entity.kind})")
        elif pt == ResourceType.ASSET:
            logger.warning("Direct import of single Asset package. Asset will be imported without an explicit parent Source unless its package data specifies one or it can be inferred.")
            asset_content_from_package = package.content.get("asset")
            if not asset_content_from_package:
                raise ValueError("Asset content missing in Asset package.")
            imported_entity = await importer._import_asset_data(asset_content_from_package, package.files, parent_source_id=None)
        elif pt == ResourceType.SCHEMA:
            imported_entity = await importer.import_annotation_schema_package(package, conflict_strategy)
        elif pt == ResourceType.RUN:
            imported_entity = await importer.import_annotation_run_package(package, conflict_strategy)
        elif pt == ResourceType.DATASET:
            imported_entity = await importer.import_dataset_package(package, conflict_strategy)
        elif pt == ResourceType.BUNDLE:
            imported_entity = await importer.import_bundle_package(package, conflict_strategy)
        elif pt == ResourceType.MIXED:
            imported_entity = await importer.import_mixed_package(package, conflict_strategy)
        else:
            raise NotImplementedError(f"Import for resource type {pt} not implemented in PackageService.")
        
        if imported_entity:
            self.session.commit()

            # --- NEW: Trigger processing AFTER commit ---
            assets_to_process = []
            if pt == ResourceType.ASSET:
                assets_to_process.append(imported_entity)
            elif pt == ResourceType.BUNDLE:
                if hasattr(imported_entity, 'assets'):
                    assets_to_process.extend(imported_entity.assets)
            elif pt == ResourceType.SOURCE:
                 if hasattr(imported_entity, 'assets'):
                    assets_to_process.extend(imported_entity.assets)
            
            for asset in assets_to_process:
                if self.asset_service._needs_processing(asset.kind):
                    self.asset_service._trigger_content_processing(asset)
            # --- END NEW ---

            if hasattr(imported_entity, 'id') and imported_entity.id is not None:
                self.session.refresh(imported_entity)
            logger.info(f"Successfully imported and committed {pt.value} (Original UUID: {package.metadata.source_entity_uuid}, New ID: {getattr(imported_entity, 'id', 'N/A')})")
            return imported_entity
        else:
            self.session.rollback()
            raise ValueError(f"Failed to import {pt.value} from package, operation rolled back.")

    async def export_infospace(
        self,
        infospace: Infospace,
        user_id: int,
        include_sources: bool = True,
        include_schemas: bool = True,
        include_runs: bool = True,
        include_datasets: bool = True,
        include_assets_for_sources: bool = True,
        include_annotations_for_runs: bool = True,
        include_chunks: bool = False,
        include_embeddings: bool = False,
    ) -> "DataPackage":
        """Export an infospace configuration and its contents as a DataPackage."""
        if not self.storage_provider:
            raise RuntimeError("Infospace export requires a configured storage provider.")

        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider,
            source_instance_id=self.source_instance_id,
            settings=self.settings,
        )

        package_metadata = PackageMetadata(
            package_type=ResourceType.INFOSPACE,
            source_entity_uuid=str(infospace.uuid),
            source_instance_id=self.source_instance_id,
            description=f"Export of Infospace: {infospace.name} (ID: {infospace.id})",
            created_by=str(user_id),
        )

        infospace_package_content: Dict[str, Any] = {
            "infospace_details": InfospaceRead.model_validate(infospace).model_dump(exclude_none=True),
            "bundles_content": [],
            "sources_content": [],
            "annotation_schemas_content": [],
            "annotation_runs_content": [],
            "datasets_content": [],
        }

        if infospace.bundles:
            for bundle_item in infospace.bundles:
                try:
                    bundle_package = await builder.build_bundle_package(
                        bundle_item,
                        include_assets_content=False,
                        include_asset_annotations=False,
                    )
                    infospace_package_content["bundles_content"].append(bundle_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Bundle {bundle_item.id}: {e}", exc_info=True)

        if include_sources and infospace.sources:
            for ds in infospace.sources:
                try:
                    ds_package = await builder.build_source_package(
                        ds,
                        include_assets=include_assets_for_sources,
                        include_chunks=include_chunks,
                        include_embeddings=include_embeddings,
                    )
                    infospace_package_content["sources_content"].append(ds_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Source {ds.id}: {e}", exc_info=True)

        if include_schemas and infospace.schemas:
            for schema_item in infospace.schemas:
                try:
                    schema_package = await builder.build_annotation_schema_package(schema_item)
                    infospace_package_content["annotation_schemas_content"].append(schema_package.content)
                except Exception as e:
                    logger.error(f"Failed to package AnnotationSchema {schema_item.id}: {e}", exc_info=True)

        if include_runs and infospace.runs:
            for run_item in infospace.runs:
                try:
                    run_package = await builder.build_annotation_run_package(
                        run_item,
                        include_annotations=include_annotations_for_runs,
                        include_chunks=include_chunks,
                        include_embeddings=include_embeddings,
                    )
                    infospace_package_content["annotation_runs_content"].append(run_package.content)
                except Exception as e:
                    logger.error(f"Failed to package AnnotationRun {run_item.id}: {e}", exc_info=True)

        if include_datasets and infospace.datasets:
            for dataset_item in infospace.datasets:
                try:
                    dataset_package = await builder.build_dataset_package(
                        dataset_item,
                        include_assets=True,
                        include_annotations=True,
                        include_chunks=include_chunks,
                        include_embeddings=include_embeddings,
                    )
                    infospace_package_content["datasets_content"].append(dataset_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Dataset {dataset_item.id}: {e}", exc_info=True)

        return DataPackage(metadata=package_metadata, content=infospace_package_content, files=builder.files)

    async def import_infospace(
        self,
        user_id: int,
        filepath: str,
        infospace_service: Any,
    ) -> Infospace:
        """Import an infospace from a comprehensive ZIP package."""
        if not self.storage_provider:
            raise RuntimeError("Infospace import requires a configured storage provider.")

        logger.info(f"Starting import of infospace from package file: {filepath} for user {user_id}")

        try:
            main_package = DataPackage.from_zip(filepath)
            if main_package.metadata.package_type != ResourceType.INFOSPACE:
                raise ValueError(f"Invalid package type. Expected '{ResourceType.INFOSPACE.value}', got '{main_package.metadata.package_type}'")

            ws_details = main_package.content.get("infospace_details")
            if not ws_details:
                raise ValueError("Infospace package content is missing 'infospace_details'.")

            new_infospace_name = ws_details.get("name", "Imported Infospace") + f" (Imported {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})"

            # Reconstruct enrichment_config from package data
            enrichment_config = ws_details.get("enrichment_config")
            if not enrichment_config:
                # Legacy: convert embedding_selection or embedding_model into enrichment_config
                embedding_selection = ws_details.get("embedding_selection")
                if not embedding_selection and ws_details.get("embedding_model"):
                    embedding_selection = {
                        "provider_key": "ollama",
                        "model_name": ws_details["embedding_model"],
                    }
                if embedding_selection:
                    enrichment_config = {"embedding": embedding_selection}

            infospace_create_data = InfospaceCreate(
                name=new_infospace_name,
                description=ws_details.get("description", "Imported infospace"),
                owner_id=user_id,
                icon=ws_details.get("icon"),
                enrichment_config=enrichment_config,
                chunk_size=ws_details.get("chunk_size"),
                chunk_overlap=ws_details.get("chunk_overlap"),
                chunk_strategy=ws_details.get("chunk_strategy"),
            )
            created_infospace = infospace_service.create_infospace(user_id=user_id, infospace_in=infospace_create_data)
            logger.info(f"Created new infospace '{created_infospace.name}' (ID: {created_infospace.id}) for import.")

            asset_service = AssetService(session=self.session, storage_provider=self.storage_provider)
            importer = PackageImporter(
                session=self.session,
                storage_provider=self.storage_provider,
                target_infospace_id=created_infospace.id,
                target_user_id=user_id,
                settings=self.settings,
                asset_service=asset_service,
            )

            bundle_contents_for_linking = []
            for bundle_content in main_package.content.get("bundles_content", []):
                try:
                    bundle_meta = PackageMetadata(package_type=ResourceType.BUNDLE, source_entity_uuid=bundle_content.get("bundle", {}).get("uuid", str(uuid.uuid4())))
                    temp_bundle_package = DataPackage(metadata=bundle_meta, content=bundle_content, files={})
                    await importer.import_bundle_package(temp_bundle_package)
                    bundle_contents_for_linking.append(bundle_content)
                except Exception as e:
                    logger.error(f"Failed to import Bundle structure: {e}", exc_info=True)

            for ds_content in main_package.content.get("sources_content", []):
                try:
                    ds_meta = PackageMetadata(package_type=ResourceType.SOURCE, source_entity_uuid=ds_content.get("source", {}).get("uuid", str(uuid.uuid4())))
                    temp_ds_package = DataPackage(metadata=ds_meta, content=ds_content, files=main_package.files)
                    await importer.import_source_package(temp_ds_package)
                except Exception as e:
                    logger.error(f"Failed to import a Source: {e}", exc_info=True)

            for schema_content in main_package.content.get("annotation_schemas_content", []):
                try:
                    schema_meta = PackageMetadata(package_type=ResourceType.SCHEMA, source_entity_uuid=schema_content.get("annotation_schema", {}).get("uuid", str(uuid.uuid4())))
                    temp_schema_package = DataPackage(metadata=schema_meta, content=schema_content, files={})
                    await importer.import_annotation_schema_package(temp_schema_package)
                except Exception as e:
                    logger.error(f"Failed to import AnnotationSchema: {e}", exc_info=True)

            for run_content in main_package.content.get("annotation_runs_content", []):
                try:
                    run_meta = PackageMetadata(package_type=ResourceType.RUN, source_entity_uuid=run_content.get("annotation_run", {}).get("uuid", str(uuid.uuid4())))
                    temp_run_package = DataPackage(metadata=run_meta, content=run_content, files={})
                    await importer.import_annotation_run_package(temp_run_package)
                except Exception as e:
                    logger.error(f"Failed to import AnnotationRun: {e}", exc_info=True)

            for dataset_content in main_package.content.get("datasets_content", []):
                try:
                    dataset_meta = PackageMetadata(package_type=ResourceType.DATASET, source_entity_uuid=dataset_content.get("dataset", {}).get("uuid", str(uuid.uuid4())))
                    temp_dataset_package = DataPackage(metadata=dataset_meta, content=dataset_content, files=main_package.files)
                    await importer.import_dataset_package(temp_dataset_package)
                except Exception as e:
                    logger.error(f"Failed to import Dataset: {e}", exc_info=True)

            for bundle_content in bundle_contents_for_linking:
                try:
                    bundle_data = bundle_content.get("bundle", {})
                    bundle_uuid = str(bundle_data.get("uuid"))
                    local_bundle_id = importer._get_local_id_from_source_uuid(ResourceType.BUNDLE.value, bundle_uuid)
                    if not local_bundle_id:
                        continue
                    bundle = self.session.get(Bundle, local_bundle_id)
                    if not bundle:
                        continue
                    asset_refs = bundle_data.get("asset_references", [])
                    linked_asset_ids = []
                    for asset_ref in asset_refs:
                        asset_uuid = str(asset_ref.get("uuid"))
                        if asset_uuid:
                            local_asset_id = importer._get_local_id_from_source_uuid(ResourceType.ASSET.value, asset_uuid)
                            if local_asset_id:
                                linked_asset_ids.append(local_asset_id)
                    if linked_asset_ids:
                        from app.core.tree import copy as tree_copy
                        result = tree_copy(self.session, asset_ids=linked_asset_ids, to=bundle.id)
                        bundle.asset_count = result.assets
                        self.session.add(bundle)
                except Exception as e:
                    logger.error(f"Failed to link assets to bundle: {e}", exc_info=True)

            self.session.commit()
            self.session.refresh(created_infospace)
            return created_infospace

        except ValueError:
            self.session.rollback()
            raise
        except Exception as e:
            self.session.rollback()
            logger.error(f"Critical error during infospace import: {e}", exc_info=True)
            raise RuntimeError(f"Infospace import failed: {str(e)}")
        finally:
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                except OSError:
                    pass