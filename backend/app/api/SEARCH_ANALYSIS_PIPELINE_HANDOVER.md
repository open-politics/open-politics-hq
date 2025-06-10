# Handover: Integrated Search & Analysis Pipeline

**Date:** November 22, 2023

**Purpose:** This document outlines the architecture and integration of the automated search-to-insight pipeline. It explains how recurring searches are treated as data sources and how their results are ingested, annotated, and analyzed for alerts using the system's core, reusable components.

---

## 1. Concept: The Feature Circle

This feature completes the "feature circle" of the OSINT platform, creating a seamless, automated pipeline from data discovery to actionable insight. The core concept is to treat **a recurring search not as a special function, but as just another `Source` of data**.

This elegant approach avoids creating new, single-purpose components and instead leverages the full power and flexibility of the existing system architecture. The pipeline consists of three logical, decoupled stages:

1.  **Ingest:** A recurring `INGEST` task polls a "search" `Source` to discover new information.
2.  **Annotate:** A recurring `ANNOTATE` task enriches the newly discovered `Asset`s with structured data using the multi-modal AI engine.
3.  **Analyze:** A flexible `AnalysisAdapter` is used to analyze the structured annotations for specific patterns, conditions, or threats, generating alerts.

This loosely coupled, highly integrated workflow is powerful, scalable, and easy to extend.

---

## 2. Integration & Workflow (No New Routes)

A key design principle of this feature is its deep integration into the existing system. **No new API routes are required.** The entire pipeline is configured and managed by creating and linking existing `Source`, `Bundle`, and `Task` entities.

Here is the step-by-step user workflow:

### Step 1: Configure the Data Funnel

1.  **Create a Search `Source`:**
    *   `POST /api/v1/infospaces/{infospace_id}/sources`
    *   Create a `Source` with `kind: "search"`.
    *   The configuration for the search is placed in the `details` field.
    *   **Feature Fields:**
        *   `details.search_config.query`: The search string.
        *   `details.search_config.provider`: The search provider to use (e.g., "opol_searxng", "tavily").
        *   `details.search_config.max_results`: Number of results to fetch.
        *   `details.search_config.params`: Provider-specific parameters.

2.  **Create a Collection `Bundle`:**
    *   `POST /api/v1/infospaces/{infospace_id}/bundles`
    *   Create an empty `Bundle`. This will serve as the collection point for all assets discovered by the search.

### Step 2: Automate the Pipeline

1.  **Create the `INGEST` Task:**
    *   `POST /api/v1/infospaces/{infospace_id}/tasks`
    *   Create a `Task` with `type: "INGEST"`.
    *   **Feature Fields:**
        *   `schedule`: A cron string (e.g., `"0 */2 * * *"` for every 2 hours).
        *   `configuration.target_source_id`: The ID of the "search" `Source` created above.
        *   `configuration.target_bundle_id`: The ID of the collection `Bundle`.

2.  **Create the `ANNOTATE` Task:**
    *   `POST /api/v1/infospaces/{infospace_id}/tasks`
    *   Create a second `Task` with `type: "ANNOTATE"`.
    *   **Feature Fields:**
        *   `schedule`: A cron string offset from the ingest task (e.g., `"15 */2 * * *"`).
        *   `configuration`: An `AnnotationRun` template that specifies:
            *   `target_bundle_id`: The ID of the collection `Bundle`.
            *   `schema_ids`: A list of `AnnotationSchema` IDs to apply to the new assets.

### Step 3: Analyze for Alerts

1.  **Execute the `alerting_adapter`:**
    *   `POST /api/v1/analysis/alerting_adapter/execute`
    *   This can be done manually via the UI or automated with a third task.
    *   **Feature Fields:**
        *   `config.target_run_id`: The ID of the latest `AnnotationRun` created by the `ANNOTATE` task.
        *   `config.alert_conditions`: A list of conditions to check against the annotation results. Each condition specifies a `field`, `operator`, and `value`.

---

## 3. Key Components & System Coupling

This feature is **loosely coupled by design**, as it orchestrates existing, independent components. This makes it robust and easy to maintain.

| Component | Role in Pipeline | Coupling & Key Files |
| :--- | :--- | :--- |
| **`Source` Model** | Defines the search query and parameters. Acts as the entry point for the pipeline. | **Loosely Coupled.** The system just needs to know how to read the `details.search_config` field. <br> • `backend/app/models.py` |
| **`ingest_recurringly.py`** | The Celery worker that executes `INGEST` tasks. It has been enhanced to understand the "search" source kind, run the search, and orchestrate scraping and asset creation. | **Tightly Integrated** with `Source` and `Asset` models. This is the primary engine for the ingestion stage. <br> • `backend/app/api/tasks/ingest_recurringly.py` |
| **`Bundle` Model** | Acts as the "inbox" or collection point, connecting the ingestion stage to the annotation stage. | **Loosely Coupled.** The `ingest` task simply links new assets to it. The `annotate` task simply reads from it. <br> • `backend/app/models.py` |
| **`annotate.py`** | The Celery worker for `ANNOTATE` tasks. It reads assets from the target bundle and enriches them. No changes were needed here; it works as designed. | **Tightly Integrated** with the multi-modal annotation engine. <br> • `backend/app/api/tasks/annotate.py` |
| **`alerting_adapter.py`** | A new, flexible analysis adapter that checks for alert conditions. It is completely decoupled from the search/ingestion process. | **Loosely Coupled.** It conforms to the `AnalysisAdapterProtocol` and can run on *any* annotation run, not just those from this pipeline. <br> • `backend/app/api/analysis/adapters/alerting_adapter.py` <br> • `backend/app/api/analysis/protocols.py` <br> • `backend/app/api/routes/analysis.py` |

---

## 4. Summary

This feature provides a powerful, automated intelligence pipeline by composing the system's core architectural strengths. By treating a search as a `Source` and an alert as an `AnalysisAdapter`, we avoid monolithic, special-purpose code and create a more flexible, scalable, and maintainable system. 