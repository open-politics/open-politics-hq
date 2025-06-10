from fastapi import APIRouter, HTTPException, Query, Depends
import os
from datetime import datetime
import asyncio

from app.api.deps import GeospatialProviderDep
from app.api.providers.base import GeospatialProvider

router = APIRouter()

@router.get("/geojson_events")
async def geojson_events_view(
    event_type: str = Query(...),
    start_date: str = Query(None, description="ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)"),
    end_date: str = Query(None, description="ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)"),
    limit: int = Query(100, description="Maximum number of locations to return"),
    geospatial_provider: GeospatialProvider = Depends(GeospatialProviderDep)
):
    if start_date:
        try:
            datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")
    
    if end_date:
        try:
            datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")

    try:
        events_geojson_data = await geospatial_provider.get_geojson_by_event(
            event_type=event_type,
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )

        if not events_geojson_data or not events_geojson_data.get("features"):
            raise HTTPException(status_code=404, detail="No GeoJSON data found for the specified parameters.")
        
        return events_geojson_data
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except ConnectionError as ce:
        raise HTTPException(status_code=503, detail=str(ce))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")


@router.get("/geojson")
async def geojson_raw_view(
    start_date: str = Query(None, description="ISO formatted start date (e.g. 2023-01-01T00:00:00+00:00)"),
    end_date: str = Query(None, description="ISO formatted end date (e.g. 2023-12-31T23:59:59+00:00)"),
    limit: int = Query(100, description="Maximum number of locations to return"),
    geospatial_provider: GeospatialProvider = Depends(GeospatialProviderDep)
):
    if start_date:
        try:
            datetime.fromisoformat(start_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid start_date format")
    
    if end_date:
        try:
            datetime.fromisoformat(end_date.replace('Z', '+00:00'))
        except ValueError:
            raise HTTPException(status_code=400, detail="Invalid end_date format")
            
    try:
        geojson_data = await geospatial_provider.get_geojson(
            start_date=start_date,
            end_date=end_date,
            limit=limit
        )
        
        if not geojson_data or not geojson_data.get("features"):
            raise HTTPException(status_code=404, detail="No GeoJSON data found for the specified parameters.")

        return geojson_data
    except ValueError as ve:
        raise HTTPException(status_code=400, detail=str(ve))
    except ConnectionError as ce:
        raise HTTPException(status_code=503, detail=str(ce))
    except Exception as e:
        raise HTTPException(status_code=500, detail="Internal server error while fetching GeoJSON data.")