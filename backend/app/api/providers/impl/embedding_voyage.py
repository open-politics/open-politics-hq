"""
Voyage AI Embedding Provider Implementation
(Recommended by Anthropic for embeddings)
"""
import logging
import httpx
from typing import List, Dict, Any, Optional

from app.api.providers.base import EmbeddingProvider

logger = logging.getLogger(__name__)


# Voyage AI model configurations
VOYAGE_MODELS = {
    "voyage-3": {
        "name": "voyage-3",
        "dimension": 1024,
        "description": "Latest general-purpose embedding model from Voyage AI",
        "max_sequence_length": 32000,
        "recommended": True,
        "tags": ["general", "latest", "high-quality"]
    },
    "voyage-3-lite": {
        "name": "voyage-3-lite",
        "dimension": 512,
        "description": "Lightweight version of Voyage 3 for faster inference",
        "max_sequence_length": 32000,
        "recommended": False,
        "tags": ["fast", "lightweight"]
    },
    "voyage-finance-2": {
        "name": "voyage-finance-2",
        "dimension": 1024,
        "description": "Specialized model for financial documents",
        "max_sequence_length": 32000,
        "recommended": False,
        "tags": ["finance", "specialized"]
    },
    "voyage-law-2": {
        "name": "voyage-law-2",
        "dimension": 1024,
        "description": "Specialized model for legal documents",
        "max_sequence_length": 32000,
        "recommended": False,
        "tags": ["legal", "specialized"]
    },
    "voyage-code-2": {
        "name": "voyage-code-2",
        "dimension": 1536,
        "description": "Specialized model for code and technical content",
        "max_sequence_length": 16000,
        "recommended": False,
        "tags": ["code", "specialized"]
    },
    "voyage-3.5": {
        "name": "voyage-3.5",
        "dimension": 1024,
        "description": "Enhanced version of Voyage 3 with improved performance",
        "max_sequence_length": 32000,
        "recommended": True,
        "tags": ["general", "enhanced", "high-performance"]
    }
}


class VoyageAIEmbeddingProvider(EmbeddingProvider):
    """
    Voyage AI implementation of the EmbeddingProvider interface.
    Uses Voyage AI's /v1/embeddings endpoint (recommended by Anthropic).
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.voyageai.com/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=120.0)
        self._model_cache = {}
        
        logger.info(f"Voyage AI embedding provider initialized with base_url: {self.base_url}")
    
    async def embed_texts(self, texts: List[str], model_name: Optional[str] = None) -> List[List[float]]:
        """
        Generate embeddings for a list of texts using Voyage AI's API.
        
        Args:
            texts: List of text strings to embed
            model_name: Voyage AI model name (e.g., "voyage-3", "voyage-3.5")
        
        Returns:
            List of embedding vectors
        """
        if not texts:
            return []
        
        if not model_name:
            raise ValueError("model_name is required for Voyage AI embeddings")
        
        if not self.api_key:
            raise ValueError("API key is required for Voyage AI embeddings")
        
        try:
            headers = {
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            }
            
            payload = {
                "model": model_name,
                "input": texts,
                "input_type": "document"  # Can be "document" or "query"
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
                logger.error(f"No data field in Voyage AI response: {data}")
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
            logger.error(f"Voyage AI embedding API error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"Voyage AI embedding failed: {e.response.text}")
        except Exception as e:
            logger.error(f"Voyage AI embedding error: {e}")
            raise RuntimeError(f"Voyage AI embedding failed: {str(e)}")
    
    async def embed_single(self, text: str, model_name: Optional[str] = None) -> List[float]:
        """
        Generate embedding for a single text.
        
        Args:
            text: Text string to embed
            model_name: Voyage AI model name
        
        Returns:
            Single embedding vector
        """
        embeddings = await self.embed_texts([text], model_name)
        if not embeddings:
            raise RuntimeError("Failed to generate embedding")
        return embeddings[0]
    
    async def discover_models(self) -> List[Dict[str, Any]]:
        """
        Discover available embedding models from Voyage AI.
        
        Returns the pre-configured list of Voyage AI models.
        """
        discovered_models = []
        
        for model_name, model_config in VOYAGE_MODELS.items():
            model_info = {
                "name": model_name,
                "provider": "voyage",  # Use "voyage" as provider name (represents Anthropic's recommended embeddings)
                "dimension": model_config.get("dimension"),
                "description": model_config.get("description"),
                "max_sequence_length": model_config.get("max_sequence_length")
            }
            discovered_models.append(model_info)
            self._model_cache[model_name] = model_info
        
        logger.info(f"Discovered {len(discovered_models)} Voyage AI embedding models")
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
        
        # Get from VOYAGE_MODELS configuration
        if model_name in VOYAGE_MODELS:
            return VOYAGE_MODELS[model_name]["dimension"]
        
        # Default fallback
        logger.warning(f"Unknown Voyage AI model '{model_name}', defaulting to 1024 dimensions")
        return 1024
    
    async def check_api_key(self) -> bool:
        """Check if the API key is valid."""
        if not self.api_key:
            return False
        
        try:
            # Test with a simple embedding request
            test_embedding = await self.embed_single("test", "voyage-3")
            return len(test_embedding) > 0
        except Exception as e:
            logger.error(f"Error checking Voyage AI API key: {e}")
            return False
