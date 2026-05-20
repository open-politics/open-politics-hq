"""Unified chunked graph streaming.

One streaming engine. Two data-source variants:
  - ``AnnotationGraphSource``   — ephemeral, scans annotation triplet arrays
  - ``PersistentGraphSource``   — materialized, reads the ``GraphEdge`` table

Both yield ``GraphChunk(nodes, edges)`` progressively. Callers cap the stream
via ``top_n_nodes`` / ``top_n_edges`` so the full graph never has to load
into Python.

Used by:
  - ``AnnotationQuery.graph()`` — delegates to ``stream_graph(AnnotationGraphSource(...))``
  - Future persistent-graph routes — ``stream_graph(PersistentGraphSource(...))``

Collection is a drain: ``collect_graph`` assembles a ``GraphResult`` from the
chunk iterator (bounded by the same caps).
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Literal, Protocol, runtime_checkable

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation.panel_config import ForwardPropertySpec
from app.api.modules.graph.schemas import (
    GraphChunkData as GraphChunk,
    GraphEdgeData as GraphEdge,
    GraphNodeData as GraphNode,
    GraphResultData as GraphResult,
)
from app.core.filters import jsonb_accessor, jsonb_value_accessor, parse_explosion, safe_array_elements

logger = logging.getLogger(__name__)


# ─── Row shape ──────────────────────────────────────────────────────────────


@dataclass
class TripletRow:
    """One triplet as seen by a source's window iterator.

    Sources normalize their rows into this shape; ``stream_graph`` accumulates
    them without caring which backend produced them.

    The ``properties`` bag carries optional per-row values extracted from the
    triplet or annotation context (forward-property values, group-by values,
    edge-weight source). Keys used by ``stream_graph``:

    - ``_edge_weight_raw`` (float | None): raw value of ``edge_weight_field``
    - ``_edge_group`` (str | None): ``edge_group_by`` value (becomes part of edge key)
    - ``_node_group_subj`` / ``_node_group_obj`` (str | None): ``node_group_by``
      values for subject / object (first-seen per node wins)
    - ``fp__<field>`` (Any): forward-property raw values, one per field
    """

    annotation_id: int
    subject_name: str
    subject_type: str
    predicate: str
    object_name: str
    object_type: str
    weight: int = 1
    properties: dict[str, Any] = field(default_factory=dict)


# ─── GraphSource protocol ───────────────────────────────────────────────────


@runtime_checkable
class GraphSource(Protocol):
    """Iterator shape that ``stream_graph`` consumes."""

    async def windows(self, chunk_size: int) -> AsyncIterator[list[TripletRow]]:
        """Yield successive windows of triplet rows until the source is exhausted."""
        ...


# ─── AnnotationGraphSource (ephemeral) ──────────────────────────────────────


@dataclass
class AnnotationGraphSource:
    """Ephemeral source: scans annotation.value→<triplet_field> via LATERAL.

    Keeps the ``AnnotationQuery`` so scope, filters, merge-maps, and run/schema
    selection flow through a single codepath. Windows by annotation id — each
    window covers at most ``chunk_size`` annotation ids beyond the last cursor.

    Optional extensions (all default to "off"):

    - ``edge_weight_field`` / ``edge_weight_mode``: numeric triplet property
      drives ``computed_weight`` on emitted edges. ``edge_weight_mode`` picks
      the aggregation semantics within stream_graph.
    - ``forward_properties``: triplet properties to surface on edges.
    - ``edge_group_by``: adds a column to the per-edge aggregation key so the
      same triplet appears in multiple buckets (one per distinct group value).
    - ``node_group_by``: attached to node payload; first-seen wins per node.
    - ``null_policy``: how numeric casts of empty / null triplet values behave.
    """

    query: "AnnotationQuery"           # noqa: F821 — forward ref to avoid import cycle
    triplet_field: str
    dedup: Literal["exact", "normalized"] = "exact"
    edge_weight_field: str | None = None
    edge_weight_mode: Literal[
        "count",
        "property",
        "sum_property",
        "avg_property",
        "max_property",
        "count_times_property",
    ] = "count"
    forward_properties: list[ForwardPropertySpec] = field(default_factory=list)
    node_group_by: str | None = None
    edge_group_by: str | None = None
    null_policy: Literal["skip", "zero"] = "skip"

    async def windows(self, chunk_size: int) -> AsyncIterator[list[TripletRow]]:
        from app.api.modules.annotation.query import AnnotationQuery  # local import

        if not isinstance(self.query, AnnotationQuery):
            raise TypeError("AnnotationGraphSource.query must be an AnnotationQuery")

        session = self.query._session

        # Tuple cursor (annotation_id, ordinality_within_annotation). Required
        # because LATERAL fans one annotation into many rows; cursoring on
        # ``a.id`` alone would skip the tail of any annotation whose triplet
        # array overflows the LIMIT (the last annotation in a batch loses
        # every triplet that didn't fit). PG's WITH ORDINALITY exposes a
        # 1-based row number per LATERAL element, which we cursor on as a
        # secondary key.
        last_id: int | None = None
        last_ord: int | None = None
        while True:
            # Build WHERE from the query's scope/filters/merges — this is the
            # single source of truth for what rows are visible. Re-run each
            # window so the exit condition is 'no more rows' not 'cursor
            # exceeded', and so `paginate()` doesn't interfere.
            clauses, params = self.query._base_where(include_cursor=False)
            self.query._apply_conditions(
                clauses, params,
                element_alias="triplet",
                active_explosion=self.triplet_field,
            )

            if last_id is not None:
                # Strict tuple-after under ORDER BY (a.id DESC, ord ASC):
                # next row is either at a smaller a.id, or same a.id with
                # higher ord. Equivalent to (a.id, -ord) < (last_id, -last_ord)
                # but expressed in directly-indexable form.
                clauses.append(
                    "(a.id < :stream_cursor_id "
                    "OR (a.id = :stream_cursor_id "
                    "AND triplet_idx.ord > :stream_cursor_ord))"
                )
                params["stream_cursor_id"] = last_id
                params["stream_cursor_ord"] = last_ord

            # Parse the triplet field path. The RolePicker writes paths like
            # ``document.triplets[*]`` or ``triplets[*]``; both must resolve
            # to SQL that navigates the annotation's JSONB value. The trailing
            # ``[*]`` is the explosion marker we consume with LATERAL.
            #
            # Three storage conventions coexist in the wild and all must be
            # handled — see ``core.filters.jsonb_value_accessor``:
            #   (A) flat key:        ``{"document.triplets": [...]}``
            #   (B) nested path:     ``{"document": {"triplets": [...]}}``
            #   (C) unwrapped root:  ``{"triplets": [...]}`` (when the
            #       schema declares ``document.triplets`` but the annotation
            #       runner merged the ``document`` envelope into the root —
            #       common; see annotation/tasks/annotate.py).
            # ``jsonb_value_accessor`` COALESCEs across all three so the
            # graph works regardless of which shape was materialized.
            where = " AND ".join(clauses)
            triplet_path = self.triplet_field.rstrip()
            if triplet_path.endswith("[*]"):
                triplet_path = triplet_path[:-3]
            triplet_parts = [p for p in triplet_path.split(".") if p]
            if not triplet_parts:
                raise ValueError(
                    f"triplet_field resolved to empty path: {self.triplet_field!r}",
                )
            normalized_triplet = ".".join(triplet_parts)
            lateral_expr, lateral_params = jsonb_value_accessor(
                "a.value", normalized_triplet, param_name="trip_path",
            )
            params.update(lateral_params)
            # Store the normalized dotted form for _path_accessor comparisons.
            self._normalized_triplet_field = normalized_triplet

            # Build the extended SELECT with optional columns for
            # edge_weight / forward_properties / group_by.
            #
            # ``edge_weight_field`` and ``forward_properties`` are always
            # triplet-scoped — the field names are keys inside the triplet
            # object (e.g. ``"confidence"``, ``"weight"``). The user writes
            # the bare key, not a path.
            #
            # ``edge_group_by`` and ``node_group_by`` use the full path
            # grammar: bare identifiers resolve against annotation root
            # (``a.value``), ``triplets[*].<field>`` resolves on the lateral
            # ``triplet`` alias.
            # Normalize triplet-scoped fields to bare keys. Users who pick
            # through the schema walker end up with paths like
            # ``document.triplets[*].weight`` — we want the last segment
            # (``weight``) since the LATERAL element is already the triplet
            # object. See ``_as_triplet_key`` docstring.
            extra_selects: list[str] = []
            if self.edge_weight_field:
                tf = _as_triplet_key(self.edge_weight_field).replace("'", "''")
                extra_selects.append(
                    f"NULLIF(triplet->>'{tf}', '')::float AS edge_weight_raw"
                )
            for i, fp in enumerate(self.forward_properties):
                bare = _as_triplet_key(fp.field)
                tf = bare.replace("'", "''")
                safe_alias = _safe_col_alias(bare, f"fp_{i}")
                extra_selects.append(f"triplet->>'{tf}' AS {safe_alias}")
            if self.edge_group_by:
                acc, eg_params = self._path_accessor(
                    self.edge_group_by, param_prefix="egfp",
                )
                params.update(eg_params)
                extra_selects.append(f"{acc} AS edge_group_raw")
            if self.node_group_by:
                acc, ng_params = self._path_accessor(
                    self.node_group_by, param_prefix="ngfp",
                )
                params.update(ng_params)
                # Same value flows to both subject and object node-group slots;
                # stream_graph disambiguates first-seen per entity id.
                extra_selects.append(f"{acc} AS node_group_raw")
            # Inline per-item justification — always pulled (cheap; missing on
            # triplets without the toggle, but stream_graph filters None).
            extra_selects.append("triplet->'justification' AS inline_justification")

            extra_cols_sql = ("," + ", ".join(extra_selects)) if extra_selects else ""

            # Triplet shape inference. Schemas use different conventions for
            # subject / predicate / object keys (`subject_name` vs `subject`,
            # `source` / `target`, `predicate` vs `relation`). Rather than
            # hardcode, COALESCE across the common aliases so any schema
            # whose triplet items expose one of these keys "just works".
            # Order: more-specific first (so `_name` wins over the bare key).
            subj_sql  = _triplet_key_sql("subject")
            stype_sql = _triplet_type_sql("subject")
            pred_sql  = _triplet_predicate_sql()
            obj_sql   = _triplet_key_sql("object")
            otype_sql = _triplet_type_sql("object")

            sql = text(f"""
                SELECT
                    a.id AS annotation_id,
                    triplet_idx.ord AS triplet_ord,
                    {subj_sql}  AS subject_name,
                    {stype_sql} AS subject_type,
                    {pred_sql}  AS predicate,
                    {obj_sql}   AS object_name,
                    {otype_sql} AS object_type
                    {extra_cols_sql}
                FROM annotation a, LATERAL jsonb_array_elements(
                    {safe_array_elements(lateral_expr)}
                ) WITH ORDINALITY AS triplet_idx(triplet, ord)
                WHERE {where}
                  AND {subj_sql} IS NOT NULL
                  AND {obj_sql}  IS NOT NULL
                ORDER BY a.id DESC, triplet_idx.ord ASC
                LIMIT :stream_lim
            """).bindparams(**params, stream_lim=chunk_size)

            rows = session.exec(sql).all()
            if not rows:
                return

            batch: list[TripletRow] = []
            for row in rows:
                # Pass strings through with original casing. Normalization
                # for dedup keying happens in ``stream_graph`` so display
                # names retain their first-seen capitalization. (Earlier the
                # lowercasing happened here, which made every entity render
                # lowercased on the wire even though node IDs are
                # case-insensitive anyway.)
                s_name = row.subject_name or ""
                o_name = row.object_name or ""
                pred = row.predicate or ""
                s_type = row.subject_type or ""
                o_type = row.object_type or ""

                props: dict[str, Any] = {}
                if self.edge_weight_field:
                    # row.edge_weight_raw is already float | None (NULLIF::float)
                    props["_edge_weight_raw"] = getattr(row, "edge_weight_raw", None)
                if self.edge_group_by:
                    props["_edge_group"] = getattr(row, "edge_group_raw", None)
                if self.node_group_by:
                    ng_val = getattr(row, "node_group_raw", None)
                    # Both node slots see the same annotation-level value; if
                    # node_group_by is triplet-scoped, it still describes the
                    # instance, not the node — first-seen per node wins.
                    props["_node_group_subj"] = ng_val
                    props["_node_group_obj"] = ng_val
                for i, fp in enumerate(self.forward_properties):
                    bare = _as_triplet_key(fp.field)
                    safe_alias = _safe_col_alias(bare, f"fp_{i}")
                    props[f"fp__{bare}"] = getattr(row, safe_alias, None)

                inline_just = getattr(row, "inline_justification", None)
                if isinstance(inline_just, dict) and inline_just:
                    props["_inline_justification"] = inline_just

                batch.append(TripletRow(
                    annotation_id=row.annotation_id,
                    subject_name=s_name,
                    subject_type=s_type,
                    predicate=pred,
                    object_name=o_name,
                    object_type=o_type,
                    properties=props,
                ))

            yield batch

            # Advance the tuple cursor to the last (annotation_id, ord) in
            # this batch. Under ``ORDER BY a.id DESC, ord ASC`` the last row
            # is the strictly-after continuation point regardless of how
            # many triplets each annotation contributed.
            last_id = rows[-1].annotation_id
            last_ord = rows[-1].triplet_ord

            if len(rows) < chunk_size:
                return

    def _path_accessor(
        self,
        path: str,
        *,
        param_prefix: str,
    ) -> tuple[str, dict[str, Any]]:
        """Resolve a dotted path to a SQL text accessor.

        Triplet-scoped paths (the array prefix matches the triplet field) are
        evaluated on the lateral-joined ``triplet`` alias; annotation-root
        paths evaluate on ``a.value``. One ``[*]`` max per path — the
        ``core/filters._PATH_RE`` grammar enforces this.

        We compare against the normalized triplet path (``document.triplets``)
        rather than the raw ``triplet_field`` since the user-supplied form
        may include the ``[*]`` marker.
        """
        ep = parse_explosion(path)
        normalized_triplet = getattr(self, "_normalized_triplet_field", None)
        if normalized_triplet is None:
            # Compute once if we got here before `windows()` ran (tests).
            tp = self.triplet_field.rstrip()
            if tp.endswith("[*]"):
                tp = tp[:-3]
            normalized_triplet = tp

        if ep.is_exploded:
            if ep.array_field == normalized_triplet:
                # Inside the triplet itself — use the element alias.
                return jsonb_accessor("triplet", ep.remainder or "", param_name=param_prefix)
            # Different array — not supported in v1 (would require a second
            # lateral join). Fall back to the annotation root.
            logger.warning(
                "AnnotationGraphSource: path %r references a different "
                "array than triplet_field=%r; evaluating at annotation root",
                path, self.triplet_field,
            )
            return jsonb_accessor(
                "a.value", ep.array_field or path, param_name=param_prefix,
            )
        # Annotation-root path (scalar field on annotation.value).
        return jsonb_accessor("a.value", path, param_name=param_prefix)


# ─── Triplet-key inference ──────────────────────────────────────────────────
#
# Schemas in the wild use different naming conventions for a triplet's
# subject / predicate / object. We COALESCE across the common aliases so the
# streamer doesn't need to be told which keys the schema uses. Order matters:
# more-specific names (with a ``_name`` / ``_type`` suffix) win over bare keys
# so triplet items that carry BOTH (``subject`` + ``subject_name``) resolve to
# the richer value.

_SUBJECT_NAME_KEYS  = ("subject_name", "subject", "source_name", "source", "head", "from")
_OBJECT_NAME_KEYS   = ("object_name",  "object",  "target_name", "target", "tail", "to")
_SUBJECT_TYPE_KEYS  = ("subject_type", "source_type", "head_type", "from_type")
_OBJECT_TYPE_KEYS   = ("object_type",  "target_type", "tail_type", "to_type")
_PREDICATE_KEYS     = ("predicate", "relation", "relationship", "type", "label")


def _coalesce_triplet(keys: tuple[str, ...]) -> str:
    """Build a ``COALESCE(triplet->>'k1', triplet->>'k2', ...)`` expression.

    All keys are static identifiers (no user input), so inlining them is safe.
    """
    parts = [f"triplet->>'{k}'" for k in keys]
    if len(parts) == 1:
        return parts[0]
    return "COALESCE(" + ", ".join(parts) + ")"


def _triplet_key_sql(which: str) -> str:
    """SQL for subject/object NAME lookup on the lateral ``triplet`` element."""
    keys = _SUBJECT_NAME_KEYS if which == "subject" else _OBJECT_NAME_KEYS
    return _coalesce_triplet(keys)


def _triplet_type_sql(which: str) -> str:
    """SQL for subject/object TYPE lookup on the lateral ``triplet`` element."""
    keys = _SUBJECT_TYPE_KEYS if which == "subject" else _OBJECT_TYPE_KEYS
    return _coalesce_triplet(keys)


def _triplet_predicate_sql() -> str:
    """SQL for predicate lookup on the lateral ``triplet`` element."""
    return _coalesce_triplet(_PREDICATE_KEYS)


def _as_triplet_key(field: str) -> str:
    """Reduce a triplet-scoped field reference to its bare key.

    The RolePicker emits full paths like ``document.triplets[*].weight`` when
    the user clicks a numeric property; but ``edge_weight_field`` and
    ``forward_properties.field`` are defined as keys inside the LATERAL
    triplet element. Strip the array/path prefix so the downstream SQL
    (``triplet->>'weight'``) and the Python consumers agree on one key.
    """
    s = field.rstrip()
    if s.endswith("[*]"):
        s = s[:-3]
    return s.rsplit(".", 1)[-1] if "." in s else s


def _safe_col_alias(field_path: str, fallback: str) -> str:
    """Build a safe SQL column alias from a field path.

    Alphanumerics + underscores only; falls back to a positional name for
    paths that can't be sanitized safely (paths with dots or brackets get
    replaced wholesale).
    """
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in field_path)
    if not safe or not safe[0].isalpha():
        return fallback
    return f"_fp_{safe}"


# ─── PersistentGraphSource (materialized) ───────────────────────────────────


@dataclass
class PersistentGraphSource:
    """Materialized source: reads the ``GraphEdge`` table.

    Windows by edge id ascending. Entity metadata comes from ``Entity`` via
    join. The DB-side columns are ``source_entity_id`` / ``target_entity_id``
    (graph-theory neutral); the projected fields keep the ``subject_*`` /
    ``object_*`` names that the streaming triplet shape expects (LLM-facing
    contract).
    """

    session: Session
    graph_id: int | None
    infospace_id: int
    order: Literal["id", "weight"] = "id"

    async def windows(self, chunk_size: int) -> AsyncIterator[list[TripletRow]]:
        last_id: int | None = None
        while True:
            params = {"iid": self.infospace_id, "stream_lim": chunk_size}
            where = ["ge.infospace_id = :iid"]
            if self.graph_id is not None:
                where.append("ge.graph_id = :gid")
                params["gid"] = self.graph_id
            if last_id is not None:
                where.append("ge.id > :stream_cursor")
                params["stream_cursor"] = last_id

            sql = text(f"""
                SELECT
                    ge.id AS edge_id,
                    ge.annotation_id,
                    src.canonical_name AS subject_name,
                    src.entity_type    AS subject_type,
                    ge.predicate       AS predicate,
                    tgt.canonical_name AS object_name,
                    tgt.entity_type    AS object_type
                FROM graphedge ge
                JOIN entity src ON src.id = ge.source_entity_id
                JOIN entity tgt ON tgt.id = ge.target_entity_id
                WHERE {' AND '.join(where)}
                ORDER BY ge.id ASC
                LIMIT :stream_lim
            """).bindparams(**params)

            rows = self.session.exec(sql).all()
            if not rows:
                return

            yield [
                TripletRow(
                    annotation_id=row.annotation_id,
                    subject_name=row.subject_name or "",
                    subject_type=row.subject_type or "",
                    predicate=row.predicate or "",
                    object_name=row.object_name or "",
                    object_type=row.object_type or "",
                )
                for row in rows
            ]

            last_id = rows[-1].edge_id
            if len(rows) < chunk_size:
                return


# ─── stream_graph — unified streamer ────────────────────────────────────────


async def stream_graph(
    session: Session,
    infospace_id: int,
    source: GraphSource,
    *,
    top_n_nodes: int | None = 1000,
    top_n_edges: int | None = 5000,
    chunk_size: int = 500,
) -> AsyncIterator[GraphChunk]:
    """Aggregate a graph from a streaming triplet source. Bounded memory.

    **Aggregation is global across all source windows.** The same triplet
    seen in N windows updates one slot rather than emitting N edges. Caps
    operate on UNIQUE counts (``len(edge_slots)``, kept node count). Earlier
    versions slotted per-window and counted emissions, which inflated the
    edge count with cross-window duplicates and tripped ``top_n_edges`` long
    before the actual unique-edge frontier was reached — large runs ended
    up rendering as ~150 nodes / 5000 mostly-duplicate edges.

    Emits the accumulated graph in fixed-size chunks at the end. The
    ``AsyncIterator[GraphChunk]`` surface is preserved so SSE consumers
    keep working unchanged; what they lose is *progressive* emission within
    a single run (chunks now arrive together at the tail). That trade is
    deliberate — correctness over progress feedback for this view.

    When the source carries optional aggregation config (``edge_weight_mode``,
    ``forward_properties``, ``edge_group_by``, ``node_group_by``):

    - Edge key is ``(subj, subj_type, pred, obj, obj_type, edge_group)`` so
      cross-group instances split into distinct edges.
    - ``computed_weight`` derived per ``edge_weight_mode`` from accumulated
      raw values across the entire run.
    - ``forward_properties`` aggregated per declared ``agg`` across the run.
    - ``node_group_by`` first-seen wins per node.

    Stops reading windows once either cap is reached. ``None`` disables a
    cap — unbounded sources should always set both to a sane upper bound.
    """

    # Pull optional aggregation config from the source (PersistentGraphSource
    # and other future sources can opt out by not exposing these attrs).
    edge_weight_mode: str = getattr(source, "edge_weight_mode", "count")
    forward_properties: list[ForwardPropertySpec] = list(
        getattr(source, "forward_properties", []) or []
    )
    has_edge_group: bool = bool(getattr(source, "edge_group_by", None))
    has_node_group: bool = bool(getattr(source, "node_group_by", None))
    null_policy: str = getattr(source, "null_policy", "skip")
    dedup_mode: str = getattr(source, "dedup", "exact")

    def _key_norm(s: str) -> str:
        """Normalize a string for the dedup key only — display strings keep
        their original casing. Under ``dedup='normalized'`` "Apple Inc." and
        "apple inc." collapse into one slot but render as whatever the
        first-seen row called itself."""
        return s.lower().strip() if dedup_mode == "normalized" else s

    # Global state. Edge slots persist across all windows so the same
    # triplet seen N times produces ONE edge with weight N. Memory is
    # bounded by ``top_n_edges`` (we stop allocating new slots once full;
    # existing slots still accumulate weight from late windows).
    edge_slots: dict[tuple[str, str, str, str, str, Any], dict[str, Any]] = {}
    annotation_ids_by_node: dict[str, set[int]] = {}
    node_group_by_id: dict[str, str | None] = {}  # first-seen wins
    # Per-node evidence: every triplet where this node appears as subject or
    # object contributes its inline justification. Keyed by node id.
    evidence_by_node: dict[str, list[dict[str, Any]]] = {}
    # Per-node evidence dedup — same justification dict can appear multiple
    # times when triplets share evidence; this set keys on a stable hash so
    # we keep one copy per node per unique payload.
    seen_evidence_keys: dict[str, set] = {}

    async for window in source.windows(chunk_size):
        if not window:
            continue

        for row in window:
            props = row.properties or {}
            edge_group = props.get("_edge_group") if has_edge_group else None

            key = (
                _key_norm(row.subject_name), _key_norm(row.subject_type),
                _key_norm(row.predicate),
                _key_norm(row.object_name), _key_norm(row.object_type),
                edge_group,
            )
            new_edge = key not in edge_slots
            # Cap on UNIQUE edges. Once full, drop further new keys but keep
            # aggregating into existing slots so weight totals stay accurate.
            if (
                new_edge
                and top_n_edges is not None
                and len(edge_slots) >= top_n_edges
            ):
                continue

            slot = edge_slots.setdefault(key, {
                "weight": 0,
                "annotation_ids": set(),
                "weight_sum": 0.0,     # for edge_weight_mode = sum/avg/max/count_times
                "weight_count": 0,     # non-null count of edge_weight_field values
                "weight_max": None,    # for max_property
                "weight_first": None,  # for property mode
                "fp_values": {_as_triplet_key(fp.field): [] for fp in forward_properties},
                # Per-edge evidence: ordered list of inline justification dicts
                # from each contributing triplet. Empty when no triplet had
                # justification populated.
                "evidence": [],
                # First-seen original-case display strings. The slot key uses
                # normalized values so "Apple Inc." and "apple inc." merge,
                # but we render whichever spelling appeared first.
                "subject_name_display": row.subject_name,
                "subject_type_display": row.subject_type,
                "predicate_display": row.predicate,
                "object_name_display": row.object_name,
                "object_type_display": row.object_type,
            })
            slot["weight"] += row.weight
            slot["annotation_ids"].add(row.annotation_id)

            inline_just = props.get("_inline_justification")
            if isinstance(inline_just, dict) and inline_just:
                slot["evidence"].append(inline_just)

            raw_w = props.get("_edge_weight_raw")
            if raw_w is None and null_policy == "zero":
                raw_w = 0.0
            if raw_w is not None:
                slot["weight_sum"] += raw_w
                slot["weight_count"] += 1
                if slot["weight_max"] is None or raw_w > slot["weight_max"]:
                    slot["weight_max"] = raw_w
                if slot["weight_first"] is None:
                    slot["weight_first"] = raw_w

            for fp in forward_properties:
                bare = _as_triplet_key(fp.field)
                v = props.get(f"fp__{bare}")
                if v is not None:
                    slot["fp_values"][bare].append(v)

            s_id = _node_id(row.subject_name, row.subject_type)
            o_id = _node_id(row.object_name, row.object_type)
            annotation_ids_by_node.setdefault(s_id, set()).add(row.annotation_id)
            annotation_ids_by_node.setdefault(o_id, set()).add(row.annotation_id)

            if isinstance(inline_just, dict) and inline_just:
                # Dedup by stable JSON key so the same triplet's justification
                # doesn't double-count on each incident node.
                try:
                    ev_key = json.dumps(inline_just, sort_keys=True, default=str)
                except (TypeError, ValueError):
                    ev_key = id(inline_just)
                for node_id in (s_id, o_id):
                    seen = seen_evidence_keys.setdefault(node_id, set())
                    if ev_key not in seen:
                        seen.add(ev_key)
                        evidence_by_node.setdefault(node_id, []).append(inline_just)

            if has_node_group:
                if s_id not in node_group_by_id:
                    node_group_by_id[s_id] = props.get("_node_group_subj")
                if o_id not in node_group_by_id:
                    node_group_by_id[o_id] = props.get("_node_group_obj")

        # Stop reading windows once either cap is reached.
        if top_n_edges is not None and len(edge_slots) >= top_n_edges:
            break
        if top_n_nodes is not None and len(annotation_ids_by_node) >= top_n_nodes:
            break

    if not edge_slots:
        return

    # Materialize node objects. Display name/type come from each slot's
    # first-seen original-case strings; node id is derived from the
    # case-insensitive form so spelling variants merge regardless of
    # ``dedup`` mode. Frequency is the sum of edge weights the node
    # participates in.
    nodes_by_id: dict[str, GraphNode] = {}
    for slot in edge_slots.values():
        s_name = slot["subject_name_display"]
        s_type = slot["subject_type_display"]
        o_name = slot["object_name_display"]
        o_type = slot["object_type_display"]
        s_id = _node_id(s_name, s_type)
        o_id = _node_id(o_name, o_type)
        if s_id not in nodes_by_id:
            nodes_by_id[s_id] = GraphNode(
                id=s_id, name=s_name, type=s_type,
                frequency=0,
                source_annotation_ids=sorted(annotation_ids_by_node.get(s_id, set())),
                group_value=node_group_by_id.get(s_id) if has_node_group else None,
                evidence=evidence_by_node.get(s_id, []),
            )
        if o_id not in nodes_by_id:
            nodes_by_id[o_id] = GraphNode(
                id=o_id, name=o_name, type=o_type,
                frequency=0,
                source_annotation_ids=sorted(annotation_ids_by_node.get(o_id, set())),
                group_value=node_group_by_id.get(o_id) if has_node_group else None,
                evidence=evidence_by_node.get(o_id, []),
            )
        nodes_by_id[s_id].frequency += slot["weight"]
        nodes_by_id[o_id].frequency += slot["weight"]

    all_nodes = list(nodes_by_id.values())
    if top_n_nodes is not None and len(all_nodes) > top_n_nodes:
        # Keep highest-frequency nodes; edges among the dropped tail are
        # dropped below. Sort is stable on frequency descending.
        all_nodes.sort(key=lambda n: n.frequency or 0, reverse=True)
        all_nodes = all_nodes[:top_n_nodes]
    kept_ids = {n.id for n in all_nodes}

    all_edges: list[GraphEdge] = []
    for key, slot in edge_slots.items():
        edge_group = key[5]
        s_id = _node_id(slot["subject_name_display"], slot["subject_type_display"])
        o_id = _node_id(slot["object_name_display"], slot["object_type_display"])
        if s_id not in kept_ids or o_id not in kept_ids:
            continue
        computed_weight = _compute_edge_weight(slot, edge_weight_mode)
        edge_props = _aggregate_forward_properties(slot["fp_values"], forward_properties)
        all_edges.append(GraphEdge(
            source=s_id, target=o_id,
            predicate=slot["predicate_display"],
            weight=slot["weight"],
            computed_weight=computed_weight,
            group_value=edge_group,
            properties=edge_props,
            evidence=slot["evidence"],
        ))

    # Emit in chunks of ``chunk_size`` to preserve the iterator API and
    # cap individual SSE event size. In practice all chunks land back-to-back
    # at the tail of the stream — progressivity now reflects "how big each
    # SSE frame is," not "how soon partial data arrives."
    out_chunk_size = max(chunk_size, 1)
    nodes_remaining = all_nodes
    edges_remaining = all_edges
    while nodes_remaining or edges_remaining:
        chunk_nodes = nodes_remaining[:out_chunk_size]
        chunk_edges = edges_remaining[:out_chunk_size]
        nodes_remaining = nodes_remaining[out_chunk_size:]
        edges_remaining = edges_remaining[out_chunk_size:]
        yield GraphChunk(nodes=chunk_nodes, edges=chunk_edges)


def _compute_edge_weight(slot: dict[str, Any], mode: str) -> float | None:
    """Derive an edge's ``computed_weight`` from an aggregation slot.

    Returns ``None`` when the mode needs property values but none were
    present (e.g., ``sum_property`` with no non-null rows).
    """
    count = slot["weight"]
    w_sum = slot["weight_sum"]
    w_cnt = slot["weight_count"]
    w_max = slot["weight_max"]
    w_first = slot["weight_first"]

    if mode == "count":
        return float(count)
    if mode == "property":
        return w_first
    if mode == "sum_property":
        return w_sum if w_cnt > 0 else None
    if mode == "avg_property":
        return (w_sum / w_cnt) if w_cnt > 0 else None
    if mode == "max_property":
        return w_max
    if mode == "count_times_property":
        # "strong repeating connections get thicker": count × avg(property).
        # A repeating edge with high property values lights up; a repeating
        # edge with low property values does not.
        if w_cnt == 0:
            return None
        return float(count) * (w_sum / w_cnt)
    return float(count)


def _aggregate_forward_properties(
    values_by_field: dict[str, list[Any]],
    specs: list[ForwardPropertySpec],
) -> dict[str, Any]:
    """Apply each ``ForwardPropertySpec.agg`` to its collected values."""
    out: dict[str, Any] = {}
    for fp in specs:
        bare = _as_triplet_key(fp.field)
        vals = values_by_field.get(bare, [])
        if not vals:
            continue
        agg = fp.agg
        if agg == "first":
            out[bare] = vals[0]
            continue
        # Numeric aggregations: coerce, skip non-numeric.
        nums: list[float] = []
        for v in vals:
            try:
                nums.append(float(v))
            except (TypeError, ValueError):
                continue
        if not nums:
            continue
        if agg == "sum":
            out[bare] = sum(nums)
        elif agg == "avg":
            out[bare] = sum(nums) / len(nums)
        elif agg == "max":
            out[bare] = max(nums)
    return out


async def collect_graph(
    session: Session,
    infospace_id: int,
    source: GraphSource,
    *,
    top_n_nodes: int | None = 1000,
    top_n_edges: int | None = 5000,
    chunk_size: int = 500,
) -> GraphResult:
    """Drain stream_graph into a full (bounded) GraphResult.

    Useful for blocking-shape callers — still bounded by ``top_n_*`` caps, so
    memory stays safe. The streaming callers iterate ``stream_graph`` directly.
    """

    nodes: list[GraphNode] = []
    edges: list[GraphEdge] = []
    async for chunk in stream_graph(
        session, infospace_id, source,
        top_n_nodes=top_n_nodes, top_n_edges=top_n_edges, chunk_size=chunk_size,
    ):
        nodes.extend(chunk.nodes)
        edges.extend(chunk.edges)
    return GraphResult(nodes=nodes, edges=edges)


def _node_id(name: str, entity_type: str) -> str:
    """Deterministic node ID from name + type. Matches AnnotationQuery.graph()'s
    legacy hashing so ephemeral and persistent sources yield the same ids."""
    raw = f"{name.lower().strip()}::{entity_type.lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]
