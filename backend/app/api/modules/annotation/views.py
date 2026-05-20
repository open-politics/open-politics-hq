"""Annotation views — progressive stream generators + envelope collectors.

Sibling to ``content/views.py`` in the annotation domain. Drives the ``/view``
endpoint with the same event shape used by tree / search / feed.

Three render functions (rows / aggregate / graph) yield unified
``StreamEvent`` variants. ``collect_X`` helpers drain the stream for blocking
JSON callers.

The annotation domain uses existing shapes where possible:
  - rows    → SectionEvent(role='primary') carrying ListingSection[AnnotationRow]
  - aggregate → AggregateSectionEvent
  - graph   → GraphSectionEvent (blocking) or GraphChunkEvent* (streaming)
"""

from __future__ import annotations

import logging
from typing import AsyncIterator, Literal

from pydantic import BaseModel, Field, field_validator

from app.api.modules.annotation.panel_config import ForwardPropertySpec
from app.api.modules.annotation.query import (
    AggregateResult,
    AnnotationQuery,
    AnnotationRow,
    GraphResult,
    ResultsPage,
)
from app.api.modules.content.schemas import (
    AggregateBucketEntry,
    AggregateSectionEvent,
    CountEvent,
    DoneEvent,
    GraphChunkEvent,
    GraphSectionEvent,
    ListingSection,
    SectionEvent,
    SkeletonEvent,
    StreamEvent,
)

logger = logging.getLogger(__name__)


# ─── Per-materialization config (mirrors /view request body) ────────────────


class AggregateViewConfig(BaseModel):
    group_by: str
    interval: str | None = None
    function: str = "count"
    value_field: str | None = None
    top_n: int | None = None
    # Second-dimension grouping (grouped timeline, clustered bar, small
    # multiples). Shares the ``group_by`` explosion context — see the
    # ``AnnotationQuery.aggregate`` docstring for rules.
    split_by: str | None = None


class GraphViewConfig(BaseModel):
    """Configuration for a graph materialization on the ``/view`` endpoint.

    Shape-compatible with ``panel_config.GraphPanelSettings`` so the frontend
    can persist and request the same settings. The ``stream`` flag decides the
    render path inside ``render_graph`` (stream chunks vs emit a single
    section) — routes set it based on whether SSE or JSON was requested.
    """

    triplet_field: str
    dedup: Literal["exact", "normalized"] = "exact"
    top_n_nodes: int | None = 1000
    top_n_edges: int | None = 5000
    chunk_size: int = 500
    stream: bool = True

    # Expanded role fields (wired in Phase 0). All optional — absent means
    # "default to count-based edge weight, no property forwarding, no grouping."
    edge_weight_field: str | None = None
    edge_weight_mode: Literal[
        "count",
        "property",
        "sum_property",
        "avg_property",
        "max_property",
        "count_times_property",
    ] = "count"
    forward_properties: list[ForwardPropertySpec] = Field(default_factory=list)
    node_group_by: str | None = None
    edge_group_by: str | None = None
    null_policy: Literal["skip", "zero"] = "skip"

    @field_validator("forward_properties")
    @classmethod
    def _cap_forward_properties(cls, v: list[ForwardPropertySpec]) -> list[ForwardPropertySpec]:
        if len(v) > 5:
            raise ValueError(
                f"forward_properties capped at 5; got {len(v)}. "
                "Extra fields would inflate per-edge payload at scale."
            )
        return v


# ─── render_rows ────────────────────────────────────────────────────────────


async def render_rows(query: AnnotationQuery) -> AsyncIterator[StreamEvent]:
    """Progressive row stream for annotation listings.

    Emits: skeleton → section(role='primary') → count → done.
    """
    yield SkeletonEvent(family="annotation_rows")

    page: ResultsPage = query.results()

    yield SectionEvent(role="primary", section=page)

    yield CountEvent(total=page.total)

    yield DoneEvent()


# ─── render_aggregate ───────────────────────────────────────────────────────


async def render_aggregate(
    query: AnnotationQuery,
    config: AggregateViewConfig,
) -> AsyncIterator[StreamEvent]:
    """Progressive aggregate stream for annotation groupings.

    Emits: skeleton → aggregate → done.
    """
    yield SkeletonEvent(family="annotation_aggregate")

    agg: AggregateResult = query.aggregate(
        config.group_by,
        interval=config.interval,
        function=config.function,
        value_field=config.value_field,
        top_n=config.top_n,
        split_by=config.split_by,
    )

    yield AggregateSectionEvent(
        buckets=[
            AggregateBucketEntry(
                key=b.key,
                count=b.count,
                stats=b.stats,
                split_value=b.split_value,
            )
            for b in agg.buckets
        ],
        field_path=agg.field_path,
        interval=agg.interval,
        total_count=agg.total_count,
        split_field_path=agg.split_field_path,
    )

    yield DoneEvent()


# ─── render_graph ───────────────────────────────────────────────────────────


async def render_graph(
    query: AnnotationQuery,
    config: GraphViewConfig,
) -> AsyncIterator[StreamEvent]:
    """Progressive graph stream.

    stream=True: skeleton → graph_chunk* → done  (bounded, progressive)
    stream=False: skeleton → graph → done        (blocking, single payload)
    """
    yield SkeletonEvent(family="annotation_graph")

    if config.stream:
        async for chunk in query.graph_stream(
            config.triplet_field,
            dedup=config.dedup,
            top_n_nodes=config.top_n_nodes,
            top_n_edges=config.top_n_edges,
            chunk_size=config.chunk_size,
        ):
            yield GraphChunkEvent(nodes=chunk.nodes, edges=chunk.edges)
    else:
        gr: GraphResult = query.graph(
            config.triplet_field,
            dedup=config.dedup,
            top_n_nodes=config.top_n_nodes,
            top_n_edges=config.top_n_edges,
        )
        yield GraphSectionEvent(nodes=gr.nodes, edges=gr.edges)

    yield DoneEvent()


# ─── collect_* (JSON envelope path) ─────────────────────────────────────────


async def collect_rows(query: AnnotationQuery) -> ResultsPage:
    """Drain render_rows into a ResultsPage. The primitive is the same —
    ``render_rows`` wraps a ``query.results()`` call; this helper exists so
    callers can grab the envelope without touching events."""
    return query.results()


async def collect_aggregate(
    query: AnnotationQuery, config: AggregateViewConfig,
) -> AggregateResult:
    """Drain render_aggregate into a full AggregateResult."""
    return query.aggregate(
        config.group_by,
        interval=config.interval,
        function=config.function,
        value_field=config.value_field,
        top_n=config.top_n,
        split_by=config.split_by,
    )


async def collect_graph(
    query: AnnotationQuery, config: GraphViewConfig,
) -> GraphResult:
    """Drain render_graph into a full GraphResult.

    Always bounded by ``top_n_*``. Walks the streaming path under the hood so
    memory stays safe even for large runs. All GraphViewConfig aggregation
    fields (edge_weight_*, forward_properties, *_group_by, null_policy) flow
    into the source so the result matches the SSE streaming output exactly.
    """
    from app.api.modules.graph.stream import AnnotationGraphSource, collect_graph as _collect
    source = AnnotationGraphSource(
        query=query,
        triplet_field=config.triplet_field,
        dedup=config.dedup,
        edge_weight_field=config.edge_weight_field,
        edge_weight_mode=config.edge_weight_mode,
        forward_properties=list(config.forward_properties or []),
        node_group_by=config.node_group_by,
        edge_group_by=config.edge_group_by,
        null_policy=config.null_policy,
    )
    return await _collect(
        query._session, query._infospace_id, source,
        top_n_nodes=config.top_n_nodes,
        top_n_edges=config.top_n_edges,
        chunk_size=config.chunk_size,
    )
