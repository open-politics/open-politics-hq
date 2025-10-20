"""
Provider interfaces and implementations.

This package contains the interface definitions and concrete implementations
for various external services used by the application. This abstraction layer
allows the application to swap different implementations (like switching from
OPOL to another search engine) without changing the core business logic.
"""

# Imports base interfaces
from typing import Any, Dict # Added Any, Dict for dummy providers

# Base interfaces
from .base import (
    StorageProvider,
    ScrapingProvider,
    SearchProvider,
    GeospatialProvider,
    GeocodingProvider,
    EmbeddingProvider,
    # New unified language model interfaces
    LanguageModelProvider,
    ModelInfo,
    GenerationResponse
)

# Registry services
from .model_registry import ModelRegistryService
from .search_registry import SearchProviderRegistryService
from .embedding_registry import EmbeddingProviderRegistryService
from .geocoding_registry import GeocodingProviderRegistryService
from .unified_registry import UnifiedProviderRegistry, ProviderCapability, ProviderMetadata, get_unified_registry

# Factory functions
from .factory import (
    create_storage_provider,
    create_scraping_provider,
    create_search_provider,
    create_embedding_provider,
    create_geospatial_provider,
    create_geocoding_provider,
    create_model_registry,  # Unified model registry
)

__all__ = [
    # Core provider interfaces
    "StorageProvider",
    "ScrapingProvider", 
    "SearchProvider",
    "GeospatialProvider",
    "GeocodingProvider",
    "EmbeddingProvider",
    
    # New unified language model system
    "LanguageModelProvider",
    "ModelInfo", 
    "GenerationResponse",
    
    # Registry services
    "ModelRegistryService",
    "SearchProviderRegistryService",
    "EmbeddingProviderRegistryService",
    "GeocodingProviderRegistryService",
    
    # Unified registry
    "UnifiedProviderRegistry",
    "ProviderCapability",
    "ProviderMetadata",
    "get_unified_registry",
    
    # Factory functions
    "create_storage_provider",
    "create_scraping_provider",
    "create_search_provider", 
    "create_embedding_provider",
    "create_geospatial_provider",
    "create_geocoding_provider",
    "create_model_registry",
]