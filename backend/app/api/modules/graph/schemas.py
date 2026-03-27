"""Graph domain Pydantic schemas for API responses and OpenAPI generation."""

from datetime import datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict


class KnowledgeGraphRead(BaseModel):
    """Response schema for KnowledgeGraph."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    uuid: str
    infospace_id: int
    name: str
    description: Optional[str] = None
    source_config: Dict[str, Any] = {}
    edit_policy: str = "method_only"
    created_at: datetime
    updated_at: datetime


class KnowledgeGraphCreate(BaseModel):
    """Request schema for creating a KnowledgeGraph."""

    name: str
    description: Optional[str] = None
    source_config: Optional[Dict[str, Any]] = None
    edit_policy: str = "method_only"


class KnowledgeGraphUpdate(BaseModel):
    """Request schema for updating a KnowledgeGraph."""

    name: Optional[str] = None
    description: Optional[str] = None
    source_config: Optional[Dict[str, Any]] = None
    edit_policy: Optional[str] = None


class EntityCanonicalRead(BaseModel):
    """Response schema for EntityCanonical."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    infospace_id: int
    graph_id: Optional[int] = None
    canonical_name: str
    entity_type: str
    aliases: List[str] = []
    embedding_384: Optional[List[float]] = None
    embedding_512: Optional[List[float]] = None
    embedding_768: Optional[List[float]] = None
    embedding_1024: Optional[List[float]] = None
    embedding_1536: Optional[List[float]] = None
    properties: Dict[str, Any] = {}
    provenance_type: str = "method"
    created_at: datetime
    updated_at: datetime


class EntityCanonicalCreate(BaseModel):
    """Request schema for creating an EntityCanonical."""

    canonical_name: str
    entity_type: str
    aliases: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None
    graph_id: Optional[int] = None


class EntityCanonicalUpdate(BaseModel):
    """Request schema for updating an EntityCanonical."""

    canonical_name: Optional[str] = None
    aliases: Optional[List[str]] = None
    properties: Optional[Dict[str, Any]] = None


class EntityEditLogRead(BaseModel):
    """Response schema for EntityEditLog (audit entries)."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    entity_canonical_id: int
    action: str
    performed_by: str
    previous_state: Dict[str, Any] = {}
    timestamp: datetime


class FragmentCurationRead(BaseModel):
    """Response schema for FragmentCuration."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    annotation_id: int
    fragment_path: str
    status: str = "curated"
    subject_entity_id: Optional[int] = None
    object_entity_id: Optional[int] = None
    entity_canonical_id: Optional[int] = None
    source_asset_superseded: bool = False
    source_run_id: Optional[int] = None
    curated_by: Optional[int] = None
    curated_at: datetime


class MergeEntitiesRequest(BaseModel):
    """Request schema for merging entities."""

    entity_ids: List[int]
    canonical_name: Optional[str] = None
    keep_id: Optional[int] = None


class RawEntityItem(BaseModel):
    """Single raw entity for resolution."""

    name: str
    type: str


class ResolveEntitiesRequest(BaseModel):
    """Request schema for triggering entity resolution."""

    raw_entities: List[RawEntityItem]
    similarity_threshold: float = 0.85
    use_embeddings: bool = True


class EntityMergeHint(BaseModel):
    """A merge group from the run-scoped graph panel: names that should resolve to `keep`."""

    keep: str
    names: List[str]
    type: Optional[str] = None


class CurateFragmentsRequest(BaseModel):
    """Request schema for curating annotation fragments into the knowledge graph."""

    fragment_paths: List[str]
    graph_id: Optional[int] = None
    entity_merges: Optional[List[EntityMergeHint]] = None
    status: str = "curated"


# ── Deduplication ────────────────────────────────────────────────────────────


class FindDuplicatesRequest(BaseModel):
    """Request: find potential duplicates in a list of strings via embedding similarity."""

    items: List[str]
    threshold: float = 0.85


class SimilarPairRead(BaseModel):
    """A pair of items whose similarity meets the threshold."""

    a_index: int
    b_index: int
    a_item: str
    b_item: str
    similarity: float


class FindDuplicatesResponse(BaseModel):
    """Response from the deduplication endpoint."""

    pairs: List[SimilarPairRead]
    items_count: int
    unique_count: int
