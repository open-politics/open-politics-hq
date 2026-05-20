"""Routes for EntityRelationship — graph-scoped, sparse, pair-canonical.

Relationships are an aggregate view over GraphEdge groupby. The list endpoint
projects ``GROUP BY (entity_a, entity_b)`` over edges and LEFT JOINs the
sparse ``EntityRelationship`` overlay (label, notes, tags, properties,
is_pinned). Most pairs have no overlay row and show only derived counts.

PATCH lazy-materializes: the first user pin/note/tag creates the row.
DELETE removes only the overlay; derived counts are unchanged.

Canonical ordering: ``entity_a_id < entity_b_id`` is enforced at the DB
level. Routes accept ``(a, b)`` in any order; ``_normalize_pair`` puts them
into canonical order before lookup/insert. Callers don't need to know the
ordering.

Scope/capability invariant (FOUNDATION.md): scope gates reads, capabilities
gate writes — they never overlap. Relationships have no ``relationship_ids``
scope field; the graph-level ``graph_ids`` scope on read + capability gate
on write is sufficient. Package consumers cannot reach write endpoints.
"""

import logging
from typing import Any, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session, select
from sqlalchemy import and_, func, or_, text

from app.models import (
    Entity, EntityRelationship, GraphEdge, KnowledgeGraph,
)
from app.api.modules.graph.schemas import (
    EntityRelationshipRead, EntityRelationshipUpdate,
    DeleteImpact, DeleteRequest,
)
from app.api.dependency_injection import get_db
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)

logger = logging.getLogger(__name__)


def _normalize_pair(a: int, b: int) -> tuple[int, int]:
    """Return ``(min, max)`` so callers can pass ``(a, b)`` in any order.

    Mirrors the DB CHECK ``entity_a_id < entity_b_id`` — see the
    ``EntityRelationship`` model. Pairs where ``a == b`` are rejected;
    a relationship requires two distinct entities.
    """
    if a == b:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Relationship requires two distinct entities",
        )
    return (a, b) if a < b else (b, a)


def _ensure_graph_in_scope(
    graph_id: int, access: Access, db: Session,
) -> KnowledgeGraph:
    """Validate the graph belongs to the access infospace and is in scope."""
    graph = db.get(KnowledgeGraph, graph_id)
    if not graph or graph.infospace_id != access.infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Graph not found")
    access.require_in_scope("graph_ids", graph_id)
    return graph


def _ensure_pair_in_canon(
    graph: KnowledgeGraph, a_id: int, b_id: int, db: Session,
) -> tuple[Entity, Entity]:
    """Both entities must exist and live in the graph's canon."""
    a = db.get(Entity, a_id)
    b = db.get(Entity, b_id)
    if not a or not b:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Entity not found")
    if a.canon_id != graph.canon_id or b.canon_id != graph.canon_id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Entities must belong to the graph's canon ({graph.canon_id})",
        )
    return a, b


router = APIRouter(
    prefix="/infospaces/{infospace_id}/graphs/{graph_id}",
    tags=["Relationships"],
)


@router.get("/relationships", response_model=List[EntityRelationshipRead])
def list_relationships(
    *,
    graph_id: int,
    access: Access = Requires(scope="graph_ids"),
    pinned_only: bool = Query(default=False),
    tags: Optional[List[str]] = Query(default=None, description="Filter to relationships carrying any of these tags"),
    limit: int = Query(default=200, le=2000),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> Any:
    """Derived list: GROUP BY (entity_a, entity_b) over GraphEdge, LEFT JOIN
    EntityRelationship overlay.

    Each row carries the derived ``edge_count`` and ``predicates`` array; the
    overlay fields (``label``, ``notes``, ``tags``, ``properties``,
    ``is_pinned``, ``is_active``) are present when a materialized row exists,
    null/empty otherwise.
    """
    _ensure_graph_in_scope(graph_id, access, db)

    # CTE collapses direction (a→b and b→a feed the same canonical pair),
    # then we GROUP BY at the outer level. PostgreSQL rejects same-level
    # aliases in GROUP BY for computed expressions, hence the CTE.
    overlay_where = []
    params: dict[str, Any] = {"gid": graph_id, "lim": limit, "off": offset}
    if pinned_only:
        overlay_where.append("er.is_pinned = TRUE")
    if tags:
        overlay_where.append("er.tags ?| CAST(:tags AS text[])")
        params["tags"] = list(tags)
    overlay_filter = ("WHERE " + " AND ".join(overlay_where)) if overlay_where else ""

    sql = text(f"""
        WITH normalized AS (
            SELECT
                graph_id,
                LEAST(source_entity_id, target_entity_id) AS entity_a_id,
                GREATEST(source_entity_id, target_entity_id) AS entity_b_id,
                predicate
              FROM graphedge
             WHERE graph_id = :gid
               AND source_entity_id <> target_entity_id
        )
        SELECT
            n.entity_a_id,
            n.entity_b_id,
            count(*) AS edge_count,
            array_agg(DISTINCT n.predicate) FILTER (WHERE n.predicate IS NOT NULL) AS predicates,
            er.id AS er_id,
            er.label, er.notes, er.tags, er.properties, er.is_pinned, er.is_active
          FROM normalized n
          LEFT JOIN entityrelationship er
            ON er.graph_id = n.graph_id
           AND er.entity_a_id = n.entity_a_id
           AND er.entity_b_id = n.entity_b_id
        {overlay_filter}
         GROUP BY n.entity_a_id, n.entity_b_id, er.id, er.label, er.notes, er.tags, er.properties, er.is_pinned, er.is_active
         ORDER BY edge_count DESC
         LIMIT :lim OFFSET :off
    """)

    rows = db.execute(sql, params).fetchall()
    return [
        EntityRelationshipRead(
            graph_id=graph_id,
            entity_a_id=row.entity_a_id,
            entity_b_id=row.entity_b_id,
            edge_count=row.edge_count,
            predicates=list(row.predicates or []),
            id=row.er_id,
            label=row.label,
            notes=row.notes,
            tags=list(row.tags or []),
            properties=dict(row.properties or {}),
            is_pinned=bool(row.is_pinned) if row.is_pinned is not None else False,
            is_active=bool(row.is_active) if row.is_active is not None else True,
        )
        for row in rows
    ]


@router.get("/relationships/{a}/{b}", response_model=EntityRelationshipRead)
def get_relationship(
    *,
    graph_id: int,
    a: int,
    b: int,
    access: Access = Requires(scope="graph_ids"),
    db: Session = Depends(get_db),
) -> Any:
    """Get a single relationship — derived counts + overlay if present."""
    graph = _ensure_graph_in_scope(graph_id, access, db)
    a_id, b_id = _normalize_pair(a, b)

    edge_stats = db.execute(text("""
        SELECT
            count(*) AS edge_count,
            array_agg(DISTINCT predicate) FILTER (WHERE predicate IS NOT NULL) AS predicates
          FROM graphedge
         WHERE graph_id = :gid
           AND (
             (source_entity_id = :a AND target_entity_id = :b) OR
             (source_entity_id = :b AND target_entity_id = :a)
           )
    """), {"gid": graph_id, "a": a_id, "b": b_id}).first()

    overlay = db.exec(
        select(EntityRelationship).where(
            EntityRelationship.graph_id == graph_id,
            EntityRelationship.entity_a_id == a_id,
            EntityRelationship.entity_b_id == b_id,
        )
    ).first()

    if (not edge_stats or not edge_stats.edge_count) and overlay is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Relationship not found")

    return EntityRelationshipRead(
        graph_id=graph_id,
        entity_a_id=a_id,
        entity_b_id=b_id,
        edge_count=int(edge_stats.edge_count or 0) if edge_stats else 0,
        predicates=list((edge_stats.predicates if edge_stats else None) or []),
        id=overlay.id if overlay else None,
        label=overlay.label if overlay else None,
        notes=overlay.notes if overlay else None,
        tags=list(overlay.tags or []) if overlay else [],
        properties=dict(overlay.properties or {}) if overlay else {},
        is_pinned=overlay.is_pinned if overlay else False,
        is_active=overlay.is_active if overlay else True,
    )


@router.patch("/relationships/{a}/{b}", response_model=EntityRelationshipRead)
def upsert_relationship(
    *,
    graph_id: int,
    a: int,
    b: int,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    body: EntityRelationshipUpdate,
    db: Session = Depends(get_db),
) -> Any:
    """Lazy-materialize the relationship overlay if absent, then apply patch.

    Tags/properties are replaced wholesale when provided (pass empty list/dict
    to clear). When the overlay didn't previously exist, it's created with
    the patch applied.
    """
    graph = _ensure_graph_in_scope(graph_id, access, db)
    a_id, b_id = _normalize_pair(a, b)
    _ensure_pair_in_canon(graph, a_id, b_id, db)

    overlay = db.exec(
        select(EntityRelationship).where(
            EntityRelationship.graph_id == graph_id,
            EntityRelationship.entity_a_id == a_id,
            EntityRelationship.entity_b_id == b_id,
        )
    ).first()

    if overlay is None:
        overlay = EntityRelationship(
            entity_a_id=a_id,
            entity_b_id=b_id,
            graph_id=graph_id,
            created_by=access.user_id,
        )
        db.add(overlay)
        db.flush()

    if body.label is not None:
        overlay.label = body.label
    if body.notes is not None:
        overlay.notes = body.notes
    if body.tags is not None:
        overlay.tags = body.tags
    if body.properties is not None:
        overlay.properties = body.properties
    if body.is_pinned is not None:
        overlay.is_pinned = body.is_pinned

    db.add(overlay)
    db.commit()
    db.refresh(overlay)

    # Return the same shape as GET — derived counts + overlay
    edge_stats = db.execute(text("""
        SELECT
            count(*) AS edge_count,
            array_agg(DISTINCT predicate) FILTER (WHERE predicate IS NOT NULL) AS predicates
          FROM graphedge
         WHERE graph_id = :gid
           AND (
             (source_entity_id = :a AND target_entity_id = :b) OR
             (source_entity_id = :b AND target_entity_id = :a)
           )
    """), {"gid": graph_id, "a": a_id, "b": b_id}).first()

    return EntityRelationshipRead(
        graph_id=graph_id,
        entity_a_id=a_id,
        entity_b_id=b_id,
        edge_count=int(edge_stats.edge_count or 0) if edge_stats else 0,
        predicates=list((edge_stats.predicates if edge_stats else None) or []),
        id=overlay.id,
        label=overlay.label,
        notes=overlay.notes,
        tags=list(overlay.tags or []),
        properties=dict(overlay.properties or {}),
        is_pinned=overlay.is_pinned,
        is_active=overlay.is_active,
    )


@router.post("/relationships/{a}/{b}/action/delete", response_model=DeleteImpact)
def delete_relationship_overlay(
    *,
    graph_id: int,
    a: int,
    b: int,
    access: Access = Requires(Capability.DELETE, scope=None),
    body: DeleteRequest,
    db: Session = Depends(get_db),
) -> Any:
    """Delete only the materialized overlay row. Derived counts are unchanged
    — the relationship still appears in the list with its edge_count and
    predicates, just without the user-curated fields.

    This is a soft destructive action — it removes user notes/tags/pin. Use
    with care; preview first.
    """
    graph = _ensure_graph_in_scope(graph_id, access, db)
    a_id, b_id = _normalize_pair(a, b)

    overlay = db.exec(
        select(EntityRelationship).where(
            EntityRelationship.graph_id == graph_id,
            EntityRelationship.entity_a_id == a_id,
            EntityRelationship.entity_b_id == b_id,
        )
    ).first()

    if overlay is None:
        # Nothing to delete; return a "vacuous" preview.
        return DeleteImpact(can_proceed=True, confirmed=body.confirm)

    impact = DeleteImpact(
        can_proceed=True,
        cascaded_relationships=1,
    )
    if not body.confirm:
        return impact

    db.delete(overlay)
    db.commit()
    impact.confirmed = True
    return impact
