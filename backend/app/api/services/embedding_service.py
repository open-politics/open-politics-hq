import logging
from typing import Dict, List, Optional, Any, Tuple
from sqlmodel import Session, select, text
from sqlalchemy import create_engine, Column, Index
from sqlalchemy.sql import exists
from app.models import EmbeddingModel, AssetChunk, EmbeddingProvider
from app.api.providers.base import EmbeddingProvider as EmbeddingProviderProtocol
from app.schemas import EmbeddingModelCreate
import time

logger = logging.getLogger(__name__)

class EmbeddingService:
    """Service for managing embeddings with variable dimensions."""
    
    def __init__(self, session: Session, embedding_provider: EmbeddingProviderProtocol):
        self.session = session
        self.embedding_provider = embedding_provider
        
    def get_or_create_embedding_model(
        self,
        name: str,
        provider: EmbeddingProvider,
        dimension: Optional[int] = None,
        description: Optional[str] = None,
        config: Optional[Dict[str, Any]] = None
    ) -> EmbeddingModel:
        """Get or create an embedding model record."""
        
        # Try to find existing model
        existing_model = self.session.exec(
            select(EmbeddingModel).where(
                EmbeddingModel.name == name,
                EmbeddingModel.provider == provider
            )
        ).first()
        
        if existing_model:
            return existing_model
        
        # Get dimension from provider if not specified
        if dimension is None:
            dimension = self.embedding_provider.get_model_dimension(name)
        
        # Create new model
        new_model = EmbeddingModel(
            name=name,
            provider=provider,
            dimension=dimension,
            description=description or f"{provider} embedding model {name}",
            config=config or {},
            max_sequence_length=self._get_max_sequence_length(name)
        )
        
        self.session.add(new_model)
        self.session.commit()
        self.session.refresh(new_model)
        
        # Create the embedding table for this model
        self._create_embedding_table(new_model)
        
        return new_model
    
    def _get_max_sequence_length(self, model_name: str) -> Optional[int]:
        """Get maximum sequence length for a model from provider."""
        try:
            models = self.embedding_provider.get_available_models()
            for model_info in models:
                if model_info['name'] == model_name:
                    return model_info.get('max_sequence_length')
        except Exception as e:
            logger.warning(f"Could not get max sequence length for {model_name}: {e}")
        return None
    
    def _create_embedding_table(self, model: EmbeddingModel) -> str:
        """Create a model-specific embedding table with native pgvector column."""
        table_name = f"embedding_{model.provider}_{model.name}_{model.dimension}".lower()
        table_name = table_name.replace("-", "_").replace(".", "_")
        
        # Create table with native pgvector column
        create_table_sql = f"""
        CREATE TABLE IF NOT EXISTS {table_name} (
            chunk_id INTEGER PRIMARY KEY REFERENCES assetchunk(id) ON DELETE CASCADE,
            embedding VECTOR({model.dimension}),
            created_at TIMESTAMP DEFAULT NOW()
        );
        """
        
        # Create vector index for efficient similarity search
        create_index_sql = f"""
        CREATE INDEX IF NOT EXISTS idx_{table_name}_embedding_hnsw 
        ON {table_name} USING hnsw (embedding vector_l2_ops);
        """
        
        # Create additional index for cosine similarity  
        create_cosine_index_sql = f"""
        CREATE INDEX IF NOT EXISTS idx_{table_name}_embedding_cosine 
        ON {table_name} USING hnsw (embedding vector_cosine_ops);
        """
        
        try:
            self.session.exec(text(create_table_sql))
            self.session.exec(text(create_index_sql))
            self.session.exec(text(create_cosine_index_sql))
            self.session.commit()
            logger.info(f"Created embedding table and indexes: {table_name}")
        except Exception as e:
            logger.error(f"Error creating embedding table {table_name}: {e}")
            self.session.rollback()
            raise
        
        return table_name
    
    def _get_embedding_table_name(self, model: EmbeddingModel) -> str:
        """Get the table name for a specific embedding model."""
        return f"embedding_{model.provider}_{model.name}_{model.dimension}".lower().replace("-", "_").replace(".", "_")
    
    async def generate_and_store_embeddings(
        self,
        chunks: List[AssetChunk],
        model_name: str,
        provider: EmbeddingProvider
    ) -> Tuple[int, int]:
        """Generate embeddings for chunks and store them efficiently."""
        
        if not chunks:
            return 0, 0
        
        # Get or create embedding model
        model = self.get_or_create_embedding_model(
            name=model_name,
            provider=provider
        )
        
        # Extract texts from chunks
        texts = []
        chunk_ids = []
        for chunk in chunks:
            if chunk.text_content:
                texts.append(chunk.text_content)
                chunk_ids.append(chunk.id)
        
        if not texts:
            logger.warning("No text content found in chunks for embedding generation")
            return 0, 0
        
        # Generate embeddings
        start_time = time.time()
        try:
            embeddings = await self.embedding_provider.embed_texts(texts, model_name)
            embedding_time = time.time() - start_time
            
            logger.info(f"Generated {len(embeddings)} embeddings in {embedding_time:.2f}s using {model_name}")
        except Exception as e:
            logger.error(f"Error generating embeddings with {model_name}: {e}")
            return 0, len(chunks)
        
        # Store embeddings in model-specific table
        stored_count = 0
        error_count = 0
        table_name = self._get_embedding_table_name(model)
        
        for chunk_id, embedding in zip(chunk_ids, embeddings):
            if not embedding:  # Skip empty embeddings
                error_count += 1
                continue
                
            try:
                # Store in model-specific table
                insert_sql = f"""
                INSERT INTO {table_name} (chunk_id, embedding) 
                VALUES (:chunk_id, :embedding)
                ON CONFLICT (chunk_id) DO UPDATE SET 
                    embedding = EXCLUDED.embedding,
                    created_at = NOW()
                """
                
                self.session.exec(
                    text(insert_sql),
                    {"chunk_id": chunk_id, "embedding": embedding}
                )
                
                # Update AssetChunk with model reference
                chunk = self.session.get(AssetChunk, chunk_id)
                if chunk:
                    chunk.embedding_model_id = model.id
                    chunk.embedding_json = embedding  # Store as JSON for compatibility
                
                stored_count += 1
                
            except Exception as e:
                logger.error(f"Error storing embedding for chunk {chunk_id}: {e}")
                error_count += 1
        
        # Update model performance metrics
        if stored_count > 0:
            avg_time_per_embedding = (embedding_time / len(embeddings)) * 1000  # ms
            model.embedding_time_ms = avg_time_per_embedding
        
        self.session.commit()
        logger.info(f"Stored {stored_count} embeddings, {error_count} errors for model {model_name}")
        
        return stored_count, error_count
    
    async def similarity_search(
        self,
        query_text: str,
        model_name: str,
        provider: EmbeddingProvider,
        limit: int = 10,
        distance_threshold: float = 1.0,
        distance_function: str = "l2"  # l2, cosine, inner_product
    ) -> List[Dict[str, Any]]:
        """Perform similarity search using native pgvector operations."""
        
        # Get embedding model
        model = self.session.exec(
            select(EmbeddingModel).where(
                EmbeddingModel.name == model_name,
                EmbeddingModel.provider == provider
            )
        ).first()
        
        if not model:
            raise ValueError(f"Embedding model {model_name} not found")
        
        # Generate query embedding
        try:
            query_embedding = await self.embedding_provider.embed_single(query_text, model_name)
        except Exception as e:
            logger.error(f"Error generating query embedding: {e}")
            return []
        
        if not query_embedding:
            return []
        
        # Choose distance operator
        distance_ops = {
            "l2": "<->",  # Euclidean distance
            "cosine": "<=>",  # Cosine distance  
            "inner_product": "<#>"  # Negative inner product
        }
        
        if distance_function not in distance_ops:
            raise ValueError(f"Unsupported distance function: {distance_function}")
        
        operator = distance_ops[distance_function]
        table_name = self._get_embedding_table_name(model)
        
        # Perform similarity search
        search_sql = f"""
        SELECT 
            ac.id as chunk_id,
            ac.asset_id,
            ac.text_content,
            et.embedding {operator} :query_embedding as distance
        FROM {table_name} et
        JOIN assetchunk ac ON et.chunk_id = ac.id
        WHERE et.embedding {operator} :query_embedding < :threshold
        ORDER BY et.embedding {operator} :query_embedding ASC
        LIMIT :limit
        """
        
        try:
            result = self.session.exec(
                text(search_sql),
                {
                    "query_embedding": query_embedding,
                    "threshold": distance_threshold,
                    "limit": limit
                }
            )
            
            results = []
            for row in result:
                results.append({
                    "chunk_id": row.chunk_id,
                    "asset_id": row.asset_id,
                    "text_content": row.text_content,
                    "distance": float(row.distance),
                    "similarity": 1 - float(row.distance) if distance_function == "cosine" else None
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Error performing similarity search: {e}")
            return []
    
    def list_embedding_models(self, active_only: bool = True) -> List[EmbeddingModel]:
        """List all embedding models."""
        query = select(EmbeddingModel)
        if active_only:
            query = query.where(EmbeddingModel.is_active == True)
        
        return self.session.exec(query).all()
    
    def get_embedding_stats(self, model_id: int) -> Dict[str, Any]:
        """Get statistics for an embedding model."""
        model = self.session.get(EmbeddingModel, model_id)
        if not model:
            return {}
        
        table_name = self._get_embedding_table_name(model)
        
        try:
            # Get count of embeddings
            count_sql = f"SELECT COUNT(*) as count FROM {table_name}"
            count_result = self.session.exec(text(count_sql)).first()
            
            # Get table size
            size_sql = f"SELECT pg_size_pretty(pg_total_relation_size('{table_name}')) as size"
            size_result = self.session.exec(text(size_sql)).first()
            
            return {
                "model_id": model_id,
                "model_name": model.name,
                "provider": model.provider,
                "dimension": model.dimension,
                "embedding_count": count_result.count if count_result else 0,
                "table_size": size_result.size if size_result else "0 bytes",
                "avg_embedding_time_ms": model.embedding_time_ms
            }
            
        except Exception as e:
            logger.error(f"Error getting embedding stats for model {model_id}: {e}")
            return {"error": str(e)} 