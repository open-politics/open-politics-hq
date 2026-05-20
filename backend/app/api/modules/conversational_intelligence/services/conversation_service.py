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

from app.api.modules.foundation_service_providers import resolve, ProviderError, get_model_spec
from app.api.modules.foundation_service_providers.base import GenerationResponse
from app.models import Asset, User, Infospace, Bundle, AnnotationSchema, Annotation, AssetKind
from app.api.modules.annotation.services import AnnotationService
from app.api.modules.content.query import AssetQuery
from app.schemas import AnnotationRunCreate
from app.api.modules.conversational_intelligence.mcp_server.client import (
    IntelligenceMCPClient,
    get_mcp_client,
    create_mcp_context_token_with_api_keys,
)
from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)


def create_mcp_context_token(user_id: int, infospace_id: int) -> str:
    """Creates a short-lived JWT to securely pass context to the MCP server."""
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES
    )
    to_encode = {
        "exp": expire,
        "sub": str(user_id),
        "infospace_id": infospace_id,
    }
    encoded_jwt = jwt.encode(
        to_encode, settings.SECRET_KEY, algorithm=security.ALGORITHM
    )
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

    def __init__(
        self,
        session: Session,
        annotation_service: AnnotationService,
        settings: Any = None,
    ):
        self.session = session
        self.annotation_service = annotation_service
        self._settings = settings
        logger.info("IntelligenceConversationService initialized")

    async def get_universal_tools(
        self,
        user_id: int,
        infospace_id: int,
        api_keys: Optional[Dict[str, str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Get universal intelligence analysis capabilities (tools + resources).

        FastMCP automatically generates schemas from function signatures.
        This combines both tools (actions) and resources (data access) for the AI.
        """
        try:
            async with get_mcp_client(
                session=self.session,
                annotation_service=self.annotation_service,
                user_id=user_id,
                infospace_id=infospace_id,
                api_keys=api_keys,
            ) as mcp_client:
                tools = await mcp_client.get_available_tools()
                logger.info(f"Retrieved {len(tools)} tools from MCP server")
                return tools

        except Exception as e:
            logger.error(f"Failed to get universal tools: {e}")
            return []

    async def get_infospace_tool_context(
        self, infospace_id: int, user_id: int
    ) -> Dict[str, Any]:
        """
        Get infospace-specific context for tools (what's actually available).

        This provides real data to help AI models make better tool usage decisions.
        """
        infospace = self.session.get(Infospace, infospace_id)

        available_asset_kinds = self.session.exec(
            select(Asset.kind).where(Asset.infospace_id == infospace_id).distinct()
        ).all()

        schemas = self.session.exec(
            select(AnnotationSchema)
            .where(AnnotationSchema.infospace_id == infospace_id)
            .where(AnnotationSchema.is_active == True)
        ).all()

        bundles = self.session.exec(
            select(Bundle).where(Bundle.infospace_id == infospace_id)
        ).all()

        from sqlmodel import func

        total_assets = self.session.exec(
            select(func.count(Asset.id)).where(Asset.infospace_id == infospace_id)
        ).one()

        total_annotations = self.session.exec(
            select(func.count(Annotation.id)).where(
                Annotation.infospace_id == infospace_id
            )
        ).one()

        return {
            "infospace": {
                "id": infospace_id,
                "name": infospace.name,
                "description": infospace.description,
            },
            "available_asset_kinds": [kind.value for kind in available_asset_kinds],
            "available_schemas": [
                {
                    "id": schema.id,
                    "name": schema.name,
                    "description": schema.description,
                    "version": schema.version,
                }
                for schema in schemas
            ],
            "available_bundles": [
                {
                    "id": bundle.id,
                    "name": bundle.name,
                    "description": bundle.description,
                    "asset_count": bundle.asset_count,
                }
                for bundle in bundles
            ],
            "statistics": {
                "total_assets": total_assets,
                "total_annotations": total_annotations,
                "schema_count": len(schemas),
                "bundle_count": len(bundles),
            },
        }

    async def intelligence_chat(
        self,
        messages: List[Dict[str, str]],
        model_name: str,
        user_id: int,
        infospace_id: int,
        stream: bool = False,
        thinking_enabled: bool = False,
        api_keys: Optional[Dict[str, str]] = None,
        conversation_id: Optional[int] = None,
        tools_enabled: bool = True,
        tools: Optional[List[Dict[str, Any]]] = None,
        provider_name: Optional[str] = None,
        agent: Optional[str] = None,
        run_id: Optional[int] = None,
        formula_id: Optional[str] = None,
        **kwargs,
    ) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Intelligence analysis chat with full tool orchestration.

        The model can search, analyze, and interact with intelligence data through tool calls.

        Parameters
        ----------
        agent:
            Optional agent persona. ``None`` / ``'intelligence'`` (default) loads
            the workspace-wide research toolset. ``'dossier'`` activates the
            DossierAgent — narrower toolset (formula authoring, observation
            snapshots) plus the formula-manual system prompt. See
            ``docs/intelligence/HOW_TO.md`` § DossierAgent.
        run_id:
            When ``agent='dossier'``, the run the agent operates against. The
            system prompt surfaces this as a default for tool calls; the tools
            themselves still take ``run_id`` explicitly so the model can
            cross-run if a user asks.
        """
        context_token = create_mcp_context_token_with_api_keys(
            user_id, infospace_id, api_keys or {}, conversation_id, model_name
        )

        runtime_key = (api_keys or {}).get(provider_name) if provider_name else None
        try:
            provider_instance = resolve(
                "language", provider_name, model_name,
                infospace_id=infospace_id,
                context="chat",
                runtime_key=runtime_key,
                session=self.session,
            )
        except ProviderError as e:
            raise ValueError(
                f"No LLM provider available for model '{model_name}': {e}"
            )

        model_spec = get_model_spec("language", provider_instance.provider_key, model_name)
        supports_tools = bool(getattr(model_spec, "supports_tools", False)) if model_spec else False

        if supports_tools and tools_enabled:
            if tools is not None and len(tools) > 0:
                logger.info(f"Using {len(tools)} filtered tools provided by frontend")
            else:
                tools = await self.get_universal_tools(user_id, infospace_id, api_keys)
                logger.info(f"Fetched {len(tools)} tools from MCP server")

            # Agent personas — narrow the tool surface so the model stays on
            # task. Each persona gets its own subset; the default workspace
            # chat sees all universal tools.
            #
            # - dossier  : run-level orchestration (formula + panel + snapshot + note)
            # - formula  : formula authoring only (introspect / create / edit / preview / list)
            if agent == "dossier" and tools:
                dossier_tool_names = {
                    "formula_introspect_schema", "formula_create", "formula_edit",
                    "formula_preview", "formula_list",
                    "panel_create", "panel_layout",
                    "observation_snapshot", "dossier_note_append",
                }
                before = len(tools)
                tools = [t for t in tools if (t.get("function") or t).get("name") in dossier_tool_names]
                logger.info(f"DossierAgent: filtered {before} → {len(tools)} tools")
            elif agent == "formula" and tools:
                formula_tool_names = {
                    "formula_introspect_schema", "formula_create", "formula_edit",
                    "formula_preview", "formula_list",
                }
                before = len(tools)
                tools = [t for t in tools if (t.get("function") or t).get("name") in formula_tool_names]
                logger.info(f"FormulaAgent: filtered {before} → {len(tools)} tools")
        else:
            tools = None

        infospace = self.session.get(Infospace, infospace_id)
        if agent == "dossier":
            system_context = self._build_dossier_agent_context(infospace, run_id)
        elif agent == "formula":
            system_context = self._build_formula_agent_context(infospace, run_id, formula_id)
        else:
            system_context = self._build_infospace_context(infospace)

        context_messages = [{"role": "system", "content": system_context}] + messages

        logger.info(
            f"Intelligence chat: user={user_id}, infospace={infospace_id}, model={model_name}, tools={len(tools) if tools else 0}, supports_tools={supports_tools}"
        )

        try:
            return await provider_instance.generate(
                messages=context_messages,
                model_name=model_name,
                tools=tools,
                stream=stream,
                thinking_enabled=thinking_enabled,
                mcp_headers={"Authorization": f"Bearer {context_token}"},
                tool_executor=lambda name, args: self.execute_tool_call(
                    name, args, user_id, infospace_id, api_keys, conversation_id
                ),
                **kwargs,
            )

        except Exception as e:
            error_str = str(e)

            if "does not support tools" in error_str and tools is not None:
                logger.warning(f"Model {model_name} rejected tools, retrying without tools")
                fallback_context = (
                    system_context
                    + "\n\nNote: This model doesn't support tool calls, so I can only provide conversational responses based on your questions."
                )
                fallback_messages = [
                    {"role": "system", "content": fallback_context}
                ] + messages

                try:
                    return await provider_instance.generate(
                        messages=fallback_messages,
                        model_name=model_name,
                        tools=None,
                        stream=stream,
                        mcp_headers={"Authorization": f"Bearer {context_token}"},
                        tool_executor=lambda name, args: self.execute_tool_call(
                            name,
                            args,
                            user_id,
                            infospace_id,
                            api_keys,
                            conversation_id,
                        ),
                        **kwargs,
                    )
                except Exception as fallback_e:
                    logger.error(
                        f"Intelligence chat failed even without tools: {fallback_e}"
                    )
                    raise RuntimeError(
                        f"Intelligence conversation failed: {str(fallback_e)}"
                    )

            if (
                "temperature" in error_str and "does not support" in error_str
            ) or "unsupported_value" in error_str:
                logger.warning(
                    f"Model {model_name} rejected parameters, retrying with minimal config"
                )
                clean_kwargs = {
                    k: v
                    for k, v in kwargs.items()
                    if k not in ["temperature", "top_p", "max_tokens"]
                }

                try:
                    return await provider_instance.generate(
                        messages=context_messages,
                        model_name=model_name,
                        tools=tools,
                        stream=stream,
                        mcp_headers={"Authorization": f"Bearer {context_token}"},
                        **clean_kwargs,
                    )
                except Exception as clean_e:
                    logger.error(
                        f"Intelligence chat failed even with clean parameters: {clean_e}"
                    )
                    raise RuntimeError(
                        f"Intelligence conversation failed: {str(clean_e)}"
                    )

            logger.error(f"Intelligence chat failed: {e}")
            raise RuntimeError(f"Intelligence conversation failed: {str(e)}")

    async def execute_tool_call(
        self,
        tool_name: str,
        arguments: Dict[str, Any],
        user_id: int,
        infospace_id: int,
        api_keys: Optional[Dict[str, str]] = None,
        conversation_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Execute a tool call or resource read made by the AI model using MCP.
        """
        logger.info(f"Executing MCP capability: {tool_name} with args: {arguments}")

        try:
            async with get_mcp_client(
                session=self.session,
                annotation_service=self.annotation_service,
                user_id=user_id,
                infospace_id=infospace_id,
                api_keys=api_keys,
                conversation_id=conversation_id,
            ) as mcp_client:
                result = await mcp_client.execute_tool(tool_name, arguments)
                if isinstance(result, dict) and result.get("error"):
                    logger.error(
                        f"MCP tool execution failed for '{tool_name}': {result['error']}"
                    )
                else:
                    logger.info(f"MCP tool execution successful for: {tool_name}")
                return result

        except Exception as e:
            logger.error(
                f"MCP capability execution failed: {tool_name} - {e}", exc_info=True
            )
            return {"error": f"Capability execution failed: {str(e)}"}

    async def _tool_search_assets(
        self, arguments: Dict[str, Any], infospace_id: int
    ) -> Dict[str, Any]:
        """Execute unified search_assets tool call."""
        query = arguments.get("query", "")
        search_method = arguments.get("search_method", "hybrid")
        asset_kinds = arguments.get("asset_kinds", [])
        limit = arguments.get("limit", 10)
        distance_threshold = arguments.get("distance_threshold", 0.8)

        logger.info(
            f"Asset search: query='{query}', method={search_method}, limit={limit}"
        )

        options = {"asset_kinds": asset_kinds, "distance_threshold": distance_threshold}

        def _serialize_asset(a: Asset) -> Dict[str, Any]:
            try:
                return {
                    "id": a.id,
                    "title": a.title,
                    "kind": a.kind.value if getattr(a, "kind", None) else None,
                    "text_content": getattr(a, "text_content", None),
                    "facets": getattr(a, "facets", None),
                    "file_info": getattr(a, "file_info", None),
                    "created_at": a.created_at.isoformat()
                    if getattr(a, "created_at", None)
                    else None,
                    "event_timestamp": a.event_timestamp.isoformat()
                    if getattr(a, "event_timestamp", None)
                    else None,
                }
            except Exception:
                return {"id": getattr(a, "id", None), "title": getattr(a, "title", None)}

        kinds = [AssetKind(k) for k in (asset_kinds or []) if k in AssetKind.__members__]

        def _text_query(q: str, n: int) -> AssetQuery:
            aq = (
                AssetQuery(self.session, infospace_id)
                .exclude_superseded()
                .text(q, mode="fts")
                .sort("relevance" if q else "created_at_desc")
                .paginate(limit=n)
            )
            if kinds:
                aq.kinds(kinds)
            return aq

        def _semantic_query(q: str, n: int) -> AssetQuery:
            aq = (
                AssetQuery(self.session, infospace_id)
                .exclude_superseded()
                .semantic(q, top_k=n)
                .paginate(limit=n)
            )
            if kinds:
                aq.kinds(kinds)
            return aq

        if search_method == "text":
            assets = _text_query(query, limit).execute()
            return {
                "assets": [_serialize_asset(a) for a in assets],
                "total_found": len(assets),
                "search_method": "text",
            }

        elif search_method == "semantic":
            try:
                assets = await _semantic_query(query, limit).execute_async()
            except Exception as e:
                logger.warning(f"Semantic search failed, falling back to text: {e}")
                assets = _text_query(query, limit).execute()
            return {
                "assets": [_serialize_asset(a) for a in assets],
                "total_found": len(assets),
                "search_method": "semantic",
            }

        elif search_method == "hybrid":
            half = max(1, limit // 2)

            async def _run_text():
                return _text_query(query, half).execute()

            async def _run_sem():
                try:
                    return await _semantic_query(query, half).execute_async()
                except Exception as e:
                    logger.warning(f"Semantic search failed in hybrid: {e}")
                    return []

            text_list, sem_list = await asyncio.gather(_run_text(), _run_sem())

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

    async def _tool_get_asset_details(
        self, arguments: Dict[str, Any], infospace_id: int
    ) -> Dict[str, Any]:
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
                    "facets": asset.facets,
                    "file_info": asset.file_info,
                    "created_at": asset.created_at.isoformat(),
                    "event_timestamp": asset.event_timestamp.isoformat()
                    if asset.event_timestamp
                    else None,
                }
                for asset in assets
            ]
        }

    async def _tool_get_annotations(
        self, arguments: Dict[str, Any], infospace_id: int
    ) -> Dict[str, Any]:
        """Execute get_annotations tool call"""
        asset_ids = arguments.get("asset_ids", [])
        schema_ids = arguments.get("schema_ids", [])

        query_conditions = [
            Annotation.infospace_id == infospace_id,
            Annotation.asset_id.in_(asset_ids),
        ]

        if schema_ids:
            query_conditions.append(Annotation.schema_id.in_(schema_ids))

        annotations = self.session.exec(
            select(Annotation).where(and_(*query_conditions))
        ).all()

        return {
            "annotations": [
                {
                    "id": annotation.id,
                    "asset_id": annotation.asset_id,
                    "schema_id": annotation.schema_id,
                    "value": annotation.value,
                    "status": annotation.status.value,
                    "timestamp": annotation.timestamp.isoformat(),
                }
                for annotation in annotations
            ],
            "total_found": len(annotations),
        }

    async def _tool_analyze_assets(
        self,
        arguments: Dict[str, Any],
        user_id: int,
        infospace_id: int,
    ) -> Dict[str, Any]:
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

        run_create = AnnotationRunCreate(
            name=f"AI Analysis - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
            description=f"Analysis requested through chat interface: {custom_instructions}"
            if custom_instructions
            else "Analysis requested through chat interface",
            schema_ids=[schema_id],
            target_asset_ids=asset_ids,
            configuration=configuration,
        )

        try:
            run = self.annotation_service.create_run(
                user_id, infospace_id, run_create
            )
            return {
                "run_id": run.id,
                "run_name": run.name,
                "status": "started",
                "message": f"Analysis run {run.id} started for {len(asset_ids)} assets",
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
                    "version": schema.version,
                }
                for schema in schemas
            ]
        }

    async def _tool_list_bundles(self, infospace_id: int) -> Dict[str, Any]:
        """Execute list_bundles tool call"""
        bundles = self.session.exec(
            select(Bundle).where(Bundle.infospace_id == infospace_id)
        ).all()

        return {
            "bundles": [
                {
                    "id": bundle.id,
                    "name": bundle.name,
                    "description": bundle.description,
                    "asset_count": bundle.asset_count,
                    "created_at": bundle.created_at.isoformat(),
                }
                for bundle in bundles
            ]
        }

    async def _tool_create_report(
        self,
        arguments: Dict[str, Any],
        user_id: int,
        infospace_id: int,
    ) -> Dict[str, Any]:
        """Execute create_report tool call - create a new report asset"""
        title = arguments.get("title")
        content = arguments.get("content")
        source_asset_ids = arguments.get("source_asset_ids", [])
        source_bundle_ids = arguments.get("source_bundle_ids", [])
        source_run_ids = arguments.get("source_run_ids", [])

        if not title or not content:
            return {"error": "Title and content are required for a report"}

        try:
            from app.api.modules.content.services.asset_builder import AssetBuilder
            file_info = {
                "composition_type": "report",
                "created_by": "user_action",
                "source_asset_ids": source_asset_ids or [],
                "source_bundle_ids": source_bundle_ids or [],
                "source_run_ids": source_run_ids or [],
            }
            report_asset = await (
                AssetBuilder(self.session, user_id, infospace_id)
                .as_kind(AssetKind.ARTICLE)
                .with_title(title)
                .with_text(content)
                .with_metadata(**file_info)
                .no_dedup()
                .build()
            )
            self.session.commit()
            self.session.refresh(report_asset)

            return {
                "report_id": report_asset.id,
                "report_name": report_asset.title,
                "status": "created",
                "message": f"Report {report_asset.id} created successfully",
            }
        except Exception as e:
            logger.error(f"Failed to create report: {e}")
            return {"error": f"Failed to create report: {str(e)}"}

    async def _tool_curate_asset_fragment(
        self,
        arguments: Dict[str, Any],
        user_id: int,
        infospace_id: int,
    ) -> Dict[str, Any]:
        """Execute curate_asset_fragment tool call"""
        asset_id = arguments.get("asset_id")
        fragment_key = arguments.get("fragment_key")
        fragment_value = arguments.get("fragment_value")

        if not asset_id or not fragment_key or not fragment_value:
            return {
                "error": "asset_id, fragment_key, and fragment_value are required"
            }

        try:
            annotation = self.annotation_service.curate_fragment(
                user_id=user_id,
                infospace_id=infospace_id,
                asset_id=asset_id,
                field_name=fragment_key,
                value=fragment_value,
            )

            return {
                "asset_id": asset_id,
                "fragment_key": fragment_key,
                "fragment_value": fragment_value,
                "status": "curated",
                "message": f"Fragment '{fragment_key}' curated on asset {asset_id} with audit trail in run {annotation.run_id}",
            }
        except Exception as e:
            logger.error(f"Failed to curate asset fragment: {e}")
            return {"error": f"Failed to curate asset fragment: {str(e)}"}

    def _build_dossier_agent_context(self, infospace: Infospace, run_id: Optional[int]) -> str:
        """Build the DossierAgent's system prompt.

        Concatenates the static formula-manual (the canonical reference at
        ``prompts/dossier_agent_prompt.md``) with a small dynamic preamble
        carrying the active infospace + run scope. Surfaces the run_id so
        the model defaults tool calls to it.
        """
        from pathlib import Path
        now = datetime.now(timezone.utc).strftime("%A, %B %d, %Y at %H:%M UTC")
        safe_name = (infospace.name or "").replace("{", "{{").replace("}", "}}")
        run_hint = f"You are operating on run_id={run_id}. Default every tool call to this id unless the user explicitly scopes elsewhere." if run_id else "No run scope was provided; ask the user which run to operate on before authoring formulas."

        prompt_path = Path(__file__).resolve().parents[1] / "prompts" / "dossier_agent_prompt.md"
        try:
            manual = prompt_path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning(f"DossierAgent prompt missing: {e}; falling back to inline summary")
            manual = (
                "You are the DossierAgent. Author Formulas (six verbs: from, "
                "filter, group, weight, aggregate, derive), drop Panels bound "
                "to them, snapshot Observations, and write dossier notes. "
                "Always call formula_introspect_schema first."
            )

        return (
            f"<workspace>\"{safe_name}\" — current: {now}\n{run_hint}</workspace>\n\n"
            + manual
        )

    def _build_formula_agent_context(
        self,
        infospace: Infospace,
        run_id: Optional[int],
        formula_id: Optional[str] = None,
    ) -> str:
        """Build the FormulaAgent's system prompt.

        Narrower than DossierAgent — focuses on single-formula authoring inside
        the workspace editor. No panel ops, no snapshots, no notes. The model
        only sees the formula-* tools and is told to lead with introspection.

        When ``formula_id`` is set, surfaces the active formula's name + body
        so the model defaults edits to it instead of asking which formula.
        """
        from pathlib import Path
        from app.api.modules.annotation.models import AnnotationRun
        now = datetime.now(timezone.utc).strftime("%A, %B %d, %Y at %H:%M UTC")
        safe_name = (infospace.name or "").replace("{", "{{").replace("}", "}}")

        run_hint = (
            f"You are inside the formula workspace for run_id={run_id}. Always pass "
            f"this run_id to your tools. The user is authoring or refining one formula at a time."
            if run_id else
            "No run scope provided. Ask the user which run before authoring."
        )

        # Active-formula hint: look up the formula by id on the run's dashboard
        # config and surface its current body to the model so edits are
        # informed, not speculative.
        active_hint = ""
        if run_id and formula_id:
            try:
                run = self.session.get(AnnotationRun, run_id)
                if run:
                    vc = getattr(run, "views_config", None)
                    dashboard = (
                        vc[0] if isinstance(vc, list) and vc and isinstance(vc[0], dict)
                        else vc if isinstance(vc, dict)
                        else None
                    )
                    formulas = (dashboard or {}).get("formulas") or []
                    active = next(
                        (f for f in formulas if isinstance(f, dict) and f.get("id") == formula_id),
                        None,
                    )
                    if active:
                        import json as _json
                        body = _json.dumps(active.get("projection") or {}, ensure_ascii=False)[:1200]
                        active_hint = (
                            f"\n\n<active_formula>The user has formula "
                            f"\"{active.get('name')}\" (id={formula_id}) open in the editor. "
                            f"Default edits to it via formula_edit unless they ask for something new. "
                            f"Current body (truncated):\n{body}</active_formula>"
                        )
            except Exception as e:  # noqa: BLE001
                logger.warning(f"formula agent: active hint lookup failed: {e}")

        prompt_path = Path(__file__).resolve().parents[1] / "prompts" / "formula_agent_prompt.md"
        try:
            manual = prompt_path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning(f"FormulaAgent prompt missing: {e}; falling back to inline summary")
            manual = (
                "You are the FormulaAgent. Help the user author a single Formula. "
                "First call formula_introspect_schema(run_id) to discover the schema "
                "surface (row-shape roots, field paths, axes). Then either propose a "
                "PanelProjection body and call formula_create, or call formula_edit on "
                "an existing one. Never invent fields — only use paths that introspect "
                "actually returned."
            )

        return (
            f"<workspace>\"{safe_name}\" — current: {now}\n{run_hint}</workspace>"
            + active_hint
            + "\n\n"
            + manual
        )

    def _build_infospace_context(self, infospace: Infospace) -> str:
        """Build system context about the infospace for the AI model"""
        now = datetime.now(timezone.utc)
        current_datetime = now.strftime("%A, %B %d, %Y at %H:%M UTC")

        safe_name = (infospace.name or "").replace("{", "{{").replace("}", "}}")
        safe_description = (
            infospace.description or "A research workspace for analyzing documents and data."
        ).replace("{", "{{").replace("}", "}}")

        context = f"""<workspace>
"{safe_name}" - {safe_description}
Current: {current_datetime}
</workspace>

<instructions>
Tool results display: After executing a tool, reference with <tool_results tool="name" />
The UI will render rich interactive results at that marker.

Pick the entry point by task type — do NOT default to navigate() for everything:
• Browse/explore the workspace tree   → navigate()
• Edit, create, inspect a SCHEMA      → analysis_hub(operation="schema.list" | "schema.get" | "schema.update" | "schema.create")
• Start or inspect an annotation RUN  → analysis_hub(operation="run.start" | "run.list" | "run.dashboard")
• Organize assets into bundles        → organize()
• Research the web                    → search_web() → ingest_urls()
• Remember user context               → working_memory()

Schemas are NOT assets — navigate() will not find them. Use analysis_hub for anything schema-related.

Minimum call plans (plan the path mentally BEFORE the first tool call):
• Schema edit: schema.list → schema.get(id) → schema.update(id, output_contract=...)   (3 calls)
• Schema create: analysis_hub(op="schema.create", schema_name, output_contract)          (1 call)
• Run start: analysis_hub(op="run.start", schema_id, asset_ids)                          (1 call)
• Asset browse: navigate(mode="search", query=..., depth="previews")                     (1 call)
• Asset load for editing: navigate(mode="view", node_id=..., depth="full")               (1 call)

If the minimum path isn't obvious from the request, ask ONE clarifying question instead
of exploring. This is not the same as asking permission for a clear task — it's avoiding
wrong actions on ambiguous intent. Example: user says "schreib sie rein" (write them in) —
if it's unclear whether they mean "list them for review" vs "commit to the schema", ask.

Efficient navigation patterns (CRITICAL - prevents iteration limits):
• SEARCH FIRST, don't walk the tree: navigate(resource="assets", mode="search", query="topic", depth="previews")
• Direct bundle access: navigate(mode="view", node_id="bundle-123", depth="previews") to see contents
• Batch operations: tasks(operation="batch", actions=[...]) instead of individual calls

⚠️ NEVER use depth="full" for search/list - use "previews" for browsing, "full" only when editing specific documents

Common anti-patterns that cause iteration limits:
❌ Using navigate() to find schemas or runs (use analysis_hub)
❌ Multiple separate calls to explore structure (tree → view → list → load)
❌ Individual task additions instead of batching (3 tasks = 3 calls, should be 1)
❌ Fetching content multiple times or at wrong depth (search previews → then load full)
❌ Not planning workflow upfront (exploring → then deciding what to do)

Depth usage (BUDGET-AWARE):
• depth="previews" (DEFAULT): ~125 tokens/asset - use for browsing, searching, exploring
• depth="full" (SPARINGLY): 1k-100k+ tokens - ONLY for small specific documents you're editing
• Never use "full" for browsing - it wastes tokens and hits limits

Key principles:
• Always use depth="previews" for browsing (efficient ~125 tokens/asset)
• Only use depth="full" for small specific documents you're actively editing (can be 1k-100k+ tokens)
• CSVs: navigate(mode="view") for preview, paginate with mode="list" for more
• Track work: working_memory() avoids redundant fetches
• Batch operations: MANDATORY - Use tasks(operation="batch") for 2+ task operations (prevents iteration limits)
• Chain operations: Multiple tools in one response when logical

Task operations (CRITICAL):
• Always funnel mutations through tasks(operation="batch", actions=[...]) — even single additions/updates.
• Batch format keeps iteration count predictable (add/start/finish/cancel in one call).
• Example: Creating 3 tasks = tasks(operation="batch", actions=[action_dict1, action_dict2, action_dict3]) = 1 call.

Response style:
• Direct and analytical
• Use compact formats (tables over bullet lists)
• Only suggest next steps if: the user is exploring/discovering, results are ambiguous, or they explicitly ask "what next?"
• Don't explain tool usage after simple CRUD operations (create/update/delete)

Tool execution: Execute tools directly without narrating your process or showing JSON arguments.
Users see structured tool results automatically. Focus your response tokens on answering their question.

General principles:
• Trust that tool results are self-documenting
• Reserve response tokens for insights, not narration
• User knows the interface - only explain the unexpected
</instructions>"""
        return context

    async def get_available_models(
        self,
        capability: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Enumerate statically-declared language models across the deployment.

        Reads from the descriptor registry — no credentials, no infospace context.
        Callers that need credential-validated discovery should go through the
        ``/providers/models`` route (infospace-gated) instead.
        """
        from app.api.modules.foundation_service_providers import list_providers
        from app.api.modules.foundation_service_providers.base import LLMModelSpec

        results: List[Dict[str, Any]] = []
        for provider_key, desc in list_providers("language"):
            for spec in desc.models:
                if not isinstance(spec, LLMModelSpec):
                    continue
                entry = {
                    "name": spec.name,
                    "provider": provider_key,
                    "supports_tools": spec.supports_tools,
                    "supports_streaming": spec.supports_streaming,
                    "supports_thinking": spec.supports_thinking,
                    "supports_multimodal": spec.supports_multimodal,
                    "supports_structured_output": spec.supports_structured_output,
                }
                if spec.max_tokens:
                    entry["max_tokens"] = spec.max_tokens
                if spec.context_length:
                    entry["context_length"] = spec.context_length
                if spec.description:
                    entry["description"] = spec.description
                results.append(entry)

        if capability:
            results = [m for m in results if m.get(f"supports_{capability}", False)]

        logger.info("Language model catalog: %d entries", len(results))
        return results
