"""
Graph domain Celery tasks.
"""

import asyncio
import logging
from typing import Any, Dict, List, Optional, Tuple

from app.core.celery_app import celery
from app.core.task_utils import run_async_in_celery
from sqlmodel import Session, select

from app.core.db import engine
from app.api.modules.graph.models import EntityCanonical, FragmentCuration
from app.api.modules.graph.resolution import resolve_entities_batch
from app.models import Annotation
from app.api.modules.annotation.models import AnnotationRun

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
    """
    Extract (raw_name, entity_type) pairs from a triplet.
    Supports subject_name/object_name format and source_id/target_id with entities.
    """
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
                    resolved_refs={
                        "subject_id": sub_entity.id,
                        "object_id": obj_entity.id,
                    },
                    curated_by=ann.user_id,
                )
                session.add(fc)
                curated += 1

            session.commit()
            logger.info(
                "reactive_curate: curated annotation %d (%d fragments)",
                ann_id,
                len(triplets),
            )
        except Exception as e:
            logger.warning("reactive_curate: failed for annotation %d: %s", ann_id, e, exc_info=True)
            failed += 1
            session.rollback()

    return {"curated": curated, "failed": failed}


@celery.task(name="reactive_curate_annotated")
def reactive_curate_annotated(annotation_ids: List[int]) -> dict:
    """
    Reactive task: process annotations for graph curation.
    Extracts entity triplets, resolves to EntityCanonical, creates FragmentCuration.
    Dispatched by AnnotatedToCurateWatcher for annotations with graph output.
    """
    if not annotation_ids:
        return {"curated": 0, "failed": 0}

    with Session(engine) as session:
        result = run_async_in_celery(_curate_annotation_batch, session, annotation_ids)
        return result or {"curated": 0, "failed": 0}


@celery.task(name="flag_superseded_entity_sources")
def flag_superseded_entity_sources(fragment_curation_ids: List[int]) -> dict:
    """
    Flag FragmentCuration entries whose source asset is superseded.
    Sets resolved_refs['source_asset_superseded'] = True so entity resolution
    can treat them as candidates for merging with entities from the preferred version.
    Dispatched by _SupersededEntityRetireWatcher.
    """
    if not fragment_curation_ids:
        return {"flagged": 0}

    flagged = 0
    with Session(engine) as session:
        for fc_id in fragment_curation_ids:
            try:
                fc = session.get(FragmentCuration, fc_id)
                if not fc:
                    continue
                refs = dict(fc.resolved_refs or {})
                if refs.get("source_asset_superseded"):
                    continue
                refs["source_asset_superseded"] = True
                fc.resolved_refs = refs
                session.add(fc)
                flagged += 1
            except Exception as e:
                logger.warning("flag_superseded: failed for FragmentCuration %d: %s", fc_id, e)
                session.rollback()
        if flagged:
            session.commit()
    return {"flagged": flagged}


@celery.task(name="re_resolve_entity_singletons")
def re_resolve_entity_singletons(entity_ids: List[int]) -> None:
    """
    Re-resolution task: for each singleton entity, check if it should be merged
    into an existing canonical. Dispatched by _ReResolveSingletonWatcher.
    """
    if not entity_ids:
        return

    merged = 0
    with Session(engine) as session:
        for eid in entity_ids:
            try:
                entity = session.get(EntityCanonical, eid)
                if not entity:
                    continue
                # Find another entity that matches this one (exclude self)
                other = find_by_alias(
                    session,
                    entity.infospace_id,
                    entity.canonical_name,
                    entity.entity_type,
                    graph_id=entity.graph_id,
                    exclude_entity_id=entity.id,
                )
                if not other:
                    continue
                # Merge entity into other (other survives)
                all_aliases = set(other.aliases or [])
                all_aliases.add(entity.canonical_name)
                all_aliases.update(entity.aliases or [])
                other.aliases = list(all_aliases)
                merged_props = dict(other.properties or {})
                merged_props.update(entity.properties or {})

                # Update FragmentCuration.resolved_refs pointing to entity -> other
                from app.models import FragmentCuration
                for fc in session.exec(
                    select(FragmentCuration).where(FragmentCuration.resolved_refs.isnot(None))
                ).all():
                    refs = fc.resolved_refs or {}
                    if entity.id not in (refs.get("entity_canonical_id"), refs.get("subject_id"), refs.get("object_id")):
                        continue
                    new_refs = None
                    for key in ("entity_canonical_id", "subject_id", "object_id"):
                        if refs.get(key) == entity.id:
                            if new_refs is None:
                                new_refs = dict(refs)
                            new_refs[key] = other.id
                    if new_refs is not None:
                        fc.resolved_refs = new_refs
                        session.add(fc)

                session.delete(entity)
                other.properties = merged_props
                session.add(other)
                session.commit()
                merged += 1
                logger.info(
                    "Re-resolve: merged entity %s '%s' into %s",
                    entity.id,
                    entity.canonical_name,
                    other.id,
                )
            except Exception as e:
                logger.warning("re_resolve: failed for entity %s: %s", eid, e)
                session.rollback()
    if merged:
        logger.info("Re-resolve: merged %d singleton entities", merged)
