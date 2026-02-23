import logging
from typing import Optional

from app.core.config import AppSettings # To inject settings
from app.api.modules.foundation_service_providers.base import (
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
    EmbeddingProvider,
    GeocodingProvider,
)

# Import concrete provider implementations
# These paths assume you will move your concrete provider classes to an 'impl' subdirectory
# and rename files appropriately, e.g., storage.py -> impl/storage_minio.py & impl/storage_s3.py
from app.api.modules.foundation_service_providers.implemented.storage_minio import MinioStorageProvider
from app.api.modules.foundation_service_providers.implemented.storage_local import LocalFileSystemStorageProvider
# from app.api.modules.foundation_service_providers.implemented.storage_s3 import S3StorageProvider # Example for S3

# Language model providers (unified interface)
from app.api.modules.foundation_service_providers.model_registry import ModelRegistryService
from app.api.modules.foundation_service_providers.implemented.language_openai import OpenAILanguageModelProvider
from app.api.modules.foundation_service_providers.implemented.language_ollama import OllamaLanguageModelProvider  
from app.api.modules.foundation_service_providers.implemented.language_gemini import GeminiLanguageModelProvider
from app.api.modules.foundation_service_providers.implemented.language_anthropic import AnthropicLanguageModelProvider
from app.api.modules.foundation_service_providers.implemented.language_mistral import MistralLanguageModelProvider



# from app.api.modules.foundation_service_providers.implemented.scraping_playwright import PlaywrightScrapingProvider # Example

from app.api.modules.foundation_service_providers.implemented.web_search_tavily import TavilyWebSearchProvider
# from app.api.modules.foundation_service_providers.implemented.search_elasticsearch import ElasticsearchSearchProvider # Example

# Embedding provider implementations
from app.api.modules.foundation_service_providers.implemented.embedding_ollama import OllamaEmbeddingProvider
from app.api.modules.foundation_service_providers.implemented.embedding_jina import JinaEmbeddingProvider
from app.api.modules.foundation_service_providers.implemented.embedding_openai import OpenAIEmbeddingProvider
from app.api.modules.foundation_service_providers.implemented.embedding_voyage import VoyageAIEmbeddingProvider
from app.api.modules.foundation_service_providers.embedding_registry import EmbeddingProviderRegistryService


# Geocoding provider implementations
from app.api.modules.foundation_service_providers.implemented.geocoding_nominatim_local import NominatimLocalGeocodingProvider
from app.api.modules.foundation_service_providers.implemented.geocoding_nominatim_api import NominatimAPIGeocodingProvider
from app.api.modules.foundation_service_providers.implemented.geocoding_mapbox import MapboxGeocodingProvider

logger = logging.getLogger(__name__)

def create_storage_provider(settings: AppSettings) -> StorageProvider:
    provider_type = settings.STORAGE_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating storage provider of type: {provider_type}")

    if provider_type == "minio":
        if not all([settings.MINIO_ENDPOINT, settings.MINIO_ACCESS_KEY, settings.MINIO_SECRET_KEY, settings.MINIO_BUCKET_NAME]):
            raise ValueError("MinIO settings (endpoint, access key, secret key, bucket name) are required.")
        return MinioStorageProvider(
            endpoint_url=settings.MINIO_ENDPOINT,
            access_key=settings.MINIO_ACCESS_KEY,
            secret_key=settings.MINIO_SECRET_KEY,
            bucket_name=settings.MINIO_BUCKET_NAME,
            use_ssl=settings.MINIO_USE_SSL
        )
    # elif provider_type == "s3":
    #     if not all([settings.S3_BUCKET_NAME, settings.S3_ACCESS_KEY_ID, settings.S3_SECRET_ACCESS_KEY, settings.S3_REGION]):
    #         raise ValueError("S3 settings (bucket, access key, secret key, region) are required.")
    #     return S3StorageProvider(
    #         bucket_name=settings.S3_BUCKET_NAME,
    #         access_key_id=settings.S3_ACCESS_KEY_ID,
    #         secret_access_key=settings.S3_SECRET_ACCESS_KEY,
    #         region_name=settings.S3_REGION
    #     )
    elif provider_type == "local_fs":
        return LocalFileSystemStorageProvider(base_path=settings.LOCAL_STORAGE_BASE_PATH)
    else:
        raise ValueError(f"Unsupported storage provider type configured: {settings.STORAGE_PROVIDER_TYPE}")

def create_model_registry(settings: AppSettings) -> ModelRegistryService:
    """
    Create and configure the unified model registry with all available providers.
    
    All providers are enabled for model discovery. API keys must be provided at runtime
    from the frontend - NO environment variable fallbacks.
    """
    registry = ModelRegistryService()
    
    # Configure OpenAI - always available, uses runtime API key from frontend if no server key
    from app.api.modules.foundation_service_providers.implemented.language_openai import OpenAILanguageModelProvider
    registry.configure_provider(
        "openai",
        OpenAILanguageModelProvider,
        {"api_key": settings.OPENAI_API_KEY or "placeholder"},  # Placeholder if no server key
        enabled=True
    )
    logger.info("Configured OpenAI provider (requires runtime API key from frontend)" if not settings.OPENAI_API_KEY else "Configured OpenAI provider with server API key")
    
    # Configure Anthropic provider - requires runtime API key from frontend
    registry.configure_provider(
        name="anthropic",
        provider_class=AnthropicLanguageModelProvider,
        config={"api_key": "placeholder"},  # Must be provided at runtime
        enabled=True
    )
    logger.info("Configured Anthropic provider (requires runtime API key from frontend)")
    
    # Configure Ollama provider - uses base URL, no API key needed
    # Use host.docker.internal for Docker containers to reach host machine's Ollama
    ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://host.docker.internal:11434')
    registry.configure_provider(
        name="ollama", 
        provider_class=OllamaLanguageModelProvider,
        config={"base_url": ollama_base_url},
        enabled=True
    )
    logger.info(f"Configured Ollama provider with base_url: {ollama_base_url}")
    
    # Configure Gemini provider - requires runtime API key from frontend
    default_model = getattr(settings, 'DEFAULT_CLASSIFICATION_MODEL_NAME', None)
    registry.configure_provider(
        name="gemini",
        provider_class=GeminiLanguageModelProvider,
        config={
            "api_key": "placeholder",  # Must be provided at runtime
            "model_name": default_model
        },
        enabled=True
    )
    logger.info("Configured Gemini provider (requires runtime API key from frontend)")
    
    # Configure Mistral provider - requires runtime API key from frontend
    registry.configure_provider(
        name="mistral",
        provider_class=MistralLanguageModelProvider,
        config={"api_key": getattr(settings, 'MISTRAL_API_KEY', None) or "placeholder"},  # Placeholder if no server key
        enabled=True
    )
    logger.info("Configured Mistral provider (requires runtime API key from frontend)" if not getattr(settings, 'MISTRAL_API_KEY', None) else "Configured Mistral provider with server API key")
    
    return registry

def create_scraping_provider(settings: AppSettings) -> ScrapingProvider:
    provider_type = getattr(settings, 'SCRAPING_PROVIDER_TYPE', 'newspaper4k').lower()
    logger.info(f"Factory: Creating scraping provider of type: {provider_type}")

    if provider_type == "newspaper4k":
        try:
            from app.api.modules.foundation_service_providers.implemented.scraping_newspaper4k import Newspaper4kScrapingProvider
            
            # Build configuration from settings
            config = {
                'timeout': getattr(settings, 'SCRAPING_TIMEOUT', 30),
                'threads': getattr(settings, 'SCRAPING_THREADS', 4),
                'fetch_images': getattr(settings, 'SCRAPING_FETCH_IMAGES', True),
                'enable_nlp': getattr(settings, 'SCRAPING_ENABLE_NLP', False),
                'language': getattr(settings, 'SCRAPING_DEFAULT_LANGUAGE', 'en'),
                'user_agent': getattr(settings, 'SCRAPING_USER_AGENT', None),
            }
            
            # Add proxy settings if configured
            if hasattr(settings, 'SCRAPING_PROXY_HTTP') or hasattr(settings, 'SCRAPING_PROXY_HTTPS'):
                config['proxies'] = {}
                if hasattr(settings, 'SCRAPING_PROXY_HTTP'):
                    config['proxies']['http'] = settings.SCRAPING_PROXY_HTTP
                if hasattr(settings, 'SCRAPING_PROXY_HTTPS'):
                    config['proxies']['https'] = settings.SCRAPING_PROXY_HTTPS
            
            return Newspaper4kScrapingProvider(config=config)
        except ImportError as e:
            logger.warning(f"newspaper4k not available: {e}")
    else:
        raise ValueError(f"Unsupported scraping provider type configured: {provider_type}")

def create_web_search_provider(settings: AppSettings) -> WebSearchProvider:
    assert settings.TAVILY_API_KEY is not None, "TAVILY_API_KEY is required for the Tavily web search provider."
    return TavilyWebSearchProvider(api_key=settings.TAVILY_API_KEY)

def create_embedding_provider(settings: AppSettings) -> EmbeddingProvider:
    """Create and configure an embedding provider based on settings."""
    provider_type = getattr(settings, 'EMBEDDING_PROVIDER_TYPE', 'ollama').lower()
    logger.info(f"Factory: Creating embedding provider of type: {provider_type}")

    if provider_type == "ollama":
        # Use host.docker.internal for Docker containers to reach host machine's Ollama
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://host.docker.internal:11434')
        return OllamaEmbeddingProvider(base_url=ollama_base_url)
    
    elif provider_type == "jina":
        jina_api_key = getattr(settings, 'JINA_API_KEY', None)
        default_model = getattr(settings, 'JINA_EMBEDDING_MODEL', 'jina-embeddings-v2-base-en')
        return JinaEmbeddingProvider(api_key=jina_api_key, default_model=default_model)
    
    elif provider_type == "openai":
        api_key = getattr(settings, 'OPENAI_API_KEY', None) or "placeholder"
        return OpenAIEmbeddingProvider(api_key=api_key)

    elif provider_type == "voyage":
        api_key = getattr(settings, 'VOYAGE_API_KEY', None) or "placeholder"
        return VoyageAIEmbeddingProvider(api_key=api_key)

    else:
        raise ValueError(f"Unsupported embedding provider type: {provider_type}")

def create_geocoding_provider(settings: AppSettings) -> GeocodingProvider:
    """
    Create default geocoding provider based on settings.
    
    Note: Endpoint can override provider at runtime with user-supplied API keys.
    This factory creates the default provider with settings/env fallback.
    
    Supports three modes:
    - local: Local Nominatim instance (compose/kubernetes) - no API key needed
    - nominatim_api: Public Nominatim API (rate-limited, free) - no API key needed
    - mapbox: Mapbox Geocoding API (requires MAPBOX_ACCESS_TOKEN env var as fallback)
    """
    provider_type = settings.GEOCODING_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating default geocoding provider of type: {provider_type}")
    
    if provider_type == "local":
        # Local Nominatim instance (compose/kubernetes)
        return NominatimLocalGeocodingProvider(base_url=settings.NOMINATIM_BASE_URL)
    
    elif provider_type == "nominatim_api":
        # Public Nominatim API (rate-limited to 1 req/sec)
        return NominatimAPIGeocodingProvider(user_agent=settings.GEOCODING_USER_AGENT)
    
    elif provider_type == "mapbox":
        # Mapbox Geocoding API - try env fallback, but frontend should provide API key
        if not settings.MAPBOX_ACCESS_TOKEN:
            logger.warning("Mapbox provider configured but no MAPBOX_ACCESS_TOKEN in env. Runtime API key from frontend required.")
            # Create with placeholder - will fail unless runtime API key provided
            return MapboxGeocodingProvider(api_key="placeholder_requires_runtime_key")
        return MapboxGeocodingProvider(api_key=settings.MAPBOX_ACCESS_TOKEN)
    
    else:
        raise ValueError(f"Unsupported geocoding provider type: {provider_type}")


def create_ocr_provider(settings: AppSettings):
    """Create OCR provider for text extraction from images. Default: tesseract."""
    provider_type = getattr(settings, "OCR_PROVIDER_TYPE", "tesseract").lower()
    if provider_type == "tesseract":
        from app.api.modules.foundation_service_providers.implemented.ocr_tesseract import TesseractOcrProvider
        return TesseractOcrProvider()
    elif provider_type == "ocrmypdf":
        raise ValueError("ocrmypdf OCR provider not yet implemented; use tesseract")
    elif provider_type == "ollama":
        from app.api.modules.foundation_service_providers.implemented.ocr_ollama import OllamaOcrProvider
        ollama_base_url = getattr(settings, "OLLAMA_BASE_URL", "http://host.docker.internal:11434")
        ollama_ocr_model = getattr(settings, "OLLAMA_OCR_MODEL", "llava")
        return OllamaOcrProvider(base_url=ollama_base_url, model=ollama_ocr_model)
    raise ValueError(f"Unsupported OCR provider type: {provider_type}")


# Global embedding registry instance
_embedding_registry: Optional[EmbeddingProviderRegistryService] = None


def create_embedding_registry(settings: AppSettings) -> EmbeddingProviderRegistryService:
    """
    Create and configure the unified embedding provider registry.
    
    All providers are enabled for model discovery. API keys must be provided at runtime
    from the frontend for cloud providers (OpenAI, Voyage AI, Jina).
    """
    registry = EmbeddingProviderRegistryService()
    
    logger.info("Created embedding registry with providers: ollama, openai, voyage, jina")
    logger.info("Cloud providers require runtime API keys from frontend")
    
    return registry


def get_embedding_registry() -> EmbeddingProviderRegistryService:
    """Get the global embedding registry instance."""
    global _embedding_registry
    
    if _embedding_registry is None:
        from app.core.config import settings
        _embedding_registry = create_embedding_registry(settings)
    
    return _embedding_registry

