import logging
from typing import Optional, List, Dict, Any, Union
from sqlmodel import Session, select, delete
from sqlalchemy import update
import asyncio

from app.models import Asset, AssetChunk, Annotation, AssetKind, ProcessingStatus
from app.api.modules.annotation.models import Justification
from app.api.modules.graph.models import FragmentCuration, GraphEdge
from app.schemas import AssetCreate, AssetUpdate
from app.api.modules.foundation_service_providers.base import StorageProvider
logger = logging.getLogger(__name__)

DEFAULT_BATCH_SIZE = 500

class AssetService:
    def __init__(self, session: Session, storage_provider: StorageProvider):
        self.session = session
        self.storage_provider = storage_provider
        logger.info("AssetService initialized.")

    def create_asset(self, asset_create: AssetCreate, process_immediately: bool = False) -> Asset:
        """
        Creates a new asset with deduplication logic.
        
        NOTE: This service is now a pure data layer - it does NOT trigger processing.
        Processing is managed by ProcessingService which calls this method.
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
            existing_hash = existing_by_source.content_hash
            
            # Check if both have content hashes and they match
            if incoming_hash and existing_hash and incoming_hash == existing_hash:
                # Exact duplicate: skip and return existing
                logger.debug(f"Skipping duplicate asset (same content_hash): {existing_by_source.id}")
                return existing_by_source
            
            # If we have hashes but they differ, it's a content update
            # If one or both lack hashes, we can't be sure - treat as potential duplicate
            # For RSS feeds specifically, if source_identifier is the same, it's likely the same article
            # so we should skip it even without content_hash comparison
            if incoming_hash and not existing_hash:
                # Update existing asset's content_hash if it didn't have one
                logger.debug(f"Updating content_hash for existing asset: {existing_by_source.id}")
                existing_by_source.content_hash = incoming_hash
                self.session.add(existing_by_source)
                self.session.commit()
                self.session.refresh(existing_by_source)
                return existing_by_source
            
            # If neither have content_hash, assume same source_identifier = duplicate for RSS
            if not incoming_hash and not existing_hash:
                logger.debug(f"Skipping duplicate asset (same source_identifier, no hashes): {existing_by_source.id}")
                return existing_by_source
            
            # Only create versioned duplicate if hashes exist and differ
            if incoming_hash and existing_hash and incoming_hash != existing_hash:
                # Versioned duplicate: chain to previous
                file_info = dict(asset_data.get("file_info") or {})
                file_info["version"] = (existing_by_source.file_info or {}).get("version", 1) + 1
                asset_data["file_info"] = file_info
                # Set first-class column too
                asset_data["previous_asset_id"] = existing_by_source.id
                logger.debug(f"Creating new version of asset {existing_by_source.id} (content changed)")

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
                file_info = dict(asset_data.get("file_info") or {})
                file_info["duplicate_of_asset_id"] = existing_by_hash.id
                asset_data["file_info"] = file_info
        
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
        DEPRECATED: Use ProcessingService.reprocess_content() instead.
        Resets asset to PENDING so process_pending @task picks it up.
        """
        asset = self.session.get(Asset, asset_id)
        if not asset:
            return False

        from app.models import ProcessingStatus
        asset.processing_status = ProcessingStatus.PENDING
        self.session.add(asset)
        self.session.commit()

        from app.core.events import emit
        emit("asset.ingested", {"asset_id": asset.id, "infospace_id": asset.infospace_id})
        return True

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
        from app.api.modules.search.services.search_service import SearchService

        search_service = SearchService(session=self.session)

        options = {
            "asset_kinds": [kind.value for kind in asset_kinds],
            "distance_threshold": distance_threshold,
            "runtime_api_keys": runtime_api_keys,
            "parent_asset_id": parent_asset_id,
            "bundle_id": bundle_id
        }

        if search_method == "text":
            return await search_service.search_assets_text(
                query, infospace_id, limit, options
            )
        elif search_method == "semantic":
            return await search_service.search_assets_semantic(
                query, infospace_id, limit, options
            )
        elif search_method == "hybrid":
            text_task = search_service.search_assets_text(
                query, infospace_id, max(1, limit // 2), options
            )
            sem_task = search_service.search_assets_semantic(
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

    def batch_create_assets(
        self,
        assets: List[Union[AssetCreate, Dict[str, Any]]],
        batch_size: int = DEFAULT_BATCH_SIZE,
        skip_dedupe: bool = True,
    ) -> List[Asset]:
        """
        Create multiple assets in batches. Single pattern for CSV rows, PDF pages,
        directory imports, RSS articles. Uses per-batch commits for scale.

        Args:
            assets: List of AssetCreate or dict (asset_data)
            batch_size: Commit after this many assets (default 500)
            skip_dedupe: If True, skip per-asset deduplication for speed (caller
                responsibility). If False, each asset goes through create_asset (slower).

        Returns:
            List of created Asset instances.
        """
        if not assets:
            return []

        created: List[Asset] = []
        if skip_dedupe:
            for i in range(0, len(assets), batch_size):
                chunk = assets[i : i + batch_size]
                for item in chunk:
                    data = item if isinstance(item, dict) else item.model_dump(exclude_unset=True)
                    if data.get("user_id") is None or data.get("infospace_id") is None:
                        raise ValueError("user_id and infospace_id are required for asset creation")
                    if "processing_status" not in data:
                        data["processing_status"] = ProcessingStatus.READY
                    if not data.get("title"):
                        data["title"] = "Untitled"
                    # Filter to valid Asset columns (exclude cells, etc. from schema)
                    valid = set(Asset.model_fields.keys()) - {"chunks", "infospace", "user", "source", "bundle", "annotations", "parent_asset", "children_assets", "previous_asset", "next_versions"}
                    filtered = {k: v for k, v in data.items() if k in valid}
                    asset = Asset(**filtered)
                    self.session.add(asset)
                    created.append(asset)
                self.session.commit()
                for a in created[-len(chunk) :]:
                    self.session.refresh(a)
            return created
        else:
            for item in assets:
                ac = item if isinstance(item, AssetCreate) else AssetCreate(**item)
                created.append(self.create_asset(ac))
            return created

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
                        facets=asset.facets,
                        file_info=asset.file_info,
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

    def cascade_delete(self, asset_ids: set[int]) -> int:
        """
        Delete assets and all descendants. Clears chunks, annotations, previous_asset_id refs.
        Caller must commit. Returns number of assets deleted.
        """
        if not asset_ids:
            return 0

        # Recursively collect all descendant asset IDs
        def collect_children_recursive(parent_ids: set) -> set:
            all_children: set[int] = set()
            current_level = parent_ids
            while current_level:
                children = self.session.exec(
                    select(Asset.id).where(Asset.parent_asset_id.in_(current_level))
                ).all()
                if not children:
                    break
                child_ids = set(children)
                all_children.update(child_ids)
                current_level = child_ids
            return all_children

        all_children = collect_children_recursive(asset_ids)
        if all_children:
            logger.info(f"Cascade delete: found {len(all_children)} child assets")
            asset_ids = asset_ids | all_children

        # Clear previous_asset_id where it points to assets we're deleting
        self.session.exec(
            update(Asset)
            .where(Asset.previous_asset_id.in_(asset_ids))
            .values(previous_asset_id=None)
        )

        # Delete asset chunks, graph data, and annotations
        self.session.exec(
            delete(AssetChunk).where(AssetChunk.asset_id.in_(asset_ids))
        )

        # Collect annotation IDs so we can clear FK references from graph tables
        annotation_ids = set(self.session.exec(
            select(Annotation.id).where(Annotation.asset_id.in_(asset_ids))
        ).all())
        if annotation_ids:
            self.session.exec(
                delete(Justification).where(Justification.annotation_id.in_(annotation_ids))
            )
            self.session.exec(
                delete(FragmentCuration).where(FragmentCuration.annotation_id.in_(annotation_ids))
            )
            self.session.exec(
                delete(GraphEdge).where(GraphEdge.annotation_id.in_(annotation_ids))
            )

        self.session.exec(
            delete(Annotation).where(Annotation.asset_id.in_(asset_ids))
        )

        # Bulk delete assets
        result = self.session.exec(delete(Asset).where(Asset.id.in_(asset_ids)))
        deleted = result.rowcount if hasattr(result, "rowcount") else len(asset_ids)
        logger.info(f"Cascade delete: removed {deleted} assets")
        return deleted
