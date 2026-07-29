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

from app.api.modules.content.query import AssetQuery, parse as parse_aql
from app.api.modules.content.schemas import (
    AssetSearch,
    AssetSearchMeta,
    AssetSearchRequest,
    ParsedQuery,
    StreamEvent,
)
from app.api.modules.content.views import collect, flat
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
    if hints.bundle_ids:
        # A bundle scope-hint includes its whole subtree (same as an AQL ``bundle:``
        # ref and access grants). Applied as a scope so it both filters the final
        # rows and pre-filters the semantic vector search (recall stays in-scope).
        from app.api.modules.content.tree import subtree_ids
        from app.api.modules.identity_infospace_user.access import PackageScope
        sub = tuple(subtree_ids(session, set(hints.bundle_ids)))
        hint_scope = PackageScope(bundle_ids=sub)
        q.scope(hint_scope)
        q._semantic_scope = hint_scope
    if hints.asset_ids:
        q.ids(list(hints.asset_ids))
    if hints.date_from or hints.date_to:
        q.date_range(after=hints.date_from, before=hints.date_to)

    q.sort(body.sort or "relevance")
    q.paginate(cursor=body.cursor, limit=body.limit)
    return q


async def search_assets(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    *,
    access: Access,
) -> AssetSearch:
    """Drained ``AssetSearch`` envelope. Use when caller wants JSON."""

    parsed = parse_aql(body.q or "")
    mode = _effective_mode(body, parsed)
    query = _build_search_query(session, infospace_id, body, parsed, access=access)
    events = flat(query, grouped=True, parsed=parsed, mode=mode, access_scope=access.scope)
    return await collect(
        events, AssetSearch,
        meta=AssetSearchMeta(query=body.q, parsed=parsed, mode=mode),
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
    mode = _effective_mode(body, parsed)
    query = _build_search_query(session, infospace_id, body, parsed, access=access)
    async for ev in flat(query, grouped=True, parsed=parsed, mode=mode, access_scope=access.scope):
        yield ev
