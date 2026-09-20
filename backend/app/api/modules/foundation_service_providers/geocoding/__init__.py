"""
geocoding — place names in, coordinates out.
============================================

  base.py      the contract      GeocodingProvider
  models.py    the data          PLACE_TYPES · GeocodingQuirks
  provider.py  the Domain        Geocoding
  dialects/    the wires         osm · geojson
  features/    ── none ──        no runtime discovery, no credential check

  NOT IN THIS FILE
    providers.py  NominatimLocal · NominatimAPI · Mapbox — the three
                  endpoints, each declared model_required=False.
"""

from app.api.modules.foundation_service_providers.geocoding.base import GeocodingProvider
from app.api.modules.foundation_service_providers.geocoding.models import (
    PLACE_TYPES, GeocodingQuirks,
)
from app.api.modules.foundation_service_providers.geocoding.provider import Geocoding

# Registers the wires. Must follow the Domain it registers onto.
from app.api.modules.foundation_service_providers.geocoding import dialects  # noqa: F401

__all__ = ["Geocoding", "GeocodingProvider", "GeocodingQuirks", "PLACE_TYPES"]
