import logging
import asyncio
from typing import Dict, Any, List
from celery import current_task
from sqlmodel import Session, create_engine, select

from app.core.config import settings
from app.core.celery_app import celery
from app.api.providers.factory import create_storage_provider
from app.api.services.backup_service import BackupService
from app.models import Infospace, User, InfospaceBackup

logger = logging.getLogger(__name__)

@celery.task(bind=True, name="process_infospace_backup")
def process_infospace_backup(self, backup_id: int, backup_options: Dict[str, Any]) -> Dict[str, Any]:
    """
    Process an infospace backup creation.
    
    Args:
        backup_id: ID of the backup record to process
        backup_options: Options from InfospaceBackupCreate
        
    Returns:
        Dict with success status and details
    """
    logger.info(f"Processing backup {backup_id}")
    
    try:
        # Create database session
        engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
        session = Session(engine)
        
        try:
            # Create storage provider and backup service
            storage_provider = create_storage_provider(settings)
            backup_service = BackupService(
                session=session,
                storage_provider=storage_provider,
                settings=settings
            )
            
            # Execute the backup (async method called in sync context)
            success = asyncio.run(backup_service.execute_backup(backup_id, backup_options))
            
            if success:
                logger.info(f"Backup {backup_id} completed successfully")
                return {"success": True, "backup_id": backup_id, "message": "Backup completed successfully"}
            else:
                logger.error(f"Backup {backup_id} failed during execution")
                return {"success": False, "backup_id": backup_id, "message": "Backup execution failed"}
                
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Error processing backup {backup_id}: {e}", exc_info=True)
        return {"success": False, "backup_id": backup_id, "message": f"Backup failed: {str(e)}"}

@celery.task(bind=True, name="cleanup_expired_backups")
def cleanup_expired_backups(self) -> Dict[str, Any]:
    """
    Clean up expired backups.
    
    Returns:
        Dict with cleanup results
    """
    logger.info("Starting cleanup of expired backups")
    
    try:
        # Create database session
        engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
        session = Session(engine)
        
        try:
            # Create storage provider and backup service
            storage_provider = create_storage_provider(settings)
            backup_service = BackupService(
                session=session,
                storage_provider=storage_provider,
                settings=settings
            )
            
            # Cleanup expired backups (async method called in sync context)
            cleaned_count = asyncio.run(backup_service.cleanup_expired_backups())
            
            logger.info(f"Cleaned up {cleaned_count} expired backups")
            return {"success": True, "cleaned_count": cleaned_count}
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Error during backup cleanup: {e}", exc_info=True)
        return {"success": False, "message": f"Cleanup failed: {str(e)}"}

@celery.task(bind=True, name="automatic_backup_all_infospaces")
def automatic_backup_all_infospaces(self, backup_type: str = "auto") -> Dict[str, Any]:
    """
    Create automatic backups for all active infospaces.
    
    Args:
        backup_type: Type of backup ('auto', 'scheduled', 'manual')
        
    Returns:
        Dict with backup results
    """
    logger.info(f"Starting automatic backup of all infospaces (type: {backup_type})")
    
    try:
        # Create database session
        engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
        session = Session(engine)
        
        try:
            # Create storage provider and backup service
            storage_provider = create_storage_provider(settings)
            backup_service = BackupService(
                session=session,
                storage_provider=storage_provider,
                settings=settings
            )
            
            # Get all infospaces
            infospaces = session.exec(select(Infospace)).all()
            
            total_infospaces = len(infospaces)
            successful_backups = 0
            failed_backups = 0
            skipped_backups = 0
            
            logger.info(f"Found {total_infospaces} infospaces to backup")
            
            for infospace in infospaces:
                try:
                    # Check if infospace already has a recent automatic backup
                    if backup_type == "auto":
                        recent_backup = session.exec(
                            select(InfospaceBackup).where(
                                InfospaceBackup.infospace_id == infospace.id,
                                InfospaceBackup.backup_type == "auto",
                                InfospaceBackup.status == "completed"
                            ).order_by(InfospaceBackup.created_at.desc()).limit(1)
                        ).first()
                        
                        # Skip if backup was created in last 24 hours
                        if recent_backup:
                            from datetime import datetime, timezone, timedelta
                            if recent_backup.created_at and recent_backup.created_at > datetime.now(timezone.utc) - timedelta(hours=24):
                                logger.info(f"Skipping infospace {infospace.id} - recent backup exists")
                                skipped_backups += 1
                                continue
                    
                    # Create backup name based on type
                    if backup_type == "auto":
                        backup_name = f"Auto Backup - {infospace.name}"
                    elif backup_type == "manual":
                        backup_name = f"Admin or Manual Backup - {infospace.name}"
                    else:
                        backup_name = f"Scheduled Backup - {infospace.name}"
                    
                    # Create backup - convert dict to InfospaceBackupCreate
                    from app.schemas import InfospaceBackupCreate
                    backup_data = InfospaceBackupCreate(
                        name=backup_name,
                        description=f"Automatic backup created on {backup_type}",
                        backup_type=backup_type,
                        include_sources=True,
                        include_schemas=True,
                        include_runs=True,
                        include_datasets=True,
                        include_annotations=True,
                    )
                    
                    backup = backup_service.create_backup(
                        infospace_id=infospace.id,
                        user_id=infospace.owner_id,
                        backup_data=backup_data
                    )
                    
                    logger.info(f"Created backup {backup.id} for infospace {infospace.id} ({infospace.name})")
                    successful_backups += 1
                    
                except Exception as e:
                    logger.error(f"Failed to create backup for infospace {infospace.id}: {e}")
                    failed_backups += 1
                    continue
            
            result = {
                "success": True,
                "total_infospaces": total_infospaces,
                "successful_backups": successful_backups,
                "failed_backups": failed_backups,
                "skipped_backups": skipped_backups,
                "backup_type": backup_type
            }
            
            logger.info(f"Automatic backup completed: {result}")
            return result
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Error during automatic backup: {e}", exc_info=True)
        return {"success": False, "message": f"Automatic backup failed: {str(e)}"}

@celery.task(bind=True, name="backup_specific_infospaces")
def backup_specific_infospaces(self, infospace_ids: List[int], backup_type: str = "manual") -> Dict[str, Any]:
    """
    Create backups for specific infospaces.
    
    Args:
        infospace_ids: List of infospace IDs to backup
        backup_type: Type of backup
        
    Returns:
        Dict with backup results
    """
    logger.info(f"Starting backup of {len(infospace_ids)} specific infospaces")
    
    try:
        # Create database session
        engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))
        session = Session(engine)
        
        try:
            # Create storage provider and backup service
            storage_provider = create_storage_provider(settings)
            backup_service = BackupService(
                session=session,
                storage_provider=storage_provider,
                settings=settings
            )
            
            successful_backups = 0
            failed_backups = 0
            results = []
            
            for infospace_id in infospace_ids:
                try:
                    # Get infospace
                    infospace = session.get(Infospace, infospace_id)
                    if not infospace:
                        logger.warning(f"Infospace {infospace_id} not found")
                        failed_backups += 1
                        results.append({"infospace_id": infospace_id, "status": "failed", "error": "Infospace not found"})
                        continue
                    
                    # Create backup - convert dict to InfospaceBackupCreate
                    from app.schemas import InfospaceBackupCreate
                    backup_data = InfospaceBackupCreate(
                        name=f"Admin or Manual Backup - {infospace.name}",
                        description=f"Admin-triggered backup",
                        backup_type=backup_type,
                        include_sources=True,
                        include_schemas=True,
                        include_runs=True,
                        include_datasets=True,
                        include_annotations=True,
                    )
                    
                    backup = backup_service.create_backup(
                        infospace_id=infospace.id,
                        user_id=infospace.owner_id,
                        backup_data=backup_data
                    )
                    
                    logger.info(f"Created backup {backup.id} for infospace {infospace.id}")
                    successful_backups += 1
                    results.append({"infospace_id": infospace_id, "status": "success", "backup_id": backup.id})
                    
                except Exception as e:
                    logger.error(f"Failed to create backup for infospace {infospace_id}: {e}")
                    failed_backups += 1
                    results.append({"infospace_id": infospace_id, "status": "failed", "error": str(e)})
            
            return {
                "success": True,
                "successful_backups": successful_backups,
                "failed_backups": failed_backups,
                "results": results
            }
            
        finally:
            session.close()
            
    except Exception as e:
        logger.error(f"Error during specific infospace backup: {e}", exc_info=True)
        return {"success": False, "message": f"Backup failed: {str(e)}"} 