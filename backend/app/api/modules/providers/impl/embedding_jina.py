import logging
import httpx
from typing import Any, Dict, List, Optional
from app.api.providers.base import EmbeddingProvider
from app.api.providers.embedding_config import embedding_models_config

logger = logging.getLogger(__name__)

class JinaEmbeddingProvider(EmbeddingProvider):
    """
    Jina AI embedding provider implementation.
    """
    
    def __init__(self, api_key: Optional[str] = None, default_model: str = "jina-embeddings-v2-base-en"):
        """
        Initialize Jina AI embedding provider.
        
        Args:
            api_key: Jina AI API key
            default_model: Default embedding model to use
        """
        self.api_key = api_key
        self.default_model = default_model
        
        # Load configuration from embedding_models_config
        provider_config = embedding_models_config.get_provider_config("jina")
        self.base_url = provider_config.get("base_url", "https://api.jina.ai/v1/embeddings")
        self.available_models = embedding_models_config.get_provider_models("jina")
        
        if not self.api_key:
            logger.warning("No Jina AI API key provided. Some features may not work.")
        
        logger.info(f"JinaEmbeddingProvider initialized with default_model: {self.default_model}")
        logger.info(f"Loaded {len(self.available_models)} models from configuration")

    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        if not texts:
            return []
            
        if not self.api_key:
            logger.error("Jina AI API key required for embedding generation")
            return [[] for _ in texts]
            
        model = model_name or self.default_model
        
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                payload = {
                    "model": model,
                    "input": texts,
                    "encoding_format": "float"
                }
                
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers=headers
                )
                response.raise_for_status()
                
                data = response.json()
                
                if "data" in data:
                    embeddings = []
                    for item in data["data"]:
                        if "embedding" in item:
                            embeddings.append(item["embedding"])
                        else:
                            logger.error(f"No embedding in response item: {item}")
                            embeddings.append([])
                    return embeddings
                else:
                    logger.error(f"No data field in Jina AI response: {data}")
                    return [[] for _ in texts]
                    
        except httpx.RequestError as e:
            logger.error(f"Request error for Jina AI embedding: {e}")
            return [[] for _ in texts]
        except httpx.HTTPStatusError as e:
            logger.error(f"HTTP error for Jina AI embedding: {e.response.status_code} - {e.response.text}")
            return [[] for _ in texts]
        except Exception as e:
            logger.error(f"Unexpected error for Jina AI embedding: {e}")
            return [[] for _ in texts]

    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """Generate embedding for a single text."""
        results = await self.embed_texts([text], model_name)
        return results[0] if results else []

    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get list of available embedding models."""
        return list(self.available_models.values())

    def get_model_dimension(self, model_name: str) -> int:
        """Get embedding dimension for a specific model."""
        dimension = embedding_models_config.get_model_dimension("jina", model_name)
        if dimension:
            return dimension
        
        # Default dimension if model not found in our registry
        logger.warning(f"Unknown Jina AI model '{model_name}', defaulting to 768 dimensions")
        return 768

    async def check_api_key(self) -> bool:
        """Check if the API key is valid."""
        if not self.api_key:
            return False
            
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                headers = {
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                }
                
                # Test with a simple embedding request
                payload = {
                    "model": self.default_model,
                    "input": ["test"],
                    "encoding_format": "float"
                }
                
                response = await client.post(
                    self.base_url,
                    json=payload,
                    headers=headers
                )
                
                return response.status_code == 200
                
        except Exception as e:
            logger.error(f"Error checking Jina AI API key: {e}")
            return False

    async def get_usage_info(self) -> Optional[Dict[str, Any]]:
        """Get API usage information if available."""
        # Jina AI might provide usage endpoints in the future
        # For now, this is a placeholder
        return None 