"""
Search Provider Registry Service
===============================

Centralized service for discovering and managing search providers with runtime API key support.
Similar to ModelRegistryService but for search providers like Tavily, OPOL, etc.
"""
import logging
from typing import Dict, List, Optional, Tuple
from dataclasses import dataclass

from app.api.providers.base import SearchProvider
from app.api.providers.impl.search_tavily import TavilySearchProvider
from app.api.providers.impl.search_opol import OpolSearchProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class SearchProviderConfig:
    """Configuration for a search provider."""
    name: str
    provider_class: type
    default_config: Dict
    requires_api_key: bool = True
    enabled: bool = True


class SearchProviderRegistryService:
    """
    Centralized service for discovering and managing search providers.
    
    This service:
    - Manages available search providers (Tavily, OPOL, etc.)
    - Creates provider instances with runtime API keys
    - Provides unified access to all search providers
    - Handles provider failures gracefully
    """
    
    def __init__(self):
        self.provider_configs: Dict[str, SearchProviderConfig] = {}
        self._setup_default_providers()
        logger.info("SearchProviderRegistryService initialized")
    
    def _setup_default_providers(self):
        """Setup default search provider configurations."""
        # Tavily provider
        self.provider_configs["tavily"] = SearchProviderConfig(
            name="tavily",
            provider_class=TavilySearchProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )
        
        # OPOL provider (uses environment config as fallback)
        self.provider_configs["opol"] = SearchProviderConfig(
            name="opol",
            provider_class=OpolSearchProvider,
            default_config={
                "opol_mode": settings.OPOL_MODE,
                "opol_api_key": settings.OPOL_API_KEY
            },
            requires_api_key=False,  # Has fallback to env config
            enabled=True
        )
        
        logger.info(f"Configured {len(self.provider_configs)} search providers")
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [name for name, config in self.provider_configs.items() if config.enabled]
    
    def get_provider_info(self, provider_name: str) -> Optional[SearchProviderConfig]:
        """Get configuration info for a specific provider."""
        return self.provider_configs.get(provider_name)
    
    def create_provider(self, provider_name: str, api_key: Optional[str] = None) -> SearchProvider:
        """
        Create a search provider instance with optional runtime API key.
        
        Args:
            provider_name: Name of the provider to create
            api_key: Optional runtime API key (overrides environment config)
            
        Returns:
            SearchProvider instance
            
        Raises:
            ValueError: If provider not found or API key required but not provided
        """
        config = self.provider_configs.get(provider_name)
        if not config:
            raise ValueError(f"Search provider '{provider_name}' not found")
        
        if not config.enabled:
            raise ValueError(f"Search provider '{provider_name}' is disabled")
        
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
        
        elif provider_name == "opol":
            # OPOL can use runtime API key or fall back to environment
            if api_key:
                provider_config["opol_api_key"] = api_key
        
        try:
            provider = config.provider_class(**provider_config)
            logger.info(f"Created search provider: {provider_name}")
            return provider
        except Exception as e:
            logger.error(f"Failed to create search provider {provider_name}: {e}")
            raise ValueError(f"Failed to create search provider {provider_name}: {str(e)}")
    
    def create_provider_with_fallback(self, provider_name: str, api_key: Optional[str] = None) -> Optional[SearchProvider]:
        """
        Create a search provider with graceful fallback on failure.
        
        Returns None if provider creation fails instead of raising exception.
        """
        try:
            return self.create_provider(provider_name, api_key)
        except Exception as e:
            logger.warning(f"Failed to create search provider {provider_name}: {e}")
            return None
    
    def get_default_provider(self, api_keys: Optional[Dict[str, str]] = None) -> Optional[SearchProvider]:
        """
        Get a default search provider, preferring Tavily if API key is available.
        
        Args:
            api_keys: Optional dictionary of provider API keys
            
        Returns:
            SearchProvider instance or None if no providers available
        """
        api_keys = api_keys or {}
        
        # Try Tavily first if API key is available
        if "tavily" in api_keys or settings.TAVILY_API_KEY:
            tavily_provider = self.create_provider_with_fallback("tavily", api_keys.get("tavily"))
            if tavily_provider:
                return tavily_provider
        
        # Fall back to OPOL
        opol_provider = self.create_provider_with_fallback("opol", api_keys.get("opol"))
        if opol_provider:
            return opol_provider
        
        logger.warning("No search providers available")
        return None
