"""
API Routes for Embedding Management
"""
import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from sqlalchemy import text
from sqlmodel import Session, select

from app.api.dependency_injection import CurrentUser, SessionDep
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
from app.models import User, Infospace, Asset, AssetChunk, AssetKind
from app.schemas import Message
from app.api.modules.embedding.services import EmbeddingService, VectorSearchService
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ======================== REQUEST/RESPONSE SCHEMAS ========================

class GenerateEmbeddingsRequest(BaseModel):
    """Request to generate embeddings for an infospace."""
    overwrite: bool = Field(default=False, description="Regenerate existing embeddings")
    asset_kinds: Optional[List[str]] = Field(default=None, description="Filter by asset types")
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for cloud providers")


class GenerateAssetEmbeddingsRequest(BaseModel):
    """Request to generate embeddings for a single asset."""
    overwrite: bool = Field(default=False, description="Regenerate existing embeddings")
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for cloud providers")


class EmbeddingStatsResponse(BaseModel):
    """Response with embedding statistics."""
    total_assets: int
    documents: int  # top-level assets (parent_asset_id IS NULL) with text
    sub_assets: int  # child assets with text
    total_chunks: int
    embedded_chunks: int
    coverage_percentage: float
    models_used: dict


class SemanticSearchRequest(BaseModel):
    """Request for semantic search."""
    query: str = Field(description="Search query text")
    limit: int = Field(default=10, ge=1, le=100, description="Maximum results")
    asset_kinds: Optional[List[str]] = Field(default=None, description="Filter by asset types")
    date_from: Optional[datetime] = Field(default=None, description="Filter from date")
    date_to: Optional[datetime] = Field(default=None, description="Filter to date")
    bundle_id: Optional[int] = Field(default=None, description="Filter by bundle")
    distance_threshold: Optional[float] = Field(default=None, description="Maximum distance")
    distance_function: str = Field(default="cosine", description="Distance function: cosine, l2, inner_product")
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for cloud providers")


class SemanticSearchResponse(BaseModel):
    """Response from semantic search."""
    query: str
    results: List[dict]
    total_found: int
    infospace_id: int


class EmbeddingModelInfo(BaseModel):
    """Information about an embedding model."""
    name: str
    provider: str
    dimension: int
    description: Optional[str] = None
    max_sequence_length: Optional[int] = None


class AvailableModelsResponse(BaseModel):
    """Response listing available embedding models."""
    models: List[EmbeddingModelInfo]


# ======================== HELPERS ========================

def _reset_embedding_for_assets(session: Session, asset_ids: list[int]):
    """Clear chunks and enrichment state so the embedding enricher re-processes assets."""
    from sqlalchemy import delete as sa_delete

    # Delete existing chunks (enricher only processes assets with no chunks)
    session.execute(
        sa_delete(AssetChunk).where(AssetChunk.asset_id.in_(asset_ids))
    )
    # Bulk clear enrichment_resolved and enrichment_errors for embedding
    session.execute(text(
        "UPDATE asset SET "
        "  enrichment_resolved = array_remove(COALESCE(enrichment_resolved, ARRAY[]::text[]), 'embedding'),"
        "  enrichment_errors = CASE WHEN jsonb_typeof(enrichment_errors) = 'object' "
        "    THEN enrichment_errors - 'embedding' ELSE enrichment_errors END "
        "WHERE id = ANY(:ids)"
    ), {"ids": asset_ids})
    session.commit()


# ======================== ENDPOINTS ========================

@router.post("/infospaces/{infospace_id}/embeddings/generate", response_model=Message)
async def generate_infospace_embeddings(
    request: GenerateEmbeddingsRequest,
    session: SessionDep,
    access: Access = Requires(Capability.COMPUTE),
):
    """
    Generate embeddings for all assets in an infospace.
    Dispatches the embedding enricher for eligible assets.
    """
    infospace_id = access.infospace_id
    infospace = access.infospace

    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured. Select a model in settings.")

    # Query embeddable asset IDs
    query = select(Asset.id).where(
        Asset.infospace_id == infospace_id,
        Asset.text_content.isnot(None),
        Asset.parent_asset_id.is_(None),
    )
    if request.asset_kinds:
        query = query.where(Asset.kind.in_([AssetKind(k) for k in request.asset_kinds]))
    asset_ids = list(session.exec(query).all())

    if not asset_ids:
        return Message(message="No embeddable assets found")

    if request.overwrite:
        _reset_embedding_for_assets(session, asset_ids)

    # Fire embedding enricher in self-query mode (async, doesn't block the request)
    from app.api.modules.content.enrichers import enrich_embedding
    enrich_embedding.delay(None, infospace_id)

    return Message(message=f"Embedding generation dispatched for {len(asset_ids)} assets")


@router.post("/assets/{asset_id}/embeddings/generate", response_model=Message)
async def generate_asset_embeddings(
    asset_id: int,
    request: GenerateAssetEmbeddingsRequest,
    session: SessionDep,
    current_user: CurrentUser,
):
    """Generate embeddings for a single asset."""
    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    access = resolve_access(session, asset.infospace_id, current_user, Capability.COMPUTE)
    infospace = access.infospace

    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured")

    if request.overwrite:
        _reset_embedding_for_assets(session, [asset_id])

    from app.api.modules.content.enrichers import enrich_embedding
    enrich_embedding.delay([asset_id], infospace.id)
    return Message(message=f"Embedding generation dispatched for asset {asset_id}")


@router.get("/infospaces/{infospace_id}/embeddings/stats", response_model=EmbeddingStatsResponse)
async def get_embedding_stats(
    session: SessionDep,
    access: Access = Requires(),
):
    """Get statistics about embedding coverage in an infospace."""
    # Stats are infospace-wide aggregates — not meaningful for scoped access
    if access.scope:
        return EmbeddingStatsResponse(
            total_assets=0, documents=0, sub_assets=0,
            total_chunks=0, embedded_chunks=0, coverage_percentage=0.0, models_used={},
        )
    infospace_id = access.infospace_id
    service = EmbeddingService(session)
    stats = service.get_embedding_stats(infospace_id)

    return EmbeddingStatsResponse(**stats)


@router.post("/infospaces/{infospace_id}/embeddings/search", response_model=SemanticSearchResponse)
async def semantic_search(
    request: SemanticSearchRequest,
    session: SessionDep,
    access: Access = Requires(),
):
    """
    Perform semantic search within an infospace using vector embeddings.

    For cloud providers (OpenAI, Voyage AI, Jina AI), API keys must be provided
    in the request to generate the query embedding.
    """
    infospace_id = access.infospace_id
    infospace = access.infospace

    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured")

    kinds = None
    if request.asset_kinds:
        try:
            kinds = [AssetKind(kind) for kind in request.asset_kinds]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid asset kind: {e}")

    service = VectorSearchService(session, runtime_api_keys=request.api_keys, user_id=access.user_id)
    results = await service.semantic_search(
        query_text=request.query,
        infospace_id=infospace_id,
        limit=request.limit,
        asset_kinds=kinds,
        date_from=request.date_from,
        date_to=request.date_to,
        bundle_id=request.bundle_id,
        distance_threshold=request.distance_threshold,
        distance_function=request.distance_function,
        scope=access.scope,
    )

    return SemanticSearchResponse(
        query=request.query,
        results=[r.to_dict() for r in results],
        total_found=len(results),
        infospace_id=infospace_id
    )


@router.delete("/infospaces/{infospace_id}/embeddings", response_model=Message)
async def clear_infospace_embeddings(
    session: SessionDep,
    access: Access = Requires(Capability.SETUP),
):
    """
    Clear all embeddings for an infospace.
    Useful when changing embedding models or resetting the vector store.
    """
    from sqlalchemy import delete as sa_delete
    from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

    infospace_id = access.infospace_id

    chunks_query = (
        select(AssetChunk.id)
        .join(Asset)
        .where(Asset.infospace_id == infospace_id)
    )
    chunk_ids = [r for r in session.exec(chunks_query).all()]

    if not chunk_ids:
        return Message(message="No embeddings found to clear")

    for chunk_id in chunk_ids:
        chunk = session.get(AssetChunk, chunk_id)
        if chunk:
            chunk.embedding_model_id = None
            for dim in EMBEDDING_SUPPORTED_DIMS:
                setattr(chunk, f"embedding_{dim}", None)
            session.add(chunk)

    session.commit()
    logger.info("Cleared embeddings for %d chunks in infospace %d", len(chunk_ids), infospace_id)

    return Message(message=f"Cleared embeddings for {len(chunk_ids)} chunks")


class DiscoverModelsRequest(BaseModel):
    """Request for discovering embedding models with runtime API keys."""
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for providers")


@router.post("/embeddings/models/discover", response_model=AvailableModelsResponse)
async def discover_embedding_models(
    request: DiscoverModelsRequest,
    current_user: CurrentUser
):
    """
    Discover available embedding models from all providers.

    Supports runtime API key injection from frontend for cloud providers.
    """
    from app.api.modules.foundation_service_providers.base import (
        EmbeddingProvider as EmbeddingProviderProtocol,
        EmbeddingModelSpec,
    )
    from app.api.modules.foundation_service_providers.registry import list_providers, get_provider
    from app.core.config import settings

    descriptors = list_providers(EmbeddingProviderProtocol)

    model_infos = []
    for provider_key, desc in descriptors:
        reachable = False
        if not desc.requires_api_key:
            reachable = True
        elif request.api_keys and desc.credential_key and desc.credential_key in request.api_keys:
            reachable = True
        elif desc.api_key_setting and getattr(settings, desc.api_key_setting, None):
            reachable = True

        if not reachable:
            continue

        if desc.models:
            for spec in desc.models:
                if isinstance(spec, EmbeddingModelSpec):
                    model_infos.append(EmbeddingModelInfo(
                        name=spec.name,
                        provider=provider_key,
                        dimension=spec.dimension,
                        description=spec.description or None,
                        max_sequence_length=spec.max_sequence_length,
                    ))
                else:
                    model_infos.append(EmbeddingModelInfo(
                        name=spec.name,
                        provider=provider_key,
                        dimension=0,
                        description=spec.description or None,
                    ))
        else:
            try:
                api_key_override = None
                if request.api_keys and desc.credential_key:
                    api_key_override = request.api_keys.get(desc.credential_key)
                provider = get_provider(
                    EmbeddingProviderProtocol, provider_key, settings,
                    api_key_override=api_key_override,
                )
                raw_models = []
                if hasattr(provider, "discover_models"):
                    raw_models = await provider.discover_models()
                elif hasattr(provider, "get_available_models"):
                    raw_models = provider.get_available_models()
                for m in raw_models:
                    model_infos.append(EmbeddingModelInfo(
                        name=m["name"],
                        provider=provider_key,
                        dimension=m.get("dimension", 0),
                        description=m.get("description"),
                        max_sequence_length=m.get("max_sequence_length"),
                    ))
            except Exception as disc_err:
                logger.warning("Runtime model discovery failed for %s: %s", provider_key, disc_err)

    return AvailableModelsResponse(models=model_infos)
