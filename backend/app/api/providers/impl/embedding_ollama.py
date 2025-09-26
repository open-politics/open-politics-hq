import logging
import httpx
from typing import Any, Dict, List, Optional
from app.api.providers.base import EmbeddingProvider
from app.api.providers.embedding_config import embedding_models_config

logger = logging.getLogger(__name__)

class OllamaEmbeddingProvider(EmbeddingProvider):
    """
    Ollama embedding provider implementation.
    """
    
    def __init__(self, base_url: str = "http://localhost:11434", default_model: str = "nomic-embed-text"):
        """
        Initialize Ollama embedding provider.
        
        Args:
            base_url: Ollama server base URL
            default_model: Default embedding model to use
        """
        self.base_url = base_url.rstrip('/')
        self.default_model = default_model
        
        # Load models from configuration
        config_models = embedding_models_config.get_provider_models("ollama")
        self.available_models = config_models
        
        logger.info(f"OllamaEmbeddingProvider initialized with base_url: {self.base_url}, default_model: {self.default_model}")
        logger.info(f"Loaded {len(self.available_models)} models from configuration")

    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """Generate embeddings for multiple texts."""
        if not texts:
            return []
            
        model = model_name or self.default_model
        
        # Check if model is available
        if not await self.check_model_availability(model):
            logger.warning(f"Model {model} not available, attempting to pull it")
            if not await self.pull_model_if_needed(model):
                logger.error(f"Failed to pull model {model}, using empty embeddings")
                return [[] for _ in texts]
        
        embeddings = []
        
        # Use longer timeout for embedding generation
        timeout = httpx.Timeout(60.0, connect=10.0)
        
        async with httpx.AsyncClient(timeout=timeout) as client:
            for text in texts:
                try:
                    # Truncate text if too long (basic safety measure)
                    max_length = 8000  # Conservative limit
                    truncated_text = text[:max_length] if len(text) > max_length else text
                    
                    response = await client.post(
                        f"{self.base_url}/api/embeddings",
                        json={
                            "model": model,
                            "prompt": truncated_text
                        }
                    )
                    response.raise_for_status()
                    
                    data = response.json()
                    if "embedding" in data and data["embedding"]:
                        embeddings.append(data["embedding"])
                    else:
                        logger.error(f"No embedding returned for text: {truncated_text[:50]}...")
                        embeddings.append([])
                        
                except httpx.TimeoutException as e:
                    logger.error(f"Timeout error for Ollama embedding: {e}")
                    embeddings.append([])
                except httpx.RequestError as e:
                    logger.error(f"Request error for Ollama embedding: {e}")
                    embeddings.append([])
                except httpx.HTTPStatusError as e:
                    logger.error(f"HTTP error for Ollama embedding: {e.response.status_code} - {e.response.text}")
                    # If it's a model not found error, try to pull the model
                    if e.response.status_code == 404:
                        logger.info(f"Model {model} not found, attempting to pull")
                        if await self.pull_model_if_needed(model):
                            # Retry the request once
                            try:
                                retry_response = await client.post(
                                    f"{self.base_url}/api/embeddings",
                                    json={
                                        "model": model,
                                        "prompt": truncated_text
                                    }
                                )
                                retry_response.raise_for_status()
                                retry_data = retry_response.json()
                                if "embedding" in retry_data and retry_data["embedding"]:
                                    embeddings.append(retry_data["embedding"])
                                else:
                                    embeddings.append([])
                            except Exception as retry_e:
                                logger.error(f"Retry failed for Ollama embedding: {retry_e}")
                                embeddings.append([])
                        else:
                            embeddings.append([])
                    else:
                        embeddings.append([])
                except Exception as e:
                    logger.error(f"Unexpected error for Ollama embedding: {e}")
                    embeddings.append([])
        
        return embeddings

    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """Generate embedding for a single text."""
        results = await self.embed_texts([text], model_name)
        return results[0] if results else []

    def get_available_models(self) -> List[Dict[str, Any]]:
        """Get list of available embedding models."""
        return list(self.available_models.values())

    def get_model_dimension(self, model_name: str) -> int:
        """Get embedding dimension for a specific model."""
        dimension = embedding_models_config.get_model_dimension("ollama", model_name)
        if dimension:
            return dimension
        
        # Default dimension if model not found in our registry
        logger.warning(f"Unknown Ollama model '{model_name}', defaulting to 768 dimensions")
        return 768

    async def check_model_availability(self, model_name: str) -> bool:
        """Check if a model is available on the Ollama server."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                
                data = response.json()
                if "models" in data:
                    available_model_names = [model["name"] for model in data["models"]]
                    return model_name in available_model_names
                    
        except Exception as e:
            logger.error(f"Error checking Ollama model availability: {e}")
            
        return False

    async def pull_model_if_needed(self, model_name: str) -> bool:
        """Pull a model if it's not available locally."""
        try:
            if await self.check_model_availability(model_name):
                return True
                
            logger.info(f"Pulling Ollama model: {model_name}")
            async with httpx.AsyncClient(timeout=300.0) as client:  # Long timeout for model pulling
                response = await client.post(
                    f"{self.base_url}/api/pull",
                    json={"name": model_name}
                )
                response.raise_for_status()
                logger.info(f"Successfully pulled Ollama model: {model_name}")
                return True
                
        except Exception as e:
            logger.error(f"Error pulling Ollama model {model_name}: {e}")
            
        return False

    async def health_check(self) -> bool:
        """Check if Ollama server is accessible."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                return True
        except Exception as e:
            logger.error(f"Ollama health check failed: {e}")
            return False

    async def get_server_info(self) -> Dict[str, Any]:
        """Get information about the Ollama server."""
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(f"{self.base_url}/api/tags")
                response.raise_for_status()
                data = response.json()
                
                return {
                    "server_accessible": True,
                    "models_available": len(data.get("models", [])),
                    "model_list": [model["name"] for model in data.get("models", [])],
                    "base_url": self.base_url
                }
        except Exception as e:
            logger.error(f"Failed to get Ollama server info: {e}")
            return {
                "server_accessible": False,
                "error": str(e),
                "base_url": self.base_url
            } 