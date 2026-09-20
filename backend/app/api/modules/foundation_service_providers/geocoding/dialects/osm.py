"""
osm.py — Nominatim jsonv2, self-hosted or public.
=================================================

  geocode(location)
       │
       ├─ in CUSTOM_PLACES?  ─►  return the canned hit (OSM has no
       │                        node for a continent — "europe" etc.)
       │
       ├─ _throttle()  no-op unless quirks.rate_limit_seconds > 0
       │
       └─ GET {base}/search?q=…  ─►  [ {lat, lon, boundingbox, geojson,
                                       display_name, class, type}, … ]
               │
               └─ top = data[0]
                     WIRE_TYPES[class/type]  ─►  PLACE_TYPES
                     boundingbox strings     ─►  bbox floats + area

  headers()  quirks.user_agent ─►  User-Agent, or none (self-hosted
            doesn't care; the public API rejects a request without one)

  NOT IN THIS FILE
    ../base.py    the six-key return contract this fills in.
    ../models.py  PLACE_TYPES — the vocabulary WIRE_TYPES maps into.

  Two ~200-line files (self-hosted, public) collapsed into one wire
  plus three quirks. The trailing assert guards WIRE_TYPES from ever
  drifting outside PLACE_TYPES.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, Optional

import httpx

from app.api.modules.foundation_service_providers.base import Adapter
from app.api.modules.foundation_service_providers.geocoding import PLACE_TYPES

logger = logging.getLogger(__name__)

#: Continents have no OSM node, so "Europe" returns empty. Asked for constantly.
CUSTOM_PLACES: Dict[str, Dict[str, Any]] = {
    "europe": {
        "coordinates": [13.405, 52.52],
        "location_type": "continent",
        "bbox": [-24.539906, 34.815009, 69.033946, 81.85871],
        "area": 1433.861436,
        "display_name": "Europe",
        "geometry": None,
    },
}

#: OSM class/type → the domain's PLACE_TYPES vocabulary.
WIRE_TYPES: Dict[str, str] = {
    "country": "country",
    "state": "state",
    "province": "state",
    "city": "city",
    "town": "city",
    "village": "locality",
    "hamlet": "locality",
    "suburb": "locality",
    "neighbourhood": "locality",
    "county": "county",
    "region": "region",
}


class OsmGeocoder(Adapter):
    """Nominatim, self-hosted or public."""

    timeout = 10.0

    def __init__(self, **kw):
        super().__init__(**kw)
        self._last_request = 0.0

    def headers(self) -> dict:
        # The public endpoint rejects a missing User-Agent; self-hosted does not care.
        return {"User-Agent": self.quirks.user_agent} if self.quirks.user_agent else {}

    async def _throttle(self) -> None:
        """Client-side rate limit. No-op when the quirk is 0 (self-hosted)."""
        gap = self.quirks.rate_limit_seconds
        if not gap:
            return
        loop = asyncio.get_event_loop()
        elapsed = loop.time() - self._last_request
        if elapsed < gap:
            await asyncio.sleep(gap - elapsed)
        self._last_request = loop.time()

    async def geocode(
        self, location: str, language: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        custom = CUSTOM_PLACES.get(location.lower())
        if custom:
            return custom

        await self._throttle()

        params: Dict[str, Any] = {
            "q": location,
            "format": "json",
            "limit": 1,
            "addressdetails": 1,
            "extratags": 1,
            "namedetails": 1,
        }
        if self.quirks.polygons:
            params["polygon_geojson"] = 1
        if language:
            params["accept-language"] = language

        try:
            response = await self.client.get(self.url("/search"), params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error("Nominatim HTTP %s for %r", e.response.status_code, location)
            return None
        except httpx.RequestError as e:
            logger.error("Nominatim unreachable for %r: %s", location, e)
            return None

        if not data:
            logger.warning("No geocoding results for %r", location)
            return None

        top = data[0]
        lat, lon = float(top["lat"]), float(top["lon"])

        # boundingbox arrives as strings; normalise once so the renderer gets numbers.
        bbox = None
        area = None
        raw_bbox = top.get("boundingbox") or []
        if len(raw_bbox) == 4:
            bbox = [float(b) for b in raw_bbox]          # [south, north, west, east]
            area = (bbox[1] - bbox[0]) * (bbox[3] - bbox[2])

        return {
            "coordinates": [lon, lat],
            "location_type": WIRE_TYPES.get(str(top.get("type", "")).lower(), "location"),
            "bbox": bbox,
            "area": area,
            "display_name": top.get("display_name", location),
            "geometry": top.get("geojson"),
        }


# Drift guard: a wire may only map into the domain's vocabulary.
assert set(WIRE_TYPES.values()) <= PLACE_TYPES, (
    f"{sorted(set(WIRE_TYPES.values()) - PLACE_TYPES)} is not in geocoding's PLACE_TYPES"
)
