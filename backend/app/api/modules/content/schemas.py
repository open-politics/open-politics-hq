"""Response shapes + SSE wire protocol for content views.

Canonical for tree, search, feed. Items are ``AssetNode`` regardless of context;
sections are ``ListingSection[T]``; envelopes are ``Asset{Tree,Search,Feed}``.
Wire protocol is one discriminated union ``StreamEvent``.

The annotation domain re-uses ``ListingSection`` (via ``ResultsPage``), the
``section`` / ``count`` / ``done`` / ``aggregate`` / ``graph`` / ``graph_chunk``
variants, but keeps its domain-specific item types in
``modules/annotation/query.py``.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Annotated, Any, Generic, Literal, TypeVar, Union

from pydantic import BaseModel, ConfigDict, Field

from app.api.modules.content.models import AssetKind, ProcessingStatus
from app.api.modules.graph.schemas import GraphEdgeData, GraphNodeData


# ─── Parsed AQL contract ────────────────────────────────────────────────────
# The structured form of an asset-query-language string: produced by
# ``content.query.parse`` (the engine), consumed by ``AssetQuery.from_aql``, and
# exposed to the frontend (the ``parsed`` field on AssetSearch, for pill rendering).
# Dataclasses, not pydantic — a pure internal contract with a hand-written
# ``to_dict``; the wire models below carry it as an arbitrary-type field.


@dataclass
class AnnotationFilter:
    field: str
    op: str  # ==, !=, >=, >, <=, <
    value: str
    negated: bool = False


@dataclass
class SemanticClause:
    text: str
    threshold: float | None = None
    threshold_op: str | None = None  # >, >=, <, <=


@dataclass
class ParsedQuery:
    # Free text — passed directly to websearch_to_tsquery (handles quotes, -, or)
    text: str = ""
    # Semantic search on asset embeddings
    semantic: SemanticClause | None = None
    # Filters
    kinds: list[str] = field(default_factory=list)
    excluded_kinds: list[str] = field(default_factory=list)
    date_after: str | None = None
    date_before: str | None = None
    bundle_refs: list[str] = field(default_factory=list)
    asset_refs: list[str] = field(default_factory=list)
    # Entities — inner list = OR, outer list = AND
    entities: list[list[str]] = field(default_factory=list)
    entity_negations: list[str] = field(default_factory=list)
    entity_semantic: SemanticClause | None = None
    # Tags
    tags: list[str] = field(default_factory=list)
    # Annotations
    annotations: list[AnnotationFilter] = field(default_factory=list)
    run_ids: list[int] = field(default_factory=list)
    # Children display: None = default (3/parent), 0 = hide, N = up to N/parent
    children_limit: int | None = None

    @property
    def has_text(self) -> bool:
        return bool(self.text.strip())

    @property
    def has_semantic(self) -> bool:
        return self.semantic is not None or self.entity_semantic is not None

    @property
    def has_filters(self) -> bool:
        return bool(
            self.kinds or self.excluded_kinds or self.date_after or self.date_before
            or self.bundle_refs or self.asset_refs or self.entities or self.entity_negations
            or self.entity_semantic or self.annotations or self.run_ids or self.tags
        )

    @property
    def is_empty(self) -> bool:
        return not self.has_text and not self.has_semantic and not self.has_filters

    def to_dict(self) -> dict:
        """Parsed structure for frontend pill rendering."""
        d: dict = {}
        if self.text:
            d["text"] = self.text
        if self.semantic:
            d["semantic"] = _semantic_dict(self.semantic)
        if self.kinds:
            d["kinds"] = self.kinds
        if self.excluded_kinds:
            d["excluded_kinds"] = self.excluded_kinds
        if self.date_after:
            d["date_after"] = self.date_after
        if self.date_before:
            d["date_before"] = self.date_before
        if self.bundle_refs:
            d["bundle_refs"] = self.bundle_refs
        if self.asset_refs:
            d["asset_refs"] = self.asset_refs
        if self.entities:
            d["entities"] = self.entities
        if self.entity_negations:
            d["entity_negations"] = self.entity_negations
        if self.entity_semantic:
            d["entity_semantic"] = _semantic_dict(self.entity_semantic)
        if self.tags:
            d["tags"] = self.tags
        if self.annotations:
            d["annotations"] = [
                {"field": a.field, "op": a.op, "value": a.value, **({"negated": True} if a.negated else {})}
                for a in self.annotations
            ]
        if self.run_ids:
            d["run_ids"] = self.run_ids
        if self.children_limit is not None:
            d["children_limit"] = self.children_limit
        return d


def _semantic_dict(s: SemanticClause) -> dict:
    d: dict = {"text": s.text}
    if s.threshold is not None:
        d["threshold"] = s.threshold
    if s.threshold_op:
        d["op"] = s.threshold_op
    return d


T = TypeVar("T")


# ─── Item + match primitives ────────────────────────────────────────────────


class AssetPreview(BaseModel):
    """Display-ready projection of an asset."""

    thumbnail_url: str | None = None
    snippet: str | None = None
    primary_field: str | None = None


class AssetMatch(BaseModel):
    """Structured evidence of a single match site.

    A search hit can carry multiple matches (title + body chunk + entity etc.);
    each carries its field, score, and optional location/snippet.
    """

    field: Literal["title", "body", "chunk", "annotation", "entity", "facet"]
    # None for exact matches (e.g. a title hit) where a relevance % is meaningless.
    score: float | None = None
    snippet: str | None = None
    location: dict[str, int] | None = None


class AssetNode(BaseModel):
    """Polymorphic tree/search/feed item. Structural identity + optional match evidence."""

    model_config = ConfigDict(use_enum_values=True)

    # Identity
    id: str
    type: Literal["bundle", "asset", "virtual_folder"]
    name: str
    kind: AssetKind | None = None

    # Structural signals
    has_children: bool = False
    children_count: int | None = None
    asset_count: int | None = None
    child_bundle_count: int | None = None
    sealed: bool | None = None
    stub: bool | None = None
    processing_status: ProcessingStatus | None = None

    # Hierarchy
    parent_asset_id: int | None = None
    bundle_ids: list[int] | None = None
    part_index: int | None = None
    path_prefix: str | None = None

    # Display
    tags: list[str] | None = None
    facets: dict[str, Any] | None = None
    preview: AssetPreview | None = None

    # Match evidence
    score: float | None = None
    matches: list[AssetMatch] = Field(default_factory=list)

    # Timestamps
    created_at: datetime | None = None
    updated_at: datetime


# ─── Generic section ────────────────────────────────────────────────────────


class ListingSection(BaseModel, Generic[T]):
    """One page of items in a listing. Generic over item type.

    total=-1 during the first event of a progressive listing (count pending);
    >=0 once count resolves. Never None, never 0 as a sentinel.
    """

    at_parent: str | None = None
    items: list[T]
    total: int
    has_more: bool = False
    cursor_next: str | None = None


# ─── Tree family ────────────────────────────────────────────────────────────


class AssetTreeBundleSkeleton(BaseModel):
    id: int
    name: str
    parent_id: int | None = None
    tags: list[str] | None = None


class AssetTreeNav(BaseModel):
    """Flat bundle registry. Client indexes by id in O(1), rebuilds hierarchy
    via parent_id in one O(n) pass."""

    bundles: list[AssetTreeBundleSkeleton]


class AssetTreeMeta(BaseModel):
    bundles: int
    assets: int
    vfolders: int


class AssetTree(BaseModel):
    nav: AssetTreeNav
    section: ListingSection[AssetNode]
    meta: AssetTreeMeta | None = None


# ─── Search family ──────────────────────────────────────────────────────────


class AssetSearchMeta(BaseModel):
    query: str
    parsed: ParsedQuery | None = None
    mode: str
    timing_ms: int | None = None

    model_config = ConfigDict(arbitrary_types_allowed=True)


class AssetSearch(BaseModel):
    primary: ListingSection[AssetNode]
    grouped: list[ListingSection[AssetNode]] = Field(default_factory=list)
    meta: AssetSearchMeta


# ─── Feed family ────────────────────────────────────────────────────────────


class AssetFeedMeta(BaseModel):
    cursor: str | None = None
    cutoff: datetime | None = None


class AssetFeed(BaseModel):
    section: ListingSection[AssetNode]
    meta: AssetFeedMeta | None = None


# ─── Wire protocol — StreamEvent discriminated union ────────────────────────


class SkeletonEvent(BaseModel):
    """First event in every stream. Optional; frontend may skip it."""

    name: Literal["skeleton"] = "skeleton"
    family: Literal[
        "tree",
        "search",
        "feed",
        "annotation_rows",
        "annotation_aggregate",
        "annotation_graph",
    ]


class NavEvent(BaseModel):
    """Tree-only. Flat bundle registry."""

    name: Literal["nav"] = "nav"
    nav: AssetTreeNav


class SectionEvent(BaseModel):
    """One section payload. ``role`` disambiguates.

    The section carries either ``AssetNode`` items (content domain) or
    ``AnnotationRow`` items (annotation domain). ``name`` + ``role`` are enough
    to drive frontend routing; the item schema follows from the view's family.

    Pydantic typing: the union across item types can't be expressed without
    triggering import cycles (AnnotationRow lives in annotation.query, which
    imports ListingSection from here). We accept any ``ListingSection`` at
    the schema boundary; render-side code only ever constructs the correct
    concrete instantiation, and the outgoing JSON carries the right items
    either way.
    """

    model_config = ConfigDict(arbitrary_types_allowed=True)

    name: Literal["section"] = "section"
    role: Literal["primary", "grouped", "level"]
    section: ListingSection


class AggregateBucketEntry(BaseModel):
    """Single bucket in an aggregate result (wire-side projection).

    Kept in-file to avoid a round-trip through ``modules/annotation/query.py``
    for the common aggregate case; the ``AggregateResult`` domain type is
    still owned by annotation.

    ``split_value`` is populated when the query carried a ``split_by`` —
    the frontend groups buckets by ``(key, split_value)`` to pivot into
    series (grouped timeline, clustered bars, small multiples).
    """

    key: str
    count: int
    stats: dict[str, Any] | None = None
    split_value: str | None = None


class AggregateSectionEvent(BaseModel):
    """Annotation-specific. Event name ``aggregate`` preserved from /view."""

    name: Literal["aggregate"] = "aggregate"
    buckets: list[AggregateBucketEntry]
    field_path: str
    interval: str | None = None
    total_count: int
    split_field_path: str | None = None


class GraphSectionEvent(BaseModel):
    """Annotation/persistent graph — blocking variant. Event name ``graph`` preserved."""

    name: Literal["graph"] = "graph"
    nodes: list[GraphNodeData]
    edges: list[GraphEdgeData]


class GraphChunkEvent(BaseModel):
    """Annotation/persistent graph — streaming variant. NEW in v2."""

    name: Literal["graph_chunk"] = "graph_chunk"
    nodes: list[GraphNodeData]
    edges: list[GraphEdgeData]


class CountEvent(BaseModel):
    """Resolves the -1 sentinel on a prior section."""

    name: Literal["count"] = "count"
    total: int
    at_parent: str | None = None


class DoneEvent(BaseModel):
    """End of stream. Client unsubscribes."""

    name: Literal["done"] = "done"


class ErrorEvent(BaseModel):
    """Error within a stream. Stream may continue or end."""

    name: Literal["error"] = "error"
    detail: str


StreamEvent = Annotated[
    Union[
        SkeletonEvent,
        NavEvent,
        SectionEvent,
        AggregateSectionEvent,
        GraphSectionEvent,
        GraphChunkEvent,
        CountEvent,
        DoneEvent,
        ErrorEvent,
    ],
    Field(discriminator="name"),
]


# ─── Request shapes ─────────────────────────────────────────────────────────


class AssetSearchScopeHints(BaseModel):
    """Optional user-facing filters. NOT access scope."""

    bundle_ids: list[int] = Field(default_factory=list)
    asset_ids: list[int] = Field(default_factory=list)
    kinds: list[AssetKind] = Field(default_factory=list)
    date_from: datetime | None = None
    date_to: datetime | None = None
    facets: dict[str, Any] = Field(default_factory=dict)
    parent_asset_id: int | None = None


class AssetSearchRequest(BaseModel):
    q: str
    mode: str = "text"  # text | vector | hybrid | filter
    limit: int = 25
    cursor: str | None = None
    sort: str = "relevance"
    scope_hints: AssetSearchScopeHints = Field(default_factory=AssetSearchScopeHints)
    # Lead the results with ranked folder (bundle) name-matches — opt-in, for
    # discovery surfaces (explore, the tree/picker). Off for asset-only callers
    # (CSV-row drilldown, feeds, the chat search tool) so folders never intrude.
    include_folders: bool = False


class AssetFeedRequest(BaseModel):
    kinds: list[AssetKind] = Field(default_factory=list)
    bundle_id: int | None = None
    path_prefix: str | None = None
    limit: int = 25
    cursor: str | None = None
    sort: str = "created_at_desc"


class ActionAcceptedResponse(BaseModel):
    """Standard shape returned by every user-initiated action endpoint."""

    task_id: str
    watch_url: str


# ─── Forward-reference resolution ───────────────────────────────────────────
#
# SectionEvent.section and the Graph* events reference types that live in
# other modules (``annotation/query.py``, ``graph/schemas.py``). We rebuild
# the models after those modules have been imported so Pydantic can resolve
# the forward refs. Imports are deferred to this block to avoid circular
# import cycles at package load time.

def _rebuild_models() -> None:
    """Compatibility shim.

    SectionEvent used to carry a union that named ``AnnotationRow`` from
    ``annotation.query``, forcing a rebuild after those modules were
    loaded. It now takes a plain ``ListingSection``, so no post-init
    rebuild is needed. Kept for callers that may still invoke it.
    """
    return None
