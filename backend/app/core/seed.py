"""Database seeding logic. Separated from db.py to keep engine config minimal."""

import logging
import os

from sqlmodel import SQLModel, Session, select, text

from app.core.config import settings
from app.core.db import engine
from app.core.initial_data import INITIAL_SCHEMAS
from app.core.security import get_password_hash
from app.models import (
    AnnotationSchema,
    Infospace,
    User,
)
from app.schemas import InfospaceCreate, UserCreate
from app.api.modules.foundation_service_providers import resolve

logger = logging.getLogger(__name__)


def init_db(session: Session) -> None:
    """Seed superuser, default infospace, and annotation schemas."""
    # Call the factory function with settings
    try:
        storage_provider = resolve("storage")
        assert storage_provider is not None, "Storage provider not initialized"
    except Exception as e:
        logger.error(f"Error creating storage provider: {e}")
        raise

    if os.environ.get("WIPE_DB") == "True":
        logger.info("Wiping DB")
        try:
            session.exec(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
            session.commit()
        except Exception as e_wipe_alembic:
            logger.warning(f"Could not drop alembic_version (may not exist): {e_wipe_alembic}")
            session.rollback()

        SQLModel.metadata.drop_all(engine)
        logger.info("DB wiped")

    # Create initial superuser if not exists
    try:
        user = session.exec(
            select(User).where(User.email == settings.FIRST_SUPERUSER)
        ).first()
    except Exception as e:
        logger.error(f"Error creating user: {e}")
        raise

    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
        )
        user = User.model_validate(user_in, update={"hashed_password": get_password_hash(user_in.password)})
        user.is_superuser = True
        session.add(user)
        session.commit()
        session.refresh(user)
        logger.info(f"Superuser {user.email} created.")
    else:
        logger.info(f"Superuser {user.email} already exists.")

    # Create a infospace for the user if not exists
    try:
        super_user_infospace = session.exec(
            select(Infospace).where(Infospace.owner_id == user.id)
        ).first()
    except Exception as e:
        logger.error(f"Error creating infospace: {e}")
        raise

    if not super_user_infospace:
        from app.api.modules.graph.models import Canon, CanonRole
        infospace_in = InfospaceCreate(
            name="Default Infospace",
            description="This is the default infospace for the user",
            owner_id=user.id
        )
        infospace = Infospace(**infospace_in.model_dump())
        session.add(infospace)
        session.flush()  # need infospace.id for Canon FK

        # Auto-create General canon and wire as default — mirrors
        # InfospaceService.create_infospace. Both paths produce the same
        # invariant: every infospace has a default_canon_id.
        general_canon = Canon(
            infospace_id=infospace.id,
            name="General",
            description="Default vocabulary for this infospace.",
            role=CanonRole.GENERAL,
        )
        session.add(general_canon)
        session.flush()
        infospace.default_canon_id = general_canon.id
        session.add(infospace)
        session.commit()
        session.refresh(infospace)
        logger.info(f"Default infospace created for user {user.email} with General canon {general_canon.id}.")
    else:
        infospace = super_user_infospace
        logger.info(f"Default infospace for user {user.email} already exists.")

    # --- Create Initial Annotation Schemas from initial_data.py ---
    for schema_data in INITIAL_SCHEMAS:
        existing_schema = session.exec(
            select(AnnotationSchema).where(
                AnnotationSchema.infospace_id == infospace.id,
                AnnotationSchema.name == schema_data.name,
                AnnotationSchema.version == schema_data.version
            )
        ).first()

        if not existing_schema:
            # Lift legacy justification configs into inline keys on the
            # output_contract — storage is canonical inline.
            from app.api.routes.annotation_schemas import _lift_configs_into_contract
            legacy_configs = {}
            if schema_data.field_specific_justification_configs:
                for field_name, config in schema_data.field_specific_justification_configs.items():
                    if hasattr(config, "model_dump"):
                        legacy_configs[field_name] = config.model_dump()
                    elif hasattr(config, "dict"):
                        legacy_configs[field_name] = config.dict()
                    else:
                        legacy_configs[field_name] = config
            output_contract = _lift_configs_into_contract(
                schema_data.output_contract, legacy_configs
            )

            new_schema = AnnotationSchema(
                name=schema_data.name,
                description=schema_data.description or "",
                instructions=schema_data.instructions,
                output_contract=output_contract,
                version=schema_data.version or "1.0",
                infospace_id=infospace.id,
                user_id=user.id,
                is_active=True
            )
            session.add(new_schema)
            logger.info(f"Creating initial schema: {new_schema.name}")
        else:
            logger.info(f"Initial schema '{schema_data.name}' already exists.")
    session.commit()
