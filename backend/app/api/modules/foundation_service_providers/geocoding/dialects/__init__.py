"""
geocoding/dialects — which wires exist.
=======================================

  osm       Nominatim jsonv2   GET {base}/search        list of hits
            serves BOTH Nominatim deployments; they differ only by a
            base URL, a required User-Agent and a rate limit.
  geojson   Mapbox             GET {base}/{q}.json      FeatureCollection

  The clearest proof that a dialect is packaging, not a vendor.

  NOT IN THIS FILE
    provider.py  Geocoding.dialect(…) — how these get registered.
    ../base.py   GeocodingProvider — the Protocol both wires implement.
"""

from app.api.modules.foundation_service_providers.geocoding.provider import Geocoding

Geocoding.dialect("osm", module="osm", adapter="OsmGeocoder")
Geocoding.dialect("geojson", module="geojson", adapter="GeoJsonGeocoder")
