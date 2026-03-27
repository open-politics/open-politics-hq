"""Routes for KnowledgeGraph CRUD."""

import logging
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.models import KnowledgeGraph
from app.api.modules.graph.schemas import KnowledgeGraphCreate, KnowledgeGraphUpdate, KnowledgeGraphRead
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/knowledge-graphs",
    tags=["Knowledge Graphs"],
)


@router.get("", response_model=List[KnowledgeGraphRead])
def list_knowledge_graphs(
    *,
    access: Access = Requires(),
    db: Session = Depends(get_db),
) -> Any:
    """List knowledge graphs for an infospace."""
    infospace_id = access.infospace_id
    stmt = select(KnowledgeGraph).where(KnowledgeGraph.infospace_id == infospace_id)
    stmt = access.scope_filter(stmt, KnowledgeGraph.id, "graph_ids")
    graphs = db.exec(stmt).all()
    return list(graphs)


@router.post("", response_model=KnowledgeGraphRead, status_code=status.HTTP_201_CREATED)
def create_knowledge_graph(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    graph_in: KnowledgeGraphCreate,
    db: Session = Depends(get_db),
) -> Any:
    """Create a named knowledge graph."""
    infospace_id = access.infospace_id
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
    access: Access = Requires(),
    graph_id: int,
    db: Session = Depends(get_db),
) -> Any:
    """Get a knowledge graph by ID."""
    infospace_id = access.infospace_id
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")
    access.require_in_scope("graph_ids", graph_id)
    return graph


@router.patch("/{graph_id}", response_model=KnowledgeGraphRead)
def update_knowledge_graph(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    graph_id: int,
    graph_in: KnowledgeGraphUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Update a knowledge graph."""
    infospace_id = access.infospace_id
    access.require_in_scope("graph_ids", graph_id)
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
    access: Access = Requires(Capability.DELETE),
    graph_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete a knowledge graph. Entities with graph_id set will need handling (cascade or nullify)."""
    infospace_id = access.infospace_id
    access.require_in_scope("graph_ids", graph_id)
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")
    # Nullify graph_id on entities pointing to this graph
    from app.models import EntityCanonical
    from sqlalchemy import update
    db.exec(update(EntityCanonical).where(EntityCanonical.graph_id == graph_id).values(graph_id=None))
    db.delete(graph)
    db.commit()
