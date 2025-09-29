"""API Schemas for OSINT Kernel (schemas.py)
================================================
Pure‑API pydantic/SQLModel classes for FastAPI endpoints, matching the canonical OSINT Kernel models.
Includes:
  • CRUD schemas for all core entities (Infospace, Source, Asset, Bundle, Schema, Run, Annotation, Task, Package, ShareableLink)
  • Utility/summary schemas (e.g., DatasetPackageSummary)
  • Hide internal columns, add validators, computed helpers, and split create/read/update payloads.
"""

from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Optional, Literal, Union, Set
from dataclasses import dataclass

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
    created_at: datetime
    updated_at: datetime

class UserPublicProfile(SQLModel):
    """Public user profile (no sensitive information)."""
    id: int
    full_name: Optional[str] = None
    profile_picture_url: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None
    created_at: datetime

class UsersOut(SQLModel):
    data: List[UserOut]
    count: int

class UserCreate(UserBase):
    password: str
    is_superuser: bool = False
    is_active: bool = True
    # Control whether to send a welcome email on admin/user creation
    send_welcome_email: bool = True

class UserCreateOpen(SQLModel):
    email: str
    password: str
    full_name: Optional[str] = None
    profile_picture_url: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None

class UserUpdate(SQLModel):
    full_name: Optional[str] = None
    email: Optional[str] = None
    password: Optional[str] = None
    is_active: Optional[bool] = None
    tier: Optional[UserTier] = None
    profile_picture_url: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None

class UserUpdateMe(SQLModel):
    full_name: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = None
    profile_picture_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=500, description="Short bio (max 500 characters)")
    description: Optional[str] = Field(None, max_length=2000, description="Longer description (max 2000 characters)")

class UserProfileUpdate(SQLModel):
    """Dedicated schema for profile-only updates (no email/password)."""
    full_name: Optional[str] = Field(None, max_length=100)
    profile_picture_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=500, description="Short bio (max 500 characters)")
    description: Optional[str] = Field(None, max_length=2000, description="Longer description (max 2000 characters)")

class UserProfileStats(SQLModel):
    """User profile statistics."""
    user_id: int
    infospaces_count: int
    assets_count: int
    annotations_count: int
    member_since: datetime

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

@dataclass
class SearchResult:
    """Standardized search result with enhanced metadata."""
    title: str
    url: str
    content: str
    score: Optional[float] = None
    provider: str = "unknown"
    raw_data: Optional[Dict[str, Any]] = None
    
    def __post_init__(self):
        self.content_hash = self._generate_content_hash()
        self.domain = self._extract_domain()
    
    def _generate_content_hash(self) -> str:
        import hashlib
        from urllib.parse import urlparse
        content_for_hash = f"{self.title}|{self.url}|{self.content[:500]}"
        return hashlib.md5(content_for_hash.encode()).hexdigest()
    
    def _extract_domain(self) -> str:
        from urllib.parse import urlparse
        try:
            return urlparse(self.url).netloc
        except Exception:
            return "unknown"

class SearchFilter:
    """Configuration for filtering search results."""
    
    def __init__(self):
        self.allowed_domains: Optional[Set[str]] = None
        self.blocked_domains: Optional[Set[str]] = None
        self.required_keywords: Optional[List[str]] = None
        self.blocked_keywords: Optional[List[str]] = None
        self.min_content_length: Optional[int] = None
        self.max_content_length: Optional[int] = None
        self.min_score: Optional[float] = None
        self.url_patterns: Optional[List[str]] = None  # Regex patterns for URLs
        self.content_patterns: Optional[List[str]] = None  # Regex patterns for content
        
    def matches(self, result: SearchResult) -> bool:
        """Check if a search result matches the filter criteria."""
        # Domain filtering
        if self.allowed_domains and result.domain not in self.allowed_domains:
            return False
        if self.blocked_domains and result.domain in self.blocked_domains:
            return False
            
        # Keyword filtering
        if self.required_keywords:
            content_lower = f"{result.title} {result.content}".lower()
            if not any(keyword.lower() in content_lower for keyword in self.required_keywords):
                return False
                
        if self.blocked_keywords:
            content_lower = f"{result.title} {result.content}".lower()
            if any(keyword.lower() in content_lower for keyword in self.blocked_keywords):
                return False
                
        # Content length filtering
        if self.min_content_length and len(result.content) < self.min_content_length:
            return False
        if self.max_content_length and len(result.content) > self.max_content_length:
            return False
            
        # Score filtering
        if self.min_score and (result.score is None or result.score < self.min_score):
            return False
            
        # URL pattern filtering
        if self.url_patterns:
            import re
            if not any(re.search(pattern, result.url) for pattern in self.url_patterns):
                return False
                
        # Content pattern filtering
        if self.content_patterns:
            import re
            content_text = f"{result.title} {result.content}"
            if not any(re.search(pattern, content_text, re.IGNORECASE) for pattern in self.content_patterns):
                return False
                
        return True

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


# ─────────────────────────────────────────────── Task ──── #

class TaskBase(SQLModel):
    name: str
    type: TaskType
    schedule: str
    configuration: Dict[str, Any] = {}

class TaskCreate(TaskBase):
    source_id: Optional[int] = None

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
    is_enabled: bool
    last_run_at: Optional[datetime]
    consecutive_failure_count: int


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
    monitoring_tasks: List[TaskRead] = []

    @computed_field  # type: ignore[misc]
    @property
    def is_monitored(self) -> bool:
        """True if the source has any enabled monitoring tasks."""
        if not self.monitoring_tasks:
            return False
        return any(task.is_enabled for task in self.monitoring_tasks)


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

# Monitoring source configurations are documented in 
# backend/app/api/docs/MONITORING_ARCHITECTURE.md

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
    fragments: Optional[Dict[str, Any]] = None
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
    views_config: Optional[List[Dict[str, Any]]] = None

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
    views_config: Optional[List[Dict[str, Any]]] = None

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

class AnnotationRetryRequest(SQLModel):
    """Request payload for retrying a single annotation with optional custom prompt."""
    custom_prompt: Optional[str] = Field(
        default=None, 
        description="Optional additional guidance or prompt override for this specific retry"
    )

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

# --- New Models for Monitor ---
class MonitorBase(SQLModel):
    name: str
    description: Optional[str] = None
    schedule: str # Cron schedule
    target_bundle_ids: List[int]
    target_schema_ids: List[int]
    run_config_override: Optional[Dict[str, Any]] = {}

class MonitorCreate(MonitorBase):
    pass

class MonitorUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    schedule: Optional[str] = None
    target_bundle_ids: Optional[List[int]] = None
    target_schema_ids: Optional[List[int]] = None
    run_config_override: Optional[Dict[str, Any]] = None
    status: Optional[str] = None

class MonitorRead(MonitorBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    linked_task_id: int
    status: str
    last_checked_at: Optional[datetime] = None

# --- New Models for Pipeline ---

class PipelineStepBase(SQLModel):
    name: str
    step_order: int
    step_type: str = Field(description="Type of step: ANNOTATE, FILTER, ANALYZE, BUNDLE")
    configuration: Dict[str, Any] = Field(description="Configuration for the step")
    input_source: Dict[str, Any] = Field(description="Source of input for this step")

class PipelineStepCreate(PipelineStepBase):
    pass

class PipelineStepRead(PipelineStepBase):
    id: int
    pipeline_id: int

class IntelligencePipelineBase(SQLModel):
    name: str
    description: Optional[str] = None
    source_bundle_ids: List[int]

class IntelligencePipelineCreate(IntelligencePipelineBase):
    steps: List[PipelineStepCreate]

class IntelligencePipelineUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    source_bundle_ids: Optional[List[int]] = None
    steps: Optional[List[PipelineStepCreate]] = None

class IntelligencePipelineRead(IntelligencePipelineBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    linked_task_id: Optional[int]
    steps: List[PipelineStepRead]

class SourceCreateRequest(SourceBase):
    enable_monitoring: bool = False
    schedule: Optional[str] = None  # cron schedule
    target_bundle_id: Optional[int] = None
    target_bundle_name: Optional[str] = None

class PipelineExecutionRead(SQLModel):
    id: int
    pipeline_id: int
    status: str
    trigger_type: str
    started_at: datetime
    completed_at: Optional[datetime]
    triggering_asset_ids: Optional[List[int]]

# --- End New Models for Pipeline ---

# --- End New Models for Monitor ---

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
    assets: List[AssetPreview]

class AnnotationRunPreview(SQLModel):
    """Preview model for shared annotation runs."""
    id: int
    uuid: str
    name: str
    description: Optional[str] = None
    status: RunStatus
    created_at: datetime
    updated_at: datetime
    completed_at: Optional[datetime] = None
    views_config: Optional[List[Dict[str, Any]]] = None
    configuration: Dict[str, Any] = {}
    annotation_count: int = 0
    target_schemas: List[Dict[str, Any]] = []  # Schema summaries
    annotations: List[Dict[str, Any]] = []  # Annotation results

class SharedResourcePreview(SQLModel):
    """The complete public-facing model for a shared resource view."""
    resource_type: ResourceType
    name: str
    description: Optional[str] = None
    content: Union[AssetPreview, BundlePreview, AnnotationRunPreview]

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

# ─────────────────────────────────────────────────────────── Backup Schemas ──── #

class InfospaceBackupBase(SQLModel):
    name: str
    description: Optional[str] = None
    expires_at: Optional[datetime] = None

class InfospaceBackupCreate(InfospaceBackupBase):
    backup_type: Optional[str] = "manual"  # BackupType enum as string
    include_sources: bool = True
    include_schemas: bool = True
    include_runs: bool = True
    include_datasets: bool = True
    include_annotations: bool = True

class InfospaceBackupUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_shareable: Optional[bool] = None
    expires_at: Optional[datetime] = None

class InfospaceBackupRead(InfospaceBackupBase):
    id: int
    uuid: str
    infospace_id: int
    user_id: int
    backup_type: str
    storage_path: str
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None
    included_sources: int = 0
    included_assets: int = 0
    included_schemas: int = 0
    included_runs: int = 0
    included_datasets: int = 0
    status: str  # BackupStatus enum as string
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    is_shareable: bool = False
    share_token: Optional[str] = None

    @computed_field  # type: ignore[misc]
    @property
    def is_expired(self) -> bool:
        """Check if backup has expired."""
        if not self.expires_at:
            return False
        
        # Handle timezone-naive datetime from database by treating it as UTC
        expires_at = self.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        
        return datetime.now(timezone.utc) > expires_at

    @computed_field  # type: ignore[misc]
    @property
    def is_ready(self) -> bool:
        """Check if backup is ready for use."""
        return self.status == "completed" and not self.is_expired

    @computed_field  # type: ignore[misc]
    @property
    def download_url(self) -> Optional[str]:
        """Generate download URL if backup is shareable."""
        if self.is_shareable and self.share_token:
            return f"/api/v1/backups/download/{self.share_token}"
        return None

class InfospaceBackupsOut(SQLModel):
    data: List[InfospaceBackupRead]
    count: int

class BackupRestoreRequest(SQLModel):
    backup_id: int
    target_infospace_name: Optional[str] = None  # If different from original
    conflict_strategy: str = "skip"  # How to handle conflicts during restore

class BackupShareRequest(SQLModel):
    backup_id: int
    is_shareable: bool = True
    expiration_hours: Optional[int] = None  # Hours until share link expires


# ==================== USER BACKUP SCHEMAS ====================

class UserBackupBase(SQLModel):
    name: str
    description: Optional[str] = None
    backup_type: str = "user"

class UserBackupCreate(UserBackupBase):
    target_user_id: int
    expires_at: Optional[datetime] = None

class UserBackupUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    is_shareable: Optional[bool] = None

class UserBackupRead(UserBackupBase):
    id: int
    uuid: str
    target_user_id: int
    created_by_user_id: int
    backup_type: str
    storage_path: str
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None
    included_infospaces: int = 0
    included_assets: int = 0
    included_schemas: int = 0
    included_runs: int = 0
    included_annotations: int = 0
    included_datasets: int = 0
    status: str
    error_message: Optional[str] = None
    created_at: datetime
    completed_at: Optional[datetime] = None
    is_shareable: bool = False
    share_token: Optional[str] = None
    is_expired: bool
    is_ready: bool

    @computed_field
    @property
    def download_url(self) -> Optional[str]:
        """Generate download URL if shareable."""
        if self.is_shareable and self.share_token:
            return f"/api/v1/user-backups/download/{self.share_token}"
        return None

class UserBackupsOut(SQLModel):
    data: List[UserBackupRead]
    count: int

class UserBackupRestoreRequest(SQLModel):
    backup_id: int
    target_user_email: Optional[str] = None  # If restoring to different user
    conflict_strategy: str = "skip"  # How to handle conflicts during restore

class UserBackupShareRequest(SQLModel):
    backup_id: int
    is_shareable: bool = True
    expiration_hours: Optional[int] = None  # Hours until share link expires


# ─────────────────────────────────────────── Chat & AI Conversation ──── #

class ChatMessage(SQLModel):
    """Individual message in a conversation."""
    role: str  # "system", "user", "assistant"
    content: str

class ChatRequest(SQLModel):
    """Request for intelligence analysis chat."""
    messages: List[ChatMessage]
    model_name: str
    infospace_id: int
    stream: bool = False
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    thinking_enabled: bool = False

class ChatResponse(SQLModel):
    """Response from intelligence analysis chat."""
    content: str
    model_used: str
    usage: Optional[Dict[str, Any]] = None  # Changed from Dict[str, int] to handle complex usage objects
    tool_calls: Optional[List[Dict]] = None
    thinking_trace: Optional[str] = None
    finish_reason: Optional[str] = None

class ToolCallRequest(SQLModel):
    """Request to execute a tool call."""
    tool_name: str
    arguments: Dict[str, Any]
    infospace_id: int

class ModelInfo(SQLModel):
    """Information about a language model."""
    name: str
    provider: str
    description: Optional[str] = None
    supports_structured_output: bool = False
    supports_tools: bool = False
    supports_streaming: bool = False
    supports_thinking: bool = False
    supports_multimodal: bool = False
    max_tokens: Optional[int] = None
    context_length: Optional[int] = None

class ModelListResponse(SQLModel):
    """Response listing available models."""
    models: List[ModelInfo]
    providers: List[str]
