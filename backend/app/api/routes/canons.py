"""Routes for Canon — vocabulary management.

Canons are infospace-scoped vocabularies. Entities are members. Multiple
canons per infospace; the same canon can back multiple knowledge graphs.

All routes nest under ``/infospaces/{infospace_id}/...`` so the existing
``Requires()`` access dependency can resolve the infospace from the path.

Action verbs use ``/action/{verb}`` (mirrors ``annotation_runs.py:1270``'s
``/{run_id}/action/geocode``). Deletion uses preview/confirm via
``/action/delete``.

Lean route shape: ``Requires() → method call → return``. No new services;
reuses ``resolve_entities_batch`` and the existing entry FK-rewrite block
from ``routes/entities.py`` (transitively, via merge logic).

Bridging with run-scoped merge maps:
- ``POST /infospaces/{iid}/canons/{cid}/action/extend`` reads
  ``run.graph_config.entity_merges`` (transient, never moved) and
  materializes the entries as CanonEntry rows in the canon. The run config is
  NOT mutated.
- ``GET /infospaces/{iid}/runs/{run_id}/canon-suggestions`` proposes which
  entries from the run would land in canon (add / already_present /
  conflict). No side-effects.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select
from sqlalchemy import func

from datetime import datetime, timezone

from app.models import (
    Canon, CanonEntry, EntityRelationship, FragmentCuration, GraphEdge,
    KnowledgeGraph, Infospace, CanonProposal, Annotation,
)
from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.graph.schemas import (
    CanonRead, CanonCreate, CanonUpdate,
    ExtendCanonRequest, CanonExtendResponse,
    PromoteRunRequest, PromoteResponse,
    ResolveIntoCanonRequest, CanonProposalRead, CanonProposalAcceptRequest,
    BulkProposalRequest, BulkProposalResponse,
    CanonSuggestion, CanonSuggestionsResponse,
    CanonEntryRead,
    MergeEntitiesRequest,
    DeleteImpact, DeleteRequest,
    EntityMergeHint,
    ProposeResolutionsParams,
)
from app.api.modules.graph.resolution import resolve_entities_batch, find_by_alias, resolve_entity
from app.api.modules.graph.services.canon_service import (
    combine_entries, serialize_canon, materialize_canon,
)
from app.api.modules.graph.promote import normalize_run_folds, promote_folds
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)

logger = logging.getLogger(__name__)


def _dump_type_schemas(type_schemas) -> Dict[str, Any]:
    """Plain-JSON form of a ``{type: [CanonPropertyDef]}`` map for the JSON column."""
    return {k: [d.model_dump() for d in v] for k, v in (type_schemas or {}).items()}


router = APIRouter(
    prefix="/infospaces/{infospace_id}/canons",
    tags=["Canons"],
)


# ── Canon CRUD ───────────────────────────────────────────────────────────────


@router.get("", response_model=List[CanonRead])
def list_canons(
    *,
    access: Access = Requires(scope="canon_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """List canons for an infospace."""
    stmt = select(Canon).where(Canon.infospace_id == access.infospace_id)
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
        external_id=body.external_id,
        tags=body.tags or [],
        type_schemas=_dump_type_schemas(body.type_schemas),
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
    """Update name / description / external_id / tags / type_schemas."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    if body.name is not None:
        canon.name = body.name
    if body.description is not None:
        canon.description = body.description
    if body.external_id is not None:
        canon.external_id = body.external_id
    if body.tags is not None:
        canon.tags = body.tags
    if body.type_schemas is not None:
        canon.type_schemas = _dump_type_schemas(body.type_schemas)
    db.add(canon)
    db.commit()
    db.refresh(canon)
    return canon


@router.get("/{canon_id}/entities", response_model=List[CanonEntryRead])
def list_canon_entities(
    *,
    canon_id: int,
    access: Access = Requires(scope="canon_ids"),
    entity_type: Optional[str] = None,
    limit: int = Query(default=200, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> Any:
    """List entries in a canon."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    access.require_in_scope("canon_ids", canon_id)

    stmt = select(CanonEntry).where(CanonEntry.canon_id == canon_id)
    if entity_type:
        stmt = stmt.where(CanonEntry.type == entity_type)
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
    """Promote a run's folds into the canon as CanonEntry rows.

    The run's config is NOT mutated — folds stay the run's working canvas. This
    is the canon-centric face of the promote seam (pick a canon, pull a run's
    folds in); the run-centric face is ``POST /runs/{id}/action/promote``. Both
    call ``promote_folds``.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    access.require_in_scope("run_ids", body.run_id)

    run = db.get(AnnotationRun, body.run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail=f"Run {body.run_id} not found")

    folds = normalize_run_folds(run)
    summary = promote_folds(
        db, infospace_id=access.infospace_id, canon_id=canon_id,
        folds=folds, log_user_id=access.user_id,
    )
    db.commit()
    return CanonExtendResponse(
        added=summary["created"] + summary["merged"] + summary["extended"],
        skipped=summary["skipped"],
        entries=summary["entries"],
    )


@router.post("/{canon_id}/action/merge-entities", response_model=CanonEntryRead)
def merge_in_canon(
    *,
    canon_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope="entity_ids"),
    body: MergeEntitiesRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Merge entries within a canon. Cross-canon merges rejected — entries
    must share a canon for a merge to make sense.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    if len(body.entry_ids) < 2:
        raise HTTPException(status_code=400, detail="At least 2 entry IDs required")

    entities: List[CanonEntry] = []
    for eid in body.entry_ids:
        access.require_in_scope("entity_ids", eid)
        ent = db.get(CanonEntry, eid)
        if not ent or ent.canon_id != canon_id:
            raise HTTPException(
                status_code=404,
                detail=f"Entry {eid} not in canon {canon_id}",
            )
        entities.append(ent)

    keep_entity = combine_entries(
        session=db,
        canon_id=canon_id,
        entry_ids=body.entry_ids,
        keep_id=body.keep_id,
        canonical=body.canonical,
        log_user_id=access.user_id,
    )
    db.commit()
    db.refresh(keep_entity)
    return keep_entity


@router.get("/{canon_id}/export")
def export_canon(
    *,
    access: Access = Requires(scope="canon_ids"),
    canon_id: int,
    db: Session = Depends(get_db),
) -> Any:
    """Serialize a canon + its entries to the portable wire format.

    The result is a standalone file (``format: "canon/v1"``) — authorable,
    diffable, importable into any deployment. Excludes local-only fields
    (id, infospace_id, embeddings). See ``canon_service.serialize_canon``.
    """
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    return serialize_canon(db, canon_id)


@router.post("/import", response_model=CanonRead)
def import_canon(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope="canon_ids"),
    payload: Dict[str, Any],
    into_canon_id: Optional[int] = Query(
        None, description="Merge into this existing canon instead of matching/creating."
    ),
    db: Session = Depends(get_db),
) -> Any:
    """Import a serialized canon (materialize = deserialize = commit).

    Body is the exported wire format. Deterministic merge by ``external_id``;
    a fresh canon is created when no match/target is given. See
    ``canon_service.materialize_canon``.
    """
    if into_canon_id is not None:
        access.require_in_scope("canon_ids", into_canon_id)
    try:
        canon = materialize_canon(
            db, access.infospace_id, payload, into_canon_id=into_canon_id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    db.commit()
    db.refresh(canon)
    # Embeddings are local-only (never travel), so a freshly imported canon has
    # none — backfill them so fuzzy resolution works. Best-effort, no-op without
    # a provider; the canon is fully usable on exact/alias regardless.
    _dispatch_embed_backfill(access.infospace_id, canon.id)
    return canon


def _dispatch_embed_backfill(infospace_id: int, canon_id: int) -> None:
    """Fire-and-forget embedding backfill for a canon (the ``embed_canon`` @task)."""
    try:
        from app.api.modules.graph.tasks.maintenance import embed_canon
        from app.api.modules.graph.schemas import EmbedCanonParams
        embed_canon.delay([None], infospace_id, params=EmbedCanonParams(canon_id=canon_id))
    except Exception as e:
        logger.warning("embed backfill dispatch failed for canon %s: %s", canon_id, e)


@router.post("/{canon_id}/action/embed", response_model=dict)
def embed_canon_action(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope="canon_ids"),
    canon_id: int,
    db: Session = Depends(get_db),
) -> Any:
    """Backfill embeddings for a canon's entries (the ``embed_canon`` @task).

    Embed-on-create covers entries made during normal curation; this catches
    imported / pre-existing / post-model-change entries. Idempotent — only
    entries missing the current provider's embedding are touched."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    _dispatch_embed_backfill(access.infospace_id, canon_id)
    return {"status": "dispatched", "canon_id": canon_id}


@router.get("/{canon_id}/proposals", response_model=List[CanonProposalRead])
def list_canon_proposals(
    *,
    access: Access = Requires(scope="canon_ids"),
    canon_id: int,
    status_filter: str = Query("pending", alias="status"),
    run_id: Optional[int] = Query(None),
    db: Session = Depends(get_db),
) -> Any:
    """Staged resolution proposals for a canon (resolve-into-canon mode), most-seen
    first. Filter by status (default ``pending``) and optionally by run."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    stmt = select(CanonProposal).where(
        CanonProposal.canon_id == canon_id,
        CanonProposal.status == status_filter,
    )
    if run_id is not None:
        stmt = stmt.where(CanonProposal.run_id == run_id)
    stmt = stmt.order_by(CanonProposal.occurrence_count.desc(), CanonProposal.id.desc())
    return db.exec(stmt).all()


async def _settle_proposal(
    db: Session, canon_id: int, prop: CanonProposal,
    merge_into_entry_id: Optional[int], user_id: Optional[int],
) -> None:
    """Settle one proposal — merge its surface into an existing entry (alias
    append) or create a new entry — and mark it accepted. No commit, no
    re-curation: the caller owns the transaction and dispatches re-curation
    once per affected run."""
    if merge_into_entry_id is not None:
        entry = db.get(CanonEntry, merge_into_entry_id)
        if not entry or entry.canon_id != canon_id:
            raise HTTPException(status_code=404, detail="Target entry not in canon")
        aliases = list(entry.aliases or [])
        if prop.surface not in aliases:
            aliases.append(prop.surface)
            entry.aliases = aliases
            db.add(entry)
    else:
        await resolve_entity(
            db, prop.infospace_id, canon_id, prop.surface, prop.type,
            use_embeddings=False,
        )
    prop.status = "accepted"
    prop.resolved_at = datetime.now(timezone.utc)
    prop.resolved_by = user_id
    db.add(prop)


def _dispatch_recurate(db: Session, infospace_id: int, run_id: int) -> bool:
    """Fire-and-forget re-curation of a run after settling proposals. Routes
    through the ``curate_annotated`` @task (async, batched, idempotent via the
    per-fragment guard) so the request never blocks on a full-run re-scan.
    Returns True if work was dispatched."""
    ann_ids = db.exec(select(Annotation.id).where(Annotation.run_id == run_id)).all()
    if not ann_ids:
        return False
    from app.api.modules.graph.tasks.curation import curate_annotated
    curate_annotated.delay(list(ann_ids), infospace_id)
    return True


@router.post("/{canon_id}/proposals/{proposal_id}/action/accept", response_model=CanonProposalRead)
async def accept_canon_proposal(
    *,
    canon_id: int,
    proposal_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope="canon_ids"),
    body: CanonProposalAcceptRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Settle a proposal: merge its surface into an existing entry (alias append) or
    create a new entry. The surface then resolves on its own, so the run is
    re-curated (async) to land any edges blocked while it was unsettled
    (per-fragment idempotency skips already-curated work)."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    prop = db.get(CanonProposal, proposal_id)
    if not prop or prop.canon_id != canon_id:
        raise HTTPException(status_code=404, detail="Proposal not found")
    if prop.status != "pending":
        raise HTTPException(status_code=409, detail=f"Proposal already {prop.status}")

    run_id = prop.run_id
    await _settle_proposal(db, canon_id, prop, body.merge_into_entry_id, access.user_id)
    db.commit()
    db.refresh(prop)

    if run_id:
        _dispatch_recurate(db, access.infospace_id, run_id)
    return prop


@router.post("/{canon_id}/proposals/{proposal_id}/action/dismiss", response_model=CanonProposalRead)
def dismiss_canon_proposal(
    *,
    canon_id: int,
    proposal_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope="canon_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Dismiss a proposal — it leaves the pending list and never re-prompts (repeat
    sightings only bump its count)."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")
    prop = db.get(CanonProposal, proposal_id)
    if not prop or prop.canon_id != canon_id:
        raise HTTPException(status_code=404, detail="Proposal not found")
    prop.status = "dismissed"
    prop.resolved_at = datetime.now(timezone.utc)
    prop.resolved_by = access.user_id
    db.add(prop)
    db.commit()
    db.refresh(prop)
    return prop


@router.post("/{canon_id}/proposals/action/bulk", response_model=BulkProposalResponse)
async def bulk_triage_proposals(
    *,
    canon_id: int,
    access: Access = Requires(Capability.ORGANIZE, scope="canon_ids"),
    body: BulkProposalRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Triage many proposals in one call — the live-flood ergonomic. Each is
    settled (alias/create) or dismissed; every affected run is then re-curated
    **once** (not once per proposal), async. Unknown or non-pending proposals are
    skipped, not errored, so a partially-stale selection still applies cleanly."""
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Canon not found")

    now = datetime.now(timezone.utc)
    accepted = dismissed = skipped = 0
    affected_runs: set[int] = set()

    for item in body.accept:
        prop = db.get(CanonProposal, item.proposal_id)
        if not prop or prop.canon_id != canon_id or prop.status != "pending":
            skipped += 1
            continue
        try:
            await _settle_proposal(db, canon_id, prop, item.merge_into_entry_id, access.user_id)
        except HTTPException:
            # e.g. a bad merge_into_entry_id — skip this item, keep the rest.
            # (The raise happens before any mutation, so nothing partial to undo.)
            skipped += 1
            continue
        if prop.run_id:
            affected_runs.add(prop.run_id)
        accepted += 1

    for pid in body.dismiss:
        prop = db.get(CanonProposal, pid)
        if not prop or prop.canon_id != canon_id or prop.status != "pending":
            skipped += 1
            continue
        prop.status = "dismissed"
        prop.resolved_at = now
        prop.resolved_by = access.user_id
        db.add(prop)
        dismissed += 1

    db.commit()

    runs_recurated = sum(1 for rid in affected_runs if _dispatch_recurate(db, access.infospace_id, rid))
    return BulkProposalResponse(
        accepted=accepted, dismissed=dismissed,
        runs_recurated=runs_recurated, skipped=skipped,
    )


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
    - All CanonEntry rows in this canon (via ON DELETE CASCADE).
    - GraphEdge / FragmentCuration / EntityRelationship cascades follow via
      CanonEntry FK ON DELETE CASCADE.

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

    entity_count = db.exec(select(func.count(CanonEntry.id)).where(CanonEntry.canon_id == canon_id)).first() or 0
    edge_count = db.exec(select(func.count(GraphEdge.id)).where(
        GraphEdge.source_entry_id.in_(select(CanonEntry.id).where(CanonEntry.canon_id == canon_id))
    )).first() or 0
    curation_count = db.exec(select(func.count(FragmentCuration.id)).where(
        FragmentCuration.source_entry_id.in_(select(CanonEntry.id).where(CanonEntry.canon_id == canon_id))
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
        elif match.canonical.strip().lower() == keep.strip().lower():
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


@run_suggestions_router.post(
    "/{run_id}/action/promote",
    response_model=PromoteResponse,
)
def promote_run_to_canon(
    *,
    run_id: int,
    body: PromoteRunRequest,
    access: Access = Requires(Capability.ORGANIZE, scope="run_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Promote a run's folds into its declared canon — the run-centric seam.

    Target precedence: explicit ``body.canon_id`` > the run's primary declared
    canon (``canon_ids[0]``) > the infospace default. Folds come from both
    sources (entity_merges + value-fold MergeMaps), normalized and resolved by
    ``promote_folds``. The run's config is untouched — additive + idempotent.
    """
    access.require_in_scope("run_ids", run_id)
    run = db.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Run not found")

    canon_id = body.canon_id
    if canon_id is None and run.canon_ids:
        canon_id = run.canon_ids[0]
    if canon_id is None:
        infospace = db.get(Infospace, access.infospace_id)
        canon_id = infospace.default_canon_id if infospace else None
    if canon_id is None:
        raise HTTPException(
            status_code=400,
            detail="No target canon — attach a canon to the run or pass canon_id.",
        )
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail=f"Canon {canon_id} not found")

    folds = normalize_run_folds(run)
    summary = promote_folds(
        db, infospace_id=access.infospace_id, canon_id=canon_id,
        folds=folds, log_user_id=access.user_id,
    )
    db.commit()
    return PromoteResponse(canon_id=canon_id, **summary)


@run_suggestions_router.post("/{run_id}/action/resolve-into-canon")
async def set_resolve_into_canon(
    *,
    run_id: int,
    body: ResolveIntoCanonRequest,
    access: Access = Requires(Capability.ORGANIZE, scope="run_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Toggle "resolve into canon" mode on a run. Requires an attached canon. On
    enable, settled-only curation applies to future content (manual curate + live
    reconcile) and an initial pass runs over the run's existing annotations —
    settled mentions dedup into the canon, the rest stage as proposals."""
    access.require_in_scope("run_ids", run_id)
    run = db.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Run not found")
    if body.enabled and not run.canon_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Attach a canon to the run (canon_ids) before enabling resolve-into-canon.",
        )
    run.resolve_into_canon = body.enabled
    run.updated_at = datetime.now(timezone.utc)
    db.add(run)
    db.commit()

    if body.enabled:
        from app.api.modules.graph.tasks.curation import curate_annotation_batch
        ann_ids = db.exec(select(Annotation.id).where(Annotation.run_id == run_id)).all()
        if ann_ids:
            try:
                await curate_annotation_batch(db, list(ann_ids), curated_by=access.user_id)
                db.commit()
            except Exception as e:
                logger.warning("resolve-into-canon initial pass failed: %s", e)
                db.rollback()
    return {"run_id": run_id, "resolve_into_canon": run.resolve_into_canon}
