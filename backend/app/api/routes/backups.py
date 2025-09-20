import logging
from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException, status, Query, BackgroundTasks
from fastapi.responses import StreamingResponse, FileResponse

from app.api.deps import CurrentUser, SessionDep, get_backup_service
from app.schemas import (
    InfospaceBackupCreate,
    InfospaceBackupRead,
    InfospaceBackupsOut,
    InfospaceBackupUpdate,
    BackupRestoreRequest,
    BackupShareRequest,
    InfospaceRead,
    Message
)
from app.api.services.backup_service import BackupService
from app.api.services.service_utils import validate_infospace_access
from app.api.tasks.backup import automatic_backup_all_infospaces, backup_specific_infospaces
from app.models import Infospace
from sqlmodel import select

logger = logging.getLogger(__name__)

# Router for infospace-specific backup operations
router = APIRouter(
    prefix="/infospaces/{infospace_id}/backups",
    tags=["Backups"]
)

# Router for general backup operations (non-infospace-specific)
general_router = APIRouter(
    prefix="/backups",
    tags=["Backups"]
)

@router.post("", response_model=InfospaceBackupRead)
def create_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    backup_data: InfospaceBackupCreate,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Create a new backup of an infospace.
    """
    try:
        backup = backup_service.create_backup(
            infospace_id=infospace_id,
            user_id=current_user.id,
            backup_data=backup_data
        )
        return InfospaceBackupRead.model_validate(backup)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Error creating backup: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create backup")

@router.get("", response_model=InfospaceBackupsOut)
def list_backups(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    List backups for an infospace.
    """
    try:
        backups, total_count = backup_service.get_user_backups(
            user_id=current_user.id,
            infospace_id=infospace_id,
            skip=skip,
            limit=limit
        )
        
        backup_reads = [InfospaceBackupRead.model_validate(backup) for backup in backups]
        return InfospaceBackupsOut(data=backup_reads, count=total_count)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.error(f"Error listing backups: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list backups")

@general_router.get("", response_model=InfospaceBackupsOut)
def list_all_user_backups(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=1000),
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    List all backups for a user across all infospaces.
    """
    try:
        backups, total_count = backup_service.get_user_backups(
            user_id=current_user.id,
            skip=skip,
            limit=limit
        )
        
        backup_reads = [InfospaceBackupRead.model_validate(backup) for backup in backups]
        return InfospaceBackupsOut(data=backup_reads, count=total_count)
    except Exception as e:
        logger.error(f"Error listing user backups: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to list backups")

@general_router.get("/{backup_id}", response_model=InfospaceBackupRead)
def get_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Get a specific backup by ID.
    """
    backup = backup_service.get_backup(backup_id, current_user.id)
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    return InfospaceBackupRead.model_validate(backup)

@general_router.put("/{backup_id}", response_model=InfospaceBackupRead)
def update_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    backup_update: InfospaceBackupUpdate,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Update backup metadata.
    """
    backup = backup_service.update_backup(
        backup_id=backup_id,
        user_id=current_user.id,
        update_data=backup_update
    )
    if not backup:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    return InfospaceBackupRead.model_validate(backup)

@general_router.delete("/{backup_id}", response_model=Message)
async def delete_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Delete a backup and its associated file.
    """
    success = await backup_service.delete_backup(backup_id, current_user.id)
    if not success:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Backup not found")
    return Message(message="Backup deleted successfully")

@general_router.post("/{backup_id}/restore", response_model=InfospaceRead)
async def restore_backup(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    restore_request: BackupRestoreRequest,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Restore an infospace from a backup.
    """
    try:
        # Override backup_id in request with path parameter
        restore_request.backup_id = backup_id
        
        restored_infospace = await backup_service.restore_backup(
            restore_request=restore_request,
            user_id=current_user.id
        )
        return InfospaceRead.model_validate(restored_infospace)
    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as e:
        logger.error(f"Error restoring backup {backup_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to restore backup")

@general_router.post("/{backup_id}/share", response_model=dict)
def create_backup_share_link(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_id: int,
    share_request: BackupShareRequest,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Create a shareable link for a backup.
    """
    try:
        # Override backup_id in request with path parameter
        share_request.backup_id = backup_id
        
        share_token = backup_service.create_share_link(
            backup_id=backup_id,
            user_id=current_user.id,
            expiration_hours=share_request.expiration_hours
        )
        
        return {
            "share_token": share_token,
            "download_url": f"/api/v1/backups/download/{share_token}",
            "message": "Share link created successfully"
        }
    except HTTPException:
        raise  # Re-raise HTTP exceptions as-is
    except Exception as e:
        logger.error(f"Error creating share link for backup {backup_id}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to create share link")

@general_router.get("/download/{share_token}")
async def download_shared_backup(
    *,
    session: SessionDep,
    share_token: str,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Download a backup using a share token.
    """
    try:
        # Get backup by share token
        from sqlmodel import select
        from app.models import InfospaceBackup, BackupStatus
        
        backup = session.exec(
            select(InfospaceBackup).where(
                InfospaceBackup.share_token == share_token,
                InfospaceBackup.is_shareable == True,
                InfospaceBackup.status == BackupStatus.COMPLETED
            )
        ).first()
        
        if not backup or backup.is_expired:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share link not found or expired")
        
        # Get file from storage
        file_obj = await backup_service.storage_provider.get_file(backup.storage_path)
        
        # Return streaming response
        def iter_file():
            while True:
                chunk = file_obj.read(8192)
                if not chunk:
                    break
                yield chunk
            file_obj.close()
        
        filename = f"backup_{backup.uuid}.zip"
        return StreamingResponse(
            iter_file(),
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename={filename}"}
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error downloading backup with token {share_token}: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to download backup")

@general_router.post("/cleanup", response_model=Message)
async def cleanup_expired_backups(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    backup_service: BackupService = Depends(get_backup_service)
) -> Any:
    """
    Manually trigger cleanup of expired backups (admin function).
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger cleanup")
    
    try:
        cleaned_count = await backup_service.cleanup_expired_backups()
        return Message(message=f"Cleaned up {cleaned_count} expired backups")
    except Exception as e:
        logger.error(f"Error during manual backup cleanup: {e}", exc_info=True)
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Cleanup failed")

# ==================== ADMIN ENDPOINTS ====================

@general_router.get("/admin/infospaces-overview")
def get_infospaces_backup_overview(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    limit: int = Query(default=100, le=1000),
    skip: int = Query(default=0, ge=0),
    search: Optional[str] = Query(default=None, description="Search infospace names or user emails"),
    user_id: Optional[int] = Query(default=None, description="Filter by specific user ID")
) -> dict:
    """
    Admin endpoint: Get overview of all infospaces with backup status.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can access this endpoint")
    
    try:
        from sqlmodel import func, or_
        from app.models import InfospaceBackup, User
        
        # Build query with joins and filters
        base_query = select(Infospace, User).join(User, Infospace.owner_id == User.id)
        
        # Apply search filter
        if search:
            search_filter = or_(
                Infospace.name.ilike(f"%{search}%"),
                User.email.ilike(f"%{search}%"),
                User.full_name.ilike(f"%{search}%") if hasattr(User, 'full_name') else False
            )
            base_query = base_query.where(search_filter)
        
        # Apply user filter
        if user_id:
            base_query = base_query.where(Infospace.owner_id == user_id)
        
        # Get total count for pagination
        count_query = select(func.count()).select_from(base_query.subquery())
        total_count = session.exec(count_query).one()
        
        # Get infospaces with pagination
        infospaces_query = base_query.offset(skip).limit(limit)
        results = list(session.exec(infospaces_query))
        
        infospaces_overview = []
        for infospace, user in results:
            # Count backups for this infospace
            backup_count_query = select(func.count()).select_from(
                select(InfospaceBackup).where(InfospaceBackup.infospace_id == infospace.id).subquery()
            )
            backup_count = session.exec(backup_count_query).one() or 0
            
            # Get latest backup with user who created it
            latest_backup_query = select(InfospaceBackup, User).join(
                User, InfospaceBackup.user_id == User.id
            ).where(
                InfospaceBackup.infospace_id == infospace.id
            ).order_by(InfospaceBackup.created_at.desc()).limit(1)
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
                    "created_by": {
                        "id": backup_creator.id,
                        "email": backup_creator.email,
                        "full_name": getattr(backup_creator, 'full_name', backup_creator.email)
                    }
                }
            
            infospaces_overview.append({
                "id": infospace.id,
                "name": infospace.name,
                "owner_id": infospace.owner_id,
                "owner": {
                    "id": user.id,
                    "email": user.email,
                    "full_name": getattr(user, 'full_name', user.email)
                },
                "created_at": infospace.created_at.isoformat() if infospace.created_at else None,
                "backup_count": backup_count,
                "latest_backup": latest_backup_info
            })
        
        return {
            "data": infospaces_overview,
            "total": total_count,
            "limit": limit,
            "skip": skip
        }
        
    except Exception as e:
        logger.error(f"Failed to get infospaces overview: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to retrieve infospaces overview"
        )

@general_router.post("/admin/backup-all", response_model=Message)
def trigger_backup_all_infospaces(
    *,
    current_user: CurrentUser,
    backup_type: str = "manual"
) -> Message:
    """
    Admin endpoint: Trigger backup creation for all infospaces.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger bulk backups")
    
    try:
        # Start the backup task
        automatic_backup_all_infospaces.delay(backup_type=backup_type)
        
        return Message(message=f"Bulk backup task started for all infospaces (type: {backup_type})")
        
    except Exception as e:
        logger.error(f"Failed to start bulk backup: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start bulk backup task"
        )

@general_router.post("/admin/backup-specific", response_model=Message)
def trigger_backup_specific_infospaces(
    *,
    infospace_ids: List[int],
    current_user: CurrentUser,
    backup_type: str = "manual"
) -> Message:
    """
    Admin endpoint: Trigger backup creation for specific infospaces.
    """
    if not current_user.is_superuser:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only admins can trigger bulk backups")
    
    try:
        if not infospace_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No infospace IDs provided"
            )
        
        # Start the backup task for specific infospaces
        backup_specific_infospaces.delay(infospace_ids=infospace_ids, backup_type=backup_type)
        
        return Message(message=f"Backup task started for {len(infospace_ids)} infospaces")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to start specific backup: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Failed to start backup task"
        ) 