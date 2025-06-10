from sqlmodel import SQLModel
from sqlmodel import Session, create_engine, select, text

from app import crud
from app.core.config import settings
from app.models import User, Infospace, AnnotationSchema, Asset, AssetKind, Source, Bundle, Task, AssetBundleLink, SourceStatus
from app.schemas import UserCreate, InfospaceCreate
from app.core.security import get_password_hash
from app.core.initial_data import INITIAL_SCHEMAS, INITIAL_ASSETS
from app.core.initial_data_scenario import (
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
from app.api.providers.factory import create_storage_provider

logger = logging.getLogger(__name__)

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))


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

    SQLModel.metadata.create_all(engine)

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
        )
        infospace = Infospace(
            **infospace_in.model_dump(),
            owner_id=user.id
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
                AnnotationSchema.name == schema_data.name
            )
        ).first()
        
        if not existing_schema:
            # Convert FieldJustificationConfig objects to dictionaries for JSON storage
            justification_configs = {}
            if schema_data.field_specific_justification_configs:
                for field_name, config in schema_data.field_specific_justification_configs.items():
                    justification_configs[field_name] = config.model_dump() if hasattr(config, 'model_dump') else config
            
            new_schema = AnnotationSchema(
                name=schema_data.name,
                description=schema_data.description,
                output_contract=schema_data.output_contract or {},
                instructions=schema_data.instructions,
                field_specific_justification_configs=justification_configs,
                version=schema_data.version or "1.0",
                infospace_id=infospace.id,
                user_id=user.id
            )
            session.add(new_schema)
            logger.info(f"Creating initial schema: {new_schema.name}")
        else:
            logger.info(f"Initial schema '{schema_data.name}' already exists.")
    session.commit()

    # --- Create Initial Assets from initial_data.py ---
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

    # --- Execute Scenario Data Creation ---
    logger.info("Starting scenario data creation...")
    try:
        # 1. Create the custom Annotation Schema for the scenario
        scenario_schema_exist = session.exec(select(AnnotationSchema).where(AnnotationSchema.name == SCENARIO_ANALYSIS_SCHEMA.name, AnnotationSchema.infospace_id == infospace.id)).first()
        if not scenario_schema_exist:
            scenario_schema = AnnotationSchema.model_validate(SCENARIO_ANALYSIS_SCHEMA, update={"infospace_id": infospace.id, "user_id": user.id})
            session.add(scenario_schema)
            logger.info(f"Created scenario schema: '{scenario_schema.name}'")
        else:
            scenario_schema = scenario_schema_exist
            logger.info(f"Scenario schema '{SCENARIO_ANALYSIS_SCHEMA.name}' already exists.")

        # 2. Create Sources for the scenario
        # 2a. CSV Source
        csv_source_exist = session.exec(select(Source).where(Source.name == "Scenario CSV Source", Source.infospace_id == infospace.id)).first()
        if not csv_source_exist:
            csv_source = Source(
                name="Scenario CSV Source",
                kind="upload_csv",
                details={"filename": "scenario_companies.csv"},
                infospace_id=infospace.id,
                user_id=user.id,
                status=SourceStatus.COMPLETE
            )
            session.add(csv_source)
            session.flush() # Get ID
            
            # Create a parent asset for the CSV file
            csv_parent_asset = Asset(
                title="scenario_companies.csv", 
                kind=AssetKind.CSV, 
                source_id=csv_source.id, 
                infospace_id=infospace.id, 
                user_id=user.id,
                source_metadata={"columns": ["company_name", "founding_year", "technology_tags"]}
            )
            session.add(csv_parent_asset)
            session.flush() # Get ID
            
            # Create child assets for each row with proper indexing
            csv_reader = csv.DictReader(io.StringIO(SCENARIO_CSV_CONTENT))
            csv_rows = list(csv_reader)  # Convert to list to get count
            
            for index, row in enumerate(csv_rows):
                csv_row_asset = Asset(
                    title=f"CSV Row: {row['company_name']}",
                    kind=AssetKind.CSV_ROW,
                    text_content=str(row),
                    source_metadata=row,
                    source_id=csv_source.id,
                    parent_asset_id=csv_parent_asset.id,
                    part_index=index,  # Add proper indexing
                    infospace_id=infospace.id,
                    user_id=user.id
                )
                session.add(csv_row_asset)
            
            # Update parent asset with row count
            csv_parent_asset.source_metadata = {
                "columns": ["company_name", "founding_year", "technology_tags"],
                "row_count": len(csv_rows)
            }
            session.add(csv_parent_asset)
            
            logger.info(f"Created CSV Source and {len(csv_rows)} child assets for scenario.")
        else:
            csv_source = csv_source_exist

        # 2b. PDF Source and Asset
        pdf_source_exist = session.exec(select(Source).where(Source.name == "Scenario PDF Source", Source.infospace_id == infospace.id)).first()
        if not pdf_source_exist:
            pdf_source = Source(name="Scenario PDF Source", kind="upload_pdf", infospace_id=infospace.id, user_id=user.id, status=SourceStatus.COMPLETE)
            session.add(pdf_source)
            session.flush()
            pdf_asset = Asset.model_validate(SCENARIO_PDF_ASSET, update={"infospace_id": infospace.id, "user_id": user.id, "source_id": pdf_source.id})
            session.add(pdf_asset)
            logger.info("Created PDF Source and Asset for scenario.")
        else:
            pdf_source = pdf_source_exist

        # 2c. URL List Source
        url_source_exist = session.exec(select(Source).where(Source.name == SCENARIO_URL_SOURCE.name, Source.infospace_id == infospace.id)).first()
        if not url_source_exist:
            url_source = Source.model_validate(SCENARIO_URL_SOURCE, update={"infospace_id": infospace.id, "user_id": user.id, "status": SourceStatus.PENDING})
            session.add(url_source)
            logger.info("Created URL List Source for scenario. Ingestion will be triggered by Celery worker.")
        else:
            url_source = url_source_exist
        
        # 2d. Search Source
        search_source_exist = session.exec(select(Source).where(Source.name == SCENARIO_SEARCH_SOURCE.name, Source.infospace_id == infospace.id)).first()
        if not search_source_exist:
            search_source = Source.model_validate(SCENARIO_SEARCH_SOURCE, update={"infospace_id": infospace.id, "user_id": user.id, "status": SourceStatus.PENDING})
            session.add(search_source)
            logger.info("Created Search Source for scenario. Ingestion will be triggered by a recurring task.")
        else:
            search_source = search_source_exist
        session.commit()

        # 3. Create Bundles and link assets
        bundle1_exist = session.exec(select(Bundle).where(Bundle.name == SCENARIO_BUNDLE_1.name, Bundle.infospace_id == infospace.id)).first()
        if not bundle1_exist:
            # Re-fetch CSV and PDF assets to link them
            csv_assets_to_bundle = session.exec(select(Asset).where(Asset.source_id == csv_source.id)).all()
            pdf_asset_to_bundle = session.exec(select(Asset).where(Asset.source_id == pdf_source.id)).first()
            bundle1_assets = csv_assets_to_bundle + ([pdf_asset_to_bundle] if pdf_asset_to_bundle else [])
            
            bundle1 = Bundle.model_validate(SCENARIO_BUNDLE_1, update={"infospace_id": infospace.id, "user_id": user.id})
            bundle1.assets = bundle1_assets
            bundle1.asset_count = len(bundle1_assets)
            session.add(bundle1)
            logger.info(f"Created Bundle '{bundle1.name}' and linked {len(bundle1.assets)} assets.")
        else:
            bundle1 = bundle1_exist

        bundle2_exist = session.exec(select(Bundle).where(Bundle.name == SCENARIO_BUNDLE_2.name, Bundle.infospace_id == infospace.id)).first()
        if not bundle2_exist:
            bundle2 = Bundle.model_validate(SCENARIO_BUNDLE_2, update={"infospace_id": infospace.id, "user_id": user.id})
            session.add(bundle2)
            logger.info(f"Created empty Bundle '{bundle2.name}'.")
        
        bundle3_exist = session.exec(select(Bundle).where(Bundle.name == SCENARIO_BUNDLE_3.name, Bundle.infospace_id == infospace.id)).first()
        if not bundle3_exist:
            bundle3 = Bundle.model_validate(SCENARIO_BUNDLE_3, update={"infospace_id": infospace.id, "user_id": user.id})
            session.add(bundle3)
            logger.info(f"Created empty Bundle '{bundle3.name}'.")
        else:
            bundle3 = bundle3_exist
        session.commit()

        # 4. Create the recurring task
        recurring_task_exist = session.exec(select(Task).where(Task.name == SCENARIO_RECURRING_TASK.name, Task.infospace_id == infospace.id)).first()
        if not recurring_task_exist:
            # We need the IDs of the search source and bundle 3
            final_search_source_id = search_source.id
            final_bundle3_id = bundle3.id
            
            task_config = SCENARIO_RECURRING_TASK.configuration.copy()
            task_config["target_source_id"] = final_search_source_id
            task_config["target_bundle_id"] = final_bundle3_id
            
            recurring_task = Task.model_validate(
                SCENARIO_RECURRING_TASK,
                update={
                    "infospace_id": infospace.id,
                    "user_id": user.id,
                    "configuration": task_config
                }
            )
            session.add(recurring_task)
            logger.info(f"Created recurring task '{recurring_task.name}'.")
        
        session.commit()
        logger.info("Scenario data creation complete.")

    except Exception as e:
        logger.error(f"Failed during scenario data creation: {e}", exc_info=True)
        session.rollback()


    # Create a classification scheme for the infospace if not exists
    default_scheme = session.exec(
        select(AnnotationSchema).where(AnnotationSchema.infospace_id == infospace.id)
    ).first()
    if not default_scheme:
        scheme_in = AnnotationSchema(
            name="Default Scheme",
            description="Default classification scheme for the infospace",
            output_contract={"label": "string"},
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(scheme_in)
        session.commit()
        session.refresh(scheme_in)

    # Create sample classification schemes if they don't exist
    sentiment_scheme = session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.name == "Sentiment Analysis",
            AnnotationSchema.infospace_id == infospace.id,
        )
    ).first()
    if not sentiment_scheme:
        s_scheme = AnnotationSchema(
            name="Sentiment Analysis",
            description="Classifies text as positive, negative, or neutral.",
            output_contract={
                "sentiment": {
                    "type": "string",
                    "enum": ["positive", "negative", "neutral"],
                }
            },
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(s_scheme)
        session.commit()

    topic_scheme = session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.name == "Topic Modeling",
            AnnotationSchema.infospace_id == infospace.id,
        )
    ).first()
    if not topic_scheme:
        t_scheme = AnnotationSchema(
            name="Topic Modeling",
            description="Identifies the main topic of a document.",
            output_contract={"topic": "string"},
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(t_scheme)
        session.commit()

    # Create a categories classification scheme with list of labels using AnnotationSchema
    categories_schema = session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.infospace_id == infospace.id,
            AnnotationSchema.name == "Political Categories"
        )
    ).first()
    if not categories_schema:
        categories_schema_in = AnnotationSchema(
            name="Political Categories",
            description="Categorize political content into predefined categories.",
            instructions="Analyze the text and select all applicable political categories that the content belongs to.",
            output_contract={
                "categories": {
                    "type": "array",
                    "items": {
                        "type": "string",
                        "enum": ["Economic Policy", "Foreign Policy", "Healthcare", "Education", 
                                 "Environment", "Immigration", "Civil Rights", "National Security"]
                    }
                }
            },
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(categories_schema_in)
        session.commit()
        session.refresh(categories_schema_in)

    # Create an entity-statement classification scheme using AnnotationSchema
    entity_statement_schema = session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.infospace_id == infospace.id,
            AnnotationSchema.name == "Entity Statements"
        )
    ).first()
    if not entity_statement_schema:
        entity_statement_schema_in = AnnotationSchema(
            name="Entity Statements",
            description="Extract entities and their associated statements from political text.",
            instructions="Identify key political entities mentioned in the text and extract the main statements or claims made about them.",
            output_contract={
                "entity_statements": {
                    "type": "array",
                    "items": {
                        "type": "object",
                        "properties": {
                            "entity": {"type": "string"},
                            "statement": {"type": "string"},
                            "sentiment": {"type": "integer"}
                        },
                        "required": ["entity", "statement"]
                    }
                }
            },
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(entity_statement_schema_in)
        session.commit()
        session.refresh(entity_statement_schema_in)

    logger.info("Database initialization complete.")

