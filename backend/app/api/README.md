# API Services Architecture

This directory contains the application's business logic layer in the form of services. The services layer is a key part of our architectural redesign, addressing issues with previous approaches such as inconsistent patterns, poor separation of concerns, and tight coupling to specific implementations.

## Key Design Principles

1.  **Service Layer Pattern**: Services encapsulate business logic, providing a clean, consistent API for the application's core functionality. This allows API routes (`app/api/routes/`) to focus on request/response handling rather than implementing business logic directly.

2.  **Provider Pattern**: External integrations (storage, classification, search, etc.) are accessed through provider interfaces (`app/api/services/providers/`), allowing the application to switch between different implementations (e.g., from OPOL to another classification system) without changing the core business logic.

3.  **Dependency Injection**: Services can be configured with specific provider implementations, enabling flexible composition and easier testing. FastAPI's dependency injection (`app/api/deps.py`) is used to provide dependencies like DB sessions and service instances.

4.  **Single Responsibility**: Each service focuses on a specific domain (workspaces, classification, ingestion, etc.) with clear boundaries and minimal overlap.

## Directory Structure (`app/api/`)

```
api/
├── deps.py                    # FastAPI dependencies (DB session, auth)
├── main.py                    # API router assembly
├── routes/                    # API endpoint definitions
│   ├── v1/                    # Version 1 API routes
│   │   ├── locations/
│   │   └── ...
│   ├── v2/                    # Version 2 API routes
│   │   ├── geo.py
│   │   └── ...
│   ├── workspaces.py          # Shared/Unversioned routes
│   ├── users.py
│   ├── datasets.py            # Add new routes file
│   └── ...
├── services/                  # Business logic layer
│   ├── providers/             # Provider interfaces and implementations
│   │   ├── __init__.py        # Exports provider interfaces and factories
│   │   ├── base.py            # Provider interfaces (abstract base classes)
│   │   ├── classification.py  # Classification providers (e.g., Opol)
│   │   ├── geospatial.py      # Geospatial providers (e.g., Opol)
│   │   ├── scraping.py        # Web scraping providers (e.g., Opol)
│   │   ├── search.py          # Search providers (e.g., Opol)
│   │   └── storage.py         # Storage providers (e.g., Minio)
│   ├── __init__.py            # Exports services & factories
│   ├── classification_service.py
│   ├── ingestion_service.py
│   ├── workspace_service.py
│   ├── recurring_task_service.py
│   ├── shareable_service.py
│   ├── dataset_service.py     # Add new service file
│   └── ... (Potentially other services)
└── README.md                  # This documentation
```

*(Note: Celery tasks now reside in `app/tasks/`)*

## Services

*   **`WorkspaceService`**: Handles workspace CRUD and related operations.
*   **`ClassificationService`**: Manages classification schemes, jobs, and results. Orchestrates classification via `ClassificationProvider`.
*   **`IngestionService`**: Manages `DataSource` creation (including file uploads via `StorageProvider`), `DataRecord` creation (including scraping via `ScrapingProvider`). Triggers background ingestion tasks.
*   **`RecurringTaskService`**: Manages `RecurringTask` entities and updates Celery Beat schedule.
*   **`ShareableService`**: Manages `ShareableLink` entities and coordinates import/export operations by calling other services.
*   **`DatasetService`**: Handles CRUD and associated logic for `Dataset` entities.

## Provider Interfaces

Providers abstract external dependencies. Key interfaces defined in `providers/base.py`:

*   **`StorageProvider`**: File storage (Implemented by `MinioClientHandler`).
*   **`ClassificationProvider`**: Text classification (Implemented by `OpolClassificationProvider`).
*   **`ScrapingProvider`**: Web scraping (Implemented by `OpolScrapingProvider`).
*   **`SearchProvider`**: Search functionality (Implemented by `OpolSearchProvider`).
*   **`GeospatialProvider`**: Geospatial data access (Implemented by `OpolGeospatialProvider`).

Factory functions (e.g., `get_storage_provider()`) in `providers/__init__.py` (or the specific provider file) return configured instances.

## Adding New Providers (Example: Search Provider)

The provider pattern makes it easy to integrate alternative external services. To add a new Search Provider (e.g., for SearXNG):

1.  **Create Implementation:**
    *   In `app/api/services/providers/search.py`, create a new class `SearXngSearchProvider(SearchProvider)`.
    *   Implement the abstract methods `search()` and `search_by_entity()` defined in `SearchProvider` (`app/api/services/providers/base.py`), using the SearXNG client or API library.

2.  **Update Factory:**
    *   Modify the `get_search_provider()` factory function in `app/api/services/providers/search.py`.
    *   Add logic (e.g., based on environment variables in `settings` or a configuration parameter) to decide whether to return an instance of `OpolSearchProvider` or `SearXngSearchProvider`.
    ```python
    # Example modification in providers/search.py
    def get_search_provider() -> SearchProvider:
        if settings.SEARCH_PROVIDER_TYPE == "searxng":
            # Assuming SearXNG client setup here
            return SearXngSearchProvider(...)
        else: # Default to OPOL
            return OpolSearchProvider()
    ```

3.  **Usage:** Services that need search functionality will continue to call `get_search_provider()`. The factory will now provide the configured implementation, requiring no changes to the service logic itself.

## Usage in API Routes

API routes (`app/api/routes/`) should:

1.  Focus on request validation, calling the appropriate service methods, and formatting responses.
2.  Not contain business logic directly.
3.  Get service instances via factory functions (e.g., `get_classification_service()`).

**Example (Refactored Route - `datasources.py`):**
```python
@router.get("", response_model=DataSourcesOut)
def read_datasources(
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    # ... other params
):
    service = get_ingestion_service()
    try:
        datasources, total_count = service.list_datasources(
            session=session,
            user_id=current_user.id,
            workspace_id=workspace_id,
            # ... other args
        )
        return DataSourcesOut(data=datasources, count=total_count)
    # ... exception handling ...
```

## Usage in Background Tasks

Background tasks (`app/tasks/`) should:

1.  Handle task-specific concerns (retries, timeouts, progress tracking).
2.  Delegate actual business operations to services.
3.  Use service methods for core functionality and database interactions.

**Example (Refactored Task - `app/tasks/classification.py`):**
```python
@celery.task(bind=True, max_retries=3)
def process_classification_job(self, job_id: int):
    classification_service = get_classification_service()
    with SQLModelSession(engine) as session:
        try:
            job = classification_service.get_job(session, job_id)
            # ... check job status ...
            classification_service.update_job_status(session, job_id, ClassificationJobStatus.RUNNING, commit_session=False)
            # ... fetch records/schemes ...
            for record in data_records:
                for scheme in schemes:
                    # ... check existing result ...
                    result_value = classification_service.classify_text(...)
                    # ... append result_value to batch_data ...
                    if len(batch_data) >= batch_size:
                        classification_service.create_results_batch(session, batch_data, commit_session=False)
                        # ... reset batch_data ...
            # ... create final batch ...
            classification_service.update_job_status(session, job_id, final_status, ..., commit_session=False)
            session.commit()
        except Exception as e:
            session.rollback()
            # ... handle error, update status via service (with commit) ...
            # ... retry logic ...
        finally:
            # ... update recurring task status via util ...
```

## Testing

Services should be easier to test because:

1.  External dependencies (Providers) can be mocked by creating test implementations of the provider interfaces.
2.  Business logic is centralized and separated from HTTP/task concerns.
3.  Services can be instantiated directly with controlled dependencies during testing.

Example test approach:
```python
def test_classification_service():
    # Create mock providers
    mock_provider = MockClassificationProvider()
    # Create service with mock provider
    service = ClassificationService(classification_provider=mock_provider)
    # Test service methods
    result = service.classify_text("sample text", scheme_id=1, session=mock_session)
    assert result == expected_result
``` 