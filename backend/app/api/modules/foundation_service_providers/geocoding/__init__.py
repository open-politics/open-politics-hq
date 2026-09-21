"""
geocoding — place names in, coordinates out.

  base.py      GeocodingProvider
  models.py    PLACE_TYPES · GeocodingQuirks
  provider.py  the Geocoding domain
  dialects/    osm · geojson
"""

from app.api.modules.foundation_service_providers.geocoding.base import GeocodingProvider
from app.api.modules.foundation_service_providers.geocoding.models import (
    PLACE_TYPES, GeocodingQuirks,
)
from app.api.modules.foundation_service_providers.geocoding.provider import Geocoding

# side-effect import: registers the dialects onto the Domain
from app.api.modules.foundation_service_providers.geocoding import dialects  # noqa: F401

__all__ = ["Geocoding", "GeocodingProvider", "GeocodingQuirks", "PLACE_TYPES"]
