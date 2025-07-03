from typing import List, Optional, Dict, Any
from sqlmodel import Session, select
from datetime import datetime, timezone
import uuid
import logging

from app.models import (
    Bundle,
    Asset,
    User
)
from app.schemas import BundleCreate, BundleUpdate, InfospaceCreate
from app.api.services.service_utils import validate_infospace_access

logger = logging.getLogger(__name__)

class BundleService:
    def __init__(self, db: Session):
        self.session = db

    def create_bundle(
        self,
        *,
        bundle_in: BundleCreate,
        infospace_id: int,
        user_id: int
    ) -> Bundle:
        """Create a new bundle."""
        logger.info(f"Service: Creating bundle '{bundle_in.name}' in infospace {infospace_id} by user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)

        asset_ids_to_link = []
        if hasattr(bundle_in, 'asset_ids') and bundle_in.asset_ids:
            for asset_id in bundle_in.asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")
                asset_ids_to_link.append(asset)
        
        bundle_data = bundle_in.model_dump(exclude={'asset_ids'} if hasattr(bundle_in, 'asset_ids') else None)
        db_bundle = Bundle(
            **bundle_data,
            infospace_id=infospace_id,
            user_id=user_id,
            asset_count=len(asset_ids_to_link)
        )
        
        if asset_ids_to_link:
            db_bundle.assets = asset_ids_to_link

        self.session.add(db_bundle)
        self.session.commit()
        self.session.refresh(db_bundle)
        logger.info(f"Service: Bundle '{db_bundle.name}' (ID: {db_bundle.id}) created.")
        return db_bundle

    def get_bundle(self, bundle_id: int, infospace_id: int, user_id: int) -> Optional[Bundle]:
        """Get a bundle by ID, ensuring it belongs to the user's infospace."""
        logger.debug(f"Service: Getting bundle {bundle_id} for infospace {infospace_id}, user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        bundle = self.session.get(Bundle, bundle_id)
        if bundle and bundle.infospace_id == infospace_id:
            return bundle
        if bundle:
             logger.warning(f"Service: Bundle {bundle_id} found but infospace_id mismatch (actual {bundle.infospace_id} vs expected {infospace_id})")
        return None

    def get_bundle_by_uuid(self, bundle_uuid: str, infospace_id: int, user_id: int) -> Optional[Bundle]:
        """Get a bundle by UUID, ensuring it belongs to the user's infospace."""
        logger.debug(f"Service: Getting bundle by UUID {bundle_uuid} for infospace {infospace_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        bundle = self.session.exec(
            select(Bundle).where(Bundle.uuid == bundle_uuid, Bundle.infospace_id == infospace_id)
        ).first()
        return bundle

    def get_bundles(
        self,
        *,
        infospace_id: int,
        user_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Bundle]:
        """Get bundles for an infospace."""
        logger.debug(f"Service: Listing bundles for infospace {infospace_id}, user {user_id}")
        validate_infospace_access(self.session, infospace_id, user_id)
        return self.session.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
            .offset(skip)
            .limit(limit)
            .order_by(Bundle.name)
        ).all()

    def update_bundle(
        self,
        *,
        bundle_id: int,
        bundle_in: BundleUpdate,
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Update a bundle."""
        logger.info(f"Service: Updating bundle {bundle_id} in infospace {infospace_id} by user {user_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None

        update_data = bundle_in.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(db_bundle, field, value)

        db_bundle.updated_at = datetime.now(timezone.utc)
        self.session.add(db_bundle)
        self.session.commit()
        self.session.refresh(db_bundle)
        logger.info(f"Service: Bundle {bundle_id} updated.")
        return db_bundle

    def delete_bundle(self, bundle_id: int, infospace_id: int, user_id: int) -> bool:
        """Delete a bundle."""
        logger.info(f"Service: Deleting bundle {bundle_id} from infospace {infospace_id} by user {user_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return False

        self.session.delete(db_bundle)
        self.session.commit()
        logger.info(f"Service: Bundle {bundle_id} deleted.")
        return True

    def add_asset_to_bundle(
        self,
        *,
        bundle_id: int,
        asset_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Add an existing asset to a bundle."""
        logger.info(f"Service: Adding asset {asset_id} to bundle {bundle_id} in infospace {infospace_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            logger.warning(f"Service: Bundle {bundle_id} not found or access denied for add_asset.")
            return None

        asset = self.session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")

        if asset not in db_bundle.assets:
            db_bundle.assets.append(asset)
            db_bundle.asset_count = (db_bundle.asset_count or 0) + 1
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Asset {asset_id} added to bundle {bundle_id}.")
        else:
            logger.info(f"Service: Asset {asset_id} already in bundle {bundle_id}. No change.")
        return db_bundle

    def remove_asset_from_bundle(
        self,
        *,
        bundle_id: int,
        asset_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Remove an asset from a bundle."""
        logger.info(f"Service: Removing asset {asset_id} from bundle {bundle_id} in infospace {infospace_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None
        
        asset_to_remove = self.session.get(Asset, asset_id)
        if not asset_to_remove or asset_to_remove.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to the infospace.")

        if asset_to_remove in db_bundle.assets:
            db_bundle.assets.remove(asset_to_remove)
            db_bundle.asset_count = max(0, (db_bundle.asset_count or 0) - 1)
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Asset {asset_id} removed from bundle {bundle_id}.")
        else:
            logger.info(f"Service: Asset {asset_id} not found in bundle {bundle_id}. No change.")
        return db_bundle

    def get_assets_for_bundle(
        self,
        *,
        bundle_id: int,
        infospace_id: int,
        user_id: Optional[int],
        skip: int = 0,
        limit: int = 100
    ) -> List[Asset]:
        """Get assets for a bundle, with pagination on the assets."""
        logger.debug(f"Service: Getting assets for bundle {bundle_id}, infospace {infospace_id}")
        
        # If a user_id is provided, validate their access to the bundle.
        # If no user_id is provided, we assume access has been validated by a higher-level
        # mechanism (like a share token) and fetch the bundle directly.
        if user_id:
            bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        else:
            bundle = self.session.get(Bundle, bundle_id)
            if bundle and bundle.infospace_id != infospace_id:
                logger.warning(f"Public access attempt for bundle {bundle_id} failed infospace check ({bundle.infospace_id} != {infospace_id})")
                return []
        
        if not bundle:
            return []
        
        all_assets = bundle.assets
        return all_assets[skip : skip + limit]

    def transfer_bundle(
        self,
        *,
        bundle_id: int,
        user_id: int,
        source_infospace_id: int,
        target_infospace_id: int,
        copy: bool = True
    ) -> Optional[Bundle]:
        """Transfer a bundle to another infospace."""
        logger.info(f"Service: Transferring bundle {bundle_id} from infospace {source_infospace_id} to {target_infospace_id} by user {user_id}. Copy: {copy}")
        db_bundle = self.get_bundle(bundle_id, source_infospace_id, user_id)
        if not db_bundle:
            return None
        
        validate_infospace_access(self.session, target_infospace_id, user_id)

        if copy:
            new_bundle_data = BundleCreate(
                name=db_bundle.name, 
                description=db_bundle.description,
                asset_ids=[asset.id for asset in db_bundle.assets]
            )
            created_bundle = self.create_bundle(
                bundle_in=new_bundle_data, 
                infospace_id=target_infospace_id, 
                user_id=user_id
            )
            logger.info(f"Service: Bundle {bundle_id} copied to new bundle {created_bundle.id} in infospace {target_infospace_id}.")
            return created_bundle
        else:
            if any(asset.infospace_id != target_infospace_id for asset in db_bundle.assets):
                 logger.warning(f"Cannot move bundle {bundle_id}: not all its assets are in/can be moved to target infospace {target_infospace_id}. Asset transfer not implemented here.")

            db_bundle.infospace_id = target_infospace_id
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Bundle {bundle_id} moved to infospace {target_infospace_id}.")
            return db_bundle 