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

from app.api.modules.annotation.sections import decl_for_name
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


# ─── Projections — the one graph atom source ─────────────────────────────────
#
# A projection says: "this array yields graph atoms, and here is how to read
# node identity, time, place, weight and evidence off each row." A triplet
# array, a nested observation row, and a bare entity roster are three instances
# of one declaration — which is what lets an entity named in a nested row and
# the same entity named in a triplet be **one node** (node identity is a global
# hash of name+type, so the collapse needs no reconciliation code).


class NodeRole(BaseModel):
    """One entity-bearing slot on a projection's row.

    ``path`` is relative to the exploded element: ``"statement_by"`` inside
    ``document.observations[*]``. It may itself explode
    (``"participants[*]"``) — a role can be multi-valued. An **empty** path
    means the exploded element *is* the entity, which is the entity-roster case
    (``document.entities[*]``).

    ``type_path`` / ``type_const`` cover the two ways a row states an entity's
    type. Triplet rows carry it in a sibling column (``subject_type``); an
    entity object carries it inside itself, which is the default (``<path>.type``
    with ``<path>.name`` for the name). ``type_const`` pins the type for rows
    that state a name and nothing else.
    """

    path: str
    label: str | None = None
    """Display name for the role — "speaker", "subject", "recipient"."""
    type_path: str | None = None
    """Where this role's entity type lives, if not inside the entity object."""
    type_const: str | None = None
    """Fixed type for rows that carry only a name."""


class TimeBinding(BaseModel):
    """When a projection's atoms exist.

    ``start`` + ``end`` → a closed interval. ``at`` alone → the atom exists
    from that instant onward (the "only a timestamp" case: it pops into
    existence and stays). Paths are relative to the exploded element, and
    resolve up the ladder — atom time → row time → doc time →
    ``asset.event_timestamp`` — so a row without its own timestamp inherits
    rather than falling out of the timeline.
    """

    at: str | None = None
    start: str | None = None
    end: str | None = None

    @property
    def active(self) -> bool:
        return bool(self.at or self.start or self.end)


class PlaceBinding(BaseModel):
    """Where a projection's atoms are. The spatial mirror of :class:`TimeBinding`.

    A point is an extent that has not moved, exactly as a bare timestamp is an
    interval that has not ended — so space gets the same shape as time and the
    anchor machinery does not grow a second case:

    * ``at`` alone → a point. Pins there.
    * ``start`` + ``end`` → a **trajectory**. Pins at both, draws as an arc, and
      participants are pulled toward both ends. A flight is not "at" either
      airport.

    Paths are relative to the exploded element and name a place **name**, never
    coordinates: ``lat``/``lon`` are resolved server-side in
    ``graph/stream.py:_attach_coords`` from the geocoding cache or curated canon
    entries. Models are never asked for numbers they cannot know.
    """

    at: str | None = None
    start: str | None = None
    end: str | None = None
    kind: str | None = None
    """Path to the field naming *what kind* of place this is — a seat's
    ``registered_office`` vs ``head_office`` vs ``tax_residence``. A company
    has several at once, in different countries, and which one you anchor on
    is the question you are asking. Absent for a plain site."""

    @property
    def active(self) -> bool:
        return bool(self.at or self.start or self.end)

    @property
    def is_trajectory(self) -> bool:
        return bool(self.start and self.end)


class EvidenceBinding(BaseModel):
    """What fills the evidence rail for a projection's atoms.

    Points at an inline justification object, a nested row, or a filtered
    subset of one (``where={"kind": "quote"}``). Deliberately separate from
    ``Projection.activity``: evidence is *why we believe this*, activity is
    *when something happened*. Either can be bound to anything.
    """

    path: str
    where: dict[str, Any] | None = None


class Projection(BaseModel):
    """One declaration of where graph atoms come from and how to read them.

    ``path`` is the array to explode (``"document.observations[*]"``). Node
    roles resolve inside each element.

    Cardinality decides the shape:

    - 2 roles + ``predicate`` → directed edges (the classic triplet)
    - 2+ roles, no ``predicate`` → co-occurrence edges **across roles**
      (values inside a single multi-valued role do *not* link to each other,
      so edge count is bounded by roles² rather than values² — one dense row
      cannot crowd out the graph). Declaring the same path twice is the escape
      hatch for a genuine clique; self-pairs are always dropped.
    - 1 role → nodes only
    """

    path: str
    nodes: list[NodeRole] = Field(default_factory=list)
    """Empty means "infer": every entity-shaped child of the container, in
    declaration order (resolved from the SchemaMap at query time)."""
    predicate: str | None = None
    time: TimeBinding | None = None
    place: str | PlaceBinding | None = None
    """Widened from a bare path to a :class:`PlaceBinding`. A string still
    parses and normalises to ``{at: <path>}``, so every panel authored before
    trajectories existed keeps working with no migration."""
    weight: str | None = None
    evidence: EvidenceBinding | None = None
    activity: TimeBinding | None = None
    """Source for the activity histogram. Falls back to ``time`` when unset —
    they differ only when "what pops in and out" isn't "what the bars count"."""
    properties: list[ForwardPropertySpec] = Field(default_factory=list)
    label: str | None = None
    """Display name for the projection in the panel's axis settings."""

    # ── What is this row ABOUT? ────────────────────────────────────────────
    #
    # The one authoring choice, and the only thing that decides whether a row
    # becomes an occurrence, a property, or a connection. Authors do not set it:
    # it is inferred in ``resolve_projections`` from the row's shape, and the
    # inferred value is returned so the picker can display (and override) it.

    about: str | None = None
    """``None`` → cross-role connections (the historical behaviour).
    ``"self"`` → the row is an **occurrence**: one node of its own, plus a
    role-labelled edge to each participant. ``"<role label>"`` → the row is a
    **property** of that participant: its bindings write onto that node and
    nothing is minted."""
    role: Literal[
        "vector", "step", "anchor", "body", "companion", "edge", "attachment",
    ] | None = None
    """What this section does in the LAYOUT — the second of three independent
    axes, and the one nothing consumed until the declaration chain existed.

    .. code-block:: text

        about   →  graph STRUCTURE   node? edge? property?
        role    →  LAYOUT            what pulls, what is labelled, what recedes
        frame   →  POSITION          which space this section CONSTITUTES

    Independent, not one thing said three times: ``events`` and ``observations``
    are both ``about: self`` while one is a STEP and the other a COMPANION. A
    default from the schema, overridable per panel — which is what makes a
    projection re-pointable (interests are a vector until you are tracing goal
    succession, at which point they are steps).

    Resolved to non-null by :func:`resolve_projections`, beside ``about``, for
    the same reason: the picker and the engine must read the same answer."""
    frame: Frame | None = None
    """Which of time · geo · interest · event this section CONSTITUTES.

    Not "can be positioned in" — ``places`` constitutes geo and ``interests``
    constitutes interest, while an observation constitutes none and is
    positioned by all four. That distinction is what lets the never-geocode
    guard be derived instead of hard-coding the string ``"interest"``."""
    node_kind: Literal["occurrence", "entity"] = "occurrence"
    """``about: self`` only. Is the minted node something that **happened**, or
    something that **is**?

    Applying the model's own test — *would it still exist if nothing had
    happened?* — an exhibit is a document: it exists whether or not anyone
    cites it. So it is an entity, even though its row lives in an ``about:
    self`` array because that is the only branch that mints a node.

    Declared rather than inferred, because the answer is semantic and the shape
    cannot reveal it. Without it, ``kind:`` reported *which array a row landed
    in* rather than what the node is — and ``kind:occurrence`` returned
    exhibits alongside the acts they ground, so "show me everything that
    happened" included documents."""
    node_type: str | None = None
    """Occurrences only. The kind of thing the row is — ``"Payment"``,
    ``"Meeting"``, ``"Holding"``. Surfaces as the node's ``type``, so
    ``type:Payment`` filters without new grammar."""
    node_type_path: str | None = None
    """Read ``node_type`` from a **field on the row** instead of pinning it.

    Mirrors :attr:`NodeRole.type_path` vs :attr:`NodeRole.type_const` — same
    distinction, one level up. It is what lets a single ``observations[*]``
    array carry a ``kind`` enum and still yield ``type:Payment``: the label
    varies per row, so the projection cannot know it in advance.

    A section whose rows differ only by label wants this; one whose rows differ
    by *which roles they fill* still wants separate arrays, because role names
    are the payload. ``node_type`` remains the fallback when a row leaves the
    field empty."""
    node_label: str | None = None
    """Occurrences only. A path, or a ``"{field} → {field}"`` template, for the
    node's display name. Deliberately separate from identity: an occurrence is
    identified by what it *is*, and labelled by what reads well."""
    node_name: str | None = None
    """Occurrences only. The field holding an identifier **the document itself
    supplies** — a case number, exhibit number, tail number, transaction
    reference. Never an identifier a model invents: that is bookkeeping across
    an open-ended generation and it does not survive. Absent, identity falls to
    the positional fallback."""

    @field_validator("place", mode="before")
    @classmethod
    def _normalize_place(cls, v: Any) -> Any:
        """A bare path means "a point here" — the pre-trajectory shape."""
        if isinstance(v, str):
            return PlaceBinding(at=v) if v.strip() else None
        return v

    @property
    def place_binding(self) -> PlaceBinding | None:
        """``place`` as a binding, whatever shape it was authored in."""
        if self.place is None:
            return None
        if isinstance(self.place, PlaceBinding):
            return self.place if self.place.active else None
        return PlaceBinding(at=str(self.place))

    @property
    def is_occurrence(self) -> bool:
        return self.about == "self"

    @property
    def array_path(self) -> str:
        """The bare array path, explosion marker stripped — what
        ``jsonb_value_accessor`` needs for the LATERAL."""
        p = self.path.strip()
        return p[:-3] if p.endswith("[*]") else p


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


Frame = Literal["time", "geo", "interest", "event"]
"""A space that can give a node a POSITION.

There are exactly four, and the count is not a design choice — it is what
survives asking *does distance in this dimension mean anything*. Time is
metric and universal; geo is metric and the only frame whose coordinates are
not our opinion; interest is semantic, so its position is arbitrary and can
therefore be solved for; event discretises time into meaningful bins.

Everything else an observation carries is categorical (colour), scalar (size)
or relational — and actors, notably, can never be a frame. Actor space has no
intrinsic order, so actors are what the axes *position*. See
``docs/plans/observation-model/INVESTIGATION.md`` §3.
"""

#: How many spatial axes each frame costs when it holds one.
#: Geo is a plane (lat × lon); the others are a line.
FRAME_COST: dict[str, int] = {"geo": 2, "time": 1, "interest": 1, "event": 1}

#: The budget. Three axes in 3D, two in 2D.
AXIS_BUDGET_3D = 3


class AxisBudget(BaseModel):
    """Which frames hold the spatial axes — the graph panel's primary control.

    Replaces the question "which field is the graph source", which is not a
    question an investigator has. The real one is **how are you spending three
    axes across four frames**, and the answer is two values.

    The default is the block: geo takes the plane because it is the only frame
    with verifiable coordinates, time takes the vertical because every node has
    one (the four-rung ladder guarantees it), and interest is left FREE — so an
    unpinned interest node drifts to the weighted centroid of everything serving
    it, and its position becomes an answer to *where and when is this motive
    being pursued*. Same argument as HANDOVER §9's weighted middleground, one
    dimension up.

    A frame not named here is not lost: it becomes a channel (colour) and, for
    interests, an attractor.
    """

    plane: Frame | None = "geo"
    """The frame holding two axes. Only ``geo`` is genuinely 2D; naming a 1D
    frame here spends one axis and leaves the other free."""
    up: Frame | None = "time"
    """The frame holding the remaining axis."""
    pin: bool = True
    """Hard-pin the plane rather than pulling toward it. What "verifiable
    coordinate" means — a simulation must not out-vote a latitude."""

    @property
    def spent(self) -> int:
        return sum(FRAME_COST.get(f, 1) for f in (self.plane, self.up) if f)

    @property
    def free(self) -> list[str]:
        """Frames not holding an axis. They still cluster and still colour."""
        used = {f for f in (self.plane, self.up) if f}
        return [f for f in FRAME_COST if f not in used]

    @field_validator("up")
    @classmethod
    def _within_budget(cls, v: Frame | None, info: Any) -> Frame | None:
        plane = (info.data or {}).get("plane")
        if v and plane and v == plane:
            raise ValueError("a frame cannot hold both the plane and the up axis")
        cost = FRAME_COST.get(plane or "", 0) + FRAME_COST.get(v or "", 0)
        if cost > AXIS_BUDGET_3D:
            raise ValueError(
                f"axis budget is {AXIS_BUDGET_3D}; {plane}+{v} costs {cost}")
        return v


class GraphConfig(BaseModel):
    """Graph panel viz map. ``projections`` is authoritative for *what the
    graph is made of*; the rest are visual channels over the result.

    ``projections`` empty is the legacy shape: one triplet field, taken from
    Formula's first group dim (``Formula.group[0].path``) or ``source``. See
    :func:`resolve_projections`, which synthesizes that single projection so
    existing panels render unchanged with no migration.
    """

    kind: Literal["graph"] = "graph"
    projections: list[Projection] = Field(default_factory=list)

    # ── The document rung ──────────────────────────────────────────────────
    #
    # The weakest rung of both ladders, and the only one that is not a property
    # of a row. "This filing is about Malta, and is dated 2014" says something
    # about *everything the filing mentions* — weakly. It belongs here rather
    # than on a projection because it is scoped to the annotation, not to any
    # one array, and because a row that has its own place must never lose it to
    # the document's.
    #
    # Applied at materialisation: a document place is appended to every node the
    # annotation produced, tagged ``source: "doc"`` so the anchor can weight it
    # near zero and the renderer can never present it like a stated site. A
    # document date fills ``t0`` **only** for nodes that have none — the promise
    # ``TimeBinding`` already makes, that a row without its own timestamp
    # inherits rather than falling out of the timeline.
    doc_place: str | None = None
    """Path to the place the document is *about* — a name, never coordinates."""
    doc_time: str | None = None
    """Path to the date the document gives itself: filed, published, recorded.
    Not the date of the events it describes — that is what row bindings are."""

    axes: AxisBudget = Field(default_factory=AxisBudget)
    """How the three spatial axes are spent across the four frames.

    Declared here rather than in the frontend's ``graphViewConfig`` blob for
    the reason ``q`` and ``hud`` are: typed so Pydantic cannot drop it, survives
    reload, travels with a shared dashboard, and is writable by the companion.
    The frontend resolves it into ``AnchorSpec[]`` — the anchor primitive is a
    render concern and stays there."""

    q: str | None = None
    """The panel's GQL string — see :mod:`app.api.modules.graph.gql`.

    Lives on the panel config rather than in transient UI state so it survives
    reload, travels with a shared dashboard, and is writable by the companion
    (which drives the graph by writing a query the user can see and edit, never
    hidden state). The frontend persisted this as an untyped extra before it was
    declared here.
    """
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

    hud: dict[str, Any] | None = None
    """Which HUD pane is pointed at what — the channel map.

    A channel is one slot in the panel's viz map that consumes a binding, the
    same idea as ``node_group_by`` one level up: point ``items`` at a different
    occurrence type and the list changes; point it at evidence occurrences and
    evidence *becomes* the item list. What counts as an observation or as
    evidence is a choice, and it has to survive reload to be a choice at all.

    Opaque here, like ``edits``: the backend never reads it, and the panes are
    pure functions over the assembled graph. But it must be **declared**, or
    Pydantic drops the key on the way through and every channel silently
    resets to its default on the next load — exactly what happened to ``q``
    before it was typed."""

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


# ─── Projection resolution ───────────────────────────────────────────────────


_LEGACY_TRIPLET_FIELD = "relationships"


def _infer_node_roles(smap: Any, container: str) -> list[NodeRole]:
    """Node roles for a projection that didn't declare any.

    Three cases, decided by what the container actually is:

    * **entity roster** (``array_entity``) — the exploded element *is* the
      entity, so there is one role with an empty path. Yields nodes only.
    * **triplet row** — pick the subject/object keys the contract really uses
      (a schema may say ``head``/``tail`` rather than ``subject_name``/
      ``object_name``), pairing each with its type sibling if present.
    * **anything else** — every entity-shaped child, in declaration order. This
      is what makes ``document.observations[*]`` graph itself with no config:
      ``statement_by`` and ``directed_to`` become the two roles.
    """
    from app.api.modules.annotation.schema_map import (
        ENTITY_SHAPES,
        OBJECT_NAME_KEYS,
        OBJECT_TYPE_KEYS,
        SUBJECT_NAME_KEYS,
        SUBJECT_TYPE_KEYS,
    )

    own = smap.get(container) if smap is not None else None
    if own is not None and own.shape == "array_entity":
        return [NodeRole(
            path="",
            label=own.label or container.rsplit(".", 1)[-1].removesuffix("[*]"),
            type_const=own.entity_type or None,
        )]

    children = smap.in_container(container) if smap is not None else ()
    by_key = {n.path.rsplit(".", 1)[-1]: n for n in children}

    def first(keys: tuple[str, ...]) -> str | None:
        return next((k for k in keys if k in by_key), None)

    # **Entity children win, and are checked first.** The triplet alias families
    # are a legacy read path and must never pre-empt a row that says what it
    # means. They nearly did something absurd here: ``SUBJECT_NAME_KEYS``
    # contains ``from`` and ``OBJECT_NAME_KEYS`` contains ``to``, so a perfectly
    # ordinary row using ``from``/``to`` as *interval dates* — which the
    # observation-model template does everywhere — was detected as a triplet and
    # had its two date fields made into the graph's nodes.
    #
    # An entity already carries ``{name, type}``, which is exactly what a
    # triplet spells out as ``subject_name`` + ``subject_type``. When a row has
    # entity fields there is nothing left for the aliases to disambiguate.
    entity_children = [
        n for n in children
        if n.shape in ENTITY_SHAPES and n.container == container
    ]
    if not entity_children:
        subj, obj = first(SUBJECT_NAME_KEYS), first(OBJECT_NAME_KEYS)
        if subj and obj:
            return [
                NodeRole(path=subj, label="subject",
                         type_path=first(SUBJECT_TYPE_KEYS)),
                NodeRole(path=obj, label="object",
                         type_path=first(OBJECT_TYPE_KEYS)),
            ]

    if entity_children:
        return [
            NodeRole(
                path=n.path[len(container) + 1:],
                # The label is user-facing — it becomes the edge predicate on an
                # occurrence ("on_board", "payer"). The explosion marker belongs
                # to the *path*, not to the name of the role, and leaking it
                # renders edges labelled ``actors[*]``.
                label=n.label or n.path.rsplit(".", 1)[-1].removesuffix("[*]"),
                type_const=n.entity_type or None,
            )
            for n in entity_children
        ]

    # **A row we can read, that names nobody, has no roles.** An exhibit relates
    # to nothing until something cites it; a named event relates to nothing until
    # an observation says it belongs. Both are ``about: self`` rows whose whole
    # content is their own identity, and inventing subject/object for them
    # fabricates two participants out of columns that do not exist.
    if children:
        return []

    # Nothing to read at all — an unschemed array, so fall back to the canonical
    # triplet keys. The read side COALESCEs across the whole alias family for
    # these, so a differently-named row still resolves.
    return [
        NodeRole(path="subject_name", label="subject", type_path="subject_type"),
        NodeRole(path="object_name", label="object", type_path="object_type"),
    ]


def _infer_about(proj: "Projection", roles: list[NodeRole]) -> str | None:
    """Is this row an occurrence, or a connection between two things?

    Two questions decide it (see ``docs/plans/observation-model/HANDOVER.md`` §2):

    1. Could this same row happen **more than once** between the same
       participants?
    2. Does the row involve **more than two** participants?

    Either yes → an occurrence, and it needs a node of its own.

    **Question 2 is countable.** Three participants do not fit in a pair, and one
    participant has no pair to be — so both are necessarily occurrences. Keeping
    a three-role row as connections is what makes a ``payer/payee/bank`` row
    emit ``payee --paid--> bank``, a relation nobody asserted.

    **Question 1 is semantic, and the computable proxy is point-vs-interval.**
    A row bound to an instant (``time.at``) is an event, and events recur: two
    payments between the same pair are two rows. A row bound to an interval
    (``start``/``end``) is a state that holds, and states do not recur —
    ``A works_for B, 2011–2015`` is one connection, not many. A row carrying
    its own place is likewise a located act rather than a standing fact.

    A row carrying its **own** place, magnitude or grounds is likewise being
    spoken about in its own right: collapsing it to a pair would smear the
    place, average away the amount, or orphan the quote.

    **This follows the model, not the history.** The one shape that would be
    mis-read is a legacy triplet array carrying ``confidence`` — a weight that
    qualifies belief rather than the act. That shape is pinned to ``"between"``
    by the legacy adapter in :func:`resolve_projections`, so the inference does
    not have to be timid on its account. New schemas declare relations as an
    ``array_object`` with two entity children and say what they mean.

    **A property row is never inferred.** Whether a row *describes* one of its
    participants rather than relating them is a judgement the shape cannot
    reveal — ``{who, place, from, to}`` is structurally identical to an
    encounter. That one stays an explicit ``about: "<role>"``, which is what
    ``about`` exists for.
    """
    if proj.about is not None:
        return proj.about

    # A roster is not a statement. When the exploded element *is* the entity
    # (an ``array_entity``, so the single role has an empty path) the row mints
    # the entity itself — it did not happen, it simply is. Treating it as an
    # occurrence would turn every vocabulary list into a pile of anonymous
    # nodes and lose the names the whole graph refers to.
    if len(roles) == 1 and not (roles[0].path or "").strip():
        return None

    if len(roles) != 2:
        # 3+ cannot be a pair; a lone participant inside a row has no pair to be.
        return "self"

    time_is_instant = bool(proj.time and proj.time.at and not proj.time.end)
    if time_is_instant or proj.place_binding or proj.weight or proj.evidence:
        return "self"

    return "between" if proj.predicate else None


def _infer_role(proj: "Projection", about: str | None) -> str:
    """The layout role a projection defaults to when nothing declared one.

    Follows from ``about`` plus ``node_kind``, which is why a contract that
    declares neither still lays out sensibly. The ladder is deliberately short:
    a role is a *default* the panel may re-point, so guessing conservatively
    and letting the schema override beats guessing cleverly.
    """
    if proj.role:
        return proj.role
    if about == "between":
        return "edge"
    if about and about not in ("self", "between"):
        return "companion"          # a property row rides its subject
    if about == "self":
        # An exhibit exists whether or not anyone cites it — it is grounds, and
        # grounds are never positioned. An act is the dense layer that rides a
        # step at zero weight.
        return "attachment" if proj.node_kind == "entity" else "companion"
    # A roster: one role with an empty path, i.e. the exploded element IS the
    # entity. Bodies move along and gather at steps.
    return "body"


#: Sections whose ``about`` is the model's own rule rather than a shape
#: inference, plus their conventional bindings, now live in
#: :mod:`app.api.modules.annotation.sections` — as ONE table that
#: ``build_contract`` stamps into the contract and ``derive_projections`` reads
#: back. They used to be two dicts here and a third copy in
#: ``templates.build_projections``, and those had already drifted: the events
#: binding carried its justification onto the evidence rail in one copy and not
#: the other, so a derived panel silently dropped every event's grounds.


def derive_projections(smap: Any) -> list[Projection]:
    """Every array in the contract, projected — for a panel that configured none.

    **A schema written in the pattern should graph itself.** A template arrives
    with its projections wired, but a hand-authored or companion-authored
    contract in the same shape arrives with none, and the legacy fallback
    synthesised exactly *one* over ``cfg.source``. So a v2 schema opened in a
    panel showed a single array and silently dropped every other section — the
    rosters, the events, the evidence, the whole point.

    Two things make this derivation rather than guesswork:

    * ``about`` comes from the **section name**, which is the model's own rule
      (HANDOVER §6). It is also the only way to get ``attributes`` right —
      a property row is never inferable from shape, because ``{who, place,
      from, to}`` is structurally identical to an encounter.
    * the bindings come from the field names the model prescribes and
      ``templates.py`` emits. A contract that uses other names simply gets
      fewer bindings; nothing breaks, and the Sources surface can still bind
      them by hand.

    An explicitly declared projection always wins. This only ever fills a void.

    **Three rungs, strongest first.**

    .. code-block:: text

        1. DECLARED   the section's own `x-graph`  — any name works
        2. NAME       the conventional table       — contracts written before
                                                     declarations existed
        3. SHAPE      `_infer_about`, downstream   — anything else

    Rung 1 is what makes the model general. Rung 2 used to be the whole
    mechanism, which meant a section called ``motives`` got no ``about``, no
    bindings, no frame and no layout role — silently, and the graph rendered
    something plausible and wrong. It stays as the compatibility rung, and
    ``test_v2_end_to_end`` asserts that a contract with every declaration
    stripped still derives exactly what it always did.
    """
    if smap is None:
        return []

    seen: list[str] = []
    for node in getattr(smap, "fields", ()) or ():
        # Top-level arrays only: a section, not a nested row inside one.
        path = getattr(node, "path", "") or ""
        if getattr(node, "container", None) is not None:
            continue
        if getattr(node, "shape", "") not in ("array_object", "array_entity", "triplet"):
            continue
        if path not in seen:
            seen.append(path)

    declared = getattr(smap, "section_decls", None) or {}
    out: list[Projection] = []
    for path in seen:
        decl = declared.get(path)
        if decl is None:
            section = path.rsplit(".", 1)[-1].removesuffix("[*]").lower()
            decl = decl_for_name(section)
        spec: dict[str, Any] = {
            "path": f"{path}[*]" if not path.endswith("[*]") else path,
            **(decl or {}),
        }
        try:
            out.append(Projection(**spec))
        except Exception:  # noqa: BLE001 — a malformed section must not sink the rest
            logger.warning("derive_projections: could not project %r", path)
    return out


def derive_doc_anchors(smap: Any) -> dict[str, str | None]:
    """The document rung, for a contract that declared no panel config.

    Same reasoning as :func:`derive_projections`, for the two bindings that are
    annotation-scoped rather than per-projection. Worth deriving rather than
    leaving empty: the weakest rung is what dates and places everything a row
    left blank, and on the first real run it was the only reason 12 of 14
    statements had a timestamp at all — the model had written "Wednesday".
    """
    if smap is None:
        return {"doc_place": None, "doc_time": None}
    have = {getattr(n, "path", "") for n in (getattr(smap, "fields", ()) or ())}
    return {
        "doc_place": "document.at.name" if "document.at" in have else None,
        "doc_time": "document.dated" if "document.dated" in have else None,
    }


def resolve_projections(
    cfg: "GraphConfig",
    *,
    formula: Any = None,
    smap: Any = None,
) -> list[Projection]:
    """The projections a graph panel actually runs.

    ``cfg.projections`` is authoritative. When it's empty — every panel
    authored before projections existed — one triplet projection is synthesized
    from ``formula.group[0].path`` → ``cfg.source`` → ``"relationships"``, with
    the legacy per-field knobs (``edge_weight_field``, ``forward_properties``)
    folded onto it so the read side has exactly one place to look.

    Projections that declared no ``nodes`` get them inferred from *smap*. Doing
    it here rather than in the engine means the picker and the companion can
    show the same resolved roles the query will use.
    """
    projections = list(cfg.projections)
    if not projections:
        # A schema written in the pattern graphs itself. Only when nothing is
        # derivable do we fall back to the single legacy array.
        derived = derive_projections(smap)
        if derived:
            out: list[Projection] = []
            for p in derived:
                # Roles FIRST — `_infer_about` reads them, and a roster is only
                # recognisable as one once its single empty-path role exists.
                roles = list(p.nodes) or _infer_node_roles(
                    smap, p.path if p.path.endswith("[*]") else f"{p.path}[*]")
                about = _infer_about(p, roles)
                out.append(p.model_copy(update={
                    "nodes": roles, "about": about,
                    "role": _infer_role(p, about),
                }))
            return out
        group_path = None
        groups = getattr(formula, "group", None) if formula is not None else None
        if groups:
            group_path = getattr(groups[0], "path", None)
        projections = [Projection(
            path=group_path or cfg.source or _LEGACY_TRIPLET_FIELD,
            predicate="predicate",
            weight=cfg.edge_weight_field,
            properties=list(cfg.forward_properties),
            # ── THE legacy adapter ────────────────────────────────────────
            # Pinned, not inferred. A triplet array *is* the connection shape,
            # and its ``confidence``-style weights qualify belief rather than
            # the act — so inference must not see them. Pinning here is what
            # lets ``_infer_about`` follow the model everywhere else.
            #
            # This is the only place the old shape is accommodated, and it is
            # meant to stay that way. New schemas declare a relation as an
            # ``array_object`` with two entity children: an entity already
            # carries ``{name, type}``, which is exactly what a triplet spells
            # out as ``subject_name`` + ``subject_type``. The two are
            # isomorphic, so the alias families in ``schema_map`` and the
            # COALESCE ladder in ``stream._role_json_sql`` are read-time
            # compatibility for stored contracts — not the way forward.
            about="between",
        )]

    out: list[Projection] = []
    for p in projections:
        roles = list(p.nodes)
        if not roles:
            container = p.path if p.path.endswith("[*]") else f"{p.path}[*]"
            roles = _infer_node_roles(smap, container)
        # ``about`` is resolved here, next to the roles it depends on, so the
        # picker and the engine read the same answer — and so an author who
        # wants a different one overrides a value they can see.
        about = _infer_about(p, roles)
        out.append(p.model_copy(update={
            "nodes": roles,
            "about": about,
            # Resolved here, next to `about`, because it is derived FROM it —
            # and so the picker and the engine cannot read different answers.
            "role": _infer_role(p, about),
        }))
    return out


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

