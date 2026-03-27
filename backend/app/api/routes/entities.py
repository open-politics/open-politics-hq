"""Routes for entity canonical management."""
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select

from app.models import EntityCanonical, EntityEditLog, FragmentCuration, KnowledgeGraph
from app.api.modules.graph.schemas import (
    EntityCanonicalRead,
    EntityCanonicalCreate,
    EntityCanonicalUpdate,
    FindDuplicatesRequest,
    FindDuplicatesResponse,
    MergeEntitiesRequest,
    ResolveEntitiesRequest,
    SimilarPairRead,
)
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from app.api.modules.graph.resolution import resolve_entity
from app.api.modules.embedding.services import EmbeddingService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/entities",
    tags=["Entities"]
)


@router.get("", response_model=List[EntityCanonicalRead])
def list_entities(
    *,
    access: Access = Requires(),
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db)
) -> Any:
    """
    List canonical entities for an infospace.
    Optionally filter by entity_type.
    """
    infospace_id = access.infospace_id
    stmt = select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
    if entity_type:
        stmt = stmt.where(EntityCanonical.entity_type == entity_type)
    stmt = access.scope_filter(stmt, EntityCanonical.id, "entity_canonical_ids")

    entities = db.exec(stmt).all()
    return list(entities)


@router.post("", response_model=EntityCanonicalRead, status_code=status.HTTP_201_CREATED)
async def create_entity(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    entity_in: EntityCanonicalCreate,
    db: Session = Depends(get_db)
) -> Any:
    """
    Create a canonical entity manually.
    """
    infospace_id = access.infospace_id
    canonical_name = entity_in.canonical_name
    entity_type = entity_in.entity_type
    
    if not canonical_name or not entity_type:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="canonical_name and entity_type are required"
        )
    
    # Check if entity already exists
    existing = db.exec(
        select(EntityCanonical).where(
            EntityCanonical.infospace_id == infospace_id,
            EntityCanonical.canonical_name == canonical_name,
            EntityCanonical.entity_type == entity_type
        )
    ).first()
    
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entity '{canonical_name}' ({entity_type}) already exists"
        )

    graph_id = entity_in.graph_id
    if graph_id:
        graph = db.get(KnowledgeGraph, graph_id)
        if not graph or graph.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph not found")
        if graph.edit_policy == "method_only":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Graph '{graph.name}' has edit_policy=method_only; manual creation not allowed",
            )
    
    entity = EntityCanonical(
        infospace_id=infospace_id,
        canonical_name=canonical_name,
        entity_type=entity_type,
        aliases=entity_in.aliases if entity_in.aliases is not None else [canonical_name],
        properties=entity_in.properties or {},
        graph_id=graph_id,
        provenance_type="manual" if graph_id else "method",
    )

    db.add(entity)
    db.flush()  # get entity.id before EntityEditLog
    if graph_id:
        log = EntityEditLog(
            entity_canonical_id=entity.id,
            action="create",
            performed_by=f"user:{access.user_id}",
            previous_state={},
        )
        db.add(log)
    db.commit()
    db.refresh(entity)
    return entity


@router.put("/{entity_id}", response_model=EntityCanonicalRead)
def update_entity(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    entity_id: int,
    entity_in: EntityCanonicalUpdate,
    db: Session = Depends(get_db)
) -> Any:
    """
    Update a canonical entity (rename, edit aliases, properties).
    """
    infospace_id = access.infospace_id
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_canonical_ids", entity_id)

    if entity.graph_id:
        graph = db.get(KnowledgeGraph, entity.graph_id)
        if graph and graph.edit_policy == "method_only":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Graph '{graph.name}' has edit_policy=method_only; manual edits not allowed",
            )

    prev_state = {"canonical_name": entity.canonical_name, "aliases": list(entity.aliases or []), "properties": dict(entity.properties or {})}

    if entity_in.canonical_name is not None:
        entity.canonical_name = entity_in.canonical_name
    if entity_in.aliases is not None:
        entity.aliases = entity_in.aliases
    if entity_in.properties is not None:
        entity.properties = entity_in.properties

    db.add(entity)
    if entity.graph_id and (entity_in.canonical_name is not None or entity_in.aliases is not None or entity_in.properties is not None):
        log = EntityEditLog(
            entity_canonical_id=entity_id,
            action="update_properties",
            performed_by=f"user:{access.user_id}",
            previous_state=prev_state,
        )
        db.add(log)
    db.commit()
    db.refresh(entity)

    return entity


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    *,
    access: Access = Requires(Capability.DELETE),
    entity_id: int,
    db: Session = Depends(get_db)
) -> None:
    """Delete a canonical entity."""
    infospace_id = access.infospace_id
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_canonical_ids", entity_id)

    if entity.graph_id:
        graph = db.get(KnowledgeGraph, entity.graph_id)
        if graph and graph.edit_policy == "method_only":
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Graph '{graph.name}' has edit_policy=method_only; manual delete not allowed",
            )

    db.delete(entity)
    db.commit()


@router.post("/merge", response_model=EntityCanonicalRead)
async def merge_entities(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    merge_request: MergeEntitiesRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Merge multiple entities into one canonical entity.
    """
    infospace_id = access.infospace_id
    for eid in merge_request.entity_ids:
        access.require_in_scope("entity_canonical_ids", eid)
    entity_ids = merge_request.entity_ids
    if len(entity_ids) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least 2 entity IDs required for merge"
        )
    
    # Fetch all entities
    entities = []
    for eid in entity_ids:
        entity = db.get(EntityCanonical, eid)
        if not entity or entity.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Entity {eid} not found"
            )
        entities.append(entity)
    
    # Check edit_policy if entities belong to a graph
    graph_ids = {e.graph_id for e in entities if e.graph_id is not None}
    if graph_ids:
        for gid in graph_ids:
            graph = db.get(KnowledgeGraph, gid)
            if graph and graph.edit_policy == "method_only":
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"Graph '{graph.name}' has edit_policy=method_only; manual merge not allowed",
                )

    # Determine which entity to keep
    keep_id = merge_request.keep_id or entity_ids[0]
    keep_entity = next((e for e in entities if e.id == keep_id), entities[0])

    # Collect all aliases
    all_aliases = set(keep_entity.aliases or [])
    for entity in entities:
        if entity.id != keep_entity.id:
            all_aliases.add(entity.canonical_name)
            all_aliases.update(entity.aliases or [])
    
    # Update keep entity
    if merge_request.canonical_name is not None:
        keep_entity.canonical_name = merge_request.canonical_name
    keep_entity.aliases = list(all_aliases)
    
    # Merge properties
    merged_properties = dict(keep_entity.properties or {})
    for entity in entities:
        if entity.id != keep_entity.id:
            merged_properties.update(entity.properties or {})
    keep_entity.properties = merged_properties
    keep_entity.provenance_type = "manual"

    # Update FK references: replace merged entity IDs with keep_entity.id
    merged_ids = {e.id for e in entities if e.id != keep_entity.id}
    if merged_ids:
        from sqlalchemy import or_
        # GraphEdge: subject and object entity references
        for ge in db.exec(
            select(GraphEdge).where(
                or_(
                    GraphEdge.subject_entity_id.in_(merged_ids),
                    GraphEdge.object_entity_id.in_(merged_ids),
                )
            )
        ).all():
            if ge.subject_entity_id in merged_ids:
                ge.subject_entity_id = keep_entity.id
            if ge.object_entity_id in merged_ids:
                ge.object_entity_id = keep_entity.id
            db.add(ge)
        # FragmentCuration: all three entity FK columns
        for fc in db.exec(
            select(FragmentCuration).where(
                or_(
                    FragmentCuration.subject_entity_id.in_(merged_ids),
                    FragmentCuration.object_entity_id.in_(merged_ids),
                    FragmentCuration.entity_canonical_id.in_(merged_ids),
                )
            )
        ).all():
            if fc.subject_entity_id in merged_ids:
                fc.subject_entity_id = keep_entity.id
            if fc.object_entity_id in merged_ids:
                fc.object_entity_id = keep_entity.id
            if fc.entity_canonical_id in merged_ids:
                fc.entity_canonical_id = keep_entity.id
            db.add(fc)

    # Delete other entities
    for entity in entities:
        if entity.id != keep_entity.id:
            db.delete(entity)
    
    db.add(keep_entity)
    if keep_entity.graph_id:
        prev = {e.id: {"canonical_name": e.canonical_name, "aliases": e.aliases, "properties": e.properties} for e in entities}
        log = EntityEditLog(
            entity_canonical_id=keep_entity.id,
            action="merge",
            performed_by=f"user:{access.user_id}",
            previous_state={"merged_entity_ids": entity_ids, "merged_states": prev},
        )
        db.add(log)
    db.commit()
    db.refresh(keep_entity)
    return keep_entity


@router.post("/resolve")
async def trigger_resolution(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    resolve_request: ResolveEntitiesRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Trigger automatic entity resolution for raw entity mentions.
    """
    infospace_id = access.infospace_id
    raw_entities = resolve_request.raw_entities
    similarity_threshold = resolve_request.similarity_threshold
    use_embeddings = resolve_request.use_embeddings
    
    embedding_service = None
    if use_embeddings:
        embedding_service = EmbeddingService(session=db, user_id=access.user_id)
    
    resolved = []
    for raw_entity in raw_entities:
        canonical = await resolve_entity(
            session=db,
            infospace_id=infospace_id,
            raw_name=raw_entity.name,
            entity_type=raw_entity.type,
            embedding_service=embedding_service,
            similarity_threshold=similarity_threshold
        )
        resolved.append({
            "raw_name": raw_entity.name,
            "canonical_id": canonical.id,
            "canonical_name": canonical.canonical_name
        })
    
    db.commit()
    
    return {
        "resolved_count": len(resolved),
        "resolved": resolved
    }


@router.post("/find-duplicates")
async def find_entity_duplicates(
    *,
    access: Access = Requires(),
    request: FindDuplicatesRequest,
    db: Session = Depends(get_db),
) -> FindDuplicatesResponse:
    """
    Find potential duplicate strings using the infospace's configured embedding provider.

    Send a list of entity names (e.g. extracted from run-scoped triplets) and get back
    pairs whose cosine similarity meets the threshold. No side-effects — inspect results
    and feed accepted merges into the curation request's entity_merges field.
    """
    from app.api.modules.identity_infospace_user.models import Infospace
    from app.api.modules.foundation_service_providers import registry
    from app.api.modules.foundation_service_providers.base import EmbeddingProvider
    from app.core.similarity import find_duplicates
    from app.core.config import settings

    infospace = db.get(Infospace, access.infospace_id)
    if not infospace or not infospace.embedding_configured:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="No embedding provider configured for this infospace",
        )

    sel = infospace.get_embedding_selection()
    provider = registry.resolve(EmbeddingProvider, sel.provider_key, settings)
    if not provider:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Embedding provider '{sel.provider_key}' is not available",
        )

    model_name = sel.model_name

    async def embed(texts: list[str]) -> list[list[float]]:
        return await provider.embed_texts(texts, model_name)

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
    access: Access = Requires(),
    entity_id: int,
    depth: int = Query(default=1, ge=1, le=3),
    limit: int = Query(default=50, ge=1, le=500),
    db: Session = Depends(get_db),
) -> Any:
    """
    Get entity neighborhood via BFS traversal on materialized GraphEdge table.
    Returns nodes and edges reachable from the given entity up to `depth` hops.
    """
    infospace_id = access.infospace_id
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    access.require_in_scope("entity_canonical_ids", entity_id)

    from app.api.modules.graph.services import GraphService
    graph_service = GraphService(session=db)
    return graph_service.get_entity_neighborhood(
        entity_id=entity_id,
        depth=depth,
        limit=limit,
        infospace_id=infospace_id,
    )
