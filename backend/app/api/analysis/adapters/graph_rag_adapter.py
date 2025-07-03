import logging
from typing import Dict, Any, List, Optional, Set
from sqlmodel import Session, select
from app.models import User, EmbeddingModel, AssetChunk, Asset, Annotation, AnnotationRun, AnnotationSchema
from app.api.analysis.protocols import AnalysisAdapterProtocol
from app.api.services.embedding_service import EmbeddingService
from app.api.providers.factory import create_classification_provider, create_embedding_provider
from app.api.providers.llm_config import llm_models_config
from app.core.config import settings
from pydantic import BaseModel, Field
import json

logger = logging.getLogger(__name__)

class GraphRagResponse(BaseModel):
    """Pydantic model for Graph RAG response structure"""
    answer: str = Field(description="The generated answer combining graph and document knowledge")
    reasoning: str = Field(description="Explanation of how the answer was derived from both sources")

class GraphRagAdapter(AnalysisAdapterProtocol):
    """
    Graph-enhanced RAG adapter that combines structured graph knowledge with 
    vector similarity search for comprehensive question-answering.
    
    This adapter retrieves relevant graph fragments from annotation runs and 
    combines them with embedding-based document retrieval to provide richer, 
    more context-aware answers.
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
        self.target_run_id = config.get("target_run_id")
        self.target_schema_id = config.get("target_schema_id")
        
        if not self.question:
            raise ValueError("Missing required config: 'question'")
        if not self.embedding_model_id:
            raise ValueError("Missing required config: 'embedding_model_id'")
        if not self.target_run_id:
            raise ValueError("Missing required config: 'target_run_id'")
        if not self.target_schema_id:
            raise ValueError("Missing required config: 'target_schema_id'")
            
        # Optional parameters with defaults
        self.top_k = config.get("top_k", 5)
        self.similarity_threshold = config.get("similarity_threshold", 0.7)
        self.distance_function = config.get("distance_function", "cosine")
        self.combine_strategy = config.get("combine_strategy", "graph_enhanced")
        
        # Simple model and thinking control
        self.model_name = config.get("model", "gemini-2.5-flash-preview-05-20")
        self.enable_thinking = config.get("enable_thinking", False)
        self.temperature = config.get("temperature", 0.1)
        self.max_tokens = config.get("max_tokens", 600)
        
        # Asset filters (optional)
        self.asset_filters = config.get("asset_filters", {})
        self.infospace_filter = config.get("infospace_id", infospace_id)
        
    async def execute(self) -> Dict[str, Any]:
        """Execute the Graph RAG pipeline: retrieve graph + embeddings → combine → generate answer."""
        
        logger.info(f"Executing Graph RAG query: '{self.question}' with embedding model {self.embedding_model_id}")
        
        try:
            # 1. Validate run and schema
            run = self.session.get(AnnotationRun, self.target_run_id)
            if not run:
                raise ValueError(f"AnnotationRun with ID {self.target_run_id} not found")
            
            schema = self.session.get(AnnotationSchema, self.target_schema_id)
            if not schema:
                raise ValueError(f"AnnotationSchema with ID {self.target_schema_id} not found")
            
            # Security check
            if self.infospace_filter and run.infospace_id != self.infospace_filter:
                raise ValueError(f"AnnotationRun {run.id} does not belong to the current infospace")
            
            # 2. Get embedding model
            embedding_model = self.session.get(EmbeddingModel, self.embedding_model_id)
            if not embedding_model:
                raise ValueError(f"Embedding model {self.embedding_model_id} not found")
            
            # 3. Perform vector similarity search
            embedding_results = await self._perform_vector_search(embedding_model)
            
            # 4. Retrieve graph fragments for relevant assets
            graph_fragments = await self._retrieve_graph_fragments(embedding_results)
            
            # 5. Combine contexts based on strategy
            combined_context = self._combine_contexts(embedding_results, graph_fragments)
            
            if not combined_context.strip():
                return {
                    "answer": "I couldn't find any relevant information to answer your question.",
                    "reasoning": "No relevant graph fragments or document chunks were found.",
                    "graph_context": "",
                    "embedding_context": "",
                    "sources": [],
                    "retrieval_stats": {
                        "chunks_retrieved": 0,
                        "graph_fragments": 0,
                        "model_used": self.model_name,
                        "thinking_enabled": self.enable_thinking,
                        "query": self.question
                    }
                }
            
            # 6. Generate answer using enhanced context
            answer_response = await self._generate_graph_enhanced_answer(combined_context, graph_fragments, embedding_results)
            
            # 7. Format sources for response
            sources = self._format_sources(embedding_results)
            
            # 8. Return structured result
            return {
                "answer": answer_response.get("answer", ""),
                "reasoning": answer_response.get("reasoning", ""),
                "graph_context": self._format_graph_context(graph_fragments),
                "embedding_context": self._format_embedding_context(embedding_results),
                "sources": sources,
                "retrieval_stats": {
                    "chunks_retrieved": len(embedding_results),
                    "graph_fragments": len(graph_fragments),
                    "model_used": self.model_name,
                    "thinking_enabled": self.enable_thinking,
                    "query": self.question,
                    "top_k": self.top_k,
                    "similarity_threshold": self.similarity_threshold,
                    "distance_function": self.distance_function,
                    "combine_strategy": self.combine_strategy
                }
            }
            
        except Exception as e:
            logger.error(f"Error in Graph RAG execution: {e}", exc_info=True)
            raise
    
    async def _perform_vector_search(self, embedding_model: EmbeddingModel) -> List[Dict[str, Any]]:
        """Perform vector similarity search to retrieve relevant chunks."""
        
        # Convert distance threshold for different functions
        if self.distance_function == "cosine":
            distance_threshold = 2.0 - self.similarity_threshold
        else:
            distance_threshold = 2.0 * (1.0 - self.similarity_threshold)
        
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
                if chunk and chunk.asset and chunk.asset.infospace_id == self.infospace_filter:
                    filtered_results.append(result)
            search_results = filtered_results
        
        # Apply additional asset filters if specified
        if self.asset_filters:
            search_results = self._apply_asset_filters(search_results)
        
        logger.info(f"Retrieved {len(search_results)} relevant chunks for query")
        return search_results
    
    async def _retrieve_graph_fragments(self, embedding_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Retrieve graph fragments for assets returned by embedding search."""
        
        # Get asset IDs from embedding results
        asset_ids = [result["asset_id"] for result in embedding_results]
        
        if not asset_ids:
            return []
        
        # Query for graph annotations for these assets
        graph_annotations = self.session.exec(
            select(Annotation).where(
                Annotation.asset_id.in_(asset_ids),
                Annotation.run_id == self.target_run_id,
                Annotation.schema_id == self.target_schema_id
            )
        ).all()
        
        graph_fragments = []
        for annotation in graph_annotations:
            try:
                if annotation.value and isinstance(annotation.value, dict):
                    fragment_data = {
                        "annotation_id": annotation.id,
                        "asset_id": annotation.asset_id,
                        "asset_title": annotation.asset.title if annotation.asset else "Unknown",
                        "graph_data": annotation.value,
                        "entities": annotation.value.get("entities", []),
                        "triplets": annotation.value.get("triplets", [])
                    }
                    graph_fragments.append(fragment_data)
            except Exception as e:
                logger.warning(f"Error processing graph annotation {annotation.id}: {e}")
        
        logger.info(f"Retrieved {len(graph_fragments)} graph fragments")
        return graph_fragments
    
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
    
    def _combine_contexts(self, embedding_results: List[Dict[str, Any]], graph_fragments: List[Dict[str, Any]]) -> str:
        """Combine graph and embedding contexts based on the combine strategy."""
        
        if self.combine_strategy == "graph_only":
            return self._format_graph_context(graph_fragments)
        elif self.combine_strategy == "embedding_only":
            return self._format_embedding_context(embedding_results)
        else:  # graph_enhanced (default)
            graph_context = self._format_graph_context(graph_fragments)
            embedding_context = self._format_embedding_context(embedding_results)
            
            if graph_context and embedding_context:
                return f"STRUCTURED KNOWLEDGE (From Knowledge Graph):\n{graph_context}\n\nDOCUMENT CONTEXT:\n{embedding_context}"
            elif graph_context:
                return f"STRUCTURED KNOWLEDGE (From Knowledge Graph):\n{graph_context}"
            else:
                return f"DOCUMENT CONTEXT:\n{embedding_context}"
    
    def _format_graph_context(self, graph_fragments: List[Dict[str, Any]]) -> str:
        """Format graph fragments into readable context."""
        
        if not graph_fragments:
            return ""
        
        # Aggregate all entities and relationships
        all_entities = {}  # entity_key -> entity_data
        all_relationships = []
        
        for fragment in graph_fragments:
            asset_title = fragment["asset_title"]
            entities = fragment.get("entities", [])
            triplets = fragment.get("triplets", [])
            
            # Process entities
            for entity in entities:
                if isinstance(entity, dict) and entity.get("name"):
                    entity_key = f"{entity['name']}_{entity.get('type', 'UNKNOWN')}"
                    if entity_key not in all_entities:
                        all_entities[entity_key] = {
                            "name": entity["name"],
                            "type": entity.get("type", "UNKNOWN"),
                            "sources": {asset_title}
                        }
                    else:
                        all_entities[entity_key]["sources"].add(asset_title)
            
            # Process relationships
            for triplet in triplets:
                if isinstance(triplet, dict):
                    # Find entity names for IDs
                    source_name = self._find_entity_name_by_id(triplet.get("source_id"), entities)
                    target_name = self._find_entity_name_by_id(triplet.get("target_id"), entities)
                    predicate = triplet.get("predicate", "")
                    
                    if source_name and target_name and predicate:
                        relationship = f"{source_name} → {predicate} → {target_name} (from {asset_title})"
                        all_relationships.append(relationship)
        
        # Format the context
        context_parts = []
        
        if all_entities:
            entities_text = []
            for entity_data in all_entities.values():
                sources = ", ".join(list(entity_data["sources"]))
                entities_text.append(f"- {entity_data['name']} ({entity_data['type']}) [Sources: {sources}]")
            context_parts.append(f"Entities:\n" + "\n".join(entities_text))
        
        if all_relationships:
            context_parts.append(f"Relationships:\n" + "\n".join(f"- {rel}" for rel in all_relationships))
        
        return "\n\n".join(context_parts)
    
    def _format_embedding_context(self, embedding_results: List[Dict[str, Any]]) -> str:
        """Format embedding search results into readable context."""
        
        if not embedding_results:
            return ""
        
        context_parts = []
        
        for i, result in enumerate(embedding_results, 1):
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
    
    def _find_entity_name_by_id(self, entity_id: Any, entities: List[Dict[str, Any]]) -> Optional[str]:
        """Find entity name by ID in the entities list."""
        for entity in entities:
            if isinstance(entity, dict) and entity.get("id") == entity_id:
                return entity.get("name")
        return None
    
    async def _generate_graph_enhanced_answer(
        self, 
        combined_context: str, 
        graph_fragments: List[Dict[str, Any]], 
        embedding_results: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """Generate answer using LLM with graph-enhanced context."""
        
        # Build enhanced RAG prompt
        prompt = self._build_graph_rag_prompt(combined_context)
        
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
                output_model_class=GraphRagResponse,
                instructions="Answer the question using both graph knowledge and document context.",
                provider_config=provider_config
            )
            
            return response
            
        except Exception as e:
            logger.error(f"Error generating LLM response: {e}")
            # Fallback response
            return {
                "answer": f"I found relevant information from both structured knowledge and documents but encountered an error generating the response: {str(e)}",
                "reasoning": "Error in LLM generation"
            }
    
    def _build_graph_rag_prompt(self, combined_context: str) -> str:
        """Build the enhanced RAG prompt combining question with graph and document context."""
        
        prompt = f"""AVAILABLE INFORMATION:
{combined_context}

QUESTION: {self.question}

Answer the question using both the structured knowledge and document content. Prioritize graph relationships for entity connections and explain your reasoning."""

        return prompt
    
    def _format_sources(self, embedding_results: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Format search results as source objects for the response."""
        
        sources = []
        
        for i, result in enumerate(embedding_results, 1):
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
    
 