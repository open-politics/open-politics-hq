"""
Service layer utility functions for infospace access control.
Shared across domains. Re-export shim at api/services/service_utils.py.
"""
import logging
from sqlmodel import Session, select
from fastapi import HTTPException, status
from app.models import Infospace
from app.api.modules.identity_infospace_user.models import InfospaceCollaborator, CollaboratorRole

logger = logging.getLogger(__name__)


def validate_infospace_access(
    session: Session,
    infospace_id: int,
    user_id: int,
    *,
    require_editor: bool = False,
) -> Infospace:
    """
    Validates if a user has access to an infospace (owner or collaborator).

    Args:
        session: Database session.
        infospace_id: The ID of the infospace to check.
        user_id: The ID of the user requesting access.
        require_editor: If True, viewers get 403. Only owners and editors can pass.
            Use for write operations: import, enable-watch, reconcile, delete.

    Returns:
        The Infospace object if access is valid.

    Raises:
        HTTPException:
            - 404 Not Found: If the infospace doesn't exist.
            - 403 Forbidden: If the user does not have access (owner or collaborator).
            - 403 Forbidden: If require_editor=True and user is a viewer.
    """
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        logger.warning(f"Access denied: Infospace {infospace_id} not found.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Infospace {infospace_id} not found")
    if infospace.owner_id == user_id:
        logger.debug(f"Access validated: User {user_id} owns infospace {infospace_id}.")
        return infospace
    collab = session.exec(
        select(InfospaceCollaborator).where(
            InfospaceCollaborator.infospace_id == infospace_id,
            InfospaceCollaborator.user_id == user_id,
        )
    ).first()
    if not collab:
        logger.warning(f"Access denied: User {user_id} does not have access to infospace {infospace_id}.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"User {user_id} does not have access to infospace {infospace_id}")
    if require_editor and collab.role == CollaboratorRole.VIEWER:
        logger.warning(f"Access denied: User {user_id} is viewer on infospace {infospace_id}; editor required.")
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Viewer collaborators cannot perform this action. Editor or owner role required.",
        )
    logger.debug(f"Access validated: User {user_id} is collaborator ({collab.role}) on infospace {infospace_id}.")
    return infospace
