from typing import List, Optional, Dict, Any, Set
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
from app.schemas import BundleCreate, BundleUpdate, InfospaceCreate

logger = logging.getLogger(__name__)


class BundleService:
    def __init__(self, db: Session):
        self.session = db

    # ─── Raw SQL array helpers ───
    # All bundle_ids mutations MUST go through these. Never do ORM read-modify-write.

    def _array_append(self, asset_ids: List[int], bundle_id: int) -> int:
        """Add bundle_id to bundle_ids array for given assets. Returns count of rows changed."""
        if not asset_ids:
            return 0
        result = self.session.execute(
            text(
                "UPDATE asset SET bundle_ids = array_append(COALESCE(bundle_ids, ARRAY[]::int[]), :bid) "
                "WHERE id = ANY(:ids) "
                "AND NOT (COALESCE(bundle_ids, ARRAY[]::int[]) @> ARRAY[:bid]::int[])"
            ),
            {"bid": bundle_id, "ids": asset_ids},
        )
        return result.rowcount

    def _array_remove(self, asset_ids: List[int], bundle_id: int) -> int:
        """Remove bundle_id from bundle_ids array. Normalizes empty arrays to NULL. Returns rows changed."""
        if not asset_ids:
            return 0
        result = self.session.execute(
            text(
                "UPDATE asset SET bundle_ids = CASE "
                "  WHEN array_length(array_remove(bundle_ids, :bid), 1) IS NULL THEN NULL "
                "  ELSE array_remove(bundle_ids, :bid) "
                "END "
                "WHERE id = ANY(:ids) "
                "AND bundle_ids @> ARRAY[:bid]::int[]"
            ),
            {"bid": bundle_id, "ids": asset_ids},
        )
        return result.rowcount

    def _recount_bundle(self, bundle: Bundle) -> None:
        """Recount assets in bundle from DB truth."""
        count = self.session.execute(
            text("SELECT count(*) FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[]"),
            {"bid": bundle.id},
        ).scalar() or 0
        bundle.asset_count = count
        bundle.updated_at = datetime.now(timezone.utc)
        self.session.add(bundle)

    def _get_bundle_asset_ids(self, bundle_id: int) -> List[int]:
        """Get all asset IDs in a bundle."""
        rows = self.session.execute(
            text("SELECT id FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[]"),
            {"bid": bundle_id},
        ).fetchall()
        return [r[0] for r in rows]

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
        db_bundle = Bundle(
            **bundle_data,
            infospace_id=infospace_id,
            user_id=user_id,
            asset_count=0,
        )
        self.session.add(db_bundle)
        self.session.flush()

        if asset_ids_to_add:
            added = self._array_append(asset_ids_to_add, db_bundle.id)
            db_bundle.asset_count = added

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
        for field, value in update_data.items():
            setattr(db_bundle, field, value)

        db_bundle.updated_at = datetime.now(timezone.utc)
        self.session.add(db_bundle)
        self.session.commit()
        self.session.refresh(db_bundle)
        return db_bundle

    def get_descendant_ids(self, bundle_ids: set[int]) -> set[int]:
        """Recursive CTE: return all bundle IDs including roots and all descendants."""
        if not bundle_ids:
            return set()
        rows = self.session.execute(text("""
            WITH RECURSIVE tree AS (
                SELECT id FROM bundle WHERE id = ANY(:bids)
                UNION ALL
                SELECT b.id FROM bundle b JOIN tree ON b.parent_bundle_id = tree.id
            )
            SELECT id FROM tree
        """), {"bids": list(bundle_ids)}).fetchall()
        return {r[0] for r in rows}

    def delete_bundle(self, bundle_id: int, infospace_id: int, user_id: int) -> bool:
        """Delete a bundle and all its descendants. DB trigger cleans bundle_ids arrays."""
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return False

        # Expand to full subtree
        all_ids = self.get_descendant_ids({bundle_id})
        self.cascade_delete(all_ids)
        self.session.commit()
        logger.info(f"Service: Bundle {bundle_id} and {len(all_ids) - 1} descendants deleted.")
        return True

    # ─── Add / Remove / Move assets ───

    def add_assets_to_bundle(
        self,
        asset_ids: List[int],
        bundle_id: int,
    ) -> None:
        """
        Add multiple assets to a bundle via array_append.
        Used after ingestion. Does not validate user access (caller must have validated).
        """
        bundle = self.session.get(Bundle, bundle_id)
        if not bundle:
            raise ValueError(f"Bundle {bundle_id} not found - it may have been deleted.")

        # Collect child asset IDs for non-container parents
        all_ids = list(asset_ids)
        assets_list = self.session.exec(select(Asset).where(Asset.id.in_(asset_ids))).all()
        non_container_ids = [a.id for a in assets_list if not a.is_container]
        if non_container_ids:
            child_ids = list(self.session.execute(
                text("SELECT id FROM asset WHERE parent_asset_id = ANY(:pids)"),
                {"pids": non_container_ids},
            ).scalars())
            all_ids.extend(child_ids)

        added = self._array_append(all_ids, bundle_id)
        if added > 0:
            self._recount_bundle(bundle)
            logger.info(f"Added {added} assets to bundle {bundle_id}")

        self.session.commit()

    def add_assets_to_bundle_validated(
        self,
        *,
        bundle_id: int,
        asset_ids: List[int],
        infospace_id: int,
        include_children: bool = True,
    ) -> tuple[int, int]:
        """Add assets to a bundle with infospace validation. Returns (assets_added, children_added)."""
        bundle = self.session.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise ValueError(f"Bundle {bundle_id} not found or infospace mismatch")

        # Filter to valid assets in this infospace
        valid_ids = [
            r[0] for r in self.session.execute(
                text("SELECT id FROM asset WHERE id = ANY(:ids) AND infospace_id = :iid"),
                {"ids": asset_ids, "iid": infospace_id},
            ).fetchall()
        ]

        children_ids = []
        if include_children and valid_ids:
            # Get children of container assets
            children_ids = [
                r[0] for r in self.session.execute(
                    text(
                        "SELECT c.id FROM asset c "
                        "JOIN asset p ON c.parent_asset_id = p.id "
                        "WHERE p.id = ANY(:ids) AND p.infospace_id = :iid"
                    ),
                    {"ids": valid_ids, "iid": infospace_id},
                ).fetchall()
            ]

        assets_added = self._array_append(valid_ids, bundle_id)
        children_added = self._array_append(children_ids, bundle_id) if children_ids else 0

        if assets_added > 0 or children_added > 0:
            self._recount_bundle(bundle)

        return assets_added, children_added

    def remove_assets_from_bundle_validated(
        self,
        *,
        bundle_id: int,
        asset_ids: List[int],
        infospace_id: int,
    ) -> int:
        """Remove assets from a bundle. Returns removed count."""
        bundle = self.session.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise ValueError(f"Bundle {bundle_id} not found or infospace mismatch")

        valid_ids = [
            r[0] for r in self.session.execute(
                text("SELECT id FROM asset WHERE id = ANY(:ids) AND infospace_id = :iid"),
                {"ids": asset_ids, "iid": infospace_id},
            ).fetchall()
        ]

        removed = self._array_remove(valid_ids, bundle_id)
        if removed > 0:
            self._recount_bundle(bundle)

        return removed

    def add_asset_to_bundle(
        self,
        *,
        bundle_id: int,
        asset_id: int,
        infospace_id: int,
        user_id: int,
        include_child_assets: bool = True
    ) -> Optional[Bundle]:
        """Add an existing asset to a bundle, optionally including child assets."""
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None

        asset = self.session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to infospace {infospace_id}.")

        ids_to_add = [asset_id]

        # Add child assets for non-container assets only
        if include_child_assets and not asset.is_container:
            child_ids = [
                r[0] for r in self.session.execute(
                    text("SELECT id FROM asset WHERE parent_asset_id = :pid"),
                    {"pid": asset_id},
                ).fetchall()
            ]
            ids_to_add.extend(child_ids)

        added = self._array_append(ids_to_add, bundle_id)
        if added > 0:
            self._recount_bundle(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Added {added} assets to bundle {bundle_id}.")

        return db_bundle

    def remove_asset_from_bundle(
        self,
        *,
        bundle_id: int,
        asset_id: int,
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Remove an asset from a bundle (array_remove with NULL normalization)."""
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            return None

        asset_to_remove = self.session.get(Asset, asset_id)
        if not asset_to_remove or asset_to_remove.infospace_id != infospace_id:
            raise ValueError(f"Asset ID {asset_id} not found or does not belong to the infospace.")

        removed = self._array_remove([asset_id], bundle_id)
        if removed > 0:
            self._recount_bundle(db_bundle)
            self.session.commit()
            self.session.refresh(db_bundle)
            logger.info(f"Service: Asset {asset_id} removed from bundle {bundle_id}.")

        return db_bundle

    def delete_bundle_returning_name(
        self,
        *,
        bundle_id: int,
        infospace_id: int,
        user_id: int,
    ) -> str:
        """Delete a bundle and return its name. Raises if not found."""
        db_bundle = self.get_bundle(bundle_id, infospace_id, user_id)
        if not db_bundle:
            raise ValueError(f"Bundle {bundle_id} not found or access denied")
        name = db_bundle.name
        self.delete_bundle(bundle_id, infospace_id, user_id)
        return name

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

        # Use containment query
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

        # Find root assets matching the path
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

        # Create child bundle
        new_bundle = Bundle(
            name=name,
            infospace_id=infospace_id,
            user_id=user_id,
            parent_bundle_id=source_bundle_id,
            asset_count=0,
        )
        self.session.add(new_bundle)
        self.session.flush()

        # Add assets to new bundle (they keep source bundle membership too)
        if root_asset_ids:
            self._array_append(root_asset_ids, new_bundle.id)
            self._recount_bundle(new_bundle)

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

        # Get assets in bundle via query (no relationship)
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
            # Move: check all assets are movable
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

    # ─── Bundle hierarchy ───

    def move_bundle_to_parent(
        self,
        *,
        child_bundle_id: int,
        parent_bundle_id: Optional[int],
        infospace_id: int,
        user_id: int
    ) -> Optional[Bundle]:
        """Move a bundle into another bundle (or to root if parent_bundle_id is None)."""
        child_bundle = self.get_bundle(child_bundle_id, infospace_id, user_id)
        if not child_bundle:
            return None

        if parent_bundle_id is not None:
            parent_bundle = self.get_bundle(parent_bundle_id, infospace_id, user_id)
            if not parent_bundle:
                return None
            if self._would_create_cycle(child_bundle_id, parent_bundle_id):
                raise ValueError("Moving bundle would create a circular reference.")

        old_parent_id = child_bundle.parent_bundle_id

        if old_parent_id:
            old_parent = self.session.get(Bundle, old_parent_id)
            if old_parent:
                old_parent.child_bundle_count = max(0, (old_parent.child_bundle_count or 0) - 1)
                self.session.add(old_parent)

        if parent_bundle_id:
            new_parent = self.session.get(Bundle, parent_bundle_id)
            if new_parent:
                new_parent.child_bundle_count = (new_parent.child_bundle_count or 0) + 1
                self.session.add(new_parent)

        child_bundle.parent_bundle_id = parent_bundle_id
        self.session.add(child_bundle)
        self.session.commit()
        self.session.refresh(child_bundle)
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
                    "children": [],
                }

            children = [build_hierarchy(c, current_depth + 1) for c in bundle_obj.child_bundles]
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
        """Get all top-level bundles (those without parent bundles)."""
        return self.session.exec(
            select(Bundle).where(
                Bundle.infospace_id == infospace_id,
                Bundle.parent_bundle_id.is_(None),
            )
        ).all()

    def cascade_delete(self, bundle_ids: Set[int]) -> int:
        """
        Clear IngestionJob/Source refs and delete bundles.
        DB trigger trg_bundle_delete_cleanup handles asset.bundle_ids cleanup.
        Caller must have already cascade-deleted assets unique to these bundles.
        """
        if not bundle_ids:
            return 0
        bundle_ids_list = list(bundle_ids)

        # Clear FK references
        jobs = list(self.session.exec(
            select(IngestionJob).where(IngestionJob.root_bundle_id.in_(bundle_ids_list))
        ).all())
        for job in jobs:
            job.root_bundle_id = None
            self.session.add(job)

        sources = list(self.session.exec(
            select(Source).where(Source.output_bundle_id.in_(bundle_ids_list))
        ).all())
        for src in sources:
            src.output_bundle_id = None
            self.session.add(src)

        deleted = 0
        for bid in bundle_ids_list:
            bundle = self.session.get(Bundle, bid)
            if bundle:
                self.session.delete(bundle)
                deleted += 1
        return deleted
