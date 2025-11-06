"""
API Routes for Embedding Management
"""
import logging
from typing import List, Optional, Dict
from datetime import datetime
from fastapi import APIRouter, HTTPException, Query
from sqlmodel import Session

from app.api.deps import CurrentUser, SessionDep
from app.models import User, Infospace, Asset, AssetKind
from app.schemas import Message
from app.api.services.embedding_service import EmbeddingService
from app.api.services.vector_search_service import VectorSearchService
from app.api.tasks.embed import embed_asset_task, embed_infospace_task
from app.api.providers.impl.embedding_ollama import OllamaEmbeddingProvider
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


# ======================== REQUEST/RESPONSE SCHEMAS ========================

class GenerateEmbeddingsRequest(BaseModel):
    """Request to generate embeddings for an infospace."""
    overwrite: bool = Field(default=False, description="Regenerate existing embeddings")
    asset_kinds: Optional[List[str]] = Field(default=None, description="Filter by asset types")
    async_processing: bool = Field(default=True, description="Process in background")
    api_keys: Optional[Dict[str, str]] = Field(default=None, description="Runtime API keys for cloud providers")


class GenerateAssetEmbeddingsRequest(BaseModel):
    """Request to generate embeddings for a single asset."""
    overwrite: bool = Field(default=False, description="Regenerate existing embeddings")
    async_processing: bool = Field(default=True, description="Process in background")


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
    Uses the infospace's configured embedding model.
    
    For cloud providers (OpenAI, Voyage AI, Jina AI), API keys must be provided
    in the request. Background processing is supported for all providers by passing
    API keys to the Celery worker.
    """
    # Verify infospace exists and user has access
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")
    
    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized to access this infospace")
    
    if not infospace.embedding_model:
        raise HTTPException(
            status_code=400,
            detail="Infospace has no embedding model configured. Set embedding_model in infospace settings."
        )
    
    if request.async_processing:
        # Start background task (uses stored credentials)
        embed_infospace_task.delay(
            infospace_id=infospace_id,
            user_id=current_user.id,
            overwrite=request.overwrite,
            asset_kinds=request.asset_kinds
        )
        return Message(message=f"Embedding generation started in background for infospace {infospace_id}")
    else:
        # Synchronous processing (supports runtime + stored credentials)
        service = EmbeddingService(
            session,
            user_id=current_user.id,
            runtime_api_keys=request.api_keys
        )
        
        # Convert asset_kinds strings to enum
        kinds = None
        if request.asset_kinds:
            kinds = [AssetKind(kind) for kind in request.asset_kinds]
        
        result = await service.generate_embeddings_for_infospace(
            infospace_id=infospace_id,
            overwrite=request.overwrite,
            asset_kinds=kinds
        )
        
        return Message(
            message=(
                f"Generated embeddings for {result['assets_processed']} assets: "
                f"{result['chunks_created']} chunks created, "
                f"{result['embeddings_generated']} embeddings generated"
            )
        )


@router.post("/assets/{asset_id}/embeddings/generate", response_model=Message)
async def generate_asset_embeddings(
    asset_id: int,
    request: GenerateAssetEmbeddingsRequest,
    session: SessionDep,
    current_user: CurrentUser
):
    """
    Generate embeddings for a single asset.
    """
    # Verify asset exists and user has access
    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    
    infospace = session.get(Infospace, asset.infospace_id)
    if not infospace:
        raise HTTPException(status_code=404, detail="Infospace not found")
    
    if infospace.owner_id != current_user.id and not current_user.is_superuser:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    if not infospace.embedding_model:
        raise HTTPException(
            status_code=400,
            detail="Infospace has no embedding model configured"
        )
    
    if request.async_processing:
        # Start background task (uses stored credentials)
        embed_asset_task.delay(
            asset_id=asset_id,
            infospace_id=infospace.id,
            user_id=current_user.id,
            overwrite=request.overwrite
        )
        return Message(message=f"Embedding generation started for asset {asset_id}")
    else:
        # Synchronous processing (supports runtime + stored credentials)
        service = EmbeddingService(
            session,
            user_id=current_user.id,
            runtime_api_keys=request.api_keys
        )
        result = await service.generate_embeddings_for_asset(
            asset_id=asset_id,
            infospace_id=infospace.id,
            overwrite=request.overwrite
        )
        
        return Message(
            message=(
                f"Generated embeddings for asset {asset_id}: "
                f"{result['chunks_created']} chunks created, "
                f"{result['embeddings_generated']} embeddings generated"
            )
        )


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
    
    if not infospace.embedding_model:
        raise HTTPException(
            status_code=400,
            detail="Infospace has no embedding model configured. Cannot perform semantic search."
        )
    
    # Convert asset_kinds strings to enum
    kinds = None
    if request.asset_kinds:
        try:
            kinds = [AssetKind(kind) for kind in request.asset_kinds]
        except ValueError as e:
            raise HTTPException(status_code=400, detail=f"Invalid asset kind: {e}")
    
    # Perform search
    service = VectorSearchService(session, runtime_api_keys=request.api_keys)
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
        # Clear embeddings from all chunks in this infospace
        from sqlalchemy import select
        chunks_query = (
            select(AssetChunk.id)
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
        )
        chunk_ids = session.exec(chunks_query).all()
        
        if chunk_ids:
            # Clear embedding data
            for chunk_id in chunk_ids:
                chunk = session.get(AssetChunk, chunk_id)
                if chunk:
                    chunk.embedding_json = None
                    chunk.embedding_model_id = None
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
        from app.api.providers.factory import get_embedding_registry
        
        registry = get_embedding_registry()
        
        # Discover models from all providers
        provider_models = await registry.discover_all_models(
            runtime_api_keys=request.api_keys,
            force_refresh=False
        )
        
        # Flatten to single list
        all_models = []
        for provider_name, models in provider_models.items():
            all_models.extend(models)
        
        model_infos = [
            EmbeddingModelInfo(
                name=m["name"],
                provider=m["provider"],
                dimension=m["dimension"],
                description=m.get("description"),
                max_sequence_length=m.get("max_sequence_length")
            )
            for m in all_models
        ]
        
        return AvailableModelsResponse(models=model_infos)
        
    except Exception as e:
        logger.error(f"Failed to discover embedding models: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to discover models: {str(e)}")


@router.get("/embeddings/models", response_model=AvailableModelsResponse)
async def list_available_embedding_models(
    current_user: CurrentUser
):
    """
    List available embedding models from Ollama (legacy endpoint).
    
    Note: This endpoint only returns Ollama models. Use POST /embeddings/models/discover
    with runtime API keys to get models from all providers.
    """
    try:
        provider = OllamaEmbeddingProvider()
        models = await provider.discover_models()
        
        model_infos = [
            EmbeddingModelInfo(
                name=m["name"],
                provider=m["provider"],
                dimension=m["dimension"],
                description=m.get("description"),
                max_sequence_length=m.get("max_sequence_length")
            )
            for m in models
        ]
        
        return AvailableModelsResponse(models=model_infos)
        
    except Exception as e:
        logger.error(f"Failed to discover embedding models: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to discover models: {str(e)}")
