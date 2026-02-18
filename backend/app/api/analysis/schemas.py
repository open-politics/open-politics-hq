"""Analysis domain schemas: Adapter CRUD and discovery."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, Optional

from sqlmodel import SQLModel, Field


class AnalysisAdapterBase(SQLModel):
    name: str
    description: Optional[str] = None
    input_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict)
    output_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict)
    version: str = "1.0"
    module_path: Optional[str] = None
    adapter_type: str
    is_public: bool = False


class AnalysisAdapterCreate(AnalysisAdapterBase):
    pass


class AnalysisAdapterUpdate(SQLModel):
    description: Optional[str] = None
    input_schema_definition: Optional[Dict[str, Any]] = None
    output_schema_definition: Optional[Dict[str, Any]] = None
    version: Optional[str] = None
    module_path: Optional[str] = None
    adapter_type: Optional[str] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None


class AnalysisAdapterRead(AnalysisAdapterBase):
    id: int
    is_active: bool
    creator_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
