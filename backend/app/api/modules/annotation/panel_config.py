"""Panel render settings — the per-type configuration a dashboard panel carries.

A :class:`Panel` (from :mod:`.formula`) is the thin render binding —
``formula_id`` XOR ``observation_id`` + ``grid_position`` + a ``settings``
dict. The typed shapes for that dict, plus shared rendering vocab
(``PanelType``, ``GridPosition``, ``Scope``, ``ForwardPropertySpec``), live
here. The query body — dims, measures, derives — is on the **Formula**,
not the Panel.

The legacy module also contained ``PanelProjection`` (the false primitive
that conflated three jobs) and ``migrate_panel_config`` (a 200-line legacy
hoist). Both were deleted with the Formula/Axis unroll. ``migrate_views_
config`` survives as a no-op shim so the historical ``a2v3w4x5y6z7``
Alembic revision still imports it cleanly on fresh DBs (where the
annotationrun table is empty and the migration is a no-op anyway).
"""

from __future__ import annotations

import logging
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator

from app.core.filters import FilterSet, MergeMap

logger = logging.getLogger(__name__)


PanelType = Literal["table", "chart", "pie", "graph", "map"]


class GridPosition(BaseModel):
    """Dashboard grid coordinates. All four required to avoid layout surprises."""

    x: int
    y: int
    w: int
    h: int


class Scope(BaseModel):
    """A cross-panel filter constraint. Source panel produces, receiver applies.

    ``mode='push'`` is a snapshot: the filter is captured at creation time.
    ``mode='link'`` keeps the receiver coupled to the source's current filter
    (live propagation in the frontend store).

    ``group_context`` carries the source panel's active group value when the
    selection was made inside one group's render unit. ``merge_maps`` carries
    the source panel's active normalization so the receiver can resolve
    canonicalized values back to raw strings.
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


# ─── Per-panel-type settings ────────────────────────────────────────────────


class ForwardPropertySpec(BaseModel):
    """One triplet property to forward onto emitted graph edges.

    ``agg`` picks how repeated triplets combine their property value. Never
    uses ``array_agg(DISTINCT ...)``: unbounded-cardinality text fields can
    pack tens of MB into a single aggregated row at scale.
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


class GraphPanelSettings(BaseModel):
    """Graph-specific configuration that doesn't fit projection/aggregation.

    Most of these drive the ``/view`` request's ``GraphConfig`` body; a few
    (``layout``, ``edits``, ``dim_unmatched``) are client-side only.
    """

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
    # touch one), preserving context while sharpening focus on the lens.
    # Default-on is safe: with no cooccurs scope, the renderer no-ops and
    # the graph looks identical to before. Set to false to opt out.
    # Client-side render toggle — does not change what the backend returns.
    dim_unmatched: bool = True
    # Client-side-only edits (node merges, hides, label overrides). Opaque to
    # the backend — shape is frontend-owned.
    edits: dict[str, Any] | None = None

    @field_validator("forward_properties")
    @classmethod
    def _cap_forward_properties(cls, v: list[ForwardPropertySpec]) -> list[ForwardPropertySpec]:
        # Hard cap: each forwarded property becomes an additional aggregated
        # column in the graph SELECT. At 5M-row scale this is where the
        # per-request memory footprint starts to matter.
        if len(v) > 5:
            raise ValueError(
                f"forward_properties capped at 5; got {len(v)}. "
                "Extra fields would inflate per-edge payload at scale."
            )
        return v


class AnalyticsOverlays(BaseModel):
    """Client-side derived computations rendered over a timeline chart."""

    rolling_average: dict[str, Any] | None = None  # {window: int}
    bands: bool = False
    trend_line: bool = False
    peak_markers: bool = False
    std_dev_bands: bool = False


class ChartPanelSettings(BaseModel):
    """Chart/timeline/bar panel settings. ``chart_kind`` picks the render mode."""

    chart_kind: Literal["bar", "line", "timeline"] = "timeline"
    time_axis: dict[str, Any] | None = None
    analytics_overlays: AnalyticsOverlays = Field(default_factory=AnalyticsOverlays)
    show_statistics: bool = False


class MapPanelSettings(BaseModel):
    """Map panel settings. Geocoding is stubbed today; shape is forward-compat."""

    geocode_source: dict[str, Any] | None = None  # {schema_id, field_key}
    label_source: dict[str, Any] | None = None
    show_labels: bool = True
    show_areas: bool = False


class TablePanelSettings(BaseModel):
    """Table panel — column selection per schema."""

    selected_fields_per_scheme: dict[str, list[str]] = Field(default_factory=dict)


class PiePanelSettings(BaseModel):
    """Pie chart panel — only a soft cap on slice count."""

    max_slices: int | None = None


# ─── Historical migrator — no-op shim for fresh-DB Alembic runs ─────────────


def migrate_views_config(raw_list: Any) -> list[Any]:
    """No-op pass-through retained so the historical ``a2v3w4x5y6z7``
    Alembic revision (which lazy-imports this) doesn't break on fresh DBs.
    Under the Formula/Axis unroll the legacy ``PanelProjection`` shape is
    abandoned; existing-DB rows were reset by revision ``f0rmula1unr0``,
    fresh DBs have no rows to migrate, so a real migrator would only
    confuse the picture.
    """
    return raw_list if isinstance(raw_list, list) else []
