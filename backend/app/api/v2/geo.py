from opol import OPOL
import os
from fastapi import APIRouter, HTTPException, Query
import requests
from datetime import datetime

router = APIRouter()

opol = OPOL(mode=os.getenv("OPOL_MODE"), api_key=os.getenv("OPOL_API_KEY"))

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
        events_geojson_data = opol.geo.json_by_event(
            event_type=event_type,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )

        if not events_geojson_data:
            raise HTTPException(status_code=404, detail="No GeoJSON data found for the specified parameters.")
        
        return events_geojson_data
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")


@router.get("/geojson")
async def geojson_raw_view(
    start_date: str = Query(None, description="ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)"),
    end_date: str = Query(None, description="ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)"),
    limit: int = Query(100, description="Maximum number of locations to return")
):
    try:
        geojson_data = opol.geo.json(
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        
        return geojson_data
     
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")