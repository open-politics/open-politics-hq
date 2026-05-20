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

from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator

from app.api.modules.annotation.panel_config import GridPosition, PanelType
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
    """

    id: str
    name: str
    description: str | None = None
    schema_id: int | None = None
    explosion: str | None = None
    filter: FilterSet = Field(default_factory=FilterSet)
    merge_maps: list[MergeMap] = Field(default_factory=list)
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
    """A thin render binding. Points at a live Formula XOR a frozen
    Observation; carries no query. The simplest direct-read panel is just
    the simplest Formula (``from schema · group X · count``)."""

    id: str
    type: PanelType
    name: str
    description: str | None = None
    formula_id: str | None = None
    observation_id: str | None = None
    grid_position: GridPosition
    collapsed: bool = False
    settings: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def _one_binding(self) -> "Panel":
        if self.formula_id and self.observation_id:
            raise ValueError(
                "Panel binds a formula XOR an observation, not both"
            )
        return self


# ─── Relation shape → eligible panel types (the spine) ──────────────────────


def eligible_panels(formula: Formula) -> set[PanelType]:
    """Deterministic relation-shape → drawable panel types. ``table`` is the
    universal fallback; ``distribution``/``top`` are table/observation only.

    For ``n_entity >= 2``, graph renders the first two entity dims as the
    edge and any extra entity dims become edge attributes (label/colour/
    hover) — see HOW_TO §Panels for the convention."""
    panels: set[PanelType] = {"table"}
    kinds = [d.kind for d in formula.group]

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

    return panels
