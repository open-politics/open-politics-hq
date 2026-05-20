"""Graph domain services: traversal, neighborhood queries."""

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session
from sqlalchemy import text

from app.api.modules.graph.models import Entity

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
        graph_id: Optional[int] = None,
    ) -> Dict[str, Any]:
        """Get entity neighborhood for interactive graph exploration.

        Returns entities connected via materialized GraphEdge rows up to the
        given depth. ``graph_id`` is now an explicit caller parameter — Entity
        no longer carries a graph_id (entities live on canons; graphs reference
        entities via edges).
        """
        entity = self.session.get(Entity, entity_id)
        if not entity:
            return {"nodes": [], "edges": []}
        if infospace_id and entity.infospace_id != infospace_id:
            return {"nodes": [], "edges": []}

        seen: set[int] = {entity_id}
        frontier: List[int] = [entity_id]
        nodes: Dict[int, Entity] = {entity_id: entity}
        edges: List[Dict[str, Any]] = []

        for _ in range(depth):
            if len(nodes) >= limit:
                break
            next_frontier: List[int] = []
            for eid in frontier:
                connected = self._get_connected_entity_ids(eid, entity.infospace_id, graph_id)
                for conn_id, pred in connected:
                    if conn_id not in seen:
                        seen.add(conn_id)
                        conn_entity = self.session.get(Entity, conn_id)
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
        """Find entity IDs connected via GraphEdge (O(1) indexed lookup).

        Direction is collapsed for neighborhood exploration: a→b and b→a both
        contribute. The graph-scoped indexes ``ix_graph_edge_graph_source`` /
        ``ix_graph_edge_graph_target`` cover the hot path when ``graph_id`` is
        provided. The infospace fallback (graph_id=NULL edges) seq-scans;
        graph_id should always be passed in normal use.
        """
        if graph_id is not None:
            sql = text("""
                SELECT target_entity_id AS other_id, predicate
                FROM graphedge
                WHERE source_entity_id = :eid AND graph_id = :gid
                UNION ALL
                SELECT source_entity_id AS other_id, predicate
                FROM graphedge
                WHERE target_entity_id = :eid AND graph_id = :gid
            """)
            rows = self.session.execute(sql, {"eid": entity_id, "gid": graph_id}).fetchall()
        else:
            sql = text("""
                SELECT target_entity_id AS other_id, predicate
                FROM graphedge
                WHERE source_entity_id = :eid AND infospace_id = :iid AND graph_id IS NULL
                UNION ALL
                SELECT source_entity_id AS other_id, predicate
                FROM graphedge
                WHERE target_entity_id = :eid AND infospace_id = :iid AND graph_id IS NULL
            """)
            rows = self.session.execute(sql, {"eid": entity_id, "iid": infospace_id}).fetchall()
        return [(r[0], r[1]) for r in rows if r[0] != entity_id]
