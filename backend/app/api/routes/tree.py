"""
Tree API Routes
===============

Endpoints for efficient tree-based navigation of bundles and assets.
Returns minimal metadata for fast initial rendering and lazy-loads children on demand.
"""

import logging
from typing import Any, List, Optional
from fastapi import APIRouter, HTTPException, Query, status
from sqlmodel import Session, select, delete
from sqlalchemy import update, or_, func
from pydantic import BaseModel, Field

from app.api import deps
from app.models import Asset, Bundle, AssetKind
from app.schemas import TreeResponse, TreeNode, TreeChildrenResponse, Message, AssetRead
from app.api.services.service_utils import validate_infospace_access
from app.api.utils.tree_builder import (
    build_root_tree_nodes,
    build_bundle_children_nodes,
    build_asset_children_nodes,
    parse_tree_node_id,
    get_bundled_asset_ids,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/infospaces/{infospace_id}/tree", response_model=TreeResponse)
def get_infospace_tree(
    *,
    infospace_id: int,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Get the root-level tree structure for an infospace.
    
    Returns minimal metadata for bundles and assets:
    - Root bundles (no parent_bundle_id)
    - Root assets (no parent_asset_id, not in any bundle)
    
    This provides fast initial rendering. Use the /tree/children endpoint
    to lazy-load contents when user expands a node.
    
    **Performance:** Single query, minimal data transfer (~50-100KB vs 500KB-2MB)
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    # Query root bundles (no parent)
    root_bundles = db.exec(
        select(Bundle)
        .where(Bundle.infospace_id == infospace_id)
        .where(Bundle.parent_bundle_id.is_(None))
        .order_by(Bundle.name)
    ).all()
    
    logger.info(f"Found {len(root_bundles)} root bundles in infospace {infospace_id}")
    
    # Get IDs of all assets that are in ANY bundle (to exclude from root assets)
    bundled_asset_ids = get_bundled_asset_ids(root_bundles)
    
    # Also need to check nested bundles for their assets
    all_bundles = db.exec(
        select(Bundle)
        .where(Bundle.infospace_id == infospace_id)
    ).all()
    all_bundled_ids = get_bundled_asset_ids(all_bundles)
    
    # Query root assets (not in bundles, no parent asset)
    root_assets_query = (
        select(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.parent_asset_id.is_(None))
        .where(Asset.user_id == current_user.id)
        .order_by(Asset.updated_at.desc())
    )
    
    if all_bundled_ids:
        root_assets_query = root_assets_query.where(Asset.id.not_in(all_bundled_ids))
    
    root_assets = db.exec(root_assets_query).all()
    
    logger.info(f"Found {len(root_assets)} root assets in infospace {infospace_id}")
    
    # Build tree nodes using utility functions
    tree_nodes = build_root_tree_nodes(root_bundles, root_assets, db)
    
    # Count totals
    total_bundles = len(db.exec(
        select(Bundle.id).where(Bundle.infospace_id == infospace_id)
    ).all())
    
    total_assets = len(db.exec(
        select(Asset.id)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
    ).all())
    
    return TreeResponse(
        nodes=tree_nodes,
        total_bundles=total_bundles,
        total_assets=total_assets,
        total_nodes=len(tree_nodes),
    )


@router.get("/infospaces/{infospace_id}/tree/children", response_model=TreeChildrenResponse)
def get_tree_children(
    *,
    infospace_id: int,
    parent_id: str = Query(..., description="Parent node ID (format: 'bundle-123' or 'asset-456')"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Get children of a specific tree node (lazy loading).
    
    For bundles: Returns child bundles + assets in that bundle
    For container assets: Returns child assets (PDF pages, CSV rows, etc.)
    
    **Performance:** Only loads children when user expands, minimal data transfer
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
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
        # Get the bundle and verify access
        bundle = db.get(Bundle, parent_numeric_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bundle {parent_numeric_id} not found"
            )
        
        # Get child bundles
        child_bundles = db.exec(
            select(Bundle)
            .where(Bundle.parent_bundle_id == parent_numeric_id)
            .order_by(Bundle.name)
            .offset(skip)
            .limit(limit)
        ).all()
        
        # Get assets in this bundle (not their children, just direct members)
        # We need to account for skip/limit across both bundles and assets
        remaining_limit = limit - len(child_bundles)
        asset_skip = max(0, skip - (bundle.child_bundle_count or 0))
        
        bundle_assets = []
        if remaining_limit > 0:
            # Get assets through the many-to-many relationship
            all_bundle_assets = bundle.assets
            # Apply skip and limit
            bundle_assets = all_bundle_assets[asset_skip:asset_skip + remaining_limit]
        
        # Build tree nodes
        children_nodes = build_bundle_children_nodes(bundle, child_bundles, bundle_assets, db)
        total_children = (bundle.child_bundle_count or 0) + (bundle.asset_count or 0)
        
        logger.info(f"Loaded {len(children_nodes)} children for bundle {parent_numeric_id}")
    
    elif parent_type == "asset":
        # Get the asset and verify access
        asset = db.get(Asset, parent_numeric_id)
        if not asset or asset.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Asset {parent_numeric_id} not found"
            )
        
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
        
        # Count total children
        total_children = len(db.exec(
            select(Asset.id).where(Asset.parent_asset_id == parent_numeric_id)
        ).all())
        
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

@router.post("/infospaces/{infospace_id}/tree/delete", response_model=Message)
def delete_tree_nodes(
    *,
    infospace_id: int,
    request: TreeDeleteRequest,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Delete tree nodes (bundles and/or assets).
    
    Handles cascading deletion intelligently:
    - Deleting a bundle deletes all assets inside it
    - Deleting an asset deletes all child assets
    - Much cleaner than separate bundle/asset endpoints
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    if not request.node_ids:
        return Message(message="No items to delete")
    
    # PHASE 1: Collect all items to delete and validate ownership
    bundles_to_delete = []
    bundle_ids_to_delete = set()
    explicitly_selected_asset_ids = set()
    failed_count = 0
    
    for node_id in request.node_ids:
        try:
            node_type, node_numeric_id = parse_tree_node_id(node_id)
            
            if node_type == "bundle":
                bundle = db.get(Bundle, node_numeric_id)
                if not bundle or bundle.infospace_id != infospace_id:
                    logger.warning(f"Bundle {node_numeric_id} not found or not in infospace")
                    failed_count += 1
                    continue
                
                bundles_to_delete.append(bundle)
                bundle_ids_to_delete.add(bundle.id)
                    
            elif node_type == "asset":
                asset = db.get(Asset, node_numeric_id)
                if not asset or asset.infospace_id != infospace_id:
                    logger.warning(f"Asset {node_numeric_id} not found or not in infospace")
                    failed_count += 1
                    continue
                
                explicitly_selected_asset_ids.add(node_numeric_id)
                
        except Exception as e:
            logger.error(f"Failed to parse/validate node {node_id}: {e}")
            failed_count += 1
    
    # PHASE 2: Handle assets in bundles being deleted
    # When a bundle is deleted, its assets are also deleted (cascade delete)
    # This matches user expectations when selecting all and deleting
    asset_ids_to_delete = set(explicitly_selected_asset_ids)
    
    if bundle_ids_to_delete:
        # Find all assets in the bundles being deleted
        assets_in_deleted_bundles = db.exec(
            select(Asset).where(Asset.bundle_id.in_(bundle_ids_to_delete))
        ).all()
        
        logger.info(f"Found {len(assets_in_deleted_bundles)} assets in {len(bundle_ids_to_delete)} bundles being deleted")
        
        # Add these assets to the deletion set (cascade delete from bundles)
        for asset in assets_in_deleted_bundles:
            asset_ids_to_delete.add(asset.id)
        
        logger.info(f"Added {len(assets_in_deleted_bundles)} assets from bundles to deletion set")
    
    # PHASE 2.5: Cascade delete child assets (CSV rows, PDF pages, etc.)
    # Collect all child assets recursively
    if asset_ids_to_delete:
        def collect_children_recursive(parent_ids: set) -> set:
            """Recursively collect all descendant asset IDs."""
            all_children = set()
            current_level = parent_ids
            
            while current_level:
                children = db.exec(
                    select(Asset.id).where(Asset.parent_asset_id.in_(current_level))
                ).all()
                
                if not children:
                    break
                
                child_ids = set(children)
                all_children.update(child_ids)
                current_level = child_ids
            
            return all_children
        
        # Collect all descendants
        all_children = collect_children_recursive(asset_ids_to_delete)
        if all_children:
            logger.info(f"Found {len(all_children)} child assets to cascade delete")
            asset_ids_to_delete.update(all_children)
    
    # PHASE 2.75: Clear self-referential foreign keys to avoid circular dependencies
    # Only clear previous_asset_id (version chains), not parent_asset_id (we're deleting children)
    if asset_ids_to_delete:
        logger.info(f"Clearing self-references for {len(asset_ids_to_delete)} assets")
        # Clear previous_asset_id where it points to an asset we're deleting
        db.exec(
            update(Asset)
            .where(Asset.previous_asset_id.in_(asset_ids_to_delete))
            .values(previous_asset_id=None)
        )
    
    # PHASE 3: Delete child records (bulk DELETE bypasses ORM cascades)
    if asset_ids_to_delete:
        from app.models import AssetChunk, Annotation
        logger.info(f"Deleting child records for {len(asset_ids_to_delete)} assets")
        # Delete asset chunks (for RAG/vector search)
        db.exec(
            delete(AssetChunk).where(AssetChunk.asset_id.in_(asset_ids_to_delete))
        )
        # Delete annotations
        db.exec(
            delete(Annotation).where(Annotation.asset_id.in_(asset_ids_to_delete))
        )
    
    # PHASE 4: Bulk delete all assets
    deleted_assets = 0
    if asset_ids_to_delete:
        logger.info(f"Bulk deleting {len(asset_ids_to_delete)} assets")
        result = db.exec(
            delete(Asset).where(Asset.id.in_(asset_ids_to_delete))
        )
        deleted_assets = result.rowcount if hasattr(result, 'rowcount') else len(asset_ids_to_delete)
    
    # PHASE 5: Delete bundles (safe now that assets are gone)
    deleted_bundles = 0
    for bundle in bundles_to_delete:
        try:
            db.delete(bundle)
            deleted_bundles += 1
            logger.info(f"Deleted bundle {bundle.id}")
        except Exception as e:
            logger.error(f"Failed to delete bundle {bundle.id}: {e}")
            failed_count += 1
    
    db.commit()
    
    message_parts = []
    if deleted_bundles > 0:
        message_parts.append(f"{deleted_bundles} bundle{'s' if deleted_bundles != 1 else ''}")
    if deleted_assets > 0:
        message_parts.append(f"{deleted_assets} asset{'s' if deleted_assets != 1 else ''}")
    
    message = f"Deleted {' and '.join(message_parts)}"
    if failed_count > 0:
        message += f" ({failed_count} failed)"
    
    return Message(message=message)


class FeedAssetsResponse(BaseModel):
    """Response for the feed assets endpoint"""
    assets: List[AssetRead]
    total: int
    has_more: bool


@router.get("/infospaces/{infospace_id}/tree/feed", response_model=FeedAssetsResponse)
def get_feed_assets(
    *,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    kinds: List[str] = Query(None, description="Filter by asset kinds"),
    sort_by: str = Query("updated_at", description="Sort field: created_at, updated_at"),
    sort_order: str = Query("desc", description="Sort order: asc, desc"),
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Get a feed of recent assets sorted by date.
    
    Unlike the tree endpoint, this returns ALL displayable assets regardless
    of whether their containing bundle is expanded. Perfect for "latest" feeds.
    
    Features:
    - Includes assets from all bundles (not just expanded ones)
    - Filters out child assets (only parent/standalone assets)
    - Sorted by date (created_at or updated_at)
    - Supports kind filtering
    - Includes source_metadata for image extraction
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    # Base query: user's assets in this infospace, no parent asset
    query = (
        select(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
        .where(Asset.parent_asset_id.is_(None))  # Only top-level assets
    )
    
    # Filter by kinds if specified
    if kinds:
        query = query.where(Asset.kind.in_(kinds))
    
    # Get total count
    count_query = (
        select(Asset.id)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
        .where(Asset.parent_asset_id.is_(None))
    )
    if kinds:
        count_query = count_query.where(Asset.kind.in_(kinds))
    total = len(db.exec(count_query).all())
    
    # Apply sorting
    if sort_by == "created_at":
        order_col = Asset.created_at
    else:
        order_col = Asset.updated_at
    
    if sort_order == "asc":
        query = query.order_by(order_col.asc())
    else:
        query = query.order_by(order_col.desc())
    
    # Apply pagination
    query = query.offset(skip).limit(limit)
    
    assets = db.exec(query).all()
    
    logger.info(f"Feed: returned {len(assets)} assets (total: {total}) for infospace {infospace_id}")
    
    return FeedAssetsResponse(
        assets=[AssetRead.model_validate(a) for a in assets],
        total=total,
        has_more=(skip + len(assets)) < total
    )


class BatchGetAssetsRequest(BaseModel):
    asset_ids: List[int] = Field(..., description="List of asset IDs to fetch", max_length=100)

@router.post("/infospaces/{infospace_id}/tree/assets/batch", response_model=List[AssetRead])
def batch_get_assets(
    *,
    infospace_id: int,
    request: BatchGetAssetsRequest,
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Batch fetch multiple assets by IDs in a single request.
    
    Efficient alternative to multiple GET /assets/{id} calls.
    Used by semantic search and other features that need multiple assets.
    
    This endpoint follows the tree API pattern for efficient batch operations.
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    if not request.asset_ids:
        return []
    
    # Fetch all assets in a single query (same pattern as tree API)
    assets = db.exec(
        select(Asset)
        .where(Asset.id.in_(request.asset_ids))
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
    ).all()
    
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
    db: Session = deps.Depends(deps.get_db),
    current_user = deps.Depends(deps.get_current_user),
) -> Any:
    """
    Comprehensive text search across all assets in an infospace.
    
    Search strategy (prioritized):
    1. **Title matches** - Exact and partial matches in asset titles (highest priority)
    2. **Bundle members** - Assets in bundles with matching names
    3. **Fulltext content** - Searches text_content field (fallback)
    
    This searches ALL assets regardless of bundle membership or tree visibility,
    making it much more useful than the client-side filtering.
    
    Returns assets with relevance scores based on match quality.
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    
    search_term = query.strip().lower()
    if not search_term:
        return TextSearchResponse(
            query=query,
            results=[],
            total_found=0,
            infospace_id=infospace_id
        )
    
    logger.info(f"Text search in infospace {infospace_id}: '{query}' (kinds={asset_kinds}, bundle={bundle_id})")
    
    # Build base query
    base_query = (
        select(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
    )
    
    # Apply filters
    if asset_kinds:
        base_query = base_query.where(Asset.kind.in_(asset_kinds))
    
    if bundle_id is not None:
        # Search within specific bundle - get bundle and its assets
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Bundle {bundle_id} not found"
            )
        
        # Get asset IDs in this bundle
        asset_ids = [asset.id for asset in bundle.assets]
        if not asset_ids:
            return TextSearchResponse(
                query=query,
                results=[],
                total_found=0,
                infospace_id=infospace_id
            )
        base_query = base_query.where(Asset.id.in_(asset_ids))
    
    # Phase 1: Title matches (highest priority)
    title_query = base_query.where(
        func.lower(Asset.title).contains(search_term)
    )
    title_matches = db.exec(title_query).all()
    
    # Phase 2: Bundle name matches - find assets in bundles with matching names
    bundle_matches = []
    if not bundle_id:  # Only search bundles if not already filtering by one
        # Find bundles with matching names
        matching_bundles = db.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
            .where(func.lower(Bundle.name).contains(search_term))
        ).all()
        
        # Get all assets from matching bundles
        for bundle in matching_bundles:
            for asset in bundle.assets:
                # Apply kind filter if specified
                if asset_kinds and asset.kind not in asset_kinds:
                    continue
                # Only add if not already in title matches
                if asset not in title_matches:
                    bundle_matches.append((asset, bundle.name))
    
    # Phase 3: Fulltext content matches (lowest priority)
    # Exclude assets already found in title/bundle matches
    found_ids = {a.id for a in title_matches} | {a[0].id for a in bundle_matches}
    
    content_query = base_query.where(
        Asset.text_content.isnot(None),
        func.lower(Asset.text_content).contains(search_term)
    )
    if found_ids:
        content_query = content_query.where(Asset.id.not_in(found_ids))
    
    content_matches = db.exec(content_query).all()
    
    # Build results with scores and match types
    results: List[TextSearchResult] = []
    
    # Title matches - highest score (0.8-1.0)
    for asset in title_matches:
        title_lower = asset.title.lower()
        # Exact match gets 1.0, otherwise scale by position and length
        if title_lower == search_term:
            score = 1.0
        elif title_lower.startswith(search_term):
            score = 0.95
        else:
            # Score based on how early the match appears
            position = title_lower.find(search_term)
            score = 0.8 + (0.15 * (1 - position / max(len(title_lower), 1)))
        
        results.append(TextSearchResult(
            asset=AssetRead.model_validate(asset),
            score=score,
            match_type="title",
            match_context=asset.title[:100]
        ))
    
    # Bundle matches - medium score (0.5-0.7)
    for asset, bundle_name in bundle_matches:
        # Score based on how well the bundle name matches
        bundle_lower = bundle_name.lower()
        if bundle_lower == search_term:
            score = 0.7
        elif bundle_lower.startswith(search_term):
            score = 0.65
        else:
            score = 0.5
        
        results.append(TextSearchResult(
            asset=AssetRead.model_validate(asset),
            score=score,
            match_type="bundle",
            match_context=f"In bundle: {bundle_name}"
        ))
    
    # Content matches - lowest score (0.3-0.5)
    for asset in content_matches:
        if not asset.text_content:
            continue
        
        # Find the matching context (snippet around the match)
        content_lower = asset.text_content.lower()
        match_pos = content_lower.find(search_term)
        
        # Extract snippet around match
        snippet_start = max(0, match_pos - 50)
        snippet_end = min(len(asset.text_content), match_pos + len(search_term) + 50)
        snippet = asset.text_content[snippet_start:snippet_end].strip()
        
        # Add ellipsis if truncated
        if snippet_start > 0:
            snippet = "..." + snippet
        if snippet_end < len(asset.text_content):
            snippet = snippet + "..."
        
        # Score based on number of occurrences (more matches = higher score)
        occurrences = content_lower.count(search_term)
        score = min(0.3 + (occurrences * 0.05), 0.5)
        
        results.append(TextSearchResult(
            asset=AssetRead.model_validate(asset),
            score=score,
            match_type="content",
            match_context=snippet[:200]  # Limit snippet length
        ))
    
    # Sort by score (highest first) and apply limit
    results.sort(key=lambda r: r.score, reverse=True)
    results = results[:limit]
    
    logger.info(
        f"Text search found {len(results)} results: "
        f"{sum(1 for r in results if r.match_type == 'title')} title, "
        f"{sum(1 for r in results if r.match_type == 'bundle')} bundle, "
        f"{sum(1 for r in results if r.match_type == 'content')} content matches"
    )
    
    return TextSearchResponse(
        query=query,
        results=results,
        total_found=len(results),
        infospace_id=infospace_id
    )

