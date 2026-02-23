"""Graph domain models: KnowledgeGraph, EntityCanonical, EntityEditLog, FragmentCuration."""

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON
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
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(JSON))  # Legacy; prefer embedding_768
    embedding_768: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(768)))
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
    )


class FragmentCuration(SQLModel, table=True):
    """Curation metadata for an annotation fragment."""
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id", index=True)
    fragment_path: str
    status: str = Field(default="curated")
    resolved_refs: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    curated_by: Optional[int] = Field(default=None, foreign_key="user.id")
    curated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    annotation: Optional["Annotation"] = Relationship()
    curator: Optional[User] = Relationship()

    __table_args__ = (
        Index("ix_fragment_curation_annotation_path", "annotation_id", "fragment_path"),
    )
