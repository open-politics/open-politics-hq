"""
Unified Provider Registry
=========================

Single source of truth for all provider types with consistent interface.
Aggregates LLM, embedding, search, and geocoding providers into one unified view.
"""
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from enum import Enum

from app.core.config import settings

logger = logging.getLogger(__name__)


class ProviderCapability(str, Enum):
    """Types of capabilities a provider can offer."""
    LLM = "llm"
    EMBEDDING = "embedding" 
    SEARCH = "search"
    GEOCODING = "geocoding"


@dataclass
class ProviderMetadata:
    """
    Unified metadata for all provider types.
    
    This provides a consistent interface regardless of provider capability.
    """
    id: str  # Unique identifier (e.g., "gemini", "openai", "tavily")
    name: str  # Display name
    capability: ProviderCapability
    description: str
    requires_api_key: bool
    api_key_name: Optional[str] = None  # e.g., "Gemini API Key", "Tavily API Key"
    api_key_url: Optional[str] = None  # URL to get API key
    enabled: bool = True
    is_local: bool = False  # True for Ollama, local Nominatim, etc.
    is_oss: bool = False  # True for open-source solutions (Ollama, Nominatim, OPOL)
    is_free: bool = False  # True for free-tier available (Nominatim API, some have free tiers)
    has_env_fallback: bool = False  # True if server has env var configured
    features: Optional[List[str]] = None  # Provider-specific features
    models: Optional[List[Dict[str, Any]]] = None  # Available models (for LLM/embedding)
    rate_limited: Optional[bool] = None  # For search/geocoding providers
    rate_limit_info: Optional[str] = None


class UnifiedProviderRegistry:
    """
    Centralized registry aggregating all provider types.
    
    Provides a unified interface for discovering and managing providers
    across all capabilities (LLM, embedding, search, geocoding).
    """
    
    def __init__(self):
        self._providers: Dict[str, ProviderMetadata] = {}
        self._setup_providers()
        logger.info("UnifiedProviderRegistry initialized")
    
    def _setup_providers(self):
        """Configure all available providers from all registries."""
        
        # ── LLM Providers ──
        self._providers["gemini"] = ProviderMetadata(
            id="gemini",
            name="Google Gemini",
            capability=ProviderCapability.LLM,
            description="Google's Gemini models offer excellent reasoning and multimodal capabilities",
            requires_api_key=True,
            api_key_name="Gemini API Key",
            api_key_url="https://aistudio.google.com/app/apikey",
            enabled=True,
            is_oss=False,
            is_free=False,  # Has free tier
            features=["structured_output", "tools", "streaming", "multimodal"]
        )
        
        self._providers["openai"] = ProviderMetadata(
            id="openai",
            name="OpenAI",
            capability=ProviderCapability.LLM,
            description="OpenAI's GPT models provide state-of-the-art language understanding",
            requires_api_key=True,
            api_key_name="OpenAI API Key",
            api_key_url="https://platform.openai.com/api-keys",
            enabled=True,
            is_oss=False,
            is_free=False,  # Paid only
            has_env_fallback=bool(settings.OPENAI_API_KEY),
            features=["structured_output", "tools", "streaming", "thinking"]
        )
        
        self._providers["anthropic"] = ProviderMetadata(
            id="anthropic",
            name="Anthropic Claude",
            capability=ProviderCapability.LLM,
            description="Anthropic's Claude models excel at reasoning and long context",
            requires_api_key=True,
            api_key_name="Anthropic API Key",
            api_key_url="https://console.anthropic.com/settings/keys",
            enabled=True,
            is_oss=False,
            is_free=False,  # Paid only
            features=["structured_output", "tools", "streaming", "thinking", "extended_thinking"]
        )
        
        self._providers["ollama"] = ProviderMetadata(
            id="ollama",
            name="Ollama",
            capability=ProviderCapability.LLM,
            description="Open-source local LLM runtime. Run models privately on your infrastructure (not available in the hosted version)",
            requires_api_key=False,
            enabled=True,
            is_local=True,
            is_oss=True,  # Open source
            is_free=True,  # Free
            features=["tools", "streaming"]
        )
        
        # ── Embedding Providers ──
        self._providers["ollama_embeddings"] = ProviderMetadata(
            id="ollama_embeddings",
            name="Ollama Embeddings",
            capability=ProviderCapability.EMBEDDING,
            description="Open-source local embeddings via Ollama. Run privately on your infrastructure (not available in the hosted version)",
            requires_api_key=False,
            enabled=True,
            is_local=True,
            is_oss=True,  # Open source
            is_free=True   # Free
        )
        
        self._providers["openai_embeddings"] = ProviderMetadata(
            id="openai_embeddings",
            name="OpenAI Embeddings",
            capability=ProviderCapability.EMBEDDING,
            description="OpenAI's text-embedding models",
            requires_api_key=True,
            api_key_name="OpenAI API Key",
            api_key_url="https://platform.openai.com/api-keys",
            enabled=True,
            is_oss=False,
            is_free=False,  # Paid only
            has_env_fallback=bool(settings.OPENAI_API_KEY)
        )
        
        self._providers["voyage"] = ProviderMetadata(
            id="voyage",
            name="Voyage AI",
            capability=ProviderCapability.EMBEDDING,
            description="Voyage AI embeddings (recommended by Anthropic)",
            requires_api_key=True,
            api_key_name="Voyage API Key",
            api_key_url="https://www.voyageai.com",
            enabled=True,
            is_oss=False,
            is_free=True  # Has free tier
        )
        
        self._providers["jina"] = ProviderMetadata(
            id="jina",
            name="Jina AI",
            capability=ProviderCapability.EMBEDDING,
            description="Jina AI embedding models",
            requires_api_key=True,
            api_key_name="Jina API Key",
            api_key_url="https://jina.ai",
            enabled=True,
            is_oss=False,
            is_free=True  # Has free tier
        )
        
        # ── Search Providers ──
        self._providers["tavily"] = ProviderMetadata(
            id="tavily",
            name="Tavily",
            capability=ProviderCapability.SEARCH,
            description="AI-powered web search optimized for LLMs",
            requires_api_key=True,
            api_key_name="Tavily API Key",
            api_key_url="https://tavily.com",
            enabled=True,
            is_oss=False,
            is_free=True,  # Has free tier
            has_env_fallback=bool(getattr(settings, 'TAVILY_API_KEY', None)),
            rate_limited=True,
            rate_limit_info="1000 requests/month (free tier)"
        )
        
        self._providers["opol_search"] = ProviderMetadata(
            id="opol_search",
            name="OPOL Search (SearXNG)",
            capability=ProviderCapability.SEARCH,
            description="Open-source privacy-focused metasearch. Self-hosted for unlimited use",
            requires_api_key=False,
            enabled=True,
            is_local=True,  # Self-hosted
            is_oss=True,    # SearXNG is open source
            is_free=True,   # Free
            has_env_fallback=True,
            rate_limited=False
        )
        
        # ── Geocoding Providers ──
        self._providers["nominatim_local"] = ProviderMetadata(
            id="nominatim_local",
            name="Nominatim (Local)",
            capability=ProviderCapability.GEOCODING,
            description="Open-source self-hosted Nominatim instance. Unlimited usage",
            requires_api_key=False,
            enabled=True,
            is_local=True,
            is_oss=True,   # Nominatim is open source
            is_free=True,  # Free
            rate_limited=False,
            features=["polygons", "reverse_geocoding"]
        )
        
        self._providers["nominatim_api"] = ProviderMetadata(
            id="nominatim_api",
            name="Nominatim Public API",
            capability=ProviderCapability.GEOCODING,
            description="OpenStreetMap's free public geocoding API (OSM community)",
            requires_api_key=False,
            enabled=True,
            is_oss=True,   # Open source project
            is_free=True,  # Free to use
            rate_limited=True,
            rate_limit_info="1 request/second",
            features=["polygons", "reverse_geocoding"]
        )
        
        self._providers["mapbox"] = ProviderMetadata(
            id="mapbox",
            name="Mapbox Geocoding",
            capability=ProviderCapability.GEOCODING,
            description="Mapbox commercial geocoding API",
            requires_api_key=True,
            api_key_name="Mapbox Access Token",
            api_key_url="https://account.mapbox.com",
            enabled=True,
            is_oss=False,
            is_free=True,  # Has free tier
            has_env_fallback=bool(getattr(settings, 'MAPBOX_ACCESS_TOKEN', None)),
            rate_limited=True,
            rate_limit_info="600 requests/minute (free tier)",
            features=["reverse_geocoding"]
        )
    
    def get_all_providers(self) -> List[ProviderMetadata]:
        """Get all enabled providers."""
        return [p for p in self._providers.values() if p.enabled]
    
    def get_providers_by_capability(self, capability: ProviderCapability) -> List[ProviderMetadata]:
        """Get all providers for a specific capability."""
        return [
            p for p in self._providers.values() 
            if p.enabled and p.capability == capability
        ]
    
    def get_provider(self, provider_id: str) -> Optional[ProviderMetadata]:
        """Get a specific provider by ID."""
        return self._providers.get(provider_id)
    
    def get_providers_grouped_by_capability(self) -> Dict[str, List[ProviderMetadata]]:
        """Get all providers grouped by capability."""
        grouped: Dict[str, List[ProviderMetadata]] = {
            capability.value: [] for capability in ProviderCapability
        }
        
        for provider in self._providers.values():
            if provider.enabled:
                grouped[provider.capability.value].append(provider)
        
        return grouped
    
    def requires_api_key(self, provider_id: str) -> bool:
        """Check if a provider requires an API key."""
        provider = self._providers.get(provider_id)
        return provider.requires_api_key if provider else False
    
    def has_env_fallback(self, provider_id: str) -> bool:
        """Check if server has environment variable configured for this provider."""
        provider = self._providers.get(provider_id)
        return provider.has_env_fallback if provider else False


# Global registry instance
_unified_registry: Optional[UnifiedProviderRegistry] = None


def get_unified_registry() -> UnifiedProviderRegistry:
    """Get the global unified provider registry instance."""
    global _unified_registry
    
    if _unified_registry is None:
        _unified_registry = UnifiedProviderRegistry()
    
    return _unified_registry

