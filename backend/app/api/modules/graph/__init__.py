"""Graph domain — knowledge primitives.

Public surface:
- ``Canon`` / ``CanonRole``: vocabulary container, role enum (general | geo | …).
- ``Entity``: a member of a canon (replaces ``EntityCanonical``).
- ``EntityRelationship``: sparse, lazy-materialized aggregate per pair.
- ``KnowledgeGraph``: backed by exactly one Canon.
- ``GraphEdge``: per-triplet evidence row (``source_entity_id`` /
  ``target_entity_id``).
- ``FragmentCuration``: provenance for a curated annotation fragment.
- ``EntityEditLog``: audit log for manual entity edits.
"""

from app.api.modules.graph.models import (
    Canon,
    CanonRole,
    KnowledgeGraph,
    Entity,
    EntityRelationship,
    EntityEditLog,
    FragmentCuration,
    GraphEdge,
)

__all__ = [
    "Canon",
    "CanonRole",
    "KnowledgeGraph",
    "Entity",
    "EntityRelationship",
    "EntityEditLog",
    "FragmentCuration",
    "GraphEdge",
]
