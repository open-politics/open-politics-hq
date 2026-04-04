"""Identity domain schemas: User and Infospace."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field

from app.api.modules.identity_infospace_user.models import UserBase, UserTier, CollaboratorRole
from app.api.modules.foundation_service_providers.base import ProviderDefaults, EnrichmentConfig


# ─── User schemas ───

class UserOut(UserBase):
    id: int
    handle: Optional[str] = None
    is_active: bool = True
    is_superuser: bool = False
    ui_preferences: Optional[Dict[str, Any]] = None
    provider_defaults: Optional[ProviderDefaults] = None
    created_at: datetime
    updated_at: datetime


class UserPublicProfile(SQLModel):
    """Public user profile (no sensitive information)."""
    id: int
    handle: Optional[str] = None
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
    send_welcome_email: bool = True


class UserCreateOpen(SQLModel):
    email: str
    password: str
    full_name: Optional[str] = None
    handle: Optional[str] = None
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
    ui_preferences: Optional[Dict[str, Any]] = None


class UserUpdateMe(SQLModel):
    full_name: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = None
    profile_picture_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=500, description="Short bio (max 500 characters)")
    description: Optional[str] = Field(None, max_length=2000, description="Longer description (max 2000 characters)")
    ui_preferences: Optional[Dict[str, Any]] = None
    provider_defaults: Optional[ProviderDefaults] = None


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


class UserUIPreferences(SQLModel):
    """Structured schema for user UI preferences and settings."""
    globe_enabled: bool = False
    docs_banner_dismissed: bool = False
    tutorial_completed: bool = False
    tutorial_step: Optional[int] = None
    custom_background_url: Optional[str] = None


class HandleUpdate(SQLModel):
    """Update a user's handle."""
    handle: str


class HandleCheck(SQLModel):
    """Handle availability check result."""
    handle: str
    available: bool


class UserSearchResult(SQLModel):
    """Lightweight user result for invite autocomplete."""
    id: int
    handle: Optional[str] = None
    full_name: Optional[str] = None
    profile_picture_url: Optional[str] = None


# ─── Invitation schemas ───

class InvitationCreate(SQLModel):
    """Invite someone by handle or email."""
    identifier: str  # handle or email — backend resolves which
    role: CollaboratorRole = CollaboratorRole.VIEWER


class InvitationOut(SQLModel):
    """Invitation as seen by owner (infospace view) or invitee (inbox view)."""
    id: int
    infospace_id: int
    infospace_name: str
    inviter_name: Optional[str] = None
    inviter_handle: Optional[str] = None
    invitee_user_id: Optional[int] = None
    invitee_handle: Optional[str] = None
    invitee_email: Optional[str] = None
    role: str
    status: str
    created_at: datetime

    @staticmethod
    def from_db(inv, session) -> "InvitationOut":
        """Build from an Invitation model + session for relationship lookups."""
        from app.api.modules.identity_infospace_user.models import Infospace, User
        infospace = session.get(Infospace, inv.infospace_id)
        inviter = session.get(User, inv.inviter_id)
        invitee = session.get(User, inv.invitee_user_id) if inv.invitee_user_id else None
        return InvitationOut(
            id=inv.id,
            infospace_id=inv.infospace_id,
            infospace_name=infospace.name if infospace else "Unknown",
            inviter_name=inviter.full_name if inviter else None,
            inviter_handle=inviter.handle if inviter else None,
            invitee_user_id=inv.invitee_user_id,
            invitee_handle=invitee.handle if invitee else None,
            invitee_email=inv.invitee_email,
            role=inv.role.value if hasattr(inv.role, "value") else inv.role,
            status=inv.status.value if hasattr(inv.status, "value") else inv.status,
            created_at=inv.created_at,
        )


class CollaboratorOut(SQLModel):
    """Collaborator in an infospace with role and profile info."""
    user_id: int
    handle: Optional[str] = None
    full_name: Optional[str] = None
    profile_picture_url: Optional[str] = None
    role: str
    is_owner: bool = False


# ─── Infospace schemas ───

class InfospaceBase(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    enable_related_assets: Optional[bool] = False


class InfospaceCreate(InfospaceBase):
    owner_id: int
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None
    icon: Optional[str] = None
    enrichment_config: Optional[EnrichmentConfig] = None


class InfospaceRead(InfospaceBase):
    id: int
    owner_id: int
    created_at: datetime
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None
    enrichment_config: Optional[EnrichmentConfig] = None
    # Per-request context: the authenticated user's role in this infospace
    current_user_role: Optional[str] = None   # owner | analyst | curator | viewer
    is_owner: bool = False


class InfospaceUpdate(SQLModel):
    name: Optional[str] = None
    description: Optional[str] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None
    icon: Optional[str] = None
    enable_related_assets: Optional[bool] = None
    enrichment_config: Optional[EnrichmentConfig] = None


class InfospacesOut(SQLModel):
    data: List[InfospaceRead]
    count: int


# ─── Auth / Token schemas ───

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
