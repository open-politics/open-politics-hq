"""Flow domain schemas: Task, Flow, FlowExecution."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel

from app.models import TaskType, TaskStatus


# ─── Task ───

class TaskBase(SQLModel):
    name: str
    type: TaskType
    schedule: str
    configuration: Dict[str, Any] = {}


class TaskCreate(TaskBase):
    source_id: Optional[int] = None


class TaskUpdate(SQLModel):
    name: Optional[str] = None
    type: Optional[TaskType] = None
    schedule: Optional[str] = None
    configuration: Optional[Dict[str, Any]] = None
    status: Optional[TaskStatus] = None
    is_enabled: Optional[bool] = None


class TaskRead(TaskBase):
    id: int
    infospace_id: int
    status: TaskStatus
    is_enabled: bool
    last_run_at: Optional[datetime]
    consecutive_failure_count: int


class TasksOut(SQLModel):
    data: List[TaskRead]
    count: int


# ─── Flow ───

class FlowStepConfig(SQLModel):
    """Configuration for a single step in a Flow."""
    type: str  # ANNOTATE, FILTER, CURATE, ROUTE, EMBED, ANALYZE
    schema_ids: Optional[List[int]] = None
    config: Optional[Dict[str, Any]] = None
    expression: Optional[Dict[str, Any]] = None
    fields: Optional[List[str]] = None
    bundle_id: Optional[int] = None
    bundle_ids: Optional[List[int]] = None
    conditions: Optional[List[Dict[str, Any]]] = None
    model: Optional[str] = None
    chunk_config: Optional[Dict[str, Any]] = None
    adapter_name: Optional[str] = None
    adapter_config: Optional[Dict[str, Any]] = None


class FlowBase(SQLModel):
    name: str
    description: Optional[str] = None
    input_type: str = "bundle"
    input_source_id: Optional[int] = None
    input_bundle_id: Optional[int] = None
    trigger_mode: str = "manual"
    steps: List[Dict[str, Any]] = []
    views_config: Optional[List[Dict[str, Any]]] = None
    tags: Optional[List[str]] = None


class FlowCreate(FlowBase):
    pass


class FlowUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    input_type: Optional[str] = None
    input_source_id: Optional[int] = None
    input_bundle_id: Optional[int] = None
    trigger_mode: Optional[str] = None
    steps: Optional[List[Dict[str, Any]]] = None
    views_config: Optional[List[Dict[str, Any]]] = None
    tags: Optional[List[str]] = None


class FlowRead(FlowBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    status: str
    linked_task_id: Optional[int] = None
    cursor_state: Dict[str, Any] = {}
    total_executions: int = 0
    total_assets_processed: int = 0
    last_execution_at: Optional[datetime] = None
    last_execution_status: Optional[str] = None
    consecutive_failures: int = 0
    created_at: datetime
    updated_at: datetime


class FlowsOut(SQLModel):
    data: List[FlowRead]
    count: int


class FlowExecutionCreate(SQLModel):
    asset_ids: Optional[List[int]] = None
    tags: Optional[List[str]] = None


class FlowExecutionRead(SQLModel):
    id: int
    uuid: str
    flow_id: int
    triggered_by: str
    triggered_by_task_id: Optional[int] = None
    triggered_by_source_id: Optional[int] = None
    trigger_context: Dict[str, Any] = {}
    status: str
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    error_message: Optional[str] = None
    input_asset_ids: List[int] = []
    output_asset_ids: List[int] = []
    step_outputs: Dict[str, Any] = {}
    tags: Optional[List[str]] = None
    created_at: datetime


class FlowExecutionsOut(SQLModel):
    data: List[FlowExecutionRead]
    count: int
