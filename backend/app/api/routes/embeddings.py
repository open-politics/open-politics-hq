import logging
import time
from typing import List, Optional, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, status, Query
from sqlmodel import Session

from app.api.deps import (
    SessionDep,
    CurrentUser,
    EmbeddingProviderDep,
    EmbeddingServiceDep
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

# Embedding service dependency is now handled in deps.py

@router.get("/models", response_model=List[EmbeddingModelRead])
async def list_embedding_models(
    current_user: CurrentUser,
    embedding_service: EmbeddingServiceDep,
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

@router.get("/health")
async def check_embedding_provider_health(
    current_user: CurrentUser,
    embedding_provider: EmbeddingProviderDep
):
    """Check the health of the embedding provider."""
    try:
        # Check if provider has health check method
        if hasattr(embedding_provider, 'health_check'):
            is_healthy = await embedding_provider.health_check()
            
            health_info = {
                "healthy": is_healthy,
                "provider_type": type(embedding_provider).__name__
            }
            
            # Get additional server info if available
            if hasattr(embedding_provider, 'get_server_info'):
                server_info = await embedding_provider.get_server_info()
                health_info.update(server_info)
            
            return health_info
        else:
            # Basic check - try to get available models
            models = embedding_provider.get_available_models()
            return {
                "healthy": True,
                "provider_type": type(embedding_provider).__name__,
                "models_configured": len(models)
            }
    except Exception as e:
        logger.error(f"Error checking embedding provider health: {e}")
        return {
            "healthy": False,
            "provider_type": type(embedding_provider).__name__,
            "error": str(e)
        }

@router.post("/models", response_model=EmbeddingModelRead)
async def create_embedding_model(
    model_data: EmbeddingModelCreate,
    current_user: CurrentUser,
    embedding_service: EmbeddingServiceDep
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
    embedding_service: EmbeddingServiceDep
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
    embedding_service: EmbeddingServiceDep
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
    embedding_service: EmbeddingServiceDep
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

@router.post("/test")
async def test_embedding_provider(
    current_user: CurrentUser,
    embedding_provider: EmbeddingProviderDep,
    test_text: str = "This is a test sentence for embedding generation.",
    model_name: Optional[str] = None
):
    """Test the embedding provider with a sample text."""
    try:
        # Use default model if none specified
        if not model_name:
            if hasattr(embedding_provider, 'default_model'):
                model_name = embedding_provider.default_model
            else:
                # Try to get first available model
                available_models = embedding_provider.get_available_models()
                if available_models:
                    model_name = available_models[0].get('name', 'nomic-embed-text')
                else:
                    model_name = 'nomic-embed-text'
        
        # Generate embedding
        start_time = time.time()
        embedding = await embedding_provider.embed_single(test_text, model_name)
        end_time = time.time()
        
        if embedding:
            return {
                "success": True,
                "test_text": test_text,
                "model_name": model_name,
                "dimension": len(embedding),
                "generation_time_ms": round((end_time - start_time) * 1000, 2),
                "sample_values": embedding[:5] if len(embedding) >= 5 else embedding,
                "provider_type": type(embedding_provider).__name__
            }
        else:
            return {
                "success": False,
                "error": "No embedding generated",
                "test_text": test_text,
                "model_name": model_name,
                "provider_type": type(embedding_provider).__name__
            }
            
    except Exception as e:
        logger.error(f"Error testing embedding provider: {e}")
        return {
            "success": False,
            "error": str(e),
            "test_text": test_text,
            "model_name": model_name,
            "provider_type": type(embedding_provider).__name__
        }

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