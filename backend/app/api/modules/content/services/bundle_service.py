from typing import List, Optional, Dict, Any
from sqlmodel import Session, select
from sqlalchemy import text
from datetime import datetime, timezone
import logging

from app.models import (
    Bundle,
    Asset,
    IngestionJob,
    Source,
    User,
)
from app.schemas import BundleCreate, BundleUpdate
from app.core.tree import ROOT, copy as tree_copy

logger = logging.getLogger(__name__)


class BundleService:
    def __init__(self, db: Session):
        self.session = db

    # ─── CRUD ───

    def create_bundle(
        self,
        *,
        bundle_in: BundleCreate,
        infospace_id: int,
        user_id: int
    ) -> Bundle:
        """Create a new bundle, optionally adding assets to it."""
        logger.info(f"Service: Creating bundle '{bundle_in.name}' in infospace {infospace_id} by user {user_id}")

        asset_ids_to_add = []
        if hasattr(bundle_in, 'asset_ids') and bundle_in.asset_ids:
            for asset_id in bundle_in.asset_ids:
                asset = self.session.get(Asset, asset_id)
                if not asset or asset.infospace_id != infospace_id:
                    raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")
                asset_ids_to_add.append(asset_id)

        bundle_data = bundle_in.model_dump(exclude={'asset_ids'} if hasattr(bundle_in, 'asset_ids') else None)
        # Map None → ROOT for parent_bundle_id
        if bundle_data.get('parent_bundle_id') is None:
            bundle_data['parent_bundle_id'] = ROOT

        db_bundle = Bundle(
            **bundle_data,
            infospace_id=infospace_id,
            user_id=user_id,
            asset_count=0,
        )
        self.session.add(db_bundle)
        self.session.flush()

        if asset_ids_to_add:
            result = tree_copy(self.session, asset_ids=asset_ids_to_add, to=db_bundle.id)
            db_bundle.asset_count = result.assets

        self.session.commit()
        self.session.refresh(db_bundle)
        logger.info(f"Service: Bundle '{db_bundle.name}' (ID: {db_bundle.id}) created with {db_bundle.asset_count} assets.")
        return db_bundle

    def get_bundle(self, bundle_id: int, infospace_id: int, user_id: int) -> Optional[Bundle]:
        """Get a bundle by ID, ensuring it belongs to the user's infospace."""
        bundle = self.session.get(Bundle, bundle_id)
        if bundle and bundle.infospace_id == infospace_id:
            return bundle
        return None

    def get_bundle_by_uuid(self, bundle_uuid: str, infospace_id: int, user_id: int) -> Optional[Bundle]:
        """Get a bundle by UUID, ensuring it belongs to the user's infospace."""
        return self.session.exec(
            select(Bundle).where(Bundle.uuid == bundle_uuid, Bundle.infospace_id == infospace_id)
        ).first()

    def get_bundles(
        self,
        *,
        infospace_id: int,
        user_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Bundle]:
        """Get bundles for an infospace."""
        return self.session.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
            .offset(skip)
            .limit(limit)
            .order_by(Bundle.name)
        ).all()

    def list_bundles(self, infospace_id: int) -> List[Bundle]:
        """List all bundles in an infospace (no access check — caller must validate)."""
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
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None

        update_data = bundle_in.model_dump(exclude_unset=True)
        # Map None → ROOT for parent_bundle_id if explicitly set
        if 'parent_bundle_id' in update_data and update_data['parent_bundle_id'] is None:
            update_data['parent_bundle_id'] = ROOT

        for field, value in update_data.items():
            setattr(db_bundle, field, value)

        db_bundle.updated_at = datetime.now(timezone.utc)
        self.session.add(db_bundle)
        self.session.commit()
        self.session.refresh(db_bundle)
        return db_bundle

    # ─── Asset retrieval ───

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
        if user_id:
            bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        else:
            bundle = self.session.get(Bundle, bundle_id)
            if bundle and bundle.infospace_id != infospace_id:
                return []

        if not bundle:
            return []

        asset_ids = [
            r[0] for r in self.session.execute(
                text(
                    "SELECT id FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[] "
                    "ORDER BY created_at DESC OFFSET :off LIMIT :lim"
                ),
                {"bid": bundle_id, "off": skip, "lim": limit},
            ).fetchall()
        ]
        if not asset_ids:
            return []
        return list(self.session.exec(
            select(Asset).where(Asset.id.in_(asset_ids)).order_by(Asset.created_at.desc())
        ).all())

    # ─── Virtual folder materialization ───

    def materialize_virtual_folder(
        self,
        *,
        source_bundle_id: int,
        path_prefix: str,
        name: str,
        infospace_id: int,
        user_id: int,
    ) -> Bundle:
        """
        Create a real bundle from a virtual folder (path prefix within a bundle).
        Uses "Add to" semantics: assets gain the new bundle membership.
        """
        source_bundle = self.get_bundle(source_bundle_id, infospace_id, user_id)
        if not source_bundle:
            raise ValueError(f"Source bundle {source_bundle_id} not found or access denied")

        like_prefix = f"{path_prefix}/%" if path_prefix else "%"
        eq_prefix = path_prefix if path_prefix else None

        if eq_prefix:
            root_asset_ids = [
                r[0] for r in self.session.execute(
                    text(
                        "SELECT id FROM asset "
                        "WHERE bundle_ids @> ARRAY[:bid]::int[] "
                        "AND parent_asset_id IS NULL "
                        "AND logical_path IS NOT NULL "
                        "AND (logical_path = :eq OR logical_path LIKE :like)"
                    ),
                    {"bid": source_bundle_id, "eq": eq_prefix, "like": like_prefix},
                ).fetchall()
            ]
        else:
            root_asset_ids = [
                r[0] for r in self.session.execute(
                    text(
                        "SELECT id FROM asset "
                        "WHERE bundle_ids @> ARRAY[:bid]::int[] "
                        "AND parent_asset_id IS NULL "
                        "AND logical_path IS NOT NULL "
                        "AND logical_path LIKE :like"
                    ),
                    {"bid": source_bundle_id, "like": like_prefix},
                ).fetchall()
            ]

        new_bundle = Bundle(
            name=name,
            infospace_id=infospace_id,
            user_id=user_id,
            parent_bundle_id=source_bundle_id,
            asset_count=0,
        )
        self.session.add(new_bundle)
        self.session.flush()

        if root_asset_ids:
            result = tree_copy(self.session, asset_ids=root_asset_ids, to=new_bundle.id)
            new_bundle.asset_count = result.assets

        # Update parent's child_bundle_count
        source_bundle.child_bundle_count = (source_bundle.child_bundle_count or 0) + 1
        self.session.add(source_bundle)

        self.session.commit()
        self.session.refresh(new_bundle)
        logger.info(f"Materialized virtual folder '{path_prefix}' as bundle {new_bundle.id} with {new_bundle.asset_count} assets")
        return new_bundle

    # ─── Bundle transfer ───

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
        db_bundle = self.get_bundle(bundle_id, source_infospace_id, user_id)
        if not db_bundle:
            return None

        bundle_assets = list(self.session.exec(
            select(Asset).where(
                text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id)
            )
        ).all())

        if copy:
            new_asset_ids = self._copy_assets_to_infospace(
                assets=bundle_assets,
                target_infospace_id=target_infospace_id,
                user_id=user_id,
            )
            new_name = self._resolve_bundle_name(db_bundle.name, db_bundle.version or "1.0", target_infospace_id)
            new_bundle_data = BundleCreate(
                name=new_name,
                description=db_bundle.description,
                asset_ids=new_asset_ids,
            )
            created_bundle = self.create_bundle(
                bundle_in=new_bundle_data,
                infospace_id=target_infospace_id,
                user_id=user_id,
            )
            logger.info(f"Service: Bundle '{created_bundle.name}' copied to infospace {target_infospace_id} with {len(new_asset_ids)} assets.")
            return created_bundle
        else:
            asset_count = len(bundle_assets)
            if any(a.infospace_id != source_infospace_id for a in bundle_assets):
                logger.warning(f"Cannot move bundle {bundle_id}: asset infospace mismatch")

            new_name = self._resolve_bundle_name(db_bundle.name, db_bundle.version, target_infospace_id)
            if new_name != db_bundle.name:
                db_bundle.name = new_name

            db_bundle.infospace_id = target_infospace_id
            db_bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Bundle {bundle_id} moved to infospace {target_infospace_id}.")
            return db_bundle

    def _resolve_bundle_name(self, original_name: str, version: str, target_infospace_id: int) -> str:
        """Find a non-conflicting bundle name in the target infospace."""
        import re
        base_name = re.sub(r'_\d+$', '', original_name)
        existing_bundles = self.session.exec(
            select(Bundle).where(
                Bundle.infospace_id == target_infospace_id,
                Bundle.version == version,
            )
        ).all()
        max_suffix = 0
        pattern = re.compile(rf'^{re.escape(base_name)}(_(\d+))?$')
        for bundle in existing_bundles:
            match = pattern.match(bundle.name)
            if match:
                suffix_str = match.group(2)
                max_suffix = max(max_suffix, int(suffix_str) if suffix_str else 0)

        if max_suffix == 0:
            existing = self.session.exec(
                select(Bundle).where(
                    Bundle.infospace_id == target_infospace_id,
                    Bundle.name == base_name,
                    Bundle.version == version,
                )
            ).first()
            return base_name if not existing else f"{base_name}_1"
        return f"{base_name}_{max_suffix + 1}"

    def _copy_assets_to_infospace(
        self,
        assets: List[Asset],
        target_infospace_id: int,
        user_id: int
    ) -> List[int]:
        """Copy assets to target infospace. Returns new asset IDs."""
        new_assets = []
        for asset in assets:
            try:
                new_asset = Asset(
                    title=asset.title,
                    kind=asset.kind,
                    text_content=asset.text_content,
                    blob_path=asset.blob_path,
                    source_identifier=asset.source_identifier,
                    facets=asset.facets,
                    file_info=asset.file_info,
                    event_timestamp=asset.event_timestamp,
                    stub=asset.stub,
                    user_id=user_id,
                    infospace_id=target_infospace_id,
                    processing_status=asset.processing_status,
                )
                new_assets.append(new_asset)
            except Exception as e:
                logger.error(f"Failed to copy asset {asset.id}: {e}")
                continue
        if new_assets:
            self.session.add_all(new_assets)
            self.session.flush()
        return [a.id for a in new_assets if a.id is not None]

    # ─── Bundle hierarchy (display) ───

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
                    "children": [],
                }

            # Explicit query instead of ORM relationship (FK removed)
            children_bundles = list(self.session.exec(
                select(Bundle).where(Bundle.parent_bundle_id == bundle_obj.id).order_by(Bundle.name)
            ).all())
            children = [build_hierarchy(c, current_depth + 1) for c in children_bundles]
            return {
                "id": bundle_obj.id,
                "name": bundle_obj.name,
                "description": bundle_obj.description,
                "asset_count": bundle_obj.asset_count,
                "child_bundle_count": bundle_obj.child_bundle_count,
                "parent_bundle_id": bundle_obj.parent_bundle_id,
                "children": children,
            }

        return build_hierarchy(bundle)

    def get_root_bundles(self, infospace_id: int, user_id: int) -> List[Bundle]:
        """Get all top-level bundles (parent_bundle_id == ROOT)."""
        return self.session.exec(
            select(Bundle).where(
                Bundle.infospace_id == infospace_id,
                Bundle.parent_bundle_id == ROOT,
            )
        ).all()
