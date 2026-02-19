"""Flow domain models: Flow, FlowExecution, Task."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON, Text
from sqlalchemy.dialects.postgresql import JSONB

from app.api.modules.identity_infospace_user.models import User, Infospace
from app.api.modules.content.models import Source, Bundle
from app.api.modules.annotation.models import AnnotationRun, RunStatus


# ─── Flow enums ───

class FlowStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"


class FlowInputType(str, enum.Enum):
    STREAM = "stream"
    BUNDLE = "bundle"
    MANUAL = "manual"


class FlowTriggerMode(str, enum.Enum):
    ON_ARRIVAL = "on_arrival"
    SCHEDULED = "scheduled"
    MANUAL = "manual"


class FlowStepType(str, enum.Enum):
    ANNOTATE = "ANNOTATE"
    FILTER = "FILTER"
    CURATE = "CURATE"
    ROUTE = "ROUTE"
    EMBED = "EMBED"
    ANALYZE = "ANALYZE"


class TaskType(str, enum.Enum):
    INGEST = "ingest"
    ANNOTATE = "annotate"
    PIPELINE = "pipeline"
    MONITOR = "monitor"
    FLOW = "flow"
    SOURCE_POLL = "source_poll"
    EMBED = "embed"
    BACKUP = "backup"
    CUSTOM = "custom"


class TaskStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"


# ─── Task ───

class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    type: TaskType
    schedule: str
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: TaskStatus = TaskStatus.PAUSED
    is_enabled: bool = Field(default=True)
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    last_run_at: Optional[datetime] = None
    last_successful_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = Field(default=None)
    last_run_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    consecutive_failure_count: int = Field(default=0)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="tasks")
    user: Optional[User] = Relationship(back_populates="tasks")
    source: Optional[Source] = Relationship(back_populates="monitoring_tasks")


# ─── Flow ───

class Flow(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    status: FlowStatus = Field(default=FlowStatus.DRAFT)
    input_type: FlowInputType = Field(default=FlowInputType.BUNDLE)
    input_source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    input_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id")
    steps: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB))
    trigger_mode: FlowTriggerMode = Field(default=FlowTriggerMode.MANUAL)
    linked_task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    cursor_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    total_executions: int = Field(default=0)
    total_assets_processed: int = Field(default=0)
    last_execution_at: Optional[datetime] = Field(default=None)
    last_execution_status: Optional[str] = Field(default=None)
    consecutive_failures: int = Field(default=0)
    views_config: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    executions: List["FlowExecution"] = Relationship(back_populates="flow")
    input_source: Optional[Source] = Relationship()
    input_bundle: Optional[Bundle] = Relationship()

    __table_args__ = (
        Index("ix_flow_infospace_status", "infospace_id", "status"),
        Index("ix_flow_input_bundle", "input_bundle_id"),
        Index("ix_flow_input_source", "input_source_id"),
    )


class FlowExecution(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    flow_id: int = Field(foreign_key="flow.id")
    triggered_by: str = Field(default="manual")
    triggered_by_task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    triggered_by_source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    trigger_context: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: RunStatus = Field(default=RunStatus.PENDING)
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    input_asset_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    output_asset_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    step_outputs: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    flow: Optional[Flow] = Relationship(back_populates="executions")
    annotation_runs: List[AnnotationRun] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[AnnotationRun.flow_execution_id]"}
    )

    __table_args__ = (
        Index("ix_flowexecution_flow_status", "flow_id", "status"),
        Index("ix_flowexecution_created", "created_at"),
    )
