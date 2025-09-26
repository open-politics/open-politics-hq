import logging
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select
import asyncio

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import AssetCreate, AssetUpdate
from app.api.providers.base import StorageProvider
from app.core.celery_app import celery

logger = logging.getLogger(__name__)

class AssetService:
    def __init__(self, session: Session, storage_provider: StorageProvider):
        self.session = session
        self.storage_provider = storage_provider
        logger.info("AssetService initialized.")

    def _needs_background_processing(self, asset_kind: AssetKind) -> bool:
        """
        Determines if an asset of a given kind requires asynchronous background processing
        to extract child assets or scrape content.
        """
        return asset_kind in [
            AssetKind.CSV, 
            AssetKind.PDF, 
            AssetKind.WEB,
            AssetKind.MBOX,
            # Add other kinds that have heavy processing tasks
        ]
    
    def _trigger_content_processing(self, asset_id: int, options: Optional[Dict[str, Any]] = None) -> None:
        """Dispatches a background task to process the asset's content."""
        try:
            # Note: We now use the task from content_tasks.py
            from app.api.tasks.content_tasks import process_content
            process_content.delay(asset_id, options=options)
            logger.info(f"Triggered content processing task for asset {asset_id}")
        except Exception as e:
            logger.error(f"Failed to trigger content processing for asset {asset_id}: {e}", exc_info=True)
            # In a real-world scenario, you might want to update the asset status to FAILED here
            # but that would require another DB transaction. For now, we log the error.

    def create_asset(self, asset_create: AssetCreate, process_immediately: bool = False) -> Asset:
        """
        Creates a new asset and triggers background processing if necessary.
        This is the single, canonical method for creating any asset.
        """
        if asset_create.user_id is None or asset_create.infospace_id is None:
            raise ValueError("user_id and infospace_id are required for asset creation")
            
        asset_data = asset_create.model_dump(exclude_unset=True)

        # Smart dedupe policy:
        # 1) If source_identifier exists, try to find the latest asset with same source_identifier in the same infospace.
        #    - If content_hash provided and matches, skip and return existing.
        #    - If content differs or no content_hash yet, create a new version linking previous_asset_id in source_metadata.
        # 2) If content_hash provided (e.g., text/file), dedupe by content_hash within infospace.

        existing_by_source = None
        if asset_data.get("source_identifier"):
            existing_by_source = self.session.exec(
                select(Asset)
                .where(
                    Asset.infospace_id == asset_data["infospace_id"],
                    Asset.source_identifier == asset_data["source_identifier"],
                )
                .order_by(Asset.created_at.desc())
            ).first()

        if existing_by_source is not None:
            incoming_hash = asset_data.get("content_hash")
            if incoming_hash and existing_by_source.content_hash == incoming_hash:
                # Exact duplicate: skip and return existing
                return existing_by_source
            # Versioned duplicate: chain to previous
            sm = dict(asset_data.get("source_metadata") or {})
            sm["previous_asset_id"] = existing_by_source.id
            sm["version"] = (existing_by_source.source_metadata or {}).get("version", 1) + 1
            asset_data["source_metadata"] = sm
            # Set first-class column too
            asset_data["previous_asset_id"] = existing_by_source.id

        # Dedupe by content hash if available
        if asset_data.get("content_hash"):
            existing_by_hash = self.session.exec(
                select(Asset)
                .where(
                    Asset.infospace_id == asset_data["infospace_id"],
                    Asset.content_hash == asset_data["content_hash"],
                )
                .order_by(Asset.created_at.desc())
            ).first()
            if existing_by_hash is not None:
                # If also same source_identifier, we already handled above; else treat as duplicate-of with different source
                if asset_data.get("source_identifier") == existing_by_hash.source_identifier:
                    return existing_by_hash
                sm = dict(asset_data.get("source_metadata") or {})
                sm["duplicate_of_asset_id"] = existing_by_hash.id
                asset_data["source_metadata"] = sm
        
        # Contract: The initial status depends on whether it needs background processing.
        if self._needs_background_processing(asset_create.kind):
            asset_data["processing_status"] = ProcessingStatus.PENDING
        else:
            asset_data["processing_status"] = ProcessingStatus.READY
        
        asset = Asset(**asset_data)
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        # Contract: If it needs processing, dispatch a background task.
        # The `process_immediately` flag is now gone from the service layer call,
        # but kept here in case some internal logic needs it. In general, processing
        # should be async. The ContentService will handle immediate processing if needed.
        if self._needs_background_processing(asset.kind):
            self._trigger_content_processing(asset.id)
        
        return asset

    def get_asset(self, asset_id: int) -> Optional[Asset]:
        """Get an asset by ID."""
        return self.session.get(Asset, asset_id)

    def get_asset_by_id(self, asset_id: int, infospace_id: int, user_id: int) -> Optional[Asset]:
        """Get an asset by ID with access validation."""
        asset = self.session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            return None
        # Note: You might want to add user access validation here
        return asset

    def list_assets(
        self, 
        infospace_id: int, 
        user_id: int,
        skip: int = 0, 
        limit: int = 100,
        filter_kind: Optional[AssetKind] = None,
        parent_asset_id: Optional[int] = None
    ) -> List[Asset]:
        """List assets with optional filtering."""
        query = select(Asset).where(
            Asset.infospace_id == infospace_id,
            Asset.user_id == user_id
        )
        
        if filter_kind:
            query = query.where(Asset.kind == filter_kind)
        
        if parent_asset_id is not None:
            query = query.where(Asset.parent_asset_id == parent_asset_id)
        
        query = query.offset(skip).limit(limit).order_by(Asset.created_at.desc())
        
        return self.session.exec(query).all()

    def get_assets_by_ids(self, asset_ids: List[int], infospace_id: int) -> List[Asset]:
        """Get multiple assets by ID, ensuring they belong to the specified infospace."""
        if not asset_ids:
            return []
        
        assets = self.session.exec(
            select(Asset)
            .where(Asset.id.in_(asset_ids))
            .where(Asset.infospace_id == infospace_id)
        ).all()
        
        return list(assets)

    def update_asset(self, asset_id: int, asset_update: AssetUpdate) -> Optional[Asset]:
        """Update an existing asset."""
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return None
        
        update_data = asset_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(asset, field, value)
        
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        return asset

    def delete_asset(self, asset_id: int) -> bool:
        """Delete an asset and its children."""
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return False
        
        # Delete children first
        children = self.session.exec(
            select(Asset).where(Asset.parent_asset_id == asset_id)
        ).all()
        
        for child in children:
            self.session.delete(child)
        
        # Delete the asset itself
        self.session.delete(asset)
        self.session.commit()
        
        return True

    def reprocess_asset(self, asset_id: int, options: Optional[Dict[str, Any]] = None) -> bool:
        """Trigger reprocessing of an asset with new options."""
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return False
        
        if not self._needs_background_processing(asset.kind):
            logger.warning(f"Asset {asset_id} of kind {asset.kind} does not support reprocessing")
            return False
        
        try:
            # Note: We now use the task from content_tasks.py
            from app.api.tasks.content_tasks import reprocess_content
            reprocess_content.delay(asset.id, options=options)
            logger.info(f"Triggered reprocessing for asset {asset.id} with options: {options}")
            return True
        except Exception as e:
            logger.error(f"Failed to trigger reprocessing for asset {asset.id}: {e}")
            return False

    async def search_assets(
        self,
        user_id: int,
        infospace_id: int,
        query: str,
        search_method: str,
        asset_kinds: List[AssetKind],
        limit: int,
        distance_threshold: float,
    ) -> List[Asset]:
        """
        Unified asset search with text, semantic, and hybrid methods.
        
        Args:
            user_id: ID of the user performing the search
            infospace_id: ID of the infospace to search within
            query: The search query string
            search_method: 'text', 'semantic', or 'hybrid'
            asset_kinds: List of AssetKind enums to filter by
            limit: Maximum number of results to return
            distance_threshold: Similarity threshold for semantic search
        
        Returns:
            A list of Asset objects matching the search criteria.
        """
        from app.api.services.content_ingestion_service import ContentIngestionService
        
        content_ingestion_service = ContentIngestionService(session=self.session)
        
        options = {
            "asset_kinds": [kind.value for kind in asset_kinds],
            "distance_threshold": distance_threshold
        }
        
        if search_method == "text":
            return await content_ingestion_service.search_assets_text(
                query, infospace_id, limit, options
            )
        elif search_method == "semantic":
            return await content_ingestion_service.search_assets_semantic(
                query, infospace_id, limit, options
            )
        elif search_method == "hybrid":
            text_task = content_ingestion_service.search_assets_text(
                query, infospace_id, max(1, limit // 2), options
            )
            sem_task = content_ingestion_service.search_assets_semantic(
                query, infospace_id, max(1, limit // 2), options
            )
            text_list, sem_list = await asyncio.gather(text_task, sem_task)
            
            merged_assets = {asset.id: asset for asset in text_list}
            for asset in sem_list:
                if asset.id not in merged_assets:
                    merged_assets[asset.id] = asset
            
            # Simple merge and limit for now, can be improved with ranking
            return list(merged_assets.values())[:limit]
        else:
            raise ValueError(f"Unknown search method: {search_method}")

    def count_assets_by_infospace(self, infospace_id: int, user_id: int) -> int:
        """Count total assets in an infospace for a user."""
        return self.session.exec(
            select(Asset).where(
                Asset.infospace_id == infospace_id,
                Asset.user_id == user_id
            )
        ).count()

    def create_asset_from_dict(self, asset_data: Dict[str, Any]) -> Asset:
        """Create asset from dictionary data (for compatibility)."""
        try:
            asset_create = AssetCreate(**asset_data)
            return self.create_asset(asset_create)
        except Exception as e:
            logger.error(f"Error in create_asset_from_dict: {e}")
            raise 