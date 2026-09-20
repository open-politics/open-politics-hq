"""
geocoding/provider.py — the Domain itself.
==========================================

  base.py      GeocodingProvider  ─┐
  models.py    GeocodingQuirks    ─┴──►  Geocoding = Domain(…)
                                                     │
  dialects/__init__.py   ──►  Geocoding.dialect("osm") · ("geojson")
  providers.py           ──►  Geocoding(dialect=…, quirks=…) per endpoint

  system_default="GEOCODING_PROVIDER_TYPE" — the one thing embedding's
  Domain deliberately has none of.

  NOT IN THIS FILE
    ../primitives.py  Domain, Dialect, Feature, Binding — what these
                      calls actually build.
    ../resolve.py     how a Binding becomes a live, constructed instance.
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
