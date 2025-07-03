# Handover: Graph Analysis & GraphRAG Implementation Plan

**Date:** November 28, 2023

**Purpose:** This document outlines the concrete implementation plan for the Graph Analysis and Graph-Retrieval Augmented Generation (GraphRAG) features. It is designed to be a self-contained guide for the next developer or AI model to execute the tasks required to meet our grant deliverables.

---

## 1. Core Architecture & Strategy

The chosen strategy is the **"Lightweight Graph-as-Annotation"** approach. This design is optimal for speed of implementation and minimizes technical debt by perfectly aligning with the existing system architecture.

**The core principles are:**

1.  **Graph Extraction is an Annotation Task:** We will not create a new, special-purpose service for graph creation. Instead, we use a standard `AnnotationRun` with a specifically designed `AnnotationSchema` to instruct an LLM to extract graph data.
2.  **Isolate Complexity in Adapters:** All complex logic for graph aggregation, analysis, and querying will be encapsulated in new, decoupled `AnalysisAdapter`s. This prevents any changes to the core services (`annotation_service`, `asset_service`, etc.).
3.  **No New Database Dependencies:** The entire feature will be built on the existing PostgreSQL database. Graph data ("fragments") will be stored in the `Annotation.value` JSONB field, and the adapters will process this data on the fly.

This approach is fast, robust, and leverages the most powerful and flexible parts of our current system.

---

## 2. Implementation Steps

The work is divided into three main components that build upon each other: the schema, the aggregation adapter for visualization, and the RAG adapter for querying.

### **Component 1: The `KnowledgeGraphExtractor` Schema (Already Implemented)**

This is the foundation of the feature.

*   **File:** `backend/app/core/initial_data.py`
*   **Purpose:** To instruct an LLM to extract "graph fragments"—a list of entities (nodes) and their relationships (triplets/edges)—from a single document.
*   **Status:** **COMPLETE.** The `KNOWLEDGE_GRAPH_SCHEMA` has already been defined and is loaded into the database on application startup. No further action is needed on this component.

**Workflow for a user:**
1. User selects a `Bundle` of assets.
2. User initiates an `AnnotationRun`, selecting the "Knowledge Graph Extractor" schema.
3. The system processes each asset, creating one `Annotation` per asset containing its unique graph fragment.

---

### **Component 2: The `graph_aggregator_adapter` (Task for Next Model)**

This adapter is the key to the **"Graph Observation Tooling"** deliverable. It aggregates all the individual graph fragments from a run into a single, cohesive graph for visualization.

*   **Action:** Create a new file: `backend/app/api/analysis/adapters/graph_aggregator_adapter.py`.
*   **Purpose:** To be called by the frontend to get a complete, renderable graph from an annotation run.
*   **Input (`config` object):**
    ```json
    {
      "target_run_id": 123,
      "target_schema_id": 456 // The ID of the KNOWLEDGE_GRAPH_SCHEMA
    }
    ```
*   **Output (JSON, compatible with `react-flow`):**
    ```json
    {
      "nodes": [
        { "id": "1", "data": { "label": "Innovatech Corp", "type": "COMPANY" } },
        { "id": "2", "data": { "label": "Dr. Evelyn Hayes", "type": "PERSON" } }
      ],
      "edges": [
        { "id": "e1-2", "source": "2", "target": "1", "label": "works for" }
      ]
    }
    ```
*   **Implementation Steps:**
    1.  Create the new file `graph_aggregator_adapter.py`.
    2.  Implement a class `GraphAggregatorAdapter` that conforms to the `AnalysisAdapterProtocol`.
    3.  In the `execute` method:
        a. Fetch all `Annotation` objects for the `target_run_id` and `target_schema_id`.
        b. Initialize a dictionary for nodes (`all_nodes = {}`) to handle deduplication and a list for edges (`all_edges = []`).
        c. Loop through each `annotation.value`:
            i.  For each `entity` in `annotation.value['entities']`, add it to `all_nodes`. Use the entity's name and type as a key to prevent duplicates.
            ii. For each `triplet` in `annotation.value['triplets']`, create an edge object using the source and target IDs.
        d. Convert the `all_nodes` dictionary into a list of node objects for the final output.
        e. Return the final `{"nodes": ..., "edges": ...}` structure.

---

### **Component 3: The `graph_rag_adapter` (Task for Next Model)**

This adapter delivers the **"GraphRAG"** feature, allowing for natural language querying.

> **📋 UPDATE:** The embedding infrastructure is now complete! See `EMBEDDING_IMPLEMENTATION_HANDOVER.md` for details. The `EmbeddingService` and vector search capabilities are ready to use.

*   **Action:** Create a new file: `backend/app/api/analysis/adapters/graph_rag_adapter.py`.
*   **Purpose:** To answer a user's natural language question based on facts retrieved from the generated graph fragments.
*   **Input (`config` object):**
    ```json
    {
      "target_run_id": 123,
      "target_schema_id": 456,
      "question": "Which people work for Innovatech Corp?",
      "embedding_model_id": 1,
      "top_k": 5
    }
    ```
*   **Output (JSON):**
    ```json
    {
      "answer": "Dr. Evelyn Hayes works for Innovatech Corp.",
      "retrieved_context": "Entities: [Dr. Evelyn Hayes (PERSON), Innovatech Corp (COMPANY)]. Triplets: [Dr. Evelyn Hayes -> works for -> Innovatech Corp].",
      "sources": [...],
      "retrieval_stats": {...}
    }
    ```
*   **Implementation Steps:**
    1.  Create the new file `graph_rag_adapter.py`.
    2.  Implement a class `GraphRagAdapter` conforming to the `AnalysisAdapterProtocol`. 
    3.  In the `execute` method:
        a. **Vector Retrieve:** Use the new `EmbeddingService.similarity_search()` to find the top K most relevant asset chunks using the `question`.
        b. **Fetch Graph Context:** Get the `Annotation` objects (containing the graph fragments) that correspond to these retrieved assets.
        c. **Assemble Context:** Convert the entities and triplets from the fetched annotations into a concise text block.
        d. **Augmented Generation:** Call the `ClassificationProvider` (the LLM) with a prompt combining the assembled context and the user's question.
        e. Return the LLM's answer, context used, sources, and retrieval statistics.

---

### **Component 4: Registering the New Adapters (Task for Next Model)**

To make the system aware of these new adapters, they must be registered in the database at startup.

*   **Action:** Modify the `init_db` function in `backend/app/core/db.py`.
*   **Implementation Steps:**
    1.  After the schemas are created, add a new section to check for and create the `AnalysisAdapter` records.
    2.  For each new adapter (`graph_aggregator_adapter`, `graph_rag_adapter`), create an `AnalysisAdapter` entry in the database.
    3.  The `name` should match the adapter's class/file name (e.g., "graph_aggregator_adapter").
    4.  The `module_path` must be the full Python path to the class (e.g., `app.api.analysis.adapters.graph_aggregator_adapter.GraphAggregatorAdapter`).
    5.  Define a simple `input_schema_definition` for each adapter's configuration.

---

## Summary of Work for Next Contributor

1.  **Create `backend/app/api/analysis/adapters/graph_aggregator_adapter.py`** and implement the aggregation logic as described above.
2.  **Create `backend/app/api/analysis/adapters/graph_rag_adapter.py`** and implement the retrieval-augmented generation logic.
3.  **Modify `backend/app/core/db.py`** to add the two new `AnalysisAdapter` records to the database during initialization.

This plan provides a clear, robust, and minimally invasive path to delivering the required graph features. 