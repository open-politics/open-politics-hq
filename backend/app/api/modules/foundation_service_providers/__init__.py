"""
__init__.py — the only import surface external callers use.

  .primitives  ──► Resolution (vocabulary): CAPABILITIES, ProviderError,
                    Setting, descriptor_for, list_providers, …
  .resolve     ──► Resolution (verbs): resolve(), list_models(),
                    probe_providers(), Resolved
                    ◄── imported AFTER .primitives: it pulls in
                        providers.py, which needs the vocabulary first

  .models                 ──► Model specs: ModelSpec
  .language / .embedding  ──► Model specs: LLMModelSpec, EmbeddingModelSpec

  .user_config  ──► Selection: ProviderSelection, ProviderDefaults,
                     EnrichmentConfig, validate_*

  eight domain packages  ──► Contracts: the Provider Protocols and their
                              result types, no implementation

  resolve("language", infospace_id=5)      build a provider
  list_models("language", "ollama", ...)   what this endpoint can run NOW

  NOT IN THIS FILE
    providers.py   every declaration; ~15 lines adds one more endpoint.
    MAP.md         why the package is shaped this way.
"""

from .primitives import (
    CAPABILITIES,
    ProviderError,
    Resolved,
    Setting,
    capabilities_for,
    descriptor_for,
    domain_for,
    list_providers,
)

# Runs providers.py, so it must follow the vocabulary above.
from .resolve import (
    get_configured_foundation_provider,
    get_model_spec,
    is_capability_available,
    list_models,
    probe_providers,
    resolve,
)

from .models import ModelSpec
from .language import LLMModelSpec
from .embedding import EmbeddingModelSpec

from .user_config import (
    ProviderSelection,
    LanguageDefaults,
    ProviderDefaults,
    EnrichmentConfig,
    enricher_enabled,
    validate_provider_defaults,
    validate_enrichment_config,
)

# Contracts only — no implementation is imported here.
from .language import LanguageModelProvider, GenerationResponse, GenerationOptions
from .embedding import EmbeddingProvider
from .logic import LogicProvider, Noul, Choice, Score, Question, Answer
from .ocr import OcrProvider, OcrResult
from .geocoding import GeocodingProvider
from .scraping import ScrapingProvider
from .storage import StorageProvider
from .web_search import WebSearchProvider, SearchHit, SearchResults

__all__ = [
    # Resolution
    "resolve", "list_models", "Resolved", "ProviderError", "Setting",
    "is_capability_available", "list_providers", "descriptor_for", "domain_for",
    "capabilities_for",
    "get_model_spec", "get_configured_foundation_provider", "probe_providers",
    "CAPABILITIES",
    # Model specs
    "ModelSpec", "LLMModelSpec", "EmbeddingModelSpec",
    # Selection
    "ProviderSelection", "LanguageDefaults", "ProviderDefaults", "EnrichmentConfig",
    "enricher_enabled", "validate_provider_defaults", "validate_enrichment_config",
    # Contracts
    "LanguageModelProvider", "GenerationResponse", "GenerationOptions",
    "LogicProvider", "Noul", "Choice", "Score", "Question", "Answer",
    "EmbeddingProvider", "OcrProvider", "OcrResult", "GeocodingProvider",
    "ScrapingProvider", "StorageProvider", "WebSearchProvider",
    "SearchHit", "SearchResults",
]
