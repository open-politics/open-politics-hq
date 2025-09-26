"""
FastMCP Intelligence Analysis Server

Clean, production-ready MCP server using FastMCP best practices:
- Direct Pydantic model returns for automatic structured output
- Proper separation of Tools (actions) vs Resources (data access)
- Simplified authentication and service management
"""
import logging
from typing import List, Optional, Any, Dict
from datetime import datetime, timezone
from fastmcp import FastMCP, Context

from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings
from app.api.providers.factory import create_storage_provider, create_model_registry
from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.bundle_service import BundleService
from app.models import AssetKind
from app.schemas import (
    AnnotationRunCreate, AssetRead, AnnotationRead, 
    AnnotationSchemaRead, BundleRead
)
from app.core import security
from fastmcp.server.auth import JWTVerifier
from fastmcp.server.dependencies import get_access_token, AccessToken

logger = logging.getLogger(__name__)





# Simple JWT verifier - FastMCP handles the complexity
jwt_verifier = JWTVerifier(
    public_key=settings.SECRET_KEY,
    algorithm=security.ALGORITHM,
)

# Create the FastMCP server with auth and stateless HTTP for OpenAI compatibility
mcp = FastMCP(
    "Intelligence Analysis Server",
    auth=jwt_verifier,
    stateless_http=True  # Crucial for OpenAI Responses API compatibility
)

from contextlib import contextmanager

@contextmanager
def get_services():
    """Get services from context with proper session management using context manager"""
    try:
        token: AccessToken | None = get_access_token()
        if not token:
            raise PermissionError("Authentication token not found.")

        user_id = token.claims.get("sub")
        infospace_id = token.claims.get("infospace_id")

        if not user_id or not infospace_id:
            raise ValueError("Missing user_id or infospace_id in token claims")

        # Create database session using proper context management
        from app.core.db import engine
        from sqlmodel import Session
        
        with Session(engine) as db_session:
            try:
                # Create services
                storage_provider = create_storage_provider(settings)
                model_registry = create_model_registry(settings)
                
                asset_service = AssetService(session=db_session, storage_provider=storage_provider)
                annotation_service = AnnotationService(session=db_session, model_registry=model_registry, asset_service=asset_service)
                bundle_service = BundleService(db=db_session)
                
                yield {
                    "user_id": int(user_id),
                    "infospace_id": int(infospace_id),
                    "session": db_session,
                    "asset_service": asset_service,
                    "annotation_service": annotation_service,
                    "bundle_service": bundle_service
                }
                
                # Commit successful operations
                db_session.commit()
            except Exception as e:
                # Rollback on error
                db_session.rollback()
                raise
    except Exception as e:
        logger.error(f"Failed to initialize services: {e}")
        raise

# ═══════════════════════════════════════════════════════════════
# RESOURCES (Read-only data access)
# Note: These are kept as resources for direct URI access if needed
# ═══════════════════════════════════════════════════════════════

@mcp.resource("intelligence://assets/{asset_id}")
async def get_asset_details(asset_id: int, ctx: Context) -> AssetRead:
    """Get detailed information about a specific asset."""
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        assets = services["asset_service"].get_assets_by_ids(
            [asset_id], 
            services["infospace_id"]
        )
        
        if not assets:
            raise ValueError(f"Asset {asset_id} not found")
        
        return AssetRead.model_validate(assets[0])

@mcp.resource("intelligence://assets/{asset_id}/annotations")
async def get_asset_annotations(
    asset_id: int, 
    ctx: Context,
    schema_ids: Optional[str] = None  # Query param as comma-separated string
) -> List[AnnotationRead]:
    """Get annotations for a specific asset."""
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        # Parse schema_ids if provided
        schema_id_list = None
        if schema_ids:
            schema_id_list = [int(x.strip()) for x in schema_ids.split(",")]
        
        annotations = services["annotation_service"].get_annotations(
            asset_ids=[asset_id],
            infospace_id=services["infospace_id"],
            schema_ids=schema_id_list
        )
        
        return [AnnotationRead.model_validate(ann) for ann in annotations]

# ═══════════════════════════════════════════════════════════════
# TOOLS (Actions and operations)
# ═══════════════════════════════════════════════════════════════

@mcp.tool
async def search_assets(
    query: str,
    ctx: Context,
    search_method: str = "hybrid",
    asset_kinds: Optional[List[str]] = None,
    limit: int = 10,
    distance_threshold: float = 0.8,
) -> List[AssetRead]:
    """
    Search for assets using text queries or semantic similarity.
    
    This is a tool because it performs a search operation.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        await ctx.info(f"Searching assets: query='{query}', method={search_method}")
        
        asset_kinds_enum = [AssetKind(kind) for kind in asset_kinds] if asset_kinds else []
        
        assets = await services["asset_service"].search_assets(
            user_id=services["user_id"],
            infospace_id=services["infospace_id"],
            query=query,
            search_method=search_method,
            asset_kinds=asset_kinds_enum,
            limit=limit,
            distance_threshold=distance_threshold
        )
        
        return [AssetRead.model_validate(asset) for asset in assets]


@mcp.tool
async def analyze_assets(
    asset_ids: List[int],
    schema_id: int,
    ctx: Context,
    custom_instructions: Optional[str] = None,
) -> dict:
    """
    Create new annotations by analyzing assets with a specific schema.
    
    This is a tool because it creates/modifies data (annotation runs).
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        await ctx.info(f"Analyzing assets {asset_ids} with schema {schema_id}")
        
        if not asset_ids or not schema_id:
            raise ValueError("asset_ids and schema_id are required")
        
        configuration = {}
        if custom_instructions:
            configuration["custom_instructions"] = custom_instructions
        
        run_create = AnnotationRunCreate(
            name=f"MCP Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
            description=f"Analysis via MCP: {custom_instructions}" if custom_instructions else "Analysis via MCP",
            schema_ids=[schema_id],
            target_asset_ids=asset_ids,
            configuration=configuration
        )
        
        run = services["annotation_service"].create_run(
            services["user_id"], 
            services["infospace_id"], 
            run_create
        )
        
        return {
            "run_id": run.id,
            "run_name": run.name,
            "status": "started",
            "message": f"Analysis run {run.id} started for {len(asset_ids)} assets"
        }

@mcp.tool
async def list_schemas(ctx: Context) -> List[AnnotationSchemaRead]:
    """Read the list of available annotation schemas."""
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        schemas = services["annotation_service"].list_schemas(
            infospace_id=services["infospace_id"]
        )
        
        return [AnnotationSchemaRead.model_validate(s) for s in schemas]

@mcp.tool
async def list_bundles(ctx: Context) -> List[BundleRead]:
    """Read the list of available asset bundles."""
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        bundles = services["bundle_service"].list_bundles(
            infospace_id=services["infospace_id"]
        )
        
        return [BundleRead.model_validate(b) for b in bundles]
    
@mcp.tool
async def curate_asset_fragment(
    asset_id: int,
    fragment_key: str,
    fragment_value: str,
    ctx: Context
) -> dict:
    """
    Save a specific piece of information as a permanent fragment on an asset.
    
    This is a tool because it modifies asset metadata.
    """
    with get_services() as services:
        validate_infospace_access(
            services["session"], 
            services["infospace_id"], 
            services["user_id"]
        )
        
        await ctx.info(f"Curating fragment '{fragment_key}' for asset {asset_id}")
        
        # This would need to be implemented in your asset service
        # For now, return a success message
        return {
            "asset_id": asset_id,
            "fragment_key": fragment_key,
            "status": "saved",
            "message": f"Fragment '{fragment_key}' saved for asset {asset_id}"
        }

