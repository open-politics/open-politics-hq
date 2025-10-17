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

    def create_asset(self, asset_create: AssetCreate, process_immediately: bool = False) -> Asset:
        """
        Creates a new asset with deduplication logic.
        
        NOTE: This service is now a pure data layer - it does NOT trigger processing.
        Processing is managed by ContentIngestionService which calls this method.
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
        
        # Set default status if not already set
        if "processing_status" not in asset_data:
            asset_data["processing_status"] = ProcessingStatus.READY
        
        asset = Asset(**asset_data)
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
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
        """Delete an asset and its children (cascade handled automatically)."""
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return False
        
        # Delete the asset - cascade will automatically delete children
        self.session.delete(asset)
        self.session.commit()
        
        return True

    def reprocess_asset(self, asset_id: int, options: Optional[Dict[str, Any]] = None) -> bool:
        """
        DEPRECATED: Use ContentIngestionService.reprocess_content() instead.
        This method is kept for backward compatibility only.
        """
        logger.warning(
            f"AssetService.reprocess_asset() is deprecated. "
            f"Use ContentIngestionService.reprocess_content() instead."
        )
        
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return False
        
        try:
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
        runtime_api_keys: Optional[Dict[str, str]] = None,
        parent_asset_id: Optional[int] = None,
        bundle_id: Optional[int] = None,
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
            runtime_api_keys: Optional runtime API keys for cloud providers (e.g., OpenAI for embeddings)
            parent_asset_id: Optional parent asset ID to filter by (for searching within specific parent assets)
            bundle_id: Optional bundle ID to filter by (for searching within specific bundles)

        Returns:
            A list of Asset objects matching the search criteria.
        """
        from app.api.services.content_ingestion_service import ContentIngestionService
        
        content_ingestion_service = ContentIngestionService(session=self.session)
        
        options = {
            "asset_kinds": [kind.value for kind in asset_kinds],
            "distance_threshold": distance_threshold,
            "runtime_api_keys": runtime_api_keys,
            "parent_asset_id": parent_asset_id,
            "bundle_id": bundle_id
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
    
    def transfer_assets(
        self,
        asset_ids: List[int],
        source_infospace_id: int,
        target_infospace_id: int,
        user_id: int,
        copy: bool = True
    ) -> List[Asset]:
        """
        Transfer assets between infospaces.
        
        Args:
            asset_ids: List of asset IDs to transfer
            source_infospace_id: Source infospace ID
            target_infospace_id: Target infospace ID
            user_id: User performing the transfer
            copy: If True, copy assets. If False, move them (changes infospace_id).
        
        Returns:
            List of new assets in target infospace (if copy=True) or the moved assets (if copy=False)
        """
        logger.info(f"Transferring {len(asset_ids)} assets from infospace {source_infospace_id} to {target_infospace_id}. Copy: {copy}")
        
        # Get and validate source assets
        source_assets = self.session.exec(
            select(Asset)
            .where(Asset.id.in_(asset_ids))
            .where(Asset.infospace_id == source_infospace_id)
        ).all()
        
        if len(source_assets) != len(asset_ids):
            found_ids = [a.id for a in source_assets]
            missing_ids = [aid for aid in asset_ids if aid not in found_ids]
            logger.warning(f"Some assets not found in source infospace: {missing_ids}")
        
        if not source_assets:
            logger.warning(f"No valid assets found to transfer")
            return []
        
        transferred_assets = []
        
        if copy:
            # Copy each asset to target infospace
            for asset in source_assets:
                try:
                    asset_create = AssetCreate(
                        title=asset.title,
                        kind=asset.kind,
                        text_content=asset.text_content,
                        blob_path=asset.blob_path,  # Shared storage
                        source_identifier=asset.source_identifier,
                        source_metadata=asset.source_metadata,
                        event_timestamp=asset.event_timestamp,
                        stub=asset.stub,
                        user_id=user_id,
                        infospace_id=target_infospace_id,
                        processing_status=asset.processing_status
                    )
                    
                    new_asset = self.create_asset(asset_create)
                    transferred_assets.append(new_asset)
                    logger.info(f"Copied asset {asset.id} → {new_asset.id} in infospace {target_infospace_id}")
                    
                except Exception as e:
                    logger.error(f"Failed to copy asset {asset.id}: {e}")
                    continue
        else:
            # Move assets by changing their infospace_id
            for asset in source_assets:
                try:
                    asset.infospace_id = target_infospace_id
                    asset.user_id = user_id  # Optionally update owner
                    self.session.add(asset)
                    transferred_assets.append(asset)
                    logger.info(f"Moved asset {asset.id} to infospace {target_infospace_id}")
                    
                except Exception as e:
                    logger.error(f"Failed to move asset {asset.id}: {e}")
                    continue
        
        self.session.commit()
        
        for asset in transferred_assets:
            self.session.refresh(asset)
        
        logger.info(f"Successfully transferred {len(transferred_assets)} assets")
        return transferred_assets 