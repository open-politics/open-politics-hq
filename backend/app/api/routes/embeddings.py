"""
API Routes for Embedding Management
"""
import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session

from app.api.dependency_injection import CurrentUser, SessionDep
from app.models import User, Infospace, Asset, AssetKind
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


# ======================== ENDPOINTS ========================

@router.post("/infospaces/{infospace_id}/embeddings/generate", response_model=Message)
async def generate_infospace_embeddings(
    infospace_id: int,
    request: GenerateEmbeddingsRequest,
    session: SessionDep,
    current_user: CurrentUser
):
    """
    Generate embeddings for all assets in an infospace.
    Dispatches background tasks using the infospace's embedding_selection.
    """
    from app.api.modules.embedding.tasks.embed import enrich_embedding_task

    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")

    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized to access this infospace")

    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured. Select a model in settings.")

    # Query embeddable asset IDs
    from sqlmodel import select
    query = select(Asset.id).where(
        Asset.infospace_id == infospace_id,
        Asset.text_content.isnot(None),
        Asset.parent_asset_id.is_(None),
    )
    if request.asset_kinds:
        query = query.where(Asset.kind.in_([AssetKind(k) for k in request.asset_kinds]))
    asset_ids = [row for row in session.exec(query).all()]

    if not asset_ids:
        return Message(message="No embeddable assets found")

    # Dispatch in batches of 50
    batch_size = 50
    for i in range(0, len(asset_ids), batch_size):
        batch = asset_ids[i : i + batch_size]
        enrich_embedding_task.delay(
            asset_ids=batch,
            user_id=current_user.id,
            api_keys=request.api_keys,
            overwrite=request.overwrite,
        )

    return Message(message=f"Embedding generation dispatched for {len(asset_ids)} assets")


@router.post("/assets/{asset_id}/embeddings/generate", response_model=Message)
async def generate_asset_embeddings(
    asset_id: int,
    request: GenerateAssetEmbeddingsRequest,
    session: SessionDep,
    current_user: CurrentUser
):
    """Generate embeddings for a single asset."""
    from app.api.modules.embedding.tasks.embed import enrich_embedding_task

    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")

    infospace = session.get(Infospace, asset.infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")

    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")

    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured")

    enrich_embedding_task.delay(
        asset_ids=[asset_id],
        user_id=current_user.id,
        api_keys=request.api_keys,
        overwrite=request.overwrite,
    )
    return Message(message=f"Embedding generation dispatched for asset {asset_id}")


@router.get("/infospaces/{infospace_id}/embeddings/stats", response_model=EmbeddingStatsResponse)
async def get_embedding_stats(
    infospace_id: int,
    session: SessionDep,
    current_user: CurrentUser
):
    """
    Get statistics about embedding coverage in an infospace.
    """
    # Verify infospace exists and user has access
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")
    
    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    service = EmbeddingService(session)
    stats = service.get_embedding_stats(infospace_id)
    
    return EmbeddingStatsResponse(**stats)


@router.post("/infospaces/{infospace_id}/embeddings/search", response_model=SemanticSearchResponse)
async def semantic_search(
    infospace_id: int,
    request: SemanticSearchRequest,
    session: SessionDep,
    current_user: CurrentUser
):
    """
    Perform semantic search within an infospace using vector embeddings.
    
    For cloud providers (OpenAI, Voyage AI, Jina AI), API keys must be provided
    in the request to generate the query embedding.
    """
    # Verify infospace exists and user has access
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")
    
    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not infospace.embedding_configured:
        raise HTTPException(status_code=400, detail="Infospace has no embedding configured")
    
    # Convert asset_kinds strings to enum
    kinds = None
    if request.asset_kinds:
        try:
            kinds = [AssetKind(kind) for kind in request.asset_kinds]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid asset kind: {e}")
    
    # Perform search
    service = VectorSearchService(session, runtime_api_keys=request.api_keys, user_id=current_user.id)
    results = await service.semantic_search(
        query_text=request.query,
        infospace_id=infospace_id,
        limit=request.limit,
        asset_kinds=kinds,
        date_from=request.date_from,
        date_to=request.date_to,
        bundle_id=request.bundle_id,
        distance_threshold=request.distance_threshold,
        distance_function=request.distance_function
    )
    
    return SemanticSearchResponse(
        query=request.query,
        results=[r.to_dict() for r in results],
        total_found=len(results),
        infospace_id=infospace_id
    )


@router.delete("/infospaces/{infospace_id}/embeddings", response_model=Message)
async def clear_infospace_embeddings(
    infospace_id: int,
    session: SessionDep,
    current_user: CurrentUser
):
    """
    Clear all embeddings for an infospace.
    Useful when changing embedding models or resetting the vector store.
    """
    from app.models import AssetChunk
    from sqlalchemy import delete
    
    # Verify infospace exists and user has access
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")
    
    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    try:
        from sqlalchemy import select
        from app.api.modules.content.models import EMBEDDING_SUPPORTED_DIMS

        chunks_query = (
            select(AssetChunk.id)
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
        )
        chunk_ids = [r[0] for r in session.exec(chunks_query).all()]

        if chunk_ids:
            for chunk_id in chunk_ids:
                chunk = session.get(AssetChunk, chunk_id)
                if chunk:
                    chunk.embedding_model_id = None
                    for dim in EMBEDDING_SUPPORTED_DIMS:
                        setattr(chunk, f"embedding_{dim}", None)
                    session.add(chunk)
            
            session.commit()
            logger.info(f"Cleared embeddings for {len(chunk_ids)} chunks in infospace {infospace_id}")
            
            return Message(message=f"Cleared embeddings for {len(chunk_ids)} chunks")
        else:
            return Message(message="No embeddings found to clear")
            
    except Exception as e:
        logger.error(f"Failed to clear embeddings: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to clear embeddings: {str(e)}")


class DiscoverModelsRequest(BaseModel):
    """Request for discovering embedding models with runtime API keys."""
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for providers")


@router.post("/embeddings/models/discover", response_model=AvailableModelsResponse)
async def discover_embedding_models(
    request: DiscoverModelsRequest,
    current_user: CurrentUser
):
    """
    Discover available embedding models from all providers with runtime API keys.
    
    This endpoint supports runtime API key injection from frontend for:
    - OpenAI: requires api_keys.openai
    - Voyage AI (Anthropic): requires api_keys.voyage
    - Jina AI: requires api_keys.jina
    - Ollama: no API key needed
    """
    try:
        from app.api.modules.foundation_service_providers.base import (
            EmbeddingProvider as EmbeddingProviderProtocol,
            EmbeddingModelSpec,
        )
        from app.api.modules.foundation_service_providers.registry import list_providers, get_provider
        from app.core.config import settings

        descriptors = list_providers(EmbeddingProviderProtocol)

        model_infos = []
        for type_key, desc in descriptors:
            # Check reachability: local providers always reachable;
            # cloud providers need runtime keys, or env-configured keys
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
                # Static model list from descriptor (OpenAI, Voyage, Jina)
                for spec in desc.models:
                    if isinstance(spec, EmbeddingModelSpec):
                        model_infos.append(EmbeddingModelInfo(
                            name=spec.name,
                            provider=type_key,
                            dimension=spec.dimension,
                            description=spec.description or None,
                            max_sequence_length=spec.max_sequence_length,
                        ))
                    else:
                        model_infos.append(EmbeddingModelInfo(
                            name=spec.name,
                            provider=type_key,
                            dimension=0,
                            description=spec.description or None,
                        ))
            else:
                # Runtime discovery for providers without static model lists (e.g. Ollama)
                try:
                    api_key_override = None
                    if request.api_keys and desc.credential_key:
                        api_key_override = request.api_keys.get(desc.credential_key)
                    provider = get_provider(
                        EmbeddingProviderProtocol, type_key, settings,
                        api_key_override=api_key_override,
                    )
                    # Prefer async discover_models() which actually queries the
                    # provider (e.g. Ollama /api/tags); fall back to the sync
                    # cache accessor only if no async method exists.
                    raw_models = []
                    if hasattr(provider, "discover_models"):
                        raw_models = await provider.discover_models()
                    elif hasattr(provider, "get_available_models"):
                        raw_models = provider.get_available_models()
                    for m in raw_models:
                        model_infos.append(EmbeddingModelInfo(
                            name=m["name"],
                            provider=type_key,
                            dimension=m.get("dimension", 0),
                            description=m.get("description"),
                            max_sequence_length=m.get("max_sequence_length"),
                        ))
                except Exception as disc_err:
                    logger.warning(f"Runtime model discovery failed for {type_key}: {disc_err}")

        return AvailableModelsResponse(models=model_infos)

    except Exception as e:
        logger.error(f"Failed to discover embedding models: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to discover models: {str(e)}")


