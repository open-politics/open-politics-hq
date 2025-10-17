"""
Vector Search Service - Semantic search using embeddings
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlmodel import Session, select, col
from sqlalchemy import and_, or_

from app.models import Asset, AssetChunk, Infospace, EmbeddingModel, AssetKind, EmbeddingProvider as EmbeddingProviderEnum

logger = logging.getLogger(__name__)


class SearchResult:
    """Container for semantic search results."""
    
    def __init__(
        self,
        chunk: AssetChunk,
        asset: Asset,
        similarity: float,
        distance: float
    ):
        self.chunk_id = chunk.id
        self.chunk_index = chunk.chunk_index
        self.chunk_text = chunk.text_content
        self.chunk_metadata = chunk.chunk_metadata
        self.asset_id = asset.id
        self.asset_uuid = asset.uuid
        self.asset_title = asset.title
        self.asset_kind = asset.kind
        self.asset_created_at = asset.created_at
        self.parent_asset_id = asset.parent_asset_id
        self.similarity = similarity
        self.distance = distance
    
    def to_dict(self) -> Dict[str, Any]:
        return {
            "chunk_id": self.chunk_id,
            "chunk_index": self.chunk_index,
            "chunk_text": self.chunk_text,
            "chunk_metadata": self.chunk_metadata,
            "asset_id": self.asset_id,
            "asset_uuid": self.asset_uuid,
            "asset_title": self.asset_title,
            "asset_kind": self.asset_kind.value,
            "asset_created_at": self.asset_created_at.isoformat() if self.asset_created_at else None,
            "parent_asset_id": self.parent_asset_id,
            "similarity": round(self.similarity, 4),
            "distance": round(self.distance, 4)
        }


class VectorSearchService:
    """Service for semantic search using vector embeddings."""
    
    def __init__(self, session: Session, runtime_api_keys: Optional[Dict[str, str]] = None):
        self.session = session
        self.runtime_api_keys = runtime_api_keys or {}
    
    async def semantic_search(
        self,
        query_text: str,
        infospace_id: int,
        limit: int = 10,
        asset_kinds: Optional[List[AssetKind]] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        bundle_id: Optional[int] = None,
        parent_asset_id: Optional[int] = None,
        distance_threshold: Optional[float] = None,
        distance_function: str = "cosine"
    ) -> List[SearchResult]:
        """
        Perform semantic search using vector embeddings.

        Args:
            query_text: Search query text
            infospace_id: Infospace to search within
            limit: Maximum number of results
            asset_kinds: Filter by asset types
            date_from: Filter assets created after this date
            date_to: Filter assets created before this date
            bundle_id: Filter by bundle membership
            parent_asset_id: Filter by parent asset (for searching within specific parent assets like CSV rows)
            distance_threshold: Maximum distance for results
            distance_function: "cosine", "l2", or "inner_product"

        Returns:
            List of SearchResult objects
        """
        # Fetch infospace configuration
        infospace = self.session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")
        
        if not infospace.embedding_model:
            raise ValueError(f"Infospace {infospace_id} has no embedding model configured")
        
        # Get the appropriate embedding provider for this model
        try:
            from app.api.providers.factory import get_embedding_registry
            registry = get_embedding_registry()
            
            provider, provider_name = await registry.get_provider_for_model(
                infospace.embedding_model,
                runtime_api_keys=self.runtime_api_keys
            )
            
            if not provider:
                raise ValueError(f"No provider found for model: {infospace.embedding_model}")
            
            logger.info(f"Using provider '{provider_name}' for query embedding with model '{infospace.embedding_model}'")
            
        except Exception as e:
            logger.error(f"Failed to get provider for model {infospace.embedding_model}: {e}")
            raise RuntimeError(f"Failed to get embedding provider: {str(e)}")
        
        # Generate query embedding
        try:
            query_embedding = await provider.embed_single(
                query_text,
                infospace.embedding_model
            )
        except Exception as e:
            logger.error(f"Failed to generate query embedding: {e}")
            raise RuntimeError(f"Failed to generate query embedding: {str(e)}")
        
        # Get the embedding model for filtering
        # IMPORTANT: Must match by both name AND provider to avoid ambiguity
        # (same model name might exist for multiple providers)
        embedding_model = self.session.exec(
            select(EmbeddingModel)
            .where(EmbeddingModel.name == infospace.embedding_model)
            .where(EmbeddingModel.provider == EmbeddingProviderEnum(provider_name.lower()))
        ).first()
        
        if not embedding_model:
            logger.warning(
                f"Embedding model '{infospace.embedding_model}' with provider '{provider_name}' "
                f"not found in database. This usually means no assets have been embedded yet with this model."
            )
            raise ValueError(
                f"Embedding model {infospace.embedding_model} (provider: {provider_name}) not found in database. "
                f"Please run embedding generation for this infospace first."
            )
        
        # Build the search query using raw SQL for pgvector operations
        # We'll use cosine distance: 1 - cosine_similarity
        distance_op = self._get_distance_operator(distance_function)
        
        # Build base query
        query = select(AssetChunk, Asset)
        query = query.join(Asset, AssetChunk.asset_id == Asset.id)
        query = query.where(Asset.infospace_id == infospace_id)
        query = query.where(AssetChunk.embedding_json.isnot(None))
        query = query.where(AssetChunk.embedding_model_id == embedding_model.id)
        
        # Apply filters
        if asset_kinds:
            query = query.where(Asset.kind.in_(asset_kinds))
        
        if date_from:
            query = query.where(Asset.created_at >= date_from)
        
        if date_to:
            query = query.where(Asset.created_at <= date_to)
        
        if bundle_id:
            # Filter by bundle_id (one-to-many relationship)
            query = query.where(Asset.bundle_id == bundle_id)

        if parent_asset_id:
            # Filter by parent_asset_id (for searching within specific parent assets like CSV rows)
            query = query.where(Asset.parent_asset_id == parent_asset_id)

        # For now, we'll do distance calculation in Python since we're using embedding_json
        # In production, you'd want to use pgvector's operators directly
        results = self.session.exec(query).all()
        
        # Calculate distances and similarities
        search_results = []
        for chunk, asset in results:
            if not chunk.embedding_json:
                continue
            
            distance = self._calculate_distance(
                query_embedding,
                chunk.embedding_json,
                distance_function
            )
            
            # Apply distance threshold
            if distance_threshold and distance > distance_threshold:
                continue
            
            # Convert distance to similarity (for cosine: similarity = 1 - distance)
            similarity = 1.0 - distance if distance_function == "cosine" else distance
            
            search_results.append(SearchResult(
                chunk=chunk,
                asset=asset,
                similarity=similarity,
                distance=distance
            ))
        
        # Sort by similarity (descending) or distance (ascending)
        if distance_function == "cosine":
            search_results.sort(key=lambda x: x.similarity, reverse=True)
        else:
            search_results.sort(key=lambda x: x.distance)
        
        # Limit results
        search_results = search_results[:limit]
        
        logger.info(
            f"Semantic search in infospace {infospace_id}: "
            f"query='{query_text[:50]}...', found {len(search_results)} results"
        )
        
        return search_results
    
    def _get_distance_operator(self, distance_function: str) -> str:
        """Get the appropriate distance operator for pgvector."""
        operators = {
            "cosine": "<=>",  # Cosine distance
            "l2": "<->",      # L2 distance
            "inner_product": "<#>"  # Inner product
        }
        return operators.get(distance_function, "<=>")
    
    def _calculate_distance(
        self,
        vec1: List[float],
        vec2: List[float],
        distance_function: str
    ) -> float:
        """
        Calculate distance between two vectors.
        This is a Python fallback; production should use pgvector operators.
        """
        import numpy as np
        
        v1 = np.array(vec1)
        v2 = np.array(vec2)
        
        if distance_function == "cosine":
            # Cosine distance = 1 - cosine_similarity
            dot_product = np.dot(v1, v2)
            norm1 = np.linalg.norm(v1)
            norm2 = np.linalg.norm(v2)
            if norm1 == 0 or norm2 == 0:
                return 1.0
            cosine_sim = dot_product / (norm1 * norm2)
            return 1.0 - cosine_sim
        
        elif distance_function == "l2":
            # Euclidean distance
            return float(np.linalg.norm(v1 - v2))
        
        elif distance_function == "inner_product":
            # Negative inner product (for maximum inner product search)
            return float(-np.dot(v1, v2))
        
        else:
            raise ValueError(f"Unknown distance function: {distance_function}")

