"""
The operation catalogue — the model's browsable surface of what it can do.

`@operation` is the structural twin of `@task` (``app/core/tasks.py``): one
declaration per MCP tool that records the metadata everything else derives
from — where the tool lives in the catalogue (``path``), what access
capability it needs (``requires``), what provider capability it depends on
(``needs``), its write posture, and a one-line summary. The module-level
``_operation_registry`` it populates **is** the catalogue index that
``conversation_service`` browses, gates, and provisions.

Naming, deliberately: ``requires`` are ``Capability`` access grants
(organize/ingest/compute/…); ``needs`` are provider capabilities
("language", "web_search", "embedding", …). We avoid the word *capability*
on the decorator itself — it already means two different things here.

The decorator **wraps** FastMCP: it delegates registration to ``mcp.tool(...)``
and keeps our metadata in the registry. ``make_operation(mcp)`` binds the
decorator to a server instance so this module never imports ``server`` — the
dependency stays one-directional (server → catalogue).
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable

from app.api.modules.identity_infospace_user.access import Capability


# ── Descriptor + registry ────────────────────────────────────────────────────

@dataclass(frozen=True)
class OperationDescriptor:
    """Everything the catalogue needs to know about one tool. One per @operation."""
    name: str                                # registry key == fn.__name__ == tool name
    path: str                                # catalogue path, e.g. "structure/run/start"
    requires: tuple[Capability, ...] = ()    # access gate (intersected with the deploy ceiling)
    needs: tuple[str, ...] = ()              # provider capabilities to surface / provision
    posture: str = "show"                    # "show" (act-then-show) | "confirm" (stage-then-confirm)
    summary: str = ""                        # one-line, for browse + model-facing projection
    hidden: bool = False                     # keep out of the operator's catalogue (not-ready surfaces, e.g. formulas)


_operation_registry: dict[str, OperationDescriptor] = {}


def get_operation_registry() -> dict[str, OperationDescriptor]:
    """The catalogue index. Populated as ``server.py``'s tools are imported."""
    return _operation_registry


def descriptor_for(name: str) -> OperationDescriptor | None:
    return _operation_registry.get(name)


def requires_for(name: str) -> tuple[Capability, ...]:
    """Access capabilities a tool declares, for the execution gate. () if unknown."""
    desc = _operation_registry.get(name)
    return desc.requires if desc else ()


# ── The decorator (bound to a FastMCP instance) ──────────────────────────────

def make_operation(mcp) -> Callable:
    """Return the ``@operation`` decorator bound to a FastMCP server.

    Called once in ``server.py`` (``operation = make_operation(mcp)``) so this
    module never imports ``server`` — the dependency stays one-directional.
    """
    def operation(
        *,
        path: str,
        requires: tuple[Capability, ...] = (),
        needs: tuple[str, ...] = (),
        posture: str = "show",
        summary: str = "",
        tags: list[str] | None = None,
        hidden: bool = False,
    ) -> Callable:
        def decorator(fn: Callable) -> Callable:
            name = fn.__name__
            _operation_registry[name] = OperationDescriptor(
                name=name,
                path=path,
                requires=tuple(requires),
                needs=tuple(needs),
                posture=posture,
                summary=summary,
                hidden=hidden,
            )
            # Delegate registration to FastMCP; our metadata rides the registry.
            # ``meta=`` is a best-effort pass-through (some FastMCP versions
            # reject it) — the registry, not ``meta``, is authoritative.
            meta = {"path": path, "requires": [c.value for c in requires]}
            try:
                deco = mcp.tool(tags=tags or [], meta=meta)
            except TypeError:
                deco = mcp.tool(tags=tags or [])
            return deco(fn)
        return decorator
    return operation


# ── Convenience sets ─────────────────────────────────────────────────────────
#
# Named multi-load shortcuts over the catalogue. Pure convenience — no
# authorship, no params, no weight (settled decision). Each value is a tuple of
# operation names ``load`` resolves to schemas in one call. Filled out in A4 as
# the workflow arcs settle.

SETS: dict[str, tuple[str, ...]] = {
    # Multi-load shortcuts over the catalogue. Grow as the workflow arcs settle.
    "web_intake": ("web_research", "library_hub"),
    "monitor": ("library_hub", "sources_hub", "analysis_hub"),  # bundle → recurring source → live run
    "structure": ("analysis_hub",),
    "visualize": ("analysis_hub",),  # panels via analysis_hub(panel.*); formulas are not operator-facing
}


# ── Scenarios ────────────────────────────────────────────────────────────────
#
# A scenario is a loadable *operation program* — the highest-order thing in the
# catalogue. It doesn't own a doc or a tool set; it COMPOSES them (settled
# decision A: composition, not a runnable doc). `load(scenario="monitor")` hands
# the model three things in one call, collapsing the browse→load→act discovery
# loop into a single move:
#     • INSTRUCTION — the referenced doc's prose (language still lives in docs.md)
#     • TOOLS       — the referenced ops, preloaded via the _load_tools crux
#     • PLAYBOOK    — phased, prefilled call TEMPLATES with reflection gates
# Loading one also makes it *sticky*: `active_scenario_from_messages` derives the
# active scenario from history (no new state, no migration), so every later turn
# re-prefixes the journey and re-preloads its tools. The model fills the
# <placeholders> and fires each phase; the reflection stops are hard pauses.

@dataclass(frozen=True)
class Phase:
    """One step of a scenario: a reflection gate + a batch of call templates."""
    label: str
    calls: tuple[dict, ...]     # each: {"tool", "args" (prefilled, <placeholder>), "note"}
    reflect: str = ""           # a reflection-stop shown BEFORE this phase; "" = proceed


@dataclass(frozen=True)
class Scenario:
    name: str
    summary: str
    doc: str                    # slug into docs.md — the instruction (language stays there)
    tools: tuple[str, ...]      # catalogue op names to preload
    phases: tuple[Phase, ...]


def _call(tool: str, note: str = "", **args: Any) -> dict:
    """Readable call-template constructor for the SCENARIOS literal."""
    return {"tool": tool, "args": args, "note": note}


SCENARIOS: dict[str, Scenario] = {
    # A live monitoring operation. The canonical arc: seed → sources → structure →
    # live run → dashboard. HQ's pollers keep it producing once set up.
    "monitor": Scenario(
        name="monitor",
        summary="Stand up a live monitoring operation on a topic/country: seed a bundle, "
                "add recurring sources, code a schema, start a live run, land a dashboard.",
        doc="monitoring",
        tools=("library_hub", "web_research", "sources_hub", "analysis_hub"),
        phases=(
            Phase(
                "Frame & seed the bundle",
                calls=(
                    _call("library_hub", "creates the destination bundle — note its id",
                          operation="collection.create", name="<Topic> Monitor"),
                    _call("web_research", "seeds the bundle NOW so the run has data immediately",
                          query="<topic> — latest political & economic developments",
                          ingest_top_k=5, bundle_id="<bundle id from above>"),
                ),
            ),
            Phase(
                "Recurring sources — staged, the user confirms each",
                reflect="Read the initial sweep. Is the topic well-covered? Which recurring "
                        "RSS feeds or standing searches would keep this bundle fresh? Propose "
                        "only those. Before a web_search source, check the catalogue shows no "
                        "needs_setup: ['web_search']; if it does, offer RSS-only.",
                calls=(
                    _call("sources_hub", "recurring RSS feed → the bundle",
                          operation="create", kind="rss", name="<Outlet> feed",
                          details={"feed_url": "<url>"}, poll_interval_seconds=3600,
                          output_bundle_id="<bundle id>"),
                    _call("sources_hub", "standing web search (only if a provider is configured)",
                          operation="create", kind="web_search", name="<Topic> search",
                          details={"query": "<topic>"}, poll_interval_seconds=21600,
                          output_bundle_id="<bundle id>"),
                ),
            ),
            Phase(
                "Structure, go live & open the dashboard",
                reflect="Sources confirmed. Now code exactly what the question needs — tight, "
                        "one field per question (see the schemas doc).",
                calls=(
                    _call("analysis_hub", "co-author the coding schema INLINE — the user shapes & confirms it",
                          operation="schema.stage", schema_name="<Topic> coding",
                          schema_fields=[{"name": "sentiment", "type": "enum",
                                          "options": ["negative", "neutral", "positive"],
                                          "description": "overall stance of the item toward <topic>"}]),
                    _call("analysis_hub", "LIVE + opens the dashboard (auto-adds a Results Table as rows land)",
                          operation="run.start", schema_id="<schema id>",
                          source_bundle_id="<bundle id>", live=True),
                ),
            ),
        ),
    ),
    # The SAME machine as monitor — the comparison lives in the SCHEMA (an outlet
    # field + a framing enum on one mixed bundle), never in separate sources.
    # Proves the operation layer isn't special-cased per task.
    "compare-framing": Scenario(
        name="compare-framing",
        summary="Compare how outlets frame a topic: one mixed bundle, a schema that codes "
                "outlet + framing lean, then panels that split by them.",
        doc="schemas",
        tools=("library_hub", "web_research", "sources_hub", "analysis_hub"),
        phases=(
            Phase(
                "Bundle & seed a MIXED corpus",
                calls=(
                    _call("library_hub", "one bundle holds all outlets — do NOT split by outlet here",
                          operation="collection.create", name="<Topic> Framing"),
                    _call("web_research", "pull a deliberate MIX of outlets across the spectrum",
                          query="<topic> coverage", ingest_top_k=8, bundle_id="<bundle id>"),
                ),
            ),
            Phase(
                "Framing schema — the comparison is coded here",
                reflect="You have a mixed corpus. The comparison lives in the SCHEMA: an "
                        "`outlet` field + a `framing_lean` enum — NOT in separate bundles. "
                        "Extract facts; don't bake the verdict into the field.",
                calls=(
                    _call("analysis_hub", "co-author the outlet + framing schema INLINE — user confirms it",
                          operation="schema.stage", schema_name="<Topic> framing",
                          schema_fields=[
                              {"name": "outlet", "type": "text", "description": "publishing outlet"},
                              {"name": "framing_lean", "type": "enum",
                               "options": ["left", "center", "right"],
                               "description": "editorial lean evident in the framing"},
                              {"name": "stance", "type": "enum",
                               "options": ["supportive", "neutral", "critical"],
                               "description": "stance toward <topic>"},
                          ]),
                    _call("analysis_hub", "annotate the mixed bundle + open the dashboard",
                          operation="run.start", schema_id="<schema id>",
                          source_bundle_id="<bundle id>", live=True),
                ),
            ),
        ),
    ),
}


def list_scenarios() -> list[dict]:
    """Name + one-line summary for each scenario (for the catalogue top level)."""
    return [{"name": s.name, "summary": s.summary} for s in SCENARIOS.values()]


def get_scenario(name: str) -> Scenario | None:
    return SCENARIOS.get(name)


def _fmt_args(args: dict) -> str:
    parts = []
    for k, v in args.items():
        parts.append(f'{k}="{v}"' if isinstance(v, str) else f"{k}={json.dumps(v)}")
    return ", ".join(parts)


def render_scenario_playbook(sc: Scenario) -> str:
    """The journey instruction: the doc's prose + the phased, prefilled playbook.

    This is what `load(scenario=…)` hands back and what the sticky context re-injects.
    """
    doc_body = read_doc(sc.doc) or ""
    lines = [
        doc_body, "",
        f"## Playbook — {sc.name}",
        "Work the phases in order. Within a phase, fire the calls as one parallel batch "
        "where the inputs allow, filling every <placeholder> with the specifics. At a "
        "reflection stop, PAUSE — review what came back, then continue. Sources and "
        "schemas are staged for inline confirmation (you get a <form_result> when the "
        "user commits); everything else executes when you call it.",
    ]
    for i, ph in enumerate(sc.phases, 1):
        lines.append("")
        if ph.reflect:
            lines.append(f"— reflection stop — {ph.reflect}")
        lines.append(f"Phase {i} · {ph.label}")
        for c in ph.calls:
            note = f"   — {c['note']}" if c.get("note") else ""
            lines.append(f"   {c['tool']}({_fmt_args(c['args'])}){note}")
    return "\n".join(lines)


def resolve_scenario_load(name: str, schema_by_name: dict) -> tuple[list[dict], str, list[str]]:
    """Resolve a scenario → (tool schemas for _load_tools, playbook text, unknown[name])."""
    sc = SCENARIOS.get(name)
    if not sc:
        return [], "", [name]
    schemas, unknown = resolve_load(list(sc.tools), None, schema_by_name)
    return schemas, render_scenario_playbook(sc), unknown


def _load_scenario_arg(ex: dict) -> str | None:
    """Pull a `scenario` arg off a recorded `load` tool call/execution, if any."""
    if not isinstance(ex, dict):
        return None
    name = ex.get("tool_name") or (ex.get("function") or {}).get("name") or ex.get("name")
    if name != "load":
        return None
    args = ex.get("arguments")
    if args is None:
        args = (ex.get("function") or {}).get("arguments") or {}
    if isinstance(args, str):
        try:
            args = json.loads(args)
        except (ValueError, TypeError):
            return None
    return args.get("scenario") if isinstance(args, dict) else None


def active_scenario_from_messages(messages) -> Scenario | None:
    """Derive the active scenario from history — the most recent `load(scenario=…)`.

    Stateless: the conversation history already carries the load call, so the
    scenario stays sticky (instruction re-prefixed, tools re-preloaded every turn)
    with no extra state and no migration.
    """
    for msg in reversed(messages or []):
        if not isinstance(msg, dict) or msg.get("role") != "assistant":
            continue
        execs = list(msg.get("tool_executions") or []) + list(msg.get("tool_calls") or [])
        for ex in reversed(execs):
            scenario = _load_scenario_arg(ex)
            if scenario and scenario in SCENARIOS:
                return SCENARIOS[scenario]
    return None


# ── Browse · load · docs ─────────────────────────────────────────────────────

def browse(access, session, infospace_id: int, path: str | None = None) -> list[dict]:
    """The gated + provisioning-annotated catalogue index (operations only).

    Capability HIDES — an operation the user can't invoke (after the deployment
    ceiling) is omitted (security). Provisioning SURFACES — an operation whose
    provider isn't configured is shown with ``needs_setup`` so the operator can
    offer to set it up instead of failing later. ``path`` narrows to a subtree.
    """
    from app.api.modules.foundation_service_providers import (
        get_configured_foundation_provider,
    )

    entries: list[dict] = []
    for name, d in _operation_registry.items():
        if d.hidden:
            continue  # not operator-facing (e.g. the not-ready formula layer)
        if path and not d.path.startswith(path):
            continue
        if not access.has_all(*d.requires):
            continue  # capability hide
        needs_setup = [
            cap for cap in d.needs
            if get_configured_foundation_provider(session, infospace_id, cap) is None
        ]
        entries.append({
            "name": name,
            "path": d.path,
            "summary": d.summary,
            "posture": d.posture,
            "needs_setup": needs_setup,
        })
    return sorted(entries, key=lambda e: e["path"])


def resolve_load(names, sets, schema_by_name: dict) -> tuple[list[dict], list[str]]:
    """Resolve operation names + set names to generic tool schemas for ``_load_tools``.

    Sets expand to their members (pure convenience). Order-preserving, deduped.
    Returns ``(schemas, unknown_names)`` so the caller can report misses.
    """
    wanted: list[str] = list(names or [])
    for s in (sets or []):
        wanted.extend(SETS.get(s, ()))
    schemas, unknown, seen = [], [], set()
    for n in wanted:
        if n in seen:
            continue
        seen.add(n)
        schema = schema_by_name.get(n)
        if schema is None:
            unknown.append(n)
        else:
            schemas.append(schema)
    return schemas, unknown


# HQ-core docs: static markdown shipped in the image, read via a helper. One
# ``docs.md`` file, sections split by ``@@@ <slug>`` lines. User-authored docs
# are deferred (they'll be plain Assets the operator is pointed to) — no DB.
_DOCS_PATH = Path(__file__).resolve().parent / "docs.md"
_DOC_SPLIT = re.compile(r"(?m)^@@@[ \t]+(\S+)[ \t]*$")


def _load_docs() -> dict[str, str]:
    try:
        raw = _DOCS_PATH.read_text(encoding="utf-8")
    except OSError:
        return {}
    parts = _DOC_SPLIT.split(raw)      # [preamble, slug, body, slug, body, ...]
    it = iter(parts[1:])
    return {slug.strip(): body.strip() for slug, body in zip(it, it)}


def _doc_title(body: str) -> str:
    for line in body.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return ""


def list_docs() -> list[dict]:
    """List HQ-core docs (path + title)."""
    return [{"path": slug, "title": _doc_title(body)} for slug, body in _load_docs().items()]


def read_doc(path: str) -> str | None:
    """Return a doc's markdown body, or None if unknown."""
    return _load_docs().get(path)


# ── Hot core ─────────────────────────────────────────────────────────────────
#
# The only tools the operator receives up front. Everything else is browsed via
# ``catalogue`` and pulled in via ``load``. Generic MCP tool-schema format (the
# same shape ``get_universal_tools`` yields), so providers convert + expand them
# uniformly.

HOT_CORE_TOOLS: list[dict] = [
    {
        "type": "mcp",
        "name": "catalogue",
        "description": (
            "Browse the catalogue of operations you can perform, and read docs. "
            "catalogue() lists the top level — including SCENARIOS (one-shot journeys). "
            "catalogue(path='ingest') narrows to a subtree; catalogue(path='docs/<slug>') "
            "reads a doc. Operations are already filtered to what you're allowed to do; one "
            "marked needs:[...] has no provider configured — offer to set it up rather than "
            "assume it works. For a known journey (monitoring, framing comparison), prefer "
            "load(scenario=…) over browsing tool-by-tool."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "subtree (e.g. 'ingest', 'visualize') or 'docs/<slug>' to read a doc"},
                "query": {"type": "string", "description": "optional fuzzy filter over paths/summaries"},
            },
        },
    },
    {
        "type": "mcp",
        "name": "load",
        "description": (
            "Load operations into your tool set so you can call them THIS turn. Pass "
            "operation names (from the catalogue), named sets, and/or a scenario. A "
            "scenario is the strongest move for a known journey: load(scenario='monitor') "
            "returns its instructions + preloads all its tools + hands you a phased, "
            "prefilled playbook, and stays active on the conversation. After loading, call "
            "the operations directly — do not ask for tools you haven't loaded."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tools": {"type": "array", "items": {"type": "string"}, "description": "operation names to load"},
                "sets": {"type": "array", "items": {"type": "string"}, "description": "named sets to load (see catalogue)"},
                "scenario": {"type": "string", "description": "a scenario/journey to load (see catalogue): its instructions, tools, and a prefilled playbook, in one call"},
            },
        },
    },
    {
        "type": "mcp",
        "name": "inspect",
        "description": (
            "Pull the FULL payload of a PRIOR tool result back into context. Results come "
            "back summarized and only the summary survives to later turns — so when you need "
            "the full data (all rows, exact fields, the whole search), inspect it instead of "
            "re-running the operation. Reference it by operation name (its most recent call) "
            "via tool=, or by an exact handle= if you have one; optionally slice with a dotted "
            "path= (e.g. 'results.0.title')."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "tool": {"type": "string", "description": "operation name whose most-recent result to inspect (e.g. 'web_research')"},
                "handle": {"type": "string", "description": "exact tool-result handle, if you have one"},
                "path": {"type": "string", "description": "optional dotted path into the payload to slice (e.g. 'items.0.url')"},
            },
        },
    },
    {
        "type": "mcp",
        "name": "navigate",
        "description": (
            "Take the user to an HQ page in the main view — you (the operator) stay with "
            "them; only the page behind you changes. Use it to bring them where the work "
            "is: after finding assets, open the Asset Manager; open the Content Explorer to "
            "query the corpus; the Annotation Runner to review runs. "
            "destination is one of: home | assets | explore | runs | schemas | "
            "packages | flows | enrichment | infospaces. For 'explore' "
            "you can pass an AQL `query` to pre-run (e.g. 'kind:pdf ~corruption after:2023'). "
            "For 'runs' pass a `run_id` to OPEN that run's dashboard directly — the "
            "lightweight way to show a run (no data fetch)."
        ),
        "parameters": {
            "type": "object",
            "properties": {
                "destination": {"type": "string", "description": "which page to open (see the list above)"},
                "query": {"type": "string", "description": "explore only: an AQL query to pre-run (text, ~semantic, kind:, tag:, bundle:, after:/before:, entity:, annotation:)"},
                "run_id": {"type": "integer", "description": "runs only: open this run's dashboard on the Annotation Runner"},
                "ask_mode": {"type": "boolean", "description": "explore only: instead of searching directly, show the user a Text-vs-Semantic chooser for this query. Use ONLY when semantic search could plausibly yield more (conceptual/topical asks) — not for exact terms/names."},
            },
            "required": ["destination"],
        },
    },
]
