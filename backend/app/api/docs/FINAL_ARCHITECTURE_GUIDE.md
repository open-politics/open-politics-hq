## Final Architecture & Workflow Guide

> **Status:** ✅ **Complete & Production Ready**  
> **Purpose:** Final handover document detailing the unified service architecture and the new intelligence workflow capabilities.

---

### 1. **Core Architecture: A Unified Service Layer**

The backend architecture is built on a **unified service layer** that provides clear separation of concerns and promotes extensibility.

-   **`ContentIngestionService`**: The single entry point for all content. It handles discovery (from search, URLs), ingestion (files, text), and processing (scraping, parsing). It is the foundation of the data pipeline.
-   **`AnnotationService`**: The core of the analysis engine. It manages the entire lifecycle of annotation, from creating `AnnotationRun`s to processing them with AI models and storing the structured `Annotation` results. It also handles result aggregation and the auditable curation of fragments.
-   **`IntelligenceConversationService`**: The brain of the chat interface. It orchestrates all tool calls, delegating tasks to other services and enabling complex, multi-step analyses through conversation.
-   **Provider Abstractions**: External dependencies like AI models (`ModelRegistryService`), storage (`StorageProvider`), and search (`SearchProvider`) are abstracted behind clean interfaces, making the system modular and easy to extend.

### 2. **New Intelligence Primitives**

This sprint introduced two powerful new concepts that elevate the platform from a simple analysis tool to a true intelligence factory.

#### A. The Report as an Asset

-   **Concept**: A "Report" is not a new, complex model. It is simply an `Asset` of `AssetKind.ARTICLE`.
-   **Benefits**: This elegant pattern allows reports to automatically inherit all asset capabilities: they are searchable, analyzable, can be added to bundles, and can be shared/exported.
-   **Provenance**: The `source_metadata` of a report asset contains a rich audit trail, linking it directly to the source `assets`, `bundles`, and `annotation_runs` that were used to generate it.
-   **Implementation**: A new `create_report` tool is available to the `IntelligenceConversationService`, allowing the AI to synthesize findings and create these durable intelligence artifacts.

#### B. Auditable Fragment Curation

-   **Concept**: Fragment Curation is the formal process of promoting a piece of data from a transient `Annotation` to a permanent, canonical "fact" on an `Asset`.
-   **Two Workflows**:
    1.  **Automated Curation**: The new `PromoteFieldAdapter` can be used in `IntelligencePipeline`s to automatically promote a specific annotation field (e.g., an extracted date) to a core field on the asset (e.g., `event_timestamp`).
    2.  **Manual Curation**: The new `curate_asset_fragment` chat tool allows an analyst (or the AI itself) to save a key finding directly to an asset's `fragments` metadata.
-   **Auditability**: Both workflows are fully auditable. The pipeline's `AnnotationRun` logs the automated promotion, while the `AnnotationService` creates a dedicated, system-level `AnnotationRun` to record every manual curation act.

### 3. **The Intelligence Sandbox: Compositional Workflows**

The true power of this architecture lies in the **composition** of these primitives. The chat interface is no longer just for Q&A; it's an interactive environment where the AI can act as a research assistant, chaining tools together to perform complex, multi-step analysis.

**Example Workflow:**

1.  The AI uses `search_assets` to find relevant documents.
2.  It uses `analyze_assets` to run a "Summarization" schema over them.
3.  It uses `get_annotations` to retrieve the summaries from the completed run.
4.  It synthesizes these summaries and calls `create_report` to generate a new, high-level intelligence document.
5.  Finally, it can use `curate_asset_fragment` to promote the report's key conclusion as a permanent fact on a relevant asset or bundle.

This demonstrates a complete intelligence cycle—from raw data to curated knowledge—orchestrated through a conversational interface.

### 4. **API Key Management Strategy**

-   **Current**: The system uses server-side environment variables, suitable for system tasks and superuser access.
-   **Path Forward**: The architecture is designed to support a "Bring Your Own Key" (BYOK) model. Future work will involve:
    -   Accepting user-provided API keys via secure HTTP headers.
    -   Passing these keys down to the `ModelRegistryService`.
    -   Instantiating temporary, request-scoped provider clients with the user's key, ensuring that user keys are never stored on the server.

### 5. **Conclusion & Next Steps**

The backend is now architecturally complete and production-ready. The service layer is consolidated, performant, and extensible. The documentation is updated and provides a clear guide for future development.

The next logical step is to **generate the frontend client**. The backend API is stable and provides all the necessary endpoints and data structures to build a rich, interactive, and powerful user interface for the Open Politics HQ intelligence platform.


