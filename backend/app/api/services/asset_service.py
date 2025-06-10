import logging
from typing import Optional, List, Dict, Any
from sqlmodel import Session, select

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

    def _needs_processing(self, asset_kind: AssetKind) -> bool:
        """Check if asset kind needs processing after creation."""
        return asset_kind in [AssetKind.CSV, AssetKind.PDF, AssetKind.WEB]
    
    def _trigger_content_processing(self, asset: Asset, options: Optional[Dict[str, Any]] = None) -> None:
        """Trigger content processing for assets that need it."""
        try:
            celery.send_task(
                "process_content",
                args=[asset.id],
                kwargs={"options": options}
            )
            logger.info(f"Triggered content processing for asset {asset.id} ({asset.kind})")
        except Exception as e:
            logger.error(f"Failed to trigger content processing for asset {asset.id}: {e}")

    def create_asset(self, asset_create: AssetCreate) -> Asset:
        """Create a new asset and trigger processing if needed."""
        
        # Ensure required fields are provided
        if asset_create.user_id is None:
            raise ValueError("user_id is required for asset creation")
        if asset_create.infospace_id is None:
            raise ValueError("infospace_id is required for asset creation")
            
        asset_data = asset_create.model_dump(exclude_unset=True)
        
        # Set initial processing status
        if self._needs_processing(asset_create.kind):
            asset_data["processing_status"] = ProcessingStatus.PENDING
        else:
            asset_data["processing_status"] = ProcessingStatus.READY
        
        asset = Asset(**asset_data)
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        # Trigger content processing if needed
        if self._needs_processing(asset.kind):
            self._trigger_content_processing(asset)
        
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
        
        if not self._needs_processing(asset.kind):
            logger.warning(f"Asset {asset_id} of kind {asset.kind} does not support reprocessing")
            return False
        
        try:
            celery.send_task(
                "reprocess_content",
                args=[asset.id],
                kwargs={"options": options}
            )
            logger.info(f"Triggered reprocessing for asset {asset.id} with options: {options}")
            return True
        except Exception as e:
            logger.error(f"Failed to trigger reprocessing for asset {asset.id}: {e}")
            return False

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