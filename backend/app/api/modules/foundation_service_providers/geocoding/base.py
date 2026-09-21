"""
geocoding/base.py — the GeocodingProvider protocol.

  "Berlin" ──► geocode() ──► six keys, or None when nothing matched
"""

from __future__ import annotations

from typing import Any, Dict, Optional, Protocol, runtime_checkable


@runtime_checkable
class GeocodingProvider(Protocol):
    """Resolve a location string to coordinates and metadata."""

    async def geocode(
        self, location: str, language: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Geocode a place name. ``None`` when nothing matched, else six keys:

        coordinates    [lon, lat] — GeoJSON order
        location_type  one of ``PLACE_TYPES``
        bbox           [south, north, west, east] floats, or None
        area           approximate area in square degrees, or None
        display_name   full formatted name
        geometry       GeoJSON geometry, or None — a real polygon only where the
                       endpoint supports one (``GeocodingQuirks.polygons``)
        """
        ...
