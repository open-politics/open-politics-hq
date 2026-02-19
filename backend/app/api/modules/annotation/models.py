"""Annotation domain models: AnnotationSchema, AnnotationRun, Annotation, Justification."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON, Text, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB

from app.api.identity.models import User, Infospace
from app.api.content.models import Asset, Bundle


# ─── Annotation enums ───

class RunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"


class ResultStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"


class RunType(str, enum.Enum):
    ONE_OFF = "one_off"
    FLOW_STEP = "flow_step"


class AnnotationRunTrigger(str, enum.Enum):
    MANUAL = "manual"
    SOURCE_POLL = "source_poll"
    FLOW_STEP = "flow_step"
    API = "api"


class AnnotationSchemaTargetLevel(str, enum.Enum):
    ASSET = "asset"
    CHILD = "child"
    BOTH = "both"


# ─── Annotation schema ───

class AnnotationSchema(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    output_contract: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    instructions: Optional[str] = Field(default=None, sa_column=Column(Text))
    version: str = Field(default="1.0")
    field_specific_justification_configs: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    is_active: bool = Field(default=True, index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="schemas")
    user: Optional[User] = Relationship(back_populates="schemas")
    annotations: List["Annotation"] = Relationship(back_populates="schema")

    __table_args__ = (
        Index(
            "ix_unique_active_schema_name_version",
            "infospace_id", "name", "version",
            unique=True,
            postgresql_where=text("is_active = true")
        ),
    )


class RunSchemaLink(SQLModel, table=True):
    run_id: Optional[int] = Field(foreign_key="annotationrun.id", primary_key=True)
    schema_id: Optional[int] = Field(foreign_key="annotationschema.id", primary_key=True)


class AnnotationRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: RunStatus = RunStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    include_parent_context: bool = Field(default=False)
    context_window: int = Field(default=0)
    views_config: Optional[List[Dict[str, Any]]] = Field(default_factory=list, sa_column=Column(JSONB))
    run_type: RunType = Field(default=RunType.ONE_OFF)
    flow_execution_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    trigger_type: str = Field(default="manual")
    trigger_context: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    source_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)
    graph_config: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))

    infospace: Optional[Infospace] = Relationship(back_populates="runs")
    user: Optional[User] = Relationship(back_populates="runs")
    flow_execution: Optional["FlowExecution"] = Relationship(
        back_populates="annotation_runs",
        sa_relationship_kwargs={"foreign_keys": "[AnnotationRun.flow_execution_id]"}
    )
    target_schemas: List["AnnotationSchema"] = Relationship(link_model=RunSchemaLink)
    annotations: List["Annotation"] = Relationship(back_populates="run")


class Annotation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    asset_id: int = Field(foreign_key="asset.id")
    schema_id: int = Field(foreign_key="annotationschema.id")
    run_id: int = Field(foreign_key="annotationrun.id")
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    value: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    status: ResultStatus = ResultStatus.SUCCESS
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    region: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    links: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    asset: Optional[Asset] = Relationship(back_populates="annotations")
    run: Optional[AnnotationRun] = Relationship(back_populates="annotations")
    schema: Optional[AnnotationSchema] = Relationship(back_populates="annotations")
    infospace: Optional[Infospace] = Relationship(back_populates="annotations")
    user: Optional[User] = Relationship(back_populates="annotations")
    justifications: List["Justification"] = Relationship(back_populates="annotation")

    __table_args__ = (
        UniqueConstraint("asset_id", "schema_id", "run_id", "uuid"),
        Index("ix_annotation_value", "value", postgresql_using="gin", postgresql_ops={"value": "jsonb_path_ops"}),
    )


class Justification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id")
    field_name: Optional[str] = Field(default=None)
    reasoning: Optional[str] = Field(default=None, sa_column=Column(Text))
    evidence_payload: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    model_name: Optional[str] = Field(default=None)
    score: Optional[float] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    annotation: Optional[Annotation] = Relationship(back_populates="justifications")

    __table_args__ = (
        Index("ix_justification_annotation_field", "annotation_id", "field_name"),
    )


class RunAggregate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="annotationrun.id")
    field_path: str
    value_kind: str
    sketch_kind: str
    payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_runaggregate_payload", "payload", postgresql_using="gin", postgresql_ops={"payload": "jsonb_path_ops"}),
        Index("ix_runaggregate_run_field", "run_id", "field_path"),
    )
