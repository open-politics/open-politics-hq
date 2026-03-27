"""
Tree Operations for Infospace Content
======================================

Layer 0 infrastructure primitive. Three operations on the infospace tree:
copy (structural fork + asset link), move (relocation), delete (contextual removal).

Bundles are folders (single parent, pure tree). Assets are files (multi-membership).
ROOT = 0. Every node always has at least one location.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session

log = logging.getLogger(__name__)

ROOT = 0


# ─── Result ───

@dataclass(frozen=True)
class TreeResult:
    message: str
    executed: bool
    assets: int = 0
    bundles: int = 0
    destroyed_assets: int = 0
    destroyed_bundles: int = 0
    unlinked: int = 0


# ─── Public API ───

def copy(
    session: Session,
    *,
    asset_ids: Optional[list[int]] = None,
    bundle_ids: Optional[list[int]] = None,
    to: int,
) -> TreeResult:
    """
    Copy assets/bundles into a destination bundle.

    Assets: gain additional membership (no new entity).
    Bundles: structural fork — new independent subtree at destination, assets gain membership in new containers.
    """
    asset_ids = asset_ids or []
    bundle_ids = bundle_ids or []

    if not asset_ids and not bundle_ids:
        return TreeResult("Nothing to copy.", executed=True)

    _assert_bundle_exists(session, to)
    _assert_not_sealed(session, to, "copy into")

    total_assets = 0
    total_bundles = 0
    new_bundle_ids: set[int] = set()

    # Fork bundles
    for bid in bundle_ids:
        _assert_bundle_exists(session, bid)
        mapping = _fork_subtree(session, bid, to, exclude=set())
        total_bundles += len(mapping)
        new_bundle_ids.update(mapping.values())
        # Assets in forked bundles gain membership in their new containers
        for old_bid, new_bid in mapping.items():
            count = _array_append_from_bundle(session, old_bid, new_bid)
            total_assets += count

    # Copy assets directly
    if asset_ids:
        added = _array_append(session, asset_ids, to)
        total_assets += added

    # Recount: destination + all newly created bundles
    recount_ids = {to} | new_bundle_ids
    _recount(session, recount_ids)

    dest_name = _node_name(session, to, is_bundle=True)
    return TreeResult(
        message=f"Copied {total_assets} assets, {total_bundles} bundles into '{dest_name}'.",
        executed=True,
        assets=total_assets,
        bundles=total_bundles,
    )


def move(
    session: Session,
    *,
    asset_ids: Optional[list[int]] = None,
    bundle_ids: Optional[list[int]] = None,
    out_of: int,
    to: int,
) -> TreeResult:
    """
    Move assets/bundles from one location to another.

    Assets: lose membership in out_of, gain membership in to. Atomic single UPDATE.
    Bundles: parent_bundle_id changes. out_of must match actual parent (catches caller bugs).
    """
    asset_ids = asset_ids or []
    bundle_ids = bundle_ids or []

    if not asset_ids and not bundle_ids:
        return TreeResult("Nothing to move.", executed=True)

    if out_of != ROOT:
        _assert_bundle_exists(session, out_of)
        _assert_not_sealed(session, out_of, "move out of")
    if to != ROOT:
        _assert_bundle_exists(session, to)
        _assert_not_sealed(session, to, "move into")

    total_assets = 0
    total_bundles = 0

    # Move bundles
    for bid in bundle_ids:
        bundle_row = session.execute(
            text("SELECT parent_bundle_id, infospace_id FROM bundle WHERE id = :bid"),
            {"bid": bid},
        ).first()
        if not bundle_row:
            raise ValueError(f"Bundle {bid} not found")
        actual_parent, infospace_id = bundle_row
        if actual_parent != out_of:
            raise ValueError(
                f"Bundle {bid} parent is {actual_parent}, not {out_of}. "
                f"out_of must match actual parent."
            )
        if _would_cycle(session, bid, to):
            raise ValueError(f"Moving bundle {bid} under {to} would create a cycle.")

        session.execute(
            text("UPDATE bundle SET parent_bundle_id = :to WHERE id = :bid"),
            {"to": to, "bid": bid},
        )
        total_bundles += 1

    # Move assets: remove from out_of, add to to, atomically
    if asset_ids:
        result = session.execute(
            text(
                "UPDATE asset SET bundle_ids = "
                "  array_append(array_remove(bundle_ids, :out_of), :to_bid) "
                "WHERE id = ANY(:ids) AND bundle_ids @> ARRAY[:out_of]::int[]"
            ),
            {"out_of": out_of, "to_bid": to, "ids": asset_ids},
        )
        total_assets = result.rowcount

    # Recount affected bundles
    recount_ids = set()
    if out_of != ROOT:
        recount_ids.add(out_of)
    if to != ROOT:
        recount_ids.add(to)
    _recount(session, recount_ids)
    _recount_children(session, bundle_ids, out_of, to)

    return TreeResult(
        message=f"Moved {total_assets} assets, {total_bundles} bundles.",
        executed=True,
        assets=total_assets,
        bundles=total_bundles,
    )


def delete(
    session: Session,
    *,
    asset_ids: Optional[list[int]] = None,
    bundle_ids: Optional[list[int]] = None,
    out_of: int,
    confirm: bool = False,
) -> TreeResult:
    """
    Delete assets/bundles from a location.

    Assets: lose membership in out_of. If last membership → destroyed.
    Bundles: destroyed (single parent = last location). Cascade: subtree destroyed,
    exclusive assets destroyed, shared assets unlinked.

    confirm=False: preview (what WOULD happen). confirm=True: re-analyzes then executes.
    """
    asset_ids = asset_ids or []
    bundle_ids = bundle_ids or []

    if not asset_ids and not bundle_ids:
        return TreeResult("Nothing to delete.", executed=True)

    if out_of != ROOT:
        _assert_bundle_exists(session, out_of)
        _assert_not_sealed(session, out_of, "delete from")

    # ── Analyze ──

    # Expand bundle subtrees
    all_bundle_ids: set[int] = set()
    for bid in bundle_ids:
        sub = subtree_ids(session, {bid})
        all_bundle_ids.update(sub)

    # Check sealed in subtree
    if all_bundle_ids:
        sealed_count = session.execute(
            text("SELECT count(*) FROM bundle WHERE id = ANY(:bids) AND sealed = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if sealed_count:
            raise ValueError(f"Cannot delete: {sealed_count} sealed bundles in subtree.")

    # Check active sources that use these bundles as output targets
    if all_bundle_ids:
        active_source_count = session.execute(
            text("SELECT count(*) FROM source WHERE output_bundle_id = ANY(:bids) AND is_active = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if active_source_count:
            raise ValueError(
                f"Cannot delete: {active_source_count} active sources use bundles in this "
                f"subtree as output targets. Pause the sources first."
            )

    # Find exclusive assets (all memberships within the subtree being deleted)
    destroyed_assets: set[int] = set()
    unlinked_assets: set[int] = set()
    if all_bundle_ids:
        destroyed_assets, unlinked_assets = _exclusive_assets(session, all_bundle_ids)

    # Direct asset deletions
    direct_destroyed: set[int] = set()
    direct_survived: set[int] = set()
    if asset_ids:
        rows = session.execute(
            text("SELECT id, bundle_ids FROM asset WHERE id = ANY(:ids)"),
            {"ids": asset_ids},
        ).fetchall()
        for aid, bids in rows:
            if aid in destroyed_assets:
                continue  # already counted in bundle cascade
            remaining = [b for b in (bids or []) if b != out_of]
            if not remaining:
                direct_destroyed.add(aid)
            else:
                direct_survived.add(aid)

    total_destroyed_assets = len(destroyed_assets) + len(direct_destroyed)
    total_unlinked = len(unlinked_assets) + len(direct_survived)

    if not confirm:
        parts = []
        if all_bundle_ids:
            parts.append(f"{len(all_bundle_ids)} bundles")
        if total_destroyed_assets:
            parts.append(f"{total_destroyed_assets} assets destroyed")
        if total_unlinked:
            parts.append(f"{total_unlinked} assets unlinked")
        msg = "Will delete: " + ", ".join(parts) + "." if parts else "Nothing to delete."
        return TreeResult(
            message=msg,
            executed=False,
            bundles=len(all_bundle_ids),
            destroyed_assets=total_destroyed_assets,
            unlinked=total_unlinked,
        )

    # ── Execute ──
    # Re-analyze from current state (TOCTOU: preview is informational, confirm is authoritative)
    all_bundle_ids = set()
    for bid in bundle_ids:
        sub = subtree_ids(session, {bid})
        all_bundle_ids.update(sub)

    if all_bundle_ids:
        sealed_count = session.execute(
            text("SELECT count(*) FROM bundle WHERE id = ANY(:bids) AND sealed = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if sealed_count:
            raise ValueError(f"Cannot delete: {sealed_count} sealed bundles in subtree.")

        active_source_count = session.execute(
            text("SELECT count(*) FROM source WHERE output_bundle_id = ANY(:bids) AND is_active = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if active_source_count:
            raise ValueError(
                f"Cannot delete: {active_source_count} active sources use bundles in this "
                f"subtree as output targets. Pause the sources first."
            )

    destroyed_assets = set()
    unlinked_assets = set()
    if all_bundle_ids:
        destroyed_assets, unlinked_assets = _exclusive_assets(session, all_bundle_ids)

    direct_destroyed = set()
    direct_survived = set()
    if asset_ids:
        rows = session.execute(
            text("SELECT id, bundle_ids FROM asset WHERE id = ANY(:ids)"),
            {"ids": asset_ids},
        ).fetchall()
        for aid, bids in rows:
            if aid in destroyed_assets:
                continue
            remaining = [b for b in (bids or []) if b != out_of]
            if not remaining:
                direct_destroyed.add(aid)
            else:
                direct_survived.add(aid)

    # Unlink shared assets from subtree bundles
    if unlinked_assets and all_bundle_ids:
        for bid in all_bundle_ids:
            _array_remove(session, list(unlinked_assets), bid)

    # Unlink survived direct assets
    if direct_survived:
        _array_remove(session, list(direct_survived), out_of)

    # Destroy exclusive + direct-destroyed assets
    all_destroyed_assets = destroyed_assets | direct_destroyed
    destroyed_asset_count = 0
    if all_destroyed_assets:
        destroyed_asset_count = _destroy_assets(session, all_destroyed_assets)

    # Destroy bundles (subtree)
    destroyed_bundle_count = 0
    if all_bundle_ids:
        destroyed_bundle_count = _destroy_bundles(session, all_bundle_ids)

    # Recount affected surviving bundles
    recount_ids = set()
    if out_of != ROOT:
        recount_ids.add(out_of)
    # Any bundle that had shared assets unlinked
    # (their recount is handled by _array_remove already affecting the DB)
    _recount(session, recount_ids)

    total_unlinked = len(unlinked_assets) + len(direct_survived)
    return TreeResult(
        message=f"Deleted {destroyed_bundle_count} bundles, {destroyed_asset_count} assets. {total_unlinked} assets unlinked.",
        executed=True,
        bundles=destroyed_bundle_count,
        destroyed_assets=destroyed_asset_count,
        destroyed_bundles=destroyed_bundle_count,
        unlinked=total_unlinked,
    )


def subtree_ids(session: Session, roots: set[int]) -> set[int]:
    """Recursive CTE: given root bundle IDs, return full subtree including roots."""
    if not roots:
        return set()
    rows = session.execute(
        text("""
            WITH RECURSIVE tree AS (
                SELECT id FROM bundle WHERE id = ANY(:bids)
                UNION ALL
                SELECT b.id FROM bundle b JOIN tree ON b.parent_bundle_id = tree.id
            )
            SELECT id FROM tree
        """),
        {"bids": list(roots)},
    ).fetchall()
    return {r[0] for r in rows}


def seal_subtree(session: Session, bundle_id: int) -> int:
    """Seal a bundle and all descendants. Returns count of bundles sealed."""
    _assert_bundle_exists(session, bundle_id)
    ids = subtree_ids(session, {bundle_id})
    result = session.execute(
        text("UPDATE bundle SET sealed = true WHERE id = ANY(:bids) AND sealed = false"),
        {"bids": list(ids)},
    )
    return result.rowcount


def unseal_subtree(session: Session, bundle_id: int) -> int:
    """Unseal a bundle and all descendants. Rejects if active packages reference the subtree."""
    _assert_bundle_exists(session, bundle_id)
    ids = subtree_ids(session, {bundle_id})

    # Lock package items to prevent race between check and unseal
    pkg_count = session.execute(
        text(
            "SELECT count(*) FROM ("
            "  SELECT pi.id FROM packageitem pi "
            "  JOIN package p ON pi.package_id = p.id "
            "  WHERE pi.bundle_id = ANY(:bids) AND p.is_active = true "
            "  AND (p.expires_at IS NULL OR p.expires_at > NOW()) "
            "  FOR UPDATE OF pi"
            ") locked"
        ),
        {"bids": list(ids)},
    ).scalar()
    if pkg_count:
        raise ValueError(f"Cannot unseal: {pkg_count} active package items reference this subtree.")

    result = session.execute(
        text("UPDATE bundle SET sealed = false WHERE id = ANY(:bids) AND sealed = true"),
        {"bids": list(ids)},
    )
    return result.rowcount


# ─── Internal helpers ───

def _assert_bundle_exists(session: Session, bundle_id: int) -> None:
    """Raise if bundle doesn't exist. ROOT (0) always exists."""
    if bundle_id == ROOT:
        return
    exists = session.execute(
        text("SELECT 1 FROM bundle WHERE id = :bid"),
        {"bid": bundle_id},
    ).first()
    if not exists:
        raise ValueError(f"Bundle {bundle_id} does not exist.")


def _assert_not_sealed(session: Session, bundle_id: int, verb: str) -> None:
    """Raise if bundle is sealed. ROOT is never sealed."""
    if bundle_id == ROOT:
        return
    sealed = session.execute(
        text("SELECT sealed FROM bundle WHERE id = :bid"),
        {"bid": bundle_id},
    ).scalar()
    if sealed:
        raise ValueError(f"Cannot {verb} sealed bundle {bundle_id}.")


def _array_append(session: Session, asset_ids: list[int], bundle_id: int) -> int:
    """Add bundle_id to bundle_ids for given assets. Idempotent. Returns rows changed."""
    if not asset_ids:
        return 0
    result = session.execute(
        text(
            "UPDATE asset SET bundle_ids = array_append(bundle_ids, :bid) "
            "WHERE id = ANY(:ids) "
            "AND NOT (bundle_ids @> ARRAY[:bid]::int[])"
        ),
        {"bid": bundle_id, "ids": asset_ids},
    )
    return result.rowcount


def _array_append_from_bundle(session: Session, source_bundle_id: int, target_bundle_id: int) -> int:
    """Add target_bundle_id to all assets that are in source_bundle_id. Returns rows changed."""
    result = session.execute(
        text(
            "UPDATE asset SET bundle_ids = array_append(bundle_ids, :to_bid) "
            "WHERE bundle_ids @> ARRAY[:from_bid]::int[] "
            "AND NOT (bundle_ids @> ARRAY[:to_bid]::int[])"
        ),
        {"from_bid": source_bundle_id, "to_bid": target_bundle_id},
    )
    return result.rowcount


def _array_remove(session: Session, asset_ids: list[int], bundle_id: int) -> int:
    """Remove bundle_id from bundle_ids. Normalizes empty to {ROOT}. Returns rows changed."""
    if not asset_ids:
        return 0
    result = session.execute(
        text(
            "UPDATE asset SET bundle_ids = CASE "
            "  WHEN array_length(array_remove(bundle_ids, :bid), 1) IS NULL "
            "    THEN ARRAY[0]::int[] "
            "  ELSE array_remove(bundle_ids, :bid) "
            "END "
            "WHERE id = ANY(:ids) "
            "AND bundle_ids @> ARRAY[:bid]::int[]"
        ),
        {"bid": bundle_id, "ids": asset_ids},
    )
    return result.rowcount


def _fork_subtree(
    session: Session,
    bundle_id: int,
    new_parent: int,
    exclude: set[int],
) -> dict[int, int]:
    """
    Recursively create new bundles mirroring the subtree.
    Returns {old_id: new_id} mapping.

    Batch path: one CTE collects structure, bulk insert, batch asset membership.
    """
    # Collect entire subtree structure in one query
    rows = session.execute(
        text("""
            WITH RECURSIVE tree AS (
                SELECT id, parent_bundle_id, name, description, purpose,
                       bundle_metadata, version, tags, infospace_id, user_id, 0 AS depth
                FROM bundle WHERE id = :root
                UNION ALL
                SELECT b.id, b.parent_bundle_id, b.name, b.description, b.purpose,
                       b.bundle_metadata, b.version, b.tags, b.infospace_id, b.user_id, t.depth + 1
                FROM bundle b JOIN tree t ON b.parent_bundle_id = t.id
            )
            SELECT * FROM tree ORDER BY depth
        """),
        {"root": bundle_id},
    ).fetchall()

    if not rows:
        return {}

    mapping: dict[int, int] = {}  # old_id → new_id

    for row in rows:
        old_id = row[0]
        if old_id in exclude:
            continue

        old_parent = row[1]

        # Determine new parent: root of fork goes to new_parent, descendants follow mapping
        if old_id == bundle_id:
            fork_parent = new_parent
        else:
            if old_parent in exclude or old_parent not in mapping:
                continue  # parent was excluded, skip this branch
            fork_parent = mapping[old_parent]

        # Deduplicate name at the target parent
        fork_name = _unique_name(session, row[2], row[8], fork_parent, row[6])

        # Insert new bundle
        result = session.execute(
            text(
                "INSERT INTO bundle (name, description, purpose, bundle_metadata, version, "
                "tags, infospace_id, user_id, parent_bundle_id, asset_count, child_bundle_count, "
                "uuid, created_at, updated_at) "
                "VALUES (:name, :desc, :purpose, :meta, :version, :tags, :iid, :uid, "
                ":parent, 0, 0, gen_random_uuid()::text, now(), now()) "
                "RETURNING id"
            ),
            {
                "name": fork_name,
                "desc": row[3],
                "purpose": row[4],
                "meta": row[5],
                "version": row[6],
                "tags": row[7],
                "iid": row[8],
                "uid": row[9],
                "parent": fork_parent,
            },
        )
        new_id = result.scalar()
        mapping[old_id] = new_id

    # Recount child_bundle_count for new bundles
    for new_id in mapping.values():
        session.execute(
            text(
                "UPDATE bundle SET child_bundle_count = "
                "(SELECT count(*) FROM bundle WHERE parent_bundle_id = :bid) "
                "WHERE id = :bid"
            ),
            {"bid": new_id},
        )

    return mapping


def _exclusive_assets(session: Session, subtree: set[int]) -> tuple[set[int], set[int]]:
    """
    Find assets exclusive to the subtree (all memberships within subtree) vs shared.

    THIS IS THE MOST DANGEROUS OPERATION IN THE MODULE.
    If subtree is incomplete, <@ over-classifies assets as exclusive and destroys them.

    Under READ COMMITTED, concurrent inserts go in the safe direction: new bundles
    are NOT in the subtree set, so their assets are NOT marked exclusive. Over-preserves,
    never over-destroys.

    Returns (exclusive_ids, shared_ids).
    """
    assert len(subtree) >= 1, "subtree_ids returned empty set"

    subtree_list = list(subtree)

    # Exclusive: ALL memberships are within the subtree (<@ = contained by)
    exclusive_rows = session.execute(
        text("SELECT id FROM asset WHERE bundle_ids <@ CAST(:bids AS int[])"),
        {"bids": subtree_list},
    ).fetchall()
    exclusive = {r[0] for r in exclusive_rows}

    # Shared: overlap with subtree but NOT exclusive (have memberships outside)
    shared_rows = session.execute(
        text(
            "SELECT id FROM asset "
            "WHERE bundle_ids && CAST(:bids AS int[]) "
            "AND NOT (bundle_ids <@ CAST(:bids AS int[]))"
        ),
        {"bids": subtree_list},
    ).fetchall()
    shared = {r[0] for r in shared_rows}

    log.info(f"Cascade: {len(subtree)} bundles, {len(exclusive)} exclusive assets, {len(shared)} shared assets")
    return exclusive, shared


def _destroy_assets(session: Session, asset_ids: set[int]) -> int:
    """Destroy assets and their children. Clears all FK references first."""
    if not asset_ids:
        return 0

    ids_list = list(asset_ids)

    # Collect children recursively
    all_child_ids: list[int] = []
    current_level = ids_list
    while current_level:
        children = [
            r[0] for r in session.execute(
                text("SELECT id FROM asset WHERE parent_asset_id = ANY(:ids)"),
                {"ids": current_level},
            ).fetchall()
        ]
        if not children:
            break
        all_child_ids.extend(children)
        current_level = children

    all_ids = ids_list + all_child_ids

    # Clear previous_asset_id references
    session.execute(
        text("UPDATE asset SET previous_asset_id = NULL WHERE previous_asset_id = ANY(:ids)"),
        {"ids": all_ids},
    )

    # Clear graph data linked through annotations
    annotation_ids = [
        r[0] for r in session.execute(
            text("SELECT id FROM annotation WHERE asset_id = ANY(:ids)"),
            {"ids": all_ids},
        ).fetchall()
    ]
    if annotation_ids:
        session.execute(
            text("DELETE FROM justification WHERE annotation_id = ANY(:aids)"),
            {"aids": annotation_ids},
        )
        session.execute(
            text("DELETE FROM fragmentcuration WHERE annotation_id = ANY(:aids)"),
            {"aids": annotation_ids},
        )
        session.execute(
            text("DELETE FROM graphedge WHERE annotation_id = ANY(:aids)"),
            {"aids": annotation_ids},
        )

    # Clear annotations and chunks
    session.execute(
        text("DELETE FROM annotation WHERE asset_id = ANY(:ids)"),
        {"ids": all_ids},
    )
    session.execute(
        text("DELETE FROM assetchunk WHERE asset_id = ANY(:ids)"),
        {"ids": all_ids},
    )

    # Delete children first (deepest first), then parents
    if all_child_ids:
        session.execute(
            text("DELETE FROM asset WHERE id = ANY(:ids)"),
            {"ids": all_child_ids},
        )
    result = session.execute(
        text("DELETE FROM asset WHERE id = ANY(:ids)"),
        {"ids": ids_list},
    )
    return result.rowcount + len(all_child_ids)


def _destroy_bundles(session: Session, bundle_ids: set[int]) -> int:
    """Destroy bundles. Clears FK references (IngestionJob, Source, AnnotationRun) first."""
    if not bundle_ids:
        return 0

    ids_list = list(bundle_ids)

    # Clear FK references
    session.execute(
        text("UPDATE ingestionjob SET root_bundle_id = NULL WHERE root_bundle_id = ANY(:bids)"),
        {"bids": ids_list},
    )
    session.execute(
        text("UPDATE source SET output_bundle_id = NULL WHERE output_bundle_id = ANY(:bids)"),
        {"bids": ids_list},
    )
    # Clear annotation run source_bundle_id if it exists
    session.execute(
        text("UPDATE annotationrun SET source_bundle_id = NULL WHERE source_bundle_id = ANY(:bids)"),
        {"bids": ids_list},
    )

    # Delete all bundles in one pass. Validation trigger only fires on INSERT/UPDATE,
    # not DELETE, so order is irrelevant. Cleanup trigger handles asset.bundle_ids.
    result = session.execute(
        text("DELETE FROM bundle WHERE id = ANY(:bids)"),
        {"bids": ids_list},
    )
    return result.rowcount


def _recount(session: Session, bundle_ids: set[int]) -> None:
    """Recount asset_count for given bundles from DB truth."""
    for bid in bundle_ids:
        session.execute(
            text(
                "UPDATE bundle SET asset_count = "
                "(SELECT count(*) FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[]), "
                "updated_at = now() "
                "WHERE id = :bid"
            ),
            {"bid": bid},
        )


def _recount_children(session: Session, moved_bundle_ids: list[int], old_parent: int, new_parent: int) -> None:
    """Update child_bundle_count after bundle moves."""
    if not moved_bundle_ids:
        return
    count = len(moved_bundle_ids)

    if old_parent != ROOT:
        session.execute(
            text(
                "UPDATE bundle SET child_bundle_count = "
                "GREATEST(0, COALESCE(child_bundle_count, 0) - :n) "
                "WHERE id = :bid"
            ),
            {"n": count, "bid": old_parent},
        )

    if new_parent != ROOT:
        session.execute(
            text(
                "UPDATE bundle SET child_bundle_count = "
                "COALESCE(child_bundle_count, 0) + :n "
                "WHERE id = :bid"
            ),
            {"n": count, "bid": new_parent},
        )


def _unique_name(session: Session, name: str, infospace_id: int, parent_id: int, version: str) -> str:
    """Generate a unique bundle name at the target parent, appending ' (copy N)' if needed."""
    exists = session.execute(
        text(
            "SELECT 1 FROM bundle WHERE infospace_id = :iid AND parent_bundle_id = :pid "
            "AND name = :name AND version = :ver"
        ),
        {"iid": infospace_id, "pid": parent_id, "name": name, "ver": version},
    ).first()
    if not exists:
        return name
    for i in range(1, 100):
        candidate = f"{name} (copy {i})" if i > 1 else f"{name} (copy)"
        exists = session.execute(
            text(
                "SELECT 1 FROM bundle WHERE infospace_id = :iid AND parent_bundle_id = :pid "
                "AND name = :name AND version = :ver"
            ),
            {"iid": infospace_id, "pid": parent_id, "name": candidate, "ver": version},
        ).first()
        if not exists:
            return candidate
    raise ValueError(f"Cannot generate unique name for '{name}'")


def _node_name(session: Session, node_id: int, is_bundle: bool) -> str:
    """Get display name for a node."""
    if node_id == ROOT:
        return "root"
    table = "bundle" if is_bundle else "asset"
    col = "name" if is_bundle else "title"
    row = session.execute(
        text(f"SELECT {col} FROM {table} WHERE id = :nid"),
        {"nid": node_id},
    ).first()
    return row[0] if row else f"<{table} {node_id}>"


def _would_cycle(session: Session, child_id: int, new_parent_id: int) -> bool:
    """Check if making new_parent_id the parent of child_id would create a cycle."""
    if new_parent_id == ROOT:
        return False
    current_id = new_parent_id
    visited: set[int] = set()
    while current_id != ROOT and current_id not in visited:
        if current_id == child_id:
            return True
        visited.add(current_id)
        row = session.execute(
            text("SELECT parent_bundle_id FROM bundle WHERE id = :bid"),
            {"bid": current_id},
        ).first()
        if not row:
            break
        current_id = row[0]
    return False
