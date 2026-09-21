"""
geocoding/models.py — PLACE_TYPES · GeocodingQuirks.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


#: the vocabulary every dialect maps its wire's own types into.
PLACE_TYPES = frozenset({
    "country", "state", "county", "region", "city", "locality", "address", "poi",
})


@dataclass(frozen=True)
class GeocodingQuirks:
    """Endpoint deviations within a geocoding dialect."""
    #: ask for boundary geometry. (nominatim; mapbox only ever returns a point.)
    polygons: bool = False
    #: client-side minimum seconds between requests. (public nominatim: 1/sec.)
    rate_limit_seconds: float = 0.0
    #: sent as User-Agent. (public nominatim rejects a request without one.)
    user_agent: Optional[str] = None
