# Backend API Directory Overview

Reference for the domain-driven backend layout. See `docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md` for full handover context.

---

## Directory Structure

```
app/
  core/                         # Infrastructure
    config.py                   # AppSettings
    security.py                 # Auth, JWT, encryption
    db.py                       # Engine, session
    celery_app.py               # Celery config + beat schedule + queue routing
    sso.py                      # SSO
    initial_data.py             # Seed data
    dispatch.py                 # ReactiveWatcher protocol, watcher registry, beat dispatcher
    task_primitives.py          # @self_chaining_task, TaskContext factory

  api/
    modules/                    # Domain modules (all except routes + standalone files)
      content/                  # Content lifecycle
        models.py               # Asset, AssetChunk, Bundle, Source, SourcePollHistory,
                                # EmbeddingModel, Dataset, DatasetIngestionJob
        schemas.py
        handlers/               # File, Web, RSS, Search, Text, Archive, DirectoryImport
                                # + resolve.py (resolve_handler — single dispatch)
        processors/             # PDF, CSV, Excel, Web + base + strategy
        services/               # AssetService, BundleService, SourceService,
                                # ProcessingService, DatasetService, AssetBuilder
        tasks/                  # ingest, content_tasks, batch_processing,
                                # dataset_tasks, source_monitoring, enrichment
        types.py                # ContentTypeRegistry, ContentTypeDescriptor
        facets.py               # WELL_KNOWN_FACETS, facet constants + query helpers
        enrichers.py            # Enricher registry + enrichment watchers (content/watchers.py)
        detection.py            # Content kind reclassification
        query.py                # AssetQuery composable builder

      annotation/               # Annotation lifecycle
        models.py               # AnnotationSchema, AnnotationRun, Annotation,
                                # Justification, RunSchemaLink, RunAggregate
        schemas.py
        services/               # AnnotationService
        tasks/                  # annotate (self-chaining), retry
        model_factory.py        # Dynamic pydantic from JSON schema
        promotion.py            # PromotionRule system

      graph/                    # Knowledge graph
        models.py               # EntityCanonical, FragmentCuration
        schemas.py
        services/               # GraphService (query, traversal, curation, merge)
        resolution.py           # Entity resolution (alias + embedding)

      flow/                     # Automation & orchestration
        models.py               # Flow, FlowExecution, Task
        schemas.py
        services/               # FlowService, TaskService, FilterService
        tasks/                  # flow_tasks, schedule

      embedding/                # Shared embedding infrastructure (Layer 2.5)
        services/               # EmbeddingService, ChunkingService, VectorSearchService
        tasks/                  # embed_asset, embed_infospace, embed_batch_assets

      search/                   # Search & retrieval
        models.py               # SearchHistory
        schemas.py
        services/               # SearchService (imports VectorSearchService from embedding/)

      conversational_intelligence/ # AI interaction (chat, MCP)
        models.py               # ChatConversation, ChatConversationMessage
        schemas.py
        services/               # IntelligenceConversationService
        mcp/                    # server.py, client.py, auth.py

      sharing/                  # Sharing, export, backup
        models.py               # ShareableLink, Package, InfospaceBackup, UserBackup
        schemas.py
        services/               # ShareableService, PackageService,
                                # BackupService, UserBackupService
        tasks/                  # backup, user_backup

      identity/                 # Users & workspaces
        models.py               # User, Infospace + all enums
        schemas.py
        services/               # InfospaceService

      analysis/                 # Pluggable adapters (Layer 4)
      providers/                # Foundation services (storage, LLM, WebSearch, embedding)
    routes/                     # HTTP surface (stays at api/)
    deps.py                     # DI wiring
    main.py                     # Router registration
    tree_builder.py             # Tree building (presentation logic)

  models.py                     # RE-EXPORT HUB: from all domain models
  schemas.py                    # RE-EXPORT HUB: from all domain schemas
  main.py                       # App lifecycle
  alembic/
```

**Note:** v1/ and v2/ are removed. All domain modules live under `api/modules/`; `routes/`, `deps.py`, `main.py`, `tree_builder.py`, `INGESTION.md`, `global_utils.py` remain at `api/` level.

---

## Dependency Rules

Strict, one-directional. A domain may only import from domains **above** it:

```
LAYER 0 (infrastructure):  core (config, db, security, celery, dispatch, task_primitives), providers
LAYER 1 (foundational):    identity
LAYER 2 (content core):     content          (imports: identity, core)
LAYER 2.5 (embedding):      embedding        (imports: content, providers, core)
LAYER 3 (enrichment):       annotation       (imports: identity, content, core)
                            search           (imports: identity, content, embedding, core)
LAYER 4 (composition):      graph            (imports: identity, content, annotation, search, embedding, core)
                            flow             (imports: identity, content, annotation, search, embedding, core)
                            analysis         (imports: identity, content, annotation, search, embedding, core)
LAYER 5 (interaction):      conversational_intelligence (imports: identity, content, annotation, search, embedding, core)
LAYER 6 (cross-cutting):    sharing          (imports: all above)
OUTSIDE:                    routes, deps     (imports: any domain)
```

**Rule:** A domain never imports from a domain at its own layer or below.

**Exception 1:** Cross-domain foreign keys use string references (`"user.id"`, `"asset.id"`); model files may reference other tables as strings without creating Python import dependencies.

**Exception 2:** Enrichment watchers dispatch by Celery task name string, not Python import. A watcher defines `task_name` (e.g. `"enrich_geocoding"`, `"reactive_embed_pending_assets"`); the beat dispatcher calls `celery.send_task(task_name, args=[ids])`.

---

## Current State (Target = Actual)

| Domain                      | Models | Schemas | Services | Tasks | Notes |
|-----------------------------|--------|---------|----------|-------|-------|
| identity                    | ✅     | ✅      | ✅       | —     | InfospaceService |
| content                     | ✅     | ✅      | ✅       | ✅    | Handlers, processors, services, tasks in content/ |
| annotation                  | ✅     | ✅      | ✅       | ✅    | AnnotationService, annotate task |
| graph                       | ✅     | ✅      | ✅       | —     | GraphService, resolution.py |
| flow                        | ✅     | ✅      | ✅       | ✅    | FlowService, TaskService, flow_tasks |
| embedding                   | —      | —       | ✅       | ✅    | EmbeddingService, ChunkingService, VectorSearchService, embed tasks |
| search                      | ✅     | ✅      | ✅       | —     | SearchService (imports VectorSearchService from embedding) |
| conversational_intelligence| ✅     | ✅      | ✅       | —     | MCP server, client, auth |
| sharing                     | ✅     | ✅      | ✅       | ✅    | PackageService, BackupService, backup tasks |
| analysis                    | ✅     | —       | ✅       | —     | Adapters in analysis/adapters/ |

**Imports:** `deps.py` uses direct service paths (`from app.api.modules.content.services import AssetService`, etc.) to avoid circular import. Celery imports domain task paths. All domain code lives under `api/modules/{domain}/`.

**Embedding storage:** Dimension-class vector columns (embedding_384..1536), pgvector HNSW indexed; `embedding_json` deprecated.

---

## Ingestion

See `INGESTION.md` (or `docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md` § Ingestion Pipeline) for the ingestion pipeline: handlers → Asset creation → Phase 1–2 processing → READY. Enrichment (geocoding, embedding) is reactive via watchers.
