"""
Ollama Embedding Provider Implementation
"""
import logging
import httpx
from typing import List, Dict, Any, Optional

from app.api.providers.base import EmbeddingProvider

logger = logging.getLogger(__name__)


class OllamaEmbeddingProvider(EmbeddingProvider):
    """
    Ollama implementation of the EmbeddingProvider interface.
    Uses Ollama's /api/embed endpoint for generating embeddings.
    """
    
    def __init__(self, base_url: str = "http://ollama:11434"):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=120.0)
        self._model_cache = {}
        logger.info(f"Ollama embedding provider initialized with base_url: {self.base_url}")
    
    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """
        Generate embeddings for a list of texts using Ollama's batch endpoint.
        
        Args:
            texts: List of text strings to embed
            model_name: Ollama embedding model name (e.g., "nomic-embed-text", "mxbai-embed-large")
        
        Returns:
            List of embedding vectors
        """
        if not texts:
            return []
        
        if not model_name:
            raise ValueError("model_name is required for Ollama embeddings")
        
        try:
            payload = {
                "model": model_name,
                "input": texts,
                "truncate": True
            }
            
            response = await self.client.post(f"{self.base_url}/api/embed", json=payload)
            response.raise_for_status()
            data = response.json()
            
            embeddings = data.get("embeddings", [])
            
            if not embeddings:
                logger.error(f"No embeddings returned from Ollama for model {model_name}")
                return []
            
            logger.debug(f"Generated {len(embeddings)} embeddings using {model_name}")
            return embeddings
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama embedding API error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"Ollama embedding failed: {e.response.text}")
        except Exception as e:
            logger.error(f"Ollama embedding error: {e}")
            raise RuntimeError(f"Ollama embedding failed: {str(e)}")
    
    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text string to embed
            model_name: Ollama embedding model name
        
        Returns:
            Single embedding vector
        """
        embeddings = await self.embed_texts([text], model_name)
        if not embeddings:
            raise RuntimeError("Failed to generate embedding")
        return embeddings[0]
    
    async def discover_models(self) -> List[Dict[str, Any]]:
        """
        Discover available embedding models from Ollama.
        
        Strategy:
        1. Get all models from /api/tags
        2. Use /api/show to check for embedding capability via tags/details
        3. Fall back to testing embedding generation if metadata unclear
        """
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            
            all_models = data.get("models", [])
            embedding_models = []
            
            logger.info(f"Checking {len(all_models)} Ollama models for embedding capability...")
            
            for model_data in all_models:
                model_name = model_data.get("name", "")
                
                # Try to get detailed model info from /api/show
                is_embedding_model = False
                try:
                    show_resp = await self.client.post(
                        f"{self.base_url}/api/show", 
                        json={"model": model_name}
                    )
                    
                    if show_resp.status_code == 200:
                        show_data = show_resp.json() or {}
                        
                        # Check for embedding indicator in model details
                        details = show_data.get("details", {}) or {}
                        model_family = details.get("family", "").lower()
                        format_type = details.get("format", "").lower()
                        
                        # Check model metadata/tags for embedding indicator
                        model_file = show_data.get("modelfile", "").lower()
                        
                        # Look for embedding indicators in metadata
                        is_embedding_model = (
                            "embed" in model_family or
                            "embed" in format_type or
                            "embedding" in model_file or
                            details.get("is_embedding", False)
                        )
                        
                        logger.debug(f"Model {model_name}: family={model_family}, format={format_type}, is_embedding={is_embedding_model}")
                
                except Exception as e:
                    logger.debug(f"Could not probe {model_name} metadata: {e}")
                
                # If metadata doesn't indicate embedding capability,
                # try to generate a test embedding to verify
                if not is_embedding_model:
                    try:
                        test_embedding = await self.embed_single("test", model_name)
                        dimension = len(test_embedding)
                        is_embedding_model = True
                        logger.debug(f"✓ {model_name} can generate embeddings ({dimension}d)")
                    except Exception as e:
                        logger.debug(f"✗ {model_name} cannot generate embeddings: {e}")
                        continue
                
                # If identified as embedding model, get dimension and add to list
                if is_embedding_model:
                    try:
                        test_embedding = await self.embed_single("test", model_name)
                        dimension = len(test_embedding)
                        
                        model_info = {
                            "name": model_name,
                            "provider": "ollama",
                            "dimension": dimension,
                            "description": f"Ollama {model_name} ({dimension}d)",
                            "max_sequence_length": None  # Ollama doesn't expose this
                        }
                        embedding_models.append(model_info)
                        self._model_cache[model_name] = model_info
                        logger.info(f"✓ Discovered embedding model: {model_name} ({dimension}d)")
                        
                    except Exception as e:
                        logger.warning(f"Model {model_name} identified as embedding but failed test: {e}")
                        continue
            
            logger.info(f"Discovered {len(embedding_models)} Ollama embedding models")
            return embedding_models
            
        except Exception as e:
            logger.error(f"Failed to discover Ollama embedding models: {e}")
            return []
    
    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get cached available models."""
        return list(self._model_cache.values())
    
    def get_model_dimension(self, model_name: str) -> int:
        """
        Get the embedding dimension for a specific model.
        If not cached, generates a test embedding to detect dimension.
        """
        if model_name in self._model_cache:
            return self._model_cache[model_name]["dimension"]
        
        # Fallback: generate test embedding synchronously (not ideal, but works)
        import asyncio
        try:
            loop = asyncio.get_event_loop()
            test_embedding = loop.run_until_complete(self.embed_single("test", model_name))
            dimension = len(test_embedding)
            self._model_cache[model_name] = {"dimension": dimension}
            return dimension
        except Exception as e:
            logger.error(f"Failed to detect dimension for {model_name}: {e}")
            # Default fallback for common models
            if "nomic" in model_name.lower():
                return 768
            elif "mxbai" in model_name.lower():
                return 1024
            return 384  # Common default
