"""
Tree Building Utilities
========================

Lightweight helper functions for building tree structures from assets and bundles.
No service class needed - just pure functions for formatting data.
"""

from typing import List, Dict, Set
from app.models import Asset, Bundle
from app.schemas import TreeNode, TreeNodeType


def build_tree_node_from_bundle(bundle: Bundle) -> TreeNode:
    """Convert a Bundle to a TreeNode with minimal data."""
    return TreeNode(
        id=f"bundle-{bundle.id}",
        type=TreeNodeType.BUNDLE,
        name=bundle.name,
        has_children=(bundle.asset_count or 0) > 0 or (bundle.child_bundle_count or 0) > 0,
        children_count=(bundle.asset_count or 0) + (bundle.child_bundle_count or 0),
        asset_count=bundle.asset_count,
        child_bundle_count=bundle.child_bundle_count,
        parent_id=f"bundle-{bundle.parent_bundle_id}" if bundle.parent_bundle_id else None,
        updated_at=bundle.updated_at,
        created_at=bundle.created_at,
    )


def build_tree_node_from_asset(asset: Asset, parent_type: str = None, parent_id: int = None) -> TreeNode:
    """
    Convert an Asset to a TreeNode with minimal data.
    
    Args:
        asset: The asset to convert
        parent_type: Type of parent ('bundle' or 'asset') if any
        parent_id: ID of parent if any
    """
    parent_id_str = None
    if parent_type and parent_id:
        parent_id_str = f"{parent_type}-{parent_id}"
    
    return TreeNode(
        id=f"asset-{asset.id}",
        type=TreeNodeType.ASSET,
        name=asset.title,
        kind=asset.kind,
        is_container=asset.is_container,
        has_children=asset.is_container,
        stub=asset.stub,
        processing_status=asset.processing_status,
        parent_id=parent_id_str,
        updated_at=asset.updated_at,
        created_at=asset.created_at,
    )


def get_bundled_asset_ids(bundles: List[Bundle]) -> Set[int]:
    """
    Extract all asset IDs that are contained in the given bundles.
    
    Returns a set of asset IDs for efficient lookup.
    Note: With the new one-to-many model, we could query by bundle_id,
    but keeping this for compatibility with the relationship access pattern.
    """
    bundled_ids = set()
    for bundle in bundles:
        # Access the assets relationship (one-to-many via bundle_id)
        for asset in bundle.assets:
            bundled_ids.add(asset.id)
    return bundled_ids


def build_root_tree_nodes(
    root_bundles: List[Bundle],
    root_assets: List[Asset],
) -> List[TreeNode]:
    """
    Build tree nodes for root level (no parents).
    
    Args:
        root_bundles: Bundles with no parent_bundle_id
        root_assets: Assets with no parent_asset_id and not in any bundle
    
    Returns:
        List of TreeNode objects for the root level
    """
    nodes = []
    
    # Add bundle nodes
    for bundle in root_bundles:
        nodes.append(build_tree_node_from_bundle(bundle))
    
    # Add standalone asset nodes
    for asset in root_assets:
        nodes.append(build_tree_node_from_asset(asset))
    
    return nodes


def build_bundle_children_nodes(
    bundle: Bundle,
    child_bundles: List[Bundle],
    bundle_assets: List[Asset],
) -> List[TreeNode]:
    """
    Build tree nodes for children of a specific bundle.
    
    Args:
        bundle: Parent bundle
        child_bundles: Nested bundles within this bundle
        bundle_assets: Assets directly in this bundle (not their children)
    
    Returns:
        List of TreeNode objects for bundle children
    """
    nodes = []
    
    # Add child bundles first
    for child_bundle in child_bundles:
        nodes.append(build_tree_node_from_bundle(child_bundle))
    
    # Add bundle's direct assets
    for asset in bundle_assets:
        nodes.append(build_tree_node_from_asset(asset, parent_type="bundle", parent_id=bundle.id))
    
    return nodes


def build_asset_children_nodes(
    parent_asset: Asset,
    child_assets: List[Asset],
) -> List[TreeNode]:
    """
    Build tree nodes for children of a container asset.
    
    Args:
        parent_asset: Parent container asset (PDF, CSV, etc.)
        child_assets: Child assets (pages, rows, etc.)
    
    Returns:
        List of TreeNode objects for asset children
    """
    nodes = []
    
    for child_asset in child_assets:
        nodes.append(build_tree_node_from_asset(
            child_asset, 
            parent_type="asset", 
            parent_id=parent_asset.id
        ))
    
    return nodes


def parse_tree_node_id(node_id: str) -> tuple[str, int]:
    """
    Parse a tree node ID string into type and numeric ID.
    
    Args:
        node_id: Format "bundle-123" or "asset-456"
    
    Returns:
        Tuple of (type_str, numeric_id)
        
    Raises:
        ValueError: If format is invalid
    """
    try:
        type_str, id_str = node_id.split('-', 1)
        numeric_id = int(id_str)
        
        if type_str not in ['bundle', 'asset']:
            raise ValueError(f"Invalid node type: {type_str}")
        
        return type_str, numeric_id
    except (ValueError, AttributeError) as e:
        raise ValueError(f"Invalid tree node ID format '{node_id}': {e}")

