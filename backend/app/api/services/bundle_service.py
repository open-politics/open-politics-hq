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

        assets_to_add = []
        if hasattr(bundle_in, 'asset_ids') and bundle_in.asset_ids:
            for asset_id in bundle_in.asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")
                assets_to_add.append(asset)
        
        bundle_data = bundle_in.model_dump(exclude={'asset_ids'} if hasattr(bundle_in, 'asset_ids') else None)
        db_bundle = Bundle(
            **bundle_data,
            infospace_id=infospace_id,
            user_id=user_id,
            asset_count=len(assets_to_add)
        )

        self.session.add(db_bundle)
        self.session.flush()  # Flush to get bundle ID
        
        # Set bundle_id on all assets
        if assets_to_add:
            for asset in assets_to_add:
                asset.bundle_id = db_bundle.id
        
        self.session.commit()
        self.session.refresh(db_bundle)
        logger.info(f"Service: Bundle '{db_bundle.name}' (ID: {db_bundle.id}) created with {len(assets_to_add)} assets.")
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

    def list_bundles(self, infospace_id: int) -> List[Bundle]:
        """List all bundles in an infospace."""
        return self.session.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
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
        user_id: int,
        include_child_assets: bool = True
    ) -> Optional[Bundle]:
        """Add an existing asset to a bundle (sets bundle_id), optionally including child assets."""
        logger.info(f"Service: Adding asset {asset_id} to bundle {bundle_id} in infospace {infospace_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            logger.warning(f"Service: Bundle {bundle_id} not found or access denied for add_asset.")
            return None

        asset = self.session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")

        assets_added = 0
        
        # Add the main asset by setting its bundle_id
        if asset.bundle_id != bundle_id:
            asset.bundle_id = bundle_id
            assets_added += 1
            logger.info(f"Service: Asset {asset_id} added to bundle {bundle_id}.")
        else:
            logger.info(f"Service: Asset {asset_id} already in bundle {bundle_id}. No change.")
        
        # Add child assets if requested, but ONLY for non-container assets
        # Container assets (CSV, PDF, etc.) manage their children via parent_asset_id hierarchy
        # Adding children to bundles would create duplication in the tree
        if include_child_assets and not asset.is_container:
            child_assets = self.session.exec(
                select(Asset).where(Asset.parent_asset_id == asset_id)
            ).all()
            
            for child_asset in child_assets:
                if child_asset.bundle_id != bundle_id:
                    child_asset.bundle_id = bundle_id
                    assets_added += 1
                    logger.info(f"Service: Child asset {child_asset.id} added to bundle {bundle_id}.")
        elif include_child_assets and asset.is_container:
            logger.info(f"Service: Asset {asset_id} is a container - children not added to bundle (accessed via hierarchy).")
        
        if assets_added > 0:
            db_bundle.asset_count = (db_bundle.asset_count or 0) + assets_added
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Added {assets_added} assets (including children) to bundle {bundle_id}.")
        
        return db_bundle

    def remove_asset_from_bundle(
        self,
        *,
        bundle_id: int,
        asset_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Remove an asset from a bundle (sets bundle_id to None)."""
        logger.info(f"Service: Removing asset {asset_id} from bundle {bundle_id} in infospace {infospace_id}")
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None
        
        asset_to_remove = self.session.get(Asset, asset_id)
        if not asset_to_remove or asset_to_remove.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to the infospace.")

        if asset_to_remove.bundle_id == bundle_id:
            asset_to_remove.bundle_id = None
            db_bundle.asset_count = max(0, (db_bundle.asset_count or 0) - 1)
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Asset {asset_id} removed from bundle {bundle_id}.")
        else:
            logger.info(f"Service: Asset {asset_id} not in bundle {bundle_id}. No change.")
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
        """Get assets for a bundle, with pagination."""
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
        
        # Query assets by bundle_id
        assets = self.session.exec(
            select(Asset)
            .where(Asset.bundle_id == bundle_id)
            .offset(skip)
            .limit(limit)
            .order_by(Asset.created_at.desc())
        ).all()
        
        return list(assets)

    def transfer_bundle(
        self,
        *,
        bundle_id: int,
        user_id: int,
        source_infospace_id: int,
        target_infospace_id: int,
        copy: bool = True
    ) -> Optional[Bundle]:
        """
        Transfer a bundle to another infospace.
        
        Args:
            bundle_id: ID of bundle to transfer
            user_id: User performing the transfer
            source_infospace_id: Source infospace
            target_infospace_id: Target infospace
            copy: If True, copy the bundle and all its assets to target infospace.
                  If False, move it (limited support for cross-infospace).
        """
        logger.info(f"Service: Transferring bundle {bundle_id} from infospace {source_infospace_id} to {target_infospace_id} by user {user_id}. Copy: {copy}")
        db_bundle = self.get_bundle(bundle_id, source_infospace_id, user_id)
        if not db_bundle:
            return None
        
        validate_infospace_access(self.session, target_infospace_id, user_id)

        if copy:
            # Copy bundle with all its assets
            new_asset_ids = self._copy_assets_to_infospace(
                assets=db_bundle.assets,
                target_infospace_id=target_infospace_id,
                user_id=user_id
            )
            
            # Check if bundle name conflicts in target infospace
            import re
            original_name = db_bundle.name
            
            # Strip existing numeric suffix if present (e.g., "Name_1" -> "Name")
            base_name = re.sub(r'_\d+$', '', original_name)
            
            # Find all existing bundles with similar names in target infospace
            existing_bundles = self.session.exec(
                select(Bundle).where(
                    Bundle.infospace_id == target_infospace_id,
                    Bundle.version == (db_bundle.version or "1.0")
                )
            ).all()
            
            # Find the highest suffix number for this base name
            max_suffix = 0
            pattern = re.compile(rf'^{re.escape(base_name)}(_(\d+))?$')
            for bundle in existing_bundles:
                match = pattern.match(bundle.name)
                if match:
                    suffix_str = match.group(2)
                    if suffix_str:
                        max_suffix = max(max_suffix, int(suffix_str))
                    else:
                        # Base name exists without suffix
                        max_suffix = max(max_suffix, 0)
            
            # Use base name if available, otherwise use next suffix
            if max_suffix == 0:
                # Check if base name is available
                existing = self.session.exec(
                    select(Bundle).where(
                        Bundle.infospace_id == target_infospace_id,
                        Bundle.name == base_name,
                        Bundle.version == (db_bundle.version or "1.0")
                    )
                ).first()
                new_name = base_name if not existing else f"{base_name}_1"
            else:
                new_name = f"{base_name}_{max_suffix + 1}"
            
            if new_name != original_name:
                logger.info(f"Copied bundle renamed from '{original_name}' to '{new_name}' to avoid conflict")
            
            new_bundle_data = BundleCreate(
                name=new_name, 
                description=db_bundle.description,
                asset_ids=new_asset_ids
            )
            created_bundle = self.create_bundle(
                bundle_in=new_bundle_data, 
                infospace_id=target_infospace_id, 
                user_id=user_id
            )
            logger.info(f"Service: Bundle '{created_bundle.name}' (ID: {created_bundle.id}) copied to infospace {target_infospace_id} with {len(new_asset_ids)} assets.")
            return created_bundle
        else:
            # Move bundle (not recommended for cross-infospace with assets)
            if any(asset.infospace_id != target_infospace_id for asset in db_bundle.assets):
                 logger.warning(f"Cannot move bundle {bundle_id}: not all its assets are in/can be moved to target infospace {target_infospace_id}.")

            # Check if bundle name conflicts with existing bundle in target infospace
            import re
            original_name = db_bundle.name
            
            # Strip existing numeric suffix if present (e.g., "Name_1" -> "Name")
            base_name = re.sub(r'_\d+$', '', original_name)
            
            # Find all existing bundles with similar names in target infospace
            existing_bundles = self.session.exec(
                select(Bundle).where(
                    Bundle.infospace_id == target_infospace_id,
                    Bundle.version == db_bundle.version
                )
            ).all()
            
            # Find the highest suffix number for this base name
            max_suffix = 0
            pattern = re.compile(rf'^{re.escape(base_name)}(_(\d+))?$')
            for bundle in existing_bundles:
                match = pattern.match(bundle.name)
                if match:
                    suffix_str = match.group(2)
                    if suffix_str:
                        max_suffix = max(max_suffix, int(suffix_str))
                    else:
                        # Base name exists without suffix
                        max_suffix = max(max_suffix, 0)
            
            # Use base name if available, otherwise use next suffix
            if max_suffix == 0:
                # Check if base name is available
                existing = self.session.exec(
                    select(Bundle).where(
                        Bundle.infospace_id == target_infospace_id,
                        Bundle.name == base_name,
                        Bundle.version == db_bundle.version
                    )
                ).first()
                new_name = base_name if not existing else f"{base_name}_1"
            else:
                new_name = f"{base_name}_{max_suffix + 1}"
            
            if new_name != original_name:
                logger.info(f"Renamed bundle from '{original_name}' to '{new_name}' to avoid conflict")
                db_bundle.name = new_name
            
            db_bundle.infospace_id = target_infospace_id
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Bundle {bundle_id} moved to infospace {target_infospace_id}.")
            return db_bundle
    
    def _copy_assets_to_infospace(
        self,
        assets: List[Asset],
        target_infospace_id: int,
        user_id: int
    ) -> List[int]:
        """
        Copy assets to target infospace.
        
        Returns list of new asset IDs in target infospace.
        Note: Does NOT commit - caller must commit after adding assets to bundle.
        """
        from app.schemas import AssetCreate
        from app.models import Asset as AssetModel
        
        new_asset_ids = []
        
        for asset in assets:
            try:
                # Create copy of asset in target infospace
                new_asset = AssetModel(
                    title=asset.title,
                    kind=asset.kind,
                    text_content=asset.text_content,
                    blob_path=asset.blob_path,  # Keep same blob path - storage is shared
                    source_identifier=asset.source_identifier,
                    source_metadata=asset.source_metadata,
                    event_timestamp=asset.event_timestamp,
                    stub=asset.stub,
                    user_id=user_id,
                    infospace_id=target_infospace_id,
                    processing_status=asset.processing_status
                )
                
                self.session.add(new_asset)
                self.session.flush()  # Get ID without committing
                new_asset_ids.append(new_asset.id)
                logger.info(f"Copied asset {asset.id} ('{asset.title}') to new asset {new_asset.id} in infospace {target_infospace_id}")
                
            except Exception as e:
                logger.error(f"Failed to copy asset {asset.id}: {e}")
                # Continue with other assets
                continue
        
        return new_asset_ids

    def move_bundle_to_parent(
        self,
        *,
        child_bundle_id: int,
        parent_bundle_id: Optional[int],
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Move a bundle into another bundle (or to root if parent_bundle_id is None)."""
        logger.info(f"Service: Moving bundle {child_bundle_id} to parent {parent_bundle_id} in infospace {infospace_id}")
        
        # Validate access to infospace
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Get the child bundle
        child_bundle = self.get_bundle(child_bundle_id, infospace_id, user_id)
        if not child_bundle:
            logger.warning(f"Service: Child bundle {child_bundle_id} not found or access denied.")
            return None
        
        # Validate parent bundle if specified
        if parent_bundle_id is not None:
            parent_bundle = self.get_bundle(parent_bundle_id, infospace_id, user_id)
            if not parent_bundle:
                logger.warning(f"Service: Parent bundle {parent_bundle_id} not found or access denied.")
                return None
            
            # Prevent circular references
            if self._would_create_cycle(child_bundle_id, parent_bundle_id):
                raise ValueError("Moving bundle would create a circular reference.")
        
        # Update child bundle counts
        old_parent_id = child_bundle.parent_bundle_id
        
        # Remove from old parent
        if old_parent_id:
            old_parent = self.session.get(Bundle, old_parent_id)
            if old_parent:
                old_parent.child_bundle_count = max(0, (old_parent.child_bundle_count or 0) - 1)
                self.session.add(old_parent)
        
        # Add to new parent
        if parent_bundle_id:
            new_parent = self.session.get(Bundle, parent_bundle_id)
            if new_parent:
                new_parent.child_bundle_count = (new_parent.child_bundle_count or 0) + 1
                self.session.add(new_parent)
        
        # Update child bundle
        child_bundle.parent_bundle_id = parent_bundle_id
        self.session.add(child_bundle)
        
        self.session.commit()
        self.session.refresh(child_bundle)
        
        logger.info(f"Service: Successfully moved bundle {child_bundle_id} to parent {parent_bundle_id}.")
        return child_bundle
    
    def _would_create_cycle(self, child_bundle_id: int, potential_parent_id: int) -> bool:
        """Check if moving child_bundle_id under potential_parent_id would create a cycle."""
        current_id = potential_parent_id
        visited = set()
        
        while current_id and current_id not in visited:
            if current_id == child_bundle_id:
                return True
            visited.add(current_id)
            
            bundle = self.session.get(Bundle, current_id)
            current_id = bundle.parent_bundle_id if bundle else None
        
        return False
    
    def get_bundle_hierarchy(
        self,
        bundle_id: int,
        infospace_id: int,
        user_id: int,
        max_depth: int = 10
    ) -> Optional[Dict[str, Any]]:
        """Get bundle with its child hierarchy."""
        bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not bundle:
            return None
        
        def build_hierarchy(bundle_obj: Bundle, current_depth: int = 0) -> Dict[str, Any]:
            if current_depth > max_depth:
                return {
                    "id": bundle_obj.id,
                    "name": bundle_obj.name,
                    "description": bundle_obj.description,
                    "asset_count": bundle_obj.asset_count,
                    "child_bundle_count": bundle_obj.child_bundle_count,
                    "children": []  # Truncated due to depth limit
                }
            
            children = []
            for child in bundle_obj.child_bundles:
                children.append(build_hierarchy(child, current_depth + 1))
            
            return {
                "id": bundle_obj.id,
                "name": bundle_obj.name,
                "description": bundle_obj.description,
                "asset_count": bundle_obj.asset_count,
                "child_bundle_count": bundle_obj.child_bundle_count,
                "parent_bundle_id": bundle_obj.parent_bundle_id,
                "children": children
            }
        
        return build_hierarchy(bundle)
    
    def get_root_bundles(self, infospace_id: int, user_id: int) -> List[Bundle]:
        """Get all top-level bundles (those without parent bundles)."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        statement = select(Bundle).where(
            Bundle.infospace_id == infospace_id,
            Bundle.parent_bundle_id.is_(None)
        )
        
        return self.session.exec(statement).all() 