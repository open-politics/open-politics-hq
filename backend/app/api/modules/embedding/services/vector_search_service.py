"""
Vector Search Service - Semantic search using embeddings
"""
import logging
from typing import List, Dict, Any, Optional
from datetime import datetime
from sqlmodel import Session, select
from sqlalchemy import text

from app.models import Asset, AssetChunk, Infospace, EmbeddingModel, AssetKind
from app.api.modules.content.models import get_embedding_column_for_dimension

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

    def __init__(
        self,
        session: Session,
        runtime_api_keys: Optional[Dict[str, str]] = None,
        user_id: Optional[int] = None,
    ):
        self.session = session
        self.runtime_api_keys = runtime_api_keys or {}
        self.user_id = user_id

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
        distance_function: str = "cosine",
        embedding_model_id: Optional[int] = None,
    ) -> List[SearchResult]:
        """
        Perform semantic search using vector embeddings.

        Args:
            query_text: Search query text
            infospace_id: Infospace to search within
            limit: Maximum number of results
            embedding_model_id: Optional. When provided, use this model for query and chunk filter instead of infospace's model.
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
        # Load infospace (always needed for embedding_selection)
        infospace = self.session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")

        # Resolve embedding model: explicit id or from infospace's embedding_selection
        if embedding_model_id is not None:
            embedding_model = self.session.get(EmbeddingModel, embedding_model_id)
            if not embedding_model:
                raise ValueError(f"Embedding model {embedding_model_id} not found")
            model_name = embedding_model.name
            type_key = embedding_model.provider
        else:
            sel = infospace.embedding_selection
            if isinstance(sel, dict):
                from app.api.modules.foundation_service_providers.base import ProviderSelection
                sel = ProviderSelection(**sel)
            if not sel or not sel.model_name:
                raise ValueError(f"Infospace {infospace_id} has no embedding configured")
            model_name = sel.model_name
            type_key = sel.type_key
            embedding_model = None

        # Resolve provider via registry
        from app.api.modules.foundation_service_providers.base import EmbeddingProvider as EmbeddingProviderProtocol
        from app.api.modules.foundation_service_providers.registry import resolve, load_credentials
        from app.core.config import settings as app_settings

        credentials = load_credentials(self.session, self.user_id, self.runtime_api_keys) if self.user_id else (self.runtime_api_keys or {})
        provider = resolve(EmbeddingProviderProtocol, type_key, app_settings, credentials)
        if not provider:
            raise ValueError(f"No embedding provider available for '{type_key}'")

        provider_name = type_key
        logger.info(f"Using provider '{provider_name}' for query embedding with model '{model_name}'")

        # Generate query embedding
        try:
            query_embedding = await provider.embed_single(query_text, model_name)
        except Exception as e:
            logger.error(f"Failed to generate query embedding: {e}")
            raise RuntimeError(f"Failed to generate query embedding: {str(e)}")

        # Get embedding model for filtering (if not already resolved)
        if embedding_model is None:
            embedding_model = self.session.exec(
                select(EmbeddingModel)
                .where(EmbeddingModel.name == model_name)
                .where(EmbeddingModel.provider == provider_name.lower())
            ).first()

        if not embedding_model:
            # Auto-register if missing (e.g., after clearing embeddings)
            logger.info(f"Embedding model '{model_name}' ({provider_name}) not in DB. Auto-registering...")
            try:
                from app.api.modules.embedding.services.embedding_service import EmbeddingService
                embedding_service = EmbeddingService(
                    self.session,
                    runtime_api_keys=self.runtime_api_keys
                )
                embedding_model = await embedding_service.ensure_embedding_model_registered(
                    provider=provider_name,
                    model_name=model_name,
                )
            except Exception as e:
                raise ValueError(
                    f"Embedding model {model_name} ({provider_name}) not found and could not be "
                    f"auto-registered: {e}. Run embedding generation first."
                )

        # Use indexed pgvector column for search (HNSW)
        dim = embedding_model.dimension
        col_name = get_embedding_column_for_dimension(dim)
        if not col_name:
            raise ValueError(
                f"Embedding dimension {dim} not supported for search. "
                f"Supported: 384, 512, 768, 1024, 1536."
            )
        query_vec_str = "[" + ",".join(str(x) for x in query_embedding) + "]"

        # Build WHERE clauses for optional filters
        extra_where = []
        params = {
            "query_vec": query_vec_str,
            "infospace_id": infospace_id,
            "embedding_model_id": embedding_model.id,
            "limit": limit,
        }
        if asset_kinds:
            extra_where.append("a.kind = ANY(:asset_kinds)")
            params["asset_kinds"] = [k.value for k in asset_kinds]
        if date_from:
            extra_where.append("a.created_at >= :date_from")
            params["date_from"] = date_from
        if date_to:
            extra_where.append("a.created_at <= :date_to")
            params["date_to"] = date_to
        if bundle_id is not None:
            extra_where.append("a.bundle_id = :bundle_id")
            params["bundle_id"] = bundle_id
        if parent_asset_id is not None:
            extra_where.append("a.parent_asset_id = :parent_asset_id")
            params["parent_asset_id"] = parent_asset_id
        extra_sql = " AND " + " AND ".join(extra_where) if extra_where else ""

        sql = text(f"""
            SELECT c.id as chunk_id, c.asset_id, a.id as asset_id,
                   (c.{col_name} <=> :query_vec::vector) as distance
            FROM assetchunk c
            JOIN asset a ON c.asset_id = a.id
            WHERE a.infospace_id = :infospace_id
              AND c.embedding_model_id = :embedding_model_id
              AND c.{col_name} IS NOT NULL
              {extra_sql}
            ORDER BY c.{col_name} <=> :query_vec::vector
            LIMIT :limit
        """)

        rows = self.session.exec(sql, params).all()
        if not rows:
            return []

        # Apply distance threshold in Python (simpler than SQL for optional param)
        search_results = []
        for row in rows:
            distance = float(row.distance)
            if distance_threshold is not None and distance > distance_threshold:
                continue
            similarity = 1.0 - distance if distance_function == "cosine" else distance
            chunk = self.session.get(AssetChunk, row.chunk_id)
            asset = self.session.get(Asset, row.asset_id)
            if chunk and asset:
                search_results.append(
                    SearchResult(chunk=chunk, asset=asset, similarity=similarity, distance=distance)
                )

        logger.info(
            f"Semantic search in infospace {infospace_id}: "
            f"query='{query_text[:50]}...', found {len(search_results)} results (pgvector indexed)"
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
