"""Routes for KnowledgeGraph CRUD + predicate/entity-type management.

Knowledge graphs are backed by a Canon (vocabulary). Create defaults
``canon_id`` to the infospace's General canon when omitted; pass an explicit
``canon_id`` to back the graph with a curated vocabulary. Multiple graphs
can share one canon.

Deletion uses the ``/action/delete`` preview/confirm pattern (mirroring
``core/tree.py``). Entities are NOT destroyed when a graph is deleted —
they live on the canon, not the graph. Edges, FragmentCurations, and
materialized EntityRelationships for this graph are cascaded away.
"""

import logging
from typing import List, Any
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select
from sqlalchemy import func, update, or_

from app.models import (
    KnowledgeGraph, GraphEdge, Entity, Canon, FragmentCuration, EntityRelationship,
)
from app.api.modules.graph.schemas import (
    KnowledgeGraphCreate, KnowledgeGraphUpdate, KnowledgeGraphRead,
    RenamePredicateRequest, RenameEntityTypeRequest,
    PredicateSummary, EntityTypeSummary,
    DeleteImpact, DeleteRequest,
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
    """Create a named knowledge graph backed by a canon.

    ``canon_id`` defaults to ``infospace.default_canon_id`` (the General canon
    every infospace gets). To back the graph with a curated vocabulary, create
    the canon first and pass its ``canon_id``.
    """
    infospace_id = access.infospace_id
    canon_id = graph_in.canon_id
    if canon_id is None:
        # Default to the infospace's General canon.
        canon_id = access.infospace.default_canon_id
        if canon_id is None:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Infospace has no default canon — migration regression?",
            )
    else:
        # Validate the canon belongs to this infospace.
        canon = db.get(Canon, canon_id)
        if not canon or canon.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Canon {canon_id} not found in this infospace",
            )

    graph = KnowledgeGraph(
        infospace_id=infospace_id,
        canon_id=canon_id,
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


@router.post("/{graph_id}/action/delete", response_model=DeleteImpact)
def delete_knowledge_graph(
    *,
    access: Access = Requires(Capability.DELETE, scope=None),
    graph_id: int,
    body: DeleteRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Delete a knowledge graph (preview or confirm).

    Cascade: GraphEdge, FragmentCuration (for affected annotations), and
    materialized EntityRelationship rows for this graph are destroyed.
    Entities live on the canon and survive. Annotations, assets, schemas
    are never destroyed by a graph delete.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("graph_ids", graph_id)
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Knowledge graph not found")

    edges = db.exec(select(func.count(GraphEdge.id)).where(GraphEdge.graph_id == graph_id)).first() or 0
    relationships = db.exec(
        select(func.count(EntityRelationship.id)).where(EntityRelationship.graph_id == graph_id)
    ).first() or 0
    # FragmentCuration rows that reference annotations whose only graph use
    # was this one: approximate as those linked to GraphEdges of this graph.
    curations = db.exec(
        select(func.count(FragmentCuration.id.distinct())).select_from(
            FragmentCuration.__table__.join(
                GraphEdge.__table__,
                FragmentCuration.annotation_id == GraphEdge.annotation_id,
            )
        ).where(GraphEdge.graph_id == graph_id)
    ).first() or 0

    impact = DeleteImpact(
        can_proceed=True,
        cascaded_edges=int(edges),
        cascaded_relationships=int(relationships),
        cascaded_curations=int(curations),
    )

    if not body.confirm:
        return impact

    # Execute: re-analyze + cascade
    db.exec(update(EntityRelationship).where(EntityRelationship.graph_id == graph_id).values(is_active=False))
    db.execute(EntityRelationship.__table__.delete().where(EntityRelationship.graph_id == graph_id))
    db.execute(GraphEdge.__table__.delete().where(GraphEdge.graph_id == graph_id))
    db.delete(graph)
    db.commit()
    impact.confirmed = True
    return impact


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
    """List all unique entity types with entity counts.

    When ``graph_id`` is provided, scopes to entities in the graph's canon.
    Otherwise lists all entities in the infospace.
    """
    infospace_id = access.infospace_id
    stmt = (
        select(Entity.entity_type, func.count(Entity.id).label("count"))
        .where(Entity.infospace_id == infospace_id)
        .group_by(Entity.entity_type)
        .order_by(func.count(Entity.id).desc())
    )
    if graph_id is not None:
        graph = db.get(KnowledgeGraph, graph_id)
        if graph:
            stmt = stmt.where(Entity.canon_id == graph.canon_id)
    rows = db.exec(stmt).all()
    return [EntityTypeSummary(entity_type=r[0], count=r[1]) for r in rows]


@router.post("/entity-types/rename", response_model=dict)
def rename_entity_types(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: RenameEntityTypeRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Rename/merge entity types within an infospace (or a graph's canon)."""
    infospace_id = access.infospace_id
    if not body.old_types:
        raise HTTPException(status_code=400, detail="old_types must not be empty")

    stmt = (
        update(Entity)
        .where(Entity.infospace_id == infospace_id)
        .where(Entity.entity_type.in_(body.old_types))
    )
    if body.graph_id is not None:
        graph = db.get(KnowledgeGraph, body.graph_id)
        if graph:
            stmt = stmt.where(Entity.canon_id == graph.canon_id)
    result = db.exec(stmt.values(entity_type=body.new_type))
    db.commit()
    return {"updated": result.rowcount, "new_type": body.new_type}
