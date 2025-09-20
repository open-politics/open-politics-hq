"""
Intelligence Analysis Conversation Service
"""
import logging
import json
from typing import List, Optional, Dict, Any, AsyncIterator, Union
from datetime import datetime, timezone
from sqlmodel import Session, select, and_, or_
import asyncio

from app.api.providers.model_registry import ModelRegistryService
from app.api.providers.base import GenerationResponse
from app.api.services.service_utils import validate_infospace_access
from app.models import Asset, User, Infospace, Bundle, AnnotationSchema, Annotation
from app.api.services.asset_service import AssetService
from app.api.services.annotation_service import AnnotationService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.schemas import AnnotationRunCreate

logger = logging.getLogger(__name__)


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
        logger.info("IntelligenceConversationService initialized")
    
    def get_universal_tools(self) -> List[Dict[str, Any]]:
        """
        Get universal intelligence analysis tool definitions.
        
        These are the capabilities available to AI models across all infospaces.
        Tool execution happens within infospace context, but definitions are universal.
        """
        return [
            {
                "type": "function",
                "function": {
                    "name": "search_assets",
                    "description": "Search for assets using text queries or semantic similarity",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "query": {
                                "type": "string",
                                "description": "Search query to find relevant assets"
                            },
                            "search_method": {
                                "type": "string",
                                "enum": ["text", "semantic", "hybrid"],
                                "default": "hybrid",
                                "description": "Search method: 'text' for keyword search, 'semantic' for vector similarity, 'hybrid' for both"
                            },
                            "asset_kinds": {
                                "type": "array",
                                "items": {"type": "string"},
                                "description": "Optional filter by asset types (pdf, web, image, etc.)"
                            },
                            "limit": {
                                "type": "integer",
                                "default": 10,
                                "description": "Maximum number of assets to return"
                            },
                            "distance_threshold": {
                                "type": "number",
                                "default": 0.8,
                                "description": "Similarity threshold for semantic search (0-1)"
                            }
                        },
                        "required": ["query"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_asset_details",
                    "description": "Get detailed information about specific assets",
                    "parameters": {
                        "type": "object", 
                        "properties": {
                            "asset_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "List of asset IDs to retrieve"
                            }
                        },
                        "required": ["asset_ids"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "get_annotations",
                    "description": "Get existing annotations for assets",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "asset_ids": {
                                "type": "array", 
                                "items": {"type": "integer"},
                                "description": "Asset IDs to get annotations for"
                            },
                            "schema_ids": {
                                "type": "array",
                                "items": {"type": "integer"}, 
                                "description": "Optional filter by annotation schema IDs"
                            }
                        },
                        "required": ["asset_ids"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "analyze_assets",
                    "description": "Create new annotations by analyzing assets with a specific schema",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "asset_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "Assets to analyze"
                            },
                            "schema_id": {
                                "type": "integer", 
                                "description": "Annotation schema to use for analysis"
                            },
                            "custom_instructions": {
                                "type": "string",
                                "description": "Optional custom analysis instructions"
                            }
                        },
                        "required": ["asset_ids", "schema_id"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "list_schemas",
                    "description": "List available annotation schemas in the infospace",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            },
            {
                "type": "function", 
                "function": {
                    "name": "list_bundles",
                    "description": "List available asset bundles in the infospace",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": []
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "create_report",
                    "description": "Create a new report asset with provenance",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "title": {
                                "type": "string",
                                "description": "Title of the report"
                            },
                            "content": {
                                "type": "string",
                                "description": "Content of the report"
                            },
                            "source_asset_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "List of asset IDs that served as sources for the report"
                            },
                            "source_bundle_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "List of bundle IDs that served as sources for the report"
                            },
                            "source_run_ids": {
                                "type": "array",
                                "items": {"type": "integer"},
                                "description": "List of analysis run IDs that served as sources for the report"
                            }
                        },
                        "required": ["title", "content"]
                    }
                }
            },
            {
                "type": "function",
                "function": {
                    "name": "curate_asset_fragment",
                    "description": "Save a specific piece of information as a permanent, curated fragment on an asset's metadata.",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "asset_id": {
                                "type": "integer",
                                "description": "ID of the asset to curate"
                            },
                            "fragment_key": {
                                "type": "string",
                                "description": "Unique key for the fragment (e.g., 'summary', 'facts')"
                            },
                            "fragment_value": {
                                "type": "string",
                                "description": "The piece of information to save as the fragment"
                            }
                        },
                        "required": ["asset_id", "fragment_key", "fragment_value"]
                    }
                }
            }
        ]

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
        
        # Check if the model exists and get its capabilities
        model_info = await self.model_registry.get_model_info(model_name)
        if not model_info:
            # Try to discover models if not in cache
            await self.model_registry.discover_all_models()
            model_info = await self.model_registry.get_model_info(model_name)
            
        if not model_info:
            raise ValueError(f"Model '{model_name}' not found. Please check available models at /api/v1/chat/models")
            
        supports_tools = model_info.supports_tools
        
        # Get universal tools only if model supports them
        tools = self.get_universal_tools() if supports_tools else None
        
        # Add system context about the infospace
        infospace = self.session.get(Infospace, infospace_id)
        system_context = self._build_infospace_context(infospace)
        
        # Modify system context based on tool support
        if not supports_tools:
            system_context += "\n\nNote: This model doesn't support tool calls, so I can only provide conversational responses based on the context you provide. For interactive data analysis, please use a model that supports tools."
        
        # Prepare messages with context
        context_messages = [{"role": "system", "content": system_context}] + messages
        
        logger.info(f"Intelligence chat: user={user_id}, infospace={infospace_id}, model={model_name}, tools={len(tools) if tools else 0}, supports_tools={supports_tools}")
        
        try:
            # Initial generation
            initial = await self.model_registry.generate(
                messages=context_messages,
                model_name=model_name,
                tools=tools,
                stream=stream,
                **kwargs
            )

            # Auto-execute tool calls for non-streaming path
            if not stream and isinstance(initial, GenerationResponse) and initial.tool_calls:
                tool_summaries: List[str] = []
                for call in initial.tool_calls:
                    try:
                        name = (
                            call.get("function", {}).get("name")
                            if isinstance(call, dict) else None
                        ) or call.get("name")
                        args_str = (
                            call.get("function", {}).get("arguments")
                            if isinstance(call, dict) else None
                        ) or call.get("arguments") or "{}"
                        arguments = {}
                        try:
                            if isinstance(args_str, str) and args_str.strip():
                                arguments = json.loads(args_str)
                        except Exception:
                            arguments = {}
                        if name:
                            result = await self.execute_tool_call(
                                tool_name=name,
                                arguments=arguments,
                                user_id=user_id,
                                infospace_id=infospace_id,
                            )
                            tool_summaries.append(f"{name}: {json.dumps(result)[:2000]}")
                    except Exception as tool_e:
                        tool_summaries.append(f"tool_error: {str(tool_e)}")

                if tool_summaries:
                    # Feed results back to the model for a final answer
                    followup_messages = context_messages + [
                        {"role": "assistant", "content": (initial.content or "")},
                        {"role": "assistant", "content": "\n".join(["Tool results:"] + tool_summaries)},
                        {"role": "user", "content": "Using the tool results above, provide a concise answer for the user."},
                    ]
                    final = await self.model_registry.generate(
                        messages=followup_messages,
                        model_name=model_name,
                        tools=None,
                        stream=False,
                        **kwargs
                    )

                    # Ensure non-empty content
                    if isinstance(final, GenerationResponse) and not final.content:
                        final.content = "\n".join(tool_summaries)[:4000]
                    return final

            return initial
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
                               infospace_id: int) -> Dict[str, Any]:
        """
        Execute a tool call made by the AI model.
        
        Args:
            tool_name: Name of the tool to execute
            arguments: Arguments for the tool call
            user_id: ID of the user
            infospace_id: ID of the infospace
            
        Returns:
            Tool execution result
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        logger.info(f"Executing tool: {tool_name} with args: {arguments}")
        
        try:
            if tool_name == "search_assets":
                return await self._tool_search_assets(arguments, infospace_id)
            
            elif tool_name == "get_asset_details":
                return await self._tool_get_asset_details(arguments, infospace_id)
            
            elif tool_name == "get_annotations":
                return await self._tool_get_annotations(arguments, infospace_id)
            
            elif tool_name == "analyze_assets":
                return await self._tool_analyze_assets(arguments, user_id, infospace_id)
            
            elif tool_name == "list_schemas":
                return await self._tool_list_schemas(infospace_id)
            
            elif tool_name == "list_bundles":
                return await self._tool_list_bundles(infospace_id)
            
            elif tool_name == "create_report":
                return await self._tool_create_report(arguments, user_id, infospace_id)
            
            elif tool_name == "curate_asset_fragment":
                return await self._tool_curate_asset_fragment(arguments, user_id, infospace_id)
            
            else:
                raise ValueError(f"Unknown tool: {tool_name}")
                
        except Exception as e:
            logger.error(f"Tool execution failed: {tool_name} - {e}")
            return {"error": f"Tool execution failed: {str(e)}"}
    
    # ─────────────── TOOL EXECUTION METHODS ─────────────── #
    
    async def _tool_search_assets(self, arguments: Dict[str, Any], infospace_id: int) -> Dict[str, Any]:
        """Execute unified search_assets tool call with multiple search methods"""
        query = arguments.get("query", "")
        search_method = arguments.get("search_method", "hybrid")
        asset_kinds = arguments.get("asset_kinds", [])
        limit = arguments.get("limit", 10)
        distance_threshold = arguments.get("distance_threshold", 0.8)
        
        logger.info(f"Asset search: query='{query}', method={search_method}, limit={limit}")
        
        options = {"asset_kinds": asset_kinds, "distance_threshold": distance_threshold}

        if search_method == "text":
            return await self.content_ingestion_service._search_assets_text(query, infospace_id, limit, options)
        
        elif search_method == "semantic":
            return await self.content_ingestion_service._search_assets_semantic(query, infospace_id, limit, options)
        
        elif search_method == "hybrid":
            # Combine text and semantic search results
            text_assets_task = self.content_ingestion_service._search_assets_text(query, infospace_id, limit // 2, options)
            semantic_assets_task = self.content_ingestion_service._search_assets_semantic(query, infospace_id, limit // 2, options)

            text_results, semantic_results = await asyncio.gather(text_assets_task, semantic_assets_task)
            
            # Merge and deduplicate results
            all_assets = {}
            
            # Add text results
            for asset in text_results.get("assets", []):
                asset["search_method"] = "text"
                all_assets[asset["id"]] = asset
            
            # Add semantic results (don't duplicate)
            for asset in semantic_results.get("assets", []):
                if asset["id"] not in all_assets:
                    asset["search_method"] = "semantic"
                    all_assets[asset["id"]] = asset
                else:
                    # Mark as found by both methods
                    all_assets[asset["id"]]["search_method"] = "hybrid"
            
            # Sort by relevance (hybrid matches first, then by creation date)
            sorted_assets = sorted(
                all_assets.values(),
                key=lambda x: (x["search_method"] == "hybrid", x["created_at"]),
                reverse=True
            )
            
            return {
                "assets": sorted_assets[:limit],
                "total_found": len(sorted_assets),
                "search_method": "hybrid",
                "text_results": len(text_results.get("assets", [])),
                "semantic_results": len(semantic_results.get("assets", []))
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
        context = f"""You are an AI intelligence analyst working in the "{infospace.name}" infospace.

Description: {infospace.description or "No description provided"}

You have access to intelligence analysis tools that allow you to:
- Search for assets (documents, articles, media) using text queries
- Perform semantic searches using embeddings
- Get detailed information about specific assets
- View existing annotations and analysis results
- Create new analysis runs using annotation schemas
- List available schemas and bundles

When users ask questions about intelligence, documents, or analysis:
1. Use search tools to find relevant assets
2. Get details about interesting assets
3. Check existing annotations if available
4. Create new analysis runs if needed
5. Present findings in a clear, analytical manner

Always think step-by-step about what information you need and use the appropriate tools to gather it.
"""
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