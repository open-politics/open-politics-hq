"""
Chat and Intelligence Conversation API Routes
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session, select

from app.api.deps import CurrentUser, ConversationServiceDep, SessionDep
from app.models import User, ChatConversation, ChatConversationMessage
from app.schemas import (
    Message, 
    ChatMessage, 
    ChatRequest, 
    ChatResponse, 
    ToolCallRequest, 
    ModelListResponse,
    ModelInfo
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─────────────── ROUTES ─────────────── #

@router.post("/chat", response_model=ChatResponse)
async def intelligence_chat(
    request: ChatRequest,
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    session: SessionDep
):
    """
    Intelligence analysis chat with tool orchestration.
    
    The AI model can search, analyze, and interact with your intelligence data.
    Example conversation:
    - User: "What are the main themes in recent political documents?"
    - AI: *calls search_assets tool* → *analyzes results* → Responds with findings
    
    Optional: Provide conversation_id to save messages to a conversation history.
    """
    try:
        # Helper function to save messages to conversation
        async def save_message_to_conversation(
            conv_id: int,
            role: str,
            content: str,
            model_used: Optional[str] = None,
            usage: Optional[Dict[str, Any]] = None,
            tool_calls: Optional[List[Dict[str, Any]]] = None,
            tool_executions: Optional[List[Dict[str, Any]]] = None,
            thinking_trace: Optional[str] = None,
            message_metadata: Optional[Dict[str, Any]] = None
        ):
            """Save a message to the conversation history."""
            try:
                # Verify conversation exists and belongs to user
                conversation = session.exec(
                    select(ChatConversation).where(
                        ChatConversation.id == conv_id,
                        ChatConversation.user_id == current_user.id
                    )
                ).first()
                
                if not conversation:
                    logger.warning(f"Conversation {conv_id} not found or doesn't belong to user")
                    return
                
                # Create message
                message = ChatConversationMessage(
                    conversation_id=conv_id,
                    role=role,
                    content=content,
                    model_used=model_used,
                    usage=usage,
                    tool_calls=tool_calls,
                    tool_executions=tool_executions,
                    thinking_trace=thinking_trace,
                    message_metadata=message_metadata or {},
                )
                
                session.add(message)
                
                # Update conversation timestamps
                conversation.last_message_at = datetime.now(timezone.utc)
                conversation.updated_at = datetime.now(timezone.utc)
                session.add(conversation)
                
                session.commit()
                logger.info(f"Saved message to conversation {conv_id}")
            except Exception as e:
                logger.error(f"Failed to save message to conversation: {e}")
                session.rollback()
        
        # Save user message if conversation_id provided
        if request.conversation_id and len(request.messages) > 0:
            last_user_message = request.messages[-1]
            if last_user_message.role == "user":
                # Preserve display content and context metadata for UI rendering
                user_metadata = {}
                if request.display_content:
                    user_metadata['display_content'] = request.display_content
                if request.context_assets:
                    user_metadata['context_assets'] = request.context_assets
                if request.context_depth:
                    user_metadata['context_depth'] = request.context_depth
                
                await save_message_to_conversation(
                    request.conversation_id,
                    role="user",
                    content=last_user_message.content,
                    message_metadata=user_metadata if user_metadata else None
                )
        
        # Convert Pydantic models to dicts, filtering out empty messages
        # Anthropic requires all messages to have non-empty content
        messages = [
            {"role": msg.role, "content": msg.content} 
            for msg in request.messages 
            if msg.content and msg.content.strip()
        ]
        
        # Ensure we have at least one message
        if not messages:
            raise HTTPException(
                status_code=400,
                detail="At least one non-empty message is required"
            )
        
        # Prepare kwargs
        kwargs = {}
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.max_tokens is not None:
            kwargs["max_tokens"] = request.max_tokens
        
        # Default OpenAI model to gpt-5 if none provided (or empty string)
        # We treat model_name as required by schema, but harden here for safety
        model_name = (request.model_name or '').strip()
        if not model_name:
            # Try to discover models to ensure availability
            try:
                models = await conversation_service.get_available_models(user_id=current_user.id)
                # Prefer OpenAI gpt-5 if present
                preferred = next((m for m in models if m.get('provider') == 'openai' and str(m.get('name','')).startswith('gpt-5')), None)
                if preferred:
                    model_name = preferred['name']
                else:
                    # Fallback: first tool-supporting model or first available
                    tool_model = next((m for m in models if m.get('supports_tools')), None)
                    model_name = (tool_model or (models[0] if models else {})).get('name') or ''
            except Exception:
                # Hard default if discovery fails
                model_name = 'gpt-5'
        
        if request.stream:
            # For streaming, we need to handle it differently
            # Track the final response for saving
            final_response = None
            final_usage_dict = None
            
            async def generate_stream():
                nonlocal final_response, final_usage_dict
                
                # SSE prelude to defeat proxy buffering
                yield ": stream-start\n\n"
                async for response in await conversation_service.intelligence_chat(
                    messages=messages,
                    model_name=model_name,
                    user_id=current_user.id,
                    infospace_id=request.infospace_id,
                    stream=True,
                    thinking_enabled=request.thinking_enabled,
                    api_keys=request.api_keys,
                    **kwargs
                ):
                    # Store for later saving
                    final_response = response
                    
                    # Convert usage to dict if it's an object
                    usage_dict = None
                    if response.usage:
                        if isinstance(response.usage, dict):
                            usage_dict = response.usage
                        else:
                            # Convert object to dict
                            usage_dict = response.usage.__dict__ if hasattr(response.usage, '__dict__') else {}
                    final_usage_dict = usage_dict
                    
                    # response is a dataclass; serialize minimally for SSE
                    payload = {
                        "content": response.content,
                        "model_used": response.model_used,
                        "usage": usage_dict,
                        "tool_calls": response.tool_calls,
                        "tool_executions": response.tool_executions,
                        "thinking_trace": response.thinking_trace,
                        "finish_reason": response.finish_reason,
                    }
                    logger.debug(f"Streaming response: content='{response.content}', model={response.model_used}")
                    import json as _json
                    yield f"data: {_json.dumps(payload)}\n\n"
                
                # Save assistant response to conversation after streaming completes
                if request.conversation_id and final_response:
                    await save_message_to_conversation(
                        request.conversation_id,
                        role="assistant",
                        content=final_response.content,
                        model_used=final_response.model_used,
                        usage=final_usage_dict,
                        tool_calls=final_response.tool_calls,
                        tool_executions=final_response.tool_executions,
                        thinking_trace=final_response.thinking_trace
                    )
                
                yield "data: [DONE]\n\n"
            
            return StreamingResponse(generate_stream(), media_type="text/event-stream", headers={
                "Cache-Control": "no-cache, no-transform",
                "Pragma": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no"
            })
        
        else:
            # Non-streaming response
            response = await conversation_service.intelligence_chat(
                messages=messages,
                model_name=model_name,
                user_id=current_user.id,
                infospace_id=request.infospace_id,
                stream=False,
                thinking_enabled=request.thinking_enabled,
                api_keys=request.api_keys,
                **kwargs
            )
            
            # Convert usage to dict if it's an object
            usage_dict = None
            if response.usage:
                if isinstance(response.usage, dict):
                    usage_dict = response.usage
                else:
                    # Convert object to dict
                    usage_dict = response.usage.__dict__ if hasattr(response.usage, '__dict__') else {}
            
            # Save assistant response to conversation if conversation_id provided
            if request.conversation_id:
                await save_message_to_conversation(
                    request.conversation_id,
                    role="assistant",
                    content=response.content,
                    model_used=response.model_used,
                    usage=usage_dict,
                    tool_calls=response.tool_calls,
                    tool_executions=response.tool_executions,
                    thinking_trace=response.thinking_trace
                )
            
            return ChatResponse(
                content=response.content,
                model_used=response.model_used,
                usage=usage_dict,
                tool_calls=response.tool_calls,
                tool_executions=response.tool_executions,
                thinking_trace=response.thinking_trace,
                finish_reason=response.finish_reason
            )
            
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat failed: {str(e)}"
        )


@router.post("/tools/execute")
async def execute_tool_call(
    current_user: CurrentUser,
    request: ToolCallRequest,
    conversation_service: ConversationServiceDep
):
    """
    Execute a tool call made by an AI model.
    
    This endpoint is used when the AI model wants to interact with the intelligence platform
    through function calls (search assets, get annotations, etc.).
    """
    try:
        result = await conversation_service.execute_tool_call(
            tool_name=request.tool_name,
            arguments=request.arguments,
            user_id=current_user.id,
            infospace_id=request.infospace_id
        )
        
        return result
        
    except Exception as e:
        logger.error(f"Tool execution endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool execution failed: {str(e)}"
        )


@router.get("/models", response_model=ModelListResponse)
async def list_available_models(
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    capability: Optional[str] = None
):
    """
    Discover available language models across all providers.
    
    Query parameters:
    - capability: Filter by capability ('tools', 'streaming', 'thinking', 'multimodal', etc.)
    
    Returns all available models from OpenAI, Ollama, Gemini, etc.
    """
    try:
        models = await conversation_service.get_available_models(
            user_id=current_user.id,
            capability=capability
        )
        
        # Get unique providers
        providers = list(set(model["provider"] for model in models))
        
        return ModelListResponse(
            models=models,
            providers=providers
        )
        
    except Exception as e:
        logger.error(f"Model discovery endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Model discovery failed: {str(e)}"
        )


@router.get("/tools")
async def list_universal_tools(
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    infospace_id: int = 1  # Default infospace for tool discovery
):
    """
    List universal intelligence analysis tool definitions.
    
    These are the capabilities available to AI models.
    FastMCP automatically generates schemas from function signatures.
    """
    try:
        tools = await conversation_service.get_universal_tools(
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        
        return {
            "tools": tools,
            "tool_count": len(tools),
            "description": "Universal intelligence analysis tools available to AI models"
        }
        
    except Exception as e:
        logger.error(f"Universal tools list error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list tools: {str(e)}"
        )


@router.get("/tools/context/{infospace_id}")
async def get_infospace_tool_context(
    infospace_id: int,
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep
):
    """
    Get infospace-specific context for tools (what's actually available).
    
    This provides real data about available asset types, schemas, bundles, etc.
    to help AI models make better tool usage decisions.
    """
    try:
        context = await conversation_service.get_infospace_tool_context(
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        
        return context
        
    except Exception as e:
        logger.error(f"Tool context endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get tool context: {str(e)}"
        )
