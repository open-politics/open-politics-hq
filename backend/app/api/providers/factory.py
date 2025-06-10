import logging
from typing import Optional

from app.core.config import AppSettings # To inject settings
from app.api.providers.base import (
    StorageProvider,
    ClassificationProvider,
    ScrapingProvider,
    SearchProvider,
    GeospatialProvider,
    # Import other provider protocols as they are defined, e.g.:
    # EmbeddingProvider,
    # GeospatialProvider,
)

# Import concrete provider implementations
# These paths assume you will move your concrete provider classes to an 'impl' subdirectory
# and rename files appropriately, e.g., storage.py -> impl/storage_minio.py & impl/storage_s3.py
from app.api.providers.impl.storage_minio import MinioStorageProvider
# from app.api.providers.impl.storage_s3 import S3StorageProvider # Example for S3
# from app.api.providers.impl.storage_local import LocalFileSystemStorageProvider # Example for Local FS

from app.api.providers.impl.classification_gemini_native import GeminiNativeClassificationProvider
from app.api.providers.impl.classification_opol import OpolClassificationProvider
# from app.api.providers.impl.classification_openai import OpenAIClassificationProvider # Example

from app.api.providers.impl.scraping_opol import OpolScrapingProvider
# from app.api.providers.impl.scraping_playwright import PlaywrightScrapingProvider # Example

from app.api.providers.impl.search_opol import OpolSearchProvider # Assuming search.py becomes search_opol.py
from app.api.providers.impl.search_tavily import TavilySearchProvider
# from app.api.providers.impl.search_elasticsearch import ElasticsearchSearchProvider # Example

# Placeholder for future provider imports
# from app.api.providers.impl.embedding_openai import OpenAIEmbeddingProvider
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

def create_classification_provider(settings: AppSettings) -> ClassificationProvider:
    provider_type = settings.CLASSIFICATION_PROVIDER_TYPE.lower()
    default_model_name = settings.DEFAULT_CLASSIFICATION_MODEL_NAME
    logger.info(f"Factory: Creating classification provider of type: {provider_type} with default model: {default_model_name}")

    if provider_type == "gemini_native":
        if not settings.GOOGLE_API_KEY:
            raise ValueError("GOOGLE_API_KEY is required for gemini_native classification provider.")
        return GeminiNativeClassificationProvider(api_key=settings.GOOGLE_API_KEY, model_name=default_model_name)
    
    elif provider_type == "opol_google_via_fastclass":
        return OpolClassificationProvider(
            provider_for_fastclass="Google", 
            model_name_for_fastclass=default_model_name, # Or a more specific setting like OPOL_GOOGLE_MODEL
            api_key_for_fastclass=settings.GOOGLE_API_KEY, # Assuming OPOL needs key for Google
            opol_mode=settings.OPOL_MODE,
            opol_api_key=settings.OPOL_API_KEY
        )
    elif provider_type == "opol_ollama_via_fastclass":
        return OpolClassificationProvider(
            provider_for_fastclass="Ollama", 
            model_name_for_fastclass=settings.OLLAMA_DEFAULT_MODEL or default_model_name,
            ollama_base_url=settings.OLLAMA_BASE_URL, # Pass this to OPOL provider
            opol_mode=settings.OPOL_MODE,
            opol_api_key=settings.OPOL_API_KEY
        )
    # Add elif for other types like "openai" if you implement OpenAIClassificationProvider
    else:
        raise ValueError(f"Unsupported classification provider type configured: {settings.CLASSIFICATION_PROVIDER_TYPE}")

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

# --- Placeholder for Future Provider Factories ---
# def create_embedding_provider(settings: AppSettings) -> EmbeddingProvider:
#     provider_type = settings.EMBEDDING_PROVIDER_TYPE.lower()
#     logger.info(f"Factory: Creating embedding provider of type: {provider_type}")
#     if provider_type == "openai":
#         if not settings.OPENAI_API_KEY: raise ValueError("OPENAI_API_KEY required for OpenAI embeddings")
#         return OpenAIEmbeddingProvider(api_key=settings.OPENAI_API_KEY, model_name=settings.DEFAULT_EMBEDDING_MODEL_NAME)
#     # ... other embedding providers
#     else:
#         raise ValueError(f"Unsupported embedding provider type: {provider_type}")

def create_geospatial_provider(settings: AppSettings) -> GeospatialProvider:
    provider_type = settings.GEOSPATIAL_PROVIDER_TYPE.lower()
    logger.info(f"Factory: Creating geospatial provider of type: {provider_type}")
    if provider_type == "opol":
        return OpolGeospatialProvider(opol_mode=settings.OPOL_MODE, opol_api_key=settings.OPOL_API_KEY)
    else:
        raise ValueError(f"Unsupported geospatial provider type configured: {provider_type}") 