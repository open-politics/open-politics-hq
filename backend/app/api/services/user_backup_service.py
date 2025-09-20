import logging
import os
import secrets
import hashlib
import zipfile
import json
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select, func
from fastapi import HTTPException, status

from app.models import (
    UserBackup, 
    BackupType, 
    BackupStatus,
    Infospace,
    User,
    Asset,
    AnnotationSchema,
    AnnotationRun,
    Annotation,
    Dataset,
    Source
)
from app.schemas import (
    UserBackupCreate, 
    UserBackupUpdate,
    UserBackupRestoreRequest
)
from app.api.services.service_utils import validate_infospace_access
from app.api.services.package_service import PackageBuilder, PackageImporter, DataPackage, PackageMetadata
from app.api.services.infospace_service import InfospaceService
from app.api.providers.base import StorageProvider
from app.core.config import AppSettings

logger = logging.getLogger(__name__)

class UserBackupService:
    """
    Service for managing system-level user backups.
    
    This service creates comprehensive backups of entire user accounts,
    including all their infospaces, assets, annotations, schemas, runs, and datasets.
    Designed for disaster recovery and user migration scenarios.
    """
    
    def __init__(
        self, 
        session: Session, 
        storage_provider: StorageProvider,
        settings: AppSettings
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.settings = settings
        self.source_instance_id = settings.INSTANCE_ID
        logger.info("UserBackupService initialized")

    def create_user_backup(
        self,
        target_user_id: int,
        admin_user_id: int,
        backup_data: UserBackupCreate
    ) -> UserBackup:
        """
        Create a new backup of a complete user account.
        
        Args:
            target_user_id: ID of the user to backup
            admin_user_id: ID of the admin creating the backup
            backup_data: Backup configuration
            
        Returns:
            The created UserBackup record
            
        Raises:
            HTTPException: If validation fails
        """
        logger.info(f"Creating user backup for user {target_user_id} by admin {admin_user_id}")
        
        # Validate target user exists
        target_user = self.session.get(User, target_user_id)
        if not target_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"User with ID {target_user_id} not found"
            )
        
        # Generate storage path
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        storage_path = f"user_backups/{target_user_id}/{timestamp}_{secrets.token_hex(8)}.zip"
        
        # Create backup record
        backup = UserBackup(
            target_user_id=target_user_id,
            created_by_user_id=admin_user_id,
            name=backup_data.name,
            description=backup_data.description,
            backup_type=BackupType.USER,
            storage_path=storage_path,
            status=BackupStatus.PENDING,
            expires_at=backup_data.expires_at,
            created_at=datetime.now(timezone.utc)
        )
        
        self.session.add(backup)
        self.session.commit()
        self.session.refresh(backup)
        
        # Queue backup processing task
        from app.api.tasks.user_backup import process_user_backup
        process_user_backup.delay(backup.id, {
            "include_files": True,
            "include_annotations": True,
            "include_runs": True
        })
        
        logger.info(f"User backup {backup.id} created and queued for processing")
        return backup

    async def execute_user_backup(
        self,
        backup_id: int,
        backup_options: Dict[str, Any]
    ) -> bool:
        """
        Execute the actual user backup process.
        
        This method:
        1. Collects all user data (infospaces, assets, annotations, etc.)
        2. Creates individual packages for each infospace
        3. Combines everything into a master user backup ZIP
        4. Uploads to storage and updates backup record
        
        Args:
            backup_id: ID of the backup to process
            backup_options: Options for backup creation
            
        Returns:
            True if successful, False otherwise
        """
        logger.info(f"Executing user backup {backup_id}")
        
        backup = self.session.get(UserBackup, backup_id)
        if not backup:
            logger.error(f"User backup {backup_id} not found")
            return False
        
        try:
            # Get target user and all their data
            target_user = self.session.get(User, backup.target_user_id)
            if not target_user:
                raise ValueError(f"Target user {backup.target_user_id} not found")
            
            # Get all user's infospaces
            infospaces_query = select(Infospace).where(Infospace.owner_id == target_user.id)
            infospaces = list(self.session.exec(infospaces_query))
            
            # Create temporary directory for backup processing
            import tempfile
            with tempfile.TemporaryDirectory() as temp_dir:
                user_backup_dir = os.path.join(temp_dir, f"user_{target_user.id}_backup")
                os.makedirs(user_backup_dir, exist_ok=True)
                
                # Create user metadata
                user_metadata = {
                    "user_id": target_user.id,
                    "email": target_user.email,
                    "full_name": getattr(target_user, 'full_name', target_user.email),
                    "is_active": target_user.is_active,
                    "is_superuser": target_user.is_superuser,
                    "backup_created_at": datetime.now(timezone.utc).isoformat(),
                    "source_instance_id": self.source_instance_id,
                    "infospace_count": len(infospaces)
                }
                
                # Save user metadata
                with open(os.path.join(user_backup_dir, "user_metadata.json"), "w") as f:
                    json.dump(user_metadata, f, indent=2)
                
                # Track statistics
                total_assets = 0
                total_schemas = 0
                total_runs = 0
                total_annotations = 0
                total_datasets = 0
                
                # Create PackageBuilder for each infospace
                infospace_service = InfospaceService(self.session, self.settings, self.storage_provider)
                infospaces_dir = os.path.join(user_backup_dir, "infospaces")
                os.makedirs(infospaces_dir, exist_ok=True)
                
                for infospace in infospaces:
                    logger.info(f"Backing up infospace {infospace.id}: {infospace.name}")
                    
                    try:
                        # Export infospace to a package
                        package = await infospace_service.export_infospace(
                            infospace_id=infospace.id,
                            user_id=backup.created_by_user_id,
                            include_sources=True,
                            include_schemas=True,
                            include_runs=backup_options.get("include_runs", True),
                            include_datasets=backup_options.get("include_datasets", True),
                            include_assets_for_sources=backup_options.get("include_files", True),
                            include_annotations_for_runs=backup_options.get("include_annotations", True)
                        )
                        
                        # Serialize package to ZIP file in infospaces directory
                        infospace_backup_path = os.path.join(
                            infospaces_dir, 
                            f"infospace_{infospace.id}_{infospace.name.replace(' ', '_')}.zip"
                        )
                        package.to_zip(infospace_backup_path)
                        
                        # Update statistics
                        # Get counts for this infospace
                        assets_count = self.session.exec(
                            select(func.count()).select_from(Asset).where(Asset.infospace_id == infospace.id)
                        ).one()
                        schemas_count = self.session.exec(
                            select(func.count()).select_from(AnnotationSchema).where(AnnotationSchema.infospace_id == infospace.id)
                        ).one()
                        runs_count = self.session.exec(
                            select(func.count()).select_from(AnnotationRun).where(AnnotationRun.infospace_id == infospace.id)
                        ).one()
                        annotations_count = self.session.exec(
                            select(func.count()).select_from(Annotation).where(Annotation.infospace_id == infospace.id)
                        ).one()
                        datasets_count = self.session.exec(
                            select(func.count()).select_from(Dataset).where(Dataset.infospace_id == infospace.id)
                        ).one()
                        
                        total_assets += assets_count
                        total_schemas += schemas_count
                        total_runs += runs_count
                        total_annotations += annotations_count
                        total_datasets += datasets_count
                        
                    except Exception as e:
                        logger.error(f"Failed to backup infospace {infospace.id}: {e}")
                        # Continue with other infospaces
                
                # Create master backup ZIP
                master_backup_path = os.path.join(temp_dir, f"user_{target_user.id}_complete_backup.zip")
                with zipfile.ZipFile(master_backup_path, 'w', zipfile.ZIP_DEFLATED) as zipf:
                    for root, dirs, files in os.walk(user_backup_dir):
                        for file in files:
                            file_path = os.path.join(root, file)
                            arcname = os.path.relpath(file_path, user_backup_dir)
                            zipf.write(file_path, arcname)
                
                # Calculate file size and hash
                file_size = os.path.getsize(master_backup_path)
                content_hash = self._calculate_file_hash(master_backup_path)
                
                # Upload to storage
                with open(master_backup_path, 'rb') as f:
                    file_bytes = f.read()
                    await self.storage_provider.upload_from_bytes(
                        file_bytes,
                        backup.storage_path,
                        filename=f"user_backup_{backup.target_user_id}.zip",
                        content_type='application/zip'
                    )
                
                # Update backup record
                backup.status = BackupStatus.COMPLETED
                backup.completed_at = datetime.now(timezone.utc)
                backup.file_size_bytes = file_size
                backup.content_hash = content_hash
                backup.included_infospaces = len(infospaces)
                backup.included_assets = total_assets
                backup.included_schemas = total_schemas
                backup.included_runs = total_runs
                backup.included_annotations = total_annotations
                backup.included_datasets = total_datasets
                
                self.session.add(backup)
                self.session.commit()
                
                logger.info(f"User backup {backup_id} completed successfully")
                return True
                
        except Exception as e:
            logger.error(f"User backup {backup_id} failed: {e}", exc_info=True)
            
            # Update backup record with error
            backup.status = BackupStatus.FAILED
            backup.error_message = str(e)
            backup.completed_at = datetime.now(timezone.utc)
            
            self.session.add(backup)
            self.session.commit()
            
            return False

    def get_user_backups(
        self,
        admin_user_id: int,
        target_user_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[UserBackup], int]:
        """
        Get user backups visible to an admin.
        
        Args:
            admin_user_id: ID of the admin requesting backups
            target_user_id: Optional filter by specific target user
            skip: Number of records to skip
            limit: Maximum number of records to return
            
        Returns:
            Tuple of (backups, total_count)
        """
        logger.info(f"Getting user backups for admin {admin_user_id}")
        
        # Build query
        query = select(UserBackup)
        
        if target_user_id:
            query = query.where(UserBackup.target_user_id == target_user_id)
        
        # Get total count
        count_query = select(func.count()).select_from(query.subquery())
        total_count = self.session.exec(count_query).one()
        
        # Get backups with pagination
        query = query.offset(skip).limit(limit).order_by(UserBackup.created_at.desc())
        backups = list(self.session.exec(query))
        
        return backups, total_count

    async def restore_user_backup(
        self,
        backup_id: int,
        admin_user_id: int,
        restore_request: UserBackupRestoreRequest
    ) -> User:
        """
        Restore a user from a backup.
        
        This creates a new user account and imports all their infospaces.
        
        Args:
            backup_id: ID of the backup to restore
            admin_user_id: ID of the admin performing the restore
            restore_request: Restore configuration
            
        Returns:
            The restored User object
            
        Raises:
            HTTPException: If restore fails
        """
        logger.info(f"Restoring user backup {backup_id} by admin {admin_user_id}")
        
        backup = self.session.get(UserBackup, backup_id)
        if not backup or backup.status != BackupStatus.COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backup not found or not ready for restore"
            )
        
        try:
            # Download backup file
            import tempfile
            with tempfile.TemporaryDirectory() as temp_dir:
                backup_file_path = os.path.join(temp_dir, "user_backup.zip")
                
                # Download from storage
                await self.storage_provider.download_file(backup.storage_path, backup_file_path)
                
                # Extract backup
                extract_dir = os.path.join(temp_dir, "extracted")
                with zipfile.ZipFile(backup_file_path, 'r') as zipf:
                    zipf.extractall(extract_dir)
                
                # Read user metadata
                user_metadata_path = os.path.join(extract_dir, "user_metadata.json")
                with open(user_metadata_path, 'r') as f:
                    user_metadata = json.load(f)
                
                # Create new user or update existing
                target_email = restore_request.target_user_email or user_metadata["email"]
                
                # Check if user already exists
                existing_user = self.session.exec(
                    select(User).where(User.email == target_email)
                ).first()
                
                if existing_user and restore_request.conflict_strategy == "skip":
                    raise HTTPException(
                        status_code=status.HTTP_409_CONFLICT,
                        detail=f"User with email {target_email} already exists"
                    )
                
                if existing_user and restore_request.conflict_strategy == "overwrite":
                    restored_user = existing_user
                else:
                    # Create new user
                    restored_user = User(
                        email=target_email,
                        hashed_password="",  # Will need to be set separately
                        is_active=user_metadata.get("is_active", True),
                        is_superuser=False,  # For security, don't restore superuser status
                        full_name=user_metadata.get("full_name")
                    )
                    
                    self.session.add(restored_user)
                    self.session.commit()
                    self.session.refresh(restored_user)
                
                # Restore infospaces
                infospaces_dir = os.path.join(extract_dir, "infospaces")
                if os.path.exists(infospaces_dir):
                    infospace_service = InfospaceService(self.session, self.settings, self.storage_provider)
                    
                    for infospace_file in os.listdir(infospaces_dir):
                        if infospace_file.endswith('.zip'):
                            infospace_path = os.path.join(infospaces_dir, infospace_file)
                            
                            try:
                                # Import infospace for the restored user
                                await infospace_service.import_infospace(
                                    package_path=infospace_path,
                                    user_id=restored_user.id,
                                    import_options={
                                        "conflict_strategy": restore_request.conflict_strategy,
                                        "preserve_uuids": False  # Generate new UUIDs
                                    }
                                )
                                logger.info(f"Restored infospace from {infospace_file}")
                                
                            except Exception as e:
                                logger.error(f"Failed to restore infospace {infospace_file}: {e}")
                                # Continue with other infospaces
                
                logger.info(f"User backup {backup_id} restored successfully as user {restored_user.id}")
                return restored_user
                
        except Exception as e:
            logger.error(f"User backup restore {backup_id} failed: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to restore user backup: {str(e)}"
            )

    def _calculate_file_hash(self, file_path: str) -> str:
        """Calculate SHA-256 hash of a file."""
        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256_hash.update(chunk)
        return sha256_hash.hexdigest()

    async def delete_user_backup(
        self,
        backup_id: int,
        admin_user_id: int
    ) -> bool:
        """
        Delete a user backup and its files.
        
        Args:
            backup_id: ID of the backup to delete
            admin_user_id: ID of the admin performing the deletion
            
        Returns:
            True if successful
            
        Raises:
            HTTPException: If deletion fails
        """
        logger.info(f"Deleting user backup {backup_id} by admin {admin_user_id}")
        
        backup = self.session.get(UserBackup, backup_id)
        if not backup:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backup not found"
            )
        
        try:
            # Delete file from storage
            if backup.storage_path:
                await self.storage_provider.delete_file_async(backup.storage_path)
            
            # Delete database record
            self.session.delete(backup)
            self.session.commit()
            
            logger.info(f"User backup {backup_id} deleted successfully")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete user backup {backup_id}: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete backup: {str(e)}"
            )

    async def cleanup_expired_user_backups(self) -> Dict[str, int]:
        """
        Clean up expired user backups.
        
        Returns:
            Dict with cleanup statistics
        """
        logger.info("Starting cleanup of expired user backups")
        
        expired_backups = self.session.exec(
            select(UserBackup).where(
                UserBackup.expires_at.is_not(None),
                UserBackup.expires_at < datetime.now(timezone.utc)
            )
        ).all()
        
        deleted_count = 0
        failed_count = 0
        
        for backup in expired_backups:
            try:
                await self.delete_user_backup(backup.id, backup.created_by_user_id)
                deleted_count += 1
            except Exception as e:
                logger.error(f"Failed to cleanup user backup {backup.id}: {e}")
                failed_count += 1
        
        logger.info(f"User backup cleanup completed: {deleted_count} deleted, {failed_count} failed")
        
        return {
            "deleted_count": deleted_count,
            "failed_count": failed_count,
            "total_processed": len(expired_backups)
        } 