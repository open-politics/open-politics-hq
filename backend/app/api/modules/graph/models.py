"""Graph domain models.

Primitives:
- ``Canon``: an infospace-scoped vocabulary. Multiple canons per infospace; the
  same canon can back multiple graphs. Every Entity belongs to exactly one canon.
- ``Entity`` (renamed from ``EntityCanonical``): a member of a Canon.
  ``entity_type`` is the primary type used for resolution matching;
  ``additional_types`` carries multi-type enrichment for queries and display.
- ``EntityRelationship``: sparse, per-pair, materialized only when users pin
  / tag / annotate. Pair-canonical (``entity_a_id < entity_b_id`` enforced).
  Tombstone via ``is_active`` so user notes survive when evidence disappears.
- ``KnowledgeGraph``: backed by exactly one Canon. Triplets resolve into the
  canon; the graph's edges (``GraphEdge`` rows) reference its entities.
- ``GraphEdge``: per-triplet evidence row. Direction matters here —
  ``source_entity_id`` / ``target_entity_id`` are graph-theory neutral terms.
  LLM-facing triplet JSON keeps ``subject_name``/``object_name`` (translation
  happens in ``tasks/curation.py``).
- ``FragmentCuration``: provenance link from annotation fragment to entities.
- ``EntityEditLog``: audit trail for manual entity edits.
"""

import enum
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


class CanonRole(str, enum.Enum):
    """Semantic purpose of a canon.

    ``general`` is the default vocabulary every infospace gets at creation.
    ``geo`` is reserved for geocoding lookup (``Infospace.default_geo_canon_id``);
    structure-ready, behavior wired in a follow-up. The enum is extensible
    via additional values — no schema change required.
    """
    GENERAL = "general"
    GEO = "geo"


class Canon(SQLModel, table=True):
    """A canonical vocabulary. Entities are its members.

    Multiple KnowledgeGraphs can share one canon. The infospace gets a
    "General" canon at creation; users can create role-specific canons
    (geo, project-specific, archival) on demand.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        unique=True, index=True,
    )
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    name: str
    description: Optional[str] = None
    role: CanonRole = Field(default=CanonRole.GENERAL, index=True)
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
        Index("ix_canon_infospace_role", "infospace_id", "role"),
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


class Entity(SQLModel, table=True):
    """A member of a Canon. The unit of resolved identity.

    Replaces ``EntityCanonical``. ``graph_id`` is gone — Entity belongs to a
    Canon (the vocabulary), not directly to a graph. Multiple graphs that
    reference the same canon share entities through GraphEdges.

    ``entity_type`` is the primary type, used as the resolution matching key.
    ``additional_types`` carries user/system enrichment for queries and
    display — real-world entities are multi-typed (Person + Politician + Author).
    """
    __tablename__ = "entity"

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    canon_id: int = Field(foreign_key="canon.id", index=True)
    canonical_name: str
    entity_type: str
    additional_types: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    aliases: List[str] = Field(default_factory=list, sa_column=Column(JSON))
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
        sa_relationship_kwargs={"foreign_keys": "[Entity.infospace_id]"},
    )
    canon: Optional[Canon] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[Entity.canon_id]"},
    )

    __table_args__ = (
        Index("ix_entity_infospace_type", "infospace_id", "entity_type"),
        Index("ix_entity_canon_type", "canon_id", "entity_type"),
        Index("ix_entity_additional_types", "additional_types", postgresql_using="gin"),
        Index("ix_entity_embedding_384", "embedding_384", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_384 IS NOT NULL")),
        Index("ix_entity_embedding_512", "embedding_512", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_512 IS NOT NULL")),
        Index("ix_entity_embedding_768", "embedding_768", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_768 IS NOT NULL")),
        Index("ix_entity_embedding_1024", "embedding_1024", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1024 IS NOT NULL")),
        Index("ix_entity_embedding_1536", "embedding_1536", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1536 IS NOT NULL")),
        # No HNSW index for 2048 — pgvector caps HNSW at 2000 dims.
    )


class EntityEditLog(SQLModel, table=True):
    """Audit log for manual edits to entities."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_id: int = Field(foreign_key="entity.id", index=True)
    action: str  # "create", "merge", "rename", "add_alias", "update_properties", "add_type"
    performed_by: str  # "resolution:alias", "resolution:embedding", "user:42"
    previous_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EntityRelationship(SQLModel, table=True):
    """A user-materialized relationship between two entities within a graph.

    Sparse: most relationships are derived from groupby(GraphEdge) at query
    time. A row exists here only when a user has pinned, tagged, or annotated
    the relationship — lazy materialization.

    Pair-canonical: ``entity_a_id < entity_b_id`` is enforced at the DB level.
    One row per pair regardless of edge direction. Direction lives on
    GraphEdge (source/target); this aggregate is direction-agnostic. Routes
    accept ``(a, b)`` in any order and normalize via ``_normalize_pair``
    before lookup/insert.

    Tombstone: when the last contributing GraphEdge is removed, the row stays
    with ``is_active=False`` so user notes survive. Re-curating reactivates.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_a_id: int = Field(foreign_key="entity.id", index=True)
    entity_b_id: int = Field(foreign_key="entity.id", index=True)
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
        UniqueConstraint("graph_id", "entity_a_id", "entity_b_id", name="uq_entityrelationship_pair"),
        CheckConstraint("entity_a_id < entity_b_id", name="ck_entityrelationship_canonical_order"),
        Index("ix_entityrelationship_graph_a", "graph_id", "entity_a_id"),
        Index("ix_entityrelationship_graph_b", "graph_id", "entity_b_id"),
        Index("ix_entityrelationship_tags", "tags", postgresql_using="gin"),
    )


class GraphEdge(SQLModel, table=True):
    """Materialized edge from triplet curation. Per-triplet evidence row.

    Direction matters: each row represents one directed statement. The
    column names are graph-theory neutral (``source_entity_id`` /
    ``target_entity_id``); the LLM-facing triplet JSON keeps the original
    ``subject_name`` / ``object_name`` keys, and translation happens in
    ``tasks/curation.py``.

    ``source_field_path`` records which schema field produced this edge
    (e.g. ``"document.loose_relationships"`` vs ``"document.licensing_assessments"``)
    so multi-graph-field schemas can split or unify the rendering at
    inspection time via ``edge_group_by``. Legacy edges curated before this
    column existed get backfilled to ``"triplets"`` to preserve provenance.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    source_entity_id: int = Field(foreign_key="entity.id", index=True)
    target_entity_id: int = Field(foreign_key="entity.id", index=True)
    predicate: Optional[str] = None
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    graph_id: Optional[int] = Field(default=None, foreign_key="knowledgegraph.id", index=True)
    source_field_path: Optional[str] = Field(default=None, index=True)

    __table_args__ = (
        Index("ix_graph_edge_graph_source", "graph_id", "source_entity_id"),
        Index("ix_graph_edge_graph_target", "graph_id", "target_entity_id"),
        Index("ix_graph_edge_graph_field", "graph_id", "source_field_path"),
    )


class FragmentCuration(SQLModel, table=True):
    """Curation provenance for an annotation fragment.

    Tracks which annotation fragment produced which entity bindings. Source/
    target mirror GraphEdge naming for triplet-shaped fragments; ``entity_id``
    is used for single-entity fragments (e.g., a Top-level entity list).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    fragment_path: str
    status: str = Field(default="curated")
    source_entity_id: Optional[int] = Field(default=None, foreign_key="entity.id", index=True)
    target_entity_id: Optional[int] = Field(default=None, foreign_key="entity.id", index=True)
    entity_id: Optional[int] = Field(default=None, foreign_key="entity.id", index=True)
    source_asset_superseded: bool = Field(default=False)
    source_run_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    curated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    curated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    annotation: Optional["Annotation"] = Relationship()
    curator: Optional[User] = Relationship()

    __table_args__ = (
        Index("ix_fragment_curation_annotation_path", "annotation_id", "fragment_path"),
    )
