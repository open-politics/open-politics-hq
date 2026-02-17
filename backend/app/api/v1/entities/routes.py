from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse
from ..locations.services import update_leaders
from ..locations.schemas import CountryRequest, CountryResponse, Law
import logging
import json
import requests
from pathlib import Path
from typing import List
from ..locations.country_services import legislation, economy
from ..locations.country_services import articles
import tavily
from enum import Enum
from typing import Optional

BASE_DIR = Path(__file__).resolve().parent.parent.parent.parent

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

router = APIRouter()
class SearchType(str, Enum):
    TEXT = "text"
    SEMANTIC = "semantic"

@router.get("/{location}/articles", response_model=None)
async def get_location_articles(
    location: str,
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    search_query: Optional[str] = None,
    search_type: SearchType = SearchType.TEXT,
):
    try:
        result = await articles.get_articles(
            location, skip, limit, search_query, search_type.value,
        )
        return JSONResponse(content=result, status_code=200)
    except Exception as e:
        logger.error(f"Error fetching articles: {str(e)}")
        return JSONResponse(content={'error': 'Failed to fetch articles'}, status_code=500)

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
    

@router.get("/score_over_time/{entity}", response_model=None)
async def get_entity_score_over_time(
    entity: str,
    score_type: str,
    timeframe_from: str,
    timeframe_to: str
):
    try:
        # Create the payload
        payload = {
            "entity": entity,
            "score_type": score_type,
            "timeframe_from": timeframe_from,
            "timeframe_to": timeframe_to
        }
        
        logger.info(f"Sending request to postgres_service with payload: {payload}")
        
        response = requests.post(
            "http://api.opol.io/postgres-service/entity_score_over_time",
            json=payload,
            headers={'Content-Type': 'application/json'},
            verify=False
        )
        
        # Log the raw response
        logger.info(f"Raw response from postgres: Status={response.status_code}, Content={response.content}")
        
        response.raise_for_status()
        data = response.json()
        
        if not data:
            logger.warning(f"No data found for entity {entity} in timeframe {timeframe_from} to {timeframe_to}")
            return JSONResponse(
                content=[],
                status_code=200
            )
            
        return JSONResponse(content=data, status_code=200)
        
    except requests.RequestException as e:
        logger.error(f"Error fetching entity scores: {str(e)}")
        return JSONResponse(
            content={'error': f'Failed to fetch entity scores: {str(e)}'},
            status_code=500
        )
    except json.JSONDecodeError as e:
        logger.error(f"Error decoding JSON response: {str(e)}")
        return JSONResponse(
            content={'error': 'Invalid JSON response from database service'},
            status_code=500
        )

@router.get("/top_entities_by_score")
async def get_top_entities_by_score(
    score_type: str = Query(..., description="Type of score to rank entities by"),
    timeframe_from: str = Query(..., description="Start date in ISO format"),
    timeframe_to: str = Query(..., description="End date in ISO format"),
    limit: int = Query(10, description="Number of top entities to retrieve")
):
    try:
        params = {
            "score_type": score_type,
            "timeframe_from": timeframe_from,
            "timeframe_to": timeframe_to,
            "limit": limit
        }
        
        response = requests.get(
            "http://api.opol.io/postgres-service/top_entities_by_score",
            params=params,
            verify=False
        )
        response.raise_for_status()
        return JSONResponse(content=response.json(), status_code=200)
        
    except requests.RequestException as e:
        logger.error(f"Error fetching top entities: {str(e)}")
        return JSONResponse(
            content={'error': 'Failed to fetch top entities'},
            status_code=500
        )