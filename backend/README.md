# Backend

FastAPI + Celery + PostgreSQL. The backend orchestrates content ingestion, schema-based analysis, and background processing for research workflows.

## Quick Start

```bash
# From project root
docker compose up -d
```

Backend runs at http://localhost/api with interactive docs at http://localhost/docs

## Architecture Philosophy

The backend is organized around two core workflows: **content ingestion** and **schema-based analysis**. Everything else supports these patterns.

### Content Ingestion Flow

The system follows a consistent pattern regardless of input type:

**Route → Handler → AssetBuilder → Processor → Storage**

1. **Routes** receive raw input (file upload, URL, text, RSS feed)
2. **Handlers** adapt input into standardized format
3. **AssetBuilder** creates parent asset with metadata
4. **Processors** transform content and extract child assets
5. **Storage** persists files and database records

This separation means each layer has a single responsibility. Handlers know about input formats. Processors know about content extraction. Neither needs to know about the other.

**Key Pattern:** Handlers are thin adapters. Processors do heavy lifting. AssetBuilder coordinates both.

### Schema Analysis Flow

Schema execution follows a different orchestration pattern:

**AnnotationRun Creation → Celery Task → Batch Processing → Result Storage**

1. User creates AnnotationRun specifying schemas and target assets
2. `AnnotationService` queues Celery task
3. Task fetches assets, batches them, calls LLM providers
4. Results are demultiplexed and stored as Annotations
5. Frontend polls for completion and displays results

**Key Pattern:** Synchronous API calls queue work. Celery handles processing. Database tracks state.

## Core Architectural Patterns

### 1. Handler Pattern for Input Diversity

Each content type has its own handler sharing the same interface:

- **FileHandler**: Uploads to storage, detects type, queues processing
- **WebHandler**: Scrapes URL, extracts metadata, creates web asset
- **SearchHandler**: Processes search results, creates articles
- **RSSHandler**: Parses feed XML, creates article items
- **TextHandler**: Creates text asset directly from string

Handlers decide whether processing happens immediately (small files) or in background (large PDFs). This keeps routes simple—they just call the appropriate handler.

### 2. Processor Pattern for Content Transformation

Processors are registered by file extension or asset kind:

- **PDFProcessor**: Extracts text page-by-page → PDF_PAGE children
- **CSVProcessor**: Parses rows → CSV_ROW children with column data
- **ExcelProcessor**: Parses sheets and rows → hierarchical structure
- **WebProcessor**: Scrapes HTML, downloads images → IMAGE children

Processors receive `ProcessingContext` with storage access, scraping tools, and options. They return child assets. The context pattern means processors don't need to know about FastAPI, sessions, or authentication.

### 3. Provider Pattern for External Services

Everything external is abstracted behind provider interfaces:

- **StorageProvider**: MinIO, S3, Google Cloud Storage
- **ScrapingProvider**: newspaper4k or external scraping services
- **SearchProvider**: Tavily or other search APIs
- **LLMProvider**: OpenAI, Google, Anthropic, Ollama

Providers are created by factories that read settings. Adding support for a new service means implementing the interface and registering in the factory. Routes and services use dependency injection to get the right provider.

### 4. Service Layer for Business Logic

Services sit between routes and database, encapsulating workflows:

- **AssetService**: CRUD operations, deduplication logic
- **BundleService**: Manages collections of assets
- **AnnotationService**: Creates schemas, orchestrates runs, stores results
- **ConversationService**: Manages chat, executes tool calls
- **PipelineService**: Orchestrates multi-step workflows

Services accept database sessions and providers via dependency injection. This makes testing straightforward—mock providers, pass test session.

### 5. Celery for Asynchronous Processing

Any operation taking more than a few seconds goes through Celery:

- **process_content**: Extracts children from parent assets
- **process_annotation_run**: Applies schemas to assets in batch
- **process_source**: Polls RSS feeds or scheduled ingestion
- **embed_asset_task**: Generates vector embeddings

Tasks are defined in `app/api/tasks/` and registered with Celery. They create their own database session and provider instances. Pattern: lightweight task function delegates to service for actual work.

## Data Model Hierarchy

**Infospace** (workspace)  
└── **Assets** (content items)  
    ├── **Bundles** (collections)  
    └── **AnnotationSchemas** (analytical frameworks)  
        └── **AnnotationRuns** (analysis jobs)  
            └── **Annotations** (structured results)

Assets have `kind` field (PDF, CSV, WEB, ARTICLE, etc.) and can have parent-child relationships. PDF asset has PDF_PAGE children. CSV asset has CSV_ROW children.

Schemas define fields to extract. Runs apply schemas to assets. Annotations store extracted data.

## Development Workflow

### Local Development

`compose.override.yml` enables hot reload:

```bash
docker compose up --build
# Edit files in app/, changes appear immediately
```

### Database Migrations

After changing models in `app/models.py`:

```bash
docker compose exec backend bash
alembic revision --autogenerate -m "description"
alembic upgrade head
```

Migrations are in `app/alembic/versions/`. Review generated migrations before applying.

### Testing

No testing suite yet.

## Extending the System

### Adding a New Content Type

The pattern is consistent:

1. Create handler in `app/api/handlers/` if input format is new
2. Add processor in `app/api/processors/` if content needs extraction
3. Register processor by extension or asset kind in `registry.py`
4. Add route in `app/api/routes/` that uses the handler

System automatically handles storage, parent-child relationships, and background processing.

### Adding an LLM Provider

Implement provider interface in `app/api/providers/impl/`:

- `generate_text()` for streaming completions
- `generate_structured()` for JSON outputs
- Register in factory

Annotation system will automatically support new provider.

### Adding a Chat Tool

Tools are defined in `ConversationService`. Each tool:

1. Has JSON schema describing parameters
2. Implements async handler function
3. Returns structured data for LLM

System handles tool call detection, execution, and result formatting.

## Key Directories

- `app/api/handlers/` - Input adapters for different content types
- `app/api/processors/` - Content extraction and transformation
- `app/api/providers/` - External service abstractions
- `app/api/routes/` - FastAPI endpoints
- `app/api/services/` - Business logic layer
- `app/api/tasks/` - Celery background jobs
- `app/models.py` - SQLModel database schema
- `app/schemas.py` - Pydantic API contracts
- `app/core/` - Configuration and app initialization

## Configuration

Key environment variables in `.env`:

**Database:** PostgreSQL connection details  
**Storage:** MinIO or S3 credentials  
**Celery:** Redis URL for job queue  
**Providers:** API keys for LLMs, search, etc.

Users can override provider keys in web interface. System-level keys in `.env` are fallbacks.

## Production Deployment

The system runs either fully local or with managed services:

**Fully Local:** All services in Docker Compose  
**Hybrid:** App in Docker, managed PostgreSQL/Redis/S3  
**Kubernetes:** Helm chart in `.deployments/kubernetes/`

For production:
- Remove `compose.override.yml` (dev-only hot reload)
- Set proper secrets (not example values)
- Configure backup strategy for PostgreSQL
- Set up monitoring for Celery workers

## Understanding the Codebase

Start by reading these in order:

1. `app/api/handlers/README.md` - Input processing patterns
2. `app/api/processors/README.md` - Content extraction patterns
3. `app/api/services/asset_builder.py` - Asset creation workflow
4. `app/api/services/annotation_service.py` - Schema execution workflow
5. `app/api/routes/assets.py` - How routes tie it together

Pattern repeats throughout: thin routing layer, handlers for adaptation, services for logic, providers for external systems.

## Resources

- **Interactive API docs:** http://localhost/docs (when running)
- **Internal documentation:** `app/api/DOCUMENTATION_INDEX.md`
- **Forum:** https://forum.open-politics.org
- **Dev meetings:** Wednesdays 15:30 Berlin Time
