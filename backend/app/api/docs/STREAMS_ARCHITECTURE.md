## Streams Architecture (Planned)

This document lays out the event-driven Streams feature in depth: rationale, design, data contracts, processing model, migration from Monitors/Pipelines, and operational concerns. It complements the canonical `SYSTEM_ARCHITECTURE.md` and will guide implementation.

Related docs:
- Overview: `backend/app/api/docs/SYSTEM_ARCHITECTURE.md`
- Models: `backend/app/models.py`
- Schemas: `backend/app/schemas.py`
- Services: `backend/app/api/services/`
- Tasks: `backend/app/api/tasks/`
- Adapters: `backend/app/api/analysis/adapters/`

---

### Why Streams

- Unify automation under a reactive, idempotent model while preserving auditability.
- Reduce coupling between “when something happens” and “what should happen next”.
- Enable replay/backfill, incremental materializations, and real-time dashboards.
- Map existing abstractions (Monitors, Pipelines, Tasks) onto a more general substrate without breaking them.

Design goals
- Minimal schema changes; reuse existing services for side-effects.
- Per‑infospace isolation; multi-tenant safety by construction.
- Idempotent processors; at-least-once delivery semantics with dedupe.
- Operable with current stack (Postgres + Celery) before introducing external brokers.

Non-goals (for now)
- Replacing Celery/Beat. They remain the scheduling backbone; Streams adds reactive composition.
- Introducing a new external event bus. Start with DB-backed events; evolve later if needed.

---

### Event model

Event record (DB-backed)
```
{
  "id": "uuid",
  "infospace_id": 1,
  "type": "asset.created | asset.processed | source.processed | run.started | run.completed | annotation.created | fragment.promoted | pipeline.step.completed",
  "occurred_at": "2025-01-01T12:00:00Z",
  "partition_key": "asset:{uuid}",
  "payload": { "domain_specific": "data" },
  "dedupe_key": "string (natural id for idempotency)",
  "producer": "service_name@version"
}
```

Sources of truth
- Emitted at service boundaries where state already changes (e.g., after `AssetService.create_asset`, `AnnotationService.create_annotation`, after `FragmentCurationAdapter` succeeds, at run lifecycle start/finish).
- Celery tasks (INGEST/ANNOTATE) emit completion events.

Event taxonomy (initial)
- asset.created: new parent or child created; includes linkage references
- asset.processed: parse/scrape complete; status READY/FAILED
- source.processed: a Source task completed with counts/ids
- run.started / run.completed: AnnotationRun lifecycle with ids, schema set, counts
- annotation.created: per-annotation event (or batched) including schema_id, asset_id
- fragment.promoted: fragment key/value and refs applied to asset metadata
- pipeline.step.completed: existing pipeline steps summarize effects

Retention
- Short term: stored in Postgres `events` table with time partitioning.
- Medium term: compacted/materialized tables for common dashboards.

---

### Processor & Recipe model

Processor contract
- Input: subscribed event types + filter predicate (by infospace, bundle, schema, etc.).
- Behavior: evaluate a Recipe, invoke existing services/adapters, emit follow-up events.
- Guarantees: idempotent with `dedupe_key`; safe to retry; handle out-of-order within partition.

Recipe (declarative)
```
{
  "name": "triage-monitor",
  "version": 1,
  "on": ["asset.created"],
  "when": {
    "bundle_ids": [123],
    "asset_kinds": ["WEB", "PDF", "TEXT"]
  },
  "actions": [
    {
      "type": "create_run",
      "schemas": [101],
      "run_config": {"model": "gemini-2.5-flash-preview-05-20", "temperature": 0.1},
      "targets": {"source": "event.asset_id"},
      "dedupe": {"key": "run:{schema}:{asset}"}
    }
  ]
}
```

Action types (initial)
- create_run: instantiate an AnnotationRun for target assets
- execute_adapter: run an AnalysisAdapter with config
- add_to_bundle: append asset_ids to bundle
- promote_fragment: call FragmentCurationAdapter with key/value/source_ref
- emit_event: produce a synthetic event (for composition/testing)

Idempotency
- Each action computes a `dedupe_key`; the processor maintains an `actions_log` to skip duplicates.
- Service calls use natural keys where possible (e.g., avoid double promotion of the same fragment key for same asset/run).

Ordering & partitioning
- Partition key: entity id most relevant to action (e.g., asset UUID) to preserve local ordering.
- Global out-of-order tolerated; processors must guard with validation checks.

Error handling
- Retries with backoff on transient failures.
- Dead-letter table with full context; operator tools to replay.

Observability
- Metrics: processed events, succeeded/failed actions, retries, DLQ depth.
- Logs: structured JSON with `event_id`, `dedupe_key`, `recipe_name`, latencies.

---

### Data model additions (proposed)

- `events` (append-only, partitioned by day): core event store.
- `processor_offsets` (per processor/recipe/partition): last processed position with checkpoint metadata.
- `processor_actions_log` (dedupe): records `dedupe_key` fingerprints and timestamps.
- `materialized_latest_signals` (optional): denormalized tables for fast dashboards (e.g., latest controversy signal per subject).

Migrations can be incremental: start with `events` and a minimal `processor_actions_log`.

---

### Mapping existing abstractions

Monitors → Recipes
- Current behavior: detect new assets in bundle(s) and start a run.
- Streams: subscribe to `asset.created` scoped to bundle(s); `create_run` action with schema_ids.

Pipelines → Chained Recipes
- Step outputs (FILTER pass list, etc.) become `pipeline.step.completed` events or `annotation.created` predicates.
- Downstream actions: second-stage `create_run`, `execute_adapter`, `add_to_bundle`, `promote_fragment`.

Tasks (cron) → Schedulers
- INGEST/ANNOTATE tasks continue to run on time; they emit `source.processed`, `run.started`, `run.completed` which processors can react to.

---

### Security & tenancy

- All events carry `infospace_id` and are stored per-tenant; processors run with infospace scoping.
- Service calls in processors must validate access (as routes/services do today).

---

### Backfill & replay

- Processors support catch-up by scanning the `events` table with time/range filters and applying idempotent actions.
- Use `processor_offsets` to resume; use `dedupe_key` to avoid duplicate effects.

---

### Example: 24h controversy + appointments

1) INGEST tasks run daily per Source; each new asset emits `asset.created`.
2) Triage processor (recipe A) listens for `asset.created` in the watch bundle and emits `create_run` for triage schema.
3) Signal processor (recipe B) listens for `annotation.created` where schema == triage and fields match controversy pattern OR for appointments schema == available(1); action: `promote_fragment` with fragment_key "controversy" or "appointments_open".
4) A dashboard reads `materialized_latest_signals` or directly the fragments to show a 0/1 panel that flips to 1 when any matching signal exists.

---

### Phased rollout plan

Phase 1: Emit core events
- Add event emission to services/tasks at natural commit points.
- Implement `events` table and a simple writer utility.

Phase 2: Minimal processor runtime
- Build a Celery worker that polls `events` by partition/time and applies recipes.
- Implement `processor_actions_log` for dedupe.

Phase 3: Migrate monitors/pipelines
- Provide recipe templates and a generator for current Monitor/Pipeline configs.
- Keep original abstractions working; run both paths in parallel while validating.

Phase 4: Materialized views & dashboards
- Create optional tables for latest signals and trendlines.
- Update frontend to read these views for near-real-time UX.

Done criteria
- Event emission covers: asset.*, source.processed, run.*, annotation.created, fragment.promoted.
- At least one end-to-end recipe (triage → promote) operating idempotently in parallel with existing Monitor.
- Dashboards verified against materialized tables/fragments.

---

### Risks & mitigations

- Double side-effects: solve with `dedupe_key` + natural keys and actions log.
- Event growth: partitioned tables + retention policies; down-sample with aggregates.
- Ordering: use per-entity partitioning and validation checks; do not require global order.
- Operational overhead: start small (DB-backed), instrument thoroughly before scaling out.

---

### Implementation checklist

- [ ] Create `events` table and writer util
- [ ] Emit events from `AssetService`, `ContentIngestionService`, `AnnotationService`, `FragmentCurationAdapter`, tasks
- [ ] Implement processor worker, recipe loader, and actions (create_run, execute_adapter, add_to_bundle, promote_fragment)
- [ ] Add `processor_actions_log` and offsets persistence
- [ ] Write triage + promote sample recipes and run in shadow mode
- [ ] Add basic materialized view and validate dashboard semantics
