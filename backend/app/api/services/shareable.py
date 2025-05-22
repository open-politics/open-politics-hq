"""
Service for managing shareable links and resource access.
"""
import json
import logging
import os
import secrets
import string
import tempfile
import uuid
import zipfile # Added for zip file creation
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple, Union, TYPE_CHECKING
import shutil
import asyncio

from fastapi import Depends, HTTPException, UploadFile, status
from sqlmodel import Session, select, func, col

# Use conditional imports to avoid circular import
if TYPE_CHECKING:
    from app.api.services.classification import ClassificationService
    from app.api.services.ingestion import IngestionService
    from app.api.services.workspace import WorkspaceService
    from app.api.services.dataset import DatasetService

# Import base types for dependencies
from app.api.services.classification import ClassificationService
from app.api.services.ingestion import IngestionService
# from app.api.services.workspace import WorkspaceService # Removed this line
from app.api.services.dataset import DatasetService # Assuming this exists

from app.api.services.service_utils import validate_workspace_access
from app.models import (
    ResourceType, 
    ShareableLink, 
    ShareableLinkCreate,
    ShareableLinkRead, 
    ShareableLinkStats, 
    ShareableLinkUpdate,
    DataSource,
    ClassificationScheme,
    Workspace,
    ClassificationJob,
    Dataset,
    DataSourceType,
    # ADDED DataPackage for type hinting if necessary, though not directly used in models.py
    # from app.api.services.package import DataPackage # This import is better placed in service files
)
# ADDED imports for StorageProvider and settings
from app.api.services.providers.base import StorageProvider
from app.core.config import settings
# ADDED imports for PackageBuilder and DataPackage
from app.api.services.package import PackageBuilder, DataPackage
from app.api.services.package import PackageImporter, PackageMetadata
# ADDED Models for DatasetPackageSummary
from app.models import DatasetPackageSummary, DatasetPackageEntitySummary, DatasetPackageFileManifestItem, User
# ADD THIS LINE:
from app.api.tasks.ingestion import process_datasource 

logger = logging.getLogger(__name__)

class ShareableService:
    """
    Service for managing shareable links to resources.
    """
    _workspace_service: Optional['WorkspaceService'] = None
    _dataset_service: Optional['DatasetService'] = None

    def __init__(
        self,
        session: Session, # Use base Session type
        ingestion_service: IngestionService, # Use base IngestionService type
        classification_service: ClassificationService, # Use base ClassificationService type
        # workspace_service: 'WorkspaceService', # REMOVED
        # dataset_service: 'DatasetService', # REMOVED
        storage_provider: StorageProvider, # ADDED
        # source_instance_id: Optional[str] = None # Optional for now, can be fetched from settings
    ):
        """Initialize service with dependencies."""
        self.session = session
        self.ingestion_service = ingestion_service
        self.classification_service = classification_service
        # self.workspace_service is now a property
        # self.dataset_service is now a property
        self.storage_provider = storage_provider # ADDED
        self.source_instance_id = settings.INSTANCE_ID if settings.INSTANCE_ID else "default_instance" # ADDED
        self.token_length = 24  # Length of the token for shareable links
        logger.info(f"ShareableService initialized with source_instance_id: {self.source_instance_id}")

    @property
    def workspace_service(self) -> 'WorkspaceService':
        if self._workspace_service is None:
            raise RuntimeError("WorkspaceService not set in ShareableService. Check DI setup.")
        return self._workspace_service

    @workspace_service.setter
    def workspace_service(self, service: 'WorkspaceService'):
        self._workspace_service = service

    @property
    def dataset_service(self) -> 'DatasetService':
        if self._dataset_service is None:
            raise RuntimeError("DatasetService not set in ShareableService. Check DI setup.")
        return self._dataset_service

    @dataset_service.setter
    def dataset_service(self, service: 'DatasetService'):
        self._dataset_service = service
    
    def _generate_token(self) -> str:
        """Generate a unique token for a shareable link."""
        chars = string.ascii_letters + string.digits
        while True:
            token = ''.join(secrets.choice(chars) for _ in range(self.token_length))
            # Check if token already exists
            existing = self.session.exec(
                select(ShareableLink).where(ShareableLink.token == token)
            ).first()
            if not existing:
                return token
    
    def create_link(
        self,
        user_id: int,
        link_data: ShareableLinkCreate
    ) -> ShareableLink:
        """Create a new shareable link."""
        try:
            # Validate resource ownership
            self._validate_resource_ownership(
                resource_type=link_data.resource_type,
                resource_id=link_data.resource_id,
                user_id=user_id
            )

            # Generate token
            token = self._generate_token()
            
            # Ensure expiration date is timezone-aware if provided
            exp_date = link_data.expiration_date
            if exp_date and exp_date.tzinfo is None:
                exp_date = exp_date.replace(tzinfo=timezone.utc)

            # Create link
            link = ShareableLink(
                token=token,
                user_id=user_id,
                resource_type=link_data.resource_type,
                resource_id=link_data.resource_id,
                name=link_data.name,
                description=link_data.description,
                permission_level=link_data.permission_level,
                is_public=link_data.is_public,
                requires_login=link_data.requires_login,
                expiration_date=exp_date,
                max_uses=link_data.max_uses
            )

            self.session.add(link)
            self.session.flush()
            self.session.refresh(link)
            
            logger.info(f"Shareable link {link.id} created for resource {link.resource_type.value}:{link.resource_id} by user {user_id}.")
            return link
        except HTTPException as he:
            # Re-raise validation errors
            raise he
        except Exception as e:
            logger.error(f"Error creating shareable link for user {user_id}: {e}", exc_info=True)
            # Raise ValueError for route to handle
            raise ValueError(f"Failed to create shareable link: {e}")
    
    def get_links(
        self,
        user_id: int,
        resource_type: Optional[ResourceType] = None,
        resource_id: Optional[int] = None
    ) -> List[ShareableLink]:
        """Get all shareable links created by a user."""
        query = select(ShareableLink).where(ShareableLink.user_id == user_id)
        
        if resource_type:
            query = query.where(ShareableLink.resource_type == resource_type)
        
        if resource_id:
            query = query.where(ShareableLink.resource_id == resource_id)
            
        query = query.order_by(ShareableLink.created_at.desc()) # Add ordering
        links = self.session.exec(query).all()
        logger.debug(f"Retrieved {len(links)} links for user {user_id} (filters: type={resource_type}, id={resource_id}).")
        return links
    
    def get_link_by_id(self, link_id: int, user_id: int) -> Optional[ShareableLink]:
        """Get a specific shareable link by ID."""
        link = self.session.get(ShareableLink, link_id)
        if link and link.user_id == user_id:
            logger.debug(f"Link {link_id} retrieved by owner {user_id}.")
            return link
        logger.warning(f"Link {link_id} not found or access denied for user {user_id}.")
        return None
    
    def get_link_by_token(self, token: str) -> Optional[ShareableLink]:
        """Get a specific shareable link by token."""
        statement = select(ShareableLink).where(ShareableLink.token == token)
        link = self.session.exec(statement).first()
        if link:
             logger.debug(f"Link found for token {token[:6]}...")
        else:
             logger.debug(f"No link found for token {token[:6]}...")
        return link
    
    def update_link(
        self,
        link_id: int,
        user_id: int,
        update_data: ShareableLinkUpdate
    ) -> Optional[ShareableLink]:
        """Update a shareable link."""
        try:
            # Get existing link
            link = self.get_link_by_id(link_id=link_id, user_id=user_id)
            if not link:
                return None

            # Update link with non-null values from update_data
            update_dict = update_data.model_dump(exclude_unset=True)
            
            # Handle special case for expiration_date to ensure it's timezone-aware
            if "expiration_date" in update_dict and update_dict["expiration_date"]:
                expiration_date = update_dict["expiration_date"]
                if expiration_date.tzinfo is None:
                    update_dict["expiration_date"] = expiration_date.replace(tzinfo=timezone.utc)
                # Validation for past dates
                if expiration_date < datetime.now(timezone.utc):
                    raise ValueError("Expiration date cannot be in the past.")
            
            link.sqlmodel_update(update_dict)
            link.updated_at = datetime.now(timezone.utc)
            
            self.session.add(link)
            self.session.flush()
            self.session.refresh(link)
            
            logger.info(f"Shareable link {link_id} updated by user {user_id}. Fields: {list(update_dict.keys())}")
            return link
        except ValueError as ve:
            # Catch specific validation errors
            logger.error(f"Validation error updating link {link_id}: {ve}")
            raise ve # Re-raise for route handler 
        except Exception as e:
            logger.error(f"Error updating link {link_id} for user {user_id}: {e}", exc_info=True)
            raise ValueError(f"Failed to update shareable link: {e}")
    
    def delete_link(
        self,
        link_id: int,
        user_id: int
    ) -> bool:
        """Delete a shareable link."""
        try:
            # Get existing link
            link = self.get_link_by_id(link_id=link_id, user_id=user_id)
            if not link:
                return False

            self.session.delete(link)
            self.session.flush()
            
            logger.info(f"Shareable link {link_id} deleted by user {user_id}.")
            return True
        except Exception as e:
            logger.error(f"Error deleting link {link_id} for user {user_id}: {e}", exc_info=True)
            return False
    
    def record_link_usage(
        self,
        link: ShareableLink
    ) -> None:
        """Record usage of a shareable link."""
        try:
            link.use_count += 1
            link.updated_at = datetime.now(timezone.utc)
            self.session.add(link)
            self.session.flush()
            logger.debug(f"Usage recorded for link {link.id} (token {link.token[:6]}...). New count: {link.use_count}.")
        except Exception as e:
            logger.error(f"Error recording usage for link {link.id}: {e}", exc_info=True)
            # Not raising an exception here as it's a secondary operation
    
    def get_link_stats(self, user_id: int) -> ShareableLinkStats:
        """Get statistics on shareable links created by a user."""
        # Get total count of links
        total_links_count = self.session.scalar(
            select(func.count(ShareableLink.id))
            .where(ShareableLink.user_id == user_id)
        ) or 0
        
        # Get active/expired links
        now_utc = datetime.now(timezone.utc)
        expired_links_count = self.session.scalar(
            select(func.count(ShareableLink.id))
            .where(
                ShareableLink.user_id == user_id,
                ShareableLink.expiration_date.is_not(None),
                ShareableLink.expiration_date < now_utc
            )
        ) or 0
        
        # Get links by resource type
        links_by_type_query = select(
            ShareableLink.resource_type,
            func.count().label("count")
        ).where(
            ShareableLink.user_id == user_id
        ).group_by(
            ShareableLink.resource_type
        )
        
        links_by_type_results = self.session.exec(links_by_type_query).all()
        links_by_type = {
            # Ensure keys are strings for the Pydantic model
            str(rt[0].value): rt[1]
            for rt in links_by_type_results
        }
        
        # Get most shared resources
        most_shared_query = select(
            ShareableLink.resource_type,
            ShareableLink.resource_id,
            func.count().label("count")
        ).where(
            ShareableLink.user_id == user_id
        ).group_by(
            ShareableLink.resource_type,
            ShareableLink.resource_id
        ).order_by(
            col("count").desc()
        ).limit(5)
        
        most_shared = []
        for r in self.session.exec(most_shared_query).all():
            resource_data = {
                "resource_type": r.resource_type.value,
                "resource_id": r.resource_id,
                "count": r.count
            }
            
            # Try to get the resource name
            try:
                resource = self._get_resource_by_type(
                    resource_type=r.resource_type,
                    resource_id=r.resource_id,
                    user_id=user_id
                )
                if resource:
                    resource_data["resource_name"] = getattr(resource, 'name', "Unknown")
            except Exception:
                resource_data["resource_name"] = "Unknown"
                
            most_shared.append(resource_data)
        
        # Get most used links
        most_used_query = select(
            ShareableLink.id,
            ShareableLink.token,
            ShareableLink.name,
            ShareableLink.resource_type,
            ShareableLink.resource_id,
            ShareableLink.use_count
        ).where(
            ShareableLink.user_id == user_id
        ).order_by(
            ShareableLink.use_count.desc()
        ).limit(5)
        
        most_used = [
            {
                "link_id": row.id,
                "token": row.token,
                "name": row.name,
                "resource_type": row.resource_type.value,
                "resource_id": row.resource_id,
                "use_count": row.use_count
            }
            for row in self.session.exec(most_used_query).all()
        ]
        
        return ShareableLinkStats(
            total_links=total_links_count,
            active_links=total_links_count - expired_links_count,
            expired_links=expired_links_count,
            links_by_resource_type=links_by_type,
            most_shared_resources=most_shared,
            most_used_links=most_used
        )
    
    def access_shared_resource(
        self,
        token: str,
        requesting_user_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Access a shared resource by token.
        Returns the resource data and records usage.
        """
        # Get link by token
        link = self.get_link_by_token(token)
        if not link:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Shared resource not found or invalid token")
        
        # Check if link is valid (not expired, under max uses)
        if not link.is_valid():
            if link.is_expired():
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This link has expired")
            if link.has_exceeded_max_uses():
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="This link has exceeded its maximum uses")
        
        # Check if login is required when no user is provided
        if link.requires_login and requesting_user_id is None:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Login required to access this resource")
        
        # Record usage
        self.record_link_usage(link)
        
        # Get resource
        resource = self._get_resource_by_type(
            resource_type=link.resource_type,
            resource_id=link.resource_id,
            user_id=requesting_user_id  # May be None for public access
        )
        
        if not resource:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Resource not found or not accessible")
        
        # Return specific metadata for datasets, full model for others
        if link.resource_type == ResourceType.DATASET:
            # Use self.dataset_service to fetch dataset metadata/details
            # Need to adjust how datasets are fetched - maybe just ID/name?
            dataset = self.dataset_service.get_dataset(user_id=link.user_id, workspace_id=None, dataset_id=link.resource_id)
            if not dataset:
                 raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dataset resource not found or not accessible")
            # Assert resource is a Dataset model for type checking
            # assert isinstance(resource, Dataset)
            return {
                "resource_type": link.resource_type.value,
                "permission_level": link.permission_level.value,
                "metadata": {
                    "name": dataset.name,
                    "description": dataset.description,
                    "original_dataset_id": dataset.id,
                    "original_workspace_id": dataset.workspace_id,
                }
            }
        else:
            # For other resource types
            if hasattr(resource, 'model_dump'):
                resource_data = resource.model_dump()
            elif hasattr(resource, 'dict'):
                resource_data = resource.dict()
            else:
                # For SQLModel instances
                resource_data = {
                    col.name: getattr(resource, col.name)
                    for col in resource.__table__.columns
                    if hasattr(resource, col.name)
                }
            
            return {
                "resource_type": link.resource_type.value,
                "resource_id": link.resource_id,
                "permission_level": link.permission_level.value,
                "data": resource_data
            }

    def _get_resource_by_type(
        self,
        resource_type: ResourceType,
        resource_id: int,
        user_id: Optional[int] # User ID for potential access checks later
    ) -> Optional[Any]:
        """Get a resource by its type and ID."""
        # Try simple approach first for common types
        model_map = {
            ResourceType.WORKSPACE: Workspace,
            ResourceType.DATA_SOURCE: DataSource,
            ResourceType.SCHEMA: ClassificationScheme,
            ResourceType.CLASSIFICATION_JOB: ClassificationJob,
            ResourceType.DATASET: Dataset
        }
        
        # Try direct DB lookup first if user_id is None (public access)
        if user_id is None and resource_type in model_map:
            model_class = model_map.get(resource_type)
            resource = self.session.get(model_class, resource_id)
            if resource:
                logger.debug(f"Retrieved shared resource {resource_type.value}:{resource_id} via direct DB lookup.")
                return resource
        
        # Otherwise use the appropriate service for access control
        if resource_type == ResourceType.DATA_SOURCE:
            return self.ingestion_service.get_datasource(
                datasource_id=resource_id,
                workspace_id=None,  # Will be checked in service
                user_id=user_id
            )
        elif resource_type == ResourceType.SCHEMA:
            # Assuming user_id can be None for public schemas
            # Expecting ClassificationService to handle this case
            return self.classification_service.get_scheme(
                scheme_id=resource_id,
                user_id=user_id,
                workspace_id=None  # Will be checked in service
            )
        elif resource_type == ResourceType.WORKSPACE:
            return self.workspace_service.get_workspace(
                workspace_id=resource_id,
                user_id=user_id
            )
        elif resource_type == ResourceType.CLASSIFICATION_JOB:
            return self.classification_service.get_job_details(
                job_id=resource_id,
                user_id=user_id,
                workspace_id=None,  # Will be checked in service
                include_counts=True
            )
        elif resource_type == ResourceType.DATASET:
            # Use DatasetService (assuming it has get_dataset method)
            return self.dataset_service.get_dataset(
                user_id=user_id,
                workspace_id=None, # Workspace is validated indirectly
                dataset_id=resource_id
            )
        else:
            raise ValueError(f"Unsupported resource type: {resource_type}")

    def _validate_resource_ownership(
        self,
        resource_type: ResourceType,
        resource_id: int,
        user_id: int
    ):
        """
        Validate that a user has ownership of a resource.
        Raises HTTPException if user doesn't own resource.
        """
        resource = self._get_resource_by_type(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id
        )
        
        if not resource:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"{resource_type.value.replace('_',' ').title()} with ID {resource_id} not found."
            )

        # Check ownership based on resource type
        owner_field = None
        if isinstance(resource, Workspace): owner_field = "user_id_ownership"
        elif isinstance(resource, (DataSource, ClassificationScheme, ClassificationJob, Dataset)): owner_field = "user_id"
        # Add other resource types here

        if owner_field and getattr(resource, owner_field) == user_id:
            logger.debug(f"User {user_id} validated as owner of {resource_type.value}:{resource_id}.")
            return True # Ownership confirmed
        else:
             logger.warning(f"User {user_id} does not own resource {resource_type.value}:{resource_id} (owner field '{owner_field}').")
             raise HTTPException(
                 status_code=status.HTTP_403_FORBIDDEN,
                 detail=f"User does not have permission to share this {resource_type.value.replace('_',' ')}."
             )

    def _create_temp_file(self, prefix: str = "export_", suffix: str = ".json") -> Tuple[str, str]:
        """Create a temporary file and return its path and filename."""
        temp_dir = os.getenv("TEMP_DIR", tempfile.gettempdir())
        os.makedirs(temp_dir, exist_ok=True)
        
        filename = f"{prefix}{uuid.uuid4()}{suffix}"
        filepath = os.path.join(temp_dir, filename)
        
        return filepath, filename

    def _cleanup_temp_file(self, filepath: str) -> None:
        """Clean up a temporary file."""
        try:
            if os.path.exists(filepath):
                os.remove(filepath)
                logger.debug(f"Temporary file {filepath} cleaned up")
        except Exception as e:
            logger.warning(f"Error cleaning up temporary file {filepath}: {e}")

    async def _get_export_data_for_resource(
        self,
        user_id: int,
        resource_type: ResourceType,
        resource_id: int,
        # New parameter to indicate if the caller expects a direct DataPackage or a path to its zip.
        # For batch exports, this should always be True.
        # For single 'export_resource' endpoint, it might be False if it handles zipping itself.
        # However, to simplify, we'll aim to always produce a zip from this method.
        create_zip_package: bool = True 
    ) -> Tuple[Optional[DataPackage], str]: # Returns (Optional[DataPackage object], path_to_zip_file)
        """
        Fetches the resource data and prepares it for export, optionally creating a zip package.
        Always returns a path to a temporary zip file containing the packaged resource.
        The DataPackage object itself is also returned but might be None if only path is needed by caller.
        """
        logger.info(f"_get_export_data_for_resource called for {resource_type.value} ID {resource_id}, create_zip_package={create_zip_package}")
        package: Optional[DataPackage] = None
        export_filename_base = f"{resource_type.value}_{resource_id}"

        # Generate PackageMetadata (common to all resource types)
        entity_uuid_str = None
        source_entity_name = "Unknown"

        # Fetch the actual entity to get its UUID and name if possible
        # This part needs to be robust and handle potential None returns from DB
        # Example for DataSource, extend for other types
        if resource_type == ResourceType.DATA_SOURCE:
            datasource = self.session.get(DataSource, resource_id)
            if datasource:
                entity_uuid_str = str(datasource.entity_uuid)
                source_entity_name = datasource.name
            else:
                logger.error(f"Datasource with ID {resource_id} not found during export preparation.")
                raise ValueError(f"Datasource {resource_id} not found.")
        elif resource_type == ResourceType.SCHEMA:
            scheme = self.session.get(ClassificationScheme, resource_id)
            if scheme:
                entity_uuid_str = str(scheme.entity_uuid)
                source_entity_name = scheme.name
            else:
                logger.error(f"ClassificationScheme with ID {resource_id} not found.")
                raise ValueError(f"ClassificationScheme {resource_id} not found.")
        elif resource_type == ResourceType.CLASSIFICATION_JOB:
            job = self.session.get(ClassificationJob, resource_id)
            if job:
                entity_uuid_str = str(job.entity_uuid)
                source_entity_name = job.name
            else:
                logger.error(f"ClassificationJob with ID {resource_id} not found.")
                raise ValueError(f"ClassificationJob {resource_id} not found.")
        elif resource_type == ResourceType.DATASET:
            dataset = self.session.get(Dataset, resource_id)
            if dataset:
                entity_uuid_str = str(dataset.entity_uuid)
                source_entity_name = dataset.name
            else:
                logger.error(f"Dataset with ID {resource_id} not found.")
                raise ValueError(f"Dataset {resource_id} not found.")
        elif resource_type == ResourceType.WORKSPACE:
            workspace = self.session.get(Workspace, resource_id)
            if workspace:
                # Workspaces might not have a direct entity_uuid in the same way, 
                # but we need some unique identifier. Using ID for now if no UUID.
                entity_uuid_str = f"workspace_export_{workspace.id}" # Placeholder, consider adding UUID to Workspace if not present
                source_entity_name = workspace.name
            else:
                logger.error(f"Workspace with ID {resource_id} not found.")
                raise ValueError(f"Workspace {resource_id} not found.")
        else:
            raise NotImplementedError(f"Export for resource type {resource_type} is not implemented.")

        if not entity_uuid_str:
            entity_uuid_str = str(uuid.uuid4()) # Fallback if no entity_uuid found
            logger.warning(f"Using fallback UUID for {resource_type.value} ID {resource_id} during export.")

        package_metadata = PackageMetadata(
            package_type=resource_type,
            source_entity_uuid=entity_uuid_str, # This should be the UUID of the exported entity
            source_instance_id=self.source_instance_id,
            created_by=str(user_id) # Or fetch user email/name
        )

        # Build the package content using PackageBuilder
        builder = PackageBuilder(self.session, self.storage_provider, self.source_instance_id)
        
        # Based on resource_type, call the appropriate builder method
        if resource_type == ResourceType.DATA_SOURCE:
            ds = self.session.get(DataSource, resource_id)
            if not ds: raise ValueError(f"DataSource {resource_id} not found for building package.")
            package = await builder.build_datasource_package(ds, include_records=True) # Defaulting to include_records=True for now
            export_filename_base = f"datasource_{ds.name.replace(' ', '_')}_{resource_id}"
        elif resource_type == ResourceType.SCHEMA:
            cs = self.session.get(ClassificationScheme, resource_id)
            if not cs: raise ValueError(f"Scheme {resource_id} not found for building package.")
            package = await builder.build_scheme_package(cs)
            export_filename_base = f"scheme_{cs.name.replace(' ', '_')}_{resource_id}"
        elif resource_type == ResourceType.CLASSIFICATION_JOB:
            cj = self.session.get(ClassificationJob, resource_id)
            if not cj: raise ValueError(f"Job {resource_id} not found for building package.")
            package = await builder.build_job_package(cj, include_results=True) # Defaulting to include_results=True
            export_filename_base = f"job_{cj.name.replace(' ', '_')}_{resource_id}"
        elif resource_type == ResourceType.DATASET:
            d = self.session.get(Dataset, resource_id)
            if not d: raise ValueError(f"Dataset {resource_id} not found for building package.")
            # include_record_content, include_results, include_source_files can be parameterized later
            package = await builder.build_dataset_package(d, include_record_content=True, include_results=True, include_source_files=True)
            export_filename_base = f"dataset_{d.name.replace(' ', '_')}_{resource_id}"
        elif resource_type == ResourceType.WORKSPACE:
            # Workspace export is more complex, involves multiple sub-packages.
            # The WorkspaceService.export_workspace method already returns a DataPackage.
            if not self.workspace_service:
                raise ValueError("WorkspaceService is not available for workspace export.")
            package = await self.workspace_service.export_workspace(workspace_id=resource_id, user_id=user_id)
            export_filename_base = f"workspace_{package.metadata.source_entity_uuid or resource_id}" # Use UUID if available
        else:
            raise NotImplementedError(f"Package building for {resource_type} not implemented.")

        if not package:
            raise ValueError(f"Failed to build package for {resource_type.value} ID {resource_id}.")

        # Override package metadata with the one we created with user_id and source_instance_id
        package.metadata = package_metadata

        # Always create a zip package for this method as per new design
        temp_zip_file_path, _ = self._create_temp_file(prefix=f"{export_filename_base}_", suffix=".zip")
        try:
            package.to_zip(temp_zip_file_path)
            logger.info(f"Successfully created individual zip package at {temp_zip_file_path} for {resource_type.value} ID {resource_id}")
            # The DataPackage object might be useful for some callers, but the path is primary for zipping operations
            return package, temp_zip_file_path 
        except Exception as e_zip:
            logger.error(f"Failed to zip package for {resource_type.value} ID {resource_id} at {temp_zip_file_path}: {e_zip}", exc_info=True)
            # Clean up the failed zip attempt if it exists
            self._cleanup_temp_file(temp_zip_file_path)
            raise # Re-raise the zipping error

    async def export_resource(
        self,
        user_id: int,
        resource_type: ResourceType,
        resource_id: int
    ) -> Tuple[str, str]: # Returns (filepath, filename)
        """Exports a single resource as a downloadable package (ZIP)."""
        logger.info(f"Exporting single resource: {resource_type.value} ID {resource_id} for user {user_id}")
        
        # Validate ownership
        await asyncio.to_thread(self._validate_resource_ownership, resource_type, resource_id, user_id)

        try:
            # _get_export_data_for_resource now always returns a DataPackage and a path to its zip
            _package_object, temp_zip_file_path = await self._get_export_data_for_resource(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id,
                create_zip_package=True # Explicitly true, though it's the default now
            )
            
            # The suggested filename for download comes from the basename of the created zip file path
            suggested_filename = os.path.basename(temp_zip_file_path)
            
            logger.info(f"Single resource export ready. File: {temp_zip_file_path}, Suggested download name: {suggested_filename}")
            return temp_zip_file_path, suggested_filename
        except Exception as e:
            logger.error(f"Error during single resource export ({resource_type.value} ID {resource_id}): {e}", exc_info=True)
            # Ensure no temp file is left if _get_export_data_for_resource partially succeeded then failed
            # Note: _get_export_data_for_resource should handle its own temp file cleanup on its errors.
            # Here, we are catching errors from the call to _get_export_data_for_resource itself or ownership validation.
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to export {resource_type.value}: {str(e)}"
            )

    async def export_resources_batch(
        self,
        user_id: int,
        resource_type: ResourceType,
        resource_ids: List[int]
    ) -> Tuple[str, str]:
        """
        Export multiple resources of the same type to a ZIP archive.
        Each resource is packaged appropriately (JSON or individual ZIP if it contains files)
        and then added to a main batch ZIP archive.
        Returns the file path to the batch zip file and a suggested filename.
        """
        if not resource_ids:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No resource IDs provided for batch export.")

        logger.info(f"Validating ownership for {len(resource_ids)} resources of type {resource_type.value} for user {user_id}.")
        for res_id in resource_ids:
            try:
                self._validate_resource_ownership(
                    resource_type=resource_type,
                    resource_id=res_id,
                    user_id=user_id
                )
            except HTTPException as he:
                logger.warning(f"Ownership validation failed for {resource_type.value}:{res_id} - {he.detail}")
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail=f"User does not have permission to export one or more selected resources (e.g., {resource_type.value} ID {res_id})."
                )

        batch_zip_temp_path, _ = self._create_temp_file(f"export_batch_{resource_type.value}_", suffix=".zip")
        suggested_batch_zip_filename = f"export_batch_{resource_type.value}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}.zip"

        logger.info(f"Starting batch export for {len(resource_ids)} resources of type {resource_type.value} to {batch_zip_temp_path}")
        failed_exports: Dict[int, str] = {}
        temp_files_to_clean = [] # Initialize empty, will not include batch_zip_temp_path initially

        try:
            with zipfile.ZipFile(batch_zip_temp_path, 'w', zipfile.ZIP_DEFLATED) as zf_batch:
                exported_files_count = 0
                for res_id in resource_ids:
                    temp_package_path: Optional[str] = None # Ensure it's defined for finally block
                    try:
                        # _get_export_data_for_resource should return the path to the created individual package ZIP
                        # and the package data itself (which might be None if only path is relevant)
                        # For now, assuming it correctly creates a zip and returns its path.
                        # The previous logic for handling non-zipped DataPackage content directly in batch seems complex.
                        # It's simpler if _get_export_data_for_resource *always* produces a zip for batch export items.
                        # Let's assume _get_export_data_for_resource is modified or already behaves this way:
                        # It creates a temporary zip file for the individual resource and returns its path.
                        
                        # This call should result in a temporary zip file being created for the resource.
                        # The second element of the tuple is the path to this temporary zip file.
                        _, temp_package_path = await self._get_export_data_for_resource(
                            user_id=user_id,
                            resource_type=resource_type,
                            resource_id=res_id
                        )

                        if temp_package_path and os.path.exists(temp_package_path) and os.path.getsize(temp_package_path) > 0:
                            archive_name = os.path.basename(temp_package_path) # e.g., datasource_123.zip
                            zf_batch.write(temp_package_path, arcname=archive_name)
                            exported_files_count += 1
                            logger.info(f"Successfully added {archive_name} to batch zip {os.path.basename(batch_zip_temp_path)}.")
                        elif temp_package_path: # Path was returned but file is missing or empty
                            logger.error(f"Skipping resource ID {res_id} of type {resource_type.value} for batch export: individual package file '{temp_package_path}' is missing or empty.")
                            failed_exports[res_id] = f"Individual package file '{os.path.basename(temp_package_path)}' was missing or empty."
                        else: # No path was returned, implies error in _get_export_data_for_resource
                            logger.error(f"Skipping resource ID {res_id} of type {resource_type.value} for batch export: failed to generate individual package.")
                            failed_exports[res_id] = "Failed to generate individual package (no path returned)."
                    
                    except Exception as e_inner:
                        logger.error(f"Error exporting resource ID {res_id} of type {resource_type.value} for batch: {e_inner}", exc_info=True)
                        failed_exports[res_id] = str(e_inner)
                    finally:
                        if temp_package_path and os.path.exists(temp_package_path):
                            self._cleanup_temp_file(temp_package_path)
            
            if not exported_files_count and resource_ids: # If there were items to export but none succeeded
                self._cleanup_temp_file(batch_zip_temp_path) 
                error_summary = "; ".join([f"ID {k}: {v}" for k,v in failed_exports.items()])
                raise ValueError(f"Batch export failed for all {len(resource_ids)} resources. Errors: {error_summary}")
            elif failed_exports:
                logger.warning(f"Batch export completed with some failures. Successful: {exported_files_count}, Failed: {len(failed_exports)}. Failures: {failed_exports}")

            logger.info(f"Batch export of {exported_files_count} items successful. Main ZIP file: {batch_zip_temp_path}")
            return batch_zip_temp_path, suggested_batch_zip_filename

        except HTTPException as he:
            # If an exception occurs before successful return, ensure the main batch_zip_temp_path is cleaned up.
            self._cleanup_temp_file(batch_zip_temp_path)
            raise he
        except Exception as e:
            # If an exception occurs before successful return, ensure the main batch_zip_temp_path is cleaned up.
            self._cleanup_temp_file(batch_zip_temp_path)
            logger.error(f"Error during batch export zip creation for {resource_type.value}: {e}", exc_info=True)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create batch export archive: {str(e)}")
        finally:
            # Cleanup only intermediate temp files. The main batch_zip_temp_path is handled by BackgroundTasks in the route.
            for temp_file_path in temp_files_to_clean:
                 self._cleanup_temp_file(temp_file_path)

    async def import_resource(
        self,
        user_id: int,
        workspace_id: int,
        file: UploadFile
    ) -> Dict[str, Any]:
        validate_workspace_access(self.session, workspace_id, user_id)
        package_importer = PackageImporter(session=self.session, storage_provider=self.storage_provider, target_workspace_id=workspace_id, target_user_id=user_id)
        
        outer_temp_upload_filepath = None
        temp_extraction_dir = None # Initialize here
        is_batch_attempt = False # Initialize here
        successful_imports = [] # Initialize here
        failed_imports = [] # Initialize here
        
        try:
            # Save the uploaded file to a temporary path first
            with tempfile.NamedTemporaryFile(delete=False, suffix=os.path.splitext(file.filename)[1]) as tmp_outer_file:
                outer_temp_upload_filepath = tmp_outer_file.name
                shutil.copyfileobj(file.file, tmp_outer_file)

            if file.filename.lower().endswith(".zip"):
                logger.info(f"Processing uploaded ZIP package: {file.filename}")
                
                # successful_imports = [] # Moved initialization up
                # failed_imports = [] # Moved initialization up
                # is_batch_attempt = False # Moved initialization up

                try: # Attempt to load as a single DataPackage first (corresponds to 'except KeyError' at line ~903)
                    main_package_from_zip = DataPackage.from_zip(outer_temp_upload_filepath)
                    logger.info(f"Successfully parsed {file.filename} as a single resource package.")
                    
                    package_type = main_package_from_zip.metadata.package_type
                    logger.info(f"Preparing to import single ZIP package. Type: {package_type}, Source UUID: {main_package_from_zip.metadata.source_entity_uuid}")
                    
                    imported_resource_id = None
                    imported_resource_name = "N/A"

                    if package_type == ResourceType.DATA_SOURCE:
                        imported_ds = await package_importer.import_datasource_package(package=main_package_from_zip)
                        imported_resource_id = imported_ds.id
                        imported_resource_name = imported_ds.name
                        # ADD THIS BLOCK: Enqueue Celery task for processing
                        if imported_ds.type in [DataSourceType.CSV, DataSourceType.PDF, DataSourceType.URL_LIST]:
                            process_datasource.delay(imported_ds.id)
                            logger.info(f"Enqueued process_datasource task for imported single ZIP DataSource ID: {imported_ds.id}, Type: {imported_ds.type.value}")
                    elif package_type == ResourceType.SCHEMA:
                        imported_scheme = await package_importer.import_scheme_package(package=main_package_from_zip)
                        imported_resource_id = imported_scheme.id
                        imported_resource_name = imported_scheme.name
                    elif package_type == ResourceType.CLASSIFICATION_JOB:
                        imported_job = await package_importer.import_job_package(package=main_package_from_zip)
                        imported_resource_id = imported_job.id
                        imported_resource_name = imported_job.name
                    elif package_type == ResourceType.DATASET:
                        imported_dataset = await package_importer.import_dataset_package(package=main_package_from_zip)
                        imported_resource_id = imported_dataset.id
                        imported_resource_name = imported_dataset.name
                    else: # This else belongs to the if/elif chain for package_type
                        logger.error(f"Unsupported package type for single import: {package_type}")
                        raise ValueError(f"Importing single package type '{package_type.value if package_type else 'unknown'}' is not supported here.")

                    self.session.commit()
                    logger.info(f"Successfully imported single package {package_type.value} '{imported_resource_name}' (ID: {imported_resource_id}) into workspace {workspace_id}")
                    return {
                        "message": f"{package_type.value} '{imported_resource_name}' imported successfully.",
                        "resource_type": package_type.value,
                        "imported_resource_id": imported_resource_id,
                        "imported_resource_name": imported_resource_name,
                        "workspace_id": workspace_id
                    }

                except KeyError as e: # This 'except' corresponds to the 'try' at line ~861
                    if "manifest.json" not in str(e):
                        logger.error(f"Unexpected KeyError during initial ZIP processing for {file.filename}: {e}", exc_info=True)
                        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error processing ZIP file content: {str(e)}")

                    logger.info(f"Root manifest.json not found in {file.filename}. Checking for inner ZIP packages (batch import attempt).")
                    is_batch_attempt = True
                    temp_extraction_dir = tempfile.mkdtemp(prefix="batch_import_")
                    inner_zip_members = [] # Define here for broader scope in case of error before assignment

                    try: # This 'try' is for the batch processing logic (corresponds to 'except Exception' at line ~993 and 'finally' at line ~1008)
                        with zipfile.ZipFile(outer_temp_upload_filepath, 'r') as zf_outer:
                            inner_zip_members = [m for m in zf_outer.infolist() if not m.is_dir() and m.filename.lower().endswith(".zip")]

                            if not inner_zip_members:
                                logger.warning(f"{file.filename} had no root manifest and no inner .zip files. It's not a valid single package or recognized batch.")
                                raise ValueError(
                                    "The provided ZIP file does not appear to be a single valid resource package (missing root 'manifest.json') "
                                    "and does not contain inner .zip packages for batch import."
                                )

                            for member_info in inner_zip_members:
                                inner_zip_filename = os.path.basename(member_info.filename)
                                inner_temp_zip_path = os.path.join(temp_extraction_dir, inner_zip_filename)
                                
                                try: # This 'try' is for processing one inner package (corresponds to 'except Exception' at line ~970 and 'finally' at line ~978)
                                    with zf_outer.open(member_info) as source, open(inner_temp_zip_path, "wb") as target:
                                        shutil.copyfileobj(source, target)
                                    
                                    logger.info(f"Processing inner package: {inner_zip_filename}")
                                    inner_package = DataPackage.from_zip(inner_temp_zip_path)
                                    inner_package_type = inner_package.metadata.package_type
                                    
                                    imported_id, imported_name = None, "N/A" # Initialize here
                                    imported_item = None

                                    if inner_package_type == ResourceType.DATA_SOURCE:
                                        logger.info(f"Attempting to import DataSource package: {inner_zip_filename}")
                                        imported_item = await package_importer.import_datasource_package(package=inner_package)
                                        logger.info(f"Importer returned: {imported_item} (type: {type(imported_item)}) for {inner_zip_filename}")

                                        if imported_item:
                                            logger.info(f"Checking imported_item attributes. Has ID: {hasattr(imported_item, 'id')}, Has Name: {hasattr(imported_item, 'name')}, Has Type: {hasattr(imported_item, 'type')}")
                                            if hasattr(imported_item, 'type') and imported_item.type in [DataSourceType.CSV, DataSourceType.PDF, DataSourceType.URL_LIST]:
                                                process_datasource.delay(imported_item.id)
                                                logger.info(f"Enqueued process_datasource task for imported inner ZIP DataSource ID: {imported_item.id}, Type: {imported_item.type.value}")
                                            elif not hasattr(imported_item, 'type'):
                                                logger.error(f"CRITICAL: imported_item for {inner_zip_filename} (ID: {getattr(imported_item, 'id', 'N/A')}) is missing 'type' attribute!")
                                        else:
                                            logger.warning(f"Importer returned None for {inner_zip_filename}, cannot enqueue Celery task.")

                                    elif inner_package_type == ResourceType.SCHEMA:
                                        imported_item = await package_importer.import_scheme_package(package=inner_package)
                                    elif inner_package_type == ResourceType.CLASSIFICATION_JOB:
                                        imported_item = await package_importer.import_job_package(package=inner_package)
                                    elif inner_package_type == ResourceType.DATASET:
                                        imported_item = await package_importer.import_dataset_package(package=inner_package)
                                    else:
                                        raise ValueError(f"Unsupported package type '{inner_package_type.value if inner_package_type else 'unknown'}' found in inner ZIP {inner_zip_filename}.")
                                    
                                    if imported_item:
                                        logger.info(f"Post-import, imported_item: {imported_item}, ID: {getattr(imported_item[0], 'id', 'N/A') if imported_item else 'N/A'}, Name: {getattr(imported_item[0], 'name', 'N/A') if imported_item else 'N/A'}")
                                        imported_id, imported_name = imported_item[0].id, imported_item[0].name
                                    else:
                                        raise ValueError(f"Importer returned None for package {inner_zip_filename} of type {inner_package_type.value if inner_package_type else 'Unknown'}")

                                    self.session.commit()
                                    successful_imports.append({
                                        "filename": inner_zip_filename,
                                        "resource_type": inner_package_type.value,
                                        "imported_resource_id": imported_id,
                                        "imported_resource_name": imported_name,
                                        "status": "success"
                                    })
                                    logger.info(f"Successfully imported inner package {inner_zip_filename} as {inner_package_type.value} ID {imported_id}")

                                except Exception as inner_e: # This 'except' corresponds to the 'try' at line ~930
                                    self.session.rollback()
                                    logger.error(f"Failed to import inner package {inner_zip_filename}: {inner_e}", exc_info=True)
                                    failed_imports.append({
                                        "filename": inner_zip_filename,
                                        "status": "failed",
                                        "error": str(inner_e)
                                    })
                                finally: # This 'finally' corresponds to the 'try' at line ~930
                                    if os.path.exists(inner_temp_zip_path):
                                        os.remove(inner_temp_zip_path)
                        
                        # This return is for the batch processing path, after the loop
                        return { # Correctly indented for the batch try block
                            "message": "Batch import process completed.",
                            "batch_summary": {
                                "total_files_processed": len(inner_zip_members),
                                "successful_imports": successful_imports,
                                "failed_imports": failed_imports
                            },
                            "workspace_id": workspace_id
                        }

                    except Exception as batch_processing_error: # This 'except' corresponds to the 'try' at line ~915
                        logger.error(f"Error during batch ZIP processing of {file.filename}: {batch_processing_error}", exc_info=True)
                        # If it was a batch attempt that failed partway, return partial results
                        if successful_imports or failed_imports: # Check if any processing happened
                            return {
                                "message": "Batch import process encountered an error.",
                                "batch_summary": {
                                    "total_files_processed": len(inner_zip_members),
                                    "successful_imports": successful_imports,
                                    "failed_imports": failed_imports + [{"filename": "overall_batch_process", "status": "failed", "error": str(batch_processing_error)}],
                                },
                                "workspace_id": workspace_id
                            }
                        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid or corrupted ZIP package for batch import: {str(batch_processing_error)}")
                    finally: # This 'finally' corresponds to the 'try' at line ~915
                        if temp_extraction_dir and os.path.exists(temp_extraction_dir):
                             shutil.rmtree(temp_extraction_dir)
                             logger.info(f"Cleaned up batch import temporary extraction directory: {temp_extraction_dir}")
            
            elif file.filename.lower().endswith(".json"):
                file_content = await file.read()
                parsed_json_content = json.loads(file_content.decode('utf-8'))
                logger.info(f"Successfully parsed JSON file: {file.filename}")

                metadata_dict = parsed_json_content.get("metadata")
                content_dict = parsed_json_content.get("content")
                if not metadata_dict or not content_dict:
                    raise ValueError("JSON package is missing 'metadata' or 'content' top-level keys.")
                metadata_obj = PackageMetadata.from_dict(metadata_dict)
                package_to_import = DataPackage(metadata=metadata_obj, content=content_dict, files=None)
                package_type = metadata_obj.package_type
                logger.info(f"Preparing to import from JSON package. Type: {package_type}, Source UUID: {metadata_obj.source_entity_uuid}")
                
                imported_resource_id = None
                imported_resource_name = "N/A"

                if package_type == ResourceType.DATA_SOURCE:
                    imported_ds = await package_importer.import_datasource_package(package=package_to_import)
                    imported_resource_id = imported_ds.id
                    imported_resource_name = imported_ds.name
                    # ADD THIS BLOCK: Enqueue Celery task for processing
                    if imported_ds.type in [DataSourceType.CSV, DataSourceType.PDF, DataSourceType.URL_LIST]:
                        process_datasource.delay(imported_ds.id)
                        logger.info(f"Enqueued process_datasource task for imported JSON DataSource ID: {imported_ds.id}, Type: {imported_ds.type.value}")
                elif package_type == ResourceType.SCHEMA:
                    imported_scheme = await package_importer.import_scheme_package(package=package_to_import)
                    imported_resource_id = imported_scheme.id
                    imported_resource_name = imported_scheme.name
                elif package_type == ResourceType.CLASSIFICATION_JOB:
                    imported_job = await package_importer.import_job_package(package=package_to_import)
                    imported_resource_id = imported_job.id
                    imported_resource_name = imported_job.name
                elif package_type == ResourceType.DATASET:
                    imported_dataset = await package_importer.import_dataset_package(package=package_to_import)
                    imported_resource_id = imported_dataset.id
                    imported_resource_name = imported_dataset.name
                else:
                    logger.error(f"Unsupported package type for JSON import: {package_type}")
                    raise ValueError(f"Importing JSON package type '{package_type.value if package_type else 'unknown'}' is not supported.")

                self.session.commit()
                logger.info(f"Successfully imported JSON package {package_type.value} '{imported_resource_name}' (ID: {imported_resource_id}) into workspace {workspace_id}")
                return {
                    "message": f"{package_type.value} '{imported_resource_name}' imported successfully from JSON.",
                    "resource_type": package_type.value,
                    "imported_resource_id": imported_resource_id,
                    "imported_resource_name": imported_resource_name,
                    "workspace_id": workspace_id
                }
            else:
                logger.error(f"Service layer received unexpected file type: {file.filename}")
                raise ValueError("Unsupported file type passed to service. Only .json or .zip files are accepted.")

        except ValueError as ve: # Corresponds to the outermost try block
            self.session.rollback()
            logger.warning(f"ValueError during import resource for user {user_id}, workspace {workspace_id}: {ve}", exc_info=True)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
        except HTTPException as he: # Corresponds to the outermost try block
            self.session.rollback()
            raise he # Re-raise if it's already an HTTPException
        except Exception as e: # Corresponds to the outermost try block
            self.session.rollback()
            logger.exception(f"General error importing resource from file {file.filename}: {e}")
            # Return batch summary if available, even on general error
            if is_batch_attempt and (successful_imports or failed_imports): # Check if batch attempt was made and had some results
                 return {
                    "message": "Batch import process resulted in a general error.",
                    "batch_summary": {
                        "total_files_processed": len(inner_zip_members) if 'inner_zip_members' in locals() and inner_zip_members is not None else 0,
                        "successful_imports": successful_imports,
                        "failed_imports": failed_imports + [{"filename": "overall_batch_process", "status": "failed", "error": str(e)}],
                    },
                    "workspace_id": workspace_id
                }
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Internal server error during import: {str(e)}")
        finally: # Corresponds to the outermost try block
            if outer_temp_upload_filepath and os.path.exists(outer_temp_upload_filepath):
                os.remove(outer_temp_upload_filepath)
                logger.info(f"Cleaned up main temporary import file: {outer_temp_upload_filepath}")
            # temp_extraction_dir is cleaned up within its own try/finally if batch attempt was made
    
    async def get_dataset_package_summary_from_token(
        self,
        requesting_user_id: Optional[int],
        token: str
    ) -> DatasetPackageSummary:
        """
        Retrieves a summary of a shared dataset package using its token.
        Does not perform a full import.
        """
        logger.info(f"User '{requesting_user_id if requesting_user_id else 'Anonymous'}' attempting to get summary for dataset package token: {token[:6]}...")

        if not self.dataset_service:
            raise RuntimeError("DatasetService is not available in ShareableService.")

        # 1. Validate token and get original dataset ID and owner ID
        shared_info = self.access_shared_resource(
            token=token,
            requesting_user_id=requesting_user_id
        )

        if shared_info.get("resource_type") != ResourceType.DATASET.value:
            raise ValueError("The provided token does not correspond to a Dataset resource.")

        # original_dataset_id is in shared_info["metadata"] from how access_shared_resource for DATASET is structured
        shared_metadata = shared_info.get("metadata", {})
        original_dataset_id = shared_metadata.get("original_dataset_id")
        
        # We need the original owner_id to correctly call export_dataset_package.
        # The shareable link stores user_id of the link creator, which should be the resource owner.
        link_details = self.get_link_by_token(token) # Fetch the link to get its user_id
        if not link_details:
             # Should have been caught by access_shared_resource, but defensive check.
            raise ValueError("Invalid or expired token (link details not found).")
        original_owner_id = link_details.user_id
        original_workspace_id = shared_metadata.get("original_workspace_id") # Get this too for export context

        if not original_dataset_id or not original_owner_id or not original_workspace_id:
            missing_parts = []
            if not original_dataset_id: missing_parts.append("original_dataset_id")
            if not original_owner_id: missing_parts.append("original_owner_id")
            if not original_workspace_id: missing_parts.append("original_workspace_id")
            raise ValueError(f"Could not retrieve necessary original dataset details from token data: missing {', '.join(missing_parts)}.")

        logger.info(f"Token validated for dataset summary. Original Dataset ID: {original_dataset_id}, Original Workspace ID: {original_workspace_id}, Original Owner ID: {original_owner_id}")

        # 2. Export the original dataset package (in-memory)
        # We need results and source file manifest for a good summary.
        # Record content can be skipped to save on payload if it's very large.
        try:
            package = await self.dataset_service.export_dataset_package(
                user_id=original_owner_id, # Use original owner for export permission
                workspace_id=original_workspace_id,
                dataset_id=original_dataset_id,
                include_record_content=False, # Usually not needed for summary
                include_results=True, # Needed for results count
                include_source_files=True # Needed for source_files_manifest
            )
        except Exception as e:
            logger.error(f"Failed to internally export dataset {original_dataset_id} for summary: {e}", exc_info=True)
            raise RuntimeError(f"Could not retrieve dataset package details: {str(e)}")

        # 3. Populate the summary from the package
        pkg_meta_dict = package.metadata.to_dict()
        pkg_content = package.content

        dataset_content_details = pkg_content.get("dataset", {})
        summary_dataset_details = DatasetPackageEntitySummary(
            entity_uuid=dataset_content_details.get("entity_uuid"),
            name=dataset_content_details.get("name"),
            description=dataset_content_details.get("description")
        )

        records_list = pkg_content.get("records", [])
        record_count = len(records_list)
        
        results_count = 0
        for record in records_list:
            results_count += len(record.get("classification_results", []))

        schemes_summary_list: List[DatasetPackageEntitySummary] = []
        for scheme_data in pkg_content.get("classification_schemes", []):
            schemes_summary_list.append(DatasetPackageEntitySummary(
                entity_uuid=scheme_data.get("entity_uuid"),
                name=scheme_data.get("name"),
                description=scheme_data.get("description")
            ))

        jobs_summary_list: List[DatasetPackageEntitySummary] = []
        for job_data in pkg_content.get("classification_jobs", []):
            jobs_summary_list.append(DatasetPackageEntitySummary(
                entity_uuid=job_data.get("entity_uuid"),
                name=job_data.get("name"),
                description=job_data.get("description")
            ))
        
        linked_ds_summary_map: Dict[str, DatasetPackageEntitySummary] = {}
        for record in records_list:
            ds_ref = record.get("datasource_ref")
            if ds_ref and isinstance(ds_ref, dict) and ds_ref.get("entity_uuid"):
                if ds_ref["entity_uuid"] not in linked_ds_summary_map:
                    linked_ds_summary_map[ds_ref["entity_uuid"]] = DatasetPackageEntitySummary(
                        entity_uuid=ds_ref.get("entity_uuid"),
                        name=ds_ref.get("name")
                        # type=ds_ref.get("type") # Add if needed in summary model
                    )
        linked_datasources_summary = list(linked_ds_summary_map.values())

        files_manifest_list: List[DatasetPackageFileManifestItem] = []
        for file_item in pkg_content.get("source_files_manifest", []):
            files_manifest_list.append(DatasetPackageFileManifestItem(**file_item))

        return DatasetPackageSummary(
            package_metadata=pkg_meta_dict,
            dataset_details=summary_dataset_details,
            record_count=record_count,
            classification_results_count=results_count,
            included_schemes=schemes_summary_list,
            included_jobs=jobs_summary_list,
            linked_datasources_summary=linked_datasources_summary,
            source_files_manifest=files_manifest_list
        ) 