"""
geocoding/provider.py — the Geocoding domain: protocol, quirks, package root.
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.geocoding.base import GeocodingProvider
from app.api.modules.foundation_service_providers.geocoding.models import GeocodingQuirks

Geocoding = Domain(
    name="geocoding",
    protocol=GeocodingProvider,
    package="app.api.modules.foundation_service_providers.geocoding",
    system_default="GEOCODING_PROVIDER_TYPE",
    quirks_type=GeocodingQuirks,
)
