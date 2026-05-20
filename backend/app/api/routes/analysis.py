"""Fragment curation and RAG search routes.

Promote annotation values to permanent asset metadata (fragments) or
delete curated fragments.  Also provides a RAG (Retrieval-Augmented Generation)
endpoint that does semantic search over asset chunks and sends the question +
context to an LLM.
"""

import logging
import time
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.api.dependency_injection import SessionDep, get_annotation_service
from app.api.modules.annotation.services import AnnotationService
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.schemas import AnnotationRead
from fastapi import Depends

logger = logging.getLogger(__name__)
router = APIRouter()


# ─── RAG Search ───


class RagSearchRequest(BaseModel):
    question: str
    model: str = "gemini-2.0-flash-thinking-exp-01-21"
    provider_name: Optional[str] = None  # LLM provider key (e.g. "google", "openai", "ollama"). Auto-detected from user defaults if omitted.
    embedding_model_id: Optional[int] = None  # Override infospace's configured embedding model
    enable_thinking: bool = False
    temperature: float = Field(default=0.1, ge=0.0, le=2.0)
    top_k: int = Field(default=5, ge=1, le=50)


class RagSource(BaseModel):
    asset_id: int
    title: str
    score: float
    snippet: str


class RagSearchResponse(BaseModel):
    answer: str
    sources: List[RagSource]
    model: str
    processing_time_ms: int


@router.post(
    "/infospaces/{infospace_id}/rag",
    response_model=RagSearchResponse,
    tags=["RAG"],
)
async def rag_search(
    *,
    request: RagSearchRequest,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    session: SessionDep,
):
    """Retrieval-Augmented Generation: semantic search over asset chunks, then LLM answer."""
    t0 = time.time()
    infospace_id = access.infospace_id
    user_id = access.user_id

    # ── 1. Semantic search over AssetChunk via flat similarity primitive ──
    from app.api.modules.embedding.similarity import search_by_text

    try:
        results = await search_by_text(
            session, infospace_id, request.question,
            limit=request.top_k,
            embedding_model_id=request.embedding_model_id,
            scope=access.scope,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))

    if not results:
        return RagSearchResponse(
            answer="No relevant content found in this infospace for your question.",
            sources=[],
            model=request.model,
            processing_time_ms=int((time.time() - t0) * 1000),
        )

    # ── 2. Build context from chunks ──
    sources: List[RagSource] = []
    context_parts: List[str] = []

    for r in results:
        snippet = (r.chunk_text or "")[:500]
        sources.append(RagSource(
            asset_id=r.asset_id,
            title=r.asset_title or f"Asset {r.asset_id}",
            score=round(r.similarity, 4),
            snippet=snippet,
        ))
        # Build context block: include asset title for attribution
        label = r.asset_title or f"Asset {r.asset_id}"
        context_parts.append(f"[Source: {label} (similarity {r.similarity:.2f})]\n{r.chunk_text or ''}")

    context_text = "\n\n---\n\n".join(context_parts)

    # ── 3. Resolve LLM provider ──
    from app.api.modules.foundation_service_providers import resolve, ProviderError

    try:
        llm = resolve(
            "language", request.provider_name, request.model,
            infospace_id=infospace_id,
            context="annotation",
            session=session,
        )
    except ProviderError as e:
        raise HTTPException(status_code=400, detail=str(e))

    # ── 4. Generate answer ──
    system_prompt = (
        "You are a research assistant analyzing documents in an intelligence workspace. "
        "Answer the user's question based on the provided source material. "
        "Be precise and cite which sources support your answer. "
        "If the sources don't contain enough information to answer fully, say so clearly."
    )

    messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"## Source Material\n\n{context_text}\n\n"
                f"## Question\n\n{request.question}"
            ),
        },
    ]

    try:
        gen_response = await llm.generate(
            messages=messages,
            model_name=llm.model,
            thinking_enabled=request.enable_thinking,
            temperature=request.temperature,
        )
    except Exception as e:
        logger.error("LLM generation failed: %s", e)
        raise HTTPException(status_code=502, detail=f"LLM generation failed: {e}")

    answer = gen_response.content if hasattr(gen_response, "content") else str(gen_response)

    return RagSearchResponse(
        answer=answer,
        sources=sources,
        model=gen_response.model_used if hasattr(gen_response, "model_used") else request.model,
        processing_time_ms=int((time.time() - t0) * 1000),
    )


class PromoteFragmentRequest(BaseModel):
    fragment_key: str
    fragment_value: Any
    source_run_id: Optional[int] = None


class DeleteFragmentResponse(BaseModel):
    success: bool
    message: str


@router.post(
    "/infospaces/{infospace_id}/assets/{asset_id}/fragments",
    response_model=AnnotationRead,
    tags=["Fragments"],
)
async def promote_fragment(
    *,
    asset_id: int,
    request: PromoteFragmentRequest,
    access: Access = Requires(scope=None),
    annotation_service: AnnotationService = Depends(get_annotation_service),
):
    """Promote a value to a permanent fragment on an asset."""
    access.require_in_scope("asset_ids", asset_id)
    try:
        annotation = annotation_service.curate_fragment(
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            asset_id=asset_id,
            field_name=request.fragment_key,
            value=request.fragment_value,
            source_run_id=request.source_run_id,
        )
        return annotation
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))


@router.delete(
    "/infospaces/{infospace_id}/assets/{asset_id}/fragments/{fragment_key}",
    response_model=DeleteFragmentResponse,
    tags=["Fragments"],
)
async def delete_fragment(
    *,
    asset_id: int,
    fragment_key: str,
    access: Access = Requires(scope=None),
    annotation_service: AnnotationService = Depends(get_annotation_service),
):
    """Delete a curated fragment from an asset."""
    access.require_in_scope("asset_ids", asset_id)
    try:
        success = annotation_service.delete_fragment(
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            asset_id=asset_id,
            fragment_key=fragment_key,
        )
        if success:
            return DeleteFragmentResponse(
                success=True,
                message=f"Fragment '{fragment_key}' deleted successfully",
            )
        raise HTTPException(
            status_code=404,
            detail=f"Fragment '{fragment_key}' not found on asset {asset_id}",
        )
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
