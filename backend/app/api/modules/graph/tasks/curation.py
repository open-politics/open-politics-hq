"""
Graph curation @task: extract entity triplets from annotations, resolve to EntityCanonical,
create FragmentCuration + GraphEdge.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlalchemy import table, column
from sqlalchemy.sql import exists
from sqlmodel import Session, select

from app.api.modules.graph.models import FragmentCuration, GraphEdge
from app.api.modules.graph.resolution import resolve_entities_batch
from app.models import Annotation, ResultStatus
from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.content.models import Asset
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


def _has_graph_structure(value: dict) -> bool:
    """Check if annotation value contains graph-like structure."""
    if not value or not isinstance(value, dict):
        return False
    doc = value.get("document") or value
    if isinstance(doc, dict):
        return "nodes" in doc or "edges" in doc or "triplets" in doc
    return False


def _extract_triplets(data: Any) -> List[Dict]:
    """Extract triplets from annotation value structure."""
    if isinstance(data, dict) and "triplets" in data and isinstance(data["triplets"], list):
        return [t for t in data["triplets"] if isinstance(t, dict)]
    if isinstance(data, dict) and "document" in data:
        return _extract_triplets(data["document"])
    return []


def _find_entity_name_by_id(entity_id: Any, entities: List[Dict]) -> Optional[str]:
    """Find entity name by id from entities list."""
    for e in entities:
        if isinstance(e, dict) and str(e.get("id", "")) == str(entity_id):
            return e.get("name")
    return None


def _find_entity_type_by_id(entity_id: Any, entities: List[Dict]) -> str:
    """Find entity type by id from entities list."""
    for e in entities:
        if isinstance(e, dict) and str(e.get("id", "")) == str(entity_id):
            return e.get("type", "UNKNOWN")
    return "UNKNOWN"


def _triplet_to_entity_pairs(
    triplet: Dict, entities: List[Dict]
) -> List[Tuple[str, str]]:
    """Extract (raw_name, entity_type) pairs from a triplet."""
    pairs: List[Tuple[str, str]] = []
    if "subject_name" in triplet and triplet.get("subject_name"):
        sub_type = triplet.get("subject_type", "UNKNOWN")
        pairs.append((str(triplet["subject_name"]).strip(), sub_type))
    elif "source_id" in triplet and entities:
        name = _find_entity_name_by_id(triplet["source_id"], entities)
        if name:
            etype = _find_entity_type_by_id(triplet["source_id"], entities)
            pairs.append((str(name).strip(), etype))
    if "object_name" in triplet and triplet.get("object_name"):
        obj_type = triplet.get("object_type", "UNKNOWN")
        pairs.append((str(triplet["object_name"]).strip(), obj_type))
    elif "target_id" in triplet and entities:
        name = _find_entity_name_by_id(triplet["target_id"], entities)
        if name:
            etype = _find_entity_type_by_id(triplet["target_id"], entities)
            pairs.append((str(name).strip(), etype))
    return pairs


async def _curate_annotation_batch(session: Session, annotation_ids: List[int]) -> dict:
    """Async implementation of curation for a batch of annotations."""
    from app.api.modules.embedding.services import EmbeddingService

    embedding_service = EmbeddingService(session=session)
    curated = 0
    failed = 0

    for ann_id in annotation_ids:
        try:
            ann = session.get(Annotation, ann_id)
            if not ann or not ann.value:
                continue
            if not _has_graph_structure(ann.value):
                continue

            existing_count = session.exec(
                select(FragmentCuration).where(FragmentCuration.annotation_id == ann_id)
            ).all()
            if existing_count:
                continue

            triplets = _extract_triplets(ann.value)
            entities = (ann.value.get("entities") or ann.value.get("document", {}).get("entities") or [])

            if not triplets:
                continue

            all_entity_pairs: List[Tuple[str, str]] = []
            for t in triplets:
                all_entity_pairs.extend(_triplet_to_entity_pairs(t, entities))

            unique_pairs = list(dict.fromkeys(all_entity_pairs))
            if not unique_pairs:
                continue

            run = session.get(AnnotationRun, ann.run_id) if ann.run_id else None
            graph_id = None
            if run and run.graph_config and isinstance(run.graph_config, dict):
                graph_id = run.graph_config.get("graph_id") or run.graph_config.get("target_graph_id")

            resolution_map = await resolve_entities_batch(
                session,
                infospace_id=ann.infospace_id,
                entities=unique_pairs,
                embedding_service=embedding_service,
                graph_id=graph_id,
            )

            for i, triplet in enumerate(triplets):
                pairs = _triplet_to_entity_pairs(triplet, entities)
                if len(pairs) < 2:
                    continue
                sub_name, sub_type = pairs[0]
                obj_name, obj_type = pairs[1]
                sub_entity = resolution_map.get((sub_name, sub_type))
                obj_entity = resolution_map.get((obj_name, obj_type))
                if not sub_entity or not obj_entity:
                    continue

                fragment_path = f"triplets[{i}]"
                fc = FragmentCuration(
                    annotation_id=ann_id,
                    fragment_path=fragment_path,
                    status="curated",
                    subject_entity_id=sub_entity.id,
                    object_entity_id=obj_entity.id,
                    curated_by=ann.user_id,
                )
                session.add(fc)
                edge = GraphEdge(
                    subject_entity_id=sub_entity.id,
                    object_entity_id=obj_entity.id,
                    predicate=triplet.get("predicate"),
                    annotation_id=ann_id,
                    infospace_id=ann.infospace_id,
                    graph_id=graph_id,
                )
                session.add(edge)
                curated += 1

            session.commit()
            logger.info("curate_annotated: curated annotation %d (%d fragments)", ann_id, len(triplets))
        except Exception as e:
            logger.warning("curate_annotated: failed for annotation %d: %s", ann_id, e, exc_info=True)
            failed += 1
            session.rollback()

    return {"curated": curated, "failed": failed}


@task("annotated_to_curate",
      check=lambda iid: (
          select(Annotation.id)
          .join(AnnotationRun, Annotation.run_id == AnnotationRun.id)
          .join(Asset, Annotation.asset_id == Asset.id)
          .where(
              Asset.infospace_id == iid,
              Annotation.status == ResultStatus.SUCCESS,
              Annotation.value.isnot(None),
              AnnotationRun.graph_config.isnot(None),
              ~exists().select_from(
                  table("fragmentcuration", column("annotation_id"))
              ).where(column("annotation_id") == Annotation.id),
              Asset.is_superseded == False,
              Asset.parent_is_superseded == False,
          )
      ),
      schedule=120,
      batch=10,
      tags=frozenset({"annotation"}))
def curate_annotated(ctx: TaskContext, ids: list[int]):
    """Extract entity triplets from annotations, resolve to EntityCanonical, create FragmentCuration + GraphEdge."""
    with ctx.session() as session:
        result = run_async_in_celery(_curate_annotation_batch, session, ids)
    ctx.stat("curated", result.get("curated", 0))
    ctx.stat("failed", result.get("failed", 0))
