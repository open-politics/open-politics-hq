# OSINT Kernel System Design (Deep Thought Edition - Rev. 3)

> **Purpose:** This document is the single source of truth for the OSINT Kernel system architecture. It outlines a backend-first, multi-modal, schema-driven, justification-rich, and analysis-ready platform. This revised edition details the analytical engine, ingestion pathways, automation, core data structures, and **multi-modal annotation with cross-modal reasoning**, emphasizing flexibility and extensibility.

---

## 1. Vision & Core Principles

Create **one extensible platform** where investigators can:
- Ingest any open-source data (text, image, video, audio, tabular, web, etc.).
- Enrich it with AI/ML pipelines via flexible `AnnotationSchema`s, capturing structured data and self-explaining model `Justification`s.
- **Perform cross-modal analysis where text, images, audio, and other media are analyzed together in context**.
- Curate flexible, shareable collections (`Bundle`s).
- Perform complex, configurable analysis through a backend `AnalysisAdapter` framework.
- Share actionable intelligence with clear provenance and detailed justifications.
- Maintain tenant data isolation (`Infospace`).
- Support pluggable storage and vector backends.
- Enable natural language schema design for annotation tasks.

### Design Principles

1.  **Everything is Addressable:** UUID + Infospace for every core entity.
2.  **Immutability First:** `Asset`s & `Annotation`s are write-once; mutations produce new versions or linked entities.
3.  **Loose Coupling:** Storage, vector indexes, and potentially graph DBs are treated as services.
4.  **Enum as VARCHAR:** Categorical fields (SQL enums) can grow without requiring immediate schema migrations.
5.  **Flexible Hierarchy:** Parent-child relationships (`Asset` to `Asset`, `Asset` to `AssetChunk`) support multi-modal and granular data representation.
6.  **API-First & Projection-Oriented:** Backend APIs are the primary interface; clients can request specific fieldsets.
7.  **Schema-Driven Everything:** `AnnotationSchema`s (extending JSONSchema with instructions) define the structure and intent for all `Annotation`s and guide `AnalysisAdapter` behavior.
8.  **Justification as First-Class:** Every `Annotation` can link to detailed `Justification`s, enhancing transparency and auditability.
9.  **Linking is First-Class:** `Annotation.links` allow explicit relationships between annotations, assets, or regions, forming the basis for graph structures and provenance.
10. **Multi-Modal by Design:** Core models and the analysis engine support diverse data types and cross-modal analysis.
11. **Pluggable Analysis & Ingestion:** The `AnalysisAdapter` registry and modular `Source` ingestion workers allow easy extension for new analytical capabilities and data types.
12. **Unified Multi-Modal Processing:** A single LLM call processes all modalities together, enabling true cross-modal reasoning and correlation.

---

## 2. Core Abstractions & Data Models

| Entity             | Description                                                                                                                               | Key SQLModel Fields (Illustrative)                                                                |
|--------------------|-------------------------------------------------------------------------------------------------------------------------------------------|---------------------------------------------------------------------------------------------------|
| **Infospace**      | Sovereign tenant space; holds vector config, ACLs, and owns all other entities.                                                           | `id`, `name`, `embedding_model`, `embedding_dim`, `owner_id`                                      |
| **Source**         | Configuration for an ingestion pathway (e.g., S3 bucket, API endpoint, RSS feed).                                                         | `id`, `name`, `kind`, `details` (JSON), `status`, `infospace_id`                                    |
| **Asset**          | Immutable raw or processed item (file, web page, image, text document, CSV row, PDF page, etc.). Supports parent-child hierarchy.            | `id`, `uuid`, `title`, `kind` (enum), `text_content`, `blob_path`, `parent_asset_id`, `source_id`, `infospace_id`, `user_id`, `event_timestamp`, `created_at` |
| **AssetChunk**     | A piece of an `Asset` (e.g., text segment, image region) used for embedding and fine-grained analysis.                                       | `id`, `asset_id`, `chunk_index`, `text_content`, `embedding` (Vector), `embedding_model`            |
| **AnnotationSchema** | Defines an `output_contract` (JSONSchema) and `instructions` for an annotation task. Supports hierarchical structure (e.g., `document`, `per_image`). **Can optionally include `field_specific_justification_configs` to control auto-generation of justifications per field (enable/disable, custom prompts).** | `id`, `name`, `output_contract` (JSON), `instructions` (Text), `version`, `infospace_id`, `field_specific_justification_configs` (JSON) |
| **AnnotationRun**  | An execution of `AnnotationSchema`(s) over target(s). `configuration` includes media flags (e.g., `include_images`), LLM thinking controls (e.g., `thinking_config`), **and `justification_mode` (e.g., "NONE", "SCHEMA_DEFAULT", "ALL_WITH_GLOBAL_PROMPT") to control system-driven field justifications.** | `id`, `name`, `configuration` (JSON - includes model, media flags, thinking controls, `justification_mode`, `default_justification_prompt`), `status` (enum), `infospace_id`, `target_schemas` (link) |
| **Annotation**     | The result of applying an `AnnotationSchema` to an `Asset` (or `AssetChunk`) within an `AnnotationRun`. **`value` field contains all data from LLM, including any system-appended `fieldName_justification` fields if auto-justification was active.** | `id`, `uuid`, `asset_id`, `schema_id`, `run_id`, `value` (JSON), `status` (enum), `region` (JSON), `links` (JSON), `event_timestamp`, `infospace_id` |
| **Justification**  | Structured explanation. **Primarily used to store an optional, global `_thinking_trace` (overall LLM reasoning) from the provider, linked to a parent/document `Annotation`. Field-specific justifications are now part of `Annotation.value`.** Evidence payload supports `thinking_trace`, `text_spans`, `image_regions`, `audio_segments`. | `id`, `annotation_id`, `field_name` (mostly for `_thinking_trace`), `reasoning`, `evidence_payload` (JSON), `model_name`    |
| **Bundle**         | Analyst-curated, mutable collection of `Asset`s.                                                                                          | `id`, `uuid`, `name`, `description`, `infospace_id`, `assets` (link)                              |
| **Task**           | Automated, scheduled job (e.g., cron-driven) for ingestion (`Source` polling) or annotation (`AnnotationRun` execution).                  | `id`, `name`, `type` (enum: INGEST, ANNOTATE), `schedule` (cron), `configuration` (JSON), `status` (enum), `infospace_id` |
| **AnalysisAdapter**| Registered backend module performing specific data analysis (e.g., aggregation, geocoding, entity linking). Configurable via its `input_schema_definition`. | `id`, `name`, `description`, `input_schema_definition` (JSONSchema for its parameters), `output_schema_definition` (JSONSchema for its results), `module_path` (Python path to the adapter class), `adapter_type` |
| **Package**        | Exported, frozen collection of `Asset`s, `Annotation`s, and related entities with a manifest.                                           | `id`, `name`, `manifest` (JSON), `infospace_id`                                                   |
| **ShareableLink**  | Time/usage-bounded deep link to a resource (e.g., `Bundle`, `Package`, `Asset`).                                                            | `id`, `token`, `resource_type`, `resource_id`, `permission_level`, `expiration_date`              |

*(Refer to `app/models.py` for the complete SQLModel definitions)*

---

## 3. System Capabilities

### 3.1 Ingestion Engine

-   **Modular `Source` Workers:** Each `Source.kind` (e.g., "s3\_bucket", "rss\_feed", "api\_scrape", "file\_upload") corresponds to a backend worker.
    -   Workers fetch or receive data, create primary `Asset`s.
    -   For container types (PDF, CSV, archives), workers create child `Asset`s (pages, rows, individual files).
    -   **Multi-modal containers** (e.g., web articles with images, documents with embedded media) maintain clear parent-child relationships.
    -   Textual content from `Asset`s (or relevant children) is chunked into `AssetChunk`s based on `Infospace` settings (`chunk_size`, `chunk_overlap`, `chunk_strategy`).
    -   Embeddings are generated for `AssetChunk`s using the `Infospace.embedding_model` and `embedding_dim`, stored in `AssetChunk.embedding`.
-   **Deduplication & Lineage:**
    -   Byte-level SHA-256 hash on `Asset.content_hash` for exact duplicates.
    -   Optional near-duplicate detection via whole-document embeddings.
    -   `Asset.parent_asset_id` maintains provenance.
-   **Supported Formats (Extensible):** PDF, DOCX, images (PNG, JPG), audio (MP3, WAV), video (MP4), archives (ZIP, TAR), CSV, JSON, text, web pages.

### 3.2 Annotation Engine (Enhanced for Multi-Modal & Implicit Linking)

The annotation engine is designed for flexibility, power, and user-friendliness, especially for multi-modal analysis and detailed justifications.

-   **Schema-Driven Core:** `AnnotationSchema.output_contract` (JSONSchema) defines the structure of `Annotation.value`. `AnnotationSchema.instructions` guide the AI/ML model.
-   **Hierarchical Schema Structure:** The `output_contract` uses conventional hierarchical keys (e.g., `document` for parent asset fields, `per_image` for fields related to each child image). Flat schemas are treated as applying to the `document` level. The `AnnotationSchema.target_level` field is removed.
-   **Implicit & Automated Child Asset Linking:**
    *   **Simplified User Schemas:** Users define their `output_contract` focusing on desired analytical fields (e.g., `description` for an image) without needing to include or manage fields for child asset UUIDs (like `image_asset_uuid`). User `instructions` also focus solely on the analytical task.
    *   **System-Managed UUIDs:**
        1.  **Context Assembly (`assemble_multimodal_context`):** The parent asset's UUID is prepended to its text content sent to the LLM (e.g., `Parent Document (UUID: parent-uuid)...`). Each child media item (image, audio) in the LLM context also includes its own UUID (e.g., `Media Item 1 (UUID: child-uuid)...`).
        2.  **Dynamic Pydantic Model Augmentation (`create_pydantic_model_from_json_schema`):** For items within a `per_modality` array (e.g., the schema for a single image's analysis), the system internally injects an `_system_asset_source_uuid: Optional[str]` field into the Pydantic model that the LLM targets.
        3.  **Automated Prompt Injection (`process_annotation_run`):** A system-level instruction is automatically appended to the user's prompt, directing the LLM to populate this `_system_asset_source_uuid` field for each per-modality item using the exact UUID provided in its input context for that media item.
        4.  **Result Demultiplexing & Cleaning (`demultiplex_results`):** The system exclusively uses the `_system_asset_source_uuid` from the LLM's output to map analysis to the correct child `Asset`. This internal UUID field is then **removed** from the data before it's stored in `Annotation.value`. If this system UUID is missing/invalid, the specific item is skipped. Positional fallback is no longer used.
-   **Field-Specific Justifications & Structured Evidence:**
    *   **User Configuration:** Justification behavior is controlled via `AnnotationSchema.field_specific_justification_configs` (per-field enable/disable, custom prompts) and `AnnotationRun.configuration` (`justification_mode`, default/global prompts).
    *   **Pydantic Model Augmentation (`create_pydantic_model_from_json_schema`):** For fields requiring justification, a corresponding `fieldName_justification: Optional[JustificationSubModel]` field is injected into the LLM's target Pydantic model. `JustificationSubModel` (in `schemas.py`) supports `reasoning`, `text_spans`, `image_regions` (with `BoundingBox`), `audio_segments`, and `additional_evidence`.
    *   **Automated Prompt Injection (`process_annotation_run`):** Detailed system instructions are appended to guide the LLM in populating `JustificationSubModel`, including how to structure evidence and use the correct `asset_uuid` (parent or child, based on context).
    *   **Storage:** All user-defined analytical fields and their corresponding `fieldName_justification` objects (if generated) are stored directly within `Annotation.value`.
-   **Overall Thinking Trace:** If `thinking_config.include_thoughts` is true and the provider returns a `_thinking_trace` (e.g., Gemini thought summaries), `process_annotation_run` creates a single, separate `Justification` DB object linked to the parent/document `Annotation` to store this. This is the sole use of the `Justification` database table for LLM-generated justifications.
-   **Media Inclusion Control:** `AnnotationRun.configuration` includes flags (e.g., `include_images`) and limits (e.g., `max_images_per_asset`).

### 3.3 Analysis Engine (Backend-First)

-   **`AnalysisAdapter` Registry:**
    -   `AnalysisAdapter` records in the database define available backend analysis modules.
    -   Key fields: `name` (unique identifier), `description`, `input_schema_definition` (JSONSchema for its parameters), `output_schema_definition` (JSONSchema for its results), `module_path` (Python path to the adapter class), `adapter_type`.
-   **Execution Workflow:**
    1.  Frontend UI allows users to select an `AnalysisAdapter` and configure its parameters according to its `input_schema_definition`.
    2.  Configuration includes specifying the data scope (e.g., `AnnotationRun` ID, `Bundle` ID, list of `Asset` IDs) and the specific fields within `Annotation.value` or `Asset` attributes to use for analysis (e.g., which field is the timestamp, which field contains categories to count).
    3.  Frontend calls a generic API endpoint: `POST /api/analysis/{adapter_name}/execute` with the configuration object.
    4.  Backend route fetches the `AnalysisAdapter` record, dynamically loads the class from `module_path`.
    5.  Instantiates the adapter with the database session and user-provided configuration.
    6.  Adapter's `execute()` method runs, performing queries and computations.
    7.  Adapter returns a JSON result matching its `output_schema_definition`.
-   **Core Adapter Examples:**
    *   **`label_distribution_adapter`:** Counts unique values in a specified `Annotation.value.<field_key>` (or `Asset.<attribute>`). Handles lists, top-N grouping.
    *   **`time_series_aggregation_adapter`:** Aggregates data (count, sum, avg of a numeric `Annotation.value.<field_key>`) over time buckets (day, week, month). Timestamp source is configurable (e.g., `Asset.event_timestamp`, `Annotation.timestamp`, specific `Annotation.value.<timestamp_field>`). Can split by `Asset.source_id`.
    *   **`alerting_adapter`:** (New) Takes an `AnnotationRun` ID and a list of conditions. Analyzes `Annotation.value` fields and generates a list of alerts if conditions are met. This replaces rigid, built-in alerting with a flexible analysis tool.
    *   **`entity_extraction_adapter`:** (Hypothetical) Could use an NER model via `ClassificationProvider` or aggregate pre-extracted entities from `Annotation.value` fields.
    *   **`geocoding_adapter`:** Takes `Annotation.value.<location_field>` strings, geocodes them, potentially creating new "GeocodedLocation" `Annotation`s or updating `Asset`s.
-   **Flexibility:** The power of this engine lies in its ability to operate on user-defined fields from `Annotation.value`, allowing analysis to be tailored to the specifics of the data and the investigation. This makes advanced, conditional alerting a standard feature of the analysis engine.

### 3.4 Search Capabilities

-   **Per-Infospace Vector Namespace:** Each `Infospace` defines its embedding model and dimension, creating an isolated search space.
-   **Hybrid Search:** Queries combine vector similarity search (on `AssetChunk.embedding`) with structured SQL filters on `Asset` or `Annotation` metadata.
-   **Graph Search (Optional):** If a graph database (e.g., Neo4j) is integrated, `AnalysisAdapter`s can populate it, and APIs can expose graph traversal/query capabilities (e.g., Cypher, SPARQL).
-   **Cross-Modal Search:** Search results can include assets based on annotations from any modality (e.g., find documents where images contain specific objects).

### 3.5 Automation & Reliability (`Task` Model)

-   **Scheduled Ingestion:** `Task` of type `INGEST` with a cron `schedule` and `Source` ID in `configuration` polls the source and ingests new data.
-   **Scheduled Annotation:** `Task` of type `ANNOTATE` with a cron `schedule` and `AnnotationRun` template (target assets/bundle, schemas, run config) in `configuration` automatically creates and starts new `AnnotationRun`s. This is the second step in the search-to-insight pipeline, processing assets collected by an `INGEST` task.
-   **Health & Reliability:** Tasks track `last_run_at`, `consecutive_failure_count`, and can be configured to auto-pause after a set number of failures.

### 3.6 Collaboration & Sharing

-   **`Bundle`s:** Support multi-user tagging, comments (future).
-   **`Package`s:** Export immutable snapshots of `Asset`s, `Annotation`s, `Justification`s, and `AnalysisAdapter` results, with a manifest for audit and offline use.
-   **`ShareableLink`s:** Control access to resources (`Bundle`, `Package`, `Asset`, `AnnotationRun`) with permissions (`READ_ONLY`, `EDIT`), expiry, and max-uses.

### 3.7 Security & Compliance

-   **Row-Level Security:** All major tables are implicitly scoped by `infospace_id` through relationships, enforced at the service/API layer.
-   **Encryption:** Binary `Asset`s stored via `StorageProvider` should use server-side encryption (e.g., S3 SSE).
-   **Audit Trail:** Database triggers or application-level logging for critical mutations (future).
-   **GDPR Compliance:** Deletion of an `Asset` should trigger a cascade delete or anonymization of linked `AssetChunk`s, `Annotation`s, and `Justification`s.

---

## 4. Data & Analysis Flow Examples

**Scenario 1: PDF Policy Analysis & Label Counting**

1.  **Ingest:** User uploads a PDF.
    *   `Source` worker creates parent `Asset` (PDF) and child `Asset`s (pages).
    *   `AssetChunk`s are created from page text and vectorized.
2.  **Annotate (Document-Level Stance):**
    *   User defines `AnnotationSchema` "StanceDetector" (`output_contract: {"document": {"stance": "string"}}`).
    *   Creates `AnnotationRun`, targeting the parent PDF `Asset` and "StanceDetector" schema.
    *   Backend processes run: LLM determines stance, creates `Annotation` (e.g., `value: {"stance": "Positive"}`).
3.  **Annotate (Page-Level Quotes):**
    *   User defines `AnnotationSchema` "QuoteExtractor" (`output_contract: {"per_page": {"quotes": ["string"]}}`).
    *   Creates `AnnotationRun`, targeting parent PDF `Asset` and "QuoteExtractor" schema.
    *   Backend processes run: LLM extracts quotes from each page `Asset`, creates multiple `Annotation`s (e.g., one per page, `value: {"quotes": ["...", "..."]}`).
4.  **Analyze (Count Stances):**
    *   User configures `label_distribution_adapter`:
        *   `target_run_id`: ID of the "StanceDetector" run.
        *   `target_schema_id`: ID of "StanceDetector" schema.
        *   `label_field_key`: `"stance"`
    *   Backend executes adapter, returns distribution: `[{"value": "Positive", "count": X}, ...]`.
    *   Frontend displays this in a pie chart.

**Scenario 2: CSV Time-Series Analysis with LLM-derived Timestamp**

1.  **Ingest:** User uploads CSV of news articles.
    *   `Source` worker creates parent `Asset` (CSV file) and child `Asset`s (rows).
    *   Row text `AssetChunk`s are created and vectorized.
2.  **Annotate (Extract Event Time & Sentiment):**
    *   User defines `AnnotationSchema` "EventTimeSentiment" (`output_contract: {"document": {"actual_event_time": "string", "sentiment_score": "number"}}`).
    *   Creates `AnnotationRun` targeting the CSV parent `Asset` (or specific row `Asset`s) and "EventTimeSentiment" schema.
    *   Backend processes run: LLM populates `Annotation.value.actual_event_time` and `Annotation.value.sentiment_score` for each row.
3.  **Analyze (Time-Series Sentiment):**
    *   User configures `time_series_aggregation_adapter`:
        *   `target_run_id`: ID of "EventTimeSentiment" run.
        *   `target_schema_id`: ID of "EventTimeSentiment" schema.
        *   `timestamp_source_field`: `"annotation_value.actual_event_time"`
        *   `value_field_key`: `"sentiment_score"`
        *   `aggregation_functions`: `["avg", "count"]`
        *   `time_bucket`: `"day"`
        *   `split_by_source_id`: `true`
    *   Backend executes adapter, returns time-series data.
    *   Frontend displays sentiment trend chart.

**Scenario 3: Automated Search, Annotation, and Alerting Pipeline**

1.  **Configure Search as a Source:** User creates a `Source` of `kind="search"`. The `details` field contains `{"search_config": {"query": "threats against public infrastructure", "provider": "tavily"}}`.
2.  **Configure Collection Bundle:** User creates an empty `Bundle` named "Infrastructure Threat Monitoring".
3.  **Task 1: Ingest from Search:** User creates a recurring `Task` of type `INGEST`.
    *   `schedule`: `"0 */2 * * *"` (Every 2 hours).
    *   `configuration`: `{"target_source_id": <ID of search source>, "target_bundle_id": <ID of bundle>}`.
    *   *Execution*: The task runs, executes the search, scrapes the top results, creates new `Asset`s, and adds them to the "Infrastructure Threat Monitoring" `Bundle`.
4.  **Task 2: Annotate New Assets:** User creates a second recurring `Task` of type `ANNOTATE`.
    *   `schedule`: `"15 */2 * * *"` (Runs 15 mins after the ingest task).
    *   `configuration`: An `AnnotationRun` template targeting the "Infrastructure Threat Monitoring" `Bundle` ID and a "ThreatAssessment" `AnnotationSchema`.
    *   *Execution*: The task runs, finds the new assets in the bundle, and executes the annotation run, producing annotations with fields like `threat_score` and `category`.
5.  **Analyze for Alerts:** User (or a third task) executes the `alerting_adapter` on demand.
    *   `config`: 
        ```json
        {
          "target_run_id": <ID of the latest run from Task 2>,
          "alert_conditions": [{
            "name": "High Priority Threat",
            "field": "threat_score",
            "condition": {"operator": ">=", "value": 0.9}
          }]
        }
        ```
    *   *Result*: The adapter returns a list of any assets whose `threat_score` exceeded the threshold, completing the automated search-to-insight pipeline.

**Scenario 4: Multi-Modal Article Analysis with Cross-Modal Reasoning**

1.  **Ingest:** User uploads an article with embedded images.
    *   `Source` worker creates parent `Asset` (article) and child `Asset`s (images).
    *   Text chunks and image metadata are stored.
2.  **Annotate (Cross-Modal Entity Analysis):**
    *   User defines `AnnotationSchema` "ArticleEntityAnalysis" with hierarchical structure:
        ```json
        {
          "output_contract": {
            "document": {
              "primary_entity": "string",
              "sentiment": "string",
              "entity_mentions": [{"name": "string", "role": "string"}]
            },
            "per_image": {
              "detected_people": [{
                "bounding_box": {"x": "number", "y": "number", "width": "number", "height": "number"},
                "label": "string",
                "matched_entity": "string"
              }],
              "relevance_to_article": "string"
            }
          }
        }
        ```
    *   Creates `AnnotationRun` with `configuration: {"include_images": true, "enable_thinking": true}`.
    *   Backend assembles full context (article text + all images) and sends to LLM.
    *   LLM analyzes both text and images together, identifying that "Secretary Smith" in text corresponds to the person at the podium in image.
    *   Creates parent `Annotation` with document-level fields and child `Annotation`s for each image.
3.  **Justification with Cross-Modal Evidence:**
    *   Each annotation includes justifications referencing both text and images:
        ```json
        {
          "reasoning": "Identified as Secretary Smith based on text reference and podium position",
          "evidence_payload": {
            "text_spans": [{"start": 245, "end": 289, "text": "Secretary Smith stepped to the podium"}],
            "image_regions": [{"asset_uuid": "img_123", "bbox": {"x": 120, "y": 80, "width": 150, "height": 200}}],
            "thinking_trace": "The person at the podium matches the Secretary Smith mentioned in paragraph 3..."
          }
        }
        ```

---

## 5. Backend Code Structure Overview (`app/` directory)

This outlines the intended organization for backend components.

```
app/
├── models.py               # All SQLModel definitions
├── schemas.py              # All Pydantic API request/response schemas
├── core/                   # Core application logic (config, db, security, celery)
│   ├── config.py
│   ├── db.py
│   ├── security.py
│   ├── celery_app.py
│   └── beat_utils.py         # (Or a refactored beat_service.py)
├── api/
│   ├── main.py             # FastAPI app instantiation, main router includes
│   ├── deps.py             # FastAPI dependency injectors
│   ├── routes/             # API Endpoints (FastAPI routers)
│   │   ├── users.py
│   │   ├── login.py
│   │   ├── infospaces.py
│   │   ├── sources.py
│   │   ├── assets.py
│   │   ├── bundles.py
│   │   ├── annotation_schemas.py
│   │   ├── annotation_runs.py
│   │   ├── annotations.py
│   │   ├── tasks.py            # For CRUD on Task model for automation
│   │   ├── packages.py         # Routes for package operations if any, distinct from service
│   │   ├── shareables.py
│   │   ├── analysis_adapters_admin.py  # CRUD for AnalysisAdapter registration (admin)
│   │   ├── analysis_execution.py     # Endpoint to run adapters (e.g., POST /analysis/{adapter_name}/execute)
│   │   ├── datasets.py
│   │   ├── filestorage.py
│   │   ├── healthcheck.py
│   │   ├── recurring_tasks.py  # For the RecurringTask model specifically if different from general Task
│   │   ├── search_history.py
│   │   └── utils.py
│   ├── services/           # Business Logic Layer
│   │   ├── __init__.py
│   │   ├── infospace_service.py
│   │   ├── ingestion_service.py    # Handles `Source` creation, ingestion of initial `Asset`s (including file processing), and manages `Source`-`Asset` relationships (e.g., export, import, transfer of sources with their assets).
│   │   ├── asset_service.py        # Handles Asset CRUD and logic
│   │   ├── bundle_service.py
│   │   ├── annotation_service.py # Handles AnnotationSchema, AnnotationRun, Annotation, Justification (**Enhanced for multi-modal**)
│   │   ├── task_service.py         # Manages Task entities (automation definitions)
│   │   ├── recurring_tasks_service.py # Logic for RecurringTask model if distinct
│   │   ├── package_service.py      # Contains PackageService, PackageBuilder, PackageImporter
│   │   ├── shareable_service.py
│   │   ├── analysis_service.py     # May orchestrate adapter loading/validation if complex
│   │   ├── dataset_service.py      # Service for Dataset operations
│   │   └── service_utils.py
│   ├── providers/          # External Service Integrations & Protocols
│   │   ├── __init__.py
│   │   ├── base.py             # Abstract Protocols (StorageProvider, ClassificationProvider (**updated for multi-modal**), GeospatialProvider, etc.)
│   │   ├── factory.py          # Factory functions (create_storage_provider, create_classification_provider, etc.)
│   │   └── impl/               # Concrete provider implementations directory
│   │       ├── __init__.py
│   │       ├── storage_minio.py
│   │       ├── classification_gemini_native.py  # **Updated to handle media_inputs**
│   │       ├── classification_opol.py           # **Updated to align with new interface**
│   │       ├── scraping_opol.py
│   │       ├── search_opol.py
│   │       ├── geospatial_opol.py  # Moved from providers/geospatial.py
│   │       └── ... (other concrete provider files)
│   ├── analysis/           # Analysis Engine Components
│   │   ├── __init__.py
│   │   ├── protocols.py        # Defines AnalysisAdapterProtocol
│   │   └── adapters/           # Concrete Analysis Adapter Implementations
│   │       ├── __init__.py
│   │       ├── label_distribution_adapter.py
│   │       ├── time_series_adapter.py
│   │       ├── alerting_adapter.py               # **New adapter for conditional alerting**
│   │       ├── cross_modal_correlation_adapter.py  # **New adapter for cross-modal analysis**
│   │       └── ... (other adapter classes)
│   └── tasks/                # Celery Tasks (definitions of background jobs)
│       ├── __init__.py
│       ├── annotate.py         # **Enhanced to handle multi-modal assembly and demultiplexing**
│       ├── ingest.py           # (Was ingestion_tasks.py - Celery tasks for processing DataSources)
│       ├── scheduling.py       # (Was scheduling_tasks.py - e.g. check_recurring_tasks)
│       └── utils.py            # Celery task utilities (**includes create_pydantic_model_from_json_schema**)
```

---

## 6. Performance Targets (Aspirational)

| Metric                    | Target                      |
| ------------------------- | --------------------------- |
| Cold ingest throughput    | 100 MB/min per worker       |
| ANN query P95 latency     | < 200 ms for 1 M vectors    |
| Annotation throughput     | 50 req/min per GPU instance (model dependent) |
| Multi-modal annotation    | 20 req/min per GPU instance (larger context windows) |
| Adapter execution (avg)   | < 5s for typical aggregations on 10k annotations |
| Bundle load (10k assets)  | < 1s API response (metadata only) |

---

## 7. Multi-Modal Annotation Implementation Guide (Implicit Linking & Enhanced Justifications)

This section summarizes the current implementation for multi-modal annotations, emphasizing the system-driven, user-friendly approach to linking and justifications. For a detailed operational flow, refer to `backend/app/api/MULTIMODAL_IMPLEMENTATION_HANDOVER.md`.

### 7.1 Core Principles & User Experience

*   **User Simplicity:** Users define `AnnotationSchema.output_contract` focusing on desired analytical outputs (e.g., image descriptions, sentiment scores) without managing child asset UUIDs or writing complex mapping instructions.
*   **System Automation:** The backend transparently handles:
    *   Linking analysis of child media (images, audio) to the correct child `Asset`.
    *   Facilitating detailed, structured justifications for LLM outputs, including typed evidence payloads.

### 7.2 Key Backend Mechanisms

1.  **Schema Definition (User):**
    *   Uses hierarchical keys in `output_contract` (e.g., `document`, `per_image`).
    *   **No manual UUID fields** (e.g., `image_asset_uuid`) are needed in `per_modality.items` schemas.
    *   `instructions` focus on the analytical task.
    *   Justification behavior is controlled via `AnnotationSchema.field_specific_justification_configs` and `AnnotationRun.configuration.justification_mode`.

2.  **Context Assembly (`assemble_multimodal_context`):**
    *   Parent asset's UUID is explicitly included in the text prompt: `Parent Document (UUID: {parent_asset.uuid})...`.
    *   Each child media item in the LLM context includes its `uuid`.

3.  **Dynamic Pydantic Model Augmentation (`create_pydantic_model_from_json_schema`):**
    *   **Internal UUID Field:** Injects `_system_asset_source_uuid: Optional[str]` into the Pydantic model for items within `per_modality` arrays.
    *   **Justification Fields:** Injects `fieldName_justification: Optional[JustificationSubModel]` for fields requiring justification, based on run/schema configuration. `JustificationSubModel` supports `reasoning` and typed evidence (`TextSpanEvidence`, `ImageRegionEvidence`, etc.).

4.  **Automated Prompt Injection (`process_annotation_run`):**
    *   **For UUID Mapping:** Appends system instructions for the LLM to populate `_system_asset_source_uuid` using the UUID from the input context for each media item.
    *   **For Justifications:** Appends system instructions for populating `JustificationSubModel`, including `reasoning` and structured evidence (guiding `asset_uuid` usage for `TextSpanEvidence` etc.).

5.  **Result Processing (`demultiplex_results`):**
    *   **Mapping:** Exclusively uses `_system_asset_source_uuid` from LLM output to link per-modality analysis to the correct child `Asset`.
    *   **Stripping:** Removes `_system_asset_source_uuid` before storing the result in `Annotation.value`.
    *   **Storage:** `Annotation.value` stores user-defined fields and their associated `fieldName_justification` objects.
    *   No positional fallback for mapping.

6.  **Overall `_thinking_trace`:** Stored in a separate `Justification` DB object linked to the parent `Annotation` if `thinking_config.include_thoughts` is true and a trace is provided.

### 7.3 Example `AnnotationRun.configuration` for Multi-Modal & Justifications:

```json
{
  "model": "gemini-1.5-pro",
  "include_images": true,
  "max_images_per_asset": 5,
  "justification_mode": "SCHEMA_DEFAULT", // Or "ALL_WITH_GLOBAL_PROMPT", "NONE", etc.
  "default_justification_prompt": "Explain your reasoning for the value of '{field_name}'. Include supporting evidence if possible.",
  // "global_justification_prompt": "For every field, provide a detailed justification and evidence.",
  "thinking_config": { "include_thoughts": true }
}
```

### 7.4 Key Considerations & Robustness

*   **LLM Adherence:** Critical for the LLM to follow system-generated instructions for `_system_asset_source_uuid` and `JustificationSubModel` structure.
*   **Provider-Side Pydantic Validation:** Highly beneficial (e.g., Gemini's `response_schema`) for ensuring correctly formatted structured output from the LLM.
*   **Clear System Prompts:** System-appended prompts for UUID mapping and evidence structure are designed for clarity.
*   **Evidence UUIDs:** The system enables correct `asset_uuid` attribution in `TextSpanEvidence` (for parent document or potentially child OCR text) and `ImageRegionEvidence`/`AudioSegmentEvidence` (for child media) by providing all necessary UUIDs in the LLM's input context.

This revised approach significantly streamlines the user experience for multi-modal schema definition while maintaining a high degree of power and robustness in the backend.

### 7.5 Frontend UI Considerations (Reiteration)

-   **Schema Builder:** UI to define `field_specific_justification_configs` (enable/disable per field, set custom prompts) on an `AnnotationSchema`.
-   **Run Configuration:** UI to select `justification_mode` and provide `default_justification_prompt` or `global_justification_prompt`.
-   **Result Viewer:** UI needs to inspect `Annotation.value` for `fieldName_justification` fields and display them alongside the primary field data.

---

## 8. Extensibility Roadmap

| Version | Theme                  | Planned Features                                                                                                 |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------- |
| v0.2    | **Multi-Modal Foundation** | Hierarchical schema support. Cross-modal annotation. Enhanced justification structure.                          |
| v0.3    | **Graph Foundation**   | Robust `Annotation.links`. `graph_builder_adapter` (basic co-occurrence). API for node/edge queries.              |
| v0.4    | **Realtime & Streaming**| Websocket `Source` worker. Near-realtime annotation triggers from `Asset` creation. Streaming adapter outputs.   |
| v0.5    | **Advanced Adapters**  | Temporal reasoning adapter. Cross-modal linking adapter. More sophisticated entity resolution.                    |
| v0.6    | **Full Justification UX**| Frontend UIs to fully explore `Justification.evidence_payload` (text highlighting, image region display, audio playback with segments).      |
| v1.0    | **Policy & Audit**     | Comprehensive audit logs. Data retention policies. Multi-region replication options.                             |

---

## 9. Open Questions & Future Considerations

1.  **Fine-grained ACLs:** Access control for individual `Asset`s or `Annotation`s within an `Infospace`.
2.  **Multi-Sheet Spreadsheets:** Current model treats CSVs as one table. How to best represent/ingest multi-sheet Excel/ODS? (Child `Asset`s per sheet, then rows?)
3.  **Advanced `AnalysisAdapter` Configuration UI:** How to best present complex adapter configurations (e.g., conditional logic, multi-field mapping) to users?
4.  **Billing & Resource Quotas:** Metrics for charging (per Asset, vector, AnnotationRun, adapter execution) and enforcing limits.
5.  **Global vs. Infospace-Specific `AnalysisAdapter`s:** Should adapters be globally registered or can users define private ones per `Infospace`? (Current model suggests global registration).
6.  **Standardizing `Justification.evidence_payload`:** Defining common schemas for evidence types (text span, bounding box, asset link) for easier parsing by frontend and other adapters.
7.  **Live/Collaborative Annotation:** Support for multiple users annotating the same asset simultaneously.
8.  **Adapter Output Caching & Versioning:** How to cache results of long-running adapters and handle re-runs if input data or adapter logic changes.
9.  **Video Frame Sampling:** For video assets, how to intelligently sample frames for annotation rather than processing every frame?
10. **Cross-Modal Embedding Strategies:** Should we create unified embeddings that capture both text and visual features for better semantic search?

---

> **Status:** Updated 2024-11-XX (Deep Thought Edition - Rev. 3 - Multi-Modal Enhancement)
>
> **Owners:** Core Architecture Squad
