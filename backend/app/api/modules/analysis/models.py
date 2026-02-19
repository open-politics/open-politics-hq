"""Analysis domain models: AnalysisAdapter."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional, TYPE_CHECKING

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON

if TYPE_CHECKING:
    from app.api.modules.identity_infospace_user.models import User


class AnalysisAdapter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None
    input_schema_definition: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    output_schema_definition: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    version: str = Field(default="1.0")
    module_path: Optional[str] = None
    adapter_type: str
    is_active: bool = Field(default=True, index=True)
    is_public: bool = Field(default=False)
    creator_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    creator: Optional["User"] = Relationship(back_populates="analysis_adapters_created")  # noqa: F821
