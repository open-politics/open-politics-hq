"""
Graph curation: extract entity triplets from annotations, resolve to ``Entity``,
create ``FragmentCuration`` + ``GraphEdge``. Reactivate any tombstone
``EntityRelationship`` for the affected pair.

Curation is always explicit — triggered by user action or flow step, never
automatic. The ``@task`` wrapper provides retries and observability for bulk
invocation via flows.

LLM-facing contract: triplets carry ``subject_name`` / ``object_name`` keys
(RDF-derived, what LLMs handle natively). DB-side, GraphEdge stores
``source_entity_id`` / ``target_entity_id`` (graph-theory neutral). The
translation between the two happens here at the curation boundary.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select
from sqlalchemy import update

from app.api.modules.graph.models import (
    Entity,
    EntityRelationship,
    FragmentCuration,
    GraphEdge,
    KnowledgeGraph,
)
from app.api.modules.graph.resolution import resolve_entities_batch
from app.models import Annotation, Infospace
from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)


# ─── Graph-shape recognition (schema-driven, multi-graph-field) ──────────────


def _is_triplet_subschema(schema_node: dict) -> bool:
    """A JSON Schema node is "graph-shaped" when it's an array whose items
    are objects with at least subject_name, predicate, and object_name keys.
    Property name is irrelevant — multi-graph-field schemas key by user-facing
    name, legacy schemas key under "triplets". Both are caught by shape.
    """
    if not isinstance(schema_node, dict):
        return False
    if schema_node.get("type") != "array":
        return False
    items = schema_node.get("items")
    if not isinstance(items, dict):
        return False
    item_props = items.get("properties")
    if not isinstance(item_props, dict):
        return False
    keys = set(item_props.keys())
    has_subject = "subject_name" in keys or "subject" in keys
    has_object = "object_name" in keys or "object" in keys
    return has_subject and has_object and "predicate" in keys


def _find_graph_field_paths(output_contract: Optional[dict]) -> List[str]:
    """Walk a schema's output_contract and return the dotted paths of every
    graph-shaped subschema. Paths are rooted under the section name, e.g.
    ``"document.loose_relationships"`` or ``"document.triplets"``.

    For v1 we walk only the document section (where graph fields almost
    exclusively live). per_image / per_audio / per_video sections are wrapped
    in arrays whose items host the per-modality fields — extending the walk
    to those sections is a follow-up if and when graph fields land there.
    """
    if not isinstance(output_contract, dict):
        return []
    section_props = (
        output_contract.get("properties", {})
        .get("document", {})
        .get("properties", {})
    )
    if not isinstance(section_props, dict):
        return []
    paths: List[str] = []
    for key, node in section_props.items():
        if _is_triplet_subschema(node):
            paths.append(f"document.{key}")
    return paths


def _walk_value_path(value: Any, path: str) -> Any:
    """Navigate a dot-path like "document.loose_relationships" through a JSON
    value, returning the value at that path or None if any segment is missing.
    """
    cur: Any = value
    for seg in path.split("."):
        if not isinstance(cur, dict):
            return None
        cur = cur.get(seg)
        if cur is None:
            return None
    return cur


def _extract_triplets_at_path(value: dict, path: str) -> List[Dict]:
    """Pull a triplet list from annotation.value at a specific dotted path."""
    found = _walk_value_path(value, path)
    if isinstance(found, list):
        return [t for t in found if isinstance(t, dict)]
    return []


def _has_graph_structure(value: dict) -> bool:
    """Check if annotation value contains graph-like structure.

    Used as a fast-path skip when no schema is available. Recognizes the
    legacy ``"triplets"`` key plus ``"nodes"``/``"edges"`` shapes. The
    schema-aware path in curate_annotation_batch is more accurate when the
    schema is loadable; this fallback handles unschemed values.
    """
    if not value or not isinstance(value, dict):
        return False
    doc = value.get("document") or value
    if isinstance(doc, dict):
        if "nodes" in doc or "edges" in doc or "triplets" in doc:
            return True
        # Any graph-shaped value (multi-field schema, post-migration).
        for v in doc.values():
            if isinstance(v, list) and v and isinstance(v[0], dict):
                if "predicate" in v[0] and (
                    "subject_name" in v[0] or "subject" in v[0]
                ):
                    return True
    return False


def _extract_triplets(data: Any) -> List[Dict]:
    """Extract triplets from the legacy ``"triplets"`` key under document.

    Used as a fallback when no schema-aware paths are found (e.g. the
    annotation's schema wasn't loadable, or the data predates schema-aware
    curation). Modern multi-graph-field curation goes through
    ``_extract_triplets_at_path`` driven by ``_find_graph_field_paths``.
    """
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
    """Extract (raw_name, entity_type) pairs from a triplet.

    Reads the LLM-facing keys (``subject_name``/``object_name`` or
    ``source_id``/``target_id`` indirection through the entities list).
    The DB-side source/target naming kicks in only when we go to write
    GraphEdge / FragmentCuration rows.
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


def _build_merge_maps(
    run: Optional[AnnotationRun],
) -> Tuple[Optional[int], Dict[str, str], Dict[str, str]]:
    """Extract graph_id and merge hint maps from run's graph_config.

    Merge hints are transient (run-scoped) and never moved into a canon
    automatically. Bridging into a canon happens through explicit user
    actions (``POST /canons/{id}/action/extend``).
    """
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


def _resolve_target_canon(
    session: Session,
    infospace_id: int,
    graph_id: Optional[int],
) -> Tuple[int, Optional[int]]:
    """Resolve curation target → ``(canon_id, graph_id)``. Always returns a real canon.

    - If ``graph_id`` is provided: validate it belongs to the infospace and
      return its ``canon_id``.
    - Otherwise: fall back to ``infospace.default_canon_id`` (the General canon
      every infospace gets at creation).

    Migration guarantees ``Infospace.default_canon_id IS NOT NULL`` after
    upgrade; the assertion catches any regression where that invariant breaks.
    """
    if graph_id is not None:
        graph = session.get(KnowledgeGraph, graph_id)
        if not graph or graph.infospace_id != infospace_id:
            raise ValueError(f"Graph {graph_id} not in infospace {infospace_id}")
        return graph.canon_id, graph_id
    infospace = session.get(Infospace, infospace_id)
    if not infospace or not infospace.default_canon_id:
        raise RuntimeError(
            f"Infospace {infospace_id} has no default_canon_id — migration regression?"
        )
    return infospace.default_canon_id, None


def _reactivate_relationship_overlay(
    session: Session,
    graph_id: int,
    entity_a_id: int,
    entity_b_id: int,
) -> None:
    """If a tombstoned ``EntityRelationship`` exists for this pair, set
    ``is_active=True`` so re-curation surfaces user notes again. The pair is
    canonical-ordered (``entity_a_id < entity_b_id``); caller must pass them
    in canonical order.
    """
    if entity_a_id >= entity_b_id:
        entity_a_id, entity_b_id = entity_b_id, entity_a_id
    session.execute(
        update(EntityRelationship)
        .where(
            EntityRelationship.graph_id == graph_id,
            EntityRelationship.entity_a_id == entity_a_id,
            EntityRelationship.entity_b_id == entity_b_id,
            EntityRelationship.is_active == False,  # noqa: E712
        )
        .values(is_active=True)
    )


def _resolve_graph_field_paths(
    session: Session,
    schema_id: Optional[int],
    annotation_value: dict,
    schema_path_cache: Dict[int, List[str]],
) -> List[Tuple[str, List[Dict]]]:
    """Resolve the (path, triplets) pairs to curate for one annotation.

    Schema-aware first: load the schema, walk its output_contract for graph-
    shaped subschemas, extract triplets at each path. Falls back to the legacy
    ``"triplets"`` lookup when the schema is unloadable or yields no graph
    fields, so existing data continues to curate cleanly.
    """
    paths: List[str] = []
    if schema_id is not None:
        if schema_id in schema_path_cache:
            paths = schema_path_cache[schema_id]
        else:
            schema = session.get(AnnotationSchema, schema_id)
            paths = _find_graph_field_paths(schema.output_contract) if schema else []
            schema_path_cache[schema_id] = paths

    out: List[Tuple[str, List[Dict]]] = []
    for path in paths:
        triplets = _extract_triplets_at_path(annotation_value, path)
        if triplets:
            out.append((path, triplets))

    # Legacy fallback: nothing schema-aware found, but the value still has
    # a literal "triplets" key (data predating schema-aware curation, or a
    # schema-less ad-hoc curation). Tag the resulting edges with "triplets"
    # as the source path so they're indistinguishable from backfilled rows.
    if not out:
        legacy = _extract_triplets(annotation_value)
        if legacy:
            out.append(("triplets", legacy))

    return out


async def curate_annotation_batch(
    session: Session,
    annotation_ids: List[int],
    graph_id_override: Optional[int] = None,
    curated_by: Optional[int] = None,
) -> dict:
    """Core curation: extract triplets from every graph-shaped field in the
    annotation's schema, resolve entities into the target canon, create
    FragmentCuration + GraphEdge (tagged with the source field path),
    reactivate tombstone relationships.

    Caller owns the transaction. Used by both the route (synchronous,
    user-selected fragments) and the ``@task`` (bulk, flow-driven).

    Multi-graph-field schemas produce multiple edge groups per annotation,
    each tagged with its ``source_field_path`` so panels can split or unify
    them via ``edge_group_by`` at inspection time.
    """
    curated = 0
    skipped = 0
    failed = 0
    schema_path_cache: Dict[int, List[str]] = {}

    for ann_id in annotation_ids:
        try:
            ann = session.get(Annotation, ann_id)
            if not ann or not ann.value:
                skipped += 1
                continue
            if not _has_graph_structure(ann.value):
                skipped += 1
                continue

            existing = session.exec(
                select(FragmentCuration).where(FragmentCuration.annotation_id == ann_id)
            ).first()
            if existing:
                skipped += 1
                continue

            # Discover all (path, triplets) pairs to curate for this annotation.
            field_triplet_groups = _resolve_graph_field_paths(
                session, ann.schema_id, ann.value, schema_path_cache,
            )
            if not field_triplet_groups:
                skipped += 1
                continue

            entities = _extract_entities_list(ann.value)

            # Aggregate (name, type) pairs across ALL graph fields on this
            # annotation so resolve_entities_batch makes one canon-resolution
            # pass per annotation regardless of how many graph fields fire.
            all_entity_pairs: List[Tuple[str, str]] = []
            for _path, triplets in field_triplet_groups:
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

            canon_id, resolved_graph_id = _resolve_target_canon(
                session, ann.infospace_id, graph_id,
            )

            unique_pairs = _apply_merge_hints(unique_pairs, merge_normalize, merge_type_override)

            resolution_map = await resolve_entities_batch(
                session,
                infospace_id=ann.infospace_id,
                canon_id=canon_id,
                entities=unique_pairs,
            )

            ann_curated = 0
            for source_field_path, triplets in field_triplet_groups:
                # fragment_path inside the annotation's value: e.g.
                # "document.licensing_assessments[3]" or, for legacy data,
                # "triplets[3]". Frontend reads this for evidence drill-down.
                frag_root = source_field_path
                for i, triplet in enumerate(triplets):
                    pairs = _triplet_to_entity_pairs(triplet, entities)
                    if len(pairs) < 2:
                        continue
                    # LLM-side keys → DB-side source/target. Subject is source,
                    # object is target — same direction, neutral naming.
                    src_name, src_type = pairs[0]
                    tgt_name, tgt_type = pairs[1]
                    src_name = merge_normalize.get(src_name.strip().lower(), src_name)
                    tgt_name = merge_normalize.get(tgt_name.strip().lower(), tgt_name)
                    src_type = merge_type_override.get(src_name.strip().lower(), src_type)
                    tgt_type = merge_type_override.get(tgt_name.strip().lower(), tgt_type)
                    source_entity = resolution_map.get((src_name, src_type))
                    target_entity = resolution_map.get((tgt_name, tgt_type))
                    if not source_entity or not target_entity:
                        continue

                    # Invariant: every GraphEdge entity must live in the graph's canon.
                    assert source_entity.canon_id == canon_id, (
                        f"source entity {source_entity.id} canon mismatch: "
                        f"{source_entity.canon_id} vs {canon_id}"
                    )
                    assert target_entity.canon_id == canon_id, (
                        f"target entity {target_entity.id} canon mismatch: "
                        f"{target_entity.canon_id} vs {canon_id}"
                    )

                    fragment_path = f"{frag_root}[{i}]"
                    fc = FragmentCuration(
                        annotation_id=ann_id,
                        fragment_path=fragment_path,
                        status="curated",
                        source_entity_id=source_entity.id,
                        target_entity_id=target_entity.id,
                        curated_by=curated_by or ann.user_id,
                    )
                    session.add(fc)
                    edge = GraphEdge(
                        source_entity_id=source_entity.id,
                        target_entity_id=target_entity.id,
                        predicate=triplet.get("predicate"),
                        annotation_id=ann_id,
                        infospace_id=ann.infospace_id,
                        graph_id=resolved_graph_id,
                        source_field_path=source_field_path,
                    )
                    session.add(edge)

                    # Reactivate any tombstone relationship overlay for this pair.
                    if resolved_graph_id is not None and source_entity.id != target_entity.id:
                        _reactivate_relationship_overlay(
                            session, resolved_graph_id, source_entity.id, target_entity.id,
                        )

                    ann_curated += 1

            session.flush()
            curated += ann_curated
            logger.info(
                "curate_annotation_batch: curated annotation %d (%d edges across %d fields)",
                ann_id, ann_curated, len(field_triplet_groups),
            )
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
    if curated > 0:
        ctx.send("knowledge_graph", "curations", "edges_curated", {
            "curated": curated,
            "skipped": result.get("skipped", 0),
            "annotation_ids": ids,
        })
