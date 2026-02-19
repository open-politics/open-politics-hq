"""
Reactive watchers for content domain.

Watchers find entities that need work and dispatch tasks by name.
Registered at import time; loaded by Celery worker via imports list.
"""

from sqlalchemy import text
from sqlalchemy.sql import exists
from sqlmodel import select

from app.core.dispatch import register_watcher
from app.api.modules.content.models import Asset, AssetChunk, ProcessingStatus


class _ReadyToEmbedWatcher:
    """
    Watcher for assets that are READY but have no chunks/embeddings.
    Dispatches to reactive_embed_pending_assets for batch embedding.
    """
    name = "ready_to_embed"
    task_name = "reactive_embed_pending_assets"
    batch_size = 20

    def build_query(self, session):
        # Assets with status READY, text_content, and no AssetChunk
        has_chunk = exists().where(AssetChunk.asset_id == Asset.id)
        return (
            select(Asset.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.text_content.isnot(None),
                ~has_chunk,
            )
            .limit(500)
        )


class _MissingGeocodingWatcher:
    """
    Watcher for READY assets that have facets.location but are missing location_lat.
    Dispatches to enrich_geocoding for provider-gated geocoding backfill.
    """
    name = "missing_geocoding"
    task_name = "enrich_geocoding"
    batch_size = 20

    def build_query(self, session):
        # READY assets with location facet but missing location_lat
        return (
            select(Asset.id)
            .where(Asset.processing_status == ProcessingStatus.READY)
            .where(text("source_metadata->'facets'->>'location' IS NOT NULL"))
            .where(text("(source_metadata->'facets'->>'location') != ''"))
            .where(text("source_metadata->'facets'->>'location_lat' IS NULL"))
            .limit(200)
        )


# Register at module import
register_watcher(_ReadyToEmbedWatcher())
register_watcher(_MissingGeocodingWatcher())
