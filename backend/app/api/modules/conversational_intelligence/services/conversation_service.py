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

from app.api.modules.foundation_service_providers import (
    resolve, ProviderError, get_model_spec, GenerationOptions,
)
from app.api.modules.foundation_service_providers import GenerationResponse
from app.models import Asset, User, Infospace, Bundle, AnnotationSchema, Annotation, AssetKind
from app.api.modules.annotation.services import AnnotationService
from app.api.modules.content.query import AssetQuery
from app.api.modules.identity_infospace_user.access import resolve_access_capped
from app.api.modules.conversational_intelligence import catalogue as C
from app.schemas import AnnotationRunCreate
from app.api.modules.conversational_intelligence.mcp_server.client import (
    IntelligenceMCPClient,
    get_mcp_client,
    create_mcp_context_token_with_api_keys,
)
from app.core import security
from app.core.config import settings

logger = logging.getLogger(__name__)


def _enumerate_schema_paths(contract, prefix: str = "", leaves=None, arrays=None, depth: int = 0):
    """Walk an annotation schema's output_contract into dotted field paths.

    Leaves are usable panel-axis paths (``document.summary``,
    ``document.triplets.subject_name``); ``arrays`` collects array-of-object
    containers (``document.triplets``) — the operator appends ``[*]`` for a graph
    source or explode. Bounded depth so a pathological schema can't runaway.
    """
    leaves = leaves if leaves is not None else []
    arrays = arrays if arrays is not None else []
    if not isinstance(contract, dict) or depth > 6:
        return leaves, arrays
    props = contract.get("properties")
    if isinstance(props, dict):
        for name, sub in props.items():
            if not isinstance(sub, dict):
                continue
            path = f"{prefix}.{name}" if prefix else name
            st = sub.get("type")
            if st == "object":
                _enumerate_schema_paths(sub, path, leaves, arrays, depth + 1)
            elif st == "array":
                items = sub.get("items") if isinstance(sub.get("items"), dict) else {}
                if items.get("type") == "object" and isinstance(items.get("properties"), dict):
                    arrays.append(path)
                    _enumerate_schema_paths(items, path, leaves, arrays, depth + 1)
                else:
                    leaves.append(path)  # array of scalars
            else:
                leaves.append(path)
    return leaves, arrays


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
        current_route: Optional[str] = None,
        current_focus: Optional[Dict[str, Any]] = None,
        **kwargs,
    ) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Intelligence analysis chat with full tool orchestration.

        The model can search, analyze, and interact with intelligence data through tool calls.

        Parameters
        ----------
        agent:
            Optional agent persona. ``None`` / ``'intelligence'`` / ``'operator'``
            all load the workspace-wide research toolset — the operator is the
            only persona left. The run-scoped Dossier and Formula personas were
            retired along with hand-authored formulas.
        run_id:
            Optional run the chat is scoped to. The system prompt surfaces this
            as a default for tool calls; the tools themselves still take
            ``run_id`` explicitly so the model can cross-run if a user asks.
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

        # The HQ operator is the only persona (browse-all catalogue). Unset and
        # legacy 'intelligence' both map to it.
        is_operator = agent in (None, "", "intelligence", "operator")
        schema_by_name: Dict[str, Any] = {}
        active_scenario = None  # sticky operator scenario, derived from history below

        # The operator runs long multi-step arcs (browse → load → seed → sources →
        # schema → live run). Raise its per-turn tool-loop cap above the default 20 so
        # a full arc doesn't get truncated mid-build. Caller can still override.
        if is_operator and "max_tool_iterations" not in kwargs:
            kwargs["max_tool_iterations"] = 40
        if supports_tools and tools_enabled:
            if is_operator:
                # Operator persona: browse-all catalogue. Ignore any frontend tool
                # filter — fetch the full surface to build the load index, then hand
                # the model only the hot core (catalogue + load). It browses and
                # loads the rest on demand.
                full_tools = await self.get_universal_tools(user_id, infospace_id, api_keys)
                schema_by_name = {t.get("name"): t for t in full_tools if t.get("name")}
                tools = [dict(t) for t in C.HOT_CORE_TOOLS]
                # Sticky scenario: if a prior turn loaded one, re-preload its tools now so
                # the model just acts instead of re-loading (the crux only expands mid-turn).
                active_scenario = C.active_scenario_from_messages(messages)
                if active_scenario:
                    extra, _ = C.resolve_load(list(active_scenario.tools), None, schema_by_name)
                    have = {t.get("name") for t in tools}
                    tools += [t for t in extra if t.get("name") not in have]
                logger.info(
                    f"Operator: {len(schema_by_name)} operations catalogued, hot core = {len(tools)} tools"
                    + (f" (+scenario '{active_scenario.name}')" if active_scenario else "")
                )
            elif tools is not None and len(tools) > 0:
                logger.info(f"Using {len(tools)} filtered tools provided by frontend")
            else:
                tools = await self.get_universal_tools(user_id, infospace_id, api_keys)
                logger.info(f"Fetched {len(tools)} tools from MCP server")

        else:
            tools = None

        # Cache the tool surface. It is large (full MCP schemas) and byte-identical
        # across every tool-loop iteration AND every conversation turn, so it is the
        # single biggest stable prefix in chat. A marker on the LAST tool caches the
        # whole tool block on Anthropic (prefix order is tools → system → messages);
        # OpenAI/Ollama rebuild tool dicts and drop the key, so this is a safe no-op
        # there (OpenAI caches stable prefixes automatically regardless).
        if tools:
            tools[-1] = {**tools[-1], "cacheable": True}

        infospace = self.session.get(Infospace, infospace_id)
        if is_operator:
            system_context = self._build_operator_context(infospace, active_scenario, current_route, current_focus)
        else:
            system_context = self._build_infospace_context(infospace)

        context_messages = [{"role": "system", "content": system_context}] + messages

        logger.info(
            f"Intelligence chat: user={user_id}, infospace={infospace_id}, model={model_name}, tools={len(tools) if tools else 0}, supports_tools={supports_tools}"
        )

        # Operator intercepts the hot-core tools locally (catalogue/load); anything
        # it loads routes through the normal MCP path, which re-gates via each
        # operation's declared `requires`.
        if is_operator:
            operator_access = resolve_access_capped(
                self.session, infospace_id, self.session.get(User, user_id)
            )

            async def _tool_executor(name, args):
                if name == "catalogue":
                    return self._op_catalogue(args, operator_access, infospace_id)
                if name == "load":
                    return self._op_load(args, schema_by_name)
                if name == "inspect":
                    return self._op_inspect(args, messages)
                if name == "navigate":
                    return self._op_navigate(args)
                return await self.execute_tool_call(
                    name, args, user_id, infospace_id, api_keys, conversation_id
                )
        else:
            def _tool_executor(name, args):
                return self.execute_tool_call(
                    name, args, user_id, infospace_id, api_keys, conversation_id
                )

        # One call. The engine owns the retries.
        #
        # This used to be followed by ~60 lines of fallback: catch the exception,
        # string-match the provider's error text for "does not support tools" or
        # "does not support temperature", and re-issue a narrower request. That
        # is a provider concern that had leaked into a service — it could only
        # ever recognise the wordings someone had already seen, and every new
        # endpoint needed its own. It now lives in the engine as retry steps
        # driven by quirks.
        return await provider_instance.generate(
            messages=context_messages,
            model_name=model_name,
            tools=tools,
            stream=stream,
            thinking_enabled=thinking_enabled,
            tool_executor=_tool_executor,
            options=GenerationOptions(
                # The endpoint reaches our MCP server with this, where the `mcp`
                # feature is attached and a server URL is configured; otherwise
                # our own executor runs every tool and the header is unused.
                mcp_headers={"Authorization": f"Bearer {context_token}"},
                **kwargs,
            ),
        )

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
</workspace>

<instructions>
Tool results display: After executing a tool, reference with <tool_results tool="name" />
The UI will render rich interactive results at that marker.

Pick the entry point by task type — do NOT default to workspace_hub() for everything:
• Browse/explore the workspace tree   → workspace_hub()
• Edit, create, inspect a SCHEMA      → analysis_hub(operation="schema.list" | "schema.get" | "schema.update" | "schema.create")
• Start or inspect an annotation RUN  → analysis_hub(operation="run.start" | "run.list" | "run.dashboard")
• Organize assets into bundles        → library_hub(operation="collection.create" | "collection.add")
• Research the web                    → web_research(query=..., ingest_urls=[...])
• Remember user context               → working_memory()

Schemas are NOT assets — workspace_hub() will not find them. Use analysis_hub for anything schema-related.

Minimum call plans (plan the path mentally BEFORE the first tool call):
• Schema edit: schema.list → schema.get(id) → schema.update(id, output_contract=...)   (3 calls)
• Schema create: analysis_hub(op="schema.create", schema_name, output_contract)          (1 call)
• Run start: analysis_hub(op="run.start", schema_id, asset_ids)                          (1 call)
• Asset browse: workspace_hub(mode="search", query=..., depth="previews")                     (1 call)
• Asset load for editing: workspace_hub(mode="view", node_id=..., depth="full")               (1 call)

If the minimum path isn't obvious from the request, ask ONE clarifying question instead
of exploring. This is not the same as asking permission for a clear task — it's avoiding
wrong actions on ambiguous intent. Example: user says "schreib sie rein" (write them in) —
if it's unclear whether they mean "list them for review" vs "commit to the schema", ask.

Efficient navigation patterns (CRITICAL - prevents iteration limits):
• SEARCH FIRST, don't walk the tree: workspace_hub(resource="assets", mode="search", query="topic", depth="previews")
• Direct bundle access: workspace_hub(mode="view", node_id="bundle-123", depth="previews") to see contents
• Batch operations: tasks(operation="batch", actions=[...]) instead of individual calls

⚠️ NEVER use depth="full" for search/list - use "previews" for browsing, "full" only when editing specific documents

Common anti-patterns that cause iteration limits:
❌ Using workspace_hub() to find schemas or runs (use analysis_hub)
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
• CSVs: workspace_hub(mode="view") for preview, paginate with mode="list" for more
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
</instructions>

<now>Current: {current_datetime}</now>"""
        return context

    # ── Operator persona: hot-core tool handlers + prompt ────────────────────

    def _op_catalogue(self, args: Optional[Dict[str, Any]], access, infospace_id: int) -> Dict[str, Any]:
        """Operator hot-core: browse the gated catalogue + read docs (act-then-show)."""
        a = args or {}
        path = a.get("path")
        query = a.get("query")

        # Docs branch: path == "docs" lists; "docs/<slug>" reads one.
        if path and (path == "docs" or path.startswith("docs/")):
            if path == "docs":
                docs = C.list_docs()
                body = "Docs:\n" + "\n".join(f"- docs/{d['path']} — {d['title']}" for d in docs)
                return {"content": body, "structured_content": {"kind": "catalogue", "docs": docs}}
            slug = path[len("docs/"):]
            doc = C.read_doc(slug)
            if doc is None:
                return {"content": f"No doc at {path}.",
                        "structured_content": {"kind": "catalogue", "error": "doc_not_found", "path": path}}
            return {"content": doc, "structured_content": {"kind": "doc", "path": path}}

        # Operations branch (gated + provisioning-annotated).
        ops = C.browse(access, self.session, infospace_id, path)
        if query:
            q = query.lower()
            ops = [o for o in ops if q in o["path"].lower() or q in o["summary"].lower()]
        lines = []
        for o in ops:
            flag = f"   ⚠ needs: {', '.join(o['needs_setup'])}" if o["needs_setup"] else ""
            lines.append(f"- {o['path']} ({o['name']}) — {o['summary']}{flag}")
        docs = C.list_docs()
        doc_lines = "\n".join(f"- docs/{d['path']} — {d['title']}" for d in docs)
        # Scenarios lead: for a known journey, one load(scenario=…) beats browsing.
        scenarios = C.list_scenarios()
        scenario_lines = "\n".join(f"- {s['name']} — {s['summary']}" for s in scenarios)
        content = (
            "Scenarios — a whole journey in one call (instructions + tools + a prefilled "
            "playbook); load(scenario='<name>'):\n" + scenario_lines
            + "\n\nOperations — call load(tools=[name,…]) to use them this turn:\n"
            + "\n".join(lines)
            + "\n\nDocs — catalogue(path='docs/<slug>') to read:\n" + doc_lines
        )
        return {"content": content,
                "structured_content": {"kind": "catalogue", "operations": ops,
                                       "docs": docs, "scenarios": scenarios}}

    def _op_load(self, args: Optional[Dict[str, Any]], schema_by_name: Dict[str, Any]) -> Dict[str, Any]:
        """Operator hot-core: load operations/sets/a scenario into the tool set for THIS turn.

        Returns the ``_load_tools`` sentinel the engine's turn loop consumes to
        extend the model's available tools mid-turn — see ``Turn.with_tools`` in
        foundation_service_providers/language/. Works on every dialect now; it
        used to be reimplemented per provider.
        A scenario additionally hands back its playbook and stays sticky across
        turns (derived from history by ``active_scenario_from_messages``).
        """
        a = args or {}

        scenario = a.get("scenario")
        if scenario:
            schemas, playbook, unknown = C.resolve_scenario_load(scenario, schema_by_name)
            if unknown or not schemas:
                names = ", ".join(s["name"] for s in C.list_scenarios())
                return {"content": f"Unknown scenario '{scenario}'. Available: {names}.",
                        "structured_content": {"kind": "scenario", "error": "unknown_scenario",
                                               "available": [s["name"] for s in C.list_scenarios()]}}
            loaded = [s.get("name") for s in schemas]
            msg = (f"Loaded scenario '{scenario}' — its tools are ready and it stays active. "
                   f"Follow the playbook; fill every <placeholder> with the specifics.\n\n{playbook}")
            return {"content": msg,
                    "structured_content": {"kind": "scenario", "scenario": scenario, "loaded": loaded},
                    "_load_tools": schemas}

        schemas, unknown = C.resolve_load(a.get("tools"), a.get("sets"), schema_by_name)
        loaded = [s.get("name") for s in schemas]
        msg = f"Loaded: {', '.join(loaded) or '(none)'}. Call them directly now."
        if unknown:
            msg += f" Unknown (not loaded — browse the catalogue): {', '.join(unknown)}."
        return {"content": msg,
                "structured_content": {"kind": "load", "loaded": loaded, "unknown": unknown},
                "_load_tools": schemas}

    def _op_navigate(self, args: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Operator hot-core: route the main view to an HQ page (act-then-show).

        Pure UI — no backend side effect. It just emits a ``navigate`` UI directive that
        the frontend command bus turns into a client-side ``router.push``; the floating
        operator stays put on top. Destinations are a curated allow-list so the model
        can't route to an arbitrary/invalid path.
        """
        routes = {
            "home": "/hq",
            "assets": "/hq/infospaces/asset-manager",
            "asset-manager": "/hq/infospaces/asset-manager",
            "explore": "/hq/infospaces/explore",
            "runs": "/hq/infospaces/annotation-runner",
            "annotation-runner": "/hq/infospaces/annotation-runner",
            "schemas": "/hq/infospaces/annotation-schemes",
            "packages": "/hq/infospaces/packages",
            "flows": "/hq/infospaces/flows",
            "enrichment": "/hq/infospaces/enrichment",
            "infospaces": "/hq/infospaces/infospace-manager",
            "infospace-manager": "/hq/infospaces/infospace-manager",
        }
        dest = str((args or {}).get("destination", "")).strip().lower()
        to = routes.get(dest)
        if not to:
            opts = sorted(set(routes.keys()))
            return {"content": f"❌ Unknown destination '{dest}'. Options: {opts}",
                    "structured_content": {"error": "unknown_destination", "options": opts}}
        # Optional pre-seed: an AQL query for the Content Explorer. It rides in the URL
        # (?q=…) so it survives a full page load; the explore page auto-runs it on land.
        query = (args or {}).get("query")
        run_id = (args or {}).get("run_id")
        # Stage a text-vs-semantic chooser instead of searching directly — only when the
        # operator judges semantic could yield more. The inline form runs the search with
        # the picked mode. Default is text; semantic prefixes the query with `~`.
        if (args or {}).get("ask_mode") and dest == "explore" and query:
            import uuid as _uuid
            token = f"searchmode-{_uuid.uuid4().hex[:12]}"
            return {"content": f"⏸ How should I search for `{query}` — text or semantic? Choose below.",
                    "structured_content": {"staged": True, "ui_directive": {
                        "command": "stage_search_mode",
                        "payload": {"query": str(query), "path": to},
                        "await_return": True, "return_token": token,
                    }}}
        seeded = ""
        ui_directive: Any = {"command": "navigate", "payload": {"to": to}}
        if query and dest == "explore":
            from urllib.parse import quote
            to = f"{to}?q={quote(str(query))}"
            seeded = f" with query `{query}`"
            ui_directive = {"command": "navigate", "payload": {"to": to}}
        # Open a specific run's dashboard on the Annotation Runner — the LIGHTWEIGHT,
        # reliable way to "open a run" (no heavy data fetch). navigate lands the page;
        # runner:open selects the run (fetching it if needed, even if already there).
        if run_id is not None and dest in ("runs", "annotation-runner"):
            try:
                rid = int(run_id)
                to = f"{to}?runId={rid}"
                seeded = f" (run #{rid})"
                ui_directive = [
                    {"command": "navigate", "payload": {"to": to}},
                    {"command": "runner:open", "payload": {"run_id": rid}},
                ]
            except (ValueError, TypeError):
                pass
        return {"content": f"→ Opened {dest} in the main view{seeded}.",
                "structured_content": {
                    "destination": dest, "path": to,
                    "ui_directive": ui_directive,
                }}

    def _op_inspect(self, args: Optional[Dict[str, Any]], messages: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Operator hot-core: pull the FULL payload of a prior tool result into context.

        Cross-turn, the provider replays only each tool's bounded ``model_view`` — the
        full ``structured_content`` is carried in history but not surfaced to the model.
        This resolves a handle (exact tool-execution id) or the most-recent call of a
        named tool, and returns its full payload, optionally sliced by a dotted path.
        Act-then-show. In-flight (same-turn) results aren't in history yet — the model
        just saw those; this is for earlier turns.
        """
        a = args or {}
        handle = a.get("handle")
        tool = a.get("tool")
        path = a.get("path")

        target = None
        for msg in reversed(messages or []):
            if not isinstance(msg, dict) or msg.get("role") != "assistant":
                continue
            for ex in reversed(msg.get("tool_executions") or []):
                if handle and str(ex.get("id")) == str(handle):
                    target = ex
                    break
                if tool and not handle and ex.get("tool_name") == tool:
                    target = ex
                    break
            if target:
                break

        if target is None:
            ref = handle or tool or "(nothing specified)"
            return {"content": f"No prior result found for {ref}. Pass tool=<operation name> or a handle.",
                    "structured_content": {"kind": "inspect", "error": "not_found", "ref": ref}}

        payload = target.get("structured_content")
        if payload is None:
            payload = target.get("result")
        if payload is None:
            payload = target.get("model_view")

        value = payload
        if path:
            try:
                for part in path.split("."):
                    if isinstance(value, list):
                        value = value[int(part)]
                    elif isinstance(value, dict):
                        value = value.get(part)
                    else:
                        value = None
                        break
            except (ValueError, IndexError, TypeError):
                value = None

        body = json.dumps(value, ensure_ascii=False, default=str)
        truncated = len(body) > 8000
        if truncated:
            body = body[:8000] + " …(truncated — narrow with a path=)"
        head = f"{target.get('tool_name')} [{target.get('id')}]" + (f" · {path}" if path else "")
        return {"content": f"{head}:\n{body}",
                "structured_content": {"kind": "inspect", "handle": target.get("id"),
                                       "tool": target.get("tool_name"), "path": path,
                                       "truncated": truncated, "value": value}}

    def _build_operator_context(self, infospace: Infospace, active_scenario=None,
                                current_route: Optional[str] = None,
                                current_focus: Optional[Dict[str, Any]] = None) -> str:
        """The ONE operator persona: the static manual (prompts/operator.md, a
        cacheable prefix) + a small volatile workspace block + (if a scenario is
        active) a concise journey header. The full playbook lives in history (the
        load result); this header just keeps the model oriented every turn."""
        from pathlib import Path
        now = datetime.now(timezone.utc).strftime("%A, %B %d, %Y at %H:%M UTC")
        safe_name = (infospace.name or "").replace("{", "{{").replace("}", "}}")
        route = (current_route or "").replace("{", "{{").replace("}", "}}")
        prompt_path = Path(__file__).resolve().parents[1] / "prompts" / "operator.md"
        try:
            manual = prompt_path.read_text(encoding="utf-8")
        except OSError as e:
            logger.warning(f"operator prompt missing: {e}; using inline fallback")
            manual = (
                "You are the HQ operator. You start with only `catalogue` and `load`. "
                "Browse the catalogue, load what you need, then act. Read a doc "
                "(catalogue path='docs/<slug>') before a multi-step build."
            )
        where = f" · user is on {route}" if route else ""
        # The entity the user has open/focused. Grounds "this run/dashboard/bundle" so
        # the operator acts on it directly instead of re-listing and asking which.
        focus_note = ""
        if isinstance(current_focus, dict) and str(current_focus.get("kind")) == "explore":
            # The Content Explorer is the open surface — searching means driving the
            # query bar (navigate), not a workspace_hub search that dumps rows in chat.
            q = str(current_focus.get("query") or "").strip().replace("{", "{{").replace("}", "}}")
            if q:
                focus_note = (
                    f" · the Content Explorer is OPEN showing query `{q}`. To search, SET THE QUERY "
                    f"BAR via navigate(destination=\"explore\", query=…) — do NOT run a workspace_hub "
                    f"search. Default to plain TEXT search (no ~). To bundle these results: load "
                    f"library_hub → collection.create(source_query=\"{q}\")."
                )
            else:
                focus_note = (
                    " · the Content Explorer is OPEN. Search by setting the query bar: "
                    "navigate(destination=\"explore\", query=…) with plain TEXT (no ~) — do NOT run a "
                    "workspace_hub search."
                )
        elif isinstance(current_focus, dict) and current_focus.get("id") is not None:
            raw_kind = str(current_focus.get("kind") or "item")
            kind = raw_kind.replace("{", "{{").replace("}", "}}")
            fid = current_focus.get("id")
            fname = str(current_focus.get("name") or "").replace("{", "{{").replace("}", "}}")
            label = f'{kind} #{fid}' + (f' "{fname}"' if fname else "")
            focus_note = (
                f" · the user has {label} OPEN and in focus — when they say \"this {kind}\" "
                f"(or \"this run/dashboard/bundle/analysis\") they mean {label}. Act on it directly; "
                f"do NOT list options and ask which one."
            )
            # For a run, fold its schema fields (+ which have data) in so the operator can
            # pick panel axes WITHOUT a round-trip to run.dashboard.
            if raw_kind == "run":
                try:
                    focus_note += self._focus_schema_fields(infospace, int(fid))
                except (ValueError, TypeError):
                    pass
        ctx = manual + f"\n\n<workspace>\"{safe_name}\" — current: {now}{where}{focus_note}</workspace>"
        if active_scenario is not None:
            phases = " → ".join(f"{i}·{p.label}" for i, p in enumerate(active_scenario.phases, 1))
            ctx += (
                f"\n\n<active-scenario name=\"{active_scenario.name}\">"
                f"\nYou are running the '{active_scenario.name}' arc; its tools are already loaded "
                f"(don't re-browse for these steps). Follow the playbook you loaded — phases: {phases}. "
                f"Work them in order, pausing at each reflection stop."
                f"\n</active-scenario>"
            )
        return ctx

    def _focus_schema_fields(self, infospace: Infospace, run_id: int) -> str:
        """A compact list of the run's schema field paths, for the operator to pick
        panel axes from without a round-trip. Empty string if unavailable."""
        try:
            from app.models import AnnotationRun
            run = self.session.get(AnnotationRun, run_id)
            if not run or run.infospace_id != infospace.id:
                return ""
            leaves: list[str] = []
            arrays: list[str] = []
            for sch in (getattr(run, "target_schemas", None) or []):
                _enumerate_schema_paths(getattr(sch, "output_contract", None) or {}, "", leaves, arrays)
            paths = list(dict.fromkeys(leaves))        # dedup, keep order
            groups = list(dict.fromkeys(arrays))
            if not paths:
                return ""
            shown = ", ".join(paths[:40])
            more = f" (+{len(paths) - 40} more)" if len(paths) > 40 else ""
            note = f" Its schema fields — use these for panel axes: {shown}{more}."
            if groups:
                note += f" Array groups (graph source / explode / nested tables): {', '.join(g + '[*]' for g in groups[:8])}."
            # Which TOP-LEVEL fields actually have data (sampled) — so panels aren't built
            # on empty fields (a common cause of blank panels).
            populated = self._focus_populated_fields(run_id)
            if populated:
                note += (
                    f" Top-level fields WITH DATA (prefer these for axes/pie): "
                    f"{', '.join('document.' + p for p in sorted(populated)[:20])}."
                )
            # No braces in field paths, but guard against .format() downstream anyway.
            return note.replace("{", "{{").replace("}", "}}")
        except Exception as e:
            logger.debug(f"_focus_schema_fields failed for run {run_id}: {e}")
            return ""

    def _focus_populated_fields(self, run_id: int) -> set:
        """Top-level `document.*` field names that carry data in a sample of the run's
        (non-failed) annotations — so the operator prefers fields that render."""
        try:
            from sqlmodel import text as _text
            rows = self.session.exec(_text(
                "SELECT value FROM annotation WHERE run_id = :rid "
                "AND LOWER(status::text) <> 'failed' LIMIT 25"
            ).bindparams(rid=run_id)).all()
            populated: set = set()
            for r in rows:
                val = r[0]
                if isinstance(val, str):
                    try:
                        val = json.loads(val)
                    except (ValueError, TypeError):
                        val = None
                # Values are usually stored unwrapped (fields at the root); some wrap in
                # a `document` object. Handle both — the `document.` path prefix is logical.
                doc = val
                if isinstance(val, dict) and isinstance(val.get("document"), dict):
                    doc = val["document"]
                if isinstance(doc, dict):
                    for k, v in doc.items():
                        if v not in (None, "", [], {}):
                            populated.add(k)
            return populated
        except Exception as e:
            logger.debug(f"_focus_populated_fields failed for run {run_id}: {e}")
            return set()

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
        from app.api.modules.foundation_service_providers import LLMModelSpec

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
