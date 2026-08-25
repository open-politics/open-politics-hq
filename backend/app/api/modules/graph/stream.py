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
import re
import logging
from collections import defaultdict
from dataclasses import dataclass, field
from typing import Any, AsyncIterator, Iterable, Literal, Protocol, runtime_checkable

from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation.panel_config import (
    ForwardPropertySpec,
    NodeRole,
    Projection,
)
from app.api.modules.annotation.schema_map import (
    OBJECT_NAME_KEYS,
    PREDICATE_KEYS,
    SUBJECT_NAME_KEYS,
)
from app.api.modules.graph.schemas import (
    GraphChunkData as GraphChunk,
    GraphEdgeData as GraphEdge,
    GraphNodeData as GraphNode,
    GraphResultData as GraphResult,
    NodePlace,
)
from app.core.filters import (
    jsonb_accessor, jsonb_value_accessor, parse_explosion, safe_array_elements,
    scalar_of,
)

logger = logging.getLogger(__name__)


# ─── Row shape ──────────────────────────────────────────────────────────────


@dataclass
class TripletRow:
    """One edge atom as seen by a source's window iterator.

    Sources normalize their rows into this shape; ``stream_graph`` accumulates
    them without caring which backend produced them.

    The ``properties`` bag carries optional per-row values extracted from the
    row or annotation context (forward-property values, group-by values,
    edge-weight source). Keys used by ``stream_graph``:

    - ``_edge_weight_raw`` (float | None): raw value of ``edge_weight_field``
    - ``_edge_group`` (str | None): ``edge_group_by`` value (becomes part of edge key)
    - ``_node_group_subj`` / ``_node_group_obj`` (str | None): ``node_group_by``
      values for subject / object (first-seen per node wins)
    - ``_inline_justification`` (dict): per-atom evidence payload
    - ``_t0`` / ``_t1`` (str | None): the interval this atom exists over
    - ``_place`` (str | None): location string for the geo anchor
    - ``fp__<field>`` (Any): forward-property raw values, one per field

    ``source_path`` records which projection produced the atom, so panels can
    split or unify by field the way ``GraphEdge.source_field_path`` already
    allows for curated edges.
    """

    annotation_id: int
    subject_name: str
    subject_type: str
    predicate: str
    object_name: str
    object_type: str
    weight: int = 1
    properties: dict[str, Any] = field(default_factory=dict)
    source_path: str | None = None
    subject_role: str | None = None
    object_role: str | None = None


@dataclass
class NodeRow:
    """One node atom — an entity mention that carries no relationship.

    A single-role projection (an entity roster, a lone ``participants[*]``)
    produces these. Without them such entities would be invisible: node objects
    used to be materialized *only* from edge slots, so an entity nobody related
    to anything simply never appeared, however often it was named.
    """

    annotation_id: int
    name: str
    type: str
    properties: dict[str, Any] = field(default_factory=dict)
    source_path: str | None = None
    role: str | None = None


#: What a source's ``windows()`` yields. Edge atoms and node atoms interleave
#: freely — one projection can produce both.
GraphAtom = TripletRow | NodeRow


# ─── GraphSource protocol ───────────────────────────────────────────────────


@runtime_checkable
class GraphSource(Protocol):
    """Iterator shape that ``stream_graph`` consumes."""

    async def windows(self, chunk_size: int) -> AsyncIterator[list[GraphAtom]]:
        """Yield successive windows of graph atoms until the source is exhausted."""
        ...


# ─── AnnotationGraphSource (ephemeral) ──────────────────────────────────────


@dataclass
class AnnotationGraphSource:
    """Ephemeral source: scans ``annotation.value`` through N **projections**.

    A projection declares an array to explode plus how to read node identity,
    time, place, weight and evidence off each row. That makes a triplet array,
    a nested observation row, and a bare entity roster three instances of one
    thing — and because node identity is a global hash of name+type, an entity
    named in a nested row and the same entity named in a triplet **collapse
    into one node** with no reconciliation code.

    Keeps the ``AnnotationQuery`` so scope, filters, merge-maps, and run/schema
    selection flow through a single codepath.

    Panel-wide extensions (all default to "off"):

    - ``edge_weight_mode``: how ``Projection.weight`` values aggregate into
      ``computed_weight`` within ``stream_graph``.
    - ``edge_group_by``: adds a column to the per-edge aggregation key so the
      same relationship appears in multiple buckets (one per group value).
    - ``node_group_by``: attached to node payload; first-seen wins per node.
      This is what a ``field`` clustering anchor reads.
    - ``null_policy``: how numeric casts of empty / null values behave.
    - ``edge_weight_field`` / ``forward_properties``: legacy panel-level
      equivalents of ``Projection.weight`` / ``Projection.properties``, used
      when a projection doesn't carry its own.
    """

    query: "AnnotationQuery"           # noqa: F821 — forward ref to avoid import cycle
    projections: list[Projection] = field(default_factory=list)
    triplet_field: str | None = None
    """Back-compat single-triplet form. When ``projections`` is empty this
    synthesizes one projection over the named array — so every caller written
    before projections existed keeps working unchanged, and callers can migrate
    one at a time. Node roles fall back to the canonical triplet keys, and the
    read side COALESCEs across the whole alias family, so a schema that says
    ``head``/``tail`` still resolves."""
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
    gql: Any = None
    """Parsed :class:`graph.gql.GraphQuery`. Only its row-scope tier is used
    here — filtered rows never enter the aggregation, and whole projections are
    skipped when ``field:`` excludes them. The graph-shape and traversal tiers
    need the assembled graph and run in ``gql.apply_to_graph``."""
    channels: Any = None
    """Parsed :class:`graph.channels.ChannelQuery` — the binding half of the
    same string. Nothing here filters; it decides what the surviving set
    *does*: what sizes a node, what groups it, what comes off the canvas."""
    doc_place: str | None = None
    doc_time: str | None = None
    """The document rung of each ladder — see :class:`GraphConfig`. Scoped to
    the annotation rather than to a row, so they are read here and applied at
    materialisation to every node the annotation produced."""
    doc_anchors: dict[int, dict[str, Any]] = field(default_factory=dict)
    """``annotation_id -> {place, time}``, accumulated while rows are read.

    Deliberately **not** carried in each atom's ``properties``. An occurrence's
    role-edges carry nothing by design, so a participant reached only that way
    would never see the document's place — and the document rung is precisely
    the one that should apply to everyone the document mentions. Keying it by
    annotation lets the aggregator reach every node regardless of which branch
    minted it."""

    _resolved: bool = field(default=False, repr=False)
    """Latch for :meth:`_resolve`. Role inference reads the DB, so it happens
    once per source at read time rather than per projection."""

    def _schema_map(self) -> Any:
        """A :class:`SchemaMap` over every contract in the query's scope.

        Role inference needs to know what a projection's container actually
        holds — which fields are entity-shaped, which key a triplet uses. That
        answer lives in the schema, and the source had no access to one, so
        ``resolve_projections`` was always called with ``smap=None`` and always
        fell through to the canonical-triplet fallback. A projection over
        ``document.observations[*]`` therefore inferred ``subject_name`` /
        ``object_name`` roles that its rows do not have.

        Schemas come from the query's own scope when the panel declared one
        (``formula.schema_id`` → ``AnnotationQuery.schemas``); otherwise we ask
        which schemas the scoped annotations actually use. Maps from several
        schemas **merge**: ``SchemaMap.get`` and ``in_container`` search a flat
        field tuple, so concatenating is exactly right for a run whose
        annotations span more than one contract, and a path resolves against
        whichever schema declares it.
        """
        from app.api.modules.annotation.schema_map import (
            SchemaMap,
            SchemaRefCycleError,
            schema_map_for,
        )

        schema_ids = list(getattr(self.query, "_schema_ids", None) or [])
        if not schema_ids:
            try:
                clauses, params = self.query._base_where(include_cursor=False)
                rows = self.query._session.exec(text(
                    f"SELECT DISTINCT a.schema_id FROM annotation a "
                    f"WHERE {' AND '.join(clauses)} LIMIT 50"
                ).bindparams(**params)).all()
                schema_ids = [r[0] for r in rows if r[0] is not None]
            except Exception as e:  # noqa: BLE001
                logger.warning("graph source: schema discovery failed: %s", e)
                return SchemaMap()

        from app.api.modules.annotation.models import AnnotationSchema

        fields: list[Any] = []
        vocabularies: dict[str, tuple[str, ...]] = {}
        section_decls: dict[str, dict[str, Any]] = {}
        entity_paths: list[str] = []
        triplet_paths: list[str] = []
        time_paths: list[str] = []
        place_paths: list[str] = []
        for sid in schema_ids:
            schema = self.query._session.get(AnnotationSchema, sid)
            if not schema or not schema.output_contract:
                continue
            try:
                smap = schema_map_for(schema.output_contract)
            except SchemaRefCycleError as e:
                # A cyclic x-ref is a broken schema, not a reason to fail the
                # whole graph — the other schemas in scope still resolve.
                logger.warning("graph source: schema %s has a ref cycle (%s)", sid, e)
                continue
            fields.extend(smap.fields)
            vocabularies.update(smap.vocabularies)
            # **Every index, not just the two the first caller needed.**
            # Carrying only `fields` + `vocabularies` made the merged map claim
            # that no contract in scope declared anything: `section_decls` came
            # back empty, so `derive_projections` fell to its name-table rung
            # for EVERY schema and the whole `x-graph` layer was inert on the
            # graph path. A section the table happens to name (`observations`)
            # looked correct; one it does not (`exhibits`) was inferred into
            # `role: companion`, `node_kind: occurrence` — the opposite of what
            # it declares — and then won the default-table tie-break.
            section_decls.update(smap.section_decls or {})
            entity_paths.extend(smap.entity_paths)
            triplet_paths.extend(smap.triplet_paths)
            time_paths.extend(smap.time_paths)
            place_paths.extend(smap.place_paths)
        return SchemaMap(
            fields=tuple(fields),
            vocabularies=vocabularies,
            section_decls=section_decls,
            entity_paths=tuple(dict.fromkeys(entity_paths)),
            triplet_paths=tuple(dict.fromkeys(triplet_paths)),
            time_paths=tuple(dict.fromkeys(time_paths)),
            place_paths=tuple(dict.fromkeys(place_paths)),
        )

    def _resolve(self) -> None:
        """Fill in node roles (and the legacy single-array fallback) once.

        Deliberately **not** in ``__post_init__``: it reads the database, and
        at construction time the query may not be fully configured yet. Called
        at the top of :meth:`windows`, where the scope is settled.

        This used to run only when ``projections`` was empty *and*
        ``triplet_field`` was set, so a UI-authored projection — which
        deliberately ships ``nodes: []`` meaning "infer from the schema" —
        reached ``_project``, found no roles, and was skipped entirely. Every
        projection authored in the picker produced zero atoms.
        """
        from app.api.modules.annotation.panel_config import (
            GraphConfig,
            resolve_projections,
        )

        if self._resolved:
            return
        self._resolved = True
        cfg = GraphConfig(
            projections=list(self.projections),
            source=self.triplet_field,
            edge_weight_field=self.edge_weight_field,
            forward_properties=list(self.forward_properties),
        )
        self.projections = resolve_projections(cfg, smap=self._schema_map())

    async def windows(self, chunk_size: int) -> AsyncIterator[list[GraphAtom]]:
        """Walk every projection, yielding node and edge atoms.

        Projections run **sequentially**, each with its own LATERAL and its own
        tuple cursor. Sequential is trivially correct because ``stream_graph``'s
        aggregation is order-independent — so no cross-projection cursor
        machinery is needed, and one projection's shape can't constrain
        another's.
        """
        from app.api.modules.annotation.query import AnnotationQuery  # local import

        if not isinstance(self.query, AnnotationQuery):
            raise TypeError("AnnotationGraphSource.query must be an AnnotationQuery")

        from app.api.modules.graph.gql import projection_allowed

        self._resolve()

        for proj in self.projections:
            if self.gql is not None and not projection_allowed(self.gql, proj.path):
                continue
            async for batch in self._project(proj, chunk_size):
                yield batch

    async def _project(
        self, proj: Projection, chunk_size: int,
    ) -> AsyncIterator[list[GraphAtom]]:
        """One projection's rows → atoms, windowed by a tuple cursor."""
        session = self.query._session
        arr_path = proj.array_path
        if not arr_path:
            logger.warning("projection with empty path skipped: %r", proj.path)
            return

        roles = list(proj.nodes)
        if not roles and proj.about != "self":
            # A connection with no participants is not a row. But a row that
            # mints a node of its OWN is meaningful without any — an exhibit
            # relates to nothing until something cites it, a named event until
            # an observation says it belongs. Skipping those dropped the whole
            # section before a query ever ran, and the only trace was a log
            # line: the projection was configured, the rows were in the
            # annotation, and the graph simply had no evidence in it.
            logger.warning("projection %r has no node roles; skipped", proj.path)
            return

        # Tuple cursor (annotation_id, ordinality). Required because the LATERAL
        # fans one annotation into many rows: cursoring on ``a.id`` alone drops
        # the tail of any annotation whose array overflows the LIMIT.
        last_id: int | None = None
        last_ord: int | None = None

        while True:
            clauses, params = self.query._base_where(include_cursor=False)
            # Filters written against this projection's array evaluate on the
            # lateral element; anything else falls through to EXISTS.
            self.query._apply_conditions(
                clauses, params, element_alias="elem", active_explosion=arr_path,
            )

            if last_id is not None:
                clauses.append(
                    "(a.id < :stream_cursor_id "
                    "OR (a.id = :stream_cursor_id AND elem_idx.ord > :stream_cursor_ord))"
                )
                params["stream_cursor_id"] = last_id
                params["stream_cursor_ord"] = last_ord

            # Three storage conventions coexist in the wild — flat dotted key,
            # nested path, and document-unwrapped root. ``jsonb_value_accessor``
            # COALESCEs across all three so a projection resolves regardless of
            # which shape the annotation task materialized.
            arr_expr, arr_params = jsonb_value_accessor(
                "a.value", arr_path, param_name="proj_arr",
            )
            params.update(arr_params)

            selects: list[str] = [
                "a.id AS annotation_id",
                "elem_idx.ord AS ord",
            ]
            # Accessors for the row's OWN bindings — identity, when, where.
            # A row that mints a node of its own is meaningful through these
            # even when it names no participants.
            own_accessors: list[str] = []
            for i, role in enumerate(roles):
                selects.append(f"{_role_json_sql(role)} AS r{i}_val")
                if role.type_path:
                    acc, p = jsonb_accessor("elem", role.type_path, param_name=f"r{i}_tp")
                    params.update(p)
                    selects.append(f"{acc} AS r{i}_type")

            if proj.predicate:
                selects.append(f"{_predicate_sql(proj.predicate)} AS predicate")
            # Time and place read identically — ``{at}`` is a degenerate
            # ``{start, end}``. A place with both ends is a trajectory: the
            # atom is at neither endpoint, it spans them.
            pb = proj.place_binding
            for key, path in (
                ("t0", (proj.time.start or proj.time.at) if proj.time else None),
                ("t1", proj.time.end if proj.time else None),
                ("act0", (proj.activity.start or proj.activity.at) if proj.activity else None),
                ("act1", proj.activity.end if proj.activity else None),
                ("place", (pb.at or pb.start) if pb else None),
                ("place_to", pb.end if pb else None),
                ("place_kind", pb.kind if pb else None),
                ("weight_raw", proj.weight),
                # Occurrences: identity and display are separate concerns. The
                # name is what other rows reference and what dedup keys on; the
                # label is what reads well on a card.
                ("occ_name", proj.node_name),
                # …and the kind, when one array carries many of them.
                ("occ_type", proj.node_type_path),
            ):
                if not path:
                    continue
                acc, p = jsonb_accessor("elem", path, param_name=f"sel_{key}")
                params.update(p)
                if key in ("t0", "place", "occ_name"):
                    own_accessors.append(acc)
                selects.append(f"{acc} AS {key}")

            label_roles = [r.label or r.path for r in roles]
            for i, fld in enumerate(_label_fields(proj.node_label, label_roles)):
                acc, p = jsonb_accessor("elem", fld, param_name=f"sel_lbl{i}")
                params.update(p)
                selects.append(f"{acc} AS {_label_alias(fld, i)}")
                own_accessors.append(acc)

            # The asset rung — the LAST resort of the time ladder, and the only
            # rung that is not a claim.
            #
            # ``document.dated`` asks a model for a date the database already
            # knows, and on the second real run it came back empty: every node
            # in the graph was untimed, so the scrubber, the activity bars and
            # the lanes were all dead over a corpus whose two assets carry exact
            # publication timestamps. A file's own timestamp is not something to
            # infer.
            #
            # ``event_timestamp`` only, never ``created_at``: when we ingested a
            # 1970s memo says nothing about the memo, and dating it by the scrape
            # would be a fabrication wearing a timestamp's clothes.
            selects.append("ast.event_timestamp AS asset_time")

            # The document rung. Annotation-scoped, so these resolve on
            # ``a.value`` rather than on the lateral element — the same
            # accessor the aggregation-level group-bys use.
            for key, path in (("doc_place", self.doc_place),
                              ("doc_time", self.doc_time)):
                if not path:
                    continue
                acc, p = self._path_accessor(path, param_prefix=key)
                params.update(p)
                selects.append(f"{acc} AS {key}")

            if self.edge_group_by:
                acc, p = self._path_accessor(self.edge_group_by, param_prefix="egfp")
                params.update(p)
                selects.append(f"{acc} AS edge_group_raw")
            # A computed grouping key is derived from the assembled graph, not
            # read off the row — selecting it as a JSONB path would look for a
            # column called "neighbours:Interest" and find nothing.
            if self.node_group_by and not is_computed_group(self.node_group_by):
                acc, p = self._path_accessor(self.node_group_by, param_prefix="ngfp")
                params.update(p)
                selects.append(f"{acc} AS node_group_raw")

            forwarded = proj.properties or self.forward_properties
            for i, fp in enumerate(forwarded):
                bare = _as_triplet_key(fp.field)
                selects.append(
                    f"elem->>'{bare.replace(chr(39), chr(39) * 2)}' "
                    f"AS {_safe_col_alias(bare, f'fp_{i}')}"
                )
            # **A row's own columns, when nobody declared which to forward.**
            #
            # Forwarding is opt-in, and the mega scenario's templates opt in for
            # every occurrence. A contract that declares nothing therefore mints
            # nodes with an EMPTY property bag — so `CLUSTER:financial_records.
            # transaction_type` resolved the path correctly, read the node, and
            # found nothing there. The column existed in the row table two
            # panes away and could not reach the canvas.
            #
            # Selecting the element itself costs one column and no schema
            # knowledge, which is what makes it work on a contract nobody
            # annotated. `_atoms_for_row` copies the scalars; nested objects
            # stay out, because a participant is a role and not a property.
            if not forwarded and proj.about == "self":
                selects.append("elem AS row_element")

            # Evidence: an explicit binding, else the inline convention.
            ev_path = proj.evidence.path if proj.evidence else "justification"
            ev_acc, ev_params = jsonb_value_accessor(
                "elem", ev_path, param_name="ev_path",
            ) if "." in ev_path else (
                f"elem->'{ev_path.replace(chr(39), chr(39) * 2)}'", {},
            )
            params.update(ev_params)
            selects.append(f"{ev_acc} AS evidence")

            # A row is only useful if SOMETHING in it resolved.
            #
            # For a connection that means a participant: an edge between
            # nothing and nothing is not a row. But a row that mints a node of
            # its own is meaningful without participants — **an exhibit relates
            # to nothing until something cites it**, and a named event relates
            # to nothing until an observation says it belongs. Gating those on
            # ``role_present`` dropped the whole section before it could reach
            # the aggregator, silently: the projection was configured, the rows
            # were there, and the graph simply had no evidence and no events in
            # it. So an ``about: self`` row also passes on its own identity,
            # label, time or place.
            present = [f"{_role_json_sql(r)} IS NOT NULL" for r in roles]
            if proj.about == "self":
                present += [f"{acc} IS NOT NULL" for acc in own_accessors]
            role_present = " OR ".join(present) if present else "TRUE"

            # GQL tier 1 — compiled against this projection's own predicate
            # accessor, so a field that calls its predicate ``relation`` still
            # filters. Rows dropped here never reach the aggregator.
            if self.gql is not None and self.gql.has_row_scope:
                from app.api.modules.graph.gql import row_predicate_sql
                pred_expr = (
                    _predicate_sql(proj.predicate) if proj.predicate else "NULL"
                )
                gq_clauses, gq_params = row_predicate_sql(
                    self.gql, pred_expr,
                    # ``doc.`` climbs to the annotation root, and only this
                    # class knows the three storage conventions a value may be
                    # written in — so it supplies the accessor.
                    doc_accessor=self._path_accessor,
                    section=_section_of(proj.path),
                    sections=self._section_names(),
                )
                clauses.extend(gq_clauses)
                params.update(gq_params)

            where = " AND ".join(clauses) + f" AND ({role_present})"

            sql = text(f"""
                SELECT {', '.join(selects)}
                FROM annotation a
                LEFT JOIN asset ast ON ast.id = a.asset_id
                CROSS JOIN LATERAL jsonb_array_elements(
                    {safe_array_elements(arr_expr)}
                ) WITH ORDINALITY AS elem_idx(elem, ord)
                WHERE {where}
                ORDER BY a.id DESC, elem_idx.ord ASC
                LIMIT :stream_lim
            """).bindparams(**params, stream_lim=chunk_size)

            rows = session.exec(sql).all()
            if not rows:
                return

            batch: list[GraphAtom] = []
            for row in rows:
                self._record_doc_anchor(row)
                batch.extend(self._atoms_for_row(row, proj, roles))
            if batch:
                yield batch

            last_id = rows[-1].annotation_id
            last_ord = rows[-1].ord
            if len(rows) < chunk_size:
                return

    def _section_names(self) -> frozenset[str]:
        """Every section name this run has, lowercased.

        A section is addressed by the word the schema author chose for it, so
        this is the vocabulary that decides whether ``observations.magnitude``
        is a qualified path or just a key with a dot in it.
        """
        return frozenset(
            _section_of(p.path) for p in self.projections if getattr(p, "path", None)
        )

    # ── The rows behind the picture ────────────────────────────────────────

    def section_rows(
        self,
        proj: Projection,
        *,
        limit: int = 200,
        cursor: tuple[int, int] | None = None,
    ) -> tuple[list[dict[str, Any]], tuple[int, int] | None, int]:
        """One projection's rows, **whole**, with the same WHERE the graph ran.

        The canvas and the table are two readings of one filter, and this method
        is why that is structural rather than a discipline: it rebuilds the
        clause list from the very same ``_base_where`` + ``_apply_conditions`` +
        ``row_predicate_sql`` sequence :meth:`_project` uses. There is no second
        filter implementation that could drift from the first, so ``MVP`` S3
        cannot be violated without deleting code that both paths call.

        Returns ``(items, next_cursor, total, census)``. Each item is
        ``{annotation_id, asset_id, ord, element}`` — the *raw* row object, not
        a projection of it. Selecting columns in SQL would save a few hundred
        bytes per row and cost the thing that matters: ``SHOW:`` could then only
        name columns the query already knew about, and "show me the whole row"
        would need a second round trip. Filtering is what has to push down;
        projection is cosmetic and belongs where the declarations are.

        ``total`` is counted under the same predicate and is deliberately
        **independent of the graph's node cap** — a table that inherited the
        canvas's truncation would report "8 payments" for a run holding 200 and
        be believed.
        """
        from sqlalchemy import text

        from app.api.modules.annotation.query import AnnotationQuery

        if not isinstance(self.query, AnnotationQuery):
            raise TypeError("AnnotationGraphSource.query must be an AnnotationQuery")

        self._resolve()
        session = self.query._session
        arr_path = proj.array_path
        if not arr_path:
            return [], None, 0

        def _where() -> tuple[list[str], dict[str, Any]]:
            clauses, params = self.query._base_where(include_cursor=False)
            self.query._apply_conditions(
                clauses, params, element_alias="elem", active_explosion=arr_path,
            )
            if self.gql is not None and getattr(self.gql, "has_row_scope", False):
                from app.api.modules.graph.gql import row_predicate_sql
                pred_expr = (
                    _predicate_sql(proj.predicate) if proj.predicate else "NULL"
                )
                gq_clauses, gq_params = row_predicate_sql(
                    self.gql, pred_expr, doc_accessor=self._path_accessor,
                    section=_section_of(proj.path),
                    sections=self._section_names(),
                )
                clauses.extend(gq_clauses)
                params.update(gq_params)
            arr_expr, arr_params = jsonb_value_accessor(
                "a.value", arr_path, param_name="rows_arr",
            )
            params.update(arr_params)
            return clauses, params, arr_expr  # type: ignore[return-value]

        clauses, params, arr_expr = _where()  # type: ignore[misc]
        lateral = (
            f"CROSS JOIN LATERAL jsonb_array_elements("
            f"{safe_array_elements(arr_expr)}) WITH ORDINALITY AS elem_idx(elem, ord)"
        )

        counted = session.exec(text(f"""
            SELECT COUNT(*) AS n FROM annotation a {lateral}
            WHERE {' AND '.join(clauses)}
        """).bindparams(**params)).one()
        total = int(getattr(counted, "n", None) or counted[0])

        page_clauses = list(clauses)
        page_params = dict(params)
        if cursor is not None:
            # The LATERAL fans one annotation into many rows, so a scalar cursor
            # on ``a.id`` would drop the tail of any annotation whose array
            # overflows the page. Same tuple cursor as ``_project``.
            page_clauses.append(
                "(a.id < :rows_cur_id "
                "OR (a.id = :rows_cur_id AND elem_idx.ord > :rows_cur_ord))"
            )
            page_params["rows_cur_id"], page_params["rows_cur_ord"] = cursor

        rows = session.exec(text(f"""
            SELECT a.id AS annotation_id, a.asset_id AS asset_id,
                   elem_idx.ord AS ord, elem_idx.elem AS elem
            FROM annotation a {lateral}
            WHERE {' AND '.join(page_clauses)}
            ORDER BY a.id DESC, elem_idx.ord ASC
            LIMIT :rows_lim
        """).bindparams(**page_params, rows_lim=limit)).all()

        items = [
            {
                "annotation_id": r.annotation_id,
                "asset_id": r.asset_id,
                "ord": r.ord,
                "element": r.elem if isinstance(r.elem, dict) else {},
            }
            for r in rows
        ]
        nxt = (
            (rows[-1].annotation_id, rows[-1].ord)
            if len(rows) == limit and rows else None
        )

        # ── The census ───────────────────────────────────────────────────
        #
        # **How often is this column actually filled, across the section — not
        # across the page.** A picker that samples the loaded rows reports a
        # field as empty whenever the page happens to miss it, which is exactly
        # backwards: the fields worth telling someone about are the rare ones.
        # `3 of 480` is a fact about the corpus; `0 of 25` is a fact about
        # scrolling.
        #
        # One pass, same predicate, same LATERAL — so the numbers cannot
        # disagree with the rows above them. Cost is the order of the COUNT(*)
        # already run for `total`, not a new class of work.
        #
        # `jsonb_each` raises on a non-object, and a section of primitives is a
        # legitimate shape, so the element is coerced to `{}` rather than
        # guarded by a WHERE that would silently drop those rows from `total`'s
        # denominator.
        filled_sql = (
            "e.v IS NOT NULL AND e.v <> 'null'::jsonb "
            "AND e.v <> '[]'::jsonb AND e.v <> '\"\"'::jsonb"
        )
        # An array's example is its first element — the point is what a value
        # LOOKS like, and `["A","B"]` renders as JSON rather than as a value.
        example_sql = (
            "CASE WHEN jsonb_typeof(e.v) = 'array' "
            f"THEN {scalar_of('e.v->0')} ELSE {scalar_of('e.v')} END"
        )
        # `{}` means the census RAN and found nothing; `None` means it did not
        # run. The difference is the whole point of reporting coverage — "no
        # row filled this" and "we did not look" must not render alike.
        census: dict[str, dict[str, Any]] | None = {}
        try:
            crows = session.exec(text(f"""
                SELECT e.k AS key,
                       count(*) FILTER (WHERE {filled_sql}) AS filled,
                       (array_agg(DISTINCT {example_sql})
                          FILTER (WHERE {filled_sql}))[1:4] AS examples
                FROM annotation a {lateral},
                     LATERAL jsonb_each(CASE
                       WHEN jsonb_typeof(elem_idx.elem) = 'object'
                       THEN elem_idx.elem ELSE '{{}}'::jsonb END) AS e(k, v)
                WHERE {' AND '.join(clauses)}
                GROUP BY e.k
            """).bindparams(**params)).all()
            for r in crows:
                census[r.key] = {
                    "filled": int(r.filled or 0),
                    "examples": [x for x in (r.examples or []) if x],
                }
        except Exception:  # noqa: BLE001 — a census must never cost the table
            logger.warning("section rows: census failed", exc_info=True)
            census = None

        return items, nxt, total, census

    def _record_doc_anchor(self, row: Any) -> None:
        """Remember what the *document* said about where and when it is — and
        what the **file** says about when it is, which is not the same claim.

        One entry per annotation, first non-empty wins: every row of one
        annotation reads the same document fields, so there is nothing to
        reconcile.

        The two time entries are kept apart rather than coalesced here because
        they sit on different rungs. ``time`` is the date the document gives
        itself — a claim, and the model may have got it wrong or left it out.
        ``asset_time`` is the asset's own ``event_timestamp`` — not a claim at
        all, and therefore both more reliable and less specific. The ordering
        between them belongs in :func:`_attach_doc_anchors`, where the rest of
        the ladder is.
        """
        place = getattr(row, "doc_place", None) if self.doc_place else None
        when = getattr(row, "doc_time", None) if self.doc_time else None
        asset_when = getattr(row, "asset_time", None)
        if not place and not when and not asset_when:
            return
        slot = self.doc_anchors.setdefault(row.annotation_id, {})
        if place and not slot.get("place"):
            slot["place"] = str(place)
        if when and not slot.get("time"):
            slot["time"] = str(when)
        if asset_when and not slot.get("asset_time"):
            slot["asset_time"] = (
                asset_when.isoformat() if hasattr(asset_when, "isoformat")
                else str(asset_when)
            )

    def _atoms_for_row(
        self, row: Any, proj: Projection, roles: list[NodeRole],
    ) -> list[GraphAtom]:
        """Fan one SQL row into node atoms and cross-role edge atoms.

        Role values are expanded **here** rather than by extra LATERALs. A role
        may be multi-valued (``beguenstigte_firmen[*]`` inside a row), and
        giving each its own LATERAL would make the ordinality cursor a tuple per
        role and the SQL a cross product. Reading the role as raw JSONB and
        fanning in Python keeps one stable cursor and puts the combinatorics
        where they're cheap and inspectable.
        """
        shared: dict[str, Any] = {}
        if self.edge_group_by:
            shared["_edge_group"] = getattr(row, "edge_group_raw", None)
        if self.node_group_by:
            ng = getattr(row, "node_group_raw", None)
            shared["_node_group_subj"] = ng
            shared["_node_group_obj"] = ng
        for key, attr in (("_t0", "t0"), ("_t1", "t1"),
                          ("_act0", "act0"), ("_act1", "act1"),
                          ("_place", "place"), ("_place_to", "place_to"),
                          ("_place_kind", "place_kind")):
            v = getattr(row, attr, None)
            if v is not None:
                shared[key] = v
        # Which rung of the place ladder this row speaks from. A stated site
        # ("the meeting was in Valletta") outranks a seat ("the company is
        # registered there"), and both must stay distinguishable downstream —
        # rendering them alike would present a filing address as a whereabouts.
        shared["_place_source"] = "attribute" if (
            proj.about and proj.about not in ("self", "between")
        ) else "row"
        raw_w = getattr(row, "weight_raw", None)
        if raw_w is not None:
            try:
                shared["_edge_weight_raw"] = float(raw_w)
            except (TypeError, ValueError):
                pass
        forwarded = proj.properties or self.forward_properties
        for i, fp in enumerate(forwarded):
            bare = _as_triplet_key(fp.field)
            shared[f"fp__{bare}"] = getattr(
                row, _safe_col_alias(bare, f"fp_{i}"), None,
            )
        if not forwarded:
            # Undeclared contract: the row's own scalars become the node's
            # properties, so `<section>.<column>` addresses the same thing in a
            # filter, a table and a CLUSTER binding. Scalars only — an object or
            # a list is a participant or a justification, and both have homes.
            element = getattr(row, "row_element", None)
            if isinstance(element, dict):
                for k, v in element.items():
                    if k in _GROUNDS_FIELDS or isinstance(v, (dict, list)):
                        continue
                    if v not in (None, ""):
                        shared[f"fp__{k}"] = v
        ev = getattr(row, "evidence", None)
        if isinstance(ev, dict) and ev and self._evidence_passes(ev, proj):
            shared["_inline_justification"] = ev

        # Resolve each role to its (name, type) values.
        per_role: list[tuple[NodeRole, list[tuple[str, str]]]] = []
        for i, role in enumerate(roles):
            explicit_type = getattr(row, f"r{i}_type", None) if role.type_path else None
            vals = _coerce_role_values(
                getattr(row, f"r{i}_val", None), role, explicit_type,
            )
            if vals:
                per_role.append((role, vals))

        atoms: list[GraphAtom] = []
        ann_id = row.annotation_id
        predicate = (getattr(row, "predicate", None) or "") if proj.predicate else ""

        # ── What is this row ABOUT? Three deposits of one mechanism. ────────
        if proj.about == "self":
            return self._occurrence_atoms(row, proj, per_role, shared, ann_id)
        if proj.about and proj.about != "between":
            return self._property_atoms(proj, per_role, shared, ann_id)

        # ── about: between (or unset) — the row relates its participants ────
        #
        # Node atoms for every resolved value. Emitted unconditionally so an
        # entity that relates to nothing still reaches the graph.
        for role, vals in per_role:
            for name, etype in vals:
                atoms.append(NodeRow(
                    annotation_id=ann_id, name=name, type=etype,
                    properties=shared, source_path=proj.path, role=role.label,
                ))

        # Edge atoms across *distinct role slots* only — never within one
        # multi-valued role. Bounds edges by roles² instead of values², so a row
        # naming 50 co-participants cannot contribute 1,225 edges and exhaust
        # ``top_n_edges``. Declaring the same path as two roles is the escape
        # hatch for a genuine clique.
        for si in range(len(per_role)):
            for oi in range(si + 1, len(per_role)):
                s_role, s_vals = per_role[si]
                o_role, o_vals = per_role[oi]
                for s_name, s_type in s_vals:
                    for o_name, o_type in o_vals:
                        # An entity related to itself is noise in any projection.
                        if (s_name.strip().lower() == o_name.strip().lower()
                                and s_type.strip().lower() == o_type.strip().lower()):
                            continue
                        atoms.append(TripletRow(
                            annotation_id=ann_id,
                            subject_name=s_name, subject_type=s_type,
                            predicate=predicate,
                            object_name=o_name, object_type=o_type,
                            properties=shared,
                            source_path=proj.path,
                            subject_role=s_role.label,
                            object_role=o_role.label,
                        ))
        return atoms

    def _occurrence_atoms(
        self,
        row: Any,
        proj: Projection,
        per_role: list[tuple[NodeRole, list[tuple[str, str]]]],
        shared: dict[str, Any],
        ann_id: int,
    ) -> list[GraphAtom]:
        """``about: self`` — the row is a thing, and gets a node of its own.

        One occurrence node carrying the row's **own** when, where, magnitude
        and grounds, plus one role-labelled edge to each participant.

        **Participants inherit nothing.** That empty ``properties`` dict on the
        edge atoms is the whole point of this branch. Handing every atom the
        same ``shared`` dict is what smeared one row's date across everyone
        named in it, so a person's interval became the union of every act they
        ever appeared in and the time slider filtered on a fiction.

        Edges run occurrence → participant, so a row with N participants costs
        N edges rather than N² — and no pair edge is invented between two
        participants who were merely present in the same row.
        """
        name = self._occurrence_name(row, proj, per_role, ann_id)
        is_occurrence = proj.node_kind != "entity"

        # The row may name its own kind — one ``observations[*]`` array whose
        # ``kind`` column says payment, meeting or filing. Falls back to the
        # pinned value, then to a generic, so a projection that pins nothing
        # still produces something filterable.
        declared = getattr(row, "occ_type", None) if proj.node_type_path else None
        node_type = (
            (str(declared).strip() if isinstance(declared, str) and declared.strip() else None)
            or proj.node_type
            or ("Occurrence" if is_occurrence else "Entity")
        )

        # ``shared`` reaches only the occurrence in this branch, so its display
        # label and kind ride on it rather than widening the atom shape.
        #
        # An ``entity`` node is minted the same way and simply does not claim to
        # have happened — see ``Projection.node_kind``.
        if is_occurrence:
            shared["_is_occurrence"] = True
        label = _render_label(row, proj.node_label, per_role)
        if not label and is_occurrence:
            # **An address is not a label.** With nothing declared, identity
            # falls back to `annotation:path:ordinality` — correct as an
            # identity (stable, never folds two reports of one meeting) and
            # unusable as a display name: a contract that declares no
            # `node_name` rendered every node as
            # `5940:document.financial_records[*]:1`, which is the JSON leaking
            # onto the canvas.
            #
            # The section and the ordinal say the same thing and read. Identity
            # is untouched — this is the *display* half, which is why they were
            # separate fields to begin with.
            label = f"{_section_of(proj.path)} #{getattr(row, 'ord', 0)}"
        if label:
            shared["_node_label"] = label

        # ← the scoping fix: participants inherit NOTHING from the row.
        #
        # With one exception, and it is not a leak. ``_edge_group`` describes
        # the EDGE, not the participant at its far end — an edge out of a
        # `denied` statement is a denied edge, and every role edge of one row
        # belongs to that row. Withholding it meant `edge_group_by: modality`
        # produced nothing on an occurrence graph, so a denial painted exactly
        # like an assertion: the one failure mode the model forbids outright.
        #
        # Node-scoped keys (`_t0`, `_place`, `_node_group_*`) stay out, which is
        # what stops one act's date smearing across everyone named in it.
        edge_props: dict[str, Any] = {}
        if "_edge_group" in shared:
            edge_props["_edge_group"] = shared["_edge_group"]
        # …and the row's FORWARDED properties, for exactly the argument above.
        # A forwarded property describes the ROW — `modality`, `kind`,
        # `currency` — and every role edge of one row belongs to that row, so
        # withholding them is the same mistake `_edge_group` was fixed for.
        #
        # Measured before this: 0 of 192 edges carried any property on run
        # 15010, so `edgeEpistemics` (which reads `properties.modality`) had
        # nothing to read and every denial painted exactly like an assertion.
        #
        # Still NOT node-scoped keys — `_t0`, `_place`, `_node_group_*` stay
        # out, which is what stops one act's date smearing across everyone
        # named in it. The distinction is whose fact it is, not where it is
        # convenient to put it.
        for key, value in shared.items():
            if key.startswith("fp__") and value is not None:
                edge_props[key] = value

        atoms: list[GraphAtom] = [NodeRow(
            annotation_id=ann_id, name=name, type=node_type,
            properties=shared, source_path=proj.path, role=proj.label,
        )]
        for role, vals in per_role:
            for pname, ptype in vals:
                atoms.append(TripletRow(
                    annotation_id=ann_id,
                    subject_name=name, subject_type=node_type,
                    predicate=role.label or "participant",
                    object_name=pname, object_type=ptype,
                    properties=dict(edge_props),
                    source_path=proj.path,
                    subject_role=proj.label,
                    object_role=role.label,
                ))
        return atoms

    def _property_atoms(
        self,
        proj: Projection,
        per_role: list[tuple[NodeRole, list[tuple[str, str]]]],
        shared: dict[str, Any],
        ann_id: int,
    ) -> list[GraphAtom]:
        """``about: "<role>"`` — the row describes one participant.

        Its bindings land **on that participant's node** and nothing new is
        minted. This is how a schema gives an entity an interval-valued property
        — a company's registered office, a person's term of office — when the
        entity slot itself is a closed ``{name, type}`` shape.

        Other roles still become nodes (a place named here is a real place), but
        with empty properties: the row is about the subject, not about them.
        A ``predicate`` turns the description into a visible edge as well;
        without one the value is an anchor and nothing is drawn.
        """
        subject = (proj.about or "").strip().lower()
        atoms: list[GraphAtom] = []
        subject_vals: list[tuple[str, str]] = []

        for role, vals in per_role:
            is_subject = (role.label or role.path or "").strip().lower() == subject
            if is_subject:
                subject_vals = vals
            for pname, ptype in vals:
                atoms.append(NodeRow(
                    annotation_id=ann_id, name=pname, type=ptype,
                    properties=shared if is_subject else {},
                    source_path=proj.path, role=role.label,
                ))

        if not subject_vals:
            logger.warning(
                "projection %r: about=%r matches no role; row described nothing",
                proj.path, proj.about,
            )
            return atoms

        if proj.predicate:
            for role, vals in per_role:
                if (role.label or role.path or "").strip().lower() == subject:
                    continue
                for s_name, s_type in subject_vals:
                    for o_name, o_type in vals:
                        atoms.append(TripletRow(
                            annotation_id=ann_id,
                            subject_name=s_name, subject_type=s_type,
                            predicate=proj.predicate,
                            object_name=o_name, object_type=o_type,
                            properties={},
                            source_path=proj.path,
                            subject_role=subject, object_role=role.label,
                        ))
        return atoms

    @staticmethod
    def _occurrence_name(
        row: Any,
        proj: Projection,
        per_role: list[tuple[NodeRole, list[tuple[str, str]]]],
        ann_id: int,
    ) -> str:
        """Identity for an occurrence, in precedence order.

        1. **An identifier the document supplies** (``node_name``) — a case
           number, exhibit number, tail number. A name, not bookkeeping, so
           asking for it is extraction and it is reliable. This is also what
           lets another row reference this one.
        2. **Positional** — ``annotation:path:ordinality``. Honest and stable:
           it never folds two reports of one meeting together, and it does not
           renumber when a live run adds annotations.

        A content address over ``(type, participants, when)`` is the natural
        third rung and is deliberately **not** the default: folding two
        documents' accounts of one event is a resolution decision, made with
        the alias/embedding machinery that already exists, not a silent
        read-time merge that would also collapse two genuinely distinct acts
        with the same cast on the same day.
        """
        if proj.node_name:
            declared = getattr(row, "occ_name", None)
            if isinstance(declared, str) and declared.strip():
                return declared.strip()
        return f"{ann_id}:{proj.path}:{getattr(row, 'ord', 0)}"

    @staticmethod
    def _evidence_passes(ev: dict, proj: Projection) -> bool:
        """Apply an ``EvidenceBinding.where`` filter, if one is declared."""
        if not proj.evidence or not proj.evidence.where:
            return True
        return all(
            str(ev.get(k, "")).strip().lower() == str(v).strip().lower()
            for k, v in proj.evidence.where.items()
        )

    def _path_accessor(
        self,
        path: str,
        *,
        param_prefix: str,
    ) -> tuple[str, dict[str, Any]]:
        """Resolve a dotted path to a SQL text accessor.

        Paths scoped to a projection's own array evaluate on the lateral
        ``elem`` alias; annotation-root paths evaluate on ``a.value``. Used for
        the aggregation-level ``node_group_by`` / ``edge_group_by``, which are
        panel-wide rather than per-projection.
        """
        ep = parse_explosion(path)
        if ep.is_exploded:
            arrays = {p.array_path for p in self.projections}
            if ep.array_field in arrays:
                return jsonb_accessor(
                    "elem", ep.remainder or "", param_name=param_prefix,
                )
            logger.warning(
                "AnnotationGraphSource: path %r references an array outside the "
                "active projections; evaluating at annotation root", path,
            )
            return jsonb_accessor(
                "a.value", ep.array_field or path, param_name=param_prefix,
            )
        return jsonb_accessor("a.value", path, param_name=param_prefix)


# ─── Role and predicate accessors ───────────────────────────────────────────


def _sql_lit(s: str) -> str:
    return s.replace("'", "''")


def _role_json_sql(role: NodeRole) -> str:
    """Raw JSONB for a node role, relative to the lateral ``elem``.

    Three shapes to cover, and one expression that covers each:

    * empty path — the element *is* the entity (an entity roster).
    * a triplet endpoint — COALESCE across the whole alias family, so a row
      that says ``head`` still resolves for a role declared as ``subject_name``.
      This is why the alias sets live in ``schema_map`` rather than here.
    * anything else — the value at that key, whether it's an entity object, a
      bare string, or an array of either. Python coerces.
    """
    if not role.path:
        return "elem"

    family: tuple[str, ...] | None = None
    if role.path in SUBJECT_NAME_KEYS:
        family = SUBJECT_NAME_KEYS
    elif role.path in OBJECT_NAME_KEYS:
        family = OBJECT_NAME_KEYS
    if family:
        return "COALESCE(" + ", ".join(f"elem->'{k}'" for k in family) + ")"

    parts = [p for p in role.path.replace("[*]", "").split(".") if p]
    if len(parts) == 1:
        return f"elem->'{_sql_lit(parts[0])}'"
    return "elem #> '{" + ",".join(_sql_lit(p) for p in parts) + "}'"


def _predicate_sql(path: str) -> str:
    """Text accessor for a projection's predicate.

    COALESCEs the alias family when the declared path is one of the known
    predicate keys — same reasoning as the role families.
    """
    if path in PREDICATE_KEYS:
        return "COALESCE(" + ", ".join(f"elem->>'{k}'" for k in PREDICATE_KEYS) + ")"
    parts = [p for p in path.replace("[*]", "").split(".") if p]
    if len(parts) == 1:
        return f"elem->>'{_sql_lit(parts[0])}'"
    return "elem #>> '{" + ",".join(_sql_lit(p) for p in parts) + "}'"


def _coerce_role_values(
    raw: Any, role: NodeRole, explicit_type: Any = None,
) -> list[tuple[str, str]]:
    """A role's raw JSONB → the ``(name, type)`` pairs it names.

    Accepts every shape the model actually produces: an entity object, a bare
    string (it emits those often enough that dropping them loses real
    mentions), or an array of either. Type precedence is explicit sibling
    column → the entity object's own ``type`` → the role's declared constant.
    """
    fallback = (
        str(explicit_type).strip() if isinstance(explicit_type, str) and explicit_type.strip()
        else (role.type_const or "")
    )

    def one(node: Any) -> list[tuple[str, str]]:
        if isinstance(node, str):
            n = node.strip()
            return [(n, fallback)] if n else []
        if isinstance(node, dict):
            name = node.get("name")
            if not isinstance(name, str) or not name.strip():
                return []
            own = node.get("type")
            etype = own.strip() if isinstance(own, str) and own.strip() else fallback
            return [(name.strip(), etype)]
        if isinstance(node, list):
            out: list[tuple[str, str]] = []
            for item in node:
                out.extend(one(item))
            return out
        return []

    return one(raw)


_LABEL_TOKEN = re.compile(r"\{([^{}]+)\}")


def _label_fields(
    node_label: str | None, role_labels: Iterable[str] = (),
) -> list[str]:
    """Element-relative paths a ``node_label`` needs SELECTED.

    A plain path selects itself; a template selects each ``{field}`` it
    interpolates. Returns ``[]`` when there is nothing to read.

    A token naming a **role** is excluded, because the row already carries that
    value in a better form: ``elem->>'by'`` is the entity object's raw JSON,
    while ``_atoms_for_row`` has the resolved participant *names* in hand by the
    time the label is rendered. Both callers must filter identically — the alias
    is positional, so a mismatch in the list silently renders the wrong column.
    """
    if not node_label or not node_label.strip():
        return []
    tokens = _LABEL_TOKEN.findall(node_label)
    if not tokens:
        return [node_label.strip()]
    roles = {r.strip().lower() for r in role_labels if r and r.strip()}
    return [t.strip() for t in tokens if t.strip() and t.strip().lower() not in roles]


def _label_alias(field: str, index: int) -> str:
    """Column alias for one label field. **The SELECT and the reader must use
    this same function** — computing the alias twice from different fallbacks
    is how a template silently renders empty."""
    return _safe_col_alias(field, f"lbl_{index}")


#: Characters a template uses to join its parts. Stripped from either end once
#: substitution is done, so an empty token cannot leave a dangling separator.
_LABEL_JOINERS = " ·→-–—:,;/|"


def _tidy_label(rendered: str) -> str | None:
    """Collapse a filled template into something that reads.

    ``"{kind} · {by} → {to}"`` on a row with no ``to`` renders
    ``"testimony · Todd Blanche → "``. Rather than growing conditional syntax
    for the template — which would make it a language — the separators are
    simply cleaned off the ends afterwards. Empty in, ``None`` out, so the
    caller falls back to identity.
    """
    out = re.sub(r"\s+", " ", rendered).strip()
    # Collapse a RUN of structural joiners, preferring `·`. An empty token in
    # the middle leaves two adjacent — `payment · P2 → · 2016-01-12` when `to`
    # is blank — and trimming only the ends never reaches it.
    #
    # `·` wins because an ARROW claims a relationship between two participants:
    # collapsing to it left `testimony · Maxwell → 2016-04-22`, which reads as
    # though the date were the thing testified to. A dot merely separates.
    #
    # Only `·` and `→`, never the wider trim set: `-` is structural at the edges
    # of a label and a legitimate character inside one, so including it here
    # turned `2016-01-12` into `2016- 01- 12`.
    out = re.sub(
        r"\s*([·→])(?:\s*[·→])+\s*",
        lambda m: " · " if "·" in m.group(0) else f" {m.group(1)} ",
        out,
    )
    while out and out[-1] in _LABEL_JOINERS:
        out = out[:-1].rstrip()
    while out and out[0] in _LABEL_JOINERS:
        out = out[1:].lstrip()
    return out or None


def _render_label(
    row: Any,
    node_label: str | None,
    per_role: Iterable[tuple[NodeRole, list[tuple[str, str]]]] = (),
) -> str | None:
    """An occurrence's display name — a field's value, or a filled template.

    ``"{from_place} → {to_place}"`` reads far better on a card than either
    endpoint alone, and a template costs one extra selected column per token.
    A token that resolved to nothing renders empty rather than leaking the
    placeholder; a template that resolved to nothing at all yields None so the
    caller falls back to identity.

    **A token may name a role**, and that is the useful case for the observation
    model. An occurrence is identified by what it *is* and labelled by what
    reads well, and what reads well is almost always who was in it: bound to the
    row's own ``kind`` column alone, every act in a section renders under the
    same word — a list of fourteen rows all called "testimony". Roles resolve
    from the participants already computed for the edge atoms, so this costs no
    column and no query.
    """
    by_role = {
        (role.label or role.path or "").strip().lower():
            ", ".join(n for n, _ in vals)
        for role, vals in per_role
    }
    fields = _label_fields(node_label, by_role.keys())
    if not fields and not by_role:
        return None
    by_field = {f: _label_alias(f, i) for i, f in enumerate(fields)}

    def value(fld: str) -> str:
        key = fld.strip().lower()
        if key in by_role:
            return by_role[key]
        v = getattr(row, by_field.get(fld, ""), None)
        return "" if v is None else str(v)

    if node_label and _LABEL_TOKEN.search(node_label):
        out = _LABEL_TOKEN.sub(lambda m: value(m.group(1).strip()), node_label)
        return _tidy_label(out)
    return _tidy_label(value(fields[0])) if fields else None


def _as_triplet_key(field: str) -> str:
    """Reduce a field reference to its bare key.

    Pickers emit full paths like ``document.triplets[*].weight``, but
    ``forward_properties`` and weight fields name a key *inside* the exploded
    element. Strip the prefix so SQL and the Python consumers agree.
    """
    s = field.rstrip()
    if s.endswith("[*]"):
        s = s[:-3]
    return s.rsplit(".", 1)[-1] if "." in s else s


def _safe_col_alias(field_path: str, fallback: str) -> str:
    """Build a safe SQL column alias from a field path."""
    safe = "".join(c if c.isalnum() or c == "_" else "_" for c in field_path)
    if not safe or not safe[0].isalpha():
        return fallback
    return f"_fp_{safe}"


# ─── PersistentGraphSource (materialized) ───────────────────────────────────


@dataclass
class PersistentGraphSource:
    """Materialized source: reads the ``GraphEdge`` table.

    Windows by edge id ascending. Entry metadata comes from ``CanonEntry`` via
    join. The DB-side columns are ``source_entry_id`` / ``target_entry_id``
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
                    src.canonical     AS subject_name,
                    src.type          AS subject_type,
                    ge.predicate      AS predicate,
                    tgt.canonical     AS object_name,
                    tgt.type          AS object_type
                FROM graphedge ge
                JOIN canon_entry src ON src.id = ge.source_entry_id
                JOIN canon_entry tgt ON tgt.id = ge.target_entry_id
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
    # Node slots are independent of edges. They used to be derived *from*
    # edge_slots, which meant an entity that related to nothing never appeared
    # however often it was named — invisible rosters. Now every atom registers
    # its nodes directly and edges only add to them.
    node_slots: dict[str, dict[str, Any]] = {}
    annotation_ids_by_node: dict[str, set[int]] = {}
    node_group_by_id: dict[str, str | None] = {}  # first-seen wins
    # Per-node evidence: every atom where this node appears contributes its
    # inline justification. Keyed by node id.
    evidence_by_node: dict[str, list[dict[str, Any]]] = {}
    # Per-node evidence dedup — same justification dict can appear multiple
    # times when atoms share evidence; this set keys on a stable hash so
    # we keep one copy per node per unique payload.
    seen_evidence_keys: dict[str, set] = {}

    def _touch_node(
        name: str, type_: str, atom: Any, group_key: str, role: str | None = None,
        *, own: bool = True,
    ) -> str:
        """Register (or update) a node slot from any atom that names it.

        ``group_key`` selects which ``node_group_by`` value in the atom's
        properties applies to this endpoint; ``role`` is the display label the
        node appeared under. They are separate because an edge's two endpoints
        read different group slots but carry their own role names.

        ``own`` says whether this atom is the node's **own** row or merely one
        that mentions it. An edge's endpoints are the latter, and the
        distinction decides whether the row's forwarded properties land here —
        see the harvest below.
        """
        props = atom.properties or {}
        node_id = _node_id(name, type_)
        slot = node_slots.setdefault(node_id, {
            # Identity and display are **separate**, and both are kept.
            #
            # ``ident`` is the string the row was named by — a document-supplied
            # reference ("TX-1", "EX-4") or the positional fallback. It is what
            # another row points at, and therefore what the typeless fold has to
            # match on: the model links statements by names the *document*
            # supplies, so evidence saying ``supports: "TX-1"`` must reach the
            # transfer called TX-1. Folding on the display name instead silently
            # broke every cross-row reference the moment a projection set
            # ``node_label`` — which the templates do for every occurrence.
            #
            # ``name`` is what reads on a card. An occurrence identified by a
            # case number should still show "€4m Acme → Bellweather".
            "ident": name,
            "name": props.get("_node_label") or name,
            "type": type_,
            "kind": "occurrence" if props.get("_is_occurrence") else "entity",
            "mentions": 0,
            "t0": None, "t1": None, "t1_open": False,
            "a0": None, "a1": None, "a1_open": False,
            "place": None, "place_to": None,
            "places": [], "place_keys": set(),
            "magnitude": None,
            "source_paths": set(),
            "roles": set(),
            "properties": {},
        })
        slot["mentions"] += 1
        # An occurrence is never demoted. The row that minted it says so; every
        # other mention is a reference to it. Without this the answer depends on
        # read order — an exhibit reached first as the target of a `cites` edge
        # latched ``entity``, so ``kind:occurrence`` could not find it and the
        # item pane would not list it, and running the projections in the other
        # order silently gave the opposite result.
        if props.get("_is_occurrence"):
            slot["kind"] = "occurrence"
        # Same rule for the display name. The row that minted the node decides
        # how it reads; a row that merely *references* it by name knows only the
        # identifier. Read the reference first and an exhibit was captioned
        # "Exhibit C" instead of the words it contains.
        if props.get("_node_label") and not slot.get("_labelled"):
            slot["name"] = props["_node_label"]
            slot["_labelled"] = True
        if atom.source_path:
            slot["source_paths"].add(atom.source_path)
        if role:
            slot["roles"].add(role)
        _absorb_interval(slot, props, "_t0", "_t1", "t0", "t1", "t1_open")
        _absorb_interval(slot, props, "_act0", "_act1", "a0", "a1", "a1_open")
        # ── Places accumulate; they do not overwrite ────────────────────────
        #
        # A node's location is a *list*, because that is what the world is: a
        # company holds a registered office, a head office and a tax residence
        # at the same time, in three countries, each over its own interval.
        # First-seen-wins gives one right answer and several wrong ones, and
        # makes a redomiciliation invisible.
        trip = bool(props.get("_place_to"))
        for raw, end in ((props.get("_place"), "from" if trip else None),
                         (props.get("_place_to"), "to")):
            if not raw:
                continue
            entry = {
                "place": str(raw),
                "lat": None, "lon": None,
                "from": _as_ts(props.get("_t0")),
                "to": _as_ts(props.get("_t1")),
                "kind": (str(props["_place_kind"])
                         if props.get("_place_kind") else None),
                "source": props.get("_place_source", "row"),
                "end": end,
            }
            key = (entry["place"], entry["from"], entry["to"],
                   entry["kind"], entry["source"], entry["end"])
            if key not in slot["place_keys"]:
                slot["place_keys"].add(key)
                slot["places"].append(entry)
            if slot["place"] is None and end != "to":
                slot["place"] = entry["place"]
        # A trajectory's far end. Present only when the projection bound
        # ``place {start, end}`` — a movement is at neither endpoint, it spans
        # them, and the renderer needs both to draw the arc.
        if slot["place_to"] is None and props.get("_place_to"):
            slot["place_to"] = str(props["_place_to"])
        # Magnitude is what the document said this act was worth. Kept apart
        # from ``frequency`` (how often we saw it) because they answer
        # different questions and conflating them is how "mentioned a lot"
        # starts looking like "large".
        if slot["magnitude"] is None and props.get("_edge_weight_raw") is not None:
            slot["magnitude"] = props["_edge_weight_raw"]
        # A row's forwarded fields belong to the node the row is ABOUT, exactly
        # as its date and place do. Declared on the wire since the beginning and
        # never filled, so an exhibit's stance, source and locator were read off
        # an empty dict and the evidence pane fell back to the node's label.
        #
        # Reached only for the node the row is ABOUT — the occurrence for an
        # ``about: self`` row, the subject for a property row. Participants stay
        # clean, which is the same scoping rule as everywhere else.
        #
        # ``own`` is what enforces that now. Role edges used to carry ``{}``, so
        # the rule held by accident; once forwarded properties were put ON the
        # edges — deliberately, so ``edgeEpistemics`` could paint a denial
        # differently from an assertion — every endpoint began inheriting them
        # through here. A deposition's ``modality: denied`` landed on the
        # witness, the person denied about, the case, and the exhibit cited:
        # the graph asserting of a *person* what a *statement* said. Exactly the
        # smearing the `_t0` / `_place` exclusions above exist to prevent, one
        # field over. Edges keep the properties; nodes take only their own.
        if own:
            for key, value in props.items():
                if key.startswith("fp__") and value is not None:
                    slot["properties"].setdefault(key[4:], value)
        annotation_ids_by_node.setdefault(node_id, set()).add(atom.annotation_id)
        # First-seen **non-null** wins, not first-seen. An occurrence's
        # role-edges carry empty properties by design (participants inherit
        # nothing), so a participant reached through one before its roster row
        # would otherwise latch ``None`` and never take the real value — making
        # colour-by and cluster-by depend on which projection happened to be
        # read first. Same trap for any projection that simply lacks the field.
        if has_node_group and node_group_by_id.get(node_id) is None:
            node_group_by_id[node_id] = props.get(group_key)
        ev = props.get("_inline_justification")
        if isinstance(ev, dict) and ev:
            try:
                ev_key = json.dumps(ev, sort_keys=True, default=str)
            except (TypeError, ValueError):
                ev_key = id(ev)
            seen = seen_evidence_keys.setdefault(node_id, set())
            if ev_key not in seen:
                seen.add(ev_key)
                evidence_by_node.setdefault(node_id, []).append(ev)
        return node_id

    async for window in source.windows(chunk_size):
        if not window:
            continue

        for row in window:
            props = row.properties or {}

            # Node atoms carry no relationship — register and move on.
            if isinstance(row, NodeRow):
                if row.name:
                    _touch_node(
                        row.name, row.type, row, "_node_group_subj", row.role,
                    )
                continue

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
                # Existence interval and activity interval, unioned across every
                # contributing atom. An open end (a bare timestamp) wins: the
                # union of "from A onward" and "[B, C]" is "from min onward".
                "t0": None, "t1": None, "t1_open": False,
                "a0": None, "a1": None, "a1_open": False,
                "source_paths": set(),
                # First-seen original-case display strings. The slot key uses
                # normalized values so "Apple Inc." and "apple inc." merge,
                # but we render whichever spelling appeared first.
                "subject_name_display": row.subject_name,
                "subject_type_display": row.subject_type,
                "predicate_display": row.predicate,
                "object_name_display": row.object_name,
                "object_type_display": row.object_type,
                # The role the target plays. On an occurrence edge this is the
                # participant slot (``payer``, ``via``); on a connection it is
                # whatever the object role was called. Role-scoped degree is
                # what turns "340 connections" into "``via`` in 340 payments",
                # which is how an intermediary is discovered rather than declared.
                "role_display": row.object_role,
            })
            slot["weight"] += row.weight
            slot["annotation_ids"].add(row.annotation_id)
            if row.source_path:
                slot["source_paths"].add(row.source_path)
            _absorb_interval(slot, props, "_t0", "_t1", "t0", "t1", "t1_open")
            _absorb_interval(slot, props, "_act0", "_act1", "a0", "a1", "a1_open")

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

            # **Whatever the atom carries, not whatever the panel listed.**
            #
            # This read only the PANEL's `forward_properties`, so a projection
            # declaring `properties: [{field: modality}]` put modality on its
            # NODES and never on its EDGES. With no panel config that left every
            # edge with an empty property bag — measured: 0 of 192 on run 15010 —
            # and `edgeEpistemics` reads `properties.modality`, so **every denial
            # painted exactly like an assertion**. On a corpus where the
            # difference between alleged and adjudicated is the whole point,
            # that is not a missing feature, it is a wrong picture.
            #
            # The atom already carries `fp__<field>` for the projection's own
            # declarations (and, on an undeclared contract, for the row's own
            # scalars). The node side has always read them that way; this is the
            # edge side catching up.
            for key, v in props.items():
                if not key.startswith("fp__") or v is None:
                    continue
                slot["fp_values"].setdefault(key[4:], []).append(v)

            # An edge's endpoints are nodes in their own right — same registry
            # the node atoms use, so intervals and evidence merge across both.
            _touch_node(row.subject_name, row.subject_type, row,
                        "_node_group_subj", row.subject_role, own=False)
            _touch_node(row.object_name, row.object_type, row,
                        "_node_group_obj", row.object_role, own=False)

        # Stop reading windows once either cap is reached.
        if top_n_edges is not None and len(edge_slots) >= top_n_edges:
            break
        if top_n_nodes is not None and len(node_slots) >= top_n_nodes:
            break

    if not node_slots:
        # **Clear what the last call decided.** These are module-level slots,
        # so an empty result used to leave the PREVIOUS query's legend standing
        # — "clustered by Interest — 8 groups" printed over a canvas with no
        # nodes at all. A confident sentence about work that did not happen, on
        # exactly the query where the reader most needs to know why they are
        # looking at nothing.
        _LAST_SIZE_LEGEND.clear()
        _LAST_SIZE_NOTES.clear()
        _LAST_CLUSTER_LEGEND.clear()
        _LAST_CLUSTER_NOTES.clear()
        return

    # Fold typeless mentions into their typed twin, and remap the edges that
    # referenced them. Without this the linking payoff doesn't land: a roster
    # that declares no ``entity_type`` yields ``("Merkel", "")`` while the
    # triplet that names her yields ``("Merkel", "Person")``, so the "same
    # entity in two fields is one node" promise silently produces two.
    id_remap = _fold_typeless_nodes(node_slots, annotation_ids_by_node,
                                   evidence_by_node, node_group_by_id)

    # Materialize node objects from the node registry. Display name/type are
    # each slot's first-seen original-case strings; the id is derived from the
    # case-insensitive form so spelling variants merge regardless of ``dedup``
    # mode. Frequency is mention count plus incident edge weight, so an
    # entity that is named often but related rarely still ranks.
    nodes_by_id: dict[str, GraphNode] = {}
    for node_id, slot in node_slots.items():
        kind = slot.get("kind", "entity")
        nodes_by_id[node_id] = GraphNode(
            id=node_id, name=slot["name"], type=slot["type"],
            kind=kind,
            # An occurrence's declared kind is its type. Mirroring it means
            # ``type:Payment`` filters occurrences with no new grammar, while
            # ``kind:occurrence`` separates them from entities.
            node_type=slot["type"] if kind == "occurrence" else None,
            magnitude=slot.get("magnitude"),
            frequency=slot["mentions"],
            source_annotation_ids=sorted(annotation_ids_by_node.get(node_id, set())),
            group_value=node_group_by_id.get(node_id) if has_node_group else None,
            evidence=evidence_by_node.get(node_id, []),
            t0=slot["t0"],
            t1=None if slot["t1_open"] else slot["t1"],
            a0=slot["a0"],
            a1=None if slot["a1_open"] else slot["a1"],
            place=slot["place"],
            place_to=slot.get("place_to"),
            places=[NodePlace(**p) for p in slot.get("places", [])],
            source_paths=sorted(slot["source_paths"]),
            roles=sorted(r for r in slot["roles"] if r),
            properties=slot.get("properties") or {},
        )
    for slot in edge_slots.values():
        s_id = id_remap.get(
            _node_id(slot["subject_name_display"], slot["subject_type_display"]),
            _node_id(slot["subject_name_display"], slot["subject_type_display"]),
        )
        o_id = id_remap.get(
            _node_id(slot["object_name_display"], slot["object_type_display"]),
            _node_id(slot["object_name_display"], slot["object_type_display"]),
        )
        for nid in (s_id, o_id):
            if nid in nodes_by_id:
                nodes_by_id[nid].frequency += slot["weight"]

    # The document rung, applied before coordinates so a doc place geocodes
    # through the same path as any other.
    _attach_doc_anchors(
        nodes_by_id, annotation_ids_by_node,
        getattr(source, "doc_anchors", None) or {},
    )

    # Geo anchors. One batched lookup against the run's canon — coords land on
    # ``CanonEntry.properties.coords`` via the geocode action, so a node that
    # resolved there gets a hard position for the map/geo layout anchor without
    # the frontend querying anything.
    _attach_coords(session, infospace_id, nodes_by_id)

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
        raw_s = _node_id(slot["subject_name_display"], slot["subject_type_display"])
        raw_o = _node_id(slot["object_name_display"], slot["object_type_display"])
        s_id = id_remap.get(raw_s, raw_s)
        o_id = id_remap.get(raw_o, raw_o)
        # A typeless endpoint folded into its typed twin can make an edge
        # self-referential; drop those rather than render a loop.
        if s_id == o_id or s_id not in kept_ids or o_id not in kept_ids:
            continue
        computed_weight = _compute_edge_weight(slot, edge_weight_mode)
        edge_props = _aggregate_forward_properties(
            slot["fp_values"], forward_properties,
        )
        all_edges.append(GraphEdge(
            source=s_id, target=o_id,
            predicate=slot["predicate_display"],
            kind=_edge_kind(
                slot["predicate_display"], slot.get("role_display"),
                node_slots.get(s_id), node_slots.get(o_id),
            ),
            role=slot.get("role_display"),
            weight=slot["weight"],
            computed_weight=computed_weight,
            group_value=edge_group,
            properties=edge_props,
            evidence=slot["evidence"],
            t0=slot["t0"],
            t1=None if slot["t1_open"] else slot["t1"],
            a0=slot["a0"],
            a1=None if slot["a1_open"] else slot["a1"],
            source_paths=sorted(slot["source_paths"]),
            source_annotation_ids=sorted(slot["annotation_ids"]),
        ))

    # Computed clustering keys — an interest profile or a role distribution is
    # a property of the assembled graph, so it can only be derived here, once
    # both nodes and edges exist. Overwrites the row-read ``group_value`` when
    # the binding names a computed form.
    node_group_spec: str | None = getattr(source, "node_group_by", None)
    roles_by_path = _roles_by_path(source)
    # **A query that asks for the why-axis gets it.**
    #
    # `converge>` and `contact>` read the interest profile, and the profile was
    # only computed when a panel happened to set `node_group_by:
    # "neighbours:Interest"` — an unrelated field, in a different surface, that
    # nobody connects to the query they just typed. Without it the query parsed,
    # ran, and returned NOTHING, which is the exact failure this language exists
    # to make impossible: a confident empty answer to a well-formed question.
    #
    # The query already says what it needs. `VECTOR:` names the direction and
    # `converge`/`contact` read it, so either is sufficient to ask for the
    # profile; the type comes from what the vector-role sections actually
    # produced, never from the word "Interest".
    if not node_group_spec and _wants_profile(source):
        vector_type = _vector_entity_type(all_nodes, roles_by_path)
        if vector_type:
            node_group_spec = f"{NEIGHBOUR_PREFIX}{vector_type}"

    attach_neighbour_profiles(
        all_nodes, all_edges, node_group_spec, roles_by_path=roles_by_path,
    )

    # Size, and the reasons for it. Server-side because the denominator needs
    # the whole population — a median or a rank computed over the client's
    # capped view is a different number from the same query.
    attach_sizes(all_nodes, all_edges, getattr(source, "channels", None))

    # Which pile each node goes in. Beside sizes because both are bindings
    # resolved from declarations onto nodes; unlike sizes, the *geometry* stays
    # on the canvas — this only decides membership.
    attach_clusters(all_nodes, all_edges, getattr(source, "channels", None))

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


#: ``node_group_by`` values that are computed from the assembled graph rather
#: than read off a row. See :func:`attach_neighbour_profiles`.
#: Row keys that are grounds rather than properties — they have their own rail
#: and would be noise in a property bag.
_GROUNDS_FIELDS = frozenset({"justification", "evidence", "grounds", "citation"})

NEIGHBOUR_PREFIX = "neighbours:"
ROLE_PROFILE = "roles"

#: Roles that mean *against*. A profile built by counting alone cannot tell
#: pursuing an interest from frustrating it, so two actors working to defeat the
#: same thing and two working to achieve it come out identically — and an actor
#: who serves X reads as aligned with one who blocks it. Signing the profile is
#: what makes the residual able to find OPPOSITION as well as convergence, which
#: is the whole of "warm in trade, hostile in politics".
OPPOSING_ROLES: frozenset[str] = frozenset({"opposes", "against", "blocks"})


#: Entity types that must never receive a coordinate, however their name reads.
#: A motive is not a location; pinning one to a map would present an inference
#: with the visual authority of a verifiable fact.
NON_SPATIAL_TYPES: frozenset[str] = frozenset({"interest"})


def is_computed_group(spec: str | None) -> bool:
    """Is this ``node_group_by`` derived from the graph rather than read off a row?"""
    return bool(spec) and (spec == ROLE_PROFILE or spec.startswith(NEIGHBOUR_PREFIX))


#: Layout roles whose nodes cannot hold a motive, and so must never accumulate
#: an interest profile.
#:
#: * ``anchor`` — positions from outside. A city, a channel, a docket: the
#:   setting an act happened in, not a party to it. Lisbon and Bari came back
#:   from ``converge>0.4`` scoring as aligned actors, which is a category error
#:   the number gives no hint of: a place has no interests, and two places
#:   "converging" is just two places that hosted similar acts.
#: * ``vector`` — IS the thing being profiled. Profiling it against itself
#:   makes every interest maximally similar to the interests it co-occurs with.
#:
#: Read from what the section DECLARED, never from a type name, so a contract
#: whose places are called ``sites`` and whose interests are called ``motives``
#: is excluded on exactly the same grounds.
NON_PROFILING_ROLES: frozenset[str] = frozenset({"anchor", "vector"})

#: How a pole is spelled into a profile key. Sign is part of the **key**, not
#: the value, and that is the whole fix for cancellation — see
#: :func:`_profile_key`.
POLE_SERVES = "▲"      # ▲
POLE_OPPOSES = "▼"     # ▼


def _profile_key(label: str, opposing: bool) -> str:
    """``opacity`` + a pole → one profile dimension.

    **Sign belongs in the key.** It used to be in the value: serving added
    ``+1`` and opposing added ``-1`` to the same entry, so an actor who both
    pursued and frustrated an interest netted to exactly ``0`` — and a zero
    entry is indistinguishable from an interest they never touched. It was then
    dropped as "no information", when it is the opposite: an actor working both
    sides of the same interest is a finding, and the arithmetic meant to reveal
    stated-versus-revealed was destroying it.

    No sum over one key can hold both "how much" and "which way", because the
    two directions annihilate. Two keys can, and cancellation stops being
    unlikely and starts being **unreachable**.

    What this trades away, stated plainly: two actors on opposite sides of the
    same interest used to cosine to ``-1`` and now cosine to ``0`` — orthogonal
    rather than opposed, because they share no dimension. Reading opposition as
    a negative number was only ever available by accepting cancellation, and
    ambivalence is the more common case. Pair-scoped opposition is a `polar`
    reading and belongs with the rest of that work, not smuggled into a cosine.

    Two parties who both *oppose* the same thing still converge, which is
    correct — they share the ``▼`` dimension, and they do agree.
    """
    return f"{label}{POLE_OPPOSES if opposing else POLE_SERVES}"


def _roles_by_path(source: Any) -> dict[str, str]:
    """``projection path -> declared layout role``, when the source has any."""
    out: dict[str, str] = {}
    for p in getattr(source, "projections", None) or ():
        path = getattr(p, "path", None)
        role = getattr(p, "role", None)
        if path and role:
            out[path] = str(role).strip().lower()
    return out


#: Shape keys whose answer is computed from the interest profile.
_PROFILE_KEYS: frozenset[str] = frozenset({"converge", "contact"})


def _wants_profile(source: Any) -> bool:
    """Does this query need the why-axis computed?

    True when it reads the profile (``converge``/``contact``) or names a
    direction (``VECTOR:``). Both are the analyst saying the question is about
    what the activity serves.
    """
    q = getattr(source, "gql", None)
    if q is not None:
        for c in getattr(q, "shape_conditions", None) or ():
            if str(getattr(c, "key", "")).lower() in _PROFILE_KEYS:
                return True
    chans = getattr(source, "channels", None)
    return bool(chans is not None and hasattr(chans, "get") and chans.get("VECTOR"))


def types_by_role(
    nodes: list[GraphNode], roles_by_path: dict[str, str] | None,
) -> dict[str, list[str]]:
    """``declared layout role -> the entity types its sections produced``.

    Read off the assembled nodes rather than off the contract, because what a
    section *declares* and what it actually minted can differ — a roster nobody
    filled contributes no types, and offering a pane for it would be offering
    an empty one.

    This is what lets a pane be scoped without naming a noun: the panes pane
    preset says ``role: vector`` and this turns that into ``type:Interest`` on
    a contract that says ``interests``, or ``type:Motive`` on one that says
    ``motives``, with neither word appearing anywhere but the schema.
    """
    if not roles_by_path:
        return {}
    counts: dict[str, dict[str, int]] = {}
    for n in nodes:
        t = (n.type or "").strip()
        if not t:
            continue
        for p in (n.source_paths or ()):
            role = roles_by_path.get(p)
            if role:
                # `counts.setdefault(r, {})[t] = counts[r].get(t, 0) + 1` reads
                # as one statement and is two: Python evaluates the RIGHT side
                # first, so `counts[r]` ran before `setdefault` created it and
                # the first node of every role raised KeyError. Bound once,
                # then used.
                bucket = counts.setdefault(role, {})
                bucket[t] = bucket.get(t, 0) + 1
    # Ordered by how much each type actually contributed, so a pane scoped to
    # the top two is scoped to the ones that matter.
    return {
        role: sorted(ts, key=ts.__getitem__, reverse=True)
        for role, ts in counts.items()
    }


def _vector_entity_type(
    nodes: list[GraphNode], roles_by_path: dict[str, str] | None,
) -> str | None:
    """The entity type the vector-role sections produced.

    Read off the assembled nodes rather than assumed, so a contract whose
    directions are called ``motives`` and typed ``Motive`` works exactly as one
    that says ``interests`` and ``Interest`` — the whole point of the
    declaration chain is that no layer below the schema knows either word.
    """
    if not roles_by_path:
        return None
    counts: dict[str, int] = {}
    for n in nodes:
        if not any(roles_by_path.get(p) == "vector" for p in (n.source_paths or ())):
            continue
        t = (n.type or "").strip()
        if t:
            counts[t] = counts.get(t, 0) + 1
    return max(counts, key=counts.__getitem__) if counts else None


def _can_hold_a_motive(node: GraphNode, roles_by_path: dict[str, str] | None) -> bool:
    """Is this node the kind of thing that can want something?

    Decided by the roles its own projections declared, and **any anchor or
    vector role disqualifies it** — not "any participating role qualifies it".

    The difference is the whole fix. Bari is a member of the ``places`` roster
    (``role: anchor``) *and* is referenced by three claim sections that name it
    as where something happened. Under "any participating role wins" it kept a
    profile and came back from ``converge>`` as an aligned actor, which is a
    category error the number gives no hint of: a city has no interests, and
    two cities "converging" is two cities that hosted similar acts.

    Being named as a setting does not make something a party. Where a node
    genuinely is both — an organisation that is also a venue — excluding it is
    the safer error: a fabricated profile entry is a wrong finding, a missing
    one is a visible gap.

    With nothing declared, everything qualifies. A contract that never wrote
    ``x-graph`` behaves exactly as it did, which is the rule the declaration
    chain has followed everywhere else: declaring adds precision, and not
    declaring is not an error.
    """
    if not roles_by_path:
        return True
    return not any(
        roles_by_path.get(p) in NON_PROFILING_ROLES
        for p in (node.source_paths or ())
    )


def attach_neighbour_profiles(
    nodes: list[GraphNode], edges: list[GraphEdge], spec: str | None,
    roles_by_path: dict[str, str] | None = None,
) -> None:
    """Give each node a weighted profile of what it is connected to. In place.

    Some clustering keys are not fields on any row. *"How much of this actor's
    activity serves opacity"* is an aggregate over ``actor → occurrence →
    interest`` weighted by what each act was worth — you cannot read it off the
    row that mentioned the actor, because it is a property of the assembled
    graph. The row-field form of ``node_group_by`` (first-seen wins) is the
    wrong instrument entirely.

    Two computed forms, one mechanism:

    ``neighbours:<Type>``
        The weighted distribution of ``<Type>``-typed nodes reachable in one
        step, **through occurrences**. This is the interest profile —
        ``{opacity: 8.2, financial_gain: 3.1}`` — and it is what makes the
        affinity anchor cluster actors by what they serve. Weight is the
        occurrence's own magnitude when it has one, else 1, so a large act
        pulls harder than a small one.

    ``roles``
        The distribution of roles a node occupies across its incident edges —
        ``{via: 340, employer: 12}``. This is how an intermediary is
        *discovered*: "``via`` in 340 payments" is a finding, "340 connections"
        is not.

    Both land on ``group_value`` as a ``{label: weight}`` map, which the
    frontend's ``affinityOf`` already consumes — a weighted map is precisely
    the vector shape an affinity anchor wants, so clustering needs no new
    force code.

    **Only the neighbour form also lands on ``profile``**, and that asymmetry
    is the point. The convergence residual cosines profiles, and a cosine over
    two role histograms is a confident number about nothing: ``{via: 340}``
    against ``{via: 12}`` scores a perfect 1.0 and means "both are
    intermediaries a lot", which is not alignment. ``group_value`` holds
    whatever the panel asked to group by; ``profile`` holds a semantic vector
    or nothing. See :attr:`GraphNodeData.profile`.
    """
    if not spec:
        return
    by_id = {n.id: n for n in nodes}

    if spec == ROLE_PROFILE:
        profiles: dict[str, dict[str, float]] = {}
        for e in edges:
            if not e.role:
                continue
            for nid in (e.source, e.target):
                bucket = profiles.setdefault(nid, {})
                bucket[e.role] = bucket.get(e.role, 0.0) + float(e.weight or 1)
        for nid, prof in profiles.items():
            if nid in by_id:
                by_id[nid].group_value = prof
        return

    if not spec.startswith(NEIGHBOUR_PREFIX):
        return
    want = spec[len(NEIGHBOUR_PREFIX):].strip().lower()
    if not want:
        return

    # occurrence -> its participants, and occurrence -> the targets we profile.
    # The ROLE is carried along: it is what tells pursuing an interest from
    # working against it, and dropping it here is what made the two identical.
    incident: dict[str, list[tuple[str, str | None]]] = {}
    for e in edges:
        for a, b in ((e.source, e.target), (e.target, e.source)):
            if by_id.get(a) is not None and by_id[a].kind == "occurrence":
                incident.setdefault(a, []).append((b, e.role))

    profiles: dict[str, dict[str, float]] = {}
    for occ_id, members in incident.items():
        occ = by_id[occ_id]
        # **One act, one vote.** Magnitude used to be the weight, and it does
        # not survive real money: a EUR 41,000,000 contract outvoted every
        # unweighted act by seven orders of magnitude, so the cosine between two
        # organisations was decided entirely by contract size and the
        # convergence residual returned nothing at all.
        #
        # That is a category error rather than a tuning problem, and the field's
        # own docstring says why — magnitude is "not a measurement… uncalibrated
        # and not comparable across documents". A quantity that cannot be
        # compared across documents cannot weight a vector that is. It is also
        # incommensurable *within* a run: euros, casualty counts and a
        # model-emitted 1–10 score all land in the same field, so no rescaling
        # (log, percentile, per-interest normalisation) makes them one unit —
        # it only makes the error smaller.
        #
        # The sign is the finding; the size is an artefact of what the document
        # happened to state. Magnitude is not lost: it stays on the occurrence,
        # where `WEIGHT:numeric` reads it as SIZE, which is the question it can
        # actually answer.
        weight = 1.0
        targets = [
            (m, role) for m, role in members
            if (by_id[m].type or "").strip().lower() == want
        ]
        if not targets:
            continue
        target_ids = {m for m, _ in targets}
        for m, _ in members:
            if m in target_ids:
                continue          # a target does not profile itself
            if not _can_hold_a_motive(by_id[m], roles_by_path):
                continue          # a place has no interests — see NON_PROFILING_ROLES
            bucket = profiles.setdefault(m, {})
            for t, role in targets:
                label = by_id[t].name
                # **Two-sided, as a KEY.** Serving and opposing an interest are
                # separate dimensions, so an actor who does both shows up as
                # doing both instead of netting to zero and vanishing. See
                # `_profile_key` for what that buys and what it costs.
                opposing = (role or "").strip().lower() in OPPOSING_ROLES
                key = _profile_key(label, opposing)
                bucket[key] = bucket.get(key, 0.0) + weight

    for nid, prof in profiles.items():
        # Both slots: `group_value` because the panel asked to group by this,
        # `profile` because it is genuinely a semantic vector. The role form
        # above writes only the first — it is a grouping, not an affinity.
        by_id[nid].group_value = prof
        by_id[nid].profile = prof


#: Where :func:`attach_sizes` leaves what it decided, for ``_graph_meta`` to
#: put on the wire. A module-level slot rather than a return value because the
#: assembly path is a generator and threading one more tuple element through it
#: would touch every caller for a string.
_LAST_SIZE_LEGEND: list[str] = []

#: …and what it could not do with what was written. Amber, not neutral.
_LAST_SIZE_NOTES: list[str] = []


def attach_sizes(
    nodes: list[GraphNode], edges: list[GraphEdge], channels: Any,
) -> None:
    """Resolve the ``WEIGHT:`` binding onto ``node.size``. In place.

    No binding, no sizes: an unconfigured panel keeps the renderer's own
    default rather than being silently switched onto a measure nobody asked
    for.
    """
    _LAST_SIZE_LEGEND.clear()
    _LAST_SIZE_NOTES.clear()
    if channels is None or not nodes:
        return
    binding = channels.get("WEIGHT") if hasattr(channels, "get") else None
    if binding is None:
        return

    from app.api.modules.graph.measures import measure_nodes, parse_measure

    spec = parse_measure(binding)
    sized = measure_nodes(spec, nodes, edges)
    for n in nodes:
        n.size = sized.sizes.get(n.id)
    _LAST_SIZE_LEGEND[:] = [f"size: {spec.render()}", *sized.legend]
    _LAST_SIZE_NOTES[:] = sized.notes


def size_legend() -> list[str]:
    """What the last :func:`attach_sizes` decided, for ``meta.legend``."""
    return list(_LAST_SIZE_LEGEND)


def size_notes() -> list[str]:
    """What it could not do with what was written, for ``meta.notes``."""
    return list(_LAST_SIZE_NOTES)


#: What the last :func:`attach_clusters` decided.
_LAST_CLUSTER_LEGEND: list[str] = []

#: …and what it could not do with what was written. Amber, not neutral.
_LAST_CLUSTER_NOTES: list[str] = []

#: The keys the last binding tried, when it placed nothing — so the route can
#: turn "matched no node" into "try these columns".
_LAST_CLUSTER_KEYS: list[str] = []

#: Keys ``CLUSTER:`` understands directly, in the spelling an analyst would
#: reach for. Everything else is looked up in ``node.properties`` and then
#: against the node's declared sections, so a schema's own words work without
#: any of them appearing here.
_CLUSTER_KEYS: dict[str, Any] = {
    "type": lambda n: n.node_type or n.type,
    "kind": lambda n: n.kind,
    "role": lambda n: (sorted(n.roles)[0] if n.roles else None),
    "label": lambda n: n.name,
    "name": lambda n: n.name,
    "place": lambda n: (strongest_place(n.places).place if n.places else n.place),
    "section": lambda n: (
        _section_of(sorted(n.source_paths)[0]) if n.source_paths else None
    ),
}


def _role_neighbour_labels(
    nodes: list[GraphNode], edges: list[GraphEdge], role: str,
) -> dict[str, str]:
    """For each node, the name of what sits in *role* on the acts it is part of.

    **A role is a neighbour, not a property.** `observations.by` names the payer
    slot, and a payer is at the far end of an edge — it never lands in the
    node's property bag, so reading it as a column found nothing however deep
    the path went. This walks the slot instead: node → its occurrences → the
    endpoint whose edge carries that role.

    Depth beyond the role (`observations.by.name`) is the same answer, because
    the name is what a pile is labelled by either way. It is accepted rather
    than refused because a writer who addressed the filter half that way will
    address this half that way too, and a grammar true in one position and
    false in another is worse than one that is simply narrower.
    """
    by_id = {n.id: n for n in nodes}
    want = role.strip().lower()
    # Who fills this role, per occurrence.
    filler: dict[str, str] = {}
    for e in edges:
        if (getattr(e, "role", "") or "").strip().lower() != want:
            continue
        far = by_id.get(e.target)
        if far is not None and far.kind != "occurrence":
            filler.setdefault(e.source, far.name)
    out: dict[str, str] = {}
    incident: dict[str, list[str]] = {}
    for e in edges:
        incident.setdefault(e.source, []).append(e.target)
        incident.setdefault(e.target, []).append(e.source)
    for n in nodes:
        if n.id in filler:            # the act itself
            out[n.id] = filler[n.id]
            continue
        names = sorted({
            filler[m] for m in incident.get(n.id, ()) if m in filler
        })
        if names:
            out[n.id] = names[0]
    return out


def _neighbour_labels(
    nodes: list[GraphNode], edges: list[GraphEdge], want: set[str],
) -> dict[str, str]:
    """For each node, the strongest neighbour whose type is in *want*.

    **The pile is often not a field on the node — it is what the node is
    attached to.** "Which interest does this actor serve", "which place did this
    act happen at": neither is readable off the row that named the actor,
    because it is a property of the assembled graph.

    One step **through occurrences**, because an act is the connective tissue
    rather than a destination: an actor does not touch an interest directly, it
    makes a payment that serves one. Counting only direct edges would find
    nothing for exactly the nodes a reader cares about.

    Ties break on the label, so a node with two equally strong attachments lands
    in the same pile on every render. A cluster that moves when nothing changed
    reads as a finding and is an artefact.
    """
    by_id = {n.id: n for n in nodes}
    adj: dict[str, list[str]] = {}
    for e in edges:
        adj.setdefault(e.source, []).append(e.target)
        adj.setdefault(e.target, []).append(e.source)

    def typed(nid: str) -> str | None:
        n = by_id.get(nid)
        if n is None:
            return None
        t = (n.node_type or n.type or "").strip()
        return t if t.lower() in want else None

    out: dict[str, str] = {}
    for n in nodes:
        scores: dict[str, float] = {}
        for mid in adj.get(n.id, ()):
            m = by_id.get(mid)
            if m is None:
                continue
            label = typed(mid)
            if label:
                # A large act pulls harder than a small one, which is the same
                # weighting `attach_neighbour_profiles` uses.
                scores[m.name] = scores.get(m.name, 0.0) + (m.magnitude or 1.0)
                continue
            if m.kind != "occurrence":
                continue
            for far in adj.get(mid, ()):
                if far == n.id:
                    continue
                f = by_id.get(far)
                if f is not None and typed(far):
                    scores[f.name] = scores.get(f.name, 0.0) + (m.magnitude or 1.0)
        if scores:
            out[n.id] = max(sorted(scores), key=lambda k: scores[k])
    return out


def _section_columns(nodes: list[GraphNode], section: str) -> set[str]:
    """Property keys carried by nodes that came from *section*.

    Only what is actually on the wire, so a suggestion cannot name a column the
    graph does not have — a hint that misfires costs more than no hint, because
    the reader spends a query finding out that it was wrong.
    """
    out: set[str] = set()
    for n in nodes:
        if any(_section_of(p) == section for p in n.source_paths or ()):
            out.update(k for k in (n.properties or {}) if k)
    return out


def attach_clusters(
    nodes: list[GraphNode], edges: list[GraphEdge], channels: Any,
) -> None:
    """Resolve the ``CLUSTER:`` binding onto ``node.cluster``. In place.

    **Which pile, not where the pile goes.** The canvas owns the geometry; this
    owns the key, because the key can name a declaration the client cannot see —
    a role, a place rung, a section. Splitting it the other way is what left
    ``node_group_by`` as a panel field the engine half-understood.

    No binding, no clusters. An unconfigured panel stays force-directed rather
    than being silently partitioned by a key nobody chose — a grouping that
    appears on its own is indistinguishable from a finding.

    A node with no value for the key gets ``None`` rather than a bucket called
    ``""``. Both the honest reading and the useful one: "everything else" is not
    a group, and drawing it as one puts a labelled box around the residue.
    """
    _LAST_CLUSTER_LEGEND.clear()
    _LAST_CLUSTER_NOTES.clear()
    _LAST_CLUSTER_KEYS.clear()
    for n in nodes:
        n.cluster = None
    if channels is None or not nodes:
        return
    binding = channels.get("CLUSTER") if hasattr(channels, "get") else None
    if binding is None:
        return
    keys = [s.path for s in binding.selectors if getattr(s, "path", None)]
    if not keys:
        return

    # **What a key can name, in order.** A reader writing `CLUSTER:Interests`
    # means "pile these by the interest they serve", not "look for a column
    # called Interests" — and the second reading is what made both of the
    # obvious queries do nothing.
    #
    #   type · kind · role · place · section       a reserved key
    #   <section>.<field>                          the data's own column
    #   Location · Interest · Interests            a TYPE or a SECTION, which
    #                                              means the neighbour of that
    #                                              type — one hop, through
    #                                              occurrences
    #   anything else                              a property on the node
    #
    # The third rung is the one that was missing, and it is the useful one: the
    # pile is usually what a node is ATTACHED to rather than a field it carries.
    types = {(n.node_type or n.type or "").strip().lower() for n in nodes}
    types.discard("")
    sections: dict[str, set[str]] = {}
    for n in nodes:
        t = (n.node_type or n.type or "").strip().lower()
        for p in n.source_paths or ():
            if t:
                sections.setdefault(_section_of(p), set()).add(t)

    roles = {r for n in nodes for r in (n.roles or ())}
    neighbours: dict[str, dict[str, str]] = {}
    #: How each key was read, so the bar can SAY it. An inference nobody can see
    #: is indistinguishable from a coincidence — `CLUSTER:Location` quietly
    #: meaning "the place it happened at" is helpful exactly once and confusing
    #: every time after.
    resolved: list[str] = []
    for key in keys:
        leaf = key.rsplit(".", 1)[-1].strip().lower()
        if "." in key:
            # `<section>.<role>` and `<section>.<role>.<field>` — a ROLE is a
            # neighbour, not a column, so it is walked rather than read.
            parts = [p for p in key.split(".") if p]
            slot = next(
                (p.strip().lower() for p in parts[1:] if p.strip().lower() in roles),
                None,
            )
            if slot:
                neighbours[key] = _role_neighbour_labels(nodes, edges, slot)
                resolved.append(f"{key} → whoever fills the {slot} slot")
                continue
            resolved.append(f"{key} → the row's own {leaf}")
            continue
        if leaf in _CLUSTER_KEYS:
            resolved.append(f"{key} → each node's {leaf}")
            continue
        want = {leaf} if leaf in types else sections.get(leaf, set())
        # A section maps to the types it minted, which is how `Interests`
        # reaches `Interest` without either word being written down anywhere.
        if want:
            neighbours[key] = _neighbour_labels(nodes, edges, want)
            named = ", ".join(sorted(want))
            resolved.append(
                f"{key} → the {named} it connects to"
                + ("" if leaf in types else f" (section {leaf})"),
            )
        else:
            resolved.append(f"{key} → a property called {leaf}")

    def read(n: GraphNode, key: str) -> str | None:
        # **A qualified key means the DATA's own field, never the reserved one.**
        # Exactly as in the filter half: `kind:` is the node kind and
        # `observations.kind:` is the column a schema happens to call `kind`.
        # Without this, `CLUSTER:observations.kind` on the mega scenario returned
        # two groups called `entity` and `occurrence` — a confident answer to a
        # question nobody asked, which is the failure mode this grammar exists
        # to remove.
        # A walked key answers first, whether or not it is qualified — the
        # resolution above already decided which mechanism this key needs, and
        # re-deciding it here by counting dots is how the two disagreed.
        if key in neighbours:
            return neighbours[key].get(n.id)
        qualified = "." in key
        leaf = key.rsplit(".", 1)[-1].strip().lower()
        if not qualified:
            fn = _CLUSTER_KEYS.get(leaf)
            if fn is not None:
                v = fn(n)
                return str(v) if v not in (None, "") else None
        v = (n.properties or {}).get(leaf)
        return str(v) if v not in (None, "") else None

    counts: dict[str, int] = {}
    for n in nodes:
        # A comma list is a COMPOUND key: `CLUSTER:type,place` is one pile per
        # distinct pair, not two clusterings fighting for the same node.
        parts = [read(n, k) for k in keys]
        if any(p is None for p in parts):
            continue
        label = " · ".join(p for p in parts if p)
        n.cluster = label
        counts[label] = counts.get(label, 0) + 1

    placed = sum(counts.values())
    _LAST_CLUSTER_LEGEND[:] = [
        f"clustered by {', '.join(keys)} — {len(counts)} groups, "
        f"{placed} of {len(nodes)} nodes"
        + (f", {len(nodes) - placed} with no value" if placed < len(nodes) else ""),
        *(f"  {r}" for r in resolved),
    ]
    if not counts:
        # A binding that placed nothing is not a clustering with zero groups —
        # it is a key this graph does not have, and the canvas will look
        # identical to one with no CLUSTER at all. That has to be visible.
        #
        # **And a note that only says "no" is half a note.** `CLUSTER:<section>`
        # is the commonest miss and the most reasonable thing to type: a section
        # is not a grouping key, because every node in it would land in one
        # pile. What the writer wants is a *column* of that section, and this
        # knows which ones exist — so it names them.
        # **A note that only says "no" is half a note.** `CLUSTER:<section>` is
        # the commonest miss and the most reasonable thing to type — but a
        # section is not a grouping key, because every node in it would land in
        # one pile. What the writer wants is a COLUMN of it, and now that a
        # row's own scalars reach its node, this knows which ones exist.
        hints: list[str] = []
        for key in keys:
            leaf = key.rsplit(".", 1)[-1].strip().lower()
            cols = sorted(_section_columns(nodes, leaf))
            if cols:
                hints.append(
                    f"{leaf} is a section, not a key — try "
                    + ", ".join(f"{leaf}.{c}" for c in cols[:5]),
                )
        _LAST_CLUSTER_NOTES[:] = [
            f"CLUSTER:{','.join(keys)} matched no node"
            + (" — " + "; ".join(hints) if hints else
               " — try type, kind, role, place, section, an entity type, "
               "a section name, or `<section>.<field>`"),
        ]
        # The route enriches this with the section's real columns when the key
        # named one: a section is not a grouping key (every node in it would
        # land in one pile) and what the writer wants is a COLUMN of it. Only
        # the route can say which — a projection that forwards no properties
        # puts nothing on the node, so the columns exist in the row table and
        # nowhere else.
        _LAST_CLUSTER_KEYS[:] = [k.rsplit(".", 1)[-1].strip().lower() for k in keys]


def cluster_legend(nodes: list[GraphNode] | None = None) -> list[str]:
    """What the last :func:`attach_clusters` decided, for ``meta.legend``.

    *nodes* is the **final** node set. Clustering runs inside assembly, before
    the post-tier filters (`type:`, `from:`, `degree>`) remove anything — so the
    tally taken there describes a superset. On a query whose post-tier matched
    nothing the legend read "7 groups, 57 of 93 nodes" over an empty canvas,
    which is the worst moment to be told a confident number: it is exactly when
    the reader is trying to work out why they are looking at nothing.

    Recounted here rather than moved: the *denominator* for sizes genuinely is
    the whole population (that is what `ref:` means), so the two tallies are
    different questions and only this one follows the filter.
    """
    if nodes is None or not _LAST_CLUSTER_LEGEND:
        return list(_LAST_CLUSTER_LEGEND)
    counts: dict[str, int] = {}
    for n in nodes:
        if n.cluster:
            counts[n.cluster] = counts.get(n.cluster, 0) + 1
    placed = sum(counts.values())
    head, *rest = _LAST_CLUSTER_LEGEND
    keys = head.split("clustered by", 1)[-1].split("—")[0].strip()
    return [
        f"clustered by {keys} — {len(counts)} groups, {placed} of {len(nodes)} nodes"
        + (f", {len(nodes) - placed} with no value" if placed < len(nodes) else ""),
        *rest,
    ]


def cluster_notes() -> list[str]:
    """What it could not do with what was written, for ``meta.notes``."""
    return list(_LAST_CLUSTER_NOTES)


def cluster_missed_keys() -> list[str]:
    """Keys the last binding tried and placed nothing with."""
    return list(_LAST_CLUSTER_KEYS)


def _attach_doc_anchors(
    nodes_by_id: dict[str, GraphNode],
    annotation_ids_by_node: dict[str, set[int]],
    doc_anchors: dict[int, dict[str, Any]],
) -> None:
    """Apply the weakest rungs of both ladders. In place.

    **A document places and dates everything it mentions — weakly.** "This
    filing concerns Malta, and is dated 2014" is real information about every
    entity in it, and throwing it away is what leaves half a corpus unplaceable
    and untimed. But it is the *weakest* thing you can say, and the two axes
    therefore behave differently:

    * **Place is additive.** It joins ``places[]`` tagged ``source: "doc"``, so
      the ladder can rank it below a stated site and the renderer can never
      present a filing's subject like a whereabouts. A node keeps both.
    * **Time is a fallback, two rungs deep.** ``t0``/``t1`` are single-valued,
      so a document date fills them **only** where the node has none. Unioning
      instead would stretch every node to the document's date and quietly make
      the slider lie — the exact smearing the occurrence branch exists to
      prevent. Below the document's stated date sits the asset's own
      ``event_timestamp``, which is not a claim and cannot be left empty by a
      model that did not feel like answering.

    Interests are skipped for the same reason they are never geocoded: a motive
    is not somewhere.
    """
    if not doc_anchors:
        return
    for node_id, node in nodes_by_id.items():
        anns = annotation_ids_by_node.get(node_id) or ()
        anchors = [doc_anchors[a] for a in anns if a in doc_anchors]
        if not anchors:
            continue

        if (node.type or "").strip().lower() not in NON_SPATIAL_TYPES:
            seen = {(p.place or "").strip().lower() for p in node.places}
            for a in anchors:
                place = (a.get("place") or "").strip()
                if not place or place.lower() in seen:
                    continue
                seen.add(place.lower())
                node.places = [*node.places, NodePlace(place=place, source="doc")]
            if node.place is None and node.places:
                node.place = strongest_place(node.places).place

        if node.t0 is None:
            # Rung 3 then rung 4, per anchor. The document's stated date is the
            # more specific claim and wins where it exists; the asset's
            # ``event_timestamp`` catches everything it left empty — which on
            # run #12424 was every single node, because the model wrote nothing
            # into ``document.dated`` and there was no rung below it.
            stamps = sorted(
                s for s in (
                    _as_ts(a.get("time")) or _as_ts(a.get("asset_time"))
                    for a in anchors
                ) if s
            )
            if stamps:
                # Earliest, and open-ended: the document says when it was
                # written, not how long anything lasted.
                node.t0 = stamps[0]


def _coord_pair(raw: Any) -> tuple[float, float] | None:
    """``(lat, lon)`` from either coords shape, or None.

    The geocode action persists the provider's GeoJSON-order
    ``[lon, lat]`` list (``annotation/tasks/geocode.py``), which is also how
    ``content/enrichers.py`` reads it. A dict form is accepted too so a
    hand-curated entry can be explicit rather than positional.
    """
    if isinstance(raw, dict):
        lat, lon = raw.get("lat"), raw.get("lon")
    elif isinstance(raw, (list, tuple)) and len(raw) >= 2:
        lon, lat = raw[0], raw[1]          # GeoJSON order
    else:
        return None
    try:
        return float(lat), float(lon)
    except (TypeError, ValueError):
        return None


def _attach_coords(
    session: Session,
    infospace_id: int,
    nodes_by_id: dict[str, GraphNode],
) -> None:
    """Fill ``lat``/``lon`` for every node we can place. In place.

    **A canon is an enhancement here, never a requirement.** Two independent
    name → coordinate sources, tried in order:

    1. **Asset facets** — the ``geocoding`` @enricher writes ``location`` plus
       ``location_lat`` / ``location_lon`` onto assets, and it does *not* write
       provider results into any canon. So an infospace that has simply ingested
       and enriched content already has a canon-free geocoding cache. (The
       column is ``metadata``; ``facets`` is the ORM attribute name — see
       OVERVIEW's "Asset Metadata" table.)
    2. **Canon entries** — ``CanonEntry.properties.coords``, written by the
       geocode *action*. Curated, so it wins on conflict.

    Matching is on the lowered place/name string, which is what makes the
    anchor work for non-location entities: an *event* whose ``place`` binding
    says "Berlin" anchors at Berlin without being a Location itself.

    Silent no-op on failure — a graph must still render when nothing is
    geocoded and when a coords payload is shaped unexpectedly.
    """
    if not nodes_by_id:
        return
    wanted: dict[str, list[GraphNode]] = {}
    for node in nodes_by_id.values():
        # **An interest is never anchored.** Coordinate anchors are for
        # verifiable axes; an interest is imputed, and it must stay affinity-
        # only. Matching on ``name`` would otherwise geocode an interest called
        # "Washington" and pin a motive to a place, which is precisely the
        # category error the model forbids.
        if (node.type or "").strip().lower() in NON_SPATIAL_TYPES:
            continue
        for label in (node.place, node.name):
            if isinstance(label, str) and label.strip():
                wanted.setdefault(label.strip().lower(), []).append(node)
        for entry in node.places:
            wanted.setdefault(entry.place.strip().lower(), []).append(node)
    if not wanted:
        return
    keys = list(wanted)

    def _apply(key: str, pair: tuple[float, float] | None, *, overwrite: bool) -> None:
        if pair is None:
            return
        for node in wanted.get(key, ()):
            # **A place is at itself.** The node's own scalar coordinate may only
            # come from its own name, never from something in its `places[]`.
            #
            # Every label a node carries lands in `wanted`, including the weak
            # doc-rung entries the ladder appends — so whichever key happened to
            # resolve last was writing the node's coordinate. Trieste, mentioned
            # in a filing about Friuli Venezia Giulia, was drawn at the region's
            # centroid: the document rung is meant to say "this is weakly about
            # there", and it was silently relocating a place that knows exactly
            # where it is.
            own = (node.name or "").strip().lower() == key
            if own and (overwrite or node.lat is None):
                node.lat, node.lon = pair
            # Each place entry resolves on its own name — a company's Valletta
            # seat and its Zurich head office are two coordinates on one node,
            # and collapsing them to a single lat/lon is what hides the
            # divergence between where a thing is registered and where it acts.
            for i, entry in enumerate(node.places):
                if entry.place.strip().lower() != key:
                    continue
                if overwrite or entry.lat is None:
                    node.places[i] = entry.model_copy(
                        update={"lat": pair[0], "lon": pair[1]},
                    )

    # (1) Canon-free: the enricher's per-asset geocoding cache.
    try:
        rows = session.execute(
            text("""
                SELECT LOWER(TRIM(a.metadata->>'location')) AS key,
                       a.metadata->>'location_lat' AS lat,
                       a.metadata->>'location_lon' AS lon
                FROM asset a
                WHERE a.infospace_id = :iid
                  AND a.metadata->>'location_lat' IS NOT NULL
                  AND LOWER(TRIM(a.metadata->>'location')) = ANY(:keys)
            """),
            {"iid": infospace_id, "keys": keys},
        ).fetchall()
        for key, lat, lon in rows:
            _apply(key, _coord_pair({"lat": lat, "lon": lon}), overwrite=False)
    except Exception as e:  # noqa: BLE001
        logger.warning("graph coords: asset-facet lookup failed: %s", e)

    # (2) Canon entries — curated, so they overwrite the enricher's guess.
    # ``CanonEntry.properties`` is a ``JSON`` column, not ``JSONB``, so cast
    # before drilling in — and via ``CAST(... AS jsonb)``, never ``::jsonb``,
    # because SQLAlchemy's ``text()`` reads ``:jsonb`` as a bind parameter.
    # Same trap ``core/filters.py`` documents for ``::text[]``.
    try:
        rows = session.execute(
            text("""
                SELECT LOWER(TRIM(e.canonical)) AS key,
                       (CAST(e.properties AS jsonb))->'coords' AS coords
                FROM canon_entry e
                WHERE e.infospace_id = :iid
                  AND LOWER(TRIM(e.canonical)) = ANY(:keys)
                  AND (CAST(e.properties AS jsonb))->'coords' IS NOT NULL
            """),
            {"iid": infospace_id, "keys": keys},
        ).fetchall()
        for key, coords in rows:
            _apply(key, _coord_pair(coords), overwrite=True)
    except Exception as e:  # noqa: BLE001
        logger.warning("graph coords: canon lookup failed: %s", e)

    # Mirror a coordinate onto every node that is somewhere without BEING
    # somewhere — an occurrence at Trieste, an actor with a registered seat.
    # From the strongest rung it has, so a stated site outranks "the filing is
    # about this region"; and only where the node did not resolve on its own
    # name, which is the case `_apply` already handled and the only one allowed
    # to relocate a place.
    for node in nodes_by_id.values():
        if node.lat is not None or not node.places:
            continue
        located = [p for p in node.places if p.lat is not None]
        if not located:
            continue
        best = strongest_place(located)
        node.lat, node.lon = best.lat, best.lon


def _fold_typeless_nodes(
    node_slots: dict[str, dict[str, Any]],
    annotation_ids_by_node: dict[str, set[int]],
    evidence_by_node: dict[str, list[dict[str, Any]]],
    node_group_by_id: dict[str, str | None],
) -> dict[str, str]:
    """Merge typeless node slots into their typed twin. Returns an id remap.

    ``""`` is not a type — it is an absence. Two mentions of "Angela Merkel",
    one saying ``Politician`` and one saying nothing, are the same entity with
    partial information, and keeping them apart defeats the point of projecting
    several fields into one graph.

    **Only when the typed twin is unambiguous.** If a name has two or more
    typed variants (``Washington`` the person and ``Washington`` the place), the
    typeless mention could belong to either, so it stays its own node rather
    than being guessed into one. Same instinct as ``resolution.find_by_alias``
    refusing substring matches.

    Mutates *node_slots* and the side registries in place; the returned map is
    ``old_id -> new_id`` for the edge rewrite.
    """
    # Matched on ``ident``, never on the display name. A row references another
    # by the identifier the document gave it; ``node_label`` changes only what
    # is shown, and matching on it would mean an occurrence stopped being
    # referenceable the moment someone gave it a readable caption.
    def _ident(slot: dict[str, Any]) -> str:
        return (slot.get("ident") or slot["name"] or "").strip().lower()

    typed_by_name: dict[str, list[str]] = {}
    typeless: list[str] = []
    for node_id, slot in node_slots.items():
        if not _ident(slot):
            continue
        if (slot["type"] or "").strip():
            typed_by_name.setdefault(_ident(slot), []).append(node_id)
        else:
            typeless.append(node_id)

    remap: dict[str, str] = {}
    for old_id in typeless:
        slot = node_slots[old_id]
        candidates = typed_by_name.get(_ident(slot), [])
        if len(candidates) != 1:
            continue
        new_id = candidates[0]
        target = node_slots[new_id]
        target["mentions"] += slot["mentions"]
        target["source_paths"] |= slot["source_paths"]
        target["roles"] |= slot["roles"]
        if target["place"] is None:
            target["place"] = slot["place"]
        for lo, hi, flag in (("t0", "t1", "t1_open"), ("a0", "a1", "a1_open")):
            if slot[lo] and (target[lo] is None or slot[lo] < target[lo]):
                target[lo] = slot[lo]
            if slot[hi] and (target[hi] is None or slot[hi] > target[hi]):
                target[hi] = slot[hi]
            target[flag] = target[flag] or slot[flag]
        annotation_ids_by_node.setdefault(new_id, set()).update(
            annotation_ids_by_node.pop(old_id, set())
        )
        moved = evidence_by_node.pop(old_id, [])
        if moved:
            evidence_by_node.setdefault(new_id, []).extend(moved)
        if node_group_by_id.get(new_id) is None and old_id in node_group_by_id:
            node_group_by_id[new_id] = node_group_by_id[old_id]
        node_group_by_id.pop(old_id, None)
        del node_slots[old_id]
        remap[old_id] = new_id
    return remap


_ISO_LEAD = re.compile(r"^\s*\d{4}[-/.]\d")


def _as_ts(v: Any) -> str | None:
    """A timestamp string we're willing to compare, or None.

    Gate mirrors ``AnnotationQuery._safe_timestamptz_sql``: a leading 4-digit
    year plus a separator. Extracted date fields are free text, so prose and
    ``<UNKNOWN>`` sentinels have to fall out rather than poison a min/max.
    Comparison is lexicographic, which is chronological for ISO-8601 — the
    format structured date extraction emits.
    """
    if not isinstance(v, str):
        return None
    s = v.strip()
    return s if s and _ISO_LEAD.match(s) else None


def _absorb_interval(
    slot: dict[str, Any],
    props: dict[str, Any],
    src_lo: str,
    src_hi: str,
    lo: str,
    hi: str,
    open_flag: str,
) -> None:
    """Union one atom's interval into a slot's.

    ``start``+``end`` gives a closed interval; a bare ``at`` gives an
    open-ended one ("exists from here onward" — the *only a timestamp* case).
    An open end is absorbing: the union of "from A onward" and "[B, C]" is
    "from min(A,B) onward", so ``open_flag`` latches and the emitted ``hi``
    becomes None.
    """
    a = _as_ts(props.get(src_lo))
    b = _as_ts(props.get(src_hi))
    if a is None and b is None:
        return
    if a is not None and (slot[lo] is None or a < slot[lo]):
        slot[lo] = a
    if b is None:
        # Bare timestamp (or an unparseable end) — open-ended from here.
        if a is not None:
            slot[open_flag] = True
    else:
        if slot[hi] is None or b > slot[hi]:
            slot[hi] = b


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
    by_field = {_as_triplet_key(fp.field): fp for fp in specs}
    for bare, vals in values_by_field.items():
        if not vals:
            continue
        # A field nobody wrote a spec for still forwards — it came from the
        # projection's own declaration, or from the row itself on a contract
        # that declares nothing. `first` is the honest default for those: it is
        # the only aggregation that cannot invent a value, and a modality is a
        # label rather than a quantity.
        fp = by_field.get(bare)
        agg = fp.agg if fp is not None else "first"
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


#: The place ladder, strongest first. A stated site outranks a seat, which
#: outranks "the filing is about this", which outranks a coordinate we cached.
_RUNG_ORDER: dict[str, int] = {
    "row": 0, "attribute": 1, "canon": 2, "doc": 3, "asset": 4,
}


def strongest_place(places: list[NodePlace]) -> NodePlace:
    """The entry a single scalar should mirror.

    ``places`` accumulates — that is the design, and disagreement between two
    rungs is a finding rather than an error. But `place`, `lat` and `lon` are
    single-valued for callers written before the list existed, and mirroring
    ``places[0]`` mirrored *insertion order*: a node whose only entries came
    from the document rung took whichever annotation happened to stream first.
    """
    return min(places, key=lambda p: _RUNG_ORDER.get(p.source, 9))


def frame_coverage(
    nodes: list[GraphNode], edges: list[GraphEdge],
) -> dict[str, dict[str, int]]:
    """How many nodes each positional frame can actually place. Per frame.

    A frame with 5% fill is not a usable axis, and the failure mode is
    specific: ``anchors.ts`` already warns that a geo layout over sparsely
    geocoded data is "a mostly-empty map with a blob over the ocean". Choosing
    a plane and *then* discovering that is the wrong order, so the counts ride
    on the wire and the control can say so before the click.

    ``of`` is the denominator each frame is answerable for. Interests are never
    geocoded (a motive is not somewhere) and occurrences are what a time frame
    positions, so a flat "out of all nodes" would understate every frame.
    """
    total = len(nodes)
    placeable = [n for n in nodes
                 if (n.type or "").strip().lower() not in NON_SPATIAL_TYPES]

    interest_ids = {n.id for n in nodes
                    if (n.type or "").strip().lower() == "interest"}
    event_ids = {n.id for n in nodes
                 if (n.node_type or n.type or "").strip().lower() == "event"}
    # A node is *in* the interest frame when it reaches one — it has a profile,
    # or it serves/opposes one directly. Same for events, through `during`.
    served = {e.source for e in edges if e.target in interest_ids}
    served |= {e.target for e in edges if e.source in interest_ids}
    during = {e.source for e in edges if e.target in event_ids}
    during |= {e.target for e in edges if e.source in event_ids}

    return {
        "time": {"have": sum(1 for n in nodes if n.t0), "of": total},
        "geo": {"have": sum(1 for n in placeable if n.lat is not None),
                "of": len(placeable)},
        # Placed-by-name, which is what a region cluster needs even with no
        # coordinates — reported separately so a map and a cluster do not look
        # equally impossible.
        "place_named": {"have": sum(1 for n in placeable if n.places),
                        "of": len(placeable)},
        "interest": {"have": len(served | interest_ids), "of": total},
        "event": {"have": len(during | event_ids), "of": total},
    }


def _edge_kind(
    predicate: str | None, role: str | None,
    source: dict[str, Any] | None, target: dict[str, Any] | None,
) -> str:
    """What this edge DOES to the picture. ``sections.EDGE_KINDS``.

    Three rungs, and the order matters — the same ladder every other reading in
    this system walks:

    1. **The conventional vocabulary.** `within`, `part_of`, `during`, `follows`
       — words whose structural meaning is not in doubt. Checked first because
       a containment edge is containment whether it was minted as a role slot
       or as a relation, and asking where it came from would give two answers
       for one fact.
    2. **The structure.** An edge out of an OCCURRENCE is that act's cast: it
       says who was in it, not that two things are related. 104 of run 15010's
       192 edges are this, and drawing them at the weight of a finding is most
       of why the canvas reads as noise.
    3. **Otherwise a relation** — the honest default, because a relation is the
       kind that asserts least about how to draw it.

    Deliberately NOT inferred from the section: a section mints both role edges
    and relation edges depending on its ``about``, so section identity answers a
    different question than this one.
    """
    from app.api.modules.annotation.sections import edge_kind_for

    declared = edge_kind_for(predicate) or edge_kind_for(role)
    if declared:
        return declared
    if source is not None and source.get("kind") == "occurrence":
        return "role"
    return "relation"


def _section_of(path: str) -> str:
    """``document.observations[*]`` → ``observations``.

    The section's own name, which is what the schema author wrote and therefore
    the only spelling anyone would reach for when addressing it.
    """
    return (path or "").rsplit(".", 1)[-1].removesuffix("[*]").strip().lower()


def _node_id(name: str, entity_type: str) -> str:
    """Deterministic node ID from name + type. Matches AnnotationQuery.graph()'s
    legacy hashing so ephemeral and persistent sources yield the same ids."""
    raw = f"{name.lower().strip()}::{entity_type.lower().strip()}"
    return hashlib.sha256(raw.encode()).hexdigest()[:12]
