# OSINT Kernel - Backend Architecture & Analysis Engine Handover

**Date:** July 16, 2024
**Version:** 2.0 (Deep Thought Edition - Post-Refactor)

## 1. Introduction

This document provides a technical handover for the refactored backend of the OSINT Kernel, focusing on the new Analysis Engine, data model interactions, provider patterns, and dependency injection. It serves as a guide for developers to understand, maintain, and extend the system.

The core philosophy is a **backend-first analysis approach** with a **thin, configurable frontend**. This means most data processing, aggregation, and analytical computations are handled by backend modules, while the frontend is responsible for user interaction, configuration of backend tasks, and visualization of (mostly) pre-processed data.

Refer to `backend/app/api/system-requirements.md` (Rev. 2) for a comprehensive system design overview.

## 2. Core Architectural Changes & Key Components

### 2.1. Data Models (`app/models.py`)

The SQLModel definitions form the backbone. Key entities relevant to the analysis engine include:

*   **`Infospace`**: Tenant isolation, holds configurations (e.g., for vector embeddings).
*   **`Source`**: Defines ingestion pathways.
*   **`Asset`**: Immutable representation of raw or processed data (files, text, images, etc.). Supports parent-child hierarchies (e.g., PDF -> Pages, CSV -> Rows) via `parent_asset_id`.
*   **`AssetChunk`**: Granular pieces of `Asset`s (e.g., text segments) used for embeddings and fine-grained analysis. Stores `embedding` vectors.
*   **`AnnotationSchema`**: Defines the *what* and *how* of an annotation task. Includes:
    *   `output_contract` (JSONSchema): Structure of the `Annotation.value`.
    *   `instructions` (Text): Natural language guidance for the AI/ML model.
    *   `target_level` (Enum: `ASSET`, `CHILD`, `BOTH`): Specifies if annotation applies to the parent `Asset` or its children.
    *   `version`: For schema evolution.
*   **`AnnotationRun`**: Represents an execution of `AnnotationSchema`(s) on target `Asset`(s) or `Bundle`(s). Key fields:
    *   `configuration` (JSON): Stores LLM model choice, `include_parent_context`, `context_window`, `thinking_budget` overrides, etc.
    *   `status` (Enum: `PENDING`, `RUNNING`, `COMPLETED`, `FAILED`).
*   **`Annotation`**: The result of applying a schema to an asset within a run. Key fields:
    *   `value` (JSON): Structured data matching the `AnnotationSchema.output_contract`.
    *   `region` (JSON): Optional spatial data (bounding box, polygon, text span).
    *   `links` (JSON): Optional structured links to other entities (other Annotations, Assets).
    *   `event_timestamp`: Optional, derived from asset or `Annotation.value`.
*   **`Justification`**: Structured explanation for an `Annotation` or a field within it. Includes `reasoning`, `evidence_payload` (can reference text spans, regions, other assets), and `model_name`.
*   **`Bundle`**: Analyst-curated collection of `Asset`s.
*   **`Task`**: Defines automated, scheduled jobs (e.g., ingestion, annotation runs) using cron syntax.
*   **`AnalysisAdapter`**: A registered backend module for specific data analysis. Key fields:
    *   `name`: Unique identifier (e.g., "label_distribution_adapter").
    *   `input_schema_definition` (JSONSchema): Defines parameters the adapter accepts.
    *   `output_schema_definition` (JSONSchema): Defines the structure of the adapter's results.
    *   `module_path`: Python path to the adapter's class (e.g., `app.api.analysis.adapters.label_distribution_adapter.LabelDistributionAdapter`).
    *   `adapter_type`: Categorizes the adapter (e.g., "aggregation", "geospatial").

### 2.2. Provider Pattern (External Service Integration)

Located in `app/api/providers/`:

*   **`base.py`**: Defines abstract `Protocol`s for each type of external service (e.g., `StorageProvider`, `ClassificationProvider`, `ScrapingProvider`, `SearchProvider`). These protocols define the interface (methods and signatures) that concrete providers must implement.
*   **`impl/` (subdirectory)**: Contains concrete implementations of the provider protocols.
    *   Example: `impl/storage_minio.py` (for Minio), `impl/classification_gemini_native.py`.
    *   **Key Principle:** Concrete provider classes in `impl/` **must** accept all their configurations (API keys, endpoints, bucket names, etc.) via their `__init__` constructor. They should **not** read from `os.environ` or global `settings` directly.
*   **`factory.py`**: Contains factory functions (e.g., `create_storage_provider(settings: AppSettings)`) for each provider type.
    *   These factories take `AppSettings` as input.
    *   They read specific settings from `AppSettings` (e.g., `settings.STORAGE_PROVIDER_TYPE`, `settings.MINIO_ENDPOINT`) to decide which concrete provider from `impl/` to instantiate and then pass the relevant configurations to its constructor.

### 2.3. Dependency Injection (`app/api/deps.py`)

*   Manages how dependencies (like DB sessions, settings, providers, and services) are created and injected into API routes and other services.
*   **`SettingsDep`**: Provides the `AppSettings` instance.
*   **`SessionDep`**: Provides a database session per request.
*   **`CurrentUser`, `OptionalUser`**: Handle user authentication using JWT and `AppSettings.SECRET_KEY`.
*   **`*ProviderDep` (e.g., `StorageProviderDep`, `ClassificationProviderDep`):**
    *   Defined using `Annotated[ProviderProtocol, Depends(get_*_provider_dependency)]`.
    *   The `get_*_provider_dependency(settings: SettingsDep)` functions call the corresponding factory function from `app/api/providers/factory.py`, passing the `settings`.
*   **`*ServiceDep` (e.g., `InfospaceServiceDep`, `AnnotationServiceDep`):**
    *   Defined using `Annotated[ServiceName, Depends(get_*_service)]` (direct class types are now used instead of string literals where Pylance can resolve them, assuming service files are created and imported).
    *   The `get_*_service(request: Request, session: SessionDep, ...other_deps...)` functions instantiate the service class, injecting its dependencies (session, other services, providers).
    *   Services are cached per-request using `request.state` to ensure a single instance per request.
*   **Service Constructors:** All service classes in `app/api/services/` must have their `__init__` methods updated to accept all dependencies injected by their respective `get_*_service` functions in `deps.py`.

### 2.4. Service Layer (`app/api/services/`)

*   Encapsulates business logic, using injected providers and DB sessions.
*   Examples: `InfospaceService`, `AssetService` (new), `AnnotationService`, `IngestionService`, `PackageService`, `AnalysisService` (new), `TaskService` (new).
*   Services should operate on full SQLModel objects internally and return them. Pydantic `Read` schemas are typically for API route responses.

### 2.5. API Routes (`app/api/routes/`)

*   Handle HTTP request/response, validation using Pydantic schemas (`app/schemas.py`), and delegate business logic to services.
*   Endpoints are organized by resource (e.g., `infospaces.py`, `assets.py`).
*   **New Analysis Routes:**
    *   `analysis_adapters_admin.py`: For CRUD operations on `AnalysisAdapter` registration records (admin/developer feature).
    *   `analysis_execution.py`: Contains the crucial `POST /analysis/{adapter_name}/execute` endpoint for running adapters.

## 3. The Analysis Engine (`app/api/analysis/`)

This is a core part of the refactored backend, enabling flexible, backend-driven data analysis.

### 3.1. `AnalysisAdapterProtocol` (`app/api/analysis/protocols.py`)

Defines the contract for all analysis adapters:

```python
from typing import Protocol, Any, Dict, Optional
from sqlmodel import Session
from app.models import User

class AnalysisAdapterProtocol(Protocol):
    def __init__(self, session: Session, config: Dict[str, Any], current_user: Optional[User] = None, infospace_id: Optional[int] = None):
        ...
    async def execute(self) -> Dict[str, Any]:
        ...
```
*   Adapters are instantiated with a DB session, a configuration dictionary (`config`), the `current_user` (for context/permissions), and the `infospace_id` where the analysis is being performed.

### 3.2. Concrete Adapters (`app/api/analysis/adapters/`)

*   Each adapter is a Python class implementing `AnalysisAdapterProtocol`.
*   **Examples Implemented:**
    *   `label_distribution_adapter.py:LabelDistributionAdapter`
    *   `time_series_adapter.py:TimeSeriesAggregationAdapter`
*   **Configuration is Key:** Adapters are designed to be highly configurable through their `config` dictionary, which is validated against their `input_schema_definition` (stored in the `AnalysisAdapter` DB record).
*   **Flexible Field Mapping:** A crucial design pattern is allowing adapters to operate on user-specified fields. For example:
    *   `timestamp_source_field`: Can be configured to use `"asset.event_timestamp"`, `"annotation.timestamp"`, or `"annotation_value.your_custom_timestamp_field"`.
    *   `label_field_key`: Can be `"asset.kind"` or `"annotation_value.extracted_category"`.
    *   This allows users to define what data is relevant for analysis via `AnnotationSchema`s and then instruct adapters to use those specific fields.
*   **`execute()` Method:** Contains the core logic for fetching data (based on `config` parameters like `target_run_id`, `target_bundle_id`, `target_asset_ids`, `target_schema_id`), performing calculations (often using libraries like Pandas), and returning results structured according to the adapter's `output_schema_definition`.

### 3.3. Execution via API (`app/api/routes/analysis_execution.py`)

*   The `POST /analysis/{adapter_name}/execute` endpoint:
    1.  Receives `adapter_name` and a JSON `config` body.
    2.  Optionally, an `AnalysisService` can be used here to encapsulate the loading/execution logic, or the route can handle it directly if simple enough.
    3.  Fetches the `AnalysisAdapter` record from the database by `adapter_name`.
    4.  Validates the provided `config` against the adapter's stored `input_schema_definition` (using `jsonschema` or dynamic Pydantic model creation - **TODO: Implement robust validation**).
    5.  Dynamically imports the adapter module and class using `adapter_record.module_path`.
    6.  Instantiates the adapter class, passing the `session`, validated `config`, `current_user`, and `infospace_id` (from route context).
    7.  Calls the adapter's `async execute()` method.
    8.  Returns the results.

### 3.4. Drill-Down and Contextual Data

*   Adapters like `TimeSeriesAggregationAdapter` (when `time_bucket: "raw"`) can include `contributing_annotation_ids` in their output.
*   The frontend can use these IDs to make a subsequent API call (e.g., to a batch GET endpoint for annotations) to fetch detailed `Annotation` data (including `Justification`s) for drill-down views.

## 4. Ingestion and Automation

### 4.1. Ingestion (`app/api/services/ingestion_service.py`)

*   The `IngestionService` now uses `AssetService` to create `Asset`s and their children (e.g., PDF pages, CSV rows as `Asset`s).
*   The concept of `DataRecord` is being phased out in favor of a unified `Asset` model.
*   `_process_csv_content` and `_process_pdf_content` in `IngestionService` now prepare data for `Asset` creation, including parent-child relationships for PDF pages or CSV rows (which become `Asset`s of kind `PDF_PAGE` or `CSV_ROW`, linked to a parent `Asset` representing the PDF/CSV file).
*   File uploads are handled with a temp-to-final storage move.
*   For `DataSource` types requiring backend processing (CSV, PDF, URL, URL_LIST), a Celery task (`process_datasource` from `app/api/tasks/ingest.py`) is enqueued. This task will use `IngestionService` and `AssetService` to perform the actual parsing and `Asset` creation.

### 4.2. Automation (`app/models.py:Task`, `app/api/services/task_service.py`, `app/core/celery_app.py`)

*   The `Task` model defines scheduled operations (INGEST, ANNOTATE) with cron schedules and configurations.
*   `TaskService` (newly created placeholder) will be responsible for CRUD on `Task` entities.
*   `celery_app.py` defines a `beat_schedule` that periodically calls a Celery task (e.g., `app.api.tasks.scheduling.check_recurring_tasks`).
*   This `check_recurring_tasks` task will query active `Task` entities from the database via `TaskService` and dispatch appropriate Celery tasks (e.g., an ingestion task for a `Source`, or an annotation task to create and process an `AnnotationRun`) based on their schedule and configuration.
*   `beat_utils.py` (or a refactored `BeatService`) will be used by `TaskService` (or `RecurringTaskService`) to dynamically add/remove/update schedules in Celery Beat when `Task` entities are managed via the API. **(Note: `beat_utils.py` was marked as deprecated; its functionality needs to be robustly implemented within a service interacting with Celery Beat).**

## 5. Frontend Interaction Model (Guidance)

With the backend-first analysis approach, the frontend's role shifts:

1.  **Configuration Hub:**
    *   Users select `Asset`(s) or `Bundle`(s).
    *   Users define/select `AnnotationSchema`(s) for `AnnotationRun`s.
    *   Users configure `AnnotationRun` parameters (LLM model, context settings, thinking budget).
    *   **New:** Users browse available `AnalysisAdapter`s (fetched from a backend API, e.g., `GET /analysis/adapters`).
    *   **New:** For a selected adapter, the frontend dynamically renders a configuration form based on the adapter's `input_schema_definition` (fetched from backend).
        *   This includes allowing users to map adapter parameters (like `timestamp_source_field` or `label_field_key`) to specific fields from `Asset` attributes or `Annotation.value` (derived from a selected `AnnotationSchema`).
2.  **Triggering Backend Operations:**
    *   Initiate `AnnotationRun`s by calling `POST /infospaces/{id}/runs`.
    *   Execute analysis by calling `POST /analysis/{adapter_name}/execute` with the user's configuration.
3.  **Displaying Processed Data:**
    *   Fetch and display results from `AnnotationRun`s (i.e., `Annotation`s with their `Justification`s and `Link`s).
    *   Fetch and display results from `AnalysisAdapter` executions.
    *   Charting/mapping components (`ClassificationResultsPieChart.tsx`, `TimeSeriesAggregationAdapter`, etc.) will receive data that is already aggregated or structured for visualization by the backend adapters.
    *   Client-side data manipulation should be minimized, focusing on presentation and UI interactivity on already processed data.
4.  **Drill-Down:** Use IDs (e.g., `contributing_annotation_ids`) from adapter results to fetch detailed `Annotation` objects for focused views.

## 6. Key Files and Structure (Reiteration)

(Refer to Section 5 of `backend/app/api/system-requirements.md` for the detailed file structure overview that was recently updated).

## 7. Next Steps & Recommendations for Development

1.  **Complete Provider Refactoring:** Ensure all concrete providers in `app/api/providers/impl/` correctly accept configuration via `__init__` from their respective factories in `app/api/providers/factory.py`.
2.  **Implement Placeholder Services:** Flesh out `AssetService`, `TaskService`, and `AnalysisService` with their core CRUD and operational methods.
3.  **Solidify Service `__init__` Signatures:** Double-check all service constructors in `app/api/services/` to ensure they match the dependencies being injected by `app/api/deps.py`.
4.  **Thorough Backend Testing:** Test API endpoints, especially `POST /analysis/{adapter_name}/execute`.
5.  **Seed `AnalysisAdapter` Table:** Add DB records for `LabelDistributionAdapter` and `TimeSeriesAggregationAdapter` with their correct module paths and JSON schema definitions for input/output.
6.  **Frontend Refactoring:** Begin adapting frontend components (e.g., `ClassificationResultsPieChart.tsx`, then `ClassificationResultsChart.tsx`) to use the new backend analysis adapter endpoints.

This refactored architecture provides a strong, scalable, and flexible foundation for the OSINT Kernel. 