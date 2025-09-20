"""
Chat and Intelligence Conversation API Routes
"""
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import StreamingResponse
from sqlmodel import Session

from app.api.deps import CurrentUser, ConversationServiceDep
from app.models import User
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
    conversation_service: ConversationServiceDep
):
    """
    Intelligence analysis chat with tool orchestration.
    
    The AI model can search, analyze, and interact with your intelligence data.
    Example conversation:
    - User: "What are the main themes in recent political documents?"
    - AI: *calls search_assets tool* → *analyzes results* → Responds with findings
    """
    try:
        # Convert Pydantic models to dicts
        messages = [{"role": msg.role, "content": msg.content} for msg in request.messages]
        
        # Prepare kwargs
        kwargs = {}
        if request.temperature is not None:
            kwargs["temperature"] = request.temperature
        if request.max_tokens is not None:
            kwargs["max_tokens"] = request.max_tokens
        
        if request.stream:
            # For streaming, we need to handle it differently
            async def generate_stream():
                async for response in await conversation_service.intelligence_chat(
                    messages=messages,
                    model_name=request.model_name,
                    user_id=current_user.id,
                    infospace_id=request.infospace_id,
                    stream=True,
                    thinking_enabled=request.thinking_enabled,
                    **kwargs
                ):
                    yield f"data: {response.model_dump_json()}\n\n"
                yield "data: [DONE]\n\n"
            
            return StreamingResponse(generate_stream(), media_type="text/plain")
        
        else:
            # Non-streaming response
            response = await conversation_service.intelligence_chat(
                messages=messages,
                model_name=request.model_name,
                user_id=current_user.id,
                infospace_id=request.infospace_id,
                stream=False,
                thinking_enabled=request.thinking_enabled,
                **kwargs
            )
            
            return ChatResponse(
                content=response.content,
                model_used=response.model_used,
                usage=response.usage,
                tool_calls=response.tool_calls,
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
    conversation_service: ConversationServiceDep
):
    """
    List universal intelligence analysis tool definitions.
    
    These are the capabilities available to AI models. No authentication required
    as this only returns tool schemas, not data access.
    """
    try:
        tools = conversation_service.get_universal_tools()
        
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
