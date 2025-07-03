import logging
from typing import Dict, Any, List, Optional, Type
from sqlmodel import Session, select
from app.models import User, EmbeddingModel, AssetChunk, Asset, AnnotationRun, AnnotationSchema
from app.api.analysis.protocols import AnalysisAdapterProtocol
from app.api.services.embedding_service import EmbeddingService
from app.api.providers.factory import create_classification_provider, create_embedding_provider
from app.api.providers.llm_config import llm_models_config
from app.core.config import settings
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

class RagResponse(BaseModel):
    """Pydantic model for RAG response structure"""
    answer: str = Field(description="The generated answer to the user's question")
    reasoning: str = Field(description="Explanation of how the answer was derived")

class RagAdapter(AnalysisAdapterProtocol):
    """
    RAG (Retrieval-Augmented Generation) adapter for question-answering over embedded content.
    
    This adapter performs vector similarity search to find relevant content chunks,
    then uses an LLM to generate answers based on the retrieved context.
    """
    
    def __init__(
        self, 
        session: Session, 
        config: Dict[str, Any], 
        current_user: Optional[User] = None, 
        infospace_id: Optional[int] = None
    ):
        self.session = session
        self.config = config
        self.current_user = current_user
        self.infospace_id = infospace_id
        
        # Initialize providers
        self.embedding_provider = create_embedding_provider(settings)
        self.embedding_service = EmbeddingService(session, self.embedding_provider)
        self.classification_provider = create_classification_provider(settings)
        
        # Validate required config
        self.question = config.get("question")
        self.embedding_model_id = config.get("embedding_model_id")
        
        if not self.question:
            raise ValueError("Missing required config: 'question'")
        if not self.embedding_model_id:
            raise ValueError("Missing required config: 'embedding_model_id'")
            
        # Optional parameters with defaults
        self.top_k = config.get("top_k", 5)
        self.similarity_threshold = config.get("similarity_threshold", 0.7)
        self.distance_function = config.get("distance_function", "cosine")
        
        # Simple model and thinking control
        self.model_name = config.get("model", "gemini-2.5-flash-preview-05-20")
        self.enable_thinking = config.get("enable_thinking", False)
        self.temperature = config.get("temperature", 0.1)
        self.max_tokens = config.get("max_tokens", 500)
        
        # Asset filters (optional)
        self.asset_filters = config.get("asset_filters", {})
        self.infospace_filter = config.get("infospace_id", infospace_id)
        
    async def execute(self) -> Dict[str, Any]:
        """Execute the RAG pipeline: retrieve → assemble context → generate answer."""
        
        logger.info(f"Executing RAG query: '{self.question}' with embedding model {self.embedding_model_id}")
        
        try:
            # 1. Get embedding model
            embedding_model = self.session.get(EmbeddingModel, self.embedding_model_id)
            if not embedding_model:
                raise ValueError(f"Embedding model {self.embedding_model_id} not found")
            
            # 2. Perform vector similarity search
            search_results = await self._perform_vector_search(embedding_model)
            
            if not search_results:
                return {
                    "answer": "I couldn't find any relevant information to answer your question.",
                    "reasoning": "No documents matched your query with sufficient similarity.",
                    "sources": [],
                    "context_used": "",
                    "retrieval_stats": {
                        "chunks_retrieved": 0,
                        "model_used": self.model_name,
                        "thinking_enabled": self.enable_thinking,
                        "query": self.question
                    }
                }
            
            # 3. Assemble context from retrieved chunks
            context = self._assemble_context(search_results)
            
            # 4. Generate answer using LLM
            answer_response = await self._generate_answer(context)
            
            # 5. Format sources for response
            sources = self._format_sources(search_results)
            
            # 6. Return structured result
            return {
                "answer": answer_response.get("answer", ""),
                "reasoning": answer_response.get("reasoning", ""),
                "sources": sources,
                "context_used": context,
                "retrieval_stats": {
                    "chunks_retrieved": len(search_results),
                    "model_used": self.model_name,
                    "thinking_enabled": self.enable_thinking,
                    "query": self.question,
                    "top_k": self.top_k,
                    "similarity_threshold": self.similarity_threshold,
                    "distance_function": self.distance_function
                }
            }
            
        except Exception as e:
            logger.error(f"Error in RAG execution: {e}", exc_info=True)
            raise
    
    async def _perform_vector_search(self, embedding_model: EmbeddingModel) -> List[Dict[str, Any]]:
        """Perform vector similarity search to retrieve relevant chunks."""
        
        # Convert distance threshold for different functions
        if self.distance_function == "cosine":
            distance_threshold = 2.0 - self.similarity_threshold  # cosine distance threshold
        else:
            distance_threshold = 2.0 * (1.0 - self.similarity_threshold)  # l2 distance threshold
        
        search_results = await self.embedding_service.similarity_search(
            query_text=self.question,
            model_name=embedding_model.name,
            provider=embedding_model.provider,
            limit=self.top_k,
            distance_threshold=distance_threshold,
            distance_function=self.distance_function
        )
        
        # Filter by infospace if specified
        if self.infospace_filter:
            filtered_results = []
            for result in search_results:
                chunk = self.session.get(AssetChunk, result["chunk_id"])
                if chunk and chunk.asset:
                    if chunk.asset.infospace_id == self.infospace_filter:
                        filtered_results.append(result)
            search_results = filtered_results
        
        # Apply additional asset filters if specified
        if self.asset_filters:
            search_results = self._apply_asset_filters(search_results)
        
        logger.info(f"Retrieved {len(search_results)} relevant chunks for query")
        return search_results
    
    def _apply_asset_filters(self, search_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Apply additional asset-level filters to search results."""
        filtered_results = []
        
        for result in search_results:
            chunk = self.session.get(AssetChunk, result["chunk_id"])
            if not chunk or not chunk.asset:
                continue
                
            asset = chunk.asset
            include_result = True
            
            # Apply filters based on asset attributes
            if "asset_kinds" in self.asset_filters:
                if asset.kind not in self.asset_filters["asset_kinds"]:
                    include_result = False
            
            if "source_ids" in self.asset_filters:
                if asset.source_id not in self.asset_filters["source_ids"]:
                    include_result = False
            
            if "date_range" in self.asset_filters:
                date_range = self.asset_filters["date_range"]
                if "start_date" in date_range and asset.event_timestamp:
                    if asset.event_timestamp < date_range["start_date"]:
                        include_result = False
                if "end_date" in date_range and asset.event_timestamp:
                    if asset.event_timestamp > date_range["end_date"]:
                        include_result = False
            
            if include_result:
                filtered_results.append(result)
        
        return filtered_results
    
    def _assemble_context(self, search_results: List[Dict[str, Any]]) -> str:
        """Assemble retrieved chunks into coherent context for the LLM."""
        
        if not search_results:
            return ""
        
        context_parts = []
        
        for i, result in enumerate(search_results, 1):
            chunk_text = result.get("text_content", "")
            if chunk_text:
                # Get additional asset context
                chunk = self.session.get(AssetChunk, result["chunk_id"])
                asset_title = "Unknown"
                if chunk and chunk.asset:
                    asset_title = chunk.asset.title or f"Asset {chunk.asset.id}"
                
                # Format context with source attribution
                similarity_score = result.get("similarity", 0.0)
                distance = result.get("distance", 0.0)
                
                context_part = f"[Source {i}: {asset_title}]\n{chunk_text}"
                if self.distance_function == "cosine" and similarity_score:
                    context_part += f"\n(Similarity: {similarity_score:.3f})"
                else:
                    context_part += f"\n(Distance: {distance:.3f})"
                
                context_parts.append(context_part)
        
        return "\n\n".join(context_parts)
    
    async def _generate_answer(self, context: str) -> Dict[str, Any]:
        """Generate answer using LLM based on retrieved context."""
        
        # Build RAG prompt
        prompt = self._build_rag_prompt(context)
        
        try:
            # Simple provider config
            provider_config = {
                "temperature": self.temperature,
                "max_tokens": self.max_tokens,
                "model_name_override": self.model_name,
                "enable_thinking": self.enable_thinking
            }
            
            response = await self.classification_provider.classify(
                text_content=prompt,
                output_model_class=RagResponse,
                instructions="Answer the question based on the provided context.",
                provider_config=provider_config
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Error generating LLM response: {e}")
            # Fallback response
            return {
                "answer": f"I found relevant information but encountered an error generating the response: {str(e)}",
                "reasoning": "Error in LLM generation"
            }
    
    def _build_rag_prompt(self, context: str) -> str:
        """Build the RAG prompt combining question and context."""
        
        prompt = f"""CONTEXT:
{context}

QUESTION: {self.question}

Please answer the question using the provided context. Cite your sources (Source 1, Source 2, etc.) and explain your reasoning."""

        return prompt
    
    def _format_sources(self, search_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Format search results as source objects for the response."""
        
        sources = []
        
        for i, result in enumerate(search_results, 1):
            chunk = self.session.get(AssetChunk, result["chunk_id"])
            if not chunk:
                continue
                
            asset = chunk.asset if chunk else None
            
            source = {
                "source_number": i,
                "chunk_id": result["chunk_id"],
                "asset_id": result["asset_id"],
                "asset_title": asset.title if asset else "Unknown",
                "asset_kind": str(asset.kind) if asset else "unknown",
                "text_content": result.get("text_content", "")[:500] + "..." if len(result.get("text_content", "")) > 500 else result.get("text_content", ""),
                "distance": result.get("distance", 0.0),
                "similarity": result.get("similarity")
            }
            
            # Add additional asset metadata if available
            if asset:
                source["asset_metadata"] = {
                    "created_at": asset.created_at.isoformat() if asset.created_at else None,
                    "event_timestamp": asset.event_timestamp.isoformat() if asset.event_timestamp else None,
                    "source_id": asset.source_id,
                    "parent_asset_id": asset.parent_asset_id
                }
            
            sources.append(source)
        
        return sources
    
 