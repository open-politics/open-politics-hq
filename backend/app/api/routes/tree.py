"""
Tree API Routes
===============

Endpoints for efficient tree-based navigation of bundles and assets.
Returns minimal metadata for fast initial rendering and lazy-loads children on demand.
"""

import asyncio
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlmodel import Session, select
from sqlalchemy import func, text
from pydantic import BaseModel, Field

from app.api import dependency_injection
from app.models import Asset, Bundle, AssetKind
from app.schemas import TreeResponse, TreeNode, TreeChildrenResponse, Message, AssetRead, SSEError
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, ViewAccess, DeleteAccess,
)
from app.api.tree_renderer import (
    build_root_tree_nodes,
    build_bundle_children_nodes,
    build_bundle_nodes,
    build_asset_children_nodes,
    build_tree_node_from_asset,
    build_tree_node_from_vfolder,
    parse_tree_node_id,
    parse_vfolder_node_id,
)
from app.core.tree import ROOT, delete as tree_delete

logger = logging.getLogger(__name__)

router = APIRouter()


def _get_virtual_folder_children(
    db: Session,
    bundle: Bundle,
    infospace_id: int,
    path_prefix: str,
    skip: int,
    limit: int,
) -> tuple[List[Any], int]:
    """
    Get virtual folder children (subfolders + files) from logical_path.
    Uses pure SQL for folder names (no full asset load) and bounded file query.
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
    # Pure SQL: distinct folder names (first path segment after prefix)
    folder_stmt = text("""
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
    """)
    folder_rows = db.execute(folder_stmt, params).fetchall()
    all_folders = [r[0] for r in folder_rows if r[0]]

    # Files at this level (suffix has no slash)
    files_count_stmt = text("""
        SELECT count(*) FROM asset
        WHERE bundle_ids @> ARRAY[:bundle_id]::int[]
          AND logical_path IS NOT NULL
          AND logical_path LIKE :like_prefix
          AND parent_asset_id IS NULL
          AND substring(logical_path from :prefix_len + 1) != ''
          AND substring(logical_path from :prefix_len + 1) NOT LIKE :slash_pattern
    """)
    total_files = db.execute(files_count_stmt, params).scalar() or 0

    total_children = len(all_folders) + total_files

    if skip < len(all_folders):
        folders_page = all_folders[skip : skip + limit]
        remaining = limit - len(folders_page)
        file_skip = 0
    else:
        folders_page = []
        file_skip = skip - len(all_folders)
        remaining = limit

    files_page: List[Asset] = []
    if remaining > 0:
        files_params = {**params, "file_skip": file_skip, "remaining": remaining}
        files_stmt = text("""
            SELECT id FROM asset
            WHERE bundle_ids @> ARRAY[:bundle_id]::int[]
              AND logical_path IS NOT NULL
              AND logical_path LIKE :like_prefix
              AND parent_asset_id IS NULL
              AND substring(logical_path from :prefix_len + 1) != ''
              AND substring(logical_path from :prefix_len + 1) NOT LIKE :slash_pattern
            ORDER BY logical_path
            OFFSET :file_skip LIMIT :remaining
        """)
        file_ids = [r[0] for r in db.execute(files_stmt, files_params).fetchall()]
        if file_ids:
            files_page = list(
                db.exec(
                    select(Asset).where(Asset.id.in_(file_ids)).order_by(Asset.logical_path)
                ).all()
            )

    nodes = []
    for folder_name in folders_page:
        nodes.append(build_tree_node_from_vfolder(bundle.id, path_prefix, folder_name))
    for asset in files_page:
        nodes.append(build_tree_node_from_asset(asset, parent_type="bundle", parent_id=bundle.id))
    return nodes, total_children


# ─── SSE phase models for tree ───

class TreePhase(BaseModel):
    nodes: list[TreeNode]
    total_bundles: int  # -1 sentinel
    total_assets: int   # -1 sentinel
    total_nodes: int

class TreeCountsPhase(BaseModel):
    total_bundles: int
    total_assets: int

def _build_tree_nodes(db, infospace_id, scope):
    """Build tree nodes + bundle count. Returns (nodes, n_bundles)."""
    if not scope:
        root_bundles = db.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
            .where(Bundle.parent_bundle_id == ROOT)
            .order_by(Bundle.name)
        ).all()
        root_assets = db.exec(
            select(Asset)
            .where(Asset.infospace_id == infospace_id)
            .where(Asset.parent_asset_id.is_(None))
            .where(text("bundle_ids = ARRAY[0]::int[]"))
            .order_by(Asset.updated_at.desc())
        ).all()
        nodes = build_root_tree_nodes(root_bundles, root_assets, db)
        return nodes, None  # None = count not yet computed
    else:
        explicit_root_bundles = []
        if scope.bundle_ids:
            explicit_root_bundles = db.exec(
                select(Bundle)
                .where(Bundle.id.in_(scope.bundle_ids))
                .where((Bundle.parent_bundle_id == ROOT) | Bundle.parent_bundle_id.not_in(scope.bundle_ids))
                .order_by(Bundle.name)
            ).all()

        derived_bundle_ids: set[int] = set()
        if scope.run_ids or scope.asset_ids:
            visible_bids_rows = db.execute(text("""
                SELECT DISTINCT unnest(bundle_ids) AS bid FROM asset
                WHERE infospace_id = :iid AND (
                    id = ANY(:aids)
                    OR id IN (
                        SELECT DISTINCT asset_id FROM annotation
                        WHERE run_id = ANY(:rids) AND asset_id IS NOT NULL
                    )
                )
            """), {
                "iid": infospace_id,
                "aids": list(scope.asset_ids) if scope.asset_ids else [],
                "rids": list(scope.run_ids) if scope.run_ids else [],
            }).fetchall()
            all_visible_bids = {r[0] for r in visible_bids_rows}
            derived_bundle_ids = all_visible_bids - set(scope.bundle_ids)

        visible_derived_bundles = []
        if derived_bundle_ids:
            for bid in derived_bundle_ids:
                bundle = db.get(Bundle, bid)
                if not bundle or bundle.infospace_id != infospace_id:
                    continue
                has_content = db.execute(text("""
                    SELECT EXISTS(
                        SELECT 1 FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[]
                        AND infospace_id = :iid AND parent_asset_id IS NULL
                        AND (
                            id = ANY(:aids)
                            OR id IN (
                                SELECT DISTINCT asset_id FROM annotation
                                WHERE run_id = ANY(:rids) AND asset_id IS NOT NULL
                            )
                        )
                    )
                """), {
                    "bid": bid, "iid": infospace_id,
                    "aids": list(scope.asset_ids) if scope.asset_ids else [],
                    "rids": list(scope.run_ids) if scope.run_ids else [],
                }).scalar()
                if has_content:
                    visible_derived_bundles.append(bundle)

        all_root_bundles = explicit_root_bundles + visible_derived_bundles
        all_root_bundles.sort(key=lambda b: b.name or "")

        scoped_root_assets = []
        if scope.asset_ids:
            scoped_root_assets = db.exec(
                select(Asset)
                .where(Asset.id.in_(scope.asset_ids))
                .where(Asset.parent_asset_id.is_(None))
                .where(text("bundle_ids = ARRAY[0]::int[]"))
                .order_by(Asset.updated_at.desc())
            ).all()

        nodes = build_root_tree_nodes(all_root_bundles, scoped_root_assets, db)
        return nodes, len(all_root_bundles)


def _tree_counts(db, infospace_id, scope):
    """Compute total bundles + assets. Can be slow on large datasets."""
    from app.api.modules.content.query import AssetQuery
    if not scope:
        tb = db.exec(
            select(func.count(Bundle.id)).where(Bundle.infospace_id == infospace_id)
        ).one() or 0
        ta = db.exec(
            select(func.count(Asset.id)).where(Asset.infospace_id == infospace_id)
        ).one() or 0
        return tb, ta
    else:
        n_bundles = 0  # scoped path already knows bundle count from _build_tree_nodes
        ta = 0
        if scope.bundle_ids or scope.asset_ids or scope.run_ids:
            ta = AssetQuery(db, infospace_id).scope(scope).count()
        return n_bundles, ta


@router.get(
    "/infospaces/{infospace_id}/tree",
    response_class=EventSourceResponse,
    response_model=TreeResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def get_infospace_tree(
    *,
    infospace_id: int,
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """
    Get the root-level tree structure for an infospace.

    Native SSE — tree nodes stream first, counts arrive later.
    Keepalive pings survive nginx proxy_read_timeout.
    """
    scope = access.scope

    try:
        tree_nodes, n_bundles = await asyncio.to_thread(_build_tree_nodes, db, infospace_id, scope)
    except Exception as e:
        logger.exception("Tree build error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")
        return

    yield ServerSentEvent(
        data=TreePhase(
            nodes=tree_nodes,
            total_bundles=n_bundles if n_bundles is not None else -1,
            total_assets=-1,
            total_nodes=len(tree_nodes),
        ),
        event="tree",
    )

    try:
        total_bundles, total_assets = await asyncio.to_thread(_tree_counts, db, infospace_id, scope)
        if n_bundles is not None:
            total_bundles = n_bundles
        yield ServerSentEvent(
            data=TreeCountsPhase(total_bundles=total_bundles, total_assets=total_assets),
            event="counts",
        )
    except Exception as e:
        logger.exception("Tree count error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")


@router.get("/infospaces/{infospace_id}/tree/children", response_model=TreeChildrenResponse)
def get_tree_children(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node ID (format: 'bundle-123' or 'asset-456')"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
) -> Any:
    """
    Get children of a specific tree node (lazy loading).

    For bundles: Returns child bundles + assets in that bundle.
    For container assets: Returns child assets (PDF pages, CSV rows, etc.)
    Scope-aware: package token access only sees scoped bundles.
    """
    scope = access.scope
    
    # Parse the parent ID
    try:
        parent_type, parent_numeric_id = parse_tree_node_id(parent_id)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    
    children_nodes = []
    total_children = 0
    
    if parent_type == "bundle":
        # Get the bundle and verify access + scope
        bundle = db.get(Bundle, parent_numeric_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bundle {parent_numeric_id} not found"
            )
        # Scope guard: package token can only browse scoped bundles
        if scope and scope.bundle_ids and bundle.id not in scope.bundle_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")

        # Bundles with assets that have logical_path use virtual folders
        has_logical_path = db.execute(
            text("SELECT id FROM asset WHERE bundle_ids @> ARRAY[:bid]::int[] AND logical_path IS NOT NULL LIMIT 1"),
            {"bid": parent_numeric_id},
        ).first()
        if has_logical_path:
            # Include both: real child bundles (e.g. materialized vfolders) + virtual folders
            child_bundles = db.exec(
                select(Bundle)
                .where(Bundle.parent_bundle_id == parent_numeric_id)
                .order_by(Bundle.name)
            ).all()
            child_bundle_nodes = build_bundle_nodes(child_bundles, infospace_id, db)
            n_bundles = len(child_bundle_nodes)
            vfolder_skip = max(0, skip - n_bundles)
            vfolder_limit = max(0, limit - max(0, n_bundles - skip))
            vfolder_nodes, vfolder_total = _get_virtual_folder_children(
                db, bundle, infospace_id, "", vfolder_skip, vfolder_limit
            )
            if skip < n_bundles:
                bundle_slice = child_bundle_nodes[skip : skip + limit]
                children_nodes = bundle_slice + vfolder_nodes
            else:
                children_nodes = vfolder_nodes
            total_children = n_bundles + vfolder_total
        else:
            # Standard bundles: child bundles + direct assets
            child_bundles = db.exec(
                select(Bundle)
                .where(Bundle.parent_bundle_id == parent_numeric_id)
                .order_by(Bundle.name)
                .offset(skip)
                .limit(limit)
            ).all()
            remaining_limit = limit - len(child_bundles)
            asset_skip = max(0, skip - (bundle.child_bundle_count or 0))
            bundle_assets = []
            if remaining_limit > 0:
                asset_ids = [
                    r[0] for r in db.execute(
                        text(
                            "SELECT id FROM asset "
                            "WHERE bundle_ids @> ARRAY[:bid]::int[] "
                            "AND parent_asset_id IS NULL "
                            "ORDER BY title OFFSET :off LIMIT :lim"
                        ),
                        {"bid": parent_numeric_id, "off": asset_skip, "lim": remaining_limit},
                    ).fetchall()
                ]
                if asset_ids:
                    bundle_assets = list(db.exec(
                        select(Asset).where(Asset.id.in_(asset_ids)).order_by(Asset.title)
                    ).all())
            children_nodes = build_bundle_children_nodes(bundle, child_bundles, bundle_assets, db)
            total_children = (bundle.child_bundle_count or 0) + (bundle.asset_count or 0)

        logger.info(f"Loaded {len(children_nodes)} children for bundle {parent_numeric_id}")

    elif parent_type == "vfolder":
        try:
            bundle_id, path_prefix = parse_vfolder_node_id(parent_id)
        except ValueError as e:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(e)
            )
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bundle {bundle_id} not found"
            )
        children_nodes, total_children = _get_virtual_folder_children(
            db, bundle, infospace_id, path_prefix, skip, limit
        )
        logger.info(f"Loaded {len(children_nodes)} children for vfolder {path_prefix}")
    
    elif parent_type == "asset":
        # Get the asset and verify access
        asset = db.get(Asset, parent_numeric_id)
        if not asset or asset.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Asset {parent_numeric_id} not found"
            )
        access.require_in_scope("asset_ids", parent_numeric_id)

        if not asset.is_container:
            # Not a container, no children
            return TreeChildrenResponse(
                parent_id=parent_id,
                children=[],
                total_children=0,
                has_more=False,
            )
        
        # Get child assets
        child_assets = db.exec(
            select(Asset)
            .where(Asset.parent_asset_id == parent_numeric_id)
            .order_by(Asset.part_index, Asset.created_at)
            .offset(skip)
            .limit(limit)
        ).all()
        
        # Count total children (DB-side, scalable)
        total_children = db.exec(
            select(func.count(Asset.id)).where(Asset.parent_asset_id == parent_numeric_id)
        ).one() or 0
        
        # Build tree nodes
        children_nodes = build_asset_children_nodes(asset, child_assets)
        
        logger.info(f"Loaded {len(children_nodes)} children for asset {parent_numeric_id}")
    
    else:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid parent type: {parent_type}"
        )
    
    has_more = (skip + len(children_nodes)) < total_children
    
    return TreeChildrenResponse(
        parent_id=parent_id,
        children=children_nodes,
        total_children=total_children,
        has_more=has_more,
    )


class TreeDeleteRequest(BaseModel):
    node_ids: List[str]  # Format: ["bundle-123", "asset-456"]


def _parse_delete_request(db: Session, infospace_id: int, node_ids: List[str]) -> tuple[list[int], list[int]]:
    """Parse node IDs into validated bundle and asset ID lists."""
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
    """
    Preview the impact of deleting tree nodes without mutating anything.
    Returns TreeResult with executed=False.
    """
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
    """
    Delete tree nodes (bundles and/or assets).
    Cascades: bundle delete includes assets; asset delete includes children.
    Requires DELETE capability (analyst+).
    """
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


# ─── SSE phase models for feed ───

class FeedPhase(BaseModel):
    assets: List[AssetRead]
    total: int  # -1 sentinel
    has_more: bool

class FeedCountPhase(BaseModel):
    total: int
    has_more: bool

class FeedAssetsResponse(BaseModel):
    assets: List[AssetRead]
    total: int
    has_more: bool


def _build_feed_queries(db, infospace_id, scope, access, bundle_id, path_filter, kinds, sort_by, sort_order, skip, limit):
    """Build the main query and count query for feed. Returns (query, count_query)."""
    query = (
        select(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.parent_asset_id.is_(None))
    )
    count_query = (
        select(func.count(Asset.id))
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.parent_asset_id.is_(None))
    )

    if scope and scope.bundle_ids:
        bids = list(scope.bundle_ids)
        query = query.where(text("bundle_ids && CAST(:s AS int[])").bindparams(s=bids))
        count_query = count_query.where(text("bundle_ids && CAST(:s AS int[])").bindparams(s=bids))

    if bundle_id is not None:
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Bundle {bundle_id} not found")
        if scope and scope.bundle_ids and bundle_id not in scope.bundle_ids:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
        bundle_cond = text("bundle_ids @> ARRAY[:bid]::int[]").bindparams(bid=bundle_id)
        query = query.where(bundle_cond)
        count_query = count_query.where(bundle_cond)
        if path_filter:
            like_prefix = f"{path_filter}%" if path_filter else "%"
            path_cond = (Asset.logical_path.is_not(None)) & (Asset.logical_path.like(like_prefix))
            query = query.where(path_cond)
            count_query = count_query.where(path_cond)
    # No extra filter needed — infospace_id constraint is the data boundary,
    # access was already validated by Requires(). All collaborators see all assets.

    if kinds:
        query = query.where(Asset.kind.in_(kinds))
        count_query = count_query.where(Asset.kind.in_(kinds))

    if sort_by == "created_at":
        order_col = Asset.created_at
    elif sort_by == "name":
        order_col = Asset.title
    else:
        order_col = Asset.updated_at

    if sort_order == "asc":
        query = query.order_by(order_col.asc())
    else:
        query = query.order_by(order_col.desc())

    query = query.offset(skip).limit(limit)
    return query, count_query


@router.get(
    "/infospaces/{infospace_id}/tree/feed",
    response_class=EventSourceResponse,
    response_model=FeedAssetsResponse,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def get_feed_assets(
    *,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    kinds: List[str] = Query(None, description="Filter by asset kinds"),
    sort_by: str = Query("updated_at", description="Sort field: created_at, updated_at, name"),
    sort_order: str = Query("desc", description="Sort order: asc, desc"),
    bundle_id: Optional[int] = Query(None, description="Filter to assets in this bundle (for Bundle detail)"),
    path_filter: Optional[str] = Query(None, description="Filter by logical_path prefix (for virtual folder)"),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
):
    """
    Get a feed of recent assets sorted by date.

    Native SSE — assets stream first, count arrives later.
    Keepalive pings survive nginx proxy_read_timeout.
    """
    scope = access.scope
    query, count_query = _build_feed_queries(
        db, infospace_id, scope, access, bundle_id, path_filter, kinds, sort_by, sort_order, skip, limit,
    )

    try:
        assets = list(await asyncio.to_thread(lambda: db.exec(query).all()))
        asset_reads = [AssetRead.model_validate(a) for a in assets]
    except Exception as e:
        logger.exception("Feed query error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")
        return

    yield ServerSentEvent(
        data=FeedPhase(assets=asset_reads, total=-1, has_more=False),
        event="feed",
    )

    try:
        total = await asyncio.to_thread(lambda: db.exec(count_query).one() or 0)
        yield ServerSentEvent(
            data=FeedCountPhase(total=total, has_more=(skip + len(assets)) < total),
            event="count",
        )
    except Exception as e:
        logger.exception("Feed count error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")


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
    """Batch fetch multiple assets by IDs. Scope-aware."""
    if not request.asset_ids:
        return []

    from app.api.modules.content.query import AssetQuery
    aq = AssetQuery(db, infospace_id).scope(access.scope)
    # Filter to only the requested IDs within scope
    aq._conditions.append(Asset.id.in_(request.asset_ids))
    assets = aq.execute()
    
    # Return in the same order as requested IDs (preserve order)
    asset_map = {asset.id: asset for asset in assets}
    result = []
    for asset_id in request.asset_ids:
        if asset_id in asset_map:
            result.append(AssetRead.model_validate(asset_map[asset_id]))
    
    logger.info(f"Batch fetched {len(result)} assets for infospace {infospace_id}")
    return result


class TextSearchResult(BaseModel):
    """Single text search result with relevance score."""
    asset: AssetRead
    score: float = Field(description="Relevance score (0-1, higher is better)")
    match_type: str = Field(description="Where the match was found: 'title', 'content', or 'bundle'")
    match_context: Optional[str] = Field(None, description="Snippet of matching content")


class TextSearchResponse(BaseModel):
    """Response from text search."""
    query: str
    results: List[TextSearchResult]
    total_found: int
    infospace_id: int


@router.get("/infospaces/{infospace_id}/tree/text-search", response_model=TextSearchResponse)
def text_search_assets(
    *,
    infospace_id: int,
    query: str = Query(..., min_length=1, description="Search query"),
    limit: int = Query(100, ge=1, le=500, description="Maximum number of results"),
    asset_kinds: Optional[List[AssetKind]] = Query(None, description="Filter by asset types"),
    bundle_id: Optional[int] = Query(None, description="Search within specific bundle"),
    access: Access = ViewAccess,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
) -> Any:
    """
    Comprehensive text search across all assets in an infospace.
    """
    # Text search service doesn't support scope filtering yet — deny scoped access
    if access.scope:
        return TextSearchResponse(query=query, results=[], total_found=0, infospace_id=infospace_id)
    try:
        from app.api.modules.search.services import SearchService
        search_service = SearchService(db)
        data = search_service.search_assets_tree_text(
            infospace_id=infospace_id,
            user_id=access.user_id,
            query=query,
            limit=limit,
            asset_kinds=asset_kinds,
            bundle_id=bundle_id,
        )
        return TextSearchResponse(
            query=data["query"],
            results=[TextSearchResult(**r) for r in data["results"]],
            total_found=data["total_found"],
            infospace_id=data["infospace_id"],
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

