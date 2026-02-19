"""Routes for entity canonical management."""
import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.models import EntityCanonical, Infospace, User
from app.api.dependency_injection import CurrentUser, get_db
from app.api.modules.graph.resolution import resolve_entity
from app.api.modules.embedding.services import EmbeddingService

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/entities",
    tags=["Entities"]
)


@router.get("", response_model=List[dict])
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
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    stmt = select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
    if entity_type:
        stmt = stmt.where(EntityCanonical.entity_type == entity_type)
    
    entities = db.exec(stmt).all()
    return [entity.model_dump() for entity in entities]


@router.post("", response_model=dict, status_code=status.HTTP_201_CREATED)
async def create_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_in: dict,
    db: Session = Depends(get_db)
) -> Any:
    """
    Create a canonical entity manually.
    
    Body: {
        "canonical_name": str,
        "entity_type": str,
        "aliases": List[str] (optional),
        "properties": dict (optional)
    }
    """
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    canonical_name = entity_in.get("canonical_name")
    entity_type = entity_in.get("entity_type")
    
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
    
    entity = EntityCanonical(
        infospace_id=infospace_id,
        canonical_name=canonical_name,
        entity_type=entity_type,
        aliases=entity_in.get("aliases", [canonical_name]),
        properties=entity_in.get("properties", {})
    )
    
    db.add(entity)
    db.commit()
    db.refresh(entity)
    
    return entity.model_dump()


@router.put("/{entity_id}", response_model=dict)
def update_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_id: int,
    entity_in: dict,
    db: Session = Depends(get_db)
) -> Any:
    """
    Update a canonical entity (rename, edit aliases, properties).
    
    Body: {
        "canonical_name": str (optional),
        "aliases": List[str] (optional),
        "properties": dict (optional)
    }
    """
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    
    if "canonical_name" in entity_in:
        entity.canonical_name = entity_in["canonical_name"]
    if "aliases" in entity_in:
        entity.aliases = entity_in["aliases"]
    if "properties" in entity_in:
        entity.properties = entity_in["properties"]
    
    db.add(entity)
    db.commit()
    db.refresh(entity)
    
    return entity.model_dump()


@router.delete("/{entity_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_entity(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    entity_id: int,
    db: Session = Depends(get_db)
) -> None:
    """Delete a canonical entity."""
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    entity = db.get(EntityCanonical, entity_id)
    if not entity or entity.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    
    db.delete(entity)
    db.commit()


@router.post("/merge", response_model=dict)
async def merge_entities(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    merge_request: dict,
    db: Session = Depends(get_db)
) -> Any:
    """
    Merge multiple entities into one canonical entity.
    
    Body: {
        "entity_ids": List[int],
        "canonical_name": str (optional, uses first entity's name if not provided),
        "keep_id": int (optional, which entity ID to keep, defaults to first)
    }
    """
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    entity_ids = merge_request.get("entity_ids", [])
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
    
    # Determine which entity to keep
    keep_id = merge_request.get("keep_id", entity_ids[0])
    keep_entity = next((e for e in entities if e.id == keep_id), entities[0])
    
    # Collect all aliases
    all_aliases = set(keep_entity.aliases or [])
    for entity in entities:
        if entity.id != keep_entity.id:
            all_aliases.add(entity.canonical_name)
            all_aliases.update(entity.aliases or [])
    
    # Update keep entity
    if "canonical_name" in merge_request:
        keep_entity.canonical_name = merge_request["canonical_name"]
    keep_entity.aliases = list(all_aliases)
    
    # Merge properties
    merged_properties = keep_entity.properties.copy()
    for entity in entities:
        if entity.id != keep_entity.id:
            merged_properties.update(entity.properties or {})
    keep_entity.properties = merged_properties
    
    # Delete other entities
    for entity in entities:
        if entity.id != keep_entity.id:
            db.delete(entity)
    
    db.add(keep_entity)
    db.commit()
    db.refresh(keep_entity)
    
    return keep_entity.model_dump()


@router.post("/resolve", response_model=dict)
async def trigger_resolution(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    resolve_request: dict,
    db: Session = Depends(get_db)
) -> Any:
    """
    Trigger automatic entity resolution for raw entity mentions.
    
    Body: {
        "raw_entities": List[{"name": str, "type": str}],
        "similarity_threshold": float (optional, default 0.85),
        "use_embeddings": bool (optional, default true)
    }
    """
    # Verify infospace access
    infospace = db.get(Infospace, infospace_id)
    if not infospace or infospace.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Infospace not found")
    
    raw_entities = resolve_request.get("raw_entities", [])
    similarity_threshold = resolve_request.get("similarity_threshold", 0.85)
    use_embeddings = resolve_request.get("use_embeddings", True)
    
    embedding_service = None
    if use_embeddings:
        embedding_service = EmbeddingService(session=db, user_id=current_user.id)
    
    resolved = []
    for raw_entity in raw_entities:
        canonical = await resolve_entity(
            session=db,
            infospace_id=infospace_id,
            raw_name=raw_entity["name"],
            entity_type=raw_entity["type"],
            embedding_service=embedding_service,
            similarity_threshold=similarity_threshold
        )
        resolved.append({
            "raw_name": raw_entity["name"],
            "canonical_id": canonical.id,
            "canonical_name": canonical.canonical_name
        })
    
    db.commit()
    
    return {
        "resolved_count": len(resolved),
        "resolved": resolved
    }
