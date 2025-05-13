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

from fastapi import Depends, HTTPException, UploadFile, status
from sqlmodel import Session, select, func, col

# Use conditional imports to avoid circular import
if TYPE_CHECKING:
    from app.api.services.classification import ClassificationService
    from app.api.services.ingestion import IngestionService
    from app.api.services.workspace import WorkspaceService

# Import base types for dependencies
from app.api.services.classification import ClassificationService
from app.api.services.ingestion import IngestionService
from app.api.services.workspace import WorkspaceService
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

logger = logging.getLogger(__name__)

class ShareableService:
    """
    Service for managing shareable links to resources.
    """

    def __init__(
        self,
        session: Session, # Use base Session type
        ingestion_service: IngestionService, # Use base IngestionService type
        classification_service: ClassificationService, # Use base ClassificationService type
        workspace_service: WorkspaceService, # Use base WorkspaceService type
        dataset_service: DatasetService, # Assign dataset_service
        storage_provider: StorageProvider, # ADDED
        # source_instance_id: Optional[str] = None # Optional for now, can be fetched from settings
    ):
        """Initialize service with dependencies."""
        self.session = session
        self.ingestion_service = ingestion_service
        self.classification_service = classification_service
        self.workspace_service = workspace_service
        self.dataset_service = dataset_service
        self.storage_provider = storage_provider # ADDED
        self.source_instance_id = settings.INSTANCE_ID if settings.INSTANCE_ID else "default_instance" # ADDED
        self.token_length = 24  # Length of the token for shareable links
        logger.info(f"ShareableService initialized with source_instance_id: {self.source_instance_id}")
    
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
        resource_id: int
    ) -> Tuple[Union[DataPackage, Dict[str, Any]], str]:
        """
        Generates the export data (as DataPackage or Dict) and a suggested filename for a single resource.
        Assumes ownership has already been validated by the caller (_validate_resource_ownership).
        """
        # Fetch the resource first to pass to PackageBuilder
        resource = self._get_resource_by_type(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id # Pass user_id for ownership context in underlying service calls
        )
        if not resource:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{resource_type.value} with ID {resource_id} not found or not accessible by user {user_id}")

        builder = PackageBuilder(
            session=self.session,
            storage_provider=self.storage_provider,
            source_instance_id=self.source_instance_id
        )
        
        package: Optional[DataPackage] = None
        filename_suffix = "json" # Default suffix

        if resource_type == ResourceType.DATA_SOURCE:
            assert isinstance(resource, DataSource), "Resource is not a DataSource"
            package = await builder.build_datasource_package(resource, include_records=True, include_results=False) # Shareable link export: records=True, results=False (can be configured)
            filename_suffix = "zip" # DataSources can have files
        elif resource_type == ResourceType.SCHEMA:
            assert isinstance(resource, ClassificationScheme), "Resource is not a ClassificationScheme"
            package = await builder.build_scheme_package(resource, include_results=False) # Shareable link export: results=False
            # filename_suffix remains json
        elif resource_type == ResourceType.CLASSIFICATION_JOB:
            assert isinstance(resource, ClassificationJob), "Resource is not a ClassificationJob"
            package = await builder.build_job_package(resource, include_results=True) # Shareable link export: results=True
            # filename_suffix remains json
        elif resource_type == ResourceType.DATASET:
            assert isinstance(resource, Dataset), "Resource is not a Dataset"
            # For datasets, assume comprehensive export by default for sharing
            package = await builder.build_dataset_package(resource, include_record_content=True, include_results=True)
            filename_suffix = "zip" # Datasets can have files
        elif resource_type == ResourceType.WORKSPACE:
            # This is a larger refactor for full workspace packaging
            assert isinstance(resource, Workspace), "Resource is not a Workspace"
            # Workspace export now returns a DataPackage
            package = await self.workspace_service.export_workspace(
                workspace_id=resource_id,
                user_id=user_id,
                include_datasources=True, 
                include_schemes=True,
                include_jobs=True,
                include_datasets=True, # Default to true for a comprehensive workspace package
                include_records_for_datasources=True,
                include_results_for_jobs=True
            )
            filename_suffix = "zip" # Workspace package will now be a zip
        else:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported resource type for export: {resource_type}")

        # Construct filename
        # Ensure resource_name_slug is derived from package.metadata.description or similar if resource.name is not directly on package
        # For now, this relies on 'resource' object being the original DB model, which is correct here.
        resource_name_slug = getattr(resource, 'name', resource_type.value).lower().replace(' ', '_')
        filename = f"{resource_name_slug}_{resource_id}.{filename_suffix}"

        if package: # Should always be a package now for supported types
            logger.debug(f"Prepared DataPackage for {resource_type.value} {resource_id}. Files included: {bool(package.files)}. Suggested filename: {filename}")
            return package, filename
        # ELIF EXPORT_DICT IS NOW OBSOLETE AS WORKSPACE EXPORT RETURNS DATAPACKAGE
        # elif export_dict: 
        #     logger.debug(f"Prepared Dict export for {resource_type.value} {resource_id}.")
        #     return export_dict, filename 
        else:
            # This should not be reached if logic is correct
            logger.error(f"_get_export_data_for_resource failed to produce a DataPackage for {resource_type.value} {resource_id}")
            raise ValueError(f"Could not generate export data for {resource_type.value} {resource_id}")

    async def export_resource(
        self,
        user_id: int,
        resource_type: ResourceType,
        resource_id: int
    ) -> Tuple[str, str]:
        """
        Export a single resource to a file (JSON or ZIP based on content).
        Returns the file path and suggested filename.
        """
        # Validate resource ownership first
        self._validate_resource_ownership(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id
        )
        
        temp_path: Optional[str] = None # Initialize to avoid reference before assignment in finally
        try:
            export_content, suggested_filename = await self._get_export_data_for_resource(
                user_id=user_id,
                resource_type=resource_type,
                resource_id=resource_id
            )
            
            # Determine suffix for temp file based on actual content type
            actual_suffix = ".zip" if isinstance(export_content, DataPackage) and export_content.files else ".json"
            temp_path, _ = self._create_temp_file(f"export_{resource_type.value}_{resource_id}_", suffix=actual_suffix)

            if isinstance(export_content, DataPackage):
                package = export_content
                if package.files: # Package has associated files, create a ZIP
                    logger.info(f"Exporting {resource_type.value} {resource_id} as ZIP to {temp_path}")
                    package.to_zip(temp_path)
                else: # No files in package, create a JSON (metadata + content)
                    logger.info(f"Exporting {resource_type.value} {resource_id} as JSON (no files in package) to {temp_path}")
                    package_json_content = {
                        "metadata": package.metadata.to_dict(),
                        "content": package.content
                    }
                    with open(temp_path, 'w') as f:
                        json.dump(package_json_content, f, indent=2)
            elif isinstance(export_content, dict): # For Workspace (currently returns Dict)
                logger.info(f"Exporting {resource_type.value} {resource_id} as JSON (dict) to {temp_path}")
                with open(temp_path, 'w') as f:
                    json.dump(export_content, f, indent=2)
            else:
                # Should not happen based on _get_export_data_for_resource logic
                raise TypeError(f"Unexpected export content type: {type(export_content)}")
            
            return temp_path, suggested_filename
        
        except HTTPException as he:
            if temp_path: self._cleanup_temp_file(temp_path)
            raise he
        except Exception as e:
            if temp_path: self._cleanup_temp_file(temp_path)
            logger.error(f"Error exporting {resource_type.value} {resource_id}: {e}", exc_info=True)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to export {resource_type.value}: {str(e)}")

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
        failed_exports = {}
        temp_files_to_clean = [batch_zip_temp_path] # Keep track of all temp files

        try:
            with zipfile.ZipFile(batch_zip_temp_path, 'w', zipfile.ZIP_DEFLATED) as zf_batch:
                for res_id in resource_ids:
                    individual_temp_package_zip_path: Optional[str] = None
                    try:
                        logger.debug(f"Exporting {resource_type.value}:{res_id} for batch...")
                        
                        export_content, individual_filename = await self._get_export_data_for_resource(
                            user_id=user_id,
                            resource_type=resource_type,
                            resource_id=res_id
                        )

                        if isinstance(export_content, DataPackage):
                            package = export_content
                            if package.files: # Package has files, create an individual ZIP for it
                                # Create a temp file for this individual package's ZIP
                                individual_temp_package_zip_path, _ = self._create_temp_file(prefix=f"pkg_{res_id}_", suffix=".zip")
                                temp_files_to_clean.append(individual_temp_package_zip_path)
                                
                                package.to_zip(individual_temp_package_zip_path)
                                # Add this individual ZIP to the main batch ZIP
                                zf_batch.write(individual_temp_package_zip_path, arcname=individual_filename) # individual_filename should be like 'datasource_X.zip'
                                logger.debug(f"Added individual ZIP {individual_filename} to batch archive.")
                            else: # No files in package, write its JSON content to batch ZIP
                                package_json_content = {
                                    "metadata": package.metadata.to_dict(),
                                    "content": package.content
                                }
                                zf_batch.writestr(individual_filename, json.dumps(package_json_content, indent=2))
                                logger.debug(f"Added individual JSON {individual_filename} (from DataPackage) to batch archive.")
                        elif isinstance(export_content, dict): # Workspace export (Dict)
                            zf_batch.writestr(individual_filename, json.dumps(export_content, indent=2))
                            logger.debug(f"Added individual JSON {individual_filename} (from Dict) to batch archive.")
                        else:
                            # Should not happen
                            raise TypeError(f"Unexpected export content type for {res_id}: {type(export_content)}")

                    except Exception as item_error:
                        logger.error(f"Failed to export item {resource_type.value}:{res_id} within batch: {item_error}", exc_info=True)
                        failed_exports[res_id] = str(item_error)
                    finally:
                        if individual_temp_package_zip_path: # Clean up temp zip for individual package if created
                            self._cleanup_temp_file(individual_temp_package_zip_path)
                            # Remove from general cleanup list as it's handled here
                            if individual_temp_package_zip_path in temp_files_to_clean:
                                temp_files_to_clean.remove(individual_temp_package_zip_path)
            
            if failed_exports:
                 raise HTTPException(
                     status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                     detail=f"Failed to export some resources within the batch: {failed_exports}"
                 )

            logger.info(f"Batch export successful. Main ZIP file created at {batch_zip_temp_path}")
            return batch_zip_temp_path, suggested_batch_zip_filename

        except HTTPException as he:
            # Batch zip path is already in temp_files_to_clean
            raise he # Re-raise to be caught by the outermost finally
        except Exception as e:
            # Batch zip path is already in temp_files_to_clean
            logger.error(f"Error during batch export zip creation for {resource_type.value}: {e}", exc_info=True)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to create batch export archive: {str(e)}")
        finally:
            # Cleanup all temp files created during this operation that weren't cleaned mid-process
            for temp_file_path in temp_files_to_clean:
                 self._cleanup_temp_file(temp_file_path)

    async def import_resource(
        self,
        user_id: int,
        workspace_id: int, # Target workspace_id for non-workspace imports
        file: UploadFile
    ) -> Dict[str, Any]:
        """
        Import a resource from an uploaded file (JSON or ZIP package).
        If importing a Workspace package, workspace_id is ignored as a new workspace is created.
        For other resource types, they are imported into the specified workspace_id.
        Returns information about the imported resource.
        """
        # For non-workspace imports, validate target workspace access
        # For workspace imports, a new one is created, so user must be valid, but workspace_id is N/A for target here.
        # The new WorkspaceService.import_workspace will handle creating a workspace for the user_id.

        temp_upload_filepath, _ = self._create_temp_file(f"import_{uuid.uuid4()}_", suffix=os.path.splitext(file.filename)[1] if file.filename else ".tmp")
        imported_resource_details: Optional[Any] = None
        imported_resource_id: Optional[int] = None
        resource_type_imported: Optional[ResourceType] = None
        message: str = ""
        is_workspace_package_import = False

        try:
            with open(temp_upload_filepath, "wb") as temp_file_writer:
                content = await file.read()
                temp_file_writer.write(content)

            package_to_import: Optional[DataPackage] = None

            if file.filename and file.filename.lower().endswith(".zip"):
                logger.info(f"Attempting to import ZIP package: {file.filename}")
                # Try to load as a generic DataPackage first to inspect metadata
                # This does not yet load all files from within the zip into memory for all nested packages.
                # DataPackage.from_zip just parses manifest.json and lists files.
                main_package_from_zip = DataPackage.from_zip(temp_upload_filepath)
                
                if main_package_from_zip.metadata.package_type == "workspace": # or ResourceType.WORKSPACE.value
                    logger.info(f"ZIP package identified as a Workspace package. Importing into a new workspace for user {user_id}.")
                    # WorkspaceService.import_workspace handles the full import from the ZIP filepath
                    imported_resource_details = await self.workspace_service.import_workspace(
                        user_id=user_id,
                        filepath=temp_upload_filepath 
                    )
                    resource_type_imported = ResourceType.WORKSPACE # Explicitly set
                    is_workspace_package_import = True
                    if imported_resource_details:
                        message = f"Successfully imported Workspace from ZIP package into new workspace ID {imported_resource_details.id}."
                else:
                    # It's a ZIP for another resource type (e.g., Dataset with files, DataSource with files)
                    logger.info(f"ZIP package identified as {main_package_from_zip.metadata.package_type.value}. Importing into workspace {workspace_id}.")
                    validate_workspace_access(self.session, workspace_id, user_id) # Validate for non-workspace imports
                    package_to_import = main_package_from_zip # Use the loaded package
                    resource_type_imported = package_to_import.metadata.package_type
            
            elif file.filename and file.filename.lower().endswith(".json"):
                logger.info(f"Attempting to import JSON file: {file.filename}. Importing into workspace {workspace_id}.")
                validate_workspace_access(self.session, workspace_id, user_id) # Validate for non-workspace imports
                with open(temp_upload_filepath, 'r') as f_json:
                    parsed_json = json.load(f_json)
                
                if "metadata" in parsed_json and "content" in parsed_json and "package_type" in parsed_json.get("metadata", {}):
                    logger.debug("JSON identified as DataPackage manifest (file-less package).")
                    metadata = PackageMetadata.from_dict(parsed_json["metadata"])
                    content_data = parsed_json["content"]
                    package_to_import = DataPackage(metadata=metadata, content=content_data, files={})
                    resource_type_imported = package_to_import.metadata.package_type
                    # Cannot be a workspace package if it's a single JSON manifest without files
                    if resource_type_imported == ResourceType.WORKSPACE:
                        raise ValueError("Workspace packages must be in ZIP format. Standalone JSON is not supported for workspace import.")
                else:
                    raise ValueError("Invalid JSON structure. Not a recognized DataPackage manifest. For Workspace import, use a ZIP package.")
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only .zip packages or .json manifests are allowed.")

            # Perform import for non-workspace packages using PackageImporter
            if package_to_import and not is_workspace_package_import:
                importer = PackageImporter(
                    session=self.session,
                    storage_provider=self.storage_provider,
                    target_workspace_id=workspace_id, # Target existing workspace
                    target_user_id=user_id
                )
                if resource_type_imported == ResourceType.DATA_SOURCE:
                    imported_resource_details = await importer.import_datasource_package(package_to_import)
                elif resource_type_imported == ResourceType.SCHEMA:
                    imported_resource_details = await importer.import_scheme_package(package_to_import)
                elif resource_type_imported == ResourceType.CLASSIFICATION_JOB:
                    imported_resource_details = await importer.import_job_package(package_to_import)
                elif resource_type_imported == ResourceType.DATASET:
                    imported_resource_details = await importer.import_dataset_package(package_to_import)
                else:
                    # This case should ideally be caught by earlier checks if package_type was unexpected
                    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Import not supported for this package type: {resource_type_imported.value if resource_type_imported else 'unknown'}")
                
                if imported_resource_details:
                    message = f"Successfully imported {resource_type_imported.value} from package into workspace {workspace_id}."
            
            # If it was not a non-workspace package import, and not a workspace package import, then something is wrong.
            elif not is_workspace_package_import and not package_to_import:
                 raise ValueError("Could not determine import strategy or resource type after file processing.")

            # Assign common variables for response construction if details exist
            if imported_resource_details:
                imported_resource_id = getattr(imported_resource_details, 'id', None)

            # Commit transaction: 
            # - WorkspaceService.import_workspace handles its own commit for the new workspace and its contents.
            # - For other types, PackageImporter uses flush, so we commit here.
            if not is_workspace_package_import and imported_resource_details: # Only commit if PackageImporter was used
                self.session.commit()
                logger.info(f"Committed import for {resource_type_imported.value} ID {imported_resource_id} into workspace {workspace_id}")
            elif is_workspace_package_import and imported_resource_details:
                logger.info(f"Workspace import for new workspace ID {imported_resource_id} handled its own commit.")
            
            # Refresh the main imported object if it's a DB model and we have a session
            if imported_resource_details and hasattr(imported_resource_details, '__table__'): # Check if SQLModel object
                try:
                    self.session.refresh(imported_resource_details)
                except Exception as refresh_err:
                    logger.warning(f"Could not refresh imported object {imported_resource_id}: {refresh_err}")

            return {
                "message": message,
                "resource_type": resource_type_imported.value if resource_type_imported else "unknown",
                "imported_resource_id": imported_resource_id,
                "imported_entity_uuid": getattr(imported_resource_details, 'entity_uuid', None)
            }

        except HTTPException as he:
            self.session.rollback() # Rollback on known HTTP errors
            raise he
        except ValueError as e:
            self.session.rollback() # Rollback on validation errors
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Import validation failed: {str(e)}")
        except Exception as e:
            self.session.rollback() # Rollback on any other errors
            logger.exception(f"Error importing resource from file {file.filename if file.filename else 'unknown'}: {e}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error importing resource: {str(e)}")
        finally:
            # WorkspaceService.import_workspace cleans up its own filepath.
            # For other imports, the temp_upload_filepath was used by DataPackage.from_zip or direct read.
            if not is_workspace_package_import: # Only clean up if not passed to workspace_service
                 self._cleanup_temp_file(temp_upload_filepath)
    
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