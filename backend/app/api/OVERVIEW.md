# Backend API Overview

This is the authoritative reference for the backend architecture — the concrete implementation detail.

For the philosophy behind these decisions, see [FOUNDATION.md](../../docs/FOUNDATION.md). For code conventions, see [PRACTICE.md](../../docs/PRACTICE.md). For feature status and outstanding work, see [FEATURE_STATUS.md](../../docs/internal/FEATURE_STATUS.md).

---

## Mission Context

Open Politics is infrastructure for people who work with data in the public interest. The system provides composable primitives — not features — that compose into whatever workflow the task demands.

The backend expresses this through five categories of primitives:

- **Handlers** adapt external sources into Assets (7 handlers, each <100 lines)
- **Processors** transform content into structured children (4 processors)
- **Enrichers** discover properties reactively (OCR, geocoding, hashing, embedding)
- **Annotation schemas** define user-specified structured extraction (LLM-driven)
- **Flows** compose primitives into automated pipelines (reentrant state machine)

Every operation in the system is a composition of these primitives. "Monitor Reuters for climate articles, extract entities, build a knowledge graph" is not a feature — it is: Source (RSS) + Flow (ANNOTATE + CURATE + ANALYZE) + Schema (entities) + Adapter (graph). Each piece works independently and composes with others.

**The acid test:** The VPS deployment with 400GB+ of drifting PDFs (redactions and un-redactions) should require zero custom code — only configuration of existing primitives: DirectoryImportHandler for import, InboxPollHandler for drift detection, reconcile for change detection, @enricher tasks for OCR/embedding/hashing, annotation runs for extraction, entity resolution for the knowledge graph.

---

## Directory Structure

```
app/
  core/                         # Infrastructure (Layer 0)
    config.py                   # AppSettings
    security.py                 # Auth, JWT, credential encryption
    db.py                       # Engine, connection pool (minimal)
    seed.py                     # init_db() — superuser, infospace, schemas, adapters, initial assets
    celery_app.py               # Celery config, 5 queues, beat schedule, task routing
    redis_lock.py               # Advisory locks for concurrent execution safety
    tasks.py                    # @task decorator, TaskDescriptor, TaskContext, task registry, cached_resolve
    dispatch.py                 # Dispatcher: dispatch_tasks beat task, kick_tasks on-demand, per-task scheduling
    events.py                   # Celery-based event bus for lifecycle transitions (subscriber registry + send_task dispatch)
    redis.py                    # Shared Redis client (connection pool)
    task_utils.py               # run_async_in_celery, pydantic model from JSON schema

  api/
    modules/                    # Domain modules
      content/                  # Content lifecycle (Layer 2)
        models.py               # Asset, AssetChunk, Bundle, Source, SourcePollHistory,
                                # EmbeddingModel, Dataset, IngestionJob
        handlers/               # 7 handlers: File, Web, RSS, Search, Text, Archive, DirectoryImport
                                # + registry.py (can_handle predicates, priority-based resolution)
                                # + base.py (BaseHandler, IngestionContext)
        processors/             # 4 processors: PDF, CSV, Excel, Web
                                # + base.py (BaseProcessor, ProcessingContext)
                                # + strategy.py (immediate vs background decision)
                                # + csv_materializer.py (rows → file, on ContentTypeDescriptor)
        services/
          asset_service.py      # Asset CRUD, deduplication, batch create, transfer
          asset_builder.py      # Fluent builder: from_url(), from_search_result(), from_rss_entry(), etc.
          bundle_service.py     # Bundle CRUD, hierarchy, vfolder materialization
          source_service.py     # Source CRUD, stream activate/pause, inbox management, execute_poll (PollHandler registry)
          processing_service.py # Phase 1 (metadata) → Phase 2 (content extraction) pipeline
          dataset_service.py    # Dataset management
          poll_handlers/        # PollHandler protocol + registry
            __init__.py         # @register_poll_handler decorator, PollResult dataclass
            rss_poll_handler.py
            search_poll_handler.py
            inbox_poll_handler.py
        ingest.py               # ingest() — single entry point for all ingestion (69 lines)
        tasks/
          processing.py         # @task: process_pending, reset_stale, clean_orphans, retry_failed
          ingestion.py          # Triggered: reprocess, bulk ingest, archive, directory import
          ingest.py             # process_source (source-based ingestion)
          source_monitoring.py  # poll_active_sources, execute_source_poll
        types.py                # ContentTypeRegistry — THE canonical registry for content types
        enrichers.py            # @enricher decorator + EnrichmentContext + 6 enricher functions
                                # (ocr, geocoding, hash, language_detection, quality_score, embedding)
        facets.py               # Well-known facet keys, get/set helpers, annotation→facet mapping
        detection.py            # MIME-based kind reclassification (Phase 1)
        query.py                # AssetQuery composable builder (FTS, facets, semantic, annotation values)

      annotation/               # Annotation lifecycle (Layer 3)
        models.py               # AnnotationSchema, AnnotationRun, Annotation,
                                # Justification, RunSchemaLink, RunAggregate
        services/               # AnnotationService (CRUD, run creation, curation, aggregates)
        tasks/
          annotate.py           # LLM annotation pipeline (self-chaining, parallel/sequential,
                                # multimodal context, hierarchical schemas, demultiplexing)
                                # + retry_failed_annotations
          followup.py           # @task: version_gap_annotation (follow-up runs for versioned assets)

      graph/                    # Knowledge graph (Layer 4)
        models.py               # KnowledgeGraph, EntityCanonical, EntityEditLog, GraphEdge, FragmentCuration
        services/               # GraphService (neighborhood traversal via GraphEdge)
        resolution.py           # Entity resolution: find_by_alias (SQL), find_by_embedding (pgvector)
        tasks/
          curation.py           # @task: annotated_to_curate (entity triplet extraction + resolution)
          maintenance.py        # @task: superseded_entity_retire, re_resolve_singletons

      flow/                     # Automation & orchestration (Layer 4)
        models.py               # Flow, FlowExecution, Task + enums
        services/
          flow_service.py       # Reentrant state machine executor (7 step types)
          filter_service.py     # FilterRule/FilterExpression + SQL pushdown via AssetQuery
        tasks/
          flow_tasks.py         # execute_flow (Redis-locked), resume_flow_execution,
                                # trigger_flows_for_source_poll, check_on_arrival_flows
          schedule.py           # check_recurring_tasks (cron-based Task dispatch)

      embedding/                # Shared embedding infrastructure (Layer 2.5)
        services/               # EmbeddingService, ChunkingService, VectorSearchService

      search/                   # Internal asset search (Layer 3)
        services/               # SearchService: text (FTS/ILIKE), semantic (pgvector), tree multi-phase
                                # Searches EXISTING assets. NOT external web search.

      conversational_intelligence/  # AI interaction (Layer 5)
        services/               # IntelligenceConversationService
        mcp_server/             # MCP server, client, auth

      sharing/                  # Export, backup (Layer 6)
        services/               # ShareableService, PackageService, BackupService, UserBackupService
        tasks/                  # backup, user_backup

      identity_infospace_user/  # Users & workspaces (Layer 1)
        services/               # InfospaceService

      analysis/                 # Pluggable adapters (Layer 4)
      foundation_service_providers/  # Foundation services (Layer 0)
        base.py                 # 7 provider protocols + ModelSpec types + ProviderSelection/ProviderDefaults
                                # + EnrichmentConfig (uses ProviderSelection per enricher)
        registry.py             # Framework: Setting, Capability, @provider, ProviderDescriptor,
                                # registry core, CAPABILITIES, select_provider(), capability_name()
        providers.py            # All 15 provider declarations + convenience getters
        implemented/            # Concrete providers (storage_local, web_search_tavily, etc.)

    routes/                     # HTTP surface (33 route files)
    dependency_injection.py     # FastAPI DI wiring (provider deps, service deps, ingestion context factory)
    content_tree_builder.py     # Tree building (pure presentation logic)
    asset_context_builder.py   # build_asset_context() — model-introspected evaluation context for flow FILTER/ROUTE steps

  models.py                     # RE-EXPORT HUB: from all domain models
  schemas.py                    # RE-EXPORT HUB: from all domain schemas
  main.py                       # App lifecycle
```

---

## Dependency Rules

Strict, one-directional. A domain may only import from domains **above** it:

```
LAYER 0 (infrastructure):  core, foundation_service_providers
LAYER 1 (foundational):    identity_infospace_user
LAYER 2 (content core):    content
LAYER 2.5 (embedding):     embedding
LAYER 3 (enrichment):      annotation, search
LAYER 4 (composition):     graph, flow, analysis
LAYER 5 (interaction):     conversational_intelligence
LAYER 6 (cross-cutting):   sharing
OUTSIDE:                    routes, dependency_injection
```

**Rule:** A domain never imports from a domain at its own layer or below.

**Exception 1:** Cross-domain foreign keys use string references (`"user.id"`, `"asset.id"`).

**Exception 2:** Cross-domain dispatch uses event bus or @task `.delay()`, not raw Celery imports. A @task declares `name="enrich_geocoding"`; the dispatcher calls `celery.send_task(task_name, args=[ids, infospace_id])`. A content service triggers flow evaluation by emitting `source.polled` events, which the `trigger_source_poll_flows` @task subscribes to.

---

## System Taxonomy

The system separates along five dimensions. Every piece of code belongs to exactly one. Confusing them (e.g., putting a primitive's logic in a service, using route DI in a task, hardcoding what a registry should provide) is how zombie architecture accumulates.

For the conceptual overview, see [FOUNDATION.md § System Taxonomy](../../docs/FOUNDATION.md). This section provides the concrete, code-level details.

### Dimension 1: Primitives

A primitive has a contract and a registration point. These are the building blocks:

| Primitive | Contract | Registration | Example |
|---|---|---|---|
| Content Type Descriptor | kind → extensions, processor, modalities, materializer | `ContentTypeRegistry._register()` | `ContentTypeDescriptor(kind=AssetKind.PDF, processor_class=PDFProcessor, ...)` |
| Handler | locator → assets | `handlers/registry.py` can_handle predicates | `WebHandler(context).handle(url)` → `[Asset]` |
| Processor | parent asset → child assets | `descriptor.processor_class` | `PDFProcessor(context).process(asset)` → `[PDF_PAGE, ...]` |
| Enricher | declares what property to discover | `@enricher` decorator in `enrichers.py` | `@enricher("ocr", check=lambda q: q.where(...), capability="ocr")` |
| PollHandler | source kind → PollResult | `@register_poll_handler("kind")` | `RSSPollHandler.poll(source, context)` → `PollResult(assets, cursor)` |
| Annotation Schema | extraction contract | DB record, user-created | `{"fields": [{"name": "entities", "type": "array"}], ...}` |
| Analysis Adapter | annotation results → insights | DB `module_path`, dynamic import | `GraphAggregatorAdapter.execute()` → unified graph |
| Provider | external service wrapper | `@provider` decorator in `providers.py` + `get_*_provider()` convenience getters | `StorageProvider.download(path)`, `WebSearchProvider.search(query)` |

### Dimension 2: Registries

One registration, everything derives. Never branch on kind/type with if/elif — look up from registry.

| Registry | Key → Value | Consumers |
|---|---|---|
| ContentTypeRegistry | `kind → ContentTypeDescriptor` | ProcessingService (processor routing), detection.py (extension→kind), handlers (importability), tree builder (preview), ProcessingService (materializer) |
| PollHandler | `source_kind → PollHandler class` | `SourceService.execute_poll()` dispatches generically |
| @task registry | `name → TaskDescriptor` | Beat dispatcher, kick_tasks, event subscribers |
| AnalysisAdapter | `DB record → module_path` | Flow ANALYZE step, `/analysis/adapters/execute` route |
| Provider registry | `(protocol, type_key) → ProviderDescriptor` | `registry.py`: framework (`ProviderDescriptor`, `@provider` decorator, `_build_config`). `providers.py`: 15 `@provider` class declarations. Descriptor fields: `impl`, `api_key_setting`, `base_url_setting`, `contexts`, `models` (`List[ModelSpec]`). Properties: `requires_api_key`, `is_local`, `get_model()`. |

### Dimension 3: Composables

Composables combine primitives into operations. If you need to create assets, query assets, or build context — use a composable, don't write new logic.

**`ingest(context, locator, bundle_id=...)`** — Single entry point for all asset creation. Calls `resolve_handler()` to find the right handler for the locator type, calls the handler, assigns assets to a bundle via `bundle_service.add_assets_to_bundle()`. 68 lines. If a route creates assets, it should go through `ingest()` or compose Handler + `bundle_service` directly (legitimate when `resolve_handler()` doesn't accept the locator type, e.g., `SearchResult`).

**`AssetQuery`** — Composable builder for all asset access. Every service, route, or task that queries assets should use this instead of raw SQL:
```
AssetQuery(session, infospace_id)
    .text("climate policy")       # FTS + ILIKE
    .kinds([AssetKind.ARTICLE])   # Kind filter
    .bundle(bundle_id)            # Bundle membership
    .facets({"language": "en"})   # JSONB facet filter
    .annotation_value(schema_id, "sentiment", ">", 0.5)  # SQL pushdown
    .exclude_superseded()         # Version filtering
    .paginate(cursor, limit)      # Cursor pagination
    .execute()
```
Consumers: SearchService, FilterService (flow FILTER step), routes, any service needing asset access.

Package scope is applied via `.scope(package_scope)` — a single method that adds the full visibility predicate (bundle GIN overlap, direct asset PK lookup, run-derived semi-join). No-op when scope is None. Every consumer of AssetQuery gets scope filtering for free.

**`AssetBuilder`** — Fluent builder for asset creation. Handlers use this to create assets from various sources:
```
builder = AssetBuilder(context)
    .from_url(url, scrape=True)   # or .from_rss_entry(entry) or .from_search_result(result)
    .with_title(title)
    .with_bundle(bundle_id)
assets = await builder.build()
```
Consumers: all 7 handlers.

**`build_asset_context(asset, session)`** — Asset evaluation context for flow FILTER/ROUTE steps. Lives in `api/asset_context_builder.py`. Layer 1 (scalar columns) is model-introspected. Layers 2-4 (metadata flattening, derived fields, fragments, annotations) use known key lists. Consumers: FlowService (FILTER, ROUTE steps).

**`resolve_handler(locator, context)`** — Locator type → handler class + method. Maps file uploads to FileHandler, URLs to WebHandler, text to TextHandler, etc. Consumer: `ingest()`.

**`ContentTypeRegistry.by_kind(kind)`** — Kind → descriptor. All kind-specific behavior derives from this single lookup: processor routing, materializer, metadata extractors, modalities, importability. Consumers: ProcessingService, detection.py, handlers, tree builder.

### Dimension 4: Execution Contexts and DI

Each execution context has its own DI pattern. Using the wrong pattern is a bug.

**Access Control** — Every infospace-scoped route resolves a frozen `Access` context via `Requires(Capability.X)`. The context carries `infospace_id`, `user_id`, `capabilities`, and `scope` (None for full access, `PackageScope` for package consumers).

Resolution priority (first match wins): owner → collaborator → package token → internal visibility → public visibility → 404.

| Role | Capabilities |
|---|---|
| Owner | all |
| Analyst | organize, ingest, compute, delete |
| Curator | organize |
| Viewer | (none) |

Two scope enforcement primitives on the `Access` context:
- **`access.scope_filter(stmt, column, scope_field)`** — applies `column.in_(scope_ids)` to a SELECT. No-op when scope is None. Returns `WHERE FALSE` when scope is set but ID set is empty. Used for list endpoints on non-asset entities (runs, schemas, graphs, entities).
- **`access.require_in_scope(scope_field, entity_id)`** — point check for single-entity endpoints. Raises 404 when entity is outside scope. No-op when scope is None.

For assets, `AssetQuery.scope()` provides the full visibility predicate (three-branch OR: GIN bundle overlap, PK asset lookup, run-derived semi-join).

| Operation | Required capability |
|---|---|
| View/list | (none — viewer access) |
| Create bundles, schemas, entities, annotations, graphs, packages | organize |
| Create sources, upload assets, import | ingest |
| Run annotations, flows, enrichments | compute |
| Delete assets, bundles, remove from bundles | delete |
| Infospace settings, collaborators, enrichment config | setup |

**Routes** — HTTP entry points. Thin dispatchers: validate input, call composable or service, return response.
- DI: `IngestionContextFactoryDep` for ingestion, FastAPI `Depends()` for services/providers
- Access control: `access: Access = Requires(Capability.X)` for path-parameter routes. Routes with `infospace_id` in the request body use `resolve_access()` directly.
- Pattern: `make_ingestion_context(user_id, infospace_id, options)` → `IngestionContext`
- One route file per resource (`assets.py`, `bundles.py`, `sources.py`). Routes outside the domain layer hierarchy — they compose primitives from any domain.
- Anti-pattern: manually constructing `IngestionContext` with 10 fields. Use `IngestionContextFactoryDep`.

**Services** — Domain logic within one domain boundary.
- DI: constructor injection (`__init__(self, session, storage_provider=None, ...)`)
- Pattern: services own business rules. They call registries and composables. They never cross domain boundaries via Python import.
- Anti-pattern: services that just wrap a primitive call without adding value ("call provider, call handler, assign bundle" — that's route-level composition, not a service).

**Celery Tasks** — All async work uses `@task` (`core/tasks.py`). `@enricher` (`content/enrichers.py`) is a specialization that wraps `@task`.
- `@task` provides: TaskContext (sessions, providers, stats, failure tracking), event subscriptions, self-chaining, dispatch integration, Redis per-item failure circuit breakers.
- **Two invocation modes.** Both are first-class:
  - **Self-query** (`batch_ids=None`): triggered by events, kicks, or schedule. The wrapper runs the `check` query to find work. Used for reactive processing and backfill sweeps.
  - **Direct** (`batch_ids=[1, 2, ...]`): caller passes explicit entity IDs. Used for user-initiated actions (retry a run, force-process specific items). The check query still exists for schedule/event recovery.
- Anti-pattern: raw `@celery.task` for new work. If it runs in the background, it should be `@task`.
- Anti-pattern: manually creating Session + services + providers inside a @task. Use `TaskContext.session()` and `ctx.provider()`.
- **Exception:** Cross-domain bridge tasks that don't operate per-infospace (e.g., `trigger_flows_for_source_poll` takes `(source_id, asset_ids)` — no infospace_id). These stay as plain celery. They should be rare.

**Beat Schedule** — Periodic dispatch. Never does work itself.
- `dispatch_tasks` (configurable interval) iterates @task registry × infospaces, dispatches due work. Each @task declares its own `schedule` (poll interval).
- All beat-dispatched tasks are idempotent downstream (atomic claims, locks, precondition checks).
- **Per-task dispatch budget:** `MAX_DISPATCH_PER_CYCLE=2000` global, `MAX_PER_TASK_PER_CYCLE=500` per task. Prevents one task from starving others at scale.

**Three dispatch mechanisms** for getting work to @task functions:

| Mechanism | When | Purpose |
|---|---|---|
| **Events** | Immediate, specific | Fast path. `asset.ingested` → process. `asset.processed` → enrich. Triggers self-query mode. |
| **Kick** | Immediate, broad | On-demand fan-out. After bulk import, admin debugging. `kick_tasks(iid, tags={"content"})` |
| **Schedule** | Periodic, per-task | Safety net. Catches lost events, broken chains. Each @task declares its own `schedule: int | None`. |
| **Direct** | Explicit, caller-driven | Caller invokes `fn.delay([entity_ids], infospace_id)`. Used for user-initiated actions. |

**The @task decorator** turns a function into a managed reactive Celery task.
- Pattern: decorate with `@task(name, check=lambda iid: select(...), schedule=60, triggers=["asset.processed"])`.
- The `check` callable returns a SELECT query for entity IDs needing work. Used in self-query mode AND by the scheduler.
- The decorator handles: Celery task registration, dispatch integration, Redis failure tracking, per-item stats, event subscriptions, self-chaining.
- Per-task `schedule` controls poll frequency. `schedule=None` means event/kick/direct only.
- `.delay` and `.apply_async` are attached to the decorated function for direct invocation.
- `@enricher` wraps `@task` with enrichment defaults: `EnrichmentContext`, dispatch filter, `schedule=60`.

### Dimension 5: Domains

Domains own their models, services, tasks, and reactions. Each domain is a bounded context.

| Domain | Layer | Owns | Key Primitives |
|---|---|---|---|
| Foundation Providers | L0 | 7 protocols, implementations, registry resolve() | StorageProvider, WebSearchProvider, OcrProvider, etc. Resolved via `resolve()`. |
| Core Infrastructure | L0 | DB, Celery, dispatch, events, @task | `@task`, `kick_tasks()`, `emit()`, `cached_resolve()` |
| Identity / Infospace | L1 | User, Infospace, access control | `Requires()`, `resolve_access()`, `Access`, `PackageScope` |
| Content | L2 | Asset, Bundle, Source, handlers, processors, enrichers | ContentTypeRegistry, `ingest()`, AssetQuery, AssetBuilder. Bundle deletion: `_expand_bundle_descendants()` (recursive CTE) collects subtree, `_analyze_deletion()` splits assets into exclusive (delete) vs shared (unlink). Preview via `POST /tree/delete-preview`. `BundleService.get_descendant_ids()` for service-level cascade. |
| Embedding | L2.5 | AssetChunk, HNSW indexes | EmbeddingService, ChunkingService, VectorSearchService |
| Annotation | L3 | AnnotationSchema, AnnotationRun, Annotation | LLM pipeline (`annotate.py`), version_gap @task |
| Search | L3 | SearchHistory | SearchService (FTS, semantic, tree multi-phase) |
| Graph | L4 | EntityCanonical, FragmentCuration, KnowledgeGraph | `resolve_entities_batch()`, GraphService |
| Flow | L4 | Flow, FlowExecution, Task | FlowService (reentrant state machine, 7 step types) |
| Analysis | L4 | AnalysisAdapter | DB-registered adapters, dynamic import |
| Conversational Intelligence | L5 | ChatConversation | MCP server, conversation service |
| Sharing | L6 | Package, PackageItem, ShareableLink, InfospaceBackup | PackageService, BackupService. PackageItem uses typed FK columns (bundle_id, run_id, etc.) with CHECK constraint. |

### Mechanisms: How Dimensions Interact

Mechanisms are recurring patterns that combine primitives, registries, composables, execution contexts, and domains into coherent operations. These are the patterns a developer should recognize and follow.

**Ingestion (content domain, route context):**
```
Route receives locator (URL, file, text)
  → IngestionContextFactoryDep provides DI (route execution context)
    → ingest() calls resolve_handler() (composable)
      → resolve_handler() dispatches to Handler (primitive, via dispatch table)
        → Handler uses AssetBuilder (composable) to create assets
          → ingest() calls bundle_service.add_assets_to_bundle() (service)
            → process_content dispatched via Celery (task execution context)
```

**Reactive Enrichment (cross-domain, event + schedule):**
```
@enricher("ocr", check=..., triggers=["asset.processed"], schedule=60)
  → Event path: asset.processed emitted → ocr task fires (immediate)
  → Schedule path: dispatcher polls every 60s, finds un-enriched assets (safety net)
    → @task wrapper: self-query, filter failed, build EnrichmentContext
      → Enricher function: load assets → external API → write facets
```

**Knowledge Promotion (annotation → graph, @task):**
```
Annotation run completes (annotation domain)
  → annotated_to_curate @task (schedule=120) finds annotations needing curation
    → Extracts triplets from annotation JSONB values
      → resolve_entities_batch() matches to EntityCanonical (pgvector SQL per entity)
        → Creates FragmentCuration (FK columns) + GraphEdge records
          → GraphService.get_entity_neighborhood() traverses via GraphEdge (O(1) indexed lookup)
```

**Flow Execution (composition of everything):**
```
Flow triggered (source poll or schedule)
  → execute_flow task (Redis-locked, task context)
    → INGEST step: calls source poll → PollHandler (registry dispatch)
    → ANNOTATE step: dispatches annotation run via Celery, checkpoints, resumes on completion
    → FILTER step: uses AssetQuery.annotation_value() for SQL pushdown (composable)
    → CURATE step: promotes to fragments or triggers entity resolution (knowledge promotion)
    → ROUTE step: uses build_asset_context() (composable) for condition evaluation
    → EMBED step: dispatches @enricher("embedding") via send_task
    → ANALYZE step: loads adapter by DB module_path (registry), calls execute()
```

**Route-level Primitive Composition (preview, search+ingest):**
```
RSS feed preview: route calls RSSHandler.preview_rss_feed() (@staticmethod — no ingestion context)
Web search preview: route calls WebSearchProvider.search() (provider, Layer 0) with create_assets=False
Search + ingest: route calls WebSearchProvider.search() → SearchHandler.handle_bulk() → bundle_service
Directory browse: route calls storage provider (Layer 0)
```
Preview is a read-only query against external sources. It lives at the route level because routes talk to the outside world. Preview does not need a primitive — it's not an extension point.

---

## Primitive Inventory

### Registries (one registration, everything follows)

| Registry | File | Mechanism | What derives |
|---|---|---|---|
| ContentTypeRegistry | `content/types.py` | `ContentTypeDescriptor` dataclass | Extension→kind, processor routing, modality, importability, preview builders, materializer |
| PollHandler registry | `content/services/poll_handlers/__init__.py` | `@register_poll_handler("kind")` decorator | Source polling dispatch in StreamSourceService |
| @task registry | `core/tasks.py` | `@task` decorator at import time | Beat dispatcher finds work and dispatches tasks |
| @enricher registry | `content/enrichers.py` | `@enricher` decorator (wraps `@task`) | Enrichment dispatch, provider gating, ENABLED_ENRICHERS filter |
| AnalysisAdapter registry | DB table `AnalysisAdapter` | `module_path` for dynamic import | Flow ANALYZE step, `/analysis/adapters/execute` route |

### Handlers (how data enters)

| Handler | Input | Lines | Creates |
|---|---|---|---|
| FileHandler | UploadFile | 169 | Asset with blob_path, triggers processing |
| WebHandler | URL string | 91 | WEB asset via AssetBuilder.from_url() |
| SearchHandler | SearchResult | 99 | ARTICLE asset via AssetBuilder.from_search_result() |
| RSSHandler | Feed URL | 372 | ARTICLE children via AssetBuilder.from_rss_entry() |
| TextHandler | Text string | 61 | TEXT asset via AssetBuilder.from_text() |
| ArchiveHandler | Archive URL | 339 | Downloads, extracts, delegates to DirectoryImportHandler |
| DirectoryImportHandler | Local path | 617 | Assets with logical_path, reconcile mode for drift. Chunks commits every 500 assets; cursor-based resume via IngestionJob.cursor_state |

### Processors (how content gets structured)

| Processor | Input Kind | Lines | Produces |
|---|---|---|---|
| PDFProcessor | PDF | 253 | PDF_PAGE children with text + discovered_modalities |
| CSVProcessor | CSV | ~300 | CSV_ROW children with structured data |
| ExcelProcessor | CSV (xlsx/xls) | ~150 | CSV_ROW children via extension override |
| WebProcessor | WEB | ~200 | Scraped text + IMAGE children |

### @task Registry (all background work)

All background work uses the `@task` decorator (`core/tasks.py`). Content enrichers use the `@enricher` specialization (`content/enrichers.py`). Graph tasks live in `graph/tasks/`, annotation tasks in `annotation/tasks/`, flow tasks in `flow/tasks/`, backup tasks in `sharing/tasks/`.

Four dispatch paths (see § Celery Tasks above for details):
- **Events** (`core/events.py`): Immediate. `asset.ingested` → `process_pending`. `asset.processed` → enrichers. Fast path.
- **Kick** (`core/dispatch.py:kick_tasks`): On-demand fan-out. After bulk import, admin re-sweep. Bypasses schedule.
- **Schedule** (`core/dispatch.py`): Per-task poll frequency. Safety net for lost events, new infospaces, recovery.
- **Direct** (`fn.delay([ids], iid)`): Caller-initiated. Retry a specific run, force-process specific items.

The beat dispatcher iterates `@task` registry × infospaces in topological order. Each task declares its own `schedule` (poll interval), `queue`, `batch` size, `depends_on`, and `dispatch_filter`.

| Task | Domain | Queue | Depends On | Capability |
|---|---|---|---|---|
| ocr | content (enricher) | external_api | — | ocr |
| hash | content (enricher) | processing | — | storage |
| geocoding | content (enricher) | external_api | — | geocoding |
| language_detection | content (enricher) | processing | — | — |
| quality_score | content (enricher) | processing | — | — |
| embedding | content (enricher) | embedding | ocr | — |
| version_gap_annotation | annotation | default | — | — |
| annotated_to_curate | annotation | default | — | — |
| superseded_entity_retire | graph | default | — | — |
| re_resolve_singletons | graph | default | — | — |

### Flow Step Types

| Step | Behavior | Async? |
|---|---|---|
| INGEST | Trigger source poll, collect new asset IDs | Sync (waits) |
| ANNOTATE | Dispatch annotation run, checkpoint, resume on completion | Async |
| FILTER | SQL pushdown via AssetQuery; fallback to in-memory evaluation | Sync |
| CURATE | Promote to fragments or trigger entity resolution into graph | Sync |
| ROUTE | Assign assets to bundles; condition evaluation + else branch | Sync |
| EMBED | Generate embeddings for all assets in set | Sync |
| ANALYZE | Execute DB-registered analysis adapter | Sync |

---

## Two "Search" Domains

| Concern | Module | Layer | What it does |
|---|---|---|---|
| Internal asset search | `search/services/search_service.py` | 3 | FTS, ILIKE, pgvector over existing assets via AssetQuery |
| External web search | `foundation_service_providers/base.py` | 0 | WebSearchProvider protocol wrapping Tavily, etc. |

The `search.py` route composes WebSearchProvider (Layer 0) + SearchHandler (content handler) to search the web and ingest results. This is route-level primitive composition. SearchService is for "find things we already have." WebSearchProvider is for "go find things on the internet."

---

## Asset Metadata: facets and file_info

The legacy `Asset.source_metadata` (JSONB) has been replaced by two columns.

| Column | Python attribute | Purpose | Written by | Read by |
|--------|------------------|---------|-----------|---------|
| `metadata` | `facets` | Enrichment-discovered properties (language, location, ocr_used, ocr_failed, quality_score) | Enrichment tasks | AssetQuery.facets(), @task check queries, build_asset_context |
| `file_info` | `file_info` | Intrinsic/processing properties (size, mime_type, page_count, columns, original_row_data) | Handlers, processors | build_asset_context, tree builder |

**Both optional.** Per-asset ownership — we do not copy parent file_info to children. Parent PDF has `page_count`; child PDF_PAGE has `page_number`, `char_count`. Parent CSV has `columns`; child CSV_ROW has `original_row_data`.

**facets.py:** `get_facet()`, `set_facet()`, `build_facet_filter()` — flat dict, no nesting. `AssetQuery.facets()` uses `metadata @> :facets::jsonb`. `FACET_OCR_FAILED` set on OCR failure to stop re-dispatch. `merge_facets()` bypasses ORM; call `expire_asset_facets()` after if you also write to the same asset via ORM.

---

## Worker Scaling & Concurrency Safety

The system is designed to run multiple worker replicas safely. Here is how conflicts are prevented:

### Task-Level Safety

| Mechanism | Where | What it prevents |
|---|---|---|
| Atomic claim | `content/tasks/processing.py:process_pending` | Double-processing: `UPDATE asset SET status=PROCESSING WHERE status=PENDING` (rowcount=0 → skip) |
| Redis advisory lock | `core/redis_lock.py` + `flow_tasks.py:execute_flow` | Concurrent execution of the same Flow |
| `task_acks_late=True` | `celery_app.py` | Re-queues task if worker dies before ack (OOM, kill) |
| `task_reject_on_worker_lost=True` | `celery_app.py` | Rejects task back to queue on worker crash |
| Stale processing reset | `content/tasks/processing.py:reset_stale` (@task, schedule=3600) | Resets PROCESSING assets stuck longer than `task_time_limit` |
| `visibility_timeout=3600` | `celery_app.py` | Redis re-delivers unacked messages after 1 hour |

### Beat Safety

Celery Beat **must run as a single instance** — it is the scheduler, not a worker. Workers can be replicated freely. Beat schedules (reactive dispatch, source polling, on_arrival flow checks) are idempotent: running them twice produces duplicate task dispatches, but downstream tasks are safe due to atomic claims and locks.

**For production:** Use `celery beat --pidfile=` to prevent duplicate beat processes, or use a distributed beat backend like `django-celery-beat` or `redbeat` if running in multi-node.

### Dispatch Safety

`dispatch_tasks` (Beat task) iterates @task registry × infospaces, respecting each task's `schedule` interval. If the same asset appears in two consecutive dispatch cycles (because the task hasn't completed yet), it may be dispatched twice. This is safe because:

- @task functions filter out already-failed items (`filter_failed_items`)
- Processing tasks use atomic claims (`UPDATE WHERE status=PENDING`)
- Enrichment tasks check preconditions (e.g., `content_hash` is still NULL)
- Embedding tasks check for existing AssetChunk records
- `kick_tasks` bypasses schedule but uses the same check→dispatch logic

### Scaling Workers

```yaml
# compose.yml — scale workers independently
celery_worker:
  command: ["celery", "-A", "app.core.celery_app.celery", "worker",
            "--loglevel=info", "-P", "prefork", "--concurrency=4"]
  deploy:
    replicas: 3  # Safe: all tasks are idempotent or use locks

# Queue-specific workers for resource isolation
celery_worker_llm:
  command: ["celery", "-A", "app.core.celery_app.celery", "worker",
            "--loglevel=info", "-Q", "llm", "--concurrency=2"]

celery_worker_processing:
  command: ["celery", "-A", "app.core.celery_app.celery", "worker",
            "--loglevel=info", "-Q", "processing", "--concurrency=4"]
```

Workers listening on the same queue will round-robin tasks automatically. No coordination needed.

---

## Development Guardrails

### Before writing code, check these rules:

**1. Is it a new content type?**
→ Add ONE `ContentTypeDescriptor` to `content/types.py`. Extensions, processor, modalities, importability all derive from that. Do NOT add scattered if-else checks.

**2. Is it a new source kind (RSS, API, filesystem watcher)?**
→ Write a `PollHandler` class, decorate with `@register_poll_handler("kind_name")`. SourceService.execute_poll() will dispatch to it automatically. Do NOT modify SourceService.

**3. Is it a new enrichment (language detection, EXIF, etc.)?**
→ Write an `@enricher` function in `content/enrichers.py` with a check query, capability, and queue. The task is auto-registered, auto-dispatched, and auto-scheduled. Do NOT put enrichment logic in processors or services.

**4. Is it a new analysis method?**
→ Implement `AnalysisAdapterProtocol`, register in DB. Flow ANALYZE step and `/analysis/adapters/execute` will discover it. Do NOT hardcode analysis methods.

**5. Is it a new ingestion path (new route for creating assets)?**
→ Use `ingest()` from `content/ingest.py` or compose with an existing Handler + AssetBuilder. Do NOT create new IngestionContext manually in routes — use `IngestionContextFactoryDep` from DI.

**6. Does it need to query assets?**
→ Use `AssetQuery` from `content/query.py`. Compose with `.text()`, `.kinds()`, `.facets()`, `.semantic()`, `.annotation_value()`, `.exclude_superseded()`. Do NOT write raw SQL against the asset table.

**7. Does it cross domain boundaries?**
→ Check the layer rules above. If content needs to trigger flow evaluation, emit an event (`source.polled`, `asset.processed`, etc.) — the subscribing @task handles it without cross-domain imports. If a route needs to compose primitives from multiple domains, that's fine — routes are OUTSIDE the layer hierarchy.

**8. Is it a new Foundation provider?**
→ Add a `@provider`-decorated class in `providers.py` with `key`, capability attributes (`language`, `embedding`, etc.), and optional `api_key`/`base_url`/`credential_key`/`contexts`. The decorator handles registration. To resolve a provider in any execution context, use `resolve(protocol, type_key, settings, credentials)` from `registry.py`. Do NOT manually construct providers, merge credentials, or check provider availability outside `resolve()`.

**9. Does the route accept an infospace_id?**
→ Use `access: Access = Requires(Capability.X)` for path-parameter routes, or `resolve_access(session, infospace_id, user, Capability.X)` for body/derived infospace_id. Do NOT validate access in service methods. The `Access` context is frozen and trusted — use `access.infospace_id`, `access.user_id`, `access.scope`. For package-scoped consumers, apply `AssetQuery.scope(access.scope)` to asset queries.

**10. Is it thinning a route file?**
→ Move domain logic to the appropriate module (`content/*`, `annotation/*`, etc.). Routes are thin dispatchers: validate input, call primitive (`ingest()`, `AssetQuery`, service method), return response. Do NOT split route files by concern type (e.g. "CRUD vs ingestion"). The pattern is one route file per resource (`assets.py`, `bundles.py`, `sources.py`). The route gets shorter because the logic moves down, not because it gets split sideways.

### Anti-patterns to avoid:

- **God services.** If a service method is "call provider, call handler, assign bundle" — leave it as route-level composition. Creating a service for that adds indirection without value.
- **Kind checks in services.** `if asset.kind == AssetKind.PDF` in service code means the registry isn't being used. Use `ContentTypeRegistry.by_kind(asset.kind)` to get the descriptor, then check `descriptor.is_container`, `descriptor.processor_class`, etc.
- **Manual IngestionContext construction in routes.** Use `IngestionContextFactoryDep`. The factory ensures consistent provider wiring.
- **Inline request models in route files.** Put them in `schemas.py`. Routes should be thin — validate input, call service, return response.
- **Processing logic in ProcessingService for a specific kind.** Kind-specific logic belongs on the processor or materializer, invoked via the descriptor. ProcessingService orchestrates the pipeline; it doesn't know about CSV columns.
- **Access validation in services.** Services never check infospace access — `Requires()` at the route level handles it. Services receive `user_id` and `infospace_id` as trusted parameters. The legacy `validate_infospace_access()` pattern is removed; `global_utils.py` is deleted.
- **Scope filtering at the route level per-endpoint.** For assets, put scope in `AssetQuery.scope()` once — every consumer gets it. For non-asset entities, use `access.scope_filter()` (lists) and `access.require_in_scope()` (get-by-ID). Don't write manual `if scope: query = query.where(...)` checks.

---

## Scale Readiness (400GB+)

The acid test: "The VPS deployment with 400GB+ of drifting PDFs should require zero custom code." Scale-critical paths are addressed:

| Path | Implementation | Scale behavior |
|------|----------------|----------------|
| Directory import | Chunked commits (500/batch), cursor-based resume | Resumable; no mega-transaction |
| Processing | Atomic claim, `process_content` rate_limit (`PROCESS_CONTENT_RATE_LIMIT`) | Idempotent; no Redis queue flooding |
| @task check queries | Partial indexes (ix_asset_ocr_pending, ix_asset_hash_missing, ix_asset_embed_ready) | Index-only scans for hot paths |
| Dispatch | One session per task in `dispatch_tasks` | No connection held across all tasks |
| Enrichment | Read/write phase separation; no DB hold during external I/O | Connection pool safe |
| OCR failure | `FACET_OCR_FAILED` + `exclude_when_facet` | No infinite re-dispatch |
| Source polling | Circuit breaker (`consecutive_failures` > threshold) | No retry storms |
| Singleton re-resolve | `RESOLVE_SINGLETON_WINDOW_DAYS` config (0 = no limit) | No age-out |
| Graph traversal | GraphEdge table + indexed SQL | O(1) lookup; no annotation/entity load |
| Entity resolution | In-memory alias lookup from prefetched canonicals before SQL | ~70% fewer queries |
| FragmentCuration lookups | FK columns (subject/object/entity_canonical_id) | Indexed joins; re_resolve uses FK filters |
| Asset search | AssetQuery (FTS, facets, semantic, bundle filter) | SQL pushdown; cursor pagination |
| Tree search | `Asset.bundle_id == bundle_id` | No relationship load; indexed filter |
| non_superseded_filter | `parent_is_superseded` denormalized column | No correlated EXISTS subquery; indexed partial filter |

---

## Known Gaps (March 2026)

**What's structurally complete:** Content processing pipeline (handlers → processors → enrichers), all registries (ContentType, handler, @task, @enricher, PollHandler), metadata decomposition (facets/file_info), versioning (superseding), scale hardening (P0–P2 architecture review items), task dispatch with per-task scheduling, task concurrency safety, capability-based access control (`Requires()` on all infospace routes, `PackageScope` with full visibility predicate via `AssetQuery.scope()`), package sharing with typed FK PackageItems and precomputed scope resolution.

**What's structurally complete and connected:**

- **Event bus** — `core/events.py` is implemented: `emit`/`subscribe`, `filter_key`/`filter_value`, Celery-based dispatch. @task functions declare `triggers=["event.name"]` and the decorator auto-subscribes. Events drive the fast path: `asset.ingested` → `process_pending`, `asset.processed` → enrichers, `annotation_run.completed` → flow resumption. Schedule-based dispatch is the safety net.
- **Provider system** — Complete. See § Active Architecture Plan Step 2 below.

**Current deployment state:** 400GB+ VPS deployment is live. Datasets imported, ingested, processed (text extraction, sub-asset creation complete). `ENABLED_ENRICHERS` gates which enrichers are dispatched (empty = none, `*` = all, or comma-separated whitelist).

**Remaining implementation gaps:**

- **Kind checks outside registries** — `strategy.py`, `annotate.py`, `content_tree_builder.py` contain direct `AssetKind` comparisons. **→ Step 6** (deferred).

**Resolved gaps (for record):**
- ~~Provider system fragmentation~~ — Unified into `registry.py` (ProviderDescriptor + `resolve()` function). `model_registry.py`, `embedding_registry.py`, `unified_registry.py`, `resolver.py` deleted.
- ~~Credential resolution~~ — Callers provide `type_key` + `credentials` explicitly. `load_credentials()` merges runtime keys with stored user credentials. `resolve()` checks access + credentials in ~15 lines.
- ~~Per-descriptor access control~~ — `PROVIDER_ACCESS_{PROTOCOL}_{type_key}` env vars; smart defaults based on `requires_api_key`.
- ~~Provider gating fragility~~ — `is_capability_available()` circuit breaker at dispatch level; startup probe logs provider availability.
- ~~OCR modality gating~~ — @enricher uses `requires_modality="image"` via dispatch_filter.
- ~~Language detection enricher~~ — @enricher with auto-dispatch.
- ~~Quality score enricher~~ — @enricher with auto-dispatch.
- ~~Watcher→@task unification~~ — All background work uses `@task`. Enrichers use `@enricher` (wraps `@task`). No separate watcher infrastructure.
- ~~`build_asset_context` hardcoded fields~~ — Relocated to `api/asset_context_builder.py`, uses `facets`/`file_info`.
- ~~`resolve_handler` dispatch table~~ — `handlers/registry.py` with priority-based lookup.
- ~~`factory.py` if/elif chains~~ — Eliminated; declarative `@provider` classes in `providers.py`.
- ~~`source_metadata` confusion~~ — Decomposed to `facets` + `file_info`, column dropped.
- ~~Service-layer access validation~~ — `validate_infospace_access()` removed from all 14 service files. `global_utils.py` deleted. Routes use `Requires()` / `resolve_access()`.
- ~~Package polymorphic FK~~ — `PackageItem.resource_type`/`resource_id` replaced with typed nullable FK columns (`bundle_id`, `run_id`, `graph_id`, `schema_id`, `asset_id`, `entity_canonical_id`). CHECK constraint enforces exactly one non-null.
- ~~Package scope incomplete~~ — `PackageScope` now precomputes all bounded derivations: recursive bundle expansion, graph→run, run→schema, ancestor asset chain. `AssetQuery.scope()` applies the three-branch visibility predicate.

**Future enhancements (P3, deferred until core is stable):**
- DAG flow execution (design complete in DAG_FLOW_STEPS_DESIGN.md).
- FlowStepRegistry (if/elif → registry dispatch for flow steps).
- Virtual folder / materialize flow coherence.
- Universal versioning + content quality comparison (see below).

---

## Active Architecture Plan (Road to 100%)

These changes bring the implementation into full alignment with the stated architectural philosophy. Each addresses a structural gap where the code falls back to if/elif dispatch, hardcoded cross-domain imports, or polling where events should suffice.

**Execution order matters.** The event bus is foundational (fixes layer violations, enables enrichment chaining). The provider registry (Step 2) and handler registry (Step 4) are independent of the bus and of each other. The @enricher decorator (Step 3) wraps @task with enrichment defaults and event triggers. Metadata decomposition (Step 5) is mechanical and should run last to avoid merge conflicts.

### 1. Event Bus (`core/events.py`) — ✅ DONE

Celery-based event bus with `emit`/`subscribe`, `filter_key`/`filter_value` support. Lifecycle events:
- `asset.ingested` → `process_pending` (content processing)
- `asset.processed` → enrichers (OCR, hash, language, etc.) + `version_gap` (annotation followup)
- `asset.enriched` → embedding (filtered `enricher_name=ocr`)
- `annotation_run.completed` → flow resumption
- `source.polled` → source monitoring

@task functions declare `triggers=["event.name"]` and the decorator auto-subscribes at import time via `null_prefix=True` (sends `args=[None, infospace_id]` to trigger self-query mode). Schedule-based dispatch is the safety net for lost events.

**Design constraints:** The event bus is infrastructure (Layer 0). It must NOT import from any domain. Subscribers are Celery task name strings. The bus calls `celery_app.send_task()` — same decoupling as task dispatch.

### 2. Unified Provider Registry — ✅ DONE

**Three files. One function.**

The provider system is implemented in `foundation_service_providers/`:

- **`base.py`** — Protocol classes (`StorageProvider`, `EmbeddingProvider`, `LanguageModelProvider`, etc.) + typed model specs (`ModelSpec`, `LLMModelSpec`, `EmbeddingModelSpec`) + provider selection models (`ProviderSelection`, `LanguageDefaults`, `ProviderDefaults`).
- **`registry.py`** — Framework: `Setting` (reference to config attr), `Capability` (one capability binding), `@provider` decorator, `ProviderDescriptor` dataclass. Registry core: `_registry`, `register_provider`, `get_descriptor`, `list_providers`, `get_provider`, `_build_config`. Resolution functions: `resolve()`, `is_accessible()`, `is_capability_available()`, `discover_models()`, `load_credentials()`, `system_default_type_key()`.
- **`providers.py`** — All 15 `@provider` class declarations (Ollama, OpenAI, Anthropic, Gemini, Mistral, Jina, Voyage, Tesseract, NominatimLocal, NominatimAPI, Mapbox, MinIO, LocalFS, Newspaper4k, Tavily) + convenience getters (`get_storage_provider`, etc.).

**Deleted:** `resolver.py` (CapabilityResolver), `model_registry.py` (ModelRegistryService), `embedding_registry.py` (EmbeddingProviderRegistryService), `unified_registry.py`, `factory.py`, `config/embedding_models.json`.

#### Declarative provider syntax

Each provider is a plain class with `key`, optional `api_key`/`base_url`/`credential_key`/`contexts`, and one or more `Capability` attributes. The `@provider` decorator reads them and registers `ProviderDescriptor` entries:

```python
@provider
class OpenAI:
    key = "openai"
    api_key = Setting("OPENAI_API_KEY")
    base_url = Setting("OPENAI_BASE_URL", default="https://api.openai.com/v1")
    credential_key = "openai"
    contexts = {"cloud"}

    language = Capability("language_openai.OpenAILanguageModelProvider", models=[
        LLMModelSpec(name="gpt-5.2", supports_tools=True, supports_streaming=True, ...),
    ])
    embedding = Capability("embedding_openai.OpenAIEmbeddingProvider", models=[
        EmbeddingModelSpec(name="text-embedding-3-small", dimension=1536, max_sequence_length=8191),
    ])
```

`ProviderDescriptor` fields: `protocol`, `type_key`, `impl`, `credential_key`, `api_key_setting`, `base_url_setting`, `base_url_default`, `extra_config`, `models` (`List[ModelSpec]`), `contexts` (`Set[str]`). Properties: `requires_api_key` (derived from `api_key_setting`), `is_local` (derived from `contexts`), `get_model(name)`.

Multi-capability providers (Ollama, OpenAI) declare once, register one descriptor per capability. `_build_config` replaces all closure-based config factories — reads `api_key_setting`, `base_url_setting`, `extra_config` from the descriptor.

#### Provider Resolution

Every execution context calls `resolve()` with explicit parameters:

```python
from app.api.modules.foundation_service_providers.registry import resolve, load_credentials

# In a route (interactive, frontend passes keys)
credentials = load_credentials(session, user.id, request.api_keys)
provider = resolve(EmbeddingProvider, sel.type_key, settings, credentials)

# In an enrichment task (background, system-level only)
type_key = system_default_type_key(OcrProvider, settings)
provider = resolve(OcrProvider, type_key, settings)

# In an annotation task (background, user-triggered)
type_key = run_config.get("provider") or run_config.get("ai_provider")
credentials = load_credentials(session, run.user_id, runtime_api_keys)
provider = resolve(LanguageModelProvider, type_key, settings, credentials)
```

**`resolve()` (~15 lines):** Look up descriptor → check access → check credentials → construct. Keyless providers (Ollama, Tesseract, local_fs) are first-class: no credential needed, just access check. Cloud providers require a key from credentials dict or system env var.

**`load_credentials(session, user_id, runtime_keys)`:** Merges runtime API keys with user's stored encrypted credentials. Returns a flat dict. Callers pass it to `resolve()`.

**Selection is the caller's job.** `type_key` always comes explicitly from domain objects: `ProviderSelection` on infospaces, run configuration, user defaults. `resolve()` never guesses — it takes what it's given.

**Access control:** Per-descriptor via `PROVIDER_ACCESS_{CAPABILITY}_{type_key}` env vars (`all | superuser | none`). Capability names: `language`, `embedding`, `ocr`, `geocoding`, `storage`, `scraping`, `web_search`. Smart defaults: `is_local` (Ollama, Tesseract, Nominatim) → default `"all"`; cloud providers → default `"none"`. Access control gates the system env-var key only — users who supply their own credential always get through. Operators set overrides to share the deployment key (`all`) or restrict it (`superuser`).

**Circuit breaker:** `is_capability_available(protocol, settings)` checks if ANY provider for a protocol is accessible. Used by dispatch to skip @tasks whose capability is unavailable — prevents dispatching thousands of tasks that will all fail.

**Model discovery:** `discover_models(protocol, settings, credentials)` aggregates typed `ModelSpec` entries from accessible descriptors + runtime discovery (Ollama `discover_models()`).

**User defaults:** `ProviderSelection` (`provider_key` + optional `model_name`) is the typed unit stored on `User.provider_defaults` and `Infospace.enrichment_config.embedding`. `LanguageDefaults` provides context-specific overrides (chat vs annotation). Selection happens in the caller — `resolve()` receives the result.

**Startup probe:** `probe_providers(settings)` probes each configured provider type and logs availability. Called at worker startup.

**DI layer:** Routes get providers via `StorageProviderDep`, `ScrapingProviderDep`, etc. (convenience getters in `dependency_injection.py`). For multi-model protocols (LLM, embedding), routes call `resolve()` directly with credentials from `load_credentials()`. @task functions use `ctx.provider(Protocol)` which calls `cached_resolve()` internally. Triggered Celery tasks use registry convenience getters (`get_storage_provider(settings)`, `get_scraping_provider(settings)`).

#### Deployment Mode Examples

**Multi-tenant cloud (zero env overrides needed):**
```env
STORAGE_PROVIDER_TYPE=minio
SCRAPING_PROVIDER_TYPE=newspaper4k
ENABLED_ENRICHERS=hash
# Only hash (no external API needed). All cloud providers default to access=none; users bring own keys
```

**Partial self-hosted (zero access overrides needed):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=tesseract
GEOCODING_PROVIDER_TYPE=nominatim_local
WEB_SEARCH_PROVIDER_TYPE=searxng
ENABLED_ENRICHERS=hash,ocr,geocoding,language_detection,quality_score
# Tesseract/Nominatim/SearXNG default to access=all; users bring LLM keys
```

**Full self-hosted, LLM restricted (one override):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=ollama
EMBEDDING_PROVIDER_TYPE=ollama
GEOCODING_PROVIDER_TYPE=nominatim_local
OLLAMA_BASE_URL=http://ollama:11434
PROVIDER_ACCESS_LANGUAGE_ollama=superuser       # the one restriction
ENABLED_ENRICHERS=hash,ocr,geocoding,language_detection,quality_score,embedding
# Ollama embedding/OCR default to access=all; only LLM is restricted
```

**Full self-hosted, open (zero overrides):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=ollama
EMBEDDING_PROVIDER_TYPE=ollama
GEOCODING_PROVIDER_TYPE=nominatim_local
OLLAMA_BASE_URL=http://ollama:11434
ENABLED_ENRICHERS=hash,ocr,geocoding,language_detection,quality_score,embedding
# Everything defaults to access=all; complete privacy
```

### 3. Enricher→@enricher Unification — ✅ DONE

**Was:** Adding an enricher required coordinating 4 files. **Now:** `@enricher` decorator wraps `@task` with enrichment defaults. One decorated function = one enricher, fully self-contained.

```python
@enricher("language_detection",
          check=lambda iid: ...,  # SQL: assets with text_content, missing 'language' facet
          capability=None,
          depends_on=None,
          queue="processing")
def language_detection(ctx: EnrichmentContext, asset_ids: list[int]):
    ...
```

The `@enricher` decorator sets `schedule=60`, `tags=frozenset({"enrichment"})`, and builds a `dispatch_filter` that checks `ENABLED_ENRICHERS` + enrichment config + capability. All enrichers participate in the unified dispatch loop — no separate watcher infrastructure.

**`requires_modality` for positive predicates:** The OCR enricher check query filters by `discovered_modalities` containing `"image"`.

**`exclude_when_facet`:** Enricher check queries exclude assets with failure facets (e.g. `FACET_OCR_FAILED`). Prevents infinite re-dispatch.

**Guardrail update:** Development Guardrail #3: "Write an `@enricher` function with a check query. Set `capability` if provider-gated. The enricher is auto-registered, auto-dispatched, and auto-scheduled."

### 4. Handler Registry — ✅ DONE

**Implemented:** `handlers/registry.py` with `register_handler()`, `HandlerRegistration` (can_handle, build_kwargs, priority), `resolve_handler()` iterating registry by priority. Handlers (File, Web, RSS, Archive, Text) registered; ingest() uses it. FileHandler couples to ContentTypeRegistry via `get_processor_class(asset)` for processor routing. No resolve.py.

### 5. Metadata Decomposition (`source_metadata` → `metadata` + `file_info`) — ✅ DONE

**Was:** `Asset.source_metadata` (JSONB) conflated three concerns under a misleading name:
- `source_metadata.facets.*` — enrichment-discovered properties (language, location, OCR status, quality score)
- `source_metadata.file.*` — intrinsic file properties (size, page_count, MIME type)
- `source_metadata.processing.*` — transient pipeline state

The name is maximally confusing: `Source` is a core entity (RSS feed, search monitor, inbox) that tracks where data enters the system. `source_metadata` on Asset has nothing to do with the Source model — it's metadata about the asset itself. 106+ references in the content domain alone.

**Solution (implemented):** Two columns on Asset. Python attributes: `facets` (maps to DB `metadata`), `file_info`.

- **`facets`** — enrichment-discovered properties. Flat dict. Written by enrichment tasks, read by AssetQuery.facets(), @task check queries, build_asset_context.
- **`file_info`** — intrinsic/processing properties. Set by handlers and processors. Per-asset (no copy from parent to children).
- **`source_metadata`** — dropped. Migration `d5e6f7g8h9i0` completed.

**`build_asset_context`** — Relocated to `api/asset_context_builder.py`. Uses `asset.facets` and `asset.file_info`; model introspection picks up both.

### 6. Layer Violation Fixes (Quick Wins)

Targeted fixes, some auto-resolved by the event bus:

- ~~`annotation/watchers.py` layer violation~~ — Resolved. File deleted; curation logic now in `graph/tasks/curation.py` as @task with raw SQL check query.
- ~~`annotate.py` line 1154: resume_flow_execution import~~ — Resolved. `process_annotation_run` emits `annotation_run.completed` event; `resume_waiting_flows` @task subscribes to it.
- **`strategy.py` kind checks:** Replace `asset.kind == AssetKind.WEB` with `registry.by_kind(asset.kind).is_heavy_processing`. Absorbed when handler registry is built.
- **`annotate.py` kind checks (lines 1909-1982):** Replace `asset.kind == AssetKind.PDF` with `registry.by_kind(asset.kind).is_container` for demultiplexing logic.
- **`content_tree_builder.py` line 475:** `asset.kind == AssetKind.WEB` used to decide whether to include `url` in asset preview. Replace with a `ContentTypeDescriptor` property (e.g., `descriptor.has_web_url`) or a generic check on `asset.source_identifier` presence (if only WEB assets have a meaningful `source_identifier`, the kind check is redundant with a null check). This is the only kind check in the tree builder and should not survive when every other kind check in the codebase has been eliminated.

---

## Future Enhancements (Post-Alignment)

These become feasible once the core alignment plan above is complete.

### Flow Step Registry

FlowService is currently a 1442-line class with an if/elif step dispatch. Handlers and enrichers are registry-dispatched. The natural next step is a `FlowStepRegistry` mapping `FlowStepType` → `StepExecutor` class. Each step type becomes a registered primitive. FlowService shrinks to CRUD + the execution loop (~200 lines). **Deferred** because flows will align naturally once the primitives they compose are solid.

### Universal Versioning and Content Quality Comparison

Currently, versioning (superseding) only works for `local_fs` imports via `DirectoryImportHandler`. The mechanism (`previous_asset_id` chain, `is_superseded` flag) exists on the Asset model but is only triggered from one ingestion path. Extending to RSS, web, search, and file upload requires:

**a) Text quality score enricher.** An entropy-based enricher that writes a quality score to `asset.metadata`. Follows the unified enricher mechanism (register descriptor with `requires_field="text_content"`, `missing_check="quality_score"`). Used by versioning logic to decide which version is authoritative.

**b) Universal version detection.** Extend superseding to all ingestion methods: same URL with different content → version chain instead of skip/duplicate.

**c) Inbox pattern generalization.** Abstract the `_inbox` directory pattern to work with S3, API webhooks, email. Each storage type gets its own `PollHandler` following the existing registry pattern.

### DAG Flow Execution

Design complete in `DAG_FLOW_STEPS_DESIGN.md`. Requires the FlowStepRegistry to be in place first.
