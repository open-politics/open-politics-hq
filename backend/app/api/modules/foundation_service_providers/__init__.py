"""
Provider interfaces, registry, and resolution.

Three files form the provider system:
- base.py:      Protocol classes + ModelSpec types + ProviderSelection
- registry.py:  Framework (@provider, ProviderDescriptor) + registry + resolve()
- providers.py: All provider declarations + convenience getters
"""

# Base interfaces
from .base import (
    ModelSpec,
    LLMModelSpec,
    EmbeddingModelSpec,
    StorageProvider,
    FileStat,
    ScrapingProvider,
    WebSearchProvider,
    GeocodingProvider,
    EmbeddingProvider,
    OcrProvider,
    OcrResult,
    LanguageModelProvider,
    ModelInfo,
    GenerationResponse,
    ProviderSelection,
    LanguageDefaults,
    ProviderDefaults,
)

# Registry + resolution
from .registry import (
    resolve,
    is_accessible,
    is_capability_available,
    discover_models,
    load_credentials,
    probe_providers,
    system_default_provider_key,
    get_descriptor,
    list_providers,
    get_provider,
    get_storage_provider,
    get_scraping_provider,
    get_web_search_provider,
    get_embedding_provider,
    get_geocoding_provider,
    get_ocr_provider,
)

__all__ = [
    # Model specs
    "ModelSpec",
    "LLMModelSpec",
    "EmbeddingModelSpec",
    # Provider selection
    "ProviderSelection",
    "LanguageDefaults",
    "ProviderDefaults",
    # Provider protocols
    "StorageProvider",
    "FileStat",
    "ScrapingProvider",
    "WebSearchProvider",
    "GeocodingProvider",
    "EmbeddingProvider",
    "OcrProvider",
    "OcrResult",
    "LanguageModelProvider",
    "ModelInfo",
    "GenerationResponse",
    # Resolution
    "resolve",
    "is_accessible",
    "is_capability_available",
    "discover_models",
    "load_credentials",
    "probe_providers",
    "system_default_provider_key",
    "get_descriptor",
    "list_providers",
    "get_provider",
    # Convenience getters
    "get_storage_provider",
    "get_scraping_provider",
    "get_web_search_provider",
    "get_embedding_provider",
    "get_geocoding_provider",
    "get_ocr_provider",
]
