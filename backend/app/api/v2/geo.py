from opol import OPOL
import os
from fastapi import APIRouter, HTTPException, Query
import requests
import logging
from datetime import datetime

logger = logging.getLogger(__name__)

router = APIRouter()

opol = OPOL(mode=os.getenv("OPOL_MODE"), api_key=os.getenv("OPOL_API_KEY"))
# opol = OPOL(mode="container", api_key=os.getenv("OPOL_API_KEY"))

@router.get("/geojson_events")
async def geojson_events_view(
    event_type: str = Query(...),
    start_date: str = Query(None, description="ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)"),
    end_date: str = Query(None, description="ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)"),
    limit: int = Query(100, description="Maximum number of locations to return")
):
    # Validate date formats
    if start_date and start_date is not None:
        try:
            datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")
    
    if end_date and end_date is not None:
        try:
            datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    try:
        logger.info(f"Fetching GeoJSON data for event_type: {event_type}, start_date: {start_date}, end_date: {end_date}, limit: {limit}")
        
        events_geojson_data = opol.geo.json_by_event(
            event_type=event_type,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )

        # Log all dates of all articles retrieved
        if events_geojson_data and 'features' in events_geojson_data:
            for feature in events_geojson_data['features']:
                if 'properties' in feature and 'contents' in feature['properties']:
                    contents = feature['properties']['contents']
                    if isinstance(contents, str):
                        try:
                            import json
                            contents = json.loads(contents)
                        except Exception as e:
                            logger.error(f"Error parsing contents JSON: {e}")
                            contents = []
                    
                    if isinstance(contents, list):
                        for article in contents:
                            if 'insertion_date' in article:
                                logger.info(f"Article date: {article['insertion_date']} - Title: {article.get('title', 'No title')}")

        if not events_geojson_data:
            logger.warning(f"No GeoJSON data returned for event_type: {event_type} in specified date range")
            raise HTTPException(status_code=404, detail="No GeoJSON data found for the specified parameters.")
        
        # Optionally, validate the GeoJSON structure here
        logger.info(events_geojson_data)
        return events_geojson_data
    except Exception as e:
        logger.error(f"Error fetching GeoJSON data for event type '{event_type}' with date range: {e}")
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")


# Get all events in a specific timeframe
@router.get("/geojson")
async def geojson_raw_view(
    start_date: str = Query(None, description="ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)"),
    end_date: str = Query(None, description="ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)"),
    limit: int = Query(100, description="Maximum number of locations to return")
):
    try:
        logger.info(f"Fetching raw GeoJSON data for start_date: {start_date}, end_date: {end_date}, limit: {limit}")

        geojson_data = opol.geo.json(
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        
        return geojson_data
     
    except Exception as e:
        logger.error(f"Error fetching Baseline GeoJSON data: {e}")
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")

        