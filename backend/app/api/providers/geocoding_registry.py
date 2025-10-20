"""
Geocoding Provider Registry Service
====================================

Centralized service for discovering and managing geocoding providers with runtime API key support.
Follows the same pattern as SearchProviderRegistryService and EmbeddingProviderRegistryService.
"""
import logging
from typing import Dict, List, Optional, Any
from dataclasses import dataclass

from app.api.providers.base import GeocodingProvider
from app.api.providers.impl.geocoding_nominatim_local import NominatimLocalGeocodingProvider
from app.api.providers.impl.geocoding_nominatim_api import NominatimAPIGeocodingProvider
from app.api.providers.impl.geocoding_mapbox import MapboxGeocodingProvider
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class GeocodingProviderConfig:
    """Configuration for a geocoding provider."""
    name: str
    provider_class: type
    default_config: Dict
    requires_api_key: bool = True
    enabled: bool = True


class GeocodingProviderRegistryService:
    """
    Centralized service for discovering and managing geocoding providers.
    
    This service:
    - Manages available geocoding providers (Local Nominatim, Public API, Mapbox)
    - Creates provider instances with runtime API keys
    - Provides unified access to all geocoding providers
    - Handles provider failures gracefully with automatic fallback
    - Supports runtime API key injection from frontend
    """
    
    def __init__(self):
        self.provider_configs: Dict[str, GeocodingProviderConfig] = {}
        self.providers: Dict[str, GeocodingProvider] = {}  # Cached instances for free providers
        self._setup_default_providers()
        logger.info("GeocodingProviderRegistryService initialized")
    
    def _setup_default_providers(self):
        """Setup default geocoding provider configurations."""
        
        # Local Nominatim provider - no API key needed, self-hosted
        self.provider_configs["local"] = GeocodingProviderConfig(
            name="local",
            provider_class=NominatimLocalGeocodingProvider,
            default_config={
                "base_url": settings.NOMINATIM_BASE_URL
            },
            requires_api_key=False,
            enabled=True
        )
        
        # Public Nominatim API provider - no API key needed, rate limited
        self.provider_configs["nominatim_api"] = GeocodingProviderConfig(
            name="nominatim_api",
            provider_class=NominatimAPIGeocodingProvider,
            default_config={
                "user_agent": settings.GEOCODING_USER_AGENT
            },
            requires_api_key=False,
            enabled=True
        )
        
        # Mapbox provider - requires API key
        self.provider_configs["mapbox"] = GeocodingProviderConfig(
            name="mapbox",
            provider_class=MapboxGeocodingProvider,
            default_config={},
            requires_api_key=True,
            enabled=True
        )
        
        logger.info(f"Configured {len(self.provider_configs)} geocoding providers")
    
    def get_available_providers(self) -> List[str]:
        """Get list of available provider names."""
        return [name for name, config in self.provider_configs.items() if config.enabled]
    
    def get_provider_info(self, provider_name: str) -> Optional[GeocodingProviderConfig]:
        """Get configuration info for a specific provider."""
        return self.provider_configs.get(provider_name)
    
    def create_provider(self, provider_name: str, api_key: Optional[str] = None) -> GeocodingProvider:
        """
        Create a geocoding provider instance with optional runtime API key.
        
        Args:
            provider_name: Name of the provider ('local', 'nominatim_api', 'mapbox')
            api_key: Optional runtime API key (required for 'mapbox')
            
        Returns:
            GeocodingProvider instance
            
        Raises:
            ValueError: If provider not found, disabled, or missing required API key
        """
        config = self.provider_configs.get(provider_name)
        if not config:
            raise ValueError(f"Geocoding provider '{provider_name}' not found")
        
        if not config.enabled:
            raise ValueError(f"Geocoding provider '{provider_name}' is disabled")
        
        # For free providers (no API key needed), use cached instance
        if not config.requires_api_key:
            if provider_name not in self.providers:
                self.providers[provider_name] = config.provider_class(**config.default_config)
                logger.info(f"Created geocoding provider: {provider_name}")
            return self.providers[provider_name]
        
        # Paid providers require API key (runtime or env fallback)
        effective_api_key = api_key or getattr(settings, 'MAPBOX_ACCESS_TOKEN', None)
        if not effective_api_key:
            raise ValueError(f"Geocoding provider '{provider_name}' requires an API key")
        
        provider = config.provider_class(api_key=effective_api_key)
        logger.info(f"Created geocoding provider: {provider_name}")
        return provider
    
    def create_provider_with_fallback(self, provider_name: str, api_key: Optional[str] = None) -> Optional[GeocodingProvider]:
        """
        Create a geocoding provider with graceful fallback on failure.
        
        Returns None if provider creation fails instead of raising exception.
        Useful for automatic fallback chains.
        """
        try:
            return self.create_provider(provider_name, api_key)
        except Exception as e:
            logger.warning(f"Failed to create geocoding provider {provider_name}: {e}")
            return None
    
    async def geocode_with_fallback(self, location: str, language: Optional[str] = 'en') -> Optional[Dict[str, Any]]:
        """
        Geocode a location with automatic provider fallback chain.
        
        Strategy: local Nominatim → public Nominatim API
        
        Args:
            location: Location name or address to geocode
            language: Language code for results (default: 'en')
            
        Returns:
            Geocoding result dict with 'provider' field, or None if all providers fail
        """
        # Try providers in order: local → public API
        for provider_name in ["local", "nominatim_api"]:
            provider = self.create_provider_with_fallback(provider_name)
            if not provider:
                continue
            
            try:
                result = await provider.geocode(location, language=language)
                if result:
                    result['provider'] = provider_name
                    logger.info(f"Geocoded '{location}' using {provider_name}")
                    return result
            except Exception as e:
                logger.warning(f"Geocoding provider '{provider_name}' failed for '{location}': {e}")
        
        logger.warning(f"All geocoding providers failed for: {location}")
        return None

