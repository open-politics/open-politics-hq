# FastAPI Project - Backend

## Requirements

*   [Docker](https://www.docker.com/).
*   [Poetry](https://python-poetry.org/) for Python package and environment management.

## Local Development

*   Start the stack with Docker Compose:

```bash
docker compose up -d
```

*   Now you can open your browser and interact with these URLs:

    Frontend, built with Docker, with routes handled based on the path: http://localhost

    Backend, JSON based web API based on OpenAPI: http://localhost/api/

    Automatic interactive documentation with Swagger UI (from the OpenAPI backend): http://localhost/docs

    Adminer, database web administration: http://localhost:8080

    Traefik UI, to see how the routes are being handled by the proxy: http://localhost:8090

**Note**: The first time you start your stack, it might take a minute for it to be ready. While the backend waits for the database to be ready and configures everything. You can check the logs to monitor it.

To check the logs, run:

```bash
docker compose logs
```

To check the logs of a specific service, add the name of the service, e.g.:

```bash
docker compose logs backend
```

If your Docker is not running in `localhost` (the URLs above wouldn't work) you would need to use the IP or domain where your Docker is running.

## Backend local development, additional details

### General workflow

The override.yml build the backend container with auto-build on, no more modifications needed for easy development.a

### Enabling Open User Registration

By default the backend has user registration disabled, but there's already a route to register users. If you want to allow users to register themselves, you can set the environment variable `USERS_OPEN_REGISTRATION` to `True` in the `.env` file.

After modifying the environment variables, restart the Docker containers to apply the changes. You can do this by running:

```console
$ docker compose up -d
```

### VS Code

There are already configurations in place to run the backend through the VS Code debugger, so that you can use breakpoints, pause and explore variables, etc.

The setup is also already configured so you can run the tests through the VS Code Python tests tab.

### Docker Compose Override

During development, you can change Docker Compose settings that will only affect the local development environment in the file `docker-compose.override.yml`.

The changes to that file only affect the local development environment, not the production environment. So, you can add "temporary" changes that help the development workflow.

For example, the directory with the backend code is mounted as a Docker "host volume", mapping the code you change live to the directory inside the container. That allows you to test your changes right away, without having to build the Docker image again. It should only be done during development, for production, you should build the Docker image with a recent version of the backend code. But during development, it allows you to iterate very fast.

There is also a command override that runs `/start-reload.sh` (included in the base image) instead of the default `/start.sh` (also included in the base image). It starts a single server process (instead of multiple, as would be for production) and reloads the process whenever the code changes. Have in mind that if you have a syntax error and save the Python file, it will break and exit, and the container will stop. After that, you can restart the container by fixing the error and running again:

```console
$ docker compose up -d
```

There is also a commented out `command` override, you can uncomment it and comment the default one. It makes the backend container run a process that does "nothing", but keeps the container alive. That allows you to get inside your running container and execute commands inside, for example a Python interpreter to test installed dependencies, or start the development server that reloads when it detects changes.

To get inside the container with a `bash` session you can start the stack with:

```console
$ docker compose up -d
```

and then `exec` inside the running container:

```console
$ docker compose exec backend bash
```

You should see an output like:

```console
root@7f2607af31c3:/app#
```

that means that you are in a `bash` session inside your container, as a `root` user, under the `/app` directory, this directory has another directory called "app" inside, that's where your code lives inside the container: `/app/app`.

There you can use the script `/start-reload.sh` to run the debug live reloading server. You can run that script from inside the container with:

```console
$ bash /start-reload.sh
```

...it will look like:

```console
root@7f2607af31c3:/app# bash /start-reload.sh
```

and then hit enter. That runs the live reloading server that auto reloads when it detects code changes.

Nevertheless, if it doesn't detect a change but a syntax error, it will just stop with an error. But as the container is still alive and you are in a Bash session, you can quickly restart it after fixing the error, running the same command ("up arrow" and "Enter").

...this previous detail is what makes it useful to have the container alive doing nothing and then, in a Bash session, make it run the live reload server.

### Backend tests

To test the backend run:

```console
$ bash ./scripts/test.sh
```

The tests run with Pytest, modify and add tests to `./backend/app/tests/`.

If you use GitHub Actions the tests will run automatically.

#### Test running stack

If your stack is already up and you just want to run the tests, you can use:

```bash
docker compose exec backend bash /app/tests-start.sh
```

That `/app/tests-start.sh` script just calls `pytest` after making sure that the rest of the stack is running. If you need to pass extra arguments to `pytest`, you can pass them to that command and they will be forwarded.

For example, to stop on first error:

```bash
docker compose exec backend bash /app/tests-start.sh -x
```

#### Test Coverage

When the tests are run, a file `htmlcov/index.html` is generated, you can open it in your browser to see the coverage of the tests.

### Migrations

As during local development your app directory is mounted as a volume inside the container, you can also run the migrations with `alembic` commands inside the container and the migration code will be in your app directory (instead of being only inside the container). So you can add it to your git repository.

Make sure you create a "revision" of your models and that you "upgrade" your database with that revision every time you change them. As this is what will update the tables in your database. Otherwise, your application will have errors.

*   Start an interactive session in the backend container:

```console
$ docker compose exec backend bash
```

*   Alembic is already configured to import your SQLModel models from `./backend/app/models.py`.

*   After changing a model (for example, adding a column), inside the container, create a revision, e.g.:

```console
$ alembic revision --autogenerate -m "Add column last_name to User model"
```

*   Commit to the git repository the files generated in the alembic directory.

*   After creating the revision, run the migration in the database (this is what will actually change the database):

```console
$ alembic upgrade head
```

If you don't want to use migrations at all, uncomment the lines in the file at `./backend/app/core/db.py` that end in:

```python
SQLModel.metadata.create_all(engine)
```

and comment the line in the file `prestart.sh` that contains:

```console
$ alembic upgrade head
```

If you don't want to start with the default models and want to remove them / modify them, from the beginning, without having any previous revision, you can remove the revision files (`.py` Python files) under `./backend/app/alembic/versions/`. And then create a first migration as described above.

# Backend Technical Overview

This document provides a technical overview of the backend application, built with FastAPI. It follows a service-oriented architecture designed for modularity and extensibility.

## Core Technologies

*   **Framework:** [FastAPI](https://fastapi.tiangolo.com/) for high-performance web APIs.
*   **ORM & Data Validation:** [SQLModel](https://sqlmodel.tiangolo.com/) (built on Pydantic and SQLAlchemy) for database models, ORM interactions, and data validation.
*   **Database:** PostgreSQL (assumed, standard for SQLAlchemy/Alembic setups). Migrations likely managed by Alembic (though migration files not shown).
*   **Asynchronous Tasks:** [Celery](https://docs.celeryq.dev/en/stable/) for background task processing (e.g., data ingestion, classification jobs, recurring tasks).
*   **Scheduling:** Celery Beat for scheduling recurring tasks.
*   **Object Storage:** MinIO (or compatible S3 service) for storing uploaded files (PDFs, CSVs).

## Architecture Principles

The backend adheres to the following architectural principles:

1.  **Service Layer Pattern:** Business logic is encapsulated within service classes (`app/api/services/`). API routes delegate operations to these services, keeping routes thin and focused on request/response handling.
2.  **Provider Pattern:** External integrations (object storage, classification models, web scraping) are abstracted behind provider interfaces (`app/api/services/providers/base.py`). Concrete implementations (`app/api/services/providers/*.py`) allow swapping external services without altering core business logic.
3.  **Dependency Injection:** FastAPI's dependency injection system (`app/api/deps.py`) is used to provide database sessions (`SessionDep`), authenticated users (`CurrentUser`), and service instances (via factory functions like `get_ingestion_service()`) to routes and other components.

## Directory Structure

```
backend/
├── alembic/              # Database migrations (if using Alembic)
├── app/                  # Main application code
│   ├── api/              # API specific code (V1, V2 entry points)
│   │   ├── deps.py       # FastAPI dependencies (DB session, auth)
│   │   ├── main.py       # API router assembly (includes routes from routes/)
│   │   ├── routes/       # API endpoint definitions (FastAPI routers)
│   │   │   ├── v1/         # Version 1 specific routes
│   │   │   └── v2/         # Version 2 specific routes
│   │   │   └── ...         # Shared/Unversioned routes
│   │   └── services/     # Business logic layer
│   │       ├── providers/  # External service integrations (Storage, LLM, etc.)
│   │       └── *.py        # Specific service implementations
│   ├── core/             # Core application components
│   │   ├── config.py     # Application settings (from environment)
│   │   ├── db.py         # Database session setup (SQLAlchemy/SQLModel engine)
│   │   ├── security.py   # Authentication helpers (password hashing, JWT)
│   │   ├── celery_app.py # Celery application instance setup
│   │   └── beat_utils.py # Celery Beat schedule management helpers
│   ├── models.py         # SQLModel data models (database tables, Pydantic validation)
│   ├── tasks/            # Celery background tasks & scheduling
│   ├── main.py           # FastAPI application creation and setup
│   ├── backend_pre_start.py # DB readiness check script
│   └── celeryworker_pre_start.py # DB readiness check for workers
├── tests/                # Application tests
├── .env                  # Environment variables (DB connection, secrets, etc.)
├── requirements.txt      # Python dependencies
└── README.md             # This file
```

## Key Components & Workflow

1.  **`app/main.py`**: Creates the FastAPI `app` instance, configures CORS, includes API routers from `app/api/main.py`.
2.  **`app/models.py`**: Defines all data structures using SQLModel, including database table definitions, relationships, and Pydantic models for API request/response validation.
3.  **`app/core/`**: Handles setup for database connection (`db.py`, `engine`), application settings (`config.py`), authentication (`security.py`), and the Celery app (`celery_app.py`, `beat_utils.py`).
4.  **`app/api/deps.py`**: Defines reusable FastAPI dependencies, primarily for getting a database session (`SessionDep`) and the currently authenticated user (`CurrentUser`).
5.  **`app/api/routes/`**: Contains subdirectories (`v1`, `v2`) and potentially shared route files. Each file defines endpoints related to specific resources (e.g., `workspaces.py`, `datasources.py`). Routes validate input using Pydantic models, use dependencies, and call **Service** methods or trigger background **Tasks**.
6.  **`app/api/services/`**: Contains the core business logic. Services abstract database interactions and external provider calls.
    *   `WorkspaceService`: Manages CRUD for Workspaces.
    *   `IngestionService`: Handles DataSources/DataRecords (uploads, scraping, etc.).
    *   `ClassificationService`: Manages Schemes, Jobs, Results, orchestrates classification.
    *   `ShareableService`: Manages ShareableLinks and coordinates import/export.
    *   `RecurringTaskService`: Manages RecurringTasks and schedules.
7.  **`app/api/services/providers/`**: Defines interfaces (`base.py`) and implementations for external services (Storage, Classification, Scraping, Search, Geospatial). Factory functions (`get_*_provider()`) enable easy swapping.
8.  **`app/tasks/`**: Contains Celery task definitions for background processing.
    *   `ingestion.py`: `process_datasource` task for ingestion work.
    *   `classification.py`: `process_classification_job` task for running classifications.
    *   `recurring_*.py`: Tasks for recurring ingestion/classification.
    *   `scheduling.py`: `check_recurring_tasks` task run by Celery Beat.
    *   `utils.py`: Shared utilities for tasks.

## High-Level Workflows

*   **User Uploads PDF:**
    *   API Request -> `routes/datasources.py` -> `IngestionService.create_datasource` -> `StorageProvider.upload_file`, Create `DataSource` -> Trigger `process_datasource` task.
    *   (Background) `tasks/ingestion.py:process_datasource` -> `StorageProvider.get_file` -> Extract text -> `IngestionService.create_records_batch` -> `IngestionService.update_datasource_status`.
*   **User Creates Classification Job:**
    *   API Request -> `routes/classification_jobs.py` -> `ClassificationService.create_job` -> Create `ClassificationJob` -> Trigger `process_classification_job` task.
    *   (Background) `tasks/classification.py:process_classification_job` -> Fetch data -> Loop: `ClassificationService.classify_text` (calls `ClassificationProvider`) -> `ClassificationService.create_results_batch` -> `ClassificationService.update_job_status`.
*   **Recurring Classification:**
    *   (Scheduled) Celery Beat -> `tasks/scheduling.py:check_recurring_tasks` -> Dispatch `process_recurring_classify`.
    *   (Background) `tasks/recurring_classification.py:process_recurring_classify` -> Fetch config -> `ClassificationService.create_job` -> Trigger `process_classification_job`.

## Key Features Overview

*   **Workspaces:** Isolate user data (DataSources, Schemes, Jobs).
*   **Data Ingestion:** Supports PDF, CSV, URL Lists, Text Blocks. Background processing via Celery.
*   **Classification:** Flexible classification using user-defined Schemes. Background processing via Celery.
*   **Sharing:** Generate shareable links for various resources (Workspaces, DataSources, Schemes, Jobs) with configurable permissions and expiry.
*   **Import/Export:** Export Workspaces, DataSources, Schemes, and Jobs to JSON files. Import them into workspaces.
*   **Recurring Tasks:** Schedule recurring ingestion (e.g., scraping URLs) or classification jobs.

## Setup & Running

1.  **Environment:** Configure database connection, MinIO credentials, Celery broker/backend URLs, secrets, etc., in a `.env` file (refer to `app/core/config.py`).
2.  **Dependencies:** `pip install -r requirements.txt` (or `poetry install`).
3.  **Database:** Ensure PostgreSQL is running. Run database migrations (e.g., `alembic upgrade head`).
4.  **Run API Server:** `uvicorn app.main:app --reload` (for development).
5.  **Run Celery Worker:** `celery -A app.core.celery_app worker --loglevel=info`
6.  **Run Celery Beat Scheduler:** `celery -A app.core.celery_app beat --loglevel=info`

(Note: Specific commands might vary based on deployment setup).
