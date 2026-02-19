"""Search domain models: SearchHistory."""

from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, JSON

from app.api.identity.models import User


class SearchHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    query: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    filters: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    result_count: Optional[int] = None

    user: Optional[User] = Relationship()
