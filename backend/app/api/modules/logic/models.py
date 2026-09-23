"""
logic/models.py — a saved decision, while the shape is still being found.

  Decision    name · description · config (JSONB)

One JSONB column on purpose. What a decision *is* — a state, some typed
questions, a threshold, a schedule, a place it gets applied — is exactly what
this panel exists to discover, and every field promoted to a column before that
is a migration written against a guess. So `config` stays a dump, nothing points
at a Decision, and deleting one is a DELETE with no cascade to reason about.

When the shape settles it graduates: typed fields, a Pydantic contract, and
whatever ties it to sources, canons or runs. Until then this is a notebook.

  NOT IN THIS FILE
    foundation_service_providers/logic/  the domain that answers a decision.
    routes/logic.py                      run one, save one, list, delete.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any, Dict, Optional

from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel


class Decision(SQLModel, table=True):
    """A decision someone set up and kept. Infospace-scoped, owned, disposable."""

    __tablename__ = "decision"

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))

    #: The whole thing: {"state": …, "questions": {key: {type, instructions, criteria}}}
    #: plus whatever the panel is trying out this week. Read by the panel, not by
    #: the backend — the route validates it by *running* it, never by parsing it.
    config: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))

    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(
        default_factory=lambda: datetime.now(timezone.utc),
        sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)},
    )
