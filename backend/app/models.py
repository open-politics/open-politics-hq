"""OSINT Kernel – canonical data model (models.py)
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


class TaskStatus(str, enum.Enum):
    ACTIVE = "active"
    PAUSED = "paused"
    ERROR = "error"


class PermissionLevel(str, enum.Enum):
    READ_ONLY = "read_only"
    EDIT = "edit"
    FULL_ACCESS = "full_access"


class ResourceType(str, enum.Enum):
    BUNDLE = "bundle"
    ASSET = "asset"
    SCHEMA = "schema"
    INFOSPACE = "infospace"
    RUN = "run"
    PACKAGE = "package"


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

# ─────────────────────────────────────────────────────────── Core Access ──── #

class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False
    full_name: Optional[str] = None

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


class Infospace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    icon: Optional[str] = None

    # Vector preferences (override the global defaults)
    vector_backend: Optional[str] = Field(default="pgvector")
    embedding_model: Optional[str] = Field(default="text-embedding-ada-002")
    embedding_dim: Optional[int] = Field(default=1024)
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

# ─────────────────────────────────────────────────────────────── Bundles ──── #

class AssetBundleLink(SQLModel, table=True):
    """Link table for many-to-many relationship between Asset and Bundle."""
    asset_id: int = Field(foreign_key="asset.id", primary_key=True)
    bundle_id: int = Field(foreign_key="bundle.id", primary_key=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

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

# ─────────────────────────────────────────────────────────────── Assets ──── #

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    kind: AssetKind
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = None
    source_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    content_hash: Optional[str] = Field(default=None, index=True)
    
    # Processing status for hierarchical assets (CSV, PDF)
    processing_status: ProcessingStatus = ProcessingStatus.READY
    processing_error: Optional[str] = None
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    # Parent-child relationship
    parent_asset_id: Optional[int] = Field(default=None, foreign_key="asset.id")
    part_index: Optional[int] = Field(default=None, index=True)
    parent_asset: Optional["Asset"] = Relationship(
        back_populates="children_assets",
        sa_relationship_kwargs=dict(remote_side="Asset.id")
    )
    children_assets: List["Asset"] = Relationship(back_populates="parent_asset")

    # Relationships
    infospace: Optional[Infospace] = Relationship(back_populates="assets")
    user: Optional[User] = Relationship(back_populates="assets")
    source: Optional[Source] = Relationship(back_populates="assets")
    bundles: List["Bundle"] = Relationship(back_populates="assets", link_model=AssetBundleLink)
    annotations: List["Annotation"] = Relationship(back_populates="asset")
    chunks: List["AssetChunk"] = Relationship(back_populates="asset")


# ──────────────────────────────────────────────────────── Asset Chunks ──── #

class AssetChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="asset.id")
    chunk_index: int  # Order of the chunk within the asset
    
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_reference: Optional[str] = None # For non-text chunks, e.g., image region coordinates as JSON string or path
    
    # Assuming embedding_dim is taken from Infospace settings, e.g., 1024
    # This might need adjustment based on how pgvector handles dynamic dimensions or if a fixed dimension is used.
    embedding: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1024))) # Defaulting to 1024
    embedding_model: Optional[str] = None # Model used for this specific embedding, e.g. "text-embedding-ada-002"
    
    chunk_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    asset: "Asset" = Relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("asset_id", "chunk_index"),
        Index("ix_assetchunk_embedding", "embedding", postgresql_using="ivfflat", postgresql_with={"lists": 100}),
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
    
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    
    # Relationships
    infospace: Optional[Infospace] = Relationship(back_populates="bundles")
    user: Optional[User] = Relationship(back_populates="bundles")
    assets: List["Asset"] = Relationship(back_populates="bundles", link_model=AssetBundleLink)

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

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="schemas")
    user: Optional[User] = Relationship(back_populates="schemas")
    annotations: List["Annotation"] = Relationship(back_populates="schema")

    __table_args__ = (
        UniqueConstraint("infospace_id", "name", "version"),
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

    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    
    # Import/export lineage
    imported_from_uuid: Optional[str] = Field(default=None, index=True)

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

    last_run_at: Optional[datetime] = None
    last_successful_run_at: Optional[datetime] = None
    last_run_status: Optional[str] = Field(default=None)
    last_run_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    consecutive_failure_count: int = Field(default=0)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="tasks")
    user: Optional[User] = Relationship(back_populates="tasks")

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

# ───────────────────────────────────────────────────────────── History (opt.) ──── #

class SearchHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(foreign_key="user.id")
    query: str
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    filters: Optional[Dict[str, Any]] = Field(default=None, sa_column=Column(JSON))
    result_count: Optional[int] = None

    user: Optional[User] = Relationship()

# ───────────────────────────────────────────────────────────── Index hints ──── #
# Alembic migrations should create additional GIN/GIST indexes on JSON columns
# (cells, value, output_contract) if query patterns show the need.

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
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Relationships (set within runtime via Relationship to avoid circular refs)
    infospace: Optional[Infospace] = Relationship(back_populates="datasets")
    user: Optional[User] = Relationship(back_populates="datasets")


# ───────────────────────────────────────────────────── Analysis Adapters ──── #

class AnalysisAdapter(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(unique=True, index=True)
    description: Optional[str] = Field(default=None, sa_column=Column(Text))
    
    input_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    output_schema_definition: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    
    version: str = Field(default="1.0")
    module_path: Optional[str] = Field(default=None)
    adapter_type: str
    
    is_active: bool = Field(default=True)
    is_public: bool = Field(default=False)
    
    creator_user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    creator: Optional[User] = Relationship(back_populates="analysis_adapters_created")
    
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

