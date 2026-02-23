"""Content domain models: Asset, Bundle, Source, Dataset, etc."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Index, JSON, Text, text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from pgvector.sqlalchemy import Vector

# Identity types (Layer 1) - content is Layer 2
from app.api.modules.identity_infospace_user.models import User, Infospace


# ─── Content enums ───

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
    RSS_FEED = "rss_feed"
    FILE = "file"


class ProcessingStatus(str, enum.Enum):
    READY = "ready"
    PENDING = "pending"
    PROCESSING = "processing"
    FAILED = "failed"


class SourceType(str, enum.Enum):
    RSS_FEED = "rss_feed"
    DIRECT_FILE = "direct_file"
    WEB_PAGE = "web_page"
    SEARCH_QUERY = "search_query"
    URL_LIST = "url_list"
    SITE_DISCOVERY = "site_discovery"
    FILE_UPLOAD = "file_upload"
    TEXT_CONTENT = "text_content"
    ARCHIVE_DATASET = "archive_dataset"


class SourceStatus(str, enum.Enum):
    PENDING = "pending"
    ACTIVE = "active"
    PAUSED = "paused"
    IDLE = "idle"
    PROCESSING = "processing"
    COMPLETE = "complete"
    FAILED = "failed"
    ERROR = "error"


class EmbeddingProvider(str, enum.Enum):
    OLLAMA = "ollama"
    JINA = "jina"
    OPENAI = "openai"
    HUGGINGFACE = "huggingface"


class IngestionStatus(str, enum.Enum):
    PENDING = "pending"
    DOWNLOADING = "downloading"
    EXTRACTING = "extracting"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    CANCELLED = "cancelled"


# ─── Sources ───

class Source(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    kind: str
    details: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    status: SourceStatus = SourceStatus.PENDING
    source_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    error_message: Optional[str] = None
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    is_active: bool = Field(default=False)
    poll_interval_seconds: int = Field(default=300)
    output_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id")
    cursor_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    last_poll_at: Optional[datetime] = None
    next_poll_at: Optional[datetime] = None
    items_last_poll: int = Field(default=0)
    total_items_ingested: int = Field(default=0)
    consecutive_failures: int = Field(default=0)
    last_error_at: Optional[datetime] = None

    infospace: Optional[Infospace] = Relationship(back_populates="sources")
    user: Optional[User] = Relationship(back_populates="sources")
    assets: List["Asset"] = Relationship(back_populates="source")
    monitoring_tasks: List["Task"] = Relationship(back_populates="source")
    output_bundle: Optional["Bundle"] = Relationship()
    poll_history: List["SourcePollHistory"] = Relationship(back_populates="source")
    ingestion_jobs: List["IngestionJob"] = Relationship(back_populates="source")


class SourcePollHistory(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    source_id: int = Field(foreign_key="source.id")
    started_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    completed_at: Optional[datetime] = None
    status: str
    items_found: int = Field(default=0)
    items_ingested: int = Field(default=0)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    cursor_before: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    cursor_after: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    source: Optional[Source] = Relationship(back_populates="poll_history")


# ─── Bundles ───

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
    parent_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)
    child_bundle_count: Optional[int] = Field(default=0)
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="bundles")
    user: Optional[User] = Relationship(back_populates="bundles")
    assets: List["Asset"] = Relationship(back_populates="bundle")
    parent_bundle: Optional["Bundle"] = Relationship(
        back_populates="child_bundles",
        sa_relationship_kwargs=dict(foreign_keys="[Bundle.parent_bundle_id]", remote_side="Bundle.id"),
    )
    child_bundles: List["Bundle"] = Relationship(
        back_populates="parent_bundle",
        sa_relationship_kwargs=dict(foreign_keys="[Bundle.parent_bundle_id]"),
    )
    bundle_views: List["BundleView"] = Relationship(back_populates="source_bundle")

    __table_args__ = (UniqueConstraint("infospace_id", "name", "version"),)


# ─── BundleView (lightweight named subset, no data movement) ───

class BundleView(SQLModel, table=True):
    """Lightweight named subset of a bundle. Queries resolve to assets in source_bundle where logical_path LIKE path_prefix%.
    No data duplication. Tree UI shows BundleViews as first-class nodes."""
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    source_bundle_id: int = Field(foreign_key="bundle.id", index=True)
    path_prefix: str = Field(default="")  # e.g. "politics/eu/" - empty means whole bundle
    infospace_id: int = Field(foreign_key="infospace.id", index=True)
    user_id: int = Field(foreign_key="user.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship()
    user: Optional[User] = Relationship()
    source_bundle: Optional[Bundle] = Relationship(back_populates="bundle_views")


# ─── Assets ───

class Asset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    title: str
    kind: AssetKind
    stub: bool = Field(default=False, index=True)
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_path: Optional[str] = None
    logical_path: Optional[str] = Field(default=None, index=True)
    source_identifier: Optional[str] = Field(default=None, index=True)
    source_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSONB))
    discovered_modalities: Optional[List[str]] = Field(default=None, sa_column=Column(JSONB))
    content_hash: Optional[str] = Field(default=None, index=True)
    fragments: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSONB))
    tags: List[str] = Field(default_factory=list, sa_column=Column(JSON))
    processing_status: ProcessingStatus = Field(default=ProcessingStatus.READY, index=True)
    processing_error: Optional[str] = None
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id")
    bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    event_timestamp: Optional[datetime] = Field(default=None)
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    parent_asset_id: Optional[int] = Field(default=None, foreign_key="asset.id", index=True)
    part_index: Optional[int] = Field(default=None, index=True)
    previous_asset_id: Optional[int] = Field(default=None, foreign_key="asset.id", index=True)
    is_superseded: bool = Field(default=False, index=True)

    parent_asset: Optional["Asset"] = Relationship(
        back_populates="children_assets",
        sa_relationship_kwargs=dict(foreign_keys="[Asset.parent_asset_id]", remote_side="[Asset.id]"),
    )
    children_assets: List["Asset"] = Relationship(
        back_populates="parent_asset",
        sa_relationship_kwargs=dict(foreign_keys="[Asset.parent_asset_id]", cascade="all, delete-orphan"),
    )
    previous_asset: Optional["Asset"] = Relationship(
        back_populates="next_versions",
        sa_relationship_kwargs=dict(foreign_keys="[Asset.previous_asset_id]", remote_side="[Asset.id]"),
    )
    next_versions: List["Asset"] = Relationship(
        back_populates="previous_asset",
        sa_relationship_kwargs=dict(foreign_keys="[Asset.previous_asset_id]"),
    )
    infospace: Optional[Infospace] = Relationship(back_populates="assets")
    user: Optional[User] = Relationship(back_populates="assets")
    source: Optional[Source] = Relationship(back_populates="assets")
    bundle: Optional[Bundle] = Relationship(back_populates="assets")
    annotations: List["Annotation"] = Relationship(
        back_populates="asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )
    chunks: List["AssetChunk"] = Relationship(
        back_populates="asset",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    __table_args__ = (
        Index("ix_asset_fragments", "fragments", postgresql_using="gin", postgresql_ops={"fragments": "jsonb_path_ops"}),
        Index("ix_asset_source_metadata", "source_metadata", postgresql_using="gin", postgresql_ops={"source_metadata": "jsonb_path_ops"}),
        Index("ix_asset_discovered_modalities", "discovered_modalities", postgresql_using="gin"),
    )

    @property
    def is_container(self) -> bool:
        from app.api.modules.content.types import get_content_type_registry
        desc = get_content_type_registry().by_kind(self.kind)
        return desc.is_container if desc else False


# ─── Embedding models ───

class EmbeddingModel(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(index=True)
    provider: EmbeddingProvider
    dimension: int
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    is_active: bool = Field(default=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    max_sequence_length: Optional[int] = None
    embedding_time_ms: Optional[float] = None
    chunks: List["AssetChunk"] = Relationship(back_populates="embedding_model")

    __table_args__ = (
        UniqueConstraint("name", "provider"),
        Index("ix_embeddingmodel_provider_active", "provider", "is_active"),
    )


# ─── Asset chunks ───

# Supported embedding dimensions for indexed vector search
EMBEDDING_SUPPORTED_DIMS = (384, 512, 768, 1024, 1536)


def get_embedding_column_for_dimension(dim: int) -> Optional[str]:
    """Return the column name for a given embedding dimension, or None if unsupported."""
    if dim in EMBEDDING_SUPPORTED_DIMS:
        return f"embedding_{dim}"
    return None


class AssetChunk(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    asset_id: int = Field(foreign_key="asset.id")
    chunk_index: int
    text_content: Optional[str] = Field(default=None, sa_column=Column(Text))
    blob_reference: Optional[str] = None
    embedding_model_id: Optional[int] = Field(default=None, foreign_key="embeddingmodel.id")
    embedding_384: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(384)))
    embedding_512: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(512)))
    embedding_768: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(768)))
    embedding_1024: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1024)))
    embedding_1536: Optional[List[float]] = Field(default=None, sa_column=Column(Vector(1536)))
    chunk_metadata: Optional[Dict[str, Any]] = Field(default_factory=dict, sa_column=Column(JSON))
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    asset: "Asset" = Relationship(back_populates="chunks")
    embedding_model: Optional[EmbeddingModel] = Relationship(back_populates="chunks")

    __table_args__ = (
        UniqueConstraint("asset_id", "chunk_index"),
        Index("ix_assetchunk_embedding_model", "embedding_model_id"),
        Index("ix_assetchunk_embedding_384", "embedding_384", postgresql_using="hnsw", postgresql_with={"m": 16, "ef_construction": 64}, postgresql_where=text("embedding_384 IS NOT NULL")),
        Index("ix_assetchunk_embedding_512", "embedding_512", postgresql_using="hnsw", postgresql_with={"m": 16, "ef_construction": 64}, postgresql_where=text("embedding_512 IS NOT NULL")),
        Index("ix_assetchunk_embedding_768", "embedding_768", postgresql_using="hnsw", postgresql_with={"m": 16, "ef_construction": 64}, postgresql_where=text("embedding_768 IS NOT NULL")),
        Index("ix_assetchunk_embedding_1024", "embedding_1024", postgresql_using="hnsw", postgresql_with={"m": 16, "ef_construction": 64}, postgresql_where=text("embedding_1024 IS NOT NULL")),
        Index("ix_assetchunk_embedding_1536", "embedding_1536", postgresql_using="hnsw", postgresql_with={"m": 16, "ef_construction": 64}, postgresql_where=text("embedding_1536 IS NOT NULL")),
    )


# ─── Datasets ───

class Dataset(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    entity_uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    asset_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    datarecord_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    source_job_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    source_scheme_ids: Optional[List[int]] = Field(default=None, sa_column=Column(JSON))
    custom_metadata: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    imported_from_uuid: Optional[str] = Field(default=None, index=True)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    infospace: Optional[Infospace] = Relationship(back_populates="datasets")
    user: Optional[User] = Relationship(back_populates="datasets")


# ─── Ingestion jobs ───

class IngestionJob(SQLModel, table=True):
    """
    Tracks content ingestion jobs (local directory import, remote archive, source poll).

    Universal execution log: every import run — whether triggered manually or by a
    Source poll — creates an IngestionJob. When ``source_id`` is set, the job
    records one poll cycle of that Source.
    """
    __tablename__ = "ingestionjob"

    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    source_locator: str = Field(index=True)
    kind: str = Field(default="archive_zip")
    source_id: Optional[int] = Field(default=None, foreign_key="source.id", index=True)
    root_bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id")
    status: IngestionStatus = Field(default=IngestionStatus.PENDING, index=True)
    total_files: int = Field(default=0)
    processed_files: int = Field(default=0)
    failed_files: int = Field(default=0)
    total_bytes: Optional[int] = Field(default=None)
    downloaded_bytes: Optional[int] = Field(default=None)
    cursor_state: Dict[str, Any] = Field(default_factory=dict, sa_column=Column(JSON))
    task_id: Optional[str] = Field(default=None, index=True)
    error_message: Optional[str] = Field(default=None, sa_column=Column(Text))
    retry_count: int = Field(default=0)
    last_error_at: Optional[datetime] = Field(default=None)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})
    started_at: Optional[datetime] = Field(default=None)
    completed_at: Optional[datetime] = Field(default=None)

    infospace: Optional[Infospace] = Relationship()
    user: Optional[User] = Relationship()
    source: Optional[Source] = Relationship(back_populates="ingestion_jobs")
    root_bundle: Optional[Bundle] = Relationship()

    __table_args__ = (
        Index("ix_ingestionjob_status_infospace", "status", "infospace_id"),
        Index("ix_ingestionjob_user_status", "user_id", "status"),
        Index("ix_ingestionjob_source", "source_id"),
    )
