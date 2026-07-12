"""Content views — progressive stream generators + envelope collectors.

One async generator per family (tree / search / feed) plus a trivial
``collect_X`` drain. Both views come from the same implementation:
``collect_X`` is always ``drain(render_X(...), envelope_type)``.

Each view is given a configured ``AssetQuery`` and produces either a
progressive ``StreamEvent`` stream (SSE) or a concrete envelope.

Shapes live in ``content/schemas.py``. The wire protocol is unified across
every content view and re-used by annotation views.
"""

from __future__ import annotations

import asyncio
import logging
from typing import AsyncIterator, Optional

from sqlalchemy import and_, func, text
from sqlmodel import select

from app.api.modules.content.models import Asset, Bundle
from app.api.modules.content.query import AssetQuery
from app.api.modules.content.schemas import (
    AssetFeed,
    AssetFeedMeta,
    AssetMatch,
    AssetNode,
    AssetSearch,
    AssetSearchMeta,
    AssetTree,
    AssetTreeBundleSkeleton,
    AssetTreeMeta,
    AssetTreeNav,
    CountEvent,
    DoneEvent,
    ListingSection,
    NavEvent,
    SectionEvent,
    SkeletonEvent,
    StreamEvent,
)
from app.core.cursor import encode_cursor
from app.core.sse import drain

logger = logging.getLogger(__name__)


# ─── Shared helpers ─────────────────────────────────────────────────────────


def _asset_node(
    asset: Asset,
    *,
    score: float | None = None,
    matches: list[AssetMatch] | None = None,
) -> AssetNode:
    """Project an Asset row into the unified AssetNode shape."""

    return AssetNode(
        id=f"asset-{asset.id}",
        type="asset",
        name=asset.title or "",
        kind=asset.kind,
        has_children=bool(asset.is_container),
        children_count=None,
        stub=bool(asset.stub) if asset.stub is not None else None,
        processing_status=asset.processing_status,
        parent_asset_id=asset.parent_asset_id,
        bundle_ids=list(asset.bundle_ids) if asset.bundle_ids else None,
        part_index=asset.part_index,
        tags=list(asset.tags) if asset.tags else None,
        facets=dict(asset.facets) if asset.facets else None,
        score=score,
        matches=matches or [],
        created_at=asset.created_at,
        updated_at=asset.updated_at,
    )


def _bundle_node(
    bundle: Bundle,
    *,
    score: float | None = None,
    matches: list[AssetMatch] | None = None,
    asset_count: int | None = None,
    child_bundle_count: int | None = None,
) -> AssetNode:
    """Project a Bundle row into the unified AssetNode shape.

    ``score``/``matches`` are optional match evidence — set when a folder is a
    search hit (e.g. a name match tagged ``field='title'``), left empty for plain
    tree listings. ``asset_count``/``child_bundle_count`` override the bundle's
    denormalized cache with live counts (see ``tree.bundle_counts``) — pass them
    so a freshly-ingested folder reports its true size, not a stale 0.
    """

    asset_count = asset_count if asset_count is not None else (bundle.asset_count or 0)
    child_bundle_count = child_bundle_count if child_bundle_count is not None else (bundle.child_bundle_count or 0)
    return AssetNode(
        id=f"bundle-{bundle.id}",
        type="bundle",
        name=bundle.name,
        has_children=(asset_count + child_bundle_count) > 0,
        children_count=asset_count + child_bundle_count,
        asset_count=asset_count,
        child_bundle_count=child_bundle_count,
        sealed=bool(bundle.sealed) if bundle.sealed is not None else None,
        tags=list(bundle.tags) if bundle.tags else None,
        score=score,
        matches=matches or [],
        created_at=bundle.created_at,
        updated_at=bundle.updated_at,
    )


def _build_nav(session, infospace_id: int, access_scope) -> AssetTreeNav:
    """Flat bundle registry. Scoped; client rebuilds hierarchy in O(n)."""

    stmt = select(Bundle).where(Bundle.infospace_id == infospace_id)
    if access_scope is not None and access_scope.bundle_ids:
        stmt = stmt.where(Bundle.id.in_(access_scope.bundle_ids))
    elif access_scope is not None and not access_scope.bundle_ids:
        # Scope set but no bundle grants — no bundles visible in nav.
        return AssetTreeNav(bundles=[])

    bundles = session.exec(stmt.order_by(Bundle.name.asc())).all()
    return AssetTreeNav(
        bundles=[
            AssetTreeBundleSkeleton(
                id=b.id,
                name=b.name,
                parent_id=(b.parent_bundle_id if b.parent_bundle_id else None),
                tags=b.tags or [],
            )
            for b in bundles
        ]
    )


def _cursor_for_asset(asset: Asset, sort: str) -> str:
    """Build an opaque next-page cursor matching the active sort's keyset.

    The encoded value MUST be the same column the sort orders by, or keyset
    Load-more overlaps/skips: date sorts order by ``coalesce(event_timestamp,
    created_at)`` (the *effective* date), not ``created_at``. Relevance can't
    carry its computed rank, so it falls back to an id-only cursor (shallow
    paging by design).
    """
    if sort in ("created_at_desc", "created_at_asc"):
        field = "effective_date"
        direction = "asc" if sort == "created_at_asc" else "desc"
        eff = asset.event_timestamp or asset.created_at
        value = eff.isoformat() if eff else None
    elif sort == "title":
        field, direction, value = "title", "asc", asset.title
    elif sort == "part_index":
        field, direction, value = "part_index", "asc", asset.part_index
    else:  # relevance / unknown — id tiebreaker only
        field, direction, value = sort, "desc", None
    return encode_cursor(
        sort_field=field, direction=direction,
        last_value=value, last_id=asset.id,
    )


# ─── render_tree ────────────────────────────────────────────────────────────


async def render_tree(
    query: AssetQuery,
    *,
    level_parent: Optional[str] = None,
    access_scope=None,
) -> AsyncIterator[StreamEvent]:
    """Progressive tree event stream.

    Emits: skeleton → nav → section(role='level') → count → done.
    """

    yield SkeletonEvent(family="tree")

    nav = _build_nav(query.session, query.infospace_id, access_scope)
    yield NavEvent(nav=nav)

    assets = query.execute()
    nodes = [_asset_node(a) for a in assets]
    next_cursor = (
        _cursor_for_asset(assets[-1], query._sort)
        if assets and len(assets) >= (query._limit or 0)
        else None
    )
    section = ListingSection[AssetNode](
        at_parent=level_parent,
        items=nodes,
        total=-1,
        has_more=bool(next_cursor),
        cursor_next=next_cursor,
    )
    yield SectionEvent(role="level", section=section)

    total = query.count()
    yield CountEvent(total=total)

    yield DoneEvent()


# ─── render_search ──────────────────────────────────────────────────────────


# Primary results stream in small batches so the list visibly fills in rather
# than landing as one dump. Kept deliberately small — 10 still reads as a batch.
PRIMARY_BATCH_SIZE = 5
# Per-parent nested-match defaults. children:none → 0; children:all → ALL_CAP.
DEFAULT_CHILD_LIMIT = 3
ALL_CHILD_CAP = 50
# Bound how many container hits on a page we fetch children for.
MAX_CHILD_PARENTS = 12


def _resolve_child_limit(parsed) -> int:
    """Per-parent child fetch limit from the ``children:`` clause. 0 = suppress."""
    v = getattr(parsed, "children_limit", None) if parsed is not None else None
    if v is None:
        return DEFAULT_CHILD_LIMIT
    if v == 0:
        return 0
    if v == -1:  # children:all
        return ALL_CHILD_CAP
    return min(v, ALL_CHILD_CAP)


def _match_node(asset: Asset, rank, headline, *, query_text: str = "") -> AssetNode:
    """AssetNode for a scored hit, tagged ``title`` vs ``body``.

    A *title* hit — the search text appears in the asset's own title — is the
    "I know its name" case: surfaced in its own tier and carrying NO relevance %
    (a name match isn't a fuzzy score). Everything else is a body/content hit
    with its snippet and score. ``query_text`` empty (e.g. children, which match
    on content) always yields a body hit.
    """
    q = query_text.strip().lower()
    if q and q in (asset.title or "").lower():
        return _asset_node(asset, score=None, matches=[AssetMatch(field="title", score=None, snippet=None)])
    matches: list[AssetMatch] = []
    if rank is not None:
        matches.append(AssetMatch(field="body", score=float(rank), snippet=headline))
    return _asset_node(asset, score=rank, matches=matches)


async def render_search(
    query: AssetQuery,
    *,
    query_string: str = "",
    mode: str = "text",
    parsed=None,
    access_scope=None,
    lead_nodes: Optional[list[AssetNode]] = None,
) -> AsyncIterator[StreamEvent]:
    """Progressive search event stream.

    Emits:
        skeleton → section(role='primary')+ → count → section(role='grouped')* → done

    Primary lands in small batches (cursor-streamed for text/filter; chunked for
    semantic/hybrid, which must merge the full set first). Grouped sections carry
    the actual nested matches — pages/rows of a container hit that also contain
    the search text — bounded by the ``children:`` clause.

    ``lead_nodes`` is a generic "emit these first" slot: a complete, un-paginated
    batch of nodes streamed ahead of the query hits (Spotlight "top hits"). It
    stays out of the asset keyset cursor, so ``count``/``has_more`` remain
    query-driven. Folder name-matches are its first consumer; pinned/suggested
    results are future ones — the view stays dumb about what leads.
    """

    yield SkeletonEvent(family="search")

    if lead_nodes:
        yield SectionEvent(role="primary", section=ListingSection[AssetNode](
            items=lead_nodes, total=-1, has_more=True, cursor_next=None,
        ))
        await asyncio.sleep(0)

    limit = query._limit or 0
    # Free-text portion drives title-vs-content tagging of primary hits.
    primary_text = (getattr(parsed, "text", "") or "") if parsed is not None else query_string

    if mode in ("vector", "hybrid"):
        # Semantic merge needs the whole set; materialise then chunk.
        scored_full = await query.execute_scored_async()
        batch_iter = (
            scored_full[i:i + PRIMARY_BATCH_SIZE]
            for i in range(0, len(scored_full), PRIMARY_BATCH_SIZE)
        )
    else:
        # Text / filter: stream rows off a server-side cursor.
        batch_iter = query.execute_scored_stream(PRIMARY_BATCH_SIZE)

    # One-batch lookahead so only the final batch carries has_more / cursor_next.
    primary_assets: list[Asset] = []
    prev_batch: Optional[list] = None
    for batch in batch_iter:
        if prev_batch is not None:
            yield SectionEvent(role="primary", section=ListingSection[AssetNode](
                items=[_match_node(a, r, h, query_text=primary_text) for a, r, h in prev_batch],
                total=-1, has_more=True, cursor_next=None,
            ))
            await asyncio.sleep(0)
        prev_batch = batch
        primary_assets.extend(a for a, _, _ in batch)

    next_cursor = (
        _cursor_for_asset(primary_assets[-1], query._sort)
        if primary_assets and limit > 0 and len(primary_assets) >= limit
        else None
    )
    yield SectionEvent(role="primary", section=ListingSection[AssetNode](
        items=[_match_node(a, r, h, query_text=primary_text) for a, r, h in (prev_batch or [])],
        total=-1, has_more=bool(next_cursor), cursor_next=next_cursor,
    ))

    yield CountEvent(total=query.count())

    # Grouped: actual nested matches per container hit. Only meaningful when
    # there's search text to find inside the children (a kind:/date: filter has
    # no "match inside a child" notion). One small indexed query per parent.
    child_limit = _resolve_child_limit(parsed)
    has_text = bool(getattr(parsed, "has_text", False)) and bool(getattr(parsed, "text", ""))
    if primary_assets and child_limit > 0 and has_text:
        containers = [a for a in primary_assets if a.is_container][:MAX_CHILD_PARENTS]
        for parent in containers:
            child_q = (
                AssetQuery(query.session, query.infospace_id)
                .scope(access_scope)
                .exclude_superseded()
                .parent_asset(parent.id)
                .text(parsed.text, mode="fts")
                .sort("relevance")
                .paginate(limit=child_limit)
            )
            child_rows = child_q.execute_scored()
            if not child_rows:
                continue
            total_children = child_q.count()
            yield SectionEvent(role="grouped", section=ListingSection[AssetNode](
                at_parent=f"asset-{parent.id}",
                items=[_match_node(c, r, h) for c, r, h in child_rows],
                total=total_children,
                has_more=total_children > len(child_rows),
            ))
            await asyncio.sleep(0)

    yield DoneEvent()


# ─── render_feed ────────────────────────────────────────────────────────────


async def render_feed(query: AssetQuery) -> AsyncIterator[StreamEvent]:
    """Progressive feed event stream.

    Emits: skeleton → section(role='primary') → count → done.
    """

    yield SkeletonEvent(family="feed")

    assets = query.execute()
    nodes = [_asset_node(a) for a in assets]
    next_cursor = (
        _cursor_for_asset(assets[-1], query._sort)
        if assets and len(assets) >= (query._limit or 0)
        else None
    )
    section = ListingSection[AssetNode](
        items=nodes,
        total=-1,
        has_more=bool(next_cursor),
        cursor_next=next_cursor,
    )
    yield SectionEvent(role="primary", section=section)

    total = query.count()
    yield CountEvent(total=total)

    yield DoneEvent()


# ─── collect_* (JSON envelope path) ─────────────────────────────────────────


async def collect_tree(
    query: AssetQuery,
    *,
    level_parent: Optional[str] = None,
    access_scope=None,
) -> AssetTree:
    """Drain render_tree into an AssetTree envelope."""

    events = render_tree(query, level_parent=level_parent, access_scope=access_scope)
    envelope = await drain(events, AssetTree)
    # Pad in tree meta counts (cheap; run after drain completes).
    envelope.meta = _compute_tree_meta(query.session, query.infospace_id, access_scope)
    return envelope


async def collect_search(
    query: AssetQuery,
    *,
    query_string: str = "",
    mode: str = "text",
    parsed=None,
    access_scope=None,
    lead_nodes: Optional[list[AssetNode]] = None,
) -> AssetSearch:
    """Drain render_search into an AssetSearch envelope."""

    events = render_search(
        query, query_string=query_string, mode=mode, parsed=parsed,
        access_scope=access_scope, lead_nodes=lead_nodes,
    )
    envelope = await drain(events, AssetSearch)
    envelope.meta = AssetSearchMeta(
        query=query_string,
        parsed=parsed,
        mode=mode,
    )
    return envelope


async def collect_feed(query: AssetQuery) -> AssetFeed:
    """Drain render_feed into an AssetFeed envelope."""

    events = render_feed(query)
    envelope = await drain(events, AssetFeed)
    envelope.meta = AssetFeedMeta()
    return envelope


def _compute_tree_meta(session, infospace_id: int, access_scope) -> AssetTreeMeta:
    """Compute tree-level counts (bundles, top-level assets). ``vfolders`` is held at
    0 — folders are real bundles now; the field is removed with the cutover client regen."""

    bundle_count_stmt = select(func.count(Bundle.id)).where(Bundle.infospace_id == infospace_id)
    if access_scope is not None and access_scope.bundle_ids:
        bundle_count_stmt = bundle_count_stmt.where(Bundle.id.in_(access_scope.bundle_ids))
    elif access_scope is not None:
        bundle_count_stmt = bundle_count_stmt.where(and_(False))
    bundle_count = session.exec(bundle_count_stmt).one() or 0

    asset_count_stmt = (
        select(func.count(Asset.id))
        .where(Asset.infospace_id == infospace_id)
        .where(Asset.parent_asset_id.is_(None))
        # Only count assets that aren't in any real bundle — matches the
        # set that _root_query returns via .no_bundles().
        .where(text("bundle_ids <@ ARRAY[0]::int[]"))
    )
    asset_count = session.exec(asset_count_stmt).one() or 0

    return AssetTreeMeta(bundles=bundle_count, assets=asset_count, vfolders=0)
