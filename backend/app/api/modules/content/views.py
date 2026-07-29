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

from sqlalchemy import and_, func
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
    TOTAL_PENDING,
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


def _build_nav(
    session, infospace_id: int, access_scope, *,
    only: Optional[set[int]] = None, name_hits: Optional[set[int]] = None,
) -> AssetTreeNav:
    """Flat bundle registry. Scoped; client rebuilds hierarchy in O(n).

    ``only`` prunes the registry to a participating subset — the search-tree
    skeleton (``views.participating_bundles``). ``None`` ships every visible
    bundle (browse). An empty ``only`` set means "a query with no folder hits" →
    an empty registry (results, if any, are all loose at root). ``name_hits`` flags
    the folders whose name matched (client browses those unfiltered).
    """

    if only is not None and not only:
        return AssetTreeNav(bundles=[])

    hits = name_hits or set()
    stmt = select(Bundle).where(Bundle.infospace_id == infospace_id)
    if access_scope is not None and access_scope.bundle_ids:
        stmt = stmt.where(Bundle.id.in_(access_scope.bundle_ids))
    elif access_scope is not None and not access_scope.bundle_ids:
        # Scope set but no bundle grants — no bundles visible in nav.
        return AssetTreeNav(bundles=[])
    if only is not None:
        stmt = stmt.where(Bundle.id.in_(only))

    bundles = session.exec(stmt.order_by(Bundle.name.asc())).all()
    return AssetTreeNav(
        bundles=[
            AssetTreeBundleSkeleton(
                id=b.id,
                name=b.name,
                parent_id=(b.parent_bundle_id if b.parent_bundle_id else None),
                tags=b.tags or [],
                name_hit=b.id in hits,
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


# ─── Emitters — the shared yields every listing composition is built from ─────
#
# One query, one node shape, a handful of yields. tree / flat below are each just a
# composition of these; the only things that
# vary are which fire and how the query's rows are projected. No listing family
# owns its own skeleton / section / count / done scaffolding.


def emit_skeleton(family: str) -> SkeletonEvent:
    return SkeletonEvent(family=family)


def emit_nav(
    session, infospace_id: int, access_scope, *,
    only: Optional[set[int]] = None, name_hits: Optional[set[int]] = None,
) -> NavEvent:
    """Flat bundle registry; ``only`` prunes it to the participating skeleton,
    ``name_hits`` flags the name-matched folders."""
    return NavEvent(nav=_build_nav(session, infospace_id, access_scope, only=only, name_hits=name_hits))


def emit_count(total: int, *, at_parent: Optional[str] = None) -> CountEvent:
    return CountEvent(total=total, at_parent=at_parent)


def emit_done() -> DoneEvent:
    return DoneEvent()


def _page_cursor(assets: list, sort: str, limit: int) -> Optional[str]:
    """Next-page keyset cursor — set only when the page came back full."""
    if assets and limit and len(assets) >= limit:
        return _cursor_for_asset(assets[-1], sort)
    return None


def _project(query):
    """The row projector: ``(asset, rank, headline) → AssetNode``, tagging title vs
    body. One projector for every listing — ``_match_node`` yields a plain node when
    there's no text/score (browse/feed) and folds the resolved semantic score in via
    the rank (``rows`` merges it), so there's nothing else to attach.
    """
    text_q = query._text_query or ""
    def project(asset, rank, headline):
        return _match_node(asset, rank, headline, query_text=text_q)
    return project


async def emit_section(
    query,
    *,
    role: str,
    project,
    at_parent: Optional[str] = None,
    batch_size: Optional[int] = None,
    mode: str = "text",
    collect: Optional[list] = None,
) -> AsyncIterator[SectionEvent]:
    """Emit ``query``'s current page as one section — or, with ``batch_size``,
    several progressive batches (one row of lookahead, so only the final section
    carries ``has_more`` / ``cursor_next``).

    ``batch_size=None`` → a single materialized section (tree / feed levels).
    vector/hybrid materialize-and-merge (``rows`` re-sorts by the blended score);
    text/filter stream off a server-side cursor. The query must already be
    ``resolve``d (the ``flat``/``tree`` compositions do it up front). ``collect``
    (when given) gathers the emitted assets for a follow-on stage (grouped children).
    """
    limit = query._limit or 0

    if batch_size is None:
        page = query.rows()
        assets = [a for a, _, _ in page]
        if collect is not None:
            collect.extend(assets)
        cursor = _page_cursor(assets, query._sort, limit)
        yield SectionEvent(role=role, section=ListingSection[AssetNode](
            at_parent=at_parent,
            items=[project(a, r, h) for a, r, h in page],
            total=-1,
            has_more=bool(cursor),
            cursor_next=cursor,
        ))
        return

    if mode in ("vector", "hybrid"):
        scored_full = query.rows()
        batch_iter = (scored_full[i:i + batch_size] for i in range(0, len(scored_full), batch_size))
    else:
        batch_iter = query.stream(batch_size)

    assets = []
    prev: Optional[list] = None
    for batch in batch_iter:
        if prev is not None:
            yield SectionEvent(role=role, section=ListingSection[AssetNode](
                at_parent=at_parent,
                items=[project(a, r, h) for a, r, h in prev],
                total=TOTAL_PENDING, has_more=True, cursor_next=None,
            ))
            await asyncio.sleep(0)
        prev = batch
        assets.extend(a for a, _, _ in batch)

    if collect is not None:
        collect.extend(assets)
    cursor = _page_cursor(assets, query._sort, limit)
    yield SectionEvent(role=role, section=ListingSection[AssetNode](
        at_parent=at_parent,
        items=[project(a, r, h) for a, r, h in (prev or [])],
        total=-1, has_more=bool(cursor), cursor_next=cursor,
    ))


# ─── tree ─────────────────────────────────────────────────────────────────────


# A tree level's total is a display figure (pagination uses has_more + cursor), so
# cap it: count(cap=N) stops scanning at N+1, turning an O(matches) count on a huge
# folder into O(cap). A total > this ceiling means "more than N" — render as "N+".
LEVEL_COUNT_CAP = 10_000


async def tree(
    query: AssetQuery,
    *,
    level_parent: Optional[str] = None,
    access_scope=None,
    participating: Optional[set[int]] = None,
    name_hits: Optional[set[int]] = None,
) -> AsyncIterator[StreamEvent]:
    """The tree arrangement: skeleton → nav → section(level) → count → done.

    A browse listing when the query carries no filters; a search-tree when it does
    — ``participating`` prunes the nav to the folders that contain matches, and the
    level section lists the matching assets at this position. ``participating`` is a
    root-level concern (``None`` at child levels, which reuse the root skeleton);
    ``name_hits`` flags the name-matched folders in the nav.
    """
    yield emit_skeleton("tree")
    await query.resolve()
    yield emit_nav(query.session, query.infospace_id, access_scope, only=participating, name_hits=name_hits)
    async for ev in emit_section(query, role="level", project=_project(query), at_parent=level_parent):
        yield ev
    yield emit_count(query.count(cap=LEVEL_COUNT_CAP), at_parent=level_parent)
    yield emit_done()


# ─── flat ─────────────────────────────────────────────────────────────────────


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


async def flat(
    query: AssetQuery,
    *,
    grouped: bool = False,
    parsed=None,
    mode: str = "text",
    access_scope=None,
) -> AsyncIterator[StreamEvent]:
    """The flat arrangement — a paged listing. Search results (``grouped=True``) or
    the recent-assets feed (``grouped=False``).

    Emits: skeleton → section(role='primary')+ → count → section(role='grouped')* → done.

    Search batches the primary for progressive fill (cursor-streamed for text/filter;
    chunked for semantic/hybrid, which merge the full set first) and appends the
    per-container nested matches bounded by the ``children:`` clause. The feed emits a
    single primary section and no grouped sections.
    """
    yield emit_skeleton("search" if grouped else "feed")
    await query.resolve()

    primary_assets: list = []
    async for ev in emit_section(
        query, role="primary", project=_project(query),
        batch_size=(PRIMARY_BATCH_SIZE if grouped else None), mode=mode, collect=primary_assets,
    ):
        yield ev

    yield emit_count(query.count())

    if grouped:
        async for ev in emit_grouped(query, parsed, access_scope, primary_assets):
            yield ev

    yield emit_done()


async def emit_grouped(query, parsed, access_scope, primary_assets) -> AsyncIterator[SectionEvent]:
    """Per-container nested matches — pages/rows of a container hit that also
    contain the search text, bounded by the ``children:`` clause. Search-only:
    the tree reveals the same nesting by expansion instead. Only meaningful with
    free text (a ``kind:``/``date:`` filter has no "match inside a child" notion).
    """
    child_limit = _resolve_child_limit(parsed)
    has_text = bool(getattr(parsed, "has_text", False)) and bool(getattr(parsed, "text", ""))
    if not (primary_assets and child_limit > 0 and has_text):
        return
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
        child_rows = child_q.rows()
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


# ─── collect (one generic drain for every envelope) ─────────────────────────


async def collect(events, envelope_type, *, meta=None):
    """Drain a render stream into its JSON envelope; attach caller-supplied ``meta``.

    One drain for tree/search/feed — the family-specific meta (``_compute_tree_meta``,
    ``AssetSearchMeta``, ``AssetFeedMeta``) is built by the route/caller and passed in.
    """
    envelope = await drain(events, envelope_type)
    if meta is not None:
        envelope.meta = meta
    return envelope


async def participating_bundles(session, infospace_id: int, parsed, access_scope) -> tuple[set[int], set[int]]:
    """The search-tree folder skeleton, and which of its folders are name-hits.

    Returns ``(participating, name_hits)`` where::

        participating = ancestors( matched-asset bundle_ids ∪ name-matched folders )
        name_hits     = the folders whose *name* matched (a subset, un-ancestored)

    ``participating`` is a peer of ``count`` — computed once at the root, bounded by
    the number of bundles (not the match count), so it stays cheap at any size. Async
    because a ``~semantic`` clause resolves via embedding+pgvector before its
    bundle_ids can be collected. An empty ``participating`` → an empty nav (all
    matches, if any, are loose at root).
    """
    from app.api.modules.content.query import (
        AssetQuery as _AssetQuery,
        bundles_matching,
        _resolve_bundle_ids,
    )
    from app.api.modules.content.tree import ancestor_ids, subtree_ids

    q = _AssetQuery.from_aql(session, infospace_id, parsed).scope(access_scope)
    await q.resolve()
    asset_leaves = q.containers()

    # An explicit ``bundle:`` scope confines the result-tree to those bundles' subtree.
    # Two things leak past the asset WHERE otherwise: a folder name-hit (``bundles_matching``
    # ranks by NAME across the whole infospace) and a multi-homed matching asset (its
    # *other* bundles ride along in ``containers()``). Clamp both leaf sources to the
    # scoped subtree; the ancestor walk below still adds the path *above* the scope, so a
    # scoped child folder renders under its parents. ``subtree_ids`` keeps in-scope
    # descendants (a matching sub-folder) and drops the rest.
    group_scopes = [
        set(_resolve_bundle_ids(session, infospace_id, g.bundle_refs))
        for g in parsed.groups_or_self
    ]

    name_hits: set[int] = set()
    for g, g_scope in zip(parsed.groups_or_self, group_scopes):
        g_hits = {b.id for b, _ in bundles_matching(session, infospace_id, g, access_scope)}
        if g_scope:
            g_hits &= subtree_ids(session, g_scope)
        name_hits |= g_hits

    # Only clamp asset containers when *every* OR group is bundle-scoped — an unscoped
    # group legitimately matches assets anywhere and must not be pruned.
    if group_scopes and all(group_scopes):
        asset_leaves &= subtree_ids(session, set().union(*group_scopes))

    participating = ancestor_ids(session, asset_leaves | name_hits)
    return participating, name_hits


def _compute_tree_meta(session, infospace_id: int, access_scope) -> AssetTreeMeta:
    """Compute tree-level browse counts (visible bundles, loose top-level assets).
    ``vfolders`` is held at 0 — folders are real bundles now; the field is removed
    with the cutover client regen."""

    bundle_count_stmt = select(func.count(Bundle.id)).where(Bundle.infospace_id == infospace_id)
    if access_scope is not None and access_scope.bundle_ids:
        bundle_count_stmt = bundle_count_stmt.where(Bundle.id.in_(access_scope.bundle_ids))
    elif access_scope is not None:
        bundle_count_stmt = bundle_count_stmt.where(and_(False))
    bundle_count = session.exec(bundle_count_stmt).one() or 0

    # Loose top-level assets, counted through the SAME scoped predicate _root_query
    # lists (scope + no_bundles + top_level + exclude_superseded) — reusing the
    # AssetQuery primitive rather than a hand-rolled select that drifts. This also
    # closes an access leak: a bundle-only PackageScope makes 0 loose assets visible,
    # so the count must be scoped too (bundles already are, above).
    asset_count = (
        AssetQuery(session, infospace_id)
        .scope(access_scope)
        .top_level_only()
        .no_bundles()
        .exclude_superseded()
        .count()
    )

    return AssetTreeMeta(bundles=bundle_count, assets=asset_count, vfolders=0)
