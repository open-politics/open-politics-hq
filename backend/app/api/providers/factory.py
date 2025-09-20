import logging
from typing import Optional

from app.core.config import AppSettings # To inject settings
from app.api.providers.base import (
    StorageProvider,
    ClassificationProvider,
    ScrapingProvider,
    SearchProvider,
    GeospatialProvider,
    EmbeddingProvider,
)

# Import concrete provider implementations
# These paths assume you will move your concrete provider classes to an 'impl' subdirectory
# and rename files appropriately, e.g., storage.py -> impl/storage_minio.py & impl/storage_s3.py
from app.api.providers.impl.storage_minio import MinioStorageProvider
# from app.api.providers.impl.storage_s3 import S3StorageProvider # Example for S3
# from app.api.providers.impl.storage_local import LocalFileSystemStorageProvider # Example for Local FS

# Language model providers (unified interface)
from app.api.providers.model_registry import ModelRegistryService
from app.api.providers.impl.language_openai import OpenAILanguageModelProvider
from app.api.providers.impl.language_ollama import OllamaLanguageModelProvider  
from app.api.providers.impl.language_gemini import GeminiLanguageModelProvider



from app.api.providers.impl.scraping_opol import OpolScrapingProvider
# from app.api.providers.impl.scraping_playwright import PlaywrightScrapingProvider # Example

from app.api.providers.impl.search_opol import OpolSearchProvider # Assuming search.py becomes search_opol.py
from app.api.providers.impl.search_tavily import TavilySearchProvider
# from app.api.providers.impl.search_elasticsearch import ElasticsearchSearchProvider # Example

# Embedding provider implementations
from app.api.providers.impl.embedding_ollama import OllamaEmbeddingProvider
from app.api.providers.impl.embedding_jina import JinaEmbeddingProvider
# from app.api.providers.impl.embedding_openai import OpenAIEmbeddingProvider # Future

from app.api.providers.impl.geospatial_opol import OpolGeospatialProvider

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
    # elif provider_type == "local_fs":
    #     return LocalFileSystemStorageProvider(base_path=settings.LOCAL_STORAGE_BASE_PATH)
    else:
        raise ValueError(f"Unsupported storage provider type configured: {settings.STORAGE_PROVIDER_TYPE}")

def create_model_registry(settings: AppSettings) -> ModelRegistryService:
    """
    Create and configure the unified model registry with all available providers.
    
    This replaces the old create_classification_provider function.
    """
    registry = ModelRegistryService()
    
    # Configure OpenAI provider if API key is available
    if hasattr(settings, 'OPENAI_API_KEY') and settings.OPENAI_API_KEY:
        registry.configure_provider(
            name="openai",
            provider_class=OpenAILanguageModelProvider,
            config={"api_key": settings.OPENAI_API_KEY},
            enabled=True
        )
        logger.info("Configured OpenAI provider")
    
    # Configure Ollama provider - always available in Docker setup
    ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://ollama:11434')
    registry.configure_provider(
        name="ollama", 
        provider_class=OllamaLanguageModelProvider,
        config={"base_url": ollama_base_url},
        enabled=True
    )
    logger.info(f"Configured Ollama provider with base_url: {ollama_base_url}")
    
    # Configure Gemini provider if API key is available
    if hasattr(settings, 'GOOGLE_API_KEY') and settings.GOOGLE_API_KEY:
        default_model = getattr(settings, 'DEFAULT_CLASSIFICATION_MODEL_NAME', None)
        registry.configure_provider(
            name="gemini",
            provider_class=GeminiLanguageModelProvider,
            config={
                "api_key": settings.GOOGLE_API_KEY,
                "model_name": default_model
            },
            enabled=True
        )
        logger.info("Configured Gemini provider")
    
    return registry

def create_scraping_provider(settings: AppSettings) -> ScrapingProvider:
    provider_type = settings.SCRAPING_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating scraping provider of type: {provider_type}")

    if provider_type == "opol":
        # OpolScrapingProvider constructor might take opol_mode, opol_api_key from settings
        # if it doesn't rely on a global opol instance initialized with these.
        return OpolScrapingProvider(opol_mode=settings.OPOL_MODE, opol_api_key=settings.OPOL_API_KEY)
    # Add elif for "custom_playwright" here if implemented
    else:
        raise ValueError(f"Unsupported scraping provider type configured: {settings.SCRAPING_PROVIDER_TYPE}")

def create_search_provider(settings: AppSettings) -> SearchProvider:
    provider_type = settings.SEARCH_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating search provider of type: {provider_type}")

    if provider_type == "opol_searxng":
        # OpolSearchProvider constructor might take opol_mode, opol_api_key
        return OpolSearchProvider(opol_mode=settings.OPOL_MODE, opol_api_key=settings.OPOL_API_KEY)
    elif provider_type == "tavily":
        if not settings.TAVILY_API_KEY:
            raise ValueError("TAVILY_API_KEY is required for the Tavily search provider.")
        return TavilySearchProvider(api_key=settings.TAVILY_API_KEY)
    # Add elif for "elasticsearch" here if implemented
    else:
        raise ValueError(f"Unsupported search provider type configured: {settings.SEARCH_PROVIDER_TYPE}")

def create_embedding_provider(settings: AppSettings) -> EmbeddingProvider:
    """Create and configure an embedding provider based on settings."""
    provider_type = getattr(settings, 'EMBEDDING_PROVIDER_TYPE', 'ollama').lower()
    logger.info(f"Factory: Creating embedding provider of type: {provider_type}")

    if provider_type == "ollama":
        ollama_base_url = getattr(settings, 'OLLAMA_BASE_URL', 'http://localhost:11434')
        default_model = getattr(settings, 'OLLAMA_EMBEDDING_MODEL', 'nomic-embed-text')
        return OllamaEmbeddingProvider(base_url=ollama_base_url, default_model=default_model)
    
    elif provider_type == "jina":
        jina_api_key = getattr(settings, 'JINA_API_KEY', None)
        default_model = getattr(settings, 'JINA_EMBEDDING_MODEL', 'jina-embeddings-v2-base-en')
        return JinaEmbeddingProvider(api_key=jina_api_key, default_model=default_model)
    
    elif provider_type == "openai":
        # Placeholder for future OpenAI implementation
        # if not settings.OPENAI_API_KEY: raise ValueError("OPENAI_API_KEY required for OpenAI embeddings")
        # return OpenAIEmbeddingProvider(api_key=settings.OPENAI_API_KEY, model_name=settings.DEFAULT_EMBEDDING_MODEL_NAME)
        raise ValueError("OpenAI embedding provider not yet implemented")
    
    else:
        raise ValueError(f"Unsupported embedding provider type: {provider_type}")

def create_geospatial_provider(settings: AppSettings) -> GeospatialProvider:
    provider_type = settings.GEOSPATIAL_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating geospatial provider of type: {provider_type}")
    if provider_type == "opol":
        return OpolGeospatialProvider(opol_mode=settings.OPOL_MODE, opol_api_key=settings.OPOL_API_KEY)
    else:
        raise ValueError(f"Unsupported geospatial provider type configured: {provider_type}") 