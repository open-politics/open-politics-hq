"""Routes for KnowledgeGraph CRUD."""

import logging
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.models import KnowledgeGraph, Infospace
from app.api.modules.graph.schemas import KnowledgeGraphCreate, KnowledgeGraphUpdate, KnowledgeGraphRead
from app.api.dependency_injection import CurrentUser, get_db
from app.api.global_utils import validate_infospace_access

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/knowledge-graphs",
    tags=["Knowledge Graphs"],
)


@router.get("", response_model=List[KnowledgeGraphRead])
def list_knowledge_graphs(
    *,
    infospace_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> Any:
    """List knowledge graphs for an infospace."""
    validate_infospace_access(db, infospace_id, current_user.id)
    stmt = select(KnowledgeGraph).where(KnowledgeGraph.infospace_id == infospace_id)
    graphs = db.exec(stmt).all()
    return list(graphs)


@router.post("", response_model=KnowledgeGraphRead, status_code=status.HTTP_201_CREATED)
def create_knowledge_graph(
    *,
    infospace_id: int,
    current_user: CurrentUser,
    graph_in: KnowledgeGraphCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create a named knowledge graph."""
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    graph = KnowledgeGraph(
        infospace_id=infospace_id,
        name=graph_in.name,
        description=graph_in.description,
        source_config=graph_in.source_config or {},
        edit_policy=graph_in.edit_policy or "method_only",
    )
    db.add(graph)
    db.commit()
    db.refresh(graph)
    return graph


@router.get("/{graph_id}", response_model=KnowledgeGraphRead)
def get_knowledge_graph(
    *,
    infospace_id: int,
    graph_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> Any:
    """Get a knowledge graph by ID."""
    validate_infospace_access(db, infospace_id, current_user.id)
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")
    return graph


@router.patch("/{graph_id}", response_model=KnowledgeGraphRead)
def update_knowledge_graph(
    *,
    infospace_id: int,
    graph_id: int,
    current_user: CurrentUser,
    graph_in: KnowledgeGraphUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Update a knowledge graph."""
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")
    if graph_in.name is not None:
        graph.name = graph_in.name
    if graph_in.description is not None:
        graph.description = graph_in.description
    if graph_in.source_config is not None:
        graph.source_config = graph_in.source_config
    if graph_in.edit_policy is not None:
        graph.edit_policy = graph_in.edit_policy
    db.add(graph)
    db.commit()
    db.refresh(graph)
    return graph


@router.delete("/{graph_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_knowledge_graph(
    *,
    infospace_id: int,
    graph_id: int,
    current_user: CurrentUser,
    db: Session = Depends(get_db),
) -> None:
    """Delete a knowledge graph. Entities with graph_id set will need handling (cascade or nullify)."""
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")
    # Nullify graph_id on entities pointing to this graph
    from app.models import EntityCanonical
    from sqlalchemy import update
    db.exec(update(EntityCanonical).where(EntityCanonical.graph_id == graph_id).values(graph_id=None))
    db.delete(graph)
    db.commit()
