"""Panel config — per-type viz map + display knobs.

A :class:`Panel` (from :mod:`.formula`) carries:

- a :class:`Formula` (the data spec)
- a ``fields[]`` projection list (what to ship in rows view)
- a typed ``panel_config`` (the per-type viz map + display knobs)
- shared concerns: ``time_source``, ``scopes_in``, ``merge_maps``

Per-type configs (Pie/Chart/Map/Table/Graph/Observation) are discriminated
on a ``kind`` literal. Each carries:

- **Viz map**: role assignments referring to fields *by name* (e.g.
  ``PieConfig.slice_by = "topic"`` where ``"topic"`` resolves to a
  Formula group dim name, a measure name, or a `Panel.fields[]` path).
- **Display knobs**: per-type render config (mark style, scales,
  layout, density) that doesn't affect what's queried.

The viz map references Formula output names by string, never duplicating
the data spec. The Formula owns the query; ``panel_config`` owns how its
output binds to visual channels.
"""

from __future__ import annotations

import logging
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, Field, field_validator

from app.core.filters import FilterSet, MergeMap

logger = logging.getLogger(__name__)


PanelType = Literal[
    "table", "chart", "pie", "graph", "map", "measurements", "scatter"
]


class GridPosition(BaseModel):
    """Dashboard grid coordinates. All four required to avoid layout surprises."""

    x: int
    y: int
    w: int
    h: int


class Scope(BaseModel):
    """A cross-panel data-side constraint. Source panel emits at gesture
    time; receiving panel composes into its own Formula at /view time.

    Carries the **data-side state from the source RolePicker** at gesture
    time:

    - ``filter`` — the source's filter conditions plus the gesture's
      selection (e.g. clicked slice → ``topic=Climate``), AND-ed
    - ``element_context`` — source's explosion path (so the receiver
      inherits the exploded view)
    - ``group_context`` — when selection happened inside one grouping
      unit, carries the parent group field+value
    - ``merge_maps`` — source's active value aliases so receiver
      resolves the same way

    Scope does **not** carry the source's group/measures themselves —
    the receiving panel keeps full control of what to *do* with the
    constrained set (its own role picks).

    ``mode='push'`` is a snapshot: the filter is captured at creation
    time. ``mode='link'`` keeps the receiver coupled to the source's
    current filter (live propagation in the frontend store).
    """

    id: str
    source_panel_id: str
    mode: Literal["push", "link"]
    filter: FilterSet
    element_context: str | None = None
    group_context: dict[str, Any] | None = None
    merge_maps: list[MergeMap] = Field(default_factory=list)
    label: str
    created_at: str


# ─── Shared graph helpers (used by GraphConfig) ─────────────────────────────


class ForwardPropertySpec(BaseModel):
    """One triplet property to forward onto emitted graph edges.

    ``agg`` picks how repeated triplets combine their property value.
    Never uses ``array_agg(DISTINCT ...)``: unbounded-cardinality text
    fields can pack tens of MB into a single aggregated row at scale.
    """

    field: str
    agg: Literal["first", "sum", "avg", "max"] = "first"


class GraphLayout(BaseModel):
    """Graph layout mode. v1 ships ``force_directed`` only; ``spatial``
    (driven by ``layout_x``/``layout_y`` role fields) and ``radial`` /
    ``hierarchical`` are scaffolded.
    """

    kind: Literal["force_directed", "spatial", "radial", "hierarchical"] = "force_directed"
    params: dict[str, Any] = Field(default_factory=dict)


class AnalyticsOverlays(BaseModel):
    """Client-side derived computations rendered over a timeline chart."""

    rolling_average: dict[str, Any] | None = None  # {window: int}
    bands: bool = False
    trend_line: bool = False
    peak_markers: bool = False
    std_dev_bands: bool = False


# ─── Per-type panel configs (viz map + display knobs) ──────────────────────


class PieConfig(BaseModel):
    """Pie panel viz map. Slices = distinct values of ``slice_by``,
    slice size = ``value`` (a measure name from the Formula or the
    sentinel ``"count"``)."""

    kind: Literal["pie"] = "pie"
    slice_by: str | None = None
    value: str | None = None
    facet: str | None = None
    max_slices: int | None = None
    legend: bool = True


class ChartConfig(BaseModel):
    """Chart panel viz map. ``x`` is typically a time dim; ``y[]`` are
    one or more measure names; ``color`` faceting comes from a non-time
    group dim."""

    kind: Literal["chart"] = "chart"
    x: str | None = None
    y: list[str] = Field(default_factory=list)
    color: str | None = None
    mark: Literal["bar", "line", "area", "timeline"] = "timeline"
    stacked: bool = False
    analytics_overlays: AnalyticsOverlays = Field(default_factory=AnalyticsOverlays)
    show_statistics: bool = False


class MapConfig(BaseModel):
    """Map panel viz map. ``position`` is the geo field; ``mode`` picks
    markers vs areaGeometryMeasures. ``label[]`` is shown on hover/click."""

    kind: Literal["map"] = "map"
    position: str | None = None
    mode: Literal["markers", "areaGeometryMeasures"] = "markers"
    color: str | None = None
    label: list[str] = Field(default_factory=list)
    geocode_source: dict[str, Any] | None = None
    show_labels: bool = True
    show_areas: bool = False


class TableConfig(BaseModel):
    """Table panel viz map. ``columns`` lists which fields to show as
    columns; ``explode`` activates lateral unnest for array fields."""

    kind: Literal["table"] = "table"
    columns: list[str] = Field(default_factory=list)
    explode: str | None = None
    sort: dict[str, Any] | None = None
    density: Literal["compact", "comfortable"] = "comfortable"


class GraphConfig(BaseModel):
    """Graph panel viz map. ``source``/``target`` are entity dim names;
    edge weight, label, and layout knobs drive the renderer.

    The triplet field that the engine extracts from lives on Formula's
    first group dim (``Formula.group[0].path``); ``source`` and
    ``target`` here are the visual channels that point at the resulting
    entity columns.
    """

    kind: Literal["graph"] = "graph"
    source: str | None = None
    target: str | None = None
    edge_label: str | None = None
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
    layout: GraphLayout = Field(default_factory=GraphLayout)
    # Relationship-as-a-lens render toggle. When a ``relational.cooccurs``
    # scope is active on the panel's filter, the renderer dims every node
    # that doesn't match a focused entity (and every edge that doesn't
    # touch one). Default-on is safe: no cooccurs → renderer no-ops.
    dim_unmatched: bool = True
    # Client-side-only edits (node merges, hides, label overrides).
    # Opaque to the backend — shape is frontend-owned.
    edits: dict[str, Any] | None = None

    @field_validator("forward_properties")
    @classmethod
    def _cap_forward_properties(
        cls, v: list[ForwardPropertySpec]
    ) -> list[ForwardPropertySpec]:
        # Hard cap: each forwarded property becomes an additional
        # aggregated column in the graph SELECT. At 5M-row scale this is
        # where the per-request memory footprint starts to matter.
        if len(v) > 5:
            raise ValueError(
                f"forward_properties capped at 5; got {len(v)}. "
                "Extra fields would inflate per-edge payload at scale."
            )
        return v


class MeasurementsConfig(BaseModel):
    """Measurements panel — stats/KPI render. Pure formula-bound; no
    role picks needed. ``display_mode`` toggles between a single
    scalar, a short list, or a small stats table.

    Renamed from ``ObservationConfig`` (2026-05-21) to free the
    "Observation" name for the deferred snapshot primitive."""

    kind: Literal["measurements"] = "measurements"
    display_mode: Literal["scalar", "small_list", "stats_table"] = "scalar"
    label: str | None = None


class ScatterConfig(BaseModel):
    """Scatter panel — 2-dim plot (categorical × categorical for
    label-distribution heatmaps, numeric × numeric for true scatter, or
    mixed). The renderer auto-detects category vs numeric per axis.

    ``size`` defaults to ``count`` when omitted — for categorical
    crosses, the dot grows with the number of annotations at each
    (x, y) intersection.
    """

    kind: Literal["scatter"] = "scatter"
    x: str | None = None
    y: str | None = None
    color: str | None = None
    size: str | None = None  # measure name; defaults to 'count' at render time
    mark: Literal["dot", "cell"] = "dot"
    legend: bool = True


PanelConfig = Annotated[
    Union[
        PieConfig,
        ChartConfig,
        MapConfig,
        TableConfig,
        GraphConfig,
        MeasurementsConfig,
        ScatterConfig,
    ],
    Field(discriminator="kind"),
]
"""The discriminated union of per-type panel configs. ``panel.type``
and ``panel.panel_config.kind`` MUST match (enforced by Panel's
validator)."""


# ─── Historical migrator — no-op shim for fresh-DB Alembic runs ────────────


def migrate_views_config(raw_list: Any) -> list[Any]:
    """No-op pass-through retained so the historical ``a2v3w4x5y6z7``
    Alembic revision (which lazy-imports this) doesn't break on fresh
    DBs. The new P2 hard-reset migration supersedes any meaningful
    transformation; this exists purely so the prior revision's import
    line doesn't 500.
    """
    return raw_list if isinstance(raw_list, list) else []

