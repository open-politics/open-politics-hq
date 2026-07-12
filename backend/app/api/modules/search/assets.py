"""Asset search composition — single entry-point for ``/search/assets``.

Two shapes over one query:

* ``search_assets``        — drained envelope (JSON).
* ``stream_search_assets`` — progressive ``StreamEvent`` generator (SSE).

Both build the same ``AssetQuery`` via ``_build_search_query``. The query is
clamped by ``Access.scope`` unconditionally; scope hints from the request are
user-visible filters, not access grants.
"""

from __future__ import annotations

import logging
from typing import AsyncIterator

from sqlmodel import Session

from app.api.modules.content.query import AssetQuery, parse as parse_aql, rank_bundles
from app.api.modules.content.schemas import (
    AssetMatch,
    AssetNode,
    AssetSearch,
    AssetSearchRequest,
    ParsedQuery,
    StreamEvent,
)
from app.api.modules.content.views import _bundle_node, collect_search, render_search
from app.api.modules.content.tree import bundle_counts
from app.api.modules.identity_infospace_user.access import Access

logger = logging.getLogger(__name__)


def _effective_mode(body: AssetSearchRequest, parsed: ParsedQuery) -> str:
    """Resolve the search mode actually executed.

    ``vector`` is honoured verbatim — those callers (semantic search) send a
    *plain* query they want embedded, with no AQL ``~``. For everything else the
    AQL itself decides: ``~`` clauses → semantic, free text → FTS, both → hybrid,
    neither → a pure structured filter. The wire ``mode`` is otherwise advisory.
    """
    if body.mode == "vector":
        return "vector"
    if parsed.has_text and parsed.has_semantic:
        return "hybrid"
    if parsed.has_semantic:
        return "vector"
    if parsed.has_text:
        return "text"
    return "filter"


def _build_search_query(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    parsed: ParsedQuery,
    *,
    access: Access,
) -> AssetQuery:
    """Compile an ``AssetSearchRequest`` into an ``AssetQuery``.

    The query string is the source of truth: it is parsed as AQL and compiled
    via ``AssetQuery.from_aql`` so ``kind: after: bundle: tag: ~semantic
    "phrase" -neg`` (and the as-is entity/annotation/run clauses) actually
    filter. ``scope_hints`` are structured user filters layered on top, and
    ``access.scope`` is the authorization clamp — ``scope()`` appends (ANDs), so
    access scope intersects any ``bundle:``/``asset:`` scope the AQL set.

    ``mode='vector'`` is the one exception: the caller wants the *raw* query
    embedded for pure semantic search, bypassing AQL parsing.
    """

    hints = body.scope_hints

    if body.mode == "vector":
        q = AssetQuery(session, infospace_id).scope(access.scope).exclude_superseded()
        q.semantic(body.q, top_k=max(body.limit, 50))
        if hints.parent_asset_id is not None:
            q.parent_asset(hints.parent_asset_id)
        elif not hints.asset_ids:
            q.top_level_only()
    else:
        # AQL compile (text / hybrid / filter). from_aql handles text, ~semantic,
        # kinds, dates, bundle:/asset: scope, tags, entity/annotation, and the
        # top-level-vs-drilldown decision.
        q = AssetQuery.from_aql(session, infospace_id, parsed, parent_asset_id=hints.parent_asset_id)
        # Authorization clamp — AND'd (intersected) with any AQL bundle:/asset: scope.
        q.scope(access.scope)

    # Structured scope_hints layer on as additional filters (helper panel, semantic search).
    if hints.kinds:
        q.kinds(hints.kinds)
    if hints.bundle_ids and len(hints.bundle_ids) == 1:
        q.bundle(hints.bundle_ids[0])
    if hints.asset_ids:
        q.ids(list(hints.asset_ids))
    if hints.date_from or hints.date_to:
        q.date_range(after=hints.date_from, before=hints.date_to)

    q.sort(body.sort or "relevance")
    q.paginate(cursor=body.cursor, limit=body.limit)
    return q


def _folder_leads(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    parsed: ParsedQuery,
    *,
    access: Access,
) -> list[AssetNode]:
    """Folder name-matches as lead nodes for the search stream.

    Folders lead ONLY an unscoped, free-text, opt-in search. Concretely:
    ``include_folders`` is set (discovery surfaces — the tree/picker; asset-only
    callers leave it off), there's free text to match (a pure-semantic ``vector``
    query has none), and the query is NOT scoped. A scoped query — ``bundle:``/
    ``asset:`` refs, or ``scope_hints`` narrowing — means "search *inside* here",
    where surfacing top-level folder name-matches is noise; the scoped asset
    search (full AQL) takes over instead. Tagged ``field='title'`` so the
    frontend's existing direct tier renders them among the name hits.
    """
    hints = body.scope_hints
    if (
        not body.include_folders
        or body.mode == "vector"
        or not parsed.has_text
        or parsed.bundle_refs
        or parsed.asset_refs
        or hints.bundle_ids
        or hints.asset_ids
        or hints.parent_asset_id is not None
    ):
        return []
    ranked = rank_bundles(session, infospace_id, parsed, access.scope, limit=10)
    # Live counts — the denormalized Bundle.asset_count drifts for ingested folders.
    counts = bundle_counts(session, [b.id for b, _ in ranked])
    return [
        _bundle_node(
            b,
            matches=[AssetMatch(field="title", score=None, snippet=None)],
            asset_count=counts.get(b.id, (None, None))[0],
            child_bundle_count=counts.get(b.id, (None, None))[1],
        )
        for b, _score in ranked
    ]


async def search_assets(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    *,
    access: Access,
) -> AssetSearch:
    """Drained ``AssetSearch`` envelope. Use when caller wants JSON."""

    parsed = parse_aql(body.q or "")
    query = _build_search_query(session, infospace_id, body, parsed, access=access)
    return await collect_search(
        query,
        query_string=body.q,
        mode=_effective_mode(body, parsed),
        parsed=parsed,
        access_scope=access.scope,
        lead_nodes=_folder_leads(session, infospace_id, body, parsed, access=access),
    )


async def stream_search_assets(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    *,
    access: Access,
) -> AsyncIterator[StreamEvent]:
    """Progressive ``StreamEvent`` generator. Use behind ``EventSourceResponse``."""

    parsed = parse_aql(body.q or "")
    query = _build_search_query(session, infospace_id, body, parsed, access=access)
    async for ev in render_search(
        query,
        query_string=body.q,
        mode=_effective_mode(body, parsed),
        parsed=parsed,
        access_scope=access.scope,
        lead_nodes=_folder_leads(session, infospace_id, body, parsed, access=access),
    ):
        yield ev
