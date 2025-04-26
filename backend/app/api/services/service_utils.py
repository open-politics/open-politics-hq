"""
Service layer utility functions.
"""
import logging
from sqlmodel import Session
from fastapi import HTTPException, status

# Avoid importing services here to prevent cycles
from app.models import Workspace

logger = logging.getLogger(__name__)

def validate_workspace_access(session: Session, workspace_id: int, user_id: int) -> Workspace:
    """
    Validates if a user has ownership access to a workspace.

    Args:
        session: Database session.
        workspace_id: The ID of the workspace to check.
        user_id: The ID of the user requesting access.

    Returns:
        The Workspace object if access is valid.

    Raises:
        HTTPException:
            - 404 Not Found: If the workspace doesn't exist.
            - 403 Forbidden: If the user does not own the workspace.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace:
        logger.warning(f"Access denied: Workspace {workspace_id} not found.")
        # Changed from ValueError to HTTPException for API layer consistency
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Workspace {workspace_id} not found")
    if workspace.user_id_ownership != user_id:
        logger.warning(f"Access denied: User {user_id} does not own workspace {workspace_id}.")
        # Changed from ValueError to HTTPException
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"User {user_id} does not have access to workspace {workspace_id}")
    logger.debug(f"Access validated: User {user_id} owns workspace {workspace_id}.")
    return workspace 