"""
Source Service
=============

Service for managing Source model operations and bridging the unified AssetDiscoveryService
with existing Source-based workflows. This service handles:
- Source CRUD operations
- Integration with AssetDiscoveryService for content discovery
- Source status management and monitoring
- Legacy Source model compatibility
"""

import logging
import json
from typing import Optional, List, Dict, Any, Tuple, Union
from datetime import datetime, timezone
from sqlmodel import Session, select, func
from fastapi import HTTPException

from app.models import (
    Source, 
    SourceStatus, 
    Asset,
    AssetKind,
    ProcessingStatus
)
from app.schemas import SourceCreate, SourceUpdate, SourceRead
from app.api.services.service_utils import validate_infospace_access
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.tasks.ingest import process_source
from app.core.config import settings

logger = logging.getLogger(__name__)

class SourceService:
    """
    Service for managing Source operations and integration with unified asset discovery.
    
    This service provides:
    - Source CRUD operations
    - Integration with AssetDiscoveryService for modern content discovery
    - Legacy Source model support for existing workflows
    - Source status tracking and monitoring
    """
    
    def __init__(self, session: Session, content_ingestion_service: Optional[ContentIngestionService] = None):
        self.session = session
        self.content_ingestion_service = content_ingestion_service or ContentIngestionService(session)
        logger.info("SourceService initialized")
    
    # ─────────────── SOURCE CRUD OPERATIONS ─────────────── #
    
    def create_source(
        self,
        user_id: int,
        infospace_id: int,
        source_in: SourceCreate
    ) -> Source:
        """
        Create a new Source.
        
        Args:
            user_id: User creating the source
            infospace_id: Target infospace
            source_in: Source creation data
            
        Returns:
            Created Source object
        """
        logger.info(f"Creating source '{source_in.name}' in infospace {infospace_id}")
        
        # Validate access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Create source
        source_data = source_in.model_dump()
        source = Source(
            **source_data,
            infospace_id=infospace_id,
            user_id=user_id,
            status=SourceStatus.PENDING,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source '{source.name}' (ID: {source.id}) created successfully")
        return source
    
    def get_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int
    ) -> Optional[Source]:
        """Get a source by ID with access validation."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        source = self.session.get(Source, source_id)
        if source and source.infospace_id == infospace_id:
            return source
        return None
    
    def list_sources(
        self,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[SourceStatus] = None,
        kind_filter: Optional[str] = None
    ) -> Tuple[List[Source], int]:
        """List sources with optional filtering."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        query = select(Source).where(
            Source.infospace_id == infospace_id,
            Source.user_id == user_id
        )
        
        if status_filter:
            query = query.where(Source.status == status_filter)
        if kind_filter:
            query = query.where(Source.kind == kind_filter)
        
        # Get total count
        count_query = select(func.count(Source.id)).where(
            Source.infospace_id == infospace_id,
            Source.user_id == user_id
        )
        if status_filter:
            count_query = count_query.where(Source.status == status_filter)
        if kind_filter:
            count_query = count_query.where(Source.kind == kind_filter)
        
        total_count = self.session.exec(count_query).one()
        
        # Get paginated results
        query = query.order_by(Source.created_at.desc()).offset(skip).limit(limit)
        sources = list(self.session.exec(query))
        
        return sources, total_count
    
    def update_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        source_update: SourceUpdate
    ) -> Optional[Source]:
        """Update a source."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return None
        
        update_data = source_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(source, field, value)
        
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} updated successfully")
        return source
    
    def delete_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        """Delete a source and optionally its assets."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False
        
        # Delete associated assets
        assets = self.session.exec(
            select(Asset).where(Asset.source_id == source_id)
        ).all()
        
        for asset in assets:
            self.session.delete(asset)
        
        # Delete source
        self.session.delete(source)
        self.session.commit()
        
        logger.info(f"Source {source_id} and {len(assets)} associated assets deleted")
        return True
    
    # ─────────────── UNIFIED DISCOVERY INTEGRATION ─────────────── #
    
    async def create_source_and_discover_assets(
        self,
        user_id: int,
        infospace_id: int,
        source_in: SourceCreate,
        discovery_options: Optional[Dict[str, Any]] = None,
        processing_options: Optional[Dict[str, Any]] = None,
        bundle_id: Optional[int] = None
    ) -> Tuple[Source, List[Asset]]:
        """
        Create a source and immediately discover assets using the unified discovery service.
        
        This bridges the old Source model with the new unified discovery system.
        """
        logger.info(f"Creating source and discovering assets for '{source_in.name}'")
        
        # Create the source first
        source = self.create_source(user_id, infospace_id, source_in)
        
        try:
            # Extract discovery locator from source details
            locator = self._extract_locator_from_source(source)
            
            # Use unified discovery service
            assets = await self.content_ingestion_service.ingest_content(
                locator=locator,
                infospace_id=infospace_id,
                user_id=user_id,
                bundle_id=bundle_id,
                options={**(discovery_options or {}), **(processing_options or {})}
            )
            
            # Link assets to the source
            for asset in assets:
                asset.source_id = source.id
                self.session.add(asset)
            
            # Update source status
            source.status = SourceStatus.COMPLETE
            source.updated_at = datetime.now(timezone.utc)
            
            # Add discovery metadata to source
            if source.source_metadata is None:
                source.source_metadata = {}
            source.source_metadata.update({
                'assets_discovered': len(assets),
                'discovery_method': 'unified_asset_discovery',
                'completed_at': datetime.now(timezone.utc).isoformat()
            })
            
            self.session.add(source)
            self.session.commit()
            
            logger.info(f"Source {source.id} created with {len(assets)} discovered assets")
            return source, assets
            
        except Exception as e:
            logger.error(f"Failed to discover assets for source {source.id}: {e}")
            # Mark source as failed
            source.status = SourceStatus.FAILED
            source.error_message = str(e)
            self.session.add(source)
            self.session.commit()
            raise
    
    def _extract_locator_from_source(self, source: Source) -> Union[str, List[str]]:
        """
        Extracts the primary content locator (e.g., URL, search query) from a Source's details.
        This is the bridge between a stored Source configuration and the AssetDiscoveryService.

        Args:
            source: The Source object.

        Returns:
            A string or list of strings that can be used by the AssetDiscoveryService.

        Raises:
            ValueError: If a suitable locator cannot be found for the source kind.
        """
        details = source.details or {}
        kind = source.kind

        # Define a mapping from source kind to the expected key in the details dict.
        # The order can imply priority if multiple keys could exist.
        KIND_TO_LOCATOR_KEY_MAP = {
            "rss_feed": "feed_url",
            "url_monitor": "urls",
            "site_discovery": "base_url",
            "url_list": "urls",
            "url_list_scrape": "urls", # Legacy compatibility
            "upload_csv": "storage_path",
            "upload_pdf": "storage_path",
            "text_block_ingest": "text_content",
            "search": "search_config", # Special case, returns a dict
            "search_monitor": "search_config" # Special case, returns a dict
        }

        locator_key = KIND_TO_LOCATOR_KEY_MAP.get(kind)

        if not locator_key:
            raise ValueError(f"Unknown or unhandled source kind '{kind}' for locator extraction.")

        locator = details.get(locator_key)

        if kind in ["search", "search_monitor"]:
            if isinstance(locator, dict) and "query" in locator:
                # For search kinds, the locator is the query string itself.
                return locator["query"]
        else:
                raise ValueError(f"Source kind '{kind}' requires a 'search_config' dict with a 'query' key in details.")

        if locator is None:
            # Fallback for legacy or misconfigured sources
            for fallback_key in ["url", "urls", "query", "feed_url", "base_url", "text_content"]:
                if fallback_key in details:
                    logger.warning(f"Source {source.id} (kind: {kind}) is missing primary locator key '{locator_key}'. Using fallback '{fallback_key}'.")
                    return details[fallback_key]
            raise ValueError(f"Could not find a valid locator for source {source.id} (kind: {kind}) using key '{locator_key}'. Details are missing the required field.")

        # Basic type validation
        if kind in ["url_list", "url_monitor", "url_list_scrape"] and not isinstance(locator, list):
            raise ValueError(f"Source kind '{kind}' expects the locator '{locator_key}' to be a list of strings.")
        if kind in ["rss_feed", "site_discovery", "upload_csv", "upload_pdf", "text_block_ingest"] and not isinstance(locator, str):
            raise ValueError(f"Source kind '{kind}' expects the locator '{locator_key}' to be a string.")

        return locator
    
    # ─────────────── LEGACY PROCESSING SUPPORT ─────────────── #
    
    def trigger_source_processing(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        override_details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Trigger legacy source processing via Celery task.
        
        This maintains compatibility with existing Source-based workflows.
        """
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False
        
        try:
            # Use existing Celery task for legacy processing
            process_source.delay(source.id, override_details)
            
            # Update source status
            source.status = SourceStatus.PROCESSING
            source.updated_at = datetime.now(timezone.utc)
            self.session.add(source)
            self.session.commit()
            
            logger.info(f"Triggered legacy processing for source {source_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to trigger processing for source {source_id}: {e}")
            return False
    
    # ─────────────── SOURCE ANALYTICS ─────────────── #
    
    def get_source_stats(
        self,
        user_id: int,
        infospace_id: int
    ) -> Dict[str, Any]:
        """Get statistics about sources in an infospace."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Total sources
        total_sources = self.session.exec(
            select(func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            )
        ).one()
        
        # Sources by status
        status_counts = self.session.exec(
            select(Source.status, func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            ).group_by(Source.status)
        ).all()
        
        # Sources by kind
        kind_counts = self.session.exec(
            select(Source.kind, func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            ).group_by(Source.kind)
        ).all()
        
        # Total assets from sources
        total_assets = self.session.exec(
            select(func.count(Asset.id)).join(Source).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            )
        ).one()
        
        return {
            "total_sources": total_sources,
            "total_assets_from_sources": total_assets,
            "status_counts": dict(status_counts),
            "kind_counts": dict(kind_counts)
        }
    
    def get_source_assets(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Asset]:
        """Get assets associated with a source."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return []
        
        query = (
            select(Asset)
            .where(Asset.source_id == source_id)
            .order_by(Asset.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        
        return list(self.session.exec(query))
    
    # ─────────────── UTILITY METHODS ─────────────── #
    
    def get_supported_source_kinds(self) -> List[str]:
        """Get list of supported source kinds."""
        return [
            "url_list",
            "rss_feed", 
            "search",
            "url_monitor",
            "site_discovery",
            "text_block_ingest",
            "upload_csv",
            "upload_pdf"
        ]
    
    def validate_source_details(self, kind: str, details: Dict[str, Any]) -> bool:
        """Validate source details for a given kind."""
        try:
            if kind == "url_list":
                return "urls" in details and isinstance(details["urls"], list)
            elif kind == "rss_feed":
                return "feed_url" in details and isinstance(details["feed_url"], str)
            elif kind == "search":
                return "search_config" in details and "query" in details["search_config"]
            elif kind == "url_monitor":
                return "urls" in details and isinstance(details["urls"], list)
            elif kind == "site_discovery":
                return "base_url" in details and isinstance(details["base_url"], str)
            elif kind == "text_block_ingest":
                return "text_content" in details and isinstance(details["text_content"], str)
            elif kind in ["upload_csv", "upload_pdf"]:
                return "storage_path" in details and isinstance(details["storage_path"], str)
            else:
                return False
        except Exception:
            return False 