"""
Reactive watchers for graph domain.

Watchers find EntityCanonicals that need re-resolution (e.g. singletons
that may have been created in parallel and should have been merged),
and FragmentCuration entries from superseded assets that should be flagged.
"""

from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from sqlmodel import select

from app.core.config import settings
from app.core.dispatch import _get_enabled_watchers, register_watcher
from app.api.modules.graph.models import EntityCanonical, FragmentCuration
from app.models import Annotation, Asset


class _SupersededEntityRetireWatcher:
    """
    Watcher for FragmentCuration entries whose source Annotation's asset is superseded.
    Dispatches to flag_superseded_entity_sources to mark them for entity resolution.
    Entity resolution can then treat these as candidates for merging with entities
    from the preferred (non-superseded) version.
    """
    name = "superseded_entity_retire"
    task_name = "flag_superseded_entity_sources"
    batch_size = 50

    def build_query(self, session):
        # FragmentCuration -> Annotation -> Asset where Asset.is_superseded
        # Exclude already-flagged (source_asset_superseded = true)
        stmt = (
            select(FragmentCuration.id)
            .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
            .join(Asset, Annotation.asset_id == Asset.id)
            .where(Asset.is_superseded == True)
            .where(FragmentCuration.source_asset_superseded == False)
            .limit(100)
        )
        return stmt


class _ReResolveSingletonWatcher:
    """
    Watcher for EntityCanonicals created as singletons in the last N days.
    Dispatches to re_resolve_entity_singletons to merge duplicates.
    """
    name = "re_resolve_singletons"
    task_name = "re_resolve_entity_singletons"
    batch_size = 20

    def build_query(self, session):
        # Singletons: aliases is null, empty, or only [canonical_name]
        # Optional time window: only consider entities created in last N days (0 = no limit)
        window_days = getattr(settings, "RESOLVE_SINGLETON_WINDOW_DAYS", 7) or 0
        stmt = (
            select(EntityCanonical.id)
            .where(text("(aliases IS NULL OR jsonb_array_length(COALESCE(aliases::jsonb, '[]'::jsonb)) <= 1)"))
            .limit(100)
        )
        if window_days > 0:
            cutoff = datetime.now(timezone.utc) - timedelta(days=window_days)
            stmt = stmt.where(EntityCanonical.created_at >= cutoff)
        return stmt


# Register only when enabled via ENABLED_WATCHERS
enabled = _get_enabled_watchers()
if "superseded_entity_retire" in enabled:
    register_watcher(_SupersededEntityRetireWatcher())
if "re_resolve_singletons" in enabled:
    register_watcher(_ReResolveSingletonWatcher())
