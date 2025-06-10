"""
Asset-Centric Ingestion Service
==============================

Refactored ingestion service that works primarily with assets.
Sources are optional and used only when needed for legacy compatibility.
"""
import logging
import hashlib
import json
import uuid
import fitz
import os
from typing import Any, Dict, List, Optional, Union, Tuple, Literal
from datetime import datetime, timezone

from fastapi import UploadFile, HTTPException, status
from sqlmodel import Session

from app.models import (
    Source, 
    SourceStatus, 
    AssetKind, 
    Asset,
    ProcessingStatus
)
from app.schemas import (
    SourceRead, SourceCreate, SourceUpdate, 
    AssetRead, AssetCreate, AssetUpdate,
)

from app.api.providers.base import StorageProvider, ScrapingProvider 
from app.api.services.service_utils import validate_infospace_access 
from app.api.services.asset_service import AssetService 
from app.api.tasks.ingest import process_source 

logger = logging.getLogger(__name__)

class IngestionService:
    """
    Asset-centric ingestion service.
    Creates assets directly without requiring sources as the primary hook.
    """
    
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        scraping_provider: Optional[ScrapingProvider] = None,
        asset_service: Optional[AssetService] = None
    ):
        """Initialize the ingestion service."""
        self.session = session
        self.storage_provider = storage_provider
        self.scraper = scraping_provider
        self.asset_service = asset_service or AssetService(session, storage_provider)
        logger.info("IngestionService initialized (asset-centric)")

    # ─────────────── Direct Asset Ingestion Methods ─────────────── #

    async def ingest_file(
        self,
        file: UploadFile,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Directly ingest a file upload as an asset.
        Automatically detects file type and triggers appropriate processing.
        """
        try:
            validate_infospace_access(self.session, infospace_id, user_id)
            
            # Determine asset kind from file extension
            file_ext = os.path.splitext(file.filename)[1].lower() if file.filename else ""
            asset_kind = self._detect_asset_kind_from_extension(file_ext)
            
            # Generate storage path
            storage_path = f"user_{user_id}/{uuid.uuid4()}{file_ext}"
            
            # Upload file to storage
            await self.storage_provider.upload_file(file, storage_path)
            
            # Create asset
            asset_title = title or file.filename or f"Uploaded {asset_kind.value}"
            asset_metadata = metadata or {}
            asset_metadata.update({
                "original_filename": file.filename,
                "file_size": file.size if hasattr(file, 'size') else None,
                "mime_type": file.content_type if hasattr(file, 'content_type') else None,
                "uploaded_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "direct_file"
            })
            
            asset_create = AssetCreate(
                title=asset_title,
                kind=asset_kind,
                user_id=user_id,
                infospace_id=infospace_id,
                blob_path=storage_path,
                source_metadata=asset_metadata
            )
            
            asset = self.asset_service.create_asset(asset_create)
            logger.info(f"Ingested file {file.filename} as asset {asset.id} ({asset_kind})")
            
            return asset
            
        except Exception as e:
            logger.exception(f"Error ingesting file {file.filename}: {e}")
            raise

    async def ingest_url(
        self,
        url: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Directly ingest a URL as a web asset.
        Triggers automatic scraping.
        """
        try:
            validate_infospace_access(self.session, infospace_id, user_id)
            
            asset_title = title or f"Web: {url}"
            asset_metadata = metadata or {}
            asset_metadata.update({
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "direct_url"
            })
            
            asset_create = AssetCreate(
                title=asset_title,
                kind=AssetKind.WEB,
                user_id=user_id,
                infospace_id=infospace_id,
                source_identifier=url,
                source_metadata=asset_metadata
            )
            
            asset = self.asset_service.create_asset(asset_create)
            logger.info(f"Ingested URL {url} as asset {asset.id}")
            
            return asset
            
        except Exception as e:
            logger.exception(f"Error ingesting URL {url}: {e}")
            raise

    def ingest_text(
        self,
        text_content: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None,
        event_timestamp: Optional[datetime] = None
    ) -> Asset:
        """
        Directly ingest text content as a text asset.
        """
        try:
            validate_infospace_access(self.session, infospace_id, user_id)
            
            asset_title = title or f"Text Content ({len(text_content)} chars)"
            asset_metadata = metadata or {}
            asset_metadata.update({
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "direct_text",
                "content_length": len(text_content)
            })
            
            asset_create = AssetCreate(
                title=asset_title,
                kind=AssetKind.TEXT,
                user_id=user_id,
                infospace_id=infospace_id,
                text_content=text_content,
                source_metadata=asset_metadata,
                event_timestamp=event_timestamp
            )
            
            asset = self.asset_service.create_asset(asset_create)
            logger.info(f"Ingested text content as asset {asset.id}")
            
            return asset
            
        except Exception as e:
            logger.exception(f"Error ingesting text content: {e}")
            raise

    async def ingest_multiple_urls(
        self,
        urls: List[str],
        infospace_id: int,
        user_id: int,
        base_title: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Ingest multiple URLs as separate web assets.
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        assets = []
        base_metadata = metadata or {}
        
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                url_metadata = base_metadata.copy()
                url_metadata.update({
                    "batch_index": i,
                    "batch_total": len(urls)
                })
                
                asset = await self.ingest_url(
                    url=url,
                    infospace_id=infospace_id,
                    user_id=user_id,
                    title=url_title,
                    metadata=url_metadata
                )
                assets.append(asset)
                
            except Exception as e:
                logger.error(f"Failed to ingest URL {url} in batch: {e}")
                continue
        
        logger.info(f"Ingested {len(assets)}/{len(urls)} URLs successfully")
        return assets

    def _detect_asset_kind_from_extension(self, file_ext: str) -> AssetKind:
        """Detect asset kind from file extension."""
        extension_map = {
            '.pdf': AssetKind.PDF,
            '.csv': AssetKind.CSV,
            '.txt': AssetKind.TEXT,
            '.md': AssetKind.TEXT,
            '.json': AssetKind.TEXT,
            '.jpg': AssetKind.IMAGE,
            '.jpeg': AssetKind.IMAGE,
            '.png': AssetKind.IMAGE,
            '.gif': AssetKind.IMAGE,
            '.webp': AssetKind.IMAGE,
            '.mp3': AssetKind.AUDIO,
            '.wav': AssetKind.AUDIO,
            '.ogg': AssetKind.AUDIO,
            '.mp4': AssetKind.VIDEO,
            '.avi': AssetKind.VIDEO,
            '.mov': AssetKind.VIDEO,
            '.webm': AssetKind.VIDEO,
            '.mbox': AssetKind.MBOX,
            '.eml': AssetKind.EMAIL
        }
        
        return extension_map.get(file_ext.lower(), AssetKind.FILE)

    def get_supported_file_types(self) -> Dict[str, List[str]]:
        """Get list of supported file types organized by category."""
        return {
            "documents": [".pdf", ".txt", ".md"],
            "data": [".csv", ".json"],
            "images": [".jpg", ".jpeg", ".png", ".gif", ".webp"],
            "audio": [".mp3", ".wav", ".ogg"],
            "video": [".mp4", ".avi", ".mov", ".webm"],
            "email": [".mbox", ".eml"],
            "other": [".zip", ".tar", ".gz"]
        }

    # ─────────────── Legacy Source-Based Methods (Optional) ─────────────── #

    async def create_source(
        self,
        *,
        infospace_id: int,
        user_id: int,
        name: str,
        kind: str, 
        details_str: Optional[str] = "{}", 
        source_metadata_str: Optional[str] = "{}",
        initial_status: SourceStatus = SourceStatus.PENDING
    ) -> SourceRead:
        """Legacy method: Create a source (now optional, mainly for batch operations)."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        try:
            details_dict = json.loads(details_str) if details_str else {}
            source_metadata_dict = json.loads(source_metadata_str) if source_metadata_str else {}
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in details_str or source_metadata_str: {e}")
            raise ValueError(f"Invalid JSON provided: {e}")

        db_source = Source(
            name=name,
            kind=kind,
            details=details_dict,
            source_metadata=source_metadata_dict,
            infospace_id=infospace_id,
            user_id=user_id,
            status=initial_status
        )
        self.session.add(db_source)
        self.session.commit()
        self.session.refresh(db_source)
        
        logger.info(f"Source '{db_source.name}' (ID: {db_source.id}) created for legacy compatibility")
        return SourceRead.model_validate(db_source)

    def list_assets_for_infospace(
        self,
        infospace_id: int,
        user_id: int,
        skip: int = 0,
        limit: int = 100,
        kind: Optional[AssetKind] = None
    ) -> List[Asset]:
        """List assets in an infospace (replaces source-based listing)."""
        return self.asset_service.list_assets(
            infospace_id=infospace_id,
            user_id=user_id,
            skip=skip,
            limit=limit,
            filter_kind=kind
        )