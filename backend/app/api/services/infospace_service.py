"""
Infospace service.

This module contains the business logic for infospace operations,
abstracting the underlying implementation details from the API layer.
"""
import logging
from typing import Any, Dict, List, Optional, TYPE_CHECKING, Tuple
from datetime import datetime, timezone
# import json # Added for export/import - Removed as it seems unused now directly in this file
# import uuid # Removed as it seems unused now directly in this file
import os
import uuid
import tempfile

# Removed Depends
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
    AssetBundleLink,
    Bundle,
    InfospaceBackup
)

# Add import for Infospace schemas from app.schemas
from app.schemas import (
    InfospaceCreate,
    InfospaceUpdate,
    InfospaceRead
)

# ADDED imports for StorageProvider and settings
from app.api.providers.base import StorageProvider
from app.core.config import AppSettings # Changed from settings to AppSettings
# ADDED imports for Package related classes
from app.api.services.package_service import PackageBuilder, PackageMetadata, DataPackage, PackageImporter
from app.api.services.asset_service import AssetService

# Moved ShareableService import under TYPE_CHECKING
if TYPE_CHECKING:
    from app.api.services.shareable_service import ShareableService

# Removed SessionDep import
# Import the new utility function
from app.api.services.service_utils import validate_infospace_access

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
        """Create a new infospace."""
        logger.info(f"Service: Creating infospace '{infospace_in.name}' for user {user_id}")
        # No need for validate_infospace_access here as we are creating it for the user
        
        db_infospace = Infospace.model_validate(infospace_in) # Use model_validate
        db_infospace.owner_id = user_id # Correct field name for owner
        # Timestamps and UUID should be handled by model defaults

        self.session.add(db_infospace)
        self.session.commit()
        self.session.refresh(db_infospace)
        logger.info(f"Service: Infospace '{db_infospace.name}' (ID: {db_infospace.id}) created for user {user_id}.")
        return db_infospace

    def get_infospace(
        self,
        infospace_id: int,
        user_id: int # user_id is mandatory for validation
    ) -> Optional[Infospace]:
        """Get a specific infospace by ID, ensuring user ownership."""
        logger.debug(f"Service: Getting infospace {infospace_id} for user {user_id}")
        # validate_infospace_access will raise HTTPException if not found or access denied
        infospace = validate_infospace_access(self.session, infospace_id, user_id)
        return infospace

    def list_infospaces( # Renamed from get_user_infospaces for consistency
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> Tuple[List[Infospace], int]:
        """Get all infospaces for a user."""
        logger.debug(f"Service: Listing infospaces for user {user_id}")
        statement = select(Infospace).where(
            Infospace.owner_id == user_id # Use owner_id
        ).offset(skip).limit(limit).order_by(Infospace.name) # Added ordering
        
        infospaces = list(self.session.exec(statement).all())

        count_statement = select(func.count(Infospace.id)).where(Infospace.owner_id == user_id)
        total_count = self.session.exec(count_statement).one_or_none() or 0
        
        logger.debug(f"Service: Found {len(infospaces)} infospaces (total {total_count}) for user {user_id}.")
        return infospaces, total_count

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
                # Delete run-schema links first
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
                # Delete asset-bundle links first
                asset_bundle_links = self.session.exec(
                    select(AssetBundleLink).where(AssetBundleLink.bundle_id == bundle.id)
                ).all()
                for link in asset_bundle_links:
                    self.session.delete(link)
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
            
            # 11. Delete infospace backups (optional infospace_id, but clean up if present)
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
            
            # 12. Finally, delete the infospace itself
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
            icon=""
        )
        return self.create_infospace(user_id=user_id, infospace_in=infospace_create_data)

    async def export_infospace(
        self,
        infospace_id: int,
        user_id: int,
        include_sources: bool = True,
        include_schemas: bool = True,
        include_runs: bool = True,
        include_datasets: bool = True,
        include_assets_for_sources: bool = True,
        include_annotations_for_runs: bool = True,
    ) -> DataPackage: 
        """Export an infospace configuration and its contents as a DataPackage."""
        if not self.storage_provider:
            logger.error("Storage provider not available in InfospaceService; cannot perform package export.")
            raise RuntimeError("Infospace export requires a configured storage provider.")

        infospace = self.get_infospace(infospace_id, user_id)
        if not infospace:
            # get_infospace already raises HTTPException if not found/accessible
            # This is a safeguard, but validate_infospace_access in get_infospace handles it.
            raise ValueError(f"Infospace {infospace_id} not found or not accessible by user {user_id}")

        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider, 
            source_instance_id=self.source_instance_id 
        )

        package_metadata = PackageMetadata(
            package_type=ResourceType.INFOSPACE,
            source_entity_uuid=str(infospace.uuid), # Assuming Infospace has a UUID field now
            source_instance_id=self.source_instance_id,
            description=f"Export of Infospace: {infospace.name} (ID: {infospace.id})",
            created_by=str(user_id)
        )

        infospace_package_content: Dict[str, Any] = {
            "infospace_details": InfospaceRead.model_validate(infospace).model_dump(exclude_none=True),
            "sources_content": [], 
            "annotation_schemas_content": [], # Renamed from annotation_schemes_content
            "annotation_runs_content": [],    # Renamed
            "datasets_content": []
        }

        if include_sources and infospace.sources:
            logger.info(f"Exporting {len(infospace.sources)} Sources for infospace {infospace.id}")
            for ds in infospace.sources:
                try:
                    ds_package = await builder.build_source_package(ds, include_assets=include_assets_for_sources) 
                    infospace_package_content["sources_content"].append(ds_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Source {ds.id} ('{ds.name}') for infospace export: {e}", exc_info=True)

        if include_schemas and infospace.schemas:
            logger.info(f"Exporting {len(infospace.schemas)} AnnotationSchemas for infospace {infospace.id}")
            for schema_item in infospace.schemas:
                try:
                    schema_package = await builder.build_annotation_schema_package(schema_item) # Assuming build_annotation_schema_package
                    infospace_package_content["annotation_schemas_content"].append(schema_package.content)
                except Exception as e:
                    logger.error(f"Failed to package AnnotationSchema {schema_item.id} ('{schema_item.name}') for infospace export: {e}", exc_info=True)
        
        if include_runs and infospace.runs:
            logger.info(f"Exporting {len(infospace.runs)} AnnotationRuns for infospace {infospace.id}")
            for run_item in infospace.runs:
                try:
                    run_package = await builder.build_annotation_run_package(run_item, include_annotations=include_annotations_for_runs) # Changed from include_results_for_jobs
                    infospace_package_content["annotation_runs_content"].append(run_package.content)
                except Exception as e:
                    logger.error(f"Failed to package AnnotationRun {run_item.id} ('{run_item.name}') for infospace export: {e}", exc_info=True)
        
        if include_datasets and infospace.datasets: 
            logger.info(f"Exporting {len(infospace.datasets)} Datasets for infospace {infospace.id}")
            for dataset_item in infospace.datasets:
                try:
                    dataset_package = await builder.build_dataset_package(dataset_item, include_assets=True, include_annotations=True) # Assuming build_dataset_package
                    infospace_package_content["datasets_content"].append(dataset_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Dataset {dataset_item.id} ('{dataset_item.name}') for infospace export: {e}", exc_info=True)

        final_infospace_package = DataPackage(
            metadata=package_metadata,
            content=infospace_package_content,
            files=builder.files 
        )
        logger.info(f"Infospace {infospace.id} package created. Total files to include: {len(builder.files)}.")
        return final_infospace_package

    async def import_infospace(
        self,
        user_id: int,
        filepath: str 
    ) -> Infospace: 
        """Import an infospace from a comprehensive ZIP package."""
        if not self.storage_provider:
            logger.error("Storage provider not available; cannot perform package import.")
            raise RuntimeError("Infospace import requires a configured storage provider.")

        logger.info(f"Starting import of infospace from package file: {filepath} for user {user_id}")

        try:
            main_package = DataPackage.from_zip(filepath)
            if main_package.metadata.package_type != ResourceType.INFOSPACE:
                raise ValueError(f"Invalid package type. Expected '{ResourceType.INFOSPACE.value}', got '{main_package.metadata.package_type}'")

            ws_details = main_package.content.get("infospace_details")
            if not ws_details:
                raise ValueError("Infospace package content is missing 'infospace_details'.")

            new_infospace_name = ws_details.get("name", "Imported Infospace") + f" (Imported {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})"
            
            infospace_create_data = InfospaceCreate(
                name=new_infospace_name,
                description=ws_details.get("description", "Imported infospace"),
                owner_id=user_id,  
                icon=ws_details.get("icon"),
                vector_backend=ws_details.get("vector_backend"),
                embedding_model=ws_details.get("embedding_model"),
                embedding_dim=ws_details.get("embedding_dim"),
                chunk_size=ws_details.get("chunk_size"),
                chunk_overlap=ws_details.get("chunk_overlap"),
                chunk_strategy=ws_details.get("chunk_strategy")
            )
            created_infospace = self.create_infospace(user_id=user_id, infospace_in=infospace_create_data)
            logger.info(f"Created new infospace '{created_infospace.name}' (ID: {created_infospace.id}) for import.")

            # Create AssetService for the importer
            asset_service = AssetService(
                session=self.session,
                storage_provider=self.storage_provider
            )
            
            importer = PackageImporter(
                session=self.session,
                storage_provider=self.storage_provider,
                target_infospace_id=created_infospace.id, 
                target_user_id=user_id,
                settings=self.settings, # Pass settings to importer
                asset_service=asset_service
            )

            for ds_content in main_package.content.get("sources_content", []):
                try:
                    ds_meta = PackageMetadata(package_type=ResourceType.SOURCE, source_entity_uuid=ds_content.get("source",{}).get("uuid", str(uuid.uuid4())))
                    temp_ds_package = DataPackage(metadata=ds_meta, content=ds_content, files=main_package.files)
                    await importer.import_source_package(temp_ds_package) # Assuming import_source_package
                except Exception as e:
                    logger.error(f"Failed to import a Source during infospace import: {e}", exc_info=True)
                    # Decide on error handling: rollback or continue with other entities
            
            for schema_content in main_package.content.get("annotation_schemas_content", []):
                try:
                    schema_meta = PackageMetadata(package_type=ResourceType.SCHEMA, source_entity_uuid=schema_content.get("annotation_schema", {}).get("uuid", str(uuid.uuid4())))
                    temp_schema_package = DataPackage(metadata=schema_meta, content=schema_content, files={})
                    await importer.import_annotation_schema_package(temp_schema_package) # Assuming import_annotation_schema_package
                except Exception as e:
                    logger.error(f"Failed to import an AnnotationSchema during infospace import: {e}", exc_info=True)

            for run_content in main_package.content.get("annotation_runs_content", []):
                try:
                    run_meta = PackageMetadata(package_type=ResourceType.RUN, source_entity_uuid=run_content.get("annotation_run", {}).get("uuid", str(uuid.uuid4())))
                    temp_run_package = DataPackage(metadata=run_meta, content=run_content, files={})
                    await importer.import_annotation_run_package(temp_run_package) # Assuming import_annotation_run_package
                except Exception as e:
                    logger.error(f"Failed to import an AnnotationRun during infospace import: {e}", exc_info=True)

            for dataset_content in main_package.content.get("datasets_content", []):
                try:
                    dataset_meta = PackageMetadata(package_type=ResourceType.DATASET, source_entity_uuid=dataset_content.get("dataset",{}).get("uuid", str(uuid.uuid4())))
                    temp_dataset_package = DataPackage(metadata=dataset_meta, content=dataset_content, files=main_package.files)
                    await importer.import_dataset_package(temp_dataset_package)
                except Exception as e:
                    logger.error(f"Failed to import a Dataset during infospace import: {e}", exc_info=True)

            self.session.commit()
            logger.info(f"Successfully committed all nested entities for imported infospace ID {created_infospace.id}")
            self.session.refresh(created_infospace)
            return created_infospace

        except ValueError as e:
            self.session.rollback()
            logger.error(f"Validation error during infospace import: {e}", exc_info=True)
            raise e 
        except Exception as e:
            self.session.rollback()
            logger.error(f"Critical error during infospace import from path {filepath}: {e}", exc_info=True)
            raise RuntimeError(f"Infospace import failed due to an internal error: {str(e)}") 
        finally:
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    logger.info(f"Cleaned up temporary import file: {filepath}")
                except OSError as e_remove:
                    logger.error(f"Error removing temporary import file {filepath}: {e_remove}")

    async def import_infospace_from_token(
        self,
        importing_user_id: int,
        share_token: str,
        shareable_service: 'ShareableService', # Use string literal for type hint
        new_infospace_name: Optional[str] = None 
    ) -> Infospace:
        """Imports an infospace using a share token."""
        if not self.storage_provider:
            raise RuntimeError("StorageProvider is not available. Cannot import from token.")

        logger.info(f"User {importing_user_id} attempting to import infospace from token: {share_token[:6]}...")
        temp_package_path: Optional[str] = None

        try:
            # Use ShareableService to validate token and get resource details
            if not shareable_service: # Check if service is provided
                raise RuntimeError("ShareableService not available for token import logic.")

            shared_resource_data = shareable_service.access_shared_resource(
                token=share_token,
                requesting_user_id=importing_user_id 
            )

            if shared_resource_data.get("resource_type") != ResourceType.INFOSPACE.value:
                raise ValueError("The provided token does not correspond to an Infospace resource.")
            
            original_infospace_id = shared_resource_data.get("resource_id")
            original_owner_id = shared_resource_data.get("data", {}).get("owner_id") # Assuming 'data' contains infospace model dump

            if not original_infospace_id or not original_owner_id:
                raise ValueError("Could not retrieve original infospace ID or owner ID from token data.")
            
            logger.info(f"Token validated. Original Infospace ID: {original_infospace_id}, Original Owner ID: {original_owner_id}")

            source_infospace_package = await self.export_infospace(
                infospace_id=original_infospace_id,
                user_id=original_owner_id,
                include_sources=True, include_schemas=True, include_runs=True, include_datasets=True,
                include_assets_for_sources=True, include_annotations_for_runs=True
            )
            logger.info(f"Successfully exported source infospace {original_infospace_id} for token import.")

            temp_dir = os.getenv("TEMP_DIR", tempfile.gettempdir())
            os.makedirs(temp_dir, exist_ok=True)
            temp_package_filename = f"infospace_import_token_{uuid.uuid4()}.zip"
            temp_package_path = os.path.join(temp_dir, temp_package_filename)
            
            source_infospace_package.to_zip(temp_package_path)
            logger.info(f"Source infospace package saved to temporary ZIP: {temp_package_path}")

            imported_infospace = await self.import_infospace(
                user_id=importing_user_id,
                filepath=temp_package_path
            )
            logger.info(f"Successfully imported infospace from token. New Infospace ID: {imported_infospace.id}")

            if new_infospace_name and imported_infospace.name != new_infospace_name:
                logger.info(f"Updating imported infospace name to: '{new_infospace_name}'")
                update_payload = InfospaceUpdate(name=new_infospace_name)
                updated_ws = self.update_infospace(
                    infospace_id=imported_infospace.id,
                    user_id=importing_user_id,
                    infospace_in=update_payload
                )
                if updated_ws: imported_infospace = updated_ws
                else: logger.warning(f"Failed to update infospace name for {imported_infospace.id}.")
            
            return imported_infospace

        except ValueError as e:
            logger.error(f"Validation error during infospace import from token: {e}", exc_info=True)
            raise e
        except RuntimeError as e:
            logger.error(f"Runtime error during infospace import from token: {e}", exc_info=True)
            raise e
        except Exception as e:
            logger.error(f"Unexpected error during infospace import from token: {e}", exc_info=True)
            raise RuntimeError(f"Infospace import from token failed: {str(e)}")
        finally:
            if temp_package_path and os.path.exists(temp_package_path):
                try:
                    os.remove(temp_package_path)
                    logger.info(f"Cleaned up temporary package file: {temp_package_path}")
                except OSError as e_remove:
                    logger.error(f"Error removing temporary package file {temp_package_path}: {e_remove}")

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