"""
Intelligence Analysis Conversation Service
"""
import logging
import json
from typing import List, Optional, Dict, Any, AsyncIterator, Union, Callable, Awaitable
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select, and_, or_
import asyncio
from jose import jwt

from app.api.providers.model_registry import ModelRegistryService
from app.api.providers.search_registry import SearchProviderRegistryService
from app.api.providers.base import GenerationResponse
from app.api.services.service_utils import validate_infospace_access
from app.models import Asset, User, Infospace, Bundle, AnnotationSchema, Annotation
from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.schemas import AnnotationRunCreate
from app.api.mcp.client import IntelligenceMCPClient, get_mcp_client
from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)

def create_mcp_context_token(user_id: int, infospace_id: int) -> str:
    """Creates a short-lived JWT to securely pass context to the MCP server."""
    expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode = {
        "exp": expire,
        "sub": str(user_id),
        "infospace_id": infospace_id
    }
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=security.ALGORITHM)
    return encoded_jwt

class IntelligenceConversationService:
    """
    Service for intelligence analysis conversations with tool orchestration.
    
    This service enables AI models to:
    - Search and discover assets using tools
    - Analyze documents with annotation schemas
    - Aggregate findings across multiple sources
    - Present intelligence insights through conversation
    
    The chat becomes an intelligence analysis interface where models can
    interact with your data through tool calls, not just chat about pre-selected documents.
    """
    
    def __init__(self, session: Session, model_registry: ModelRegistryService, 
                 asset_service: AssetService, annotation_service: AnnotationService,
                 content_ingestion_service: ContentIngestionService):
        self.session = session
        self.model_registry = model_registry
        self.asset_service = asset_service
        self.annotation_service = annotation_service
        self.content_ingestion_service = content_ingestion_service
        self.search_registry = SearchProviderRegistryService()
        logger.info("IntelligenceConversationService initialized")
    
    async def get_universal_tools(self, user_id: int, infospace_id: int, api_keys: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """
        Get universal intelligence analysis capabilities (tools + resources).
        
        FastMCP automatically generates schemas from function signatures.
        This combines both tools (actions) and resources (data access) for the AI.
        """
        try:
            async with get_mcp_client(
                session=self.session,
                asset_service=self.asset_service,
                annotation_service=self.annotation_service,
                content_ingestion_service=self.content_ingestion_service,
                user_id=user_id,
                infospace_id=infospace_id,
                api_keys=api_keys  # Pass API keys to MCP client
            ) as mcp_client:
                # Get tools from MCP server
                # Note: search_and_ingest tool already provides Tavily integration
                # via the internal search provider system
                tools = await mcp_client.get_available_tools()
                
                logger.info(f"Retrieved {len(tools)} tools from MCP server")
                return tools
                
        except Exception as e:
            logger.error(f"Failed to get universal tools: {e}")
            return []

    async def get_infospace_tool_context(self, infospace_id: int, user_id: int) -> Dict[str, Any]:
        """
        Get infospace-specific context for tools (what's actually available).
        
        This provides real data to help AI models make better tool usage decisions.
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Get infospace details
        infospace = self.session.get(Infospace, infospace_id)
        
        # Get available asset kinds
        available_asset_kinds = self.session.exec(
            select(Asset.kind).where(Asset.infospace_id == infospace_id).distinct()
        ).all()
        
        # Get available schemas
        schemas = self.session.exec(
            select(AnnotationSchema)
            .where(AnnotationSchema.infospace_id == infospace_id)
            .where(AnnotationSchema.is_active == True)
        ).all()
        
        # Get available bundles
        bundles = self.session.exec(
            select(Bundle).where(Bundle.infospace_id == infospace_id)
        ).all()
        
        # Get asset statistics
        from sqlmodel import func
        total_assets = self.session.exec(
            select(func.count(Asset.id)).where(Asset.infospace_id == infospace_id)
        ).one()
        
        total_annotations = self.session.exec(
            select(func.count(Annotation.id)).where(Annotation.infospace_id == infospace_id)
        ).one()
        
        return {
            "infospace": {
                "id": infospace_id,
                "name": infospace.name,
                "description": infospace.description
            },
            "available_asset_kinds": [kind.value for kind in available_asset_kinds],
            "available_schemas": [
                {
                    "id": schema.id,
                    "name": schema.name,
                    "description": schema.description,
                    "version": schema.version
                }
                for schema in schemas
            ],
            "available_bundles": [
                {
                    "id": bundle.id,
                    "name": bundle.name,
                    "description": bundle.description,
                    "asset_count": bundle.asset_count
                }
                for bundle in bundles
            ],
            "statistics": {
                "total_assets": total_assets,
                "total_annotations": total_annotations,
                "schema_count": len(schemas),
                "bundle_count": len(bundles)
            }
        }

    async def intelligence_chat(self,
                               messages: List[Dict[str, str]],
                               model_name: str,
                               user_id: int,
                               infospace_id: int,
                               stream: bool = False,
                               thinking_enabled: bool = False,
                               api_keys: Optional[Dict[str, str]] = None,
                               **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Intelligence analysis chat with full tool orchestration.
        
        The model can search, analyze, and interact with intelligence data through tool calls.
        
        Args:
            messages: Conversation messages
            model_name: Name of the model to use
            user_id: ID of the user
            infospace_id: ID of the infospace for intelligence context
            stream: Whether to stream the response
            **kwargs: Additional model parameters
        
        Returns:
            GenerationResponse or async iterator for streaming
        """
        # Validate access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Create a secure context token for this conversation with API keys encoded
        from app.api.mcp.client import create_mcp_context_token_with_api_keys
        context_token = create_mcp_context_token_with_api_keys(user_id, infospace_id, api_keys or {})
        
        # Check if the model exists and get its capabilities
        model_info = await self.model_registry.get_model_info(model_name)
        if not model_info:
            await self.model_registry.discover_all_models()
            model_info = await self.model_registry.get_model_info(model_name)
        if not model_info:
            raise ValueError(f"Model '{model_name}' not found. Please check available models at /api/v1/chat/models")

        # Use model-reported capability; do not assume tools
        supports_tools = bool(getattr(model_info, "supports_tools", False))
        
        # Only provide tools when supported
        tools = await self.get_universal_tools(user_id, infospace_id, api_keys) if supports_tools else None
        
        # Add system context about the infospace
        infospace = self.session.get(Infospace, infospace_id)
        system_context = self._build_infospace_context(infospace)
        
        # No additional notes; we assume tool support
        
        # Prepare messages with context
        context_messages = [{"role": "system", "content": system_context}] + messages
        
        logger.info(f"Intelligence chat: user={user_id}, infospace={infospace_id}, model={model_name}, tools={len(tools) if tools else 0}, supports_tools={supports_tools}")
        
        try:
            # The entire generation process, including tool loops, is now delegated to the provider
            return await self.model_registry.generate(
                messages=context_messages,
                model_name=model_name,
                tools=tools,
                stream=stream,
                thinking_enabled=thinking_enabled,
                # Pass runtime API keys from frontend
                runtime_api_keys=api_keys,
                # Pass the context token to the provider for auth header
                mcp_headers={"Authorization": f"Bearer {context_token}"},
                # Pass the tool executor to the provider for non-MCP tools (includes api_keys)
                tool_executor=lambda name, args: self.execute_tool_call(name, args, user_id, infospace_id, api_keys),
                **kwargs
            )

        except Exception as e:
            error_str = str(e)
            
            # If the error is about tool support, retry without tools
            if "does not support tools" in error_str and tools is not None:
                logger.warning(f"Model {model_name} rejected tools, retrying without tools")
                
                # Update system context to reflect no tool support
                fallback_context = system_context + "\n\nNote: This model doesn't support tool calls, so I can only provide conversational responses based on your questions."
                fallback_messages = [{"role": "system", "content": fallback_context}] + messages
                
                try:
                    return await self.model_registry.generate(
                        messages=fallback_messages,
                        model_name=model_name,
                        tools=None,  # No tools
                        stream=stream,
                        runtime_api_keys=api_keys,
                        mcp_headers={"Authorization": f"Bearer {context_token}"},
                        **kwargs
                    )
                except Exception as fallback_e:
                    logger.error(f"Intelligence chat failed even without tools: {fallback_e}")
                    raise RuntimeError(f"Intelligence conversation failed: {str(fallback_e)}")
            
            # If the error is about unsupported parameters, retry with minimal config
            if ("temperature" in error_str and "does not support" in error_str) or "unsupported_value" in error_str:
                logger.warning(f"Model {model_name} rejected parameters, retrying with minimal config")
                
                # Remove problematic parameters and retry
                clean_kwargs = {k: v for k, v in kwargs.items() if k not in ['temperature', 'top_p', 'max_tokens']}
                
                try:
                    return await self.model_registry.generate(
                        messages=context_messages,
                        model_name=model_name,
                        tools=tools,
                        stream=stream,
                        runtime_api_keys=api_keys,
                        mcp_headers={"Authorization": f"Bearer {context_token}"},
                        **clean_kwargs
                    )
                except Exception as clean_e:
                    logger.error(f"Intelligence chat failed even with clean parameters: {clean_e}")
                    raise RuntimeError(f"Intelligence conversation failed: {str(clean_e)}")
            
            logger.error(f"Intelligence chat failed: {e}")
            raise RuntimeError(f"Intelligence conversation failed: {str(e)}")
    
    async def execute_tool_call(self,
                               tool_name: str,
                               arguments: Dict[str, Any],
                               user_id: int,
                               infospace_id: int,
                               api_keys: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Execute a tool call or resource read made by the AI model using MCP.
        
        Handles both:
        - MCP tools (actions like search_assets, analyze_assets)  
        - MCP resources (data access like list_bundles, get_asset_details)
        
        Args:
            tool_name: Name of the tool/resource to execute
            arguments: Arguments for the tool call
            user_id: ID of the user
            infospace_id: ID of the infospace
            api_keys: Optional runtime API keys for cloud providers
            
        Returns:
            Tool execution result
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        logger.info(f"Executing MCP capability: {tool_name} with args: {arguments}")
        
        try:
            async with get_mcp_client(
                session=self.session,
                asset_service=self.asset_service,
                annotation_service=self.annotation_service,
                content_ingestion_service=self.content_ingestion_service,
                user_id=user_id,
                infospace_id=infospace_id,
                api_keys=api_keys  # Pass API keys to MCP client
            ) as mcp_client:
                # We no longer need to distinguish between tool execution and resource reading,
                # as all capabilities are now exposed as tools.
                result = await mcp_client.execute_tool(tool_name, arguments)
                if isinstance(result, dict) and result.get("error"):
                    logger.error(f"MCP tool execution failed for '{tool_name}': {result['error']}")
                else:
                    logger.info(f"MCP tool execution successful for: {tool_name}")
                return result
                
        except Exception as e:
            logger.error(f"MCP capability execution failed: {tool_name} - {e}", exc_info=True)
            return {"error": f"Capability execution failed: {str(e)}"}
    
    # ─────────────── LEGACY TOOL EXECUTION METHODS (DEPRECATED - USE MCP) ─────────────── #
    # These methods are kept for backward compatibility but should not be used directly.
    # All tool execution now goes through the MCP client and server.
    
    async def _tool_search_assets(self, arguments: Dict[str, Any], infospace_id: int) -> Dict[str, Any]:
        """Execute unified search_assets tool call with multiple search methods.
        Always returns a dict including an "assets" array of serialized assets.
        """
        query = arguments.get("query", "")
        search_method = arguments.get("search_method", "hybrid")
        asset_kinds = arguments.get("asset_kinds", [])
        limit = arguments.get("limit", 10)
        distance_threshold = arguments.get("distance_threshold", 0.8)

        logger.info(f"Asset search: query='{query}', method={search_method}, limit={limit}")

        options = {"asset_kinds": asset_kinds, "distance_threshold": distance_threshold}

        def _serialize_asset(a: Asset) -> Dict[str, Any]:
            try:
                return {
                    "id": a.id,
                    "title": a.title,
                    "kind": a.kind.value if getattr(a, "kind", None) else None,
                    "text_content": getattr(a, "text_content", None),
                    "source_metadata": getattr(a, "source_metadata", None),
                    "created_at": a.created_at.isoformat() if getattr(a, "created_at", None) else None,
                    "event_timestamp": a.event_timestamp.isoformat() if getattr(a, "event_timestamp", None) else None,
                }
            except Exception:
                return {"id": getattr(a, "id", None), "title": getattr(a, "title", None)}

        if search_method == "text":
            assets = await self.content_ingestion_service._search_assets_text(query, infospace_id, limit, options)
            return {"assets": [_serialize_asset(a) for a in assets], "total_found": len(assets), "search_method": "text"}

        elif search_method == "semantic":
            assets = await self.content_ingestion_service._search_assets_semantic(query, infospace_id, limit, options)
            return {"assets": [_serialize_asset(a) for a in assets], "total_found": len(assets), "search_method": "semantic"}

        elif search_method == "hybrid":
            text_task = self.content_ingestion_service._search_assets_text(query, infospace_id, max(1, limit // 2), options)
            sem_task = self.content_ingestion_service._search_assets_semantic(query, infospace_id, max(1, limit // 2), options)
            text_list, sem_list = await asyncio.gather(text_task, sem_task)

            merged: Dict[int, Dict[str, Any]] = {}
            for a in text_list:
                sa = _serialize_asset(a)
                sa["search_method"] = "text"
                if sa.get("id") is not None:
                    merged[sa["id"]] = sa
            for a in sem_list:
                sa = _serialize_asset(a)
                _id = sa.get("id")
                if _id in merged:
                    merged[_id]["search_method"] = "hybrid"
                else:
                    sa["search_method"] = "semantic"
                    if _id is not None:
                        merged[_id] = sa

            def sort_key(x: Dict[str, Any]):
                return (x.get("search_method") == "hybrid", x.get("created_at") or "")
            sorted_assets = sorted(merged.values(), key=sort_key, reverse=True)

            return {
                "assets": sorted_assets[:limit],
                "total_found": len(sorted_assets),
                "search_method": "hybrid",
                "text_results": len(text_list),
                "semantic_results": len(sem_list),
            }

        else:
            raise ValueError(f"Unknown search method: {search_method}")
    
    async def _tool_get_asset_details(self, arguments: Dict[str, Any], infospace_id: int) -> Dict[str, Any]:
        """Execute get_asset_details tool call"""
        asset_ids = arguments.get("asset_ids", [])
        
        assets = self.session.exec(
            select(Asset)
            .where(Asset.id.in_(asset_ids))
            .where(Asset.infospace_id == infospace_id)
        ).all()
        
        return {
            "assets": [
                {
                    "id": asset.id,
                    "title": asset.title,
                    "kind": asset.kind.value,
                    "text_content": asset.text_content,
                    "source_metadata": asset.source_metadata,
                    "created_at": asset.created_at.isoformat(),
                    "event_timestamp": asset.event_timestamp.isoformat() if asset.event_timestamp else None
                }
                for asset in assets
            ]
        }
    
    async def _tool_get_annotations(self, arguments: Dict[str, Any], infospace_id: int) -> Dict[str, Any]:
        """Execute get_annotations tool call"""
        asset_ids = arguments.get("asset_ids", [])
        schema_ids = arguments.get("schema_ids", [])
        
        query_conditions = [
            Annotation.infospace_id == infospace_id,
            Annotation.asset_id.in_(asset_ids)
        ]
        
        if schema_ids:
            query_conditions.append(Annotation.schema_id.in_(schema_ids))
        
        annotations = self.session.exec(
            select(Annotation)
            .where(and_(*query_conditions))
        ).all()
        
        return {
            "annotations": [
                {
                    "id": annotation.id,
                    "asset_id": annotation.asset_id,
                    "schema_id": annotation.schema_id,
                    "value": annotation.value,
                    "status": annotation.status.value,
                    "timestamp": annotation.timestamp.isoformat()
                }
                for annotation in annotations
            ],
            "total_found": len(annotations)
        }
    
    async def _tool_analyze_assets(self, arguments: Dict[str, Any], user_id: int, infospace_id: int) -> Dict[str, Any]:
        """Execute analyze_assets tool call - create new annotation run"""
        asset_ids = arguments.get("asset_ids", [])
        schema_id = arguments.get("schema_id")
        custom_instructions = arguments.get("custom_instructions")
        previous_run_id = arguments.get("previous_run_id")
        
        if not asset_ids or not schema_id:
            return {"error": "asset_ids and schema_id are required"}
        
        configuration = {}
        if custom_instructions:
            configuration["custom_instructions"] = custom_instructions
        if previous_run_id:
            configuration["previous_run_id"] = previous_run_id

        # Create annotation run
        run_create = AnnotationRunCreate(
            name=f"AI Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
            description=f"Analysis requested through chat interface: {custom_instructions}" if custom_instructions else "Analysis requested through chat interface",
            schema_ids=[schema_id],
            target_asset_ids=asset_ids,
            configuration=configuration
        )
        
        try:
            run = self.annotation_service.create_run(user_id, infospace_id, run_create)
            return {
                "run_id": run.id,
                "run_name": run.name,
                "status": "started",
                "message": f"Analysis run {run.id} started for {len(asset_ids)} assets"
            }
        except Exception as e:
            return {"error": f"Failed to create analysis run: {str(e)}"}
    
    async def _tool_list_schemas(self, infospace_id: int) -> Dict[str, Any]:
        """Execute list_schemas tool call"""
        schemas = self.session.exec(
            select(AnnotationSchema)
            .where(AnnotationSchema.infospace_id == infospace_id)
            .where(AnnotationSchema.is_active == True)
        ).all()
        
        return {
            "schemas": [
                {
                    "id": schema.id,
                    "name": schema.name,
                    "description": schema.description,
                    "version": schema.version
                }
                for schema in schemas
            ]
        }
    
    async def _tool_list_bundles(self, infospace_id: int) -> Dict[str, Any]:
        """Execute list_bundles tool call"""
        bundles = self.session.exec(
            select(Bundle)
            .where(Bundle.infospace_id == infospace_id)
        ).all()
        
        return {
            "bundles": [
                {
                    "id": bundle.id,
                    "name": bundle.name,
                    "description": bundle.description,
                    "asset_count": bundle.asset_count,
                    "created_at": bundle.created_at.isoformat()
                }
                for bundle in bundles
            ]
        }
    
    async def _tool_create_report(self, arguments: Dict[str, Any], user_id: int, infospace_id: int) -> Dict[str, Any]:
        """Execute create_report tool call - create a new report asset"""
        title = arguments.get("title")
        content = arguments.get("content")
        source_asset_ids = arguments.get("source_asset_ids", [])
        source_bundle_ids = arguments.get("source_bundle_ids", [])
        source_run_ids = arguments.get("source_run_ids", [])

        if not title or not content:
            return {"error": "Title and content are required for a report"}
        
        try:
            # Create the report asset
            report_asset = self.content_ingestion_service.create_report(
                user_id,
                infospace_id,
                title,
                content,
                source_asset_ids=source_asset_ids,
                source_bundle_ids=source_bundle_ids,
                source_run_ids=source_run_ids
            )

            return {
                "report_id": report_asset.id,
                "report_name": report_asset.title,
                "status": "created",
                "message": f"Report {report_asset.id} created successfully"
            }
        except Exception as e:
            logger.error(f"Failed to create report: {e}")
            return {"error": f"Failed to create report: {str(e)}"}
    
    async def _tool_curate_asset_fragment(self, arguments: Dict[str, Any], user_id: int, infospace_id: int) -> Dict[str, Any]:
        """Execute curate_asset_fragment tool call - save a specific piece of information as a permanent, curated fragment on an asset's metadata."""
        asset_id = arguments.get("asset_id")
        fragment_key = arguments.get("fragment_key")
        fragment_value = arguments.get("fragment_value")

        if not asset_id or not fragment_key or not fragment_value:
            return {"error": "asset_id, fragment_key, and fragment_value are required"}
        
        try:
            annotation = self.annotation_service.curate_fragment(
                user_id=user_id,
                infospace_id=infospace_id,
                asset_id=asset_id,
                field_name=fragment_key,
                value=fragment_value
            )

            return {
                "asset_id": asset_id,
                "fragment_key": fragment_key,
                "fragment_value": fragment_value,
                "status": "curated",
                "message": f"Fragment '{fragment_key}' curated on asset {asset_id} with audit trail in run {annotation.run_id}"
            }
        except Exception as e:
            logger.error(f"Failed to curate asset fragment: {e}")
            return {"error": f"Failed to curate asset fragment: {str(e)}"}
    
    def _build_infospace_context(self, infospace: Infospace) -> str:
        """Build system context about the infospace for the AI model"""
        # Get current date and time
        now = datetime.now(timezone.utc)
        current_datetime = now.strftime("%A, %B %d, %Y at %H:%M UTC")
        
        # Escape curly braces in user-provided content to prevent f-string parsing errors
        safe_name = (infospace.name or "").replace("{", "{{").replace("}", "}}")
        safe_description = (infospace.description or "A research workspace for analyzing documents and data.").replace("{", "{{").replace("}", "}}")
        
        # Build workspace context with proper f-string formatting
        context = f"""<workspace>
"{safe_name}" - {safe_description}
Current: {current_datetime}
</workspace>

<instructions>
Tool results display: After executing a tool, reference with <tool_results tool="name" />
The UI will render rich interactive results at that marker.

Common operations
1. Start: navigate() shows workspace tree (bundles + assets)
2. Explore: navigate(mode="view", node_id="X") peeks inside
3. Search: navigate(mode="search", query="...") or semantic_search()
4. Organize: organize(operation="create", name="...", asset_ids=[...])
5. Web: search_web() → ingest_urls() (two-step: search, then save selections)

Key principles:
• Always use depth="previews" for browsing (efficient ~125 tokens/asset)
• Only use depth="full" for small specific documents (can be 1k-100k+ tokens)
• CSVs: navigate(mode="view") for preview, paginate with mode="list" for more
• Track work: working_memory() avoids redundant fetches
• Chain operations: Multiple tools in one response when logical

Response style:
• Direct and analytical
• Use compact formats (tables over bullet lists)
• Suggest next steps when relevant

Tool execution: Execute tools directly without narrating your process or showing JSON arguments.
Users see structured tool results automatically. Focus your response tokens on answering their question.
</instructions>"""
        return context
    
    async def get_available_models(self, user_id: int, capability: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get available models for intelligence analysis.
        
        Args:
            user_id: ID of the user
            capability: Optional capability filter ('tools', 'streaming', etc.)
        
        Returns:
            List of available model information
        """
        logger.info(f"Model discovery request: user={user_id}, capability={capability}")
        
        try:
            # Discover all models
            all_models = await self.model_registry.discover_all_models()
            
            # Flatten and filter by capability if specified
            models = []
            for provider_name, provider_models in all_models.items():
                for model_info in provider_models:
                    if capability:
                        if not getattr(model_info, f"supports_{capability}", False):
                            continue
                    
                    models.append({
                        "name": model_info.name,
                        "provider": model_info.provider,
                        "description": model_info.description,
                        "supports_structured_output": model_info.supports_structured_output,
                        "supports_tools": model_info.supports_tools,
                        "supports_streaming": model_info.supports_streaming,
                        "supports_thinking": model_info.supports_thinking,
                        "supports_multimodal": model_info.supports_multimodal,
                        "max_tokens": model_info.max_tokens,
                        "context_length": model_info.context_length
                    })
            
            logger.info(f"Discovered {len(models)} models for user {user_id}")
            return models
            
        except Exception as e:
            logger.error(f"Model discovery failed: {e}")
            raise RuntimeError(f"Model discovery failed: {str(e)}")