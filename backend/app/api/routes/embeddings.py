"""
API Routes for Embedding Management
"""
import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException
from sqlmodel import select

from app.api.dependency_injection import CurrentUser, SessionDep
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
from app.models import Asset, AssetKind
from app.schemas import Message
from app.api.modules.embedding import embed as embed_mod
from app.api.modules.foundation_service_providers import get_configured_foundation_provider
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



# ======================== ENDPOINTS ========================

@router.post("/infospaces/{infospace_id}/embeddings/generate", response_model=Message)
async def generate_infospace_embeddings(
    request: GenerateEmbeddingsRequest,
    session: SessionDep,
    access: Access = Requires(Capability.COMPUTE, scope=None),
):
    """
    Generate embeddings for all assets in an infospace.
    Dispatches the embedding enricher for eligible assets.
    """
    infospace_id = access.infospace_id
    infospace = access.infospace

    sel = get_configured_foundation_provider(session, infospace_id, "embedding")
    if not sel or not sel.model_name:
        raise HTTPException(status_code=400, detail="No embedding provider configured. Select a model in infospace settings or your user provider defaults.")

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
        embed_mod.reset_for_assets(session, asset_ids)

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

    sel = get_configured_foundation_provider(session, infospace.id, "embedding")
    if not sel or not sel.model_name:
        raise HTTPException(status_code=400, detail="No embedding provider configured for this infospace or user")

    if request.overwrite:
        embed_mod.reset_for_assets(session, [asset_id])

    from app.api.modules.content.enrichers import enrich_embedding
    enrich_embedding.delay([asset_id], infospace.id)
    return Message(message=f"Embedding generation dispatched for asset {asset_id}")


@router.get("/infospaces/{infospace_id}/embeddings/stats", response_model=EmbeddingStatsResponse)
async def get_embedding_stats(
    session: SessionDep,
    access: Access = Requires(scope=None),
):
    """Get statistics about embedding coverage in an infospace."""
    # Stats are infospace-wide aggregates — not meaningful for scoped access
    if access.scope:
        return EmbeddingStatsResponse(
            total_assets=0, documents=0, sub_assets=0,
            total_chunks=0, embedded_chunks=0, coverage_percentage=0.0, models_used={},
        )
    infospace_id = access.infospace_id
    stats = embed_mod.embedding_stats(session, infospace_id)

    return EmbeddingStatsResponse(**stats)


@router.delete("/infospaces/{infospace_id}/embeddings", response_model=Message)
async def clear_infospace_embeddings(
    session: SessionDep,
    access: Access = Requires(Capability.SETUP, scope=None),
):
    """
    Clear all embeddings for an infospace.
    Useful when changing embedding models or resetting the vector store.
    """
    infospace_id = access.infospace_id
    count = embed_mod.clear_embeddings(session, infospace_id)
    if count == 0:
        return Message(message="No embeddings found to clear")
    return Message(message=f"Cleared embeddings for {count} chunks")


class DiscoverModelsRequest(BaseModel):
    """Request for discovering embedding models with an optional BYOK key."""
    provider_key: Optional[str] = Field(default=None, description="Probe this specific provider (required for runtime probe)")
    runtime_key: Optional[str] = Field(default=None, description="BYOK key for the provider being probed")


@router.post("/infospaces/{infospace_id}/embeddings/models/discover", response_model=AvailableModelsResponse)
async def discover_embedding_models(
    request: DiscoverModelsRequest,
    session: SessionDep,
    access: Access = Requires(Capability.SETUP, scope=None),
):
    """
    Discover available embedding models.

    Default: enumerate statically-declared models across all embedding providers.
    With ``provider_key``: probe that provider's runtime models (uses infospace
    owner's stored credentials or the supplied BYOK runtime_key).
    """
    from app.api.modules.foundation_service_providers import (
        list_providers, list_models, ProviderError, EmbeddingModelSpec,
    )

    def entry(spec, provider_key: str) -> EmbeddingModelInfo:
        return EmbeddingModelInfo(
            name=spec.name,
            provider=provider_key,
            dimension=spec.dimension,
            description=spec.description or None,
            max_sequence_length=spec.max_sequence_length,
        )

    # One endpoint: its curated models, then whatever it reports live. For a
    # local endpoint the live half is the only half that exists — nothing can
    # declare ahead of time which models an operator happens to have pulled.
    if request.provider_key:
        try:
            specs = await list_models(
                "embedding", request.provider_key,
                infospace_id=access.infospace_id,
                runtime_key=request.runtime_key,
                session=session,
            )
        except ProviderError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return AvailableModelsResponse(models=[
            entry(s, request.provider_key)
            for s in specs if isinstance(s, EmbeddingModelSpec)
        ])

    # Every provider's curated models.
    return AvailableModelsResponse(models=[
        entry(spec, provider_key)
        for provider_key, desc in list_providers("embedding")
        for spec in desc.models
        if isinstance(spec, EmbeddingModelSpec)
    ])
