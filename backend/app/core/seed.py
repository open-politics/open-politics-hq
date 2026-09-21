"""First-boot bootstrap. Creates the superuser and the starter content; the rest
is the user's to make."""

import logging

from sqlmodel import Session, select

from app.api.modules.foundation_service_providers import resolve
from app.api.modules.identity_infospace_user.services.user_service import create_user
from app.core.config import settings
from app.core.seed_content import seed_infospace
from app.models import User
from app.schemas import UserCreate
from tenacity import before_sleep_log, retry, stop_after_delay, wait_fixed

logger = logging.getLogger(__name__)

# s3 storage resolves over the network and nothing orders it before the backend.
STORAGE_WAIT_SECONDS = 60


@retry(
    stop=stop_after_delay(STORAGE_WAIT_SECONDS),
    wait=wait_fixed(2),
    before_sleep=before_sleep_log(logger, logging.WARNING),
    reraise=True,
)
def _resolve_storage():
    provider = resolve("storage")
    assert provider is not None, "Storage provider not initialized"
    return provider


def init_db(session: Session) -> None:
    """Refuse to boot without storage, then make sure the superuser exists."""
    _resolve_storage()

    existing = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if existing:
        logger.info(f"Superuser {existing.email} already exists.")
        return

    user = create_user(
        session=session,
        user_create=UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
            send_welcome_email=False,
        ),
    )
    logger.info(f"Superuser {user.email} created.")

    # user_service defers this import for the same reason: infospace_service
    # reaches back into the identity models.
    from app.api.modules.identity_infospace_user.services.infospace_service import (
        InfospaceService,
    )

    # Reaching here is the definition of first boot, so the starter content
    # lands exactly once and needs no flag of its own.
    infospace = InfospaceService(session=session, settings=settings).ensure_default_infospace(user.id)
    seed_infospace(session, user_id=user.id, infospace_id=infospace.id)
