"""Conversational intelligence domain: models, schemas, services, MCP."""

from app.api.conversational_intelligence.models import ChatConversation, ChatConversationMessage
from app.api.conversational_intelligence.schemas import (
    ChatConversationCreate,
    ChatConversationRead,
    ChatConversationUpdate,
    ChatConversationWithMessages,
    ChatConversationsOut,
    ChatConversationMessageCreate,
    ChatConversationMessageRead,
    AddMessageToConversationRequest,
)

# Service import deferred to avoid circular import (models -> schemas -> models).
# Use: from app.api.conversational_intelligence.services import IntelligenceConversationService
__all__ = [
    "ChatConversation",
    "ChatConversationMessage",
    "ChatConversationCreate",
    "ChatConversationRead",
    "ChatConversationUpdate",
    "ChatConversationWithMessages",
    "ChatConversationsOut",
    "ChatConversationMessageCreate",
    "ChatConversationMessageRead",
    "AddMessageToConversationRequest",
]
