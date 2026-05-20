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

import logging
import time
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


def _bundle_node(bundle: Bundle) -> AssetNode:
    """Project a Bundle row into the unified AssetNode shape."""

    asset_count = bundle.asset_count or 0
    child_bundle_count = bundle.child_bundle_count or 0
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
        created_at=bundle.created_at,
        updated_at=bundle.updated_at,
    )


def _vfolder_node(bundle_id: int, path_prefix: str, name: str) -> AssetNode:
    from datetime import datetime, timezone
    return AssetNode(
        id=f"vfolder-{bundle_id}::{path_prefix}",
        type="virtual_folder",
        name=name,
        path_prefix=path_prefix,
        has_children=True,
        updated_at=datetime.now(timezone.utc),
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
            )
            for b in bundles
        ]
    )


def _cursor_for_asset(asset: Asset, sort: str) -> str:
    """Build an opaque next-page cursor for an asset listing."""

    direction = "desc" if sort.endswith("_desc") or sort == "relevance" else "asc"
    if sort.startswith("created_at") or sort == "relevance":
        field = "created_at"
        value = asset.created_at.isoformat() if asset.created_at else None
    elif sort == "title":
        field = "title"
        value = asset.title
    else:
        field = "id"
        value = asset.id
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


async def render_search(
    query: AssetQuery,
    *,
    query_string: str = "",
    mode: str = "text",
    parsed=None,
) -> AsyncIterator[StreamEvent]:
    """Progressive search event stream.

    Emits:
        skeleton → section(role='primary') → count → section(role='grouped')* → done
    """

    start = time.perf_counter()
    yield SkeletonEvent(family="search")

    scored = await query.execute_scored_async()
    primary_nodes: list[AssetNode] = []
    for asset, rank, headline in scored:
        matches: list[AssetMatch] = []
        if rank is not None:
            matches.append(AssetMatch(
                field="body" if headline else "title",
                score=float(rank),
                snippet=headline,
            ))
        primary_nodes.append(_asset_node(asset, score=rank, matches=matches))

    next_cursor = (
        _cursor_for_asset(scored[-1][0], query._sort)
        if scored and len(scored) >= (query._limit or 0)
        else None
    )
    primary = ListingSection[AssetNode](
        items=primary_nodes,
        total=-1,
        has_more=bool(next_cursor),
        cursor_next=next_cursor,
    )
    yield SectionEvent(role="primary", section=primary)

    total = query.count()
    elapsed_ms = int((time.perf_counter() - start) * 1000)
    yield CountEvent(total=total)

    # Grouped sections: one level-down listing per hit asset that has children
    # that also match the underlying conditions. This is cheap — count_by_parent
    # runs a single GROUP BY on the indexed parent_asset_id column.
    if scored and mode in ("text", "hybrid"):
        group_counts = query.count_by_parent()
        for asset in [s[0] for s in scored]:
            if not asset.is_container:
                continue
            child_count = group_counts.get(asset.id, 0)
            if child_count == 0:
                continue
            yield SectionEvent(
                role="grouped",
                section=ListingSection[AssetNode](
                    at_parent=f"asset-{asset.id}",
                    items=[],
                    total=child_count,
                    has_more=child_count > 0,
                ),
            )

    # Attach meta on the primary via a final no-op wrapper? We stream
    # meta back by having the drain assemble an AssetSearchMeta when the
    # caller is collecting. Streaming consumers use the raw events.
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
) -> AssetSearch:
    """Drain render_search into an AssetSearch envelope."""

    events = render_search(query, query_string=query_string, mode=mode, parsed=parsed)
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
    """Compute tree-level counts (bundles, top-level assets, vfolder approx)."""

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
