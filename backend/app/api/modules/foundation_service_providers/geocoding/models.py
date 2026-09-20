"""
geocoding/models.py — this domain's data models.
================================================

  PLACE_TYPES        country · state · county · region · city · locality
                     · address · poi — every dialect maps its wire's
                     own types INTO this vocabulary.

  GeocodingQuirks     every field is read by dialects/osm.py alone —
                      geojson.py (Mapbox) reads none of them.
    polygons               boundary geometry, where asked (Mapbox returns
                           a point instead)
    rate_limit_seconds     client-side throttle (public policy: 1/sec)
    user_agent             sent as User-Agent (public API rejects none)

  NOT IN THIS FILE
    base.py          GeocodingProvider — the contract these types serve.
    dialects/osm.py  WIRE_TYPES — Nominatim's vocabulary, mapped in.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


#: The vocabulary every dialect maps into; nothing outside it may be emitted.
PLACE_TYPES = frozenset({
    "country", "state", "county", "region", "city", "locality", "address", "poi",
})


@dataclass(frozen=True)
class GeocodingQuirks:
    """Endpoint deviations within a geocoding dialect. Each names its endpoint.

    ``polygons`` was first drafted as a feature. It is not: a feature provides
    callable surface; this states a FACT about what the endpoint returns, which
    then changes one request parameter. Facts about an endpoint are quirks.
    """
    #: Ask for boundary geometry. (osm/both — Mapbox returns a point instead.)
    polygons: bool = False
    #: Client-side min seconds between requests. (osm/public — policy is 1/sec.)
    rate_limit_seconds: float = 0.0
    #: Sent as User-Agent. (osm/public — Nominatim rejects requests without one.)
    user_agent: Optional[str] = None
