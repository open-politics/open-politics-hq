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

from app.api.modules.content.query import AssetQuery
from app.api.modules.content.query_parser import parse as parse_aql
from app.api.modules.content.schemas import (
    AssetSearch,
    AssetSearchRequest,
    StreamEvent,
)
from app.api.modules.content.views import collect_search, render_search
from app.api.modules.identity_infospace_user.access import Access

logger = logging.getLogger(__name__)


def _build_search_query(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    *,
    access: Access,
) -> AssetQuery:
    """Compile an ``AssetSearchRequest`` into an ``AssetQuery``.

    Mode dispatch:
      * ``text``   — FTS + title ILIKE via ``AssetQuery.text``
      * ``vector`` — ``AssetQuery.semantic`` (pgvector)
      * ``hybrid`` — both; ``execute_scored_async`` merges scores
      * ``filter`` — no textual ranking; pure structured filters
    """

    hints = body.scope_hints

    q = (
        AssetQuery(session, infospace_id)
        .scope(access.scope)
        .exclude_superseded()
    )

    if body.mode in ("text", "hybrid"):
        q.text(body.q, mode="fts")
    if body.mode in ("vector", "hybrid"):
        q.semantic(body.q, top_k=max(body.limit, 50))

    if hints.kinds:
        q.kinds(hints.kinds)
    if hints.bundle_ids:
        # AssetQuery.bundle takes a single id; use ids() for multi-bundle intersections
        # with scope; scope already enforces access. Here we treat bundle_ids as a
        # filter hint — apply the first; ignore the rest for now since AQL handles
        # full set semantics. (Clients wanting multi-bundle should use AQL.)
        if len(hints.bundle_ids) == 1:
            q.bundle(hints.bundle_ids[0])
    if hints.asset_ids:
        q.ids(list(hints.asset_ids))
    if hints.parent_asset_id is not None:
        q.parent_asset(hints.parent_asset_id)
    if hints.date_from or hints.date_to:
        q.date_range(after=hints.date_from, before=hints.date_to)

    if hints.parent_asset_id is None and not hints.asset_ids:
        q.top_level_only()

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

    query = _build_search_query(session, infospace_id, body, access=access)
    parsed = parse_aql(body.q) if body.q else None
    return await collect_search(
        query,
        query_string=body.q,
        mode=body.mode,
        parsed=parsed,
    )


async def stream_search_assets(
    session: Session,
    infospace_id: int,
    body: AssetSearchRequest,
    *,
    access: Access,
) -> AsyncIterator[StreamEvent]:
    """Progressive ``StreamEvent`` generator. Use behind ``EventSourceResponse``."""

    query = _build_search_query(session, infospace_id, body, access=access)
    parsed = parse_aql(body.q) if body.q else None
    async for ev in render_search(
        query,
        query_string=body.q,
        mode=body.mode,
        parsed=parsed,
    ):
        yield ev
