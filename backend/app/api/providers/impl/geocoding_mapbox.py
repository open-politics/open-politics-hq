"""
Mapbox geocoding provider implementation.
Uses Mapbox Geocoding API with API key authentication.
"""
import logging
from typing import Optional, Dict, Any
from urllib.parse import quote
import httpx

logger = logging.getLogger(__name__)


class MapboxGeocodingProvider:
    """
    Geocoding provider using Mapbox Geocoding API.
    Requires API key for authentication.
    """
    
    def __init__(self, api_key: str):
        """
        Initialize the Mapbox provider.
        
        Args:
            api_key: Mapbox API access token
        """
        self.api_key = api_key
        self.base_url = "https://api.mapbox.com/geocoding/v5/mapbox.places"
    
    async def geocode(self, location: str, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Geocode a location using Mapbox API.
        
        Args:
            location: Location name or address to geocode
            language: Optional language code for results (e.g., 'en', 'es')
            
        Returns:
            Geocoding result dictionary or None if not found
        """
        try:
            # URL-encode the location for use in the path (critical for spaces, special chars)
            encoded_location = quote(location.strip(), safe='')
            
            # Build request parameters
            params = {
                'access_token': self.api_key,
                'limit': 1
            }
            if language:
                params['language'] = language
            
            # Make request to Mapbox Geocoding API
            async with httpx.AsyncClient(timeout=10.0) as client:
                # Mapbox uses the search query as part of the URL path - MUST be URL encoded
                url = f"{self.base_url}/{encoded_location}.json"
                logger.info(f"Mapbox request: '{location}' -> URL: {url}")
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
                logger.info(f"Mapbox raw response for '{location}': {len(data.get('features', []))} features")
            
            # Check if we have results
            features = data.get('features', [])
            if not features:
                logger.warning(f"No Mapbox geocoding results for location: {location}")
                return None
            
            # Parse the top result
            result = features[0]
            coordinates = result.get('center', [])  # [lon, lat]
            bbox = result.get('bbox')  # [min_lon, min_lat, max_lon, max_lat]
            
            # Mapbox provides place_type array (e.g., ['country'], ['city'])
            place_types = result.get('place_type', [])
            location_type = self._map_mapbox_type(place_types)
            
            # Log detailed result for debugging
            logger.info(f"Mapbox result for '{location}': place_name='{result.get('place_name')}', "
                       f"coordinates={coordinates}, type={place_types}")
            
            # Calculate area if bbox is available
            area = None
            if bbox and len(bbox) == 4:
                lat_diff = bbox[3] - bbox[1]
                lon_diff = bbox[2] - bbox[0]
                area = lat_diff * lon_diff
            
            # Convert bbox to Nominatim format [min_lat, max_lat, min_lon, max_lon]
            normalized_bbox = None
            if bbox and len(bbox) == 4:
                normalized_bbox = [bbox[1], bbox[3], bbox[0], bbox[2]]
            
            return {
                'coordinates': coordinates,  # [lon, lat]
                'location_type': location_type,
                'bbox': normalized_bbox,
                'area': area,
                'display_name': result.get('place_name', location),
                'geometry': result.get('geometry')  # Mapbox returns point geometry; polygons require separate API
            }
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                logger.error("Mapbox API authentication failed - invalid API key")
            elif e.response.status_code == 429:
                logger.warning("Mapbox API rate limit exceeded")
            else:
                logger.error(f"Mapbox API HTTP error: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"Mapbox API request error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error geocoding location {location}: {str(e)}")
            return None
    
    async def reverse_geocode(self, lat: float, lon: float, language: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Reverse geocode coordinates using Mapbox API.
        
        Args:
            lat: Latitude
            lon: Longitude
            language: Optional language code for results
            
        Returns:
            Reverse geocoding result dictionary or None if not found
        """
        try:
            params = {
                'access_token': self.api_key
            }
            if language:
                params['language'] = language
            
            # Mapbox reverse geocoding uses lon,lat in the URL
            url = f"{self.base_url}/{lon},{lat}.json"
            
            async with httpx.AsyncClient(timeout=10.0) as client:
                response = await client.get(url, params=params)
                response.raise_for_status()
                data = response.json()
            
            features = data.get('features', [])
            if not features:
                logger.warning(f"No Mapbox reverse geocoding results for coordinates: ({lat}, {lon})")
                return None
            
            # Parse the most relevant result
            result = features[0]
            
            # Extract address components from context
            address_components = {}
            context = result.get('context', [])
            for item in context:
                item_id = item.get('id', '')
                if item_id.startswith('country'):
                    address_components['country'] = item.get('text', '')
                elif item_id.startswith('region'):
                    address_components['state'] = item.get('text', '')
                elif item_id.startswith('place'):
                    address_components['city'] = item.get('text', '')
                elif item_id.startswith('postcode'):
                    address_components['postcode'] = item.get('text', '')
            
            place_types = result.get('place_type', [])
            
            return {
                'display_name': result.get('place_name', ''),
                'address': address_components,
                'location_type': self._map_mapbox_type(place_types),
                'coordinates': [lon, lat],
                'geometry': result.get('geometry')  # Point geometry from Mapbox
            }
            
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 401:
                logger.error("Mapbox API authentication failed - invalid API key")
            elif e.response.status_code == 429:
                logger.warning("Mapbox API rate limit exceeded")
            else:
                logger.error(f"Mapbox API reverse geocoding HTTP error: {e.response.status_code}")
            return None
        except httpx.RequestError as e:
            logger.error(f"Mapbox API reverse geocoding request error: {str(e)}")
            return None
        except Exception as e:
            logger.error(f"Unexpected error reverse geocoding ({lat}, {lon}): {str(e)}")
            return None
    
    def _map_mapbox_type(self, place_types: list) -> str:
        """Map Mapbox place_type to our location_type."""
        if not place_types:
            return 'location'
        
        # Use the first place_type
        place_type = place_types[0]
        
        type_mapping = {
            'country': 'country',
            'region': 'state',
            'place': 'city',
            'district': 'locality',
            'locality': 'locality',
            'neighborhood': 'locality',
            'address': 'address',
            'poi': 'poi'
        }
        return type_mapping.get(place_type, 'location')
