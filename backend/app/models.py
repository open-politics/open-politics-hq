""" Core Models
=================================================
"""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import (
    ARRAY,
    Column,
    DateTime,
    Enum as PgEnum,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector


class UserTier(str, enum.Enum):
    TIER_0 = "tier_0"
    FREE = "free"
    PRO = "pro"
    TIER_1 = "tier_1"
    ENTERPRISE = "enterprise"

class UserBase(SQLModel):
    email: str
    full_name: Optional[str] = None
    tier: UserTier = UserTier.TIER_0
    profile_picture_url: Optional[str] = None
    bio: Optional[str] = None
    description: Optional[str] = None

# ─────────────────────────────────────────────────────────────── Enums ──── #

class Modality(str, enum.Enum):
    TEXT = "text"
    IMAGE = "image"
    AUDIO = "audio"
    VIDEO = "video"


class AssetKind(str, enum.Enum):
    PDF = "pdf"
    WEB = "web"
    IMAGE = "image"
    VIDEO = "video"
    AUDIO = "audio"
    TEXT = "text"
    CSV = "csv"
    CSV_ROW = "csv_row"
    MBOX = "mbox"
    EMAIL = "email"
    PDF_PAGE = "pdf_page"
    TEXT_CHUNK = "text_chunk"
    IMAGE_REGION = "image_region"
    VIDEO_SCENE = "video_scene"
    AUDIO_SEGMENT = "audio_segment"
    ARTICLE = "article"
    RSS_FEED = "rss_feed"  # RSS feed container (parent of article children)
    FILE = "file"


class RunStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    COMPLETED_WITH_ERRORS = "completed_with_errors"


class ResultStatus(str, enum.Enum):
    SUCCESS = "success"
    FAILED = "failed"


class TaskType(str, enum.Enum):
    INGEST = "ingest"
    ANNOTATE = "annotate"
    PIPELINE = "pipeline"
    MONITOR = "monitor"


class TaskStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"


class PermissionLevel(str, enum.Enum):
    READ_ONLY = "read_only"
    EDIT = "edit"
    FULL_ACCESS = "full_access"


class ResourceType(str, enum.Enum):
    SOURCE = "source"
    BUNDLE = "bundle"
    ASSET = "asset"
    SCHEMA = "schema"
    INFOSPACE = "infospace"
    RUN = "run"
    PACKAGE = "package"
    DATASET = "dataset"
    MIXED = "mixed"


class BackupType(str, enum.Enum):
    MANUAL = "manual"
    AUTO = "auto"
    SYSTEM = "system"


class BackupStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class PipelineStepType(str, enum.Enum):
    ANNOTATE = "ANNOTATE"
    FILTER = "FILTER"
    ANALYZE = "ANALYZE"
    ROUTE = "ROUTE"
    CURATE = "CURATE"
    BUNDLE = "BUNDLE"

class SourceType(str, enum.Enum):
    """Auto-detected source types based on locator patterns."""
    RSS_FEED = "rss_feed"
    DIRECT_FILE = "direct_file"
    WEB_PAGE = "web_page"
    SEARCH_QUERY = "search_query"
    URL_LIST = "url_list"
    SITE_DISCOVERY = "site_discovery"
    FILE_UPLOAD = "file_upload"
    TEXT_CONTENT = "text_content"

class SourceStatus(str, enum.Enum):
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"


class ProcessingStatus(str, enum.Enum):
    """Status for asset processing (creating child assets)."""
    READY = "ready"           # No processing needed or completed
    PENDING = "pending"       # Waiting to be processed
    PROCESSING = "processing" # Currently being processed
    FAILED = "failed"         # Processing failed


class AnnotationSchemaTargetLevel(str, enum.Enum):
    """Defines the target level for an AnnotationSchema."""
    ASSET = "asset"
    CHILD = "child"
    BOTH = "both"


class EmbeddingProvider(str, enum.Enum):
    OLLAMA = "ollama"
    JINA = "jina"
    OPENAI = "openai"  # For future use
    HUGGINGFACE = "huggingface"  # For future use


# ─────────────────────────────────────────────────────────── Core Access ──── #

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False
    full_name: Optional[str] = None
    
    # Profile fields
    profile_picture_url: Optional[str] = Field(default=None)
    bio: Optional[str] = Field(default=None, max_length=500)  # Short bio
    description: Optional[str] = Field(default=None, sa_column=Column(Text))  # Longer description
    
    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # Email verification fields
    email_verified: bool = Field(default=False)
    email_verification_token: Optional[str] = Field(default=None, index=True)
    email_verification_sent_at: Optional[datetime] = Field(default=None)
    email_verification_expires_at: Optional[datetime] = Field(default=None)

    infospaces: List["Infospace"] = Relationship(back_populates="owner")
    datasets: List["Dataset"] = Relationship(back_populates="user")
    assets: List["Asset"] = Relationship(back_populates="user")
    bundles: List["Bundle"] = Relationship(back_populates="user")
    shareable_links: List["ShareableLink"] = Relationship(back_populates="user")
    schemas: List["AnnotationSchema"] = Relationship(back_populates="user")
    runs: List["AnnotationRun"] = Relationship(back_populates="user")
    annotations: List["Annotation"] = Relationship(back_populates="user")
    sources: List["Source"] = Relationship(back_populates="user")
    tasks: List["Task"] = Relationship(back_populates="user")
    analysis_adapters_created: List["AnalysisAdapter"] = Relationship(back_populates="creator")
    created_backups: List["InfospaceBackup"] = Relationship(back_populates="user")
    user_backups: List["UserBackup"] = Relationship(
        back_populates="target_user",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.target_user_id]"}
    )
    created_user_backups: List["UserBackup"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.created_by_user_id]"}
    )
    monitors: List["Monitor"] = Relationship(back_populates="user")


class Infospace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    icon: Optional[str] = None

    # Vector preferences (override the global defaults)
    vector_backend: Optional[str] = Field(default="pgvector")
    embedding_model: Optional[str] = Field(default=None)  # None = embeddings disabled
    embedding_dim: Optional[int] = Field(default=None)
    chunk_size: Optional[int] = Field(default=512)
    chunk_overlap: Optional[int] = Field(default=50)
    chunk_strategy: Optional[str] = Field(default="token")

    owner_id: int = Field(foreign_key="user.id")
    owner: Optional[User] = Relationship(back_populates="infospaces")

    sources: List["Source"] = Relationship(back_populates="infospace")
    bundles: List["Bundle"] = Relationship(back_populates="infospace")
    schemas: List["AnnotationSchema"] = Relationship(back_populates="infospace")
    runs: List["AnnotationRun"] = Relationship(back_populates="infospace")
    tasks: List["Task"] = Relationship(back_populates="infospace")
    packages: List["Package"] = Relationship(back_populates="infospace")
    datasets: List["Dataset"] = Relationship(back_populates="infospace")
    assets: List["Asset"] = Relationship(back_populates="infospace")
    annotations: List["Annotation"] = Relationship(back_populates="infospace")
    shareable_links: List["ShareableLink"] = Relationship(back_populates="infospace")
    backups: List["InfospaceBackup"] = Relationship(back_populates="infospace")
    monitors: List["Monitor"] = Relationship(back_populates="infospace")

# ─────────────────────────────────────────────────────────────── Bundles ──── #

class MonitorBundleLink(SQLModel, table=True):
    monitor_id: int = Field(foreign_key="monitor.id", primary_key=True)
    bundle_id: int = Field(foreign_key="bundle.id", primary_key=True)

# ─────────────────────────────────────────────────────────────── Sources ──── #

class Source(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    kind: str  # rss, api, scrape, upload, search
    details: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    status: SourceStatus = SourceStatus.PENDING
    source_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    
    infospace: Optional[Infospace] = Relationship(back_populates="sources")
    user: Optional[User] = Relationship(back_populates="sources")

    assets: List["Asset"] = Relationship(back_populates="source")
    monitoring_tasks: List["Task"] = Relationship(back_populates="source")

# ─────────────────────────────────────────────────────────────── Assets ──── #

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    kind: AssetKind
    stub: bool = Field(default=False, index=True)  # True = reference only, False = has content
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = Field(default=None, index=True)
    source_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    content_hash: Optional[str] = Field(default=None, index=True)
    fragments: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSONB))
    
    # Processing status for hierarchical assets (CSV, PDF)
    processing_status: ProcessingStatus = ProcessingStatus.READY
    processing_error: Optional[str] = None
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    # Parent-child relationship
    parent_asset_id: Optional[int] = Field(default=None, foreign_key="asset.id")
    part_index: Optional[int] = Field(default=None, index=True)
    # Version lineage for dynamic content
    previous_asset_id: Optional[int] = Field(default=None, foreign_key="asset.id", index=True)
    parent_asset: Optional["Asset"] = Relationship(
        back_populates="children_assets",
        sa_relationship_kwargs=dict(
            foreign_keys="[Asset.parent_asset_id]",
            remote_side="Asset.id",
        ),
    )
    children_assets: List["Asset"] = Relationship(
        back_populates="parent_asset",
        sa_relationship_kwargs=dict(
            foreign_keys="[Asset.parent_asset_id]",
            cascade="all, delete-orphan"
        )
    )
    # Version lineage relationships
    previous_asset: Optional["Asset"] = Relationship(
        back_populates="next_versions",
        sa_relationship_kwargs=dict(
            foreign_keys="[Asset.previous_asset_id]",
            remote_side="Asset.id",
        ),
    )
    next_versions: List["Asset"] = Relationship(
        back_populates="previous_asset",
        sa_relationship_kwargs=dict(foreign_keys="[Asset.previous_asset_id]")
    )

    # Relationships
    infospace: Optional[Infospace] = Relationship(back_populates="assets")
    user: Optional[User] = Relationship(back_populates="assets")
    source: Optional[Source] = Relationship(back_populates="assets")
    bundle: Optional["Bundle"] = Relationship(back_populates="assets")
    annotations: List["Annotation"] = Relationship(
        back_populates="asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )
    chunks: List["AssetChunk"] = Relationship(
        back_populates="asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"}
    )

    __table_args__ = (
        Index("ix_asset_fragments", "fragments", postgresql_using="gin", postgresql_ops={"fragments": "jsonb_path_ops"}),
    )

    @property
    def is_container(self) -> bool:  
        """Read-only property to check if this asset can have child assets."""
        return self.kind in {
            AssetKind.CSV,
            AssetKind.PDF,
            AssetKind.MBOX,
            AssetKind.WEB,
            AssetKind.ARTICLE,
        }


# ──────────────────────────────────────────────────── Embedding Models ──── #

class EmbeddingModel(SQLModel, table=True):
    """Registry of available embedding models with their specifications."""
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)  # e.g., "all-MiniLM-L6-v2", "llama2:7b"
    provider: EmbeddingProvider
    dimension: int  # Embedding dimension (384, 768, 1024, 4096, etc.)
    description: Optional[str] = None
    
    # Provider-specific configuration
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    
    # Model metadata
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # Performance characteristics
    max_sequence_length: Optional[int] = None  # Maximum input length
    embedding_time_ms: Optional[float] = None  # Average embedding time in milliseconds
    
    chunks: List["AssetChunk"] = Relationship(back_populates="embedding_model")

    __table_args__ = (
        UniqueConstraint("name", "provider"),
        Index("ix_embeddingmodel_provider_active", "provider", "is_active"),
    )


# ───────────────────────────────────────────────────── Analysis Adapters ──── #

class AnalysisAdapter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    description: Optional[str] = None

    # JSON Schema definitions for input/output contracts
    input_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    output_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))

    version: str = Field(default="1.0")
    module_path: Optional[str] = None  # e.g. "app.api.analysis.adapters.time_series_adapter.TimeSeriesAggregationAdapter"
    adapter_type: str  # free-form type descriptor ("timeseries", "distribution", "graph", etc.)
    is_active: bool = Field(default=True, index=True)
    is_public: bool = Field(default=False)

    creator_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    # Relationships
    creator: Optional[User] = Relationship(back_populates="analysis_adapters_created")

    __table_args__ = (
        UniqueConstraint("name", "version"),
    )

# ──────────────────────────────────────────────────────── Asset Chunks ──── #

class AssetChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="asset.id")
    chunk_index: int  # Order of the chunk within the asset
    
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_reference: Optional[str] = None # For non-text chunks, e.g., image region coordinates as JSON string or path
    
    # UPDATED: Variable dimension embedding support
    embedding_model_id: Optional[int] = Field(default=None, foreign_key="embeddingmodel.id")
    # Embedding stored as JSON array for variable dimensions
    # We'll use separate model-specific tables for efficient vector operations
    embedding_json: Optional[List[float]] = Field(default=None, sa_column=Column(JSON))
    
    # Keep old embedding column for backward compatibility (will be deprecated)
    embedding_legacy: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1024)))
    
    chunk_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    asset: "Asset" = Relationship(back_populates="chunks")
    embedding_model: Optional[EmbeddingModel] = Relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("asset_id", "chunk_index"),
        Index("ix_assetchunk_embedding_model", "embedding_model_id"),
        Index("ix_assetchunk_embedding_legacy", "embedding_legacy", postgresql_using="ivfflat", postgresql_with={"lists": 100}),
    )


# ─────────────────────────────────────────────────────────────── Bundles ──── #

class Bundle(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    purpose: Optional[str] = None
    bundle_metadata: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    asset_count: Optional[int] = Field(default=0)
    version: str = Field(default="1.0")
    
    # Nested bundle support
    parent_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)
    child_bundle_count: Optional[int] = Field(default=0)
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # Relationships
    infospace: Optional[Infospace] = Relationship(back_populates="bundles")
    user: Optional[User] = Relationship(back_populates="bundles")
    assets: List["Asset"] = Relationship(back_populates="bundle")
    monitors: List["Monitor"] = Relationship(back_populates="target_bundles", link_model=MonitorBundleLink)
    
    # Nested bundle relationships
    parent_bundle: Optional["Bundle"] = Relationship(
        back_populates="child_bundles",
        sa_relationship_kwargs=dict(
            foreign_keys="[Bundle.parent_bundle_id]",
            remote_side="Bundle.id",
        ),
    )
    child_bundles: List["Bundle"] = Relationship(
        back_populates="parent_bundle",
        sa_relationship_kwargs=dict(foreign_keys="[Bundle.parent_bundle_id]")
    )

    __table_args__ = (
        UniqueConstraint("infospace_id", "name", "version"),
    )


# ───────────────────────────────────────────────────── Annotation Schemas ──── #

class MonitorSchemaLink(SQLModel, table=True):
    monitor_id: int = Field(foreign_key="monitor.id", primary_key=True)
    schema_id: int = Field(foreign_key="annotationschema.id", primary_key=True)

class AnnotationSchema(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    output_contract: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    instructions: Optional[str] = Field(default=None, sa_column=Column(Text))
    version: str = Field(default="1.0")
    field_specific_justification_configs: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    is_active: bool = Field(default=True, index=True)

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="schemas")
    user: Optional[User] = Relationship(back_populates="schemas")
    annotations: List["Annotation"] = Relationship(back_populates="schema")
    monitors: List["Monitor"] = Relationship(back_populates="target_schemas", link_model=MonitorSchemaLink)

    __table_args__ = (
        Index(
            "ix_unique_active_schema_name_version",
            "infospace_id", "name", "version",
            unique=True,
            postgresql_where=text("is_active = true")
        ),
    )

class RunSchemaLink(SQLModel, table=True):
    run_id: Optional[int] = Field(foreign_key="annotationrun.id", primary_key=True)
    schema_id: Optional[int] = Field(foreign_key="annotationschema.id", primary_key=True)

class AnnotationRun(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: RunStatus = RunStatus.PENDING
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))

    # New fields from user query
    include_parent_context: bool = Field(default=False)
    context_window: int = Field(default=0)
    views_config: Optional[List[Dict[str, Any]]] = Field(
        default_factory=list, sa_column=Column(JSONB)
    )

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    # Link to a monitor if this run was generated by one
    monitor_id: Optional[int] = Field(default=None, foreign_key="monitor.id")
    monitor: Optional["Monitor"] = Relationship(back_populates="runs")

    infospace: Optional[Infospace] = Relationship(back_populates="runs")
    user: Optional[User] = Relationship(back_populates="runs")

    target_schemas: List["AnnotationSchema"] = Relationship(link_model=RunSchemaLink)
    annotations: List["Annotation"] = Relationship(back_populates="run")

# ───────────────────────────────────────────────────────── Annotation Results ──── #

class Annotation(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)

    asset_id: int = Field(foreign_key="asset.id")
    schema_id: int = Field(foreign_key="annotationschema.id")
    run_id: int = Field(foreign_key="annotationrun.id")
    
    # Add infospace and user references
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")

    value: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    status: ResultStatus = ResultStatus.SUCCESS
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    region: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    links: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    asset: Optional[Asset] = Relationship(back_populates="annotations")
    run: Optional[AnnotationRun] = Relationship(back_populates="annotations")
    schema: Optional[AnnotationSchema] = Relationship(back_populates="annotations")
    infospace: Optional[Infospace] = Relationship(back_populates="annotations")
    user: Optional[User] = Relationship(back_populates="annotations")

    justifications: List["Justification"] = Relationship(back_populates="annotation")

    __table_args__ = (
        UniqueConstraint("asset_id", "schema_id", "run_id", "uuid"),
        Index("ix_annotation_value", "value", postgresql_using="gin", postgresql_ops={"value": "jsonb_path_ops"}),
    )

# ───────────────────────────────────────────────────────── Justifications ──── #

class Justification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    annotation_id: int = Field(foreign_key="annotation.id")
    
    field_name: Optional[str] = Field(default=None)
    reasoning: Optional[str] = Field(default=None, sa_column=Column(Text))
    evidence_payload: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    
    model_name: Optional[str] = Field(default=None)
    score: Optional[float] = Field(default=None)
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    annotation: "Annotation" = Relationship(back_populates="justifications")

    __table_args__ = (
        Index("ix_justification_annotation_field", "annotation_id", "field_name"),
    )

# ─────────────────────────────────────────────────────────────── Tasks ──── #

class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    type: TaskType
    schedule: str  # cron syntax, or 'on_event:asset_created' etc.
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: TaskStatus = TaskStatus.PAUSED
    is_enabled: bool = Field(default=True)

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")

    last_run_at: Optional[datetime] = None
    last_successful_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = Field(default=None)
    last_run_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    consecutive_failure_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="tasks")
    user: Optional[User] = Relationship(back_populates="tasks")
    monitor: Optional["Monitor"] = Relationship(back_populates="linked_task")
    source: Optional["Source"] = Relationship(back_populates="monitoring_tasks")

# ───────────────────────────────────────────────────────────── History (opt.) ──── #

class SearchHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    query: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    filters: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    result_count: Optional[int] = None

    user: Optional[User] = Relationship()


# ───────────────────────────────────────────────────────── Chat Conversations ──── #

class ChatConversation(SQLModel, table=True):
    """Stores chat conversation sessions for intelligence analysis."""
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    description: Optional[str] = None
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Model configuration used in this conversation
    model_name: Optional[str] = None
    temperature: Optional[float] = None
    
    # Conversation metadata
    conversation_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    
    # Status tracking
    is_archived: bool = Field(default=False)
    is_pinned: bool = Field(default=False)
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    last_message_at: Optional[datetime] = None
    
    # Relationships
    infospace: Optional["Infospace"] = Relationship()
    user: Optional[User] = Relationship()
    messages: List["ChatConversationMessage"] = Relationship(back_populates="conversation")
    
    __table_args__ = (
        Index("ix_chatconversation_user_infospace", "user_id", "infospace_id"),
        Index("ix_chatconversation_updated", "updated_at"),
    )


class ChatConversationMessage(SQLModel, table=True):
    """Individual messages within a chat conversation."""
    id: Optional[int] = Field(default=None, primary_key=True)
    conversation_id: int = Field(foreign_key="chatconversation.id")
    
    role: str  # "system", "user", "assistant", "tool"
    content: str = Field(sa_column=Column(Text))
    
    # Message metadata
    message_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    
    # Tool execution tracking
    tool_calls: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    tool_executions: Optional[List[Dict[str, Any]]] = Field(default=None, sa_column=Column(JSON))
    thinking_trace: Optional[str] = Field(default=None, sa_column=Column(Text))
    
    # Model usage tracking
    model_used: Optional[str] = None
    usage: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # Relationships
    conversation: Optional[ChatConversation] = Relationship(back_populates="messages")
    
    __table_args__ = (
        Index("ix_chatconversationmessage_conversation", "conversation_id", "created_at"),
    )

# ───────────────────────────────────────────────────────────── Index hints ──── #
# Alembic migrations should create additional GIN/GIST indexes on JSON columns
# (cells, value, output_contract) if query patterns show the need.

# ─────────────────────────────────────────────────────────── Monitors ──── #

# ─────────────────────────────────────────────────────────── Backups ──── #

class InfospaceBackup(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    expires_at: Optional[datetime] = None

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")

    backup_type: BackupType = BackupType.MANUAL
    storage_path: str
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None

    included_sources: int = 0
    included_assets: int = 0
    included_schemas: int = 0
    included_runs: int = 0
    included_datasets: int = 0
    included_annotations: int = 0

    status: BackupStatus = BackupStatus.PENDING
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

    is_shareable: bool = Field(default=False)
    share_token: Optional[str] = Field(default=None, index=True)

    infospace: Optional[Infospace] = Relationship(back_populates="backups")
    user: Optional[User] = Relationship(back_populates="created_backups")

    __table_args__ = (
        Index("ix_infospacebackup_infospace_user", "infospace_id", "user_id"),
    )


class UserBackup(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    backup_type: str = "user"
    expires_at: Optional[datetime] = None

    target_user_id: int = Field(foreign_key="user.id")
    created_by_user_id: int = Field(foreign_key="user.id")

    storage_path: str
    file_size_bytes: Optional[int] = None
    content_hash: Optional[str] = None

    included_infospaces: int = 0
    included_assets: int = 0
    included_schemas: int = 0
    included_runs: int = 0
    included_annotations: int = 0
    included_datasets: int = 0

    status: BackupStatus = BackupStatus.PENDING
    error_message: Optional[str] = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

    is_shareable: bool = Field(default=False)
    share_token: Optional[str] = Field(default=None, index=True)

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

    @property
    def is_ready(self) -> bool:
        """Check if backup is ready for use."""
        return self.status == BackupStatus.COMPLETED and not self.is_expired

    # Relationships
    target_user: Optional[User] = Relationship(sa_relationship_kwargs={"foreign_keys": "[UserBackup.target_user_id]"})
    created_by_user: Optional[User] = Relationship(sa_relationship_kwargs={"foreign_keys": "[UserBackup.created_by_user_id]"})

    __table_args__ = (
        Index("ix_userbackup_target_created", "target_user_id", "created_by_user_id"),
    )

class Monitor(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    linked_task_id: int = Field(foreign_key="task.id", unique=True)
    
    run_config_override: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    views_config: Optional[List[Dict[str, Any]]] = Field(default_factory=list, sa_column=Column(JSONB))
    aggregation_config: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSONB))
    
    status: str = Field(default="PAUSED")
    last_checked_at: Optional[datetime] = None
    
    # Relationships
    infospace: Infospace = Relationship(back_populates="monitors")
    user: User = Relationship(back_populates="monitors")
    linked_task: "Task" = Relationship(back_populates="monitor")
    
    target_bundles: List["Bundle"] = Relationship(back_populates="monitors", link_model=MonitorBundleLink)
    target_schemas: List["AnnotationSchema"] = Relationship(back_populates="monitors", link_model=MonitorSchemaLink)
    runs: List["AnnotationRun"] = Relationship(back_populates="monitor")

# ─────────────────────────────────────────────────────────── Pipelines ──── #

class PipelineStep(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    pipeline_id: int = Field(foreign_key="intelligencepipeline.id")
    step_order: int
    name: str
    step_type: str # ANNOTATE, FILTER, ANALYZE, ROUTE, CURATE, BUNDLE
    configuration: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    input_source: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    
    pipeline: "IntelligencePipeline" = Relationship(back_populates="steps")

class IntelligencePipeline(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    source_bundle_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    linked_task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    
    steps: List["PipelineStep"] = Relationship(back_populates="pipeline")
    executions: List["PipelineExecution"] = Relationship(back_populates="pipeline")

class PipelineExecution(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    pipeline_id: int = Field(foreign_key="intelligencepipeline.id")
    status: str # RUNNING, COMPLETED, FAILED
    trigger_type: str # ON_NEW_ASSET, SCHEDULED_FULL_RUN, MANUAL_ADHOC
    triggering_asset_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    step_outputs: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None

    pipeline: "IntelligencePipeline" = Relationship(back_populates="executions")

class PipelineProcessedAsset(SQLModel, table=True):
    pipeline_id: int = Field(foreign_key="intelligencepipeline.id", primary_key=True)
    input_bundle_id: int = Field(foreign_key="bundle.id", primary_key=True)
    asset_id: int = Field(foreign_key="asset.id", primary_key=True)
    processed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class RunAggregate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    run_id: int = Field(foreign_key="annotationrun.id")
    field_path: str
    value_kind: str  # number|string|bool|datetime|array_* etc
    sketch_kind: str  # count|min|max|mean|var|histogram|hll|topk|timeseries
    payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    __table_args__ = (
        Index("ix_runaggregate_payload", "payload", postgresql_using="gin", postgresql_ops={"payload": "jsonb_path_ops"}),
        Index("ix_runaggregate_run_field", "run_id", "field_path"),
    )


class MonitorAggregate(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    monitor_id: int = Field(foreign_key="monitor.id")
    field_path: str
    value_kind: str
    sketch_kind: str
    payload: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    __table_args__ = (
        Index("ix_monitoraggregate_payload", "payload", postgresql_using="gin", postgresql_ops={"payload": "jsonb_path_ops"}),
        Index("ix_monitoraggregate_monitor_field", "monitor_id", "field_path"),
    )

# ─────────────────────────────────────────────────────────────── Datasets ──── #

class Dataset(SQLModel, table=True):
    """Curated collection of Assets (and optional downstream artefacts) within an Infospace."""
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None

    # Core links
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")

    # Asset composition & provenance
    asset_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    datarecord_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    source_job_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    source_scheme_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))

    # Arbitrary user metadata / tags
    custom_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    # Relationships (set within runtime via Relationship to avoid circular refs)
    infospace: Optional[Infospace] = Relationship(back_populates="datasets")
    user: Optional[User] = Relationship(back_populates="datasets")

# ───────────────────────────────────────────────────────────── Packages ──── #

class Package(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str
    description: Optional[str] = None

    infospace_id: int = Field(foreign_key="infospace.id")
    infospace: Optional[Infospace] = Relationship(back_populates="packages")

    manifest: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    asset_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    schema_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    run_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

# ─────────────────────────────────────────────────────── Shareable Links ──── #

class ShareableLink(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    token: str = Field(index=True, unique=True)
    name: Optional[str] = None
    permission_level: PermissionLevel = PermissionLevel.READ_ONLY
    is_public: bool = False
    expiration_date: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    max_uses: Optional[int] = None
    use_count: int = Field(default=0)

    user_id: int = Field(foreign_key="user.id")
    resource_type: ResourceType
    resource_id: int
    
    # Add infospace_id for better context and querying
    infospace_id: Optional[int] = Field(default=None, foreign_key="infospace.id")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships
    infospace: Optional[Infospace] = Relationship(back_populates="shareable_links")
    user: Optional[User] = Relationship(back_populates="shareable_links")

    def is_expired(self) -> bool:
        return self.expiration_date is not None and datetime.now(timezone.utc) > self.expiration_date

    def has_exceeded_max_uses(self) -> bool:
        return self.max_uses is not None and self.use_count >= self.max_uses

    def is_valid(self) -> bool:
        return not (self.is_expired() or self.has_exceeded_max_uses())

