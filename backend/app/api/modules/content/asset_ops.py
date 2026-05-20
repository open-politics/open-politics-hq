"""
Asset operations — module-level utilities for asset lifecycle actions.

These are the parts of the former AssetService that survive: non-trivial multi-row
operations that don't fit on AssetBuilder. Each function takes an explicit session
and follows the flush-never-commit invariant — the caller owns the transaction
boundary (route, @task body, poll handler).

Functions:
  • cascade_delete(session, asset_ids) — delete assets and all descendants,
    clearing chunks, annotations, justifications, graph edges, previous-version
    refs. Flushes only; caller commits.

  • transfer_assets(session, ...) — copy or move assets between infospaces.
    Uses AssetBuilder for copy-mode to get dedup + identity handling.

  • reconcile_children(session, parent_id, expected) — match expected children
    against existing children by source_identifier within a parent scope;
    insert new, supersede changed, delete orphaned. Used by reprocess flows
    that want to preserve annotations attached to existing children.
"""

from __future__ import annotations

import logging
from typing import Iterable, List, Literal, Optional

from sqlalchemy import delete, update
from sqlmodel import Session, select

from app.api.modules.content.services.asset_builder import AssetBuilder
from app.api.modules.graph.models import FragmentCuration, GraphEdge
from app.models import Annotation, Asset, AssetChunk

logger = logging.getLogger(__name__)


# ─── cascade_delete ──────────────────────────────────────────────────────────

def cascade_delete(session: Session, asset_ids: Iterable[int]) -> int:
    """Delete assets and every descendant. Clears chunks, annotations, graph FKs.

    Respects the tree invariant: deleting a parent deletes all its children
    transitively. Annotations and their justifications are removed; graph
    curations and edges referencing those annotations are cleared.
    `previous_asset_id` references pointing into the delete set are nulled
    so we don't leave dangling FKs on sibling versions.

    Flush-only. Caller commits.
    """
    root_ids = {aid for aid in asset_ids if aid is not None}
    if not root_ids:
        return 0

    # Walk descendants level by level
    def _collect_descendants(seed: set[int]) -> set[int]:
        all_children: set[int] = set()
        current = seed
        while current:
            children = session.exec(
                select(Asset.id).where(Asset.parent_asset_id.in_(current))
            ).all()
            if not children:
                break
            child_ids = set(children)
            all_children.update(child_ids)
            current = child_ids
        return all_children

    descendants = _collect_descendants(root_ids)
    if descendants:
        logger.info("cascade_delete: %d descendants found", len(descendants))
        root_ids |= descendants

    # Null out previous_asset_id where it points into the delete set
    session.exec(
        update(Asset)
        .where(Asset.previous_asset_id.in_(root_ids))
        .values(previous_asset_id=None)
    )

    # Chunks
    session.exec(delete(AssetChunk).where(AssetChunk.asset_id.in_(root_ids)))

    # Clear annotation-referencing graph rows before deleting annotations.
    # Justifications travel inline in annotation.value JSONB and disappear with
    # the annotation row itself — no separate cascade needed.
    annotation_ids = set(session.exec(
        select(Annotation.id).where(Annotation.asset_id.in_(root_ids))
    ).all())
    if annotation_ids:
        session.exec(
            delete(FragmentCuration).where(FragmentCuration.annotation_id.in_(annotation_ids))
        )
        session.exec(
            delete(GraphEdge).where(GraphEdge.annotation_id.in_(annotation_ids))
        )

    session.exec(delete(Annotation).where(Annotation.asset_id.in_(root_ids)))

    result = session.exec(delete(Asset).where(Asset.id.in_(root_ids)))
    deleted = getattr(result, "rowcount", None) or len(root_ids)
    session.flush()
    logger.info("cascade_delete: removed %d assets", deleted)
    return deleted


# ─── transfer_assets ─────────────────────────────────────────────────────────

async def transfer_assets(
    session: Session,
    asset_ids: List[int],
    source_infospace_id: int,
    target_infospace_id: int,
    user_id: int,
    *,
    copy: bool = True,
) -> List[Asset]:
    """Move or copy assets between infospaces.

    ``copy=True`` (default) routes each source asset through AssetBuilder in the
    target infospace — duplicates (same content_hash) are skipped by dedup, so
    repeat transfers are idempotent. ``copy=False`` mutates existing rows in
    place (changes ``infospace_id`` and ``user_id``).

    Flush-only. Caller owns the transaction boundary (route, @task body).
    """
    if not asset_ids:
        return []

    sources = session.exec(
        select(Asset)
        .where(Asset.id.in_(asset_ids))
        .where(Asset.infospace_id == source_infospace_id)
    ).all()

    if not sources:
        return []

    transferred: List[Asset] = []
    if copy:
        for src in sources:
            builder = (
                AssetBuilder(session, user_id, target_infospace_id)
                .as_kind(src.kind)
                .with_title(src.title)
            )
            if src.text_content is not None:
                builder.with_text(src.text_content)
            if src.blob_path:
                builder.with_blob(src.blob_path)
            if src.source_identifier:
                builder.with_source(src.source_identifier)
            if src.content_hash:
                builder.with_content_hash(src.content_hash)
            if src.event_timestamp:
                builder.with_timestamp(src.event_timestamp)
            if src.facets:
                builder.with_facets(**src.facets)
            if src.file_info:
                builder.with_metadata(**src.file_info)
            if src.stub:
                builder.as_stub(True)
            if src.processing_status is not None:
                builder.with_processing_status(src.processing_status)
            if src.content_hash:
                builder.dedup_on(content_hash=src.content_hash).on_match("skip")
            else:
                builder.no_dedup()

            new_asset = await builder.build()
            transferred.append(new_asset)
    else:
        for src in sources:
            src.infospace_id = target_infospace_id
            src.user_id = user_id
            session.add(src)
            transferred.append(src)
        session.flush()

    logger.info(
        "transfer_assets_async: %d asset(s) %s → infospace %s",
        len(transferred), "copied" if copy else "moved", target_infospace_id,
    )
    return transferred


# ─── reconcile_children ──────────────────────────────────────────────────────

ReconcileAction = Literal["delete", "mark_orphaned"]


async def reconcile_children(
    session: Session,
    parent_id: int,
    expected: List[Asset],
    *,
    user_id: int,
    infospace_id: int,
    match_key: Literal["source_identifier", "part_index", "title"] = "source_identifier",
    orphan_action: ReconcileAction = "mark_orphaned",
) -> dict:
    """Reconcile children of ``parent_id`` against an expected blueprint list.

    Children are matched by ``match_key`` within the parent scope (non-superseded
    only). For each expected blueprint:
      • No existing match → insert as a new child.
      • Match with identical content_hash → keep.
      • Match with different content_hash → supersede (old gets is_superseded,
        new gets previous_asset_id).
    Existing children absent from expected are handled per ``orphan_action``:
      • ``mark_orphaned`` — stamp file_info['orphaned']=True (default; preserves
        annotations, row visible but tagged).
      • ``delete`` — cascade_delete through ``asset_ops.cascade_delete``.

    Used by reprocess flows that want to preserve annotations attached to
    existing children. Flush-only; caller commits.

    Returns a stats dict: ``{"inserted": int, "kept": int, "superseded": int,
    "orphaned": int}``.
    """
    if not expected:
        expected = []

    # Load existing non-superseded children
    existing_children = session.exec(
        select(Asset)
        .where(Asset.parent_asset_id == parent_id)
        .where(Asset.is_superseded == False)  # noqa: E712
    ).all()

    def _key(a: Asset):
        if match_key == "part_index":
            return a.part_index
        if match_key == "title":
            return a.title
        return a.source_identifier

    existing_by_key = {}
    for a in existing_children:
        k = _key(a)
        if k is None:
            continue
        existing_by_key[k] = a

    stats = {"inserted": 0, "kept": 0, "superseded": 0, "orphaned": 0}
    to_insert: List[Asset] = []

    for blueprint in expected:
        key = _key(blueprint)
        if key is None:
            # Anonymous blueprint — can't reconcile, just insert
            to_insert.append(blueprint)
            continue

        match = existing_by_key.pop(key, None)
        if match is None:
            to_insert.append(blueprint)
            continue

        if (
            match.content_hash
            and blueprint.content_hash
            and match.content_hash == blueprint.content_hash
        ):
            stats["kept"] += 1
            continue

        # Supersede via AssetBuilder (single cascade write-site)
        await (
            AssetBuilder(session, user_id, infospace_id)
            .supersedes(match)
            .load(blueprint)
        )
        stats["superseded"] += 1

    # Bulk insert new children (auto part_index only if not set)
    if to_insert:
        builder = AssetBuilder(session, user_id, infospace_id)
        await builder.build_children(parent_id, to_insert)
        stats["inserted"] += len(to_insert)

    # Handle orphans (existing that were not in expected)
    if existing_by_key:
        orphans = list(existing_by_key.values())
        if orphan_action == "mark_orphaned":
            for o in orphans:
                info = dict(o.file_info or {})
                info["orphaned"] = True
                o.file_info = info
                session.add(o)
            session.flush()
        elif orphan_action == "delete":
            cascade_delete(session, {o.id for o in orphans})
        stats["orphaned"] = len(orphans)

    return stats
