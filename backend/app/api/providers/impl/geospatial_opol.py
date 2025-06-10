"""
Concrete implementations of geospatial providers.
"""
import logging
from typing import Any, Dict, List, Optional

from app.core.opol_config import opol
from app.api.providers.base import GeospatialProvider # Corrected import path

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class OpolGeospatialProvider(GeospatialProvider):
    """
    OPOL implementation of the GeospatialProvider interface.
    """
    
    def __init__(self, opol_mode: Optional[str] = None, opol_api_key: Optional[str] = None): # Added opol_mode and opol_api_key
        """
        Initialize the OPOL geospatial provider.
        """
        self._check_opol_available()
        # Store opol_mode and opol_api_key if needed for provider-specific logic,
        # though OPOL often relies on global config.
        self.opol_mode = opol_mode
        self.opol_api_key = opol_api_key
        logger.info("OPOL geospatial provider initialized")
    
    def _check_opol_available(self):
        """Check if OPOL is available."""
        if not opol:
            logger.error("OPOL instance is not available for geospatial data")
            raise ConnectionError("Geospatial service (OPOL) is not available")
    
    async def get_geojson(self, start_date: Optional[str] = None, 
                         end_date: Optional[str] = None, 
                         limit: int = 100) -> Dict[str, Any]:
        """
        Get GeoJSON data within a specified time range using OPOL.
        
        Args:
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            limit: Maximum number of locations to return
            
        Returns:
            GeoJSON formatted data
        """
        self._check_opol_available()
        
        try:
            logger.debug(f"Getting GeoJSON data with start_date: {start_date}, end_date: {end_date}, limit: {limit}")
            
            geojson_data = opol.geo.json(
                start_date=start_date,
                end_date=end_date,
                limit=limit
            )
            
            if not geojson_data:
                logger.warning("No GeoJSON data returned from OPOL")
                return {
                    "type": "FeatureCollection",
                    "features": []
                }
            
            if not isinstance(geojson_data, dict):
                logger.warning(f"Unexpected GeoJSON data type: {type(geojson_data)}")
                try:
                    geojson_data = dict(geojson_data)
                except (TypeError, ValueError):
                    logger.error("Could not convert GeoJSON data to dictionary")
                    return {
                        "type": "FeatureCollection",
                        "features": []
                    }
            
            if "type" not in geojson_data:
                logger.warning("GeoJSON data missing 'type' field")
                geojson_data["type"] = "FeatureCollection"
                
            if "features" not in geojson_data:
                logger.warning("GeoJSON data missing 'features' field")
                geojson_data["features"] = []
            
            logger.debug(f"GeoJSON data returned with {len(geojson_data.get('features', []))} features")
            return geojson_data
            
        except Exception as e:
            logger.error(f"Error getting GeoJSON data: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to get GeoJSON data: {str(e)}")
    
    async def get_geojson_by_event(self, event_type: str, 
                                  start_date: Optional[str] = None,
                                  end_date: Optional[str] = None, 
                                  limit: int = 100) -> Dict[str, Any]:
        """
        Get GeoJSON data for a specific event type using OPOL.
        
        Args:
            event_type: The type of event
            start_date: Optional start date for filtering
            end_date: Optional end date for filtering
            limit: Maximum number of locations to return
            
        Returns:
            GeoJSON formatted data
        """
        self._check_opol_available()
        
        try:
            logger.debug(f"Getting GeoJSON data for event_type: {event_type}, start_date: {start_date}, end_date: {end_date}, limit: {limit}")
            
            geojson_data = opol.geo.json_by_event(
                event_type=event_type,
                start_date=start_date,
                end_date=end_date,
                limit=limit
            )
            
            if not geojson_data:
                logger.warning(f"No GeoJSON data returned for event type: {event_type}")
                return {
                    "type": "FeatureCollection",
                    "features": []
                }
            
            if not isinstance(geojson_data, dict):
                logger.warning(f"Unexpected GeoJSON data type for event: {type(geojson_data)}")
                try:
                    geojson_data = dict(geojson_data)
                except (TypeError, ValueError):
                    logger.error("Could not convert event GeoJSON data to dictionary")
                    return {
                        "type": "FeatureCollection",
                        "features": []
                    }
            
            if "type" not in geojson_data:
                logger.warning("Event GeoJSON data missing 'type' field")
                geojson_data["type"] = "FeatureCollection"
                
            if "features" not in geojson_data:
                logger.warning("Event GeoJSON data missing 'features' field")
                geojson_data["features"] = []
            
            logger.debug(f"Event GeoJSON data returned with {len(geojson_data.get('features', []))} features")
            return geojson_data
            
        except Exception as e:
            logger.error(f"Error getting GeoJSON data for event type {event_type}: {str(e)}", exc_info=True)
            raise ValueError(f"Failed to get GeoJSON data for event type {event_type}: {str(e)}")

# Factory function removed, will be in factory.py 