"""Routes for entity canonical management."""
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.models import EntityCanonical, EntityEditLog, FragmentCuration, KnowledgeGraph, User
from app.api.modules.graph.schemas import (
    EntityCanonicalRead,
    EntityCanonicalCreate,
    EntityCanonicalUpdate,
    MergeEntitiesRequest,
    ResolveEntitiesRequest,
)
from app.api.dependency_injection import CurrentUser, get_db
from app.api.global_utils import validate_infospace_access
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
    current_user: CurrentUser,
    infospace_id: int,
    entity_type: Optional[str] = None,
    db: Session = Depends(get_db)
) -> Any:
    """
    List canonical entities for an infospace.
    Optionally filter by entity_type.
    """
    validate_infospace_access(db, infospace_id, current_user.id)
    stmt = select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
    if entity_type:
        stmt = stmt.where(EntityCanonical.entity_type == entity_type)
    
    entities = db.exec(stmt).all()
    return list(entities)


@router.post("", response_model=EntityCanonicalRead, status_code=status.HTTP_201_CREATED)
async def create_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_in: EntityCanonicalCreate,
    db: Session = Depends(get_db)
) -> Any:
    """
    Create a canonical entity manually.
    """
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
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
            performed_by=f"user:{current_user.id}",
            previous_state={},
        )
        db.add(log)
    db.commit()
    db.refresh(entity)
    return entity


@router.put("/{entity_id}", response_model=EntityCanonicalRead)
def update_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_id: int,
    entity_in: EntityCanonicalUpdate,
    db: Session = Depends(get_db)
) -> Any:
    """
    Update a canonical entity (rename, edit aliases, properties).
    """
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")

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
            performed_by=f"user:{current_user.id}",
            previous_state=prev_state,
        )
        db.add(log)
    db.commit()
    db.refresh(entity)

    return entity


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_id: int,
    db: Session = Depends(get_db)
) -> None:
    """Delete a canonical entity."""
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")

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
    current_user: CurrentUser,
    infospace_id: int,
    merge_request: MergeEntitiesRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Merge multiple entities into one canonical entity.
    """
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
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

    # Update FragmentCuration FK columns: replace merged (deleted) entity IDs with keep_entity.id
    merged_ids = {e.id for e in entities if e.id != keep_entity.id}
    if merged_ids:
        from sqlalchemy import or_
        for fc in db.exec(
            select(FragmentCuration).where(
                or_(
                    FragmentCuration.subject_entity_id.in_(merged_ids),
                    FragmentCuration.object_entity_id.in_(merged_ids),
                    FragmentCuration.entity_canonical_id.in_(merged_ids),
                )
            )
        ).all():
            updated = False
            if fc.subject_entity_id in merged_ids:
                fc.subject_entity_id = keep_entity.id
                updated = True
            if fc.object_entity_id in merged_ids:
                fc.object_entity_id = keep_entity.id
                updated = True
            if fc.entity_canonical_id in merged_ids:
                fc.entity_canonical_id = keep_entity.id
                updated = True
            if updated:
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
            performed_by=f"user:{current_user.id}",
            previous_state={"merged_entity_ids": entity_ids, "merged_states": prev},
        )
        db.add(log)
    db.commit()
    db.refresh(keep_entity)
    return keep_entity


@router.post("/resolve")
async def trigger_resolution(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    resolve_request: ResolveEntitiesRequest,
    db: Session = Depends(get_db)
) -> Any:
    """
    Trigger automatic entity resolution for raw entity mentions.
    """
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    raw_entities = resolve_request.raw_entities
    similarity_threshold = resolve_request.similarity_threshold
    use_embeddings = resolve_request.use_embeddings
    
    embedding_service = None
    if use_embeddings:
        embedding_service = EmbeddingService(session=db, user_id=current_user.id)
    
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
