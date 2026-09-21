"""
geocoding dialects — osm (both Nominatim deployments) · geojson (Mapbox).
"""

from app.api.modules.foundation_service_providers.geocoding.provider import Geocoding

Geocoding.dialect("osm", module="osm", adapter="OsmGeocoder")
Geocoding.dialect("geojson", module="geojson", adapter="GeoJsonGeocoder")
