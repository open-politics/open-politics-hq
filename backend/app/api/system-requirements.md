--- a/backend/app/api/v2/system-requirements.md
+++ b/backend/app/api/v2/system-requirements.md
@@ -1,60 +1,114 @@
-
-
-1. Broad Vector Stores
-2. Specific Scrape Jobs
-3. Search & Ingest
-4. Classify, Stor
+# System Design Overview
 
-Engines
-Quick Search:
-Result: Lists of Entries
-- Opol (Open Politics Data Engine)
-- SearXng (OSS Google, Wikipedia Proxy)
-- Tavily (Proprietary Engine)
-- OWLER (EU Webindex)
+This document outlines the high-level design and components of the backend system.
 
---> Press into one unified Ingestion Format
-
--Classification
--via Natural Language "Pydantic Models"
--Model-Field Architecture
--Result Types:
--- int
--- List[str]
--- Dict[str, any]
--- ...
+## Core Concepts
 
--Classification(BaseModel):
-    """ What is the top location and the content relevance?"""
-    topLoc: str = Field(description="Main Geo Entity")
-    relevance: int = Field(description="From a political news perspective, 1-10")
+The system is designed to ingest data from various sources, classify it according to user-defined schemas, and allow users to manage, analyze, and share this information within isolated workspaces.
 
-input = "Your input text here"
+1.  **Workspaces:** Provide multi-tenant isolation. Each user operates within one or more workspaces. DataSources, Schemes, and Jobs are scoped to a specific Workspace.
+2.  **Data Ingestion:**
+    *   **DataSources:** Represent a source of data (e.g., a collection of scraped URLs, an uploaded CSV/PDF, a block of text).
+    *   **DataRecords:** Individual pieces of text content extracted from a DataSource (e.g., a single scraped article, a row from a CSV, a chunk from a PDF).
+    *   **Ingestion Process:** Triggered upon DataSource creation. Background tasks process the source (scrape URLs, parse files), extract text, and create corresponding DataRecords.
+3.  **Classification:**
+    *   **ClassificationSchemes:** User-defined structures defining the desired output format for classifying text. Consists of one or more `ClassificationFields`.
+    *   **ClassificationFields:** Define the name, description, data type (`str`, `int`, `List[str]`, `List[Dict]`), constraints (e.g., min/max for `int`, labels for `List[str]`), and optional LLM instructions for a specific piece of information to be extracted.
+    *   **ClassificationJobs:** Represent the execution of one or more Schemes against one or more DataSources. Jobs are processed asynchronously.
+    *   **ClassificationResults:** Store the output of applying a specific Scheme to a single DataRecord within the context of a Job.
+4.  **Asynchronous Processing:** Long-running operations like data ingestion and classification jobs are handled by Celery background workers.
+5.  **Recurring Tasks:** Users can define recurring tasks to automatically ingest data (e.g., re-scrape URLs) or run classification jobs on new data.
+6.  **Sharing & Collaboration:** Users can create shareable links for Workspaces, DataSources, Schemes, and Jobs with configurable permissions (read-only, edit) and access control (public, requires login).
+7.  **Import/Export:** Workspaces, DataSources, Schemes, and Jobs can be exported to JSON format and imported into other workspaces (or shared as files).
 
--classification_result = opol.classify(Classification, "No extra instruction", input)
+## Key Components & Data Flow
 
--assert isinstance(classification_result, Classification)
+1.  **User Interaction (via API):**
+    *   Users manage `Workspaces`.
+    *   Users create `DataSource`s (providing URLs, uploading files, pasting text).
+    *   Users define `ClassificationScheme`s with `ClassificationField`s.
+    *   Users create `ClassificationJob`s, specifying target `DataSource`(s) and `ClassificationScheme`(s).
+    *   Users create `RecurringTask`s for ingestion or classification.
+    *   Users create `ShareableLink`s to share resources.
+    *   Users export/import resources.
+    *   Users query `DataRecord`s and `ClassificationResult`s.
+2.  **Ingestion Workflow:**
+    *   `DataSource` creation triggers an ingestion task (`app.tasks.ingestion.process_datasource`).
+    *   Task uses `IngestionService`:
+        *   Retrieves source details (URLs, file path).
+        *   Uses `ScrapingProvider` or file parsing logic (PDF, CSV) to get text.
+        *   Uses `StorageProvider` to read uploaded files.
+        *   Creates `DataRecord`(s) for extracted content.
+        *   Updates `DataSource` status.
+3.  **Classification Workflow:**
+    *   `ClassificationJob` creation triggers a classification task (`app.tasks.classification.process_classification_job`).
+    *   Task uses `ClassificationService`:
+        *   Fetches `ClassificationJob` details, target `DataRecord`s, and `ClassificationScheme`s.
+        *   For each Record/Scheme pair:
+            *   Calls `ClassificationProvider` via `ClassificationService.classify_text`.
+            *   Creates `ClassificationResult` via `ClassificationService.create_results_batch`.
+        *   Updates `ClassificationJob` status.
+4.  **Recurring Task Workflow:**
+    *   Celery Beat runs `app.tasks.scheduling.check_recurring_tasks` periodically.
+    *   Task identifies due `RecurringTask`s.
+    *   Dispatches appropriate worker task (`app.tasks.recurring_ingestion` or `app.tasks.recurring_classification`).
+    *   Recurring tasks typically create new `DataRecord`s or trigger new `ClassificationJob`s via the respective services.
+5.  **Sharing Workflow:**
+    *   User creates `ShareableLink` via `ShareableService`.
+    *   Another user/system accesses resource via token (`GET /api/shareables/access/{token}`).
+    *   `ShareableService` validates token, checks permissions/login requirements, fetches the resource using the appropriate service (`IngestionService`, `ClassificationService`, `WorkspaceService`), records usage, and returns resource data.
+6.  **Export/Import Workflow:**
+    *   **Export:** User requests export -> `ShareableService.export_resource` -> Calls relevant service (`IngestionService.export_datasource`, etc.) -> Service generates JSON data -> `ShareableService` writes to temp file -> Route returns `FileResponse`.
+    *   **Import:** User uploads file -> `ShareableService.import_resource` saves to temp file -> Parses JSON, identifies resource type -> Calls relevant service (`IngestionService.import_datasource`, etc.) -> Service creates new DB entities in the target workspace.
 
--Creating structured data types via nlp pydantic models. A regular "response" or question answering would be a string field. Quotes and similar would be complex dicts.
+## Extensibility
 
---> Classifying system working on any text-based content. In last instance everything can be collapsed into pure text input. Lots of articles, csv rows, pdf files or raw scrapes.
+*   **Providers:** New external services (storage, LLMs, scrapers, search engines) can be integrated by implementing the corresponding Provider interface in `app/api/services/providers/base.py` and updating the factory function.
+*   **DataSource Types:** New data source types can be added by:
+    1.  Adding to the `DataSourceType` enum in `models.py`.
+    2.  Implementing processing logic in `app.tasks.ingestion.process_datasource`.
+    3.  Updating `IngestionService` and API routes if needed.
+*   **Classification Field Types:** New output field types can potentially be added by:
+    1.  Adding to `FieldType` enum.
+    2.  Updating the Pydantic model generation logic in the `ClassificationProvider`.
+    3.  Ensuring the frontend can handle/display the new type.
 
--+ Certain special extractions like locations or timestamps (asking to model to find it from the text) result in special analysis and display options. Int (numeric dimensions), str (plain setence,  single word or abstract answers) and List[str] (often labels or quotes). Sorting via numerics, counting labels, using locations or using timestamps to place it correctly for time-series analysis.
-
-
--Ingestion:
--Works from a model where a data source can hold many data records. This allows for a upload of multiple pdfs, scraping multple urls, or unrolling data from a csv.
-
--Ingestion schould also be considered in a queue-worker based way like celery to allow special recurring tasks. At the moment this is only limitied to patterns of executing search and ingestion tasks.
--Either a url list specified by the user, a search through search engines (resulting in url lists) in data sources would create new records according to the results of scheduled re-fetching.
-
--Tasks like searching ingestion and classification should be manageable packed into classes. We need to swiftly integrate new engines. The first difficulty is pressing many result formats into one.
-
--Afterwards our classification system will need to recieve a unified adapter.
-
--The results are standardisable because they are just the same as what pydantic models can yield as results.
-
--The results are analysable in the frontend. But we need to be able to share data sources, schemas and runs/ results to others. Analysis/ research operations need to be transparently transferable and retraceble so every analysis becomes evidence.
-
--Our tasks/ functions should be executable in a framework of organised operations. A search could be user initiated or packed as a task of a running data operation.
--A task should be ad-hoc callable, run regularly or invoked as an llm tool call. So async it is. 