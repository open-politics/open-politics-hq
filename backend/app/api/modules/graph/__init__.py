"""Graph domain — knowledge primitives.

Public surface:
- ``Canon``: a portable vocabulary container.
- ``CanonEntry``: a member of a canon (table ``canon_entry``; was ``Entity`` /
  ``EntityCanonical``).
- ``EntityRelationship``: sparse, lazy-materialized aggregate per pair.
- ``KnowledgeGraph``: backed by exactly one Canon.
- ``GraphEdge``: per-triplet evidence row (``source_entry_id`` /
  ``target_entry_id``).
- ``FragmentCuration``: provenance for a curated annotation fragment.
- ``EntityEditLog``: audit log for manual entry edits.
"""

from app.api.modules.graph.models import (
    Canon,
    KnowledgeGraph,
    CanonEntry,
    EntityRelationship,
    EntityEditLog,
    FragmentCuration,
    GraphEdge,
    CanonProposal,
)

__all__ = [
    "Canon",
    "KnowledgeGraph",
    "CanonEntry",
    "EntityRelationship",
    "EntityEditLog",
    "FragmentCuration",
    "GraphEdge",
    "CanonProposal",
]
