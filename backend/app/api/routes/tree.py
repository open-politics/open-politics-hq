"""Tree routes — unified ``AssetTree`` + ``AssetFeed`` shapes.

Three families:

* ``GET  /tree``          — root tree. Nav (flat bundle registry) + level assets.
* ``GET  /tree/children`` — lazy-load children of a bundle or container asset.
* ``GET  /tree/feed``     — recent assets (flat feed).
* ``POST /tree/assets/batch`` — id-indexed detail fetch (stays, pure projection).
* ``POST /tree/delete(-preview)`` — cascaded deletion.

Each surface answers JSON by default and SSE when the client advertises
``Accept: text/event-stream``. Shapes come from ``modules/content/schemas``;
event generation comes from ``modules/content/views``. The route is thin.
"""

from __future__ import annotations

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException, Query, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
from sqlmodel import Session

from app.api import dependency_injection
from app.api.modules.content.models import Asset, AssetKind, Bundle
from app.api.modules.content.query import AssetQuery
from app.api.modules.content.schemas import AssetFeed, AssetTree
from app.api.modules.content.views import (
    collect_feed,
    collect_tree,
    render_feed,
    render_tree,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, DeleteAccess, Requires, ViewAccess,
)
from app.api.tree_renderer import parse_tree_node_id
from app.api.modules.content.tree import ROOT, delete as tree_delete
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
) -> AssetQuery:
    """Resolve a parent node id to the AssetQuery for its children.

    ``bundle-N`` → member root-assets (child *bundles* come via ``nav``);
    ``asset-N`` → container parts (``parent_asset_id = N``). Validates existence
    + scope; raises HTTPException on invalid input. Folders are real bundles now,
    so there is no ``vfolder`` node type.
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
        return query

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
        return query

    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid parent type: {parent_type}")


@router.get("/infospaces/{infospace_id}/tree/children", response_model=AssetTree)
async def get_tree_children(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node id (bundle-*, asset-*)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Lazy children for a tree node (JSON envelope).

    Dispatches by parent type:
      * ``bundle-N`` — member root-assets (``bundle_ids @> [N]`` and ``parent_asset_id IS NULL``);
        child *bundles* (sub-folders) arrive via ``nav``.
      * ``asset-N``  — container parts (``parent_asset_id = N``).

    For a progressive SSE stream, call ``GET /tree/children/stream``.
    """
    scope = access.scope
    query = _children_query(db, infospace_id, parent_id, skip, limit, access)
    return await collect_tree(query, level_parent=parent_id, access_scope=scope)


@router.get("/infospaces/{infospace_id}/tree/children/stream", response_class=EventSourceResponse)
async def get_tree_children_stream(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node id (bundle-*, asset-*)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Native SSE stream of tree children."""
    scope = access.scope
    query = _children_query(db, infospace_id, parent_id, skip, limit, access)
    async for ev in render_tree(query, level_parent=parent_id, access_scope=scope):
        yield ServerSentEvent(data=ev, event=ev.name)


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
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Flat feed of recent assets (JSON envelope)."""
    query = _feed_query(
        db, infospace_id, access,
        skip=skip, limit=limit, kinds=kinds, sort_by=sort_by,
        sort_order=sort_order, bundle_id=bundle_id,
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
    cursor: Optional[str] = Query(None),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """Native SSE stream of the recent-assets feed."""
    query = _feed_query(
        db, infospace_id, access,
        skip=skip, limit=limit, kinds=kinds, sort_by=sort_by,
        sort_order=sort_order, bundle_id=bundle_id,
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
    # The collection (bundle) the user is deleting FROM. Assets lose membership in
    # this location: last membership → destroyed, otherwise unlinked (kept elsewhere).
    # ROOT (default) = the top level. Bundle deletes cascade regardless of out_of.
    out_of: int = ROOT


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
        return tree_delete(db, out_of=request.out_of, confirm=False)

    bundle_ids, asset_ids = _parse_delete_request(db, infospace_id, request.node_ids)
    return tree_delete(db, asset_ids=asset_ids, bundle_ids=bundle_ids, out_of=request.out_of, confirm=False)


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
    result = tree_delete(db, asset_ids=asset_ids, bundle_ids=bundle_ids, out_of=request.out_of, confirm=True)
    db.commit()

    message = result.message
    if failed_count > 0:
        message += f" ({failed_count} failed)"
    return Message(message=message)
