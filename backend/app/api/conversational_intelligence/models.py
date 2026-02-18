"""Conversational intelligence domain models."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON, Text

from app.api.identity.models import User, Infospace


class ChatConversation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    description: Optional[str] = None
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    conversation_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    is_archived: bool = Field(default=False)
    is_pinned: bool = Field(default=False)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    last_message_at: Optional[datetime] = None
    infospace: Optional[Infospace] = Relationship()
    user: Optional[User] = Relationship()
    messages: List["ChatConversationMessage"] = Relationship(back_populates="conversation")

    __table_args__ = (
        Index("ix_chatconversation_user_infospace", "user_id", "infospace_id"),
        Index("ix_chatconversation_updated", "updated_at"),
    )


class ChatConversationMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="chatconversation.id")
    role: str
    content: str = Field(sa_column=Column(Text))
    message_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    tool_calls: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    tool_executions: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    thinking_trace: Optional[str] = Field(default=None, sa_column=Column(Text))
    model_used: Optional[str] = None
    usage: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    conversation: Optional[ChatConversation] = Relationship(back_populates="messages")

    __table_args__ = (
        Index("ix_chatconversationmessage_conversation", "conversation_id", "created_at"),
    )
