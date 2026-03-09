"""Graph domain services: traversal, neighborhood queries."""

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session
from sqlalchemy import text

from app.api.modules.graph.models import EntityCanonical

logger = logging.getLogger(__name__)


class GraphService:
    """Service for graph queries, traversal, and neighborhood exploration."""

    def __init__(self, session: Session):
        self.session = session

    def get_entity_neighborhood(
        self,
        entity_id: int,
        depth: int = 1,
        limit: int = 50,
        infospace_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """
        Get entity neighborhood for interactive graph exploration.
        Returns entities connected via annotation triplets up to given depth.

        Args:
            entity_id: Canonical entity ID
            depth: Traversal depth (1 = immediate neighbors)
            limit: Max entities to return
            infospace_id: Optional infospace filter

        Returns:
            Dict with nodes (entities) and edges (subject->object relations)
        """
        entity = self.session.get(EntityCanonical, entity_id)
        if not entity:
            return {"nodes": [], "edges": []}
        if infospace_id and entity.infospace_id != infospace_id:
            return {"nodes": [], "edges": []}

        seen: set[int] = {entity_id}
        frontier: List[int] = [entity_id]
        nodes: Dict[int, EntityCanonical] = {entity_id: entity}
        edges: List[Dict[str, Any]] = []

        for _ in range(depth):
            if len(nodes) >= limit:
                break
            next_frontier: List[int] = []
            for eid in frontier:
                e = nodes.get(eid) or self.session.get(EntityCanonical, eid)
                graph_id = e.graph_id if e else None
                connected = self._get_connected_entity_ids(eid, entity.infospace_id, graph_id)
                for conn_id, pred in connected:
                    if conn_id not in seen:
                        seen.add(conn_id)
                        conn_entity = self.session.get(EntityCanonical, conn_id)
                        if conn_entity:
                            nodes[conn_id] = conn_entity
                            edges.append({
                                "source": str(eid),
                                "target": str(conn_id),
                                "predicate": pred or "",
                            })
                            next_frontier.append(conn_id)
                    if len(nodes) >= limit:
                        break
                if len(nodes) >= limit:
                    break
            frontier = next_frontier
            if not frontier:
                break

        return {
            "nodes": [
                {
                    "id": str(e.id),
                    "name": e.canonical_name,
                    "type": e.entity_type,
                }
                for e in nodes.values()
            ],
            "edges": edges[:limit],
        }

    def _get_connected_entity_ids(
        self, entity_id: int, infospace_id: int, graph_id: Optional[int] = None
    ) -> List[tuple[int, Optional[str]]]:
        """Find entity IDs connected via materialized GraphEdge table (O(1) indexed lookup)."""
        if graph_id is not None:
            sql = text("""
                SELECT object_entity_id AS other_id, predicate
                FROM graphedge
                WHERE subject_entity_id = :eid AND infospace_id = :iid AND graph_id = :gid
                UNION ALL
                SELECT subject_entity_id AS other_id, predicate
                FROM graphedge
                WHERE object_entity_id = :eid AND infospace_id = :iid AND graph_id = :gid
            """)
            rows = self.session.execute(sql, {"eid": entity_id, "iid": infospace_id, "gid": graph_id}).fetchall()
        else:
            sql = text("""
                SELECT object_entity_id AS other_id, predicate
                FROM graphedge
                WHERE subject_entity_id = :eid AND infospace_id = :iid AND graph_id IS NULL
                UNION ALL
                SELECT subject_entity_id AS other_id, predicate
                FROM graphedge
                WHERE object_entity_id = :eid AND infospace_id = :iid AND graph_id IS NULL
            """)
            rows = self.session.execute(sql, {"eid": entity_id, "iid": infospace_id}).fetchall()
        return [(r[0], r[1]) for r in rows if r[0] != entity_id]
