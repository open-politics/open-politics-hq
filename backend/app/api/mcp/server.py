"""
FastMCP Intelligence Analysis Server
====================================

Clean, production-ready MCP server implementing elegant content separation patterns:

DESIGN PATTERNS:
--------------
1. **ToolResult with Dual Content Streams**
   - Traditional content: Concise summaries for model context (~200-500 chars)
   - Structured content: Full rich data for frontend rendering
   
2. **XML Marker Pattern for Results**
   - Model writes: <tool_results id="exec_123" format="default" />
   - System expands: Formatted results from structured_content
   - Benefits: 80-90% token savings, consistent formatting, rich interactivity
   
3. **Preview Truncation**
   - Asset text_content: Max 500 characters in responses
   - Search snippets: Keep original short snippets
   - Full content: Available in structured_content for frontend
   
4. **Two-Step Search Pattern**
   - Step 1: search_web → User reviews in UI → Selects items
   - Step 2: ingest_urls → Creates permanent assets from selections
   - Benefit: User control, no premature asset creation

ADDING NEW TOOLS:
----------------
1. Use ToolResult for return value
2. Create concise text summary (use format_* helpers)
3. Include full data in structured_content
4. Add tool to appropriate category section
5. Document parameters with Field() descriptions
6. Follow naming conventions: verb_noun (e.g., search_assets, create_bundle)

Example Tool Pattern:
--------------------
```python
@mcp.tool
async def example_tool(
    param: Annotated[str, "Parameter description"],
    ctx: Context
) -> ToolResult:
    \"\"\"One-line tool description.\"\"\"
    
    # Execute logic
    data = await do_something(param)
    
    # Concise summary for model
    summary = format_example_summary(data)
    
    # Full data for frontend
    structured_data = {
        "items": data,
        "total": len(data),
        "metadata": {...}
    }
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content=structured_data
    )
```

# New Method

list = type[bundles, assetts
amouont = literal[filestree, titles, titlefirst10, full]
navigate
xy
z
"""

import logging
from typing import List, Optional, Any, Dict, Union
from datetime import datetime, timezone
from fastmcp import FastMCP, Context
from fastmcp.tools.tool import ToolResult
from mcp.types import TextContent

from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings
from app.api.providers.factory import create_storage_provider, create_model_registry
from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.bundle_service import BundleService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.models import AssetKind, Infospace
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

    if not user_id or not infospace_id:
        raise PermissionError("Invalid authentication token")

    # Initialize database session
    from app.core.db import engine
    from sqlmodel import Session
        
    session = Session(engine)
    
    try:
        # Initialize core services
        storage_provider = create_storage_provider(settings)
        asset_service = AssetService(session, storage_provider)
        model_registry = create_model_registry(settings)
        annotation_service = AnnotationService(session, model_registry, asset_service)
        content_ingestion_service = ContentIngestionService(session)
        bundle_service = BundleService(session)
                
        yield {
            "session": session,
            "user_id": user_id,
            "infospace_id": infospace_id,
                    "asset_service": asset_service,
                    "annotation_service": annotation_service,
            "content_ingestion_service": content_ingestion_service,
                    "bundle_service": bundle_service,
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


def format_schema_summary(schemas: List[Any]) -> str:
    """Format list of annotation schemas as concise summary."""
    if not schemas:
        return "No annotation schemas found in this infospace."
    
    lines = [f"Found {len(schemas)} annotation schemas:\n"]
    
    for schema in schemas:
        lines.append(f"• [{schema.id}] {schema.name} (v{schema.version})")
        if schema.description:
            lines.append(f"  {truncate_text(schema.description, 100)}")
            field_descriptions = [f"  {field.name}: {field.description}" for field in schema.output_contract.fields]
            lines.append(f"  {field_descriptions}")
        else:
            field_descriptions = [f"  {field.name}: {field.description}" for field in schema.output_contract.fields]
            lines.append(f"  {field_descriptions}")
        lines.append("")
    
    return "\n".join(lines)


# ============================================================================
# CATEGORY: NAVIGATION & DISCOVERY
# ============================================================================

@mcp.tool
async def navigate(
    resource: Annotated[str, "Type of resource: 'assets' (documents), 'bundles' (collections), 'schemas' (analysis templates), 'runs' (analysis jobs)"],
    ctx: Context,
    mode: Annotated[str, "How to access: 'list' (browse all), 'search' (find by query), 'load' (get specific IDs)"] = "list",
    depth: Annotated[str, "Information detail: 'ids' (just IDs), 'titles' (names and basic info), 'previews' (with text excerpts), 'full' (complete content)"] = "titles",
    ids: Annotated[Optional[List[int]], "Specific resource IDs to retrieve (required when mode='load')"] = None,
    query: Annotated[Optional[str], "Search terms to find resources (required when mode='search')"] = None,
    search_method: Annotated[str, "Search approach: 'hybrid' (keyword + semantic), 'semantic' (meaning-based), 'text' (exact keyword matching)"] = "hybrid",
    filters: Annotated[Optional[Dict[str, Any]], "Additional constraints (e.g., {'asset_kinds': ['pdf', 'web']})"] = None,
    limit: Annotated[int, "Maximum number of items to return"] = 40,
    offset: Annotated[int, "Number of items to skip (for pagination)"] = 0,
) -> ToolResult:
    """
    Explore and discover workspace resources with flexible control over what you retrieve and how much detail you see.
    
    Use this to:
    - Discover what documents, collections, or analyses exist
    - Search for content relevant to your research question
    - Load specific items when you know their IDs
    - Control information depth to balance speed and detail
    
    <common_patterns>
    Starting research:
      navigate(resource="bundles", depth="titles")
      # See what collections exist before diving in
    
    Finding relevant documents:
      navigate(resource="assets", mode="search", query="climate policy", search_method="hybrid")
      # Combines keyword and semantic search for best results
    
    Examining a collection:
      navigate(resource="bundles", mode="load", ids=[4], depth="previews")
      # See previews of all documents in bundle #4
    
    Reading full content:
      navigate(resource="assets", mode="load", ids=[123, 124], depth="full")
      # Get complete text of specific documents
    </common_patterns>
    
    Performance tip: Start with depth="titles" to get a quick overview, then use mode="load" with specific IDs to read full content only when needed.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"],
            services["infospace_id"],
            services["user_id"]
        )
        
        await ctx.info(f"Navigate: resource={resource}, mode={mode}, depth={depth}")
        
        # Route to appropriate handler
        if resource == "assets":
            return await _navigate_assets(services, ctx, mode, depth, ids, query, search_method, filters, limit, offset)
        elif resource == "bundles":
            return await _navigate_bundles(services, ctx, mode, depth, ids, limit, offset)
        elif resource == "schemas":
            return await _navigate_schemas(services, ctx, mode, depth, ids, limit, offset)
        elif resource == "runs":
            return await _navigate_runs(services, ctx, mode, depth, ids, limit, offset)
        else:
            return ToolResult(
                content=[TextContent(type="text", text=f"Unknown resource type: {resource}")],
                structured_content={"error": f"Unknown resource: {resource}"}
            )


async def _navigate_assets(services: Dict, ctx: Context, mode: str, depth: str, 
                           ids: Optional[List[int]], query: Optional[str], 
                           search_method: str, filters: Optional[Dict], 
                           limit: int, offset: int) -> ToolResult:
    """Navigate assets: search or load specific ones."""
    
    if mode == "load" and ids:
        # Load specific assets by ID
        from sqlmodel import select
        from app.models import Asset
        
        assets = services["session"].exec(
            select(Asset)
            .where(Asset.id.in_(ids))
            .where(Asset.infospace_id == services["infospace_id"])
            .limit(limit)
        ).all()
        
        await ctx.info(f"Loaded {len(assets)} assets")
        
    elif mode == "search" and query:
        # Search assets
        asset_kinds_enum = []
        if filters and filters.get("asset_kinds"):
            asset_kinds_enum = [AssetKind(kind) for kind in filters["asset_kinds"]]
        
        distance_threshold = filters.get("distance_threshold", 0.8) if filters else 0.8
        
        assets = await services["asset_service"].search_assets(
            user_id=services["user_id"],
            infospace_id=services["infospace_id"],
            query=query,
            search_method=search_method,
            asset_kinds=asset_kinds_enum,
            limit=limit,
            distance_threshold=distance_threshold
        )
        
        await ctx.info(f"Found {len(assets)} assets matching '{query}'")
        
    else:
        # List all assets (rarely used, generally search is better)
        from sqlmodel import select
        from app.models import Asset
        
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
    
    # Format based on depth
    asset_data = []
    for asset in assets:
        item = {"id": asset.id, "title": asset.title}
        
        if depth in ["titles", "previews", "full"]:
            item.update({
                "kind": asset.kind.value,
                "source_identifier": asset.source_identifier,
                "created_at": asset.created_at.isoformat() if asset.created_at else None,
                "updated_at": asset.updated_at.isoformat() if asset.updated_at else None,
            })
        
        if depth in ["previews", "full"]:
            preview_length = 200 if depth == "previews" else None
            item["text_content"] = truncate_text(asset.text_content or "", preview_length) if preview_length else asset.text_content
            item["source_metadata"] = asset.source_metadata
        
        asset_data.append(item)
    
    # Build concise summary for model
    if mode == "search":
        summary_lines = [f"🔍 Found {len(assets)} assets matching '{query}':\n"]
    else:
        summary_lines = [f"📄 {len(assets)} assets:\n"]
    
    for i, asset in enumerate(assets[:5], 1):
        summary_lines.append(f"[{asset.id}] {asset.title}")
        if depth == "previews":
            preview = truncate_text(asset.text_content or "", 80)
            if preview:
                summary_lines.append(f"    {preview}")
    
    if len(assets) > 5:
        summary_lines.append(f"\n... {len(assets) - 5} more assets")
    
    summary_lines.append(f"\n→ Load details: navigate(resource='assets', mode='load', ids=[...], depth='full')")
    
    return ToolResult(
        content=[TextContent(type="text", text="\n".join(summary_lines))],
        structured_content={
            "resource": "assets",
            "mode": mode,
            "depth": depth,
            "items": asset_data,
            "total": len(assets),
            "query": query,
            "message": f"Found {len(assets)} assets"
        }
    )


async def _navigate_bundles(services: Dict, ctx: Context, mode: str, depth: str,
                            ids: Optional[List[int]], limit: int, offset: int) -> ToolResult:
    """Navigate bundles: list all or load specific ones with their assets."""
    from sqlmodel import select
    from app.models import Bundle
    
    if mode == "load" and ids:
        # Load specific bundles with their assets
        bundle_data = {}
        
        for bundle_id in ids:
            bundle = services["session"].get(Bundle, bundle_id)
            if not bundle or bundle.infospace_id != services["infospace_id"]:
                continue
            
            # Get assets in bundle based on depth
            asset_limit = 10 if depth == "titles" else (100 if depth == "previews" else None)
            assets = services["bundle_service"].get_assets_for_bundle(
                bundle_id=bundle_id,
                infospace_id=services["infospace_id"],
                user_id=services["user_id"],
                limit=asset_limit or 1000
            )
            
            # Format assets based on depth
            formatted_assets = []
            for asset in assets:
                item = {"id": asset.id, "title": asset.title, "kind": asset.kind.value}
                
                if depth in ["previews", "full"]:
                    preview_length = 200 if depth == "previews" else None
                    item["text_content"] = truncate_text(asset.text_content or "", preview_length) if preview_length else asset.text_content
                    item["source_metadata"] = asset.source_metadata
                    item["updated_at"] = asset.updated_at.isoformat() if asset.updated_at else None
                
                formatted_assets.append(item)
            
            bundle_data[str(bundle_id)] = {
                "bundle_id": bundle.id,
                "bundle_name": bundle.name,
                "bundle_description": bundle.description,
                "asset_count": bundle.asset_count,
                "assets": formatted_assets,
                "created_at": bundle.created_at.isoformat() if bundle.created_at else None,
            }
        
        await ctx.info(f"Loaded {len(bundle_data)} bundles")
        
        # Build summary
        summary_lines = []
        for bid, data in bundle_data.items():
            summary_lines.append(f"\n📦 [{bid}] {data['bundle_name']}")
            summary_lines.append(f"    {data['bundle_description'] or 'No description'}")
            summary_lines.append(f"    {data['asset_count']} assets\n")
            
            for i, asset in enumerate(data['assets'][:3], 1):
                summary_lines.append(f"    [{asset['id']}] {asset['title']}")
            
            if len(data['assets']) > 3:
                summary_lines.append(f"    ... {len(data['assets']) - 3} more")
        
        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={
                "resource": "bundles",
                "mode": "load",
                "depth": depth,
                "bundle_data": bundle_data,
                "total": len(bundle_data),
                "message": f"Loaded {len(bundle_data)} bundles"
            }
        )
    
    else:
        # List all bundles
        bundles = services["session"].exec(
            select(Bundle)
            .where(Bundle.infospace_id == services["infospace_id"])
            .offset(offset)
            .limit(limit)
        ).all()
        
        await ctx.info(f"Listed {len(bundles)} bundles")
        
        # Format based on depth
        bundle_list = []
        for bundle in bundles:
            item = {"id": bundle.id, "name": bundle.name}
            
            if depth in ["titles", "previews", "full"]:
                item.update({
                    "description": bundle.description,
                    "asset_count": bundle.asset_count,
                    "created_at": bundle.created_at.isoformat() if bundle.created_at else None,
                })
            
            bundle_list.append(item)
        
        # Build summary
        summary_lines = [f"📦 {len(bundles)} bundles:\n"]
        for bundle in bundles[:8]:
            summary_lines.append(f"[{bundle.id}] {bundle.name}")
            summary_lines.append(f"    {bundle.asset_count} assets | {bundle.description or 'No description'}")
        
        if len(bundles) > 8:
            summary_lines.append(f"\n... {len(bundles) - 8} more")
        
        summary_lines.append(f"\n→ Load contents: navigate(resource='bundles', mode='load', ids=[...], depth='previews')")
        
        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={
                "resource": "bundles",
                "mode": "list",
                "depth": depth,
                "items": bundle_list,
                "total": len(bundles),
                "message": f"Found {len(bundles)} bundles"
            }
        )


async def _navigate_schemas(services: Dict, ctx: Context, mode: str, depth: str,
                            ids: Optional[List[int]], limit: int, offset: int) -> ToolResult:
    """Navigate annotation schemas."""
    
    schemas = services["annotation_service"].list_schemas(
        services["user_id"],
        services["infospace_id"],
        active_only=True
    )
    
    # Filter by IDs if mode=load
    if mode == "load" and ids:
        schemas = [s for s in schemas if s.id in ids]
    
    # Apply pagination
    schemas = schemas[offset:offset + limit]
    
    # Format based on depth
    schema_list = []
    for schema in schemas:
        item = {"id": schema.id, "name": schema.name}
        
        if depth in ["titles", "previews", "full"]:
            item.update({
                "description": schema.description,
                "version": schema.version,
                "created_at": schema.created_at.isoformat() if schema.created_at else None,
            })
        
        if depth in ["full"]:
            # Include field definitions
            item["fields"] = [
                {"name": f.name, "type": f.type, "description": f.description}
                for f in schema.output_contract.fields
            ]
        
        schema_list.append(item)
    
    # Build summary
    summary_lines = [f"📋 {len(schemas)} annotation schemas:\n"]
    for schema in schemas:
        summary_lines.append(f"[{schema.id}] {schema.name} (v{schema.version})")
        if schema.description:
            summary_lines.append(f"    {truncate_text(schema.description, 80)}")
    
    return ToolResult(
        content=[TextContent(type="text", text="\n".join(summary_lines))],
        structured_content={
            "resource": "schemas",
            "mode": mode,
            "depth": depth,
            "items": schema_list,
            "total": len(schemas),
            "message": f"Found {len(schemas)} schemas"
        }
    )


async def _navigate_runs(services: Dict, ctx: Context, mode: str, depth: str,
                        ids: Optional[List[int]], limit: int, offset: int) -> ToolResult:
    """Navigate annotation runs."""
    from sqlmodel import select
    from app.models import AnnotationRun
    
    query_stmt = select(AnnotationRun).where(
        AnnotationRun.infospace_id == services["infospace_id"]
    )
    
    if mode == "load" and ids:
        query_stmt = query_stmt.where(AnnotationRun.id.in_(ids))
    
    runs = services["session"].exec(
        query_stmt.offset(offset).limit(limit)
    ).all()
    
    # Format based on depth
    run_list = []
    for run in runs:
        item = {"id": run.id, "name": run.name}
        
        if depth in ["titles", "previews", "full"]:
            item.update({
                "description": run.description,
                "status": run.status.value if run.status else None,
                "created_at": run.created_at.isoformat() if run.created_at else None,
            })
        
        run_list.append(item)
    
    # Build summary
    summary_lines = [f"🔬 {len(runs)} annotation runs:\n"]
    for run in runs[:5]:
        summary_lines.append(f"[{run.id}] {run.name}")
        summary_lines.append(f"    Status: {run.status.value if run.status else 'unknown'}")
    
    if len(runs) > 5:
        summary_lines.append(f"\n... {len(runs) - 5} more")
    
    return ToolResult(
        content=[TextContent(type="text", text="\n".join(summary_lines))],
        structured_content={
            "resource": "runs",
            "mode": mode,
            "depth": depth,
            "items": run_list,
            "total": len(runs),
            "message": f"Found {len(runs)} runs"
        }
    )


@mcp.tool
async def search_web(
    query: Annotated[str, "What to search for (e.g., 'recent climate legislation in Europe')"],
    ctx: Context,
    provider: Annotated[str, "Search service: 'tavily' (default, recommended)"] = "tavily",
    max_results: Annotated[int, "Number of results to return (1-10 for basic, up to 50 for advanced)"] = 10,
    include_domains: Annotated[Optional[List[str]], "Only search these domains (e.g., ['gov.uk', 'parliament.uk'])"] = None,
    exclude_domains: Annotated[Optional[List[str]], "Skip these domains (e.g., ['twitter.com', 'facebook.com'])"] = None,
    search_depth: Annotated[str, "Result quality: 'basic' (faster) or 'advanced' (more thorough)"] = "basic",
) -> ToolResult:
    """
    Find new information from the web when workspace documents don't contain what you need.
    
    Use this to:
    - Research current events or recent developments
    - Find expert sources and official documents
    - Gather diverse perspectives on a topic
    - Locate specific facts or statistics
    
    Important: This only searches and returns results—it does NOT save anything yet.
    After reviewing results, use ingest_urls() to save selected items as permanent documents.
    
    <workflow>
    Step 1 - Search:
      search_web(query="2024 renewable energy policy EU")
      # Returns preview of web results
    
    Step 2 - Review results in UI (user selects which ones matter)
    
    Step 3 - Save selections:
      ingest_urls(urls=["https://example.com/doc1", "https://example.com/doc2"])
      # Creates permanent documents from chosen results
    </workflow>
    
    <examples>
    Broad research:
      search_web(query="carbon pricing mechanisms 2024", max_results=10)
    
    Targeted to trusted sources:
      search_web(query="IPCC climate report", include_domains=["ipcc.ch", "unfccc.int"])
    
    Excluding noise:
      search_web(query="vaccine efficacy studies", exclude_domains=["twitter.com", "reddit.com"])
    </examples>
    
    Tip: Use search_depth="advanced" for complex topics where you need more comprehensive results.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        await ctx.info(f"Searching web: query='{query}', provider={provider}")
        
        # Normalize provider name to lowercase for registry lookup
        provider_normalized = provider.lower()
        
        # Extract API key from JWT token claims (passed from frontend)
        access_token: AccessToken = get_access_token()
        api_key = None
        if access_token and access_token.claims:
            api_keys = access_token.claims.get('api_keys', {})
            if isinstance(api_keys, dict):
                if provider_normalized == 'tavily':
                    api_key = api_keys.get('tavily') or api_keys.get('TAVILY_API_KEY')
                elif provider_normalized == 'opol':
                    api_key = api_keys.get('opol') or api_keys.get('OPOL_API_KEY')
        
        # Initialize search provider
        from app.api.providers.search_registry import SearchProviderRegistryService
        search_registry = SearchProviderRegistryService()
        
        try:
            search_provider = search_registry.create_provider(provider_normalized, api_key)
        except Exception as e:
            return ToolResult(
                content=[TextContent(type="text", text=f"Error: Could not initialize {provider} search provider: {str(e)}")],
                structured_content={"error": str(e), "status": "failed"}
            )
        
        # Build search parameters
        search_params = {
            "limit": max_results,
            "search_depth": search_depth,
        }
        
        if include_domains:
            search_params['include_domains'] = include_domains
        if exclude_domains:
            search_params['exclude_domains'] = exclude_domains
        
        # Execute search
        try:
            raw_results = await search_provider.search(
                query=query,
                **search_params
            )
        except Exception as e:
            logger.error(f"Search failed: {e}", exc_info=True)
            return ToolResult(
                content=[TextContent(type="text", text=f"Search failed: {str(e)}")],
                structured_content={"error": str(e), "status": "failed"}
            )
        
        # Concise summary for model
        search_items_summary = format_search_summary(raw_results, query)

        # Add summary answer if available
        summary = search_items_summary
        if raw_results and "raw" in raw_results[0] and "summary_answer" in raw_results[0]["raw"]:
            summary_answer = raw_results[0]["raw"]["summary_answer"]
            summary = f"{summary_answer}\n\n{search_items_summary}"
        
        # Full structured data for frontend
        search_results_data = [
            {
                "title": result.get("title", ""),
                "url": result.get("url", ""),
                "content": result.get("content", ""),  # Short snippet
                "text_content": result.get("raw_content"),  # Full article if available
                "score": result.get("score"),
                "provider": provider,
                "source_metadata": {
                    "search_query": query,
                    "search_provider": provider,
                    "search_score": result.get("score"),
                    "published_date": result.get("published_date"),
                    "favicon": result.get("favicon"),
                    "tavily_images": result.get("images", []),
                }
            }
            for result in raw_results
        ]
        
        await ctx.info(f"Found {len(raw_results)} results")
        
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "query": query,
                "provider": provider,
                "results": search_results_data,
                "total_found": len(raw_results),
                "message": f"Found {len(raw_results)} results. Review them and use ingest_urls to save specific items."
            }
        )


# ============================================================================
# CATEGORY: CONTENT INGESTION
# ============================================================================

@mcp.tool
async def ingest_urls(
    urls: Annotated[List[str], "Web addresses to save as permanent documents (e.g., ['https://example.com/article1', 'https://example.com/doc2'])"],
    ctx: Context,
    bundle_id: Annotated[Optional[int], "Collection ID to add these documents to (optional, can organize later)"] = None,
    scrape_content: Annotated[bool, "Extract full text content from pages (recommended: True)"] = True,
) -> ToolResult:
    """
    Convert web pages into permanent documents that become part of your workspace.
    
    Use this after search_web() to save selected results, or anytime you want to add specific web content to your research.
    
    What happens:
    - Fetches and extracts content from each URL
    - Creates a new document (asset) for each page
    - Optionally adds all documents to a specified collection (bundle)
    - Makes content searchable and available for analysis
    
    <workflow>
    After web search:
      1. search_web(query="climate policy")
      2. User reviews results in UI
      3. ingest_urls(urls=["url1", "url2", "url3"], bundle_id=5)
    
    Direct addition:
      ingest_urls(
        urls=["https://ipcc.ch/report-2024", "https://unfccc.int/news"],
        bundle_id=8
      )
    </workflow>
    
    <examples>
    Save search results to new collection:
      organize(operation="create", name="Climate Reports 2024")
      # Returns bundle_id: 12
      ingest_urls(urls=["url1", "url2"], bundle_id=12)
    
    Add to existing collection:
      ingest_urls(urls=["https://example.com/doc"], bundle_id=5)
    
    Ingest without organizing yet:
      ingest_urls(urls=["url1", "url2"])
      # Can add to bundle later with organize()
    </examples>
    
    Note: Failed URLs are reported but don't stop processing of successful ones.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        await ctx.info(f"Ingesting {len(urls)} URLs (scrape={scrape_content})")
        
        created_assets = []
        failed_urls = []
        
        for url in urls:
            try:
                # Use the unified ingestion service
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
        
        # Commit the database session
        services["session"].commit()
        
        # Build summary
        summary_lines = [f"Successfully ingested {len(created_assets)} assets from {len(urls)} URLs"]
        
        if bundle_id:
            summary_lines.append(f"Added to bundle #{bundle_id}")
        
        if failed_urls:
            summary_lines.append(f"\nFailed to ingest {len(failed_urls)} URLs:")
            for url in failed_urls[:3]:
                summary_lines.append(f"  • {url}")
            if len(failed_urls) > 3:
                summary_lines.append(f"  ... and {len(failed_urls) - 3} more")
        
        summary_lines.append(f"\nCreated asset IDs: {[a.id for a in created_assets]}")
        
        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={
                "assets_created": len(created_assets),
                "asset_ids": [asset.id for asset in created_assets],
                "urls_processed": len(urls),
                "urls_failed": len(failed_urls),
                "failed_urls": failed_urls,
                "bundle_id": bundle_id,
                "status": "success" if not failed_urls else "partial_success"
            }
        )


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

@mcp.tool
async def organize(
    operation: Annotated[str, "What to do: 'create' (new collection), 'add' (documents to collection), 'remove' (documents from collection), 'rename' (update collection), 'delete' (remove collection)"],
    ctx: Context,
    bundle_id: Annotated[Optional[int], "Which collection to modify (required for add/remove/rename/delete)"] = None,
    asset_ids: Annotated[Optional[List[int]], "Document IDs to add or remove (list of integers)"] = None,
    name: Annotated[Optional[str], "Collection name (required for create, optional for rename)"] = None,
    description: Annotated[Optional[str], "What this collection is about (optional, helps track purpose)"] = None,
) -> ToolResult:
    """
    Manage document collections (bundles) to organize your research materials.
    
    Use this to:
    - Group related documents together
    - Organize documents by topic, source, or research phase
    - Maintain clean separation between different research areas
    - Track which documents you've selected for specific analyses
    
    <operations>
    create - Start a new collection:
      organize(operation="create", name="2024 Climate Reports", description="Recent policy documents")
      # Can include initial documents with asset_ids=[1,2,3]
    
    add - Put documents into a collection:
      organize(operation="add", bundle_id=4, asset_ids=[5,6,7])
      # Adds documents 5, 6, 7 to collection 4
    
    remove - Take documents out of a collection:
      organize(operation="remove", bundle_id=4, asset_ids=[5])
      # Removes document 5 from collection 4 (doesn't delete document)
    
    rename - Update collection details:
      organize(operation="rename", bundle_id=4, name="Updated Name", description="New focus area")
    
    delete - Remove entire collection:
      organize(operation="delete", bundle_id=4)
      # Deletes collection but keeps all documents
    </operations>
    
    <examples>
    Research workflow:
      1. navigate(resource="assets", mode="search", query="carbon tax")
      2. organize(operation="create", name="Carbon Tax Research", asset_ids=[10,11,12])
      3. search_web(query="recent carbon tax news")
      4. ingest_urls(urls=["url1", "url2"], bundle_id=15)
    
    Organizing after search:
      navigate(resource="assets", mode="search", query="renewable energy")
      # Found assets: 20, 21, 22, 23
      organize(operation="create", name="Renewable Energy", asset_ids=[20,21,22,23])
    
    Adding to existing:
      organize(operation="add", bundle_id=8, asset_ids=[30,31])
    </examples>
    
    Tip: Collections help you work with groups of documents without searching repeatedly.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"],
            services["infospace_id"],
            services["user_id"]
        )
        
        await ctx.info(f"Organize: operation={operation}, bundle_id={bundle_id}")
        
        try:
            if operation == "create":
                return await _organize_create(services, ctx, name, description, asset_ids)
            elif operation == "add":
                return await _organize_add(services, ctx, bundle_id, asset_ids)
            elif operation == "remove":
                return await _organize_remove(services, ctx, bundle_id, asset_ids)
            elif operation == "rename":
                return await _organize_rename(services, ctx, bundle_id, name, description)
            elif operation == "delete":
                return await _organize_delete(services, ctx, bundle_id)
            else:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Unknown operation: {operation}")],
                    structured_content={"error": f"Unknown operation: {operation}"}
                )
        except Exception as e:
            logger.error(f"Organize operation failed: {e}", exc_info=True)
            return ToolResult(
                content=[TextContent(type="text", text=f"Operation failed: {str(e)}")],
                structured_content={"error": str(e), "status": "failed"}
            )


async def _organize_create(services: Dict, ctx: Context, name: Optional[str], 
                          description: Optional[str], asset_ids: Optional[List[int]]) -> ToolResult:
    """Create a new bundle."""
    if not name:
        return ToolResult(
            content=[TextContent(type="text", text="Bundle name is required for create operation")],
            structured_content={"error": "name is required"}
        )
    
    from app.schemas import BundleCreate
    
    bundle_create = BundleCreate(
        name=name,
        description=description,
        infospace_id=services["infospace_id"],
        user_id=services["user_id"]
    )
    
    bundle = services["bundle_service"].create_bundle(
        bundle_create,
        services["user_id"],
        services["infospace_id"]
    )
    
    # Add initial assets if provided
    assets_added = 0
    if asset_ids:
        for asset_id in asset_ids:
            try:
                services["bundle_service"].add_asset_to_bundle(
                    bundle_id=bundle.id,
                    asset_id=asset_id,
                    infospace_id=services["infospace_id"],
                    user_id=services["user_id"],
                    include_child_assets=True
                )
                assets_added += 1
            except Exception as e:
                logger.warning(f"Failed to add asset {asset_id}: {e}")
    
    services["session"].commit()
    
    await ctx.info(f"Created bundle #{bundle.id} with {assets_added} assets")
    
    summary = f"✅ Created bundle '{name}' (ID: {bundle.id})"
    if assets_added:
        summary += f"\n   Added {assets_added} assets"
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "operation": "create",
            "bundle_id": bundle.id,
            "bundle_name": bundle.name,
            "assets_added": assets_added,
            "status": "success"
        }
    )


async def _organize_add(services: Dict, ctx: Context, bundle_id: Optional[int], 
                       asset_ids: Optional[List[int]]) -> ToolResult:
    """Add assets to an existing bundle."""
    if not bundle_id:
        return ToolResult(
            content=[TextContent(type="text", text="bundle_id is required for add operation")],
            structured_content={"error": "bundle_id is required"}
        )
    
    if not asset_ids:
        return ToolResult(
            content=[TextContent(type="text", text="asset_ids is required for add operation")],
            structured_content={"error": "asset_ids is required"}
        )
    
    added_count = 0
    failed_count = 0
    
    for asset_id in asset_ids:
        try:
            services["bundle_service"].add_asset_to_bundle(
                bundle_id=bundle_id,
                asset_id=asset_id,
                infospace_id=services["infospace_id"],
                user_id=services["user_id"],
                include_child_assets=True
            )
            added_count += 1
        except Exception as e:
            logger.warning(f"Failed to add asset {asset_id}: {e}")
            failed_count += 1
    
    services["session"].commit()
    
    await ctx.info(f"Added {added_count} assets to bundle #{bundle_id}")
    
    summary = f"✅ Added {added_count} assets to bundle #{bundle_id}"
    if failed_count:
        summary += f"\n   ⚠️  {failed_count} assets failed to add"
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "operation": "add",
            "bundle_id": bundle_id,
            "assets_added": added_count,
            "assets_failed": failed_count,
            "status": "success" if failed_count == 0 else "partial_success"
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
    
    removed_count = 0
    failed_count = 0
    
    for asset_id in asset_ids:
        try:
            services["bundle_service"].remove_asset_from_bundle(
                bundle_id=bundle_id,
                asset_id=asset_id,
                infospace_id=services["infospace_id"],
                user_id=services["user_id"]
            )
            removed_count += 1
        except Exception as e:
            logger.warning(f"Failed to remove asset {asset_id}: {e}")
            failed_count += 1
    
    services["session"].commit()
    
    await ctx.info(f"Removed {removed_count} assets from bundle #{bundle_id}")
    
    summary = f"✅ Removed {removed_count} assets from bundle #{bundle_id}"
    if failed_count:
        summary += f"\n   ⚠️  {failed_count} assets failed to remove"
    
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "operation": "remove",
            "bundle_id": bundle_id,
            "assets_removed": removed_count,
            "assets_failed": failed_count,
            "status": "success" if failed_count == 0 else "partial_success"
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
    
    from app.models import Bundle
    
    bundle = services["session"].get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != services["infospace_id"]:
        return ToolResult(
            content=[TextContent(type="text", text=f"Bundle {bundle_id} not found")],
            structured_content={"error": "bundle not found"}
        )
    
    if name:
        bundle.name = name
    if description is not None:
        bundle.description = description
    
    services["session"].add(bundle)
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


async def _organize_delete(services: Dict, ctx: Context, bundle_id: Optional[int]) -> ToolResult:
    """Delete a bundle."""
    if not bundle_id:
        return ToolResult(
            content=[TextContent(type="text", text="bundle_id is required for delete operation")],
            structured_content={"error": "bundle_id is required"}
        )
    
    from app.models import Bundle
    
    bundle = services["session"].get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != services["infospace_id"]:
        return ToolResult(
            content=[TextContent(type="text", text=f"Bundle {bundle_id} not found")],
            structured_content={"error": "bundle not found"}
        )
    
    bundle_name = bundle.name
    services["session"].delete(bundle)
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


# ============================================================================
# CATEGORY: ASSET ANALYSIS
# ============================================================================

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


@mcp.tool
async def list_schemas(ctx: Context) -> ToolResult:
    """
    View available analysis templates (schemas) that define how to extract structured information from documents.
    
    Use this to:
    - See what types of analysis you can perform
    - Find templates for extracting specific data (entities, themes, classifications, etc.)
    - Understand what fields each analysis will produce
    
    Schemas are pre-defined templates that tell the system what information to look for and how to structure it.
    For example: "Extract all mentioned organizations, their roles, and key positions" or "Classify sentiment and identify main arguments."
    
    Note: Currently disabled for simplification, but listed here for context.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"],
            services["infospace_id"],
            services["user_id"]
        )
        
        await ctx.info("Listing annotation schemas")
        
        schemas = services["annotation_service"].list_schemas(
            services["user_id"],
            services["infospace_id"],
            active_only=True
        )
        
        summary = format_schema_summary(schemas)
        
        schema_data = [
            {
                "id": schema.id,
                "name": schema.name,
                "description": schema.description,
                "version": schema.version,
                "created_at": schema.created_at.isoformat() if schema.created_at else None,
            }
            for schema in schemas
        ]
        
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "schemas": schema_data,
                "total": len(schemas)
            }
        )


@mcp.tool
async def semantic_search(
    query: Annotated[Union[str, List[str]], "What to search for conceptually (e.g., 'arguments for carbon pricing') or multiple related queries ['carbon tax benefits', 'emissions trading advantages']"],
    ctx: Context,
    limit: Annotated[int, "Maximum results per query (10-50 recommended)"] = 10,
    asset_kinds: Annotated[Optional[List[str]], "Limit to document types: ['web', 'pdf', 'text', 'article']"] = None,
    bundle_id: Annotated[Optional[int], "Search only within a specific collection (bundle ID)"] = None,
    date_from: Annotated[Optional[str], "Only documents from this date onward (format: YYYY-MM-DD)"] = None,
    date_to: Annotated[Optional[str], "Only documents up to this date (format: YYYY-MM-DD)"] = None,
    combine_results: Annotated[bool, "For multiple queries, merge and deduplicate results"] = True,
) -> ToolResult:
    """
    Find content by meaning rather than exact keywords—discovers related passages even with different wording.
    
    Use this when:
    - You want to find concepts, not just exact phrases
    - Looking for different ways people discuss the same idea
    - Regular search (navigate) isn't finding what you need
    - Exploring thematic connections across documents
    
    How it works: Converts your query into a vector (mathematical representation of meaning) and finds 
    text passages with similar meanings, even if they use completely different words.
    
    <examples>
    Finding concepts:
      semantic_search(query="arguments against carbon pricing")
      # Finds passages discussing opposition, even if they don't say "arguments against"
    
    Exploring multiple angles:
      semantic_search(
        query=["renewable energy benefits", "clean energy advantages", "sustainable power pros"],
        combine_results=True
      )
      # Searches all angles and returns unified results
    
    Time-bounded research:
      semantic_search(
        query="inflation policy responses",
        date_from="2024-01-01",
        date_to="2024-12-31"
      )
    
    Within specific collection:
      semantic_search(query="climate adaptation strategies", bundle_id=12)
    </examples>
    
    Returns: Text passages (chunks) with similarity scores, showing exactly where relevant content appears in which documents.
    
    Tip: Start broad, then refine with filters. Semantic search often surfaces unexpected but relevant connections.
    """
    with get_services() as services:
        session = services["session"]
        infospace_id = services["infospace_id"]
        
        # Check if infospace has embeddings configured
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
                             "3. Use this tool to search"
                    )
                ]
            )
        
        # Convert date strings to datetime if provided
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
        
        # Convert asset_kinds to enum
        from app.models import AssetKind
        kinds = None
        if asset_kinds:
            try:
                kinds = [AssetKind(kind) for kind in asset_kinds]
            except ValueError as e:
                return ToolResult(
                    content=[TextContent(type="text", text=f"❌ Invalid asset kind: {e}")]
                )
        
        # Extract API keys from JWT token claims (for cloud embedding providers)
        from fastmcp.server.dependencies import get_access_token, AccessToken
        access_token: AccessToken = get_access_token()
        runtime_api_keys = None
        if access_token and access_token.claims:
            api_keys = access_token.claims.get('api_keys', {})
            if isinstance(api_keys, dict) and api_keys:
                runtime_api_keys = api_keys
        
        # Handle single or multiple queries
        queries = [query] if isinstance(query, str) else query
        
        # Perform semantic search
        from app.api.services.vector_search_service import VectorSearchService
        search_service = VectorSearchService(session, runtime_api_keys=runtime_api_keys)
        
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
                    bundle_id=bundle_id
                )
                query_results_map[q] = results
                all_results.extend(results)
            
            # If multiple queries and combine_results is True, deduplicate by chunk_id
            if len(queries) > 1 and combine_results:
                seen_chunks = {}
                for result in all_results:
                    chunk_id = result.chunk_id
                    # Keep the result with highest similarity
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
                                 "- Ensuring assets have been embedded"
                        )
                    ]
                )
            
            # Format results
            if len(queries) > 1:
                queries_str = "', '".join(queries)
                output_lines = [f"🔍 Multi-Query Semantic Search Results"]
                output_lines.append(f"Queries: '{queries_str}'")
                output_lines.append(f"Found {len(results)} unique results (combined and deduplicated)\n" if combine_results else f"Found {len(results)} total results\n")
            else:
                output_lines = [f"🔍 Semantic Search Results for: '{queries[0]}'"]
                output_lines.append(f"Found {len(results)} results\n")
            
            # Build structured data for tool result registry
            structured_results = []
            
            for i, result in enumerate(results, 1):
                output_lines.append(f"## Result {i} (Similarity: {result.similarity:.3f})")
                output_lines.append(f"**Asset:** {result.asset_title} (ID: {result.asset_id})")
                output_lines.append(f"**Type:** {result.asset_kind}")
                output_lines.append(f"**Chunk:** #{result.chunk_index}")
                
                # Show chunk position if available
                if result.chunk_metadata:
                    if 'start_char' in result.chunk_metadata and 'end_char' in result.chunk_metadata:
                        output_lines.append(f"**Position:** chars {result.chunk_metadata['start_char']}-{result.chunk_metadata['end_char']}")
                
                # Truncate text preview
                text_preview = result.chunk_text[:300] + "..." if result.chunk_text and len(result.chunk_text) > 300 else (result.chunk_text or "")
                output_lines.append(f"**Content:**\n{text_preview}")
                output_lines.append("")
                
                # Add to structured results
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
            
            # Add asset IDs for follow-up navigation
            asset_ids = list(set(r.asset_id for r in results))
            output_lines.append(f"\n💡 **Tip:** Use `navigate` with mode='load' and ids={asset_ids[:5]} to view full asset details")
            
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

