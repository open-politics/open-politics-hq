"""Graph domain models.

Primitives:
- ``Canon``: an infospace-scoped, portable vocabulary. Multiple canons per
  infospace; the same canon can back multiple graphs. Every ``CanonEntry``
  belongs to exactly one canon. A canon points OUT to nothing — it carries no
  back-references — so it can be serialized, diffed, shipped, and imported as a
  file (``external_id`` makes import-merge deterministic).
- ``CanonEntry`` (table ``canon_entry``; was ``Entity`` / ``EntityCanonical``):
  a member of a Canon — the unit of resolved identity, generalized so the same
  row carries everything from a bare value to a typed, hierarchical entity.
  ``type`` is the primary type used for resolution matching; ``additional_types``
  carries multi-type enrichment; ``parents`` is a same-canon DAG of portable
  refs (containment OR subclass); ``properties`` is the free-form open bag.
- ``EntityRelationship``: sparse, per-pair, materialized only when users pin
  / tag / annotate. Pair-canonical (``entry_a_id < entry_b_id`` enforced).
  Tombstone via ``is_active`` so user notes survive when evidence disappears.
- ``KnowledgeGraph``: backed by exactly one Canon. Triplets resolve into the
  canon; the graph's edges (``GraphEdge`` rows) reference its entries.
- ``GraphEdge``: per-triplet evidence row. Direction matters here —
  ``source_entry_id`` / ``target_entry_id`` are graph-theory neutral terms.
  LLM-facing triplet JSON keeps ``subject_name``/``object_name`` (translation
  happens in ``tasks/curation.py``).
- ``FragmentCuration``: provenance link from annotation fragment to entries.
- ``EntityEditLog``: audit trail for manual entry edits.
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import (
    Column, Index, JSON, CheckConstraint, UniqueConstraint, Text, text,
)
from pgvector.sqlalchemy import Vector

from app.api.modules.identity_infospace_user.models import User, Infospace
from app.api.modules.annotation.models import Annotation


class Canon(SQLModel, table=True):
    """A canonical, portable vocabulary. Entries are its members.

    Multiple KnowledgeGraphs can share one canon. The infospace gets a
    "General" canon at creation; users can create project-specific or archival
    canons on demand. ``external_id`` (e.g. ``naturalearth:admin0``) makes
    import-merge deterministic; ``tags`` group/sort canons in the workbench.
    Geo is not a role — it is entries carrying geo ``properties``; the
    infospace keeps a ``default_geo_canon_id`` pointer for the geocode hook.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        unique=True, index=True,
    )
    external_id: Optional[str] = Field(default=None, index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    name: str
    description: Optional[str] = None
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    # Per-type property-shape declarations: ``{type_name: [{name, type,
    # description, required}]}``. Portable (travels in the canon export) and
    # *guidance, not a gate* — entries keep a free-form ``properties`` bag, so
    # undeclared types and extra keys are always allowed. This only tells the
    # workbench which typed inputs to render for an entry of a given ``type``.
    type_schemas: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )

    # FK ambiguity: Infospace has two FKs back to Canon (default_canon_id,
    # default_geo_canon_id). Specify which FK this relationship traverses.
    infospace: Optional[Infospace] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Canon.infospace_id]"},
    )

    __table_args__ = (
        Index("ix_canon_tags", "tags", postgresql_using="gin"),
    )


class KnowledgeGraph(SQLModel, table=True):
    """Named knowledge graph per infospace. Backed by exactly one Canon."""
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    canon_id: int = Field(foreign_key="canon.id", index=True)
    name: str
    description: Optional[str] = None
    source_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    edit_policy: str = Field(default="method_only")  # "method_only" | "editable"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
    infospace: Optional[Infospace] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[KnowledgeGraph.infospace_id]"},
    )
    canon: Optional[Canon] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[KnowledgeGraph.canon_id]"},
    )

    __table_args__ = (
        Index("ix_knowledge_graph_infospace", "infospace_id"),
        Index("ix_knowledge_graph_canon", "canon_id"),
    )


class CanonEntry(SQLModel, table=True):
    """A member of a Canon — the unit of resolved identity, generalized.

    Table ``canon_entry`` (was ``entity`` / ``entitycanonical``). ``canon_id``
    is membership; an entry belongs to a Canon (the vocabulary), not directly
    to a graph. Multiple graphs that reference the same canon share entries
    through GraphEdges.

    The same row carries everything from a bare value fold (``canonical`` +
    ``aliases``) to a geocoded, term-bearing entity — the difference is how
    full ``properties`` is, not which table it lives in.

    - ``type`` is the primary type, used as the resolution matching key.
      ``additional_types`` carries multi-type enrichment for queries / display.
    - ``external_id`` (e.g. ``wikidata:Q183``) is a stable key for deterministic
      import-merge and soft cross-canon refs (a string, not an FK).
    - ``parents`` is a same-canon DAG of **portable refs** (other entries'
      ``external_id`` or ``uuid`` strings, never FKs) expressing containment OR
      subclass. No traversal in phase 2.
    - Embeddings stay six fixed pgvector columns (per-provider, per-dim,
      Matryoshka-truncatable, each its own HNSW index) — local-only, never
      portable, recomputed on import.
    """
    __tablename__ = "canon_entry"

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    external_id: Optional[str] = Field(default=None, index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    canon_id: int = Field(foreign_key="canon.id", index=True)
    canonical: str
    type: str
    additional_types: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    aliases: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    parents: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    embedding_384: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(384)))
    embedding_512: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(512)))
    embedding_768: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(768)))
    embedding_1024: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1024)))
    embedding_1536: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1536)))
    embedding_2048: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(2048)))
    properties: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    provenance_type: str = Field(default="method")  # "method" | "manual"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
    infospace: Optional[Infospace] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[CanonEntry.infospace_id]"},
    )
    canon: Optional[Canon] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[CanonEntry.canon_id]"},
    )

    __table_args__ = (
        Index("ix_canon_entry_infospace_type", "infospace_id", "type"),
        Index("ix_canon_entry_canon_type", "canon_id", "type"),
        Index("ix_canon_entry_additional_types", "additional_types", postgresql_using="gin"),
        Index("ix_canon_entry_tags", "tags", postgresql_using="gin"),
        Index("ix_canon_entry_embedding_384", "embedding_384", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_384 IS NOT NULL")),
        Index("ix_canon_entry_embedding_512", "embedding_512", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_512 IS NOT NULL")),
        Index("ix_canon_entry_embedding_768", "embedding_768", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_768 IS NOT NULL")),
        Index("ix_canon_entry_embedding_1024", "embedding_1024", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1024 IS NOT NULL")),
        Index("ix_canon_entry_embedding_1536", "embedding_1536", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1536 IS NOT NULL")),
        # No HNSW index for 2048 — pgvector caps HNSW at 2000 dims.
    )


class EntityEditLog(SQLModel, table=True):
    """Audit log for manual edits to canon entries."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_id: int = Field(foreign_key="canon_entry.id", index=True)
    action: str  # "create", "merge", "rename", "add_alias", "update_properties", "add_type"
    performed_by: str  # "resolution:alias", "resolution:embedding", "user:42"
    previous_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EntityRelationship(SQLModel, table=True):
    """A user-materialized relationship between two entries within a graph.

    Sparse: most relationships are derived from groupby(GraphEdge) at query
    time. A row exists here only when a user has pinned, tagged, or annotated
    the relationship — lazy materialization.

    Pair-canonical: ``entry_a_id < entry_b_id`` is enforced at the DB level.
    One row per pair regardless of edge direction. Direction lives on
    GraphEdge (source/target); this aggregate is direction-agnostic. Routes
    accept ``(a, b)`` in any order and normalize via ``_normalize_pair``
    before lookup/insert.

    Tombstone: when the last contributing GraphEdge is removed, the row stays
    with ``is_active=False`` so user notes survive. Re-curating reactivates.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    entry_a_id: int = Field(foreign_key="canon_entry.id", index=True)
    entry_b_id: int = Field(foreign_key="canon_entry.id", index=True)
    graph_id: int = Field(foreign_key="knowledgegraph.id", index=True)
    label: Optional[str] = Field(default=None, max_length=128)
    notes: Optional[str] = Field(default=None, sa_column=Column(Text))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    properties: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    is_pinned: bool = Field(default=False, index=True)
    is_active: bool = Field(default=True)
    created_by: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )

    __table_args__ = (
        UniqueConstraint("graph_id", "entry_a_id", "entry_b_id", name="uq_entityrelationship_pair"),
        CheckConstraint("entry_a_id < entry_b_id", name="ck_entityrelationship_canonical_order"),
        Index("ix_entityrelationship_graph_a", "graph_id", "entry_a_id"),
        Index("ix_entityrelationship_graph_b", "graph_id", "entry_b_id"),
        Index("ix_entityrelationship_tags", "tags", postgresql_using="gin"),
    )


class GraphEdge(SQLModel, table=True):
    """Materialized edge from triplet curation. Per-triplet evidence row.

    Direction matters: each row represents one directed statement. The
    column names are graph-theory neutral (``source_entry_id`` /
    ``target_entry_id``); the LLM-facing triplet JSON keeps the original
    ``subject_name`` / ``object_name`` keys, and translation happens in
    ``tasks/curation.py``.

    ``source_field_path`` records which schema field produced this edge
    (e.g. ``"document.loose_relationships"`` vs ``"document.licensing_assessments"``)
    so multi-graph-field schemas can split or unify the rendering at
    inspection time via ``edge_group_by``. Legacy edges curated before this
    column existed get backfilled to ``"triplets"`` to preserve provenance.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_entry_id: int = Field(foreign_key="canon_entry.id", index=True)
    target_entry_id: int = Field(foreign_key="canon_entry.id", index=True)
    predicate: Optional[str] = None
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    graph_id: Optional[int] = Field(default=None, foreign_key="knowledgegraph.id", index=True)
    source_field_path: Optional[str] = Field(default=None, index=True)

    __table_args__ = (
        Index("ix_graph_edge_graph_source", "graph_id", "source_entry_id"),
        Index("ix_graph_edge_graph_target", "graph_id", "target_entry_id"),
        Index("ix_graph_edge_graph_field", "graph_id", "source_field_path"),
    )


class FragmentCuration(SQLModel, table=True):
    """Curation provenance for an annotation fragment.

    Tracks which annotation fragment produced which entry bindings. Source/
    target mirror GraphEdge naming for triplet-shaped fragments; ``entry_id``
    is used for single-entry fragments (e.g., a Top-level entity list).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    fragment_path: str
    status: str = Field(default="curated")
    source_entry_id: Optional[int] = Field(default=None, foreign_key="canon_entry.id", index=True)
    target_entry_id: Optional[int] = Field(default=None, foreign_key="canon_entry.id", index=True)
    entry_id: Optional[int] = Field(default=None, foreign_key="canon_entry.id", index=True)
    source_asset_superseded: bool = Field(default=False)
    source_run_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    curated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    curated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    annotation: Optional["Annotation"] = Relationship()
    curator: Optional[User] = Relationship()

    __table_args__ = (
        Index("ix_fragment_curation_annotation_path", "annotation_id", "fragment_path"),
    )


class CanonProposal(SQLModel, table=True):
    """A staged, human-confirmed resolution proposal for "resolve into canon" mode.

    When a run in ``resolve_into_canon`` mode hits a mention that doesn't settle
    (no exact/alias match in the canon), curation stages it here instead of
    auto-creating — preserving the canon's "never auto-created" invariant. A human
    accepts (merge the surface into a suggested existing entry, or create a new
    entry) which *settles* it so it auto-applies next time, or dismisses it.

    Distinct from the ephemeral Pydantic ``ResolutionProposal`` (the SSE dedupe
    stream): this is **persistent**, because a live run stages proposals over time
    when no one is watching a stream.

    Deduped on ``(canon_id, type, normalized_surface)`` — a repeated unmatched
    surface bumps ``occurrence_count`` (and appends a capped example annotation id)
    rather than inserting a new row. ``accepted`` / ``dismissed`` rows never flip
    back to ``pending``.
    """
    __tablename__ = "canon_proposal"

    id: Optional[int] = Field(default=None, primary_key=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    canon_id: int = Field(foreign_key="canon.id", index=True)
    run_id: Optional[int] = Field(default=None, foreign_key="annotationrun.id", index=True)
    surface: str                                   # raw mention as seen
    normalized_surface: str                        # lower/trim — the dedup key
    type: str                                      # entity type the mention carried
    status: str = Field(default="pending")         # pending | accepted | dismissed
    suggested_entry_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    occurrence_count: int = Field(default=1)
    example_annotation_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
    resolved_at: Optional[datetime] = Field(default=None)
    resolved_by: Optional[int] = Field(default=None, foreign_key="user.id")

    __table_args__ = (
        UniqueConstraint("canon_id", "type", "normalized_surface", name="uq_canon_proposal_surface"),
        Index("ix_canon_proposal_canon_status", "canon_id", "status"),
    )
