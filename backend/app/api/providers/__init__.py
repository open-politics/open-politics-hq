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
    EmbeddingProvider,
    # New unified language model interfaces
    LanguageModelProvider,
    ModelInfo,
    GenerationResponse
)

# New model registry service
from .model_registry import ModelRegistryService

# Factory functions
from .factory import (
    create_storage_provider,
    create_scraping_provider,
    create_search_provider,
    create_embedding_provider,
    create_geospatial_provider,
    create_model_registry,  # Unified model registry
)

__all__ = [
    # Core provider interfaces
    "StorageProvider",
    "ScrapingProvider", 
    "SearchProvider",
    "GeospatialProvider",
    "EmbeddingProvider",
    
    # New unified language model system
    "LanguageModelProvider",
    "ModelInfo", 
    "GenerationResponse",
    "ModelRegistryService",
    
    # Factory functions
    "create_storage_provider",
    "create_scraping_provider",
    "create_search_provider", 
    "create_embedding_provider",
    "create_geospatial_provider",
    "create_model_registry",
]