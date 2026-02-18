# Ingestion Pipeline

**This document has been moved.** The ingestion pipeline is documented in:

- **`docs/internal/BACKEND_ARCHITECTURE_HANDOVER.md`** — see § Ingestion Pipeline
- **`directory_overview.md`** — target structure and module layout

Quick reference:

- **Handlers:** File, Web, RSS, Search, Text, Archive, DirectoryImport → create Assets with `processing_status=PENDING`
- **Processing:** `batch_process_pending` (Celery) runs Phase 1 (metadata), Phase 2 (content extraction) → READY
- **Enrichment:** Reactive watchers dispatch tasks when facets are missing (geocoding, embedding). No synchronous Phase 3.
- **Key modules:** `content/handlers/`, `content/processors/`, `content/types.py`, `content/facets.py`, `content/enrichers.py`, `content/watchers.py`, `content/services/processing_service.py`, `content/tasks/batch_processing.py`, `content/tasks/enrichment.py`
