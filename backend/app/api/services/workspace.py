"""
Workspace service.

This module contains the business logic for workspace operations,
abstracting the underlying implementation details from the API layer.
"""
import logging
from typing import Any, Dict, List, Optional, TYPE_CHECKING
from datetime import datetime, timezone
import json # Added for export/import
import uuid
import os
import tempfile

# Removed Depends
from sqlmodel import Session, select

from app.models import (
    Workspace,
    WorkspaceCreate,
    User,
    DataSource, # Added for export/import
    ClassificationScheme, # Added for export/import
    ClassificationJob, # Added for export/import
    WorkspaceUpdate,
    ClassificationField, # Added to prevent lint error
    ResourceType # Added for import_workspace_from_token
)
# ADDED imports for StorageProvider and settings
from app.api.services.providers.base import StorageProvider
from app.core.config import settings
# ADDED imports for Package related classes
from app.api.services.package import PackageBuilder, PackageMetadata, DataPackage, PackageImporter

# Moved ShareableService import under TYPE_CHECKING
if TYPE_CHECKING:
    from app.api.services.shareable import ShareableService

# Removed SessionDep import
# Import the new utility function
from app.api.services.service_utils import validate_workspace_access

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Removed old service factory function

class WorkspaceService:
    """
    Service for handling workspace operations.
    """
    _shareable_service: Optional['ShareableService'] = None

    def __init__(self, session: Session, storage_provider: Optional[StorageProvider] = None, source_instance_id: Optional[str] = None):
        """Initialize with a database session dependency and optional storage provider for exports."""
        self.session = session
        self.storage_provider = storage_provider
        self.source_instance_id = source_instance_id or (settings.INSTANCE_ID if settings.INSTANCE_ID else "default_instance")
        if storage_provider:
            logger.info(f"WorkspaceService initialized with StorageProvider. Source Instance ID: {self.source_instance_id}")
        else:
            logger.info("WorkspaceService initialized WITHOUT StorageProvider (export functionality might be limited).")

    @property
    def shareable_service(self) -> 'ShareableService':
        if self._shareable_service is None:
            raise RuntimeError("ShareableService not set in WorkspaceService. Check DI setup.")
        return self._shareable_service

    @shareable_service.setter
    def shareable_service(self, service: 'ShareableService'):
        self._shareable_service = service
        logger.info("ShareableService has been set in WorkspaceService.")

    def create_workspace(
        self,
        user_id: int,
        workspace_data: WorkspaceCreate,
    ) -> Workspace:
        """
        Create a new workspace.
        MODIFIES DATA - Commits transaction.
        """
        workspace = Workspace(
            **workspace_data.model_dump(),
            user_id_ownership=user_id
        )
        self.session.add(workspace)
        self.session.commit()
        self.session.refresh(workspace)
        return workspace

    def get_workspace(
        self,
        workspace_id: int,
        user_id: Optional[int] = None
    ) -> Optional[Workspace]:
        """
        Get a specific workspace by ID.
        READ-ONLY - Does not commit.
        """
        workspace = self.session.get(Workspace, workspace_id)
        if not workspace:
            return None
        if user_id is not None and workspace.user_id_ownership != user_id:
            return None
        return workspace

    def get_user_workspaces(
        self,
        user_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Workspace]:
        """
        Get all workspaces for a user.
        READ-ONLY - Does not commit.
        """
        statement = select(Workspace).where(
            Workspace.user_id_ownership == user_id
        ).offset(skip).limit(limit)
        workspaces = self.session.exec(statement).all()
        return workspaces

    def update_workspace(
        self,
        workspace_id: int,
        user_id: int,
        **update_data: Any
    ) -> Optional[Workspace]:
        """
        Update a workspace.
        MODIFIES DATA - Commits transaction.
        """
        workspace = self.get_workspace(workspace_id, user_id)
        if not workspace:
            return None

        for key, value in update_data.items():
            if hasattr(workspace, key) and value is not None:
                setattr(workspace, key, value)

        self.session.add(workspace)
        self.session.commit()
        self.session.refresh(workspace)
        return workspace

    def delete_workspace(
        self,
        workspace_id: int,
        user_id: int,
    ) -> bool:
        """
        Delete a workspace.
        MODIFIES DATA - Commits transaction.
        """
        workspace = self.get_workspace(workspace_id, user_id)
        if not workspace:
            return False

        self.session.delete(workspace)
        self.session.commit()
        return True

    def ensure_default_workspace(
        self,
        user_id: int,
    ) -> Workspace:
        """
        Ensure a default workspace exists for the user.
        MODIFIES DATA - Commits transaction if workspace created.
        """
        # First try to find existing default workspace
        statement = select(Workspace).where(
            Workspace.user_id_ownership == user_id
        ).order_by(Workspace.created_at)
        default_workspace = self.session.exec(statement).first()

        if default_workspace:
            return default_workspace

        # Create default workspace if none exists
        workspace_data = WorkspaceCreate(
            name="Default Workspace",
            description="Your default workspace"
        )
        return self.create_workspace(user_id, workspace_data)

    async def export_workspace(
        self,
        workspace_id: int,
        user_id: int,
        # The following flags will control what's included in the structured content.
        # For a full package, we'd typically want most things true by default.
        include_datasources: bool = True,
        include_schemes: bool = True,
        include_jobs: bool = True,
        include_datasets: bool = True, # New: for including dataset packages
        include_records_for_datasources: bool = True, # New: control record inclusion for loose datasources
        include_results_for_jobs: bool = True, # New: control result inclusion for loose jobs
    ) -> DataPackage: # MODIFIED return type
        """
        Export a workspace configuration and its contents as a DataPackage.
        READ-ONLY - Does not commit.
        """
        if not self.storage_provider:
            # This check is important because PackageBuilder requires it.
            logger.error("Storage provider not available in WorkspaceService; cannot perform full package export.")
            raise RuntimeError("Workspace export requires a configured storage provider.")

        workspace = self.get_workspace(workspace_id, user_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found or not accessible")

        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider, # self.storage_provider should be set in __init__
            source_instance_id=self.source_instance_id # self.source_instance_id should be set in __init__
        )

        # 1. Create metadata for the main Workspace package
        package_metadata = PackageMetadata(
            package_type=ResourceType.WORKSPACE, # Pass the enum member directly
            source_entity_uuid=str(workspace.id), # Workspace might not have entity_uuid yet, using id as placeholder
            source_instance_id=self.source_instance_id,
            description=f"Export of Workspace: {workspace.name} (ID: {workspace.id})",
            created_by=str(user_id) # Ensure user_id is string
        )

        # 2. Prepare the main content dictionary for the Workspace package
        workspace_package_content: Dict[str, Any] = {
            "workspace_details": {
                "id": workspace.id, # Keep original ID for reference
            "name": workspace.name,
            "description": workspace.description,
            "icon": workspace.icon,
            "system_prompt": workspace.system_prompt,
            "created_at": workspace.created_at.isoformat() if workspace.created_at else None,
            "updated_at": workspace.updated_at.isoformat() if workspace.updated_at else None,
                "user_id_ownership": workspace.user_id_ownership
            },
            "datasources_content": [],
            "schemes_content": [],
            "jobs_content": [],
            "datasets_content": []
            # TODO: Add recurring_tasks_content if needed
        }

        # 3. Populate content for nested entities (DataSources, Schemes, Jobs, Datasets)
        # The builder.files will accumulate files from all build_*_package calls.

        if include_datasources and workspace.datasources:
            logger.info(f"Exporting {len(workspace.datasources)} DataSources for workspace {workspace.id}")
            for ds in workspace.datasources:
                try:
                    # For loose datasources in a workspace export, decide if records/results are needed.
                    # Results are typically tied to jobs, not directly to datasources in this context.
                    ds_package = await builder.build_datasource_package(ds, include_records=include_records_for_datasources, include_results=False)
                    workspace_package_content["datasources_content"].append(ds_package.content)
                except Exception as e:
                    logger.error(f"Failed to package DataSource {ds.id} ('{ds.name}') for workspace export: {e}", exc_info=True)
                    # Optionally, add error info to the package content

        if include_schemes and workspace.classification_schemes:
            logger.info(f"Exporting {len(workspace.classification_schemes)} ClassificationSchemes for workspace {workspace.id}")
            for scheme in workspace.classification_schemes:
                try:
                    # Results are not directly tied to schemes in isolation here.
                    scheme_package = await builder.build_scheme_package(scheme, include_results=False)
                    workspace_package_content["schemes_content"].append(scheme_package.content)
                except Exception as e:
                    logger.error(f"Failed to package ClassificationScheme {scheme.id} ('{scheme.name}') for workspace export: {e}", exc_info=True)

        if include_jobs and workspace.classification_jobs:
            logger.info(f"Exporting {len(workspace.classification_jobs)} ClassificationJobs for workspace {workspace.id}")
            for job in workspace.classification_jobs:
                try:
                    job_package = await builder.build_job_package(job, include_results=include_results_for_jobs)
                    workspace_package_content["jobs_content"].append(job_package.content)
                except Exception as e:
                    logger.error(f"Failed to package ClassificationJob {job.id} ('{job.name}') for workspace export: {e}", exc_info=True)
        
        if include_datasets and workspace.datasets: # Assuming workspace.datasets relationship exists
            logger.info(f"Exporting {len(workspace.datasets)} Datasets for workspace {workspace.id}")
            for dataset_item in workspace.datasets:
                try:
                    # For datasets, assume a full export including content, results, and source files by default
                    dataset_package = await builder.build_dataset_package(dataset_item, include_record_content=True, include_results=True)
                    workspace_package_content["datasets_content"].append(dataset_package.content)
                except Exception as e:
                    logger.error(f"Failed to package Dataset {dataset_item.id} ('{dataset_item.name}') for workspace export: {e}", exc_info=True)

        # 4. Create the final DataPackage for the Workspace
        # The builder.files dictionary now contains all files gathered from the build_*_package calls above.
        final_workspace_package = DataPackage(
            metadata=package_metadata,
            content=workspace_package_content,
            files=builder.files # builder.files has accumulated all necessary files
        )
        logger.info(f"Workspace {workspace.id} package created. Total files to include: {len(builder.files)}.")
        return final_workspace_package

    async def import_workspace(
        self,
        user_id: int,
        filepath: str # Path to the uploaded ZIP package
    ) -> Workspace: # Return the newly created or updated Workspace
        """
        Import a workspace from a comprehensive ZIP package.
        MODIFIES DATA - Commits transaction.
        """
        if not self.storage_provider:
            logger.error("Storage provider not available in WorkspaceService; cannot perform full package import.")
            raise RuntimeError("Workspace import requires a configured storage provider.")

        logger.info(f"Starting import of workspace from package file: {filepath} for user {user_id}")

        try:
            # 1. Load the main workspace package from the ZIP file
            main_workspace_package = DataPackage.from_zip(filepath)
            if main_workspace_package.metadata.package_type != ResourceType.WORKSPACE.value: # or ResourceType.WORKSPACE.value
                raise ValueError(f"Invalid package type. Expected '{ResourceType.WORKSPACE.value}', got '{main_workspace_package.metadata.package_type}'")

            ws_details = main_workspace_package.content.get("workspace_details")
            if not ws_details:
                raise ValueError("Workspace package content is missing 'workspace_details'.")

            # 2. Create the new Workspace DB entry
            # Note: We are creating a NEW workspace for the importing user.
            # We are not updating an existing one by ID from the package to prevent conflicts.
            # The original IDs from the package are for reference/logging if needed.
            new_workspace_name = ws_details.get("name", "Imported Workspace") + f" (Imported {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')})"
            
            # Ensure a unique name if necessary, or let user resolve later.
            # For now, just append timestamp.

            workspace_create_data = WorkspaceCreate(
                name=new_workspace_name,
                description=ws_details.get("description", "Imported workspace"),
                icon=ws_details.get("icon"),
                system_prompt=ws_details.get("system_prompt")
            )
            # Use the service's own create_workspace method to ensure all standard logic is applied
            # This method also handles the initial commit for the workspace row itself.
            created_workspace = self.create_workspace(user_id=user_id, workspace_data=workspace_create_data)
            logger.info(f"Created new workspace '{created_workspace.name}' (ID: {created_workspace.id}) for import.")

            # 3. Initialize PackageImporter with the new workspace ID
            importer = PackageImporter(
                session=self.session,
                storage_provider=self.storage_provider,
                target_workspace_id=created_workspace.id, # Target is the newly created workspace
                target_user_id=user_id
            )

            # 4. Import nested entities
            # The importer methods will use self.session.flush() but not commit.
            # We will do a single commit at the end of this try block.

            # Import DataSources
            datasources_content_list = main_workspace_package.content.get("datasources_content", [])
            logger.info(f"Found {len(datasources_content_list)} DataSource content entries to import.")
            for ds_content in datasources_content_list:
                try:
                    # Reconstruct a temporary DataPackage object for the importer
                    ds_package_metadata = PackageMetadata(
                        package_type=ResourceType.DATA_SOURCE.value, # Use Enum value
                        source_entity_uuid=ds_content.get("datasource", {}).get("entity_uuid", str(uuid.uuid4())),
                    )
                    temp_ds_package = DataPackage(metadata=ds_package_metadata, content=ds_content, files=main_workspace_package.files)
                    await importer.import_datasource_package(temp_ds_package)
                    logger.debug(f"Successfully imported nested DataSource: {ds_content.get('datasource',{}).get('name')}")
                except Exception as e:
                    logger.error(f"Failed to import a DataSource during workspace import (name: {ds_content.get('datasource',{}).get('name', 'N/A')}): {e}", exc_info=True)
                    raise RuntimeError(f"Failed to import nested DataSource '{ds_content.get('datasource',{}).get('name', 'N/A')}'. Rolling back entire workspace import.") from e

            # Import ClassificationSchemes
            schemes_content_list = main_workspace_package.content.get("schemes_content", [])
            logger.info(f"Found {len(schemes_content_list)} Scheme content entries to import.")
            for scheme_content in schemes_content_list:
                try:
                    scheme_package_metadata = PackageMetadata(
                        package_type=ResourceType.SCHEMA.value, # Use Enum value
                        source_entity_uuid=scheme_content.get("scheme", {}).get("entity_uuid", str(uuid.uuid4())),
                    )
                    temp_scheme_package = DataPackage(metadata=scheme_package_metadata, content=scheme_content, files={})
                    await importer.import_scheme_package(temp_scheme_package)
                    logger.debug(f"Successfully imported nested Scheme: {scheme_content.get('scheme',{}).get('name')}")
                except Exception as e:
                    logger.error(f"Failed to import a ClassificationScheme during workspace import (name: {scheme_content.get('scheme',{}).get('name', 'N/A')}): {e}", exc_info=True)
                    raise RuntimeError(f"Failed to import nested ClassificationScheme '{scheme_content.get('scheme',{}).get('name', 'N/A')}'. Rolling back entire workspace import.") from e
            
            # Import ClassificationJobs
            jobs_content_list = main_workspace_package.content.get("jobs_content", [])
            logger.info(f"Found {len(jobs_content_list)} Job content entries to import.")
            for job_content in jobs_content_list:
                try:
                    job_package_metadata = PackageMetadata(
                        package_type=ResourceType.CLASSIFICATION_JOB.value, # Use Enum value
                        source_entity_uuid=job_content.get("job", {}).get("entity_uuid", str(uuid.uuid4())),
                    )
                    temp_job_package = DataPackage(metadata=job_package_metadata, content=job_content, files={})
                    await importer.import_job_package(temp_job_package)
                    logger.debug(f"Successfully imported nested Job: {job_content.get('job',{}).get('name')}")
                except Exception as e:
                    logger.error(f"Failed to import a ClassificationJob during workspace import (name: {job_content.get('job',{}).get('name', 'N/A')}): {e}", exc_info=True)
                    raise RuntimeError(f"Failed to import nested ClassificationJob '{job_content.get('job',{}).get('name', 'N/A')}'. Rolling back entire workspace import.") from e

            # Import Datasets
            datasets_content_list = main_workspace_package.content.get("datasets_content", [])
            logger.info(f"Found {len(datasets_content_list)} Dataset content entries to import.")
            for dataset_content in datasets_content_list:
                try:
                    dataset_package_metadata = PackageMetadata(
                        package_type=ResourceType.DATASET.value, # Use Enum value
                        source_entity_uuid=dataset_content.get("dataset", {}).get("entity_uuid", str(uuid.uuid4())),
                    )
                    temp_dataset_package = DataPackage(metadata=dataset_package_metadata, content=dataset_content, files=main_workspace_package.files)
                    await importer.import_dataset_package(temp_dataset_package)
                    logger.debug(f"Successfully imported nested Dataset: {dataset_content.get('dataset',{}).get('name')}")
                except Exception as e:
                    logger.error(f"Failed to import a Dataset during workspace import (name: {dataset_content.get('dataset',{}).get('name', 'N/A')}): {e}", exc_info=True)
                    raise RuntimeError(f"Failed to import nested Dataset '{dataset_content.get('dataset',{}).get('name', 'N/A')}'. Rolling back entire workspace import.") from e

            # TODO: Import RecurringTasks if they are part of the package

            # 5. Commit all changes for the nested entities
            self.session.commit()
            logger.info(f"Successfully committed all nested entities for imported workspace ID {created_workspace.id}")
            self.session.refresh(created_workspace) # Refresh to get all relationships populated if any
            return created_workspace

        except ValueError as e:
            self.session.rollback()
            logger.error(f"Validation error during workspace import: {e}", exc_info=True)
            raise e # Re-raise to be handled by the route
        except Exception as e:
            self.session.rollback()
            logger.error(f"Critical error during workspace import from path {filepath}: {e}", exc_info=True)
            # Raise a more generic error or a specific one if identifiable
            raise RuntimeError(f"Workspace import failed due to an internal error: {str(e)}") 
        finally:
            # Clean up the uploaded temp file
            if os.path.exists(filepath):
                try:
                    os.remove(filepath)
                    logger.info(f"Cleaned up temporary import file: {filepath}")
                except OSError as e_remove:
                    logger.error(f"Error removing temporary import file {filepath}: {e_remove}")

    async def import_workspace_from_token(
        self,
        importing_user_id: int,
        share_token: str,
        new_workspace_name: Optional[str] = None # Optional name for the new workspace
    ) -> Workspace:
        """
        Imports a workspace using a share token.
        This involves: 
        1. Validating the token and getting original workspace details.
        2. Exporting the original workspace to a temporary package.
        3. Importing that package into a new workspace for the importing_user_id.
        MODIFIES DATA - Commits transaction via self.import_workspace.
        """
        if not self.shareable_service:
            raise RuntimeError("ShareableService is not available in WorkspaceService. Cannot import from token.")
        if not self.storage_provider: # Needed for export part
            raise RuntimeError("StorageProvider is not available in WorkspaceService. Cannot import from token.")

        logger.info(f"User {importing_user_id} attempting to import workspace from token: {share_token[:6]}...")

        temp_package_path: Optional[str] = None
        imported_workspace: Optional[Workspace] = None

        try:
            # 1. Validate token and get original workspace ID and owner ID
            # We pass importing_user_id as requesting_user_id for access check against link properties
            shared_resource_data = self.shareable_service.access_shared_resource(
                token=share_token,
                requesting_user_id=importing_user_id 
            )

            if shared_resource_data.get("resource_type") != ResourceType.WORKSPACE.value:
                raise ValueError("The provided token does not correspond to a Workspace resource.")
            
            original_workspace_id = shared_resource_data.get("resource_id")
            # The 'data' field in shared_resource_data for a workspace is its model dump.
            # We need the original owner_id to call export_workspace correctly.
            original_owner_id = shared_resource_data.get("data", {}).get("user_id_ownership")

            if not original_workspace_id or not original_owner_id:
                raise ValueError("Could not retrieve original workspace ID or owner ID from token data.")
            
            logger.info(f"Token validated. Original Workspace ID: {original_workspace_id}, Original Owner ID: {original_owner_id}")

            # 2. Export the original workspace to a DataPackage
            # Note: export_workspace now requires user_id of the owner of the workspace being exported.
            source_workspace_package = await self.export_workspace(
                workspace_id=original_workspace_id,
                user_id=original_owner_id, # Use original owner's ID for export permission
                include_datasources=True, # Ensure comprehensive export
                include_schemes=True,
                include_jobs=True,
                include_datasets=True,
                include_records_for_datasources=True,
                include_results_for_jobs=True
            )
            logger.info(f"Successfully exported source workspace {original_workspace_id} to an in-memory package.")

            # 3. Save this package to a temporary ZIP file
            # Use a more descriptive temp file prefix
            temp_dir = os.getenv("TEMP_DIR", tempfile.gettempdir())
            os.makedirs(temp_dir, exist_ok=True)
            temp_package_filename = f"ws_import_token_{uuid.uuid4()}.zip"
            temp_package_path = os.path.join(temp_dir, temp_package_filename)
            
            source_workspace_package.to_zip(temp_package_path)
            logger.info(f"Source workspace package saved to temporary ZIP: {temp_package_path}")

            # 4. Import the package into a new workspace for the importing_user_id
            # The self.import_workspace method handles creating a new workspace with a modified name.
            # We can pass the desired new_workspace_name to it if the method is adapted, 
            # or handle renaming after import if import_workspace doesn't take a name directly.
            # For now, import_workspace creates a name like "Imported Workspace (Timestamp)".
            # We will rely on its internal naming and it will create a new workspace for importing_user_id.
            
            imported_workspace = await self.import_workspace(
                user_id=importing_user_id,
                filepath=temp_package_path
            )
            logger.info(f"Successfully imported workspace from token. New Workspace ID: {imported_workspace.id}")

            # Optionally, if new_workspace_name is provided and differs from imported_workspace.name,
            # and if import_workspace doesn't handle custom naming, update it here.
            if new_workspace_name and imported_workspace.name != new_workspace_name:
                logger.info(f"Updating imported workspace name to: '{new_workspace_name}'")
                # Create a WorkspaceUpdate model instance for the name change
                update_payload = WorkspaceUpdate(name=new_workspace_name)
                updated_ws = self.update_workspace( # This is synchronous, may need async version or careful session handling
                    workspace_id=imported_workspace.id,
                    user_id=importing_user_id,
                    **update_payload.model_dump(exclude_unset=True)
                )
                if updated_ws:
                    imported_workspace = updated_ws # self.update_workspace commits and refreshes
                else:
                    logger.warning(f"Failed to update workspace name for {imported_workspace.id} after token import.")
            
            return imported_workspace

        except ValueError as e:
            # No specific rollback here as commits are handled by sub-methods or at the end of this method (if it were to commit directly)
            logger.error(f"Validation error during workspace import from token: {e}", exc_info=True)
            raise e
        except RuntimeError as e:
            logger.error(f"Runtime error during workspace import from token: {e}", exc_info=True)
            raise e
        except Exception as e:
            logger.error(f"Unexpected error during workspace import from token: {e}", exc_info=True)
            raise RuntimeError(f"Workspace import from token failed: {str(e)}")
        finally:
            if temp_package_path and os.path.exists(temp_package_path):
                try:
                    os.remove(temp_package_path)
                    logger.info(f"Cleaned up temporary package file: {temp_package_path}")
                except OSError as e_remove:
                    logger.error(f"Error removing temporary package file {temp_package_path}: {e_remove}")

    # Removed old import_workspace method that took import_data: Dict[str, Any]
    # async def import_workspace(
    #     self,
    #     user_id: int,
    #     filepath: str
    # ) -> Workspace:
    #     """
    #     Import a workspace from a file.
    #     MODIFIES DATA - Commits transaction.
    #     """
    #     try:
    #         with open(filepath, 'r') as f:
    #             import_data = json.load(f)

    #         # Create the workspace first
    #         workspace_data = WorkspaceCreate(
    #             name=import_data.get("name", "Imported Workspace"),
    #             description=import_data.get("description", "Imported workspace configuration"),
    #             icon=import_data.get("icon"),
    #             system_prompt=import_data.get("system_prompt")
    #         )
    #         workspace = self.create_workspace(user_id, workspace_data)

    #         # Import classification schemes if present
    #         if "classification_schemes" in import_data:
    #             for scheme_data in import_data["classification_schemes"]:
    #                 scheme = ClassificationScheme(
    #                     workspace_id=workspace.id,
    #                     user_id=user_id,
    #                     **{k: v for k, v in scheme_data.items() if k not in ["fields", "created_at"]}
    #                 )
    #                 self.session.add(scheme)
    #                 self.session.flush()  # Get scheme ID for fields

    #                 # Add fields if present
    #                 if "fields" in scheme_data:
    #                     for field_data in scheme_data["fields"]:
    #                         field = ClassificationField(
    #                             scheme_id=scheme.id,
    #                             **{k: v for k, v in field_data.items()}
    #                         )
    #                         self.session.add(field)

    #         # Import datasources if present (metadata only)
    #         if "datasources" in import_data:
    #             for ds_data in import_data["datasources"]:
    #                 datasource = DataSource(
    #                     workspace_id=workspace.id,
    #                     user_id=user_id,
    #                     **{k: v for k, v in ds_data.items() if k != "created_at"}
    #                 )
    #                 self.session.add(datasource)

    #         # Import job configurations if present
    #         if "classification_jobs" in import_data:
    #             for job_data in import_data["classification_jobs"]:
    #                 job = ClassificationJob(
    #                     workspace_id=workspace.id,
    #                     user_id=user_id,
    #                     **{k: v for k, v in job_data.items() if k != "created_at"}
    #                 )
    #                 self.session.add(job)

    #         # Commit all changes
    #         self.session.commit()
    #         self.session.refresh(workspace)
    #         return workspace

    #     except Exception as e:
    #         self.session.rollback()
    #         raise ValueError(f"Failed to import workspace: {str(e)}") 