"""
Embedding Service - Coordinates embedding generation and storage
"""
import logging
from typing import List, Dict, Any, Optional
from sqlmodel import Session, select
from sqlalchemy import func

from app.models import Asset, AssetChunk, Infospace, EmbeddingModel, EmbeddingProvider as EmbeddingProviderEnum, AssetKind, User
from app.api.services.chunking_service import ChunkingService
from app.api.providers.impl.embedding_ollama import OllamaEmbeddingProvider
from app.core.security import merge_credentials

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
        
        # Legacy providers for backward compatibility
        self.providers = {
            "ollama": OllamaEmbeddingProvider()
        }
    
    def _get_all_api_keys(self) -> Dict[str, str]:
        """
        Get all API keys (runtime + stored), with runtime taking precedence.
        
        This enables dual-mode:
        - Immediate operations: Use runtime keys from frontend
        - Background tasks: Use stored encrypted keys
        - Runtime keys always override stored (user intent)
        """
        if not self.user_id:
            return self.runtime_api_keys
        
        user = self.session.get(User, self.user_id)
        if not user:
            return self.runtime_api_keys
        
        # Merge: stored + runtime (runtime takes precedence)
        return merge_credentials(user.encrypted_credentials, self.runtime_api_keys)
    
    async def _get_provider(self, provider_name: str, model_name: Optional[str] = None):
        """
        Get embedding provider instance with automatic credential resolution.
        
        Uses merged credentials (stored + runtime) for provider creation.
        """
        # Get all available API keys (merged stored + runtime)
        api_keys = self._get_all_api_keys()
        
        # Try registry-based provider resolution
        if api_keys or provider_name.lower() != "ollama":
            try:
                from app.api.providers.factory import get_embedding_registry
                registry = get_embedding_registry()
                
                # If we have a model name, use it to find the right provider
                if model_name:
                    provider, resolved_provider_name = await registry.get_provider_for_model(
                        model_name,
                        runtime_api_keys=api_keys
                    )
                    if provider:
                        return provider
                
                # Otherwise, try to create provider by name
                return registry.create_provider(provider_name, api_keys.get(provider_name))
                
            except Exception as e:
                logger.warning(f"Failed to get provider from registry: {e}, falling back to legacy")
        
        # Fall back to legacy provider lookup
        provider = self.providers.get(provider_name.lower())
        if not provider:
            raise ValueError(f"Unknown embedding provider: {provider_name}")
        return provider
    
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
            .where(EmbeddingModel.provider == EmbeddingProviderEnum(provider.lower()))
        ).first()
        
        if existing:
            return existing
        
        # Auto-detect dimension if not provided
        if dimension is None:
            provider_instance = await self._get_provider(provider, model_name)
            dimension = provider_instance.get_model_dimension(model_name)
        
        # Create new model record
        embedding_model = EmbeddingModel(
            name=model_name,
            provider=EmbeddingProviderEnum(provider.lower()),
            dimension=dimension,
            description=f"{provider} {model_name}",
            is_active=True
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
        
        # Store embeddings
        success_count = 0
        for chunk, embedding in zip(chunks, embeddings):
            chunk.embedding_json = embedding
            chunk.embedding_model_id = embedding_model.id
            self.session.add(chunk)
            success_count += 1
        
        self.session.commit()
        logger.info(f"Generated embeddings for {success_count} chunks using {model_name}")
        return success_count
    
    async def generate_embeddings_for_asset(
        self,
        asset_id: int,
        infospace_id: int,
        overwrite: bool = False
    ) -> Dict[str, Any]:
        """
        Generate embeddings for a single asset using infospace configuration.
        
        Strategy:
        - If asset is a container with children, embed each child
        - If asset is a container without children, embed parent
        - Always chunk first if chunks don't exist
        
        Returns:
            Dict with statistics (chunks_created, embeddings_generated)
        """
        # Fetch asset
        asset = self.session.get(Asset, asset_id)
        if not asset:
            raise ValueError(f"Asset {asset_id} not found")
        
        # Fetch infospace for configuration
        infospace = self.session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")
        
        if not infospace.embedding_model:
            raise ValueError(f"Infospace {infospace_id} has no embedding model configured")
        
        # Determine the correct provider for this model
        try:
            from app.api.providers.factory import get_embedding_registry
            registry = get_embedding_registry()
            _, provider_name = await registry.get_provider_for_model(
                infospace.embedding_model,
                runtime_api_keys=self.runtime_api_keys
            )
            logger.info(f"Using provider '{provider_name}' for embedding asset {asset_id} with model '{infospace.embedding_model}'")
        except Exception as e:
            logger.warning(f"Failed to determine provider for model {infospace.embedding_model}, defaulting to ollama: {e}")
            provider_name = "ollama"
        
        # Determine which assets to embed
        assets_to_embed = []
        
        if asset.is_container and asset.children_assets:
            # Container with children: embed children
            assets_to_embed = [child for child in asset.children_assets if child.text_content]
            logger.debug(f"Asset {asset_id} is container with {len(assets_to_embed)} children to embed")
        else:
            # Leaf asset or container without children: embed self
            if asset.text_content:
                assets_to_embed = [asset]
            else:
                logger.warning(f"Asset {asset_id} has no text content to embed")
                return {"chunks_created": 0, "embeddings_generated": 0}
        
        total_chunks_created = 0
        total_embeddings_generated = 0
        
        # Process each asset
        for target_asset in assets_to_embed:
            # Step 1: Ensure chunks exist
            existing_chunks = self.session.exec(
                select(AssetChunk).where(AssetChunk.asset_id == target_asset.id)
            ).all()
            
            if not existing_chunks:
                # Create chunks
                chunks = self.chunking_service.chunk_asset(
                    asset=target_asset,
                    strategy=infospace.chunk_strategy or "token",
                    chunk_size=infospace.chunk_size or 512,
                    chunk_overlap=infospace.chunk_overlap or 50,
                    overwrite_existing=False
                )
                total_chunks_created += len(chunks)
            else:
                chunks = existing_chunks
            
            # Step 2: Generate embeddings for chunks that don't have them
            chunks_to_embed = []
            for chunk in chunks:
                if overwrite or chunk.embedding_json is None:
                    chunks_to_embed.append(chunk.id)
            
            if chunks_to_embed:
                embedded_count = await self.generate_embeddings_for_chunks(
                    chunk_ids=chunks_to_embed,
                    model_name=infospace.embedding_model,
                    provider=provider_name
                )
                total_embeddings_generated += embedded_count
        
        logger.info(
            f"Asset {asset_id} embedding complete: "
            f"{total_chunks_created} chunks created, {total_embeddings_generated} embeddings generated"
        )
        
        return {
            "chunks_created": total_chunks_created,
            "embeddings_generated": total_embeddings_generated
        }
    
    async def generate_embeddings_for_infospace(
        self,
        infospace_id: int,
        overwrite: bool = False,
        asset_kinds: Optional[List[AssetKind]] = None
    ) -> Dict[str, Any]:
        """
        Generate embeddings for all assets in an infospace.
        
        Args:
            infospace_id: Infospace ID
            overwrite: Whether to regenerate existing embeddings
            asset_kinds: Optional filter for specific asset types
        
        Returns:
            Dict with statistics
        """
        # Fetch infospace
        infospace = self.session.get(Infospace, infospace_id)
        if not infospace:
            raise ValueError(f"Infospace {infospace_id} not found")
        
        if not infospace.embedding_model:
            raise ValueError(f"Infospace {infospace_id} has no embedding model configured")
        
        # Build query for assets
        query = select(Asset).where(Asset.infospace_id == infospace_id)
        query = query.where(Asset.text_content.isnot(None))
        
        # Filter for root assets only (we'll handle children in generate_embeddings_for_asset)
        query = query.where(Asset.parent_asset_id.is_(None))
        
        if asset_kinds:
            query = query.where(Asset.kind.in_(asset_kinds))
        
        assets = self.session.exec(query).all()
        
        logger.info(f"Starting embedding generation for {len(assets)} assets in infospace {infospace_id}")
        
        total_chunks_created = 0
        total_embeddings_generated = 0
        failed_assets = []
        
        for asset in assets:
            try:
                result = await self.generate_embeddings_for_asset(
                    asset_id=asset.id,
                    infospace_id=infospace_id,
                    overwrite=overwrite
                )
                total_chunks_created += result["chunks_created"]
                total_embeddings_generated += result["embeddings_generated"]
                
            except Exception as e:
                logger.error(f"Failed to embed asset {asset.id}: {e}")
                failed_assets.append(asset.id)
                continue
        
        return {
            "infospace_id": infospace_id,
            "assets_processed": len(assets),
            "chunks_created": total_chunks_created,
            "embeddings_generated": total_embeddings_generated,
            "failed_assets": failed_assets
        }
    
    def get_embedding_stats(self, infospace_id: int) -> Dict[str, Any]:
        """
        Get statistics about embedding coverage in an infospace.
        """
        # Total assets with text content
        total_assets = self.session.exec(
            select(func.count(Asset.id))
            .where(Asset.infospace_id == infospace_id)
            .where(Asset.text_content.isnot(None))
        ).one()
        
        # Total chunks
        total_chunks = self.session.exec(
            select(func.count(AssetChunk.id))
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
        ).one()
        
        # Embedded chunks
        embedded_chunks = self.session.exec(
            select(func.count(AssetChunk.id))
            .join(Asset)
            .where(Asset.infospace_id == infospace_id)
            .where(AssetChunk.embedding_json.isnot(None))
        ).one()
        
        # Embedding models used
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
