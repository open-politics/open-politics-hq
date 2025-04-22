from sqlmodel import Session, create_engine, select, text

from app import crud
from app.core.config import settings
from app.models import *
from app.core.security import get_password_hash
import os
import logging

logger = logging.getLogger(__name__)

engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI))


# make sure all SQLModel models are imported (app.models) before initializing DB
# otherwise, SQLModel might fail to initialize relationships properly
# for more details: https://github.com/tiangolo/full-stack-fastapi-template/issues/28


def init_db(session: Session) -> None:
    # Tables should be created with Alembic migrations
    # But if you don't want to use migrations, create
    # the tables un-commenting the next lines


    if os.environ.get("WIPE_DB") == "True":
        logger.info("Wiping DB")
        # Wipe DB table "alembic_version"
        session.exec(text("DROP TABLE IF EXISTS alembic_version"))
        SQLModel.metadata.drop_all(engine)
        SQLModel.metadata.create_all(engine)
        logger.info("DB wiped")

        # from app.core.engine import engine
        # This works because the models are already imported and registered from app.models
        # print("Creating tables")
        # SQLModel.metadata.drop_all(engine)
        # SQLModel.metadata.create_all(engine)

    # Create initial superuser if not exists
    user = session.exec(
        select(User).where(User.email == settings.FIRST_SUPERUSER)
    ).first()
    if not user:
        user_in = UserCreate(
            email=settings.FIRST_SUPERUSER,
            password=settings.FIRST_SUPERUSER_PASSWORD,
            is_superuser=True,
        )
        user = crud.create_user(session=session, user_create=user_in)

    # Create a workspace for the user if not exists
    super_user_workspace = session.exec(
        select(Workspace).where(Workspace.user_id_ownership == user.id)
    ).first()
    if not super_user_workspace:
        workspace_in = WorkspaceCreate(
            name="Default Workspace",
            description="This is the default workspace for the user",
        )
        workspace = Workspace(
            **workspace_in.model_dump(),
            user_id_ownership=user.id
        )
        session.add(workspace)
        session.commit()
        session.refresh(workspace)
    else:
        workspace = super_user_workspace

    # Create a classification scheme for the workspace if not exists
    super_user_scheme = session.exec(
        select(ClassificationScheme).where(ClassificationScheme.workspace_id == workspace.id)
    ).first()
    if not super_user_scheme:
        # First create the scheme without fields
        scheme = ClassificationScheme(
            name="Default Text Classifier",
            description="A simple text classifier that returns 'Works!' when called",
            model_instructions="Return 'Works!' for any input text",
            workspace_id=workspace.id,
            user_id=user.id
        )
        session.add(scheme)
        session.flush()  # Get the scheme ID

        # Then create the field separately
        field = ClassificationField(
            scheme_id=scheme.id,
            name="text",
            description="The text to classify",
            type=FieldType.STR
        )
        session.add(field)
        session.commit()
        session.refresh(scheme)

    # Create a categories classification scheme with list of labels
    categories_scheme = session.exec(
        select(ClassificationScheme).where(
            ClassificationScheme.workspace_id == workspace.id,
            ClassificationScheme.name == "Political Categories"
        )
    ).first()
    if not categories_scheme:
        # Create the categories scheme
        categories_scheme = ClassificationScheme(
            name="Political Categories",
            description="Categorize political content into predefined categories",
            model_instructions="Analyze the text and select all applicable political categories that the content belongs to.",
            workspace_id=workspace.id,
            user_id=user.id
        )
        session.add(categories_scheme)
        session.flush()  # Get the scheme ID

        # Create the categories field with predefined labels
        categories_field = ClassificationField(
            scheme_id=categories_scheme.id,
            name="categories",
            description="Political categories that apply to the content",
            type=FieldType.LIST_STR,
            is_set_of_labels=True,
            labels=["Economic Policy", "Foreign Policy", "Healthcare", "Education", 
                    "Environment", "Immigration", "Civil Rights", "National Security"]
        )
        session.add(categories_field)
        session.commit()
        session.refresh(categories_scheme)

    # Create an entity-statement classification scheme
    entity_statement_scheme = session.exec(
        select(ClassificationScheme).where(
            ClassificationScheme.workspace_id == workspace.id,
            ClassificationScheme.name == "Entity Statements"
        )
    ).first()
    if not entity_statement_scheme:
        # Create the entity-statement scheme
        entity_statement_scheme = ClassificationScheme(
            name="Entity Statements",
            description="Extract entities and their associated statements from political text",
            model_instructions="Identify key political entities mentioned in the text and extract the main statements or claims made about them.",
            workspace_id=workspace.id,
            user_id=user.id
        )
        session.add(entity_statement_scheme)
        session.flush()  # Get the scheme ID

        # Create the entity-statement field with dictionary structure
        entity_statement_field = ClassificationField(
            scheme_id=entity_statement_scheme.id,
            name="entity_statements",
            description="Entities and their associated statements",
            type=FieldType.LIST_DICT,
            dict_keys=[
                {"name": "entity", "type": "str"},
                {"name": "statement", "type": "str"},
                {"name": "sentiment", "type": "int"}
            ]
        )
        session.add(entity_statement_field)
        session.commit()
        session.refresh(entity_statement_scheme)

