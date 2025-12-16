"""
FastMCP Intelligence Analysis Server
====================================

Clean, production-ready MCP server implementing efficient content separation patterns.

DESIGN PATTERNS
---------------
1. **ToolResult with Dual Content Streams**
   - Traditional content: concise summaries (~200-500 chars)
   - Structured content: full rich data for frontend rendering

2. **XML Marker Pattern for Results**
   - Model writes: `<tool_results id="exec_123" format="default" />`
   - System expands marker with formatted output from structured_content

3. **Preview Truncation**
   - Asset `text_content`: max 500 chars in responses
   - Search snippets stay short; full text lives in structured_content

4. **Web Research Pipeline**
   - Single call: `web_research(query="...", ingest_top_k=3, bundle_id=5)`
   - Or two-phase: search → review → `web_research(ingest_urls=[...])`

TOOL FAMILIES
-------------
- `workspace_hub`: tree/list/search + semantic search
- `web_research`: live search with optional ingestion
- `library_hub`: asset & collection (bundle) CRUD
- `analysis_hub`: schemas, runs, dashboards, sharing
- `tasks`: conversation-scoped planning (batch required)
- `working_memory`: scratchpad for assets/findings/paths

ADDING NEW TOOLS
----------------
1. Always return `ToolResult`
2. Keep summaries tight; stash full payload in `structured_content`
3. Document parameters with `Annotated[...]`
4. Follow verb_noun naming (e.g., `search_assets`, `create_bundle`)
5. Slot the tool into the appropriate family above
"""


import logging
from typing import List, Optional, Any, Dict, Union, Tuple
from datetime import datetime, timezone
from fastmcp import FastMCP, Context
from fastmcp.tools.tool import ToolResult
from mcp.types import TextContent

from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings
from app.api.providers.factory import create_storage_provider, create_model_registry
from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.models import Asset, AssetKind, Infospace
from app.schemas import (
    AnnotationRunCreate, AssetRead, AnnotationRead, 
    AnnotationSchemaRead, BundleRead, SearchResult
)
from app.core import security
from fastmcp.server.auth import JWTVerifier
from fastmcp.server.dependencies import get_access_token, AccessToken
from contextlib import contextmanager
from typing import Annotated
from pydantic import Field

logger = logging.getLogger(__name__)


# ============================================================================
# AUTHENTICATION & SERVER SETUP
# ============================================================================

jwt_verifier = JWTVerifier(
    public_key=settings.SECRET_KEY,
    algorithm=security.ALGORITHM,
)

mcp = FastMCP(
    "Intelligence Analysis Server",
    auth=jwt_verifier
)


# ============================================================================
# SERVICE CONTEXT MANAGER
# ============================================================================

@contextmanager
def get_services():
    """
    Provide authenticated service instances for current request context.
    
    Services are initialized per-request with user/infospace context from JWT.
    This ensures proper access control and resource isolation.
    """
    access_token: AccessToken = get_access_token()
    
    if not access_token or not access_token.claims:
        raise PermissionError("Authentication required")
    
    user_id = int(access_token.claims.get("sub"))
    infospace_id = access_token.claims.get("infospace_id")
    conversation_id = access_token.claims.get("conversation_id")  # Optional conversation ID
    model_name = access_token.claims.get("model_name")  # Chat's selected model for annotation runs

    if not user_id or not infospace_id:
        raise PermissionError("Invalid authentication token")
    
    # Initialize database session
    from app.core.db import engine
    from sqlmodel import Session
    from app.models import User
        
    session = Session(engine)
    
    try:
        # Initialize core services
        storage_provider = create_storage_provider(settings)
        asset_service = AssetService(session, storage_provider)
        model_registry = create_model_registry(settings)
        annotation_service = AnnotationService(session, model_registry, asset_service)
        content_ingestion_service = ContentIngestionService(session)
        
        # Retrieve user's stored API keys (no runtime keys in JWT anymore)
        user = session.get(User, user_id)
        api_keys = {}
        if user and user.encrypted_credentials:
            api_keys = security.decrypt_credentials(user.encrypted_credentials)
                
        yield {
            "session": session,
            "user_id": user_id,
            "infospace_id": infospace_id,
            "conversation_id": conversation_id,  # Pass conversation ID to tools
            "model_name": model_name,  # Chat's model for annotation runs
            "runtime_api_keys": api_keys,  # Use stored API keys from database
            "asset_service": asset_service,
            "annotation_service": annotation_service,
            "content_ingestion_service": content_ingestion_service,
        }
    finally:
        session.close()


# ============================================================================
# FORMATTING HELPERS
# ============================================================================

def truncate_text(text: str, max_length: int = 500) -> str:
    """Truncate text to max_length, adding ellipsis if truncated."""
    if not text:
        return ""
    if len(text) <= max_length:
        return text
    return text[:max_length].rstrip() + "..."


def format_asset_preview(asset: Any, preview_length: int = 200) -> str:
    """
    Format a single asset as a concise preview for model context.
    
    Returns: "ID: 123 | Title: Document Name | Preview: Text content..."
    """
    preview = truncate_text(asset.text_content or "", preview_length)
    return f"ID: {asset.id} | {asset.title} | Preview: {preview}"


def format_search_summary(results: List[dict], query: str, max_items: int = 5) -> str:
    """
    Format search results as concise summary for model.
    
    Returns XML marker + brief list of top results.
    """
    lines = [f"Found {len(results)} results for '{query}':\n"]
    
    for i, result in enumerate(results[:max_items], 1):
        lines.append(f"{i}. {result['title']}")
        lines.append(f"   URL: {result['url']}")
        if result.get('score'):
            lines.append(f"   Relevance: {int(result['score'] * 100)}%")
        lines.append("")
    
    if len(results) > max_items:
        lines.append(f"... and {len(results) - max_items} more results")
    
    return "\n".join(lines)


def format_asset_list_summary(assets: List[Any], query: str = "", max_items: int = 5) -> str:
    """
    Format list of assets as concise summary for model.
    
    Returns brief list with IDs, titles, and short previews.
    """
    header = f"Found {len(assets)} assets"
    if query:
        header += f" matching '{query}'"
    
    lines = [header + ":\n"]
    
    for i, asset in enumerate(assets[:max_items], 1):
        preview = truncate_text(asset.text_content or "", 100)
        lines.append(f"{i}. [{asset.id}] {asset.title}")
        if preview:
            lines.append(f"   {preview}")
        lines.append("")
    
    if len(assets) > max_items:
        lines.append(f"... and {len(assets) - max_items} more assets (use their IDs to get details)")
    
    return "\n".join(lines)


def format_bundle_summary(bundles: List[Any]) -> str:
    """Format list of bundles as concise summary for model context."""
    if not bundles:
        return "No bundles found in this infospace."
    
    return f"Found {len(bundles)} bundle{'' if len(bundles) == 1 else 's'} in your infospace."


def _extract_fields_from_output_contract(output_contract: Dict[str, Any]) -> List[Dict[str, str]]:
    """Extract field information from output_contract JSON schema dict."""
    fields = []
    
    if not output_contract or not isinstance(output_contract, dict):
        return fields
    
    # Handle JSON schema format: {"type": "object", "properties": {...}}
    properties = output_contract.get("properties", {})
    if not properties:
        return fields
    
    def extract_from_properties(props: Dict[str, Any], prefix: str = "") -> None:
        """Recursively extract fields from properties dict."""
        for key, value in props.items():
            if not isinstance(value, dict):
                continue
            
            field_name = f"{prefix}.{key}" if prefix else key
            field_type = value.get("type", "unknown")
            field_description = value.get("description", "")
            
            # Add this field
            if field_type in ["string", "integer", "number", "boolean", "array"]:
                fields.append({
                    "name": field_name,
                    "type": field_type,
                    "description": field_description
                })
            
            # Recurse into nested object properties
            if value.get("type") == "object" and value.get("properties"):
                extract_from_properties(value["properties"], field_name)
            
            # Handle array of objects (per-modality patterns)
            if value.get("type") == "array" and value.get("items", {}).get("type") == "object":
                items_props = value.get("items", {}).get("properties", {})
                if items_props:
                    extract_from_properties(items_props, field_name)
    
    # Extract from hierarchical structure (document, per_*)
    if "document" in properties and isinstance(properties["document"], dict):
        doc_props = properties["document"].get("properties", {})
        if doc_props:
            extract_from_properties(doc_props, "document")
    
    # Extract from per-modality fields (per_image, per_audio, etc.)
    for key, value in properties.items():
        if key.startswith("per_") and isinstance(value, dict):
            if value.get("type") == "array" and value.get("items", {}).get("type") == "object":
                items_props = value.get("items", {}).get("properties", {})
                if items_props:
                    extract_from_properties(items_props, key)
    
    # If no hierarchical structure found, extract from flat properties
    if not fields:
        extract_from_properties(properties)
    
    return fields


def format_schema_summary(schemas: List[Any]) -> str:
    """Format list of annotation schemas as concise summary."""
    if not schemas:
        return "No annotation schemas found in this infospace."
    
    lines = [f"Found {len(schemas)} annotation schemas:\n"]
    
    for schema in schemas:
        lines.append(f"• [{schema.id}] {schema.name} (v{schema.version})")
        if schema.description:
            lines.append(f"  {truncate_text(schema.description, 100)}")
        
        # Extract fields from output_contract (handles both dict and object formats)
        output_contract = schema.output_contract
        if isinstance(output_contract, dict):
            fields = _extract_fields_from_output_contract(output_contract)
        elif hasattr(output_contract, 'fields'):
            # Legacy format with OutputContract object
            fields = [
                {"name": f.name, "type": f.type, "description": getattr(f, 'description', '')}
                for f in output_contract.fields
            ]
        else:
            fields = []
        
        if fields:
            field_descriptions = [
                f"  {field['name']}: {field['description']}" if field.get('description') 
                else f"  {field['name']} ({field.get('type', 'unknown')})"
                for field in fields[:10]  # Limit to first 10 fields
            ]
            lines.append("  Fields:")
            lines.extend(field_descriptions)
            if len(fields) > 10:
                lines.append(f"  ... and {len(fields) - 10} more fields")
        else:
            lines.append("  (No fields defined)")
        
        lines.append("")
    
    return "\n".join(lines)


# ============================================================================
# CATEGORY: NAVIGATION & DISCOVERY
# ============================================================================

@mcp.tool(tags=["workspace", "navigation", "search"])
async def workspace_hub(
    ctx: Context,
    mode: Annotated[str, "Action: 'tree' (browse structure), 'view' (see children/content), 'search' (keyword), 'semantic' (concept search), 'load' (fetch by ID), 'open' (open asset in detail view)"] = "tree",
    query: Annotated[Optional[str], "Search query (for search/semantic modes)"] = None,
    node_id: Annotated[Optional[str], "Target ID for view mode (e.g. 'bundle-123', 'asset-456')"] = None,
    ids: Annotated[Optional[List[int]], "Asset IDs to load (for load mode)"] = None,
    asset_id: Annotated[Optional[int], "Asset ID to open (for open mode)"] = None,
    depth: Annotated[str, "Detail level: 'tree' (structure), 'titles' (metadata), 'previews' (recommended), 'full' (complete content)"] = "previews",
    resource: Annotated[Optional[str], "Override target: 'files' (bundles) or 'assets' (documents). Auto-detected by mode if omitted."] = None,
    semantic_queries: Annotated[Optional[List[str]], "Multiple angles for semantic search"] = None,
    search_method: Annotated[str, "Search approach: 'hybrid', 'semantic', 'text'"] = "hybrid",
    filters: Annotated[Optional[Dict[str, Any]], "Filters: {'asset_kinds': ['pdf'], 'bundle_id': 123, 'parent_asset_id': 456}"] = None,
    limit: Annotated[Optional[int], "Max items to return"] = None,
    offset: Annotated[int, "Pagination offset"] = 0,
    combine_results: Annotated[bool, "Deduplicate semantic results"] = True,
) -> ToolResult:
    """
    Unified workspace explorer. Browse, search, and load content.
    
    <quick_start>
    • Browse: workspace_hub() or workspace_hub(mode="view", node_id="bundle-123")
    • Search: workspace_hub(mode="search", query="budget report")
    • Semantic: workspace_hub(mode="semantic", query="implications of tax changes")
    • Load: workspace_hub(mode="load", ids=[123], depth="full")
    • Open: workspace_hub(mode="open", asset_id=123) - opens asset in detail panel
    </quick_start>
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"],
            services["infospace_id"],
            services["user_id"]
        )
        
        # Auto-detect resource if not specified
        if not resource:
            if mode in ["search", "semantic", "load"]:
                resource = "assets"
            else:
                resource = "files"
                
        # Extract convenient filter args if passed in filters dict
        asset_kinds = filters.get("asset_kinds") if filters else None
        bundle_id = filters.get("bundle_id") if filters else None
        parent_asset_id = filters.get("parent_asset_id") if filters else None
        date_from = filters.get("date_from") if filters else None
        date_to = filters.get("date_to") if filters else None

        await ctx.info(f"Hub: mode={mode}, resource={resource}, query={query}")
        
        # BUDGET PROTECTION: Interactive elicitation for expensive depth='full' operations on large containers
        if depth == "full" and mode == "load" and ids:
            from app.models import Asset
            from sqlmodel import select
            for asset_id in ids:
                asset = services["session"].get(Asset, asset_id)
                if asset and asset.infospace_id == services["infospace_id"] and asset.is_container:
                    # Query child count (Asset doesn't have child_asset_count attribute)
                    child_count = len(services["session"].exec(
                        select(Asset.id).where(Asset.parent_asset_id == asset_id)
                    ).all())
                    if child_count > 20:  # Conservative budget limit
                        estimated_tokens = child_count * 125  # Rough estimate
                        
                        await ctx.info(f"⚠️ Budget protection: Asset {asset_id} has {child_count} children")
                        
                        # Request user choice via elicitation
                        try:
                            response = await ctx.request_elicitation(
                                message=f"📊 Budget Check: Asset {asset_id} ({asset.title}) has {child_count} children (≈{estimated_tokens:,} tokens).\n\n"
                                        f"How would you like to proceed?\n"
                                        f"• preview: Quick look at structure (first 5-10 items, ≈400 tokens)\n"
                                        f"• paginate: Load in batches (specify batch_size, ≈125 tokens per item)\n"
                                        f"• search: Query-based access (provide search_query)\n"
                                        f"• cancel: Skip this operation",
                                schema={
                                    "type": "object",
                                    "properties": {
                                        "choice": {
                                            "type": "string",
                                            "enum": ["preview", "paginate", "search", "cancel"],
                                            "description": "How to access this large dataset"
                                        },
                                        "batch_size": {
                                            "type": "integer",
                                            "description": "For paginate: how many items per batch (default 50)",
                                            "default": 50,
                                            "minimum": 10,
                                            "maximum": 100
                                        },
                                        "search_query": {
                                            "type": "string",
                                            "description": "For search: what to search for within this container"
                                        }
                                    },
                                    "required": ["choice"]
                                }
                            )
                            
                            # Handle user's choice
                            choice = response.get("choice")
                            
                            if choice == "preview":
                                await ctx.info(f"User chose: preview (first 5-10 items)")
                                return await _navigate_tree_expand(services, ctx, f"asset-{asset_id}", 10, 0)
                            
                            elif choice == "paginate":
                                batch_size = response.get("batch_size", 50)
                                await ctx.info(f"User chose: paginate (batch_size={batch_size})")
                                # Execute paginated load
                                return await _navigate_assets(
                                    services, ctx, "list", "previews", 
                                    None, None, "hybrid", 
                                    {"parent_asset_id": asset_id}, 
                                    batch_size, 0
                                )
                            
                            elif choice == "search":
                                search_query = response.get("search_query", "")
                                if not search_query:
                                    return ToolResult(
                                        content=[TextContent(type="text", text="❌ Search query is required for search option")],
                                        structured_content={"error": "search_query_required"}
                                    )
                                await ctx.info(f"User chose: search (query='{search_query}')")
                                # Execute search within container
                                return await _navigate_assets(
                                    services, ctx, "search", "previews",
                                    None, search_query, "hybrid",
                                    {"parent_asset_id": asset_id},
                                    30, 0
                                )
                            
                            else:  # cancel
                                await ctx.info(f"User chose: cancel")
                                return ToolResult(
                                    content=[TextContent(type="text", text="❌ Operation cancelled by user")],
                                    structured_content={"status": "cancelled", "reason": "user_request"}
                                )
                        
                        except Exception as e:
                            # Fallback to blocking error if elicitation fails
                            logger.warning(f"Elicitation failed, falling back to blocking error: {e}")
                            return ToolResult(
                                content=[TextContent(
                                    type="text",
                                    text=f"⚠️ Budget Protection Active\n\n"
                                         f"Asset {asset_id} ({asset.title}) is a container with {child_count} children.\n"
                                         f"Loading with depth='full' would use approximately {estimated_tokens:,} tokens.\n\n"
                                         f"📊 Recommended alternatives:\n\n"
                                         f"1. Quick preview:\n"
                                         f"   workspace_hub(mode='view', node_id='asset-{asset_id}')\n\n"
                                         f"2. Paginated access:\n"
                                         f"   workspace_hub(resource='assets', mode='list', \n"
                                         f"                 filters={{'parent_asset_id': {asset_id}}}, \n"
                                         f"                 limit=50, offset=0)\n\n"
                                         f"3. Query-based access:\n"
                                         f"   workspace_hub(mode='semantic', parent_asset_id={asset_id}, \n"
                                         f"                 query='your search terms', limit=20)"
                                )],
                                structured_content={
                                    "error": "budget_protection_activated",
                                    "reason": "container_too_large",
                                    "asset_id": asset_id,
                                    "asset_title": asset.title,
                                    "child_count": child_count,
                                    "estimated_tokens": estimated_tokens
                                }
                            )
        
        # Apply context-aware default limits if not specified
        effective_limit = limit
        if effective_limit is None:
            if mode in ["view", "expand"]:
                # Will be refined in _navigate_tree_expand based on node type
                effective_limit = 10  # Default for bundles/containers
            elif mode == "list":
                effective_limit = 50
            elif mode == "search":
                effective_limit = 30
            elif mode == "semantic":
                effective_limit = 10
            else:
                effective_limit = 20  # tree/load default
        
        effective_filters = dict(filters or {})
        if asset_kinds:
            effective_filters["asset_kinds"] = asset_kinds
        if bundle_id and "bundle_id" not in effective_filters:
            effective_filters["bundle_id"] = bundle_id
        if parent_asset_id and "parent_asset_id" not in effective_filters:
            effective_filters["parent_asset_id"] = parent_asset_id
        
        if mode == "semantic":
            query_list = semantic_queries or ([query] if query else None)
            if not query_list:
                return ToolResult(
                    content=[TextContent(type="text", text="Provide 'query' or 'semantic_queries' when mode='semantic'.")],
                    structured_content={"error": "missing_semantic_query"}
                )
            
            return await _workspace_semantic_search(
                services=services,
                ctx=ctx,
                queries=query_list,
                limit=effective_limit or 10,
                asset_kinds=asset_kinds,
                bundle_id=bundle_id,
                parent_asset_id=parent_asset_id,
                date_from=date_from,
                date_to=date_to,
                combine_results=combine_results
            )
        
        # Open mode - returns a navigate-like result that auto-opens in the detail panel
        if mode == "open":
            target_asset_id = asset_id
            # Also support extracting from node_id format
            if not target_asset_id and node_id:
                if node_id.startswith("asset-"):
                    try:
                        target_asset_id = int(node_id.split("-")[1])
                    except (ValueError, IndexError):
                        pass
            # Or from ids list
            if not target_asset_id and ids and len(ids) > 0:
                target_asset_id = ids[0]
                
            if not target_asset_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ asset_id is required for open mode. Use: workspace_hub(mode='open', asset_id=123)")],
                    structured_content={"error": "asset_id_required"}
                )
            
            # Fetch asset info
            from app.models import Asset
            asset = services["session"].get(Asset, target_asset_id)
            if not asset or asset.infospace_id != services["infospace_id"]:
                return ToolResult(
                    content=[TextContent(type="text", text=f"❌ Asset {target_asset_id} not found in this infospace")],
                    structured_content={"error": "asset_not_found", "asset_id": target_asset_id}
                )
            
            await ctx.info(f"Opening asset {target_asset_id}: {asset.title}")
            
            # Return navigate-like structure with auto_open flag
            # This lets the existing ConversationalAssetExplorer render it AND auto-open
            return ToolResult(
                content=[TextContent(type="text", text=f"📂 Opening: {asset.title}")],
                structured_content={
                    "resource": "assets",
                    "mode": "open",
                    "auto_open": True,
                    "total": 1,
                    "nodes": [{
                        "id": f"asset-{target_asset_id}",
                        "asset_id": target_asset_id,
                        "type": "asset",
                        "name": asset.title,
                        "kind": asset.kind.value if asset.kind else "text",
                    }]
                }
            )
        
        # Tree mode is the default and most efficient way to browse
        if mode == "tree" or (resource == "files" and mode not in ["search", "view", "expand", "open"]):
            return await _navigate_tree_root(services, ctx)
        elif mode in ["view", "expand"]:  # Support both for backward compatibility
            if not node_id:
                return ToolResult(
                    content=[TextContent(type="text", text="node_id is required for view mode")],
                    structured_content={"error": "node_id required"}
                )
            return await _navigate_tree_expand(services, ctx, node_id, effective_limit, offset)
        
        # Route to resource-specific handlers
        if resource == "assets":
            return await _navigate_assets(services, ctx, mode, depth, ids, query, search_method, effective_filters, effective_limit, offset)
        elif resource == "files":
            # Default to tree mode
            return await _navigate_tree_root(services, ctx)
        else:
            # Unsupported resources: bundles (use tree), schemas (use annotation UI), runs (use annotation UI)
            return ToolResult(
                content=[TextContent(type="text", text=f"Resource '{resource}' not supported. Use workspace_hub() for files/bundles, or the annotation UI for schemas/runs.")],
                structured_content={
                    "error": f"unsupported resource: {resource}",
                    "hint": "Use workspace_hub() for tree view, workspace_hub(mode='view', node_id='...') to explore"
                }
            )


async def _navigate_tree_root(services: Dict, ctx: Context) -> ToolResult:
    """Navigate tree root - shows hierarchical structure of bundles and standalone assets."""
    from sqlmodel import select
    from app.models import Asset, Bundle
    from app.api.utils.tree_builder import build_root_tree_nodes, get_bundled_asset_ids
    
    # Get root bundles (no parent)
    root_bundles = services["session"].exec(
        select(Bundle)
        .where(Bundle.infospace_id == services["infospace_id"])
        .where(Bundle.parent_bundle_id.is_(None))
        .order_by(Bundle.name)
    ).all()
    
    await ctx.info(f"Found {len(root_bundles)} root bundles")
    
    # Get all bundled asset IDs to exclude from root assets
    all_bundles = services["session"].exec(
        select(Bundle).where(Bundle.infospace_id == services["infospace_id"])
    ).all()
    all_bundled_ids = get_bundled_asset_ids(all_bundles)
    
    # Get root assets (not in any bundle, no parent)
    root_assets_query = (
        select(Asset)
        .where(Asset.infospace_id == services["infospace_id"])
        .where(Asset.parent_asset_id.is_(None))
        .where(Asset.user_id == services["user_id"])
        .order_by(Asset.updated_at.desc())
    )
    
    if all_bundled_ids:
        root_assets_query = root_assets_query.where(Asset.id.not_in(all_bundled_ids))
    
    root_assets = services["session"].exec(root_assets_query).all()
    
    await ctx.info(f"Found {len(root_assets)} root assets")
    
    # Build tree structure
    tree_nodes = build_root_tree_nodes(root_bundles, root_assets, services["session"])
    
    # At root level: NO enrichment (strict lazy-loading)
    # Tree nodes already have basic metadata from build_root_tree_nodes:
    # - Bundles: name, item count
    # - Assets: name, kind, is_container flag
    # 
    # Internal structure (bundle contents, CSV columns, etc.) only revealed on explicit view
    # This keeps root navigation fast and prevents information leakage
    tree_nodes = tree_nodes  # Use as-is, no enrichment
    
    # Build concise summary for model
    summary_lines = [f"📁 Workspace structure ({len(tree_nodes)} items):\n"]
    
    for node in tree_nodes[:10]:
        node_data = node if isinstance(node, dict) else node.model_dump()
        node_type = node_data.get("type")
        node_id = node_data.get("id")
        node_name = node_data.get("name")
        preview = node_data.get("preview")
        
        if node_type == "bundle":
            children_count = node_data.get("children_count", 0)
            summary_lines.append(f"📦 {node_id} | {node_name} ({children_count} items)")
        else:
            kind = node_data.get("kind", "unknown")
            # At root level: Show file type and basic info only
            # Don't reveal internal structure (columns, etc.) - user must view to see that
            is_container = node_data.get("is_container", False)
            container_marker = " 📁" if is_container else ""
            
            if kind == "csv" and preview and preview.get("row_count"):
                summary_lines.append(f"📊 {node_id} | {node_name} ({preview.get('row_count', 0)} rows){container_marker}")
            else:
                summary_lines.append(f"📄 {node_id} | {node_name} ({kind}){container_marker}")
    
    if len(tree_nodes) > 10:
        summary_lines.append(f"\n... {len(tree_nodes) - 10} more items")
    
    summary_lines.append(f"\n💡 Use workspace_hub(mode='view', node_id='bundle-X') to look inside a bundle")
    summary_lines.append(f"💡 Use workspace_hub(mode='view', node_id='asset-Y') to preview a CSV's data")
    
    # Convert nodes to dicts for structured_content
    nodes_data = []
    for node in tree_nodes:
        if isinstance(node, dict):
            nodes_data.append(node)
        else:
            nodes_data.append(node.model_dump())
    
    summary_text = "\n".join(summary_lines)
    return ToolResult(
        content=[TextContent(type="text", text=summary_text)],
        structured_content={
            "resource": "files",
            "mode": "tree",
            "nodes": nodes_data,
            "total_nodes": len(tree_nodes),
            "message": summary_text,  # Full summary for frontend
            "summary": summary_text
        }
    )


async def _navigate_tree_expand(services: Dict, ctx: Context, node_id: str, 
                                limit: int, offset: int) -> ToolResult:
    """
    View a tree node's contents (preview mode).
    
    Context-aware limits:
    - CSV rows: 5 (df.head() style)
    - Bundles/containers: limit parameter (typically 10)
    """
    from app.api.utils.tree_builder import (
        parse_tree_node_id, 
        build_bundle_children_nodes, 
        build_asset_children_nodes,
        enrich_node_with_preview,
        build_tree_node_from_asset
    )
    from sqlmodel import select
    from app.models import Asset, Bundle
    
    # Parse node ID
    try:
        node_type, node_numeric_id = parse_tree_node_id(node_id)
    except ValueError as e:
        return ToolResult(
            content=[TextContent(type="text", text=f"Invalid node_id format: {str(e)}")],
            structured_content={"error": str(e)}
        )
    
    await ctx.info(f"Viewing {node_type}-{node_numeric_id}")
    
    children_nodes = []
    parent_entity = None  # For enrichment
    parent_preview = None  # For CSV/container metadata
    
    if node_type == "bundle":
        # Get the bundle
        bundle = services["session"].get(Bundle, node_numeric_id)
        if not bundle or bundle.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"Bundle {node_numeric_id} not found")],
                structured_content={"error": "bundle not found"}
            )
        
        parent_entity = bundle
        
        # Get child bundles
        child_bundles = services["session"].exec(
            select(Bundle)
            .where(Bundle.parent_bundle_id == node_numeric_id)
            .order_by(Bundle.name)
            .offset(offset)
            .limit(limit)
        ).all()
        
        # Get assets in bundle
        remaining_limit = limit - len(child_bundles)
        asset_skip = max(0, offset - (bundle.child_bundle_count or 0))
        
        bundle_assets = []
        if remaining_limit > 0:
            all_bundle_assets = bundle.assets
            bundle_assets = all_bundle_assets[asset_skip:asset_skip + remaining_limit]
        
        # Build nodes
        children_nodes = build_bundle_children_nodes(bundle, child_bundles, bundle_assets, services["session"])
        
        # Enrich each node with preview data
        for i, node in enumerate(children_nodes):
            if i < len(child_bundles):
                # Bundle node
                entity = child_bundles[i]
                children_nodes[i] = enrich_node_with_preview(node, entity, entity.assets)
            else:
                # Asset node
                asset_idx = i - len(child_bundles)
                if asset_idx < len(bundle_assets):
                    entity = bundle_assets[asset_idx]
                    # For container assets, fetch children for preview
                    if entity.is_container:
                        asset_children = services["session"].exec(
                            select(Asset)
                            .where(Asset.parent_asset_id == entity.id)
                            .order_by(Asset.part_index, Asset.created_at)
                            .limit(10)  # First 10 for preview
                        ).all()
                        children_nodes[i] = enrich_node_with_preview(node, entity, asset_children)
                    else:
                        children_nodes[i] = enrich_node_with_preview(node, entity)
        
        await ctx.info(f"Expanded bundle {node_numeric_id}: {len(children_nodes)} children")
        
    elif node_type == "asset":
        # Get the asset
        asset = services["session"].get(Asset, node_numeric_id)
        if not asset or asset.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"Asset {node_numeric_id} not found")],
                structured_content={"error": "asset not found"}
            )
        
        parent_entity = asset
        
        if not asset.is_container:
            return ToolResult(
                content=[TextContent(type="text", text=f"Asset {node_numeric_id} has no children")],
                structured_content={"message": "no children"}
            )
        
        # Apply CSV-specific limit (df.head() style: 5 rows)
        is_csv = asset.kind and asset.kind.value == 'csv'
        effective_asset_limit = 5 if is_csv else limit
        
        # Get child assets
        child_assets = services["session"].exec(
            select(Asset)
            .where(Asset.parent_asset_id == node_numeric_id)
            .order_by(Asset.part_index, Asset.created_at)
            .offset(offset)
            .limit(effective_asset_limit)
        ).all()
        
        # Build nodes
        children_nodes = build_asset_children_nodes(asset, child_assets)
        
        # Enrich with CSV preview if this is a CSV
        if is_csv:
            # Get CSV preview with column headers to pass to frontend
            parent_preview = enrich_node_with_preview(
                build_tree_node_from_asset(asset),
                asset,
                child_assets
            ).preview
        
        await ctx.info(f"Viewing asset {node_numeric_id}: {len(children_nodes)} children (CSV preview)" if is_csv else f"Viewing asset {node_numeric_id}: {len(children_nodes)} children")
    
    else:
        return ToolResult(
            content=[TextContent(type="text", text=f"Invalid node type: {node_type}")],
            structured_content={"error": f"invalid node type: {node_type}"}
        )
    
    # Build summary with intelligent preview info
    summary_lines = []
    
    # For CSV assets, show structure PROMINENTLY at top with ASCII table
    if node_type == "asset" and parent_entity and parent_entity.kind and parent_entity.kind.value == 'csv':
        columns = parent_entity.source_metadata.get('columns', [])
        total_row_count = parent_preview.get('row_count') if parent_preview else None
        
        if columns and parent_preview and parent_preview.get('sample_rows'):
            from app.api.utils.tree_builder import format_csv_as_table
            
            sample_rows = parent_preview['sample_rows']
            
            # Show total row count if available
            if total_row_count and total_row_count > len(children_nodes):
                summary_lines.append(f"📊 CSV Preview: {len(columns)} columns × {total_row_count} total rows (showing first {len(children_nodes)})\n")
            else:
                summary_lines.append(f"📊 CSV: {len(columns)} columns × {len(children_nodes)} rows\n")
            
            summary_lines.append(format_csv_as_table(columns, sample_rows[:5]))
            summary_lines.append("")  # Blank line
            
            # Hint about pagination if there are more rows
            if total_row_count and total_row_count > len(children_nodes):
                summary_lines.append(f"💡 Use offset={len(children_nodes)} to see rows {len(children_nodes)+1}-{min(len(children_nodes)+5, total_row_count)}")
        elif columns:
            summary_lines.append(f"📊 CSV Structure ({total_row_count or len(children_nodes)} rows):\n")
            summary_lines.append(f"Columns: {' | '.join(columns)}")
        else:
            summary_lines.append(f"📂 Contents of {node_id} ({len(children_nodes)} items):\n")
    else:
        summary_lines.append(f"📂 Contents of {node_id} ({len(children_nodes)} items):\n")
    
    for i, node in enumerate(children_nodes[:10], 1):
        node_data = node if isinstance(node, dict) else node.model_dump()
        child_type = node_data.get("type")
        child_id = node_data.get("id")
        child_name = node_data.get("name")
        kind = node_data.get("kind", "unknown")
        preview = node_data.get("preview")
        
        if child_type == "bundle":
            children_count = node_data.get("children_count", 0)
            summary_lines.append(f"  📦 {child_id} | {child_name} ({children_count} items)")
            # Show bundle preview if available
            if preview and preview.get("kinds"):
                kind_summary = ", ".join([f"{count} {kind}" for kind, count in list(preview["kinds"].items())[:3]])
                summary_lines.append(f"      Contains: {kind_summary}")
        elif kind == "csv_row":
            # CSV rows: show as compact data rows, not verbose asset descriptions
            summary_lines.append(f"  {i} | {child_name}")
        else:
            is_container = node_data.get("is_container", False)
            container_marker = " 📁" if is_container else ""
            summary_lines.append(f"  📄 {child_id} | {child_name} ({kind}){container_marker}")
            
            # Show preview info for assets
            if preview:
                if preview.get("columns"):
                    summary_lines.append(f"      Columns: {', '.join(preview['columns'][:4])}")
                elif preview.get("excerpt"):
                    summary_lines.append(f"      {preview['excerpt'][:80]}...")
                elif preview.get("page_count"):
                    summary_lines.append(f"      {preview['page_count']} pages")
    
    if len(children_nodes) > 10:
        summary_lines.append(f"\n  ... {len(children_nodes) - 10} more items")
    
    # Add helpful hint for CSVs about getting full data
    if node_type == "asset" and parent_entity and parent_entity.kind and parent_entity.kind.value == 'csv':
        summary_lines.append(f"\n→ To work with full data: workspace_hub(resource='assets', mode='load', ids=[{node_numeric_id}], depth='full')")
    
    # Convert nodes to dicts
    nodes_data = []
    for node in children_nodes:
        if isinstance(node, dict):
            nodes_data.append(node)
        else:
            nodes_data.append(node.model_dump())
    
    # Build structured content with parent metadata and optional preview
    summary_text = "\n".join(summary_lines)
    structured = {
        "resource": "files",
        "mode": "view",  # Preview mode (was "expand")
        "parent_id": node_id,
        "parent_name": parent_entity.name if hasattr(parent_entity, 'name') else parent_entity.title if hasattr(parent_entity, 'title') else node_id,
        "parent_type": node_type,
        "children": nodes_data,
        "total_children": len(children_nodes),
        "message": summary_text,  # Full summary with ASCII tables for frontend
        "summary": summary_text   # Alternative field name for clarity
    }
    
    # Add parent_kind for assets
    if node_type == "asset" and hasattr(parent_entity, 'kind') and parent_entity.kind:
        structured["parent_kind"] = parent_entity.kind.value
    
    # Include parent preview for CSV/container assets (has columns, metadata, etc.)
    if parent_preview:
        structured["parent_preview"] = parent_preview
    
    return ToolResult(
        content=[TextContent(type="text", text=summary_text)],
        structured_content=structured
    )


async def _navigate_assets(services: Dict, ctx: Context, mode: str, depth: str, 
                           ids: Optional[List[int]], query: Optional[str], 
                           search_method: str, filters: Optional[Dict], 
                           limit: int, offset: int) -> ToolResult:
    """Navigate assets: search or load specific ones."""
    
    # Import at function level so it's available in all branches
    from sqlmodel import select
    from app.models import Asset, Bundle
    
    if mode == "load" and ids:
        # Load specific assets by ID
        
        assets = services["session"].exec(
            select(Asset)
            .where(Asset.id.in_(ids))
            .where(Asset.infospace_id == services["infospace_id"])
            .limit(limit)
        ).all()
        
        await ctx.info(f"Loaded {len(assets)} assets")
        
    elif mode == "search" and query:
        # Search assets
        # Allow depth="full" when limit=1 (single-document workflow optimization)
        if depth == "full" and limit and limit > 1:
            await ctx.info(f"⚠️ Using depth='full' for search with limit > 1 is expensive. Consider depth='previews' for browsing, or use limit=1 for single-document editing workflow.")
        elif depth == "full" and (not limit or limit == 1):
            await ctx.info(f"✓ Using depth='full' with limit=1 for single-document editing workflow")
        
        asset_kinds_enum = []
        if filters and filters.get("asset_kinds"):
            asset_kinds_enum = [AssetKind(kind) for kind in filters["asset_kinds"]]
        
        distance_threshold = filters.get("distance_threshold", 0.8) if filters else 0.8
        parent_asset_id = filters.get("parent_asset_id") if filters else None
        bundle_id = filters.get("bundle_id") if filters else None

        assets = await services["asset_service"].search_assets(
            user_id=services["user_id"],
            infospace_id=services["infospace_id"],
            query=query,
            search_method=search_method,
            asset_kinds=asset_kinds_enum,
            limit=limit,
            distance_threshold=distance_threshold,
            runtime_api_keys=services["runtime_api_keys"],
            parent_asset_id=parent_asset_id,
            bundle_id=bundle_id
        )
        
        await ctx.info(f"Found {len(assets)} assets matching '{query}'")
        
    else:
        # List all assets (rarely used, generally search is better)
        # WARNING: depth="full" for list is wasteful - use "previews" for browsing
        if depth == "full":
            await ctx.info(f"⚠️ Using depth='full' for list is expensive. Consider depth='previews' for browsing, then load specific IDs with depth='full' only when editing.")
        
        query_stmt = select(Asset).where(Asset.infospace_id == services["infospace_id"])
        
        # Apply filters
        if filters:
            if filters.get("asset_kinds"):
                kinds = [AssetKind(k) for k in filters["asset_kinds"]]
                query_stmt = query_stmt.where(Asset.kind.in_(kinds))
        
        assets = services["session"].exec(
            query_stmt.offset(offset).limit(limit)
        ).all()
        
        await ctx.info(f"Listed {len(assets)} assets")
    
    # Format based on depth (with bundle context)
    def build_hierarchy_path(asset: Asset, session) -> list:
        """
        Build the complete hierarchy path from asset to root.
        Returns list of dicts with {type, id, name, kind} for each level.
        """
        path = []
        current = asset
        visited = set()  # Prevent infinite loops
        
        # Walk up through parent assets
        while current and current.id not in visited:
            visited.add(current.id)
            
            # Add parent asset if exists
            if current.parent_asset_id:
                parent = session.get(Asset, current.parent_asset_id)
                if parent:
                    path.append({
                        "type": "asset",
                        "id": parent.id,
                        "name": parent.title,
                        "kind": parent.kind.value if parent.kind else "text"
                    })
                    current = parent
                    continue
            
            # Add bundle if exists (at this level or walked up to it)
            if current.bundle_id:
                bundle = session.get(Bundle, current.bundle_id)
                if bundle:
                    path.append({
                        "type": "bundle",
                        "id": bundle.id,
                        "name": bundle.name
                    })
                    
                    # Walk up through parent bundles
                    current_bundle = bundle
                    while current_bundle.parent_bundle_id and current_bundle.parent_bundle_id not in visited:
                        visited.add(current_bundle.parent_bundle_id)
                        parent_bundle = session.get(Bundle, current_bundle.parent_bundle_id)
                        if parent_bundle:
                            path.append({
                                "type": "bundle",
                                "id": parent_bundle.id,
                                "name": parent_bundle.name
                            })
                            current_bundle = parent_bundle
                        else:
                            break
            break
        
        return path
    
    asset_data = []
    for asset in assets:
        # Use consistent ID format with tree nodes
        # Make asset_id prominent for immediate load operations
        item = {
            "asset_id": asset.id,  # Prominent field name for easy access
            "id": f"asset-{asset.id}",  # Tree node format
            "numeric_id": asset.id,  # Direct numeric ID
            "type": "asset",
            "name": asset.title,
            "kind": asset.kind.value if asset.kind else "text",  # Always include kind for proper icon display
        }
        
        if depth in ["titles", "previews", "full"]:
            item.update({
                "source_identifier": asset.source_identifier,
                "created_at": asset.created_at.isoformat() if asset.created_at else None,
                "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
                "is_container": asset.is_container,
            })
        
        # Build complete hierarchy path for search/browsing context
        hierarchy_path = build_hierarchy_path(asset, services["session"])
        if hierarchy_path:
            item["hierarchy_path"] = hierarchy_path
        
        if depth in ["previews", "full"]:
            preview_length = 200 if depth == "previews" else None
            
            # Add content with appropriate truncation
            if preview_length:
                item["text_content"] = truncate_text(asset.text_content or "", preview_length)
            else:
                # depth="full" - warn if content is very large
                content_size = len(asset.text_content or "")
                if content_size > 50000:  # ~12.5k tokens
                    token_estimate = content_size // 4
                    await ctx.info(f"⚠️ Asset {asset.id} has {content_size:,} chars (~{token_estimate:,} tokens)")
                
                item["text_content"] = asset.text_content
            
            item["source_metadata"] = asset.source_metadata
        
        asset_data.append(item)
    
    # Build concise summary for model
    if mode == "search":
        summary_lines = [f"🔍 Found {len(assets)} assets matching '{query}':\n"]
    else:
        summary_lines = [f"📄 {len(assets)} assets:\n"]
    
    for i, asset in enumerate(assets[:5], 1):
        # Make asset ID prominent for immediate load operations
        summary_lines.append(f"📄 Asset ID: {asset.id} | {asset.title}")
        if depth == "previews":
            preview = truncate_text(asset.text_content or "", 80)
            if preview:
                summary_lines.append(f"    {preview}")
    
    if len(assets) > 5:
        summary_lines.append(f"\n... {len(assets) - 5} more assets")
    
    if depth != "full":
        summary_lines.append(f"\n→ Load full content: workspace_hub(resource='assets', mode='load', ids=[{assets[0].id if assets else '...'}], depth='full')")
    else:
        summary_lines.append(f"\n→ Full content loaded above")
    
    summary_text = "\n".join(summary_lines)
    return ToolResult(
        content=[TextContent(type="text", text=summary_text)],
        structured_content={
            "resource": "assets",
            "mode": mode,
            "depth": depth,
            "items": asset_data,
            "total": len(assets),
            "query": query,
            "message": summary_text,  # Full summary for frontend
            "summary": summary_text
        }
    )


@mcp.tool(tags=["search", "web", "ingestion"])
async def web_research(
    ctx: Context,
    query: Annotated[Optional[str], "What to search for (e.g., 'recent climate legislation in Europe')"] = None,
    provider: Annotated[str, "Search service: 'tavily' (default, recommended)"] = "tavily",
    max_results: Annotated[int, "Number of results to return (1-10 for basic, up to 50 for advanced)"] = 10,
    include_domains: Annotated[Optional[List[str]], "Only search these domains (e.g., ['gov.uk', 'parliament.uk'])"] = None,
    exclude_domains: Annotated[Optional[List[str]], "Skip these domains (e.g., ['twitter.com', 'facebook.com'])"] = None,
    search_depth: Annotated[str, "Result quality: 'basic' (faster) or 'advanced' (more thorough)"] = "basic",
    ingest_urls: Annotated[Optional[List[str]], "List of URLs to ingest directly (can be used without search)"] = None,
    ingest_top_k: Annotated[Optional[int], "After searching, auto-ingest the top K results (1-5 recommended)"] = None,
    bundle_id: Annotated[Optional[int], "Collection ID to add ingested documents to"] = None,
    scrape_content: Annotated[bool, "Extract full text content from pages (recommended: True)"] = True,
) -> ToolResult:
    """
    Unified web discovery + ingestion, so you can research and capture sources in one call.
    
    <use_cases>
    • Search only:
        web_research(query="2025 prorogation debates", max_results=8)
    • Search + auto-ingest top 3 hits into a collection:
        web_research(
            query="just transition policy brief",
            ingest_top_k=3,
            bundle_id=12
        )
    • Direct ingestion without searching:
        web_research(
            ingest_urls=[
                "https://example.com/report",
                "https://another.org/brief"
            ],
            bundle_id=7
        )
    </use_cases>
    
    Parameters:
    - query: Optional. Skip it if you only want to ingest known URLs.
    - ingest_top_k: Works only when query is provided. Pulls URLs from the ranked results list.
    - ingest_urls: Explicit list you already trust (works with or without query).
    - bundle_id: Logical collection to drop documents into.
    
    Returns combined structured_content with `search` and/or `ingestion` keys depending on what ran.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        if not query and not ingest_urls and not ingest_top_k:
            return ToolResult(
                content=[TextContent(type="text", text="Provide either a search query, ingest_urls, or ingest_top_k.")],
                structured_content={"error": "missing_parameters"}
            )
        
        summary_sections: List[str] = []
        structured_payload: Dict[str, Any] = {}
        raw_results: List[dict] = []
        
        if query:
            await ctx.info(f"Searching web: query='{query}', provider={provider}")
            provider_normalized = provider.lower()
            
            api_key = None
            if services["runtime_api_keys"]:
                if provider_normalized == 'tavily':
                    api_key = services["runtime_api_keys"].get('tavily') or services["runtime_api_keys"].get('TAVILY_API_KEY')
                elif provider_normalized == 'opol':
                    api_key = services["runtime_api_keys"].get('opol') or services["runtime_api_keys"].get('OPOL_API_KEY')
            
            from app.api.providers.search_registry import SearchProviderRegistryService
            search_registry = SearchProviderRegistryService()
            
            try:
                search_provider = search_registry.create_provider(provider_normalized, api_key)
            except Exception as e:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Error: Could not initialize {provider} search provider: {str(e)}")],
                    structured_content={
                        "error": str(e),
                        "status": "failed",
                        "query": query,
                        "provider": provider,
                    }
                )
            
            search_params = {
                "limit": max_results,
                "search_depth": search_depth,
            }
            if include_domains:
                search_params['include_domains'] = include_domains
            if exclude_domains:
                search_params['exclude_domains'] = exclude_domains
            
            try:
                raw_results = await search_provider.search(
                    query=query,
                    **search_params
                )
            except Exception as e:
                logger.error(f"Search failed: {e}", exc_info=True)
                return ToolResult(
                    content=[TextContent(type="text", text=f"Search failed: {str(e)}")],
                    structured_content={
                        "error": str(e),
                        "status": "failed",
                        "query": query,
                        "provider": provider,
                        "results": [],
                        "total_found": 0
                    }
                )
            
            search_items_summary = format_search_summary(raw_results, query)
            summary_text = search_items_summary
            if raw_results and "raw" in raw_results[0] and "summary_answer" in raw_results[0]["raw"]:
                summary_answer = raw_results[0]["raw"]["summary_answer"]
                summary_text = f"{summary_answer}\n\n{search_items_summary}"
            
            # Extract top-level images from first result's raw data (where Tavily stores them)
            top_level_images = []
            if raw_results and "raw" in raw_results[0]:
                top_level_images = raw_results[0]["raw"].get("tavily_images", [])
            
            search_results_data = [
                {
                    "title": result.get("title", ""),
                    "url": result.get("url", ""),
                    "content": result.get("content", ""),
                    "text_content": result.get("raw_content"),
                    "score": result.get("score"),
                    "provider": provider,
                    "source_metadata": {
                        "search_query": query,
                        "search_provider": provider,
                        "search_score": result.get("score"),
                        "published_date": result.get("published_date"),
                        "favicon": result.get("favicon"),
                    }
                }
                for result in raw_results
            ]
            
            await ctx.info(f"Found {len(raw_results)} results")
            summary_sections.append(f"🔎 Web Search\n{summary_text}")
            structured_payload["search"] = {
                "query": query,
                "provider": provider,
                "results": search_results_data,
                "total_found": len(raw_results),
                "images": top_level_images,  # Top-level images from Tavily
            }
        
        urls_to_ingest: List[str] = []
        if ingest_urls:
            urls_to_ingest.extend(ingest_urls)
        if ingest_top_k and raw_results:
            urls_from_results = [
                result.get("url")
                for result in raw_results[:ingest_top_k]
                if result.get("url")
            ]
            urls_to_ingest.extend(urls_from_results)
            if urls_from_results:
                await ctx.info(f"Auto-ingesting top {len(urls_from_results)} results")
        
        ingestion_structured = None
        if urls_to_ingest:
            ingest_summary, ingestion_structured = await _ingest_urls_with_services(
                services=services,
                ctx=ctx,
                urls=urls_to_ingest,
                bundle_id=bundle_id,
                scrape_content=scrape_content
            )
            summary_sections.append(f"📥 Ingestion\n{ingest_summary}")
            structured_payload["ingestion"] = ingestion_structured
        
        if not summary_sections:
            # Should only happen if ingest_top_k requested but no search results
            return ToolResult(
                content=[TextContent(type="text", text="No action performed. Provide ingest_urls or a valid search query.")],
                structured_content={"status": "noop"}
            )
        
        return ToolResult(
            content=[TextContent(type="text", text="\n\n".join(summary_sections))],
            structured_content=structured_payload
        )


async def _ingest_urls_with_services(
    services: Dict,
    ctx: Context,
    urls: List[str],
    bundle_id: Optional[int],
    scrape_content: bool,
) -> Tuple[str, Dict[str, Any]]:
    """Shared ingestion helper used by web_research."""
    if not urls:
        return (
            "No URLs provided for ingestion.",
            {"status": "noop", "assets_created": 0, "asset_ids": [], "bundle_id": bundle_id},
        )
    
    await ctx.info(f"Ingesting {len(urls)} URLs (scrape={scrape_content})")
    
    created_assets = []
    failed_urls = []
    
    for url in urls:
        try:
            assets = await services["content_ingestion_service"].ingest_content(
                locator=url,
                infospace_id=services["infospace_id"],
                user_id=services["user_id"],
                bundle_id=bundle_id,
                options={
                    'scrape_immediately': scrape_content
                }
            )
            created_assets.extend(assets)
            await ctx.info(f"✓ Ingested: {url}")
        except Exception as e:
            logger.error(f"Failed to ingest {url}: {e}")
            failed_urls.append(url)
            await ctx.info(f"✗ Failed: {url}")
    
    services["session"].commit()
    
    summary_lines = [f"Created {len(created_assets)} assets from {len(urls)} URLs"]
    if bundle_id:
        summary_lines.append(f"Added to bundle #{bundle_id}")
    
    if failed_urls:
        summary_lines.append(f"\nFailed to ingest {len(failed_urls)} URLs:")
        for url in failed_urls[:3]:
            summary_lines.append(f"  • {url}")
        if len(failed_urls) > 3:
            summary_lines.append(f"  ... and {len(failed_urls) - 3} more")
    
    summary_lines.append(f"\nNew asset IDs: {[a.id for a in created_assets]}")
    
    structured = {
        "assets_created": len(created_assets),
        "asset_ids": [asset.id for asset in created_assets],
        "urls_processed": len(urls),
        "urls_failed": len(failed_urls),
        "failed_urls": failed_urls,
        "bundle_id": bundle_id,
        "status": "success" if not failed_urls else "partial_success"
    }
    
    return "\n".join(summary_lines), structured


# @mcp.tool
# async def ingest_rss_feeds(
#     country: Annotated[str, "Country name (e.g., 'Australia', 'United States')"],
#     ctx: Context,
#     category_filter: Annotated[Optional[str], "Category filter (e.g., 'News', 'Technology')"] = None,
#     max_feeds: Annotated[int, "Maximum number of feeds to ingest"] = 5,
#     max_items_per_feed: Annotated[int, "Maximum items per feed"] = 10,
#     bundle_id: Annotated[Optional[int], "Bundle to add ingested assets to"] = None,
# ) -> ToolResult:
#     """
#     Discover and ingest RSS feeds from the awesome-rss-feeds repository.
#     
#     Provides access to curated RSS feeds organized by country and category.
#     Automatically creates assets from feed items.
#     """
#     with get_services() as services:
#         validate_infospace_access(
#             services["session"], 
#             services["infospace_id"], 
#             services["user_id"]
#         )
#         
#         await ctx.info(f"Discovering RSS feeds for {country}")
#         
#         try:
#             # Use content ingestion service
#             assets = await services["content_ingestion_service"].ingest_rss_feeds_from_awesome_repo(
#                 country=country,
#                 infospace_id=services["infospace_id"],
#                 user_id=services["user_id"],
#                 category_filter=category_filter,
#                 max_feeds=max_feeds,
#                 max_items_per_feed=max_items_per_feed,
#                 bundle_id=bundle_id,
#                 options={'scrape_full_content': True, 'use_bulk_scraping': True}
#             )
#             
#             summary = f"Successfully ingested {len(assets)} assets from {max_feeds} RSS feeds in {country}"
#             if category_filter:
#                 summary += f" (category: {category_filter})"
#             
#             return ToolResult(
#                 content=[TextContent(type="text", text=summary)],
#                 structured_content={
#                     "assets_created": len(assets),
#                     "asset_ids": [a.id for a in assets],
#                     "country": country,
#                     "category": category_filter,
#                     "feeds_processed": max_feeds,
#                     "bundle_id": bundle_id,
#                     "status": "success"
#                 }
#             )
#             
#         except Exception as e:
#             logger.error(f"RSS ingestion failed: {e}", exc_info=True)
#             return ToolResult(
#                 content=[TextContent(type="text", text=f"RSS feed ingestion failed: {str(e)}")],
#                 structured_content={"error": str(e), "status": "failed"}
#             )


# ============================================================================
# CATEGORY: ORGANIZATION & CURATION
# ============================================================================

@mcp.tool(tags=["library", "assets", "bundles"])
async def library_hub(
    ctx: Context,
    operation: Annotated[str, "asset.create/update/delete or collection.create/add/remove/rename/delete"] = "asset.create",
    # Asset Creation Params
    kind: Annotated[Optional[str], "Asset kind (article, text, web, csv_row)"] = None,
    title: Annotated[Optional[str], "Asset title"] = None,
    content: Annotated[Optional[str], "Text content (for article/text)"] = None,
    url: Annotated[Optional[str], "URL (for web)"] = None,
    row_data: Annotated[Optional[Dict[str, Any]], "Column-value pairs for csv_row"] = None,
    
    # Asset Update Params
    asset_id: Annotated[Optional[int], "Asset ID (for update/delete)"] = None,
    new_title: Annotated[Optional[str], "New title"] = None,
    new_content: Annotated[Optional[str], "New text content"] = None,
    updates: Annotated[Optional[Dict[str, Any]], "Raw updates dict for advanced cases"] = None,

    # Collection Params
    bundle_id: Annotated[Optional[int], "Collection ID"] = None,
    asset_ids: Annotated[Optional[List[int]], "Assets to include"] = None,
    name: Annotated[Optional[str], "Collection name"] = None,
    description: Annotated[Optional[str], "Collection description"] = None,
    
    # Shared
    parent_asset_id: Annotated[Optional[int], "Parent asset ID"] = None,
    data: Annotated[Optional[Dict[str, Any]], "Legacy: raw data payload (deprecated)"] = None,
) -> ToolResult:
    """
    Manage library content (assets and collections).
    
    <quick_start>
    • Create Note: library_hub(operation="asset.create", kind="text", title="Idea", content="...")
    • Save Link: library_hub(operation="asset.create", kind="web", url="https://...", title="...")
    • Create Collection: library_hub(operation="collection.create", name="Research", asset_ids=[1,2])
    • Add to Collection: library_hub(operation="collection.add", bundle_id=5, asset_ids=[10])
    </quick_start>
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"],
            services["infospace_id"],
            services["user_id"]
        )
        
        await ctx.info(f"library_hub: operation={operation}")
        
        try:
            if operation.startswith("asset."):
                # Construct legacy 'data' dict if flattened args are used
                effective_data = data or {}
                
                if operation == "asset.create":
                    if kind: effective_data["kind"] = kind
                    if title: effective_data["title"] = title
                    if content: effective_data["content"] = content
                    if url: effective_data["url"] = url
                    if row_data: effective_data["row_data"] = row_data
                
                elif operation == "asset.update":
                    if asset_id: effective_data["id"] = asset_id
                    
                    # Initialize updates dict if needed
                    if "updates" not in effective_data:
                        effective_data["updates"] = updates or {}
                    
                    if new_title: effective_data["updates"]["title"] = new_title
                    if new_content: effective_data["updates"]["content"] = new_content
                    if new_content: effective_data["updates"]["text_content"] = new_content # Handle both content/text_content
                    
                elif operation == "asset.delete":
                    if asset_id: effective_data["id"] = asset_id

                # Route to handlers
                if operation == "asset.create":
                    if not effective_data:
                        return ToolResult(content=[TextContent(type="text", text="❌ Missing parameters for asset.create")], structured_content={"error": "missing_params"})
                    return await _asset_create(services, ctx, effective_data, parent_asset_id)
                
                if operation == "asset.update":
                    if not effective_data:
                        return ToolResult(content=[TextContent(type="text", text="❌ Missing parameters for asset.update")], structured_content={"error": "missing_params"})
                    return await _asset_update(services, ctx, effective_data)
                
                if operation == "asset.delete":
                    if not effective_data:
                        return ToolResult(content=[TextContent(type="text", text="❌ Missing parameters for asset.delete")], structured_content={"error": "missing_params"})
                    return await _asset_delete(services, ctx, effective_data)
            
            if operation == "collection.create":
                return await _organize_create(services, ctx, name, description, asset_ids)
            if operation == "collection.add":
                return await _organize_add(services, ctx, bundle_id, asset_ids)
            if operation == "collection.remove":
                return await _organize_remove(services, ctx, bundle_id, asset_ids)
            if operation == "collection.rename":
                return await _organize_rename(services, ctx, bundle_id, name, description)
            if operation == "collection.delete":
                return await _organize_delete(services, ctx, bundle_id)
            
            return ToolResult(
                content=[TextContent(type="text", text=f"Unknown operation: {operation}")],
                structured_content={"error": f"Unknown operation: {operation}"}
            )
        
        except Exception as e:
            logger.error(f"library_hub operation failed: {e}", exc_info=True)
            return ToolResult(
                content=[TextContent(type="text", text=f"Operation failed: {str(e)}")],
                structured_content={"error": str(e), "status": "failed"}
            )


async def _organize_create(services: Dict, ctx: Context, name: Optional[str], 
                          description: Optional[str], asset_ids: Optional[List[int]]) -> ToolResult:
    """Create a new bundle."""
    if not name:
        return ToolResult(
            content=[TextContent(type="text", text="❌ Missing required parameter: name\n\nExample:\n  organize(operation='create', name='Climate Reports', asset_ids=[1,2,3])\n\nBundle name should describe the collection's purpose or topic")],
            structured_content={
                "error": "missing_required_parameter",
                "missing_parameter": "name",
                "hint": "Provide a descriptive name for the new collection"
            }
        )
    
    from app.api.utils.tree_builder import create_bundle, add_assets_to_bundle
    
    # Create bundle using tree_builder
    bundle = create_bundle(
        session=services["session"],
        user_id=services["user_id"],
        infospace_id=services["infospace_id"],
        name=name,
        description=description
    )
    
    # Add initial assets if provided
    assets_added = 0
    children_added = 0
    if asset_ids:
        try:
            assets_added, children_added = add_assets_to_bundle(
                session=services["session"],
                bundle_id=bundle.id,
                asset_ids=asset_ids,
                infospace_id=services["infospace_id"],
                include_children=True
            )
        except Exception as e:
            logger.warning(f"Failed to add assets: {e}")
    
    services["session"].commit()
    
    total_added = assets_added + children_added
    await ctx.info(f"Created bundle #{bundle.id} with {total_added} assets")
    
    summary = f"✅ Created bundle '{name}' (ID: {bundle.id})"
    if total_added:
        summary += f"\n   Added {assets_added} assets"
        if children_added:
            summary += f" (+{children_added} children)"
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "operation": "create",
            "bundle_id": bundle.id,
            "bundle_name": bundle.name,
            "assets_added": assets_added,
            "children_added": children_added,
            "status": "success"
        }
    )


async def _organize_add(services: Dict, ctx: Context, bundle_id: Optional[int], 
                       asset_ids: Optional[List[int]]) -> ToolResult:
    """Add assets to an existing bundle."""
    if not bundle_id:
        return ToolResult(
            content=[TextContent(type="text", text="❌ Missing required parameter: bundle_id\n\nExample:\n  organize(operation='add', bundle_id=5, asset_ids=[1,2,3])\n\nTip: Use workspace_hub() to find bundle IDs or create a new bundle with operation='create'")],
            structured_content={
                "error": "missing_required_parameter",
                "missing_parameter": "bundle_id",
                "hint": "Specify which collection to add assets to"
            }
        )
    
    if not asset_ids:
        return ToolResult(
            content=[TextContent(type="text", text="❌ Missing required parameter: asset_ids\n\nExample:\n  organize(operation='add', bundle_id=5, asset_ids=[1,2,3])\n\nTip: Use workspace_hub() to find asset IDs you want to add to the collection")],
            structured_content={
                "error": "missing_required_parameter",
                "missing_parameter": "asset_ids",
                "hint": "Provide a list of asset IDs to add to the bundle"
            }
        )
    
    from app.api.utils.tree_builder import add_assets_to_bundle
    
    try:
        assets_added, children_added = add_assets_to_bundle(
            session=services["session"],
            bundle_id=bundle_id,
            asset_ids=asset_ids,
            infospace_id=services["infospace_id"],
            include_children=True
        )
        
        services["session"].commit()
        
        total_added = assets_added + children_added
        await ctx.info(f"Added {total_added} assets to bundle #{bundle_id}")
        
        summary = f"✅ Added {assets_added} assets to bundle #{bundle_id}"
        if children_added:
            summary += f" (+{children_added} children)"
        
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "operation": "add",
                "bundle_id": bundle_id,
                "assets_added": assets_added,
                "children_added": children_added,
                "status": "success"
            }
        )
    except Exception as e:
        logger.error(f"Failed to add assets to bundle: {e}")
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to add assets: {str(e)}")],
            structured_content={
                "operation": "add",
                "bundle_id": bundle_id,
                "error": str(e),
                "status": "failed"
            }
        )


async def _organize_remove(services: Dict, ctx: Context, bundle_id: Optional[int],
                          asset_ids: Optional[List[int]]) -> ToolResult:
    """Remove assets from a bundle."""
    if not bundle_id or not asset_ids:
        return ToolResult(
            content=[TextContent(type="text", text="bundle_id and asset_ids are required for remove operation")],
            structured_content={"error": "bundle_id and asset_ids required"}
        )
    
    from app.api.utils.tree_builder import remove_assets_from_bundle
    
    try:
        removed_count = remove_assets_from_bundle(
            session=services["session"],
            bundle_id=bundle_id,
            asset_ids=asset_ids,
            infospace_id=services["infospace_id"]
        )
        
        services["session"].commit()
        
        await ctx.info(f"Removed {removed_count} assets from bundle #{bundle_id}")
        
        summary = f"✅ Removed {removed_count} assets from bundle #{bundle_id}"
        
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "operation": "remove",
                "bundle_id": bundle_id,
                "assets_removed": removed_count,
                "status": "success"
            }
        )
    except Exception as e:
        logger.error(f"Failed to remove assets from bundle: {e}")
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to remove assets: {str(e)}")],
            structured_content={
                "operation": "remove",
                "bundle_id": bundle_id,
                "error": str(e),
                "status": "failed"
            }
        )


async def _organize_rename(services: Dict, ctx: Context, bundle_id: Optional[int],
                          name: Optional[str], description: Optional[str]) -> ToolResult:
    """Rename/update a bundle."""
    if not bundle_id:
        return ToolResult(
            content=[TextContent(type="text", text="bundle_id is required for rename operation")],
            structured_content={"error": "bundle_id is required"}
        )
    
    from app.api.utils.tree_builder import update_bundle
    
    try:
        bundle = update_bundle(
            session=services["session"],
            bundle_id=bundle_id,
            infospace_id=services["infospace_id"],
            name=name,
            description=description
        )
        
        services["session"].commit()
        
        await ctx.info(f"Updated bundle #{bundle_id}")
        
        summary = f"✅ Updated bundle #{bundle_id}"
        if name:
            summary += f"\n   New name: {name}"
        if description is not None:
            summary += f"\n   New description: {description}"
        
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "operation": "rename",
                "bundle_id": bundle.id,
                "bundle_name": bundle.name,
                "bundle_description": bundle.description,
                "status": "success"
            }
        )
    except Exception as e:
        logger.error(f"Failed to update bundle: {e}")
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to update bundle: {str(e)}")],
            structured_content={
                "operation": "rename",
                "bundle_id": bundle_id,
                "error": str(e),
                "status": "failed"
            }
        )


async def _organize_delete(services: Dict, ctx: Context, bundle_id: Optional[int]) -> ToolResult:
    """Delete a bundle."""
    if not bundle_id:
        return ToolResult(
            content=[TextContent(type="text", text="bundle_id is required for delete operation")],
            structured_content={"error": "bundle_id is required"}
        )
    
    from app.api.utils.tree_builder import delete_bundle
    
    try:
        bundle_name = delete_bundle(
            session=services["session"],
            bundle_id=bundle_id,
            infospace_id=services["infospace_id"]
        )
        
        services["session"].commit()
        
        await ctx.info(f"Deleted bundle #{bundle_id}")
        
        return ToolResult(
            content=[TextContent(type="text", text=f"✅ Deleted bundle '{bundle_name}' (ID: {bundle_id})")],
            structured_content={
                "operation": "delete",
                "bundle_id": bundle_id,
                "bundle_name": bundle_name,
                "status": "success"
            }
        )
    except Exception as e:
        logger.error(f"Failed to delete bundle: {e}")
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to delete bundle: {str(e)}")],
            structured_content={
                "operation": "delete",
                "bundle_id": bundle_id,
                "error": str(e),
                "status": "failed"
            }
        )


# ============================================================================
# CATEGORY: ANALYSIS & SCHEMA CREATION
# ============================================================================
async def _analysis_create_schema(
    services: Dict,
    ctx: Context,
    name: str,
    fields: List[Dict[str, Any]],
    description: Optional[str],
    instructions: Optional[str],
) -> ToolResult:
    await ctx.info(f"Creating schema '{name}' with {len(fields)} fields")
    
    try:
        # Build JSON Schema format for output_contract
        # Follows the hierarchical convention with a top-level "document" object
        document_properties = {}
        required_fields = []
        
        for field in fields:
            field_name = field.get("name", "unnamed_field")
            field_type = field.get("field_type") or field.get("type", "text")
            field_description = field.get("description", "")
            is_required = field.get("required", True)
            
            # Map field_type to JSON Schema type
            if field_type in ("list", "array"):
                json_type = {"type": "array", "items": {"type": "string"}}
            elif field_type in ("number", "integer", "int"):
                json_type = {"type": "integer"}
            elif field_type in ("float", "decimal"):
                json_type = {"type": "number"}
            elif field_type in ("boolean", "bool"):
                json_type = {"type": "boolean"}
            else:
                # Default to string for text, str, and unknown types
                json_type = {"type": "string"}
            
            # Add description if present
            if field_description:
                json_type["description"] = field_description
            
            document_properties[field_name] = json_type
            
            if is_required:
                required_fields.append(field_name)
        
        # Build the full output_contract in hierarchical schema format
        output_contract = {
            "type": "object",
            "properties": {
                "document": {
                    "type": "object",
                    "properties": document_properties,
                    "required": required_fields
                }
            },
            "required": ["document"]
        }
        
        # Use the annotation_service.create_annotation_schema method directly
        schema = services["annotation_service"].create_annotation_schema(
            name=name,
            output_contract=output_contract,
            user_id=services["user_id"],
            infospace_id=services["infospace_id"],
            description=description or f"Schema: {name}",
            instructions=instructions,
            version="1.0.0"
        )
        # Note: create_annotation_schema already commits
        
        await ctx.info(f"Created schema #{schema.id}")
        
        field_summary = "\n".join([
            f"  • {f.get('name', 'unnamed')} ({f.get('field_type') or f.get('type', 'text')}): {f.get('description', 'No description')}" 
            for f in fields
        ])
        
        return ToolResult(
            content=[TextContent(type="text", text=f"✅ Created schema '{name}' (ID: {schema.id})\n\nFields:\n{field_summary}\n\n→ Use analysis_hub(operation='run.start', schema_id={schema.id}, asset_ids=[...]) to run analysis")],
            structured_content={
                "schema_id": schema.id,
                "schema_name": schema.name,
                "schema_uuid": str(schema.uuid),
                "field_count": len(fields),
                "fields": fields,
                "status": "created"
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to create schema: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to create schema: {str(e)}")],
            structured_content={"error": str(e), "status": "failed"}
        )

@mcp.tool(tags=["analysis", "schema", "runs"])
async def analysis_hub(
    ctx: Context,
    operation: Annotated[str, "schema.list, schema.create, run.start, run.list, run.dashboard, run.share"] = "schema.list",
    schema_name: Annotated[Optional[str], "Required for schema.create"] = None,
    schema_fields: Annotated[Optional[List[Dict[str, Any]]], "Field definitions for schema.create"] = None,
    schema_description: Annotated[Optional[str], "Optional description for schema.create"] = None,
    schema_instructions: Annotated[Optional[str], "Optional instructions for schema.create"] = None,
    schema_id: Annotated[Optional[int], "Use with run.start/run.list filters/run.dashboard/run.share"] = None,
    asset_ids: Annotated[Optional[List[int]], "Required for run.start"] = None,
    run_name: Annotated[Optional[str], "Optional friendly name for run.start"] = None,
    custom_instructions: Annotated[Optional[str], "Optional extra guidance for run.start"] = None,
    status: Annotated[Optional[str], "Filter for run.list: pending/running/completed/failed/completed_with_errors"] = None,
    limit: Annotated[int, "Pagination for run.list"] = 20,
    offset: Annotated[int, "Pagination for run.list"] = 0,
    run_id: Annotated[Optional[int], "Required for run.dashboard/run.share"] = None,
    share_name: Annotated[Optional[str], "Optional title for run.share"] = None,
    expiration_days: Annotated[Optional[int], "Optional expiry for run.share"] = None,
) -> ToolResult:
    """
    Unified analysis control panel: create/list schemas, launch runs, list dashboards, and share results.
    
    <operations>
    • schema.list .................. Show all available schemas.
    • schema.create ................ Provide schema_name + schema_fields to add a template.
    • run.start .................... Provide schema_id + asset_ids (optionally run_name/custom_instructions).
    • run.list ..................... Optional filters schema_id/status plus pagination.
    • run.dashboard ................ Provide run_id to fetch structured results.
    • run.share .................... Provide run_id (plus optional share_name/expiration_days) for a public link.
    """
    with get_services() as services:
        validate_infospace_access(services["session"], services["infospace_id"], services["user_id"])
        
        await ctx.info(f"analysis_hub: operation={operation}")
        
        if operation == "schema.list":
            return await _analysis_list_schemas(services, ctx)
        
        if operation == "schema.create":
            if not schema_name or not schema_fields:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.create requires schema_name and schema_fields")],
                    structured_content={"error": "missing_schema_definition"}
                )
            return await _analysis_create_schema(
                services=services,
                ctx=ctx,
                name=schema_name,
                fields=schema_fields,
                description=schema_description,
                instructions=schema_instructions
            )
        
        if operation == "run.start":
            if not schema_id or not asset_ids:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ run.start requires schema_id and asset_ids")],
                    structured_content={"error": "missing_run_parameters"}
                )
            return await _analysis_start_run(
                services=services,
                ctx=ctx,
                asset_ids=asset_ids,
                schema_id=schema_id,
                name=run_name,
                custom_instructions=custom_instructions
            )
        
        if operation == "run.list":
            return await _analysis_list_runs(
                services=services,
                ctx=ctx,
                schema_id=schema_id,
                status=status,
                limit=limit,
                offset=offset
            )
        
        if operation == "run.dashboard":
            if not run_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ run.dashboard requires run_id")],
                    structured_content={"error": "missing_run_id"}
                )
            return await _analysis_get_dashboard(services, ctx, run_id)
        
        if operation == "run.share":
            if not run_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ run.share requires run_id")],
                    structured_content={"error": "missing_run_id"}
                )
            return await _analysis_share_run(
                services=services,
                ctx=ctx,
                run_id=run_id,
                name=share_name,
                expiration_days=expiration_days
            )
        
        return ToolResult(
            content=[TextContent(type="text", text=f"Unknown analysis operation: {operation}")],
            structured_content={"error": f"unknown_operation:{operation}"}
        )


async def _analysis_start_run(
    services: Dict,
    ctx: Context,
    asset_ids: List[int],
    schema_id: int,
    name: Optional[str],
    custom_instructions: Optional[str],
) -> ToolResult:
    await ctx.info(f"Creating analysis run for {len(asset_ids)} assets with schema #{schema_id}")
    
    try:
        # Validate that the assets exist in this infospace BEFORE creating the run
        # This gives immediate feedback rather than failing in background celery task
        valid_assets = services["asset_service"].get_assets_by_ids(
            asset_ids, 
            services["infospace_id"]
        )
        valid_asset_ids = {a.id for a in valid_assets}
        invalid_ids = [aid for aid in asset_ids if aid not in valid_asset_ids]
        
        if invalid_ids:
            invalid_str = ", ".join(str(i) for i in invalid_ids[:10])
            if len(invalid_ids) > 10:
                invalid_str += f"... (+{len(invalid_ids) - 10} more)"
            
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Cannot start run: {len(invalid_ids)} asset(s) not found in this infospace: [{invalid_str}]\n\n💡 Use workspace_hub(mode='view') or workspace_hub(mode='load', ids=[...]) to verify asset IDs first.")],
                structured_content={
                    "error": "invalid_asset_ids",
                    "invalid_ids": invalid_ids,
                    "valid_ids": list(valid_asset_ids),
                    "status": "failed"
                }
            )
        
        if not valid_assets:
            return ToolResult(
                content=[TextContent(type="text", text="❌ No valid assets provided for analysis run.\n\n💡 Use workspace_hub(mode='view') to browse available assets first.")],
                structured_content={"error": "no_valid_assets", "status": "failed"}
            )
        
        run_name = name or f"Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
        
        # Use the chat's selected model for annotation runs
        # Falls back to a sensible default if not available
        stored_keys = services.get("runtime_api_keys", {})
        model_name = services.get("model_name")
        
        if not model_name:
            # Fallback: pick based on available stored credentials
            if stored_keys.get("anthropic"):
                model_name = "claude-sonnet-4-20250514"
            elif stored_keys.get("openai"):
                model_name = "gpt-4o"
            elif stored_keys.get("gemini") or stored_keys.get("GOOGLE_API_KEY"):
                model_name = "gemini-2.5-flash-preview-05-20"
            else:
                model_name = "qwen3:14b"  # Local Ollama fallback
        
        configuration = {
            "ai_model": model_name,
            "api_keys": stored_keys if stored_keys else None
        }
        if custom_instructions:
            configuration["custom_instructions"] = custom_instructions
        
        await ctx.info(f"Using model: {model_name}")
        
        run_create = AnnotationRunCreate(
            name=run_name,
            description=f"Analysis via chat{': ' + custom_instructions if custom_instructions else ''}",
            schema_ids=[schema_id],
            target_asset_ids=list(valid_asset_ids),  # Use validated IDs
            configuration=configuration
        )
        
        run = services["annotation_service"].create_run(
            services["user_id"],
            services["infospace_id"],
            run_create
        )
        
        services["session"].commit()
        
        await ctx.info(f"Started run #{run.id}")
        
        # Include asset names in response for confirmation
        asset_names = [a.title or f"Asset {a.id}" for a in valid_assets[:5]]
        asset_summary = ", ".join(asset_names)
        if len(valid_assets) > 5:
            asset_summary += f"... (+{len(valid_assets) - 5} more)"
        
        return ToolResult(
            content=[TextContent(type="text", text=f"🔬 Started analysis run '{run_name}' (ID: {run.id})\n\n📊 Analyzing {len(valid_assets)} documents: {asset_summary}\n\n🤖 Model: {model_name}\n📋 Schema: #{schema_id}\n\n⏳ Status: {run.status.value}\n\n→ Check results: analysis_hub(operation='run.dashboard', run_id={run.id})")],
            structured_content={
                "run_id": run.id,
                "run_name": run.name,
                "run_uuid": str(run.uuid),
                "schema_id": schema_id,
                "model_name": model_name,
                "asset_count": len(valid_assets),
                "asset_ids": list(valid_asset_ids),
                "status": run.status.value,
                "created_at": run.created_at.isoformat() if run.created_at else None
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to create analysis run: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to start analysis: {str(e)}")],
            structured_content={"error": str(e), "status": "failed"}
        )


def _format_task_list(tasks_list: List[Dict[str, Any]]) -> Tuple[str, Dict[str, Any]]:
    """Helper to format task list for display and structured content."""
    if not tasks_list:
        return (
            "📝 No tasks yet.\n\nUse tasks(operation='batch', actions=[{'action': 'add', 'description': '...'}]) to create your first task.",
            {"tasks": [], "summary": "empty"}
        )
    
    # Group by status
    in_progress = [t for t in tasks_list if t["status"] == "in_progress"]
    pending = [t for t in tasks_list if t["status"] == "pending"]
    completed = [t for t in tasks_list if t["status"] == "completed"]
    
    lines = ["📋 **Current Tasks**\n"]
    
    if in_progress:
        lines.append("🔵 **In Progress:**")
        for task in in_progress:
            lines.append(f"  [{task['id']}] {task['description']}")
        lines.append("")
    
    if pending:
        lines.append("⚪ **Pending:**")
        for task in pending[:5]:  # Show first 5
            lines.append(f"  [{task['id']}] {task['description']}")
        if len(pending) > 5:
            lines.append(f"  ... and {len(pending) - 5} more")
        lines.append("")
    
    if completed:
        lines.append(f"✅ **Completed:** {len(completed)} tasks")
        for task in completed[:3]:  # Show last 3
            lines.append(f"  [{task['id']}] {task['description']}")
    
    return (
        "\n".join(lines),
        {
            "tasks": tasks_list,
            "counts": {
                "in_progress": len(in_progress),
                "pending": len(pending),
                "completed": len(completed)
            }
        }
    )


@mcp.tool(tags=["tasks", "productivity"])
async def tasks(
    ctx: Context,
    operation: Annotated[Optional[str], "Operation: 'view' (default) or 'batch' (execute multiple actions)"] = "view",
    actions: Annotated[Optional[List[Dict[str, Any]]], "List of actions for batch operation: [{'action': 'add', 'description': '...'}, {'action': 'finish', 'task_id': 1}]"] = None
) -> ToolResult:
    """
    View all current tasks and their status, or execute batch operations.
    
    ⚠️ This is the only task tool. Batch every mutation to avoid multi-call penalties.
    
    Common anti-patterns (CAUSES ITERATION LIMITS):
    ❌ DON'T: Add/start/finish tasks in separate calls (view → add → view → start).
    ❌ DON'T: Mix standalone calls with batch calls.
    
    ✅ DO: Plan all changes, then call `tasks(operation="batch", actions=[...])` once.
    ✅ DO: Combine with efficient work sequence: Workspace search → tasks(batch) → library_hub update.
    
    Operations:
    - 'view' (default): Show all tasks grouped by status
    - 'batch': Execute multiple actions in one call (MANDATORY for 2+ operations to prevent iteration limits)
    
    Batch actions format:
    - {"action": "add", "description": "...", "start_now": False}
    - {"action": "start", "task_id": 1}
    - {"action": "finish", "task_id": 1}
    - {"action": "cancel", "task_id": 1}
    
    Tasks are stored in conversation metadata for reliable persistence.
    
    Note: Results are self-explanatory. Assistant should not repeat available operations unless user asks.
    
    Examples:
      tasks()  # View all tasks
      
      # Create 3 tasks in ONE call:
      tasks(operation="batch", actions=[
          {"action": "add", "description": "Task 1"},
          {"action": "add", "description": "Task 2"},
          {"action": "add", "description": "Task 3"}
      ])
      
      # Mixed operations in one call:
      tasks(operation="batch", actions=[
          {"action": "add", "description": "New task"},
          {"action": "finish", "task_id": 1},
          {"action": "start", "task_id": 2}
      ])
    """
    with get_services() as services:
        conversation_id = services.get("conversation_id")
        if not conversation_id:
            return ToolResult(
                content=[TextContent(type="text", text="📝 No tasks yet.\n\nUse tasks(operation='batch', actions=[{'action': 'add', 'description': '...'}]) to create your first task.")],
                structured_content={"tasks": [], "summary": "empty"}
            )
        if not conversation_id:
            return ToolResult(
                content=[TextContent(type="text", text="📝 No tasks yet.\n\nUse tasks(operation='batch', actions=[{'action': 'add', 'description': '...'}]) to create your first task.")],
                structured_content={"tasks": [], "summary": "empty"}
            )
        
        # Load conversation and its metadata
        from app.models import ChatConversation
        from sqlmodel import select
        
        conversation = services["session"].exec(
            select(ChatConversation)
            .where(ChatConversation.id == conversation_id)
        ).first()
        
        if not conversation:
            return ToolResult(
                content=[TextContent(type="text", text="❌ Conversation not found")],
                structured_content={"error": "Conversation not found", "tasks": []}
            )
        
        # Initialize metadata if needed
        if not conversation.conversation_metadata:
            conversation.conversation_metadata = {}
        
        tasks_list = conversation.conversation_metadata.get("tasks", [])
        
        # Handle batch operations
        if operation == "batch" and actions:
            results = []
            errors = []
            
            for action in actions:
                action_type = action.get("action")
                
                try:
                    if action_type == "add":
                        description = action.get("description")
                        start_now = action.get("start_now", False)
                        
                        if not description:
                            errors.append({"action": action, "error": "Missing 'description'"})
                            continue
                        
                        # Generate next task ID
                        task_id = max([t["id"] for t in tasks_list], default=0) + 1
                        
                        # Auto-pause other in-progress tasks if starting this one
                        if start_now:
                            for task in tasks_list:
                                if task["status"] == "in_progress":
                                    task["status"] = "pending"
                        
                        new_task = {
                            "id": task_id,
                            "description": description,
                            "status": "in_progress" if start_now else "pending",
                            "created_at": datetime.now(timezone.utc).isoformat()
                        }
                        tasks_list.append(new_task)
                        results.append({"action": "add", "task": new_task})
                        
                    elif action_type == "start":
                        task_id = action.get("task_id")
                        if not task_id:
                            errors.append({"action": action, "error": "Missing 'task_id'"})
                            continue
                        
                        task = next((t for t in tasks_list if t["id"] == task_id), None)
                        if not task:
                            errors.append({"action": action, "error": f"Task {task_id} not found"})
                            continue
                        
                        # Auto-pause other in-progress tasks
                        for t in tasks_list:
                            if t["id"] != task_id and t["status"] == "in_progress":
                                t["status"] = "pending"
                        
                        task["status"] = "in_progress"
                        if "started_at" not in task:
                            task["started_at"] = datetime.now(timezone.utc).isoformat()
                        results.append({"action": "start", "task": task})
                        
                    elif action_type == "finish":
                        task_id = action.get("task_id")
                        if not task_id:
                            errors.append({"action": action, "error": "Missing 'task_id'"})
                            continue
                        
                        task = next((t for t in tasks_list if t["id"] == task_id), None)
                        if not task:
                            errors.append({"action": action, "error": f"Task {task_id} not found"})
                            continue
                        
                        task["status"] = "completed"
                        task["completed_at"] = datetime.now(timezone.utc).isoformat()
                        results.append({"action": "finish", "task": task})
                        
                    elif action_type == "cancel":
                        task_id = action.get("task_id")
                        if not task_id:
                            errors.append({"action": action, "error": "Missing 'task_id'"})
                            continue
                        
                        task = next((t for t in tasks_list if t["id"] == task_id), None)
                        if not task:
                            errors.append({"action": action, "error": f"Task {task_id} not found"})
                            continue
                        
                        task["status"] = "cancelled"
                        task["cancelled_at"] = datetime.now(timezone.utc).isoformat()
                        results.append({"action": "cancel", "task": task})
                        
                    else:
                        errors.append({"action": action, "error": f"Unknown action: {action_type}"})
                        
                except Exception as e:
                    errors.append({"action": action, "error": str(e)})
            
            # Save updated tasks
            conversation.conversation_metadata["tasks"] = tasks_list
            services["session"].add(conversation)
            services["session"].commit()
            
            await ctx.info(f"Batch operation: {len(results)} succeeded, {len(errors)} failed")
            
            # Format response
            content_lines = [f"📋 Batch operation: {len(results)} succeeded"]
            if errors:
                content_lines.append(f"⚠️ {len(errors)} errors")
            
            formatted_text, structured_data = _format_task_list(tasks_list)
            
            return ToolResult(
                content=[TextContent(type="text", text="\n".join(content_lines) + "\n\n" + formatted_text)],
                structured_content={
                    **structured_data,
                    "batch_results": results,
                    "batch_errors": errors
                }
            )
        
        # Default: view operation
        await ctx.info(f"Loaded {len(tasks_list)} tasks from conversation metadata")
        
        formatted_text, structured_data = _format_task_list(tasks_list)
        
        return ToolResult(
            content=[TextContent(type="text", text=formatted_text)],
            structured_content=structured_data
        )










@mcp.tool(tags=["memory", "context"])
async def working_memory(
    operation: Annotated[str, "Action: 'view' (show current memory), 'add' (save item), 'remove' (delete item), 'pin' (mark important), 'unpin', 'clear' (reset all)"],
    ctx: Context,
    item_type: Annotated[Optional[str], "Type of item: 'asset', 'finding', 'path', 'note' (required for add/remove)"] = None,
    item_id: Annotated[Optional[Union[int, str]], "Identifier (asset_id for assets, custom key for others)"] = None,
    content: Annotated[Optional[str], "Content to store (for findings/notes)"] = None,
    metadata: Annotated[Optional[Dict[str, Any]], "Additional metadata (e.g., tree path, timestamps)"] = None,
) -> ToolResult:
    """
    Your working memory for this conversation.
    
    Keep track of:
    - Assets you've already fetched (avoid re-fetching)
    - Important findings and insights
    - Navigation paths through the tree
    - Quick notes and reminders
    
    Pinned items stay at the top for easy reference.
    Memory persists throughout the conversation.
    """
    with get_services() as services:
        conversation_id = services.get("conversation_id")
        
        # Initialize default memory structure
        default_memory = {
            "assets": {},      # {asset_id: {title, last_accessed, pinned}}
            "findings": {},    # {key: {content, pinned}}
            "paths": {},       # {key: {path, description, pinned}}
            "notes": {},       # {key: {content, pinned}}
        }
        
        memory = default_memory
        conversation = None
        
        # Try to load persistent memory from conversation
        if conversation_id:
            from app.models import ChatConversation
            from sqlmodel import select
            
            conversation = services["session"].exec(
                select(ChatConversation)
                .where(ChatConversation.id == conversation_id)
            ).first()
            
            if conversation:
                if not conversation.conversation_metadata:
                    conversation.conversation_metadata = {}
                
                # Load existing memory or initialize
                memory = conversation.conversation_metadata.get("working_memory", default_memory)
                # Ensure all categories exist (migration safety)
                for cat in default_memory:
                    if cat not in memory:
                        memory[cat] = {}

    try:
        if operation == "view":
            # Show current memory state
            summary = []
            total_items = sum(len(items) for items in memory.values())
            
            if total_items == 0:
                return ToolResult(
                    content="Working memory is empty.",
                    structured_content={"memory": memory, "total_items": 0}
                )
            
            # Format memory for display
            for category, items in memory.items():
                if not items:
                    continue
                
                pinned = {k: v for k, v in items.items() if v.get("pinned")}
                unpinned = {k: v for k, v in items.items() if not v.get("pinned")}
                
                if pinned:
                    summary.append(f"\n📌 Pinned {category}:")
                    for key, data in list(pinned.items())[:5]:  # Show up to 5 pinned
                        summary.append(f"  • {key}: {str(data)[:100]}")
                
                if unpinned:
                    summary.append(f"\n{category.title()} ({len(unpinned)}):")
                    for key, data in list(unpinned.items())[:3]:  # Show up to 3 recent
                        summary.append(f"  • {key}: {str(data)[:100]}")
            
            return ToolResult(
                content=f"Working memory ({total_items} items):\n" + "\n".join(summary),
                structured_content={"memory": memory, "total_items": total_items}
            )
        
        elif operation == "add":
            if not item_type or item_id is None:
                return ToolResult(
                    content="Error: item_type and item_id required for 'add' operation",
                    structured_content={"error": "missing_parameters", "status": "failed"}
                )
            
            category = item_type + "s" if item_type in ["asset", "finding", "path", "note"] else "notes"
            
            item_data = {
                "id": item_id,
                "added_at": datetime.now(timezone.utc).isoformat(),
                "pinned": False
            }
            
            if content:
                item_data["content"] = content
            if metadata:
                item_data.update(metadata)
            
            memory[category][str(item_id)] = item_data
            
            # Persist changes
            if conversation:
                # Force SQLAlchemy to detect change in JSON field
                from sqlalchemy.orm.attributes import flag_modified
                conversation.conversation_metadata["working_memory"] = memory
                flag_modified(conversation, "conversation_metadata")
                services["session"].add(conversation)
                services["session"].commit()
            
            return ToolResult(
                content=f"Added {item_type} '{item_id}' to working memory",
                structured_content={"added": item_data, "category": category}
            )
        
        elif operation == "remove":
            if not item_type or item_id is None:
                return ToolResult(
                    content="Error: item_type and item_id required for 'remove' operation",
                    structured_content={"error": "missing_parameters", "status": "failed"}
                )
            
            category = item_type + "s" if item_type in ["asset", "finding", "path", "note"] else "notes"
            
            if str(item_id) in memory[category]:
                del memory[category][str(item_id)]
                
                # Persist changes
                if conversation:
                    from sqlalchemy.orm.attributes import flag_modified
                    conversation.conversation_metadata["working_memory"] = memory
                    flag_modified(conversation, "conversation_metadata")
                    services["session"].add(conversation)
                    services["session"].commit()
                
                return ToolResult(
                    content=f"Removed {item_type} '{item_id}' from working memory",
                    structured_content={"removed": item_id, "category": category}
                )
            else:
                return ToolResult(
                    content=f"{item_type} '{item_id}' not found in working memory",
                    structured_content={"found": False}
                )
        
        elif operation in ["pin", "unpin"]:
            if not item_type or item_id is None:
                return ToolResult(
                    content=f"Error: item_type and item_id required for '{operation}' operation",
                    structured_content={"error": "missing_parameters", "status": "failed"}
                )
            
            category = item_type + "s" if item_type in ["asset", "finding", "path", "note"] else "notes"
            
            if str(item_id) in memory[category]:
                memory[category][str(item_id)]["pinned"] = (operation == "pin")
                
                # Persist changes
                if conversation:
                    from sqlalchemy.orm.attributes import flag_modified
                    conversation.conversation_metadata["working_memory"] = memory
                    flag_modified(conversation, "conversation_metadata")
                    services["session"].add(conversation)
                    services["session"].commit()
                
                return ToolResult(
                    content=f"{'Pinned' if operation == 'pin' else 'Unpinned'} {item_type} '{item_id}'",
                    structured_content={"item": memory[category][str(item_id)]}
                )
            else:
                return ToolResult(
                    content=f"{item_type} '{item_id}' not found in working memory",
                    structured_content={"error": "not_found", "status": "failed"}
                )
        
        elif operation == "clear":
            memory.clear()
            memory.update({
                "assets": {},
                "findings": {},
                "paths": {},
                "notes": {},
            })
            
            # Persist changes
            if conversation:
                # Force SQLAlchemy to detect change in JSON field
                from sqlalchemy.orm.attributes import flag_modified
                conversation.conversation_metadata["working_memory"] = memory
                flag_modified(conversation, "conversation_metadata")
                services["session"].add(conversation)
                services["session"].commit()
            
            return ToolResult(
                content="Working memory cleared",
                structured_content={"memory": memory}
            )
        
        else:
            return ToolResult(
                content=f"Unknown operation: {operation}. Use: view, add, remove, pin, unpin, clear",
                structured_content={"error": "unknown_operation", "status": "failed"}
            )
    
    except Exception as e:
        logger.error(f"working_memory error: {e}", exc_info=True)
        return ToolResult(
            content=f"Error managing working memory: {str(e)}",
            structured_content={"error": "exception", "status": "failed", "exception": str(e)}
        )


async def _analysis_list_runs(
    services: Dict,
    ctx: Context,
    schema_id: Optional[int],
    status: Optional[str],
    limit: int,
    offset: int,
) -> ToolResult:
    from sqlmodel import select, and_
    from app.models import AnnotationRun, RunStatus
    
    await ctx.info(f"Listing runs (schema_id={schema_id}, status={status})")
    
    query_conditions = [AnnotationRun.infospace_id == services["infospace_id"]]
    
    if schema_id:
        from app.models import annotation_run_schema_association
        query = (
            select(AnnotationRun)
            .join(annotation_run_schema_association)
            .where(annotation_run_schema_association.c.schema_id == schema_id)
            .where(AnnotationRun.infospace_id == services["infospace_id"])
        )
    else:
        query = select(AnnotationRun).where(and_(*query_conditions))
    
    if status:
        try:
            status_enum = RunStatus(status)
            query = query.where(AnnotationRun.status == status_enum)
        except ValueError:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Invalid status: {status}. Valid: pending, running, completed, failed, completed_with_errors")],
                structured_content={"error": "invalid_status", "valid_statuses": ["pending", "running", "completed", "failed", "completed_with_errors"]}
            )
    
    query = query.order_by(AnnotationRun.created_at.desc()).offset(offset).limit(limit)
    
    runs = services["session"].exec(query).all()
    
    await ctx.info(f"Found {len(runs)} runs")
    
    if not runs:
        filters_text = []
        if schema_id:
            filters_text.append(f"schema_id={schema_id}")
        if status:
            filters_text.append(f"status={status}")
        filter_desc = f" with filters: {', '.join(filters_text)}" if filters_text else ""
        
        return ToolResult(
            content=[TextContent(type="text", text=f"📊 No annotation runs found{filter_desc}\n\nCreate your first run:\n  analysis_hub(operation='run.start', schema_id=..., asset_ids=[...])")],
            structured_content={"runs": [], "total": 0, "filters": {"schema_id": schema_id, "status": status}}
        )
    
    summary_lines = [f"📊 Found {len(runs)} annotation runs:\n"]
    
    for i, run in enumerate(runs[:10], 1):
        run_config = run.configuration or {}
        target_asset_ids = run_config.get('target_asset_ids', [])
        target_count = len(target_asset_ids) if target_asset_ids else 0
        annotation_count = len(run.annotations) if hasattr(run, 'annotations') and run.annotations else 0
        target_display = str(target_count) if target_count > 0 else "bundle" if run_config.get('target_bundle_id') else "0"
        status_emoji = {
            "pending": "⏳",
            "running": "🔄", 
            "completed": "✅",
            "failed": "❌",
            "completed_with_errors": "⚠️"
        }.get(run.status.value if run.status else "unknown", "❓")
        
        summary_lines.append(f"{i}. {status_emoji} [{run.id}] {run.name}")
        if annotation_count > 0:
            summary_lines.append(f"   {annotation_count} results from {target_display} assets | {run.status.value if run.status else 'unknown'}")
        else:
            summary_lines.append(f"   Targets: {target_display} assets | {run.status.value if run.status else 'unknown'}")
        
        if run.created_at:
            summary_lines.append(f"   Created: {run.created_at.strftime('%Y-%m-%d %H:%M')}")
        
        summary_lines.append("")
    
    if len(runs) > 10:
        summary_lines.append(f"... {len(runs) - 10} more runs")
    
    summary_lines.append(f"💡 Use analysis_hub(operation='run.dashboard', run_id=X) to see results")
    
    run_data = []
    for run in runs:
        run_config = run.configuration or {}
        target_asset_ids = run_config.get('target_asset_ids', [])
        target_count = len(target_asset_ids) if target_asset_ids else 0
        annotation_count = len(run.annotations) if hasattr(run, 'annotations') and run.annotations else 0
        schema_ids = [s.id for s in run.target_schemas] if hasattr(run, 'target_schemas') and run.target_schemas else []
        schema_names = [s.name for s in run.target_schemas] if hasattr(run, 'target_schemas') and run.target_schemas else []
        
        run_data.append({
            "id": run.id,
            "uuid": str(run.uuid),
            "name": run.name,
            "description": run.description,
            "status": run.status.value if run.status else None,
            "target_asset_count": target_count,
            "annotation_count": annotation_count,
            "target_bundle_id": run_config.get('target_bundle_id'),
            "schema_ids": schema_ids,
            "schema_names": schema_names,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
        })
    
    summary_text = "\n".join(summary_lines)
    return ToolResult(
        content=[TextContent(type="text", text=summary_text)],
        structured_content={
            "runs": run_data,
            "total": len(runs),
            "limit": limit,
            "offset": offset,
            "filters": {
                "schema_id": schema_id,
                "status": status
            },
            "message": summary_text
        }
    )


async def _analysis_get_dashboard(
    services: Dict,
    ctx: Context,
    run_id: int,
) -> ToolResult:
    await ctx.info(f"Fetching dashboard for run #{run_id}")
    
    try:
        from sqlmodel import select
        from app.models import AnnotationRun, Annotation, AnnotationSchema
        
        run = services["session"].get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run not found"}
            )
        
        annotations = services["session"].exec(
            select(Annotation).where(Annotation.run_id == run_id)
        ).all()
        
        schemas = run.target_schemas if hasattr(run, 'target_schemas') and run.target_schemas else []
        logger.info(f"Run has {len(schemas)} schemas via target_schemas relationship")
        
        status_counts = {}
        for ann in annotations:
            status = ann.status.value if ann.status else "unknown"
            status_counts[status] = status_counts.get(status, 0) + 1
        
        summary_lines = [
            f"📊 {run.name}: {len(annotations)} annotations • {run.status.value}",
        ]
        
        if status_counts:
            status_parts = [f"{count} {status}" for status, count in list(status_counts.items())[:3]]
            summary_lines.append(f"   {', '.join(status_parts)}")
        
        if schemas:
            summary_lines.append(f"   Schemas: {', '.join([s.name for s in schemas[:2]])}")
        
        annotation_data = []
        asset_ids_in_results = set()
        for ann in annotations[:100]:
            asset_ids_in_results.add(ann.asset_id)
            annotation_data.append({
                "id": ann.id,
                "asset_id": ann.asset_id,
                "schema_id": ann.schema_id,
                "value": ann.value,
                "status": ann.status.value if ann.status else None,
                "timestamp": ann.timestamp.isoformat() if ann.timestamp else None,
            })
        
        from app.models import Asset
        asset_data = []
        if asset_ids_in_results:
            assets = services["session"].exec(
                select(Asset).where(Asset.id.in_(list(asset_ids_in_results)))
            ).all()
            for asset in assets:
                asset_data.append({
                    "id": asset.id,
                    "uuid": str(asset.uuid),
                    "title": asset.title,
                    "kind": asset.kind.value if asset.kind else None,
                    "infospace_id": asset.infospace_id,
                })
            logger.info(f"Fetched {len(asset_data)} assets for dashboard")
        
        schema_data = []
        for schema in schemas:
            output_contract = None
            if schema.output_contract:
                if hasattr(schema.output_contract, 'model_dump'):
                    output_contract = schema.output_contract.model_dump()
                elif isinstance(schema.output_contract, dict):
                    output_contract = schema.output_contract
                else:
                    try:
                        output_contract = dict(schema.output_contract)
                    except Exception as e:
                        logger.warning(f"Could not serialize output_contract for schema {schema.id}: {e}")
                        output_contract = None
            
            schema_data.append({
                "id": schema.id,
                "name": schema.name,
                "description": schema.description,
                "output_contract": output_contract,
            })
        
        logger.info(f"Serialized {len(schema_data)} schemas for run {run_id}")
        
        structured_result = {
            "run_id": run.id,
            "run_name": run.name,
            "run_uuid": str(run.uuid),
            "status": run.status.value,
            "created_at": run.created_at.isoformat() if run.created_at else None,
            "updated_at": run.updated_at.isoformat() if run.updated_at else None,
            "completed_at": run.completed_at.isoformat() if run.completed_at else None,
            "annotation_count": len(annotations),
            "annotations": annotation_data,
            "schemas": schema_data,
            "assets": asset_data,
            "views_config": run.views_config,
            "status_counts": status_counts,
        }
        
        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content=structured_result
        )
        
    except Exception as e:
        logger.error(f"Failed to get run dashboard: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to fetch dashboard: {str(e)}")],
            structured_content={"error": str(e), "status": "failed"}
        )


# ============================================================================
# ASSET CRUD HELPERS (for the asset() tool)
# ============================================================================

async def _asset_create(services: Dict, ctx: Context, data: Dict[str, Any], parent_asset_id: Optional[int]) -> ToolResult:
    """Create asset using AssetBuilder pattern."""
    from app.api.services.asset_builder import AssetBuilder
    from app.models import AssetKind

    kind = data.get("kind")
    if not kind:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'kind' field is required for asset creation")],
            structured_content={"error": "kind is required"}
        )

    try:
        # Convert string kind to enum
        asset_kind = AssetKind(kind)
    except ValueError:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Invalid asset kind: {kind}")],
            structured_content={"error": f"Invalid kind: {kind}"}
        )

    # Create builder
    builder = AssetBuilder(services["session"], services["user_id"], services["infospace_id"])

    # Route based on asset kind
    if asset_kind == AssetKind.CSV_ROW:
        return await _asset_create_csv_row(services, ctx, builder, data, parent_asset_id)
    elif asset_kind == AssetKind.ARTICLE:
        return await _asset_create_article(services, ctx, builder, data)
    elif asset_kind == AssetKind.WEB:
        return await _asset_create_web(services, ctx, builder, data)
    elif asset_kind == AssetKind.TEXT:
        return await _asset_create_text(services, ctx, builder, data)
    else:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Asset kind '{kind}' not supported for creation")],
            structured_content={"error": f"Unsupported kind: {kind}"}
        )


async def _asset_create_csv_row(services: Dict, ctx: Context, builder, data: Dict[str, Any], parent_asset_id: Optional[int]) -> ToolResult:
    """Create CSV row asset."""
    row_data = data.get("row_data")
    if not row_data:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Missing required field 'row_data' for CSV row creation\n\nRequired:\n- row_data (dict): Column-value pairs, e.g. {{'Name': 'Berlin Center', 'Address': '...'}}\n\nReceived data: {list(data.keys())}")],
            structured_content={
                "error": "missing_required_fields",
                "missing_fields": ["row_data"],
                "received_fields": list(data.keys()),
                "required_fields": ["row_data"],
                "hint": "row_data should be a dictionary with column names as keys"
            }
        )

    # Get parent CSV asset if parent_asset_id provided
    parent_asset = None
    if parent_asset_id:
        parent_asset = services["session"].get(Asset, parent_asset_id)
        if not parent_asset or parent_asset.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Parent asset #{parent_asset_id} not found or not accessible\n\nTroubleshooting:\n1. Verify the asset ID exists: workspace_hub(resource='assets', mode='load', ids=[{parent_asset_id}])\n2. Check if it's a CSV container: Should have kind='csv' and is_container=True\n3. Ensure it belongs to your infospace")],
                structured_content={
                    "error": "parent_asset_not_found",
                    "parent_asset_id": parent_asset_id,
                    "hint": "Parent must be a CSV container in your infospace"
                }
            )

    # Get column headers from parent if available
    column_headers = None
    if parent_asset and parent_asset.source_metadata.get("columns"):
        column_headers = parent_asset.source_metadata["columns"]

    # Build and create the CSV row
    if parent_asset_id:
        asset = await (builder
            .for_csv_row(
                row_data=row_data,
                column_headers=column_headers
            )
            .as_child_of(parent_asset_id)
            .build()
        )
    else:
        asset = await (builder
            .for_csv_row(
                row_data=row_data,
                column_headers=column_headers
            )
            .build()
        )

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ CSV Row #{asset.id}\n{asset.title}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value,
            "parent_asset_id": parent_asset_id,
            "row_data": row_data,
            "status": "created"
        }
    )


async def _asset_create_article(services: Dict, ctx: Context, builder, data: Dict[str, Any]) -> ToolResult:
    """Create article asset."""
    title = data.get("title")
    content = data.get("content")

    if not title or not content:
        missing_fields = []
        if not title:
            missing_fields.append("title")
        if not content:
            missing_fields.append("content")
        
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Missing required fields for article creation: {', '.join(missing_fields)}\n\nRequired:\n- title (string): Article headline\n- content (string): Article body text\n\nReceived data: {list(data.keys())}")],
            structured_content={
                "error": "missing_required_fields",
                "missing_fields": missing_fields,
                "received_fields": list(data.keys()),
                "required_fields": ["title", "content"]
            }
        )

    asset = await builder.from_article(title=title, content=content).build()

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Article #{asset.id}\n{asset.title}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value,
            "status": "created"
        }
    )


async def _asset_create_web(services: Dict, ctx: Context, builder, data: Dict[str, Any]) -> ToolResult:
    """Create web asset."""
    url = data.get("url")
    if not url:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'url' field is required for web asset creation")],
            structured_content={"error": "url is required"}
        )

    title = data.get("title")
    stub = data.get("stub", False)

    if stub:
        asset = await builder.from_url_stub(url, title).build()
    else:
        asset = await builder.from_url(url, title).build()

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Web #{asset.id}\n{asset.title}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value,
            "url": url,
            "stub": stub,
            "status": "created"
        }
    )


async def _asset_create_text(services: Dict, ctx: Context, builder, data: Dict[str, Any]) -> ToolResult:
    """Create text asset."""
    content = data.get("content")
    if not content:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'content' field is required for text asset creation")],
            structured_content={"error": "content is required"}
        )

    title = data.get("title")

    asset = await builder.from_text(content, title).build()

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Text #{asset.id}\n{asset.title}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value,
            "status": "created"
        }
    )


async def _asset_update(services: Dict, ctx: Context, data: Dict[str, Any]) -> ToolResult:
    """Update existing asset."""
    asset_id = data.get("id")
    if not asset_id:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'id' field is required for asset update")],
            structured_content={"error": "id is required"}
        )

    # Get existing asset
    from app.models import Asset
    asset = services["session"].get(Asset, asset_id)
    if not asset or asset.infospace_id != services["infospace_id"]:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Asset {asset_id} not found or not accessible")],
            structured_content={"error": "asset not found"}
        )

    # Handle CSV row updates specially
    if asset.kind == AssetKind.CSV_ROW:
        return await _asset_update_csv_row(services, ctx, asset, data)
    
    # Handle article/text/web updates
    elif asset.kind in [AssetKind.ARTICLE, AssetKind.TEXT, AssetKind.WEB]:
        return await _asset_update_content(services, ctx, asset, data)
    
    else:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Update not supported for asset kind: {asset.kind.value}")],
            structured_content={"error": f"Update not supported for kind: {asset.kind.value}"}
        )


async def _asset_update_content(services: Dict, ctx: Context, asset, data: Dict[str, Any]) -> ToolResult:
    """Update article/text/web asset content."""
    from app.schemas import AssetUpdate
    from app.models import AssetKind
    
    updates = data.get("updates", {})
    if not updates:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'updates' field is required for content asset update\n\nExample:\n  asset(operation='update', data={'id': 123, 'updates': {'title': 'New Title', 'text_content': 'New content...'}})")],
            structured_content={"error": "updates is required"}
        )
    
    # Build update dict - support both "content" (user-friendly) and "text_content" (database field)
    update_dict = {}
    if "title" in updates:
        update_dict["title"] = updates["title"]
    if "text_content" in updates:
        update_dict["text_content"] = updates["text_content"]
    elif "content" in updates:
        # Map "content" to "text_content" for database
        update_dict["text_content"] = updates["content"]
    if "source_metadata" in updates:
        update_dict["source_metadata"] = updates["source_metadata"]
    
    if not update_dict:
        return ToolResult(
            content=[TextContent(type="text", text="❌ No valid update fields provided. Supported: 'title', 'text_content' (or 'content'), 'source_metadata'")],
            structured_content={"error": "no valid updates"}
        )
    
    # Use AssetService to update
    asset_update = AssetUpdate(**update_dict)
    updated_asset = services["asset_service"].update_asset(asset.id, asset_update)
    
    if not updated_asset:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to update asset {asset.id}")],
            structured_content={"error": "update failed"}
        )
    
    # Return updated asset info
    updated_fields = list(update_dict.keys())
    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Updated {asset.kind.value} #{asset.id}\nTitle: {updated_asset.title}\nUpdated fields: {', '.join(updated_fields)}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": updated_asset.title,
            "asset_kind": asset.kind.value,
            "updated_fields": updated_fields,
            "text_content": updated_asset.text_content[:500] if updated_asset.text_content else None,  # Preview
            "status": "updated"
        }
    )


async def _asset_update_csv_row(services: Dict, ctx: Context, asset, data: Dict[str, Any]) -> ToolResult:
    """Update CSV row asset."""
    updates = data.get("updates")
    if not updates:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'updates' field is required for CSV row update")],
            structured_content={"error": "updates is required"}
        )

    # Create builder for update
    from app.api.services.asset_builder import AssetBuilder
    builder = AssetBuilder(services["session"], services["user_id"], services["infospace_id"])

    # Use update method
    merge_strategy = data.get("merge_strategy", "overwrite")
    updated_asset = await builder.update_csv_row(asset.id, updates, merge_strategy).build()

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Updated CSV Row #{asset.id}\n{updated_asset.title}")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": updated_asset.title,
            "updated_fields": list(updates.keys()),
            "merge_strategy": merge_strategy,
            "status": "updated"
        }
    )


async def _asset_delete(services: Dict, ctx: Context, data: Dict[str, Any]) -> ToolResult:
    """Delete asset."""
    asset_id = data.get("id")
    if not asset_id:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'id' field is required for asset deletion")],
            structured_content={"error": "id is required"}
        )

    # Delete using asset service (handles cascade)
    deleted = services["asset_service"].delete_asset(asset_id)

    if not deleted:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Asset {asset_id} not found or could not be deleted")],
            structured_content={"error": "asset not found or deletion failed"}
        )

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Deleted asset #{asset_id}")],
        structured_content={
            "asset_id": asset_id,
            "status": "deleted"
        }
    )




async def _analysis_share_run(
    services: Dict,
    ctx: Context,
    run_id: int,
    name: Optional[str],
    expiration_days: Optional[int],
) -> ToolResult:
    await ctx.info(f"Creating shareable link for run #{run_id}")
    
    try:
        from app.api.services.shareable_service import ShareableService
        from app.schemas import ShareableLinkCreate
        from datetime import timedelta
        
        shareable_service = ShareableService(services["session"])
        
        expiration_date = None
        if expiration_days:
            expiration_date = datetime.now(timezone.utc) + timedelta(days=expiration_days)
        
        link_create = ShareableLinkCreate(
            name=name or f"Shared: Run {run_id}",
            resource_type="run",
            resource_id=run_id,
            permission_level="read_only",
            is_public=True,
            expiration_date=expiration_date
        )
        
        link = shareable_service.create_shareable_link(
            services["user_id"],
            services["infospace_id"],
            link_create
        )
        
        services["session"].commit()
        
        share_url = f"{settings.FRONTEND_URL}/share/{link.token}"
        
        await ctx.info(f"Created shareable link: {share_url}")
        
        expiry_text = f"Expires: {expiration_date.strftime('%Y-%m-%d')}" if expiration_date else "Never expires"
        
        return ToolResult(
            content=[TextContent(type="text", text=f"🔗 Shareable link created!\n\n{share_url}\n\n{expiry_text}\n\nRecipients can view the dashboard and import the run into their workspace.")],
            structured_content={
                "share_url": share_url,
                "token": link.token,
                "link_id": link.id,
                "run_id": run_id,
                "expiration_date": expiration_date.isoformat() if expiration_date else None,
                "created_at": link.created_at.isoformat() if link.created_at else None
            }
        )
        
    except Exception as e:
        logger.error(f"Failed to create shareable link: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to create share link: {str(e)}")],
            structured_content={"error": str(e), "status": "failed"}
        )


# @mcp.tool
# async def analyze_assets(
#     asset_ids: Annotated[List[int], "List of asset IDs to analyze"],
#     schema_id: Annotated[int, "Annotation schema ID to use for analysis"],
#     ctx: Context,
#     custom_instructions: Annotated[Optional[str], "Custom instructions for the analysis"] = None,
# ) -> ToolResult:
#     """
#     Analyze assets using an annotation schema.
#     
#     Creates an annotation run that extracts structured information from
#     the specified assets according to the schema definition.
#     """
#     with get_services() as services:
#         validate_infospace_access(
#             services["session"], 
#             services["infospace_id"], 
#             services["user_id"]
#         )
#         
#         await ctx.info(f"Creating analysis run for {len(asset_ids)} assets")
#         
#         # Create annotation run
#         configuration = {}
#         if custom_instructions:
#             configuration["custom_instructions"] = custom_instructions
#         
#         run_create = AnnotationRunCreate(
#             name=f"Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
#             description=f"Analysis via chat: {custom_instructions}" if custom_instructions else "Analysis via chat",
#             schema_ids=[schema_id],
#             target_asset_ids=asset_ids,
#             configuration=configuration
#         )
#         
#         try:
#             run = services["annotation_service"].create_run(
#                 services["user_id"],
#                 services["infospace_id"],
#                 run_create
#             )
#             
#             summary = f"Started analysis run #{run.id} for {len(asset_ids)} assets using schema #{schema_id}"
#             
#             return ToolResult(
#                 content=[TextContent(type="text", text=summary)],
#                 structured_content={
#                     "run_id": run.id,
#                     "run_name": run.name,
#                     "schema_id": schema_id,
#                     "asset_count": len(asset_ids),
#                     "status": "started"
#                 }
#             )
#             
#         except Exception as e:
#             logger.error(f"Failed to create analysis run: {e}", exc_info=True)
#             return ToolResult(
#                 content=[TextContent(type="text", text=f"Failed to create analysis run: {str(e)}")],
#                 structured_content={"error": str(e), "status": "failed"}
#             )


async def _analysis_list_schemas(services: Dict, ctx: Context) -> ToolResult:
    await ctx.info("Listing annotation schemas")
    
    schemas = services["annotation_service"].list_schemas(
        services["infospace_id"]
    )
    
    summary = format_schema_summary(schemas)
    
    schema_data = []
    for schema in schemas:
        # Extract field count from output_contract
        field_count = 0
        if isinstance(schema.output_contract, dict):
            properties = schema.output_contract.get("properties", {})
            if properties:
                # Count fields in hierarchical structure
                if "document" in properties and isinstance(properties["document"], dict):
                    doc_props = properties["document"].get("properties", {})
                    field_count += len(doc_props) if doc_props else 0
                # Count per-modality fields
                for key, value in properties.items():
                    if key.startswith("per_") and isinstance(value, dict):
                        if value.get("type") == "array" and value.get("items", {}).get("type") == "object":
                            items_props = value.get("items", {}).get("properties", {})
                            field_count += len(items_props) if items_props else 0
                # If no hierarchical structure, count flat properties
                if field_count == 0:
                    field_count = len(properties)
        
        schema_data.append({
            "id": schema.id,
            "name": schema.name,
            "description": schema.description,
            "version": schema.version,
            "field_count": field_count,
            "output_contract": schema.output_contract if isinstance(schema.output_contract, dict) else None,
            "created_at": schema.created_at.isoformat() if schema.created_at else None,
        })
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "schemas": schema_data,
            "total": len(schemas)
        }
    )


async def _workspace_semantic_search(
    services: Dict,
    ctx: Context,
    queries: List[str],
    limit: int,
    asset_kinds: Optional[List[str]],
    bundle_id: Optional[int],
    parent_asset_id: Optional[int],
    date_from: Optional[str],
    date_to: Optional[str],
    combine_results: bool,
) -> ToolResult:
    """Internal helper that powers workspace_hub(mode='semantic')."""
    session = services["session"]
    infospace_id = services["infospace_id"]
    
    infospace = session.get(Infospace, infospace_id)
    if not infospace or not infospace.embedding_model:
        return ToolResult(
            content=[
                TextContent(
                    type="text",
                    text="❌ Semantic search not available: Infospace does not have embeddings configured.\n\n"
                         "To enable semantic search:\n"
                         "1. Configure an embedding model for this infospace\n"
                         "2. Generate embeddings for your assets\n"
                         "3. Retry workspace_hub(mode='semantic')"
                )
            ]
        )
    
    from datetime import datetime
    date_from_dt = None
    date_to_dt = None
    
    if date_from:
        try:
            date_from_dt = datetime.fromisoformat(date_from)
        except ValueError:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Invalid date_from format: {date_from}. Use ISO format (YYYY-MM-DD)")]
            )
    
    if date_to:
        try:
            date_to_dt = datetime.fromisoformat(date_to)
        except ValueError:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Invalid date_to format: {date_to}. Use ISO format (YYYY-MM-DD)")]
            )
    
    from app.models import AssetKind
    kinds = None
    if asset_kinds:
        try:
            kinds = [AssetKind(kind) for kind in asset_kinds]
        except ValueError as e:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Invalid asset kind: {e}")]
            )
    
    from app.api.services.vector_search_service import VectorSearchService
    search_service = VectorSearchService(session, runtime_api_keys=services["runtime_api_keys"])
    
    try:
        all_results = []
        query_results_map = {}
        
        for q in queries:
            results = await search_service.semantic_search(
                query_text=q,
                infospace_id=infospace_id,
                limit=limit,
                asset_kinds=kinds,
                date_from=date_from_dt,
                date_to=date_to_dt,
                bundle_id=bundle_id,
                parent_asset_id=parent_asset_id
            )
            query_results_map[q] = results
            all_results.extend(results)
        
        if len(queries) > 1 and combine_results:
            seen_chunks = {}
            for result in all_results:
                chunk_id = result.chunk_id
                if chunk_id not in seen_chunks or result.similarity > seen_chunks[chunk_id].similarity:
                    seen_chunks[chunk_id] = result
            results = sorted(seen_chunks.values(), key=lambda x: x.similarity, reverse=True)[:limit]
        else:
            results = all_results
        
        if not results:
            queries_str = "', '".join(queries)
            return ToolResult(
                content=[
                    TextContent(
                        type="text",
                        text=f"🔍 No results found for {'queries' if len(queries) > 1 else 'query'}: '{queries_str}'\n\n"
                             "Try:\n"
                             "- Using different search terms\n"
                             "- Removing filters\n"
                             "- Ensuring assets have embeddings"
                    )
                ]
            )
        
        if len(queries) > 1:
            queries_str = "', '".join(queries)
            output_lines = [f"🔍 Multi-Query Semantic Search Results"]
            output_lines.append(f"Queries: '{queries_str}'")
            output_lines.append(f"Found {len(results)} unique results (combined and deduplicated)\n" if combine_results else f"Found {len(results)} total results\n")
        else:
            output_lines = [f"🔍 Semantic Search Results for: '{queries[0]}'"]
            output_lines.append(f"Found {len(results)} results\n")
        
        structured_results = []
        
        for i, result in enumerate(results, 1):
            output_lines.append(f"## Result {i} (Similarity: {result.similarity:.3f})")
            output_lines.append(f"**Asset:** {result.asset_title} (ID: {result.asset_id})")
            output_lines.append(f"**Type:** {result.asset_kind}")
            output_lines.append(f"**Chunk:** #{result.chunk_index}")
            
            if result.chunk_metadata:
                if 'start_char' in result.chunk_metadata and 'end_char' in result.chunk_metadata:
                    output_lines.append(f"**Position:** chars {result.chunk_metadata['start_char']}-{result.chunk_metadata['end_char']}")
            
            text_preview = result.chunk_text[:300] + "..." if result.chunk_text and len(result.chunk_text) > 300 else (result.chunk_text or "")
            output_lines.append(f"**Content:**\n{text_preview}")
            output_lines.append("")
            
            structured_results.append({
                "rank": i,
                "similarity": round(result.similarity, 4),
                "distance": round(result.distance, 4),
                "asset_id": result.asset_id,
                "asset_uuid": result.asset_uuid,
                "asset_title": result.asset_title,
                "asset_kind": result.asset_kind.value if hasattr(result.asset_kind, 'value') else str(result.asset_kind),
                "chunk_id": result.chunk_id,
                "chunk_index": result.chunk_index,
                "chunk_text": result.chunk_text,
                "chunk_metadata": result.chunk_metadata
            })
        
        asset_ids = list(set(r.asset_id for r in results))
        output_lines.append(f"\n💡 **Tip:** Use workspace_hub(mode='load', ids={asset_ids[:5]}, depth='full') to pull full documents")
        
        return ToolResult(
            content=[TextContent(type="text", text="\n".join(output_lines))],
            structured_content={
                "queries": queries,
                "multi_query": len(queries) > 1,
                "combined": combine_results if len(queries) > 1 else False,
                "total_results": len(results),
                "results": structured_results,
                "asset_ids": asset_ids,
                "query_results_map": {q: len(query_results_map[q]) for q in queries} if len(queries) > 1 else None
            }
        )
    
    except Exception as e:
        logger.error(f"Semantic search failed: {e}", exc_info=True)
        return ToolResult(
            content=[
                TextContent(
                    type="text",
                    text=f"❌ Semantic search failed: {str(e)}\n\n"
                         "This might be because:\n"
                         "- No embeddings have been generated yet\n"
                         "- The embedding model is not available\n"
                         "- There was an error processing the query"
                )
            ]
        )


# @mcp.tool
# async def curate_asset_fragment(
#     asset_id: Annotated[int, "ID of the asset to curate"],
#     fragment_key: Annotated[str, "Key/name for the curated fragment"],
#     fragment_value: Annotated[str, "Value of the curated fragment"],
#     ctx: Context,
# ) -> ToolResult:
#     """
#     Save a curated fragment of information on an asset's metadata.
#     
#     Use this to highlight and preserve specific pieces of information
#     discovered during analysis. Creates an audit trail via annotation system.
#     """
#     with get_services() as services:
#         validate_infospace_access(
#             services["session"], 
#             services["infospace_id"], 
#             services["user_id"]
#         )
#         
#         await ctx.info(f"Curating fragment '{fragment_key}' on asset {asset_id}")
#         
#         try:
#             annotation = services["annotation_service"].curate_fragment(
#                 user_id=services["user_id"],
#                 infospace_id=services["infospace_id"],
#                 asset_id=asset_id,
#                 field_name=fragment_key,
#                 value=fragment_value
#             )
#             
#             summary = f"Curated fragment '{fragment_key}' on asset #{asset_id}"
#             
#             return ToolResult(
#                 content=[TextContent(type="text", text=summary)],
#                 structured_content={
#                     "asset_id": asset_id,
#                     "fragment_key": fragment_key,
#                     "fragment_value": fragment_value,
#                     "annotation_id": annotation.id,
#                     "run_id": annotation.run_id,
#                     "status": "curated"
#                 }
#             )
#             
#         except Exception as e:
#             logger.error(f"Failed to curate fragment: {e}", exc_info=True)
#             return ToolResult(
#                 content=[TextContent(type="text", text=f"Failed to curate fragment: {str(e)}")],
#                 structured_content={"error": str(e), "status": "failed"}
#             )


# ============================================================================
# RESOURCES: READ-ONLY DATA ACCESS
# ============================================================================

@mcp.resource("intelligence://assets/{asset_id}")
async def get_asset_details(asset_id: int, ctx: Context) -> dict:
    """
    Get full details for a specific asset including complete text content.
    
    Use this when you need the full content of an asset for detailed analysis.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        from app.models import Asset
        asset = services["session"].get(Asset, asset_id)
        
        if not asset or asset.infospace_id != services["infospace_id"]:
            raise ValueError(f"Asset {asset_id} not found")
        
        return {
            "id": asset.id,
            "title": asset.title,
            "kind": asset.kind.value,
            "text_content": asset.text_content,  # Full content (no truncation)
            "source_identifier": asset.source_identifier,
            "source_metadata": asset.source_metadata,
            "created_at": asset.created_at.isoformat() if asset.created_at else None,
            "event_timestamp": asset.event_timestamp.isoformat() if asset.event_timestamp else None,
            "processing_status": asset.processing_status.value if asset.processing_status else None,
        }


@mcp.resource("intelligence://assets/{asset_id}/annotations")
async def get_asset_annotations(
    asset_id: int,
    ctx: Context,
    schema_ids: Optional[str] = None  # Comma-separated string
) -> List[dict]:
    """
    Get annotations for a specific asset.
    
    Optionally filter by schema IDs (comma-separated).
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        from sqlmodel import select, and_
        from app.models import Annotation
        
        query_conditions = [
            Annotation.infospace_id == services["infospace_id"],
            Annotation.asset_id == asset_id
        ]
        
        if schema_ids:
            schema_id_list = [int(sid.strip()) for sid in schema_ids.split(",")]
            query_conditions.append(Annotation.schema_id.in_(schema_id_list))
        
        annotations = services["session"].exec(
            select(Annotation).where(and_(*query_conditions))
        ).all()
        
        return [
            {
                "id": ann.id,
                "asset_id": ann.asset_id,
                "schema_id": ann.schema_id,
                "value": ann.value,
                "status": ann.status.value if ann.status else None,
                "timestamp": ann.timestamp.isoformat() if ann.timestamp else None,
            }
            for ann in annotations
        ]


# ============================================================================
# SERVER LIFECYCLE
# ============================================================================

if __name__ == "__main__":
    mcp.run(stateless_http=True)


