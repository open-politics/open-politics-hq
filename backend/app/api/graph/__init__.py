"""Graph domain: EntityCanonical, FragmentCuration. Use graph.resolution for resolve_entity etc., graph.services for GraphService."""

from app.api.graph.models import EntityCanonical, FragmentCuration

__all__ = [
    "EntityCanonical", "FragmentCuration",
]
