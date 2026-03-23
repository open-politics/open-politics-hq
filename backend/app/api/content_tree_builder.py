"""
Tree Building Utilities
========================

Lightweight helper functions for building tree structures from assets and bundles.
No service class needed - just pure functions for formatting data.
"""

from typing import List, Dict, Set, Optional, Any
from urllib.parse import quote, unquote
from sqlalchemy import text
from sqlmodel import Session, select
from app.models import Asset, Bundle, AssetKind, Source, Flow, FlowStatus, Task, TaskStatus, IngestionJob, IngestionStatus
from app.schemas import TreeNode, TreeNodeType
from collections import Counter
from datetime import datetime, timezone


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
        
        # Query active IngestionJobs populating this bundle
        active_jobs = session.exec(
            select(IngestionJob)
            .where(IngestionJob.root_bundle_id == bundle.id)
            .where(IngestionJob.status.in_([
                IngestionStatus.PENDING,
                IngestionStatus.DOWNLOADING,
                IngestionStatus.EXTRACTING,
                IngestionStatus.PROCESSING
            ]))
        ).all()
        node.has_active_jobs = len(active_jobs) > 0
        node.active_job_count = len(active_jobs)
        
        # If there's an active job, add its progress to node metadata
        if active_jobs:
            job = active_jobs[0]  # Show first active job
            node.job_status = {
                'status': job.status.value,
                'stage': job.cursor_state.get('stage', 'processing'),
                'message': job.cursor_state.get('message', 'Processing...'),
                'progress_pct': job.cursor_state.get('progress_pct', 0),
                'processed_files': job.processed_files,
                'total_files': job.total_files
            }
    
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
    
    # Include facets and file_info for CSV rows (needed for table rendering)
    facets = None
    file_info = None
    if asset.kind and asset.kind.value == 'csv_row':
        facets = asset.facets
        file_info = asset.file_info
    
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
        facets=facets,
        file_info=file_info,
    )


def get_bundled_asset_ids(bundles: List[Bundle], session: Optional[Session] = None) -> Set[int]:
    """
    Extract all asset IDs that are contained in the given bundles.

    Returns a set of asset IDs for efficient lookup.
    Requires a session to query via the bundle_ids array column.
    """
    if not bundles or not session:
        return set()
    bundle_id_list = [b.id for b in bundles]
    rows = session.execute(
        text("SELECT id FROM asset WHERE bundle_ids && ARRAY[:bids]::int[]"),
        {"bids": bundle_id_list},
    ).all()
    return {r[0] for r in rows}


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


def make_vfolder_node_id(bundle_id: int, path_prefix: str) -> str:
    """Encode bundle_id and path_prefix for virtual folder node ID.
    Uses URL-encoding for path to handle |, __, and other special chars in filenames.
    """
    encoded = quote(path_prefix, safe="")
    return f"vfolder-{bundle_id}__{encoded}"


def build_tree_node_from_vfolder(
    bundle_id: int,
    path_prefix: str,
    folder_name: str,
) -> TreeNode:
    """Build TreeNode for a virtual folder (derived from logical_path)."""
    new_prefix = f"{path_prefix}/{folder_name}" if path_prefix else folder_name
    return TreeNode(
        id=make_vfolder_node_id(bundle_id, new_prefix),
        type=TreeNodeType.VIRTUAL_FOLDER,
        name=folder_name,
        path_prefix=new_prefix,
        has_children=True,
        updated_at=datetime.now(timezone.utc),
    )


def parse_tree_node_id(node_id: str) -> tuple[str, int]:
    """
    Parse a tree node ID string into type and numeric ID.
    
    Args:
        node_id: Format "bundle-123", "asset-456", or "vfolder-123" / "vfolder-123__path|to|folder"
    
    Returns:
        Tuple of (type_str, numeric_id). For vfolder, use parse_vfolder_node_id for path_prefix.
        
    Raises:
        ValueError: If format is invalid
    """
    try:
        if node_id.startswith("vfolder-"):
            rest = node_id[8:]
            numeric_id = int(rest.split("__")[0])
            return "vfolder", numeric_id

        type_str, id_str = node_id.split('-', 1)
        numeric_id = int(id_str)
        
        if type_str not in ['bundle', 'asset']:
            raise ValueError(f"Invalid node type: {type_str}")
        
        return type_str, numeric_id
    except (ValueError, AttributeError) as e:
        raise ValueError(f"Invalid tree node ID format '{node_id}': {e}")


def parse_vfolder_node_id(node_id: str) -> tuple[int, str]:
    """
    Parse a virtual folder node ID into bundle_id and path_prefix.
    
    Args:
        node_id: Format "vfolder-123__urlencoded_path" (path is URL-encoded)
    
    Returns:
        Tuple of (bundle_id, path_prefix with slashes)
    """
    if not node_id.startswith("vfolder-"):
        raise ValueError(f"Invalid vfolder node ID: {node_id}")
    parts = node_id.split("__", 1)
    bundle_id = int(parts[0].split("-")[1])  # "vfolder-123" -> 123
    path_prefix = unquote(parts[1]) if len(parts) > 1 else ""
    return bundle_id, path_prefix


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
    
    # Extract column headers from file_info
    columns = (asset.file_info or {}).get('columns', [])
    
    # Fallback: extract from first child row if parent doesn't have columns
    if not columns and child_assets and len(child_assets) > 0:
        first_child = child_assets[0]
        # Try column_headers field (from for_csv_row builder)
        columns = (first_child.file_info or {}).get('column_headers', [])
        # Or extract from original_row_data keys
        if not columns:
            row_data = (first_child.file_info or {}).get('original_row_data', {})
            if row_data:
                columns = list(row_data.keys())
    
    if columns:
        preview['columns'] = columns
        preview['column_count'] = len(columns)
    
    # Row count - always use the actual total from parent asset metadata
    total_rows = (asset.file_info or {}).get('row_count', 0)
    if total_rows:
        preview['row_count'] = total_rows
    elif child_assets is not None:
        # Only use child count if no metadata available
        preview['row_count'] = len(child_assets)
    
    # Sample rows (first 5 from loaded children) - ALWAYS include if children available
    if child_assets and len(child_assets) > 0:
        sample_rows = []
        for child in child_assets[:5]:  # Increased from 3 to 5 for better preview
            row_data = (child.file_info or {}).get('original_row_data', {})
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
        preview['page_count'] = (asset.file_info or {}).get('page_count', 0)
    
    # First page text excerpt (if available)
    if asset.text_content:
        excerpt = asset.text_content[:200].strip()
        if len(asset.text_content) > 200:
            excerpt += "..."
        preview['excerpt'] = excerpt
    
    # File size
    if (asset.file_info or {}).get('file_size'):
        preview['file_size'] = asset.file_info['file_size']
    
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
    
    # URL when source_identifier is present (typically WEB assets)
    if asset.source_identifier and str(asset.source_identifier).startswith(("http://", "https://")):
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
        # Asset preview from registry (descriptor.preview_builder_name)
        from app.api.modules.content.types import get_content_type_registry
        registry = get_content_type_registry()
        desc = registry.by_kind(entity.kind)
        builder = registry.get_preview_builder(entity.kind) if desc else None
        if builder:
            # "article" builder takes asset only; "csv"/"pdf" take (asset, child_assets)
            if desc and desc.preview_builder_name == "article":
                node.preview = builder(entity)
            else:
                child_assets = [e for e in (child_entities or []) if isinstance(e, Asset)]
                node.preview = builder(entity, child_assets)
    
    return node

