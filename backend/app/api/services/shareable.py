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
    Dataset
)

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
        # Add dataset_service dependency
        dataset_service: DatasetService
    ):
        """Initialize service with dependencies."""
        self.session = session
        self.ingestion_service = ingestion_service
        self.classification_service = classification_service
        self.workspace_service = workspace_service
        self.dataset_service = dataset_service # Assign dataset_service
        self.token_length = 24  # Length of the token for shareable links
        logger.info("ShareableService initialized")
    
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

    def _create_temp_file(self, prefix: str = "export_") -> Tuple[str, str]:
        """Create a temporary file and return its path and filename."""
        temp_dir = os.getenv("TEMP_DIR", tempfile.gettempdir())
        os.makedirs(temp_dir, exist_ok=True)
        
        filename = f"{prefix}{uuid.uuid4()}.json"
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

    async def export_resource(
        self,
        user_id: int,
        resource_type: ResourceType,
        resource_id: int
    ) -> Tuple[str, str]:
        """
        Export a resource to a JSON file.
        Returns the file path and suggested filename.
        """
        # Validate resource ownership
        self._validate_resource_ownership(
            resource_type=resource_type,
            resource_id=resource_id,
            user_id=user_id
        )
        
        # Create temp file
        temp_path, filename = self._create_temp_file(f"export_{resource_type.value}_{resource_id}_")
        
        try:
            # Export data based on resource type
            export_data = {}
            
            if resource_type == ResourceType.DATA_SOURCE:
                export_data = self.ingestion_service.export_datasource(
                    datasource_id=resource_id,
                    user_id=user_id,
                    include_records=True
                )
                filename = f"datasource_{resource_id}.json"
            
            elif resource_type == ResourceType.SCHEMA:
                export_data = self.classification_service.export_scheme(
                    scheme_id=resource_id,
                    user_id=user_id
                )
                filename = f"scheme_{resource_id}.json"
            
            elif resource_type == ResourceType.CLASSIFICATION_JOB:
                export_data = self.classification_service.export_job(
                    job_id=resource_id,
                    user_id=user_id,
                    include_results=True
                )
                filename = f"job_{resource_id}.json"
            
            elif resource_type == ResourceType.WORKSPACE:
                export_data = self.workspace_service.export_workspace(
                    workspace_id=resource_id,
                    user_id=user_id
                )
                filename = f"workspace_{resource_id}.json"
            
            elif resource_type == ResourceType.DATASET:
                # Not yet implemented
                raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail="Dataset export not yet implemented")
            
            else:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Unsupported resource type for export: {resource_type}")
            
            # Write export data to temp file
            with open(temp_path, 'w') as f:
                json.dump(export_data, f, indent=2)
            
            return temp_path, filename
        
        except HTTPException as he:
            # Clean up temp file if error occurs
            self._cleanup_temp_file(temp_path)
            raise he
        except Exception as e:
            # Clean up temp file if error occurs
            self._cleanup_temp_file(temp_path)
            logger.error(f"Error exporting {resource_type.value} {resource_id}: {e}", exc_info=True)
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Failed to export {resource_type.value}: {str(e)}")

    async def import_resource(
        self,
        user_id: int,
        workspace_id: int,
        file: UploadFile
    ) -> Dict[str, Any]:
        """
        Import a resource from a file.
        Returns information about the imported resource.
        """
        # Validate workspace access
        validate_workspace_access(self.session, workspace_id, user_id)
        
        # Basic file validation
        if not file.filename or not file.filename.lower().endswith(".json"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid file type. Only JSON files are allowed.")
        
        # Create a temporary file to save upload
        filepath, _ = self._create_temp_file(f"import_{uuid.uuid4()}_")
        
        try:
            # Write the uploaded file to the temporary file
            with open(filepath, "wb") as temp_file:
                content = await file.read()
                temp_file.write(content)

            # Parse the JSON data from the temp file
            with open(filepath, 'r') as f:
                import_data = json.load(f)

            # Check basic structure and resource type
            meta = import_data.get("meta", {})
            try:
                resource_type_str = meta.get("export_type")
                if not resource_type_str:
                    raise ValueError("Missing 'export_type' in import file metadata")
                resource_type = ResourceType(resource_type_str)
            except ValueError as e:
                 raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Invalid or missing resource type in import file: {e}")

            imported_resource = None
            imported_id = None
            
            # Call the appropriate service import method
            if resource_type == ResourceType.DATA_SOURCE:
                imported_resource = self.ingestion_service.import_datasource(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    import_data=import_data
                )
                imported_id = imported_resource.id
            elif resource_type == ResourceType.SCHEMA:
                imported_resource = self.classification_service.import_scheme(
                    user_id=user_id,
                    workspace_id=workspace_id,
                    import_data=import_data
                )
                imported_id = imported_resource.id
            elif resource_type == ResourceType.WORKSPACE:
                # Importing a workspace creates a *new* workspace
                imported_resource = await self.workspace_service.import_workspace(
                    user_id=user_id,
                    filepath=filepath # Pass filepath to service
                )
                imported_id = imported_resource.id
                # Workspace import handles its own sub-imports, return result directly
                return {
                    "message": f"Successfully imported Workspace",
                    "resource_type": resource_type.value,
                    "imported_workspace_id": imported_id
                }
            elif resource_type == ResourceType.CLASSIFICATION_JOB:
                # Job import requires context (mapping of original IDs) typically within workspace import
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Job import is only supported as part of a Workspace import.")
            elif resource_type == ResourceType.DATASET:
                 raise HTTPException(status_code=status.HTTP_501_NOT_IMPLEMENTED, detail=f"Import not supported for {resource_type}")
            else:
                 raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Import not supported for {resource_type}")

            return {
                "message": f"Successfully imported {resource_type.value}",
                "resource_type": resource_type.value,
                "imported_resource_id": imported_id
            }

        except HTTPException as he:
            # Re-raise HTTP exceptions
            raise he
        except ValueError as e:
            # Catch specific validation errors from service import methods
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Import validation failed: {e}")
        except Exception as e:
            # Catch unexpected errors during service import
            logger.exception(f"Error importing resource: {e}")
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Error importing resource: {e}")
        finally:
            # Ensure temp file is cleaned up unless it was a workspace import
            if resource_type != ResourceType.WORKSPACE:
                self._cleanup_temp_file(filepath) 