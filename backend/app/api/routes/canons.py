"""Routes for Canon — vocabulary management.

Canons are infospace-scoped vocabularies. Entities are members. Multiple
canons per infospace; the same canon can back multiple knowledge graphs.

All routes nest under ``/infospaces/{infospace_id}/...`` so the existing
``Requires()`` access dependency can resolve the infospace from the path.

Action verbs use ``/action/{verb}`` (mirrors ``annotation_runs.py:1270``'s
``/{run_id}/action/geocode``). Deletion uses preview/confirm via
``/action/delete``.

Lean route shape: ``Requires() → method call → return``. No new services;
reuses ``resolve_entities_batch`` and the existing entity FK-rewrite block
from ``routes/entities.py`` (transitively, via merge logic).

Bridging with run-scoped merge maps:
- ``POST /infospaces/{iid}/canons/{cid}/action/extend`` reads
  ``run.graph_config.entity_merges`` (transient, never moved) and
  materializes the entries as Entity rows in the canon. The run config is
  NOT mutated.
- ``GET /infospaces/{iid}/runs/{run_id}/canon-suggestions`` proposes which
  entries from the run would land in canon (add / already_present /
  conflict). No side-effects.
"""

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select
from sqlalchemy import func

from app.models import (
    Canon, Entity, EntityRelationship, FragmentCuration, GraphEdge,
    KnowledgeGraph, Infospace,
)
from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.graph.schemas import (
    CanonRead, CanonCreate, CanonUpdate,
    ExtendCanonRequest, CanonExtendResponse,
    CanonSuggestion, CanonSuggestionsResponse,
    EntityRead,
    MergeEntitiesRequest,
    DeleteImpact, DeleteRequest,
    EntityMergeHint,
    ProposeResolutionsParams,
)
from app.api.modules.graph.resolution import resolve_entities_batch, find_by_alias
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)

logger = logging.getLogger(__name__)


router = APIRouter(
    prefix="/infospaces/{infospace_id}/canons",
    tags=["Canons"],
)


# ── Canon CRUD ───────────────────────────────────────────────────────────────


@router.get("", response_model=List[CanonRead])
def list_canons(
    *,
    access: Access = Requires(scope="canon_ids"),
    role: Optional[str] = Query(default=None, description="Filter by canon role (general | geo | …)"),
    db: Session = Depends(get_db),
) -> Any:
    """List canons for an infospace."""
    stmt = select(Canon).where(Canon.infospace_id == access.infospace_id)
    if role:
        stmt = stmt.where(Canon.role == role)
    stmt = access.scope_filter(stmt, Canon.id, "canon_ids")
    return list(db.exec(stmt).all())


@router.post("", response_model=CanonRead, status_code=status.HTTP_201_CREATED)
async def create_canon(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: CanonCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create a canon. Optionally seed from a run's merge_map or explicit groups."""
    canon = Canon(
        infospace_id=access.infospace_id,
        name=body.name,
        description=body.description,
        role=body.role,
    )
    db.add(canon)
    db.flush()

    seed_groups: List[EntityMergeHint] = []
    if body.from_run is not None:
        access.require_in_scope("run_ids", body.from_run)
        run = db.get(AnnotationRun, body.from_run)
        if not run or run.infospace_id != access.infospace_id:
            raise HTTPException(status_code=404, detail=f"Run {body.from_run} not found")
        for group in (run.graph_config or {}).get("entity_merges", []):
            seed_groups.append(EntityMergeHint(**group))
    if body.from_merges:
        seed_groups.extend(body.from_merges)

    if seed_groups:
        entities_to_resolve: List[tuple[str, str]] = []
        for group in seed_groups:
            etype = group.type or "UNKNOWN"
            entities_to_resolve.append((group.keep, etype))
        resolved = await resolve_entities_batch(
            session=db,
            infospace_id=access.infospace_id,
            canon_id=canon.id,
            entities=entities_to_resolve,
            use_embeddings=False,
        )
        for group in seed_groups:
            etype = group.type or "UNKNOWN"
            ent = resolved.get((group.keep, etype))
            if not ent:
                continue
            existing_aliases = set(ent.aliases or [])
            for alias in group.names:
                existing_aliases.add(alias)
            ent.aliases = list(existing_aliases)
            db.add(ent)

    db.commit()
    db.refresh(canon)
    return canon


@router.get("/{canon_id}", response_model=CanonRead)
def get_canon(
    *,
    canon_id: int,
    access: Access = Requires(scope="canon_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Get a canon by ID."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    access.require_in_scope("canon_ids", canon_id)
    return canon


@router.patch("/{canon_id}", response_model=CanonRead)
def update_canon(
    *,
    canon_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: CanonUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Update name / description / role."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    if body.name is not None:
        canon.name = body.name
    if body.description is not None:
        canon.description = body.description
    if body.role is not None:
        canon.role = body.role
    db.add(canon)
    db.commit()
    db.refresh(canon)
    return canon


@router.get("/{canon_id}/entities", response_model=List[EntityRead])
def list_canon_entities(
    *,
    canon_id: int,
    access: Access = Requires(scope="canon_ids"),
    entity_type: Optional[str] = None,
    limit: int = Query(default=200, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> Any:
    """List entities in a canon."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    access.require_in_scope("canon_ids", canon_id)

    stmt = select(Entity).where(Entity.canon_id == canon_id)
    if entity_type:
        stmt = stmt.where(Entity.entity_type == entity_type)
    stmt = stmt.offset(offset).limit(limit)
    return list(db.exec(stmt).all())


# ── Action verbs ──────────────────────────────────────────────────────────────


@router.post("/{canon_id}/action/extend", response_model=CanonExtendResponse)
async def extend_canon_from_run(
    *,
    canon_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: ExtendCanonRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Pull a run's transient ``entity_merges`` into the canon as Entity rows.

    The run's ``graph_config`` is NOT mutated — merge hints stay transient.
    Existing entities (matched by alias) accumulate the new aliases; missing
    entities are created.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    access.require_in_scope("run_ids", body.run_id)

    run = db.get(AnnotationRun, body.run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail=f"Run {body.run_id} not found")

    groups = (run.graph_config or {}).get("entity_merges", [])
    if not groups:
        return CanonExtendResponse(added=0, skipped=0, entries=[])

    added = 0
    skipped = 0
    entries: list[dict] = []
    for group in groups:
        keep = group.get("keep", "")
        etype = group.get("type") or "UNKNOWN"
        names = group.get("names", [])
        if not keep:
            skipped += 1
            continue

        existing = find_by_alias(db, canon_id=canon_id, raw_name=keep, entity_type=etype)
        if existing:
            new_aliases = set(existing.aliases or [])
            new_aliases.update(names)
            new_aliases.add(keep)
            existing.aliases = list(new_aliases)
            db.add(existing)
            entries.append({"keep": keep, "type": etype, "status": "extended", "entity_id": existing.id})
            added += 1
        else:
            ent = Entity(
                infospace_id=access.infospace_id,
                canon_id=canon_id,
                canonical_name=keep,
                entity_type=etype,
                aliases=list({keep, *names}),
                provenance_type="manual",
            )
            db.add(ent)
            db.flush()
            entries.append({"keep": keep, "type": etype, "status": "created", "entity_id": ent.id})
            added += 1

    db.commit()
    return CanonExtendResponse(added=added, skipped=skipped, entries=entries)


@router.post("/{canon_id}/action/merge-entities", response_model=EntityRead)
def merge_in_canon(
    *,
    canon_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope="entity_ids"),
    body: MergeEntitiesRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Merge entities within a canon. Cross-canon merges rejected — entities
    must share a canon for a merge to make sense.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    if len(body.entity_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 entity IDs required")

    entities: List[Entity] = []
    for eid in body.entity_ids:
        access.require_in_scope("entity_ids", eid)
        ent = db.get(Entity, eid)
        if not ent or ent.canon_id != canon_id:
            raise HTTPException(
                status_code=404,
                detail=f"Entity {eid} not in canon {canon_id}",
            )
        entities.append(ent)

    keep_id = body.keep_id or body.entity_ids[0]
    keep_entity = next((e for e in entities if e.id == keep_id), entities[0])

    all_aliases = set(keep_entity.aliases or [])
    all_additional_types = set(keep_entity.additional_types or [])
    for ent in entities:
        if ent.id != keep_entity.id:
            all_aliases.add(ent.canonical_name)
            all_aliases.update(ent.aliases or [])
            all_additional_types.update(ent.additional_types or [])
    if body.canonical_name:
        keep_entity.canonical_name = body.canonical_name
    keep_entity.aliases = list(all_aliases)
    keep_entity.additional_types = list(all_additional_types)
    keep_entity.provenance_type = "manual"

    merged_ids = {e.id for e in entities if e.id != keep_entity.id}
    if merged_ids:
        from sqlalchemy import or_
        for ge in db.exec(
            select(GraphEdge).where(or_(
                GraphEdge.source_entity_id.in_(merged_ids),
                GraphEdge.target_entity_id.in_(merged_ids),
            ))
        ).all():
            if ge.source_entity_id in merged_ids:
                ge.source_entity_id = keep_entity.id
            if ge.target_entity_id in merged_ids:
                ge.target_entity_id = keep_entity.id
            db.add(ge)
        for fc in db.exec(
            select(FragmentCuration).where(or_(
                FragmentCuration.source_entity_id.in_(merged_ids),
                FragmentCuration.target_entity_id.in_(merged_ids),
                FragmentCuration.entity_id.in_(merged_ids),
            ))
        ).all():
            if fc.source_entity_id in merged_ids:
                fc.source_entity_id = keep_entity.id
            if fc.target_entity_id in merged_ids:
                fc.target_entity_id = keep_entity.id
            if fc.entity_id in merged_ids:
                fc.entity_id = keep_entity.id
            db.add(fc)
        for rel in db.exec(
            select(EntityRelationship).where(or_(
                EntityRelationship.entity_a_id.in_(merged_ids),
                EntityRelationship.entity_b_id.in_(merged_ids),
            ))
        ).all():
            new_a = keep_entity.id if rel.entity_a_id in merged_ids else rel.entity_a_id
            new_b = keep_entity.id if rel.entity_b_id in merged_ids else rel.entity_b_id
            if new_a == new_b:
                db.delete(rel)
                continue
            new_a, new_b = sorted((new_a, new_b))
            rel.entity_a_id = new_a
            rel.entity_b_id = new_b
            db.add(rel)

    for ent in entities:
        if ent.id != keep_entity.id:
            db.delete(ent)

    db.commit()
    db.refresh(keep_entity)
    return keep_entity


@router.post("/{canon_id}/action/delete", response_model=DeleteImpact)
def delete_canon(
    *,
    canon_id: int,
    access: Access = Requires(Capability.DELETE, scope=None),
    body: DeleteRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Delete a canon (preview or confirm).

    Hard blockers:
    - Any KnowledgeGraph references this canon.
    - This canon is the infospace's ``default_canon_id`` or ``default_geo_canon_id``.

    Cascade (when no blockers + confirm=True):
    - All Entities in this canon (via ON DELETE CASCADE).
    - GraphEdge / FragmentCuration / EntityRelationship cascades follow via
      Entity FK ON DELETE CASCADE.

    Annotations, assets, schemas always survive.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")

    blockers: List[str] = []
    referencing_graphs = db.exec(
        select(KnowledgeGraph.id, KnowledgeGraph.name).where(KnowledgeGraph.canon_id == canon_id)
    ).all()
    if referencing_graphs:
        names = ", ".join(f"'{n}'" for _, n in referencing_graphs)
        blockers.append(f"{len(referencing_graphs)} knowledge graph(s) reference this canon: {names}")

    infospace = db.get(Infospace, canon.infospace_id)
    if infospace and (infospace.default_canon_id == canon_id or infospace.default_geo_canon_id == canon_id):
        blockers.append("Canon is set as an infospace default — change the default before deleting")

    entity_count = db.exec(select(func.count(Entity.id)).where(Entity.canon_id == canon_id)).first() or 0
    edge_count = db.exec(select(func.count(GraphEdge.id)).where(
        GraphEdge.source_entity_id.in_(select(Entity.id).where(Entity.canon_id == canon_id))
    )).first() or 0
    curation_count = db.exec(select(func.count(FragmentCuration.id)).where(
        FragmentCuration.source_entity_id.in_(select(Entity.id).where(Entity.canon_id == canon_id))
    )).first() or 0

    impact = DeleteImpact(
        can_proceed=not blockers,
        blockers=blockers,
        cascaded_entities=int(entity_count),
        cascaded_edges=int(edge_count),
        cascaded_curations=int(curation_count),
    )

    if not body.confirm:
        return impact
    if blockers:
        raise HTTPException(status_code=409, detail="; ".join(blockers))

    db.delete(canon)
    db.commit()
    impact.confirmed = True
    return impact


# ── Resolution proposals (user-invocable scan, streams via /stream) ─────────


@router.post(
    "/action/propose-resolutions",
    response_model=dict,
)
def propose_resolutions_action(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: ProposeResolutionsParams,
    db: Session = Depends(get_db),
) -> Any:
    """Dispatch the ``propose_resolutions`` ``@task``.

    Scans entities (within ``canon_id``) and/or predicates (within
    ``graph_id``, or infospace-wide if omitted) for similarity-based merge
    candidates. Streams proposals on the ``resolution.proposals`` topic.
    """
    from app.api.modules.graph.tasks.proposals import propose_resolutions

    if body.canon_id is not None:
        access.require_in_scope("canon_ids", body.canon_id)
    if body.graph_id is not None:
        access.require_in_scope("graph_ids", body.graph_id)

    async_result = propose_resolutions.delay(
        [None],
        access.infospace_id,
        params=body,
    )

    return {
        "task_id": async_result.id,
        "topic": "resolution.proposals",
        "watch_url": f"/api/v1/infospaces/{access.infospace_id}/stream/resolution.proposals/{async_result.id}",
    }


# ── Run-side suggestion endpoint (no side-effects) ──────────────────────────


run_suggestions_router = APIRouter(
    prefix="/infospaces/{infospace_id}/runs",
    tags=["Canons"],
)


@run_suggestions_router.get(
    "/{run_id}/canon-suggestions",
    response_model=CanonSuggestionsResponse,
)
def suggest_canon_extensions(
    *,
    run_id: int,
    canon_id: int = Query(..., description="Canon to compare against"),
    access: Access = Requires(scope="run_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Given a run and a canon, propose which merge entries from the run
    would land where:

    - ``add``: name doesn't exist in canon — would be added.
    - ``already_present``: name matches an existing entity by alias.
    - ``conflict``: name resolves but to a different canonical name.

    No side-effects.
    """
    run = db.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Run not found")
    access.require_in_scope("run_ids", run_id)

    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")

    add: list[CanonSuggestion] = []
    already: list[CanonSuggestion] = []
    conflict: list[CanonSuggestion] = []

    for group in (run.graph_config or {}).get("entity_merges", []):
        keep = group.get("keep", "")
        etype = group.get("type") or "UNKNOWN"
        names = group.get("names", [])
        if not keep:
            continue
        match = find_by_alias(db, canon_id=canon_id, raw_name=keep, entity_type=etype)
        if match is None:
            add.append(CanonSuggestion(keep=keep, names=names, type=etype, status="add"))
        elif match.canonical_name.strip().lower() == keep.strip().lower():
            already.append(CanonSuggestion(
                keep=keep, names=names, type=etype, status="already_present",
                matched_entity_id=match.id,
            ))
        else:
            conflict.append(CanonSuggestion(
                keep=keep, names=names, type=etype, status="conflict",
                matched_entity_id=match.id,
            ))

    return CanonSuggestionsResponse(add=add, already_present=already, conflict=conflict)
