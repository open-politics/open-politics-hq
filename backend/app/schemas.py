"""API Schemas for OSINT Kernel (schemas.py)
================================================
Pure‑API pydantic/SQLModel classes for FastAPI endpoints, matching the canonical OSINT Kernel models.
Includes:
  • CRUD schemas for all core entities (Infospace, Source, Asset, Bundle, Schema, Run, Annotation, Task, Package, ShareableLink)
  • Utility/summary schemas (e.g., DatasetPackageSummary)
  • Hide internal columns, add validators, computed helpers, and split create/read/update payloads.
"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional, Literal, Union

from sqlmodel import SQLModel, Field
from pydantic import computed_field, ConfigDict

from .models import (
    AssetKind,
    UserBase,
    UserTier,
    PermissionLevel,
    ResultStatus,
    RunStatus,
    TaskStatus,
    TaskType,
    ResourceType,
    AnnotationSchemaTargetLevel,
    Modality,
    ProcessingStatus,
)

# ────────────────────────────────────────────── User & Auth ──── #

# New Models for Justification Configuration (moved up to fix forward references)
class FieldJustificationConfig(SQLModel):
    enabled: bool
    custom_prompt: Optional[str] = None

class UserOut(UserBase):
    id: int
    is_active: bool = True
    is_superuser: bool = False

class UsersOut(SQLModel):
    data: List[UserOut]
    count: int

class UserCreate(UserBase):
    password: str
    is_superuser: bool = False
    is_active: bool = True

class UserCreateOpen(SQLModel):
    email: str
    password: str
    full_name: Optional[str] = None

class UserUpdate(SQLModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    tier: Optional[UserTier] = None

class UserUpdateMe(SQLModel):
    full_name: Optional[str] = None
    email: Optional[str] = None

class UpdatePassword(SQLModel):
    current_password: str
    new_password: str

class Token(SQLModel):
    access_token: str
    token_type: str = "bearer"

class TokenPayload(SQLModel):
    sub: Optional[int] = None

class NewPassword(SQLModel):
    token: str
    new_password: str

class Message(SQLModel):
    message: str

# ───────────────────────────────────────────── Infospace ──── #

class InfospaceBase(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None

class InfospaceCreate(InfospaceBase):
    owner_id: int
    # Optional vector‑store overrides
    vector_backend: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_dim: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None
    icon: Optional[str] = None

class InfospaceRead(InfospaceBase):
    id: int
    owner_id: int
    created_at: datetime

class InfospaceUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    vector_backend: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_dim: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None
    icon: Optional[str] = None

class InfospacesOut(SQLModel):
    data: List[InfospaceRead]
    count: int

# ─────────────────────────────────────────────── Source ──── #

class SourceBase(SQLModel):
    name: str
    kind: str
    details: Dict[str, Any] = {}

class SourceCreate(SourceBase):
    pass

class SourceUpdate(SQLModel):
    name: Optional[str] = None
    kind: Optional[str] = None
    details: Optional[Dict[str, Any]] = None

class SourceRead(SourceBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    status: str
    created_at: datetime
    updated_at: datetime
    error_message: Optional[str]
    source_metadata: Optional[Dict[str, Any]] = {}

class SourcesOut(SQLModel):
    data: List[SourceRead]
    count: int

class SourceTransferRequest(SQLModel):
    source_ids: List[int]
    target_infospace_id: int
    target_user_id: int

class SourceTransferResponse(SQLModel):
    message: str
    source_id: int
    infospace_id: int

# ─────────────────────────────────────────────── Asset ──── #

class AssetBase(SQLModel):
    title: Optional[str] = None
    kind: AssetKind

class AssetCreate(AssetBase):
    user_id: Optional[int] = None
    infospace_id: Optional[int] = None
    parent_asset_id: Optional[int] = None
    part_index: Optional[int] = None
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    cells: Optional[Dict[str, Any]] = None
    source_identifier: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None
    event_timestamp: Optional[datetime] = None

class AssetUpdate(SQLModel):
    title: Optional[str] = None
    kind: Optional[AssetKind] = None
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None
    event_timestamp: Optional[datetime] = None

class AssetRead(AssetBase):
    id: int
    uuid: str
    title: str
    parent_asset_id: Optional[int]
    part_index: Optional[int]
    infospace_id: int
    source_id: Optional[int]
    created_at: datetime
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None
    content_hash: Optional[str] = None
    user_id: Optional[int] = None
    updated_at: datetime
    event_timestamp: Optional[datetime] = None
    processing_status: ProcessingStatus = ProcessingStatus.READY
    processing_error: Optional[str] = None

    # Helper flags
    @computed_field  # type: ignore[misc]
    @property
    def is_container(self) -> bool:  
        """True if this asset can have child assets."""
        return self.kind in {
            AssetKind.CSV,
            AssetKind.PDF,
            AssetKind.MBOX,
            AssetKind.WEB,
            AssetKind.ARTICLE,
        }

class AssetsOut(SQLModel):
    data: List[AssetRead]
    count: int

# ─────────────────────────────────────────────── Bundle ──── #

class BundleBase(SQLModel):
    name: str
    description: Optional[str] = None
    tags: Optional[List[str]] = None

class BundleCreate(BundleBase):
    asset_ids: List[int] = []
    purpose: Optional[str] = None
    bundle_metadata: Optional[Dict[str, Any]] = None

class BundleUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    tags: Optional[List[str]] = None
    purpose: Optional[str] = None
    bundle_metadata: Optional[Dict[str, Any]] = None

class BundleRead(BundleBase):
    id: int
    infospace_id: int
    created_at: datetime
    updated_at: datetime
    asset_count: int
    uuid: str
    user_id: int
    purpose: Optional[str] = None
    bundle_metadata: Optional[Dict[str, Any]] = None

# ───────────────────────────────────── Annotation Schema ──── #

class AnnotationSchemaBase(SQLModel):
    name: str
    description: Optional[str] = None
    output_contract: Dict[str, Any]
    instructions: Optional[str] = None
    version: str = "1.0"

class AnnotationSchemaCreate(AnnotationSchemaBase):
    field_specific_justification_configs: Optional[Dict[str, FieldJustificationConfig]] = None

class AnnotationSchemaUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    output_contract: Optional[Dict[str, Any]] = None
    instructions: Optional[str] = None
    version: Optional[str] = None
    field_specific_justification_configs: Optional[Dict[str, FieldJustificationConfig]] = None
    is_active: Optional[bool] = None

class AnnotationSchemaRead(AnnotationSchemaBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime
    field_specific_justification_configs: Optional[Dict[str, FieldJustificationConfig]] = None
    annotation_count: Optional[int] = None
    is_active: bool

class AnnotationSchemasOut(SQLModel):
    data: List[AnnotationSchemaRead]
    count: int

# ───────────────────────────────────── Annotation Run ──── #

class AnnotationRunBase(SQLModel):
    name: str
    description: Optional[str] = None
    configuration: Dict[str, Any] = {}
    include_parent_context: bool = False
    context_window: int = 0

class AnnotationRunCreate(AnnotationRunBase):
    schema_ids: List[int]
    target_asset_ids: Optional[List[int]] = None
    target_bundle_id: Optional[int] = None

class AnnotationRunUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    configuration: Optional[Dict[str, Any]] = None
    include_parent_context: Optional[bool] = None
    context_window: Optional[int] = None

class AnnotationRunRead(AnnotationRunBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    started_at: Optional[datetime]
    completed_at: Optional[datetime]
    error_message: Optional[str]
    annotation_count: Optional[int] = None
    schema_ids: Optional[List[int]] = None

class AnnotationRunsOut(SQLModel):
    data: List[AnnotationRunRead]
    count: int

# ───────────────────────────────────── Annotation Result ──── #

class AnnotationBase(SQLModel):
    value: Dict[str, Any]
    status: ResultStatus = ResultStatus.SUCCESS
    event_timestamp: Optional[datetime] = None
    region: Optional[Dict[str, Any]] = None
    links: Optional[List[Dict[str, Any]]] = None

class AnnotationCreate(AnnotationBase):
    asset_id: int
    schema_id: int
    run_id: int

class AnnotationUpdate(SQLModel):
    value: Optional[Dict[str, Any]] = None
    status: Optional[ResultStatus] = None
    event_timestamp: Optional[datetime] = None
    region: Optional[Dict[str, Any]] = None
    links: Optional[List[Dict[str, Any]]] = None

class AnnotationRead(AnnotationBase):
    id: int
    uuid: str
    asset_id: int
    schema_id: int
    run_id: int
    infospace_id: int
    user_id: int
    timestamp: datetime
    created_at: datetime
    updated_at: datetime

class AnnotationsOut(SQLModel):
    data: List[AnnotationRead]
    count: int

# ───────────────────────────────────── Justification ──── #

class JustificationBase(SQLModel):
    field_name: Optional[str] = None
    reasoning: Optional[str] = None
    evidence_payload: Optional[Dict[str, Any]] = {}
    model_name: Optional[str] = None
    score: Optional[float] = None

class JustificationCreate(JustificationBase):
    annotation_id: int

class JustificationRead(JustificationBase):
    id: int
    annotation_id: int
    created_at: datetime

# ─────────────────────────────────────────────── Task ──── #

class TaskBase(SQLModel):
    name: str
    type: TaskType
    schedule: str
    configuration: Dict[str, Any] = {}

class TaskCreate(TaskBase):
    pass

class TaskUpdate(SQLModel):
    name: Optional[str] = None
    type: Optional[TaskType] = None
    schedule: Optional[str] = None
    configuration: Optional[Dict[str, Any]] = None
    status: Optional[TaskStatus] = None
    is_enabled: Optional[bool] = None

class TaskRead(TaskBase):
    id: int
    infospace_id: int
    status: TaskStatus
    last_run_at: Optional[datetime]
    consecutive_failure_count: int

# ─────────────────────────────────────── Search Tasks ──── #

# ───────────────────────────────────────────── Package ──── #

class PackageBase(SQLModel):
    name: str
    description: Optional[str] = None

class PackageCreate(PackageBase):
    asset_ids: List[int] = []
    schema_ids: List[int] = []
    run_ids: List[int] = []

class PackageRead(PackageBase):
    id: int
    infospace_id: int
    created_at: datetime

class CreatePackageFromRunRequest(SQLModel):
    name: str
    description: Optional[str] = None

# ───────────────────────────────────── Shareable Links ──── #

class ShareableLinkBase(SQLModel):
    name: Optional[str] = None
    permission_level: PermissionLevel = PermissionLevel.READ_ONLY
    is_public: bool = False
    expiration_date: Optional[datetime] = None
    max_uses: Optional[int] = None

class ShareableLinkCreate(ShareableLinkBase):
    resource_type: ResourceType
    resource_id: int

class ShareableLinkUpdate(SQLModel):
    name: Optional[str] = None
    permission_level: Optional[PermissionLevel] = None
    is_public: Optional[bool] = None
    expiration_date: Optional[datetime] = None
    max_uses: Optional[int] = None

class ShareableLinkRead(ShareableLinkBase):
    id: int
    token: str
    user_id: int
    resource_type: ResourceType
    resource_id: int
    use_count: int
    created_at: datetime
    infospace_id: Optional[int] = None

    @computed_field  # type: ignore[misc]
    @property
    def share_url(self) -> str:  # noqa: D401
        return f"/share/{self.token}"

class ShareableLinkStats(SQLModel):
    total_links: int
    active_links: int
    expired_links: int
    links_by_resource_type: Dict[str, int]
    most_shared_resources: List[Dict[str, Any]]
    most_used_links: List[Dict[str, Any]]

# ──────────────────────────────────────── Search History ──── #

class SearchHistoryBase(SQLModel):
    query: str
    filters: Optional[Dict[str, Any]] = None
    result_count: Optional[int] = None

class SearchHistoryCreate(SearchHistoryBase):
    pass

class SearchHistoryRead(SearchHistoryBase):
    id: int
    user_id: int
    timestamp: datetime

SearchHistoryOut = SearchHistoryRead # Alias for route consistency

class SearchHistoriesOut(SQLModel):
    data: List[SearchHistoryRead]
    count: int

class TasksOut(SQLModel): # For listing multiple tasks
    data: List[TaskRead]
    count: int

# --- New Models for Provider Discovery ---
class ProviderModel(SQLModel):
    name: str
    description: Optional[str] = None
    # Add other metadata like context window size, etc. in the future

class ProviderInfo(SQLModel):
    provider_name: str
    models: List[ProviderModel]

class ProviderListResponse(SQLModel):
    providers: List[ProviderInfo]

# ================================================================================================
# CHUNKING SCHEMAS
# ================================================================================================

class ChunkAssetRequest(SQLModel):
    strategy: str = "token"
    chunk_size: int = 512
    chunk_overlap: int = 50
    overwrite_existing: bool = False

class ChunkAssetsRequest(SQLModel):
    asset_ids: Optional[List[int]] = None
    asset_kinds: Optional[List[str]] = None  # String representation of AssetKind
    infospace_id: Optional[int] = None
    strategy: str = "token"
    chunk_size: int = 512
    chunk_overlap: int = 50
    overwrite_existing: bool = False

class ChunkingResultResponse(SQLModel):
    message: str
    asset_id: int
    chunks_created: int
    strategy_used: str
    strategy_params: Dict[str, Any]

class ChunkingStatsResponse(SQLModel):
    total_chunks: int
    total_characters: Optional[int] = 0
    average_chunk_size: Optional[float] = 0.0
    assets_with_chunks: Optional[int] = 0
    strategies_used: Optional[Dict[str, int]] = {}

class AssetChunkBase(SQLModel):
    asset_id: int
    chunk_index: int
    text_content: str
    chunk_metadata: Optional[Dict[str, Any]] = {}

class AssetChunkRead(AssetChunkBase):
    id: int
    created_at: datetime

# ================================================================================================
# EMBEDDING SCHEMAS
# ================================================================================================

class EmbeddingModelBase(SQLModel):
    name: str
    provider: str  # Using str instead of enum for flexibility
    dimension: int
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = {}
    max_sequence_length: Optional[int] = None

class EmbeddingModelCreate(EmbeddingModelBase):
    pass

class EmbeddingModelRead(EmbeddingModelBase):
    id: int
    is_active: bool
    created_at: datetime
    updated_at: datetime
    embedding_time_ms: Optional[float] = None

class EmbeddingGenerateRequest(SQLModel):
    chunk_ids: List[int]
    model_name: str
    provider: str

class EmbeddingSearchRequest(SQLModel):
    query_text: str
    model_name: str
    provider: str
    limit: int = 10
    distance_threshold: float = 1.0
    distance_function: str = "cosine"  # cosine, l2, inner_product

class EmbeddingSearchResult(SQLModel):
    chunk_id: int
    asset_id: int
    text_content: Optional[str]
    distance: float
    similarity: Optional[float] = None

class EmbeddingSearchResponse(SQLModel):
    query_text: str
    results: List[EmbeddingSearchResult]
    model_name: str
    distance_function: str

class EmbeddingStatsResponse(SQLModel):
    model_id: int
    model_name: str
    provider: str
    dimension: int
    embedding_count: int
    table_size: str
    avg_embedding_time_ms: Optional[float] = None
# --- End of New Models ---

# ─────────────────────────────────────────── Pagination ──── #

class Paginated(SQLModel):
    data: List[Any]
    count: int

# DatasetPackageSummary and related utility models
class DatasetPackageFileManifestItem(SQLModel):
    filename: str
    original_collection_uuid: Optional[str] = None
    original_collection_id: Optional[int] = None
    type: Optional[str] = None
    linked_asset_uuid: Optional[str] = None

class DatasetPackageEntitySummary(SQLModel):
    entity_uuid: Optional[str] = None
    name: Optional[str] = None
    description: Optional[str] = None

class DatasetPackageSummary(SQLModel):
    package_metadata: Dict[str, Any]
    dataset_details: DatasetPackageEntitySummary
    record_count: int = 0
    annotation_results_count: int = 0
    included_schemas: List[DatasetPackageEntitySummary] = []
    included_runs: List[DatasetPackageEntitySummary] = []
    linked_collections_summary: List[DatasetPackageEntitySummary] = []
    source_files_manifest: List[DatasetPackageFileManifestItem] = []

# ───────────────────────────────────────────── Dataset ──── #

class DatasetBase(SQLModel):
    name: str
    description: Optional[str] = None

class DatasetCreate(DatasetBase):
    asset_ids: List[int] = []

class DatasetUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    asset_ids: Optional[List[int]] = None

class DatasetRead(DatasetBase):
    id: int
    infospace_id: int
    asset_ids: Optional[List[int]] = None
    created_at: datetime
    entity_uuid: str
    user_id: int
    updated_at: datetime

# Paginated wrapper for datasets
class DatasetsOut(SQLModel):
    data: List[DatasetRead]
    count: int

# --- Pre-configured Types for Evidence Payloads --- #
class BoundingBox(SQLModel):
    x: float # Normalized coordinate (0.0 to 1.0)
    y: float # Normalized coordinate (0.0 to 1.0)
    width: float # Normalized (0.0 to 1.0)
    height: float # Normalized (0.0 to 1.0)
    label: Optional[str] = None # Optional label for the box itself

class TextSpanEvidence(SQLModel):
    asset_uuid: Optional[str] = None # UUID of the asset (e.g., parent or a specific child PDF page)
    start_char_offset: int
    end_char_offset: int
    text_snippet: str # The actual referenced text

class ImageRegionEvidence(SQLModel):
    asset_uuid: str # UUID of the specific image Asset
    bounding_box: BoundingBox

class AudioSegmentEvidence(SQLModel):
    asset_uuid: str # UUID of the specific audio Asset
    start_time_seconds: float
    end_time_seconds: float

# --- Updated JustificationSubModel --- #
class JustificationSubModel(SQLModel):
    reasoning: Optional[str] = None
    # Specific evidence types
    text_spans: Optional[List[TextSpanEvidence]] = None
    image_regions: Optional[List[ImageRegionEvidence]] = None
    audio_segments: Optional[List[AudioSegmentEvidence]] = None
    # Fallback for any other structured evidence or less common types
    additional_evidence: Optional[Dict[str, Any]] = Field(default_factory=dict)
    # evidence_payload: Optional[Dict[str, Any]] = Field(default_factory=dict) # Deprecated in favor of specific types

# End of new models

# ────────────────────────────────────────── Public Sharing Previews ──── #

class AssetPreview(SQLModel):
    """A lightweight public representation of an Asset."""
    id: int
    title: str
    kind: AssetKind
    created_at: datetime
    updated_at: datetime
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = None
    children: List["AssetPreview"] = []
    
    @computed_field
    @property
    def is_container(self) -> bool:
        """Helper to know if this asset might have children (e.g., PDF, CSV)."""
        return self.kind in {
            AssetKind.CSV,
            AssetKind.PDF,
            AssetKind.MBOX,
            AssetKind.WEB,
            AssetKind.ARTICLE,
        }

class BundlePreview(SQLModel):
    """A lightweight public representation of a Bundle."""
    id: int
    name: str
    description: Optional[str] = None
    created_at: datetime
    updated_at: datetime
    assets: List[AssetPreview] = []

class SharedResourcePreview(SQLModel):
    """The complete public-facing model for a shared resource view."""
    resource_type: ResourceType
    name: str
    description: Optional[str] = None
    content: Union[AssetPreview, BundlePreview]

# ───────────────────────────────────── Analysis Adapters ──── #
class AnalysisAdapterBase(SQLModel):
    name: str
    description: Optional[str] = None
    input_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict)
    output_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict)
    version: str = "1.0"
    module_path: Optional[str] = None
    adapter_type: str
    is_public: bool = False

class AnalysisAdapterCreate(AnalysisAdapterBase):
    pass

class AnalysisAdapterUpdate(SQLModel):
    description: Optional[str] = None
    input_schema_definition: Optional[Dict[str, Any]] = None
    output_schema_definition: Optional[Dict[str, Any]] = None
    version: Optional[str] = None
    module_path: Optional[str] = None
    adapter_type: Optional[str] = None
    is_active: Optional[bool] = None
    is_public: Optional[bool] = None

class AnalysisAdapterRead(AnalysisAdapterBase):
    id: int
    is_active: bool
    creator_user_id: Optional[int] = None
    created_at: datetime
    updated_at: datetime
