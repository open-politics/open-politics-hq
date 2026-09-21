"""What a fresh install starts with: templates from the catalogue, documents
from ``deployment.starter.documents`` through the ordinary ``directory`` source."""

import logging
from pathlib import Path

from sqlmodel import Session

from app.core.config import settings

logger = logging.getLogger(__name__)


def seed_infospace(session: Session, *, user_id: int, infospace_id: int) -> None:
    """Populate a new infospace with the starter content. Never raises."""
    try:
        _seed_schemas(session, user_id=user_id, infospace_id=infospace_id)
    except Exception as e:
        logger.warning("Starter schemas skipped: %s", e)
    try:
        _seed_documents(session, user_id=user_id, infospace_id=infospace_id)
    except Exception as e:
        logger.warning("Starter documents skipped: %s", e)


def _seed_schemas(session: Session, *, user_id: int, infospace_id: int) -> None:
    wanted = [str(s).strip() for s in (settings.STARTER_SCHEMAS or []) if str(s).strip()]
    if not wanted:
        return

    from app.api.modules.annotation.services.annotation_service import AnnotationService
    from app.api.modules.annotation.templates import list_templates

    catalogue = {t.id: t for t in list_templates()}
    service = AnnotationService(session)
    for template_id in wanted:
        template = catalogue.get(template_id)
        if template is None:
            logger.warning(
                "deployment.starter.schemas names %r, which is not in the template "
                "catalogue (%s)", template_id, ", ".join(sorted(catalogue)),
            )
            continue
        service.create_annotation_schema(
            name=template.label,
            output_contract=template.contract(),
            user_id=user_id,
            infospace_id=infospace_id,
            description=template.hint,
        )
        logger.info("Starter schema '%s' created.", template.label)


def _seed_documents(session: Session, *, user_id: int, infospace_id: int) -> None:
    path = Path(settings.STARTER_DOCUMENTS_PATH or "")
    if not path.is_dir():
        return
    if not any(p.is_file() and not p.name.startswith(".") for p in path.iterdir()):
        return

    from app.api.modules.content.intake import intake
    from app.api.modules.content.tree import resolve_or_create_bundle

    # copy_mode: they become the user's own data, so emptying ./.github/seed afterwards
    # leaves nothing dangling.
    dest = resolve_or_create_bundle(
        session, infospace_id, user_id, bundle_name="Starter documents"
    )
    jobs = intake(
        session,
        infospace_id=infospace_id,
        user_id=user_id,
        groups={"directory": [{"path": str(path), "copy_mode": True}]},
        dest_id=dest.id if dest else None,
    )
    logger.info("Starter documents queued from %s (%d job(s)).", path, len(jobs))
