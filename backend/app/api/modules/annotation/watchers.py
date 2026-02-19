"""
Reactive watchers for annotation domain.

Watchers find entities that need post-annotation work (e.g. graph curation).
"""

from sqlalchemy.sql import exists
from sqlmodel import select

from app.core.dispatch import register_watcher
from app.api.modules.annotation.models import Annotation, AnnotationRun
from app.api.modules.graph.models import FragmentCuration
from app.models import ResultStatus


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
        # with no FragmentCuration record
        has_curation = exists().where(FragmentCuration.annotation_id == Annotation.id)
        return (
            select(Annotation.id)
            .join(AnnotationRun, Annotation.run_id == AnnotationRun.id)
            .where(
                Annotation.status == ResultStatus.SUCCESS,
                Annotation.value.isnot(None),
                AnnotationRun.graph_config.isnot(None),
                ~has_curation,
            )
            .limit(100)
        )


# Register at module import
register_watcher(_AnnotatedToCurateWatcher())
