# Backend API Overview

This is the authoritative reference for the backend architecture — the concrete implementation detail.

For the philosophy behind these decisions, see [FOUNDATION.md](../../../docs/FOUNDATION.md). For code conventions, see [PRACTICE.md](../../../docs/PRACTICE.md). For the target content-cascade diagram, see [`docs/MASTER.mermaid`](../../../docs/MASTER.mermaid). For feature status and outstanding work, see [FEATURE_STATUS.md](../../../docs/internal/FEATURE_STATUS.md). For the graph/schema/canon domain plan, see [graph-domain/HANDOVER.md](../../../docs/plans/graph-domain/HANDOVER.md).

---

## Mission Context

Open Politics is infrastructure for people who work with data in the public interest. The system provides composable primitives — not features — that compose into whatever workflow the task demands.

The backend expresses this through five categories of primitives:

- **Sources** (`@source_type`) acquire items from an external place — read/view/fetch (7 sources)
- **Types** (`@content_type`) expand a content kind into structured children + modalities (5 types)
- **Enrichers** (`@enricher`) discover properties reactively (6: ocr, geocoding, hash, language, quality, embedding)
- **Annotation schemas** define user-specified structured extraction (LLM-driven)
- **Providers** (`@provider`) wrap external services behind capability protocols (deployment sovereignty)

Every operation is a composition of these. **Monitoring is not a system** — it is a `Source` row minting `IngestionJob`s on a schedule, riding the same `ingest` task as a one-shot upload. **Flows compose over jobs** — they dispatch the same primitives and checkpoint/resume on the same events. "Monitor Reuters for climate articles, extract entities, build a knowledge graph" is: Source (rss) + annotation run on the output bundle + CURATE. Nothing higher-order is built explicitly; it falls out of the primitives.

---

## Directory Structure

```
app/
  core/                         # Infrastructure (Layer 0)
    config.py                   # AppSettings
    security.py                 # Auth, JWT, credential encryption
    db.py                       # Engine, connection pool
    celery_app.py               # Celery config, queues, beat schedule
    tasks.py                    # @task decorator, TaskDescriptor, TaskContext (session/provider/
                                # stat/item_failed/send/job_progress), registry, cached_resolve,
                                # structural blocks, Redis slot concurrency
    dispatch.py                 # dispatch_tasks beat task + kick_tasks(tags) on-demand fan-out
    events.py                   # Celery-based event bus: emit() → send_task to subscribers
    stream.py                   # StreamWriter / FamilyStreamWriter / StreamHub (Redis Streams)
    sse.py                      # SSE drain helpers (collect_X = drain(render_X))
    filters.py                  # Shared filter language (FilterSet/FieldCondition + relational.*)
    cursor.py                   # Opaque cursor encode/decode
    redis.py                    # Shared Redis client
    task_utils.py               # run_async_in_celery, …
    initial_data.py             # Seed data (superuser, scenario sources/bundles)

  api/
    modules/
      content/                  # Content lifecycle (Layer 2)
        models.py               # Asset, AssetChunk, Bundle, Source, Dataset, IngestionJob,
                                # EmbeddingModel + enums (AssetKind, Modality, ProcessingStatus,
                                # SourceStatus, IngestionStatus)
        contexts.py             # ALL injected contexts: SourceContext (acquire),
                                # ProcessingContext (process), EnrichmentContext (enrich)
        intake.py               # intake(groups) + run_source_ingestion(source_id) — the only
                                # two job minters; both trivial
        asset_builder.py        # AssetBuilder (fluent) + decide() — create/skip/unchanged/
                                # supersede/update + persist_children
        tree.py                 # THE structure authority: walk (subtree_ids, asset_descendants,
                                # bundle_assets) · member (attach/detach, infospace-scoped) ·
                                # mutate (create_bundle, copy, move, delete, transfer,
                                # resolve_or_create_bundle, find_or_create_child_bundle,
                                # expand_into_bundle, ensure_path_bundles) · weigh (impact) ·
                                # purge · seal/unseal
        query.py                # AssetQuery composable builder (FTS, facets, semantic,
                                # annotation values, scope)
        views.py                # render_tree/search/feed → StreamEvents (one impl, SSE + JSON)
        schemas.py              # View/search/feed DTOs
        facets.py               # Facet keys + merge_facets (the one module-level MAP)
        enrichers.py            # @enricher decorator + 6 enricher functions
        sources/                # @source_type registry: rss, web, web_search, upload, text,
                                # directory (incl. inbox helpers), crawl
                                # __init__.py: RawItem, FetchedContent, Preview, SourceHandler,
                                # content_hash, stage_blob
        types/                  # @content_type registry: pdf, csv(+excel), web_article,
                                # archive, rss_feed — process + recognition signals → detect_kind
        tasks/
          ingestion.py          # ingest @task + the acquire spine (intake_item/intake_items/
                                # _run_ingestion_job); progress via ctx.job_progress per chunk
          processing.py         # item_processing @task + process_asset + maintenance
                                # (reset_stale_processing, retry_failed_processing,
                                # clean_orphaned_children)
          source_monitoring.py  # source_polling @task (due Sources → run_source_ingestion)
          bundle_populate.py    # populate_bundle_from_query (AQL-defined bundles)
          tree_consistency.py   # daily orphan-bundle scan (log-only)
        services/
          source_service.py     # Source CRUD + activate/pause + poll analytics
          dataset_service.py    # Dataset management
        utils/                  # feed_parse, resolve_source_file, storage_access, watcher_filters

      annotation/               # Annotation + Intelligence lifecycle (Layer 3)
        schema_map.py           # THE contract authority: what an output_contract MEANS
                                # (shapes, entity/triplet/time/place paths, x-ref
                                # vocabularies, canon ties) + how to read values at
                                # those paths (iter_values / iter_entity_refs)
        contract_resolution.py  # canon bindings → the contract a RUN executes
                                # (type vocabulary + canon-declared properties)
        …                       # (unchanged by the content cutover — see sections below:
                                # formula.py, formula_query.py, query.py, panel_config.py,
                                # tasks/annotate.py, tasks/followup.py)

      graph/                    # Knowledge graph (Layer 4) — models, resolution, curation tasks
      flow/                     # Automation (Layer 4) — Flow/FlowExecution/Task, FlowService,
                                # schedule + flow_tasks (checkpoint/resume on events)
      embedding/                # Chunking + pgvector primitives (Layer 2.5)
      search/                   # web.py: search_web (provider call) + ingest_results/ingest_urls
                                # (mint `web` jobs); assets.py: internal search over AssetQuery
      conversational_intelligence/  # MCP server + conversation service (Layer 5)
      sharing/                  # Packages, backups (Layer 6)
      identity_infospace_user/  # Users, infospaces, Access/Requires (Layer 1)
      foundation_service_providers/ # Provider protocols + registry + resolve() (Layer 0)

    routes/                     # HTTP surface — thin dispatchers over primitives
    dependency_injection.py     # FastAPI DI (providers + the surviving services)

  models.py / schemas.py        # RE-EXPORT HUBS
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
LAYER 4 (composition):     graph, flow
LAYER 5 (interaction):     conversational_intelligence
LAYER 6 (cross-cutting):   sharing
OUTSIDE:                    routes, dependency_injection
```

**Rule:** A domain never imports from a domain at its own layer or below.

**Exception 1:** Cross-domain foreign keys use string references (`"user.id"`, `"asset.id"`).

**Exception 2:** Cross-domain dispatch uses the event bus or `@task .delay()`, never raw Celery imports. Content emits `source.polled`; flow's `trigger_source_poll_flows` subscribes — no import between them.

**Known violation — annotation (L3) → graph (L4).** Crossed in ~9 places today: `annotation/query.py`, `formula_query.py`, `views.py` (graph schemas + `stream_graph`), `tasks/geocode.py` and `tasks/contract_resolution` paths (`Canon`/`CanonEntry`/`resolve_entities_batch`), `tasks/annotate.py` (`curate_annotated`). The rule does not describe reality here: **the canon is the annotation layer's vocabulary authority and the graph is a consumer of it**, so `Canon`/`CanonEntry` likely belong below `graph`. Until that is decided, new crossings use function-level imports and are expected to be few. See [`docs/plans/graph-domain/HANDOVER.md`](../../../docs/plans/graph-domain/HANDOVER.md).

---

## The Content Cascade

One path for everything that enters the system. Kind is decided **on the bytes at acquire** and trusted afterward.

```
producer ──ints──▶ IngestionJob(kind ∈ registered_source_kinds, config, source_id?)
                      │  intake(groups)            one-shot: source_id NULL
                      │  run_source_ingestion(id)  Source row: kind+details copied verbatim
                      ▼
ingest @task          read → source_token guard → fetch → detect_kind →
                      AssetBuilder.decide → place (tree) → count
                      progress: ctx.job_progress per chunk (DB row + SSE stream)
                      ▼
item_processing @task ContentType.process → modalities + persist_children
                      (kind-driven re-entry for nested containers)
                      ▼
enrichers             ocr · geocoding · hash · language · quality  (gate: enrichment_resolved[])
                      ▼
embedding             terminal (depends_on=ocr, self-chained)
```

### Event graph (verified — every cascade task has BOTH an event trigger and a kick tag)

| event | emitters | subscribers |
|---|---|---|
| `ingestion_job.created` | `intake()` / `run_source_ingestion()` | `ingest` |
| `asset.ingested` | ingest finalize · archive re-entry · authoring route · package import | `item_processing` |
| `asset.processed` | `process_asset` per child · `item_processing` per batch | the 5 discovery enrichers |
| `asset.enriched` | each enricher per batch | `embedding` |
| `source.polled` | `source_polling` | `trigger_source_poll_flows` (flow) |
| `annotation_run.created` / `.completed` | annotation service / annotate task | `process_annotation_run` / `resume_waiting_flows` |

**Dedup is a three-tier ladder, and it is what makes monitoring free.** Identity = `source_identifier` (the URL wherever one exists — feeds key on the article link, not an opaque guid, so a story reached by RSS and by search is one asset; also path, `archive://<id>/<relpath>` position).

| Tier | Question | Cost | On |
|---|---|---|---|
| 1 identity | seen this `source_identifier`? | one indexed lookup, **DB-enforced** by `ux_asset_live_identity` | always |
| 2 drift token | did the cheap change signal move? | one query per 200-item chunk | when the source emits one |
| 3 content hash | did the bytes change? | fetch + one `content_hash()` | **only when the Source declares `on_drift`** |

Tier 3 is opt-in. With it off — the default — a known identifier never reaches `fetch()`: no network, no hash, no write. Turning it on is what buys versioning (`supersede`) or in-place refresh (`update`). Monitoring is therefore a Source with a poll interval and `on_drift` set, not a feature.

`ux_asset_live_identity` is `UNIQUE (infospace_id, source_identifier) WHERE parent_asset_id IS NULL AND is_superseded = false`. Both predicates are load-bearing: superseded versions accumulate freely behind the one live row, and children reuse identifiers by design. A losing racer's insert rolls back to a savepoint and re-decides, so a concurrent poll collapses into an ordinary match instead of a duplicate.

**The Source contract:** a `Source` row IS monitoring config — `kind` is a registered source kind, `details` is that source's read-config **verbatim**, destination is the `output_bundle_id` column, cursor is `cursor_state`. Minting a poll job is copying those fields onto an `IngestionJob`. There is no translation anywhere.

**The source realization contract:** `read` always yields identity + locator (+ inline `text` only when it is the *full* content — a snippet is preview metadata, never `text`). `fetch` passes inline text through, else acquires from the locator. Because the locator always carries forward, `fetch` can always complete. Browse/preview = `read`/`view` stopping before `fetch`.

---

## System Taxonomy

### Dimension 1: Primitives

| Primitive | Contract | Registration | Example |
|---|---|---|---|
| Source | read(config,cursor,ctx) → RawItems · view(item) → Preview · fetch(item) → FetchedContent | `@source_type("kind")` in `content/sources/<kind>.py` | `@source_type("rss") class RSSFeed` |
| Content Type | process(ctx, asset) → children + modalities; recognition signals (ext/mime/magic) | `@content_type` in `content/types/<kind>.py` | `@content_type class PDF` |
| Enricher | check query + one discovery function | `@enricher` in `content/enrichers.py` | `@enricher("ocr", check=…, capability="ocr", triggers=["asset.processed"])` |
| Annotation Schema | extraction contract | DB record, user-created | `{"fields": [...]}` |
| Provider | external service behind a capability protocol | `@provider` in `foundation_service_providers/providers.py` | `resolve("scraping")` |

### Dimension 2: Registries

One registration, everything derives. Never branch on kind with if/elif — look up.

| Registry | Key → Value | Consumers |
|---|---|---|
| Source registry (`sources/__init__`) | `kind → SourceHandler class` | `ingest` task dispatch, `intake` validation, Source create validation |
| ContentTypeRegistry (`types/__init__`) | `kind → ContentTypeDescriptor` | `detect_kind` (signals), `process_asset` (processor), importability, previews |
| @task registry (`core/tasks.py`) | `name → TaskDescriptor` | beat dispatcher, `kick_tasks`, event subscriptions |
| Provider registry | `(capability, key) → ProviderDescriptor` | `resolve()` / `ctx.provider()` — chain: explicit → infospace enrichment_config → owner defaults → env. BYOK runtime keys bypass the cache. |

### Dimension 3: Composables

| Composable | What it is | Consumers |
|---|---|---|
| `intake(session, groups={kind: [spec,…]}, dest_id?)` | Mint one PENDING `IngestionJob` per kind; emit `ingestion_job.created`. THE producer entry. | every route/dialog/MCP tool that ingests anything |
| `run_source_ingestion(session, source_id, dest_id?)` | The Source-row analog: kind + details copied onto a job; claims the source for the run. | `source_polling`, flow INGEST step, manual "process now", `execute_poll` |
| `intake_item` / `intake_items` (tasks/ingestion.py) | The acquire spine: guard → fetch → detect_kind → decide → place. Pure enough to call directly in tests. | `ingest` task, re-poll regression test |
| `process_asset(session, asset, *, storage, scraping)` | One asset through its type's `process`; flips PROCESSING→READY/FAILED; emits per-child `asset.processed`. | `item_processing`, reprocess routes |
| tree verbs (`content/tree.py`) | The only structure mutations: create_bundle, copy, move, delete, transfer, attach/detach (infospace-scoped), ensure_path_bundles, expand_into_bundle, … | routes, sharing, MCP, container types, the acquire spine |
| `AssetQuery` | composable asset access (FTS, kinds, bundle, facets, semantic, annotation values, scope, cursor) | search/tree routes, MCP, flow FILTER, tasks |
| `AssetBuilder` (+ `decide()`) | the one asset write path; dedup/drift policy declared per call (`dedup_on`, `on_match`) | acquire spine, container types, authoring routes |

### Dimension 4: Execution Contexts and DI

**Access control** — unchanged and load-bearing: `Requires(Capability.X)` resolves a frozen `Access` before handler code runs; scope (package consumers) and capabilities (collaborators) are disjoint; services receive trusted ids and never re-validate.

**Injected contexts — all live in `content/contexts.py`** (standing rule: a new injected context goes there):
- `SourceContext` — what a source's read/view/fetch runs in (session, ids, settings, storage/scraping/search providers, options)
- `ProcessingContext` — what a type's process runs in (session, ids, storage/scraping, limits, `persist_children`)
- `EnrichmentContext` — the @enricher runtime (a TaskContext with done/fail/skip over `enrichment_resolved`)

**Routes** are thin dispatchers: validate → mint a job via `intake()` / call a tree verb / compose `AssetQuery` → return. Ingestion routes return the `IngestionJobRead` to poll (the async contract; `ctx.job_progress` keeps it live).

**Tasks**: all background work is `@task`. `TaskContext` carries `session()`, `provider()` (cached per infospace; ProviderError → indefinite structural block cleared on config save; transient → 5-min backoff), `stat()`, `item_failed()` (circuit breaker), `send()` (SSE), and `job_progress()` (job row + stream in one call — the ingestion spine uses it per chunk and for both terminal states).

Dispatch mechanisms (all four first-class): **events** (fast path), **kick** (`kick_tasks(iid, tags)` — on-demand fan-out), **schedule** (per-task poll, safety net), **direct** (`fn.delay([ids], iid)`, plus `params_model` for typed user actions).

### Dimension 5: Domains

| Domain | Layer | Owns | Key Primitives |
|---|---|---|---|
| Foundation Providers | L0 | protocols, implementations, resolve() | `resolve()`, capability gating, BYOK |
| Core Infrastructure | L0 | @task, events, dispatch, streams | `@task`, `emit()`, `kick_tasks()`, `ctx.job_progress` |
| Identity / Infospace | L1 | User, Infospace, access | `Requires()`, `Access`, `PackageScope` |
| Content | L2 | Asset, Bundle, Source, IngestionJob; sources/types/enrichers; tree | `intake`, `ingest`, `process_asset`, tree verbs, `AssetQuery`, `AssetBuilder` |
| Embedding | L2.5 | AssetChunk, HNSW | chunk/embed/similarity/vectors |
| Annotation | L3 | Schema, Run, Annotation; Formula stack | annotate pipeline, `AnnotationQuery`, `FormulaQuery` |
| Search | L3 | SearchHistory | `search_web` (provider call), `ingest_results`/`ingest_urls` (mint `web` jobs) |
| Graph | L4 | Canon, Entity, GraphEdge, … | resolution, curation, `stream_graph` |
| Flow | L4 | Flow, FlowExecution, Task | reentrant state machine; checkpoint/resume on `annotation_run.completed` |
| Conversational Intelligence | L5 | conversations | MCP server (consumes intake/tree/AssetQuery directly) |
| Sharing | L6 | Package, backups | PackageService (an imported Source is config; user activates, polling does the rest) |

---

## Primitive Inventory

### Sources (`@source_type`) — how data enters

| Kind | config (read contract) | Notes |
|---|---|---|
| `web` | `{url}` \| `{urls: […]}` (+ inline `text` passthrough) | post-fetch kind detection: HTML → WEB stub (WebArticle scrapes in process); real file → blob |
| `upload` | `{storage_path, filename?, title?, path?}` | route stages bytes first; `path` → sub-bundle placement |
| `text` | `{text, title?, event_timestamp?}` | identity = content hash |
| `rss` | `{feed_url, max_items?}` | inline entry content; drift token = pubdate |
| `web_search` | `{query, max_results?}` | uses `ctx.search_provider`; snippet-wiggle-safe tokens |
| `directory` | `{path, copy_mode?, inbox_mode?, stable_seconds?, …}` | streaming `os.walk`; `mtime:size` tokens; inbox = same source with `inbox_mode` (helpers live here) |
| `crawl` | `{base_url, max_depth?, max_urls?}` | bounded same-origin BFS discovery; fetch == web's fetch |

All sources share the **uniform opener** — `config.get("items") or [config]` — so one source reads both intake-shape (`config.items=[specs]`) and poll-shape (flat `details`) without adapters.

### Types (`@content_type`) — how content expands

| Type | Kind(s) | Produces |
|---|---|---|
| PDF | PDF | PDF_PAGE children + per-page modalities |
| CSV | CSV (+ xlsx/xls) | CSV_ROW children |
| WebArticle | WEB/ARTICLE | scraped text + IMAGE children |
| Archive | ARCHIVE (zip/tar/gz, by ext+magic+mime) | unrolls into a bundle; members dedup on position (`archive://<id>/<relpath>` as source_identifier); nested archives re-enter in-process (depth/byte budget) |
| FeedDocument | RSS_FEED file | entries → ARTICLE bundle members |

### @task inventory (content domain)

| Task | Trigger(s) | Kick tags | Schedule | Notes |
|---|---|---|---|---|
| `ingest` | `ingestion_job.created` | content, ingestion | — | batch=1, self-chain, claims PENDING jobs |
| `item_processing` | `asset.ingested` | content | — | atomic claim per asset; parent-READY gate enables container re-entry |
| `source_polling` | — | content, source | 300s | due Sources → `run_source_ingestion`; circuit breaker on consecutive_failures |
| `reset_stale_processing` | — | content | 3600s | recovers PROCESSING stuck past task_time_limit |
| `retry_failed_processing` | — | content | 3600s | FAILED → PENDING (item_failed breaker caps retries) |
| `clean_orphaned_children` | — | content | 86400s | antijoin (NOT EXISTS) — safe at 500k assets |
| `populate_bundle_from_query` | direct | content, bundle | — | AQL-defined bundles |
| `tree_consistency_check` | — | maintenance | 86400s | orphan-bundle scan, log-only |
| 6 enrichers | `asset.processed` (embedding: `asset.enriched`) | enrichment | 60s | capability-gated per infospace; embedding depends_on=ocr |

### Flow Step Types

| Step | Behavior | Async? |
|---|---|---|
| INGEST | `run_source_ingestion` → drive the `ingest` job → diff new assets in the destination bundle | Sync (waits on the job; candidate for checkpoint/resume on a job-completion event when flows are rebuilt) |
| ANNOTATE | dispatch run, checkpoint, resume on `annotation_run.completed` | Async |
| FILTER / CURATE / ROUTE / EMBED / ANALYZE | unchanged | Sync |

---

## Search Topology

Two orthogonal concerns under `/search`. One looks out, one looks in.

| Concern | Entry | Composition |
|---|---|---|
| External web search | `POST /search/web` (query → results, creates nothing) | `search_web()` — a provider call |
| External → ingest | `/search/ingest`-family routes | `ingest_results()` / `ingest_urls()` → `intake({"web": specs})`; full inline content (≥ threshold) passes through `web.fetch`, snippets scrape |
| Internal asset search | `POST /search/infospaces/{iid}/assets` (+ `/stream`) | `AssetQuery` → `render_search` (one impl, JSON + SSE) |

`/tree/*` is the same topology scoped to structural browsing (`/tree`, `/tree/children`, `/tree/feed`, each with a `/stream` sibling). Navigation is **bundles only** — `bundle_id` scoping + `subtree_ids`; there is no path-based navigation (logical_path is gone).

---

## Views Pattern — One implementation, two presentations

Every listing surface comes from a single `render_X()` async generator (`content/views.py`, `annotation/views.py`) yielding discriminated `StreamEvent`s. SSE routes yield them natively (keepalives attach automatically); JSON routes await `collect_X` (= `drain(render_X, envelope)` from `core/sse.py`). `ListingSection[T]` is the universal section shape; `AssetNode` the single tree/search/feed item; cursors are opaque base64-JSON via `core/cursor.py`.

---

## User-initiated Actions — `@task(params_model=…)` + `/stream`

A route accepts typed params, dispatches an `@task` with a `params_model`, and returns `ActionAcceptedResponse(task_id, watch_url)` pointing at the existing `GET /infospaces/{iid}/stream/{topic}/{resource_id}`. Inside the task, `ctx.send(topic, resource_id, event, data)` pushes progress. Decorator-time invariants: `params_model` forbids `triggers`/`schedule`/`check`; plain tasks require `check`.

Ingestion progress rides the same machinery one level up: `ctx.job_progress(job_id, …)` writes the `IngestionJob` row (polled by dialogs) **and** emits on the `ingestion_job` stream topic, in one call.

---

## Graph Streaming — `stream_graph` with `GraphSource` variants

Annotation triplets and persistent graphs share one streaming primitive: `stream_graph(session, iid, source, *, top_n_nodes, top_n_edges, chunk_size)` (`modules/graph/stream.py`), with `AnnotationGraphSource` (LATERAL over `Annotation.value`) and `PersistentGraphSource` (GraphEdge + Entity). Chunked, deduped across chunks, hard-stops at top-N — never materializes the full set in Python. Multi-graph-field schemas tag edges with `source_field_path`; legacy `"triplets"` keys are honored forever.

Node identity is `_node_id(name, type)` — a global hash. That is load-bearing: the same entity named by a triplet, a nested row's entity leaf, or a top-level roster collapses into **one** node with no reconciliation code. Field-shape recognition comes from `annotation/schema_map.py` (one detector, shared with the frontend), not from local pattern-matching; `stream.py`'s `_SUBJECT_NAME_KEYS` COALESCE ladder survives only as the legacy fallback for schemas with no explicit role bindings.

---

## Projections — the one graph atom source

`AnnotationGraphSource` reads **N projections**, not one triplet array. A `Projection` (`annotation/panel_config.py`) declares an array to explode plus how to read node identity, time, place, weight and evidence off each row — so a triplet field, a nested observation row, and a bare entity roster are three instances of one declaration.

```
GraphConfig.projections ──▶ resolve_projections(cfg, formula, smap)
                                     │  (node roles inferred from SchemaMap)
                                     ▼
                    AnnotationGraphSource.windows()
                      one LATERAL + one tuple cursor PER projection,
                      run sequentially into ONE shared aggregator
                                     ▼
                    stream_graph → node_slots + edge_slots → GraphChunk
```

**`Projection.about` decides what a row becomes.** One field, three deposits —
see [observation-model/HANDOVER.md](../../../docs/plans/observation-model/HANDOVER.md):

| `about` | produces |
|---|---|
| `self` | an **occurrence node** carrying the row's own when/where/magnitude/evidence, plus one role-labelled edge per participant. Participants inherit **nothing** — that scoping is what stops one row's date smearing across everyone in it. |
| `"<role>"` | a **property**: the row's bindings write onto that participant's node and nothing is minted. How an entity gets an interval-valued attribute (a seat, a term) when the entity slot is a closed `{name, type}` shape. |
| `between` / unset | cross-role **connections** — the historical behaviour |

Inferred in `resolve_projections`, never typed by an author: three-or-more
participants cannot be a pair, one participant has no pair to be, and for two
the proxy is point-vs-interval (an instant recurs and is an event; an interval
holds and is a state). A property row is **never** inferred — `{who, place,
from, to}` is structurally identical to an encounter.

Legacy triplet arrays are pinned to `between` by the adapter in
`resolve_projections`, which is what lets the inference follow the model
everywhere else.

**A schema in the pattern graphs itself.** When a panel declares no
projections, `derive_projections(smap)` builds one per array section instead of
synthesizing a single one over `cfg.source`. `about` comes from the **section
name** — the model's own rule, and the only way to get `attributes` right,
since a property row is never inferable from shape. Bindings come from the
field names the model prescribes. `derive_doc_anchors` does the same for the
document rung. An explicitly declared projection always wins; this only fills a
void — and the void was real, since a v2 schema opened in a panel showed one
array and dropped every other section.

**Two knobs on what an `about: self` row mints.** Both declared, because the
answers are semantic and the row's shape cannot reveal them:

| field | what it decides |
|---|---|
| `node_kind` | `occurrence` (default) or `entity`. An exhibit exists whether or not anyone cites it, so it is an entity — even though its row lives in an `about: self` array, because that is the only branch that mints a node. Without it, `kind:` reported *which array a row landed in*, and `kind:occurrence` returned documents alongside the acts they ground. |
| `node_type_path` | read `node_type` from a **field on the row** rather than pinning it — mirrors `NodeRole.type_path` vs `type_const`. What lets one `observations[*]` array carry a `kind` enum and still answer `type:Payment`. Falls back to `node_type` when a row leaves it empty. |

**A roleless `about: self` row still reaches the graph.** The read gate used to
require at least one participant, which is right for a connection — an edge
between nothing and nothing is not a row — and wrong for anything that mints a
node of its own. An exhibit relates to nothing until something cites it; a named
event relates to nothing until an observation says it belongs. Those sections
were dropped in SQL before the aggregator ever saw them, silently. An
`about: self` row now also passes on its own identity, label, time or place.

| node roles | predicate | produces (when `about` is unset) |
|---|---|---|
| 2 | set | directed edges (the classic triplet) |
| 2+ | unset | co-occurrence **across roles** — never within one multi-valued role, so edge count is bounded by roles² not values² |
| 1 | — | nodes only (a roster) |

Five things in here are load-bearing and easy to break:

- **Node atoms are independent of edges.** `NodeRow` + `node_slots` exist because nodes used to be materialized *only* from edge slots — an entity that related to nothing never appeared, however often it was named. Rosters were structurally invisible.
- **Typeless folding.** `("Merkel", "")` folds into `("Merkel", "Politician")` when the typed twin is *unambiguous*. Without it multi-projection merges nothing on real schemas (rosters often declare no `entity_type` while triplet endpoints carry one). Ambiguous names — `Washington` the person and the place — stay apart.
- **Role values fan out in Python, not SQL.** A role may be multi-valued (`beguenstigte_firmen[*]` inside a row); giving each its own LATERAL would make the cursor a tuple per role and the SQL a cross product. One LATERAL, one stable cursor, combinatorics where they're cheap.
- **Entity children beat the triplet aliases.** `_infer_node_roles` checks entity-shaped children *first*; the alias families only run when there are none. `SUBJECT_NAME_KEYS` contains `from` and `OBJECT_NAME_KEYS` contains `to`, so an ordinary row using them as interval **dates** — which the observation-model template does everywhere — was otherwise detected as a triplet and had its two date fields made into the graph's nodes.
- **Legacy synthesis, never migration.** Empty `projections` synthesizes one from `formula.group[0].path` → `cfg.source` → `"relationships"`; `AnnotationGraphSource(triplet_field=…)` still works. No stored panel changed.

Time and space ride the payload: `t0`/`t1` (existence) and `a0`/`a1` (activity) per node and edge, unioned across contributing atoms, with an **open end absorbing** (a bare timestamp means "from here onward", so `t1 = None`). Place is a **list** — `NodePlace[]` with per-entry interval, kind and ladder rung — because a company holds a registered office, a head office and a tax residence at once, in three countries, and the gap between two of them is often the finding. `place {start, end}` is a trajectory, both ends resolving their own coordinates. `lat`/`lon` resolve from the asset-facet geocoding cache first and curated `CanonEntry.properties.coords` second — **a canon is an enhancement, never a requirement** for geo, and an `Interest` never geocodes at all.

---

## GQL — `modules/graph/gql.py`

AQL's sibling: same tokenizer (`content/query.py:_tokenize`), same `[-]prefix:value` grammar, same comma-OR / space-AND / `-`-NOT rules, plus `hops:`. One field on the wire: `GraphParams.q`.

**Status: [`docs/plans/observation-model/STATUS.md`](../../../docs/plans/observation-model/STATUS.md)** — feature inventory and flows.

**Full reference: [`docs/plans/observation-model/GRAPH_QUERY.md`](../../../docs/plans/observation-model/GRAPH_QUERY.md)** — every token, worked queries, and the known gaps. The summary below is the architecture; that is the grammar.

**Three tiers, and only the first touches SQL.** The split decides what can be pushed down and what fundamentally cannot:

| tier | tokens | where |
|---|---|---|
| 1 row scope | `predicate:` `confidence>0.8` **`doc.relevance>0.7`** `field:` | compiled per projection onto its lateral element; `field:` skips whole projections so the scan never happens. `doc.` climbs to the annotation root and discards whole annotations before any row is exploded |
| 2 graph shape | `type:` `kind:` `role:` **`label==`** `serves:` `degree>` `weight>` `after:/before:` `near:` | post-aggregation — degree needs the whole edge set, `t0` is a union across atoms |
| 3 traversal | `from:` + `hops:` | BFS **last**, over the time/space-bounded graph; identity filters then select from what it reached |

Five semantics worth stating, because each answers a question the naive reading gets wrong:

- **Identity filters select, they do not block paths.** `type:`/`-type:`/`kind:`/`role:`/free text say what to *show*; `after:`/`before:`/`near:` and the edge predicates say what graph you are *in*. Only the second kind bounds a traversal. Filtering first and walking the remainder reads plausibly and fails twice over: the seed is usually not of the type asked for (`type:Location from:"E1"` removed E1 before he could seed → empty), and every actor-to-actor link runs *through* an occurrence that `type:` deletes (`type:Person from:"X" hops:2` returned the seed alone). A path-scoped constraint is a different query and wants its own token.
- **`hops:` counts *actor* hops.** Occurrences are contracted during BFS, so `actor → occurrence → actor` is one step. Without that, every query written before occurrences existed would silently halve in reach.
- **Separate `from:` tokens intersect.** `from:"E1" from:"E2"` is reachable-from-**both** — the co-presence question. Commas inside one token still union.
- **`degree>` is role-scoped when a `role:` is present**, counting only edges in that role and counting them even where the far end was filtered out. "`via` in 340 payments" is a finding; "340 connections" is not.
- **`serves:X+`** rolls up through `subsumes`, so a mundane act reaches the interest hierarchy it belongs to.

Tiers 2–3 run over the *capped projection* (top-N nodes), not the true graph. The UI states this ("top 1000" chip) rather than implying otherwise. Both `/view` and `/view/stream` configure through `_graph_kwargs` → `FormulaQuery._graph_source`, so the same body yields the same graph either way. (The SSE path used to build its source by hand and silently drop `projections` and `q`.)

---

## Schema meaning — `annotation/schema_map.py`

An `output_contract` is a JSON Schema decorated with HQ extensions. **One** module resolves what it means, and every consumer reads that instead of re-deriving it (six implementations had already drifted before this existed):

| Extension | Meaning |
|---|---|
| `x-entityField` | this node is an entity reference `{name, type, additional_types}` |
| `x-entityType` / `x-entityAlternateTypes` / `x-entityEnum` | declared vocabulary; the primary type is the canon resolution key |
| `x-ref` | this field **reuses another field's vocabulary** — the linking primitive. A string **or a list**: one role can draw from several rosters (a `via` that is an intermediary *or* a routing account). Resolution walks a DAG, registering the field under every anchor it reaches. Merging never depended on it — node identity is `name + type` — so what a list adds is the *declaration*: enum propagation, and telling `SchemaMap` two paths name one population |
| `x-canon` | this field resolves into a canon (+ injection controls, see below) |
| `x-fromSource` / `x-toSource` | a triplet's endpoints are drawn from a named entity field |

`build_schema_map()` → `SchemaMap`: `fields` (typed `FieldNode` per path), `vocabularies` (the `x-ref` equivalence classes — `anchor_for(path)` gives the field a path resolves through), and `entity_paths` / `triplet_paths` / `time_paths` / `place_paths` as *candidates* a role picker offers. `schema_map_for()` caches on contract **content**, so there is no invalidation to get wrong. Served on `AnnotationSchemaRead.schema_map` (computed, never stored).

Paths carry `[*]` on array nodes (`document.observations[*].claim`), matching the RolePicker and `core.filters.parse_explosion_chain`. Entity internals are deliberately **not** walked — that shape is closed, so the contract is "given an entity path, the name leaf is `<path>.name`".

The value side lives here too, because a path is useless without a reader: `iter_values(value, path)` honours all three storage conventions (nested / document-unwrapped / flat dotted key) and substitutes real array indices into the returned path — which is what `FragmentCuration.fragment_path` records.

**Curation consumes it directly.** `graph/tasks/curation.py` walks both `triplet_paths` (→ `GraphEdge` + source/target `FragmentCuration`) and `entity_paths` (→ `FragmentCuration.entry_id`; a mention is a membership statement, not a relationship). Both feed **one** `resolve_entities_batch` per annotation, so a name appearing in a roster *and* in a triplet resolves to a single `CanonEntry`.

---

## Contract resolution — `annotation/contract_resolution.py`

A stored contract says what to extract. A **run** may additionally bind an entity field to a canon. That can't live in the stored contract: the same schema runs against different canons, and canon contents change between runs. So the run rewrites its contract once, up front:

```
stored contract + SchemaMap + canon bindings
        │
        └─▶ resolve_contract() ─▶ effective contract ─┬─▶ split_schema_for_extraction
                                                      ├─▶ create_pydantic_model_from_json_schema
                                                      └─▶ the prompt (_format_prop_line)
```

All three consumers read *from the contract*, so one rewrite upstream constrains all three — no per-consumer injection code. Same technique as `routes/annotation_schemas.py:_lift_configs_into_contract`, one level up.

| `inject` | writes | effect |
|---|---|---|
| `types` | `type.enum` + `x-entityTypeList` | closes the type vocabulary (kills `Person`/`person` fragmentation at source) |
| `inject_properties` | nested `properties` bag from `Canon.type_schemas` | model fills the canon's declared slots |

Bindings: schema `x-canon` default merged with `run.configuration.canon_bindings`, **per key**. Canon precedence: run override → `run.canon_ids[0]` → schema preference → infospace default.

**Entity *names* are never injected.** Types constrain, names resolve. A name list large enough to help is large enough to distort the prompt, and it would hide exactly the mentions that most need review. Identity belongs to `graph/resolution.py` (alias → embedding → `CanonProposal`) *after* extraction, not to the prompt. `POST /runs/preview-bindings` runs the same resolution the task will, so a binding's effect (and any binding that landed nowhere) is inspectable before dispatch.

---

## Value aliases — two layers, one resolution order

Values get normalised from two places, and the order they compose in is
load-bearing:

1. **Run-wide aliases** — `AnnotationRun.views_config['aliases']`, authored
   once and applied to every panel touching that field.
2. **Panel merge maps** — `Panel.merge_maps`, authored per panel per field in
   the Value Alias Manager.
3. **Canon aliases** — the attached canon's durable value vocabulary
   (`graph/promote.py:canon_value_merge_maps`), the read-time inverse of
   value-fold promotion.

`_build_formula_query` composes them **scope → panel → run → canon**, first
match winning in `AnnotationQuery._find_merge_map`. The canon layer is lowest
precedence deliberately: it is the durable base, and any explicit run, panel or
scope alias must be able to override it for one question without editing the
vocabulary.

Applied backend-side as SQL `CASE` expressions in three places, so they cannot
disagree: aggregations group by the canonical value, filters match any alias
(`eq: 'SPD'` finds all of them), and field projections render canonicalised.

## Filter operators — `core/filters.py`

`AssetQuery` and `AnnotationQuery` share one filter language: `FilterSet` → `FieldCondition(path, operator, value)`. Standard operators plus the `relational.*` family — `relational.cooccurs` (entities, reach ∈ annotation|asset|same_level, paths) narrows panels/dashboards to where entities co-occur. See FOUNDATION for the lens semantics.

---

## Asset Metadata: facets and file_info

| Column | Attribute | Purpose | Written by |
|---|---|---|---|
| `metadata` | `facets` | enrichment-discovered (language, location, ocr_used, quality_score) | enrichers (`merge_facets`) |
| `file_info` | `file_info` | intrinsic/processing (size, mime, page_count, entry_count) | sources/types |

Per-asset ownership (no parent→child copying). `merge_facets()` bypasses ORM; `expire_asset_facets()` after mixed writes. Provenance lives on `source_id` + `source_identifier` + `source_token` — there is no `logical_path`.

---

## Worker Scaling & Concurrency Safety

| Mechanism | Where | What it prevents |
|---|---|---|
| Atomic claim | `ingest` (job) + `item_processing` (asset) | double-processing: `UPDATE … WHERE status=PENDING`, rowcount=0 → skip |
| Redis slot concurrency | `@task` wrapper (`max_concurrency` per task × infospace) | herd effects per infospace |
| Structural block | `@task` wrapper (ProviderError → `:block` key) | retry storms on misconfig; cleared by config save |
| Source claim | `run_source_ingestion` sets PROCESSING + advances `next_poll_at` | double-minting a poll mid-run |
| Poll circuit breaker | `source_polling` check (`consecutive_failures` ≤ threshold) | dead-feed retry storms |
| Stale reset | `reset_stale_processing` (3600s) | assets stuck after worker crash |
| `task_acks_late` + `reject_on_worker_lost` | celery_app | lost work on worker death |

Beat runs as a single instance; workers replicate freely (all downstream work is idempotent via claims + the dedup ladder, with asset identity enforced by a DB constraint rather than by convention — this claim used to be aspirational, and ~20% of newly created assets were duplicates because of it). Content work runs on its own `-Q processing` pool so a long ingest cannot starve annotate/embed.

---

## Development Guardrails

**1. New content type?** → one `@content_type` module in `content/types/` (process + recognition signals). Everything derives.

**2. New source kind?** → one `@source_type` module in `content/sources/` implementing read/view/fetch. The `ingest` task, `intake()`, Source validation, and polling pick it up automatically. The uniform opener makes it work for both one-shot and monitored use — write it once.

**3. New enrichment?** → one `@enricher` function with a check query, capability, and queue.

**4. New analysis over annotations?** → compose `AnnotationQuery` / a `/view` phase on `FormulaQuery`. No dynamic-import adapters.

**4a. Need to know what a schema field *is*?** → `schema_map_for(contract)`. Never pattern-match `output_contract` locally — that is how six drifting shape detectors happened. New HQ extension? Parse it in `schema_map.py` and expose it on `FieldNode`; the emitter is `frontend/src/lib/annotations/adapters.ts` and it is the only writer.

**4b. New graph capability?** → ask which of the three it is. A **new atom source** (some other field shape becoming nodes/edges) is a `Projection` role binding, not a new source class. A **new way to narrow** is a GQL token — and pick its tier deliberately, because tier 1 scales with the corpus and tiers 2–3 are bounded by the node cap. A **new way to arrange** is an `AnchorSpec` (`frontend/.../forcegraph/anchors.ts`), never a new force: clustering, geography and time are already one primitive, and a fourth special case is the thing that primitive exists to prevent.

**5. New ingestion path?** → there isn't one. Field-dispatch your input into `{source_kind: [specs]}` and call `intake()`; return the job. Authoring (sync `AssetBuilder`) is only for source-less creation (compose-article, bare metadata, URL bookmarks).

**6. Querying assets?** → `AssetQuery`. Mutating structure? → a tree verb. Never raw SQL against asset/bundle structure outside `tree.py`.

**7. Cross-domain trigger?** → emit an event; the subscribing @task handles it. Routes may compose any domain (they're outside the layer hierarchy).

**8. New provider?** → `@provider` declaration; resolve via `resolve()` / `ctx.provider()` only.

**9. New injected context?** → it goes in `content/contexts.py`.

**10. Job status/progress?** → `ctx.job_progress()`. Never hand-write IngestionJob status transitions.

### Anti-patterns

- **Translation layers.** A Source's `details` IS the read-config; a job's `config` IS what `read` parses. If you're writing a function that maps one vocabulary onto another, the vocabulary is wrong — fix it at the source (and migrate data once).
- **Destination in `details`.** The output bundle is the `output_bundle_id` column. Nothing else.
- **Kind checks in services.** Use the registries.
- **Hand-rolled job/progress writes.** `ctx.job_progress` does the row + the stream.
- **Access validation in services.** `Requires()` at the route; services trust their ids.
- **New heavy service classes.** The bar: would this be better as functions over models + a tree verb + `ctx.provider`? (BundleService, ProcessingService, the poll handlers, and the handler/processor taxonomy all failed that bar and are gone.)

---

## Scale Readiness

| Path | Implementation | Scale behavior |
|---|---|---|
| Huge directory import | streaming `os.walk` read + `_INGEST_CHUNK` commits + per-chunk `job_progress` | bounded memory; live progress; crash-safe via guard+decide idempotency |
| Re-polls | tier-1 identity + tier-2 `source_token` guard, then `decide()` | O(changed), zero-write for unchanged corpora (measured 0.018 ms/item) |
| Processing | atomic claim + self-chain + `MAX_CHAIN_DEPTH` | idempotent, no queue flooding |
| Enrichment | GIN `enrichment_resolved @>` gates + read/write phase separation | index-only candidate scans; no DB hold during external I/O |
| Orphan cleanup | `NOT EXISTS` antijoin | safe on 500k-asset infospaces (the `NOT IN` version melted them) |
| Deletion preview | `impact()` — counts only, never materializes id sets | GIN-accelerated on 100k-asset bundles |
| Asset search | AssetQuery SQL pushdown + cursor pagination | no client-side materialization |
| Dispatch | per-cycle budgets (`MAX_DISPATCH_PER_CYCLE`, per-task cap) | one task can't starve others |
