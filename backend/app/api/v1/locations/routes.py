from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from fastapi.responses import HTMLResponse
from fastapi.responses import StreamingResponse
from fastapi.responses import Response
from .services import update_leaders
from .schemas import CountryRequest, CountryResponse, Law
import logging
import json
import requests
from pathlib import Path
from typing import List
from .country_services import legislation, economy
from .country_services import articles
import tavily
from enum import Enum
from typing import Optional
from sentinelsat import SentinelAPI
from datetime import date, timedelta, datetime
from sentinelhub import SHConfig, DataCollection, SentinelHubRequest, BBox, CRS, MimeType
from io import BytesIO
from PIL import Image
import os
from app.core.config import settings




BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()



@router.get("/leaders/{state}")
async def get_leader_info(state: str):
    leaders_file_path = BASE_DIR / 'static' / 'country_data' / 'leaders.json'
    try:
        with open(leaders_file_path, 'r') as f:
            leaders = json.load(f)
        for leader in leaders:
            if leader['State'] == state:
                return JSONResponse(content=leader, status_code=200)
        return JSONResponse(content={'error': 'State not found'}, status_code=404)
    except FileNotFoundError:
        return JSONResponse(content={'error': 'Leaders file not found'}, status_code=404)

@router.get("/legislation/{state}", response_model=None)
async def get_legislation_data(state: str):
    if state == "Germany":
        result = legislation.get_legislation_data(state)
        return JSONResponse(content=result, status_code=200)
    else:
        return JSONResponse(content={'error': 'State not found'}, status_code=404)

@router.get("/econ_data/{state}", response_model=None)
async def get_econ_data(state: str, indicators: List[str] = Query(["GDP", "GDP_GROWTH"])):
    result = await economy.get_econ_data(state, indicators)
    return JSONResponse(content=result, status_code=200)

@router.get("/update_leaders/")
async def update_leaders():
    logging.info("Updating leaders data...")
    update_leaders()
    return {"message": "Leaders data updated successfully."}

@router.get("/get_articles", response_model=None)
async def get_tavily_data():
    result = tavily.get_tavily_data()
    return JSONResponse(content=result, status_code=200)

def call_nominatim_api(location, lang=None):
    """
    Call Nominatim search API for geocoding. Handles varied location formats from LLM.
    Nominatim's search endpoint is flexible and works with various location formats.
    """
    custom_mappings = {
        "europe": {
            'coordinates': [13.405, 52.52],
            'location_type': 'continent',
            'bbox': [-24.539906, 34.815009, 69.033946, 81.85871],
            'area': 1433.861436
        },
    }

    if location.lower() in custom_mappings:
        return custom_mappings[location.lower()]

    try:
        # Nominatim's /search endpoint is the most flexible - handles cities, countries, addresses, etc.
        url = f"http://nominatim:8721/search"
        params = {
            'q': location,
            'format': 'json',
            'limit': 1,
            'addressdetails': 1,
            'extratags': 1,
            'namedetails': 1
        }
        if lang:
            params['accept-language'] = lang

        response = requests.get(url, params=params, timeout=10)
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                top_result = data[0]
                lat = float(top_result.get('lat'))
                lon = float(top_result.get('lon'))
                boundingbox = top_result.get('boundingbox', [])
                
                # Map Nominatim's type/class to our location_type
                osm_type = top_result.get('type', 'location')
                osm_class = top_result.get('class', '')
                location_type = _map_nominatim_type(osm_type, osm_class)
                
                # Calculate approximate area from bounding box (in degrees squared, rough estimate)
                area = None
                if len(boundingbox) == 4:
                    bbox_floats = [float(b) for b in boundingbox]
                    # bbox format: [min_lat, max_lat, min_lon, max_lon]
                    lat_diff = bbox_floats[1] - bbox_floats[0]
                    lon_diff = bbox_floats[3] - bbox_floats[2]
                    area = lat_diff * lon_diff
                
                return {
                    'coordinates': [lon, lat],  # [lon, lat] format
                    'location_type': location_type,
                    'bbox': boundingbox if boundingbox else None,
                    'area': area
                }
            else:
                logger.warning(f"No data returned from Nominatim for location: {location}")
        else:
            logger.error(f"Nominatim API call failed with status code: {response.status_code}")
    except requests.RequestException as e:
        logger.error(f"Nominatim API call exception for location {location}: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error for location {location}: {str(e)}")
    return None

def _map_nominatim_type(osm_type, osm_class):
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


@router.get("/get_coordinates")
async def get_coordinates(location: str, language: str = "en"):
    """
    Fetches the coordinates, bounding box, and location type for a given location.
    """
    try:
        logger.info(f"Geocoding location: {location}")
        coordinates = call_nominatim_api(location, lang=language)
        logger.info(f"Coordinates: {coordinates}")

        if coordinates:
            return {
                "coordinates": coordinates['coordinates'],
                "location_type": coordinates['location_type'],
                "bbox": coordinates.get('bbox'),
                "area": coordinates.get('area')
            }
        else:
            raise HTTPException(status_code=404, detail="Unable to geocode location")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error fetching coordinates for location {location}: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal server error")

from .country_services.economy import COUNTRY_TO_ISO  # Import the existing mapping

@router.get("/metadata/{location}")
async def get_location_metadata(location: str):
    """
    Get metadata about a location including supported features
    """
    return {
        "isOECDCountry": location in COUNTRY_TO_ISO,
        "isLegislativeEnabled": location.lower() == "germany"
    }

from pydantic import BaseModel

class QueryType(BaseModel):
    type: str 

class Request(BaseModel):
    "Request object for search synthesizer"
    query: str
    query_type: QueryType
    



@router.get("/channel/{service_name}/{path:path}", response_model=None)
async def channel_route(service_name: str, path: str, request: Request):
    """
    A channel route that forwards requests to a specified service.
    """
    try:
        # Construct the URL for the target service
        target_url = f"http://{service_name}/{path}"
        
        # Forward the request to the target service
        response = requests.request(
            method=request.method,
            url=target_url,
            headers=request.headers,
            params=request.query_params,
            data=await request.body(),
            verify=False
        )
        
        # Return the response from the target service
        return Response(
            content=response.content,
            status_code=response.status_code,
            headers=dict(response.headers)
        )
    except requests.RequestException as e:
        logger.error(f"Error forwarding request to {service_name}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error forwarding request: {str(e)}")