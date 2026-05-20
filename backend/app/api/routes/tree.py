"""Tree routes — unified ``AssetTree`` + ``AssetFeed`` shapes.

Three families:

* ``GET  /tree``          — root tree. Nav (flat bundle registry) + level assets.
* ``GET  /tree/children`` — lazy-load children of a bundle / vfolder / container asset.
* ``GET  /tree/feed``     — recent assets (flat feed).
* ``POST /tree/assets/batch`` — id-indexed detail fetch (stays, pure projection).
* ``POST /tree/delete(-preview)`` — cascaded deletion.

Each surface answers JSON by default and SSE when the client advertises
``Accept: text/event-stream``. Shapes come from ``modules/content/schemas``;
event generation comes from ``modules/content/views``. The route is thin.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlalchemy import func, text
from sqlmodel import Session, select

from app.api import dependency_injection
from app.api.modules.content.models import Asset, AssetKind, Bundle
from app.api.modules.content.query import AssetQuery
from app.api.modules.content.schemas import (
    AssetFeed,
    AssetFeedMeta,
    AssetNode,
    AssetTree,
    AssetTreeMeta,
    AssetTreeNav,
    ListingSection,
)
from app.api.modules.content.views import (
    _asset_node,
    _build_nav,
    _vfolder_node,
    collect_feed,
    collect_tree,
    render_feed,
    render_tree,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, DeleteAccess, Requires, ViewAccess,
)
from app.api.tree_renderer import parse_tree_node_id, parse_vfolder_node_id
from app.core.tree import ROOT, delete as tree_delete
from app.schemas import AssetRead, Message

logger = logging.getLogger(__name__)

router = APIRouter()


def _root_query(db: Session, infospace_id: int, scope, *, limit: int, cursor: Optional[str]) -> AssetQuery:
    return (
        AssetQuery(db, infospace_id)
        .scope(scope)
        .top_level_only()
        .no_bundles()
        .exclude_superseded()
        .sort("created_at_desc")
        .paginate(cursor=cursor, limit=limit, max_limit=500)
    )


# ─── GET /tree — root-level listing (JSON + SSE siblings) ──────────────────


@router.get("/infospaces/{infospace_id}/tree", response_model=AssetTree)
async def get_infospace_tree(
    *,
    infospace_id: int,
    limit: int = Query(100, ge=1, le=500),
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Root-level tree: flat bundle nav + top-level assets (JSON envelope).

    For a progressive SSE stream, call ``GET /tree/stream`` with the same
    query params. The client indexes ``nav.bundles`` by id in O(1) and
    rebuilds hierarchy from ``parent_id`` in one O(n) pass.
    """
    scope = access.scope
    query = _root_query(db, infospace_id, scope, limit=limit, cursor=cursor)
    return await collect_tree(query, access_scope=scope)


@router.get("/infospaces/{infospace_id}/tree/stream", response_class=EventSourceResponse)
async def get_infospace_tree_stream(
    *,
    infospace_id: int,
    limit: int = Query(100, ge=1, le=500),
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Native SSE stream of the root tree."""
    scope = access.scope
    query = _root_query(db, infospace_id, scope, limit=limit, cursor=cursor)
    async for ev in render_tree(query, access_scope=scope):
        yield ServerSentEvent(data=ev, event=ev.name)


# ─── GET /tree/children — lazy children (JSON + SSE siblings) ──────────────


def _children_query(
    db: Session, infospace_id: int, parent_id: str, skip: int, limit: int, access: Access,
) -> tuple[str, AssetQuery | None, Bundle | None, str | None]:
    """Resolve parent_id to (parent_type, query, bundle, path_prefix).

    Validates the parent node exists and is in scope. Raises HTTPException
    on invalid input. ``query`` is ``None`` for vfolder parents (those use
    the bundle + path_prefix to assemble children manually).
    """
    scope = access.scope
    try:
        parent_type, parent_numeric_id = parse_tree_node_id(parent_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))

    if parent_type == "bundle":
        bundle = db.get(Bundle, parent_numeric_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found")
        if scope and scope.bundle_ids and bundle.id not in scope.bundle_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        query = (
            AssetQuery(db, infospace_id)
            .scope(scope)
            .bundle(parent_numeric_id)
            .top_level_only()
            .exclude_superseded()
            .sort("created_at_desc")
            .paginate(limit=limit, max_limit=500)
        )
        query._offset = skip
        return ("bundle", query, bundle, None)

    if parent_type == "asset":
        asset = db.get(Asset, parent_numeric_id)
        if not asset or asset.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")
        access.require_in_scope("asset_ids", parent_numeric_id)
        query = (
            AssetQuery(db, infospace_id)
            .scope(scope)
            .parent_asset(parent_numeric_id)
            .sort("part_index")
            .paginate(limit=limit, max_limit=500)
        )
        query._offset = skip
        return ("asset", query, None, None)

    if parent_type == "vfolder":
        try:
            bundle_id, path_prefix = parse_vfolder_node_id(parent_id)
        except ValueError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found")
        if scope and scope.bundle_ids and bundle.id not in scope.bundle_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        return ("vfolder", None, bundle, path_prefix)

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid parent type: {parent_type}")


@router.get("/infospaces/{infospace_id}/tree/children", response_model=AssetTree)
async def get_tree_children(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node id (bundle-*, asset-*, vfolder-*)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Lazy children for a tree node (JSON envelope).

    Dispatches by parent type:
      * ``bundle-N`` — assets whose ``bundle_ids @> [N]`` (and ``parent_asset_id IS NULL``)
      * ``asset-N``  — container children (``parent_asset_id = N``)
      * ``vfolder-N__path`` — mix of sub-folder nodes + files at that path

    For a progressive SSE stream, call ``GET /tree/children/stream``.
    """
    scope = access.scope
    parent_type, query, bundle, path_prefix = _children_query(db, infospace_id, parent_id, skip, limit, access)

    if parent_type in ("bundle", "asset"):
        assert query is not None
        return await collect_tree(query, level_parent=parent_id, access_scope=scope)

    # vfolder: manually assemble envelope (mixed folder + asset nodes)
    assert bundle is not None and path_prefix is not None
    nav = _build_nav(db, infospace_id, scope)
    nodes, total = _vfolder_children_nodes(db, bundle, path_prefix, skip, limit)
    section = ListingSection[AssetNode](
        at_parent=parent_id,
        items=nodes,
        total=total,
        has_more=(skip + len(nodes)) < total,
    )
    return AssetTree(nav=nav, section=section, meta=AssetTreeMeta(bundles=0, assets=0, vfolders=total))


@router.get("/infospaces/{infospace_id}/tree/children/stream", response_class=EventSourceResponse)
async def get_tree_children_stream(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node id (bundle-*, asset-*, vfolder-*)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Native SSE stream of tree children."""
    scope = access.scope
    parent_type, query, bundle, path_prefix = _children_query(db, infospace_id, parent_id, skip, limit, access)

    if parent_type in ("bundle", "asset"):
        assert query is not None
        async for ev in render_tree(query, level_parent=parent_id, access_scope=scope):
            yield ServerSentEvent(data=ev, event=ev.name)
        return

    # vfolder: assemble envelope then emit synthetic events in the wire protocol
    from app.api.modules.content.schemas import (
        CountEvent, DoneEvent, NavEvent, SectionEvent, SkeletonEvent,
    )
    assert bundle is not None and path_prefix is not None
    nav = _build_nav(db, infospace_id, scope)
    nodes, total = _vfolder_children_nodes(db, bundle, path_prefix, skip, limit)
    section = ListingSection[AssetNode](
        at_parent=parent_id,
        items=nodes,
        total=-1,
        has_more=(skip + len(nodes)) < total,
    )
    yield ServerSentEvent(data=SkeletonEvent(family="tree"), event="skeleton")
    yield ServerSentEvent(data=NavEvent(nav=nav), event="nav")
    yield ServerSentEvent(data=SectionEvent(role="level", section=section), event="section")
    yield ServerSentEvent(data=CountEvent(total=total, at_parent=parent_id), event="count")
    yield ServerSentEvent(data=DoneEvent(), event="done")


def _vfolder_children_nodes(
    db: Session, bundle: Bundle, path_prefix: str, skip: int, limit: int,
) -> tuple[List[AssetNode], int]:
    """Build mixed AssetNode list for a vfolder level: sub-folders + files.

    Folders come from distinct path segments; files are assets at this level
    whose suffix contains no slash.
    """
    base_prefix = f"{path_prefix}/" if path_prefix else ""
    like_prefix = f"{base_prefix}%"
    prefix_len = len(base_prefix)
    params = {
        "prefix_len": prefix_len,
        "bundle_id": bundle.id,
        "like_prefix": like_prefix,
        "slash_pattern": "%/%",
    }

    folder_rows = db.execute(text("""
        SELECT DISTINCT split_part(
            substring(logical_path from :prefix_len + 1), '/', 1
        ) AS segment
        FROM asset
        WHERE bundle_ids @> ARRAY[:bundle_id]::int[]
          AND logical_path IS NOT NULL
          AND logical_path LIKE :like_prefix
          AND parent_asset_id IS NULL
          AND substring(logical_path from :prefix_len + 1) LIKE :slash_pattern
        ORDER BY segment
    """), params).fetchall()
    folder_names = [r[0] for r in folder_rows if r[0]]

    file_count = db.execute(text("""
        SELECT count(*) FROM asset
        WHERE bundle_ids @> ARRAY[:bundle_id]::int[]
          AND logical_path IS NOT NULL
          AND logical_path LIKE :like_prefix
          AND parent_asset_id IS NULL
          AND substring(logical_path from :prefix_len + 1) != ''
          AND substring(logical_path from :prefix_len + 1) NOT LIKE :slash_pattern
    """), params).scalar() or 0

    total_children = len(folder_names) + file_count

    if skip < len(folder_names):
        folder_page = folder_names[skip : skip + limit]
        file_skip = 0
        remaining = limit - len(folder_page)
    else:
        folder_page = []
        file_skip = skip - len(folder_names)
        remaining = limit

    files: List[Asset] = []
    if remaining > 0:
        file_ids = [
            r[0] for r in db.execute(text("""
                SELECT id FROM asset
                WHERE bundle_ids @> ARRAY[:bundle_id]::int[]
                  AND logical_path IS NOT NULL
                  AND logical_path LIKE :like_prefix
                  AND parent_asset_id IS NULL
                  AND substring(logical_path from :prefix_len + 1) != ''
                  AND substring(logical_path from :prefix_len + 1) NOT LIKE :slash_pattern
                ORDER BY logical_path
                OFFSET :file_skip LIMIT :remaining
            """), {**params, "file_skip": file_skip, "remaining": remaining}).fetchall()
        ]
        if file_ids:
            files = list(db.exec(
                select(Asset).where(Asset.id.in_(file_ids)).order_by(Asset.logical_path)
            ).all())

    nodes: List[AssetNode] = []
    for name in folder_page:
        sub_prefix = f"{base_prefix}{name}"
        nodes.append(_vfolder_node(bundle.id, sub_prefix, name))
    for asset in files:
        nodes.append(_asset_node(asset))
    return nodes, total_children


# ─── GET /tree/feed — recent assets ────────────────────────────────────────


def _feed_query(
    db: Session,
    infospace_id: int,
    access: Access,
    *,
    skip: int,
    limit: int,
    kinds: Optional[List[str]],
    sort_by: str,
    sort_order: str,
    bundle_id: Optional[int],
    path_filter: Optional[str],
    cursor: Optional[str],
) -> AssetQuery:
    scope = access.scope

    parsed_kinds: List[AssetKind] = []
    if kinds:
        for k in kinds:
            try:
                parsed_kinds.append(AssetKind(k))
            except ValueError:
                continue

    query = (
        AssetQuery(db, infospace_id)
        .scope(scope)
        .top_level_only()
        .exclude_superseded()
    )
    if parsed_kinds:
        query.kinds(parsed_kinds)
    if bundle_id is not None:
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found")
        if scope and scope.bundle_ids and bundle_id not in scope.bundle_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        query.bundle(bundle_id)
    if path_filter:
        query._conditions.append(
            (Asset.logical_path.is_not(None)) & (Asset.logical_path.like(f"{path_filter}%"))
        )

    direction = "desc" if sort_order == "desc" else "asc"
    if sort_by == "created_at":
        query.sort("created_at_asc" if direction == "asc" else "created_at_desc")
    elif sort_by == "name":
        query.sort("title")
    else:
        query.sort("created_at_asc" if direction == "asc" else "created_at_desc")

    query.paginate(cursor=cursor, limit=limit, max_limit=100)
    query._offset = skip
    return query


@router.get("/infospaces/{infospace_id}/tree/feed", response_model=AssetFeed)
async def get_feed_assets(
    *,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    kinds: List[str] = Query(None, description="Filter by asset kinds"),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc"),
    bundle_id: Optional[int] = Query(None),
    path_filter: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Flat feed of recent assets (JSON envelope)."""
    query = _feed_query(
        db, infospace_id, access,
        skip=skip, limit=limit, kinds=kinds, sort_by=sort_by,
        sort_order=sort_order, bundle_id=bundle_id, path_filter=path_filter,
        cursor=cursor,
    )
    return await collect_feed(query)


@router.get("/infospaces/{infospace_id}/tree/feed/stream", response_class=EventSourceResponse)
async def get_feed_assets_stream(
    *,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    kinds: List[str] = Query(None, description="Filter by asset kinds"),
    sort_by: str = Query("updated_at"),
    sort_order: str = Query("desc"),
    bundle_id: Optional[int] = Query(None),
    path_filter: Optional[str] = Query(None),
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Native SSE stream of the recent-assets feed."""
    query = _feed_query(
        db, infospace_id, access,
        skip=skip, limit=limit, kinds=kinds, sort_by=sort_by,
        sort_order=sort_order, bundle_id=bundle_id, path_filter=path_filter,
        cursor=cursor,
    )
    async for ev in render_feed(query):
        yield ServerSentEvent(data=ev, event=ev.name)


# ─── POST /tree/assets/batch — id-indexed detail fetch ────────────────────


class BatchGetAssetsRequest(BaseModel):
    asset_ids: List[int] = Field(..., description="List of asset IDs to fetch", max_length=100)


@router.post("/infospaces/{infospace_id}/tree/assets/batch", response_model=List[AssetRead])
def batch_get_assets(
    *,
    infospace_id: int,
    request: BatchGetAssetsRequest,
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
) -> Any:
    """Fetch multiple assets by ids. Scope-aware; order preserved."""

    if not request.asset_ids:
        return []

    assets = (
        AssetQuery(db, infospace_id)
        .scope(access.scope)
        .ids(request.asset_ids)
        .execute()
    )
    asset_map = {a.id: a for a in assets}
    return [AssetRead.model_validate(asset_map[aid]) for aid in request.asset_ids if aid in asset_map]


# ─── POST /tree/delete(-preview) — cascaded deletion ──────────────────────


class TreeDeleteRequest(BaseModel):
    node_ids: List[str]


def _parse_delete_request(db: Session, infospace_id: int, node_ids: List[str]) -> tuple[list[int], list[int]]:
    bundle_ids: list[int] = []
    asset_ids: list[int] = []
    for node_id in node_ids:
        try:
            node_type, node_numeric_id = parse_tree_node_id(node_id)
            if node_type == "bundle":
                bundle = db.get(Bundle, node_numeric_id)
                if bundle and bundle.infospace_id == infospace_id:
                    bundle_ids.append(bundle.id)
            elif node_type == "asset":
                asset = db.get(Asset, node_numeric_id)
                if asset and asset.infospace_id == infospace_id:
                    asset_ids.append(node_numeric_id)
        except Exception:
            continue
    return bundle_ids, asset_ids


@router.post("/infospaces/{infospace_id}/tree/delete-preview")
def preview_tree_deletion(
    *,
    infospace_id: int,
    request: TreeDeleteRequest,
    access: Access = Requires(Capability.DELETE, scope=None),
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
) -> Any:
    """Preview deletion impact without mutating."""

    if not request.node_ids:
        return tree_delete(db, out_of=ROOT, confirm=False)

    bundle_ids, asset_ids = _parse_delete_request(db, infospace_id, request.node_ids)
    return tree_delete(db, asset_ids=asset_ids, bundle_ids=bundle_ids, out_of=ROOT, confirm=False)


@router.post("/infospaces/{infospace_id}/tree/delete", response_model=Message)
def delete_tree_nodes(
    *,
    infospace_id: int,
    request: TreeDeleteRequest,
    access: Access = DeleteAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
) -> Any:
    """Delete bundles and/or assets (cascaded)."""

    if not request.node_ids:
        return Message(message="No items to delete")

    bundle_ids, asset_ids = _parse_delete_request(db, infospace_id, request.node_ids)
    failed_count = len(request.node_ids) - len(bundle_ids) - len(asset_ids)
    result = tree_delete(db, asset_ids=asset_ids, bundle_ids=bundle_ids, out_of=ROOT, confirm=True)
    db.commit()

    message = result.message
    if failed_count > 0:
        message += f" ({failed_count} failed)"
    return Message(message=message)
