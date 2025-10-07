"""
Chat Conversation History API Routes
"""
import logging
from typing import Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session, select, func, and_, desc

from app.api.deps import CurrentUser, SessionDep
from app.models import ChatConversation, ChatConversationMessage, User
from app.schemas import (
    ChatConversationCreate,
    ChatConversationUpdate,
    ChatConversationRead,
    ChatConversationWithMessages,
    ChatConversationsOut,
    ChatConversationMessageCreate,
    ChatConversationMessageRead,
    AddMessageToConversationRequest,
    Message,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────────── ROUTES ─────────────── #

@router.get("", response_model=ChatConversationsOut)
async def list_conversations(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: Optional[int] = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    include_archived: bool = Query(False),
    pinned_only: bool = Query(False),
):
    """
    List chat conversations for the current user.
    
    Query parameters:
    - infospace_id: Filter by infospace
    - skip: Number of records to skip (pagination)
    - limit: Maximum number of records to return
    - include_archived: Include archived conversations
    - pinned_only: Return only pinned conversations
    """
    try:
        # Build query
        query = select(ChatConversation).where(ChatConversation.user_id == current_user.id)
        
        if infospace_id:
            query = query.where(ChatConversation.infospace_id == infospace_id)
        
        if not include_archived:
            query = query.where(ChatConversation.is_archived == False)
        
        if pinned_only:
            query = query.where(ChatConversation.is_pinned == True)
        
        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_count = session.exec(count_query).one()
        
        # Order by pinned first, then by last_message_at or updated_at
        query = query.order_by(
            desc(ChatConversation.is_pinned),
            desc(ChatConversation.last_message_at),
            desc(ChatConversation.updated_at)
        )
        
        # Apply pagination
        query = query.offset(skip).limit(limit)
        
        conversations = session.exec(query).all()
        
        # Enrich with message counts
        results = []
        for conv in conversations:
            message_count = session.exec(
                select(func.count()).where(ChatConversationMessage.conversation_id == conv.id)
            ).one()
            
            conv_dict = conv.model_dump()
            conv_dict["message_count"] = message_count
            results.append(ChatConversationRead(**conv_dict))
        
        return ChatConversationsOut(data=results, count=total_count)
        
    except Exception as e:
        logger.error(f"Error listing conversations: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list conversations: {str(e)}"
        )


@router.post("", response_model=ChatConversationRead)
async def create_conversation(
    conversation_data: ChatConversationCreate,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Create a new chat conversation.
    
    Optionally include initial messages.
    """
    try:
        # Create conversation
        conversation = ChatConversation(
            title=conversation_data.title,
            description=conversation_data.description,
            infospace_id=conversation_data.infospace_id,
            user_id=current_user.id,
            model_name=conversation_data.model_name,
            temperature=conversation_data.temperature,
            conversation_metadata=conversation_data.conversation_metadata or {},
        )
        
        session.add(conversation)
        session.commit()
        session.refresh(conversation)
        
        # Add initial messages if provided
        if conversation_data.messages:
            for msg_data in conversation_data.messages:
                message = ChatConversationMessage(
                    conversation_id=conversation.id,
                    role=msg_data.role,
                    content=msg_data.content,
                    message_metadata=msg_data.message_metadata or {},
                    tool_calls=msg_data.tool_calls,
                    tool_executions=msg_data.tool_executions,
                    thinking_trace=msg_data.thinking_trace,
                    model_used=msg_data.model_used,
                    usage=msg_data.usage,
                )
                session.add(message)
            
            # Update last_message_at
            conversation.last_message_at = datetime.now(timezone.utc)
            session.add(conversation)
            session.commit()
            session.refresh(conversation)
        
        # Get message count
        message_count = session.exec(
            select(func.count()).where(ChatConversationMessage.conversation_id == conversation.id)
        ).one()
        
        conv_dict = conversation.model_dump()
        conv_dict["message_count"] = message_count
        
        return ChatConversationRead(**conv_dict)
        
    except Exception as e:
        logger.error(f"Error creating conversation: {e}")
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create conversation: {str(e)}"
        )


@router.get("/{conversation_id}", response_model=ChatConversationWithMessages)
async def get_conversation(
    conversation_id: int,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Get a specific conversation with all its messages.
    """
    try:
        # Get conversation
        conversation = session.exec(
            select(ChatConversation).where(
                and_(
                    ChatConversation.id == conversation_id,
                    ChatConversation.user_id == current_user.id
                )
            )
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        # Get all messages
        messages = session.exec(
            select(ChatConversationMessage)
            .where(ChatConversationMessage.conversation_id == conversation_id)
            .order_by(ChatConversationMessage.created_at)
        ).all()
        
        conv_dict = conversation.model_dump()
        conv_dict["messages"] = [ChatConversationMessageRead(**msg.model_dump()) for msg in messages]
        conv_dict["message_count"] = len(messages)
        
        return ChatConversationWithMessages(**conv_dict)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting conversation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get conversation: {str(e)}"
        )


@router.patch("/{conversation_id}", response_model=ChatConversationRead)
async def update_conversation(
    conversation_id: int,
    conversation_data: ChatConversationUpdate,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Update a conversation's metadata (title, description, etc).
    """
    try:
        # Get conversation
        conversation = session.exec(
            select(ChatConversation).where(
                and_(
                    ChatConversation.id == conversation_id,
                    ChatConversation.user_id == current_user.id
                )
            )
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        # Update fields
        update_data = conversation_data.model_dump(exclude_unset=True)
        for key, value in update_data.items():
            setattr(conversation, key, value)
        
        conversation.updated_at = datetime.now(timezone.utc)
        
        session.add(conversation)
        session.commit()
        session.refresh(conversation)
        
        # Get message count
        message_count = session.exec(
            select(func.count()).where(ChatConversationMessage.conversation_id == conversation.id)
        ).one()
        
        conv_dict = conversation.model_dump()
        conv_dict["message_count"] = message_count
        
        return ChatConversationRead(**conv_dict)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error updating conversation: {e}")
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update conversation: {str(e)}"
        )


@router.delete("/{conversation_id}", response_model=Message)
async def delete_conversation(
    conversation_id: int,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Delete a conversation and all its messages.
    """
    try:
        # Get conversation
        conversation = session.exec(
            select(ChatConversation).where(
                and_(
                    ChatConversation.id == conversation_id,
                    ChatConversation.user_id == current_user.id
                )
            )
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        # Delete all messages first
        messages = session.exec(
            select(ChatConversationMessage).where(
                ChatConversationMessage.conversation_id == conversation_id
            )
        ).all()
        
        for message in messages:
            session.delete(message)
        
        # Delete conversation
        session.delete(conversation)
        session.commit()
        
        return Message(message=f"Conversation {conversation_id} deleted successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deleting conversation: {e}")
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete conversation: {str(e)}"
        )


@router.post("/{conversation_id}/messages", response_model=ChatConversationMessageRead)
async def add_message_to_conversation(
    conversation_id: int,
    request: AddMessageToConversationRequest,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Add a new message to an existing conversation.
    """
    try:
        # Verify conversation exists and belongs to user
        conversation = session.exec(
            select(ChatConversation).where(
                and_(
                    ChatConversation.id == conversation_id,
                    ChatConversation.user_id == current_user.id
                )
            )
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        # Create message
        msg_data = request.message
        message = ChatConversationMessage(
            conversation_id=conversation_id,
            role=msg_data.role,
            content=msg_data.content,
            message_metadata=msg_data.message_metadata or {},
            tool_calls=msg_data.tool_calls,
            tool_executions=msg_data.tool_executions,
            thinking_trace=msg_data.thinking_trace,
            model_used=msg_data.model_used,
            usage=msg_data.usage,
        )
        
        session.add(message)
        
        # Update conversation's last_message_at
        conversation.last_message_at = datetime.now(timezone.utc)
        conversation.updated_at = datetime.now(timezone.utc)
        session.add(conversation)
        
        session.commit()
        session.refresh(message)
        
        return ChatConversationMessageRead(**message.model_dump())
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error adding message: {e}")
        session.rollback()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to add message: {str(e)}"
        )


@router.get("/{conversation_id}/messages", response_model=list[ChatConversationMessageRead])
async def get_conversation_messages(
    conversation_id: int,
    current_user: CurrentUser,
    session: SessionDep,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
):
    """
    Get messages for a specific conversation.
    """
    try:
        # Verify conversation exists and belongs to user
        conversation = session.exec(
            select(ChatConversation).where(
                and_(
                    ChatConversation.id == conversation_id,
                    ChatConversation.user_id == current_user.id
                )
            )
        ).first()
        
        if not conversation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Conversation not found"
            )
        
        # Get messages
        messages = session.exec(
            select(ChatConversationMessage)
            .where(ChatConversationMessage.conversation_id == conversation_id)
            .order_by(ChatConversationMessage.created_at)
            .offset(skip)
            .limit(limit)
        ).all()
        
        return [ChatConversationMessageRead(**msg.model_dump()) for msg in messages]
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting messages: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get messages: {str(e)}"
        )

