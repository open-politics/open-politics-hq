"""
Provider interfaces, registry, and resolution.

Three files form the provider system:
- base.py:      Protocol classes + ModelSpec types + ProviderSelection
- registry.py:  Framework (@provider, ProviderDescriptor) + registry + resolve()
- providers.py: All provider declarations

Public API — everything else is internal:
- ``resolve(capability, ...)``  → build a provider
- ``Resolved``                  → return type, delegates to the instance
- ``ProviderError``             → raised on any resolution failure
- ``is_capability_available()`` → cheap deployment-level probe (circuit breakers)
- ``list_providers(capability)`` → discovery UI helper
- ``probe_providers()``         → startup status summary
"""

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
    EnrichmentConfig,
)

from .registry import (
    resolve,
    Resolved,
    ProviderError,
    is_capability_available,
    list_providers,
    get_model_spec,
    get_selection,
    probe_providers,
    CAPABILITIES,
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
    "EnrichmentConfig",
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
    # Resolution — public API
    "resolve",
    "Resolved",
    "ProviderError",
    "is_capability_available",
    "list_providers",
    "get_model_spec",
    "get_selection",
    "probe_providers",
    "CAPABILITIES",
]
