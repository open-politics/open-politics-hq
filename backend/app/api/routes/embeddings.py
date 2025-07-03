import logging
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session

from app.api.deps import (
    SessionDep,
    CurrentUser,
    EmbeddingProviderDep
)
from app.api.services.embedding_service import EmbeddingService
from app.models import EmbeddingModel, EmbeddingProvider, AssetChunk
from app.schemas import (
    EmbeddingModelRead,
    EmbeddingModelCreate,
    EmbeddingSearchRequest,
    EmbeddingSearchResponse,
    EmbeddingGenerateRequest,
    EmbeddingStatsResponse
)

router = APIRouter()
logger = logging.getLogger(__name__)

def get_embedding_service(
    session: SessionDep,
    embedding_provider: EmbeddingProviderDep
) -> EmbeddingService:
    """Dependency to get embedding service."""
    return EmbeddingService(session, embedding_provider)

@router.get("/models", response_model=List[EmbeddingModelRead])
async def list_embedding_models(
    current_user: CurrentUser,
    embedding_service: EmbeddingService = Depends(get_embedding_service),
    active_only: bool = Query(True, description="Only return active models")
):
    """List all available embedding models."""
    try:
        models = embedding_service.list_embedding_models(active_only=active_only)
        return models
    except Exception as e:
        logger.error(f"Error listing embedding models: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to list embedding models"
        )

@router.get("/models/available")
async def get_available_models(
    current_user: CurrentUser,
    embedding_provider: EmbeddingProviderDep
):
    """Get available models from the current embedding provider."""
    try:
        models = embedding_provider.get_available_models()
        return {"models": models}
    except Exception as e:
        logger.error(f"Error getting available models: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get available models from provider"
        )

@router.post("/models", response_model=EmbeddingModelRead)
async def create_embedding_model(
    model_data: EmbeddingModelCreate,
    current_user: CurrentUser,
    embedding_service: EmbeddingService = Depends(get_embedding_service)
):
    """Create a new embedding model."""
    try:
        model = embedding_service.get_or_create_embedding_model(
            name=model_data.name,
            provider=model_data.provider,
            dimension=model_data.dimension,
            description=model_data.description,
            config=model_data.config
        )
        return model
    except Exception as e:
        logger.error(f"Error creating embedding model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create embedding model: {str(e)}"
        )

@router.get("/models/{model_id}/stats", response_model=EmbeddingStatsResponse)
async def get_embedding_model_stats(
    model_id: int,
    current_user: CurrentUser,
    embedding_service: EmbeddingService = Depends(get_embedding_service)
):
    """Get statistics for an embedding model."""
    try:
        stats = embedding_service.get_embedding_stats(model_id)
        if not stats or "error" in stats:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Embedding model not found or error getting stats"
            )
        return stats
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting embedding model stats: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to get embedding model statistics"
        )

@router.post("/generate")
async def generate_embeddings(
    request: EmbeddingGenerateRequest,
    current_user: CurrentUser,
    session: SessionDep,
    embedding_service: EmbeddingService = Depends(get_embedding_service)
):
    """Generate embeddings for a list of asset chunks."""
    try:
        # Get the chunks
        chunks = []
        for chunk_id in request.chunk_ids:
            chunk = session.get(AssetChunk, chunk_id)
            if chunk:
                chunks.append(chunk)
            else:
                logger.warning(f"Chunk {chunk_id} not found")
        
        if not chunks:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No valid chunks found"
            )
        
        # Generate and store embeddings
        stored_count, error_count = await embedding_service.generate_and_store_embeddings(
            chunks=chunks,
            model_name=request.model_name,
            provider=request.provider
        )
        
        return {
            "message": f"Generated embeddings for {stored_count} chunks",
            "stored_count": stored_count,
            "error_count": error_count,
            "total_chunks": len(request.chunk_ids)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error generating embeddings: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to generate embeddings: {str(e)}"
        )

@router.post("/search", response_model=EmbeddingSearchResponse)
async def similarity_search(
    request: EmbeddingSearchRequest,
    current_user: CurrentUser,
    embedding_service: EmbeddingService = Depends(get_embedding_service)
):
    """Perform similarity search using embeddings."""
    try:
        results = await embedding_service.similarity_search(
            query_text=request.query_text,
            model_name=request.model_name,
            provider=request.provider,
            limit=request.limit,
            distance_threshold=request.distance_threshold,
            distance_function=request.distance_function
        )
        
        return EmbeddingSearchResponse(
            query_text=request.query_text,
            results=results,
            model_name=request.model_name,
            distance_function=request.distance_function
        )
        
    except Exception as e:
        logger.error(f"Error performing similarity search: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to perform similarity search: {str(e)}"
        )

@router.post("/embed-text")
async def embed_text(
    text: str,
    model_name: str,
    provider: EmbeddingProvider,
    current_user: CurrentUser,
    embedding_provider: EmbeddingProviderDep
):
    """Generate embedding for a single text (utility endpoint)."""
    try:
        embedding = await embedding_provider.embed_single(text, model_name)
        
        return {
            "text": text,
            "model_name": model_name,
            "provider": provider,
            "embedding": embedding,
            "dimension": len(embedding) if embedding else 0
        }
        
    except Exception as e:
        logger.error(f"Error embedding text: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to embed text: {str(e)}"
        )

@router.delete("/models/{model_id}")
async def deactivate_embedding_model(
    model_id: int,
    current_user: CurrentUser,
    session: SessionDep
):
    """Deactivate an embedding model (soft delete)."""
    try:
        model = session.get(EmbeddingModel, model_id)
        if not model:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Embedding model not found"
            )
        
        model.is_active = False
        session.add(model)
        session.commit()
        
        return {"message": f"Embedding model {model_id} deactivated successfully"}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error deactivating embedding model: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to deactivate embedding model"
        ) 