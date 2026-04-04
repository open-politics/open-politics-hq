"""
Graph curation: extract entity triplets from annotations, resolve to EntityCanonical,
create FragmentCuration + GraphEdge.

Curation is always explicit — triggered by user action or flow step, never automatic.
The @task wrapper provides retries and observability for bulk invocation via flows.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select

from app.api.modules.graph.models import FragmentCuration, GraphEdge
from app.api.modules.graph.resolution import resolve_entities_batch
from app.models import Annotation
from app.api.modules.annotation.models import AnnotationRun
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
    """Extract triplets from annotation value structure, handling document nesting."""
    if isinstance(data, dict) and "triplets" in data and isinstance(data["triplets"], list):
        return [t for t in data["triplets"] if isinstance(t, dict)]
    if isinstance(data, dict) and "document" in data:
        return _extract_triplets(data["document"])
    return []


def _extract_entities_list(data: Any) -> List[Dict]:
    """Extract entities list from annotation value, handling document nesting."""
    if isinstance(data, dict):
        if "entities" in data and isinstance(data["entities"], list):
            return data["entities"]
        if "document" in data and isinstance(data["document"], dict):
            return data["document"].get("entities", [])
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


def _build_merge_maps(
    run: Optional[AnnotationRun],
) -> Tuple[Optional[int], Dict[str, str], Dict[str, str]]:
    """Extract graph_id and merge hint maps from run's graph_config."""
    graph_id = None
    merge_normalize: Dict[str, str] = {}
    merge_type_override: Dict[str, str] = {}
    if run and run.graph_config and isinstance(run.graph_config, dict):
        graph_id = run.graph_config.get("graph_id") or run.graph_config.get("target_graph_id")
        for group in run.graph_config.get("entity_merges", []):
            keep = group.get("keep", "")
            forced_type = group.get("type")
            for name in group.get("names", []):
                if name.strip().lower() != keep.strip().lower():
                    merge_normalize[name.strip().lower()] = keep
            if forced_type:
                merge_type_override[keep.strip().lower()] = forced_type
    return graph_id, merge_normalize, merge_type_override


def _apply_merge_hints(
    pairs: List[Tuple[str, str]],
    merge_normalize: Dict[str, str],
    merge_type_override: Dict[str, str],
) -> List[Tuple[str, str]]:
    """Apply entity_merges normalization to (name, type) pairs."""
    if not merge_normalize and not merge_type_override:
        return pairs
    return list(dict.fromkeys(
        (
            merge_normalize.get(name.strip().lower(), name),
            merge_type_override.get(
                merge_normalize.get(name.strip().lower(), name).strip().lower(),
                etype,
            ),
        )
        for name, etype in pairs
    ))


async def curate_annotation_batch(
    session: Session,
    annotation_ids: List[int],
    graph_id_override: Optional[int] = None,
    curated_by: Optional[int] = None,
) -> dict:
    """
    Core curation logic: extract triplets, resolve entities, create FragmentCuration + GraphEdge.

    Used by both the route (synchronous, user-selected fragments) and the @task (bulk, flow-driven).

    Args:
        session: DB session — caller owns the transaction.
        annotation_ids: Explicit annotation IDs to curate.
        graph_id_override: Force target graph. If None, derived from run's graph_config.
        curated_by: User ID for audit trail.
    """
    from app.api.modules.embedding.services import EmbeddingService

    embedding_service = EmbeddingService(session=session)
    curated = 0
    skipped = 0
    failed = 0

    for ann_id in annotation_ids:
        try:
            ann = session.get(Annotation, ann_id)
            if not ann or not ann.value:
                skipped += 1
                continue
            if not _has_graph_structure(ann.value):
                skipped += 1
                continue

            # Skip if already curated
            existing = session.exec(
                select(FragmentCuration).where(FragmentCuration.annotation_id == ann_id)
            ).first()
            if existing:
                skipped += 1
                continue

            triplets = _extract_triplets(ann.value)
            entities = _extract_entities_list(ann.value)

            if not triplets:
                skipped += 1
                continue

            all_entity_pairs: List[Tuple[str, str]] = []
            for t in triplets:
                all_entity_pairs.extend(_triplet_to_entity_pairs(t, entities))

            unique_pairs = list(dict.fromkeys(all_entity_pairs))
            if not unique_pairs:
                skipped += 1
                continue

            run = session.get(AnnotationRun, ann.run_id) if ann.run_id else None
            graph_id, merge_normalize, merge_type_override = _build_merge_maps(run)
            if graph_id_override is not None:
                graph_id = graph_id_override

            unique_pairs = _apply_merge_hints(unique_pairs, merge_normalize, merge_type_override)

            resolution_map = await resolve_entities_batch(
                session,
                infospace_id=ann.infospace_id,
                entities=unique_pairs,
                embedding_service=embedding_service,
                graph_id=graph_id,
            )

            ann_curated = 0
            for i, triplet in enumerate(triplets):
                pairs = _triplet_to_entity_pairs(triplet, entities)
                if len(pairs) < 2:
                    continue
                sub_name, sub_type = pairs[0]
                obj_name, obj_type = pairs[1]
                sub_name = merge_normalize.get(sub_name.strip().lower(), sub_name)
                obj_name = merge_normalize.get(obj_name.strip().lower(), obj_name)
                sub_type = merge_type_override.get(sub_name.strip().lower(), sub_type)
                obj_type = merge_type_override.get(obj_name.strip().lower(), obj_type)
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
                    curated_by=curated_by or ann.user_id,
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
                ann_curated += 1

            session.flush()
            curated += ann_curated
            logger.info("curate_annotation_batch: curated annotation %d (%d triplets)", ann_id, ann_curated)
        except Exception as e:
            logger.warning("curate_annotation_batch: failed for annotation %d: %s", ann_id, e, exc_info=True)
            failed += 1
            session.rollback()

    return {"curated": curated, "skipped": skipped, "failed": failed}


@task("curate_annotations",
      check=lambda iid: None,
      schedule=None,
      batch=10,
      tags=frozenset({"graph", "curation"}))
def curate_annotated(ctx: TaskContext, ids: list[int]):
    """Curate annotations into the knowledge graph. Direct invocation only — called by flows or routes."""
    with ctx.session() as session:
        result = run_async_in_celery(
            curate_annotation_batch, session, ids,
        )
        session.commit()
    curated = result.get("curated", 0)
    ctx.stat("curated", curated)
    ctx.stat("skipped", result.get("skipped", 0))
    ctx.stat("failed", result.get("failed", 0))
    # Presence: notify watching graph panels of new curated edges
    if curated > 0:
        ctx.send("knowledge_graph", "curations", "edges_curated", {
            "curated": curated,
            "skipped": result.get("skipped", 0),
            "annotation_ids": ids,
        })
