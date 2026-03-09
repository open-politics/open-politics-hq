"""
Embedding Service - Coordinates embedding generation and storage.

All provider access goes through registry.resolve(). No legacy fallbacks.
"""
import logging
from datetime import datetime
from typing import List, Dict, Any, Optional
from sqlmodel import Session, select
from sqlalchemy import func

from app.models import Asset, AssetChunk, Infospace, EmbeddingModel, AssetKind, User
from app.api.modules.content.models import get_embedding_column_for_dimension, EMBEDDING_SUPPORTED_DIMS
from app.api.modules.embedding.services.chunking_service import ChunkingService

logger = logging.getLogger(__name__)


class EmbeddingService:
    """Service for generating and managing embeddings for assets."""

    def __init__(
        self,
        session: Session,
        user_id: Optional[int] = None,
        runtime_api_keys: Optional[Dict[str, str]] = None
    ):
        self.session = session
        self.user_id = user_id
        self.chunking_service = ChunkingService(session)
        self.runtime_api_keys = runtime_api_keys or {}
        self._provider_cache: Dict[str, Any] = {}

    async def _get_provider(self, provider_name: str, model_name: Optional[str] = None):
        """Get embedding provider via registry resolve.

        Args:
            provider_name: The provider type_key (e.g. "ollama", "openai").
            model_name: Optional model name (unused for resolution, kept for error messages).
        """
        from app.api.modules.foundation_service_providers.base import EmbeddingProvider
        from app.api.modules.foundation_service_providers.registry import resolve, load_credentials
        from app.core.config import settings

        credentials = load_credentials(self.session, self.user_id, self.runtime_api_keys) if self.user_id else self.runtime_api_keys
        provider = resolve(EmbeddingProvider, provider_name, settings, credentials)
        if provider:
            return provider

        raise ValueError(
            f"No embedding provider available for '{provider_name}'. "
            f"Check that the relevant API key is configured or that the system "
            f"embedding provider is set up."
        )

    async def ensure_embedding_model_registered(
        self,
        provider: str,
        model_name: str,
        dimension: Optional[int] = None
    ) -> EmbeddingModel:
        """
        Ensure an embedding model is registered in the database.
        Auto-detects dimension if not provided.
        """
        # Check if model already exists
        existing = self.session.exec(
            select(EmbeddingModel)
            .where(EmbeddingModel.name == model_name)
            .where(EmbeddingModel.provider == provider.lower())
        ).first()

        if existing:
            return existing

        # Auto-detect dimension if not provided
        if dimension is None:
            # Try to get dimension from the descriptor's model catalog
            from app.api.modules.foundation_service_providers.registry import get_descriptor
            from app.api.modules.foundation_service_providers.base import EmbeddingProvider, EmbeddingModelSpec
            desc = get_descriptor(EmbeddingProvider, provider)
            if desc:
                spec = desc.get_model(model_name)
                if isinstance(spec, EmbeddingModelSpec):
                    dimension = spec.dimension

            # If still unknown, ask the provider (async-safe)
            if dimension is None:
                provider_instance = await self._get_provider(provider, model_name)
                # Prefer async probe if available (e.g. Ollama's _probe_model),
                # otherwise detect dimension from a test embedding.
                if hasattr(provider_instance, '_probe_model'):
                    info = await provider_instance._probe_model(model_name)
                    dimension = info.get("dimension") or 0
                if not dimension:
                    test_embedding = await provider_instance.embed_single(" ", model_name)
                    dimension = len(test_embedding)

        # Create new model record
        embedding_model = EmbeddingModel(
            name=model_name,
            provider=provider.lower(),
            dimension=dimension,
            is_active=True,
        )

        self.session.add(embedding_model)
        self.session.commit()
        self.session.refresh(embedding_model)

        logger.info(f"Registered embedding model: {model_name} ({provider}) with dimension {dimension}")
        return embedding_model

    async def generate_embeddings_for_chunks(
        self,
        chunk_ids: List[int],
        model_name: str,
        provider: str = "ollama"
    ) -> int:
        """
        Generate embeddings for specific chunks.

        Returns:
            Number of chunks successfully embedded
        """
        if not chunk_ids:
            return 0

        # Ensure model is registered
        embedding_model = await self.ensure_embedding_model_registered(provider, model_name)

        # Fetch chunks
        chunks = self.session.exec(
            select(AssetChunk).where(AssetChunk.id.in_(chunk_ids))
        ).all()

        if not chunks:
            logger.warning(f"No chunks found for IDs: {chunk_ids}")
            return 0

        # Extract text content
        texts = [chunk.text_content or "" for chunk in chunks]

        # Generate embeddings
        provider_instance = await self._get_provider(provider, model_name)
        embeddings = await provider_instance.embed_texts(texts, model_name)

        if len(embeddings) != len(chunks):
            logger.error(f"Embedding count mismatch: {len(embeddings)} vs {len(chunks)}")
            return 0

        # Store embeddings in dimension-specific vector column
        dim = embedding_model.dimension
        col_name = get_embedding_column_for_dimension(dim)
        if not col_name:
            raise ValueError(
                f"Embedding dimension {dim} not supported. "
                f"Supported: {EMBEDDING_SUPPORTED_DIMS}. "
                f"Use a model with dimension 384, 512, 768, 1024, or 1536."
            )
        if len(embeddings[0]) != dim:
            raise ValueError(f"Model {model_name} produced {len(embeddings[0])}d embeddings, expected {dim}d")

        success_count = 0
        for chunk, embedding in zip(chunks, embeddings):
            setattr(chunk, col_name, embedding)
            chunk.embedding_model_id = embedding_model.id
            self.session.add(chunk)
            success_count += 1

        self.session.commit()
        logger.info(f"Generated embeddings for {success_count} chunks using {model_name} (dim={dim})")
        return success_count

    async def similarity_search(
        self,
        query_text: str,
        model_name: str,
        provider: str,
        limit: int = 10,
        distance_threshold: Optional[float] = None,
        distance_function: str = "cosine",
        infospace_id: Optional[int] = None,
        embedding_model_id: Optional[int] = None,
        asset_kinds: Optional[List[AssetKind]] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        bundle_id: Optional[int] = None,
        parent_asset_id: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Perform vector similarity search. Delegates to VectorSearchService.

        Either infospace_id or embedding_model_id must be provided.
        When embedding_model_id is provided, infospace_id is still required to scope the search.
        """
        if not infospace_id:
            raise ValueError(
                "similarity_search requires infospace_id to scope the search. "
                "Pass infospace_filter from the RAG adapter config."
            )
        from app.api.modules.embedding.services.vector_search_service import VectorSearchService

        search_svc = VectorSearchService(self.session, runtime_api_keys=self.runtime_api_keys, user_id=self.user_id)
        results = await search_svc.semantic_search(
            query_text=query_text,
            infospace_id=infospace_id,
            limit=limit,
            distance_threshold=distance_threshold,
            distance_function=distance_function,
            embedding_model_id=embedding_model_id,
            asset_kinds=asset_kinds,
            date_from=date_from,
            date_to=date_to,
            bundle_id=bundle_id,
            parent_asset_id=parent_asset_id,
        )
        return [r.to_dict() for r in results]

    def get_embedding_stats(self, infospace_id: int) -> Dict[str, Any]:
        """Get statistics about embedding coverage in an infospace."""
        total_assets = self.session.exec(
            select(func.count(Asset.id))
            .where(Asset.infospace_id == infospace_id)
            .where(Asset.text_content.isnot(None))
        ).one()

        total_chunks = self.session.exec(
            select(func.count(AssetChunk.id))
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
        ).one()

        from sqlalchemy import or_
        dim_conditions = [getattr(AssetChunk, f"embedding_{d}").isnot(None) for d in EMBEDDING_SUPPORTED_DIMS]
        embedded_chunks = self.session.exec(
            select(func.count(AssetChunk.id))
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
            .where(or_(*dim_conditions))
        ).one()

        models_used = self.session.exec(
            select(EmbeddingModel.name, func.count(AssetChunk.id))
            .join(AssetChunk)
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
            .where(AssetChunk.embedding_model_id.isnot(None))
            .group_by(EmbeddingModel.name)
        ).all()

        coverage_percentage = (embedded_chunks / total_chunks * 100) if total_chunks > 0 else 0

        return {
            "total_assets": total_assets,
            "total_chunks": total_chunks,
            "embedded_chunks": embedded_chunks,
            "coverage_percentage": round(coverage_percentage, 2),
            "models_used": {model: count for model, count in models_used}
        }
