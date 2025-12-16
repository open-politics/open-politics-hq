"""
Tree Building Utilities
========================

Lightweight helper functions for building tree structures from assets and bundles.
No service class needed - just pure functions for formatting data.
"""

from typing import List, Dict, Set, Optional, Any
from sqlmodel import Session, select
from app.models import Asset, Bundle, AssetKind, Source, Flow, FlowStatus, Task, TaskStatus
from app.schemas import TreeNode, TreeNodeType
from collections import Counter
from datetime import datetime


def build_tree_node_from_bundle(bundle: Bundle, session: Optional[Session] = None) -> TreeNode:
    """
    Convert a Bundle to a TreeNode with minimal data and activity indicators.
    
    Args:
        bundle: The bundle to convert
        session: Optional database session for querying relationships
    """
    node = TreeNode(
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
    
    if session:
        # Query active sources outputting to this bundle
        active_sources = session.exec(
            select(Source)
            .where(Source.output_bundle_id == bundle.id)
            .where(Source.is_active == True)
        ).all()
        node.has_active_sources = len(active_sources) > 0
        node.active_source_count = len(active_sources)
        
        # Query active Flows watching this bundle as input
        active_flows_input = session.exec(
            select(Flow)
            .where(Flow.input_bundle_id == bundle.id)
            .where(Flow.status == FlowStatus.ACTIVE)
        ).all()
        node.has_monitors = len(active_flows_input) > 0  # Legacy field name for UI compatibility
        node.monitor_count = len(active_flows_input)
        
        # This bundle is a flow input if any active flow watches it
        node.is_pipeline_input = len(active_flows_input) > 0
        node.pipeline_input_count = len(active_flows_input)
        
        # Query Flows routing TO this bundle (ROUTE steps with bundle_id matching)
        all_flows = session.exec(
            select(Flow)
            .where(Flow.infospace_id == bundle.infospace_id)
            .where(Flow.status == FlowStatus.ACTIVE)
        ).all()
        
        # Filter flows that have a ROUTE step targeting this bundle
        matching_output_flows = []
        for flow in all_flows:
            if flow.steps:
                for step in flow.steps:
                    if step.get("type") == "ROUTE":
                        # Check bundle_id or bundle_ids in step config
                        if step.get("bundle_id") == bundle.id:
                            matching_output_flows.append(flow)
                            break
                        if bundle.id in (step.get("bundle_ids") or []):
                            matching_output_flows.append(flow)
                            break
        
        node.is_pipeline_output = len(matching_output_flows) > 0
        node.pipeline_output_count = len(matching_output_flows)
    
    return node


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
    
    # Include source_metadata for CSV rows (needed for table rendering)
    source_metadata = None
    if asset.kind and asset.kind.value == 'csv_row':
        source_metadata = asset.source_metadata
    
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
        source_metadata=source_metadata,
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
    session: Optional[Session] = None,
) -> List[TreeNode]:
    """
    Build tree nodes for root level (no parents).
    
    Args:
        root_bundles: Bundles with no parent_bundle_id
        root_assets: Assets with no parent_asset_id and not in any bundle
        session: Optional database session for querying relationships
    
    Returns:
        List of TreeNode objects for the root level
    """
    nodes = []
    
    # Add bundle nodes
    for bundle in root_bundles:
        nodes.append(build_tree_node_from_bundle(bundle, session))
    
    # Add standalone asset nodes
    for asset in root_assets:
        nodes.append(build_tree_node_from_asset(asset))
    
    return nodes


def build_bundle_children_nodes(
    bundle: Bundle,
    child_bundles: List[Bundle],
    bundle_assets: List[Asset],
    session: Optional[Session] = None,
) -> List[TreeNode]:
    """
    Build tree nodes for children of a specific bundle.
    
    Args:
        bundle: Parent bundle
        child_bundles: Nested bundles within this bundle
        bundle_assets: Assets directly in this bundle (not their children)
        session: Optional database session for querying relationships
    
    Returns:
        List of TreeNode objects for bundle children
    """
    nodes = []
    
    # Add child bundles first
    for child_bundle in child_bundles:
        nodes.append(build_tree_node_from_bundle(child_bundle, session))
    
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


# ============================================================================
# RICH PREVIEW BUILDERS - The Intelligence Layer
# ============================================================================

def format_csv_as_table(columns: List[str], sample_rows: List[Dict[str, Any]], max_col_width: int = 30) -> str:
    """
    Format CSV data as ASCII table for model readability.
    
    Example output:
    | Name        | Website           | Email              |
    |-------------|-------------------|--------------------|
    | Green Earth | https://green...  | info@green.org     |
    | Save Oceans | https://save...   | contact@ocean.org  |
    """
    if not columns or not sample_rows:
        return ""
    
    # Calculate column widths
    col_widths = {}
    for col in columns:
        # Start with column name width
        max_width = len(col)
        # Check all row values
        for row in sample_rows:
            val_str = str(row.get(col, ''))
            max_width = max(max_width, len(val_str))
        # Cap at max_col_width
        col_widths[col] = min(max_width, max_col_width)
    
    # Build table
    lines = []
    
    # Header row
    header_parts = []
    for col in columns:
        header_parts.append(col.ljust(col_widths[col]))
    lines.append("| " + " | ".join(header_parts) + " |")
    
    # Separator
    sep_parts = ["-" * col_widths[col] for col in columns]
    lines.append("|" + "|".join(sep_parts) + "|")
    
    # Data rows
    for row in sample_rows:
        row_parts = []
        for col in columns:
            val = str(row.get(col, ''))
            # Truncate if too long
            if len(val) > col_widths[col]:
                val = val[:col_widths[col]-3] + "..."
            row_parts.append(val.ljust(col_widths[col]))
        lines.append("| " + " | ".join(row_parts) + " |")
    
    return "\n".join(lines)


def build_csv_preview(asset: Asset, child_assets: Optional[List[Asset]] = None) -> Dict[str, Any]:
    """
    Build rich CSV preview with column headers and sample rows.
    
    DESIGN: df.head() equivalent - always show structure + first few rows
    """
    preview = {}
    
    # Extract column headers from source_metadata
    columns = asset.source_metadata.get('columns', [])
    
    # Fallback: extract from first child row if parent doesn't have columns
    if not columns and child_assets and len(child_assets) > 0:
        first_child = child_assets[0]
        # Try column_headers field (from for_csv_row builder)
        columns = first_child.source_metadata.get('column_headers', [])
        # Or extract from original_row_data keys
        if not columns:
            row_data = first_child.source_metadata.get('original_row_data', {})
            if row_data:
                columns = list(row_data.keys())
    
    if columns:
        preview['columns'] = columns
        preview['column_count'] = len(columns)
    
    # Row count - always use the actual total from parent asset metadata
    total_rows = asset.source_metadata.get('row_count', 0)
    if total_rows:
        preview['row_count'] = total_rows
    elif child_assets is not None:
        # Only use child count if no metadata available
        preview['row_count'] = len(child_assets)
    
    # Sample rows (first 5 from loaded children) - ALWAYS include if children available
    if child_assets and len(child_assets) > 0:
        sample_rows = []
        for child in child_assets[:5]:  # Increased from 3 to 5 for better preview
            row_data = child.source_metadata.get('original_row_data', {})
            if row_data:
                sample_rows.append(row_data)
        
        # Always include sample_rows if we have data
        if sample_rows:
            preview['sample_rows'] = sample_rows
            preview['sample_count'] = len(sample_rows)
        elif columns:
            # Even if no sample_rows, indicate we have structure
            preview['sample_rows'] = []
            preview['sample_count'] = 0
    
    # File info
    if asset.source_identifier:
        preview['source'] = asset.source_identifier
    
    return preview


def build_pdf_preview(asset: Asset, child_assets: Optional[List[Asset]] = None) -> Dict[str, Any]:
    """Build rich PDF preview with page count and first page excerpt."""
    preview = {}
    
    # Page count
    if child_assets is not None:
        preview['page_count'] = len(child_assets)
    else:
        preview['page_count'] = asset.source_metadata.get('page_count', 0)
    
    # First page text excerpt (if available)
    if asset.text_content:
        excerpt = asset.text_content[:200].strip()
        if len(asset.text_content) > 200:
            excerpt += "..."
        preview['excerpt'] = excerpt
    
    # File size
    if asset.source_metadata.get('file_size'):
        preview['file_size'] = asset.source_metadata['file_size']
    
    return preview


def build_article_preview(asset: Asset) -> Dict[str, Any]:
    """Build rich article/web preview with excerpt and metadata."""
    preview = {}
    
    # Text excerpt
    if asset.text_content:
        excerpt = asset.text_content[:200].strip()
        if len(asset.text_content) > 200:
            excerpt += "..."
        preview['excerpt'] = excerpt
        preview['word_count'] = len(asset.text_content.split())
    
    # URL for web assets
    if asset.kind == AssetKind.WEB and asset.source_identifier:
        preview['url'] = asset.source_identifier
    
    # Published date if available
    if asset.event_timestamp:
        preview['published'] = asset.event_timestamp.isoformat()
    
    return preview


def build_bundle_preview(bundle: Bundle, assets: Optional[List[Asset]] = None) -> Dict[str, Any]:
    """
    Build rich bundle preview with content type distribution and date range.
    
    Shows what's inside without expanding.
    """
    preview = {}
    
    # Content type distribution
    if assets:
        kind_counts = Counter(asset.kind.value for asset in assets if asset.kind)
        if kind_counts:
            preview['kinds'] = dict(kind_counts.most_common())
        
        # Date range
        dates = [asset.updated_at for asset in assets if asset.updated_at]
        if dates:
            preview['date_range'] = {
                'earliest': min(dates).isoformat(),
                'latest': max(dates).isoformat()
            }
        
        # Sample titles (first 3)
        preview['sample_titles'] = [asset.title for asset in assets[:3]]
    
    # Bundle metadata
    if bundle.description:
        preview['description'] = bundle.description
    
    return preview


def enrich_node_with_preview(
    node: TreeNode, 
    entity: Asset | Bundle,
    child_entities: Optional[List[Asset | Bundle]] = None,
    include_preview: bool = True
) -> TreeNode:
    """
    Enrich a tree node with intelligent preview data.
    
    This is the temporal flow enhancement: Give UI everything it needs
    to render intelligently without additional API calls.
    """
    if not include_preview:
        return node
    
    if isinstance(entity, Bundle):
        # Bundle preview
        child_assets = [e for e in (child_entities or []) if isinstance(e, Asset)]
        node.preview = build_bundle_preview(entity, child_assets)
    
    elif isinstance(entity, Asset):
        # Asset preview based on kind
        if entity.kind == AssetKind.CSV:
            child_assets = [e for e in (child_entities or []) if isinstance(e, Asset)]
            node.preview = build_csv_preview(entity, child_assets)
        
        elif entity.kind == AssetKind.PDF:
            child_assets = [e for e in (child_entities or []) if isinstance(e, Asset)]
            node.preview = build_pdf_preview(entity, child_assets)
        
        elif entity.kind in [AssetKind.ARTICLE, AssetKind.WEB, AssetKind.TEXT]:
            node.preview = build_article_preview(entity)
    
    return node


# ============================================================================
# BUNDLE CRUD OPERATIONS
# ============================================================================

def create_bundle(
    session,
    user_id: int,
    infospace_id: int,
    name: str,
    description: Optional[str] = None,
    parent_bundle_id: Optional[int] = None
) -> Bundle:
    """
    Create a new bundle (collection).
    
    Args:
        session: Database session
        user_id: User creating the bundle
        infospace_id: Infospace ID
        name: Bundle name
        description: Optional description
        parent_bundle_id: Optional parent bundle for nesting
    
    Returns:
        Created Bundle object
    """
    bundle = Bundle(
        name=name,
        description=description,
        infospace_id=infospace_id,
        user_id=user_id,
        parent_bundle_id=parent_bundle_id,
        asset_count=0,
        child_bundle_count=0
    )
    
    session.add(bundle)
    session.flush()  # Get the ID
    
    return bundle


def add_assets_to_bundle(
    session,
    bundle_id: int,
    asset_ids: List[int],
    infospace_id: int,
    include_children: bool = True
) -> tuple[int, int]:
    """
    Add assets to a bundle.
    
    Args:
        session: Database session
        bundle_id: Bundle to add to
        asset_ids: List of asset IDs to add
        infospace_id: Infospace ID for validation
        include_children: Whether to include child assets automatically
    
    Returns:
        Tuple of (assets_added_count, children_added_count)
    """
    from sqlmodel import select
    
    bundle = session.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise ValueError(f"Bundle {bundle_id} not found")
    
    assets_added = 0
    children_added = 0
    
    for asset_id in asset_ids:
        asset = session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            continue
        
        # Set bundle_id on asset
        if asset.bundle_id != bundle_id:
            asset.bundle_id = bundle_id
            session.add(asset)
            assets_added += 1
        
        # Optionally include child assets
        if include_children and asset.is_container:
            children = session.exec(
                select(Asset).where(Asset.parent_asset_id == asset_id)
            ).all()
            
            for child in children:
                if child.bundle_id != bundle_id:
                    child.bundle_id = bundle_id
                    session.add(child)
                    children_added += 1
    
    # Update bundle asset count
    total_assets = session.exec(
        select(Asset).where(Asset.bundle_id == bundle_id)
    ).all()
    bundle.asset_count = len(total_assets)
    session.add(bundle)
    
    return assets_added, children_added


def remove_assets_from_bundle(
    session,
    bundle_id: int,
    asset_ids: List[int],
    infospace_id: int
) -> int:
    """
    Remove assets from a bundle.
    
    Args:
        session: Database session
        bundle_id: Bundle to remove from
        asset_ids: List of asset IDs to remove
        infospace_id: Infospace ID for validation
    
    Returns:
        Number of assets removed
    """
    from sqlmodel import select
    
    bundle = session.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise ValueError(f"Bundle {bundle_id} not found")
    
    removed_count = 0
    
    for asset_id in asset_ids:
        asset = session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            continue
        
        if asset.bundle_id == bundle_id:
            asset.bundle_id = None
            session.add(asset)
            removed_count += 1
    
    # Update bundle asset count
    total_assets = session.exec(
        select(Asset).where(Asset.bundle_id == bundle_id)
    ).all()
    bundle.asset_count = len(total_assets)
    session.add(bundle)
    
    return removed_count


def update_bundle(
    session,
    bundle_id: int,
    infospace_id: int,
    name: Optional[str] = None,
    description: Optional[str] = None
) -> Bundle:
    """
    Update bundle metadata.
    
    Args:
        session: Database session
        bundle_id: Bundle to update
        infospace_id: Infospace ID for validation
        name: New name (optional)
        description: New description (optional)
    
    Returns:
        Updated Bundle object
    """
    bundle = session.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise ValueError(f"Bundle {bundle_id} not found")
    
    if name is not None:
        bundle.name = name
    if description is not None:
        bundle.description = description
    
    session.add(bundle)
    
    return bundle


def delete_bundle(
    session,
    bundle_id: int,
    infospace_id: int
) -> str:
    """
    Delete a bundle (keeps assets, just removes the collection).
    
    Args:
        session: Database session
        bundle_id: Bundle to delete
        infospace_id: Infospace ID for validation
    
    Returns:
        Bundle name that was deleted
    """
    from sqlmodel import select
    
    bundle = session.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise ValueError(f"Bundle {bundle_id} not found")
    
    # Clear bundle_id from all assets
    assets = session.exec(
        select(Asset).where(Asset.bundle_id == bundle_id)
    ).all()
    
    for asset in assets:
        asset.bundle_id = None
        session.add(asset)
    
    bundle_name = bundle.name
    session.delete(bundle)
    
    return bundle_name

