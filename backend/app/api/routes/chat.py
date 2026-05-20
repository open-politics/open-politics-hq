"""
Chat and Intelligence Conversation API Routes.

Two parallel endpoints:

* ``POST /chat``         — JSON one-shot. Returns a single ``ChatResponse``.
* ``POST /chat/stream``  — Native SSE generator. Yields incremental chunks.

Splitting JSON and SSE into sibling paths lets FastAPI's SSE pipeline
(``response_class=EventSourceResponse`` + ``yield``) attach 3 s keepalive
pings — ``SSEResponse(generate())`` silently bypassed them.
"""

import logging
import asyncio
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.sse import EventSourceResponse, ServerSentEvent
from sqlmodel import Session, select

from app.api.dependency_injection import (
    CurrentUser,
    ConversationServiceDep,
    SessionDep,
    SettingsDep,
    StorageProviderDep,
)
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires, resolve_access
from app.api.modules.foundation_service_providers import resolve, ProviderError
from app.models import User, ChatConversation, ChatConversationMessage, Asset, AssetKind
from app.schemas import (
    Message,
    ChatMessage,
    ChatRequest,
    ChatResponse,
    ToolCallRequest,
    ModelListResponse,
    ModelInfo,
)

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Conversation persistence helper ─────────────────────────────────────


async def _save_message_to_conversation(
    session: Session,
    user_id: int,
    conv_id: int,
    *,
    role: str,
    content: str,
    model_used: Optional[str] = None,
    usage: Optional[Dict[str, Any]] = None,
    tool_calls: Optional[List[Dict[str, Any]]] = None,
    tool_executions: Optional[List[Dict[str, Any]]] = None,
    thinking_trace: Optional[str] = None,
    message_metadata: Optional[Dict[str, Any]] = None,
    agent_kind: Optional[str] = None,
    run_id: Optional[int] = None,
) -> None:
    """Append a message to a chat conversation (best-effort; logs on failure).

    Also stamps the conversation's metadata with ``agent_kind`` / ``run_id`` on
    the first save so the conversation list can later filter by surface. Once
    stamped, never overwrites — a conversation belongs to one agent for life.
    """
    try:
        conversation = session.exec(
            select(ChatConversation).where(
                ChatConversation.id == conv_id,
                ChatConversation.user_id == user_id,
            )
        ).first()

        if not conversation:
            logger.warning(f"Conversation {conv_id} not found or doesn't belong to user")
            return

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

        # Stamp agent_kind / run_id on first save. SQLAlchemy's JSON change
        # tracking on a JSONB column requires reassigning the dict rather than
        # mutating it in place, so we always rebuild and assign.
        meta = dict(conversation.conversation_metadata or {})
        meta_changed = False
        if agent_kind and not meta.get("agent_kind"):
            meta["agent_kind"] = agent_kind
            meta_changed = True
        if run_id is not None and meta.get("run_id") is None:
            meta["run_id"] = run_id
            meta_changed = True
        if meta_changed:
            conversation.conversation_metadata = meta

        now = datetime.now(timezone.utc)
        conversation.last_message_at = now
        conversation.updated_at = now
        session.add(conversation)
        session.commit()
        logger.info(f"Saved message to conversation {conv_id}")
    except Exception as e:
        logger.error(f"Failed to save message to conversation: {e}")
        session.rollback()


# ─── Chat request preparation ────────────────────────────────────────────


async def _prepare_chat(
    *,
    request: ChatRequest,
    current_user: User,
    session: Session,
    storage_provider: Any,
    conversation_service: Any,
) -> tuple[list[dict], str, dict]:
    """Prepare messages, model_name, and kwargs for a chat invocation.

    Also persists the user's final message to the conversation when
    ``conversation_id`` is set. Raises ``HTTPException`` on invalid input.
    """
    # Persist user message
    if request.conversation_id and len(request.messages) > 0:
        last_user_message = request.messages[-1]
        if last_user_message.role == "user":
            user_metadata: Dict[str, Any] = {}
            if request.display_content:
                user_metadata["display_content"] = request.display_content
            if request.context_assets:
                user_metadata["context_assets"] = request.context_assets
            if request.context_depth:
                user_metadata["context_depth"] = request.context_depth
            await _save_message_to_conversation(
                session, current_user.id, request.conversation_id,
                role="user",
                content=last_user_message.content,
                message_metadata=user_metadata if user_metadata else None,
                agent_kind=request.agent,
                run_id=request.run_id,
            )

    # Pass through tool_executions on assistant messages so the provider can splice
    # tool_use/tool_result blocks back into its native shape — without this the LLM
    # only sees the assistant's final text on subsequent turns and the rich tool
    # data it produced/consumed earlier in the conversation is lost.
    def _keep(m: ChatMessage) -> bool:
        if m.content and m.content.strip():
            return True
        return m.role == "assistant" and bool(m.tool_executions)

    messages = [
        {
            "role": m.role,
            "content": m.content,
            **({"tool_executions": m.tool_executions} if m.role == "assistant" and m.tool_executions else {}),
            **({"tool_calls": m.tool_calls} if m.role == "assistant" and m.tool_calls else {}),
        }
        for m in request.messages
        if _keep(m)
    ]
    if not messages:
        raise HTTPException(
            status_code=400,
            detail="At least one non-empty message is required",
        )

    # Images (attached image assets)
    media_inputs: list[dict] = []
    if request.image_asset_ids:
        logger.info(f"Fetching {len(request.image_asset_ids)} images for chat")
        for asset_id in request.image_asset_ids:
            try:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Image asset {asset_id} not found, skipping")
                    continue
                if asset.kind != AssetKind.IMAGE:
                    logger.warning(f"Asset {asset_id} is not an image (kind: {asset.kind}), skipping")
                    continue
                if asset.infospace_id != request.infospace_id:
                    logger.warning(f"Asset {asset_id} does not belong to infospace {request.infospace_id}, skipping")
                    continue
                if not asset.blob_path:
                    logger.warning(f"Asset {asset_id} has no blob_path, skipping")
                    continue

                file_stream = await storage_provider.get_file(asset.blob_path)
                image_bytes = await asyncio.to_thread(file_stream.read)
                file_stream.close()
                if not image_bytes:
                    logger.warning(f"Asset {asset_id} blob is empty, skipping")
                    continue

                mime_type = (asset.file_info or {}).get("mime_type")
                if not mime_type:
                    low = asset.blob_path.lower()
                    if low.endswith((".jpg", ".jpeg")):
                        mime_type = "image/jpeg"
                    elif low.endswith(".png"):
                        mime_type = "image/png"
                    elif low.endswith(".gif"):
                        mime_type = "image/gif"
                    elif low.endswith(".webp"):
                        mime_type = "image/webp"
                    else:
                        mime_type = "image/png"

                media_inputs.append({
                    "uuid": str(asset.uuid),
                    "type": "image",
                    "content": image_bytes,
                    "mime_type": mime_type,
                    "metadata": {"title": asset.title, "asset_id": asset.id},
                })
                logger.info(f"Loaded image asset {asset_id} ({len(image_bytes)} bytes, {mime_type})")
            except Exception as e:
                logger.error(f"Error processing image asset {asset_id}: {e}")
                continue
        logger.info(f"Successfully loaded {len(media_inputs)} images for chat")

    # Generation kwargs
    kwargs: dict = {}
    if request.temperature is not None:
        kwargs["temperature"] = request.temperature
    if request.max_tokens is not None:
        kwargs["max_tokens"] = request.max_tokens
    if media_inputs:
        kwargs["media_inputs"] = media_inputs

    # Resolve model_name (fallback to an OpenAI tool-capable model)
    model_name = (request.model_name or "").strip()
    if not model_name:
        try:
            models = await conversation_service.get_available_models()
            preferred = next(
                (m for m in models if m.get("provider") == "openai" and str(m.get("name", "")).startswith("gpt-5")),
                None,
            )
            if preferred:
                model_name = preferred["name"]
            else:
                tool_model = next((m for m in models if m.get("supports_tools")), None)
                model_name = (tool_model or (models[0] if models else {})).get("name") or ""
        except Exception:
            model_name = "gpt-5"

    return messages, model_name, kwargs


# ─── Routes ──────────────────────────────────────────────────────────────


@router.post("/chat", response_model=ChatResponse)
async def intelligence_chat(
    request: ChatRequest,
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    session: SessionDep,
    storage_provider: StorageProviderDep,
):
    """Intelligence-analysis chat (JSON one-shot).

    For a streaming response (token/chunk-level), call ``POST /chat/stream``
    with the same body. This endpoint returns a single final ``ChatResponse``.
    """
    resolve_access(session, request.infospace_id, current_user, Capability.COMPUTE)

    try:
        messages, model_name, kwargs = await _prepare_chat(
            request=request,
            current_user=current_user,
            session=session,
            storage_provider=storage_provider,
            conversation_service=conversation_service,
        )

        response = await conversation_service.intelligence_chat(
            messages=messages,
            model_name=model_name,
            user_id=current_user.id,
            infospace_id=request.infospace_id,
            stream=False,
            thinking_enabled=request.thinking_enabled,
            tools_enabled=request.tools_enabled,
            api_keys=request.api_keys,
            conversation_id=request.conversation_id,
            provider_name=request.provider_name,
            agent=request.agent,
            run_id=request.run_id,
            formula_id=request.formula_id,
            **kwargs,
        )

        usage_dict = None
        if response.usage:
            if isinstance(response.usage, dict):
                usage_dict = response.usage
            else:
                usage_dict = response.usage.__dict__ if hasattr(response.usage, "__dict__") else {}

        if request.conversation_id:
            await _save_message_to_conversation(
                session, current_user.id, request.conversation_id,
                role="assistant",
                content=response.content,
                model_used=response.model_used,
                usage=usage_dict,
                tool_calls=response.tool_calls,
                tool_executions=response.tool_executions,
                thinking_trace=response.thinking_trace,
            )

        return ChatResponse(
            content=response.content,
            model_used=response.model_used,
            usage=usage_dict,
            tool_calls=response.tool_calls,
            tool_executions=response.tool_executions,
            thinking_trace=response.thinking_trace,
            finish_reason=response.finish_reason,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Chat endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Chat failed: {str(e)}",
        )


@router.post("/chat/stream", response_class=EventSourceResponse)
async def intelligence_chat_stream(
    request: ChatRequest,
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    session: SessionDep,
    storage_provider: StorageProviderDep,
):
    """Intelligence-analysis chat (progressive SSE).

    Native async-generator — FastAPI's SSE pipeline applies 3 s keepalive
    pings. Each chunk is emitted as ``event: chunk`` with a ``ChatResponse``
    payload. The final chunk is persisted to the conversation if
    ``conversation_id`` is set.
    """
    resolve_access(session, request.infospace_id, current_user, Capability.COMPUTE)

    try:
        messages, model_name, kwargs = await _prepare_chat(
            request=request,
            current_user=current_user,
            session=session,
            storage_provider=storage_provider,
            conversation_service=conversation_service,
        )
    except HTTPException as he:
        yield ServerSentEvent(data={"detail": str(he.detail)}, event="error")
        return

    final_response = None
    final_usage_dict: Optional[Dict[str, Any]] = None

    try:
        async for response in await conversation_service.intelligence_chat(
            messages=messages,
            model_name=model_name,
            user_id=current_user.id,
            infospace_id=request.infospace_id,
            stream=True,
            thinking_enabled=request.thinking_enabled,
            tools_enabled=request.tools_enabled,
            tools=request.tools,
            api_keys=request.api_keys,
            conversation_id=request.conversation_id,
            provider_name=request.provider_name,
            agent=request.agent,
            run_id=request.run_id,
            formula_id=request.formula_id,
            **kwargs,
        ):
            final_response = response

            usage_dict: Optional[Dict[str, Any]] = None
            if response.usage:
                if isinstance(response.usage, dict):
                    usage_dict = response.usage
                else:
                    usage_dict = response.usage.__dict__ if hasattr(response.usage, "__dict__") else {}
            final_usage_dict = usage_dict

            yield ServerSentEvent(
                data=ChatResponse(
                    content=response.content,
                    model_used=response.model_used,
                    usage=usage_dict,
                    tool_calls=response.tool_calls,
                    tool_executions=response.tool_executions,
                    thinking_trace=response.thinking_trace,
                    finish_reason=response.finish_reason,
                ),
                event="chunk",
            )
    except Exception as e:
        logger.exception("Chat stream error")
        yield ServerSentEvent(data={"detail": str(e)}, event="error")
        return

    if request.conversation_id and final_response:
        await _save_message_to_conversation(
            session, current_user.id, request.conversation_id,
            role="assistant",
            content=final_response.content,
            model_used=final_response.model_used,
            usage=final_usage_dict,
            tool_calls=final_response.tool_calls,
            tool_executions=final_response.tool_executions,
            thinking_trace=final_response.thinking_trace,
        )


@router.post("/tools/execute")
async def execute_tool_call(
    current_user: CurrentUser,
    request: ToolCallRequest,
    conversation_service: ConversationServiceDep,
    session: SessionDep,
):
    """Execute a tool call made by an AI model."""
    resolve_access(session, request.infospace_id, current_user, Capability.COMPUTE)
    try:
        result = await conversation_service.execute_tool_call(
            tool_name=request.tool_name,
            arguments=request.arguments,
            user_id=current_user.id,
            infospace_id=request.infospace_id,
        )
        return result
    except Exception as e:
        logger.error(f"Tool execution endpoint error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Tool execution failed: {str(e)}",
        )


@router.get("/models", response_model=ModelListResponse)
async def list_available_models(
    current_user: CurrentUser,
    conversation_service: ConversationServiceDep,
    capability: Optional[str] = None,
):
    """Return available generation models."""
    try:
        models = await conversation_service.get_available_models(capability=capability)
        model_infos = [ModelInfo(**m) for m in models]
        providers = sorted({m.provider for m in model_infos})
        return ModelListResponse(
            models=model_infos,
            providers=providers,
        )
    except Exception as e:
        logger.error(f"Model listing error: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list models: {str(e)}",
        )
