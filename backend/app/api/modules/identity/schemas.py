"""Identity domain schemas: User and Infospace."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Dict, List, Optional

from sqlmodel import SQLModel, Field

from app.api.identity.models import UserBase, UserTier


# ─── User schemas ───

class UserOut(UserBase):
    id: int
    is_active: bool = True
    is_superuser: bool = False
    ui_preferences: Optional[Dict[str, Any]] = None
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
    ui_preferences: Optional[Dict[str, Any]] = None


class UserUpdateMe(SQLModel):
    full_name: Optional[str] = Field(None, max_length=100)
    email: Optional[str] = None
    profile_picture_url: Optional[str] = Field(None, max_length=500)
    bio: Optional[str] = Field(None, max_length=500, description="Short bio (max 500 characters)")
    description: Optional[str] = Field(None, max_length=2000, description="Longer description (max 2000 characters)")
    ui_preferences: Optional[Dict[str, Any]] = None


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


# ─── Infospace schemas ───

class InfospaceBase(SQLModel):
    name: str
    description: Optional[str] = None
    icon: Optional[str] = None
    enable_related_assets: Optional[bool] = False


class InfospaceCreate(InfospaceBase):
    owner_id: int
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
    vector_backend: Optional[str] = None
    embedding_model: Optional[str] = None
    embedding_dim: Optional[int] = None
    chunk_size: Optional[int] = None
    chunk_overlap: Optional[int] = None
    chunk_strategy: Optional[str] = None


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
    enable_related_assets: Optional[bool] = None


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
