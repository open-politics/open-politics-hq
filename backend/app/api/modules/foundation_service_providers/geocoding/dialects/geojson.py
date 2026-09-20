"""
geojson.py — Mapbox's FeatureCollection wire.
=============================================

  geocode(location)
       │
       ▼
  GET {base}/{url-encoded location}.json?access_token=…
       │
       ▼
  { features: [ {center, bbox, place_type, place_name, geometry} ] }
       │
       └─ top = features[0]
             center                      ─►  coordinates ([lon,lat])
             place_type[0], WIRE_TYPES    ─►  location_type
             bbox [minLon,minLat,maxLon,maxLat], reordered
                                         ─►  [south, north, west, east]
             geometry                     ─►  geometry (point only)

  NOT IN THIS FILE
    ../base.py  the six-key return contract this fills in.
    osm.py      same contract, different packaging: query in the
                path, a FeatureCollection, GeoJSON's own bbox order.

  401 ─► bad token. 429 ─► rate limit. Both logged distinctly before
  the generic HTTP-error fallback. Point geometry only — real
  boundaries need a separate paid API.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional
from urllib.parse import quote

import httpx

from app.api.modules.foundation_service_providers.base import Adapter
from app.api.modules.foundation_service_providers.geocoding import PLACE_TYPES

logger = logging.getLogger(__name__)

#: Mapbox place_type → the domain's PLACE_TYPES vocabulary.
WIRE_TYPES: Dict[str, str] = {
    "country": "country",
    "region": "state",
    "place": "city",
    "district": "locality",
    "locality": "locality",
    "neighborhood": "locality",
    "address": "address",
    "poi": "poi",
}


class GeoJsonGeocoder(Adapter):
    """Mapbox Geocoding v5."""

    timeout = 10.0

    async def geocode(
        self, location: str, language: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        params: Dict[str, Any] = {"access_token": self.api_key, "limit": 1}
        if language:
            params["language"] = language

        # Query is in the path, so an unescaped space or slash 404s, not misses.
        url = self.url(f"/{quote(location.strip(), safe='')}.json")

        try:
            response = await self.client.get(url, params=params)
            response.raise_for_status()
            features = response.json().get("features") or []
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                logger.error("Mapbox authentication failed — invalid access token")
            elif e.response.status_code == 429:
                logger.error("Mapbox rate limit hit")
            else:
                logger.error("Mapbox HTTP %s for %r", e.response.status_code, location)
            return None
        except httpx.RequestError as e:
            logger.error("Mapbox unreachable for %r: %s", location, e)
            return None

        if not features:
            logger.warning("No Mapbox geocoding results for %r", location)
            return None

        top = features[0]
        place_types = top.get("place_type") or []

        # Mapbox [min_lon,min_lat,max_lon,max_lat] → contract [S,N,W,E]. Reorder only.
        bbox = top.get("bbox")
        normalised = None
        area = None
        if bbox and len(bbox) == 4:
            normalised = [bbox[1], bbox[3], bbox[0], bbox[2]]
            area = (bbox[3] - bbox[1]) * (bbox[2] - bbox[0])

        return {
            "coordinates": top.get("center", []),                  # already [lon, lat]
            "location_type": WIRE_TYPES.get(place_types[0], "location") if place_types else "location",
            "bbox": normalised,
            "area": area,
            "display_name": top.get("place_name", location),
            # Point only; real boundaries need a separate paid API, hence no `polygons`.
            "geometry": top.get("geometry"),
        }


# Drift guard: a wire may only map into the domain's vocabulary.
assert set(WIRE_TYPES.values()) <= PLACE_TYPES, (
    f"{sorted(set(WIRE_TYPES.values()) - PLACE_TYPES)} is not in geocoding's PLACE_TYPES"
)
