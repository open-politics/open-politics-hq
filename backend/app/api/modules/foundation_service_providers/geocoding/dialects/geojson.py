"""
geojson.py — Mapbox's FeatureCollection wire.

  GET {base}/{location}.json ──► features[0] ──► the domain's six keys
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

        # the query goes in the path: an unescaped space or slash 404s
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

        # mapbox bbox is [minLon, minLat, maxLon, maxLat]; the contract wants [S, N, W, E]
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
            # mapbox returns a point, never boundary geometry
            "geometry": top.get("geometry"),
        }


# drift guard: a wire may only map into the domain's vocabulary
assert set(WIRE_TYPES.values()) <= PLACE_TYPES, (
    f"{sorted(set(WIRE_TYPES.values()) - PLACE_TYPES)} is not in geocoding's PLACE_TYPES"
)
