"""Routes for Entity management.

Entities are members of a Canon (vocabulary). Every entity belongs to exactly
one canon (``canon_id NOT NULL``). The Canon's parent is the infospace.

Action verbs use the ``/action/{verb}`` convention (matches
``annotation_runs.py:1270``). Deletion uses preview/confirm via
``/action/delete`` mirroring ``core/tree.py:178``.

Cross-canon merges are forbidden — entities must share a canon for a merge
to make sense semantically.

GraphEdge / FragmentCuration FK rewiring on merge:
- GraphEdge has ``source_entity_id`` / ``target_entity_id``.
- FragmentCuration has ``source_entity_id`` / ``target_entity_id`` / ``entity_id``.
"""
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select
from sqlalchemy import func, or_

from app.models import (
    Entity, EntityEditLog, EntityRelationship, FragmentCuration,
    GraphEdge, KnowledgeGraph, Canon,
)
from app.api.modules.graph.schemas import (
    EntityRead,
    EntityCreate,
    EntityUpdate,
    FindDuplicatesRequest,
    FindDuplicatesResponse,
    MergeEntitiesRequest,
    ResolveEntitiesRequest,
    SimilarPairRead,
    DeleteImpact,
    DeleteRequest,
)
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from app.api.modules.graph.resolution import resolve_entity

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/entities",
    tags=["Entities"]
)


@router.get("", response_model=List[EntityRead])
def list_entities(
    *,
    access: Access = Requires(scope="entity_ids"),
    canon_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db)
) -> Any:
    """List entities for an infospace. Optionally filter by canon and/or type."""
    infospace_id = access.infospace_id
    stmt = select(Entity).where(Entity.infospace_id == infospace_id)
    if canon_id is not None:
        stmt = stmt.where(Entity.canon_id == canon_id)
    if entity_type:
        stmt = stmt.where(Entity.entity_type == entity_type)
    stmt = access.scope_filter(stmt, Entity.id, "entity_ids")

    entities = db.exec(stmt).all()
    return list(entities)


@router.post("", response_model=EntityRead, status_code=status.HTTP_201_CREATED)
async def create_entity(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    entity_in: EntityCreate,
    db: Session = Depends(get_db)
) -> Any:
    """Create an entity manually in a specific canon."""
    infospace_id = access.infospace_id
    canonical_name = entity_in.canonical_name
    entity_type = entity_in.entity_type

    if not canonical_name or not entity_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="canonical_name and entity_type are required",
        )

    # Validate canon belongs to this infospace.
    canon = db.get(Canon, entity_in.canon_id)
    if not canon or canon.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Canon {entity_in.canon_id} not found in this infospace",
        )

    # Existence check within the canon.
    existing = db.exec(
        select(Entity).where(
            Entity.canon_id == entity_in.canon_id,
            Entity.canonical_name == canonical_name,
            Entity.entity_type == entity_type,
        )
    ).first()
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entity '{canonical_name}' ({entity_type}) already exists in canon {canon.id}",
        )

    entity = Entity(
        infospace_id=infospace_id,
        canon_id=entity_in.canon_id,
        canonical_name=canonical_name,
        entity_type=entity_type,
        additional_types=entity_in.additional_types or [],
        aliases=entity_in.aliases if entity_in.aliases is not None else [canonical_name],
        properties=entity_in.properties or {},
        provenance_type="manual",
    )

    db.add(entity)
    db.flush()
    db.add(EntityEditLog(
        entity_id=entity.id,
        action="create",
        performed_by=f"user:{access.user_id}",
        previous_state={},
    ))
    db.commit()
    db.refresh(entity)
    return entity


@router.patch("/{entity_id}", response_model=EntityRead)
def update_entity(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope="entity_ids"),
    entity_id: int,
    entity_in: EntityUpdate,
    db: Session = Depends(get_db)
) -> Any:
    """Update an entity (rename, edit aliases, additional_types, properties)."""
    infospace_id = access.infospace_id
    entity = db.get(Entity, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_ids", entity_id)

    prev_state = {
        "canonical_name": entity.canonical_name,
        "aliases": list(entity.aliases or []),
        "additional_types": list(entity.additional_types or []),
        "properties": dict(entity.properties or {}),
    }

    if entity_in.canonical_name is not None:
        entity.canonical_name = entity_in.canonical_name
    if entity_in.additional_types is not None:
        entity.additional_types = entity_in.additional_types
    if entity_in.aliases is not None:
        entity.aliases = entity_in.aliases
    if entity_in.properties is not None:
        entity.properties = entity_in.properties

    db.add(entity)
    if any(v is not None for v in (entity_in.canonical_name, entity_in.aliases, entity_in.additional_types, entity_in.properties)):
        db.add(EntityEditLog(
            entity_id=entity_id,
            action="update_properties",
            performed_by=f"user:{access.user_id}",
            previous_state=prev_state,
        ))
    db.commit()
    db.refresh(entity)
    return entity


@router.post("/{entity_id}/action/delete", response_model=DeleteImpact)
def delete_entity(
    *,
    access: Access = Requires(Capability.DELETE, scope="entity_ids"),
    entity_id: int,
    body: DeleteRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Delete an entity (preview or confirm).

    Hard blockers: any GraphEdge / FragmentCuration / EntityRelationship still
    references this entity. Resolve via merge first. The preview surfaces
    blockers so the caller knows what to merge.

    Annotations, assets, schemas always survive.
    """
    infospace_id = access.infospace_id
    entity = db.get(Entity, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_ids", entity_id)

    edges = db.exec(select(func.count(GraphEdge.id)).where(
        or_(GraphEdge.source_entity_id == entity_id, GraphEdge.target_entity_id == entity_id)
    )).first() or 0
    curations = db.exec(select(func.count(FragmentCuration.id)).where(
        or_(
            FragmentCuration.source_entity_id == entity_id,
            FragmentCuration.target_entity_id == entity_id,
            FragmentCuration.entity_id == entity_id,
        )
    )).first() or 0
    relationships = db.exec(select(func.count(EntityRelationship.id)).where(
        or_(EntityRelationship.entity_a_id == entity_id, EntityRelationship.entity_b_id == entity_id)
    )).first() or 0

    blockers: List[str] = []
    if edges:
        blockers.append(f"{edges} GraphEdge rows reference this entity — merge first")
    if curations:
        blockers.append(f"{curations} FragmentCuration rows reference this entity — merge first")
    if relationships:
        blockers.append(f"{relationships} EntityRelationship rows reference this entity — merge first")

    impact = DeleteImpact(
        can_proceed=not blockers,
        blockers=blockers,
        cascaded_edges=int(edges),
        cascaded_curations=int(curations),
        cascaded_relationships=int(relationships),
    )

    if not body.confirm:
        return impact
    if blockers:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="; ".join(blockers),
        )

    db.delete(entity)
    db.commit()
    impact.confirmed = True
    return impact


@router.post("/action/merge", response_model=EntityRead)
async def merge_entities(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope="entity_ids"),
    merge_request: MergeEntitiesRequest,
    db: Session = Depends(get_db)
) -> Any:
    """Merge multiple entities into one. All entities must share a canon
    (cross-canon merges rejected — entities don't have semantically
    comparable identity across vocabularies).
    """
    infospace_id = access.infospace_id
    for eid in merge_request.entity_ids:
        access.require_in_scope("entity_ids", eid)
    entity_ids = merge_request.entity_ids
    if len(entity_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 entity IDs required for merge",
        )

    entities: List[Entity] = []
    for eid in entity_ids:
        entity = db.get(Entity, eid)
        if not entity or entity.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Entity {eid} not found",
            )
        entities.append(entity)

    canon_ids = {e.canon_id for e in entities}
    if len(canon_ids) > 1:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Cross-canon merge rejected — entities must share the same canon",
        )

    keep_id = merge_request.keep_id or entity_ids[0]
    keep_entity = next((e for e in entities if e.id == keep_id), entities[0])

    # Aggregate aliases + types + properties
    all_aliases = set(keep_entity.aliases or [])
    all_additional_types = set(keep_entity.additional_types or [])
    for entity in entities:
        if entity.id != keep_entity.id:
            all_aliases.add(entity.canonical_name)
            all_aliases.update(entity.aliases or [])
            all_additional_types.update(entity.additional_types or [])

    if merge_request.canonical_name is not None:
        keep_entity.canonical_name = merge_request.canonical_name
    keep_entity.aliases = list(all_aliases)
    keep_entity.additional_types = list(all_additional_types)

    merged_properties = dict(keep_entity.properties or {})
    for entity in entities:
        if entity.id != keep_entity.id:
            merged_properties.update(entity.properties or {})
    keep_entity.properties = merged_properties
    keep_entity.provenance_type = "manual"

    # Rewire FK references for GraphEdge, FragmentCuration, EntityRelationship.
    merged_ids = {e.id for e in entities if e.id != keep_entity.id}
    if merged_ids:
        # GraphEdge: source / target
        for ge in db.exec(
            select(GraphEdge).where(
                or_(
                    GraphEdge.source_entity_id.in_(merged_ids),
                    GraphEdge.target_entity_id.in_(merged_ids),
                )
            )
        ).all():
            if ge.source_entity_id in merged_ids:
                ge.source_entity_id = keep_entity.id
            if ge.target_entity_id in merged_ids:
                ge.target_entity_id = keep_entity.id
            db.add(ge)
        # FragmentCuration: source / target / entity_id (single-entity fragments)
        for fc in db.exec(
            select(FragmentCuration).where(
                or_(
                    FragmentCuration.source_entity_id.in_(merged_ids),
                    FragmentCuration.target_entity_id.in_(merged_ids),
                    FragmentCuration.entity_id.in_(merged_ids),
                )
            )
        ).all():
            if fc.source_entity_id in merged_ids:
                fc.source_entity_id = keep_entity.id
            if fc.target_entity_id in merged_ids:
                fc.target_entity_id = keep_entity.id
            if fc.entity_id in merged_ids:
                fc.entity_id = keep_entity.id
            db.add(fc)
        # EntityRelationship: entity_a / entity_b — must preserve canonical
        # ordering after rewrite. If a row collapses (a == b after merge),
        # delete it.
        for rel in db.exec(
            select(EntityRelationship).where(
                or_(
                    EntityRelationship.entity_a_id.in_(merged_ids),
                    EntityRelationship.entity_b_id.in_(merged_ids),
                )
            )
        ).all():
            new_a = keep_entity.id if rel.entity_a_id in merged_ids else rel.entity_a_id
            new_b = keep_entity.id if rel.entity_b_id in merged_ids else rel.entity_b_id
            if new_a == new_b:
                db.delete(rel)
                continue
            # Restore canonical order
            new_a, new_b = sorted((new_a, new_b))
            rel.entity_a_id = new_a
            rel.entity_b_id = new_b
            db.add(rel)

    for entity in entities:
        if entity.id != keep_entity.id:
            db.delete(entity)

    db.add(keep_entity)
    prev = {e.id: {"canonical_name": e.canonical_name, "aliases": e.aliases, "properties": e.properties} for e in entities}
    db.add(EntityEditLog(
        entity_id=keep_entity.id,
        action="merge",
        performed_by=f"user:{access.user_id}",
        previous_state={"merged_entity_ids": entity_ids, "merged_states": prev},
    ))
    db.commit()
    db.refresh(keep_entity)
    return keep_entity


@router.post("/action/resolve")
async def trigger_resolution(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    resolve_request: ResolveEntitiesRequest,
    canon_id: int = Query(..., description="Target canon for resolution"),
    db: Session = Depends(get_db)
) -> Any:
    """Trigger entity resolution for raw entity mentions into a target canon."""
    infospace_id = access.infospace_id
    canon = db.get(Canon, canon_id)
    if not canon or canon.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Canon not found")

    raw_entities = resolve_request.raw_entities
    similarity_threshold = resolve_request.similarity_threshold
    use_embeddings = resolve_request.use_embeddings

    resolved = []
    for raw_entity in raw_entities:
        canonical = await resolve_entity(
            session=db,
            infospace_id=infospace_id,
            canon_id=canon_id,
            raw_name=raw_entity.name,
            entity_type=raw_entity.type,
            use_embeddings=use_embeddings,
            similarity_threshold=similarity_threshold,
        )
        resolved.append({
            "raw_name": raw_entity.name,
            "canonical_id": canonical.id,
            "canonical_name": canonical.canonical_name,
        })

    db.commit()
    return {
        "resolved_count": len(resolved),
        "resolved": resolved,
    }


@router.post("/action/find-duplicates")
async def find_entity_duplicates(
    *,
    access: Access = Requires(scope=None),
    request: FindDuplicatesRequest,
    db: Session = Depends(get_db),
) -> FindDuplicatesResponse:
    """Find potential duplicate strings using the infospace's embedding provider.

    No side-effects — inspect results and feed accepted merges into the
    curation request's ``entity_merges`` field, OR into a canon's
    ``/action/extend`` flow.
    """
    from app.api.modules.foundation_service_providers import (
        resolve, ProviderError, get_selection,
    )
    from app.core.similarity import find_duplicates

    sel = get_selection(db, access.infospace_id, "embedding")
    if not sel or not sel.model_name:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No embedding provider configured for this infospace or user",
        )

    try:
        provider = resolve(
            "embedding", sel.provider_key, sel.model_name,
            infospace_id=access.infospace_id,
            session=db,
        )
    except ProviderError as e:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Embedding provider '{sel.provider_key}' is not available: {e}",
        )

    async def embed(texts: list[str]) -> list[list[float]]:
        return await provider.embed_texts(texts, sel.model_name)

    try:
        pairs = await find_duplicates(request.items, embed, request.threshold)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    return FindDuplicatesResponse(
        pairs=[
            SimilarPairRead(
                a_index=p.a_index, b_index=p.b_index,
                a_item=p.a_item, b_item=p.b_item,
                similarity=p.similarity,
            )
            for p in pairs
        ],
        items_count=len(request.items),
        unique_count=len(set(i.strip().lower() for i in request.items)),
    )


@router.get("/{entity_id}/neighborhood")
def get_entity_neighborhood(
    *,
    access: Access = Requires(scope="entity_ids"),
    entity_id: int,
    graph_id: Optional[int] = Query(default=None, description="Restrict traversal to a specific graph"),
    depth: int = Query(default=1, ge=1, le=3),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> Any:
    """Get entity neighborhood via BFS on materialized GraphEdge.

    ``graph_id`` is recommended — without it, the lookup falls back to the
    legacy infospace-scoped index on ``graph_id IS NULL`` edges, which is
    rarely the hot path.
    """
    infospace_id = access.infospace_id
    entity = db.get(Entity, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_ids", entity_id)

    from app.api.modules.graph.services import GraphService
    graph_service = GraphService(session=db)
    return graph_service.get_entity_neighborhood(
        entity_id=entity_id,
        depth=depth,
        limit=limit,
        infospace_id=infospace_id,
        graph_id=graph_id,
    )
