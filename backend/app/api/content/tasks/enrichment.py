"""
Provider-gated enrichment tasks.
Dispatched by ReactiveWatchers when assets need backfilled data (geocoding, etc.).
"""

import logging
from typing import List

from app.core.celery_app import celery
from app.core.task_primitives import task_context
from app.core.task_utils import run_async_in_celery

from app.models import Asset, ProcessingStatus
from app.api.content.facets import (
    FACET_LOCATION,
    FACET_LOCATION_LAT,
    FACET_LOCATION_LON,
    get_facet,
    set_facet,
)

logger = logging.getLogger(__name__)


@celery.task(name="enrich_geocoding")
def enrich_geocoding_task(asset_ids: List[int]):
    """
    Reactive watcher task: geocodes assets that have facets.location but are missing
    facets.location_lat / location_lon. Uses GeocodingProvider from task_context.
    """
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        with task_context(providers=["geocoding"]) as (session, prov):
            geocoding = prov.get("geocoding")
            if not geocoding:
                logger.warning("Geocoding provider not configured; skipping enrich_geocoding")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}

            enriched = 0
            failed = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    failed += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY:
                    continue
                meta = asset.source_metadata or {}
                location = get_facet(meta, FACET_LOCATION)
                lat = get_facet(meta, FACET_LOCATION_LAT)
                lon = get_facet(meta, FACET_LOCATION_LON)
                if not location or not isinstance(location, str) or not location.strip():
                    continue
                if lat is not None and lon is not None:
                    continue  # Already has coordinates
                try:
                    result = await geocoding.geocode(location.strip())
                    if result and "coordinates" in result:
                        coords = result["coordinates"]
                        if len(coords) >= 2:
                            set_facet(meta, FACET_LOCATION_LON, float(coords[0]))
                            set_facet(meta, FACET_LOCATION_LAT, float(coords[1]))
                            if result.get("display_name"):
                                set_facet(meta, FACET_LOCATION, result["display_name"])
                            asset.source_metadata = meta
                            session.add(asset)
                            enriched += 1
                        else:
                            failed += 1
                    else:
                        logger.debug(f"No geocoding result for asset {asset_id} location '{location[:50]}'")
                        failed += 1
                except Exception as e:
                    logger.warning(f"Geocoding failed for asset {asset_id}: {e}")
                    failed += 1
            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)
