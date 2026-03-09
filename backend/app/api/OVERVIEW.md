# Backend API Overview

This is the authoritative reference for the backend architecture. Read this first.

For the philosophy behind these decisions, see [docs/FOUNDATION.md](../../docs/FOUNDATION.md).
For handover context and residual work, see [docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md](../../docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md).

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

**The acid test:** The VPS deployment with 400GB+ of drifting PDFs (redactions and un-redactions) should require zero custom code — only configuration of existing primitives: DirectoryImportHandler for import, InboxPollHandler for drift detection, reconcile for change detection, enrichment watchers for OCR/embedding/hashing, annotation runs for extraction, entity resolution for the knowledge graph.

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
    dispatch.py                 # ReactiveWatcher protocol, watcher registry, sorted-group beat dispatcher
    events.py                   # Celery-based event bus for lifecycle transitions (subscriber registry + send_task dispatch)
    task_primitives.py          # task_context() provider bag, @self_chaining_task
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
          task_services.py      # create_task_services() — DI mirror for Celery tasks
          content_tasks.py      # process_content (atomic claim), reprocess, bulk ingest
          batch_processing.py   # batch_process_pending, batch_enrich (self-chaining)
          ingestion_tasks.py    # import_directory_task, ingest_archive_task
          source_monitoring.py  # poll_active_sources, execute_source_poll
          enrichment.py         # enrich_geocoding, enrich_file_hash, enrich_ocr
        types.py                # ContentTypeRegistry — THE canonical registry for content types
        enrichers.py            # Enricher descriptors (name, target_facet, task_name, provider gate)
        watchers.py             # 4 ReactiveWatchers: OCR, hash, geocoding, embedding
        facets.py               # Well-known facet keys, get/set helpers, annotation→facet mapping
        detection.py            # MIME-based kind reclassification (Phase 1)
        query.py                # AssetQuery composable builder (FTS, facets, semantic, annotation values)

      annotation/               # Annotation lifecycle (Layer 3)
        models.py               # AnnotationSchema, AnnotationRun, Annotation,
                                # Justification, RunSchemaLink, RunAggregate
        services/               # AnnotationService (CRUD, run creation, curation, aggregates)
        tasks/annotate.py       # LLM annotation pipeline (self-chaining, parallel/sequential,
                                # multimodal context, hierarchical schemas, demultiplexing)
                                # + retry_failed_annotations, create_followup_annotation_runs
        watchers.py             # 2 watchers: VersionGapAnnotation, AnnotatedToCurate

      graph/                    # Knowledge graph (Layer 4)
        models.py               # KnowledgeGraph, EntityCanonical, EntityEditLog, GraphEdge, FragmentCuration
        services/               # GraphService (neighborhood traversal via GraphEdge)
        resolution.py           # Entity resolution: find_by_alias (SQL), find_by_embedding (pgvector)
        watchers.py             # 2 watchers: SupersededEntityRetire, ReResolveSingletons
        tasks.py                # reactive_curate_annotated, flag_superseded_entity_sources,
                                # re_resolve_entity_singletons

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
        tasks/                  # enrich_embedding (single enricher task)

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
        registry.py             # Framework: Setting, Capability, @provider, ProviderDescriptor,
                                # registry core, _build_config
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

**Exception 2:** Cross-domain dispatch uses Celery task name strings, not Python imports. A watcher defines `task_name = "enrich_geocoding"`; the dispatcher calls `celery.send_task(task_name, args=[ids])`. A content service triggers flow evaluation via `celery.send_task("trigger_flows_for_source_poll", args=[source_id, asset_ids])`.

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
| Enricher | declares what property to discover | `register_enricher(Enricher(...))` | `Enricher(name="ocr", missing_check="ocr_used", exclude_when_facet="ocr_failed", ...)` |
| ReactiveWatcher | SQL query for work → task name | `register_watcher(instance)` | `EnricherWatcher(enricher).build_query()` → asset IDs needing enrichment |
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
| ReactiveWatcher | `watcher instance → (task_name, build_query)` | `dispatch_reactive_work` beat task (every 2 min) |
| Enricher | `name → Enricher descriptor` | `batch_enrich` validation, provider gating |
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

**Routes** — HTTP entry points. Thin dispatchers: validate input, call composable or service, return response.
- DI: `IngestionContextFactoryDep` for ingestion, FastAPI `Depends()` for services/providers
- Pattern: `make_ingestion_context(user_id, infospace_id, options)` → `IngestionContext`
- One route file per resource (`assets.py`, `bundles.py`, `sources.py`). Routes outside the domain layer hierarchy — they compose primitives from any domain.
- Anti-pattern: manually constructing `IngestionContext` with 10 fields. Use `IngestionContextFactoryDep`.

**Services** — Domain logic within one domain boundary.
- DI: constructor injection (`__init__(self, session, storage_provider=None, ...)`)
- Pattern: services own business rules. They call registries and composables. They never cross domain boundaries via Python import.
- Anti-pattern: services that just wrap a primitive call without adding value ("call provider, call handler, assign bundle" — that's route-level composition, not a service).

**Celery Tasks** — Async execution.
- DI: `task_context(providers=["storage", "ocr"])` for enrichment tasks, `create_task_services(session)` for tasks needing full service access (ingestion, processing)
- Pattern: `with task_context(providers=["storage"]) as (session, prov): ...`
- Shared infrastructure: `@self_chaining_task` for batch processing with cursor, `task_context()` for provider bags, `create_task_services()` for full DI mirror. All in `core/task_primitives.py` and `content/tasks/task_services.py`.
- Anti-pattern: manually creating Session + services + providers inside a task. Use the factories.

**Beat Schedule** — Periodic dispatch. Never does work itself.
- Tasks: `dispatch_reactive_work` (every 2 min — runs all watcher queries, dispatches tasks), `poll_active_sources` (every 5 min), `check_on_arrival_flows` (every 5 min), `check_recurring_tasks` (every 5 min)
- All beat-dispatched tasks are idempotent downstream (atomic claims, locks, precondition checks).
- **Per-watcher dispatch budget:** `MAX_DISPATCH_PER_CYCLE=2000` global, `MAX_PER_WATCHER_PER_CYCLE=500` per watcher. Prevents one watcher from starving others at scale.

**ReactiveWatchers** — Work discovery and backfill. Never execute work — only find it and dispatch.
- Pattern: implement `build_query(session)` returning a SELECT of entity IDs needing work. Set `task_name` for dispatch. Set `batch_size`. Optionally set `depends_on` for ordering hint (e.g., embedding depends on OCR completing first).
- Registered at import time via `register_watcher()`. Beat task `dispatch_reactive_work` runs all watchers in sorted order: independent watchers first, then dependent. This is a single-pass ordering hint — dependent watchers run in the same session, not after independent work completes. Works because watchers re-run every 2 minutes and downstream watchers have their own SQL preconditions.
- **Dual-path model (infrastructure complete, wiring pending):** The event bus (`core/events.py`) provides the hot path: enrichers with `event_trigger` subscribe at import time; events chain enrichment immediately instead of waiting for watcher cycles. The bus infrastructure is complete (emit/subscribe, filter_key/filter_value). All 4 lifecycle events are emitted. But no enrichers currently set `event_trigger`, so the hot path is inactive. **Watchers are currently the only enrichment path.** The next step is wiring enrichers to events — set `event_trigger` on enricher descriptors and subscribe to `asset.processed`. The circuit breaker (`is_capability_available()`) provides the stable provider gating needed. Once wired, enrichers become the hot path and watchers become the backfill/cold-start mechanism.

### Dimension 5: Domains

Domains own their models, services, tasks, and watchers. Each domain is a bounded context.

| Domain | Layer | Owns | Key Primitives |
|---|---|---|---|
| Foundation Providers | L0 | 7 protocols, implementations, registry resolve() | StorageProvider, WebSearchProvider, OcrProvider, etc. Resolved via `resolve()`. |
| Core Infrastructure | L0 | DB, Celery, dispatch, task_primitives | `task_context()`, `@self_chaining_task`, `register_watcher()` |
| Identity / Infospace | L1 | User, Infospace, access control | `validate_infospace_access()` |
| Content | L2 | Asset, Bundle, Source, handlers, processors, enrichers, watchers | ContentTypeRegistry, `ingest()`, AssetQuery, AssetBuilder |
| Embedding | L2.5 | AssetChunk, HNSW indexes | EmbeddingService, ChunkingService, VectorSearchService |
| Annotation | L3 | AnnotationSchema, AnnotationRun, Annotation | LLM pipeline (`annotate.py`), version-gap watcher |
| Search | L3 | SearchHistory | SearchService (FTS, semantic, tree multi-phase) |
| Graph | L4 | EntityCanonical, FragmentCuration, KnowledgeGraph | `resolve_entities_batch()`, GraphService |
| Flow | L4 | Flow, FlowExecution, Task | FlowService (reentrant state machine, 7 step types) |
| Analysis | L4 | AnalysisAdapter | DB-registered adapters, dynamic import |
| Conversational Intelligence | L5 | ChatConversation | MCP server, conversation service |
| Sharing | L6 | ShareableLink, InfospaceBackup | PackageService, BackupService |

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

**Reactive Enrichment (cross-domain, beat + task context):**
```
Enricher registered in enrichers.py (primitive — declaration)
Watcher registered in watchers.py (primitive — work discovery SQL)
  → Beat runs dispatch_reactive_work every 2 min (beat execution context)
    → Watcher.build_query() finds asset IDs needing enrichment (registry lookup)
      → Beat dispatches celery.send_task(watcher.task_name, [ids]) (cross-domain via string)
        → Task runs with task_context(providers=["ocr"]) (task execution context)
          → Task writes result to asset facets/properties (enrichment)
```

**Knowledge Promotion (annotation → graph, task context):**
```
Annotation run completes (annotation domain)
  → _AnnotatedToCurateWatcher finds annotations needing curation (watcher)
    → reactive_curate_annotated task (graph domain, task context)
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
    → EMBED step: dispatches enrich_embedding (task)
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
| ReactiveWatcher registry | `core/dispatch.py` | `register_watcher(instance)` at import time | Beat dispatcher finds work and dispatches tasks |
| Enricher registry | `content/enrichers.py` | `register_enricher(Enricher(...))` | batch_enrich validation, provider gating |
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

### Reactive Watchers (how backfill happens)

Content enrichers use `EnricherWatcher` (auto-generated from descriptors). Graph and annotation have dedicated watchers.

| Watcher | Domain | Dispatches To | Depends On |
|---|---|---|---|
| ocr (EnricherWatcher) | content | enrich_ocr | — |
| hash (EnricherWatcher) | content | enrich_file_hash | — |
| geocoding (EnricherWatcher) | content | enrich_geocoding | — |
| language_detection (EnricherWatcher) | content | enrich_language | — |
| quality_score (EnricherWatcher) | content | enrich_quality_score | — |
| _EmbeddingWatcher | content | enrich_embedding | ocr |
| _VersionGapAnnotationWatcher | annotation | create_followup_annotation_runs | — |
| _AnnotatedToCurateWatcher | annotation | reactive_curate_annotated | — |
| _SupersededEntityRetireWatcher | graph | flag_superseded_entity_sources | — |
| _ReResolveSingletonWatcher | graph | re_resolve_entity_singletons | — |

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

The legacy `Asset.source_metadata` (JSONB) has been replaced by two columns. See [BACKEND_ARCHITECTURE_HANDOVER.md § Asset Metadata](../../docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md) for full details.

| Column | Python attribute | Purpose | Written by | Read by |
|--------|------------------|---------|-----------|---------|
| `metadata` | `facets` | Enrichment-discovered properties (language, location, ocr_used, ocr_failed, quality_score) | Enrichment tasks | AssetQuery.facets(), watchers, build_asset_context |
| `file_info` | `file_info` | Intrinsic/processing properties (size, mime_type, page_count, columns, original_row_data) | Handlers, processors | build_asset_context, tree builder |

**Both optional.** Per-asset ownership — we do not copy parent file_info to children. Parent PDF has `page_count`; child PDF_PAGE has `page_number`, `char_count`. Parent CSV has `columns`; child CSV_ROW has `original_row_data`.

**facets.py:** `get_facet()`, `set_facet()`, `build_facet_filter()` — flat dict, no nesting. `AssetQuery.facets()` uses `metadata @> :facets::jsonb`. `FACET_OCR_FAILED` set on OCR failure to stop watcher re-dispatch. `merge_facets()` bypasses ORM; call `expire_asset_facets()` after if you also write to the same asset via ORM.

---

## Worker Scaling & Concurrency Safety

The system is designed to run multiple worker replicas safely. Here is how conflicts are prevented:

### Task-Level Safety

| Mechanism | Where | What it prevents |
|---|---|---|
| Atomic claim | `content_tasks.py:process_content` | Double-processing: `UPDATE asset SET status=PROCESSING WHERE status=PENDING` (rowcount=0 → skip) |
| Redis advisory lock | `core/redis_lock.py` + `flow_tasks.py:execute_flow` | Concurrent execution of the same Flow |
| `task_acks_late=True` | `celery_app.py` | Re-queues task if worker dies before ack (OOM, kill) |
| `task_reject_on_worker_lost=True` | `celery_app.py` | Rejects task back to queue on worker crash |
| Stale processing reset | `content_tasks.py:reset_stale_processing_assets` | Hourly Beat task resets PROCESSING assets stuck longer than `task_time_limit` |
| `visibility_timeout=3600` | `celery_app.py` | Redis re-delivers unacked messages after 1 hour |

### Beat Safety

Celery Beat **must run as a single instance** — it is the scheduler, not a worker. Workers can be replicated freely. Beat schedules (reactive dispatch, source polling, on_arrival flow checks) are idempotent: running them twice produces duplicate task dispatches, but downstream tasks are safe due to atomic claims and locks.

**For production:** Use `celery beat --pidfile=` to prevent duplicate beat processes, or use a distributed beat backend like `django-celery-beat` or `redbeat` if running in multi-node.

### Watcher Dispatch Safety

`dispatch_reactive_work` (Beat task, every 2 minutes) queries for entities needing work and dispatches tasks. If the same asset appears in two consecutive dispatch cycles (because the enrichment task hasn't completed yet), it may be dispatched twice. This is safe because:

- Enrichment tasks check preconditions (e.g., `enrich_file_hash` checks `asset.content_hash` is still NULL)
- Processing tasks use atomic claims
- Embedding tasks check for existing AssetChunk records

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
→ Register an `Enricher` descriptor in `content/enrichers.py` with `requires_field`, `missing_check`, etc. Write a Celery task in `content/tasks/enrichment.py`. Add task routing in `celery_app.py`. The watcher is auto-generated from the descriptor. Do NOT put enrichment logic in processors or services.

**4. Is it a new analysis method?**
→ Implement `AnalysisAdapterProtocol`, register in DB. Flow ANALYZE step and `/analysis/adapters/execute` will discover it. Do NOT hardcode analysis methods.

**5. Is it a new ingestion path (new route for creating assets)?**
→ Use `ingest()` from `content/ingest.py` or compose with an existing Handler + AssetBuilder. Do NOT create new IngestionContext manually in routes — use `IngestionContextFactoryDep` from DI.

**6. Does it need to query assets?**
→ Use `AssetQuery` from `content/query.py`. Compose with `.text()`, `.kinds()`, `.facets()`, `.semantic()`, `.annotation_value()`, `.exclude_superseded()`. Do NOT write raw SQL against the asset table.

**7. Does it cross domain boundaries?**
→ Check the layer rules above. If content needs to trigger flow evaluation, use `celery.send_task("trigger_flows_for_source_poll", ...)` — task name string, not Python import. If a route needs to compose primitives from multiple domains, that's fine — routes are OUTSIDE the layer hierarchy.

**8. Is it a new Foundation provider?**
→ Add a `@provider`-decorated class in `providers.py` with `key`, capability attributes (`language`, `embedding`, etc.), and optional `api_key`/`base_url`/`credential_key`/`contexts`. The decorator handles registration. To resolve a provider in any execution context, use `resolve(protocol, type_key, settings, credentials)` from `registry.py`. Do NOT manually construct providers, merge credentials, or check provider availability outside `resolve()`.

**9. Is it thinning a route file?**
→ Move domain logic to the appropriate module (`content/*`, `annotation/*`, etc.). Routes are thin dispatchers: validate input, call primitive (`ingest()`, `AssetQuery`, service method), return response. Do NOT split route files by concern type (e.g. "CRUD vs ingestion"). The pattern is one route file per resource (`assets.py`, `bundles.py`, `sources.py`). The route gets shorter because the logic moves down, not because it gets split sideways.

### Anti-patterns to avoid:

- **God services.** If a service method is "call provider, call handler, assign bundle" — leave it as route-level composition. Creating a service for that adds indirection without value.
- **Kind checks in services.** `if asset.kind == AssetKind.PDF` in service code means the registry isn't being used. Use `ContentTypeRegistry.by_kind(asset.kind)` to get the descriptor, then check `descriptor.is_container`, `descriptor.processor_class`, etc.
- **Manual IngestionContext construction in routes.** Use `IngestionContextFactoryDep`. The factory ensures consistent provider wiring.
- **Inline request models in route files.** Put them in `schemas.py`. Routes should be thin — validate input, call service, return response.
- **Processing logic in ProcessingService for a specific kind.** Kind-specific logic belongs on the processor or materializer, invoked via the descriptor. ProcessingService orchestrates the pipeline; it doesn't know about CSV columns.

---

## Scale Readiness (400GB+)

The acid test: "The VPS deployment with 400GB+ of drifting PDFs should require zero custom code." Scale-critical paths are addressed:

| Path | Implementation | Scale behavior |
|------|----------------|----------------|
| Directory import | Chunked commits (500/batch), cursor-based resume | Resumable; no mega-transaction |
| Processing | Atomic claim, `process_content` rate_limit (`PROCESS_CONTENT_RATE_LIMIT`) | Idempotent; no Redis queue flooding |
| Watcher queries | Partial indexes (ix_asset_ocr_pending, ix_asset_hash_missing, ix_asset_embed_ready) | Index-only scans for hot paths |
| Dispatch | One session per watcher in `dispatch_reactive_work` | No connection held across all watchers |
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

**What's structurally complete:** Content processing pipeline (handlers → processors → enrichers), all registries (ContentType, handler, enricher, PollHandler, watcher), metadata decomposition (facets/file_info), versioning (superseding), scale hardening (P0–P2 architecture review items), watcher SQL and budget controls, task concurrency safety.

**What's structurally complete but not connected:**

- **Event bus** — `core/events.py` is implemented: `emit`/`subscribe`, `filter_key`/`filter_value`, Celery-based dispatch. All 4 lifecycle events are emitted at the correct points (`asset.processed`, `asset.enriched`, `annotation_run.completed`, `source.polled`). But only 2 subscribers are active: `annotation_run.completed` → flow resumption, `asset.enriched` (OCR-filtered) → embedding. **No enrichers set `event_trigger`**, so the enricher subscription loop never fires. `asset.processed` has zero subscribers. The bus is infrastructure waiting to be turned on. Watchers are currently the only enrichment path.
- **Provider system** — Complete. See § Active Architecture Plan Step 2 below.

**Current deployment state:** 400GB+ VPS deployment is live. Datasets imported, ingested, processed (text extraction, sub-asset creation complete). `ENABLED_WATCHERS` is configurable — the provider system prerequisite is now met. Configure `ENABLED_WATCHERS` to activate enrichment watchers.

**Remaining implementation gaps:**

- **Event bus wiring** — Wire enrichers to the event bus: set `event_trigger` on enricher descriptors and subscribe to `asset.processed`. Watchers become backfill-only. The circuit breaker (`is_capability_available()`) provides the stable provider gating needed to safely activate event-driven enrichment.
- **Layer violations** — `annotation/watchers.py` imports `FragmentCuration` from graph (L3→L4). `annotate.py` kind checks (`AssetKind.PDF`). `content_tree_builder.py` kind check. **→ Step 6** (deferred).
- **Kind checks outside registries** — `strategy.py`, `annotate.py`, `content_tree_builder.py` contain direct `AssetKind` comparisons. **→ Step 6**.

**Resolved gaps (for record):**
- ~~Provider system fragmentation~~ — Unified into `registry.py` (ProviderDescriptor + `resolve()` function). `model_registry.py`, `embedding_registry.py`, `unified_registry.py`, `resolver.py` deleted.
- ~~Credential resolution~~ — Callers provide `type_key` + `credentials` explicitly. `load_credentials()` merges runtime keys with stored user credentials. `resolve()` checks access + credentials in ~15 lines.
- ~~Per-descriptor access control~~ — `PROVIDER_ACCESS_{PROTOCOL}_{type_key}` env vars; smart defaults based on `requires_api_key`.
- ~~Provider gating fragility~~ — `is_capability_available()` circuit breaker at dispatch level; startup probe logs provider availability.
- ~~OCR modality gating~~ — EnricherWatcher uses `requires_modality="image"`.
- ~~Language detection watcher~~ — Auto-generated from enricher descriptor.
- ~~Quality score enricher~~ — Descriptor + watcher + task implemented.
- ~~`build_asset_context` hardcoded fields~~ — Relocated to `api/asset_context_builder.py`, uses `facets`/`file_info`.
- ~~`resolve_handler` dispatch table~~ — `handlers/registry.py` with priority-based lookup.
- ~~`factory.py` if/elif chains~~ — Eliminated; declarative `@provider` classes in `providers.py`.
- ~~`source_metadata` confusion~~ — Decomposed to `facets` + `file_info`, column dropped.

**Future enhancements (P3, deferred until core is stable):**
- DAG flow execution (design complete in DAG_FLOW_STEPS_DESIGN.md).
- FlowStepRegistry (if/elif → registry dispatch for flow steps).
- Virtual folder / materialize flow coherence.
- Universal versioning + content quality comparison (see below).

---

## Active Architecture Plan (Road to 100%)

These changes bring the implementation into full alignment with the stated architectural philosophy. Each addresses a structural gap where the code falls back to if/elif dispatch, hardcoded cross-domain imports, or polling where events should suffice.

**Execution order matters.** The event bus is foundational (fixes layer violations, enables enrichment chaining). The provider registry (Step 2) and handler registry (Step 4) are independent of the bus and of each other. Enricher-watcher unification (Step 3) optionally uses the bus for `event_trigger`. Metadata decomposition (Step 5) is mechanical and should run last to avoid merge conflicts.

### 1. Event Bus (`core/events.py`) — Infrastructure ✅ DONE, Wiring ⏳ PENDING

**Infrastructure complete.** Celery-based event bus with `emit`/`subscribe`, `filter_key`/`filter_value` support. All 4 lifecycle events emitted at the correct points:
- `asset.processed` → emitted by `content_tasks.py:process_content` after Phase 2
- `asset.enriched` → emitted by enrichment tasks after writing facets
- `annotation_run.completed` → emitted by `annotate.py` after run finishes
- `source.polled` → emitted by source monitoring after poll

**Active subscribers (2):** `annotation_run.completed` → flow resumption. `asset.enriched` (filtered `enricher_name=ocr`) → embedding dispatch.

**Not yet wired:** No enrichers set `event_trigger`, so the enricher subscription loop never fires. `asset.processed` has zero subscribers. The hot path (processing → enrichment chaining without waiting for 2-min watcher cycles) is designed but inactive. Watchers are currently the only enrichment path.

**Next:** Set `event_trigger` on enricher descriptors and subscribe to `asset.processed`. The circuit breaker (`is_capability_available()`) provides the stable provider gating needed to gate enricher subscriptions safely. Once wired, enrichers become the hot path; watchers become backfill.

**Design constraints:** The event bus is infrastructure (Layer 0). It must NOT import from any domain. Subscribers are Celery task name strings. The bus calls `celery_app.send_task()` — same decoupling as watcher dispatch.

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

**Access control:** Per-descriptor via `PROVIDER_ACCESS_{PROTOCOL}_{type_key}` env vars (`all | superuser | none`). Smart defaults: `is_local` (Ollama, Tesseract, Nominatim) → default `"all"`; cloud providers → default `"none"`. Operators only set overrides for exceptions.

**Circuit breaker:** `is_capability_available(protocol, settings)` checks if ANY provider for a protocol is accessible. Used by dispatch to skip watchers whose capability is unavailable — prevents dispatching thousands of tasks that will all fail.

**Model discovery:** `discover_models(protocol, settings, credentials)` aggregates typed `ModelSpec` entries from accessible descriptors + runtime discovery (Ollama `discover_models()`).

**User defaults:** `ProviderSelection` (`type_key` + optional `model_name`) is the typed unit stored on `User.provider_defaults` and `Infospace.embedding_selection`. `LanguageDefaults` provides context-specific overrides (chat vs annotation). Selection happens in the caller — `resolve()` receives the result.

**Startup probe:** `probe_providers(settings)` probes each configured provider type and logs availability. Called at worker startup.

**DI layer:** Routes get providers via `StorageProviderDep`, `ScrapingProviderDep`, etc. (convenience getters in `dependency_injection.py`). For multi-model protocols (LLM, embedding), routes call `resolve()` directly with credentials from `load_credentials()`. Tasks use `task_context(providers=[...])` or `create_task_services(session)` which call `system_default_type_key()` + `resolve()` internally.

#### Deployment Mode Examples

**Multi-tenant cloud (zero env overrides needed):**
```env
STORAGE_PROVIDER_TYPE=minio
SCRAPING_PROVIDER_TYPE=newspaper4k
ENABLED_WATCHERS=hash
# All cloud providers default to access=none; users bring own keys
```

**Partial self-hosted (zero access overrides needed):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=tesseract
GEOCODING_PROVIDER_TYPE=nominatim_local
WEB_SEARCH_PROVIDER_TYPE=searxng
ENABLED_WATCHERS=hash,ocr,geocoding,language_detection,quality_score
# Tesseract/Nominatim/SearXNG default to access=all; users bring LLM keys
```

**Full self-hosted, LLM restricted (one override):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=ollama
EMBEDDING_PROVIDER_TYPE=ollama
GEOCODING_PROVIDER_TYPE=nominatim_local
OLLAMA_BASE_URL=http://ollama:11434
PROVIDER_ACCESS_LLM_ollama=superuser          # the one restriction
ENABLED_WATCHERS=hash,ocr,geocoding,language_detection,quality_score,embedding
# Ollama embedding/OCR default to access=all; only LLM is restricted
```

**Full self-hosted, open (zero overrides):**
```env
STORAGE_PROVIDER_TYPE=local_fs
OCR_PROVIDER_TYPE=ollama
EMBEDDING_PROVIDER_TYPE=ollama
GEOCODING_PROVIDER_TYPE=nominatim_local
OLLAMA_BASE_URL=http://ollama:11434
ENABLED_WATCHERS=hash,ocr,geocoding,language_detection,quality_score,embedding
# Everything defaults to access=all; complete privacy
```

### 3. Enricher-Watcher Unification — ✅ DONE

**Was:** Adding an enricher required coordinating 4 files. **Now:** Generic `EnricherWatcher` auto-generated from descriptors; `language_detection` and `quality_score` have descriptors, watchers, tasks.


**Solution:** Extend `Enricher` descriptor with watcher-generation fields:

```python
register_enricher(Enricher(
    name="language_detection",
    target_facet="language",
    task_name="enrich_language",
    required_provider=None,
    requires_field="text_content",       # Asset must have this for enrichment to apply
    missing_check="language",             # Dispatch when metadata->>'language' IS NULL
    applicable_kinds=set(),              # empty = all kinds
    depends_on=None,                     # or "needs_ocr" for ordering
    batch_size=50,
    event_trigger="asset.processed",     # event bus subscription (when bus is live)
))
```

A single `EnricherWatcher` class reads these declarations and generates `build_query()` dynamically. Registering an enricher automatically registers its watcher. The 4-file ceremony collapses to 2 files: enricher descriptor + Celery task.

**`requires_modality` for positive predicates:** The OCR enricher uses `requires_modality="image"` so only image-dominant pages get OCR. `discovered_modalities` is a first-class Asset column.

**`exclude_when_facet`:** Enrichers can set `exclude_when_facet` (e.g. `FACET_OCR_FAILED`) so the watcher skips assets that already failed after an attempt. Prevents infinite re-dispatch.

**Gaps this closes:** language_detection, quality_score (descriptors + watchers), OCR modality gating, OCR failure circuit breaker.

**Guardrail update:** Development Guardrail #3: "Register an `Enricher` descriptor with `requires_field` and/or `requires_modality` and `missing_check`. Optionally `exclude_when_facet` for failure circuit breaker. Write a Celery task. Add task routing. The watcher is auto-generated."

### 4. Handler Registry — ✅ DONE

**Implemented:** `handlers/registry.py` with `register_handler()`, `HandlerRegistration` (can_handle, build_kwargs, priority), `resolve_handler()` iterating registry by priority. Handlers (File, Web, RSS, Archive, Text) registered; ingest() uses it. FileHandler couples to ContentTypeRegistry via `get_processor_class(asset)` for processor routing. No resolve.py.

### 5. Metadata Decomposition (`source_metadata` → `metadata` + `file_info`) — ✅ DONE

**Was:** `Asset.source_metadata` (JSONB) conflated three concerns under a misleading name:
- `source_metadata.facets.*` — enrichment-discovered properties (language, location, OCR status, quality score)
- `source_metadata.file.*` — intrinsic file properties (size, page_count, MIME type)
- `source_metadata.processing.*` — transient pipeline state

The name is maximally confusing: `Source` is a core entity (RSS feed, search monitor, inbox) that tracks where data enters the system. `source_metadata` on Asset has nothing to do with the Source model — it's metadata about the asset itself. 106+ references in the content domain alone.

**Solution (implemented):** Two columns on Asset. Python attributes: `facets` (maps to DB `metadata`), `file_info`.

- **`facets`** — enrichment-discovered properties. Flat dict. Written by enrichment tasks, read by AssetQuery.facets(), watchers, build_asset_context.
- **`file_info`** — intrinsic/processing properties. Set by handlers and processors. Per-asset (no copy from parent to children).
- **`source_metadata`** — dropped. Migration `d5e6f7g8h9i0` completed.

**`build_asset_context`** — Relocated to `api/asset_context_builder.py`. Uses `asset.facets` and `asset.file_info`; model introspection picks up both.

### 6. Layer Violation Fixes (Quick Wins)

Targeted fixes, some auto-resolved by the event bus:

- **`annotation/watchers.py` line 12:** Replace `from app.api.modules.graph.models import FragmentCuration` with raw SQL: `EXISTS (SELECT 1 FROM fragmentcuration WHERE annotation_id = annotation.id)`. No model import from L4.
- **`annotate.py` line 1154:** Replace `from app.api.modules.flow.tasks.flow_tasks import resume_flow_execution` with `celery_app.send_task("resume_flow_execution", args=[execution_id])`. Or better: emit `annotation_run.completed` event when bus is live.
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
