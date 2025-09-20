from sqlmodel import SQLModel
from sqlmodel import Session, create_engine, select, text

from app import crud
from app.core.config import settings
from app.models import User, Infospace, AnnotationSchema, Asset, AssetKind, Source, Bundle, Task, AssetBundleLink, SourceStatus, AnalysisAdapter, EmbeddingModel, EmbeddingProvider
from app.api.providers.embedding_config import embedding_models_config
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

    # --- Create Initial Annotation Schemas from initial_data.py for ALL infospaces ---
    all_infospaces = session.exec(select(Infospace)).all()
    for space in all_infospaces:
        for schema_data in INITIAL_SCHEMAS:
            existing_schema = session.exec(
                select(AnnotationSchema).where(
                    AnnotationSchema.infospace_id == space.id,
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
                    infospace_id=space.id, # Use the current infospace's ID
                    user_id=space.owner_id # Associate with the infospace owner
                )
                session.add(new_schema)
                logger.info(f"Creating initial schema: '{new_schema.name}' in Infospace {space.id} ('{space.name}')")
            else:
                logger.info(f"Initial schema '{schema_data.name}' already exists in Infospace {space.id} ('{space.name}').")
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
            output_contract={"properties": {"label": {"type": "string"}}},
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
                "properties": {
                    "document": {
                        "type": "object",
                        "properties": {
                            "sentiment": {
                                "type": "string",
                                "enum": ["positive", "negative", "neutral"],
                            }
                        },
                        "required": ["sentiment"]
                    }
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
            output_contract={"properties": {"document": {"type": "object", "properties": {"topic": {"type": "string"}}, "required": ["topic"]}}},
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
                "properties":{
                    "document": {
                        "type": "object",
                        "properties": {
                            "categories": {
                                "type": "array",
                                "items": {
                                    "type": "string",
                                    "enum": ["Economic Policy", "Foreign Policy", "Healthcare", "Education", 
                                            "Environment", "Immigration", "Civil Rights", "National Security"]
                                }
                            }
                        },
                        "required": ["categories"]
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
                "properties": {
                    "document": {
                        "type": "object",
                        "properties": {
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
                        "required": ["entity_statements"]
                    }
                }
            },
            infospace_id=infospace.id,
            user_id=user.id
        )
        session.add(entity_statement_schema_in)
        session.commit()
        session.refresh(entity_statement_schema_in)

    # --- Create Analysis Adapters ---
    logger.info("Creating initial analysis adapters...")
    
    # Graph Aggregator Adapter
    graph_aggregator_exists = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "graph_aggregator")
    ).first()
    
    if not graph_aggregator_exists:
        graph_aggregator_adapter = AnalysisAdapter(
            name="graph_aggregator",
            description="Aggregates individual graph fragments from an AnnotationRun into a single, cohesive graph for visualization. Outputs react-flow compatible JSON with nodes and edges.",
            input_schema_definition={
                "type": "object",
                "properties": {
                    "target_run_id": {
                        "type": "integer",
                        "description": "ID of the AnnotationRun containing graph fragments"
                    },
                    "target_schema_id": {
                        "type": "integer", 
                        "description": "ID of the AnnotationSchema used (should be Knowledge Graph Extractor)"
                    },
                    "include_isolated_nodes": {
                        "type": "boolean",
                        "default": True,
                        "description": "Whether to include nodes that have no edges"
                    },
                    "max_nodes": {
                        "type": "integer",
                        "description": "Maximum number of nodes to include (most frequent nodes kept)"
                    },
                    "node_frequency_threshold": {
                        "type": "integer",
                        "default": 1,
                        "description": "Minimum frequency for a node to be included"
                    }
                },
                "required": ["target_run_id", "target_schema_id"]
            },
            output_schema_definition={
                "type": "object",
                "properties": {
                    "graph_data": {
                        "type": "object",
                        "properties": {
                            "nodes": {
                                "type": "array",
                                "description": "React-flow compatible node objects"
                            },
                            "edges": {
                                "type": "array", 
                                "description": "React-flow compatible edge objects"
                            }
                        }
                    },
                    "graph_metrics": {
                        "type": "object",
                        "description": "Statistical information about the graph"
                    },
                    "processing_summary": {
                        "type": "object",
                        "description": "Summary of the aggregation process"
                    }
                }
            },
            module_path="app.api.analysis.adapters.graph_aggregator_adapter.GraphAggregatorAdapter",
            adapter_type="graph_analysis",
            version="1.0",
            is_active=True,
            is_public=True,
            creator_user_id=user.id
        )
        session.add(graph_aggregator_adapter)
        logger.info("Created Graph Aggregator analysis adapter")
    else:
        logger.info("Graph Aggregator analysis adapter already exists")

    # RAG Adapter
    rag_adapter_exists = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "rag_adapter")
    ).first()
    
    if not rag_adapter_exists:
        rag_adapter = AnalysisAdapter(
            name="rag_adapter",
            description="Retrieval-Augmented Generation for question answering over embedded content. Uses vector similarity search to find relevant chunks and LLM generation to provide comprehensive answers.",
            input_schema_definition={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to answer using the knowledge base"
                    },
                    "embedding_model_id": {
                        "type": "integer",
                        "description": "ID of the embedding model to use for vector search"
                    },
                    "top_k": {
                        "type": "integer",
                        "default": 5,
                        "description": "Number of most relevant chunks to retrieve"
                    },
                    "similarity_threshold": {
                        "type": "number",
                        "default": 0.7,
                        "description": "Minimum similarity threshold for chunk inclusion (0.0-1.0)"
                    },
                    "distance_function": {
                        "type": "string",
                        "default": "cosine",
                        "enum": ["cosine", "l2", "inner_product"],
                        "description": "Distance function for vector similarity"
                    },
                    "model": {
                        "type": "string", 
                        "default": "gemini-2.5-flash-preview-05-20",
                        "description": "LLM model for generation"
                    },
                    "enable_thinking": {
                        "type": "boolean", 
                        "default": False,
                        "description": "Enable thinking/reasoning in the response"
                    },
                    "temperature": {
                        "type": "number", 
                        "default": 0.1, 
                        "description": "Generation temperature"
                    },
                    "max_tokens": {
                        "type": "integer", 
                        "default": 500, 
                        "description": "Maximum tokens for response"
                    },
                    "asset_filters": {
                        "type": "object",
                        "properties": {
                            "asset_kinds": {"type": "array", "items": {"type": "string"}},
                            "source_ids": {"type": "array", "items": {"type": "integer"}},
                            "date_range": {
                                "type": "object",
                                "properties": {
                                    "start_date": {"type": "string", "format": "date-time"},
                                    "end_date": {"type": "string", "format": "date-time"}
                                }
                            }
                        },
                        "description": "Optional filters to apply to asset selection"
                    },
                    "infospace_id": {
                        "type": "integer",
                        "description": "Limit search to specific infospace (optional)"
                    }
                },
                "required": ["question", "embedding_model_id"]
            },
            output_schema_definition={
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "The generated answer to the user's question"
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Explanation of how the answer was derived"
                    },
                    "sources": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_number": {"type": "integer"},
                                "chunk_id": {"type": "integer"},
                                "asset_id": {"type": "integer"},
                                "asset_title": {"type": "string"},
                                "text_content": {"type": "string"},
                                "distance": {"type": "number"},
                                "similarity": {"type": "number"}
                            }
                        },
                        "description": "Sources used to generate the answer"
                    },
                    "context_used": {
                        "type": "string",
                        "description": "The assembled context provided to the LLM"
                    },
                    "retrieval_stats": {
                        "type": "object",
                        "description": "Statistics about the retrieval process"
                    }
                }
            },
            module_path="app.api.analysis.adapters.rag_adapter.RagAdapter",
            adapter_type="question_answering",
            version="1.0",
            is_active=True,
            is_public=True,
            creator_user_id=user.id
        )
        session.add(rag_adapter)
        logger.info("Created RAG analysis adapter")
    else:
        logger.info("RAG analysis adapter already exists")

    # Graph RAG Adapter
    graph_rag_adapter_exists = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "graph_rag_adapter")
    ).first()
    
    if not graph_rag_adapter_exists:
        graph_rag_adapter = AnalysisAdapter(
            name="graph_rag_adapter",
            description="Graph-enhanced RAG adapter that combines structured graph knowledge with vector similarity search for comprehensive question-answering. Retrieves relevant graph fragments and combines them with embedding-based document retrieval.",
            input_schema_definition={
                "type": "object",
                "properties": {
                    "question": {
                        "type": "string",
                        "description": "The question to answer using graph and document knowledge"
                    },
                    "embedding_model_id": {
                        "type": "integer",
                        "description": "ID of the embedding model to use for vector search"
                    },
                    "target_run_id": {
                        "type": "integer",
                        "description": "ID of the AnnotationRun containing graph fragments"
                    },
                    "target_schema_id": {
                        "type": "integer",
                        "description": "ID of the AnnotationSchema used (should be Knowledge Graph Extractor)"
                    },
                    "top_k": {
                        "type": "integer",
                        "default": 5,
                        "description": "Number of most relevant chunks to retrieve"
                    },
                    "similarity_threshold": {
                        "type": "number",
                        "default": 0.7,
                        "description": "Minimum similarity threshold for chunk inclusion (0.0-1.0)"
                    },
                    "distance_function": {
                        "type": "string",
                        "default": "cosine",
                        "enum": ["cosine", "l2", "inner_product"],
                        "description": "Distance function for vector similarity"
                    },
                    "combine_strategy": {
                        "type": "string",
                        "default": "graph_enhanced",
                        "enum": ["graph_only", "embedding_only", "graph_enhanced"],
                        "description": "Strategy for combining graph and embedding contexts"
                    },
                                         "model": {
                         "type": "string", 
                         "default": "gemini-2.5-flash-preview-05-20",
                         "description": "LLM model for generation"
                     },
                     "enable_thinking": {
                         "type": "boolean", 
                         "default": False,
                         "description": "Enable thinking/reasoning in the response"
                     },
                     "temperature": {
                         "type": "number", 
                         "default": 0.1, 
                         "description": "Generation temperature"
                     },
                     "max_tokens": {
                         "type": "integer", 
                         "default": 600, 
                         "description": "Maximum tokens for response"
                     },
                    "asset_filters": {
                        "type": "object",
                        "properties": {
                            "asset_kinds": {"type": "array", "items": {"type": "string"}},
                            "source_ids": {"type": "array", "items": {"type": "integer"}},
                            "date_range": {
                                "type": "object",
                                "properties": {
                                    "start_date": {"type": "string", "format": "date-time"},
                                    "end_date": {"type": "string", "format": "date-time"}
                                }
                            }
                        },
                        "description": "Optional filters to apply to asset selection"
                    },
                    "infospace_id": {
                        "type": "integer",
                        "description": "Limit search to specific infospace (optional)"
                    }
                },
                "required": ["question", "embedding_model_id", "target_run_id", "target_schema_id"]
            },
            output_schema_definition={
                "type": "object",
                "properties": {
                    "answer": {
                        "type": "string",
                        "description": "The generated answer combining graph and document knowledge"
                    },
                    "reasoning": {
                        "type": "string",
                        "description": "Explanation of how the answer was derived from both sources"
                    },
                    "graph_context": {
                        "type": "string",
                        "description": "Formatted graph knowledge used in the answer"
                    },
                    "embedding_context": {
                        "type": "string",
                        "description": "Formatted document context used in the answer"
                    },
                    "sources": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source_number": {"type": "integer"},
                                "chunk_id": {"type": "integer"},
                                "asset_id": {"type": "integer"},
                                "asset_title": {"type": "string"},
                                "text_content": {"type": "string"},
                                "distance": {"type": "number"},
                                "similarity": {"type": "number"}
                            }
                        },
                        "description": "Sources used to generate the answer"
                    },
                    "retrieval_stats": {
                        "type": "object",
                        "description": "Statistics about the retrieval process including graph fragments"
                    }
                }
            },
            module_path="app.api.analysis.adapters.graph_rag_adapter.GraphRagAdapter",
            adapter_type="graph_question_answering",
            version="1.0",
            is_active=True,
            is_public=True,
            creator_user_id=user.id
        )
        session.add(graph_rag_adapter)
        logger.info("Created Graph RAG analysis adapter")
    else:
        logger.info("Graph RAG analysis adapter already exists")

    # Fragment Curation Adapter
    fragment_curation_adapter_exists = session.exec(
        select(AnalysisAdapter).where(AnalysisAdapter.name == "fragment_curation_adapter")
    ).first()

    if not fragment_curation_adapter_exists:
        fragment_curation_adapter = AnalysisAdapter(
            name="fragment_curation_adapter",
            description="Manually promotes a selected insight to an asset's permanent metadata. This is a human-in-the-loop tool for curating asset intelligence fragments.",
            module_path="app.api.analysis.adapters.fragment_curation_adapter.FragmentCurationAdapter",
            input_schema_definition={
                "type": "object",
                "properties": {
                    "target_asset_id": {
                        "type": "integer",
                        "description": "The ID of the asset to update.",
                    },
                    "fragment_key": {
                        "type": "string",
                        "description": "The natural language name for the intelligence fragment (e.g., 'Key People', 'OSINT Relevance').",
                    },
                    "fragment_value": {
                        "type": "object",
                        "description": "The data being promoted. Can be any valid JSON type.",
                    },
                    "source_ref": {
                        "type": "string",
                        "description": "A reference to the data's origin (e.g., 'annotation/123', 'user/jane.doe').",
                    },
                    "curated_by_ref": {
                        "type": "string",
                        "description": "A reference to the user or process that curated the fragment (e.g., 'user/john.doe').",
                    },
                },
                "required": ["target_asset_id", "fragment_key", "fragment_value", "source_ref"],
            },
            output_schema_definition={
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer"},
                    "promoted_fragment_key": {"type": "string"},
                    "final_fragments": {"type": "object"},
                },
            },
            adapter_type="curation",
            version="1.0",
            is_active=True,
            is_public=True,
            creator_user_id=user.id,
        )
        session.add(fragment_curation_adapter)
        logger.info("Created Fragment Curation analysis adapter")
    else:
        logger.info("Fragment Curation analysis adapter already exists")

    session.commit()

    # --- Create Initial Embedding Models from Configuration ---
    logger.info("Creating initial embedding models from configuration...")
    
    try:
        # Load all provider configurations
        for provider_name in embedding_models_config.list_all_providers():
            provider_enum = None
            if provider_name.upper() == "OLLAMA":
                provider_enum = EmbeddingProvider.OLLAMA
            elif provider_name.upper() == "JINA":
                provider_enum = EmbeddingProvider.JINA
            elif provider_name.upper() == "OPENAI":
                provider_enum = EmbeddingProvider.OPENAI
            else:
                logger.warning(f"Unknown provider '{provider_name}', skipping")
                continue
            
            provider_models = embedding_models_config.get_provider_models(provider_name)
            
            for model_name, model_config in provider_models.items():
                existing_model = session.exec(
                    select(EmbeddingModel).where(
                        EmbeddingModel.name == model_name,
                        EmbeddingModel.provider == provider_enum
                    )
                ).first()
                
                if not existing_model:
                    # Create config dictionary from model_config
                    config_dict = {
                        "max_sequence_length": model_config.get("max_sequence_length"),
                        "tags": model_config.get("tags", []),
                        "languages": model_config.get("languages", []),
                        "use_cases": model_config.get("use_cases", []),
                        "recommended": model_config.get("recommended", False)
                    }
                    
                    # Add provider-specific config
                    if provider_name == "jina":
                        config_dict["cost_per_1k_tokens"] = model_config.get("cost_per_1k_tokens")
                    elif provider_name == "ollama":
                        config_dict["model_size"] = model_config.get("model_size")
                    
                    embedding_model = EmbeddingModel(
                        name=model_name,
                        provider=provider_enum,
                        dimension=model_config["dimension"],
                        description=model_config.get("description", ""),
                        config=config_dict,
                        max_sequence_length=model_config.get("max_sequence_length")
                    )
                    session.add(embedding_model)
                    logger.info(f"Created embedding model: {model_name} ({provider_name})")
                else:
                    logger.info(f"Embedding model '{model_name}' already exists")
        
        session.commit()
        
    except Exception as e:
        logger.error(f"Error creating embedding models from configuration: {e}")
        session.rollback()

    logger.info("Database initialization complete.")

