"""Graph domain models: KnowledgeGraph, EntityCanonical, EntityEditLog, GraphEdge, FragmentCuration."""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON, text
from pgvector.sqlalchemy import Vector

from app.api.modules.identity_infospace_user.models import User, Infospace
from app.api.modules.annotation.models import Annotation


class KnowledgeGraph(SQLModel, table=True):
    """Named knowledge graph per infospace. Multiple graphs per infospace supported."""
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    name: str
    description: Optional[str] = None
    source_config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    edit_policy: str = Field(default="method_only")  # "method_only" | "editable"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
    infospace: Optional[Infospace] = Relationship()

    __table_args__ = (
        Index("ix_knowledge_graph_infospace", "infospace_id"),
    )


class EntityEditLog(SQLModel, table=True):
    """Audit log for manual edits to canonical entities."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_canonical_id: int = Field(foreign_key="entitycanonical.id", index=True)
    action: str  # "create", "merge", "rename", "add_alias", "update_properties"
    performed_by: str  # "resolution:alias", "resolution:embedding", "user:42"
    previous_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class EntityCanonical(SQLModel, table=True):
    """Canonical entity for resolution at infospace or graph level."""
    id: Optional[int] = Field(default=None, primary_key=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    graph_id: Optional[int] = Field(default=None, foreign_key="knowledgegraph.id", index=True)
    canonical_name: str
    entity_type: str
    aliases: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    embedding_384: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(384)))
    embedding_512: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(512)))
    embedding_768: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(768)))
    embedding_1024: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1024)))
    embedding_1536: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1536)))
    properties: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    provenance_type: str = Field(default="method")  # "method" | "manual"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
    infospace: Optional[Infospace] = Relationship()
    graph: Optional[KnowledgeGraph] = Relationship()

    __table_args__ = (
        Index("ix_entity_canonical_infospace_type", "infospace_id", "entity_type"),
        Index("ix_entity_canonical_graph", "graph_id"),
        Index("ix_entitycanonical_embedding_384", "embedding_384", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_384 IS NOT NULL")),
        Index("ix_entitycanonical_embedding_512", "embedding_512", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_512 IS NOT NULL")),
        Index("ix_entitycanonical_embedding_768", "embedding_768", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_768 IS NOT NULL")),
        Index("ix_entitycanonical_embedding_1024", "embedding_1024", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1024 IS NOT NULL")),
        Index("ix_entitycanonical_embedding_1536", "embedding_1536", postgresql_using="hnsw",
              postgresql_with={"m": 16, "ef_construction": 64},
              postgresql_where=text("embedding_1536 IS NOT NULL")),
    )


class GraphEdge(SQLModel, table=True):
    """Materialized edge from triplet curation. Enables O(1) traversal instead of O(N) annotation scan."""
    id: Optional[int] = Field(default=None, primary_key=True)
    subject_entity_id: int = Field(foreign_key="entitycanonical.id", index=True)
    object_entity_id: int = Field(foreign_key="entitycanonical.id", index=True)
    predicate: Optional[str] = None
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    graph_id: Optional[int] = Field(default=None, foreign_key="knowledgegraph.id", index=True)

    __table_args__ = (
        Index("ix_graph_edge_infospace_subject", "infospace_id", "subject_entity_id"),
        Index("ix_graph_edge_infospace_object", "infospace_id", "object_entity_id"),
    )


class FragmentCuration(SQLModel, table=True):
    """Curation metadata for an annotation fragment."""
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    fragment_path: str
    status: str = Field(default="curated")
    subject_entity_id: Optional[int] = Field(default=None, foreign_key="entitycanonical.id", index=True)
    object_entity_id: Optional[int] = Field(default=None, foreign_key="entitycanonical.id", index=True)
    entity_canonical_id: Optional[int] = Field(default=None, foreign_key="entitycanonical.id", index=True)
    source_asset_superseded: bool = Field(default=False)
    source_run_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    curated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    curated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    annotation: Optional["Annotation"] = Relationship()
    curator: Optional[User] = Relationship()

    __table_args__ = (
        Index("ix_fragment_curation_annotation_path", "annotation_id", "fragment_path"),
    )
