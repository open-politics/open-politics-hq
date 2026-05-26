"""FormulaQuery — the one-class boundary between Formula and the
``/view`` route's phase packers.

For each ``/view`` request the route constructs a :class:`FormulaQuery`
once. The constructor folds the Formula's filter, merge_maps, schema_id,
and any incoming scope contributions into a configured
:class:`AnnotationQuery`. Composition (``@formula.col`` references) is
attached via ``attach_formula_lookup`` at construction. Each phase
packer method (``rows_view``, ``aggregate_view``, ``graph_view``, …)
reuses the same configured AQ.

Adding a new view phase = adding a new packer method here + a new
field on :class:`ViewRequest`. The AQ engine is untouched.

The route shrinks to dispatch logic over the request's phase toggles —
no Formula handling duplicated per phase, no body-level filter
plumbing.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any, Iterable

from app.api.modules.annotation.formula import Formula
from app.api.modules.annotation.formulas import attach_formula_lookup
from app.api.modules.annotation.panel_config import Scope
from app.api.modules.annotation.query import (
    AnnotationQuery,
    OutputRelation,
)
from app.api.modules.graph.schemas import GraphResultData

if TYPE_CHECKING:
    from sqlmodel import Session

    from app.api.modules.access import Access


class FormulaQuery:
    """One Formula → one configured :class:`AnnotationQuery` + the phase
    packers.

    The constructor:

    1. Builds a fresh AQ scoped to the request's runs (and family
       rollup, if applicable).
    2. Folds in the Formula's ``schema_id``, ``filter``, ``merge_maps``.
    3. Composes each incoming scope's ``filter`` and ``merge_maps`` on
       top (AND semantics, append semantics).
    4. Attaches composition (``@formula.col``) via
       :func:`attach_formula_lookup` if a ``formula_lookup_cfg`` is
       provided (typically the run's ``views_config``).

    Each phase packer (one method per view type) reads from this single
    configured AQ. The AQ's chaining API is *not* mutated by phase
    methods beyond ``paginate()``, which is per-call.
    """

    def __init__(
        self,
        session: "Session",
        access: "Access",
        run_ids: list[int],
        formula: Formula,
        *,
        incoming_scopes: Iterable[Scope] = (),
        panel_merge_maps: Iterable[Any] = (),
        run_aliases: Iterable[Any] = (),
        formula_lookup_cfg: dict[str, Any] | None = None,
    ) -> None:
        self.formula = formula
        self.aq = self._build_aq(
            session, access, run_ids, formula,
            incoming_scopes=incoming_scopes,
            panel_merge_maps=panel_merge_maps,
            run_aliases=run_aliases,
        )
        if formula_lookup_cfg:
            attach_formula_lookup(self.aq, formula_lookup_cfg)

    # ─── Construction ────────────────────────────────────────────────

    @staticmethod
    def _build_aq(
        session: "Session",
        access: "Access",
        run_ids: list[int],
        formula: Formula,
        *,
        incoming_scopes: Iterable[Scope] = (),
        panel_merge_maps: Iterable[Any] = (),
        run_aliases: Iterable[Any] = (),
    ) -> AnnotationQuery:
        """Translate Formula + scopes + merge-map layers into a
        configured :class:`AnnotationQuery`. Single source of truth for
        the Formula → AQ contract.

        Merge-map priority (first match wins in
        :meth:`AnnotationQuery._find_merge_map`):

        1. Scope merge_maps   — carried from source panel at gesture time
        2. Panel merge_maps   — panel-local aliases
        3. Run aliases        — run-wide canonical library

        The Formula itself does NOT carry merge_maps any more — that
        belonged to the run/panel context, not to the data spec.
        """
        aq = AnnotationQuery(session, access.infospace_id).scope(access.scope)
        aq.runs(list(run_ids))
        if formula.schema_id is not None:
            aq.schemas([formula.schema_id])
        if formula.filter and formula.filter.conditions:
            aq.filter(formula.filter)
        for sc in incoming_scopes:
            if sc.filter and sc.filter.conditions:
                aq.filter(sc.filter)
            # ``group_context`` carries the source panel's parent group
            # field+value when the gesture happened inside one grouping
            # unit. Fold as an equality (or 'in' for list values) filter
            # so the receiver honors both the selection AND group
            # membership. Mirrors frontend ``mergeFiltersAndScopes``.
            gctx = sc.group_context
            if gctx and gctx.get("field") and "value" in gctx:
                val = gctx["value"]
                from app.core.filters import FieldCondition, FilterSet
                op = "in" if isinstance(val, list) else "eq"
                aq.filter(FilterSet(
                    logic="and",
                    conditions=[FieldCondition(path=gctx["field"], operator=op, value=val)],
                ))
            for mm in sc.merge_maps:
                aq.merge(mm)
        for mm in panel_merge_maps:
            aq.merge(mm)
        for mm in run_aliases:
            aq.merge(mm)
        return aq

    # ─── Phase packers ───────────────────────────────────────────────

    def aggregate_view(self) -> OutputRelation:
        """Pack as grouped buckets via :meth:`AnnotationQuery.relation`.

        Uses the Formula's ``group`` + ``measures`` + ``derives`` to
        produce one SQL GROUP BY. Result is an :class:`OutputRelation`
        with one row per group key.
        """
        return self.aq.relation(self.formula)

    def rows_view(
        self,
        *,
        fields: list[str] | None = None,
        cursor: str | int | None = None,
        limit: int = 100,
    ) -> "RowsView":
        """Pack as paginated annotation rows with asset hierarchy.

        ``fields`` (the panel's projection list) is informational
        right now; the existing :meth:`AnnotationQuery.results` ships
        the full annotation value. Wire-side projection lands as a
        follow-up optimization (see ``docs/internal/RE_EVALUATION.md``).
        """
        self.aq.paginate(cursor=cursor, limit=limit)
        page = self.aq.results()
        return RowsView(
            items=[_row_to_dict(r) for r in page.items],
            assets={aid: _asset_to_dict(a) for aid, a in page.assets.items()},
            total=page.total,
            cursor_next=page.cursor_next,
            fields=list(fields) if fields else [],
        )

    def graph_view(
        self,
        *,
        triplet_field: str | None = None,
        dedup: str = "exact",
        top_n_nodes: int | None = None,
        top_n_edges: int | None = None,
    ) -> GraphResultData:
        """Pack as nodes + edges via the streaming graph source.

        ``triplet_field`` falls back to ``formula.group[0].path`` when
        omitted (the graph engine's contract: first entity-shaped dim
        identifies the triplet array on the annotation).

        Bridges the streaming source (``AnnotationGraphSource`` +
        ``collect_graph``) to the JSON /view endpoint. The route runs
        ``_build_view_phases`` in a worker thread via ``asyncio.to_thread``,
        so spinning up a fresh event loop here with ``asyncio.run`` is
        safe — we're not nested inside another loop.

        Using ``collect_graph`` (not the deprecated ``AnnotationQuery.graph``)
        gives us the same path-aware triplet resolution as ``graph_stream``:
        dotted paths like ``document.triplets[*]`` and the ``[*]`` suffix
        are normalized; the deprecated method couldn't handle either.
        """
        tf = triplet_field
        if tf is None and self.formula.group:
            tf = self.formula.group[0].path
        if not tf:
            raise ValueError(
                "graph view requires triplet_field or formula.group[0].path"
            )

        import asyncio
        from app.api.modules.graph.stream import (
            AnnotationGraphSource,
            collect_graph,
        )

        source = AnnotationGraphSource(
            query=self.aq,
            triplet_field=tf,
            dedup=dedup,
        )
        return asyncio.run(
            collect_graph(
                self.aq._session,
                self.aq._infospace_id,
                source,
                top_n_nodes=top_n_nodes,
                top_n_edges=top_n_edges,
            )
        )


# ─── Phase response models ──────────────────────────────────────────────────


from pydantic import BaseModel, Field


class RowsView(BaseModel):
    """Rows-phase response — paginated annotations + asset hierarchy."""

    items: list[dict[str, Any]] = Field(default_factory=list)
    assets: dict[int, dict[str, Any]] = Field(default_factory=dict)
    total: int = 0
    cursor_next: str | None = None
    fields: list[str] = Field(default_factory=list)
    """Echoes the requested projection list (informational; engine ships
    the full value blob today)."""


# ─── Internal helpers (the dict shapes the existing route used) ─────────────


def _row_to_dict(r: Any) -> dict[str, Any]:
    """Wire shape for an :class:`AnnotationRow`. Single source of truth
    for the rows-phase row dict — the route imports this verbatim.
    """
    return {
        "annotation_id": r.annotation_id,
        "asset_id": r.asset_id,
        "schema_id": r.schema_id,
        "run_id": r.run_id,
        "value": r.value,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        "status": r.status,
        "element": r.element,
        "element_index": r.element_index,
    }


def _asset_to_dict(a: Any) -> dict[str, Any]:
    """Wire shape for an :class:`AssetSummary`."""
    return {
        "id": a.id,
        "title": a.title,
        "kind": a.kind,
        "parent_asset_id": a.parent_asset_id,
        "parent_title": a.parent_title,
    }


def _node_to_dict(n: Any) -> dict[str, Any]:
    """Wire shape for a :class:`GraphNode`."""
    return {
        "id": n.id,
        "name": n.name,
        "type": n.type,
        "frequency": n.frequency,
        "source_annotation_ids": n.source_annotation_ids,
        # Schema field renamed in the canon-graph rework:
        # canonical_entity_id → entity_id. Wire shape exposes both keys
        # for one release to give the frontend time to migrate.
        "entity_id": n.entity_id,
        "canonical_entity_id": n.entity_id,
        "group_value": n.group_value,
        "properties": n.properties,
        "evidence": getattr(n, "evidence", []),
    }


def _edge_to_dict(e: Any) -> dict[str, Any]:
    """Wire shape for a :class:`GraphEdge`."""
    return {
        "source": e.source,
        "target": e.target,
        "predicate": e.predicate,
        "weight": e.weight,
        "computed_weight": e.computed_weight,
        "group_value": e.group_value,
        "properties": e.properties,
        "evidence": getattr(e, "evidence", []),
    }
