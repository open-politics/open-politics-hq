"""
Web Search Provider Registry Service
====================================

Centralized service for discovering and managing web search providers with runtime API key support.
Similar to ModelRegistryService but for web search providers like Tavily, etc.
"""
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from app.api.modules.foundation_service_providers.base import WebSearchProvider
from app.api.modules.foundation_service_providers.implemented.web_search_tavily import TavilyWebSearchProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class WebSearchProviderConfig:
    """Configuration for a web search provider."""
    name: str
    provider_class: type
    default_config: Dict
    requires_api_key: bool = True
    enabled: bool = True


class WebSearchProviderRegistryService:
    """
    Centralized service for discovering and managing web search providers.

    This service:
    - Manages available web search providers (Tavily, etc.)
    - Creates provider instances with runtime API keys
    - Provides unified access to all web search providers
    - Handles provider failures gracefully
    """

    def __init__(self):
        self.provider_configs: Dict[str, WebSearchProviderConfig] = {}
        self._setup_default_providers()
        logger.info("WebSearchProviderRegistryService initialized")

    def _setup_default_providers(self):
        """Setup default web search provider configurations."""
        # Tavily provider
        self.provider_configs["tavily"] = WebSearchProviderConfig(
            name="tavily",
            provider_class=TavilyWebSearchProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )

        logger.info(f"Configured {len(self.provider_configs)} web search providers")

    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [name for name, config in self.provider_configs.items() if config.enabled]

    def get_provider_info(self, provider_name: str) -> Optional[WebSearchProviderConfig]:
        """Get configuration info for a specific provider."""
        return self.provider_configs.get(provider_name)

    def create_provider(self, provider_name: str, api_key: Optional[str] = None) -> WebSearchProvider:
        """
        Create a web search provider instance with optional runtime API key.

        Args:
            provider_name: Name of the provider to create
            api_key: Optional runtime API key (overrides environment config)

        Returns:
            WebSearchProvider instance

        Raises:
            ValueError: If provider not found or API key required but not provided
        """
        config = self.provider_configs.get(provider_name)
        if not config:
            raise ValueError(f"Web search provider '{provider_name}' not found")

        if not config.enabled:
            raise ValueError(f"Web search provider '{provider_name}' is disabled")

        # Build provider configuration
        provider_config = config.default_config.copy()

        if provider_name == "tavily":
            # Tavily requires API key
            if api_key:
                provider_config["api_key"] = api_key
            elif settings.TAVILY_API_KEY:
                provider_config["api_key"] = settings.TAVILY_API_KEY
            else:
                raise ValueError("Tavily API key is required but not provided")

        try:
            provider = config.provider_class(**provider_config)
            logger.info(f"Created web search provider: {provider_name}")
            return provider
        except Exception as e:
            logger.error(f"Failed to create web search provider {provider_name}: {e}")
            raise ValueError(f"Failed to create web search provider {provider_name}: {str(e)}")

    def create_provider_with_fallback(self, provider_name: str, api_key: Optional[str] = None) -> Optional[WebSearchProvider]:
        """
        Create a web search provider with graceful fallback on failure.

        Returns None if provider creation fails instead of raising exception.
        """
        try:
            return self.create_provider(provider_name, api_key)
        except Exception as e:
            logger.warning(f"Failed to create web search provider {provider_name}: {e}")
            return None

    def get_default_provider(self, api_keys: Optional[Dict[str, str]] = None) -> Optional[WebSearchProvider]:
        """
        Get a default web search provider, preferring Tavily if API key is available.

        Args:
            api_keys: Optional dictionary of provider API keys

        Returns:
            WebSearchProvider instance or None if no providers available
        """
        api_keys = api_keys or {}

        # Try Tavily first if API key is available
        if "tavily" in api_keys or settings.TAVILY_API_KEY:
            tavily_provider = self.create_provider_with_fallback("tavily", api_keys.get("tavily"))
            if tavily_provider:
                return tavily_provider

        logger.warning("No web search providers available")
        return None
