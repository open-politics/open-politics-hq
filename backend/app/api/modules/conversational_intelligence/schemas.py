"""Chat conversation schemas for the conversational intelligence domain."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel


class ChatConversationMessageBase(SQLModel):
    """Base schema for chat conversation messages."""
    role: str
    content: str
    message_metadata: Optional[Dict[str, Any]] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_executions: Optional[List[Dict[str, Any]]] = None
    thinking_trace: Optional[str] = None
    model_used: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None


class ChatConversationMessageCreate(SQLModel):
    """Schema for creating a new chat message."""
    role: str
    content: str
    message_metadata: Optional[Dict[str, Any]] = None
    tool_calls: Optional[List[Dict[str, Any]]] = None
    tool_executions: Optional[List[Dict[str, Any]]] = None
    thinking_trace: Optional[str] = None
    model_used: Optional[str] = None
    usage: Optional[Dict[str, Any]] = None


class ChatConversationMessageRead(ChatConversationMessageBase):
    """Schema for reading a chat message."""
    id: int
    conversation_id: int
    created_at: datetime


class ChatConversationBase(SQLModel):
    """Base schema for chat conversations."""
    title: str
    description: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    conversation_metadata: Optional[Dict[str, Any]] = None


class ChatConversationCreate(ChatConversationBase):
    """Schema for creating a new chat conversation."""
    infospace_id: int
    messages: Optional[List[ChatConversationMessageCreate]] = None


class ChatConversationUpdate(SQLModel):
    """Schema for updating a chat conversation."""
    title: Optional[str] = None
    description: Optional[str] = None
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    conversation_metadata: Optional[Dict[str, Any]] = None
    is_archived: Optional[bool] = None
    is_pinned: Optional[bool] = None


class ChatConversationRead(ChatConversationBase):
    """Schema for reading a chat conversation."""
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    is_archived: bool
    is_pinned: bool
    created_at: datetime
    updated_at: datetime
    last_message_at: Optional[datetime]
    message_count: Optional[int] = None


class ChatConversationWithMessages(ChatConversationRead):
    """Schema for chat conversation with full message history."""
    messages: List[ChatConversationMessageRead]


class ChatConversationsOut(SQLModel):
    """Paginated list of chat conversations."""
    data: List[ChatConversationRead]
    count: int


class AddMessageToConversationRequest(SQLModel):
    """Request to add a message to an existing conversation."""
    message: ChatConversationMessageCreate
