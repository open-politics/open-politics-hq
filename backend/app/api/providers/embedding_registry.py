"""
Embedding Provider Registry Service
====================================

Centralized service for discovering and managing embedding providers with runtime API key support.
Similar to ModelRegistryService and SearchProviderRegistryService but for embedding providers.
"""
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from app.api.providers.base import EmbeddingProvider
from app.api.providers.impl.embedding_ollama import OllamaEmbeddingProvider
from app.api.providers.impl.embedding_openai import OpenAIEmbeddingProvider
from app.api.providers.impl.embedding_voyage import VoyageAIEmbeddingProvider
from app.api.providers.impl.embedding_jina import JinaEmbeddingProvider
from app.api.providers.embedding_config import embedding_models_config
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class EmbeddingProviderConfig:
    """Configuration for an embedding provider."""
    name: str
    provider_class: type
    default_config: Dict
    requires_api_key: bool = True
    enabled: bool = True


class EmbeddingProviderRegistryService:
    """
    Centralized service for discovering and managing embedding providers.
    
    This service:
    - Manages available embedding providers (Ollama, OpenAI, Voyage AI, Jina)
    - Creates provider instances with runtime API keys
    - Provides unified access to all embedding providers
    - Handles provider failures gracefully
    - Supports runtime API key injection from frontend
    """
    
    def __init__(self):
        self.provider_configs: Dict[str, EmbeddingProviderConfig] = {}
        self.providers: Dict[str, EmbeddingProvider] = {}
        self.models_cache: Dict[str, Dict] = {}  # model_name -> model_info
        self._setup_default_providers()
        logger.info("EmbeddingProviderRegistryService initialized")
    
    def _setup_default_providers(self):
        """Setup default embedding provider configurations."""
        
        # Ollama provider - no API key needed, always available
        self.provider_configs["ollama"] = EmbeddingProviderConfig(
            name="ollama",
            provider_class=OllamaEmbeddingProvider,
            default_config={
                "base_url": getattr(settings, 'OLLAMA_BASE_URL', 'http://ollama:11434')
            },
            requires_api_key=False,
            enabled=True
        )
        
        # OpenAI provider - requires API key
        self.provider_configs["openai"] = EmbeddingProviderConfig(
            name="openai",
            provider_class=OpenAIEmbeddingProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )
        
        # Voyage AI provider (Anthropic's recommended embeddings) - requires API key
        self.provider_configs["voyage"] = EmbeddingProviderConfig(
            name="voyage",
            provider_class=VoyageAIEmbeddingProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )
        
        # Jina AI provider - requires API key
        self.provider_configs["jina"] = EmbeddingProviderConfig(
            name="jina",
            provider_class=JinaEmbeddingProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )
        
        logger.info(f"Configured {len(self.provider_configs)} embedding providers")
    
    async def initialize_providers(self):
        """Initialize providers that don't require API keys (e.g., Ollama)."""
        for name, config in self.provider_configs.items():
            if not config.enabled:
                continue
            
            # Only initialize providers that don't require API keys
            if not config.requires_api_key:
                try:
                    provider = config.provider_class(**config.default_config)
                    self.providers[name] = provider
                    logger.info(f"Initialized embedding provider: {name}")
                except Exception as e:
                    logger.error(f"Failed to initialize embedding provider {name}: {e}")
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [name for name, config in self.provider_configs.items() if config.enabled]
    
    def get_provider_info(self, provider_name: str) -> Optional[EmbeddingProviderConfig]:
        """Get configuration info for a specific provider."""
        return self.provider_configs.get(provider_name)
    
    def create_provider(self, provider_name: str, api_key: Optional[str] = None) -> EmbeddingProvider:
        """
        Create an embedding provider instance with optional runtime API key.
        
        Args:
            provider_name: Name of the provider to create
            api_key: Optional runtime API key (overrides environment config)
            
        Returns:
            EmbeddingProvider instance
            
        Raises:
            ValueError: If provider not found or API key required but not provided
        """
        config = self.provider_configs.get(provider_name)
        if not config:
            raise ValueError(f"Embedding provider '{provider_name}' not found")
        
        if not config.enabled:
            raise ValueError(f"Embedding provider '{provider_name}' is disabled")
        
        # If provider doesn't require API key, return cached instance
        if not config.requires_api_key:
            if provider_name in self.providers:
                return self.providers[provider_name]
            
            # Create new instance
            provider = config.provider_class(**config.default_config)
            self.providers[provider_name] = provider
            return provider
        
        # Provider requires API key - must be provided at runtime
        if not api_key:
            raise ValueError(f"Embedding provider '{provider_name}' requires an API key")
        
        # Build provider configuration
        provider_config = config.default_config.copy()
        provider_config["api_key"] = api_key
        
        try:
            provider = config.provider_class(**provider_config)
            logger.info(f"Created embedding provider: {provider_name} with runtime API key")
            return provider
        except Exception as e:
            logger.error(f"Failed to create embedding provider {provider_name}: {e}")
            raise ValueError(f"Failed to create embedding provider {provider_name}: {str(e)}")
    
    def create_provider_with_fallback(
        self, 
        provider_name: str, 
        api_key: Optional[str] = None
    ) -> Optional[EmbeddingProvider]:
        """
        Create an embedding provider with graceful fallback on failure.
        
        Returns None if provider creation fails instead of raising exception.
        """
        try:
            return self.create_provider(provider_name, api_key)
        except Exception as e:
            logger.warning(f"Failed to create embedding provider {provider_name}: {e}")
            return None
    
    async def discover_all_models(
        self, 
        runtime_api_keys: Optional[Dict[str, str]] = None,
        force_refresh: bool = False
    ) -> Dict[str, List[Dict]]:
        """
        Discover models from all providers.
        
        Args:
            runtime_api_keys: Optional runtime API keys (e.g., {"openai": "sk-...", "voyage": "pa-..."})
            force_refresh: Whether to force refresh the cache
            
        Returns:
            Dict mapping provider names to their available models
        """
        if not force_refresh and self.models_cache:
            # Return cached results organized by provider
            results = {}
            for model_name, model_info in self.models_cache.items():
                provider_name = model_info.get("provider", "unknown")
                if provider_name not in results:
                    results[provider_name] = []
                results[provider_name].append(model_info)
            return results
        
        runtime_api_keys = runtime_api_keys or {}
        results = {}
        self.models_cache.clear()
        
        # Discover from Ollama (no API key needed)
        if "ollama" in self.providers or not self.provider_configs["ollama"].requires_api_key:
            try:
                provider = self.providers.get("ollama") or self.create_provider("ollama")
                models = await provider.discover_models()
                results["ollama"] = models
                
                # Update cache
                for model in models:
                    self.models_cache[model["name"]] = model
                
                logger.info(f"Discovered {len(models)} models from ollama")
            except Exception as e:
                logger.error(f"Failed to discover models from ollama: {e}")
                results["ollama"] = []
        
        # Discover from cloud providers using static configuration (no API keys needed for discovery)
        for provider_name in ["openai", "voyage", "jina"]:
            try:
                # Use static configuration - no API keys needed for discovery
                provider_models = embedding_models_config.get_provider_models(provider_name)
                
                discovered_models = []
                for model_name, model_config in provider_models.items():
                    model_info = {
                        "name": model_name,
                        "provider": provider_name,
                        "dimension": model_config.get("dimension"),
                        "description": model_config.get("description", f"{provider_name.title()} {model_name}"),
                        "max_sequence_length": model_config.get("max_sequence_length")
                    }
                    discovered_models.append(model_info)
                    self.models_cache[model_name] = model_info
                
                results[provider_name] = discovered_models
                logger.info(f"Discovered {len(discovered_models)} models from {provider_name} (static config)")
            except Exception as e:
                logger.error(f"Failed to discover models from {provider_name}: {e}")
                results[provider_name] = []
        
        return results
    
    def _infer_provider_from_model_name(self, model_name: str) -> Optional[str]:
        """
        Infer the likely provider based on model name patterns.
        This helps avoid unnecessary provider discovery.
        """
        # OpenAI patterns
        if model_name.startswith("text-embedding-"):
            return "openai"
        
        # Voyage AI patterns
        if model_name.startswith("voyage-"):
            return "voyage"
        
        # Jina AI patterns
        if model_name.startswith("jina-"):
            return "jina"
        
        # If no pattern matches, return None (will discover from all)
        return None
    
    async def get_provider_for_model(
        self, 
        model_name: str, 
        runtime_api_keys: Optional[Dict[str, str]] = None
    ) -> Tuple[Optional[EmbeddingProvider], Optional[str]]:
        """
        Find which provider has a specific model.
        
        Args:
            model_name: Name of the model to find
            runtime_api_keys: Runtime API keys from frontend
        
        Returns:
            Tuple of (provider_instance, provider_name) or (None, None) if not found
        """
        runtime_api_keys = runtime_api_keys or {}
        
        # Check if model is in cache
        if model_name in self.models_cache:
            model_info = self.models_cache[model_name]
            provider_name = model_info.get("provider")
            
            # For Ollama (no API key needed), use cached provider
            if provider_name == "ollama":
                provider = self.providers.get("ollama") or self.create_provider("ollama")
                return provider, provider_name
            
            # For other providers, need runtime API key or environment fallback
            api_key = runtime_api_keys.get(provider_name)
            
            # Fall back to environment variables if no runtime key
            if not api_key:
                if provider_name == "openai" and settings.OPENAI_API_KEY:
                    api_key = settings.OPENAI_API_KEY
                    logger.info(f"Using environment OPENAI_API_KEY for {model_name}")
                elif provider_name == "jina" and settings.JINA_API_KEY:
                    api_key = settings.JINA_API_KEY
                    logger.info(f"Using environment JINA_API_KEY for {model_name}")
            
            if api_key:
                try:
                    provider = self.create_provider(provider_name, api_key)
                    return provider, provider_name
                except Exception as e:
                    logger.error(f"Failed to create provider {provider_name}: {e}")
                    return None, None
        
        # Model not in cache - try to infer provider from model name
        inferred_provider = self._infer_provider_from_model_name(model_name)
        
        # Check if we can infer the provider
        if inferred_provider:
            # Use static configuration for discovery (no API key needed)
            logger.info(f"Model '{model_name}' not in cache, attempting targeted discovery from '{inferred_provider}' provider")
            try:
                provider_models = embedding_models_config.get_provider_models(inferred_provider)
                
                # Update cache with all models from this provider
                for model_name_cfg, model_config in provider_models.items():
                    model_info = {
                        "name": model_name_cfg,
                        "provider": inferred_provider,
                        "dimension": model_config.get("dimension"),
                        "description": model_config.get("description"),
                        "max_sequence_length": model_config.get("max_sequence_length")
                    }
                    self.models_cache[model_name_cfg] = model_info
                
                logger.info(f"Discovered {len(provider_models)} models from {inferred_provider} (static config)")
                
                # Check if our model was found
                if model_name in self.models_cache:
                    # Now create the provider with API key for actual usage
                    api_key = runtime_api_keys.get(inferred_provider)
                    if not api_key:
                        if inferred_provider == "openai" and settings.OPENAI_API_KEY:
                            api_key = settings.OPENAI_API_KEY
                        elif inferred_provider == "jina" and settings.JINA_API_KEY:
                            api_key = settings.JINA_API_KEY
                    
                    if api_key:
                        provider = self.create_provider(inferred_provider, api_key)
                        return provider, inferred_provider
            except Exception as e:
                logger.error(f"Targeted discovery from {inferred_provider} failed: {e}")
        
        # Fall back to discovering from all providers
        logger.info(f"Model '{model_name}' not found via targeted discovery, attempting full discovery")
        await self.discover_all_models(runtime_api_keys, force_refresh=True)
        
        # Try again after discovery
        if model_name in self.models_cache:
            model_info = self.models_cache[model_name]
            provider_name = model_info.get("provider")
            
            if provider_name == "ollama":
                provider = self.providers.get("ollama") or self.create_provider("ollama")
                return provider, provider_name
            
            if provider_name in runtime_api_keys:
                api_key = runtime_api_keys[provider_name]
                if api_key:
                    try:
                        provider = self.create_provider(provider_name, api_key)
                        return provider, provider_name
                    except Exception as e:
                        logger.error(f"Failed to create provider {provider_name}: {e}")
                        return None, None
        
        logger.error(f"Model '{model_name}' not found in any provider")
        return None, None
    
    def get_default_provider(self, api_keys: Optional[Dict[str, str]] = None) -> Optional[EmbeddingProvider]:
        """
        Get a default embedding provider, preferring Ollama if available.
        
        Args:
            api_keys: Optional dictionary of provider API keys
            
        Returns:
            EmbeddingProvider instance or None if no providers available
        """
        api_keys = api_keys or {}
        
        # Try Ollama first (no API key needed)
        ollama_provider = self.create_provider_with_fallback("ollama")
        if ollama_provider:
            return ollama_provider
        
        # Try OpenAI if API key is available
        if "openai" in api_keys:
            openai_provider = self.create_provider_with_fallback("openai", api_keys["openai"])
            if openai_provider:
                return openai_provider
        
        # Try Voyage AI if API key is available
        if "voyage" in api_keys:
            voyage_provider = self.create_provider_with_fallback("voyage", api_keys["voyage"])
            if voyage_provider:
                return voyage_provider
        
        # Try Jina AI if API key is available
        if "jina" in api_keys:
            jina_provider = self.create_provider_with_fallback("jina", api_keys["jina"])
            if jina_provider:
                return jina_provider
        
        logger.warning("No embedding providers available")
        return None
