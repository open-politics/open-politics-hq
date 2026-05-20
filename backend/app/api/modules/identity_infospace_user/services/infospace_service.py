"""
Infospace service.

This module contains the business logic for infospace operations,
abstracting the underlying implementation details from the API layer.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional, TYPE_CHECKING, Tuple
from datetime import datetime, timezone
import uuid

# Removed Depends
from sqlalchemy import text
from sqlmodel import Session, select, func

from app.models import (
    Infospace,
    User,
    Source,
    Dataset,
    AnnotationSchema,
    AnnotationRun,
    Asset,
    Task,
    Package,
    ResourceType,
    Annotation,
    ShareableLink,
    RunSchemaLink,
    Bundle,
    InfospaceBackup
)
from app.api.modules.identity_infospace_user.models import InfospaceCollaborator, CollaboratorRole

# Add import for Infospace schemas from app.schemas
from app.schemas import (
    InfospaceCreate,
    InfospaceUpdate,
    InfospaceRead
)

# ADDED imports for StorageProvider and settings
from app.api.modules.foundation_service_providers.base import StorageProvider
from app.core.config import AppSettings # Changed from settings to AppSettings
# Moved ShareableService import under TYPE_CHECKING
if TYPE_CHECKING:
    from app.api.modules.sharing.services.shareable_service import ShareableService

# Removed SessionDep import
logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Removed old service factory function

class InfospaceService:
    """
    Service for handling infospace operations.
    """

    def __init__(self, session: Session, settings: AppSettings, storage_provider: Optional[StorageProvider] = None):
        """Initialize with a database session, settings, and optional storage provider."""
        self.session = session
        self.settings = settings # Store AppSettings
        self.storage_provider = storage_provider
        self.source_instance_id = self.settings.INSTANCE_ID
        if storage_provider:
            logger.info(f"InfospaceService initialized with StorageProvider. Source Instance ID: {self.source_instance_id}")
        else:
            logger.info("InfospaceService initialized WITHOUT StorageProvider (export/import functionality will be limited).")

    def create_infospace(
        self,
        user_id: int,
        infospace_in: InfospaceCreate, # Use InfospaceCreate from models.py
    ) -> Infospace:
        """Create a new infospace.

        Atomically creates a "General" canon and wires it as
        ``infospace.default_canon_id``. Every infospace gets exactly one
        General canon at creation; users can create role-specific canons
        (geo, project-specific, archival) on demand thereafter.
        """
        from app.api.modules.graph.models import Canon, CanonRole

        logger.info(f"Service: Creating infospace '{infospace_in.name}' for user {user_id}")
        db_infospace = Infospace.model_validate(infospace_in)
        db_infospace.owner_id = user_id

        self.session.add(db_infospace)
        self.session.flush()  # need infospace.id for Canon FK

        general_canon = Canon(
            infospace_id=db_infospace.id,
            name="General",
            description="Default vocabulary for this infospace.",
            role=CanonRole.GENERAL,
        )
        self.session.add(general_canon)
        self.session.flush()  # need canon.id

        db_infospace.default_canon_id = general_canon.id
        self.session.add(db_infospace)
        self.session.commit()
        self.session.refresh(db_infospace)
        logger.info(
            f"Service: Infospace '{db_infospace.name}' (ID: {db_infospace.id}) "
            f"created for user {user_id} with General canon {general_canon.id}."
        )
        return db_infospace

    def get_infospace(
        self,
        infospace_id: int,
        user_id: int # user_id is mandatory for validation
    ) -> Optional[Infospace]:
        """Get a specific infospace by ID."""
        logger.debug(f"Service: Getting infospace {infospace_id} for user {user_id}")
        infospace = self.session.get(Infospace, infospace_id)
        return infospace

    def list_infospaces(
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[Tuple[Infospace, str, bool]], int]:
        """Get all infospaces for a user (owned or collaborated) with role context.

        Returns:
            ([(infospace, role_str, is_owner), ...], total_count)
        """
        logger.debug(f"Service: Listing infospaces for user {user_id}")

        # Single LEFT JOIN — owned infospaces have NULL collab row, collaborated have one.
        _filter = (
            (Infospace.owner_id == user_id)
            | (InfospaceCollaborator.id.isnot(None))
        )
        statement = (
            select(Infospace, InfospaceCollaborator.role)
            .outerjoin(
                InfospaceCollaborator,
                (InfospaceCollaborator.infospace_id == Infospace.id)
                & (InfospaceCollaborator.user_id == user_id),
            )
            .where(_filter)
            .offset(skip)
            .limit(limit)
            .order_by(Infospace.name)
        )
        rows = list(self.session.exec(statement).all())

        results: List[Tuple[Infospace, str, bool]] = []
        for infospace, collab_role in rows:
            is_owner = infospace.owner_id == user_id
            role = "owner" if is_owner else (
                collab_role.value if hasattr(collab_role, "value") else collab_role
            )
            results.append((infospace, role, is_owner))

        count_statement = (
            select(func.count(Infospace.id))
            .outerjoin(
                InfospaceCollaborator,
                (InfospaceCollaborator.infospace_id == Infospace.id)
                & (InfospaceCollaborator.user_id == user_id),
            )
            .where(_filter)
        )
        total_count = self.session.exec(count_statement).one_or_none() or 0

        logger.debug(f"Service: Found {len(results)} infospaces (total {total_count}) for user {user_id}.")
        return results, total_count

    def update_infospace(
        self,
        infospace_id: int,
        user_id: int,
        infospace_in: InfospaceUpdate # Use InfospaceUpdate from models.py
    ) -> Optional[Infospace]:
        """Update an infospace."""
        logger.info(f"Service: Updating infospace {infospace_id} by user {user_id}")
        db_infospace = self.get_infospace(infospace_id, user_id) # This also validates access
        if not db_infospace:
            return None # Should be caught by get_infospace if access is denied/not found

        update_data = infospace_in.model_dump(exclude_unset=True)
        if not update_data:
            logger.info(f"Service: No update data provided for infospace {infospace_id}.")
            return db_infospace # No changes to apply
            
        for key, value in update_data.items():
            setattr(db_infospace, key, value)
        # db_infospace.updated_at = datetime.now(timezone.utc) # Model handles this with onupdate

        self.session.add(db_infospace)
        self.session.commit()
        self.session.refresh(db_infospace)
        logger.info(f"Service: Infospace {infospace_id} updated.")
        return db_infospace

    def delete_infospace(
        self,
        infospace_id: int,
        user_id: int,
    ) -> bool:
        """Delete an infospace and all its related entities in the correct order."""
        logger.info(f"Service: Attempting to delete infospace {infospace_id} by user {user_id}")
        db_infospace = self.get_infospace(infospace_id, user_id) # Validates access
        if not db_infospace:
            return False
        
        try:
            logger.info(f"Service: Starting cascade deletion for infospace {infospace_id}")
            
            # 0. First, clean up any corrupted backup records that might cause constraint violations
            self._cleanup_orphaned_backup_records()
            
            # 1. Delete annotations first (they reference runs, schemas, and assets)
            annotations = self.session.exec(
                select(Annotation).where(Annotation.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(annotations)} annotations")
            for annotation in annotations:
                self.session.delete(annotation)
            
            # 2. Delete annotation runs (they reference schemas via link table)
            runs = self.session.exec(
                select(AnnotationRun).where(AnnotationRun.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(runs)} annotation runs")
            for run in runs:
                # Delete run aggregates first (they reference runs)
                from app.models import RunAggregate
                run_aggregates = self.session.exec(
                    select(RunAggregate).where(RunAggregate.run_id == run.id)
                ).all()
                for aggregate in run_aggregates:
                    self.session.delete(aggregate)
                
                # Delete run-schema links
                run_schema_links = self.session.exec(
                    select(RunSchemaLink).where(RunSchemaLink.run_id == run.id)
                ).all()
                for link in run_schema_links:
                    self.session.delete(link)
                
                # Then delete the run itself
                self.session.delete(run)
            
            # 3. Delete annotation schemas
            schemas = self.session.exec(
                select(AnnotationSchema).where(AnnotationSchema.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(schemas)} annotation schemas")
            for schema in schemas:
                self.session.delete(schema)
            
            # 4. Delete asset-bundle links and bundles
            bundles = self.session.exec(
                select(Bundle).where(Bundle.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(bundles)} bundles")
            for bundle in bundles:
                # Remove this bundle from all assets' bundle_ids arrays
                self.session.execute(
                    text("UPDATE asset SET bundle_ids = NULLIF(array_remove(bundle_ids, :bid), ARRAY[]::int[]) WHERE bundle_ids @> ARRAY[:bid]::int[]"),
                    {"bid": bundle.id},
                )
                
                # Clear root_bundle_id from IngestionJob records
                from app.models import IngestionJob
                jobs = self.session.exec(
                    select(IngestionJob).where(IngestionJob.root_bundle_id == bundle.id)
                ).all()
                for job in jobs:
                    job.root_bundle_id = None
                
                # Then delete the bundle itself
                self.session.delete(bundle)
            
            # 5. Delete assets (they reference sources)
            assets = self.session.exec(
                select(Asset).where(Asset.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(assets)} assets")
            for asset in assets:
                self.session.delete(asset)
            
            # 6. Delete sources
            sources = self.session.exec(
                select(Source).where(Source.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(sources)} sources")
            for source in sources:
                self.session.delete(source)
            
            # 7. Delete datasets
            datasets = self.session.exec(
                select(Dataset).where(Dataset.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(datasets)} datasets")
            for dataset in datasets:
                self.session.delete(dataset)
            
            # 8. Delete tasks
            tasks = self.session.exec(
                select(Task).where(Task.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(tasks)} tasks")
            for task in tasks:
                self.session.delete(task)
            
            # 9. Delete packages
            packages = self.session.exec(
                select(Package).where(Package.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(packages)} packages")
            for package in packages:
                self.session.delete(package)
            
            # 10. Delete shareable links (optional infospace_id, but clean up if present)
            shareable_links = self.session.exec(
                select(ShareableLink).where(ShareableLink.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(shareable_links)} shareable links")
            for link in shareable_links:
                self.session.delete(link)
            
            # 11. Delete chat conversations and their messages
            from app.models import ChatConversation, ChatConversationMessage
            conversations = self.session.exec(
                select(ChatConversation).where(ChatConversation.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(conversations)} chat conversations")
            for conversation in conversations:
                # Delete all messages first
                messages = self.session.exec(
                    select(ChatConversationMessage).where(ChatConversationMessage.conversation_id == conversation.id)
                ).all()
                for message in messages:
                    self.session.delete(message)
                # Then delete the conversation
                self.session.delete(conversation)
            
            # 12. Delete infospace backups (optional infospace_id, but clean up if present)
            infospace_backups = self.session.exec(
                select(InfospaceBackup).where(InfospaceBackup.infospace_id == infospace_id)
            ).all()
            logger.info(f"Service: Deleting {len(infospace_backups)} infospace backups")
            for backup in infospace_backups:
                # Try to clean up storage file if storage provider is available
                if self.storage_provider and backup.storage_path:
                    try:
                        # Note: This is a sync call, but most storage providers handle this
                        import asyncio
                        if hasattr(self.storage_provider, 'delete_file'):
                            # Try async delete if available
                            try:
                                loop = asyncio.get_event_loop()
                                if loop.is_running():
                                    # If we're in an async context, we can't use asyncio.run()
                                    # Just delete the database record and let cleanup handle storage later
                                    logger.warning(f"Service: Skipping storage cleanup for backup {backup.id} (async context)")
                                else:
                                    asyncio.run(self.storage_provider.delete_file(backup.storage_path))
                                    logger.info(f"Service: Cleaned up storage for backup {backup.id}")
                            except Exception:
                                # Fallback to sync delete if async fails
                                logger.warning(f"Service: Could not clean up storage for backup {backup.id}, will be handled by cleanup job")
                    except Exception as e:
                        logger.warning(f"Service: Failed to clean up storage for backup {backup.id}: {e}")
                
                self.session.delete(backup)
            
            # 13. Finally, delete the infospace itself
            self.session.delete(db_infospace)
            
            # Commit all deletions
            self.session.commit()
            logger.info(f"Service: Successfully deleted infospace {infospace_id} and all related entities")
            return True
            
        except Exception as e:
            # Rollback on any error
            self.session.rollback()
            logger.error(f"Service: Error during cascade deletion of infospace {infospace_id}: {e}", exc_info=True)
            raise e

    def _cleanup_orphaned_backup_records(self):
        """
        Cleans up any InfospaceBackup records that have a null infospace_id.
        This typically happens if the infospace was deleted without its backups.
        """
        logger.info("Service: Starting cleanup of orphaned backup records.")
        try:
            # Find all backup records where infospace_id is null
            orphaned_backups = self.session.exec(
                select(InfospaceBackup).where(InfospaceBackup.infospace_id == None)
            ).all()
            logger.info(f"Service: Found {len(orphaned_backups)} orphaned backup records to delete.")

            for backup in orphaned_backups:
                logger.info(f"Service: Deleting orphaned backup record ID: {backup.id}")
                self.session.delete(backup)
                # If storage path is not null, try to clean up the file
                if self.storage_provider and backup.storage_path:
                    try:
                        if hasattr(self.storage_provider, 'delete_file'):
                            import asyncio
                            if not asyncio.get_event_loop().is_running():
                                asyncio.run(self.storage_provider.delete_file(backup.storage_path))
                                logger.info(f"Service: Cleaned up orphaned storage for backup {backup.id}")
                            else:
                                logger.warning(f"Service: Skipping orphaned storage cleanup for backup {backup.id} (async context)")
                    except Exception as e:
                        logger.warning(f"Service: Could not clean up orphaned storage for backup {backup.id}: {e}")
                self.session.commit() # Commit each deletion to avoid transaction buildup
            logger.info("Service: Finished cleanup of orphaned backup records.")
        except Exception as e:
            logger.error(f"Service: Error during cleanup of orphaned backup records: {e}", exc_info=True)
            self.session.rollback() # Rollback on error

    def ensure_default_infospace(
        self,
        user_id: int,
    ) -> Infospace:
        """Ensure a default infospace exists for the user."""
        statement = select(Infospace).where(
            Infospace.owner_id == user_id # Use owner_id
        ).order_by(Infospace.created_at)
        default_infospace = self.session.exec(statement).first()

        if default_infospace:
            return default_infospace

        infospace_create_data = InfospaceCreate(
            name="Default Infospace",
            description="Your default infospace",
            icon="",
            owner_id=user_id,
        )
        return self.create_infospace(user_id=user_id, infospace_in=infospace_create_data)

    def invite_collaborator(
        self,
        infospace_id: int,
        inviter_user_id: int,
        invitee_email: str,
        role: str = "viewer",
    ) -> InfospaceCollaborator:
        """Invite a user to collaborate on an infospace. Only owner or editor can invite."""
        infospace = self.get_infospace(infospace_id, inviter_user_id)
        if not infospace:
            raise ValueError("Infospace not found")
        # Check inviter is owner or editor
        if infospace.owner_id != inviter_user_id:
            collab = self.session.exec(
                select(InfospaceCollaborator).where(
                    InfospaceCollaborator.infospace_id == infospace_id,
                    InfospaceCollaborator.user_id == inviter_user_id,
                )
            ).first()
            if not collab or collab.role.value not in ("owner", "editor"):
                raise ValueError("Only owner or editor can invite collaborators")
        invitee = self.session.exec(select(User).where(User.email == invitee_email)).first()
        if not invitee:
            raise ValueError(f"User with email {invitee_email} not found")
        if invitee.id == infospace.owner_id:
            raise ValueError("Owner is already a member")
        existing = self.session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == invitee.id,
            )
        ).first()
        if existing:
            existing.role = CollaboratorRole(role) if role in ("owner", "editor", "viewer") else CollaboratorRole.VIEWER
            self.session.add(existing)
            self.session.commit()
            self.session.refresh(existing)
            return existing
        collab = InfospaceCollaborator(
            infospace_id=infospace_id,
            user_id=invitee.id,
            role=CollaboratorRole(role) if role in ("owner", "editor", "viewer") else CollaboratorRole.VIEWER,
        )
        self.session.add(collab)
        self.session.commit()
        self.session.refresh(collab)
        return collab

    def list_collaborators(
        self,
        infospace_id: int,
        user_id: int,
    ) -> List[tuple[Optional[InfospaceCollaborator], User, str]]:
        """List collaborators for an infospace. Returns (collab_or_none, user, role). Owner has role 'owner'."""
        infospace = self.get_infospace(infospace_id, user_id)  # validates access
        result = []
        # Add owner first
        owner = self.session.get(User, infospace.owner_id)
        if owner:
            result.append((None, owner, "owner"))
        # Add collaborators from table
        collabs = list(
            self.session.exec(
                select(InfospaceCollaborator).where(
                    InfospaceCollaborator.infospace_id == infospace_id
                )
            ).all()
        )
        for c in collabs:
            u = self.session.get(User, c.user_id)
            if u:
                result.append((c, u, c.role.value if hasattr(c.role, "value") else c.role))
        return result

    def remove_collaborator(
        self,
        infospace_id: int,
        remover_user_id: int,
        collaborator_user_id: int,
    ) -> bool:
        """Remove a collaborator. Owner can remove anyone; editor can remove viewers."""
        infospace = self.get_infospace(infospace_id, remover_user_id)
        if not infospace:
            return False
        if collaborator_user_id == infospace.owner_id:
            raise ValueError("Cannot remove the owner")
        collab = self.session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == collaborator_user_id,
            )
        ).first()
        if not collab:
            raise ValueError("User is not a collaborator")
        if infospace.owner_id != remover_user_id:
            remover_collab = self.session.exec(
                select(InfospaceCollaborator).where(
                    InfospaceCollaborator.infospace_id == infospace_id,
                    InfospaceCollaborator.user_id == remover_user_id,
                )
            ).first()
            if not remover_collab or remover_collab.role.value != "editor":
                raise ValueError("Only owner or editor can remove collaborators")
            if collab.role.value != "viewer":
                raise ValueError("Editors can only remove viewers")
        self.session.delete(collab)
        self.session.commit()
        return True

    def change_collaborator_role(
        self,
        infospace_id: int,
        changer_user_id: int,
        target_user_id: int,
        new_role: CollaboratorRole,
    ) -> InfospaceCollaborator:
        """Change a collaborator's role. Only owner/setup capability can do this."""
        infospace = self.get_infospace(infospace_id, changer_user_id)
        if not infospace:
            raise ValueError("Infospace not found")
        if target_user_id == infospace.owner_id:
            raise ValueError("Cannot change the owner's role")
        collab = self.session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == target_user_id,
            )
        ).first()
        if not collab:
            raise ValueError("User is not a collaborator")
        collab.role = new_role
        self.session.add(collab)
        self.session.commit()
        self.session.refresh(collab)
        return collab

    def leave_infospace(
        self,
        infospace_id: int,
        user_id: int,
    ) -> bool:
        """Self-removal from an infospace. Owner cannot leave."""
        infospace = self.get_infospace(infospace_id, user_id)
        if not infospace:
            raise ValueError("Infospace not found")
        if user_id == infospace.owner_id:
            raise ValueError("Owner cannot leave the infospace. Transfer ownership or delete it instead.")
        collab = self.session.exec(
            select(InfospaceCollaborator).where(
                InfospaceCollaborator.infospace_id == infospace_id,
                InfospaceCollaborator.user_id == user_id,
            )
        ).first()
        if not collab:
            raise ValueError("You are not a collaborator of this infospace")
        self.session.delete(collab)
        self.session.commit()
        return True

    def get_infospace_stats(
        self,
        infospace_id: int,
        user_id: int
    ) -> Dict[str, Any]:
        """Get statistics about an infospace."""
        logger.debug(f"Service: Getting stats for infospace {infospace_id}, user {user_id}")
        
        infospace = self.get_infospace(infospace_id, user_id) # Validates access
        if not infospace:
            # This case should be handled by get_infospace raising an exception or returning None, 
            # leading to HTTP 403/404 in the route.
            # However, if we want to return a specific structure for "not found/no access" stats:
            return {"error": "Infospace not found or access denied", "asset_count": 0} 

        asset_count = self.session.exec(
            select(func.count(Asset.id))
            .where(Asset.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        schema_count = self.session.exec(
            select(func.count(AnnotationSchema.id))
            .where(AnnotationSchema.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        run_count = self.session.exec(
            select(func.count(AnnotationRun.id))
            .where(AnnotationRun.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        task_count = self.session.exec(
            select(func.count(Task.id))
            .where(Task.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        package_count = self.session.exec(
            select(func.count(Package.id))
            .where(Package.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        dataset_count = self.session.exec(
             select(func.count(Dataset.id))
            .where(Dataset.infospace_id == infospace_id)
        ).one_or_none() or 0
        
        return {
            "asset_count": asset_count,
            "annotation_schema_count": schema_count, # Renamed
            "annotation_run_count": run_count,       # Renamed
            "task_count": task_count,
            "package_count": package_count,
            "dataset_count": dataset_count         # Added
        } 