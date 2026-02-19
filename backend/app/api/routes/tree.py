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
from sqlalchemy import update, or_, func, text
from pydantic import BaseModel, Field

from app.api import dependency_injection
from app.models import Asset, Bundle, AssetKind
from app.schemas import TreeResponse, TreeNode, TreeChildrenResponse, Message, AssetRead
from app.api.global_utils import validate_infospace_access
from app.api.content_tree_builder import (
    build_root_tree_nodes,
    build_bundle_children_nodes,
    build_asset_children_nodes,
    build_tree_node_from_asset,
    build_tree_node_from_vfolder,
    parse_tree_node_id,
    parse_vfolder_node_id,
)

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
        WHERE bundle_id = :bundle_id
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
        WHERE bundle_id = :bundle_id
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
            WHERE bundle_id = :bundle_id
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


@router.get("/infospaces/{infospace_id}/tree", response_model=TreeResponse)
def get_infospace_tree(
    *,
    infospace_id: int,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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
    
    # Query root bundles (no parent) - limited to root level only
    root_bundles = db.exec(
        select(Bundle)
        .where(Bundle.infospace_id == infospace_id)
        .where(Bundle.parent_bundle_id.is_(None))
        .order_by(Bundle.name)
    ).all()
    
    logger.info(f"Found {len(root_bundles)} root bundles in infospace {infospace_id}")
    
    # Query root assets (not in any bundle, no parent asset)
    # Use bundle_id IS NULL instead of loading all bundled IDs - scalable for large infospaces
    root_assets = db.exec(
        select(Asset)
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.parent_asset_id.is_(None))
        .where(Asset.bundle_id.is_(None))
        .where(Asset.user_id == current_user.id)
        .order_by(Asset.updated_at.desc())
    ).all()
    
    logger.info(f"Found {len(root_assets)} root assets in infospace {infospace_id}")
    
    # Build tree nodes using utility functions
    tree_nodes = build_root_tree_nodes(root_bundles, root_assets, db)
    
    # Count totals (DB-side, scalable for large infospaces)
    total_bundles = db.exec(
        select(func.count(Bundle.id)).where(Bundle.infospace_id == infospace_id)
    ).one() or 0
    
    total_assets = db.exec(
        select(func.count(Asset.id))
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
    ).one() or 0
    
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
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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

        # Bundles with assets that have logical_path use virtual folders
        has_logical_path = db.exec(
            select(Asset.id)
            .where(Asset.bundle_id == parent_numeric_id)
            .where(Asset.logical_path.is_not(None))
            .limit(1)
        ).first()
        if has_logical_path:
            children_nodes, total_children = _get_virtual_folder_children(
                db, bundle, infospace_id, "", skip, limit
            )
        else:
            # Standard bundles: child bundles + direct assets (SQL query, not relationship)
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
                bundle_assets = db.exec(
                    select(Asset)
                    .where(Asset.bundle_id == parent_numeric_id)
                    .where(Asset.parent_asset_id.is_(None))
                    .order_by(Asset.title)
                    .offset(asset_skip)
                    .limit(remaining_limit)
                ).all()

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

@router.post("/infospaces/{infospace_id}/tree/delete", response_model=Message)
def delete_tree_nodes(
    *,
    infospace_id: int,
    request: TreeDeleteRequest,
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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
    
    # PHASE 5: Clear DatasetIngestionJob references before deleting bundles
    if bundles_to_delete:
        from app.models import DatasetIngestionJob
        bundle_ids_to_delete = [b.id for b in bundles_to_delete]
        jobs_to_update = db.exec(
            select(DatasetIngestionJob).where(
                DatasetIngestionJob.root_bundle_id.in_(bundle_ids_to_delete)
            )
        ).all()
        if jobs_to_update:
            logger.info(f"Clearing root_bundle_id from {len(jobs_to_update)} dataset ingestion jobs")
            for job in jobs_to_update:
                job.root_bundle_id = None
                db.add(job)
    
    # PHASE 6: Delete bundles (safe now that assets and job references are cleared)
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


class VirtualFolderChildrenResponse(BaseModel):
    """Response for virtual folder children (path-based tree from blob_path)."""
    folders: List[str]
    assets: List[AssetRead]
    path_prefix: str
    total_folders: int
    total_assets: int


@router.get("/infospaces/{infospace_id}/tree/virtual-children", response_model=VirtualFolderChildrenResponse)
def get_virtual_folder_children(
    *,
    infospace_id: int,
    bundle_id: int = Query(..., description="Bundle ID (root bundle for dataset)"),
    path_prefix: str = Query("", description="Path prefix for filtering (e.g. data_set_1/politics)"),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
) -> Any:
    """
    Get virtual folder structure from blob_path for path-based bundles.
    Parses blob_path to extract immediate subfolders and files under path_prefix.
    Used for lightweight directory-imported bundles (one root Bundle, virtual folders).
    """
    validate_infospace_access(db, infospace_id, current_user.id)

    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bundle not found")

    # When path_prefix is empty, we're at bundle root - use bundle.name as base (e.g. data_set_1)
    base_prefix = f"{bundle.name}/" if not path_prefix else f"{path_prefix}/"
    like_prefix = f"{base_prefix}%"

    query = (
        select(Asset)
        .where(Asset.bundle_id == bundle_id)
        .where(Asset.blob_path.is_not(None))
        .where(Asset.blob_path.like(like_prefix))
    )

    assets_raw = db.exec(query.limit(limit * 10)).all()  # Fetch more to parse folders
    folders_set: set = set()
    files_at_level: List[Asset] = []

    prefix_len = len(base_prefix)

    for asset in assets_raw:
        if not asset.blob_path:
            continue
        if not asset.blob_path.startswith(base_prefix):
            continue
        suffix = asset.blob_path[prefix_len:]
        parts = suffix.split("/")
        if len(parts) == 1 and parts[0]:
            files_at_level.append(asset)
        elif len(parts) > 1:
            folders_set.add(parts[0])

    folders = sorted(folders_set)[skip : skip + limit]
    asset_skip = max(0, skip - len(folders))
    assets_page = files_at_level[asset_skip : asset_skip + limit]

    total_folders = len(folders_set)
    total_assets = len(files_at_level)

    return VirtualFolderChildrenResponse(
        folders=folders,
        assets=[AssetRead.model_validate(a) for a in assets_page],
        path_prefix=path_prefix,
        total_folders=total_folders,
        total_assets=total_assets,
    )


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
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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
    
    # Get total count (DB-side, scalable for large infospaces)
    count_query = (
        select(func.count(Asset.id))
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.user_id == current_user.id)
        .where(Asset.parent_asset_id.is_(None))
    )
    if kinds:
        count_query = count_query.where(Asset.kind.in_(kinds))
    total = db.exec(count_query).one() or 0
    
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
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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
    db: Session = dependency_injection.Depends(dependency_injection.get_db),
    current_user = dependency_injection.Depends(dependency_injection.get_current_user),
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

