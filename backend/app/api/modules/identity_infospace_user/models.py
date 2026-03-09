"""Identity domain models: User, Infospace."""

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import enum
import uuid

from sqlmodel import SQLModel, Field, Relationship
from sqlalchemy import Column, Text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.types import JSON

from app.api.modules.foundation_service_providers.base import ProviderDefaults, ProviderSelection


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


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    email: str = Field(index=True, unique=True)
    hashed_password: str
    is_active: bool = True
    is_superuser: bool = False
    full_name: Optional[str] = None

    profile_picture_url: Optional[str] = Field(default=None)
    bio: Optional[str] = Field(default=None, max_length=500)
    description: Optional[str] = Field(default=None, sa_column=Column(Text))

    ui_preferences: Optional[Dict[str, Any]] = Field(
        default_factory=dict,
        sa_column=Column(JSONB)
    )

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc), sa_column_kwargs={"onupdate": lambda: datetime.now(timezone.utc)})

    email_verified: bool = Field(default=False)
    email_verification_token: Optional[str] = Field(default=None, index=True)
    email_verification_sent_at: Optional[datetime] = Field(default=None)
    email_verification_expires_at: Optional[datetime] = Field(default=None)

    encrypted_credentials: Optional[str] = Field(
        default=None,
        sa_column=Column(Text),
        description="Fernet-encrypted JSON of provider API keys for scheduled/background tasks"
    )

    provider_defaults: Optional[ProviderDefaults] = Field(
        default=None, sa_column=Column("provider_defaults", JSON)
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
    infospace_collaborations: List["InfospaceCollaborator"] = Relationship(back_populates="user")
    user_backups: List["UserBackup"] = Relationship(
        back_populates="target_user",
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.target_user_id]"}
    )
    created_user_backups: List["UserBackup"] = Relationship(
        sa_relationship_kwargs={"foreign_keys": "[UserBackup.created_by_user_id]"}
    )


class CollaboratorRole(str, enum.Enum):
    OWNER = "owner"
    EDITOR = "editor"
    VIEWER = "viewer"


class InfospaceCollaborator(SQLModel, table=True):
    """Many-to-many: users with access to an infospace (owner, editor, viewer)."""
    id: Optional[int] = Field(default=None, primary_key=True)
    infospace_id: int = Field(foreign_key="infospace.id")
    user_id: int = Field(foreign_key="user.id")
    role: CollaboratorRole = Field(default=CollaboratorRole.VIEWER)
    invited_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    infospace: Optional["Infospace"] = Relationship(back_populates="collaborators")
    user: Optional[User] = Relationship(back_populates="infospace_collaborations")


class Infospace(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    uuid: str = Field(default_factory=lambda: str(uuid.uuid4()), unique=True, index=True)
    name: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    icon: Optional[str] = None

    embedding_selection: Optional[ProviderSelection] = Field(
        default=None, sa_column=Column("embedding_selection", JSON)
    )
    chunk_size: Optional[int] = Field(default=512)
    chunk_overlap: Optional[int] = Field(default=50)
    chunk_strategy: Optional[str] = Field(default="token")
    enable_related_assets: bool = Field(default=False)

    @property
    def embedding_configured(self) -> bool:
        """True when a provider + model are selected for embedding."""
        sel = self.embedding_selection
        if isinstance(sel, dict):
            return bool(sel.get("model_name"))
        return bool(sel and sel.model_name)

    owner_id: int = Field(foreign_key="user.id")
    owner: Optional[User] = Relationship(back_populates="infospaces")
    collaborators: List["InfospaceCollaborator"] = Relationship(back_populates="infospace")

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
