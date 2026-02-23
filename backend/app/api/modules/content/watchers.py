"""
Reactive watchers for content domain.

Watchers find entities that need work and dispatch tasks by name.
Registered at import time; loaded by Celery worker via imports list.
"""

from sqlalchemy import text
from sqlalchemy.sql import exists
from sqlmodel import select

from app.core.dispatch import register_watcher
from app.api.modules.content.models import Asset, AssetChunk, AssetKind, ProcessingStatus
from app.api.modules.content.types import get_content_type_registry
from app.api.modules.content.utils.watcher_filters import non_superseded_filter


class _NeedsOcrWatcher:
    """
    Watcher for PDF_PAGE assets with no text_content that need OCR.
    Dispatches to enrich_ocr. Layer 1: text_content IS NULL.
    """
    name = "needs_ocr"
    task_name = "enrich_ocr"
    batch_size = 10

    def build_query(self, session):
        q = (
            select(Asset.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.kind == AssetKind.PDF_PAGE,
                Asset.text_content.is_(None),
                Asset.parent_asset_id.isnot(None),
            )
            .where(text("(source_metadata->'facets'->>'ocr_used') IS NULL"))
        )
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(200)


class _ReadyToEmbedWatcher:
    """
    Watcher for assets that are READY but have no chunks/embeddings.
    Dispatches to reactive_embed_pending_assets for batch embedding.
    """
    name = "ready_to_embed"
    task_name = "reactive_embed_pending_assets"
    batch_size = 20

    def build_query(self, session):
        # Assets with status READY, text_content, and no AssetChunk.
        # Exclude container kinds (embed children instead to prevent double-dispatch).
        # Exclude superseded assets and children of superseded parents.
        has_chunk = exists().where(AssetChunk.asset_id == Asset.id)
        registry = get_content_type_registry()
        container_kinds = [k for k in registry._by_kind if registry.is_container(k)]
        q = (
            select(Asset.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.text_content.isnot(None),
                ~has_chunk,
            )
        )
        if container_kinds:
            q = q.where(Asset.kind.notin_(container_kinds))
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(500)


class _MissingHashWatcher:
    """
    Watcher for READY assets with blob_path but no content_hash.
    Dispatches to enrich_file_hash for SHA-256 backfill.
    """
    name = "missing_hash"
    task_name = "enrich_file_hash"
    batch_size = 50

    def build_query(self, session):
        q = (
            select(Asset.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.blob_path.isnot(None),
                Asset.content_hash.is_(None),
                Asset.parent_asset_id.is_(None),  # Only top-level files, not children
            )
        )
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(500)


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
        q = (
            select(Asset.id)
            .where(Asset.processing_status == ProcessingStatus.READY)
            .where(text("source_metadata->'facets'->>'location' IS NOT NULL"))
            .where(text("(source_metadata->'facets'->>'location') != ''"))
            .where(text("source_metadata->'facets'->>'location_lat' IS NULL"))
        )
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(200)


# Register at module import
register_watcher(_NeedsOcrWatcher())
register_watcher(_MissingHashWatcher())
register_watcher(_ReadyToEmbedWatcher())
register_watcher(_MissingGeocodingWatcher())
