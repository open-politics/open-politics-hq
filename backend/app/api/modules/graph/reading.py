"""A run read as a graph — configured in one place, for every surface that draws one.

Two surfaces draw a run as a graph: the knowledge-graph panel (through
``/view``'s graph phase) and the network panel (``routes/network.py``). Both
hand this module an :class:`AnnotationQuery` that already says *which rows*,
and get back the same graph for the same query string — so the two can never
disagree about what the run's graph *is*.

    configure(aq, q=…)   →  (source, parsed)   the one place a graph is set up
    collect(aq, source, parsed)  →  GraphResultData   drained, post tiers applied

The query string is split in two before anything else reads it:
``channels.parse_channels`` claims the UPPERCASE bindings (``SECTION:``,
``VECTOR:``…) and ``gql.parse`` the rest. Row-scope clauses ride into the read
query; graph-shape and traversal clauses (``degree``, ``near``, ``hops``) only
exist once the graph is assembled, so :func:`collect` applies them after.

Nothing here knows about Formula. ``/view`` passes the one thing a Formula
still contributes — the legacy triplet field — as an argument.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.graph.schemas import GraphResultData

logger = logging.getLogger(__name__)

__all__ = ["configure", "collect"]


def configure(
    aq: AnnotationQuery,
    *,
    q: str | None = None,
    projections: list[Any] | None = None,
    triplet_field: str | None = None,
    dedup: str = "normalized",
    edge_weight_field: str | None = None,
    edge_weight_mode: str = "count",
    forward_properties: list[Any] | None = None,
    node_group_by: str | None = None,
    edge_group_by: str | None = None,
    null_policy: str = "skip",
    doc_place: str | None = None,
    doc_time: str | None = None,
) -> tuple[Any, Any]:
    """``(source, parsed_gql)`` for the rows *aq* selects.

    With neither ``projections`` nor ``triplet_field``, a schema written in the
    observation model graphs itself: ``resolve_projections`` derives the whole
    set — and the document rung — from the schema map. Raises ``ValueError``
    only when nothing is derivable, because then the caller really has asked
    for a graph of nothing.
    """
    from app.api.modules.annotation.panel_config import derive_doc_anchors, derive_projections
    from app.api.modules.graph import gql as gql_mod
    from app.api.modules.graph.channels import parse_channels, resolve_sections
    from app.api.modules.graph.stream import AnnotationGraphSource

    configured = bool(projections) or bool(triplet_field)
    derive_doc = doc_place is None and doc_time is None and not projections
    smap = None
    if not configured or derive_doc:
        try:
            smap = AnnotationGraphSource(query=aq)._schema_map()
        except Exception:  # noqa: BLE001 — a probe must not sink the graph
            smap = None
    if not configured and not derive_projections(smap):
        raise ValueError(
            "this run's schema declares no graphable section, and no projection "
            "or triplet field was given to graph instead"
        )

    # One string, two halves — see the module docstring. Without the split an
    # UPPERCASE binding fell through gql as FREE TEXT: a substring match on
    # node names that returns a plausible handful of nodes and no error.
    chans = parse_channels(q or "")
    parsed = gql_mod.parse(chans.rest)

    # An unconfigured graph gets the document rung derived too. An explicit
    # setting always wins.
    if derive_doc:
        derived = derive_doc_anchors(smap)
        doc_place, doc_time = derived["doc_place"], derived["doc_time"]

    source = AnnotationGraphSource(
        query=aq,
        projections=list(projections or []),
        triplet_field=triplet_field,
        dedup=dedup,
        edge_weight_field=edge_weight_field,
        edge_weight_mode=edge_weight_mode,
        forward_properties=list(forward_properties or []),
        node_group_by=node_group_by,
        edge_group_by=edge_group_by,
        null_policy=null_policy,
        doc_place=doc_place,
        doc_time=doc_time,
        gql=parsed if not parsed.is_empty else None,
    )
    source.channels = chans

    # `SECTION:places` → `field:document.places[*]`. Resolved here, not in the
    # parser, because it needs the run's projections — the point of the alias
    # is that the analyst names the section and the engine finds the path.
    # Folded into the same parsed query, so a skipped projection is a scan that
    # never happens.
    try:
        source._resolve()
        fields = resolve_sections(chans, list(source.projections or []))
        if fields:
            parsed.fields.extend(f for f in fields if f not in parsed.fields)
            source.gql = parsed
    except Exception:  # noqa: BLE001 — an alias must not break a graph
        logger.warning("SECTION: could not resolve to a projection", exc_info=True)

    return source, parsed


def collect(
    aq: AnnotationQuery,
    source: Any,
    parsed: Any,
    *,
    top_n_nodes: int | None = None,
    top_n_edges: int | None = None,
) -> GraphResultData:
    """Drain *source* into one graph, then apply the post-aggregation tiers.

    Synchronous: callers run it in a worker thread, where spinning up a fresh
    event loop for the streaming engine is safe.
    """
    from app.api.modules.graph import gql as gql_mod
    from app.api.modules.graph.stream import collect_graph

    result = asyncio.run(collect_graph(
        aq._session, aq._infospace_id, source,
        top_n_nodes=top_n_nodes, top_n_edges=top_n_edges,
    ))
    if parsed.has_post:
        nodes, edges = gql_mod.apply_to_graph(parsed, result.nodes, result.edges)
        result = GraphResultData(nodes=nodes, edges=edges)
    return result
