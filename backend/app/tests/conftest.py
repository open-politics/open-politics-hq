from collections.abc import Generator
from typing import Dict
import pytest
from fastapi.testclient import TestClient
from sqlmodel import Session, delete, SQLModel
import os
import asyncio
from celery.contrib.testing.worker import start_worker
from celery.contrib.testing.app import TestApp

from app.core.config import settings
from app.core.db import engine, init_db
from app.core.celery_app import celery
from app.main import app
from app.models import (
    Item,
    User,
    Workspace,
    DataSource,
    ClassificationScheme,
    ClassificationJob,
    ClassificationResult,
    DataRecord,
    Dataset,
    ShareableLink,
    RecurringTask,
    ClassificationField,
)
from app.tests.utils.user import authentication_token_from_email
from app.tests.utils.utils import get_superuser_token_headers

# Configure test Celery app
test_celery = TestApp(celery)
test_celery.conf.update(
    CELERY_ALWAYS_EAGER=True,  # Tasks run synchronously
    CELERY_TASK_EAGER_PROPAGATES=True,  # Exceptions are propagated
)

@pytest.fixture(scope="session")
def celery_config():
    return {
        "broker_url": "memory://",
        "result_backend": "cache+memory://",
        "task_always_eager": True,
        "task_eager_propagates": True,
    }

@pytest.fixture(scope="session")
def celery_enable_logging():
    return True

@pytest.fixture(scope="session")
def celery_includes():
    return [
        "app.api.tasks.ingestion",
        "app.api.tasks.classification",
    ]

@pytest.fixture(scope="function")
def db() -> Generator:
    """
    Create a fresh database for each test.
    """
    # Create all tables
    SQLModel.metadata.create_all(engine)
    
    with Session(engine) as session:
        init_db(session)
        yield session
        
        # Rollback any pending changes
        session.rollback()
        
        # Delete all data after each test
        for table in reversed(SQLModel.metadata.sorted_tables):
            session.execute(table.delete())
        session.commit()

@pytest.fixture(scope="module")
def client() -> TestClient:
    """Create a test client that behaves like a regular HTTP client."""
    return TestClient(app)

@pytest.fixture(scope="module")
def auth_headers(client: TestClient) -> dict[str, str]:
    """Get authentication headers by making a real login request."""
    login_data = {
        "username": settings.FIRST_SUPERUSER,
        "password": settings.FIRST_SUPERUSER_PASSWORD,
    }
    response = client.post(f"{settings.API_V1_STR}/login/access-token", data=login_data)
    assert response.status_code == 200, f"Login failed: {response.text}"
    
    tokens = response.json()
    return {"Authorization": f"Bearer {tokens['access_token']}"}

@pytest.fixture(scope="module")
def superuser_token_headers(client: TestClient) -> dict[str, str]:
    return get_superuser_token_headers(client)

@pytest.fixture(scope="module")
def normal_user_token_headers(client: TestClient, db: Session) -> dict[str, str]:
    return authentication_token_from_email(
        client=client, email=settings.EMAIL_TEST_USER, db=db
    )
