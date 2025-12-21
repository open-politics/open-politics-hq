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
    PIPELINE = "pipeline"      # DEPRECATED - use FLOW
    MONITOR = "monitor"        # DEPRECATED - use FLOW
    FLOW = "flow"              # Execute a Flow
    SOURCE_POLL = "source_poll"  # Poll a Source for new items
    EMBED = "embed"            # Create embeddings
    BACKUP = "backup"          # Create backups
    CUSTOM = "custom"          # Custom Celery task


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
    ACTIVE = "active"
    PAUSED = "paused"
    IDLE = "idle"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"
    ERROR = "error"


class AnnotationRunTrigger(str, enum.Enum):
    """Trigger types for annotation runs."""
    MANUAL = "manual"
    SOURCE_POLL = "source_poll"
    FLOW_STEP = "flow_step"
    API = "api"


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


# ─────────────────────────────────────────────────────── Flow Enums ──── #

class FlowStatus(str, enum.Enum):
    """Status of a Flow definition."""
    DRAFT = "draft"        # Being configured, not yet active
    ACTIVE = "active"      # Actively processing
    PAUSED = "paused"      # Temporarily stopped
    ERROR = "error"        # In error state, needs attention


class FlowInputType(str, enum.Enum):
    """What feeds data into a Flow."""
    STREAM = "stream"      # Watch a Source's output
    BUNDLE = "bundle"      # Watch a Bundle for new assets
    MANUAL = "manual"      # Only triggered manually with explicit asset_ids


class FlowTriggerMode(str, enum.Enum):
    """When a Flow runs."""
    ON_ARRIVAL = "on_arrival"  # Process as soon as new assets arrive
    SCHEDULED = "scheduled"    # Run on a schedule (linked Task)
    MANUAL = "manual"          # Only run when explicitly triggered


class FlowStepType(str, enum.Enum):
    """Types of steps in a Flow."""
    ANNOTATE = "ANNOTATE"  # Apply schemas, create annotations
    FILTER = "FILTER"      # Evaluate conditions, pass/reject assets
    CURATE = "CURATE"      # Promote annotation fields to asset.fragments
    ROUTE = "ROUTE"        # Copy/move assets to bundle(s)
    EMBED = "EMBED"        # Create embeddings for semantic search
    ANALYZE = "ANALYZE"    # Run analysis adapters


class RunType(str, enum.Enum):
    """Differentiates one-off runs from flow-triggered runs."""
    ONE_OFF = "one_off"    # Manual/standalone annotation run (shows in history)
    FLOW_STEP = "flow_step"  # Created by a Flow execution (hidden from main list)


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
    
    # UI preferences and settings
    ui_preferences: Optional[Dict[str, Any]] = Field(
        default_factory=dict, 
        sa_column=Column(JSONB)
    )
    
    # Timestamps
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # Email verification fields
    email_verified: bool = Field(default=False)
    email_verification_token: Optional[str] = Field(default=None, index=True)
    email_verification_sent_at: Optional[datetime] = Field(default=None)
    email_verification_expires_at: Optional[datetime] = Field(default=None)
    
    # Encrypted provider credentials for background tasks
    # Stores user's API keys encrypted with Fernet (AES-128 + HMAC)
    # Format: {provider_id: api_key} encrypted as JSON string
    encrypted_credentials: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="Fernet-encrypted JSON of provider API keys for scheduled/background tasks"
    )

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
    
    # Tags for filtering and organization
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    
    # ═══ STREAMING BEHAVIOR ═══
    is_active: bool = Field(default=False)
    poll_interval_seconds: int = Field(default=300)
    
    # ═══ OUTPUT ROUTING (key for hierarchy) ═══
    output_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id")
    
    # ═══ STATE TRACKING ═══
    cursor_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    last_poll_at: Optional[datetime] = None
    next_poll_at: Optional[datetime] = None
    
    # ═══ STATISTICS ═══
    items_last_poll: int = Field(default=0)
    total_items_ingested: int = Field(default=0)
    
    # ═══ HEALTH ═══
    consecutive_failures: int = Field(default=0)
    last_error_at: Optional[datetime] = None
    
    infospace: Optional[Infospace] = Relationship(back_populates="sources")
    user: Optional[User] = Relationship(back_populates="sources")

    assets: List["Asset"] = Relationship(back_populates="source")
    monitoring_tasks: List["Task"] = Relationship(back_populates="source")
    
    # ═══ RELATIONSHIPS ═══
    output_bundle: Optional["Bundle"] = Relationship()
    poll_history: List["SourcePollHistory"] = Relationship(back_populates="source")

class SourcePollHistory(SQLModel, table=True):
    """Tracks poll history for sources to enable statistics and debugging."""
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="source.id")
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    status: str  # success, failed, partial
    items_found: int = Field(default=0)
    items_ingested: int = Field(default=0)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    cursor_before: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    cursor_after: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))

    source: Optional["Source"] = Relationship(back_populates="poll_history")

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
    
    # Tags for filtering and organization
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    
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
            remote_side="[Asset.id]",
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
            remote_side="[Asset.id]",
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
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    
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
    
    # Tags for filtering and organization
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="schemas")
    user: Optional[User] = Relationship(back_populates="schemas")
    annotations: List["Annotation"] = Relationship(back_populates="schema")

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
    
    # ═══ RUN TYPE: Distinguishes one-off runs from flow-triggered runs ═══
    # one_off: Manual/standalone run - shows in run history
    # flow_step: Created by FlowExecution - hidden from main run list, shown under Flow
    run_type: RunType = Field(default=RunType.ONE_OFF)
    
    # ═══ FLOW EXECUTION LINK ═══
    # If run_type == flow_step, this links to the parent FlowExecution
    flow_execution_id: Optional[int] = Field(default=None, foreign_key="flowexecution.id", index=True)
    
    # Tags for filtering and organization
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

    # ═══ TRIGGER TRACKING ═══
    # trigger_type: manual (default), source_poll, flow_step, api
    trigger_type: str = Field(default="manual")
    trigger_context: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    
    # Source bundle for continuous run support
    source_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)

    infospace: Optional[Infospace] = Relationship(back_populates="runs")
    user: Optional[User] = Relationship(back_populates="runs")
    
    # Link to FlowExecution if this run was created by a Flow
    flow_execution: Optional["FlowExecution"] = Relationship(
        back_populates="annotation_runs",
        sa_relationship_kwargs={"foreign_keys": "[AnnotationRun.flow_execution_id]"}
    )

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
    target_user: Optional[User] = Relationship(
        back_populates="user_backups",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.target_user_id]"}
    )
    created_by_user: Optional[User] = Relationship(
        back_populates="created_user_backups",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.created_by_user_id]"}
    )

    __table_args__ = (
        Index("ix_userbackup_target_created", "target_user_id", "created_by_user_id"),
    )

# ─────────────────────────────────────────────────────────────── Flows ──── #
# Flows unify Monitor + IntelligencePipeline into a single abstraction

class Flow(SQLModel, table=True):
    """
    Unified processing flow that replaces Monitor and IntelligencePipeline.
    
    A Flow defines:
    - What to watch (input: stream/bundle/manual)
    - What processing to apply (steps: annotate, filter, curate, route, etc.)
    - When to run (trigger: on_arrival, scheduled, manual)
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # ═══ STATUS ═══
    status: FlowStatus = Field(default=FlowStatus.DRAFT)
    
    # ═══ INPUT CONFIGURATION ═══
    # Defines what feeds data into this flow
    input_type: FlowInputType = Field(default=FlowInputType.BUNDLE)
    input_source_id: Optional[int] = Field(default=None, foreign_key="source.id")  # if input_type == STREAM
    input_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id")  # if input_type == BUNDLE
    
    # ═══ STEP DEFINITIONS ═══
    # Embedded as JSON for simplicity
    # Example: [
    #   {"type": "ANNOTATE", "schema_ids": [1, 2], "config": {...}},
    #   {"type": "FILTER", "expression": {...}},
    #   {"type": "CURATE", "fields": ["entities", "sentiment"]},
    #   {"type": "ROUTE", "bundle_id": 5, "conditions": [...]}
    # ]
    steps: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB))
    
    # ═══ TRIGGER CONFIGURATION ═══
    trigger_mode: FlowTriggerMode = Field(default=FlowTriggerMode.MANUAL)
    linked_task_id: Optional[int] = Field(default=None, foreign_key="task.id")  # For scheduled flows
    
    # ═══ DELTA TRACKING (unified) ═══
    # Tracks what we've processed to enable incremental processing
    # Structure: { "processed_asset_ids": [...], "last_processed_at": "...", "cursor": {...} }
    cursor_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    
    # ═══ STATISTICS ═══
    total_executions: int = Field(default=0)
    total_assets_processed: int = Field(default=0)
    last_execution_at: Optional[datetime] = Field(default=None)
    last_execution_status: Optional[str] = Field(default=None)
    consecutive_failures: int = Field(default=0)
    
    # ═══ VIEWS CONFIG (for dashboards) ═══
    views_config: List[Dict[str, Any]] = Field(default_factory=list, sa_column=Column(JSONB))
    
    # ═══ TAGS ═══
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    
    # ═══ TIMESTAMPS ═══
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # ═══ RELATIONSHIPS ═══
    executions: List["FlowExecution"] = Relationship(back_populates="flow")
    input_source: Optional["Source"] = Relationship()
    input_bundle: Optional["Bundle"] = Relationship()
    
    __table_args__ = (
        Index("ix_flow_infospace_status", "infospace_id", "status"),
        Index("ix_flow_input_bundle", "input_bundle_id"),
        Index("ix_flow_input_source", "input_source_id"),
    )


class FlowExecution(SQLModel, table=True):
    """
    A single execution of a Flow.
    
    Replaces PipelineExecution and monitor cycle tracking.
    Contains all trigger context and step outputs.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    flow_id: int = Field(foreign_key="flow.id")
    
    # ═══ TRIGGER CONTEXT ═══
    triggered_by: str = Field(default="manual")  # task | on_arrival | manual | source_poll
    triggered_by_task_id: Optional[int] = Field(default=None, foreign_key="task.id")
    triggered_by_source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    trigger_context: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    
    # ═══ EXECUTION STATUS ═══
    status: RunStatus = Field(default=RunStatus.PENDING)
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    
    # ═══ INPUT/OUTPUT ═══
    input_asset_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))
    output_asset_ids: List[int] = Field(default_factory=list, sa_column=Column(JSON))  # After routing
    
    # ═══ STEP OUTPUTS ═══
    # Structure: {
    #   "0": {"type": "ANNOTATE", "run_id": 42, "annotation_count": 15},
    #   "1": {"type": "FILTER", "passed": 12, "rejected": 3},
    #   "2": {"type": "CURATE", "promoted_count": 24},
    #   "3": {"type": "ROUTE", "routed_count": 12, "bundle_id": 5}
    # }
    step_outputs: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSONB))
    
    # ═══ TAGS ═══
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    
    # ═══ TIMESTAMPS ═══
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    
    # ═══ RELATIONSHIPS ═══
    flow: Optional["Flow"] = Relationship(back_populates="executions")
    annotation_runs: List["AnnotationRun"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[AnnotationRun.flow_execution_id]"}
    )
    
    __table_args__ = (
        Index("ix_flowexecution_flow_status", "flow_id", "status"),
        Index("ix_flowexecution_created", "created_at"),
    )


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

