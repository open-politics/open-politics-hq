"""
Reactive watchers for content domain.

Watchers find entities that need work and dispatch tasks by name.
EnricherWatcher: generic watcher auto-generated from Enricher descriptors.
_EmbeddingWatcher: custom watcher for embedding (needs infospace join that EnricherWatcher can't auto-generate).
"""

from sqlalchemy import text
from sqlalchemy.sql import exists
from sqlmodel import select

from app.core.dispatch import MAX_PER_WATCHER_PER_CYCLE, _get_enabled_watchers, register_watcher
from app.api.modules.content.models import Asset, AssetChunk, AssetKind, ProcessingStatus
from app.api.modules.content.types import get_content_type_registry
from app.api.modules.content.enrichers import ENRICHER_REGISTRY
from app.api.modules.content.utils.watcher_filters import non_superseded_filter


# Columns on Asset that can be used for missing_check (column-based)
_ASSET_SCALAR_COLUMNS = frozenset({"content_hash", "text_content"})


class EnricherWatcher:
    """
    Generic watcher generated from an Enricher descriptor.
    build_query() derives from requires_field, missing_check, requires_modality, applicable_kinds.
    """

    def __init__(self, enricher):
        self.enricher = enricher
        self.name = enricher.name
        self.task_name = enricher.task_name
        self.batch_size = enricher.batch_size
        self.depends_on = enricher.depends_on

    def build_query(self, session):
        q = select(Asset.id).where(Asset.processing_status == ProcessingStatus.READY)

        # applicable_kinds
        if self.enricher.applicable_kinds:
            q = q.where(Asset.kind.in_(self.enricher.applicable_kinds))

        # requires_field: column must exist / be non-null
        if self.enricher.requires_field:
            col = getattr(Asset, self.enricher.requires_field, None)
            if col is not None:
                q = q.where(col.isnot(None))

        # requires_facet: facets key must be present and non-empty
        if self.enricher.requires_facet:
            q = q.where(text(f"metadata->>'{self.enricher.requires_facet}' IS NOT NULL"))
            q = q.where(text(f"(metadata->>'{self.enricher.requires_facet}') != ''"))

        # missing_check: facets key or column must be NULL
        if self.enricher.missing_check:
            if self.enricher.missing_check in _ASSET_SCALAR_COLUMNS:
                col = getattr(Asset, self.enricher.missing_check, None)
                if col is not None:
                    q = q.where(col.is_(None))
            else:
                q = q.where(text(f"(metadata->>'{self.enricher.missing_check}') IS NULL"))

        # exclude_when_facet: skip assets that have this facet set (e.g. ocr_failed)
        if self.enricher.exclude_when_facet:
            q = q.where(text(f"(metadata->>'{self.enricher.exclude_when_facet}') IS NULL"))

        # requires_modality: positive predicate on Asset.discovered_modalities (JSONB array)
        if self.enricher.requires_modality:
            from json import dumps
            arr = dumps([self.enricher.requires_modality]).replace("'", "''")
            q = q.where(text(f"(discovered_modalities @> '{arr}'::jsonb)"))

        if self.enricher.top_level_only:
            q = q.where(Asset.parent_asset_id.is_(None))
        if self.enricher.children_only:
            q = q.where(Asset.parent_asset_id.isnot(None))

        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(MAX_PER_WATCHER_PER_CYCLE)


class _EmbeddingWatcher:
    """
    Watcher for assets ready for embedding.

    Custom watcher because the query needs an Infospace join to check
    embedding_selection is configured — beyond what EnricherWatcher can
    auto-generate.  Text content is checked now; image modality support
    can be added here when we ship image embedding.
    """
    name = "embedding"
    task_name = "enrich_embedding"
    batch_size = 20
    depends_on = "ocr"
    # No capability gate: embedding is per-infospace (not system-wide).
    # The build_query() already gates on embedding_selection being configured.

    def build_query(self, session):
        from app.api.modules.identity_infospace_user.models import Infospace

        has_chunk = exists().where(AssetChunk.asset_id == Asset.id)
        registry = get_content_type_registry()
        container_kinds = registry.container_kinds()
        q = (
            select(Asset.id)
            .join(Infospace, Asset.infospace_id == Infospace.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.text_content.isnot(None),
                ~has_chunk,
                Infospace.embedding_selection.isnot(None),
                text("(embedding_selection->>'model_name') IS NOT NULL"),
            )
        )
        if container_kinds:
            q = q.where(Asset.kind.notin_(container_kinds))
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(MAX_PER_WATCHER_PER_CYCLE)


# Register watchers only when enabled via ENABLED_WATCHERS
enabled = _get_enabled_watchers()

for enricher in ENRICHER_REGISTRY.values():
    if not enabled or enricher.name not in enabled:
        continue
    if enricher.missing_check or (enricher.name == "hash" and enricher.requires_field):
        register_watcher(EnricherWatcher(enricher))

if enabled and "embedding" in enabled:
    register_watcher(_EmbeddingWatcher())

# Hot-path: event bus subscriptions for immediate dispatch (watchers remain as backfill)
from app.core.events import subscribe

for enricher in ENRICHER_REGISTRY.values():
    if enricher.event_trigger and enabled and enricher.name in enabled:
        subscribe(enricher.event_trigger, enricher.task_name, args_key="asset_id")

if enabled and "embedding" in enabled:
    subscribe(
        "asset.enriched",
        "enrich_embedding",
        args_key="asset_id",
        filter_key="enricher_name",
        filter_value="ocr",
    )
