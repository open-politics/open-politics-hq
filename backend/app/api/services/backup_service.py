import logging
import os
import secrets
import hashlib
from typing import List, Optional, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select, func
from fastapi import HTTPException, status

from app.models import (
    InfospaceBackup, 
    BackupType, 
    BackupStatus,
    Infospace,
    User,
    ResourceType
)
from app.schemas import (
    InfospaceBackupCreate, 
    InfospaceBackupUpdate,
    BackupRestoreRequest
)
from app.api.services.service_utils import validate_infospace_access
from app.api.services.package_service import PackageBuilder, PackageImporter, DataPackage, PackageMetadata
from app.api.providers.base import StorageProvider
from app.core.config import AppSettings

logger = logging.getLogger(__name__)

class BackupService:
    """
    Service for managing user-controlled infospace backups.
    
    Leverages the existing PackageBuilder/PackageImporter infrastructure
    to provide a robust backup and restore system at the infospace level.
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
        logger.info("BackupService initialized")

    def create_backup(
        self,
        infospace_id: int,
        user_id: int,
        backup_data: InfospaceBackupCreate
    ) -> InfospaceBackup:
        """
        Create a new backup of an infospace.
        
        Args:
            infospace_id: ID of the infospace to backup
            user_id: ID of the user creating the backup
            backup_data: Backup configuration and metadata
            
        Returns:
            The created backup record (status will be CREATING initially)
        """
        logger.info(f"Creating backup '{backup_data.name}' for infospace {infospace_id} by user {user_id}")
        
        # Validate access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Generate storage path
        storage_path = f"backups/infospace_{infospace_id}/{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{secrets.token_hex(8)}.zip"
        
        # Create backup record
        backup = InfospaceBackup(
            infospace_id=infospace_id,
            user_id=user_id,
            name=backup_data.name,
            description=backup_data.description,
            backup_type=BackupType(backup_data.backup_type),
            storage_path=storage_path,
            expires_at=backup_data.expires_at,
            status=BackupStatus.PENDING
        )
        
        self.session.add(backup)
        self.session.commit()
        self.session.refresh(backup)
        
        # Trigger async backup creation
        from app.api.tasks.backup import process_infospace_backup
        process_infospace_backup.delay(backup.id, backup_data.model_dump())
        
        logger.info(f"Backup record created with ID {backup.id}, queued for processing")
        return backup

    async def execute_backup(
        self,
        backup_id: int,
        backup_options: Dict[str, Any]
    ) -> bool:
        """
        Execute the actual backup creation (called by Celery task).
        
        Args:
            backup_id: ID of the backup record
            backup_options: Options from InfospaceBackupCreate
            
        Returns:
            True if successful, False otherwise
        """
        backup = self.session.get(InfospaceBackup, backup_id)
        if not backup:
            logger.error(f"Backup {backup_id} not found")
            return False
            
        try:
            logger.info(f"Executing backup {backup_id} for infospace {backup.infospace_id}")
            
            # Use InfospaceService to create the backup package
            from app.api.services.infospace_service import InfospaceService
            infospace_service = InfospaceService(
                session=self.session,
                settings=self.settings,
                storage_provider=self.storage_provider
            )
            
            # Create infospace package with specified options
            package = await infospace_service.export_infospace(
                infospace_id=backup.infospace_id,
                user_id=backup.user_id,
                include_sources=backup_options.get("include_sources", True),
                include_schemas=backup_options.get("include_schemas", True), 
                include_runs=backup_options.get("include_runs", True),
                include_datasets=backup_options.get("include_datasets", True),
                include_assets_for_sources=True,
                include_annotations_for_runs=backup_options.get("include_annotations", True)
            )
            
            # Create temporary file for the package
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as temp_file:
                temp_path = temp_file.name
                
            # Write package to temporary file
            package.to_zip(temp_path)
            
            # Calculate file size and hash
            file_size = os.path.getsize(temp_path)
            file_hash = self._calculate_file_hash(temp_path)
            
            # Upload to storage
            with open(temp_path, 'rb') as f:
                await self.storage_provider.upload_from_bytes(
                    f.read(), 
                    backup.storage_path,
                    filename=f"backup_{backup.uuid}.zip",
                    content_type="application/zip"
                )
            
            # Update backup record with success info
            backup.status = BackupStatus.COMPLETED
            backup.completed_at = datetime.now(timezone.utc)
            backup.file_size_bytes = file_size
            backup.content_hash = file_hash
            
            # Update content summary
            content = package.content
            backup.included_sources = len(content.get("sources_content", []))
            backup.included_schemas = len(content.get("annotation_schemas_content", []))
            backup.included_runs = len(content.get("annotation_runs_content", []))
            backup.included_datasets = len(content.get("datasets_content", []))
            
            # Count total assets across all sources
            total_assets = 0
            for source_content in content.get("sources_content", []):
                if source_content.get("source", {}).get("assets"):
                    total_assets += len(source_content["source"]["assets"])
            backup.included_assets = total_assets
            
            self.session.add(backup)
            self.session.commit()
            
            # Cleanup temporary file
            os.unlink(temp_path)
            
            logger.info(f"Backup {backup_id} completed successfully. Size: {file_size} bytes, Assets: {total_assets}")
            return True
            
        except Exception as e:
            logger.error(f"Backup {backup_id} failed: {e}", exc_info=True)
            backup.status = BackupStatus.FAILED
            backup.error_message = str(e)
            self.session.add(backup)
            self.session.commit()
            return False

    def get_user_backups(
        self,
        user_id: int,
        infospace_id: Optional[int] = None,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[InfospaceBackup], int]:
        """
        Get backups for a user, optionally filtered by infospace.
        
        Args:
            user_id: ID of the user
            infospace_id: Optional infospace filter
            skip: Number of records to skip
            limit: Maximum records to return
            
        Returns:
            Tuple of (backups, total_count)
        """
        query = select(InfospaceBackup).where(InfospaceBackup.user_id == user_id)
        
        if infospace_id:
            # Validate access to the infospace
            validate_infospace_access(self.session, infospace_id, user_id)
            query = query.where(InfospaceBackup.infospace_id == infospace_id)
        
        # Get total count
        count_query = select(func.count(InfospaceBackup.id)).where(InfospaceBackup.user_id == user_id)
        if infospace_id:
            count_query = count_query.where(InfospaceBackup.infospace_id == infospace_id)
        total_count = self.session.exec(count_query).one()
        
        # Get paginated results
        query = query.order_by(InfospaceBackup.created_at.desc()).offset(skip).limit(limit)
        backups = list(self.session.exec(query))
        
        return backups, total_count

    def get_backup(
        self,
        backup_id: int,
        user_id: int
    ) -> Optional[InfospaceBackup]:
        """
        Get a specific backup by ID with access validation.
        
        Args:
            backup_id: ID of the backup
            user_id: ID of the requesting user
            
        Returns:
            The backup if found and accessible, None otherwise
        """
        backup = self.session.get(InfospaceBackup, backup_id)
        if not backup:
            return None
            
        # Validate user has access to this backup's infospace
        try:
            validate_infospace_access(self.session, backup.infospace_id, user_id)
            return backup
        except HTTPException:
            return None

    def update_backup(
        self,
        backup_id: int,
        user_id: int,
        update_data: InfospaceBackupUpdate
    ) -> Optional[InfospaceBackup]:
        """
        Update backup metadata.
        
        Args:
            backup_id: ID of the backup to update
            user_id: ID of the user making the update
            update_data: New backup data
            
        Returns:
            Updated backup or None if not found/accessible
        """
        backup = self.get_backup(backup_id, user_id)
        if not backup:
            return None
            
        # Update fields
        update_fields = update_data.model_dump(exclude_unset=True)
        for field, value in update_fields.items():
            setattr(backup, field, value)
            
        self.session.add(backup)
        self.session.commit()
        self.session.refresh(backup)
        
        logger.info(f"Updated backup {backup_id}")
        return backup

    async def delete_backup(
        self,
        backup_id: int,
        user_id: int
    ) -> bool:
        """
        Delete a backup and its associated file.
        
        Args:
            backup_id: ID of the backup to delete
            user_id: ID of the user requesting deletion
            
        Returns:
            True if successful, False otherwise
        """
        backup = self.get_backup(backup_id, user_id)
        if not backup:
            return False
            
        try:
            # Delete file from storage
            await self.storage_provider.delete_file(backup.storage_path)
            
            # Delete database record
            self.session.delete(backup)
            self.session.commit()
            
            logger.info(f"Deleted backup {backup_id}")
            return True
            
        except Exception as e:
            logger.error(f"Failed to delete backup {backup_id}: {e}", exc_info=True)
            return False

    async def restore_backup(
        self,
        restore_request: BackupRestoreRequest,
        user_id: int
    ) -> Infospace:
        """
        Restore an infospace from a backup.
        
        Args:
            restore_request: Restore configuration
            user_id: ID of the user performing the restore
            
        Returns:
            The newly created infospace
            
        Raises:
            HTTPException: If backup not found or restore fails
        """
        backup = self.get_backup(restore_request.backup_id, user_id)
        if not backup or backup.status != BackupStatus.COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backup not found or not ready for restore"
            )
            
        logger.info(f"Restoring backup {backup.id} for user {user_id}")
        
        try:
            # Download backup file from storage
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as temp_file:
                temp_path = temp_file.name
                
            await self.storage_provider.download_file(backup.storage_path, temp_path)
            
            # Load package from backup file
            package = DataPackage.from_zip(temp_path)
            
            # Create new infospace name
            original_name = package.content.get("infospace_details", {}).get("name", "Restored Infospace")
            new_name = restore_request.target_infospace_name or f"{original_name} (Restored {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})"
            
            # Use InfospaceService to import the backup
            from app.api.services.infospace_service import InfospaceService
            infospace_service = InfospaceService(
                session=self.session,
                settings=self.settings,
                storage_provider=self.storage_provider
            )
            
            # Modify the package content to use the new name
            package.content["infospace_details"]["name"] = new_name
            
            # Save modified package to temporary file
            package.to_zip(temp_path)
            
            # Import the infospace (import_infospace handles cleanup)
            restored_infospace = await infospace_service.import_infospace(
                user_id=user_id,
                filepath=temp_path
            )
            
            # No need to cleanup - import_infospace already handles this
            
            logger.info(f"Successfully restored backup {backup.id} to new infospace {restored_infospace.id}")
            return restored_infospace
            
        except Exception as e:
            logger.error(f"Failed to restore backup {backup.id}: {e}", exc_info=True)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Restore failed: {str(e)}"
            )

    def create_share_link(
        self,
        backup_id: int,
        user_id: int,
        expiration_hours: Optional[int] = None
    ) -> str:
        """
        Create a shareable link for a backup.
        
        Args:
            backup_id: ID of the backup to share
            user_id: ID of the user creating the share
            expiration_hours: Hours until link expires
            
        Returns:
            Share token for accessing the backup
        """
        backup = self.get_backup(backup_id, user_id)
        if not backup or backup.status != BackupStatus.COMPLETED:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Backup not found or not ready for sharing"
            )
            
        # Generate share token
        share_token = secrets.token_urlsafe(32)
        
        # Update backup with sharing info
        backup.is_shareable = True
        backup.share_token = share_token
        
        if expiration_hours:
            backup.expires_at = datetime.now(timezone.utc) + timedelta(hours=expiration_hours)
            
        self.session.add(backup)
        self.session.commit()
        
        logger.info(f"Created share link for backup {backup_id}")
        return share_token

    def _calculate_file_hash(self, file_path: str) -> str:
        """Calculate SHA-256 hash of a file."""
        hash_sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                hash_sha256.update(chunk)
        return hash_sha256.hexdigest()

    async def cleanup_expired_backups(self) -> int:
        """
        Clean up expired backups (admin function).
        
        Returns:
            Number of backups cleaned up
        """
        expired_backups = self.session.exec(
            select(InfospaceBackup).where(
                InfospaceBackup.expires_at < datetime.now(timezone.utc),
                InfospaceBackup.status == BackupStatus.COMPLETED
            )
        ).all()
        
        cleaned_count = 0
        for backup in expired_backups:
            try:
                await self.storage_provider.delete_file(backup.storage_path)
                backup.status = BackupStatus.EXPIRED
                self.session.add(backup)
                cleaned_count += 1
            except Exception as e:
                logger.error(f"Failed to clean up expired backup {backup.id}: {e}")
                
        if cleaned_count > 0:
            self.session.commit()
            logger.info(f"Cleaned up {cleaned_count} expired backups")
            
        return cleaned_count 