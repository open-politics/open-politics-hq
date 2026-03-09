"""
Reactive watchers for annotation domain.

Watchers find entities that need post-annotation work (e.g. graph curation, version follow-ups).
"""

from sqlalchemy import table, column
from sqlalchemy.sql import exists
from sqlmodel import select

from app.core.dispatch import _get_enabled_watchers, register_watcher
from app.api.modules.annotation.models import Annotation, AnnotationRun
from app.models import Asset, ResultStatus
from app.api.modules.content.models import ProcessingStatus
from app.api.modules.content.utils.watcher_filters import non_superseded_filter


class _VersionGapAnnotationWatcher:
    """
    Watcher for versioned assets (previous_asset_id) that have no annotations
    but whose previous version had annotations from runs with follow_on_version_change=True.
    Dispatches to create_followup_annotation_runs.
    """
    name = "version_gap_annotation"
    task_name = "create_followup_annotation_runs"
    batch_size = 10

    def build_query(self, session):
        # Subquery: previous asset has annotations from flagged runs
        prev_has_flagged = (
            select(1)
            .select_from(Annotation)
            .join(AnnotationRun, Annotation.run_id == AnnotationRun.id)
            .where(
                Annotation.asset_id == Asset.previous_asset_id,
                AnnotationRun.follow_on_version_change == True,
            )
        )
        # Current asset has no annotations
        has_no_annotations = ~exists().where(Annotation.asset_id == Asset.id)
        q = (
            select(Asset.id)
            .where(
                Asset.processing_status == ProcessingStatus.READY,
                Asset.previous_asset_id.isnot(None),
                has_no_annotations,
                exists(prev_has_flagged),
            )
        )
        for clause in non_superseded_filter():
            q = q.where(clause)
        return q.limit(50)


class _AnnotatedToCurateWatcher:
    """
    Watcher for annotations from graph-enabled runs that have no FragmentCuration yet.
    Dispatches to reactive_curate_annotated for KG extraction.
    """

    name = "annotated_to_curate"
    task_name = "reactive_curate_annotated"
    batch_size = 10

    def build_query(self, session):
        # Annotations with SUCCESS, from runs that have graph_config,
        # with no FragmentCuration record (raw SQL to avoid L3->L4 import).
        # Exclude annotations on superseded assets or children of superseded parents.
        fc = table("fragmentcuration", column("annotation_id"))
        has_curation = exists().select_from(fc).where(fc.c.annotation_id == Annotation.id)
        q = (
            select(Annotation.id)
            .join(AnnotationRun, Annotation.run_id == AnnotationRun.id)
            .join(Asset, Annotation.asset_id == Asset.id)
            .where(
                Annotation.status == ResultStatus.SUCCESS,
                Annotation.value.isnot(None),
                AnnotationRun.graph_config.isnot(None),
                ~has_curation,
            )
        )
        for clause in non_superseded_filter(Asset):
            q = q.where(clause)
        return q.limit(100)


# Register only when enabled via ENABLED_WATCHERS
enabled = _get_enabled_watchers()
if "version_gap_annotation" in enabled:
    register_watcher(_VersionGapAnnotationWatcher())
if "annotated_to_curate" in enabled:
    register_watcher(_AnnotatedToCurateWatcher())
