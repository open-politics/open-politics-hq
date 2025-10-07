"""
OpenAI Embedding Provider Implementation
"""
import logging
import httpx
from typing import List, Dict, Any, Optional

from app.api.providers.base import EmbeddingProvider
from app.api.providers.embedding_config import embedding_models_config

logger = logging.getLogger(__name__)


class OpenAIEmbeddingProvider(EmbeddingProvider):
    """
    OpenAI implementation of the EmbeddingProvider interface.
    Uses OpenAI's /v1/embeddings endpoint for generating embeddings.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=120.0)
        self._model_cache = {}
        
        # Load configuration from embedding_models_config
        provider_config = embedding_models_config.get_provider_config("openai")
        self.available_models = embedding_models_config.get_provider_models("openai")
        
        logger.info(f"OpenAI embedding provider initialized with base_url: {self.base_url}")
        logger.info(f"Loaded {len(self.available_models)} models from configuration")
    
    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """
        Generate embeddings for a list of texts using OpenAI's API.
        
        Args:
            texts: List of text strings to embed
            model_name: OpenAI embedding model name (e.g., "text-embedding-ada-002", "text-embedding-3-small")
        
        Returns:
            List of embedding vectors
        """
        if not texts:
            return []
        
        if not model_name:
            raise ValueError("model_name is required for OpenAI embeddings")
        
        if not self.api_key:
            raise ValueError("API key is required for OpenAI embeddings")
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": model_name,
                "input": texts,
                "encoding_format": "float"
            }
            
            response = await self.client.post(
                f"{self.base_url}/embeddings",
                json=payload,
                headers=headers
            )
            response.raise_for_status()
            data = response.json()
            
            # Extract embeddings from response
            if "data" not in data:
                logger.error(f"No data field in OpenAI response: {data}")
                return []
            
            embeddings = []
            for item in sorted(data["data"], key=lambda x: x.get("index", 0)):
                if "embedding" in item:
                    embeddings.append(item["embedding"])
                else:
                    logger.error(f"No embedding in response item: {item}")
                    embeddings.append([])
            
            logger.debug(f"Generated {len(embeddings)} embeddings using {model_name}")
            return embeddings
            
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI embedding API error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"OpenAI embedding failed: {e.response.text}")
        except Exception as e:
            logger.error(f"OpenAI embedding error: {e}")
            raise RuntimeError(f"OpenAI embedding failed: {str(e)}")
    
    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text string to embed
            model_name: OpenAI embedding model name
        
        Returns:
            Single embedding vector
        """
        embeddings = await self.embed_texts([text], model_name)
        if not embeddings:
            raise RuntimeError("Failed to generate embedding")
        return embeddings[0]
    
    async def discover_models(self) -> List[Dict[str, Any]]:
        """
        Discover available embedding models from OpenAI configuration.
        
        Since OpenAI's models endpoint doesn't filter for embedding models,
        we use the pre-configured list from embedding_models_config.
        """
        discovered_models = []
        
        for model_name, model_config in self.available_models.items():
            model_info = {
                "name": model_name,
                "provider": "openai",
                "dimension": model_config.get("dimension"),
                "description": model_config.get("description", f"OpenAI {model_name}"),
                "max_sequence_length": model_config.get("max_sequence_length")
            }
            discovered_models.append(model_info)
            self._model_cache[model_name] = model_info
        
        logger.info(f"Discovered {len(discovered_models)} OpenAI embedding models from configuration")
        return discovered_models
    
    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get cached available models."""
        return list(self._model_cache.values())
    
    def get_model_dimension(self, model_name: str) -> int:
        """
        Get the embedding dimension for a specific model.
        """
        if model_name in self._model_cache:
            return self._model_cache[model_name]["dimension"]
        
        # Get from configuration
        dimension = embedding_models_config.get_model_dimension("openai", model_name)
        if dimension:
            return dimension
        
        # Default fallback for common models
        if "ada-002" in model_name.lower():
            return 1536
        elif "3-small" in model_name.lower():
            return 1536
        elif "3-large" in model_name.lower():
            return 3072
        
        logger.warning(f"Unknown OpenAI model '{model_name}', defaulting to 1536 dimensions")
        return 1536
    
    async def check_api_key(self) -> bool:
        """Check if the API key is valid."""
        if not self.api_key:
            return False
        
        try:
            # Test with a simple embedding request
            test_embedding = await self.embed_single("test", "text-embedding-ada-002")
            return len(test_embedding) > 0
        except Exception as e:
            logger.error(f"Error checking OpenAI API key: {e}")
            return False
