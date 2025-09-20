from typing import Any
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import select, func
from pydantic import BaseModel

from app.api.deps import (
    CurrentUser,
    SessionDep,
    get_current_active_superuser,
)
from app.core.config import settings
from app.models import User

router = APIRouter()

# Request/Response models for registration management
class RegistrationStats(BaseModel):
    total_users: int
    users_created_today: int
    users_created_this_week: int
    users_created_this_month: int
    open_registration_enabled: bool
    last_registration: str | None

@router.get("/admin/registration/stats", response_model=RegistrationStats)
def get_registration_stats(
    session: SessionDep,
    current_user: CurrentUser
) -> RegistrationStats:
    """
    Get registration statistics and status.
    Admin only.
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=now.weekday())
    month_start = today_start.replace(day=1)
    
    # Total users
    total_users = session.exec(select(func.count(User.id))).one()
    
    # Users created today
    users_today = session.exec(
        select(func.count(User.id)).where(User.created_at >= today_start)
    ).one()
    
    # Users created this week
    users_week = session.exec(
        select(func.count(User.id)).where(User.created_at >= week_start)
    ).one()
    
    # Users created this month
    users_month = session.exec(
        select(func.count(User.id)).where(User.created_at >= month_start)
    ).one()
    
    # Last registration - get most recently created user
    last_user = session.exec(
        select(User).order_by(User.created_at.desc()).limit(1)
    ).first()
    
    last_registration = None
    if last_user and last_user.created_at:
        last_registration = last_user.created_at.isoformat()
    
    return RegistrationStats(
        total_users=total_users,
        users_created_today=users_today,
        users_created_this_week=users_week,
        users_created_this_month=users_month,
        open_registration_enabled=settings.USERS_OPEN_REGISTRATION,
        last_registration=last_registration
    )

 