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
from opol import OPOL
import os
from app.core.config import settings

opol = OPOL(mode=os.getenv("OPOL_MODE"), api_key=os.getenv("OPOL_API_KEY"))


BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()

@router.get("/{location}/contents", response_model=None)
async def get_location_contents(
    location: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Get articles related to a location with basic pagination.
    """
    try:
        response = opol.articles.by_location(location, skip, limit)
        response.raise_for_status()
        
        return JSONResponse(content=response.json(), status_code=200)
        
    except requests.RequestException as e:
        logger.error(f"Error fetching contents for location {location}: {str(e)}")
        return JSONResponse(
            content={
                'error': 'Failed to fetch contents',
                'detail': str(e)
            }, 
            status_code=500
        )

@router.get("/{location}/entities/contents", response_model=None)
async def get_location_entities_contents(
    location: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
):
    """
    Get articles related to a location with basic pagination.
    """
    try:
        response = opol.articles.by_entity(location, skip, limit)
        
        return JSONResponse(content=response.json(), status_code=200)
        
    except requests.RequestException as e:
        logger.error(f"Error fetching contents for location {location}: {str(e)}")
        return JSONResponse(
            content={
                'error': 'Failed to fetch contents',
                'detail': str(e)
            }, 
            status_code=500
        ) 

@router.get("/location_from_query")
async def location_from_query(query: str):
    try:
        # Get location from classification service
        location_response = requests.get(
            f"https://api.opol.io/classification-service/location_from_query?query={query}", 
            verify=False
        )
        location_response.raise_for_status()
        location = location_response.json()

        # Get coordinates from geo service
        geo_response = requests.get(
            f"https://api.opol.io/geo-service/geocode_location?location={location}", 
            verify=False
        )
        geo_response.raise_for_status()
        data = geo_response.json()

        # Log the full response for debugging
        logger.info(f"Geo service response: {data}")

        return {
            "country_name": location,
            "coordinates": data.get('coordinates'),  # This is already [lon, lat]
            "bbox": data.get('bbox'),
            "area": data.get('area'),
            "location_type": data.get('location_type', 'locality')  # Add location_type
        }
    except requests.RequestException as e:
        logger.error(f"Service request failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Service request failed: {str(e)}")
    except (KeyError, IndexError, json.JSONDecodeError) as e:
        logger.error(f"Error processing response: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error processing response: {str(e)}")

@router.get("/geojson/")
async def geojson_view():
    request = requests.get("https://api.opol.io/geo-service/geojson", verify=False)
    if request.status_code == 200:
        return request.json()
    else:
        raise HTTPException(status_code=request.status_code, detail="Unable to fetch GeoJSON data")

@router.get("/geojson_events")
async def geojson_events_view(event_type: str = Query(...)):
    request = requests.get(f"http://api.opol.io/geo-service/geojson_events/{event_type}", verify=False)
    if request.status_code == 200:
        return request.json()
    else:
        raise HTTPException(status_code=request.status_code, detail="Unable to fetch events GeoJSON data")

@router.get("/dashboard", response_class=HTMLResponse)
async def dashboard_view():
    try:
        # Update the URL to point to the correct service name or IP address
        request = requests.get("http://api.opol.io/core_app/", verify=False)
        request.raise_for_status()  # Raise an exception for HTTP errors
        
        # Return the raw HTML content
        return HTMLResponse(content=request.text, status_code=200)
    except requests.RequestException as e:
        logger.error(f"Error fetching dashboard data: {str(e)}")
        raise HTTPException(status_code=request.status_code, detail="Unable to fetch dashboard data")

@router.get("/{location_name}/entities", response_model=None)
async def get_location_entities(
    location_name: str, 
    skip: int = 0, 
    limit: int = 50,
    min_relevance: float = 0.0  # Add minimum relevance threshold
):
    try:
        response = requests.get(
            f"http://api.opol.io/postgres-service/location_entities/{location_name}",
            params={
                "skip": skip,
                "limit": limit,
                "min_relevance": min_relevance
            }
        )
        response.raise_for_status()
        
        # Map entity types to match frontend expectations / due to changing NER model
        entity_type_mapping = {
            # "organization": "ORG",
            # "person": "PERSON",
            # "location": "GPE",
            "x" : "y"
        }
        
        entities = response.json()
        mapped_entities = [{
            **entity,
            "type": entity_type_mapping.get(entity["type"].lower(), entity["type"].upper())
        } for entity in entities]
        
        return JSONResponse(content=mapped_entities, status_code=200)
    except requests.RequestException as e:
        logger.error(f"Error fetching location entities: {str(e)}")
        return JSONResponse(
            content={'error': 'Failed to fetch location entities'}, 
            status_code=500
        )

@router.get("/leaders/{state}")
async def get_leader_info(state: str):
    leaders_file_path = BASE_DIR / 'static' / 'country_data' / 'leaders.json'
    try:
        with open(leaders_file_path, 'r') as f:
            leaders = json.load(f)
        for leader in leaders:
            if leader['State'] == state:
                return leader
        raise HTTPException(status_code=404, detail="State not found")
    except FileNotFoundError:
        logging.error(f"Leaders JSON file not found at {leaders_file_path}")  
        raise HTTPException(status_code=404, detail="Leaders file not found")
    except json.JSONDecodeError:
        logging.error("Error decoding JSON data.")
        raise HTTPException(status_code=500, detail="Error decoding leaders data")

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

def call_pelias_api(location, lang=None):
    """Call Pelias API for geocoding with custom mappings for certain locations."""
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
        pelias_url = settings.PELIAS_PLACEHOLDER_PORT
        url = f"http://{pelias_url}/parser/search?text={location}"
        if lang:
            url += f"&lang={lang}"

        response = requests.get(url)
        if response.status_code == 200:
            data = response.json()
            if data and len(data) > 0:
                top_result = data[0]
                geometry = top_result.get('geom')
                location_type = top_result.get('placetype', 'location')
                if geometry:
                    bbox = geometry.get('bbox')
                    area = geometry.get('area')
                    return {
                        'coordinates': [geometry.get('lon'), geometry.get('lat')],
                        'location_type': location_type if location_type else 'location',
                        'bbox': bbox.split(',') if bbox else None,
                        'area': area
                    }
                else:
                    logger.warning(f"No geometry found for location: {location}")
            else:
                logger.warning(f"No data returned from API for location: {location}")
        else:
            logger.error(f"API call failed with status code: {response.status_code}")
    except requests.RequestException as e:
        logger.error(f"API call exception for location {location}: {str(e)}")
    except Exception as e:
        logger.error(f"Unexpected error for location {location}: {str(e)}")
    return None


@router.get("/get_coordinates")
async def get_coordinates(location: str, language: str = "en"):
    """
    Fetches the coordinates, bounding box, and location type for a given location.
    """
    try:
        logger.info(f"Geocoding location: {location}")
        coordinates = call_pelias_api(location, lang=language)
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

@router.post("/get_geojson_for_article_ids")
async def get_geojson_for_article_ids(article_ids: List[str]):
    # Ensure article_ids are strings
    article_ids = [str(article_id) for article_id in article_ids]
    
    # Log the payload for debugging
    logger.debug(f"Sending article_ids: {article_ids}")

    # Send the request with the correct headers
    geojson_data = requests.post(
        "http://api.opol.io/geo-service/geojson_by_article_ids",
        json=article_ids, 
        headers={"Content-Type": "application/json"},
        verify=False
    )
    
    if geojson_data.status_code == 200:
        return JSONResponse(content=geojson_data.json(), status_code=200)
    else:
        logger.error(f"Failed to fetch GeoJSON data: {geojson_data.text}")
        raise HTTPException(status_code=geojson_data.status_code, detail="Unable to fetch GeoJSON data")

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