---
title: "Intelligence Workflows Guide"
description: "Learn how to compose the platform's core capabilities into powerful, multi-step intelligence workflows, from automated analysis to generating final reports."
---

## The Compositional Workflow

The true power of the Open Politics HQ platform lies in the **composition** of its core primitives. The chat interface is not just a tool for asking questions; it's an interactive **Intelligence Sandbox**. Here, an analyst or an AI-powered agent can chain together tools to perform complex, multi-step analyses, transforming raw data into curated knowledge.

This guide details the high-level concepts and workflows that enable this process.

---

## New Intelligence Primitives

Two new concepts elevate the platform from a simple analysis tool to a true intelligence factory: **Reports as Assets** and **Auditable Fragment Curation**.

### 1. Reports as Assets

Instead of introducing a complex, new data model, a "Report" is simply an `Asset` of type `ARTICLE`. This elegant pattern allows reports to automatically inherit the full suite of `Asset` capabilities.

<CardGroup cols={2}>
  <Card title="Searchable & Analyzable" icon="search">
    Reports are chunked, embedded, and discoverable. They can even be the target of *new* analysis runs for fact-checking or further summarization.
  </Card>
  <Card title="Composable & Portable" icon="cubes">
    Reports can be added to `Bundles`, versioned, and shared or exported using the platform's standard package system.
  </Card>
</CardGroup>

- **Full Provenance**: The `source_metadata` of a report `Asset` contains a rich audit trail, linking it directly to the source `Assets`, `Bundles`, and `AnnotationRuns` used to generate it.
- **AI-Enabled Creation**: The `create_report` tool is available to the `IntelligenceConversationService`, allowing the AI to synthesize findings from multiple sources and create a durable intelligence artifact.

### 2. Auditable Fragment Curation

**Fragment Curation** is the formal process of promoting a piece of information from a transient `Annotation` to a permanent, canonical "fact" stored on an `Asset`'s metadata. This turns your collection of documents into a structured, queryable knowledge base.

<Tabs>
<Tab title="Automated Curation">
  The `PromoteFieldAdapter` can be used in an `IntelligencePipeline` to automatically promote a specific field from an annotation (e.g., an extracted `event_date`) to a core field on the parent `Asset` (e.g., `event_timestamp`). This is ideal for routine data standardization.
</Tab>
<Tab title="Manual & AI Curation">
  The `curate_asset_fragment` chat tool allows a human analyst or an AI agent to save a key finding, summary, or conclusion directly to an `Asset`'s `fragments`. This is perfect for capturing insights that require human judgment.
</Tab>
</Tabs>

<Info>
**Complete Auditability**: Both curation workflows are fully auditable. Automated promotions are logged in the pipeline's `AnnotationRun`, while the `AnnotationService` creates a dedicated, system-level `AnnotationRun` to record every manual curation act, ensuring complete traceability.
</Info>

---

## Example: The Full Intelligence Cycle

This workflow demonstrates how an AI research assistant can use these primitives to go from a high-level request to a final, curated intelligence product, all orchestrated through the conversational interface.

<Steps>
<Step title="1. Discovery">
  The user asks a high-level question. The AI uses the `search_assets` tool to find a set of relevant documents.

  ```
  User: "Find documents about next-generation battery technology and summarize the main research trends."
  AI -> search_assets(query="next-generation battery technology")
  ```
</Step>
<Step title="2. Analysis">
  The AI identifies a "Summarization" `AnnotationSchema` and uses the `analyze_assets` tool to run it on the documents found in the previous step. This creates a new `AnnotationRun`.

  ```
  AI -> analyze_assets(asset_ids=[101, 108, 115], schema_id=42)
  ```
</Step>
<Step title="3. Synthesis">
  Once the `AnnotationRun` is complete, the AI uses the `get_annotations` tool to retrieve the individual summaries. It then synthesizes these summaries into a single, coherent overview.
</Step>
<Step title="4. Report Generation">
  The AI calls the `create_report` tool, providing a title, the synthesized content, and the IDs of the source `Assets` and the `AnnotationRun` for provenance. This creates a new, durable `Asset` for the report.

  ```
  AI -> create_report(
    title="Next-Generation Battery Research Trends",
    content="Solid-state batteries are...",
    source_asset_ids=[101, 108, 115],
    source_run_ids=[55]
  )
  ```
</Step>
<Step title="5. Curation">
  Finally, the AI promotes the report's key conclusion as a permanent fact on a relevant, high-level `Asset` or `Bundle` using the `curate_asset_fragment` tool.

  ```
  AI -> curate_asset_fragment(
    asset_id=205, // e.g., an Asset representing the 'Battery Technology' topic
    field_name="key_finding_2024",
    value="The main trend is the shift towards solid-state electrolytes for improved safety and energy density."
  )
  ```
</Step>
</Steps>

---

## API Key Management

-   **Current State**: The system uses server-side environment variables for API keys, which is suitable for system-level tasks and superuser access.
-   **Future Direction**: The architecture is designed to support a "Bring Your Own Key" (BYOK) model. Future work will enable users to provide their own API keys via secure HTTP headers. These keys will be used for the duration of the request and **never stored on the server**, ensuring user privacy and security.

## Conclusion

The backend is architecturally complete and production-ready. The service layer is consolidated, the intelligence primitives are powerful and extensible, and the documentation provides a clear path for future development. The next logical step is to build the frontend client that will leverage this robust and flexible backend.


