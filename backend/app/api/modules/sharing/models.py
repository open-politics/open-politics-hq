"""Sharing domain models: ShareableLink, Package, InfospaceBackup, UserBackup."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import CheckConstraint, Column, DateTime, Index, JSON, text

from app.api.modules.identity_infospace_user.models import User, Infospace


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
    USER = "user"


class BackupStatus(str, enum.Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"
    EXPIRED = "expired"


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
    __table_args__ = (Index("ix_infospacebackup_infospace_user", "infospace_id", "user_id"),)


class UserBackup(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    backup_type: BackupType = BackupType.USER
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
        if not self.expires_at:
            return False
        expires_at = self.expires_at
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        return datetime.now(timezone.utc) > expires_at

    @property
    def is_ready(self) -> bool:
        return self.status == BackupStatus.COMPLETED and not self.is_expired

    target_user: Optional[User] = Relationship(
        back_populates="user_backups",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.target_user_id]"},
    )
    created_by_user: Optional[User] = Relationship(
        back_populates="created_user_backups",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.created_by_user_id]"},
    )
    __table_args__ = (Index("ix_userbackup_target_created", "target_user_id", "created_by_user_id"),)


class PackageVisibility(str, enum.Enum):
    TOKEN = "token"         # accessible only with token (default)
    INTERNAL = "internal"   # discoverable by any authenticated user
    PUBLIC = "public"       # discoverable by anyone


class Package(SQLModel, table=True):
    """
    Universal sharing primitive. A curated selection of items from an infospace
    with per-item download/copy controls.

    See FOUNDATION.md § Access Control and OVERVIEW.md § Access Control.
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    token: str = Field(
        default_factory=lambda: __import__("secrets").token_urlsafe(24),
        unique=True,
        index=True,
    )
    visibility: PackageVisibility = Field(default=PackageVisibility.TOKEN)

    infospace_id: int = Field(foreign_key="infospace.id")
    infospace: Optional[Infospace] = Relationship(back_populates="packages")
    user_id: Optional[int] = Field(default=None, foreign_key="user.id")

    # Package-wide defaults (overridden by per-item settings)
    default_allow_download: bool = Field(default=False)
    default_allow_copy: bool = Field(default=False)

    is_active: bool = Field(default=True)
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    items: List["PackageItem"] = Relationship(
        back_populates="package",
        sa_relationship_kwargs={"cascade": "all, delete-orphan"},
    )

    @property
    def is_expired(self) -> bool:
        if not self.expires_at:
            return False
        return datetime.now(timezone.utc) > self.expires_at

    @property
    def is_valid(self) -> bool:
        return self.is_active and not self.is_expired


class PackageItem(SQLModel, table=True):
    """Single item in a package — exactly one typed FK is non-null per row.

    Typed FKs give us referential integrity, CASCADE on source deletion,
    and type-safe access (``item.bundle_id is not None`` instead of
    ``item.resource_type == "bundle"``).
    """
    id: Optional[int] = Field(default=None, primary_key=True)
    package_id: int = Field(foreign_key="package.id", index=True, sa_column_kwargs={"ondelete": "CASCADE"})
    # Exactly one of these is non-null (CHECK constraint in migration)
    bundle_id: Optional[int] = Field(default=None, foreign_key="bundle.id", sa_column_kwargs={"ondelete": "CASCADE"})
    run_id: Optional[int] = Field(default=None, foreign_key="annotationrun.id", sa_column_kwargs={"ondelete": "CASCADE"})
    graph_id: Optional[int] = Field(default=None, foreign_key="knowledgegraph.id", sa_column_kwargs={"ondelete": "CASCADE"})
    schema_id: Optional[int] = Field(default=None, foreign_key="annotationschema.id", sa_column_kwargs={"ondelete": "CASCADE"})
    asset_id: Optional[int] = Field(default=None, foreign_key="asset.id", sa_column_kwargs={"ondelete": "CASCADE"})
    entity_canonical_id: Optional[int] = Field(default=None, foreign_key="entitycanonical.id", sa_column_kwargs={"ondelete": "CASCADE"})
    # Per-item permission overrides (NULL = use package default)
    allow_download: Optional[bool] = None
    allow_copy: Optional[bool] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    package: Optional[Package] = Relationship(back_populates="items")

    __table_args__ = (
        CheckConstraint(
            "(bundle_id IS NOT NULL)::int + (run_id IS NOT NULL)::int + "
            "(graph_id IS NOT NULL)::int + (schema_id IS NOT NULL)::int + "
            "(asset_id IS NOT NULL)::int + (entity_canonical_id IS NOT NULL)::int = 1",
            name="ck_packageitem_exactly_one_fk",
        ),
    )

    @property
    def resource_type(self) -> str:
        """Compat accessor — returns which FK is set."""
        if self.bundle_id is not None: return "bundle"
        if self.run_id is not None: return "run"
        if self.graph_id is not None: return "graph"
        if self.schema_id is not None: return "schema"
        if self.asset_id is not None: return "asset"
        if self.entity_canonical_id is not None: return "entity"
        return "unknown"

    @property
    def resource_id(self) -> int:
        """Compat accessor — returns the non-null FK value."""
        return (
            self.bundle_id or self.run_id or self.graph_id or self.schema_id
            or self.asset_id or self.entity_canonical_id or 0
        )

    def effective_allow_download(self) -> bool:
        if self.allow_download is not None:
            return self.allow_download
        return self.package.default_allow_download if self.package else False

    def effective_allow_copy(self) -> bool:
        if self.allow_copy is not None:
            return self.allow_copy
        return self.package.default_allow_copy if self.package else False


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
    infospace_id: Optional[int] = Field(default=None, foreign_key="infospace.id")

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    infospace: Optional[Infospace] = Relationship(back_populates="shareable_links")
    user: Optional[User] = Relationship(back_populates="shareable_links")

    def is_expired(self) -> bool:
        return self.expiration_date is not None and datetime.now(timezone.utc) > self.expiration_date

    def has_exceeded_max_uses(self) -> bool:
        return self.max_uses is not None and self.use_count >= self.max_uses

    def is_valid(self) -> bool:
        return not (self.is_expired() or self.has_exceeded_max_uses())
