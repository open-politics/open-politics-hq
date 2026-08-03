"""Graph domain Pydantic schemas for API responses and OpenAPI generation."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Graph data items (shared by ephemeral annotation graph + persistent graph) ──


class NodePlace(BaseModel):
    """One place a node is, over one interval, from one rung of the ladder.

    A node's location is a list because that is what the world is: a company
    holds a registered office, a head office and a tax residence
    simultaneously, in three countries. Anchoring on the one you care about is
    the question you are asking, and the gap between two of them is often the
    finding.

    ``source`` is the rung — ``row`` is a stated site (strongest, hard-pinnable),
    ``attribute`` is a seat (softer), ``doc`` and ``asset`` are weaker still.
    They must never render alike: "this filing is about Malta" carries nothing
    like the authority of "the meeting was in Valletta".
    """

    place: str
    lat: float | None = None
    lon: float | None = None
    #: The interval this place holds over. Open ``to`` means "still current".
    from_: str | None = Field(default=None, alias="from")
    to: str | None = None
    #: What kind of place — ``registered_office``, ``head_office``. Null for a
    #: plain site.
    kind: str | None = None
    source: Literal["row", "attribute", "doc", "asset", "canon"] = "row"
    #: Which end of a trajectory this is. ``None`` for a point. A movement is
    #: at neither endpoint — it spans them — so both ends live here and resolve
    #: their own coordinates through the same path as any other place.
    end: Literal["from", "to"] | None = None

    model_config = ConfigDict(frozen=True, populate_by_name=True)


class GraphNodeData(BaseModel):
    """One node in a graph projection (entity with frequency).

    ``entity_id`` scaffolds a curation overlay — populated once a triplet has
    been resolved to an ``Entity`` row. Null in ephemeral (uncurated) graphs.
    ``group_value`` carries the panel's ``node_group_by`` field value when
    grouping is active.

    ``evidence`` aggregates the inline ``justification`` payload from every
    triplet where this node appears as source or target. Each entry mirrors
    the structured-output ``JustificationSubModel`` shape (``reasoning``,
    ``text_spans``, ``image_regions``, ...). Empty list when no contributing
    triplet carried justification.
    """

    id: str
    name: str
    type: str
    frequency: int
    #: What kind of node this is. ``entity`` comes from a named set — it
    #: persists, is named, and participates repeatedly. ``occurrence`` is minted
    #: from a statement row that is *about itself*: it came to be, and it is
    #: identified by its participants and its when rather than by a name of its
    #: own. The renderer treats them oppositely — entities are the labelled
    #: nouns, occurrences are the numerous connective tissue.
    kind: Literal["entity", "occurrence"] = "entity"
    #: Occurrences only: the declared kind of act — ``Payment``, ``Meeting``.
    #: Mirrors into ``type`` so ``type:Payment`` filters with no new grammar.
    node_type: str | None = None
    #: What the document said this act was worth — an amount, a percentage, a
    #: 1–10 salience. Deliberately separate from ``frequency`` (how often we
    #: saw it): conflating them makes "mentioned often" look like "large".
    #: **Not a measurement.** A model-emitted scale is uncalibrated and not
    #: comparable across documents, so it ranks within a run and nothing more.
    magnitude: float | None = None
    source_annotation_ids: list[int] = Field(default_factory=list)
    entity_id: int | None = None
    group_value: str | list[str] | dict[str, float] | None = None
    """Clustering key — **presentation**. A scalar is one label; a list is
    multi-label; a ``{label: weight}`` map is a *vector*. The affinity anchor
    reads all three shapes.

    Whatever ``node_group_by`` asked for lands here, so its meaning changes
    with the panel's configuration. Read :attr:`profile` for the semantic
    vector; see the note there for why the two are separate fields."""
    profile: dict[str, float] | None = None
    """Signed affinity vector — **data**, and only ever a semantic one.

    Written by :func:`stream.attach_neighbour_profiles` for the
    ``neighbours:<Type>`` form: ``{opacity: 8.2, oversight: -3.0}``, an
    aggregate over ``node → occurrence → <Type>`` weighted by each act's
    magnitude and signed by whether the act served or opposed.

    Separate from :attr:`group_value` because that slot is whatever the panel
    asked to group by, and the convergence residual will cosine any dict it is
    handed. With ``node_group_by: "roles"`` the slot holds a role histogram
    (``{via: 340, employer: 12}``), and cosining two of those produces a
    confident number about nothing. One slot, two meanings, three consumers —
    so the meanings get a field each."""
    properties: dict[str, Any] = Field(default_factory=dict)
    # ── Time ──
    # Existence interval, unioned across every atom that named this node.
    # ``t1 = None`` with a ``t0`` present means open-ended — the node exists
    # from ``t0`` onward, which is what a bare timestamp declares. A time
    # slider filters on these client-side; no refetch.
    t0: str | None = None
    t1: str | None = None
    # Activity interval — the histogram source when a projection binds
    # ``activity`` separately from ``time``. Falls back to t0/t1 when unbound.
    a0: str | None = None
    a1: str | None = None
    # ── Space ──
    #: Raw location string from the projection's ``place`` binding — the
    #: ``at``, or the origin of a trajectory.
    place: str | None = None
    #: The far end of a trajectory, when the projection bound
    #: ``place {start, end}``. A movement is at neither endpoint; it spans
    #: them, and both are needed to draw the arc.
    place_to: str | None = None
    #: Every place this node is, with its interval, kind and ladder rung.
    #: ``place``/``lat``/``lon`` above mirror the first entry so callers written
    #: against the scalar shape keep working.
    places: list[NodePlace] = Field(default_factory=list)
    #: Geo anchor, joined from ``CanonEntry.properties.coords`` when the name
    #: resolves in the run's canon. Null for nodes that never geocoded.
    lat: float | None = None
    lon: float | None = None
    # ── Provenance ──
    #: Which projections produced this node — lets a panel split or unify by
    #: field the way ``GraphEdge.source_field_path`` does for curated edges.
    source_paths: list[str] = Field(default_factory=list)
    #: Role labels this node appeared under ("speaker", "subject", …).
    roles: list[str] = Field(default_factory=list)
    evidence: list[dict[str, Any]] = Field(default_factory=list)


class GraphEdgeData(BaseModel):
    """One edge in a graph projection (source → target via predicate).

    ``computed_weight`` is the panel's ``edge_weight_mode`` result (may differ
    from raw count — e.g. ``count * avg(confidence)``). ``group_value`` is the
    edge's ``edge_group_by`` bucket when grouping is active; one triplet may
    appear in multiple groups, splitting edges. ``properties`` carries
    user-selected ``forward_properties`` so the renderer can consume them
    without a second query.

    ``evidence`` is an ordered list of inline ``justification`` payloads — one
    per triplet that contributed to this edge slot. Carries the structured
    ``JustificationSubModel`` shape (``reasoning``, ``text_spans``, ...). When
    no contributing triplet had justification enabled, ``evidence`` is empty.
    """

    source: str
    target: str
    predicate: str
    #: The role this edge's target plays in its source occurrence — ``payer``,
    #: ``via``, ``on_board``. A property of the *edge*, never of the node: the
    #: same bank is ``via`` in 340 payments and ``employer`` in 12 employments
    #: while staying one node. "Facilitator" is therefore a measured view
    #: (degree restricted to a role), never a declared type.
    role: str | None = None
    weight: int
    computed_weight: float | None = None
    group_value: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)
    #: Existence interval, unioned across contributing atoms. ``t1 = None``
    #: with ``t0`` set means open-ended (a bare timestamp: from here onward).
    #: This is what pops an edge in and out of the graph on the time slider.
    t0: str | None = None
    t1: str | None = None
    #: Activity interval — separate histogram source when a projection binds
    #: ``activity`` distinctly from ``time``.
    a0: str | None = None
    a1: str | None = None
    #: Which projections contributed to this edge.
    source_paths: list[str] = Field(default_factory=list)


class GraphResultData(BaseModel):
    """Blocking collect shape. Used when caller drains the chunk stream into
    a full node/edge set (bounded by top_n caps)."""

    nodes: list[GraphNodeData]
    edges: list[GraphEdgeData]


class GraphChunkData(BaseModel):
    """Streaming delta. Emitted as GraphChunkEvent.

    nodes = newly-seen (not yet emitted in this stream);
    edges = this chunk's edges.
    """

    nodes: list[GraphNodeData]
    edges: list[GraphEdgeData]


# ── Canon ──


class CanonPropertyDef(BaseModel):
    """One typed property slot a canon declares for an entity type.

    ``Canon.type_schemas`` maps a type name → an ordered list of these. It's
    *guidance* for the workbench editor (which typed input to render for an
    entry of that type), never a gate: entries keep a free-form ``properties``
    bag, so undeclared types and extra keys are always allowed.

    ``type`` is one of: ``text``, ``number``, ``integer``, ``boolean``,
    ``date``, ``url``, ``list`` (a list of text).
    """

    name: str
    type: str = "text"
    description: Optional[str] = None
    required: bool = False


class CanonRead(BaseModel):
    """Response schema for Canon."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    external_id: Optional[str] = None
    infospace_id: int
    name: str
    description: Optional[str] = None
    tags: List[str] = []
    type_schemas: Dict[str, List[CanonPropertyDef]] = {}
    created_at: datetime
    updated_at: datetime


class CanonCreate(BaseModel):
    """Request schema for creating a Canon.

    ``from_run`` and ``from_merges`` are optional seeding paths — the canon
    can be created empty, populated from an annotation run's
    ``graph_config.entity_merges`` (transient hints, never moved), or
    populated from explicit merge groups passed in the request.
    """

    name: str
    description: Optional[str] = None
    external_id: Optional[str] = None
    tags: Optional[List[str]] = None
    type_schemas: Optional[Dict[str, List[CanonPropertyDef]]] = None
    from_run: Optional[int] = None
    from_merges: Optional[List["EntityMergeHint"]] = None


class CanonUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    external_id: Optional[str] = None
    tags: Optional[List[str]] = None
    type_schemas: Optional[Dict[str, List[CanonPropertyDef]]] = None


class ExtendCanonRequest(BaseModel):
    """``POST /canons/{id}/action/extend`` body: pull a run's merge entries
    into this canon. The run's ``graph_config.entity_merges`` is read-only
    (transient) — entries are materialized as CanonEntry rows under this canon.
    """

    run_id: int


class CanonExtendResponse(BaseModel):
    added: int
    skipped: int
    entries: List[Dict[str, Any]] = Field(default_factory=list)


class PromoteRunRequest(BaseModel):
    """``POST /runs/{run_id}/action/promote`` body. Target canon defaults to the
    run's primary declared canon (``canon_ids[0]``), then the infospace default.
    """
    canon_id: Optional[int] = None


class PromoteResponse(BaseModel):
    """Outcome of promoting a run's folds into a canon."""
    canon_id: int
    created: int = 0
    merged: int = 0
    extended: int = 0
    skipped: int = 0
    entries: List[Dict[str, Any]] = Field(default_factory=list)


# ── Resolve-into-canon mode + staged proposals ───────────────────────────────


class ResolveIntoCanonRequest(BaseModel):
    """``POST /runs/{id}/action/resolve-into-canon`` body — toggle the mode."""
    enabled: bool = True


class CanonProposalRead(BaseModel):
    """A staged, human-confirmed resolution proposal (settled-only mode)."""
    model_config = ConfigDict(from_attributes=True)

    id: int
    canon_id: int
    run_id: Optional[int] = None
    surface: str
    type: str
    status: str
    suggested_entry_ids: List[int] = []
    occurrence_count: int = 1
    example_annotation_ids: List[int] = []
    created_at: datetime
    updated_at: datetime


class CanonProposalAcceptRequest(BaseModel):
    """Accept a proposal: merge the surface into an existing entry (alias), or
    create a new entry when ``merge_into_entry_id`` is omitted."""
    merge_into_entry_id: Optional[int] = None


class BulkProposalAcceptItem(BaseModel):
    """One accept in a bulk triage call — same semantics as the single accept."""
    proposal_id: int
    merge_into_entry_id: Optional[int] = None


class BulkProposalRequest(BaseModel):
    """Triage many proposals in one call. Each is settled (alias/create or
    dismissed); affected runs are then re-curated **once each** (not once per
    proposal) — the live-flood ergonomic."""
    accept: List[BulkProposalAcceptItem] = []
    dismiss: List[int] = []


class BulkProposalResponse(BaseModel):
    accepted: int
    dismissed: int
    runs_recurated: int
    skipped: int  # not found / not pending


class EmbedCanonParams(BaseModel):
    """Backfill embeddings for a canon's entries (the ``embed_canon`` @task)."""
    canon_id: int


class CanonSuggestion(BaseModel):
    """One merge suggestion for a run, given a canon.

    ``add`` — name that doesn't exist in canon; would be added.
    ``already_present`` — name matches an existing canon entity by alias.
    ``conflict`` — name resolves to a different entity than expected.
    """

    keep: str
    names: List[str]
    type: Optional[str] = None
    status: Literal["add", "already_present", "conflict"] = "add"
    matched_entity_id: Optional[int] = None


class CanonSuggestionsResponse(BaseModel):
    add: List[CanonSuggestion] = Field(default_factory=list)
    already_present: List[CanonSuggestion] = Field(default_factory=list)
    conflict: List[CanonSuggestion] = Field(default_factory=list)


# ── KnowledgeGraph ──


class KnowledgeGraphRead(BaseModel):
    """Response schema for KnowledgeGraph."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    infospace_id: int
    canon_id: int
    name: str
    description: Optional[str] = None
    source_config: Dict[str, Any] = {}
    edit_policy: str = "method_only"
    created_at: datetime
    updated_at: datetime


class KnowledgeGraphCreate(BaseModel):
    """Request schema for creating a KnowledgeGraph.

    ``canon_id`` defaults to ``infospace.default_canon_id`` when omitted —
    the General canon every infospace gets. Pass an explicit ``canon_id`` to
    back the graph with a curated canon (e.g., a project-specific vocabulary).
    """

    name: str
    description: Optional[str] = None
    source_config: Optional[Dict[str, Any]] = None
    edit_policy: str = "method_only"
    canon_id: Optional[int] = None


class KnowledgeGraphUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_config: Optional[Dict[str, Any]] = None
    edit_policy: Optional[str] = None


# ── CanonEntry ──


class CanonEntryRead(BaseModel):
    """Response schema for CanonEntry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    external_id: Optional[str] = None
    infospace_id: int
    canon_id: int
    canonical: str
    type: str
    additional_types: List[str] = []
    aliases: List[str] = []
    tags: List[str] = []
    parents: List[str] = []
    embedding_384: Optional[List[float]] = None
    embedding_512: Optional[List[float]] = None
    embedding_768: Optional[List[float]] = None
    embedding_1024: Optional[List[float]] = None
    embedding_1536: Optional[List[float]] = None
    properties: Dict[str, Any] = {}
    provenance_type: str = "method"
    created_at: datetime
    updated_at: datetime


class CanonEntryCreate(BaseModel):
    canonical: str
    type: str
    canon_id: int
    external_id: Optional[str] = None
    additional_types: Optional[List[str]] = None
    aliases: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    parents: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None


class CanonEntryUpdate(BaseModel):
    canonical: Optional[str] = None
    type: Optional[str] = None
    external_id: Optional[str] = None
    additional_types: Optional[List[str]] = None
    aliases: Optional[List[str]] = None
    tags: Optional[List[str]] = None
    parents: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None


class EntityEditLogRead(BaseModel):
    """Response schema for EntityEditLog (audit entries)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    entry_id: int
    action: str
    performed_by: str
    previous_state: Dict[str, Any] = {}
    timestamp: datetime


# ── EntityRelationship ──


class EntityRelationshipRead(BaseModel):
    """A relationship view: derived aggregation + materialized overlay.

    ``edge_count`` and ``predicates`` are computed from GraphEdge groupby.
    The remaining fields come from the materialized EntityRelationship row
    when one exists (LEFT JOIN); they are null/empty otherwise.
    """

    model_config = ConfigDict(from_attributes=True)

    graph_id: int
    entry_a_id: int
    entry_b_id: int
    edge_count: int
    predicates: List[str] = []
    # Materialized overlay (null when no row exists)
    id: Optional[int] = None
    label: Optional[str] = None
    notes: Optional[str] = None
    tags: List[str] = []
    properties: Dict[str, Any] = {}
    is_pinned: bool = False
    is_active: bool = True


class EntityRelationshipUpdate(BaseModel):
    """``PATCH /graphs/{id}/relationships/{a}/{b}`` body — lazy materializes
    the row if absent, then applies the patch. Tags are replaced wholesale
    when provided; pass an empty list to clear them.
    """

    label: Optional[str] = None
    notes: Optional[str] = None
    tags: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None
    is_pinned: Optional[bool] = None


# ── FragmentCuration ──


class FragmentCurationRead(BaseModel):
    """Response schema for FragmentCuration."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    annotation_id: int
    fragment_path: str
    status: str = "curated"
    source_entry_id: Optional[int] = None
    target_entry_id: Optional[int] = None
    entry_id: Optional[int] = None
    source_asset_superseded: bool = False
    source_run_id: Optional[int] = None
    curated_by: Optional[int] = None
    curated_at: datetime


# ── Entity merge / resolution ──


class MergeEntitiesRequest(BaseModel):
    """Request schema for merging entries within a canon."""

    entry_ids: List[int]
    canonical: Optional[str] = None
    keep_id: Optional[int] = None


class RawEntityItem(BaseModel):
    name: str
    type: str


class ResolveEntitiesRequest(BaseModel):
    raw_entities: List[RawEntityItem]
    similarity_threshold: float = 0.85
    use_embeddings: bool = True


class EntityMergeHint(BaseModel):
    """A merge group: names that should resolve to ``keep``.

    Used in the run-scoped graph panel (``run.graph_config.entity_merges``)
    AND as input for canon-extend / from-merges seeding paths. The shape is
    identical; the difference is lifecycle (transient run hints vs. persistent
    canon entries).
    """

    keep: str
    names: List[str]
    type: Optional[str] = None


CanonCreate.model_rebuild()


class CurateFragmentsRequest(BaseModel):
    fragment_paths: List[str]
    graph_id: Optional[int] = None
    entity_merges: Optional[List[EntityMergeHint]] = None
    status: str = "curated"


# ── Resolution proposals (user-invocable scan task) ──────────────────────────


class ProposeResolutionsParams(BaseModel):
    """Parameters for the ``propose_resolutions`` ``@task``.

    Scans entities and/or predicates for similarity-based merge candidates.
    No side-effects — proposals stream via ``ctx.send``; the user submits
    accepted merges via existing routes (``/canons/{id}/action/merge-entities``
    for entities, ``/knowledge-graphs/{iid}/predicates/rename`` for predicates).

    Targets:
    - ``entities``: requires ``canon_id``. Scans entities in the canon for
      embedding-similar pairs of the same type.
    - ``predicates``: requires ``graph_id`` (or scoped to whole infospace if
      omitted). Scans distinct predicate strings on GraphEdges for embedding-
      similar pairs.
    - ``both``: runs both passes; each requires its own scope.
    """
    target: Literal["entities", "predicates", "both"] = "entities"
    canon_id: Optional[int] = None
    graph_id: Optional[int] = None
    threshold: float = 0.85
    entity_type_filter: Optional[List[str]] = None
    max_proposals: int = 100


class ResolutionProposal(BaseModel):
    """One merge proposal — same shape regardless of target."""
    kind: Literal["entity", "predicate"]
    keep: str
    keep_id: Optional[int] = None
    candidates: List[str]
    candidate_ids: List[int] = Field(default_factory=list)
    similarity: float
    type: Optional[str] = None


# ── Deduplication ────────────────────────────────────────────────────────────


class FindDuplicatesRequest(BaseModel):
    items: List[str]
    threshold: float = 0.85


class SimilarPairRead(BaseModel):
    a_index: int
    b_index: int
    a_item: str
    b_item: str
    similarity: float


class FindDuplicatesResponse(BaseModel):
    pairs: List[SimilarPairRead]
    items_count: int
    unique_count: int


# ── Predicate / entity-type management ───────────────────────────────────────


class PredicateSummary(BaseModel):
    predicate: str
    count: int


class EntityTypeSummary(BaseModel):
    entity_type: str
    count: int


class RenamePredicateRequest(BaseModel):
    old_predicates: List[str]
    new_predicate: str
    graph_id: Optional[int] = None


class RenameEntityTypeRequest(BaseModel):
    old_types: List[str]
    new_type: str
    graph_id: Optional[int] = None


# ── Deletion preview/confirm — mirrors content/tree.py:178 idiom ──


class DeleteImpact(BaseModel):
    """Cascade impact of a delete operation.

    Returned by ``POST /{resource}/{id}/action/delete`` with ``confirm=False``
    (preview) and again with ``confirm=True`` (post-execution). When
    ``can_proceed`` is False, ``blockers`` lists human-readable reasons; the
    caller must resolve them (reassign, merge, unset default) before re-trying.

    Annotations, assets, and schemas always survive — we never destroy source
    data. ``affected_annotations`` is informational only.
    """

    can_proceed: bool
    blockers: List[str] = Field(default_factory=list)
    cascaded_entities: int = 0
    cascaded_edges: int = 0
    cascaded_curations: int = 0
    cascaded_relationships: int = 0
    affected_annotations: int = 0
    confirmed: bool = False


class DeleteRequest(BaseModel):
    """Body for any ``/action/delete`` route."""

    confirm: bool = False
