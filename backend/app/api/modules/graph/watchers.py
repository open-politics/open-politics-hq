"""
Reactive watchers for graph domain.

Watchers find EntityCanonicals that need re-resolution (e.g. singletons
that may have been created in parallel and should have been merged),
and FragmentCuration entries from superseded assets that should be flagged.
"""

from datetime import datetime, timedelta, timezone
from sqlalchemy import text
from sqlmodel import select

from app.core.dispatch import register_watcher
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
        # Exclude already-flagged (resolved_refs->>'source_asset_superseded' = 'true')
        stmt = (
            select(FragmentCuration.id)
            .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
            .join(Asset, Annotation.asset_id == Asset.id)
            .where(Asset.is_superseded == True)
            .where(
                text(
                    "fragmentcuration.resolved_refs IS NULL OR "
                    "(fragmentcuration.resolved_refs->>'source_asset_superseded') IS NULL"
                )
            )
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
        # Created in last 7 days
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        stmt = (
            select(EntityCanonical.id)
            .where(EntityCanonical.created_at >= cutoff)
            .where(text("aliases IS NULL OR jsonb_array_length(COALESCE(aliases::jsonb, '[]'::jsonb)) <= 1"))
            .limit(100)
        )
        return stmt


register_watcher(_SupersededEntityRetireWatcher())
register_watcher(_ReResolveSingletonWatcher())
