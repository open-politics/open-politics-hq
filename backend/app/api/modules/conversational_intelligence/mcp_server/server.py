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


import inspect
import json
import logging

from fastapi import HTTPException
from typing import List, Optional, Any, Dict, Union, Tuple
from datetime import datetime, timezone
from fastmcp import FastMCP, Context
from fastmcp.tools.tool import ToolResult
from mcp.types import TextContent

from app.api.modules.identity_infospace_user.access import resolve_access_capped, Capability
from app.api.modules.conversational_intelligence.catalogue import make_operation, requires_for
from app.core.config import settings
from app.api.modules.foundation_service_providers import resolve
from app.api.modules.annotation.services import AnnotationService
from app.models import Asset, AssetKind, Infospace, AnnotationSchema, Annotation
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

# The @operation decorator (see ../catalogue.py) wraps @mcp.tool and records each
# tool's catalogue metadata (path · requires · needs · posture · summary) into the
# operation registry that the conversation service browses, gates, and provisions.
operation = make_operation(mcp)


def _gate(services):
    """Resolve deployment-capped access and enforce the calling operation's
    declared ``requires`` (from the catalogue registry).

    The operation name is read from the calling frame — the ``@operation`` tool
    function — so every tool gates identically with no repeated name and no
    drift. Raises 403 when the user (∩ the deployment ceiling) lacks a required
    capability. Fat hubs escalate per-mode on the returned ``access``.
    """
    op_name = inspect.currentframe().f_back.f_code.co_name
    return resolve_access_capped(
        services["session"], services["infospace_id"], services["user"],
        *requires_for(op_name),
    )


def _require(access, *caps: Capability) -> None:
    """Raise 403 unless the (already deployment-capped) ``access`` has all caps.

    Per-mode escalation inside fat hubs (e.g. library delete → DELETE,
    analysis schema-writes → ORGANIZE, run.start → COMPUTE).
    """
    for cap in caps:
        if not access.has(cap):
            raise HTTPException(
                status_code=403,
                detail=f"This action requires the '{cap.value}' capability.",
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
        annotation_service = AnnotationService(session=session)

        # Retrieve user's stored API keys (no runtime keys in JWT anymore).
        # If the stored blob is present but undecryptable, decrypt_credentials
        # raises CredentialDecryptionError — we deliberately let it propagate
        # and fail context setup rather than silently handing tools api_keys={}
        # (an agent quietly losing every provider key is the worse failure).
        user = session.get(User, user_id)
        api_keys = {}
        if user and user.encrypted_credentials:
            api_keys = security.decrypt_credentials(user.encrypted_credentials)

        yield {
            "session": session,
            "user": user,
            "user_id": user_id,
            "infospace_id": infospace_id,
            "conversation_id": conversation_id,  # Pass conversation ID to tools
            "model_name": model_name,  # Chat's model for annotation runs
            "runtime_api_keys": api_keys,  # Use stored API keys from database
            "annotation_service": annotation_service,
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
    Format search results as a summary for the model.

    Includes each hit's snippet (and a short excerpt of scraped body text when
    present) — not just titles/URLs. A result list with no snippets leaves the
    model unable to judge or cite what it found; the full bodies still live in
    structured_content for the UI and can be loaded per-asset after ingestion.
    """
    lines = [f"Found {len(results)} results for '{query}':\n"]

    for i, result in enumerate(results[:max_items], 1):
        lines.append(f"{i}. {result.get('title', '(untitled)')}")
        lines.append(f"   URL: {result.get('url', '')}")
        if result.get('score'):
            lines.append(f"   Relevance: {int(result['score'] * 100)}%")
        snippet = result.get("content") or result.get("raw_content") or ""
        if snippet:
            lines.append(f"   {truncate_text(snippet, 500)}")
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
    """Legacy flat extractor — kept for backwards compatibility with old callers.

    For the introspection surface used by FormulaAgent / DossierAgent, prefer
    ``_walk_schema_surface()`` below, which emits row-shape roots, full
    array-indexed paths, enum values, and axis references.
    """
    return _walk_schema_surface(output_contract).get("field_paths", [])


def _walk_schema_surface(output_contract: Dict[str, Any]) -> Dict[str, Any]:
    """Walk a schema's output_contract and emit everything an LLM needs to author a Formula.

    Returns
    -------
    dict with three keys:
      - ``row_shape_roots``: list of ``{path, description}`` for top-level
        array-of-object containers (e.g. ``regulatorische_handlungen[*]``).
        These are the row shapes formulas iterate over.
      - ``field_paths``: list of ``{path, type, description, enum_values?,
        axis?}`` with full array-indexed paths
        (``regulatorische_handlungen[*].target_firm``).
      - ``simple_fields``: list of top-level scalar/object fields that aren't
        array containers — useful for whole-document scoped formulas.

    Handles JSON Schema patterns: object → properties; array → items.object
    (emits ``[*]`` in the path); enum → enum_values; oneOf/anyOf → first
    branch. ``x-axis`` references on a field are surfaced as ``axis``.
    """
    row_shape_roots: List[Dict[str, str]] = []
    field_paths: List[Dict[str, Any]] = []
    simple_fields: List[Dict[str, Any]] = []

    if not output_contract or not isinstance(output_contract, dict):
        return {"row_shape_roots": row_shape_roots, "field_paths": field_paths, "simple_fields": simple_fields}

    def walk_object(props: Dict[str, Any], prefix: str) -> None:
        """Recurse into a JSON-schema object's properties, emitting field_paths."""
        if not isinstance(props, dict):
            return
        for key, sub in props.items():
            if not isinstance(sub, dict):
                continue
            field_path = f"{prefix}.{key}" if prefix else key
            sub_type = sub.get("type") or _peek_type(sub)
            entry: Dict[str, Any] = {
                "path": field_path,
                "type": sub_type or "unknown",
                "description": sub.get("description", "") or "",
            }
            # Enum values: surface as a vocabulary the LLM can choose from.
            if "enum" in sub and isinstance(sub["enum"], list):
                entry["enum_values"] = sub["enum"]
            # Axis reference: surface so the LLM can validate aggregation rules.
            x_axis = sub.get("x-axis") or sub.get("xAxis")
            if isinstance(x_axis, str):
                entry["axis"] = x_axis

            if sub_type == "object" and isinstance(sub.get("properties"), dict):
                # Don't emit object containers as field_paths — their leaves carry the data.
                walk_object(sub["properties"], field_path)
            elif sub_type == "array":
                items = sub.get("items") or {}
                items_type = items.get("type") or _peek_type(items)
                if items_type == "object" and isinstance(items.get("properties"), dict):
                    # Array-of-objects — descend with [*] notation.
                    walk_object(items["properties"], f"{field_path}[*]")
                else:
                    # Array of scalars — surface as a single path; the LLM can
                    # bind it for set-style operations.
                    entry["type"] = f"array<{items_type or 'unknown'}>"
                    field_paths.append(entry)
            else:
                # Scalar leaf.
                field_paths.append(entry)

    properties = output_contract.get("properties") or {}
    if not properties:
        return {"row_shape_roots": row_shape_roots, "field_paths": field_paths, "simple_fields": simple_fields}

    # Top pass — distinguish array-of-object row-shape roots from scalars/objects.
    for key, sub in properties.items():
        if not isinstance(sub, dict):
            continue
        sub_type = sub.get("type") or _peek_type(sub)
        if sub_type == "array":
            items = sub.get("items") or {}
            items_type = items.get("type") or _peek_type(items)
            if items_type == "object" and isinstance(items.get("properties"), dict):
                row_shape_roots.append({
                    "path": f"{key}[*]",
                    "description": sub.get("description", "") or "",
                })
                walk_object(items["properties"], f"{key}[*]")
                continue
        if sub_type == "object" and isinstance(sub.get("properties"), dict):
            # Nested object container — descend, but also note it as a path root.
            walk_object(sub["properties"], key)
            simple_fields.append({"path": key, "type": "object", "description": sub.get("description", "") or ""})
            continue
        # Scalar at top level.
        leaf: Dict[str, Any] = {
            "path": key,
            "type": sub_type or "unknown",
            "description": sub.get("description", "") or "",
        }
        if "enum" in sub and isinstance(sub["enum"], list):
            leaf["enum_values"] = sub["enum"]
        x_axis = sub.get("x-axis") or sub.get("xAxis")
        if isinstance(x_axis, str):
            leaf["axis"] = x_axis
        field_paths.append(leaf)
        simple_fields.append(leaf)

    return {
        "row_shape_roots": row_shape_roots,
        "field_paths": field_paths,
        "simple_fields": simple_fields,
    }


def _peek_type(node: Dict[str, Any]) -> Optional[str]:
    """Resolve a JSON-Schema type when it's hidden behind oneOf/anyOf/$ref.

    Falls back to ``None``; the caller treats that as 'unknown'.
    """
    if not isinstance(node, dict):
        return None
    if "type" in node:
        return node["type"]
    for combinator in ("oneOf", "anyOf", "allOf"):
        branches = node.get(combinator)
        if isinstance(branches, list) and branches:
            first = branches[0]
            if isinstance(first, dict):
                return first.get("type") or _peek_type(first)
    return None


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
# MODEL-FACING PAYLOAD RENDERERS
# ============================================================================
#
# The model only ever sees a tool's ``content`` stream; ``structured_content`` is
# frontend-only and never reaches it. For BROWSE/DISCOVERY operations a concise
# summary is correct — the model just needs to know what exists and the IDs to
# drill into. But for RETRIEVAL/INSPECTION operations (read a document, preview a
# formula, fetch run results) the model explicitly asked for the payload, so the
# payload must land in ``content``. These helpers render that payload as bounded
# text. The two streams are independent — feeding the model the data costs the
# rich UI card nothing.


def _render_asset_full_for_model(asset: Any) -> str:
    """Render an asset's full content as the model's working payload (depth='full').

    Carries the actual ``text_content`` (plus CSV columns when present) so the
    model can reason over and cite the body — not just its title. The frontend
    renders its own rich card from ``structured_content`` independently.
    """
    kind = asset.kind.value if getattr(asset, "kind", None) else "text"
    lines = [f"━━━ Asset {asset.id}: {asset.title} ({kind}) ━━━"]
    columns = (getattr(asset, "file_info", None) or {}).get("columns")
    if columns:
        lines.append(f"Columns: {', '.join(str(c) for c in columns)}")
    body = asset.text_content or ""
    lines.append(body if body else "(no text content)")
    return "\n".join(lines)


def _render_rows_for_model(
    rows: List[Any],
    *,
    label: str,
    total: Optional[int] = None,
    has_more: bool = False,
    max_items: int = 15,
    max_chars: int = 8000,
) -> str:
    """Render a bounded sample of structured rows/values as text for the model.

    A bare count ("12 rows", "42 annotations") leaves the model blind to what it
    fetched and unable to verify or reason over it. This serialises a sample to
    JSON, bounded by ``max_items`` / ``max_chars`` so one call can't blow the
    context window, and annotates any truncation so the model knows to paginate
    for the rest.
    """
    shown = rows[:max_items]
    body = json.dumps(shown, ensure_ascii=False, indent=2, default=str)
    truncated_chars = len(body) > max_chars
    if truncated_chars:
        body = body[:max_chars].rstrip()

    count = total if total is not None else len(rows)
    header = f"{label} — {count} total"
    notes = []
    if len(rows) > len(shown):
        notes.append(f"showing first {len(shown)}")
    if truncated_chars:
        notes.append("sample truncated to fit context")
    if has_more:
        notes.append("more rows available — paginate for the rest")
    if notes:
        header += f" ({'; '.join(notes)})"

    return f"{header}:\n{body}"


# ============================================================================
# CATEGORY: NAVIGATION & DISCOVERY
# ============================================================================

@operation(path="workspace", tags=["workspace", "navigation", "search"],
           summary="Browse and search the workspace tree; view, open, or load assets and bundles.")
async def workspace_hub(
    ctx: Context,
    mode: Annotated[str, "Action: 'tree' (browse structure), 'view' (see children/content), 'search' (find by name/concept), 'load' (fetch by ID), 'open' (open an asset OR bundle in the detail panel)"] = "tree",
    query: Annotated[Optional[str], "Search query (for search mode)"] = None,
    node_id: Annotated[Optional[str], "Target ID for view/open mode (e.g. 'bundle-123', 'asset-456')"] = None,
    ids: Annotated[Optional[List[int]], "Asset IDs to load (for load mode)"] = None,
    asset_id: Annotated[Optional[int], "Asset ID to open (for open mode)"] = None,
    bundle_id: Annotated[Optional[int], "Bundle/collection ID to open in the detail panel (for open mode)"] = None,
    depth: Annotated[str, "Detail level: 'tree' (structure), 'titles' (metadata), 'previews' (recommended), 'full' (complete content)"] = "previews",
    resource: Annotated[Optional[str], "Narrow search to one type: 'bundles' or 'assets'. Omit to search both. (For browse modes: which tree to open.)"] = None,
    semantic_queries: Annotated[Optional[List[str]], "Multiple angles for semantic search"] = None,
    search: Annotated[str, "How to match (search mode): 'basic' (default — name match, fast, spans bundles + assets), 'semantic' (meaning, not names), 'hybrid' (name + meaning). Reach for semantic when the query is conceptual rather than a name."] = "basic",
    filters: Annotated[Optional[Dict[str, Any]], "Filters: {'asset_kinds': ['pdf'], 'bundle_id': 123, 'parent_asset_id': 456}"] = None,
    limit: Annotated[Optional[int], "Max items to return"] = None,
    offset: Annotated[int, "Pagination offset"] = 0,
    combine_results: Annotated[bool, "Deduplicate semantic results"] = True,
) -> ToolResult:
    """
    Unified workspace explorer. Browse, search, and load content.
    
    <quick_start>
    • Browse: workspace_hub() or workspace_hub(mode="view", node_id="bundle-123")
    • Search (default — bundles + assets by name): workspace_hub(mode="search", query="Q1 reports")
    • Targeted: add search="semantic" (meaning) or resource="bundles"/"assets" (one type)
    • Semantic: workspace_hub(mode="search", query="implications of tax changes", search="semantic")
    • Load: workspace_hub(mode="load", ids=[123], depth="full")
    • Open an asset: workspace_hub(mode="open", asset_id=123) - opens it in the detail panel
    • Open a bundle: workspace_hub(mode="open", bundle_id=123) - opens the collection in the detail panel
      (prefer this over mode="view" when the user wants to *see/open* a collection, not just list its contents)
    </quick_start>
    """
    with get_services() as services:
        access = _gate(services)
        
        # Resource defaults. Search spans BOTH types (resource stays None) unless
        # the caller narrows it to 'bundles'/'assets'. Browse/load have a natural
        # type: load fetches assets; tree/view open the bundle tree.
        if not resource and mode not in ["search", "semantic"]:
            resource = "assets" if mode == "load" else "bundles"
                
        # Extract convenient filter args if passed in filters dict. An explicit
        # ``bundle_id`` arg (open mode / scoping) takes precedence over filters.
        asset_kinds = filters.get("asset_kinds") if filters else None
        bundle_id = bundle_id or (filters.get("bundle_id") if filters else None)
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
        
        # Open mode - returns a navigate-like result that auto-opens in the detail
        # panel. Works for an asset OR a bundle; the frontend ConversationalAssetExplorer
        # auto-opens whichever the payload carries (asset_id → asset overlay,
        # bundle_id → bundle detail). Same docking surface either way.
        if mode == "open":
            target_asset_id = asset_id
            target_bundle_id = bundle_id
            # Resolve a typed node_id (e.g. 'asset-456' / 'bundle-123').
            if node_id:
                if node_id.startswith("asset-") and not target_asset_id:
                    try:
                        target_asset_id = int(node_id.split("-")[1])
                    except (ValueError, IndexError):
                        pass
                elif node_id.startswith("bundle-") and not target_bundle_id:
                    try:
                        target_bundle_id = int(node_id.split("-")[1])
                    except (ValueError, IndexError):
                        pass
            # A bare ids list is asset-oriented (load semantics).
            if not target_asset_id and not target_bundle_id and ids and len(ids) > 0:
                target_asset_id = ids[0]

            # Bundle open — explicit asset target wins if somehow both are set.
            if target_bundle_id and not target_asset_id:
                from app.models import Bundle
                from app.api.modules.content.tree import bundle_counts as _bundle_counts
                bundle = services["session"].get(Bundle, target_bundle_id)
                if not bundle or bundle.infospace_id != services["infospace_id"]:
                    return ToolResult(
                        content=[TextContent(type="text", text=f"❌ Bundle {target_bundle_id} not found in this infospace")],
                        structured_content={"error": "bundle_not_found", "bundle_id": target_bundle_id}
                    )

                await ctx.info(f"Opening bundle {target_bundle_id}: {bundle.name}")

                # bundle_id at top level + a single bundle node — both auto-open paths
                # the ConversationalAssetExplorer understands.
                return ToolResult(
                    content=[TextContent(type="text", text=f"📂 Opening collection: {bundle.name}")],
                    structured_content={
                        "resource": "bundles",
                        "mode": "open",
                        "auto_open": True,
                        "bundle_id": target_bundle_id,
                        "total": 1,
                        "nodes": [{
                            "id": f"bundle-{target_bundle_id}",
                            "bundle_id": target_bundle_id,
                            "type": "bundle",
                            "name": bundle.name,
                            "children_count": sum(
                                _bundle_counts(services["session"], [target_bundle_id]).get(target_bundle_id, (0, 0))
                            ),
                        }],
                        # Co-presence: open the bundle in the sideview AND unfold the
                        # asset tree to it (the `assets:reveal` verb no-ops off-surface).
                        "ui_directive": [
                            {"command": "open_item", "payload": {"bundle_id": target_bundle_id}},
                            {"command": "assets:reveal", "payload": {"bundle_id": target_bundle_id}},
                        ],
                    }
                )

            if not target_asset_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ asset_id or bundle_id is required for open mode. Use: workspace_hub(mode='open', asset_id=123) or workspace_hub(mode='open', bundle_id=123)")],
                    structured_content={"error": "open_target_required"}
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

            # The bundle this asset lives in (first real membership; 0 = root) — carried
            # so the sideview breadcrumb walks back up to the folder.
            from_bundle_id = next((b for b in (asset.bundle_ids or []) if b and b != 0), None)

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
                    }],
                    # Co-presence: open the asset in the sideview beside the chat, with its
                    # bundle context so the breadcrumb leads back to the folder.
                    "ui_directive": {"command": "open_item", "payload": {"asset_id": target_asset_id, "from_bundle_id": from_bundle_id}},
                }
            )
        
        # Tree mode is the default and most efficient way to browse
        if mode == "tree" or (resource == "bundles" and mode not in ["search", "view", "expand", "open"]):
            return await _navigate_tree_root(services, ctx)
        elif mode in ["view", "expand"]:  # Support both for backward compatibility
            if not node_id:
                return ToolResult(
                    content=[TextContent(type="text", text="node_id is required for view mode")],
                    structured_content={"error": "node_id required"}
                )
            return await _navigate_tree_expand(services, ctx, node_id, effective_limit, offset)

        # Search — tiered. Basic name match across bundles + assets by default;
        # narrow with resource='bundles'/'assets', escalate with search='semantic'/'hybrid'.
        if mode == "search":
            if resource == "bundles":
                return await _search_bundles(services, ctx, query, effective_limit or 30)
            # 'basic' is a name match → text FTS on the asset side; only a basic,
            # unscoped, both-types search leads with folder name-matches.
            method = "text" if search == "basic" else search
            include_folders = (
                search == "basic" and resource is None
                and parent_asset_id is None and bundle_id is None
            )
            return await _navigate_assets(
                services, ctx, mode, depth, ids, query, method,
                effective_filters, effective_limit, offset,
                include_folders=include_folders,
            )

        # Non-search asset ops (load).
        if resource == "assets":
            return await _navigate_assets(services, ctx, mode, depth, ids, query, search, effective_filters, effective_limit, offset)

        # Fallback: browse the tree.
        return await _navigate_tree_root(services, ctx)


async def _navigate_tree_root(services: Dict, ctx: Context) -> ToolResult:
    """Navigate tree root - shows hierarchical structure of bundles and standalone assets."""
    from sqlmodel import select
    from app.models import Asset, Bundle
    from app.api.tree_renderer import build_root_tree_nodes
    from app.api.modules.content.query import AssetQuery
    from app.api.modules.content.tree import ROOT

    # Get root bundles (no parent)
    root_bundles = services["session"].exec(
        select(Bundle)
        .where(Bundle.infospace_id == services["infospace_id"])
        .where(Bundle.parent_bundle_id == ROOT)
        .order_by(Bundle.name)
    ).all()

    await ctx.info(f"Found {len(root_bundles)} root bundles")

    # Root assets = standalone (no parent, in no bundle) — composed from AssetQuery,
    # the SAME selection the display tree uses (routes/tree.py:_root_query). MCP and UI
    # now share one traversal instead of hand-rolling it; ``.no_bundles()`` is the
    # scale-safe array predicate (the old hand-rolled NOT IN blew past Postgres's
    # 65k-param ceiling on large bundled CSVs).
    root_assets = (
        AssetQuery(services["session"], services["infospace_id"])
        .top_level_only()
        .no_bundles()
        .exclude_superseded()
        .sort("created_at_desc")
        .paginate(limit=100)  # bounded root listing, matching the display root
        .assets()
    )
    
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
            from app.api.modules.content.tree import fmt_count
            children_count = node_data.get("children_count", 0)
            summary_lines.append(f"📦 {node_id} | {node_name} ({fmt_count(children_count)} items)")
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
            "resource": "bundles",
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
    from app.api.tree_renderer import (
        parse_tree_node_id, 
        build_bundle_children_nodes, 
        build_asset_children_nodes,
        enrich_node_with_preview,
        build_tree_node_from_asset
    )
    from sqlmodel import select
    from app.models import Asset, Bundle
    from app.api.modules.content.query import AssetQuery

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
            aq = (
                AssetQuery(services["session"], services["infospace_id"])
                .bundle(bundle.id)
                .top_level_only()
                .sort("created_at_desc")
                .paginate(limit=remaining_limit)
            )
            aq._offset = asset_skip
            bundle_assets = list(aq.assets())
        
        # Build nodes
        children_nodes = build_bundle_children_nodes(bundle, child_bundles, bundle_assets, services["session"])
        
        # Enrich each node with preview data
        for i, node in enumerate(children_nodes):
            if i < len(child_bundles):
                # Bundle node — sample a bounded set of members for the preview.
                # build_bundle_preview only needs a kinds distribution + a few sample
                # titles, so an unbounded fetch (the old `Asset.id.in_(all_member_ids)`)
                # both over-fetched and risked the 65k-param ceiling on large bundles.
                entity = child_bundles[i]
                child_assets_list = (
                    AssetQuery(services["session"], services["infospace_id"])
                    .bundle(entity.id)
                    .top_level_only()
                    .paginate(limit=50)
                    .assets()
                )
                children_nodes[i] = enrich_node_with_preview(node, entity, child_assets_list)
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
        
        # Get child assets — AssetQuery (same as the UI's parent_asset listing; its
        # "part_index" sort orders by part_index NULLS LAST then created_at, matching
        # the previous hand-rolled order_by).
        aq = (
            AssetQuery(services["session"], services["infospace_id"])
            .parent_asset(node_numeric_id)
            .sort("part_index")
            .paginate(limit=effective_asset_limit)
        )
        aq._offset = offset
        child_assets = list(aq.assets())
        
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
        columns = (parent_entity.file_info or {}).get('columns', [])
        total_row_count = parent_preview.get('row_count') if parent_preview else None
        
        if columns and parent_preview and parent_preview.get('sample_rows'):
            from app.api.tree_renderer import format_csv_as_table
            
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
            from app.api.modules.content.tree import fmt_count
            children_count = node_data.get("children_count", 0)
            summary_lines.append(f"  📦 {child_id} | {child_name} ({fmt_count(children_count)} items)")
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


async def _search_bundles(services: Dict, ctx: Context, query: Optional[str], limit: int) -> ToolResult:
    """Search bundles (folders) by name — ranked, no document search.

    The targeted 'bundles only' search: workspace_hub(mode='search',
    resource='bundles', query='...'). Reuses the same bundles_matching primitive the
    basic search and the explore stream use.
    """
    if not query:
        return ToolResult(
            content=[TextContent(type="text", text="Provide a query to search bundles.")],
            structured_content={"error": "missing_query"},
        )
    from app.api.modules.content.query import bundles_matching, parse as _parse_aql
    from app.api.modules.content.tree import bundle_counts, fmt_count
    ranked = bundles_matching(services["session"], services["infospace_id"], _parse_aql(query), None, limit=limit)
    # Capped live counts — cheap on huge folders, and can't drift like the cache.
    counts = bundle_counts(services["session"], [b.id for b, _ in ranked])
    items = [{
        "id": f"bundle-{b.id}",
        "bundle_id": b.id,
        "type": "bundle",
        "name": b.name,
        "children_count": sum(counts.get(b.id, (0, 0))),
    } for b, _score in ranked]

    await ctx.info(f"Found {len(items)} bundles matching '{query}'")
    lines = [f"📁 Found {len(items)} bundles matching '{query}':"]
    for it in items[:10]:
        lines.append(f"📦 {it['id']} | {it['name']} ({fmt_count(it['children_count'])} items)")
    if len(items) > 10:
        lines.append(f"... {len(items) - 10} more")
    lines.append("\n💡 Look inside: workspace_hub(mode='view', node_id='bundle-X')")
    summary = "\n".join(lines)
    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "resource": "bundles", "mode": "search", "items": items,
            "total": len(items), "query": query, "message": summary, "summary": summary,
        },
    )


async def _navigate_assets(services: Dict, ctx: Context, mode: str, depth: str,
                           ids: Optional[List[int]], query: Optional[str],
                           search_method: str, filters: Optional[Dict],
                           limit: int, offset: int,
                           include_folders: bool = False) -> ToolResult:
    """Navigate assets: search or load specific ones.

    ``include_folders`` leads a search result with ranked bundle name-matches
    (the basic, both-types search). Set by the dispatcher; off for scoped or
    document-only searches.
    """
    
    # Import at function level so it's available in all branches
    from sqlmodel import select
    from app.models import Asset, Bundle

    # The basic both-types search leads asset hits with ranked folder
    # name-matches — the Finder behaviour, as a tool result. Set via
    # include_folders; empty for semantic/hybrid, bundle-only, or scoped searches.
    bundle_data: List[Dict[str, Any]] = []

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

        from app.api.modules.content.query import AssetQuery
        import asyncio as _mcp_asyncio

        def _text_aq(q: str, n: int) -> AssetQuery:
            aq = (
                AssetQuery(services["session"], services["infospace_id"])
                .exclude_superseded()
                .text(q, mode="fts")
                .sort("relevance" if q else "created_at_desc")
                .paginate(limit=n)
            )
            if asset_kinds_enum:
                aq.kinds(asset_kinds_enum)
            if bundle_id is not None:
                aq.bundle(bundle_id)
            if parent_asset_id is not None:
                aq.parent_asset(parent_asset_id)
            else:
                # Surface the parent DOCUMENT, not its PDF pages / CSV rows — the parent
                # carries the full text, so no matches are lost. Drilling into a parent
                # (parent_asset_id set) still returns its children.
                aq.top_level_only()
            return aq

        def _sem_aq(q: str, n: int) -> AssetQuery:
            aq = (
                AssetQuery(services["session"], services["infospace_id"])
                .exclude_superseded()
                .semantic(q, top_k=n)
                .paginate(limit=n)
            )
            if asset_kinds_enum:
                aq.kinds(asset_kinds_enum)
            if bundle_id is not None:
                aq.bundle(bundle_id)
            if parent_asset_id is None:
                aq.top_level_only()  # parent documents, not pages
            return aq

        if search_method == "text":
            assets = _text_aq(query, limit).assets()
        elif search_method == "semantic":
            try:
                aq = _sem_aq(query, limit)
                await aq.resolve()
                assets = aq.assets()
            except Exception as e:
                # A failed pgvector query leaves the session's transaction in an
                # aborted state — every subsequent query in this MCP call would
                # fail with InFailedSqlTransaction unless we roll back first.
                services["session"].rollback()
                await ctx.info(f"Semantic search failed, falling back to text: {e}")
                assets = _text_aq(query, limit).assets()
        elif search_method == "hybrid":
            # Run text first, then semantic. Sequencing avoids cross-task session
            # corruption (SQLAlchemy sessions aren't safe under concurrent use)
            # and lets us roll back the semantic failure before the text path runs.
            text_list = _text_aq(query, max(1, limit // 2)).assets()
            try:
                aq = _sem_aq(query, max(1, limit // 2))
                await aq.resolve()
                sem_list = aq.assets()
            except Exception as e:
                services["session"].rollback()
                await ctx.info(f"Semantic leg of hybrid search failed: {e}")
                sem_list = []
            merged = {a.id: a for a in text_list}
            for a in sem_list:
                merged.setdefault(a.id, a)
            assets = list(merged.values())[:limit]
        else:
            raise ValueError(f"Unknown search_method: {search_method}")
        
        await ctx.info(f"Found {len(assets)} assets matching '{query}'")

        # Lead with ranked folder name-matches when the dispatcher asked for the
        # basic both-types search (gating — semantic/hybrid, bundle-only, scoped —
        # is decided there).
        if include_folders:
            from app.api.modules.content.query import bundles_matching, parse as _parse_aql
            from app.api.modules.content.tree import bundle_counts, fmt_count
            ranked_bundles = bundles_matching(
                services["session"], services["infospace_id"], _parse_aql(query), None, limit=limit
            )
            # Live counts — the denormalized Bundle.asset_count drifts for ingested folders.
            b_counts = bundle_counts(services["session"], [b.id for b, _ in ranked_bundles])
            for b, _score in ranked_bundles:
                bundle_data.append({
                    "id": f"bundle-{b.id}",
                    "bundle_id": b.id,
                    "type": "bundle",
                    "name": b.name,
                    "children_count": sum(b_counts.get(b.id, (0, 0))),
                })
            if bundle_data:
                await ctx.info(f"Found {len(bundle_data)} folders matching '{query}'")

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
            if current.bundle_ids:
                bundle = session.get(Bundle, current.bundle_ids[0])
                if bundle:
                    path.append({
                        "type": "bundle",
                        "id": bundle.id,
                        "name": bundle.name
                    })
                    
                    # Walk up through parent bundles
                    current_bundle = bundle
                    while current_bundle.parent_bundle_id != 0 and current_bundle.parent_bundle_id not in visited:
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
            
            item["facets"] = asset.facets
            item["file_info"] = asset.file_info
        
        asset_data.append(item)
    
    # Build the model-facing content stream.
    #
    # depth="full" is a RETRIEVAL operation — the model explicitly asked to read
    # these documents — so the body must land in the model's stream, not only in
    # structured_content (which is frontend-only). Browse/preview depths stay a
    # concise summary: there the model only needs to know what exists and the IDs
    # to drill into.
    if depth == "full":
        header = (
            f"🔍 Found {len(assets)} assets matching '{query}' — full content:"
            if mode == "search"
            else f"📄 Loaded {len(assets)} assets — full content:"
        )
        summary_lines = [header, ""]
        for asset in assets:
            summary_lines.append(_render_asset_full_for_model(asset))
            summary_lines.append("")
    else:
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

        summary_lines.append(f"\n→ Load full content: workspace_hub(resource='assets', mode='load', ids=[{assets[0].id if assets else '...'}], depth='full')")

    # Folders lead the result (Finder-style) — prepend their summary and nodes.
    if bundle_data:
        folder_lines = [f"📁 {len(bundle_data)} folders matching '{query}':"]
        for b in bundle_data[:5]:
            folder_lines.append(f"📦 {b['id']} | {b['name']} ({fmt_count(b['children_count'])} items)")
        if len(bundle_data) > 5:
            folder_lines.append(f"... {len(bundle_data) - 5} more folders")
        folder_lines.append("")
        summary_lines = folder_lines + summary_lines

    summary_text = "\n".join(summary_lines)
    return ToolResult(
        content=[TextContent(type="text", text=summary_text)],
        structured_content={
            "resource": "assets",
            "mode": mode,
            "depth": depth,
            "items": bundle_data + asset_data,
            "total": len(bundle_data) + len(assets),
            "query": query,
            "message": summary_text,  # Full summary for frontend
            "summary": summary_text
        }
    )


@operation(path="ingest/web-research", requires=(Capability.INGEST,), needs=("web_search",),
           tags=["search", "web", "ingestion"],
           summary="Live web search with optional one-shot ingestion of results into a bundle.")
async def web_research(
    ctx: Context,
    query: Annotated[Optional[str], "What to search for (e.g., 'recent climate legislation in Europe')"] = None,
    provider: Annotated[Optional[str], "Search service: 'searxng' (self-hosted, no API key), 'tavily' (API key), or 'opol' (API key). Omit to use the deployment's configured default (WEB_SEARCH_PROVIDER_TYPE — typically 'searxng')."] = None,
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
        web_research(quey="2025r prorogation debates", max_results=8)
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
        access = _gate(services)
        
        if not query and not ingest_urls and not ingest_top_k:
            return ToolResult(
                content=[TextContent(type="text", text="Provide either a search query, ingest_urls, or ingest_top_k.")],
                structured_content={"error": "missing_parameters"}
            )
        
        summary_sections: List[str] = []
        structured_payload: Dict[str, Any] = {}
        raw_results: List[dict] = []
        
        if query:
            # When provider is omitted, fall through to the deployment-configured
            # default (settings.WEB_SEARCH_PROVIDER_TYPE — 'searxng' by default).
            # This makes self-hosted SearXNG the no-credentials path and lets
            # users explicitly request 'tavily' / 'opol' when they have keys.
            provider_normalized = (provider or "").strip().lower() or None
            effective_provider = provider_normalized or settings.WEB_SEARCH_PROVIDER_TYPE
            await ctx.info(f"Searching web: query='{query}', provider={effective_provider}")

            api_key = None
            if services["runtime_api_keys"]:
                if effective_provider == 'tavily':
                    api_key = services["runtime_api_keys"].get('tavily') or services["runtime_api_keys"].get('TAVILY_API_KEY')
                elif effective_provider == 'opol':
                    api_key = services["runtime_api_keys"].get('opol') or services["runtime_api_keys"].get('OPOL_API_KEY')

            from app.api.modules.foundation_service_providers import resolve, ProviderError

            try:
                web_search_provider = resolve(
                    "web_search", provider_normalized,
                    infospace_id=services["infospace_id"],
                    runtime_key=api_key,
                    session=services["session"],
                )
            except ProviderError as e:
                return ToolResult(
                    content=[TextContent(type="text", text=f"Error: Could not initialize {effective_provider} web search provider: {str(e)}")],
                    structured_content={
                        "error": str(e),
                        "status": "failed",
                        "query": query,
                        "provider": effective_provider,
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
                raw_results = await web_search_provider.search(
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
                    "provider": effective_provider,
                    "file_info": {
                        "search_query": query,
                        "search_provider": effective_provider,
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
                "provider": effective_provider,
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
    
    await ctx.info(f"Queuing {len(urls)} URLs for ingestion (scrape={scrape_content})")

    # Unified web path: one `web` job whose source scrapes each URL. Async — the agent
    # gets the job id to report/poll rather than building assets inline.
    from app.api.modules.search.web import ingest_urls
    job = ingest_urls(
        services["session"], services["infospace_id"], services["user_id"],
        urls, bundle_id=bundle_id,
    )
    services["session"].commit()

    summary_lines = [f"Queued {len(urls)} URL(s) for ingestion"]
    if bundle_id:
        summary_lines.append(f"Into bundle #{bundle_id}")
    summary_lines.append(f"\nIngestion job: {job.id if job else None}")

    structured = {
        "status": "queued",
        "job_id": job.id if job else None,
        "urls_processed": len(urls),
        "bundle_id": bundle_id,
    }

    return "\n".join(summary_lines), structured


# ============================================================================
# CATEGORY: ORGANIZATION & CURATION
# ============================================================================

@operation(path="library", requires=(Capability.ORGANIZE,), tags=["library", "assets", "bundles"],
           summary="Create, rename, organize, and delete assets and bundles.")
async def library_hub(
    ctx: Context,
    operation: Annotated[str, "asset.create/update/delete or collection.create/add/remove/rename/delete"] = "asset.create",
    # Asset Creation Params
    kind: Annotated[Optional[str], "Asset kind (article, text, web, csv, csv_row)"] = None,
    title: Annotated[Optional[str], "Asset title"] = None,
    content: Annotated[Optional[str], "Text content (for article/text)"] = None,
    url: Annotated[Optional[str], "URL (for web)"] = None,
    columns: Annotated[Optional[List[str]], "Column names (for csv parent)"] = None,
    description: Annotated[Optional[str], "Description (for csv parent or collections)"] = None,
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
    source_query: Annotated[Optional[str], "collection.create: an AQL query to MATERIALIZE the bundle from — matching assets are added in the background and the bundle stays query-backed (e.g. 'kind:pdf ~corruption after:2023')."] = None,

    # Shared
    parent_asset_id: Annotated[Optional[int], "Parent asset ID"] = None,
    data: Annotated[Optional[Dict[str, Any]], "Legacy: raw data payload (deprecated)"] = None,
) -> ToolResult:
    """
    Manage library content (assets and collections).
    
    <quick_start>
    • Create Note: library_hub(operation="asset.create", kind="text", title="Idea", content="...")
    • Save Link: library_hub(operation="asset.create", kind="web", url="https://...", title="...")
    • Create CSV Dataset: library_hub(operation="asset.create", kind="csv", title="Survey Data", columns=["Name", "Age", "City"])
    • Add CSV Row: library_hub(operation="asset.create", kind="csv_row", row_data={"Name": "Alice", "Age": 30}, parent_asset_id=123)
    • Create Collection: library_hub(operation="collection.create", name="Research", asset_ids=[1,2])
    • Bundle from a query: library_hub(operation="collection.create", name="PDF corruption", source_query="kind:pdf ~corruption after:2023") — fills in the background
    • Add to Collection: library_hub(operation="collection.add", bundle_id=5, asset_ids=[10])
    </quick_start>
    """
    with get_services() as services:
        access = _gate(services)
        
        if operation.endswith(".delete"):
            _require(access, Capability.DELETE)

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
                    if columns: effective_data["columns"] = columns
                    if description: effective_data["description"] = description
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
                return await _organize_create(services, ctx, name, description, asset_ids, source_query)
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
                          description: Optional[str], asset_ids: Optional[List[int]],
                          source_query: Optional[str] = None) -> ToolResult:
    """Create a new bundle. With ``source_query`` the bundle is query-backed —
    matching assets are materialized in the background (same as the Content Explorer's
    "new bundle from results")."""
    if not name:
        return ToolResult(
            content=[TextContent(type="text", text="❌ Missing required parameter: name\n\nExample:\n  organize(operation='create', name='Climate Reports', asset_ids=[1,2,3])\n\nBundle name should describe the collection's purpose or topic")],
            structured_content={
                "error": "missing_required_parameter",
                "missing_parameter": "name",
                "hint": "Provide a descriptive name for the new collection"
            }
        )

    from app.api.modules.content.tree import create_bundle

    extra = {"bundle_metadata": {"source_query": source_query}} if source_query else {}
    bundle = create_bundle(
        services["session"],
        infospace_id=services["infospace_id"],
        user_id=services["user_id"],
        asset_ids=asset_ids,
        name=name,
        description=description,
        **extra,
    )
    services["session"].commit()
    services["session"].refresh(bundle)

    # Materialize matching assets in the background when a query was given.
    if source_query:
        from app.api.modules.content.tasks.bundle_populate import populate_bundle_from_query
        populate_bundle_from_query.delay([bundle.id], services["infospace_id"])

    assets_added = len(asset_ids or [])
    await ctx.info(f"Created bundle #{bundle.id} with {assets_added} assets")

    summary = f"✅ Created bundle '{bundle.name}' (ID: {bundle.id})"
    if assets_added:
        summary += f"\n   Added {assets_added} assets"
    if source_query:
        summary += f"\n   Populating from query `{source_query}` in the background"

    structured: Dict[str, Any] = {
        "operation": "create",
        "bundle_id": bundle.id,
        "bundle_name": bundle.name,
        "assets_added": assets_added,
        "status": "success",
    }
    # Query-backed bundles fill over time — open the bundle so the user watches it land.
    if source_query:
        structured["source_query"] = source_query
        structured["ui_directive"] = {"command": "open_item", "payload": {"bundle_id": bundle.id}}

    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content=structured,
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
    
    try:
        from app.api.modules.content.tree import copy as tree_copy
        result = tree_copy(services["session"], asset_ids=asset_ids, to=bundle_id)

        await ctx.info(f"Added {result.assets} assets to bundle #{bundle_id}")

        return ToolResult(
            content=[TextContent(type="text", text=f"Added {result.assets} assets to bundle #{bundle_id}")],
            structured_content={
                "operation": "add",
                "bundle_id": bundle_id,
                "assets_added": result.assets,
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
    
    try:
        from app.api.modules.content.tree import delete as tree_delete
        result = tree_delete(services["session"], asset_ids=asset_ids, out_of=bundle_id, confirm=True)

        removed_count = result.unlinked + result.destroyed_assets
        await ctx.info(f"Removed {removed_count} assets from bundle #{bundle_id}")

        return ToolResult(
            content=[TextContent(type="text", text=f"Removed {removed_count} assets from bundle #{bundle_id}")],
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
    
    from app.api.modules.content.models import Bundle

    try:
        bundle = services["session"].get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != services["infospace_id"]:
            raise ValueError(f"Bundle {bundle_id} not found")
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
    
    try:
        from app.models import Bundle
        bundle = services["session"].get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != services["infospace_id"]:
            raise ValueError(f"Bundle {bundle_id} not found")
        bundle_name = bundle.name

        from app.api.modules.content.tree import delete as tree_delete
        tree_delete(services["session"], bundle_ids=[bundle_id], out_of=bundle.parent_bundle_id, confirm=True)
        services["session"].commit()

        await ctx.info(f"Deleted bundle #{bundle_id}")

        return ToolResult(
            content=[TextContent(type="text", text=f"Deleted bundle '{bundle_name}' (ID: {bundle_id})")],
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

def _schema_field_count(output_contract: Dict[str, Any]) -> int:
    """Count user-visible fields in a hierarchical output_contract."""
    if not isinstance(output_contract, dict):
        return 0
    properties = output_contract.get("properties") or {}
    document = properties.get("document") if isinstance(properties, dict) else None
    if isinstance(document, dict) and isinstance(document.get("properties"), dict):
        return len(document["properties"])
    return len(properties) if isinstance(properties, dict) else 0


def _schema_to_structured(schema: AnnotationSchema) -> Dict[str, Any]:
    """Canonical MCP representation of a schema — matches export/import shape.

    Per-field justification opt-in lives inline on each output_contract
    property as ``include_justification``. The legacy
    ``field_specific_justification_configs`` block is reconstructed from the
    inline flags for FE/LLM compat with older clients.
    """
    from app.api.routes.annotation_schemas import _derive_configs_from_contract
    return {
        "id": schema.id,
        "uuid": str(schema.uuid),
        "name": schema.name,
        "description": schema.description,
        "version": schema.version,
        "instructions": schema.instructions,
        "output_contract": schema.output_contract if isinstance(schema.output_contract, dict) else None,
        "field_specific_justification_configs": _derive_configs_from_contract(schema.output_contract),
        "field_count": _schema_field_count(schema.output_contract or {}),
        "is_active": schema.is_active,
    }


def _render_schema_text(schema: AnnotationSchema, *, include_contract: bool = True) -> str:
    """Full schema as text for the LLM — untruncated JSON round-trippable with schema.update."""
    header = [
        f"Schema #{schema.id}: {schema.name} (v{schema.version}){'  [inactive]' if not schema.is_active else ''}",
    ]
    if schema.description:
        header.append(f"Description: {schema.description}")
    if schema.instructions:
        header.append(f"Instructions: {schema.instructions}")
    if include_contract and isinstance(schema.output_contract, dict):
        header.append("")
        header.append("output_contract:")
        header.append("```json")
        header.append(json.dumps(schema.output_contract, indent=2, ensure_ascii=False))
        header.append("```")
    from app.api.routes.annotation_schemas import _derive_configs_from_contract
    jconfigs = _derive_configs_from_contract(schema.output_contract)
    if include_contract and jconfigs:
        header.append("")
        header.append("field_specific_justification_configs (derived from inline include_justification flags):")
        header.append("```json")
        header.append(json.dumps(jconfigs, indent=2, ensure_ascii=False))
        header.append("```")
    return "\n".join(header)


async def _analysis_get_schema(
    services: Dict,
    ctx: Context,
    schema_id: int,
) -> ToolResult:
    """Fetch one schema with full, untruncated output_contract — for edit round-trips."""
    await ctx.info(f"Getting schema #{schema_id}")
    schema = services["annotation_service"].get_schema(
        schema_id=schema_id,
        infospace_id=services["infospace_id"],
        user_id=services["user_id"],
    )
    if not schema:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Schema #{schema_id} not found in this infospace")],
            structured_content={"error": "schema_not_found", "schema_id": schema_id},
        )
    return ToolResult(
        content=[TextContent(type="text", text=_render_schema_text(schema))],
        structured_content=_schema_to_structured(schema),
    )


def _entity_object_schema(
    entity_type: str = "",
    *,
    description: str = "",
    alternate_types: Optional[List[str]] = None,
    names: Optional[List[str]] = None,
    constrained: bool = True,
    ref: Optional[str] = None,
) -> Dict[str, Any]:
    """HQ's entity reference shape: ``{name, type, additional_types}``.

    Byte-for-byte the shape ``adapters.ts:buildEntityObjectSchema`` emits — the
    ``x-entityField`` marker especially. Everything downstream keys on that
    marker (``schema_map.infer_shape``, the Phase B prompt renderer, the
    ``relational.cooccurs`` path builder); a schema authored without it looks
    like a plain object and can never reach the graph or the canon.
    """
    alts = [t for t in (alternate_types or []) if isinstance(t, str) and t.strip()]
    all_types = ([entity_type] if entity_type else []) + alts
    name_list = [n for n in (names or []) if isinstance(n, str) and n.strip()]
    label = " / ".join(all_types) if all_types else "entity"

    name_prop: Dict[str, Any] = {
        "type": "string",
        "description": f"Name of the {label}" if all_types else "Entity name",
    }
    if name_list:
        name_prop["x-entityEnum"] = name_list
        if constrained:
            name_prop["enum"] = name_list

    type_prop: Dict[str, Any] = {
        "type": "string",
        "description": (
            f"Entity type — pick one of: {', '.join(all_types)}."
            if len(all_types) > 1
            else "Entity type — usually matches the declared primary type."
        ),
    }
    if entity_type:
        type_prop["x-entityTypeDeclared"] = entity_type
        if constrained and all_types:
            type_prop["enum"] = all_types

    obj: Dict[str, Any] = {
        "type": "object",
        "description": description or (f"A {label} reference." if all_types else "An entity reference."),
        "x-entityField": True,
        "properties": {
            "name": name_prop,
            "type": type_prop,
            "additional_types": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Optional additional entity types beyond the primary type.",
            },
        },
        "required": ["name"],
        "x-entityTypeConstrained": constrained,
    }
    if entity_type:
        obj["x-entityType"] = entity_type
    if alts:
        obj["x-entityAlternateTypes"] = alts
    if name_list:
        obj["x-entityEnum"] = name_list
    if ref:
        obj["x-ref"] = ref
    return obj


_TRIPLET_REQUIRED = ["subject_name", "subject_type", "predicate", "object_name", "object_type"]


def _graph_field_schema(f: Dict[str, Any]) -> Dict[str, Any]:
    """A triplet array — the ``subject → predicate → object`` shape.

    Mirrors the graph branch of ``adapters.ts:buildJsonSchemaProperties``,
    including the ``x-fromSource`` / ``x-toSource`` anchors that tie a
    triplet's endpoints back to an entity field elsewhere in the schema.
    """
    types = [t for t in (f.get("entity_types") or []) if isinstance(t, str) and t.strip()]
    preds = [p for p in (f.get("predicates") or []) if isinstance(p, str) and p.strip()]
    type_constrained = bool(f.get("entity_types_constrained", bool(types)))
    pred_constrained = bool(f.get("predicates_constrained", bool(preds)))

    def role_type(role: str) -> Dict[str, Any]:
        s: Dict[str, Any] = {"type": "string", "description": f"Type of the {role} entity"}
        if types:
            s["x-entityTypeList"] = types
            if type_constrained:
                s["enum"] = types
        s["x-entityTypeConstrained"] = type_constrained
        return s

    pred: Dict[str, Any] = {
        "type": "string",
        "description": f.get("predicate_description")
        or "Relationship predicate (e.g. works_for, located_in)",
    }
    if preds:
        pred["x-predicateList"] = preds
        if pred_constrained:
            pred["enum"] = preds
    pred["x-predicateConstrained"] = pred_constrained

    item_props: Dict[str, Any] = {
        "subject_name": {"type": "string", "description": "Name of the subject entity"},
        "subject_type": role_type("subject"),
        "predicate": pred,
        "object_name": {"type": "string", "description": "Name of the object entity"},
        "object_type": role_type("object"),
    }
    extra_props, extra_required = _fields_to_properties(f.get("fields") or [])
    item_props.update(extra_props)

    out: Dict[str, Any] = {
        "type": "array",
        "description": f.get("description") or "Relationship triplets (subject → predicate → object)",
        "items": {
            "type": "object",
            "properties": item_props,
            "required": _TRIPLET_REQUIRED + extra_required,
        },
    }
    if f.get("from_source"):
        out["x-fromSource"] = str(f["from_source"])
    if f.get("to_source"):
        out["x-toSource"] = str(f["to_source"])
    return out


def _field_to_property(f: Dict[str, Any]) -> Dict[str, Any]:
    """One field descriptor → one JSON Schema property node."""
    ftype = str(f.get("type") or "text").strip().lower()
    desc = f.get("description") or ""
    is_array = bool(f.get("array") or f.get("multiple")) or ftype.endswith("[]")
    if ftype.endswith("[]"):
        ftype = ftype[:-2]
    options = f.get("options") or f.get("enum")
    ref = f.get("ref")

    if ftype in ("graph", "triplets", "relationships"):
        # Graph fields are intrinsically arrays — `array: true` is redundant.
        return _graph_field_schema(f)

    if ftype == "entity":
        leaf = _entity_object_schema(
            str(f.get("entity_type") or "").strip(),
            description=desc,
            alternate_types=f.get("entity_types") or f.get("alternate_types"),
            names=options,
            constrained=bool(f.get("constrained", True)),
            # A ref on an ARRAY of entities belongs on the array node (that is
            # where adapters.ts puts it), so only pass it through for scalars.
            ref=None if is_array else ref,
        )
    elif ftype in ("object", "row", "group"):
        sub_props, sub_required = _fields_to_properties(f.get("fields") or [])
        leaf = {"type": "object", "description": desc, "properties": sub_props}
        if sub_required:
            leaf["required"] = sub_required
    elif ftype in ("enum", "select") or options:
        leaf = {"type": "string", "enum": list(options or []), "description": desc}
    elif ftype in ("number", "float"):
        leaf = {"type": "number", "description": desc}
    elif ftype in ("integer", "int"):
        leaf = {"type": "integer", "description": desc}
    elif ftype in ("boolean", "bool"):
        leaf = {"type": "boolean", "description": desc}
    elif ftype in ("date", "datetime", "timestamp"):
        leaf = {"type": "string", "format": "date-time", "description": desc}
    else:  # text / string / default
        leaf = {"type": "string", "description": desc}

    node = {"type": "array", "items": leaf, "description": desc} if is_array else leaf

    # Extensions that live on the property node rather than the leaf.
    if ref and (is_array or ftype != "entity"):
        node["x-ref"] = str(ref)
    canon = f.get("canon")
    if isinstance(canon, dict) and canon:
        node["x-canon"] = canon
    if f.get("justification"):
        node["include_justification"] = True
    return node


def _fields_to_properties(
    fields: List[Dict[str, Any]],
) -> Tuple[Dict[str, Any], List[str]]:
    """Field list → ``(properties, required)``. Recurses for nested rows."""
    props: Dict[str, Any] = {}
    required: List[str] = []
    for f in fields or []:
        if not isinstance(f, dict) or not f.get("name"):
            continue
        name = str(f["name"]).strip()
        props[name] = _field_to_property(f)
        # Default-required preserves the prior behaviour (every authored field
        # was required); an explicit ``required: false`` now opts out.
        if f.get("required", True):
            required.append(name)
    return props, required


def _fields_to_output_contract(fields: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Build a hierarchical output_contract from a field list.

    Lets the model author schemas the natural way — a list of fields — instead
    of hand-writing JSON Schema with HQ's extensions, which it gets wrong.

    Each field: ``{name, type, description?, array?, required?, ref?, canon?}``.

    Types: ``text`` / ``number`` / ``integer`` / ``boolean`` / ``date`` /
    ``enum`` (with ``options``) / ``entity`` / ``object`` (nested row, with
    ``fields``) / ``graph`` (triplets). ``array: true`` — or a ``[]`` suffix —
    wraps the field in an array.

    The three shapes that make a schema graph-capable:

    - ``{"type": "entity", "array": true, "entity_type": "Person"}`` — a
      canon-resolvable roster.
    - ``{"type": "object", "array": true, "fields": [...]}`` — a nested row,
      whose own entity fields can ``ref`` the roster.
    - ``{"type": "graph", "from_source": "entities"}`` — triplets anchored on
      that same roster.

    ``ref`` names another field whose vocabulary this one reuses; that is what
    lets the backend know two paths name the same population (see
    ``annotation/schema_map.py``).

    **The shape to author: named sets, then statements about them.**
    ``GET /annotation_schemas/templates?expand=true`` returns ready-made
    contracts *and their projections* — prefer starting from one over composing
    a field list by hand, because the projections carry the bindings (which
    array is time-bound, what the place is, what each row is *about*) and those
    are where the difficulty lives.

    When composing by hand, the sections are::

        ROSTERS — named sets, declared ONCE, referenced by name everywhere
          actors[]        who acts
          instruments[]   what is USED rather than acting — the mechanism
          places[]        every place named
          interests[]     goals an act can further or work against

        events[]          named happenings many documents each report. The
                          referent layer: `within` and `follows` order them.
        observations[]    what THIS document reports. Roles are generic and
                          named — by · with · to · via · concerns — plus
                          serves/opposes (interests), during (events),
                          cites (evidence), two clocks, modality, magnitude.
                          Each row becomes its own graph node.
        attributes[]      properties OF one thing over an interval (a seat, a
                          role, an interest's domain) — writes onto that thing.
        relations[]       standing links between two, AND hierarchy:
                          part_of · subsumes · furthers.
        evidence[]        citable grounds, when the document numbers them.

    Kept in step with ``annotation/templates.py``, which is the definition. The
    two have drifted before — this text still said ``objects[]`` and
    ``participants`` long after the v2 rename, so every companion-authored
    schema was v1-shaped and derived no graph bindings at all.

    Two rules that decide where a row belongs. **Could this happen more than
    once between the same participants?** and **does it involve more than two
    participants?** Either yes → ``observations``; both no → ``relations``.
    Getting this wrong is not cosmetic: a three-participant row kept as a
    relation *fabricates* connections nobody asserted.

    Declare relations as an ``object`` array with two ``entity`` fields rather
    than as ``graph``/triplets. An entity already carries ``{name, type}``,
    which is exactly what a triplet spells out as ``subject_name`` +
    ``subject_type``; the triplet form is a legacy read path, not the way
    forward.
    """
    props, required = _fields_to_properties(fields)
    return {
        "type": "object",
        "properties": {"document": {"type": "object", "properties": props, "required": required}},
        "required": ["document"],
    }


def _analysis_schema_templates(template_id: Optional[str]) -> ToolResult:
    """Ready-made observation-model schemas, served from the one definition.

    The same ``templates`` module the REST route and the editor read, so a
    companion-authored schema and a hand-picked one are the same artifact.
    That is the whole point: the editor and the companion have each grown their
    own contract emitter before and drifted, and the graph silently got worse
    on one side (A2: companion entity fields lacked ``x-entityField`` and could
    not produce a graph at all).

    Expanded, a template carries **contract and projections**. Both, because a
    contract alone is half a template — the bindings are where the difficulty
    lives, and handing back a good schema with a blank graph is the failure
    this is here to prevent.
    """
    from app.api.modules.annotation.templates import (
        ARCHETYPES, build_contract, build_projections, list_templates,
    )

    templates = list_templates()
    if template_id:
        t = next((x for x in templates if x.id == template_id), None)
        if t is None:
            known = ", ".join(x.id for x in templates)
            return ToolResult(
                content=[TextContent(
                    type="text",
                    text=f"❌ No template {template_id!r}. Available: {known}",
                )],
                structured_content={"error": "unknown_template", "available": known},
            )
        contract = build_contract(t.tier, t.archetypes)
        projections = build_projections(t.tier, t.archetypes)
        return ToolResult(
            content=[TextContent(
                type="text",
                text=(f"📐 {t.label} ({t.tier}) — {t.hint}\n"
                      f"Sections: {', '.join(t.archetypes)}\n"
                      f"{len(projections)} projections carry the graph bindings; pass both "
                      f"to schema.create and the graph panel."),
            )],
            structured_content={
                "template": {
                    "id": t.id, "label": t.label, "tier": t.tier, "hint": t.hint,
                    "archetypes": list(t.archetypes),
                    "output_contract": contract,
                    "projections": projections,
                },
            },
        )

    listing = [
        {"id": t.id, "label": t.label, "tier": t.tier, "hint": t.hint,
         "archetypes": list(t.archetypes)}
        for t in templates
    ]
    lines = "\n".join(f"  • {t['id']} ({t['tier']}) — {t['hint']}" for t in listing)
    return ToolResult(
        content=[TextContent(
            type="text",
            text=(f"📐 {len(listing)} schema templates:\n{lines}\n\n"
                  "Call again with template_id to get one expanded (contract + "
                  "projections). Tiers are strict supersets — minimal is already a "
                  "working graph, standard adds places and relations, full adds "
                  "objects, interests, attributes and numbered evidence."),
        )],
        structured_content={
            "templates": listing,
            "archetypes": [
                {"id": a.id, "label": a.label, "section": a.section, "hint": a.hint}
                for a in ARCHETYPES
            ],
        },
    )


async def _analysis_create_schema(
    services: Dict,
    ctx: Context,
    name: str,
    output_contract: Dict[str, Any],
    description: Optional[str],
    instructions: Optional[str],
    version: str,
    field_specific_justification_configs: Optional[Dict[str, Any]],
) -> ToolResult:
    """Create a schema from a full JSON Schema output_contract.

    Legacy ``field_specific_justification_configs`` argument is lifted into
    inline ``include_justification`` keys on the output_contract before storage.
    """
    from app.api.routes.annotation_schemas import _lift_configs_into_contract
    await ctx.info(f"Creating schema '{name}' (v{version})")
    try:
        contract = _lift_configs_into_contract(output_contract, field_specific_justification_configs)
        schema = services["annotation_service"].create_annotation_schema(
            name=name,
            output_contract=contract,
            user_id=services["user_id"],
            infospace_id=services["infospace_id"],
            description=description,
            instructions=instructions,
            version=version,
        )
        structured = _schema_to_structured(schema)
        structured["status"] = "created"
        text = (
            f"✅ Created schema '{schema.name}' v{schema.version} (ID: {schema.id}, {structured['field_count']} fields)\n\n"
            f"{_render_schema_text(schema)}\n\n"
            f"→ analysis_hub(operation='run.start', schema_id={schema.id}, asset_ids=[...]) to run analysis"
        )
        return ToolResult(
            content=[TextContent(type="text", text=text)],
            structured_content=structured,
        )
    except ValueError as ve:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ {ve}")],
            structured_content={"error": str(ve), "status": "failed"},
        )
    except Exception as e:
        logger.error(f"Failed to create schema: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to create schema: {e}")],
            structured_content={"error": str(e), "status": "failed"},
        )


async def _analysis_update_schema(
    services: Dict,
    ctx: Context,
    schema_id: int,
    updates: Dict[str, Any],
    allow_breaking: bool,
) -> ToolResult:
    """Patch a schema in place. Mirrors PATCH /annotation_schemas/{id}.

    `updates` uses AnnotationSchemaUpdate field names; only provided keys are applied.
    Changing `output_contract` on a schema with existing annotations requires
    `allow_breaking=True` — stored annotation values are contract-shaped.
    """
    await ctx.info(f"Updating schema #{schema_id}: fields={list(updates.keys())}")

    session = services["session"]
    infospace_id = services["infospace_id"]

    schema = session.get(AnnotationSchema, schema_id)
    if not schema or schema.infospace_id != infospace_id:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Schema #{schema_id} not found in this infospace")],
            structured_content={"error": "schema_not_found", "schema_id": schema_id},
        )

    if "output_contract" in updates and updates["output_contract"] != schema.output_contract:
        annotation_count = len(schema.annotations or [])
        if annotation_count > 0 and not allow_breaking:
            return ToolResult(
                content=[TextContent(type="text", text=f"⚠️ Schema #{schema_id} has {annotation_count} existing annotations. Changing output_contract will leave them shaped by the old contract. Re-run with allow_breaking=true to proceed.")],
                structured_content={
                    "error": "breaking_change_blocked",
                    "schema_id": schema_id,
                    "annotation_count": annotation_count,
                },
            )

    try:
        # Translate legacy justification configs (if present) into inline keys
        # on the output_contract — same shape as the route's PATCH translator.
        from app.api.routes.annotation_schemas import _lift_configs_into_contract
        legacy_configs = updates.pop("field_specific_justification_configs", None)
        if legacy_configs is not None or "output_contract" in updates:
            base_contract = updates.get("output_contract", schema.output_contract)
            if legacy_configs is not None:
                updates["output_contract"] = _lift_configs_into_contract(base_contract, legacy_configs)

        for field, value in updates.items():
            setattr(schema, field, value)
        schema.updated_at = datetime.now(timezone.utc)
        session.add(schema)
        session.commit()
        session.refresh(schema)
    except Exception as e:
        session.rollback()
        logger.error(f"Failed to update schema #{schema_id}: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to update schema: {e}")],
            structured_content={"error": str(e), "status": "failed", "schema_id": schema_id},
        )

    structured = _schema_to_structured(schema)
    structured["status"] = "updated"
    structured["updated_fields"] = list(updates.keys())
    # Echo the full schema back when output_contract or justifications changed —
    # that's what the model needs to verify its write. Metadata-only edits get a terse line.
    heavy_fields = {"output_contract", "field_specific_justification_configs"}
    include_contract = bool(heavy_fields & updates.keys())
    text = (
        f"✅ Updated schema '{schema.name}' v{schema.version} (ID: {schema.id}) — changed: {', '.join(updates.keys())}\n\n"
        f"{_render_schema_text(schema, include_contract=include_contract)}"
    )
    return ToolResult(
        content=[TextContent(type="text", text=text)],
        structured_content=structured,
    )


async def _analysis_delete_schema(
    services: Dict,
    ctx: Context,
    schema_id: int,
    hard: bool,
) -> ToolResult:
    """Delete a schema. Soft by default (is_active=False) when annotations exist.

    Hard deletes are cascaded by the DB; use `hard=True` only when you want the
    schema and its annotations gone. Hard delete on a schema with annotations
    requires explicit intent.
    """
    session = services["session"]
    infospace_id = services["infospace_id"]

    schema = session.get(AnnotationSchema, schema_id)
    if not schema or schema.infospace_id != infospace_id:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Schema #{schema_id} not found in this infospace")],
            structured_content={"error": "schema_not_found", "schema_id": schema_id},
        )

    annotation_count = len(schema.annotations or [])
    schema_name = schema.name
    schema_version = schema.version

    if not hard and annotation_count > 0:
        await ctx.info(f"Soft-deleting schema #{schema_id} (preserving {annotation_count} annotations)")
        schema.is_active = False
        schema.updated_at = datetime.now(timezone.utc)
        session.add(schema)
        try:
            session.commit()
        except Exception as e:
            session.rollback()
            logger.error(f"Failed to soft-delete schema #{schema_id}: {e}", exc_info=True)
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Failed to deactivate schema: {e}")],
                structured_content={"error": str(e), "status": "failed", "schema_id": schema_id},
            )
        return ToolResult(
            content=[TextContent(type="text", text=f"✅ Deactivated schema '{schema_name}' v{schema_version} (ID: {schema_id}) — {annotation_count} annotations preserved. Re-activate with schema.update(is_active=true).")],
            structured_content={
                "status": "deactivated",
                "schema_id": schema_id,
                "name": schema_name,
                "version": schema_version,
                "annotation_count": annotation_count,
            },
        )

    await ctx.info(f"Hard-deleting schema #{schema_id} ({annotation_count} annotations)")
    try:
        session.delete(schema)
        session.commit()
    except Exception as e:
        session.rollback()
        logger.error(f"Failed to delete schema #{schema_id}: {e}", exc_info=True)
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Failed to delete schema: {e}")],
            structured_content={"error": str(e), "status": "failed", "schema_id": schema_id},
        )

    return ToolResult(
        content=[TextContent(type="text", text=f"🗑️ Deleted schema '{schema_name}' v{schema_version} (ID: {schema_id})" + (f" and {annotation_count} annotations" if annotation_count else ""))],
        structured_content={
            "status": "deleted",
            "schema_id": schema_id,
            "name": schema_name,
            "version": schema_version,
            "annotations_deleted": annotation_count,
        },
    )


@operation(path="analysis", needs=("language",), posture="confirm", tags=["analysis", "schema", "runs"],
           summary="Author annotation schemas; start and list annotation runs; open dashboards; share.")
async def analysis_hub(
    ctx: Context,
    operation: Annotated[str, "schema.templates (ready-made starting points — CHECK THIS FIRST when the user wants a graph), schema.list, schema.get, schema.stage (co-author a schema inline in chat — PREFERRED), schema.create, schema.update, schema.delete, run.start, run.list, run.dashboard, run.share, panel.add, panel.set, panel.remove (build the dashboard on the open run), graph.query (write a query into the open graph panel's bar)"] = "schema.list",
    schema_name: Annotated[Optional[str], "Schema name — required for schema.create, optional rename for schema.update"] = None,
    output_contract: Annotated[Optional[Dict[str, Any]], "Full JSON Schema output_contract — same shape as schema.list returns. Use the hierarchical {type, properties: {document: {type, properties: {...}, required: [...]}}, required: ['document']} convention. For schema.create, prefer the simpler schema_fields instead."] = None,
    schema_fields: Annotated[Optional[Any], (
        "EASY way to create a schema: a list (or JSON string) of fields "
        "[{name, type, description?, array?, required?, ref?}]. Converted to output_contract "
        "for you — always prefer this over hand-writing output_contract.\n"
        "Types: text, number, integer, boolean, date, enum (+options), entity (+entity_type), "
        "object (a nested row, +fields). array:true for many.\n"
        "\n"
        "RUN schema.templates FIRST. A template already carries the bindings (which array is "
        "time-bound, what the place is, what each row is about), and those are where the "
        "difficulty lives. Compose by hand only when no template fits.\n"
        "\n"
        "THE SHAPE: named sets, then claims about them.\n"
        "  ROSTERS — entity arrays, declared ONCE. Every name used anywhere else must also\n"
        "        appear in its roster; that is what makes the same person named in three\n"
        "        rows become ONE node.\n"
        "    actors[]       who acts — Person, Organization, State\n"
        "    instruments[]  what is USED rather than acting — accounts, vessels, aircraft,\n"
        "                   properties, documents. What recurs here is often the mechanism.\n"
        "    places[]       every place named\n"
        "    interests[]    goals an act can further or work against. Name the GOAL, not\n"
        "                   the actor pursuing it.\n"
        "  events[]        named happenings many documents may each report — a case, an\n"
        "        election, a merger. ONLY when the document gives a name you could search\n"
        "        for; a generic description of what occurred is not a name. `within` and\n"
        "        `follows` order them.\n"
        "  observations[]  what THIS document reports happening. Each row becomes its own\n"
        "        graph node, with a labelled edge per participant. Generic named roles:\n"
        "          by[]        who did it\n"
        "          with[]      who else took part\n"
        "          to[]        who or what it was done to\n"
        "          via[]       who or what it ran THROUGH — the intermediary. Often the\n"
        "                      most valuable field in the row.\n"
        "          concerns[]  what it is about, when that differs from `to`\n"
        "          serves[] / opposes[]  →interests: what it furthers, what it works against\n"
        "          during[]    →events: the occasion it belongs to\n"
        "          cites[]     →evidence\n"
        "        plus at/origin/destination, when/until, covers_from/covers_until (the\n"
        "        period it is ABOUT, often years before it was recorded), modality\n"
        "        (done · attempted · asserted · denied · alleged — a denial must never\n"
        "        read like an assertion), magnitude, justification.\n"
        "  attributes[]    a property OF one thing over an interval (a seat, a term of\n"
        "        office, a budget figure) — writes onto that thing, mints nothing.\n"
        "  relations[]     a standing link between two. ALSO where hierarchy goes: a place\n"
        "        inside a place or a happening inside a happening (`part_of`), an interest\n"
        "        that is a component of a broader one (`subsumes`) or that advances one\n"
        "        without being part of it (`furthers`).\n"
        "  evidence[]      citable grounds, when the document itself numbers them.\n"
        "\n"
        "TWO QUESTIONS decide where a row goes. Could this happen MORE THAN ONCE between the "
        "same participants? Does it involve MORE THAN TWO participants? Either yes → "
        "observations[]; both no → relations[]. This is not cosmetic: a three-participant row "
        "left as a relation FABRICATES connections nobody asserted (payer/payee/bank emits "
        "'payee paid bank').\n"
        "\n"
        "Write a relation as an object array with two entity fields — NOT as triplets. An "
        "entity already carries {name, type}, which is exactly what a triplet spells out as "
        "subject_name + subject_type. The triplet form is a legacy read path.\n"
        "\n"
        "`ref` names another field whose vocabulary this one reuses — that is what tells the "
        "system two fields name the same entities, so they merge into one node and resolve to "
        "one canon entry. Declare the roster once and ref it everywhere.\n"
        "  {name:'actors', type:'entity', array:true, entity_type:'Person'}\n"
        "  {name:'interests', type:'entity', array:true, entity_type:'Interest'}\n"
        "  {name:'observations', type:'object', array:true, fields:[\n"
        "     {name:'kind', type:'enum', options:['meeting','payment','statement']},\n"
        "     {name:'by', type:'entity', array:true, entity_type:'Person', ref:'actors'},\n"
        "     {name:'via', type:'entity', array:true, entity_type:'Organization', ref:'actors'},\n"
        "     {name:'at', type:'entity', entity_type:'Location', ref:'places'},\n"
        "     {name:'serves', type:'entity', array:true, entity_type:'Interest', ref:'interests'},\n"
        "     {name:'when', type:'date'}]}\n"
        "\n"
        "Ask for place NAMES, never coordinates — those are resolved server-side. Ask only for "
        "identifiers the DOCUMENT supplies; never have the model invent one."
    )] = None,
    schema_description: Annotated[Optional[str], "Schema description"] = None,
    schema_instructions: Annotated[Optional[str], "LLM instructions for the schema"] = None,
    schema_version: Annotated[Optional[str], "Schema version (defaults to 1.0 on create)"] = None,
    field_specific_justification_configs: Annotated[Optional[Dict[str, Any]], "Per-field justification config map"] = None,
    is_active: Annotated[Optional[bool], "Toggle schema activity — used by schema.update"] = None,
    allow_breaking: Annotated[bool, "schema.update: permit output_contract change on a schema that already has annotations"] = False,
    hard_delete: Annotated[bool, "schema.delete: drop the schema and its annotations instead of soft-deactivating"] = False,
    schema_id: Annotated[Optional[int], "Required for schema.get/schema.update/schema.delete; filter for run.list; target for run.start/run.dashboard/run.share"] = None,
    asset_ids: Annotated[Optional[List[int]], "Required for run.start"] = None,
    run_name: Annotated[Optional[str], "Optional friendly name for run.start"] = None,
    custom_instructions: Annotated[Optional[str], "Optional extra guidance for run.start"] = None,
    status: Annotated[Optional[str], "Filter for run.list: pending/running/completed/failed/completed_with_errors"] = None,
    run_query: Annotated[Optional[str], "run.list: search — only runs whose name contains this text (case-insensitive). Use this instead of paging through every run."] = None,
    limit: Annotated[int, "Pagination for run.list"] = 20,
    offset: Annotated[int, "Pagination for run.list"] = 0,
    run_id: Annotated[Optional[int], "Required for run.dashboard/run.share"] = None,
    share_name: Annotated[Optional[str], "Optional title for run.share"] = None,
    expiration_days: Annotated[Optional[int], "Optional expiry for run.share"] = None,
    live: Annotated[bool, "run.start: keep the run LIVE — HQ re-annotates new content in scope as it arrives"] = False,
    source_bundle_id: Annotated[Optional[int], "run.start: the bundle a live run watches (its subtree). Use instead of asset_ids to watch a whole bundle, even an empty one."] = None,
    follow_on_version_change: Annotated[bool, "run.start: re-annotate when an asset's content version changes"] = False,
    # Panel authoring (operates on the run currently OPEN in the Annotation Runner — navigate there first; run.start does)
    panel_type: Annotated[Optional[str], "panel.add: table | chart | pie | map | scatter | measurements"] = None,
    panel_name: Annotated[Optional[str], "panel.add: the new panel's title. panel.set/panel.remove: the title of the panel to target."] = None,
    panel_description: Annotated[Optional[str], "panel.add/panel.set: a short description"] = None,
    panel_index: Annotated[Optional[int], "panel.set/panel.remove: target a panel by 0-based position instead of name"] = None,
    panel_axis: Annotated[Optional[Dict[str, Any]], "panel.add/panel.set: role→field map for the panel kind. chart: {x, y, color, mark}; pie: {slice_by, value, facet}; map: {position, color, label}; table: {columns}; scatter: {x, y, color, size}. Fields are dotted paths like 'document.sentiment'."] = None,
    panel_filter: Annotated[Optional[Any], "panel.add/panel.set: a FilterSet {logic:'and'|'or', conditions:[{path, operator, value}]} (or just the conditions list). Narrows the panel's data. Do NOT author formulas."] = None,
    panel_size: Annotated[Optional[Dict[str, int]], "panel.add/panel.set: grid size/position {w, h, x?, y?}. Usually omit — sizes are standardized per panel kind and the layout is auto-arranged."] = None,
    graph_query: Annotated[Optional[str], (
        "graph.query: a GQL string for the open graph panel. Space=AND, comma=OR, "
        "'-' negates.\n"
        "  type:Person  -type:Location      node entity type\n"
        "  kind:occurrence  kind:entity     things that HAPPENED vs things that PERSIST\n"
        "  role:via                         the slot a node occupied (payer, via, on_board)\n"
        "  serves:opacity                   nodes serving an interest; 'serves:X+' rolls\n"
        "                                   up through the interest hierarchy\n"
        "  converge>0.6                     actors whose interest profiles overlap MORE\n"
        "                                   than their graph distance predicts. Zero at\n"
        "                                   one hop, so it surfaces alignment WITHOUT\n"
        "                                   contact — the pair worth looking at\n"
        "  predicate:funds,owns             edge predicate\n"
        "  degree>3  weight>2               well-connected nodes / strong edges. With a\n"
        "                                   role: present, degree counts only that role —\n"
        "                                   'role:via degree>20' finds intermediaries\n"
        "  confidence>0.8                   a row column (pushed into SQL)\n"
        "  doc.relevance>0.7                a DOCUMENT field, one level up — the\n"
        "                                   cheapest filter there is; discards whole\n"
        "                                   annotations before any row is exploded\n"
        "  label==\"Acme Ltd\"                the node's own name, EXACTLY (bare text\n"
        "                                   is a substring match on the same string)\n"
        "  after:2020 before:2023           active in a window\n"
        "  from:\"Angela Merkel\" hops:2      traverse out from an entity\n"
        "  from:\"A\" from:\"B\"                separate from: tokens INTERSECT — reachable\n"
        "                                   from both, which is how co-presence is asked.\n"
        "                                   Commas inside one token still union.\n"
        "  hops:2-origin / -paths           a -flag SUBTRACTS. By default a traversal\n"
        "                                   returns the selection, the node you started\n"
        "                                   from, and the nodes connecting them; -origin\n"
        "                                   and -paths drop those. Combine in any order.\n"
        "  near:\"Berlin\"<200km             within a radius of a geocoded node\n"
        "  field:document.observations[*]   restrict to one graph source\n"
        "Identity filters SELECT; they do not block paths. 'type:Location from:\"X\" hops:2' "
        "is 'the places within two hops of X', not 'a route made only of places'. hops: "
        "counts ACTOR steps — an occurrence between two people is one step, not two. "
        "Write the query the user asked for; they see it in the bar and can edit it. "
        "Pass an empty string to clear."
    )] = None,
    graph_focus: Annotated[Optional[str], (
        "graph.query: focus one entity by name instead of writing a full query — "
        "shorthand for from:\"<name>\" hops:1. Use with graph_hops to go wider."
    )] = None,
    graph_hops: Annotated[Optional[int], "graph.query: hops for graph_focus (default 1)."] = None,
    template_id: Annotated[Optional[str], (
        "schema.templates: return this one template EXPANDED — its full output_contract and "
        "its projections. Omit to list all of them with their hints. Pass the contract "
        "straight to schema.create, or seed schema.stage from it to shape it with the user."
    )] = None,
    panels: Annotated[Optional[List[Dict[str, Any]]], "panel.add (BATCH — strongly preferred): build the WHOLE dashboard in ONE call. A list of {type, name, description?, axis, filter?} — one per panel. Sizes + layout are automatic; do not set them."] = None,
) -> ToolResult:
    """
    Unified analysis control panel: schemas CRUD, runs, dashboards, sharing.

    PREFER THIS over navigate() for anything schema- or run-related. Schemas
    are not assets — navigate() will not find them, and trying to locate a
    schema by walking the workspace tree is the #1 cause of iteration-limit
    exhaustion. Go straight here.

    <operations>
    • schema.templates ............. Ready-made observation-model schemas. START HERE whenever the user wants a graph, a map, a timeline, or "who did what to whom". Omit template_id to list; pass one to get its output_contract AND its projections. A template's bindings are the hard part — composing a field list by hand loses them.
    • schema.list .................. Browse schemas (summary — use schema.get before editing).
    • schema.get ................... schema_id. Returns one schema with the full, untruncated output_contract.
    • schema.stage ................. schema_name + schema_fields. Renders a lean field editor INLINE in the chat, seeded with your proposed fields, for the user to shape and confirm — then resumes. PREFER this when building a schema *with* a user; it lands the same schema as schema.create.
    • schema.create ................ schema_name + output_contract (full JSON Schema). Immediate — use when no confirmation is wanted.
    • schema.update ................ schema_id + any of: schema_name/output_contract/schema_description/schema_instructions/schema_version/field_specific_justification_configs/is_active. Only provided fields change. output_contract change on a schema with annotations needs allow_breaking=true.
    • schema.delete ................ schema_id. Soft-deactivates when annotations exist; use hard_delete=true to drop the schema and annotations.
    • run.start .................... Provide schema_id + asset_ids (optionally run_name/custom_instructions).
    • run.list ..................... Optional filters schema_id/status, run_query (search by name), plus pagination. Prefer run_query to find a run by name instead of paging.
    • run.dashboard ................ run_id. OPENS that run on the Annotation Runner (so you can build its dashboard with panel.add/set) and returns its results. Use this to reopen an existing run before adding panels.
    • run.share .................... Provide run_id (plus optional share_name/expiration_days) for a public link.
    • panel.add .................... BATCH (preferred): pass `panels`=[{type, name, axis, filter?}, …] to build the whole dashboard in ONE call — sizes + layout are automatic. Or a single panel via panel_type+panel_name+panel_axis. Adds to the run OPEN in the Annotation Runner. Set axes + filters; never formulas, never sizes.
    • panel.set .................... panel_name or panel_index + any of panel_axis/panel_filter/panel_size/panel_description. Reconfigures an existing panel.
    • panel.remove ................. panel_name or panel_index. Removes a panel.

    Round-trip edit pattern (3 calls, under any iteration cap):
      schema.list → schema.get(schema_id=...) → schema.update(schema_id=..., output_contract=...)
    """
    with get_services() as services:
        access = _gate(services)

        if operation in ("schema.create", "schema.stage", "schema.update", "schema.delete",
                         "panel.add", "panel.set", "panel.remove"):
            _require(access, Capability.ORGANIZE)
        elif operation == "run.start":
            _require(access, Capability.COMPUTE)

        await ctx.info(f"analysis_hub: operation={operation}")

        if operation == "schema.templates":
            return _analysis_schema_templates(template_id)

        if operation == "schema.list":
            return await _analysis_list_schemas(services, ctx)

        if operation == "schema.get":
            if not schema_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.get requires schema_id")],
                    structured_content={"error": "missing_schema_id"},
                )
            return await _analysis_get_schema(services, ctx, schema_id)

        if operation == "schema.stage":
            # Stage-then-confirm (the PREFERRED way to author a schema with a user):
            # render a lean field editor *inline in the chat* (command=stage_schema)
            # seeded with the proposed fields. The user shapes and confirms it, and a
            # <form_result> resumes us. Creation happens on confirm (frontend), so
            # nothing is written here.
            if not schema_name:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.stage requires schema_name")],
                    structured_content={"error": "missing_schema_name"},
                )
            try:
                staged_fields = (json.loads(schema_fields) if isinstance(schema_fields, str) else schema_fields) or []
            except (ValueError, TypeError) as e:
                return ToolResult(
                    content=[TextContent(type="text", text=f"❌ schema_fields must be a list of field objects: {e}")],
                    structured_content={"error": "invalid_schema_fields", "detail": str(e)},
                )
            import uuid as _uuid
            token = f"schema-{_uuid.uuid4().hex[:12]}"
            n = len(staged_fields) if isinstance(staged_fields, list) else 0
            return ToolResult(
                content=[TextContent(type="text", text=f"⏸ Prepared schema '{schema_name}' ({n} field{'' if n == 1 else 's'}) — shape and confirm it below and I'll continue.")],
                structured_content={
                    "staged": True,
                    "ui_directive": {
                        "command": "stage_schema",
                        "payload": {
                            "name": schema_name,
                            "description": schema_description or "",
                            "instructions": schema_instructions or None,
                            "fields": staged_fields,
                        },
                        "await_return": True,
                        "return_token": token,
                    },
                },
            )

        if operation == "schema.create":
            # Accept the natural field-list form and convert it to output_contract.
            if schema_fields is not None and not output_contract:
                try:
                    fields = json.loads(schema_fields) if isinstance(schema_fields, str) else schema_fields
                    output_contract = _fields_to_output_contract(fields)
                except (ValueError, TypeError) as e:
                    return ToolResult(
                        content=[TextContent(type="text", text=f"❌ schema_fields must be a list of field objects: {e}")],
                        structured_content={"error": "invalid_schema_fields", "detail": str(e)},
                    )
            if not schema_name or not output_contract:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.create requires schema_name and either schema_fields (a field list) or output_contract (full JSON Schema)")],
                    structured_content={"error": "missing_schema_definition"},
                )
            return await _analysis_create_schema(
                services=services,
                ctx=ctx,
                name=schema_name,
                output_contract=output_contract,
                description=schema_description,
                instructions=schema_instructions,
                version=schema_version or "1.0",
                field_specific_justification_configs=field_specific_justification_configs,
            )

        if operation == "schema.update":
            if not schema_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.update requires schema_id")],
                    structured_content={"error": "missing_schema_id"},
                )
            updates: Dict[str, Any] = {}
            if schema_name is not None: updates["name"] = schema_name
            if output_contract is not None: updates["output_contract"] = output_contract
            if schema_description is not None: updates["description"] = schema_description
            if schema_instructions is not None: updates["instructions"] = schema_instructions
            if schema_version is not None: updates["version"] = schema_version
            if field_specific_justification_configs is not None: updates["field_specific_justification_configs"] = field_specific_justification_configs
            if is_active is not None: updates["is_active"] = is_active
            if not updates:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.update needs at least one field to change")],
                    structured_content={"error": "no_updates_provided", "schema_id": schema_id},
                )
            return await _analysis_update_schema(
                services=services, ctx=ctx,
                schema_id=schema_id, updates=updates, allow_breaking=allow_breaking,
            )

        if operation == "schema.delete":
            if not schema_id:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ schema.delete requires schema_id")],
                    structured_content={"error": "missing_schema_id"},
                )
            return await _analysis_delete_schema(
                services=services, ctx=ctx,
                schema_id=schema_id, hard=hard_delete,
            )

        if operation == "run.start":
            if not schema_id or (not asset_ids and not source_bundle_id):
                return ToolResult(
                    content=[TextContent(type="text", text="❌ run.start requires schema_id and either asset_ids or source_bundle_id (for a live bundle watch)")],
                    structured_content={"error": "missing_run_parameters"}
                )
            return await _analysis_start_run(
                services=services,
                ctx=ctx,
                asset_ids=asset_ids,
                schema_id=schema_id,
                name=run_name,
                custom_instructions=custom_instructions,
                live=live,
                source_bundle_id=source_bundle_id,
                follow_on_version_change=follow_on_version_change,
            )

        if operation == "run.list":
            return await _analysis_list_runs(
                services=services,
                ctx=ctx,
                schema_id=schema_id,
                status=status,
                name=run_query,
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

        # Panel authoring is UI-driven: these emit a `dashboard:*` directive that the
        # Annotation Runner applies to the OPEN run's dashboard (and persists). No
        # backend write here — and no formulas: only axes (panel_config) + a filter.
        if operation in ("panel.add", "panel.set", "panel.remove"):
            # Model tool-args sometimes arrive JSON-encoded as strings — especially the
            # Any-typed panel_filter (unlike Dict-typed panel_axis, which is coerced for
            # us). Parse them so axis/filter/size reach the frontend as real objects.
            def _coerce_json(v):
                if isinstance(v, str):
                    try:
                        return json.loads(v)
                    except (ValueError, TypeError):
                        return v
                return v
            panel_axis = _coerce_json(panel_axis)
            panel_filter = _coerce_json(panel_filter)
            panel_size = _coerce_json(panel_size)

        if operation == "graph.query":
            # The operator writes the query string; the panel's bar renders it
            # so the user can see and edit what was asked for. Deliberately not
            # a hidden filter — inspectability is the point.
            if graph_focus:
                hops = graph_hops if isinstance(graph_hops, int) and graph_hops > 0 else 1
                payload = {"name": graph_focus, "hops": hops}
                return ToolResult(
                    content=[TextContent(type="text", text=(
                        f"🔎 Focusing the graph on '{graph_focus}' ({hops} hop"
                        f"{'' if hops == 1 else 's'})."
                    ))],
                    structured_content={
                        "ui_directive": {"command": "graph:focus", "payload": payload},
                    },
                )
            if graph_query is None:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ graph.query requires graph_query or graph_focus")],
                    structured_content={"error": "missing_graph_query"},
                )
            q = graph_query.strip()
            return ToolResult(
                content=[TextContent(type="text", text=(
                    f"🔍 Graph query: `{q}`" if q else "🔍 Cleared the graph query."
                ))],
                structured_content={
                    "graph_query": q,
                    "ui_directive": {"command": "graph:query", "payload": {"q": q}},
                },
            )

        if operation == "panel.add" and panels:
            # Batch: build the whole dashboard in one call → one directive that
            # creates + configures + auto-arranges every panel.
            specs_raw = _coerce_json(panels) or []
            clean: List[Dict[str, Any]] = []
            for sp in specs_raw:
                if not isinstance(sp, dict) or not sp.get("type") or not sp.get("name"):
                    continue
                sp = dict(sp)
                for k in ("axis", "filter", "size"):
                    if k in sp:
                        sp[k] = _coerce_json(sp[k])
                clean.append(sp)
            if not clean:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ panel.add batch needs a `panels` list of {type, name, ...}")],
                    structured_content={"error": "empty_panels"},
                )
            names = ", ".join(f"{s['type']} '{s['name']}'" for s in clean)
            return ToolResult(
                content=[TextContent(type="text", text=f"➕ Added {len(clean)} panels: {names}.")],
                structured_content={
                    "panels": clean,
                    "ui_directive": {"command": "dashboard:addPanels", "payload": {"panels": clean}},
                },
            )

        if operation == "panel.add":
            if not panel_type or not panel_name:
                return ToolResult(
                    content=[TextContent(type="text", text="❌ panel.add requires panel_type and panel_name")],
                    structured_content={"error": "missing_panel_params"},
                )
            add_payload: Dict[str, Any] = {"type": panel_type, "name": panel_name}
            if panel_description is not None: add_payload["description"] = panel_description
            if panel_axis: add_payload["axis"] = panel_axis
            if panel_filter is not None: add_payload["filter"] = panel_filter
            if panel_size: add_payload["size"] = panel_size
            return ToolResult(
                content=[TextContent(type="text", text=f"➕ Added a {panel_type} panel '{panel_name}' to the dashboard.")],
                structured_content={
                    "panel": add_payload,
                    "ui_directive": {"command": "dashboard:addPanel", "payload": add_payload},
                },
            )

        if operation in ("panel.set", "panel.remove"):
            if panel_name is None and panel_index is None:
                return ToolResult(
                    content=[TextContent(type="text", text=f"❌ {operation} requires panel_name or panel_index")],
                    structured_content={"error": "missing_panel_target"},
                )
            set_payload: Dict[str, Any] = {}
            if panel_name is not None: set_payload["name"] = panel_name
            if panel_index is not None: set_payload["index"] = panel_index
            target = panel_name if panel_name is not None else f"#{panel_index}"
            if operation == "panel.remove":
                return ToolResult(
                    content=[TextContent(type="text", text=f"🗑 Removed panel '{target}'.")],
                    structured_content={"ui_directive": {"command": "dashboard:removePanel", "payload": set_payload}},
                )
            if panel_description is not None: set_payload["description"] = panel_description
            if panel_axis: set_payload["axis"] = panel_axis
            if panel_filter is not None: set_payload["filter"] = panel_filter
            if panel_size: set_payload["size"] = panel_size
            return ToolResult(
                content=[TextContent(type="text", text=f"🛠 Reconfigured panel '{target}'.")],
                structured_content={
                    "panel": set_payload,
                    "ui_directive": {"command": "dashboard:setPanel", "payload": set_payload},
                },
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
    live: bool = False,
    source_bundle_id: Optional[int] = None,
    follow_on_version_change: bool = False,
) -> ToolResult:
    await ctx.info(f"Creating analysis run for {len(asset_ids)} assets with schema #{schema_id}")
    
    try:
        # Validate that the assets exist in this infospace BEFORE creating the run
        # This gives immediate feedback rather than failing in background celery task
        asset_ids = asset_ids or []
        valid_assets = services["session"].exec(
            select(Asset)
            .where(Asset.id.in_(asset_ids))
            .where(Asset.infospace_id == services["infospace_id"])
        ).all() if asset_ids else []
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
        
        if not valid_assets and not source_bundle_id:
            return ToolResult(
                content=[TextContent(type="text", text="❌ run.start needs asset_ids, or source_bundle_id for a live bundle watch.")],
                structured_content={"error": "no_target", "status": "failed"}
            )
        
        run_name = name or f"Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}"
        
        # Use the chat's selected model for annotation runs
        # Falls back to a sensible default if not available
        stored_keys = services.get("runtime_api_keys", {})
        model_name = services.get("model_name")
        
        provider_name = services.get("provider_name")
        if not model_name:
            # Fallback: pick based on available stored credentials
            if stored_keys.get("anthropic"):
                model_name = "claude-sonnet-4-6"
                provider_name = provider_name or "anthropic"
            elif stored_keys.get("openai"):
                model_name = "gpt-5.2"
                provider_name = provider_name or "openai"
            elif stored_keys.get("gemini") or stored_keys.get("GOOGLE_API_KEY"):
                model_name = "gemini-3-flash"
                provider_name = provider_name or "gemini"
            else:
                model_name = "qwen3:14b"  # Local Ollama fallback
                provider_name = provider_name or "ollama"

        configuration = {
            "model": model_name,
            "provider": provider_name,
            "api_keys": stored_keys if stored_keys else None
        }
        if custom_instructions:
            configuration["custom_instructions"] = custom_instructions
        
        await ctx.info(f"Using model: {model_name}")
        
        run_create = AnnotationRunCreate(
            name=run_name,
            description=f"Analysis via chat{': ' + custom_instructions if custom_instructions else ''}",
            schema_ids=[schema_id],
            target_asset_ids=list(valid_asset_ids) if valid_asset_ids else None,
            source_bundle_id=source_bundle_id,
            live=live,
            follow_on_version_change=follow_on_version_change,
            configuration=configuration,
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
        
        target_desc = (f"{len(valid_assets)} documents: {asset_summary}" if valid_assets
                       else f"bundle #{source_bundle_id}")
        live_note = " · LIVE (HQ re-annotates new content as it arrives)" if live else ""
        return ToolResult(
            content=[TextContent(type="text", text=f"🔬 Started run '{run_name}' (ID: {run.id}){live_note}\n\n📊 Target: {target_desc}\n\n🤖 Model: {model_name}\n📋 Schema: #{schema_id}\n\n⏳ Status: {run.status.value}\n\n→ Check results: analysis_hub(operation='run.dashboard', run_id={run.id})")],
            structured_content={
                "run_id": run.id,
                "run_name": run.name,
                "run_uuid": str(run.uuid),
                "schema_id": schema_id,
                "model_name": model_name,
                "asset_count": len(valid_assets),
                "asset_ids": list(valid_asset_ids) if valid_asset_ids else [],
                "live": bool(live),
                "source_bundle_id": source_bundle_id,
                "status": run.status.value,
                "created_at": run.created_at.isoformat() if run.created_at else None,
                # Co-presence: open the run on the full Annotation Runner page and select
                # it there (navigate lands the page; runner:open selects the run even if
                # we're already on the runner or it isn't in the loaded list yet), so its
                # dashboard + the panel-building verbs operate on it.
                "ui_directive": [
                    {"command": "navigate", "payload": {"to": f"/hq/infospaces/annotation-runner?runId={run.id}"}},
                    {"command": "runner:open", "payload": {"run_id": run.id}},
                ],
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


@operation(path="workspace/tasks", tags=["tasks", "productivity"],
           summary="Conversation-scoped task planning (batch add/start/finish/cancel).")
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










@operation(path="workspace/memory", tags=["memory", "context"],
           summary="Scratchpad for assets, findings, paths, and notes across turns.")
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
    name: Optional[str] = None,
) -> ToolResult:
    from sqlmodel import select, and_
    from app.models import AnnotationRun, RunStatus

    await ctx.info(f"Listing runs (schema_id={schema_id}, status={status}, name={name})")
    
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
    
    if name and name.strip():
        query = query.where(AnnotationRun.name.ilike(f"%{name.strip()}%"))

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

        # Put actual extracted values in the model's stream — a bare count leaves
        # the model unable to verify the run succeeded or reason over what it
        # extracted. The frontend still renders the full set from structured_content.
        if annotation_data:
            summary_lines.append("")
            summary_lines.append(_render_rows_for_model(
                annotation_data,
                label="Annotation values",
                total=len(annotations),
            ))

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
            # Co-presence: open THIS run on the Annotation Runner and select it, so the
            # dashboard shows and panel.add/panel.set operate on it (works for an
            # existing run whether or not we're already on the runner page).
            "ui_directive": [
                {"command": "navigate", "payload": {"to": f"/hq/infospaces/annotation-runner?runId={run.id}"}},
                {"command": "runner:open", "payload": {"run_id": run.id}},
            ],
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
    from app.api.modules.content.services import AssetBuilder
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
    if asset_kind == AssetKind.CSV:
        return await _asset_create_csv_container(services, ctx, builder, data)
    elif asset_kind == AssetKind.CSV_ROW:
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


async def _asset_create_csv_container(services: Dict, ctx: Context, builder, data: Dict[str, Any]) -> ToolResult:
    """Create CSV parent container asset."""
    title = data.get("title")
    columns = data.get("columns")
    
    if not title:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'title' field is required for CSV container creation")],
            structured_content={"error": "title is required"}
        )
    
    if not columns or not isinstance(columns, list) or len(columns) == 0:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ 'columns' field is required for CSV container creation\n\nRequired:\n- columns (list): Column names, e.g. ['Name', 'Age', 'City']\n\nReceived data: {list(data.keys())}")],
            structured_content={
                "error": "missing_required_fields",
                "missing_fields": ["columns"],
                "received_fields": list(data.keys()),
                "required_fields": ["title", "columns"],
                "hint": "columns should be a list of column names"
            }
        )
    
    description = data.get("description")

    from app.models import AssetKind, ProcessingStatus
    metadata = {
        "columns": columns,
        "column_count": len(columns),
        "row_count": 0,
        "created_via": "mcp_chat",
    }
    if description:
        metadata["description"] = description
    asset = await (
        builder
        .as_kind(AssetKind.CSV)
        .with_title(title)
        .with_text(",".join(columns))  # header as text content
        .with_metadata(**metadata)
        .with_processing_status(ProcessingStatus.READY)
        .no_dedup()
        .build()
    ).asset
    services["session"].commit()  # v2: builder flushes only; caller owns tx
    services["session"].refresh(asset)

    return ToolResult(
        content=[TextContent(type="text", text=f"✅ CSV Dataset #{asset.id}: {asset.title}\nColumns: {', '.join(columns)}\n\nAdd rows with:\n  library_hub(operation='asset.create', kind='csv_row', row_data={{'Column1': 'value1', ...}}, parent_asset_id={asset.id})")],
        structured_content={
            "asset_id": asset.id,
            "asset_title": asset.title,
            "asset_kind": asset.kind.value,
            "columns": columns,
            "column_count": len(columns),
            "row_count": 0,
            "status": "created"
        }
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
    next_part_index = 0
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
        
        # Get the next part_index by counting existing rows
        from sqlmodel import select, func
        existing_rows_count = services["session"].exec(
            select(func.count(Asset.id))
            .where(Asset.parent_asset_id == parent_asset_id)
            .where(Asset.kind == AssetKind.CSV_ROW)
        ).one()
        next_part_index = existing_rows_count
        
        # Update parent's row_count in file_info
        file_info = parent_asset.file_info or {}
        file_info['row_count'] = existing_rows_count + 1
        parent_asset.file_info = file_info
        services["session"].add(parent_asset)
        services["session"].commit()

    # Get column headers from parent if available
    column_headers = None
    if parent_asset and (parent_asset.file_info or {}).get("columns"):
        column_headers = parent_asset.file_info["columns"]

    # Build and create the CSV row with proper part_index
    from app.models import AssetKind, ProcessingStatus
    from app.api.modules.content.types.csv import (
        csv_row_title, csv_row_text, csv_row_metadata,
    )
    row_title = csv_row_title(row_data, next_part_index if parent_asset_id else 0)
    row_text = csv_row_text(row_data, column_headers)
    row_meta = csv_row_metadata(row_data, column_headers)

    builder = (
        builder
        .as_kind(AssetKind.CSV_ROW)
        .with_title(row_title)
        .with_text(row_text)
        .with_metadata(**row_meta)
        .with_processing_status(ProcessingStatus.READY)
        .no_dedup()  # each row is a fresh child; caller controls identity
    )
    if parent_asset_id:
        builder = builder.as_child_of(parent_asset_id).with_part_index(next_part_index)
    asset = (await builder.build()).asset
    services["session"].commit()  # v2: builder flushes only; caller owns tx
    services["session"].refresh(asset)

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

    from app.models import AssetKind, ProcessingStatus
    asset = await (
        builder
        .as_kind(AssetKind.ARTICLE)
        .with_title(title)
        .with_text(content)
        .with_metadata(
            content_format="markdown",
            content_source="user",
            composition_type="free_form_article",
            ingestion_method="article_composition",
        )
        .with_processing_status(ProcessingStatus.READY)
        .no_dedup()
        .build()
    ).asset
    services["session"].commit()  # v2: builder flushes only; caller owns tx
    services["session"].refresh(asset)

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
    """Create web asset. A stub (bookmark) is source-less authoring — built sync via
    AssetBuilder. Content-with-an-origin goes through ``intake`` like every producer:
    one ``web`` job, the source scrapes it, the agent polls the job."""
    url = data.get("url")
    if not url:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'url' field is required for web asset creation")],
            structured_content={"error": "url is required"}
        )

    title = data.get("title")
    stub = data.get("stub", False)

    if stub:
        # URL bookmark — no scraping. Dedupes on URL to avoid duplicate bookmarks.
        from app.models import AssetKind, ProcessingStatus
        asset = await (
            builder
            .as_kind(AssetKind.WEB)
            .as_stub(True)
            .with_title(title or url)
            .with_source(url)
            .with_metadata(ingestion_method="url_bookmark")
            .with_processing_status(ProcessingStatus.READY)
            .dedup_on(source_identifier=url)
            .on_match("skip")
            .build()
        ).asset
        services["session"].commit()  # v2: builder flushes only; caller owns tx
        services["session"].refresh(asset)
        return ToolResult(
            content=[TextContent(type="text", text=f"✅ Web #{asset.id}\n{asset.title}")],
            structured_content={
                "asset_id": asset.id,
                "asset_title": asset.title,
                "asset_kind": asset.kind.value,
                "url": url,
                "stub": True,
                "status": "created"
            }
        )

    from app.api.modules.content.intake import intake
    jobs = intake(
        services["session"],
        infospace_id=services["infospace_id"],
        user_id=services["user_id"],
        groups={"web": [{"url": url, **({"title": title} if title else {})}]},
    )
    job = jobs[0]
    return ToolResult(
        content=[TextContent(type="text", text=f"✅ Queued web ingestion for {url}\nIngestion job: {job.id}")],
        structured_content={
            "job_id": job.id,
            "url": url,
            "stub": False,
            "status": "queued"
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

    from app.models import AssetKind, ProcessingStatus
    asset = await (
        builder
        .as_kind(AssetKind.TEXT)
        .with_title(title or f"Text: {content[:30]}...")
        .with_text(content)
        .with_metadata(ingestion_method="direct_text")
        .with_processing_status(ProcessingStatus.READY)
        .no_dedup()
        .build()
    ).asset
    services["session"].commit()  # v2: builder flushes only; caller owns tx
    services["session"].refresh(asset)

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
    if "file_info" in updates:
        update_dict["file_info"] = updates["file_info"]
    if "facets" in updates:
        update_dict["facets"] = updates["facets"]
    
    if not update_dict:
        return ToolResult(
            content=[TextContent(type="text", text="❌ No valid update fields provided. Supported: 'title', 'text_content' (or 'content'), 'file_info', 'facets'")],
            structured_content={"error": "no valid updates"}
        )
    
    # Apply updates directly — this endpoint is fields-only (no dedup, no versioning).
    session = services["session"]
    for field, value in update_dict.items():
        setattr(asset, field, value)
    session.add(asset)
    session.commit()
    session.refresh(asset)
    updated_asset = asset
    
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
    """Update CSV row asset — merges updates into existing row_data, rewrites
    title + text_content, updates file_info. In-place mutation (no versioning)."""
    updates = data.get("updates")
    if not updates:
        return ToolResult(
            content=[TextContent(type="text", text="❌ 'updates' field is required for CSV row update")],
            structured_content={"error": "updates is required"}
        )

    merge_strategy = data.get("merge_strategy", "overwrite")

    from app.api.modules.content.types.csv import (
        merged_csv_row, csv_row_title, csv_row_text, csv_row_update_metadata,
    )
    session = services["session"]
    infospace_id = services["infospace_id"]

    if asset.infospace_id != infospace_id:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ CSV row {asset.id} not accessible")],
            structured_content={"error": "not_accessible", "asset_id": asset.id},
        )

    existing_row_data = (asset.file_info or {}).get("original_row_data", {})
    merged = merged_csv_row(existing_row_data, updates, merge_strategy)
    column_headers = (asset.file_info or {}).get("column_headers", list(merged.keys()))

    # Apply changes in-place
    asset.title = csv_row_title(merged, asset.part_index or 0)
    asset.text_content = csv_row_text(merged, column_headers)
    file_info = dict(asset.file_info or {})
    file_info.update(csv_row_update_metadata(
        merged, column_headers, list(updates.keys()), merge_strategy,
    ))
    asset.file_info = file_info
    from datetime import datetime, timezone
    from app.models import ProcessingStatus
    asset.updated_at = datetime.now(timezone.utc)
    asset.processing_status = ProcessingStatus.READY
    session.add(asset)
    session.commit()
    session.refresh(asset)
    updated_asset = asset

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

    # Hard-destroy via the tree primitive (children, annotations, graph edges, chunks).
    from app.api.modules.content.tree import purge
    session = services["session"]
    infospace_id = services["infospace_id"]
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Asset {asset_id} not found or could not be deleted")],
            structured_content={"error": "asset not found or deletion failed"}
        )
    purge(session, {asset_id})
    session.commit()
    deleted = True

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
        from app.api.modules.sharing.services import ShareableService
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

    schemas = services["annotation_service"].list_schemas(services["infospace_id"])
    summary = format_schema_summary(schemas)
    if schemas:
        summary += "\n→ Before editing, fetch the full contract: analysis_hub(operation='schema.get', schema_id=<id>)"

    schema_data = []
    for schema in schemas:
        entry = _schema_to_structured(schema)
        entry["created_at"] = schema.created_at.isoformat() if schema.created_at else None
        schema_data.append(entry)

    return ToolResult(
        content=[TextContent(type="text", text=summary)],
        structured_content={
            "schemas": schema_data,
            "total": len(schemas),
        },
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
    
    from app.api.modules.foundation_service_providers import get_configured_foundation_provider
    sel = get_configured_foundation_provider(session, infospace_id, "embedding")
    if not sel or not sel.model_name:
        return ToolResult(
            content=[
                TextContent(
                    type="text",
                    text="❌ Semantic search not available: no embedding model selected.\n\n"
                         "To enable semantic search:\n"
                         "1. Configure an embedding model for this infospace (or in your user provider defaults)\n"
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
    
    from app.api.modules.embedding.similarity import search_by_text
    # BYOK from the MCP session's api_keys (stored user credentials resolved at session setup).
    # The provider that runs is determined by the infospace's embedding config. We pass
    # the first key as a best-effort fallback — the registry resolves the actual provider.
    runtime_keys = services.get("runtime_api_keys") or {}
    runtime_key = next(iter(runtime_keys.values()), None) if runtime_keys else None

    try:
        all_results = []
        query_results_map = {}

        for q in queries:
            results = await search_by_text(
                session, infospace_id, q,
                runtime_key=runtime_key,
                limit=limit,
                asset_kinds=kinds,
                date_from=date_from_dt,
                date_to=date_to_dt,
                bundle_id=bundle_id,
                parent_asset_id=parent_asset_id,
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
        access = _gate(services)
        
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
            "facets": asset.facets,
            "file_info": asset.file_info,
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
        access = _gate(services)
        
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




# ============================================================================
# CATEGORY: DOSSIER AGENT — formula authoring + observation snapshots
# ============================================================================
#
# The DossierAgent's specialised toolset (M7 of the intelligence-primitive
# plan). These tools let an LLM chat author Formulas, render panels, snapshot
# Observations, and write dossier notes — the full intelligence workflow.
#
# See docs/INTELLIGENCE.md § DossierAgent for the conceptual picture
# and docs/plans/intelligence-primitive/05_dossier_agent.md for the plan.
#
# Tag family: ["dossier", "formula"]. The chat backend filters MCP tools by
# tag when the request carries agent="dossier".


def _dashboard_dict(run: Any) -> dict:
    """Return the run's dashboard config as a dict.

    The canonical storage shape is ``views_config: List[Dict]`` with the
    dashboard at index 0 (the frontend ``saveDashboardToBackend`` always
    sends ``[dashboardConfig]``). Older code wrote a bare dict directly;
    we tolerate both. List shape → ``cfg[0]``; bare dict → ``cfg``.
    """
    cfg = getattr(run, "views_config", None)
    if isinstance(cfg, list):
        d = cfg[0] if (cfg and isinstance(cfg[0], dict)) else {}
    elif isinstance(cfg, dict):
        d = cfg
    else:
        d = {}
    # Guarantee the well-formed shape at the single read boundary, so the first
    # write (e.g. formula_create right after run.start) can't persist a blob with
    # no `panels` key — which makes the runner's dashboardConfig.panels undefined
    # and crashes addPanel/updatePanel on open.
    d.setdefault("panels", [])
    d.setdefault("formulas", [])
    return d


def _save_dashboard(run: Any, dashboard: dict) -> None:
    """Persist a dashboard dict back to ``run.views_config``.

    Always writes as a single-element list ``[dashboard]`` to match the
    column's declared ``List[Dict[str, Any]]`` type. Previously every
    ``run.views_config = dashboard`` site wrote a bare dict and corrupted
    the storage shape — frontend reads then mis-indexed and panels appeared
    to vanish on reload.
    """
    run.views_config = [dashboard]


@operation(path="visualize/formula/introspect", hidden=True, tags=["dossier", "formula", "introspection"],
           summary="Discover a run schema's paths, axes, entity vocabularies, and row-shapes.")
async def formula_introspect_schema(
    ctx: Context,
    run_id: Annotated[int, "Annotation run to introspect"],
) -> ToolResult:
    """Discover what's available for formula authoring on this run.

    Returns the row-shape roots (mails, events, regulatorische_handlungen,
    …) and field paths the LLM can bind as Formula dims/measures, plus
    sample annotation contents so the model sees concrete value shapes.

    Use this FIRST when a user asks a question — the answer depends on
    what the schema exposes.
    """
    from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
    from sqlmodel import select

    with get_services() as services:
        access = _gate(services)
        session = services["session"]

        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        # Collect schemas attached to this run — either via RunSchemaLink
        # (canonical) or via Annotation.schema_id (any schema that produced
        # annotations on this run). Union both for completeness.
        from app.api.modules.annotation.models import Annotation, RunSchemaLink
        link_ids = {
            link.schema_id for link in session.exec(
                select(RunSchemaLink).where(RunSchemaLink.run_id == run_id)
            ).all()
        }
        ann_ids = set(session.exec(
            select(Annotation.schema_id).where(Annotation.run_id == run_id).distinct()
        ).all())
        schema_ids = sorted(link_ids | ann_ids)
        schemas = []
        if schema_ids:
            schemas = session.exec(
                select(AnnotationSchema).where(AnnotationSchema.id.in_(schema_ids))
            ).all()

        out_schemas: list[dict] = []
        for s in schemas:
            surface = _walk_schema_surface(s.output_contract or {})

            # Sample annotations — pull up to 3 recent annotation contents for
            # this schema. The LLM uses these as concrete examples to ground
            # field-path bindings ("ah, predicate values look like this").
            sample_annotations: list[Any] = []
            try:
                sample_rows = session.exec(
                    select(Annotation)
                    .where(Annotation.run_id == run_id, Annotation.schema_id == s.id)
                    .order_by(Annotation.id.desc())
                    .limit(3)
                ).all()
                for ann in sample_rows:
                    sample_annotations.append(_truncate_sample(ann.value))
            except Exception as e:  # noqa: BLE001
                logger.warning(f"introspect: sample fetch failed for schema {s.id}: {e}")

            out_schemas.append({
                "schema_id": s.id,
                "name": s.name,
                "description": getattr(s, "description", None) or "",
                "row_shape_roots": surface["row_shape_roots"],
                "field_paths": surface["field_paths"],
                "simple_fields": surface["simple_fields"],
                "sample_annotations": sample_annotations,
            })

        dashboard = _dashboard_dict(run)
        formulas = dashboard.get("formulas") or []
        formula_names = [f.get("name") for f in formulas if isinstance(f, dict)]

        # Human-readable summary — first thing the model sees. Keep tight; the
        # structured_content carries the full surface.
        summary_lines = [f"📊 Run {run_id} ({run.name}) — {len(out_schemas)} schema(s)"]
        for s in out_schemas:
            summary_lines.append(f"\n## {s['name']} (schema_id={s['schema_id']})")
            if s["description"]:
                summary_lines.append(f"_{s['description']}_")
            if s["row_shape_roots"]:
                roots = ", ".join(r["path"] for r in s["row_shape_roots"])
                summary_lines.append(f"**row-shape roots:** {roots}")
            else:
                summary_lines.append("**row-shape roots:** (none — schema is document-shaped, not row-shaped)")
            summary_lines.append(f"**field paths:** {len(s['field_paths'])} total")
            # Surface the first 8 paths inline so the model has immediate signal
            # even if it doesn't dig into structured_content.
            for fp in s["field_paths"][:8]:
                bits = [f"`{fp['path']}` ({fp['type']})"]
                if fp.get("axis"):
                    bits.append(f"axis={fp['axis']}")
                if fp.get("enum_values"):
                    enum_preview = ", ".join(str(v) for v in fp["enum_values"][:5])
                    suffix = "…" if len(fp["enum_values"]) > 5 else ""
                    bits.append(f"enum=[{enum_preview}{suffix}]")
                summary_lines.append(f"  - " + " ".join(bits))
            if len(s["field_paths"]) > 8:
                summary_lines.append(f"  - … {len(s['field_paths']) - 8} more in structured_content")
            if s["sample_annotations"]:
                summary_lines.append(f"**sample annotations:** {len(s['sample_annotations'])} examples in structured_content")

        if formula_names:
            summary_lines.append(f"\nSaved formulas: {', '.join(formula_names)}")
        else:
            summary_lines.append("\nSaved formulas: (none — author one with formula_create)")

        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={
                "run_id": run_id,
                "run_name": run.name,
                "schemas": out_schemas,
                "saved_formulas": formula_names,
            },
        )


def _truncate_sample(value: Any, max_chars: int = 800) -> Any:
    """Truncate a sample annotation value for the LLM's introspection view.

    Long extraction payloads burn context budget without adding signal past
    the first few hundred characters. Stringify, slice, mark truncation.
    """
    import json as _json
    try:
        s = _json.dumps(value, ensure_ascii=False, default=str)
    except Exception:
        s = str(value)
    if len(s) > max_chars:
        return s[:max_chars] + "…[truncated]"
    # Return the parsed value if it fits, so structured tools can navigate it.
    return value if isinstance(value, (dict, list)) else s


@operation(path="visualize/formula/create", requires=(Capability.ORGANIZE,), hidden=True, tags=["dossier", "formula", "create"],
           summary="Author a new Formula (PanelProjection) on a run's dashboard.")
async def formula_create(
    ctx: Context,
    run_id: Annotated[int, "Annotation run that owns the dashboard"],
    name: Annotated[str, "Unique name for the formula in this dossier"],
    body: Annotated[Dict[str, Any], "Formula JSON — id/name/schema_id/filter/merge_maps/group/measures/derives/weight/snippet/output_keys/order_by"],
    description: Annotated[Optional[str], "Optional human-readable description"] = None,
) -> ToolResult:
    """Save a new Formula on the run's DashboardConfig.formulas[].

    The body is the six-verb shape (from·filter·group·measure·derive,
    plus optional weight/snippet/order_by). Errors return a clear message
    so the LLM can edit and retry.
    """
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.formula import Formula
    from pydantic import ValidationError as _ValidationError
    import uuid

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        # Stamp id/name/description from the tool args (body may omit them).
        fid = str(body.get("id") or str(uuid.uuid4())[:16])
        merged_body = {
            **body,
            "id": fid,
            "name": name,
            "description": description if description is not None else body.get("description"),
        }
        try:
            formula = Formula.model_validate(merged_body)
        except _ValidationError as e:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Invalid formula body:\n{e}")],
                structured_content={"error": "invalid_formula", "detail": str(e)},
            )

        dashboard = dict(_dashboard_dict(run))
        formulas = list(dashboard.get("formulas") or [])
        if any(f.get("name") == name for f in formulas if isinstance(f, dict)):
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Formula {name!r} already exists. Use formula_edit to modify.")],
                structured_content={"error": "duplicate_name"},
            )

        now = datetime.now(timezone.utc).isoformat()
        formula_entry = {
            **formula.model_dump(mode="json"),
            "created_at": now,
            "updated_at": now,
        }
        formulas.append(formula_entry)
        dashboard["formulas"] = formulas
        _save_dashboard(run, dashboard)
        session.add(run)
        session.commit()

        return ToolResult(
            content=[TextContent(type="text", text=f"✓ Formula {name!r} saved.")],
            structured_content={"formula": formula_entry},
        )


@operation(path="visualize/formula/edit", requires=(Capability.ORGANIZE,), hidden=True, tags=["dossier", "formula", "edit"],
           summary="Merge a partial PanelProjection onto an existing formula.")
async def formula_edit(
    ctx: Context,
    run_id: int,
    name: Annotated[str, "Name of the formula to modify"],
    patch: Annotated[Dict[str, Any], "Partial Formula — verbs to merge onto the existing body (group/measures/filter/derives/...)"],
) -> ToolResult:
    """Modify a saved Formula by name. The patch is merged onto the current
    body; pass only the verbs you want to change."""
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.formula import Formula
    from pydantic import ValidationError as _ValidationError

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = dict(_dashboard_dict(run))
        formulas = list(dashboard.get("formulas") or [])
        idx = next(
            (i for i, f in enumerate(formulas) if isinstance(f, dict) and f.get("name") == name),
            None,
        )
        if idx is None:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Formula {name!r} not found")],
                structured_content={"error": "formula_not_found"},
            )

        # Strip metadata fields from the existing entry before validating;
        # they'll be re-stamped on save.
        existing_meta = {
            "created_at": formulas[idx].get("created_at"),
            "updated_at": formulas[idx].get("updated_at"),
        }
        existing_body = {
            k: v for k, v in formulas[idx].items()
            if k not in {"created_at", "updated_at"}
        }
        merged = {**existing_body, **patch, "name": name}
        try:
            formula = Formula.model_validate(merged)
        except _ValidationError as e:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Patch produced invalid formula:\n{e}")],
                structured_content={"error": "invalid_formula", "detail": str(e)},
            )

        formulas[idx] = {
            **formula.model_dump(mode="json"),
            "created_at": existing_meta["created_at"],
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
        dashboard["formulas"] = formulas
        _save_dashboard(run, dashboard)
        session.add(run)
        session.commit()

        return ToolResult(
            content=[TextContent(type="text", text=f"✓ Formula {name!r} updated.")],
            structured_content={"formula": formulas[idx]},
        )


@operation(path="visualize/formula/preview", hidden=True, tags=["dossier", "formula", "preview"],
           summary="Run a formula and return a sample of output rows with provenance.")
async def formula_preview(
    ctx: Context,
    run_id: int,
    name: Annotated[str, "Saved formula name"],
    limit: Annotated[int, "Max rows to return"] = 20,
) -> ToolResult:
    """Run a saved Formula and return a sample of the output relation
    (rows + row count). Use this before snapshotting to verify the formula
    does what the user asked."""
    from app.api.modules.annotation.formulas import resolve_formula, attach_formula_lookup
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.query import AnnotationQuery

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = _dashboard_dict(run)
        try:
            formula = resolve_formula(name, dashboard)
        except ValueError:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Formula {name!r} not found")],
                structured_content={"error": "formula_not_found"},
            )

        aq = (
            AnnotationQuery(session, services["infospace_id"])
            .runs([run_id])
            .paginate(limit=max(1, min(int(limit), 5000)))
        )
        attach_formula_lookup(aq, dashboard)
        rel = aq.relation(formula)
        sample = [r.model_dump(mode="json") for r in rel.rows]

        # The model must SEE the sample rows to verify the formula does what the
        # user asked (this tool's whole purpose) — a row count alone is unverifiable.
        summary = _render_rows_for_model(
            sample,
            label=f"📐 Formula {name!r}",
            total=rel.total,
            has_more=rel.has_more,
        )
        if rel.measure_names:
            summary = f"Measures: {', '.join(rel.measure_names)}\n" + summary
        return ToolResult(
            content=[TextContent(type="text", text=summary)],
            structured_content={
                "formula_name": name,
                "total": rel.total,
                "evidence_mode": rel.evidence_mode,
                "measure_names": rel.measure_names,
                "has_more": rel.has_more,
                "sample": sample,
            },
        )


@operation(path="visualize/formula/list", hidden=True, tags=["dossier", "formula", "list"],
           summary="List saved formulas on a run's dashboard.")
async def formula_list(
    ctx: Context,
    run_id: int,
) -> ToolResult:
    """List all saved Formulas in this dossier with their key fields."""
    from app.api.modules.annotation.models import AnnotationRun

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = _dashboard_dict(run)
        formulas = dashboard.get("formulas") or []
        summary_lines = [f"📐 Saved formulas on run {run_id}:"]
        for f in formulas:
            if not isinstance(f, dict):
                continue
            dims = [d.get("name") for d in (f.get("group") or []) if isinstance(d, dict)]
            meas = [m.get("name") for m in (f.get("measures") or []) if isinstance(m, dict)]
            derives = [s.get("name") for s in (f.get("derives") or []) if isinstance(s, dict)]
            parts = [f"group=[{', '.join(dims)}]", f"measures=[{', '.join(meas)}]"]
            if derives:
                parts.append(f"derives=[{', '.join(derives)}]")
            summary_lines.append(f"  • {f.get('name')} — {' '.join(parts)}")
        if not formulas:
            summary_lines.append("  (none yet — formula_create to add one)")

        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={"formulas": formulas},
        )


@operation(path="visualize/panel/create", requires=(Capability.ORGANIZE,), hidden=True, tags=["dossier", "panel", "create"],
           summary="Drop a dashboard panel bound to a formula.")
async def panel_create(
    ctx: Context,
    run_id: int,
    formula_name: Annotated[str, "Saved formula to bind to the new panel"],
    panel_type: Annotated[str, "pie | chart | graph | table | map"] = "table",
    panel_name: Annotated[Optional[str], "Display name for the panel (defaults to formula name)"] = None,
    grid_position: Annotated[Optional[Dict[str, int]], "Optional {x, y, w, h}; auto-places if omitted"] = None,
) -> ToolResult:
    """Drop a panel onto the dashboard, bound to the named formula."""
    from app.api.modules.annotation.models import AnnotationRun
    import uuid

    if panel_type not in {"pie", "chart", "graph", "table", "map"}:
        return ToolResult(
            content=[TextContent(type="text", text=f"❌ Invalid panel_type {panel_type!r}")],
            structured_content={"error": "invalid_panel_type"},
        )

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = dict(_dashboard_dict(run))
        formulas = dashboard.get("formulas") or []
        formula_entry = next(
            (f for f in formulas if isinstance(f, dict) and f.get("name") == formula_name),
            None,
        )
        if not formula_entry:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Formula {formula_name!r} not found")],
                structured_content={"error": "formula_not_found"},
            )

        panels = list(dashboard.get("panels") or [])
        # Auto-place: next free row at the bottom of the grid.
        if grid_position is None:
            max_y = max((int(p.get("grid_position", {}).get("y", 0)) + int(p.get("grid_position", {}).get("h", 4)) for p in panels), default=0)
            grid_position = {"x": 0, "y": max_y, "w": 6, "h": 4}

        # Thin Panel — render binding only. Engine + filter live on the Formula.
        new_panel = {
            "id": str(uuid.uuid4())[:16],
            "type": panel_type,
            "name": panel_name or formula_name,
            "formula_id": formula_entry.get("id"),
            "grid_position": grid_position,
            "collapsed": False,
            "settings": {},
        }
        panels.append(new_panel)
        dashboard["panels"] = panels
        _save_dashboard(run, dashboard)
        session.add(run)
        session.commit()

        return ToolResult(
            content=[TextContent(type="text", text=f"✓ {panel_type} panel created for formula {formula_name!r} at ({grid_position['x']},{grid_position['y']})")],
            structured_content={"panel": new_panel},
        )


@operation(path="visualize/panel/layout", tags=["dossier", "panel", "layout"],
           summary="Inspect the run's dashboard layout.")
async def panel_layout(
    ctx: Context,
    run_id: int,
) -> ToolResult:
    """Return the current grid: panel ids, types, formula bindings, positions."""
    from app.api.modules.annotation.models import AnnotationRun

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = _dashboard_dict(run)
        panels = dashboard.get("panels") or []
        summary_lines = [f"🪟 Dashboard on run {run_id}: {len(panels)} panels"]
        for p in panels:
            if not isinstance(p, dict):
                continue
            pos = p.get("grid_position") or {}
            fid = p.get("formula_id") or p.get("observation_id") or "(unbound)"
            summary_lines.append(
                f"  • {p.get('type')} {p.get('name')!r} @ ({pos.get('x')},{pos.get('y')}) {pos.get('w')}x{pos.get('h')} formula={fid}"
            )

        return ToolResult(
            content=[TextContent(type="text", text="\n".join(summary_lines))],
            structured_content={"panels": panels},
        )


@operation(path="visualize/observation/snapshot", requires=(Capability.ORGANIZE,), hidden=True, tags=["dossier", "snapshot"],
           summary="Freeze a formula's current output as an immutable Observation.")
async def observation_snapshot(
    ctx: Context,
    run_id: int,
    formula_name: Annotated[str, "Saved formula to snapshot"],
    note: Annotated[Optional[str], "Optional journalist note attached to this snapshot"] = None,
) -> ToolResult:
    """Snapshot a formula's current output as an immutable Observation.

    The formula body is inlined; editing the formula afterwards does NOT
    mutate this Observation. Re-snapshot to capture new corpus state.
    """
    from app.api.modules.annotation.formulas import resolve_formula, attach_formula_lookup
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.annotation.query import AnnotationQuery
    from app.api.modules.annotation import snapshots as _snapshots

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = _dashboard_dict(run)
        try:
            formula = resolve_formula(formula_name, dashboard)
        except ValueError:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Formula {formula_name!r} not found")],
                structured_content={"error": "formula_not_found"},
            )

        aq = AnnotationQuery(session, services["infospace_id"]).runs([run_id])
        attach_formula_lookup(aq, dashboard)
        rel = aq.relation(formula)
        obs = _snapshots.snapshot_from_formula(
            run=run,
            formula_name=formula_name,
            relation=rel,
            note=note,
            schema_id=formula.schema_id,
        )
        _snapshots.append_observation(run, obs)
        session.add(run)
        session.commit()

        return ToolResult(
            content=[TextContent(type="text", text=f"📸 Snapshotted {formula_name!r} ({len(obs.output_blob)} rows) as obs {obs.id}")],
            structured_content={"observation": obs.model_dump(mode="json")},
        )


@operation(path="visualize/dossier/note", requires=(Capability.ORGANIZE,), tags=["dossier", "notes"],
           summary="Append cited markdown to the dossier note.")
async def dossier_note_append(
    ctx: Context,
    run_id: int,
    md: Annotated[str, "Markdown to append to the dossier notes. Supports @cite[obs_id, key:(...)] markers."],
) -> ToolResult:
    """Append to the dossier's notes_md.

    Notes are markdown; the agent should cite observations by their id
    using ``@cite[<obs_id>, key:(<tuple>)]`` so the frontend can rewind
    panels to the snapshot when the citation is clicked.
    """
    from app.api.modules.annotation.models import AnnotationRun

    with get_services() as services:
        access = _gate(services)
        session = services["session"]
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != services["infospace_id"]:
            return ToolResult(
                content=[TextContent(type="text", text=f"❌ Run {run_id} not found")],
                structured_content={"error": "run_not_found"},
            )

        dashboard = dict(_dashboard_dict(run))
        existing = dashboard.get("notes_md") or ""
        new_notes = existing.rstrip() + ("\n\n" if existing else "") + md.strip() + "\n"
        dashboard["notes_md"] = new_notes
        _save_dashboard(run, dashboard)
        session.add(run)
        session.commit()

        return ToolResult(
            content=[TextContent(type="text", text=f"✓ Appended {len(md)} chars to dossier notes")],
            structured_content={"notes_md": new_notes},
        )


@operation(path="ingest/sources", requires=(Capability.INGEST,), posture="confirm",
           tags=["sources", "ingestion", "monitoring"],
           summary="Set up and manage recurring sources (RSS, web search, …) that fill a bundle on a schedule — the basis of live monitoring.")
async def sources_hub(
    ctx: Context,
    operation: Annotated[str, "create | activate | pause | list"] = "list",
    kind: Annotated[Optional[str], "create (single): source kind — rss, web_search, web, crawl"] = None,
    name: Annotated[Optional[str], "create (single): a friendly name"] = None,
    details: Annotated[Optional[Dict[str, Any]], "create (single): the source read-config verbatim, e.g. {'feed_url': '...'} for rss or {'query': '...'} for web_search"] = None,
    poll_interval_seconds: Annotated[int, "create: seconds between polls (default 3600 = hourly)"] = 3600,
    output_bundle_id: Annotated[Optional[int], "create: the bundle this source fills"] = None,
    sources: Annotated[Optional[List[Dict[str, Any]]], "create (batch): a list of {kind, name, details, poll_interval_seconds?, output_bundle_id?} — proposes them all at once as one checklist the user confirms together. Prefer this over N separate calls when setting up multiple sources."] = None,
    source_id: Annotated[Optional[int], "activate/pause: the source id"] = None,
) -> ToolResult:
    """Recurring sources. HQ polls active sources on their schedule and ingests
    new items into their output bundle — no further conversation needed. Pair a
    source with a live run (analysis_hub run.start, live=true, source_bundle_id)
    to auto-annotate arrivals: that is a complete monitoring operation."""
    from app.api.modules.content.services.source_service import (
        activate_stream, pause_stream,
    )
    from app.api.modules.content.sources import registered_source_kinds
    from app.models import Source
    from sqlmodel import select as _select

    with get_services() as services:
        _gate(services)  # requires INGEST (declared on @operation)
        session = services["session"]
        iid = services["infospace_id"]
        uid = services["user_id"]

        if operation == "create":
            # One source (kind/name/details) or many (sources=[{...}]) — both stage a
            # single `stage_sources` directive carrying a list, so N sources confirm
            # together as one inline checklist under one return token.
            specs = list(sources) if sources else (
                [{"kind": kind, "name": name, "details": details,
                  "poll_interval_seconds": poll_interval_seconds,
                  "output_bundle_id": output_bundle_id}]
                if (kind and name) else []
            )
            if not specs:
                return ToolResult(content=[TextContent(type="text", text="❌ create needs a source (kind + name) or a `sources` list")],
                                  structured_content={"error": "missing_params"})
            registered = registered_source_kinds()
            inits = []
            for spec in specs:
                k, n = spec.get("kind"), spec.get("name")
                if not k or not n:
                    return ToolResult(content=[TextContent(type="text", text="❌ each source needs kind + name")],
                                      structured_content={"error": "missing_params"})
                if k not in registered:
                    return ToolResult(
                        content=[TextContent(type="text", text=f"❌ Unknown source kind '{k}'. Registered: {sorted(registered)}")],
                        structured_content={"error": "invalid_kind", "registered": sorted(registered)})
                inits.append({
                    "kind": k, "name": n, "config": spec.get("details") or {},
                    "streamEnabled": True,
                    "pollInterval": spec.get("poll_interval_seconds", poll_interval_seconds),
                    "bundleId": spec.get("output_bundle_id", output_bundle_id),
                    "lockKind": True,
                })
            # Stage-then-confirm (posture=confirm): render the confirmation *inline in
            # the chat* (command=stage_sources, not open_form → no dock). The user
            # commits it right in the conversation, and a <form_result> resumes us.
            import uuid as _uuid
            token = f"src-{_uuid.uuid4().hex[:12]}"
            count = len(inits)
            label = (f"{count} recurring sources" if count > 1
                     else f"a recurring {inits[0]['kind']} source '{inits[0]['name']}'")
            return ToolResult(
                content=[TextContent(type="text", text=f"⏸ Prepared {label} — confirm below and I'll continue.")],
                structured_content={
                    "staged": True, "count": count,
                    "ui_directive": {
                        "command": "stage_sources",
                        "payload": {"sources": inits},
                        "await_return": True, "return_token": token,
                    },
                },
            )

        if operation in ("activate", "pause"):
            if not source_id:
                return ToolResult(content=[TextContent(type="text", text=f"❌ {operation} needs source_id")],
                                  structured_content={"error": "missing_source_id"})
            try:
                (activate_stream if operation == "activate" else pause_stream)(session, source_id, uid)
            except Exception as e:
                return ToolResult(content=[TextContent(type="text", text=f"❌ {e}")],
                                  structured_content={"error": f"{operation}_failed", "detail": str(e)})
            verb = "activated ▶" if operation == "activate" else "paused ⏸"
            return ToolResult(content=[TextContent(type="text", text=f"Source #{source_id} {verb}")],
                              structured_content={"source_id": source_id, "is_active": operation == "activate"})

        sources = session.exec(_select(Source).where(Source.infospace_id == iid)).all()
        rows = [{"id": s.id, "name": s.name, "kind": s.kind, "is_active": s.is_active,
                 "poll_interval_seconds": s.poll_interval_seconds, "output_bundle_id": s.output_bundle_id}
                for s in sources]
        lines = [f"- #{r['id']} {r['name']} ({r['kind']}) {'▶ active' if r['is_active'] else '⏸ paused'} · every {r['poll_interval_seconds']}s → bundle {r['output_bundle_id']}"
                 for r in rows]
        return ToolResult(content=[TextContent(type="text", text="Recurring sources:\n" + ("\n".join(lines) or "(none yet)"))],
                          structured_content={"sources": rows})
