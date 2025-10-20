"""
Nominatim free API geocoding provider implementation.
Uses the public Nominatim API at nominatim.openstreetmap.org.
Rate limited: 1 request/second per IP.
"""
import logging
from typing import Optional, Dict, Any
import httpx
import asyncio

logger = logging.getLogger(__name__)


class NominatimAPIGeocodingProvider:
    """
    Geocoding provider using public Nominatim API.
    Rate limited to 1 request/second as per usage policy.
    """
    
    def __init__(self, user_agent: str = "OpenPoliticsHQ/1.0"):
        """
        Initialize the Nominatim API provider.
        
        Args:
            user_agent: User agent string (required by Nominatim usage policy)
        """
        self.base_url = "https://nominatim.openstreetmap.org"
        self.user_agent = user_agent
        self._last_request_time = 0.0
        self._rate_limit_delay = 1.0  # 1 second between requests
        
        # Custom mappings for special cases
        self.custom_mappings = {
            "europe": {
                'coordinates': [13.405, 52.52],
                'location_type': 'continent',
                'bbox': [-24.539906, 34.815009, 69.033946, 81.85871],
                'area': 1433.861436,
                'display_name': 'Europe'
            },
        }
    
    async def _rate_limit(self):
        """Enforce rate limiting: 1 request per second."""
        current_time = asyncio.get_event_loop().time()
        time_since_last = current_time - self._last_request_time
        
        if time_since_last < self._rate_limit_delay:
            await asyncio.sleep(self._rate_limit_delay - time_since_last)
        
        self._last_request_time = asyncio.get_event_loop().time()
    
    async def geocode(self, location: str, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Geocode a location using public Nominatim API.
        
        Args:
            location: Location name or address to geocode
            language: Optional language code for results
            
        Returns:
            Geocoding result dictionary or None if not found
        """
        # Check custom mappings first
        if location.lower() in self.custom_mappings:
            return self.custom_mappings[location.lower()]
        
        # Enforce rate limiting
        await self._rate_limit()
        
        try:
            # Build request parameters
            params = {
                'q': location,
                'format': 'json',
                'limit': 1,
                'addressdetails': 1,
                'extratags': 1,
                'namedetails': 1,
                'polygon_geojson': 1  # Request GeoJSON geometry for future polygon support
            }
            if language:
                params['accept-language'] = language
            
            headers = {
                'User-Agent': self.user_agent
            }
            
            # Make request to public Nominatim API
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/search",
                    params=params,
                    headers=headers
                )
                response.raise_for_status()
                data = response.json()
            
            if not data or len(data) == 0:
                logger.warning(f"No geocoding results for location: {location}")
                return None
            
            # Parse the top result
            result = data[0]
            lat = float(result.get('lat'))
            lon = float(result.get('lon'))
            boundingbox = result.get('boundingbox', [])
            
            # Map Nominatim's type/class to our location_type
            osm_type = result.get('type', 'location')
            osm_class = result.get('class', '')
            location_type = self._map_nominatim_type(osm_type, osm_class)
            
            # Calculate approximate area from bounding box
            area = None
            if len(boundingbox) == 4:
                bbox_floats = [float(b) for b in boundingbox]
                lat_diff = bbox_floats[1] - bbox_floats[0]
                lon_diff = bbox_floats[3] - bbox_floats[2]
                area = lat_diff * lon_diff
            
            return {
                'coordinates': [lon, lat],
                'location_type': location_type,
                'bbox': boundingbox if boundingbox else None,
                'area': area,
                'display_name': result.get('display_name', location),
                'geometry': result.get('geojson')  # Future: complex polygons/borders
            }
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                logger.warning("Nominatim API rate limit exceeded")
            else:
                logger.error(f"Nominatim API HTTP error: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"Nominatim API request error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error geocoding location {location}: {str(e)}")
            return None
    
    async def reverse_geocode(self, lat: float, lon: float, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Reverse geocode coordinates using public Nominatim API.
        
        Args:
            lat: Latitude
            lon: Longitude
            language: Optional language code for results
            
        Returns:
            Reverse geocoding result dictionary or None if not found
        """
        # Enforce rate limiting
        await self._rate_limit()
        
        try:
            params = {
                'lat': lat,
                'lon': lon,
                'format': 'json',
                'addressdetails': 1,
                'extratags': 1,
                'namedetails': 1,
                'polygon_geojson': 1  # Request GeoJSON geometry for future polygon support
            }
            if language:
                params['accept-language'] = language
            
            headers = {
                'User-Agent': self.user_agent
            }
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(
                    f"{self.base_url}/reverse",
                    params=params,
                    headers=headers
                )
                response.raise_for_status()
                data = response.json()
            
            if not data:
                logger.warning(f"No reverse geocoding results for coordinates: ({lat}, {lon})")
                return None
            
            # Parse address components
            address = data.get('address', {})
            
            return {
                'display_name': data.get('display_name', ''),
                'address': address,
                'location_type': self._map_nominatim_type(data.get('type', ''), data.get('class', '')),
                'coordinates': [lon, lat],
                'geometry': data.get('geojson')  # Future: complex polygons/borders
            }
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                logger.warning("Nominatim API rate limit exceeded")
            else:
                logger.error(f"Nominatim API reverse geocoding HTTP error: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"Nominatim API reverse geocoding request error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error reverse geocoding ({lat}, {lon}): {str(e)}")
            return None
    
    def _map_nominatim_type(self, osm_type: str, osm_class: str) -> str:
        """Map Nominatim's OSM type/class to our location_type."""
        type_mapping = {
            'country': 'country',
            'state': 'state',
            'province': 'state',
            'city': 'city',
            'town': 'city',
            'village': 'locality',
            'hamlet': 'locality',
            'suburb': 'locality',
            'neighbourhood': 'locality',
            'county': 'county',
            'region': 'region'
        }
        return type_mapping.get(osm_type.lower(), 'location')

