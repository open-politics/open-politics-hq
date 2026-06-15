"""
Tree Operations for Infospace Content
======================================

Home of the content-tree domain — the single place that owns Bundle/Asset
structure and every operation on it. Composable verbs:

  walk      subtree_ids (bundles) · asset_descendants (assets)   — recursive CTE
  weigh     impact                                               — deletion preview, counts only
  member    attach · detach                                      — bundle membership (ROOT-normalizing)
  mutate    create_bundle · copy · move · delete                 — structural changes
  purge     purge                                                — hard-destroy assets + their subtree

Bundles are folders (single parent, pure tree). Assets are files (multi-membership).
ROOT = 0. Every node always has at least one location.

Bulk structural ops are raw set-based SQL (array ``= ANY``, recursive CTEs) by
design; ``create_bundle`` is the one verb that constructs a row, so it touches
the Bundle model.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session, select

from app.models import Asset, Bundle

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
    # Sources whose output bundle was deleted — paused + flagged WARNING (not blocked).
    paused_sources: int = 0


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
        added = attach(session, asset_ids, to)
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


def create_bundle(
    session: Session,
    *,
    infospace_id: int,
    user_id: int,
    asset_ids: Optional[list[int]] = None,
    **fields,
) -> Bundle:
    """Create a bundle, optionally seeding it with assets. Flush-only; caller commits.

    The one birthplace of a Bundle row. ``**fields`` are Bundle columns (name,
    description, parent_bundle_id, …); ``parent_bundle_id`` defaults to ROOT. Seed
    assets are linked through ``copy`` so a bundle's initial contents flow through
    the same membership path as every other move — no special-case row writes.
    Access/ownership checks belong to the caller; this verb is pure structure.
    """
    if fields.get("parent_bundle_id") is None:
        fields["parent_bundle_id"] = ROOT

    bundle = Bundle(infospace_id=infospace_id, user_id=user_id, asset_count=0, **fields)
    session.add(bundle)
    session.flush()  # assign bundle.id

    if asset_ids:
        result = copy(session, asset_ids=list(asset_ids), to=bundle.id)
        bundle.asset_count = result.assets
        session.add(bundle)
        session.flush()

    return bundle


# ─── Ingestion destinations (find-or-create placement) ───
# The placement half of the acquire spine: a destination is resolved/created once,
# folder paths become nested bundles, and container types (archive, feed) expand
# into their own bundle. All flush-only; the task/route owns the transaction.

def resolve_or_create_bundle(
    session: Session,
    infospace_id: int,
    user_id: int,
    *,
    bundle_id: Optional[int] = None,
    bundle_name: Optional[str] = None,
    parent_bundle_id: Optional[int] = None,
) -> Optional[Bundle]:
    """Resolve a destination bundle from caller-supplied identifiers.

    - ``bundle_name`` given → create a new bundle (child of ``parent_bundle_id``
      or ROOT) and return it.
    - ``bundle_id`` given → validate it exists, belongs to this infospace, and
      isn't sealed; return the Bundle row.
    - Neither → return ``None`` (caller treats as ROOT — items land top-level).
    - Both → ``ValueError`` (ambiguous contract).
    """
    if bundle_id is not None and bundle_name is not None:
        raise ValueError("Provide at most one of bundle_id or bundle_name")

    if bundle_id is not None:
        _assert_bundle_exists(session, bundle_id)
        _assert_not_sealed(session, bundle_id, "ingest into")
        bundle = session.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise ValueError(f"Bundle {bundle_id} not found in this infospace")
        return bundle

    if bundle_name is not None:
        parent = parent_bundle_id if parent_bundle_id is not None else ROOT
        if parent != ROOT:
            _assert_bundle_exists(session, parent)
            _assert_not_sealed(session, parent, "nest under")
        return create_bundle(
            session, infospace_id=infospace_id, user_id=user_id,
            name=bundle_name, parent_bundle_id=parent,
        )

    return None


def find_or_create_child_bundle(
    session: Session,
    infospace_id: int,
    user_id: int,
    *,
    name: str,
    parent_id: Optional[int] = None,
) -> Bundle:
    """Find the bundle named ``name`` directly under ``parent_id`` (this infospace),
    or create it. The single-segment find-or-create a **container type** uses to make
    "a bundle named after the archive / feed" idempotent across a reprocess. Unlike
    ``resolve_or_create_bundle`` (which always creates), this reuses an existing match.
    ``parent_id=None`` → ROOT."""
    parent = parent_id if parent_id is not None else ROOT
    existing = session.exec(
        select(Bundle).where(
            Bundle.infospace_id == infospace_id,
            Bundle.name == name,
            Bundle.parent_bundle_id == parent,
        )
    ).first()
    if existing:
        return existing
    return resolve_or_create_bundle(
        session, infospace_id, user_id, bundle_name=name, parent_bundle_id=parent,
    )


def expand_into_bundle(
    session: Session,
    infospace_id: int,
    user_id: int,
    asset,
    name: str,
) -> int:
    """The shared "container expands into its own bundle" move (archive, feed).

    Create (or reuse) a bundle named ``name`` nested under the asset's current bundle,
    move the container **artifact** inside it (the artifact lives with its contents),
    and return the bundle id. Idempotent across a reprocess — if the asset already sits
    in a bundle named ``name`` (its contents bundle from a prior run), that one is reused
    rather than nesting a duplicate."""
    parent_id = (asset.bundle_ids or [ROOT])[0]
    parent = session.get(Bundle, parent_id) if parent_id else None
    if parent is not None and parent.name == name:
        return parent.id   # reprocess: already inside our own contents bundle
    bundle = find_or_create_child_bundle(
        session, infospace_id, user_id, name=name, parent_id=parent_id,
    )
    asset.bundle_ids = [bundle.id]
    session.add(asset)
    return bundle.id


def ensure_path_bundles(
    session: Session,
    root_bundle_id: Optional[int],
    path: Optional[str],
    *,
    user_id: int,
    infospace_id: int,
    memo: dict,
) -> Optional[int]:
    """Resolve a ``"/"``-separated folder path to its leaf **folder-bundle** under
    ``root_bundle_id``, **find-or-creating** each segment (a re-import reuses the
    same bundles, never duplicates). Memoized per run via ``memo`` (path → id).
    Empty path → ``root_bundle_id`` (flat). The one placement primitive: folders
    become bundles, uniformly for directory and archive imports. Flush-only."""
    norm = (path or "").strip("/").strip()
    if not norm:
        return root_bundle_id
    parent = root_bundle_id
    accum = ""
    for seg in norm.split("/"):
        if not seg or seg in (".", ".."):
            continue
        accum = f"{accum}/{seg}" if accum else seg
        if accum in memo:
            parent = memo[accum]
            continue
        existing = session.exec(
            select(Bundle).where(
                Bundle.infospace_id == infospace_id,
                Bundle.name == seg,
                Bundle.parent_bundle_id == parent,
            )
        ).first()
        bid = existing.id if existing else resolve_or_create_bundle(
            session, infospace_id, user_id, bundle_name=seg, parent_bundle_id=parent,
        ).id
        memo[accum] = bid
        parent = bid
    return parent


# ─── Reads (shared structure queries) ───

def bundle_assets(
    session: Session, bundle_id: int, *, skip: int = 0, limit: int = 100,
) -> list[Asset]:
    """Page of assets that are members of ``bundle_id`` (newest first).
    Pure structure read — caller validates infospace/access."""
    asset_ids = [
        r[0] for r in session.execute(
            text(
                "SELECT id FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[] "
                "ORDER BY created_at DESC OFFSET :off LIMIT :lim"
            ),
            {"bid": bundle_id, "off": skip, "lim": limit},
        ).fetchall()
    ]
    if not asset_ids:
        return []
    return list(session.exec(
        select(Asset).where(Asset.id.in_(asset_ids)).order_by(Asset.created_at.desc())
    ).all())


# ─── Cross-infospace transfer ───

def transfer(
    session: Session,
    *,
    bundle_id: int,
    user_id: int,
    source_infospace_id: int,
    target_infospace_id: int,
    copy_assets: bool = True,
) -> Optional[Bundle]:
    """Transfer a bundle to another infospace. Flush-only; caller commits.

    ``copy_assets=True``: duplicate the member assets into the target infospace and
    create a fresh bundle seeded with them (the source stays untouched).
    ``copy_assets=False``: move the bundle row itself (asset rows keep their
    infospace — a known limitation, logged)."""
    db_bundle = session.get(Bundle, bundle_id)
    if not db_bundle or db_bundle.infospace_id != source_infospace_id:
        return None

    bundle_assets_rows = list(session.exec(
        select(Asset).where(
            text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id)
        )
    ).all())

    if copy_assets:
        new_asset_ids = _copy_assets_to_infospace(
            session, bundle_assets_rows, target_infospace_id, user_id,
        )
        new_name = _transfer_name(session, db_bundle.name, db_bundle.version or "1.0", target_infospace_id)
        return create_bundle(
            session, infospace_id=target_infospace_id, user_id=user_id,
            asset_ids=new_asset_ids or None,
            name=new_name, description=db_bundle.description,
        )

    if any(a.infospace_id != source_infospace_id for a in bundle_assets_rows):
        log.warning("Cannot move bundle %s cleanly: asset infospace mismatch", bundle_id)
    new_name = _transfer_name(session, db_bundle.name, db_bundle.version, target_infospace_id)
    if new_name != db_bundle.name:
        db_bundle.name = new_name
    db_bundle.infospace_id = target_infospace_id
    db_bundle.updated_at = datetime.now(timezone.utc)
    session.add(db_bundle)
    session.flush()
    return db_bundle


def _transfer_name(session: Session, original_name: str, version: str, target_infospace_id: int) -> str:
    """Find a non-conflicting bundle name in the target infospace (``name_N`` suffixing)."""
    base_name = re.sub(r'_\d+$', '', original_name)
    existing_bundles = session.exec(
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
        existing = session.exec(
            select(Bundle).where(
                Bundle.infospace_id == target_infospace_id,
                Bundle.name == base_name,
                Bundle.version == version,
            )
        ).first()
        return base_name if not existing else f"{base_name}_1"
    return f"{base_name}_{max_suffix + 1}"


def _copy_assets_to_infospace(
    session: Session, assets: list[Asset], target_infospace_id: int, user_id: int,
) -> list[int]:
    """Duplicate asset rows into the target infospace. Returns new asset ids."""
    new_assets = []
    for asset in assets:
        try:
            new_assets.append(Asset(
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
            ))
        except Exception as e:
            log.error("Failed to copy asset %s: %s", asset.id, e)
            continue
    if new_assets:
        session.add_all(new_assets)
        session.flush()
    return [a.id for a in new_assets if a.id is not None]


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

    # Expand bundle subtrees
    all_bundle_ids: set[int] = set()
    for bid in bundle_ids:
        all_bundle_ids.update(subtree_ids(session, {bid}))

    # Sealed bundles are a hard stop in both preview and execute.
    if all_bundle_ids:
        sealed_count = session.execute(
            text("SELECT count(*) FROM bundle WHERE id = ANY(:bids) AND sealed = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if sealed_count:
            raise ValueError(f"Cannot delete: {sealed_count} sealed bundles in subtree.")

    if not confirm:
        # Preview is its own composable verb — see impact().
        return impact(session, asset_ids=asset_ids, bundle_ids=bundle_ids, out_of=out_of)

    # ── Execute ──
    # Re-expand from current state (TOCTOU: preview is informational, confirm is authoritative).
    all_bundle_ids = set()
    for bid in bundle_ids:
        all_bundle_ids.update(subtree_ids(session, {bid}))

    if all_bundle_ids:
        sealed_count = session.execute(
            text("SELECT count(*) FROM bundle WHERE id = ANY(:bids) AND sealed = true"),
            {"bids": list(all_bundle_ids)},
        ).scalar()
        if sealed_count:
            raise ValueError(f"Cannot delete: {sealed_count} sealed bundles in subtree.")

    # Pause + flag sources that output into the doomed bundles BEFORE destroying
    # them (which nulls output_bundle_id). The source keeps a WARNING note so the
    # user can rewire it to a new bundle.
    paused_source_count = 0
    if all_bundle_ids:
        paused_source_count = _pause_sources_for_deleted_bundles(session, all_bundle_ids)

    destroyed_assets: set[int] = set()
    unlinked_assets: set[int] = set()
    if all_bundle_ids:
        destroyed_assets, unlinked_assets = _exclusive_assets(session, all_bundle_ids)

    direct_destroyed: set[int] = set()
    direct_survived: set[int] = set()
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
            detach(session, list(unlinked_assets), bid)

    # Unlink survived direct assets
    if direct_survived:
        detach(session, list(direct_survived), out_of)

    # Destroy exclusive + direct-destroyed assets
    all_destroyed_assets = destroyed_assets | direct_destroyed
    destroyed_asset_count = 0
    if all_destroyed_assets:
        destroyed_asset_count = purge(session, all_destroyed_assets)

    # Destroy bundles (subtree)
    destroyed_bundle_count = 0
    if all_bundle_ids:
        destroyed_bundle_count = _destroy_bundles(session, all_bundle_ids)

    # Recount affected surviving bundles
    recount_ids = set()
    if out_of != ROOT:
        recount_ids.add(out_of)
    # Any bundle that had shared assets unlinked
    # (their recount is handled by detach already affecting the DB)
    _recount(session, recount_ids)

    total_unlinked = len(unlinked_assets) + len(direct_survived)
    message = f"Deleted {destroyed_bundle_count} bundles, {destroyed_asset_count} assets. {total_unlinked} assets unlinked."
    if paused_source_count:
        message += f" {paused_source_count} sources paused."
    return TreeResult(
        message=message,
        executed=True,
        bundles=destroyed_bundle_count,
        destroyed_assets=destroyed_asset_count,
        destroyed_bundles=destroyed_bundle_count,
        unlinked=total_unlinked,
        paused_sources=paused_source_count,
    )


def impact(
    session: Session,
    *,
    asset_ids: Optional[list[int]] = None,
    bundle_ids: Optional[list[int]] = None,
    out_of: int,
) -> TreeResult:
    """Preview a deletion: counts of what would be destroyed vs unlinked.

    Counts only — NEVER materialize id sets here: a single bundle can hold 100k+
    assets, and fetching every id just to call len() was the cause of preview
    timeouts. Aggregate counts are GIN-accelerated and cheap. This is the same
    computation ``delete(confirm=False)`` returns, exposed as its own verb so
    callers can weigh an operation without threading it through delete().
    """
    asset_ids = asset_ids or []
    bundle_ids = bundle_ids or []

    all_bundle_ids: set[int] = set()
    for bid in bundle_ids:
        all_bundle_ids.update(subtree_ids(session, {bid}))

    excl_n, shared_n = _exclusive_asset_counts(session, all_bundle_ids) if all_bundle_ids else (0, 0)
    direct_d, direct_s = _direct_asset_counts(session, asset_ids, out_of, all_bundle_ids) if asset_ids else (0, 0)
    total_destroyed_assets = excl_n + direct_d
    total_unlinked = shared_n + direct_s

    # Sources that output into this subtree are NOT a hard block — deleting
    # their output bundle pauses them and flags WARNING (handled in execute).
    source_count = 0
    if all_bundle_ids:
        source_count = session.execute(
            text("SELECT count(*) FROM source WHERE output_bundle_id = ANY(:bids)"),
            {"bids": list(all_bundle_ids)},
        ).scalar() or 0

    parts = []
    if all_bundle_ids:
        parts.append(f"{len(all_bundle_ids)} bundles")
    if total_destroyed_assets:
        parts.append(f"{total_destroyed_assets} assets destroyed")
    if total_unlinked:
        parts.append(f"{total_unlinked} assets unlinked")
    if source_count:
        parts.append(f"{source_count} sources paused")
    msg = "Will delete: " + ", ".join(parts) + "." if parts else "Nothing to delete."
    return TreeResult(
        message=msg,
        executed=False,
        bundles=len(all_bundle_ids),
        destroyed_assets=total_destroyed_assets,
        unlinked=total_unlinked,
        paused_sources=source_count,
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


def asset_descendants(session: Session, roots: set[int]) -> set[int]:
    """Recursive CTE: given root asset IDs, return the full container subtree including roots.

    Sibling of ``subtree_ids`` for the asset axis — walks ``parent_asset_id`` (a
    container's parts, their parts, …). Used by ``purge`` and anywhere the asset
    hierarchy must be expanded without materializing an IN-list (which on a large
    bundled CSV blew past Postgres's 65k-parameter ceiling).
    """
    if not roots:
        return set()
    rows = session.execute(
        text("""
            WITH RECURSIVE tree AS (
                SELECT id FROM asset WHERE id = ANY(:ids)
                UNION ALL
                SELECT a.id FROM asset a JOIN tree ON a.parent_asset_id = tree.id
            )
            SELECT id FROM tree
        """),
        {"ids": list(roots)},
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


def attach(session: Session, asset_ids: list[int], bundle_id: int) -> int:
    """Add a bundle membership to the given assets. Idempotent. Returns rows changed.

    Infospace-scoped at the primitive: an asset can only gain membership in a
    bundle of its own infospace, so cross-infospace seeding is unreachable by
    construction (ROOT carries no row, hence no scope — caller-validated ids)."""
    if not asset_ids:
        return 0
    result = session.execute(
        text(
            "UPDATE asset SET bundle_ids = array_append(bundle_ids, :bid) "
            "WHERE id = ANY(:ids) "
            "AND NOT (bundle_ids @> ARRAY[:bid]::int[]) "
            "AND (:bid = 0 OR infospace_id = (SELECT infospace_id FROM bundle WHERE id = :bid))"
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


def detach(session: Session, asset_ids: list[int], bundle_id: int) -> int:
    """Remove a bundle membership from the given assets. Normalizes an emptied set to {ROOT}. Returns rows changed."""
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


def _exclusive_asset_counts(session: Session, subtree: set[int]) -> tuple[int, int]:
    """
    Count (exclusive, shared) assets for the subtree WITHOUT materializing id sets.

    Preview-only sibling of ``_exclusive_assets``. ``&&`` (overlap) is GIN-indexed,
    so it restricts the scan to the subtree's members; the ``<@`` filter is then
    evaluated only on those candidate rows, not the whole asset table. This keeps
    preview fast even when a bundle holds hundreds of thousands of assets.
    """
    if not subtree:
        return (0, 0)
    subtree_list = list(subtree)

    total = session.execute(
        text("SELECT count(*) FROM asset WHERE bundle_ids && CAST(:bids AS int[])"),
        {"bids": subtree_list},
    ).scalar() or 0
    # Shared = overlaps the subtree but has at least one membership outside it.
    shared = session.execute(
        text(
            "SELECT count(*) FROM asset "
            "WHERE bundle_ids && CAST(:bids AS int[]) "
            "AND NOT (bundle_ids <@ CAST(:bids AS int[]))"
        ),
        {"bids": subtree_list},
    ).scalar() or 0
    exclusive = total - shared
    return (exclusive, shared)


def _direct_asset_counts(
    session: Session, asset_ids: list[int], out_of: int, subtree: set[int]
) -> tuple[int, int]:
    """
    Count (destroyed, survived) for explicit asset_ids removed from ``out_of``.

    Explicit ids are a bounded user selection, so fetching their rows is fine.
    Assets already covered by the bundle cascade (members of ``subtree``) are
    skipped to avoid double-counting.
    """
    if not asset_ids:
        return (0, 0)
    rows = session.execute(
        text("SELECT id, bundle_ids FROM asset WHERE id = ANY(:ids)"),
        {"ids": asset_ids},
    ).fetchall()
    destroyed = survived = 0
    for _aid, bids in rows:
        bset = set(bids or [])
        if subtree and (bset & subtree):
            continue  # already counted in the bundle cascade
        remaining = [b for b in bset if b != out_of]
        if not remaining:
            destroyed += 1
        else:
            survived += 1
    return (destroyed, survived)


def _pause_sources_for_deleted_bundles(session: Session, subtree: set[int]) -> int:
    """
    Pause every source whose output bundle is being deleted, flagging it WARNING.

    Polling is gated on ``Source.is_active`` (see source_monitoring.poll_sources),
    so clearing it stops the stream. The WARNING status + ``error_message`` give
    the user a visible, actionable signal to rewire the source to a new bundle.
    Returns the number of sources paused.
    """
    if not subtree:
        return 0
    rows = session.execute(
        text("SELECT id, name, output_bundle_id FROM source WHERE output_bundle_id = ANY(:bids)"),
        {"bids": list(subtree)},
    ).fetchall()
    if not rows:
        return 0

    bundle_names = dict(
        session.execute(
            text("SELECT id, name FROM bundle WHERE id = ANY(:bids)"),
            {"bids": list(subtree)},
        ).fetchall()
    )
    for sid, _sname, output_bundle_id in rows:
        target = bundle_names.get(output_bundle_id, f"#{output_bundle_id}")
        note = f"Output bundle '{target}' was deleted; polling paused. Re-point this source to a new bundle to resume."
        session.execute(
            text(
                "UPDATE source SET is_active = false, status = 'WARNING', "
                "error_message = :note, next_poll_at = NULL, updated_at = now() "
                "WHERE id = :sid"
            ),
            {"note": note[:500], "sid": sid},
        )
    return len(rows)


def purge(session: Session, asset_ids) -> int:
    """Hard-destroy assets and their entire container subtree. The ONE destroyer.

    Removes the assets, every descendant part (``parent_asset_id`` subtree), and
    everything hanging off them — chunks, annotations, and the graph edges /
    fragment-curations those annotations carry — plus nulls any version-chain refs
    pointing into the set. Membership-blind: this is the structural teardown the
    higher verbs (``delete``) call once they've decided an asset is doomed.

    Scale-safe: walks via ``asset_descendants`` (recursive CTE) and only ever binds
    ``= ANY(:array)`` — never an IN-list, which on a large bundled CSV exceeded
    Postgres's 65k-parameter ceiling. Flush-only; caller commits.
    """
    roots = {aid for aid in (asset_ids or []) if aid is not None}
    if not roots:
        return 0

    all_ids = list(asset_descendants(session, roots))  # roots + every descendant part

    # Null version-chain refs pointing into the delete set.
    session.execute(
        text("UPDATE asset SET previous_asset_id = NULL WHERE previous_asset_id = ANY(:ids)"),
        {"ids": all_ids},
    )

    # Graph data hangs off annotations — clear it before the annotations go.
    annotation_ids = [
        r[0] for r in session.execute(
            text("SELECT id FROM annotation WHERE asset_id = ANY(:ids)"),
            {"ids": all_ids},
        ).fetchall()
    ]
    if annotation_ids:
        session.execute(
            text("DELETE FROM fragmentcuration WHERE annotation_id = ANY(:aids)"),
            {"aids": annotation_ids},
        )
        session.execute(
            text("DELETE FROM graphedge WHERE annotation_id = ANY(:aids)"),
            {"aids": annotation_ids},
        )

    session.execute(text("DELETE FROM annotation WHERE asset_id = ANY(:ids)"), {"ids": all_ids})
    session.execute(text("DELETE FROM assetchunk WHERE asset_id = ANY(:ids)"), {"ids": all_ids})

    # parent_asset_id is ON DELETE NO ACTION; deleting the whole subtree in one
    # statement satisfies the self-FK (every referencing row vanishes in the same
    # statement, so the end-of-statement check passes).
    result = session.execute(text("DELETE FROM asset WHERE id = ANY(:ids)"), {"ids": all_ids})
    return result.rowcount


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
