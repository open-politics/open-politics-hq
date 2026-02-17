# Ingestion Pipeline

```
ANY SOURCE                    HANDLER                         ASSET CREATED
─────────────────────────────────────────────────────────────────────────────
Local directory        → DirectoryImportHandler  ─┐
Remote archive (.zip)  → ArchiveHandler           │
File upload            → FileUploadHandler        ├→  Asset(blob_path, logical_path?, kind)
Images (.jpg, .png…)   → DirectoryImportHandler  │      processing_status = PENDING
URL / webpage          → WebHandler               │      (or READY if no processor)
RSS feed               → RSSHandler               │
Search result          → SearchHandler           ─┘
```

```
PROCESSING (Celery: batch_process_pending)
─────────────────────────────────────────────────────────────────────────────
Phase 1 ─ Metadata + Type Refinement
  │  extract_pdf_metadata()          → source_metadata.file.*
  │  detect_content_kind(asset)      → reclassify kind if needed
  │                                    (e.g. image-only PDF → IMAGE)
  ▼
Phase 2 ─ Content Extraction
  │  PDFProcessor.process()          → text_content, child pages
  │  CSVProcessor.process()          → text_content, child rows
  │  WebProcessor.process()          → scraped text_content
  │  IMAGE (no processor)            → skip to READY
  ▼
Phase 3 ─ Quality Gate + Enrichment (implemented)
     language detection              → source_metadata.facets.language (langdetect)
     quality scoring                → source_metadata.facets.quality_score
     OCR (future)                   → replace text_content when quality low
```

```
KEY MODULES
─────────────────────────────────────────────────────────────────────────────
utils/content_types.py       Registry: kind → extensions, processor, importable?, container?
utils/content_detection.py   detect_content_kind() — flat if-checks, reclassifies kind
utils/facets.py              Well-known keys in source_metadata.facets + query helpers
utils/enrichers.py           Enricher registry: language_detection, quality_score (Phase 3)
processors/*                 Pure content transformation (PDF→pages, CSV→rows)
handlers/*                   Source adaptation → Asset creation (BaseHandler + IngestionContext)
services/processing_service  Orchestrates Phase 1 → 2 → 3 pipeline
services/content_ingestion   Thin compatibility shim (ingest_content, compose_article)
services/search_service      Text + semantic search (AssetService, ConversationService)
tasks/batch_processing       batch_process_pending, batch_enrich (Celery)
```

Enrichment endpoints:
  POST /infospaces/{id}/bundles/{bid}/enrich     — trigger batch_enrich (retroactive facet backfill)
  GET  /infospaces/{id}/bundles/{bid}/processing-status — counts by PENDING/READY/FAILED
```
