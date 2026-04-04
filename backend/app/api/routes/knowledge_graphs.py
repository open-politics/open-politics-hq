"""Routes for KnowledgeGraph CRUD + predicate/entity-type management."""

import logging
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from sqlalchemy import func, update

from app.models import KnowledgeGraph, GraphEdge, EntityCanonical
from app.api.modules.graph.schemas import (
    KnowledgeGraphCreate, KnowledgeGraphUpdate, KnowledgeGraphRead,
    RenamePredicateRequest, RenameEntityTypeRequest,
    PredicateSummary, EntityTypeSummary,
)
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
    access: Access = Requires(scope=None),
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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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
    access: Access = Requires(scope=None),
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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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
    access: Access = Requires(Capability.DELETE, scope=None),
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
    db.exec(update(EntityCanonical).where(EntityCanonical.graph_id == graph_id).values(graph_id=None))
    db.delete(graph)
    db.commit()


# ── Predicate management ─────────────────────────────────────────────────────


@router.get("/predicates/summary", response_model=List[PredicateSummary])
def list_predicates(
    *,
    access: Access = Requires(scope=None),
    graph_id: int | None = None,
    db: Session = Depends(get_db),
) -> Any:
    """List all unique predicates with edge counts."""
    infospace_id = access.infospace_id
    stmt = (
        select(GraphEdge.predicate, func.count(GraphEdge.id).label("count"))
        .where(GraphEdge.infospace_id == infospace_id)
        .where(GraphEdge.predicate.isnot(None))
        .group_by(GraphEdge.predicate)
        .order_by(func.count(GraphEdge.id).desc())
    )
    if graph_id is not None:
        stmt = stmt.where(GraphEdge.graph_id == graph_id)
    rows = db.exec(stmt).all()
    return [PredicateSummary(predicate=r[0], count=r[1]) for r in rows]


@router.post("/predicates/rename", response_model=dict)
def rename_predicates(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: RenamePredicateRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Rename/merge predicates: all edges with old_predicates become new_predicate."""
    infospace_id = access.infospace_id
    if not body.old_predicates:
        raise HTTPException(status_code=400, detail="old_predicates must not be empty")

    stmt = (
        update(GraphEdge)
        .where(GraphEdge.infospace_id == infospace_id)
        .where(GraphEdge.predicate.in_(body.old_predicates))
    )
    if body.graph_id is not None:
        stmt = stmt.where(GraphEdge.graph_id == body.graph_id)
    result = db.exec(stmt.values(predicate=body.new_predicate))
    db.commit()
    return {"updated": result.rowcount, "new_predicate": body.new_predicate}


# ── Entity type management ───────────────────────────────────────────────────


@router.get("/entity-types/summary", response_model=List[EntityTypeSummary])
def list_entity_types(
    *,
    access: Access = Requires(scope=None),
    graph_id: int | None = None,
    db: Session = Depends(get_db),
) -> Any:
    """List all unique entity types with entity counts."""
    infospace_id = access.infospace_id
    stmt = (
        select(EntityCanonical.entity_type, func.count(EntityCanonical.id).label("count"))
        .where(EntityCanonical.infospace_id == infospace_id)
        .group_by(EntityCanonical.entity_type)
        .order_by(func.count(EntityCanonical.id).desc())
    )
    if graph_id is not None:
        stmt = stmt.where(EntityCanonical.graph_id == graph_id)
    rows = db.exec(stmt).all()
    return [EntityTypeSummary(entity_type=r[0], count=r[1]) for r in rows]


@router.post("/entity-types/rename", response_model=dict)
def rename_entity_types(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: RenameEntityTypeRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Rename/merge entity types: all entities with old_types become new_type."""
    infospace_id = access.infospace_id
    if not body.old_types:
        raise HTTPException(status_code=400, detail="old_types must not be empty")

    stmt = (
        update(EntityCanonical)
        .where(EntityCanonical.infospace_id == infospace_id)
        .where(EntityCanonical.entity_type.in_(body.old_types))
    )
    if body.graph_id is not None:
        stmt = stmt.where(EntityCanonical.graph_id == body.graph_id)
    result = db.exec(stmt.values(entity_type=body.new_type))
    db.commit()
    return {"updated": result.rowcount, "new_type": body.new_type}
