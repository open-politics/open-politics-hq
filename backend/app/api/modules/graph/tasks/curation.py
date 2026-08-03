"""
Graph curation: extract entity triplets from annotations, resolve to
``CanonEntry``, create ``FragmentCuration`` + ``GraphEdge``. Reactivate any
tombstone ``EntityRelationship`` for the affected pair.

Curation is always explicit — triggered by user action or flow step, never
automatic. The ``@task`` wrapper provides retries and observability for bulk
invocation via flows.

LLM-facing contract: triplets carry ``subject_name`` / ``object_name`` keys
(RDF-derived, what LLMs handle natively). DB-side, GraphEdge stores
``source_entry_id`` / ``target_entry_id`` (graph-theory neutral). The
translation between the two happens here at the curation boundary.
"""

import logging
from typing import Any, Dict, List, Optional, Tuple

from sqlmodel import Session, select
from sqlalchemy import update

from app.api.modules.graph.models import (
    Canon,
    EntityRelationship,
    FragmentCuration,
    GraphEdge,
    KnowledgeGraph,
)
from app.api.modules.graph.resolution import resolve_entities_batch
from app.models import Annotation, Infospace
from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
from app.api.modules.annotation.schema_map import (
    SchemaMap,
    iter_entity_refs,
    schema_map_for,
)
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)

#: Type recorded when neither the schema nor the model supplies one. Both the
#: triplet path and the entity-field path must use it, or the same entity splits
#: into two canon entries depending on which field named it.
UNTYPED = "UNKNOWN"


# ─── Graph-shape recognition (schema-driven, multi-graph-field) ──────────────


def _find_graph_field_paths(output_contract: Optional[dict]) -> List[str]:
    """Walk a schema's output_contract and return the dotted paths of every
    graph-shaped subschema. Paths are rooted under the section name, e.g.
    ``"document.loose_relationships"`` or ``"document.triplets"``.

    Reads ``SchemaMap.triplet_paths`` and strips the ``[*]`` marker the map
    carries on array nodes — this function's contract is the bare array path,
    which is what ``_walk_value_path`` navigates.

    For v1 we walk only the document section (where graph fields almost
    exclusively live). ``_walk_value_path`` splits on dots and has no notion of
    array indices, so a ``per_image[*].x`` path could not be navigated even if
    we returned it; per-modality graph fields stay a follow-up.
    """
    if not isinstance(output_contract, dict):
        return []
    smap = schema_map_for(output_contract)
    return [
        node.path.removesuffix("[*]")
        for node in smap.fields
        if node.shape == "triplet" and node.section == "document"
    ]


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
    """Extract entities list from annotation value, handling document nesting.

    Only feeds the legacy ``source_id``/``target_id`` indirection in
    ``_triplet_to_entity_pairs`` — it keys on a literal ``"entities"`` key by
    convention. Schema-declared entity fields go through
    :func:`_extract_entity_mentions`, which is driven by the SchemaMap instead
    of a hardcoded key.
    """
    if isinstance(data, dict):
        if "entities" in data and isinstance(data["entities"], list):
            return data["entities"]
        if "document" in data and isinstance(data["document"], dict):
            return data["document"].get("entities", [])
    return []


def _extract_entity_mentions(
    value: dict, smap: SchemaMap,
) -> List[Tuple[str, str, str]]:
    """Every entity mention in *value* at a schema-declared entity path.

    Returns ``(name, type, fragment_path)`` — the fragment path carries real
    array indices (``document.observations[2].statement_by``) so each mention
    gets its own ``FragmentCuration`` row and its own idempotency key.

    **Type coercion is the anchor's job.** A mention arriving as
    ``Merkel/Person`` on a field that declares ``Politician`` is coerced to the
    declared type, because a field's declared vocabulary is what "linked" means
    — otherwise one human splits into two canon entries (and
    ``find_by_alias`` matches ``type`` exactly, so the split would be
    permanent). An undeclared type on an unconstrained field passes through for
    resolution to deal with.
    """
    out: List[Tuple[str, str, str]] = []
    for path in smap.entity_paths:
        node = smap.get(path)
        for name, raw_type, frag in iter_entity_refs(value, path):
            out.append((name, _coerce_entity_type(raw_type, node), frag))
    return out


def _coerce_entity_type(raw_type: str, node: Optional[Any]) -> str:
    """Fold a mention's emitted type into its field's declared vocabulary."""
    if node is None:
        return raw_type or UNTYPED
    declared = [t for t in ([node.entity_type] if node.entity_type else [])
                + list(node.alternate_types) if t]
    if not declared:
        # Nothing declared: keep what the model said, else fall back to the
        # same sentinel the triplet path uses. Diverging here would split one
        # entity across ``""`` and ``UNKNOWN`` depending on which field named
        # it — precisely the fragmentation C1 exists to remove.
        return raw_type or UNTYPED
    if raw_type:
        for t in declared:
            if t.strip().lower() == raw_type.strip().lower():
                return t
        if not node.type_constrained:
            # Field explicitly allows the model to invent a type — keep it as
            # an audit signal rather than flattening it.
            return raw_type
    return declared[0]


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
    # ``.get(k, default)`` only fires the default on a *missing* key — an
    # emitted-but-empty ``subject_type`` would otherwise slip through as ``""``
    # and split from the UNKNOWN population. ``or UNTYPED`` covers both.
    if "subject_name" in triplet and triplet.get("subject_name"):
        sub_type = triplet.get("subject_type") or UNTYPED
        pairs.append((str(triplet["subject_name"]).strip(), sub_type))
    elif "source_id" in triplet and entities:
        name = _find_entity_name_by_id(triplet["source_id"], entities)
        if name:
            etype = _find_entity_type_by_id(triplet["source_id"], entities)
            pairs.append((str(name).strip(), etype or UNTYPED))
    if "object_name" in triplet and triplet.get("object_name"):
        obj_type = triplet.get("object_type") or UNTYPED
        pairs.append((str(triplet["object_name"]).strip(), obj_type))
    elif "target_id" in triplet and entities:
        name = _find_entity_name_by_id(triplet["target_id"], entities)
        if name:
            etype = _find_entity_type_by_id(triplet["target_id"], entities)
            pairs.append((str(name).strip(), etype or UNTYPED))
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
    run: Optional[AnnotationRun] = None,
) -> Tuple[int, Optional[int]]:
    """Resolve curation target → ``(canon_id, graph_id)``. Always returns a real canon.

    Precedence (each falls through to the next when absent):
    1. ``graph_id`` → the graph's ``canon_id`` (validated in-infospace). Highest:
       a graph names its canon explicitly.
    2. ``run.canon_ids`` → the run's declared coordinate frame. Phase 2 targets the
       primary (``canon_ids[0]``); multi-canon union read is deferred. The primary
       is validated to belong to this infospace.
    3. ``infospace.default_canon_id`` → the General canon every infospace gets at
       creation. The backward-compatible fallback for runs with no declared canon.

    Migration guarantees ``Infospace.default_canon_id IS NOT NULL`` after
    upgrade; the assertion catches any regression where that invariant breaks.
    """
    if graph_id is not None:
        graph = session.get(KnowledgeGraph, graph_id)
        if not graph or graph.infospace_id != infospace_id:
            raise ValueError(f"Graph {graph_id} not in infospace {infospace_id}")
        return graph.canon_id, graph_id
    if run is not None and run.canon_ids:
        primary = run.canon_ids[0]
        canon = session.get(Canon, primary)
        if not canon or canon.infospace_id != infospace_id:
            raise ValueError(f"Canon {primary} not in infospace {infospace_id}")
        return primary, None
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
            EntityRelationship.entry_a_id == entity_a_id,
            EntityRelationship.entry_b_id == entity_b_id,
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


async def _stage_proposals(
    session: Session,
    infospace_id: int,
    canon_id: int,
    run_id: Optional[int],
    unmatched: List[Tuple[str, str]],
    annotation_id: int,
) -> None:
    """Upsert a ``CanonProposal`` per unmatched ``(surface, type)`` — settled-only
    staging. Deduped on ``(canon_id, type, normalized_surface)``: a repeat bumps
    ``occurrence_count`` rather than inserting, and an ``accepted``/``dismissed`` row
    stays put (only the count bumps) so a settled or dismissed surface never
    re-prompts. Embedding-similar existing entries are attached as suggestions when a
    provider is configured (one batched embed per call); without embeddings the
    proposal is just "create new?".
    """
    from sqlalchemy.dialects.postgresql import insert as pg_insert
    from sqlalchemy import func as sa_func
    from app.api.modules.graph.models import CanonProposal
    from app.api.modules.graph.resolution import find_similar_entries_sql

    if not unmatched:
        return

    suggestions: Dict[Tuple[str, str], List[int]] = {}
    try:
        from app.api.modules.embedding.embed import embed_texts
        from app.api.modules.foundation_service_providers import get_configured_foundation_provider
        sel = get_configured_foundation_provider(session, infospace_id, "embedding")
        if sel and sel.model_name:
            surfaces = [s for s, _ in unmatched]
            vectors, _em = await embed_texts(session, infospace_id, surfaces)
            if vectors:
                for (surface, etype), vec in zip(unmatched, vectors):
                    if vec:
                        suggestions[(surface, etype)] = find_similar_entries_sql(
                            session, canon_id, etype, vec,
                        )
    except Exception as e:
        logger.warning("stage_proposals: suggestion embedding failed: %s", e)

    for surface, etype in unmatched:
        norm = (surface or "").strip().lower()
        if not norm:
            continue
        stmt = pg_insert(CanonProposal.__table__).values(
            infospace_id=infospace_id,
            canon_id=canon_id,
            run_id=run_id,
            surface=surface,
            normalized_surface=norm,
            type=etype,
            status="pending",
            suggested_entry_ids=suggestions.get((surface, etype), []),
            occurrence_count=1,
            example_annotation_ids=[annotation_id],
        ).on_conflict_do_update(
            constraint="uq_canon_proposal_surface",
            set_={
                "occurrence_count": CanonProposal.__table__.c.occurrence_count + 1,
                "updated_at": sa_func.now(),
            },
        )
        session.execute(stmt)


async def curate_annotation_batch(
    session: Session,
    annotation_ids: List[int],
    graph_id_override: Optional[int] = None,
    curated_by: Optional[int] = None,
) -> dict:
    """Core curation: resolve every entity the annotation names into the
    target canon, and materialise the relationships between them.

    Two kinds of field contribute, both discovered from the schema via
    ``SchemaMap`` — never from hardcoded key conventions:

    - **Graph fields** (triplet-shaped arrays) → ``FragmentCuration`` with
      ``source_entry_id``/``target_entry_id`` + a ``GraphEdge`` tagged with its
      ``source_field_path``, so multi-graph-field schemas can split or unify
      them via ``edge_group_by`` at inspection time. Tombstone relationships
      for the pair reactivate.
    - **Entity fields** (``entity`` / ``array_entity``, at any nesting depth) →
      ``FragmentCuration`` with ``entry_id``. A mention is a membership
      statement, not a relationship, so it gets no edge. What it buys is the
      canon entry: a name appearing only in a roster, or only in a nested
      row's entity leaf, still resolves, dedupes, and becomes geocodable.

    Both kinds feed **one** ``resolve_entities_batch`` call per annotation, so
    a name that appears in a roster *and* in a triplet resolves to a single
    ``CanonEntry`` — which is what later makes it a single graph node.

    Caller owns the transaction. Used by both the route (synchronous,
    user-selected fragments) and the ``@task`` (bulk, flow-driven).
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

            # Per-fragment idempotency: skip only fragments already curated, not the
            # whole annotation. Lets a partially-settled annotation (resolve-into-canon
            # mode) re-land its blocked fragments once their entities settle, while a
            # fully-curated annotation re-curates to a clean no-op (no duplicate edges).
            curated_paths = {
                fc.fragment_path for fc in session.exec(
                    select(FragmentCuration).where(
                        FragmentCuration.annotation_id == ann_id,
                        FragmentCuration.status == "curated",
                    )
                ).all()
            }

            # Discover all (path, triplets) pairs to curate for this annotation.
            field_triplet_groups = _resolve_graph_field_paths(
                session, ann.schema_id, ann.value, schema_path_cache,
            )

            # Schema-declared entity fields are curatable in their own right —
            # a roster or a nested row's entity leaf resolves into the canon
            # whether or not the annotation carries any triplets. This is what
            # makes "entities tied to a canon" give in-pipeline dedup.
            schema = session.get(AnnotationSchema, ann.schema_id) if ann.schema_id else None
            smap = schema_map_for(schema.output_contract) if schema else SchemaMap()
            entity_mentions = _extract_entity_mentions(ann.value, smap)

            if not field_triplet_groups and not entity_mentions:
                skipped += 1
                continue

            entities = _extract_entities_list(ann.value)

            # Aggregate (name, type) pairs across ALL graph fields AND all
            # entity fields on this annotation so resolve_entities_batch makes
            # one canon-resolution pass per annotation regardless of how many
            # fields fire.
            all_entity_pairs: List[Tuple[str, str]] = []
            for _path, triplets in field_triplet_groups:
                for t in triplets:
                    all_entity_pairs.extend(_triplet_to_entity_pairs(t, entities))
            all_entity_pairs.extend((name, etype) for name, etype, _ in entity_mentions)

            unique_pairs = list(dict.fromkeys(all_entity_pairs))
            if not unique_pairs:
                skipped += 1
                continue

            run = session.get(AnnotationRun, ann.run_id) if ann.run_id else None
            graph_id, merge_normalize, merge_type_override = _build_merge_maps(run)
            if graph_id_override is not None:
                graph_id = graph_id_override

            canon_id, resolved_graph_id = _resolve_target_canon(
                session, ann.infospace_id, graph_id, run,
            )

            unique_pairs = _apply_merge_hints(unique_pairs, merge_normalize, merge_type_override)

            # "Resolve into canon" mode (run toggle): settled-only resolution — exact/
            # alias matches auto-apply, unmatched mentions stage as proposals below.
            settled = bool(run and getattr(run, "resolve_into_canon", False))
            resolution_map = await resolve_entities_batch(
                session,
                infospace_id=ann.infospace_id,
                canon_id=canon_id,
                entities=unique_pairs,
                settled_only=settled,
            )

            if settled:
                unmatched = [p for p in unique_pairs if p not in resolution_map]
                if unmatched:
                    await _stage_proposals(
                        session, ann.infospace_id, canon_id, run.id, unmatched, ann_id,
                    )

            ann_curated = 0
            for source_field_path, triplets in field_triplet_groups:
                # fragment_path inside the annotation's value: e.g.
                # "document.licensing_assessments[3]" or, for legacy data,
                # "triplets[3]". Frontend reads this for evidence drill-down.
                frag_root = source_field_path
                for i, triplet in enumerate(triplets):
                    fragment_path = f"{frag_root}[{i}]"
                    if fragment_path in curated_paths:
                        continue  # already curated — per-fragment idempotency
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

                    fc = FragmentCuration(
                        annotation_id=ann_id,
                        fragment_path=fragment_path,
                        status="curated",
                        source_entry_id=source_entity.id,
                        target_entry_id=target_entity.id,
                        curated_by=curated_by or ann.user_id,
                    )
                    session.add(fc)
                    edge = GraphEdge(
                        source_entry_id=source_entity.id,
                        target_entry_id=target_entity.id,
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

            # Entity-field mentions: one FragmentCuration per mention, bound
            # through ``entry_id`` (the single-entry slot the model already
            # documents for exactly this case). No GraphEdge — a mention is a
            # membership statement, not a relationship. What it buys is the
            # canon entry itself, so a name appearing only in a roster or only
            # in a nested row still resolves, dedupes, and can be geocoded.
            ann_entities = 0
            for name, etype, fragment_path in entity_mentions:
                if fragment_path in curated_paths:
                    continue  # already curated — per-mention idempotency
                norm_name = merge_normalize.get(name.strip().lower(), name)
                norm_type = merge_type_override.get(norm_name.strip().lower(), etype)
                entry = resolution_map.get((norm_name, norm_type))
                if not entry:
                    continue  # unsettled in resolve-into-canon mode; staged above
                assert entry.canon_id == canon_id, (
                    f"entity {entry.id} canon mismatch: {entry.canon_id} vs {canon_id}"
                )
                session.add(FragmentCuration(
                    annotation_id=ann_id,
                    fragment_path=fragment_path,
                    status="curated",
                    entry_id=entry.id,
                    curated_by=curated_by or ann.user_id,
                ))
                ann_entities += 1

            session.flush()
            curated += ann_curated + ann_entities
            logger.info(
                "curate_annotation_batch: curated annotation %d "
                "(%d edges across %d graph fields, %d entity mentions)",
                ann_id, ann_curated, len(field_triplet_groups), ann_entities,
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
