"""Celery tasks for user backup processing."""
import logging
from typing import Dict, Any
from datetime import datetime, timezone

from app.core.celery_app import celery
from app.core.db import engine
from sqlmodel import Session
from app.api.providers.factory import create_storage_provider
from app.core.config import settings

logger = logging.getLogger(__name__)

@celery.task(bind=True, name="process_user_backup")
def process_user_backup(self, backup_id: int, backup_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process a user backup in the background.
    
    Args:
        backup_id: ID of the UserBackup record to process
        backup_options: Options for backup creation
        
    Returns:
        Dict with processing results
    """
    logger.info(f"Processing user backup {backup_id}")
    
    try:
        with Session(engine) as session:
            from app.api.services.user_backup_service import UserBackupService
            
            # Create service dependencies
            storage_provider = create_storage_provider(settings)
            user_backup_service = UserBackupService(session, storage_provider, settings)
            
            # Execute backup
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                success = loop.run_until_complete(
                    user_backup_service.execute_user_backup(backup_id, backup_options)
                )
                
                result = {
                    "success": success,
                    "backup_id": backup_id,
                    "completed_at": datetime.now(timezone.utc).isoformat()
                }
                
                if success:
                    logger.info(f"User backup {backup_id} completed successfully")
                else:
                    logger.error(f"User backup {backup_id} failed")
                
                return result
                
            finally:
                loop.close()
                
    except Exception as e:
        logger.error(f"User backup task {backup_id} failed: {e}", exc_info=True)
        
        # Update backup record with error
        try:
            with Session(engine) as session:
                from app.models import UserBackup, BackupStatus
                backup = session.get(UserBackup, backup_id)
                if backup:
                    backup.status = BackupStatus.FAILED
                    backup.error_message = str(e)
                    backup.completed_at = datetime.now(timezone.utc)
                    session.add(backup)
                    session.commit()
        except Exception as update_error:
            logger.error(f"Failed to update backup {backup_id} with error: {update_error}")
        
        return {
            "success": False,
            "backup_id": backup_id,
            "error": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat()
        }

@celery.task(bind=True, name="cleanup_expired_user_backups")
def cleanup_expired_user_backups(self) -> Dict[str, Any]:
    """
    Clean up expired user backups.
    
    Returns:
        Dict with cleanup results
    """
    logger.info("Starting cleanup of expired user backups")
    
    try:
        with Session(engine) as session:
            from app.api.services.user_backup_service import UserBackupService
            
            # Create service dependencies
            storage_provider = create_storage_provider(settings)
            user_backup_service = UserBackupService(session, storage_provider, settings)
            
            # Execute cleanup
            import asyncio
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            
            try:
                cleanup_result = loop.run_until_complete(
                    user_backup_service.cleanup_expired_user_backups()
                )
                
                logger.info(f"User backup cleanup completed: {cleanup_result}")
                return {
                    "success": True,
                    "cleanup_result": cleanup_result,
                    "completed_at": datetime.now(timezone.utc).isoformat()
                }
                
            finally:
                loop.close()
                
    except Exception as e:
        logger.error(f"User backup cleanup failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat()
        }

@celery.task(bind=True, name="backup_all_users")
def backup_all_users(self, backup_type: str = "system", admin_user_id: int = 1) -> Dict[str, Any]:
    """
    Create backups for all users in the system.
    
    Args:
        backup_type: Type of backup to create
        admin_user_id: ID of admin triggering the backup
        
    Returns:
        Dict with backup results
    """
    logger.info(f"Starting backup of all users (type: {backup_type})")
    
    try:
        with Session(engine) as session:
            from app.api.services.user_backup_service import UserBackupService
            from app.models import User
            from app.schemas import UserBackupCreate
            from sqlmodel import select
            
            # Create service dependencies
            storage_provider = create_storage_provider(settings)
            user_backup_service = UserBackupService(session, storage_provider, settings)
            
            # Get all users
            users = session.exec(select(User).where(User.is_active == True)).all()
            
            successful_backups = 0
            failed_backups = 0
            
            for user in users:
                try:
                    backup_data = UserBackupCreate(
                        target_user_id=user.id,
                        name=f"System Backup - {user.email}",
                        description=f"Automated system backup created on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}"
                    )
                    
                    backup = user_backup_service.create_user_backup(
                        target_user_id=user.id,
                        admin_user_id=admin_user_id,
                        backup_data=backup_data
                    )
                    
                    successful_backups += 1
                    logger.info(f"Created backup for user {user.id} ({user.email})")
                    
                except Exception as e:
                    failed_backups += 1
                    logger.error(f"Failed to create backup for user {user.id}: {e}")
            
            result = {
                "success": True,
                "total_users": len(users),
                "successful_backups": successful_backups,
                "failed_backups": failed_backups,
                "backup_type": backup_type,
                "completed_at": datetime.now(timezone.utc).isoformat()
            }
            
            logger.info(f"System user backup completed: {result}")
            return result
            
    except Exception as e:
        logger.error(f"System user backup failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat()
        }

@celery.task(bind=True, name="backup_specific_users")
def backup_specific_users(
    self, 
    user_ids: list[int], 
    backup_type: str = "manual", 
    admin_user_id: int = 1
) -> Dict[str, Any]:
    """
    Create backups for specific users.
    
    Args:
        user_ids: List of user IDs to backup
        backup_type: Type of backup to create
        admin_user_id: ID of admin triggering the backup
        
    Returns:
        Dict with backup results
    """
    logger.info(f"Starting backup of specific users: {user_ids} (type: {backup_type})")
    
    try:
        with Session(engine) as session:
            from app.api.services.user_backup_service import UserBackupService
            from app.models import User
            from app.schemas import UserBackupCreate
            from sqlmodel import select
            
            # Create service dependencies
            storage_provider = create_storage_provider(settings)
            user_backup_service = UserBackupService(session, storage_provider, settings)
            
            successful_backups = 0
            failed_backups = 0
            skipped_backups = 0
            
            for user_id in user_ids:
                try:
                    user = session.get(User, user_id)
                    if not user:
                        logger.warning(f"User {user_id} not found, skipping")
                        skipped_backups += 1
                        continue
                    
                    backup_data = UserBackupCreate(
                        target_user_id=user.id,
                        name=f"Admin Backup - {user.email}",
                        description=f"Admin-triggered backup created on {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M:%S')}"
                    )
                    
                    backup = user_backup_service.create_user_backup(
                        target_user_id=user.id,
                        admin_user_id=admin_user_id,
                        backup_data=backup_data
                    )
                    
                    successful_backups += 1
                    logger.info(f"Created backup for user {user.id} ({user.email})")
                    
                except Exception as e:
                    failed_backups += 1
                    logger.error(f"Failed to create backup for user {user_id}: {e}")
            
            result = {
                "success": True,
                "requested_users": len(user_ids),
                "successful_backups": successful_backups,
                "failed_backups": failed_backups,
                "skipped_backups": skipped_backups,
                "backup_type": backup_type,
                "completed_at": datetime.now(timezone.utc).isoformat()
            }
            
            logger.info(f"Specific users backup completed: {result}")
            return result
            
    except Exception as e:
        logger.error(f"Specific users backup failed: {e}", exc_info=True)
        return {
            "success": False,
            "error": str(e),
            "completed_at": datetime.now(timezone.utc).isoformat()
        } 