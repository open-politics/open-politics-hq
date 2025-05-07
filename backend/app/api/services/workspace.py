"""
Workspace service.

This module contains the business logic for workspace operations,
abstracting the underlying implementation details from the API layer.
"""
import logging
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import json # Added for export/import
import uuid

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
    ClassificationField # Added to prevent lint error

)
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
    def __init__(self, session: Session): # Use base Session type
        """Initialize with a database session dependency."""
        self.session = session

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

    def export_workspace(
        self,
        workspace_id: int,
        user_id: int,
        include_datasources: bool = True,
        include_schemes: bool = True,
        include_jobs: bool = True,
    ) -> Dict[str, Any]:
        """
        Export a workspace configuration.
        READ-ONLY - Does not commit.
        """
        workspace = self.get_workspace(workspace_id, user_id)
        if not workspace:
            raise ValueError(f"Workspace {workspace_id} not found or not accessible")

        export_data = {
            "name": workspace.name,
            "description": workspace.description,
            "icon": workspace.icon,
            "system_prompt": workspace.system_prompt,
            "created_at": workspace.created_at.isoformat() if workspace.created_at else None,
            "updated_at": workspace.updated_at.isoformat() if workspace.updated_at else None,
        }

        if include_datasources and workspace.datasources:
            export_data["datasources"] = [
                {
                    "name": ds.name,
                    "description": ds.description,
                    "type": ds.type,
                    "origin_details": ds.origin_details,
                    "source_metadata": ds.source_metadata,
                    "created_at": ds.created_at.isoformat() if ds.created_at else None,
                }
                for ds in workspace.datasources
            ]

        if include_schemes and workspace.classification_schemes:
            export_data["classification_schemes"] = [
                {
                    "name": scheme.name,
                    "description": scheme.description,
                    "model_instructions": scheme.model_instructions,
                    "validation_rules": scheme.validation_rules,
                    "created_at": scheme.created_at.isoformat() if scheme.created_at else None,
                    "fields": [
                        {
                            "name": field.name,
                            "description": field.description,
                            "type": field.type,
                            "scale_min": field.scale_min,
                            "scale_max": field.scale_max,
                            "is_set_of_labels": field.is_set_of_labels,
                            "labels": field.labels,
                            "dict_keys": field.dict_keys,
                            "is_time_axis_hint": field.is_time_axis_hint
                        }
                        for field in scheme.fields
                    ] if scheme.fields else []
                }
                for scheme in workspace.classification_schemes
            ]

        if include_jobs and workspace.classification_jobs:
            export_data["classification_jobs"] = [
                {
                    "name": job.name,
                    "description": job.description,
                    "configuration": job.configuration,
                    "status": job.status,
                    "created_at": job.created_at.isoformat() if job.created_at else None,
                }
                for job in workspace.classification_jobs
            ]

        return export_data

    async def import_workspace(
        self,
        user_id: int,
        filepath: str
    ) -> Workspace:
        """
        Import a workspace from a file.
        MODIFIES DATA - Commits transaction.
        """
        try:
            with open(filepath, 'r') as f:
                import_data = json.load(f)

            # Create the workspace first
            workspace_data = WorkspaceCreate(
                name=import_data.get("name", "Imported Workspace"),
                description=import_data.get("description", "Imported workspace configuration"),
                icon=import_data.get("icon"),
                system_prompt=import_data.get("system_prompt")
            )
            workspace = self.create_workspace(user_id, workspace_data)

            # Import classification schemes if present
            if "classification_schemes" in import_data:
                for scheme_data in import_data["classification_schemes"]:
                    scheme = ClassificationScheme(
                        workspace_id=workspace.id,
                        user_id=user_id,
                        **{k: v for k, v in scheme_data.items() if k not in ["fields", "created_at"]}
                    )
                    self.session.add(scheme)
                    self.session.flush()  # Get scheme ID for fields

                    # Add fields if present
                    if "fields" in scheme_data:
                        for field_data in scheme_data["fields"]:
                            field = ClassificationField(
                                scheme_id=scheme.id,
                                **{k: v for k, v in field_data.items()}
                            )
                            self.session.add(field)

            # Import datasources if present (metadata only)
            if "datasources" in import_data:
                for ds_data in import_data["datasources"]:
                    datasource = DataSource(
                        workspace_id=workspace.id,
                        user_id=user_id,
                        **{k: v for k, v in ds_data.items() if k != "created_at"}
                    )
                    self.session.add(datasource)

            # Import job configurations if present
            if "classification_jobs" in import_data:
                for job_data in import_data["classification_jobs"]:
                    job = ClassificationJob(
                        workspace_id=workspace.id,
                        user_id=user_id,
                        **{k: v for k, v in job_data.items() if k != "created_at"}
                    )
                    self.session.add(job)

            # Commit all changes
            self.session.commit()
            self.session.refresh(workspace)
            return workspace

        except Exception as e:
            self.session.rollback()
            raise ValueError(f"Failed to import workspace: {str(e)}") 