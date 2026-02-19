"""Graph domain models: EntityCanonical, FragmentCuration."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON

from app.api.identity.models import User, Infospace
from app.api.annotation.models import Annotation


class EntityCanonical(SQLModel, table=True):
    """Canonical entity for resolution at infospace level."""
    id: Optional[int] = Field(default=None, primary_key=True)
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    canonical_name: str
    entity_type: str
    aliases: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(JSON))
    properties: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)}
    )
    infospace: Optional[Infospace] = Relationship()

    __table_args__ = (
        Index("ix_entity_canonical_infospace_type", "infospace_id", "entity_type"),
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
