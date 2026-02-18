"""Graph domain services: traversal, neighborhood queries."""

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.api.graph.models import EntityCanonical, FragmentCuration
from app.models import Annotation

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
                connected = self._get_connected_entity_ids(eid, entity.infospace_id)
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
        self, entity_id: int, infospace_id: int
    ) -> List[tuple[int, Optional[str]]]:
        """Find entity IDs connected via annotation triplets."""
        entity = self.session.get(EntityCanonical, entity_id)
        if not entity:
            return []
        name_lower = entity.canonical_name.lower()
        aliases_lower = [a.lower() for a in (entity.aliases or [])]
        all_names = {name_lower} | set(aliases_lower)
        result: List[tuple[int, Optional[str]]] = []

        all_canonicals = self.session.exec(
            select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
        ).all()
        canonicals: Dict[str, int] = {}
        for c in all_canonicals:
            canonicals[c.canonical_name.lower()] = c.id
            for a in c.aliases or []:
                canonicals[a.strip().lower()] = c.id

        annotations = self.session.exec(
            select(Annotation)
            .where(Annotation.infospace_id == infospace_id)
            .where(Annotation.value.isnot(None))
        ).all()

        for ann in annotations:
            triplets = self._extract_triplets(ann.value or {})
            for t in triplets:
                sub_name = (t.get("subject_name") or "").strip().lower()
                obj_name = (t.get("object_name") or "").strip().lower()
                pred = t.get("predicate")
                sub_matches = sub_name in all_names
                obj_matches = obj_name in all_names
                if sub_matches and obj_matches:
                    continue
                if sub_matches:
                    other_id = canonicals.get(obj_name)
                    if other_id and other_id != entity_id:
                        result.append((other_id, pred))
                elif obj_matches:
                    other_id = canonicals.get(sub_name)
                    if other_id and other_id != entity_id:
                        result.append((other_id, pred))

        return list(dict.fromkeys(result))

    def _extract_triplets(self, data: Any) -> List[Dict]:
        """Extract triplets from annotation value structure."""
        if isinstance(data, dict) and "triplets" in data and isinstance(data["triplets"], list):
            return [t for t in data["triplets"] if isinstance(t, dict)]
        if isinstance(data, dict) and "document" in data:
            return self._extract_triplets(data["document"])
        return []
