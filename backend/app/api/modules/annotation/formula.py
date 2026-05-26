"""Formula — the intelligence-layer third primitive.

> Asset + Schema = Annotation. Annotation + Formula = Observation.

A **Formula** is arbitrary field synthesis: ``from · filter · group ·
measure · derive``. It declares an intelligence question; the system fills
it with **one SQL GROUP BY** (``AnnotationQuery.relation`` — see
``query.py``). This module owns the typed Formula/Panel models and the
relation-shape → panel-type mapping. There is no ``compile_formula`` /
``materialize`` bifurcation any more — the engine consumes a Formula
directly.

Key facts (see ``docs/intelligence/HOW_TO.md``):

- A **Dimension** is any field path: a value, an entity (a tag — the engine
  does no resolution; merge maps normalise, canons persist out-of-band), a
  time bucket, a doc field, or a geo field. ``roles``/``edges``/``axes`` are
  abandoned — an edge is just two entity dimensions; ordering/weight is a
  per-formula author-time choice.
- A **Panel** is a thin render binding (→ a live Formula XOR a frozen
  Observation); it carries no query.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.api.modules.annotation.panel_config import (
    GridPosition,
    PanelConfig,
    PanelType,
    Scope,
)
from app.core.filters import FilterSet, MergeMap

# ─── The Formula body ───────────────────────────────────────────────────────

DimensionKind = Literal["field", "entity", "time", "doc", "geo"]
TimeInterval = Literal["day", "week", "month", "quarter", "year"]


class Dimension(BaseModel):
    """One group key of a Formula's output relation.

    ``kind`` is mostly a semantic tag: the engine treats ``field``,
    ``entity``, ``doc`` and ``geo`` identically (extract + merge_case +
    GROUP BY — **no entity resolution**). Only ``time`` is special (it
    ``date_trunc``s by ``interval``). ``entity``/``geo`` drive frontend
    affordances and (for ``geo``) geocoder/map eligibility. ``path`` is a
    JSONB path, ``parse_explosion``-valid (≤ one ``[*]``).
    """

    name: str
    kind: DimensionKind
    path: str
    entity_type: str | None = None  # advisory metadata (not engine logic)
    interval: TimeInterval | None = None

    @model_validator(mode="after")
    def _consistency(self) -> "Dimension":
        if self.kind == "time" and self.interval is None:
            self.interval = "month"
        return self


class Measure(BaseModel):
    """One value column of the output relation.

    ``path=None`` ⇒ ``count()``. ``enum_weights`` is an author-time lift
    (replaced schema axes — the ordering/weight decision lives here, per
    formula). ``top`` switches the engine to evidence mode (bounded rows
    that carry their annotation intrinsically)."""

    name: str
    path: str | None = None
    agg: Literal[
        "count", "mean", "sum", "max", "min", "median", "mode",
        "distribution", "top",
    ] = "count"
    enum_weights: dict[str, float] | None = None
    top_n: int | None = None
    top_by: str | None = None

    @model_validator(mode="after")
    def _count_needs_no_path(self) -> "Measure":
        if self.agg not in ("count", "top") and self.path is None:
            raise ValueError(f"agg={self.agg!r} requires a path")
        return self


class OrderBy(BaseModel):
    """Optional sort override on the output relation.

    Default (when omitted): if any ``time`` dim is present, sort chronologic-
    ally on the first time dim ASC; otherwise sort by the first non-derive
    measure DESC (biggest-first — what pies/bars want).

    Explicit override: ``column`` names a dim, measure, or derive in the
    formula; ``direction`` defaults to DESC. SQL-side push when the column
    is a dim or aggregate measure; post-eval Python sort when the column is
    a derive (≤5000 rows, free)."""

    column: str
    direction: Literal["asc", "desc"] = "desc"


class DeriveSpec(BaseModel):
    """A post-aggregate computed column. ``expr`` is evaluated by
    ``app.core.expr`` over the GROUPED relation (keys + measures), with
    ``@formula[k].col`` composition."""

    name: str
    expr: str
    description: str | None = None


class Formula(BaseModel):
    """The third primitive — arbitrary field synthesis into intelligence.

    Authored identically by the prompt bar (one LLM call), the Dashboard
    Operator, or hand-edit; all emit *this* shape. Lives on
    ``AnnotationRun.views_config.formulas[]``.

    Formula is the pure **data spec**: filter, group, measures, derive,
    weight, explode. It carries no view metadata — the output packing is
    decided by the request's phase (rows / aggregate / graph / future
    statistics / co-occurrence). ``eligible_panels(formula)`` infers
    which view types are valid for a given Formula.

    The pipeline:

    .. code-block::

        [Frontend] → Formula → FormulaQuery (builds AnnotationQuery,
                                exposes phase packers) → Views → [Frontend]
    """

    model_config = ConfigDict(extra="ignore")
    """Silently drop unknown fields so historical formulas with the
    now-removed ``merge_maps`` field still load cleanly (the canonical
    place for merge maps is Run.aliases + Panel.merge_maps + Scope.merge_maps,
    composed at the FormulaQuery boundary)."""

    id: str
    name: str
    description: str | None = None
    schema_id: int | None = None
    explosion: str | None = None
    filter: FilterSet = Field(default_factory=FilterSet)
    group: list[Dimension] = Field(default_factory=list)
    weight: Measure | None = None
    measures: list[Measure] = Field(default_factory=list)
    derives: list[DeriveSpec] = Field(default_factory=list)
    snippet: "SnippetBinding | None" = None
    output_keys: list[str] = Field(default_factory=list)
    order_by: OrderBy | None = None
    version: Literal[1] = 1

    @model_validator(mode="after")
    def _at_most_one_distribution(self) -> "Formula":
        n_dist = sum(1 for m in self.measures if m.agg == "distribution")
        if n_dist > 1:
            raise ValueError(
                "a Formula may declare at most one 'distribution' measure; "
                f"got {n_dist}. Compose with @formula if you need more."
            )
        return self


class SnippetBinding(BaseModel):
    """Where evidence-mode rows read a quotable snippet from."""

    verbatim: str | None = None
    fallback: str | None = None


Formula.model_rebuild()


class Panel(BaseModel):
    """A dashboard panel — display artifact with a data spec, projection,
    and visual mapping.

    Anatomy:

    - ``formula`` — the inline :class:`Formula` (pure data spec). Edited
      via the RolePicker's data sections (filter, group, measures,
      explode, derive, weight).
    - ``formula_ref`` — optional pointer into ``DashboardConfig.formulas[]``;
      when set, the runtime resolves the saved formula from the run's
      ``views_config.formulas[]`` and uses it instead of ``formula``.
      Edits to that saved formula propagate to every panel binding it.
      The local ``formula`` is preserved (so detaching reverts cleanly).
    - ``fields`` — projection list for the rows view: which value-blob
      paths to ship per row. Empty list = ship the full value blob.
    - ``panel_config`` — per-type viz map + display knobs (discriminated
      on ``kind``). Refers to Formula output names + ``fields`` by
      string (e.g. ``PieConfig.slice_by = "topic"``).
    - ``time_source`` — panel-level designated timestamp field. Used by
      time-aware views (chart, brush gestures); time-centric panels
      may override via a role pick.
    - ``scopes_in`` — incoming :class:`Scope` contributions from other
      panels. Composed into the panel's effective filter at /view time.
    - ``merge_maps`` — panel-local value aliases (applied as SQL
      ``CASE WHEN`` in-flight).

    ``panel.type`` and ``panel.panel_config.kind`` MUST match.
    """

    id: str
    type: PanelType
    name: str
    description: str | None = None
    formula: Formula
    formula_ref: str | None = None
    fields: list[str] = Field(default_factory=list)
    panel_config: PanelConfig
    time_source: str | None = None
    scopes_in: list[Scope] = Field(default_factory=list)
    merge_maps: list[MergeMap] = Field(default_factory=list)
    grid_position: GridPosition
    collapsed: bool = False

    @model_validator(mode="after")
    def _type_matches_config(self) -> "Panel":
        if self.type != self.panel_config.kind:
            raise ValueError(
                f"Panel.type={self.type!r} != panel_config.kind={self.panel_config.kind!r}"
            )
        return self


# ─── Relation shape → eligible panel types (the spine) ──────────────────────


def eligible_panels(formula: Formula) -> set[PanelType]:
    """Deterministic Formula → drawable panel types. ``table`` is the
    universal fallback; specific panel types are added based on the
    Formula's group/measure composition.

    A Formula with no group + no measures (pure filter) is naturally
    rows-ready and renders in table/map (markers). A Formula with
    group+measures is aggregate-ready and renders in pie/chart/map/
    observation depending on dim kinds. Two entity dims → graph.

    For ``n_entity >= 2``, graph renders the first two entity dims as
    the edge and any extra entity dims become edge attrs — see HOW_TO
    §Panels for the convention."""
    panels: set[PanelType] = {"table"}
    kinds = [d.kind for d in formula.group]

    # Pure filter (no group, no measures) → list-mode renders.
    if not formula.group and not formula.measures:
        panels.add("map")  # markers when fields include a geo path
        return panels

    if "geo" in kinds:
        panels.add("map")

    structured = any(m.agg in ("distribution", "top") for m in formula.measures)
    if structured:
        return panels

    n_entity = kinds.count("entity")
    n_time = kinds.count("time")
    n_cat = kinds.count("field") + kinds.count("doc")

    if n_entity >= 2:
        panels.add("graph")
    if n_time >= 1 and n_entity == 0:
        panels.add("chart")
    if len(kinds) == 1 and (n_cat == 1 or n_entity == 1):
        panels.add("pie")
        panels.add("chart")

    # Aggregate formulas with at least one measure render as measurements
    # (single scalar / mini table / stats — the catch-all stats panel).
    if formula.measures:
        panels.add("measurements")

    # Scatter eligibility: aggregate with two dims (any kind) + one
    # measure, OR with two numeric measures. Both cover label × label
    # heatmaps and true numeric scatter.
    if len(formula.group) == 2 and len(formula.measures) >= 1:
        panels.add("scatter")

    return panels
