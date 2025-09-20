import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from fastapi.responses import StreamingResponse

from app.api.deps import CurrentUser, SessionDep, get_user_backup_service
from app.schemas import (
    UserBackupCreate,
    UserBackupRead,
    UserBackupsOut,
    UserBackupUpdate,
    UserBackupRestoreRequest,
    UserBackupShareRequest,
    UserOut,
    Message
)
from app.models import User
from sqlmodel import select

logger = logging.getLogger(__name__)

# Router for user backup operations (admin only)
router = APIRouter(
    prefix="/user-backups",
    tags=["User Backups"]
)

@router.post("", response_model=UserBackupRead)
def create_user_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_data: UserBackupCreate,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Create a new backup of a complete user account (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can create user backups")
    
    try:
        backup = user_backup_service.create_user_backup(
            target_user_id=backup_data.target_user_id,
            admin_user_id=current_user.id,
            backup_data=backup_data
        )
        return UserBackupRead.model_validate(backup)
    
    except Exception as e:
        logger.error(f"User backup creation failed: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create user backup")

@router.get("", response_model=UserBackupsOut)
def list_user_backups(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    target_user_id: Optional[int] = Query(None, description="Filter by specific target user"),
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    List user backups (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access user backups")
    
    try:
        backups, total_count = user_backup_service.get_user_backups(
            admin_user_id=current_user.id,
            target_user_id=target_user_id,
            skip=skip,
            limit=limit
        )
        
        return UserBackupsOut(
            data=[UserBackupRead.model_validate(backup) for backup in backups],
            count=total_count
        )
    
    except Exception as e:
        logger.error(f"Failed to list user backups: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list user backups")

@router.get("/{backup_id}", response_model=UserBackupRead)
def get_user_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Get a specific user backup (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access user backups")
    
    from app.models import UserBackup
    backup = session.get(UserBackup, backup_id)
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User backup not found")
    
    return UserBackupRead.model_validate(backup)

@router.put("/{backup_id}", response_model=UserBackupRead)
def update_user_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    backup_update: UserBackupUpdate,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Update user backup metadata (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can update user backups")
    
    from app.models import UserBackup
    backup = session.get(UserBackup, backup_id)
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User backup not found")
    
    # Update backup fields
    update_data = backup_update.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(backup, field, value)
    
    session.add(backup)
    session.commit()
    session.refresh(backup)
    
    return UserBackupRead.model_validate(backup)

@router.delete("/{backup_id}", response_model=Message)
async def delete_user_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Delete a user backup and its files (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can delete user backups")
    
    try:
        await user_backup_service.delete_user_backup(backup_id, current_user.id)
        return Message(message="User backup deleted successfully")
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to delete user backup {backup_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to delete user backup")

@router.post("/{backup_id}/restore", response_model=UserOut)
async def restore_user_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    restore_request: UserBackupRestoreRequest,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Restore a user from a backup (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can restore user backups")
    
    try:
        restored_user = await user_backup_service.restore_user_backup(
            backup_id=backup_id,
            admin_user_id=current_user.id,
            restore_request=restore_request
        )
        return UserOut.model_validate(restored_user)
    
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to restore user backup {backup_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to restore user backup")

@router.post("/{backup_id}/share", response_model=dict)
def create_user_backup_share_link(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    share_request: UserBackupShareRequest,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Create a shareable link for a user backup (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can share user backups")
    
    from app.models import UserBackup
    import secrets
    
    backup = session.get(UserBackup, backup_id)
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User backup not found")
    
    try:
        # Generate share token if needed
        if share_request.is_shareable and not backup.share_token:
            backup.share_token = secrets.token_urlsafe(32)
        
        backup.is_shareable = share_request.is_shareable
        
        # Set expiration if provided
        if share_request.expiration_hours:
            from datetime import datetime, timezone, timedelta
            backup.expires_at = datetime.now(timezone.utc) + timedelta(hours=share_request.expiration_hours)
        
        session.add(backup)
        session.commit()
        session.refresh(backup)
        
        return {
            "share_token": backup.share_token if backup.is_shareable else None,
            "download_url": f"/api/v1/user-backups/download/{backup.share_token}" if backup.is_shareable else None,
            "expires_at": backup.expires_at.isoformat() if backup.expires_at else None
        }
    
    except Exception as e:
        logger.error(f"Failed to create share link for user backup {backup_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create share link")

@router.get("/download/{share_token}")
async def download_shared_user_backup(
    *,
    session: SessionDep,
    share_token: str,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Download a shared user backup.
    """
    from app.models import UserBackup
    
    backup = session.exec(
        select(UserBackup).where(UserBackup.share_token == share_token)
    ).first()
    
    if not backup or not backup.is_shareable or backup.is_expired:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found or no longer available")
    
    try:
        # Stream backup file from storage
        async def stream_backup():
            file_obj = await user_backup_service.storage_provider.get_file(backup.storage_path)
            try:
                while True:
                    chunk = file_obj.read(8192)
                    if not chunk:
                        break
                    yield chunk
            finally:
                file_obj.close()
        
        return StreamingResponse(
            stream_backup(),
            media_type='application/zip',
            headers={
                "Content-Disposition": f"attachment; filename=user_backup_{backup.target_user_id}_{backup.id}.zip"
            }
        )
    
    except Exception as e:
        logger.error(f"Failed to download user backup {backup.id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to download user backup")

@router.post("/cleanup", response_model=Message)
async def cleanup_expired_user_backups(
    *,
    current_user: CurrentUser,
    user_backup_service = Depends(get_user_backup_service)
) -> Any:
    """
    Manually trigger cleanup of expired user backups (Admin only).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger cleanup")
    
    try:
        # Trigger cleanup task
        from app.api.tasks.user_backup import cleanup_expired_user_backups
        cleanup_expired_user_backups.delay()
        
        return Message(message="User backup cleanup task started")
    
    except Exception as e:
        logger.error(f"Failed to trigger user backup cleanup: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to trigger cleanup")

# ==================== ADMIN ENDPOINTS ====================

@router.get("/admin/users-overview")
def get_users_backup_overview(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=100, le=1000),
    skip: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None, description="Search user emails or names")
) -> dict:
    """
    Admin endpoint: Get overview of all users with backup status.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access this endpoint")
    
    try:
        from sqlmodel import func, or_
        from app.models import UserBackup
        
        # Build query with search filter
        base_query = select(User)
        
        if search:
            search_filter = or_(
                User.email.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%") if hasattr(User, 'full_name') else False
            )
            base_query = base_query.where(search_filter)
        
        # Get total count for pagination
        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = session.exec(count_query).one()
        
        # Get users with pagination (order by ID since User model doesn't have created_at)
        users_query = base_query.offset(skip).limit(limit).order_by(User.id.desc())
        users = list(session.exec(users_query))
        
        users_overview = []
        for user in users:
            # Count backups for this user
            backup_count_query = select(func.count()).select_from(
                select(UserBackup).where(UserBackup.target_user_id == user.id).subquery()
            )
            backup_count = session.exec(backup_count_query).one() or 0
            
            # Get latest backup
            latest_backup_query = select(UserBackup, User).join(
                User, UserBackup.created_by_user_id == User.id
            ).where(
                UserBackup.target_user_id == user.id
            ).order_by(UserBackup.created_at.desc()).limit(1)
            latest_backup_result = session.exec(latest_backup_query).first()
            
            latest_backup_info = None
            if latest_backup_result:
                latest_backup, backup_creator = latest_backup_result
                latest_backup_info = {
                    "id": latest_backup.id,
                    "name": latest_backup.name,
                    "status": latest_backup.status,
                    "created_at": latest_backup.created_at.isoformat() if latest_backup.created_at else None,
                    "completed_at": latest_backup.completed_at.isoformat() if latest_backup.completed_at else None,
                    "backup_type": latest_backup.backup_type,
                    "included_infospaces": latest_backup.included_infospaces,
                    "file_size_bytes": latest_backup.file_size_bytes,
                    "created_by": {
                        "id": backup_creator.id,
                        "email": backup_creator.email,
                        "full_name": getattr(backup_creator, 'full_name', backup_creator.email)
                    }
                }
            
            users_overview.append({
                "id": user.id,
                "email": user.email,
                "full_name": getattr(user, 'full_name', user.email),
                "is_active": user.is_active,
                "is_superuser": user.is_superuser,
                "created_at": None,  # User model doesn't have created_at field
                "backup_count": backup_count,
                "latest_backup": latest_backup_info
            })
        
        return {
            "data": users_overview,
            "total": total_count,
            "limit": limit,
            "skip": skip
        }
        
    except Exception as e:
        logger.error(f"Failed to get users overview: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve users overview"
        )

@router.post("/admin/backup-all", response_model=Message)
def trigger_backup_all_users(
    *,
    current_user: CurrentUser,
    backup_type: str = "system"
) -> Message:
    """
    Admin endpoint: Trigger backup creation for all users.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger bulk user backups")
    
    try:
        from app.api.tasks.user_backup import backup_all_users
        backup_all_users.delay(backup_type=backup_type, admin_user_id=current_user.id)
        
        return Message(message=f"Bulk user backup ({backup_type}) triggered successfully")
    
    except Exception as e:
        logger.error(f"Failed to trigger bulk user backup: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to trigger bulk user backup"
        )

@router.post("/admin/backup-specific", response_model=Message)
def trigger_backup_specific_users(
    *,
    user_ids: List[int],
    current_user: CurrentUser,
    backup_type: str = "manual"
) -> Message:
    """
    Admin endpoint: Trigger backup creation for specific users.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger bulk user backups")
    
    try:
        from app.api.tasks.user_backup import backup_specific_users
        backup_specific_users.delay(
            user_ids=user_ids,
            backup_type=backup_type,
            admin_user_id=current_user.id
        )
        
        return Message(message=f"Backup for {len(user_ids)} users triggered successfully")
    
    except Exception as e:
        logger.error(f"Failed to trigger specific user backups: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to trigger specific user backups"
        ) 