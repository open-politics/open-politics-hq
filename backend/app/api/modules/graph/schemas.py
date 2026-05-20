"""Graph domain Pydantic schemas for API responses and OpenAPI generation."""

from datetime import datetime
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


# ── Graph data items (shared by ephemeral annotation graph + persistent graph) ──


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
    source_annotation_ids: list[int] = Field(default_factory=list)
    entity_id: int | None = None
    group_value: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
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
    weight: int
    computed_weight: float | None = None
    group_value: str | None = None
    properties: dict[str, Any] = Field(default_factory=dict)
    evidence: list[dict[str, Any]] = Field(default_factory=list)


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


class CanonRead(BaseModel):
    """Response schema for Canon."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    infospace_id: int
    name: str
    description: Optional[str] = None
    role: str = "general"
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
    role: Literal["general", "geo"] = "general"
    from_run: Optional[int] = None
    from_merges: Optional[List["EntityMergeHint"]] = None


class CanonUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    role: Optional[Literal["general", "geo"]] = None


class ExtendCanonRequest(BaseModel):
    """``POST /canons/{id}/action/extend`` body: pull a run's merge entries
    into this canon. The run's ``graph_config.entity_merges`` is read-only
    (transient) — entries are materialized as Entity rows under this canon.
    """

    run_id: int


class CanonExtendResponse(BaseModel):
    added: int
    skipped: int
    entries: List[Dict[str, Any]] = Field(default_factory=list)


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


# ── Entity ──


class EntityRead(BaseModel):
    """Response schema for Entity."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    infospace_id: int
    canon_id: int
    canonical_name: str
    entity_type: str
    additional_types: List[str] = []
    aliases: List[str] = []
    embedding_384: Optional[List[float]] = None
    embedding_512: Optional[List[float]] = None
    embedding_768: Optional[List[float]] = None
    embedding_1024: Optional[List[float]] = None
    embedding_1536: Optional[List[float]] = None
    properties: Dict[str, Any] = {}
    provenance_type: str = "method"
    created_at: datetime
    updated_at: datetime


class EntityCreate(BaseModel):
    canonical_name: str
    entity_type: str
    canon_id: int
    additional_types: Optional[List[str]] = None
    aliases: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None


class EntityUpdate(BaseModel):
    canonical_name: Optional[str] = None
    additional_types: Optional[List[str]] = None
    aliases: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None


class EntityEditLogRead(BaseModel):
    """Response schema for EntityEditLog (audit entries)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_id: int
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
    entity_a_id: int
    entity_b_id: int
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
    source_entity_id: Optional[int] = None
    target_entity_id: Optional[int] = None
    entity_id: Optional[int] = None
    source_asset_superseded: bool = False
    source_run_id: Optional[int] = None
    curated_by: Optional[int] = None
    curated_at: datetime


# ── Entity merge / resolution ──


class MergeEntitiesRequest(BaseModel):
    """Request schema for merging entities within a canon."""

    entity_ids: List[int]
    canonical_name: Optional[str] = None
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


# ── Deletion preview/confirm — mirrors core/tree.py:178 idiom ──


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
