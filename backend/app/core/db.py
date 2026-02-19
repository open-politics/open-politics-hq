from sqlmodel import SQLModel
from sqlmodel import Session, create_engine, select, text

from app.core.config import settings
from app.models import User, Infospace, AnnotationSchema, Asset, AssetKind, Source, Bundle, Task, SourceStatus, AnalysisAdapter, EmbeddingModel, EmbeddingProvider
from app.api.modules.foundation_service_providers.embedding_config import embedding_models_config
from app.schemas import UserCreate, InfospaceCreate
from app.core.security import get_password_hash
from app.core.initial_data import (
    INITIAL_SCHEMAS, 
    INITIAL_ASSETS,
    SCENARIO_ANALYSIS_SCHEMA,
    SCENARIO_CSV_CONTENT,
    SCENARIO_PDF_ASSET,
    SCENARIO_URL_SOURCE,
    SCENARIO_SEARCH_SOURCE,
    SCENARIO_BUNDLE_1,
    SCENARIO_BUNDLE_2,
    SCENARIO_BUNDLE_3,
    SCENARIO_RECURRING_TASK
)
import os
import logging
import csv
import io

# Import the correct factory function
from app.api.modules.foundation_service_providers.factory import create_storage_provider

logger = logging.getLogger(__name__)

engine = create_engine(
    str(settings.SQLALCHEMY_DATABASE_URI),
    pool_size=settings.DB_POOL_SIZE,
    max_overflow=settings.DB_MAX_OVERFLOW,
    pool_pre_ping=settings.DB_POOL_PRE_PING,
)


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/tiangolo/full-stack-fastapi-template/issues/28


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines

    # Call the factory function with settings
    try:
        storage_provider = create_storage_provider(settings)
        assert storage_provider is not None, "Storage provider not initialized"
    except Exception as e:
        logger.error(f"Error creating storage provider: {e}")
        raise

    # SQLModel.metadata.create_all(engine)

    if os.environ.get("WIPE_DB") == "True":
        logger.info("Wiping DB")
        # Wipe DB table "alembic_version"
        try:
            session.exec(text("DROP TABLE IF EXISTS alembic_version CASCADE"))
            session.commit()
        except Exception as e_wipe_alembic:
            logger.warning(f"Could not drop alembic_version (may not exist): {e_wipe_alembic}")
            session.rollback()
        
        SQLModel.metadata.drop_all(engine)
        logger.info("DB wiped")

        # from app.core.engine import engine
        # This works because the models are already imported and registered from app.models
        # print("Creating tables")
        # SQLModel.metadata.drop_all(engine)
        # SQLModel.metadata.create_all(engine)

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
        infospace_in = InfospaceCreate(
            name="Default Infospace",
            description="This is the default infospace for the user",
            owner_id=user.id
        )
        infospace = Infospace(
            **infospace_in.model_dump()
        )
        session.add(infospace)
        session.commit()
        session.refresh(infospace)
        logger.info(f"Default infospace created for user {user.email}.")
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
            # Convert FieldJustificationConfig Pydantic models to dicts for JSON serialization
            justification_configs = {}
            if schema_data.field_specific_justification_configs:
                for field_name, config in schema_data.field_specific_justification_configs.items():
                    if hasattr(config, 'model_dump'):
                        justification_configs[field_name] = config.model_dump()
                    elif hasattr(config, 'dict'):
                        justification_configs[field_name] = config.dict()
                    else:
                        justification_configs[field_name] = config
            
            new_schema = AnnotationSchema(
                name=schema_data.name,
                description=schema_data.description or "",
                instructions=schema_data.instructions,
                output_contract=schema_data.output_contract,
                field_specific_justification_configs=justification_configs,
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

    # --- Register Analysis Adapters ---
    # Register graph_aggregator adapter
    graph_adapter = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "graph_aggregator")
    ).first()
    if not graph_adapter:
        graph_adapter = AnalysisAdapter(
            name="graph_aggregator",
            description="Aggregates graph entities and triplets from annotation results into a unified knowledge graph for visualization",
            module_path="app.api.modules.analysis.adapters.graph_aggregator_adapter.GraphAggregatorAdapter",
            adapter_type="graph",
            is_public=True,
            creator_user_id=user.id,
        )
        session.add(graph_adapter)
        logger.info("Registered graph_aggregator adapter")
    else:
        logger.info("graph_aggregator adapter already registered")

    session.commit()

    # --- Create Initial Assets from initial_data.py (Only for the default infospace)---
    for asset_data in INITIAL_ASSETS:
        try:
            asset_kind_enum = AssetKind(asset_data.kind)
        except ValueError:
            logger.error(f"Invalid AssetKind '{asset_data.kind}' in INITIAL_ASSETS for title '{asset_data.title}'. Skipping asset.")
            continue

        existing_asset = session.exec(
            select(Asset).where(
                Asset.infospace_id == infospace.id,
                Asset.title == asset_data.title,
                Asset.kind == asset_kind_enum
            )
        ).first()

        if not existing_asset:
            new_asset = Asset(
                title=asset_data.title,
                kind=asset_kind_enum,
                text_content=asset_data.text_content,
                blob_path=asset_data.blob_path,
                source_metadata=asset_data.source_metadata or {},
                infospace_id=infospace.id,
                user_id=user.id
            )
            session.add(new_asset)
            logger.info(f"Creating initial asset: {new_asset.title}")
        else:
            logger.info(f"Initial asset '{asset_data.title}' already exists.")
    session.commit()

