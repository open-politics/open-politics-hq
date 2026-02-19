"""Sharing domain models: ShareableLink, Package, InfospaceBackup, UserBackup."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, DateTime, Index, JSON, text

from app.api.identity.models import User, Infospace


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
