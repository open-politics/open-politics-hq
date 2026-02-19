"""
Graph domain Celery tasks.
"""

import logging
from typing import List

from app.core.celery_app import celery
from sqlmodel import Session, select

from app.core.db import engine
from app.api.modules.graph.models import FragmentCuration
from app.models import Annotation

logger = logging.getLogger(__name__)


def _has_graph_structure(value: dict) -> bool:
    """Check if annotation value contains graph-like structure."""
    if not value or not isinstance(value, dict):
        return False
    doc = value.get("document") or value
    if isinstance(doc, dict):
        return "nodes" in doc or "edges" in doc or "triplets" in doc
    return False


@celery.task(name="reactive_curate_annotated")
def reactive_curate_annotated(annotation_ids: List[int]) -> None:
    """
    Reactive task: process annotations for graph curation.
    Dispatched by AnnotatedToCurateWatcher for annotations with graph output.
    """
    if not annotation_ids:
        return

    with Session(engine) as session:
        for ann_id in annotation_ids:
            try:
                ann = session.get(Annotation, ann_id)
                if not ann or not ann.value:
                    continue
                if not _has_graph_structure(ann.value):
                    continue
                # Check if already curated
                existing = session.exec(
                    select(FragmentCuration).where(FragmentCuration.annotation_id == ann_id)
                ).first()
                if existing:
                    continue
                # Placeholder: full implementation would run GraphAggregatorAdapter
                # or create FragmentCuration from triplet extraction
                logger.info(
                    f"reactive_curate: annotation {ann_id} has graph structure, "
                    "curation pipeline can be extended here"
                )
            except Exception as e:
                logger.warning(f"reactive_curate: failed for annotation {ann_id}: {e}")
