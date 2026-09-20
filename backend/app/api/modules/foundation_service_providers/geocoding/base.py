"""
geocoding/base.py — the contract.
=================================

  "Berlin"  ──►  geocode()  ──►  { coordinates · location_type · bbox
                                   area · display_name · geometry }
                                                 │
                                                 └─ one of models.PLACE_TYPES

  NOT IN THIS FILE
    models.py  PLACE_TYPES itself, and GeocodingQuirks.
    dialects/  osm.py · geojson.py — the two real implementations.

  Returns None on no match. reverse_geocode is deliberately absent: all
  three old providers implemented it and nothing ever called it.
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Protocol, runtime_checkable


@runtime_checkable
class GeocodingProvider(Protocol):
    """Resolve a location string to coordinates and metadata."""

    async def geocode(
        self, location: str, language: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Geocode a place name. ``None`` when nothing matched; six keys on a hit.

        coordinates    [lon, lat] — GeoJSON order
        location_type  one of ``PLACE_TYPES``
        bbox           [south, north, west, east] floats, or None
        area           approximate area in square degrees, or None
        display_name   full formatted name
        geometry       GeoJSON geometry, or None. A real polygon only where the
                       endpoint supports one (``GeocodingQuirks.polygons``).

        A typed ``Place`` is deferred: all three adapters already agree on these
        six keys, so the prose contract is not yet costing anything.
        """
        ...
