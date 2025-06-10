"""
Service layer utility functions for infospace access control.
"""
import logging
from sqlmodel import Session
from fastapi import HTTPException, status
from app.models import Infospace

logger = logging.getLogger(__name__)

def validate_infospace_access(session: Session, infospace_id: int, user_id: int) -> Infospace:
    """
    Validates if a user has ownership access to an infospace.

    Args:
        session: Database session.
        infospace_id: The ID of the infospace to check.
        user_id: The ID of the user requesting access.

    Returns:
        The Infospace object if access is valid.

    Raises:
        HTTPException:
            - 404 Not Found: If the infospace doesn't exist.
            - 403 Forbidden: If the user does not own the infospace.
    """
    infospace = session.get(Infospace, infospace_id)
    if not infospace:
        logger.warning(f"Access denied: Infospace {infospace_id} not found.")
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Infospace {infospace_id} not found")
    if infospace.owner_id != user_id:
        logger.warning(f"Access denied: User {user_id} does not own infospace {infospace_id}.")
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"User {user_id} does not have access to infospace {infospace_id}")
    logger.debug(f"Access validated: User {user_id} owns infospace {infospace_id}.")
    return infospace 