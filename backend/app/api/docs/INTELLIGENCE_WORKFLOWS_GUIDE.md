# Intelligence Workflows & Composition Guide

> **Status:** 📝 **Design & Planning**  
> **Purpose:** A detailed guide for building higher-level intelligence workflows, including reports, fragment curation, and compositional AI patterns. This document serves as the blueprint for the next development sprint.

---

## 🎯 **Core Philosophy: From Primitives to Composition**

The backend architecture is now mature, providing a robust set of primitives: content ingestion, asset management, annotation, and search. The next evolution of the platform is to enable the **composition** of these primitives into sophisticated, multi-step intelligence workflows.

This guide outlines an architecture where **the AI, guided by an analyst, acts as an orchestrator**, chaining together the platform's capabilities to synthesize knowledge and create durable intelligence artifacts.

We will introduce two core concepts:
1.  **The Report**: A new, first-class intelligence artifact that synthesizes information from multiple sources.
2.  **Fragment Curation**: A formal mechanism for promoting transient analysis results into permanent, queryable facts on assets.

---

## 🏗️ **Part 1: The "Report" as a First-Class Citizen**

### **Concept: A Report is an Asset**

Instead of creating a new, complex `Report` model with its own services, routes, and logic, we will adopt a more elegant and extensible pattern: **A Report is simply an `Asset` of `AssetKind.ARTICLE`**.

This architectural decision is crucial for maintainability and extensibility. By treating a report as a specialized type of asset, it automatically inherits the full suite of capabilities available to all assets:

-   **Searchable**: Reports will be chunked, embedded, and discoverable via semantic and keyword search.
-   **Analyzable**: A report can itself become the target of a new `AnnotationRun` (e.g., for fact-checking, bias assessment, or further summarization).
-   **Composable**: Reports can be added to `Bundle`s alongside their source materials.
-   **Portable**: They can be shared and exported using the existing package system.
-   **Versioned**: Changes to a report can be tracked using the `previous_asset_id` linkage.

### **Implementation Details**

**1. Model Layer:**
No changes are required to the `Asset` model in `models.py`. We will leverage existing fields:
-   `kind`: Set to `AssetKind.ARTICLE`.
-   `text_content`: Will store the main body of the report (e.g., the LLM-generated summary).
-   `source_metadata`: This field is key for **provenance**. It will be structured to store references to the sources used to generate the report.

**`source_metadata` Schema for Reports:**
```json
{
  "composition_type": "report",
  "created_by": "chat_session" or "pipeline_xyz",
  "source_asset_ids": [101, 102, 105],
  "source_bundle_ids": [10],
  "source_run_ids": [20],
  "generation_config": {
    "model_name": "gemini-2.5-flash-preview-05-20",
    "prompt_template": "Summarize findings about X..." 
  }
}
```

**2. Service Layer:**
A new method will be added to the `ContentIngestionService` to encapsulate the logic of creating a report.

**File:** `backend/app/api/services/content_ingestion_service.py`
```python
# Add to ContentIngestionService class
def create_report(
    self,
    user_id: int,
    infospace_id: int,
    title: str,
    content: str,
    source_asset_ids: Optional[List[int]] = None,
    source_bundle_ids: Optional[List[int]] = None,
    source_run_ids: Optional[List[int]] = None,
    generation_config: Optional[Dict[str, Any]] = None
) -> Asset:
    """Creates a new Asset of kind ARTICLE to represent a report."""
    validate_infospace_access(self.session, infospace_id, user_id)

    source_metadata = {
        "composition_type": "report",
        "created_by": "user_action", # Could be enhanced to show "chat" or "pipeline"
        "source_asset_ids": source_asset_ids or [],
        "source_bundle_ids": source_bundle_ids or [],
        "source_run_ids": source_run_ids or [],
        "generation_config": generation_config or {}
    }

    report_asset_create = AssetCreate(
        title=title,
        kind=AssetKind.ARTICLE,
        text_content=content,
        user_id=user_id,
        infospace_id=infospace_id,
        source_metadata=source_metadata
    )
    
    report_asset = self.asset_service.create_asset(report_asset_create)
    logger.info(f"Report '{title}' (Asset ID: {report_asset.id}) created successfully.")
    return report_asset
```

**3. API Layer (Chat Tool):**
We will introduce a new tool that the `IntelligenceConversationService` can execute.

**File:** `backend/app/api/services/conversation_service.py`
```python
# Add to get_universal_tools method
{
    "type": "function",
    "function": {
        "name": "create_report",
        "description": "Creates a new report asset from a title and content. Use this to synthesize findings from multiple sources into a durable intelligence product.",
        "parameters": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "The title of the report."},
                "content": {"type": "string", "description": "The full text content of the report."},
                "source_asset_ids": {"type": "array", "items": {"type": "integer"}, "description": "A list of asset IDs used as sources for this report."},
                "source_bundle_ids": {"type": "array", "items": {"type": "integer"}, "description": "A list of bundle IDs used as sources for this report."},
                "source_run_ids": {"type": "array", "items": {"type": "integer"}, "description": "A list of annotation run IDs used as sources for this report."}
            },
            "required": ["title", "content"]
        }
    }
}

# Add to execute_tool_call method
elif tool_name == "create_report":
    return self.content_ingestion_service.create_report(
        user_id=user_id,
        infospace_id=infospace_id,
        title=arguments["title"],
        content=arguments["content"],
        source_asset_ids=arguments.get("source_asset_ids"),
        source_bundle_ids=arguments.get("source_bundle_ids"),
        source_run_ids=arguments.get("source_run_ids")
    )
```

---

## 🧩 **Part 2: Evolving Fragment Curation**

### **Concept: Promoting Annotations to Facts**

Fragment Curation is the process of elevating a specific piece of data from a transient `Annotation` into a durable, canonical fact stored on an `Asset`'s metadata. This turns a collection of assets into a structured knowledge base. We will support two distinct curation workflows.

### **Workflow A: Automated Promotion via Pipelines**

This pattern is for when a specific annotation field should always overwrite a core asset field.

**Implementation: `PromoteFieldAdapter`**

We will create a new `AnalysisAdapter` designed for this purpose.

1.  **Adapter Code**:
    **File**: `backend/app/api/analysis/adapters/promote_field_adapter.py`
    ```python
    class PromoteFieldAdapter(AnalysisAdapterProtocol):
        async def execute(self) -> Dict[str, Any]:
            source_field = self.config["source_field"]
            target_field = self.config["target_field"]
            run_id = self.config["run_id"]
            
            annotations = self.session.exec(select(Annotation).where(Annotation.run_id == run_id)).all()
            
            updated_assets = 0
            for ann in annotations:
                if source_field in ann.value:
                    asset = self.session.get(Asset, ann.asset_id)
                    if asset and hasattr(asset, target_field):
                        setattr(asset, target_field, ann.value[source_field])
                        self.session.add(asset)
                        updated_assets += 1
            
            self.session.commit()
            return {"updated_assets": updated_assets, "source_field": source_field, "target_field": target_field}
    ```

2.  **Pipeline Configuration**:
    ```json
    {
      "step_order": 2,
      "step_type": "ANALYZE",
      "name": "Promote Event Date",
      "configuration": {
        "adapter_name": "PromoteFieldAdapter",
        "adapter_config": {
          "source_field": "event_date",
          "target_field": "event_timestamp"
        }
      },
      "input_source": {"source": "FROM_STEP", "step_order": 1}
    }
    ```

### **Workflow B: Manual Curation via Chat**

This pattern allows an analyst (human or AI) to make a judgment call and curate a specific piece of information.

**Implementation: `curate_asset_fragment` Tool**

1.  **Chat Tool Definition**:
    **File**: `backend/app/api/services/conversation_service.py`
    ```python
    # Add to get_universal_tools method
    {
        "type": "function",
        "function": {
            "name": "curate_asset_fragment",
            "description": "Saves a specific piece of information as a permanent, curated 'fragment' on an asset's metadata. Use this to record key facts, summaries, or conclusions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "asset_id": {"type": "integer"},
                    "field_name": {"type": "string", "description": "A descriptive key for the fragment, e.g., 'executive_summary' or 'key_finding'."},
                    "value": {"type": "string", "description": "The information to be curated."}
                },
                "required": ["asset_id", "field_name", "value"]
            }
        }
    }
    ```

2.  **Service Logic**: The key here is to maintain an audit trail. A manual curation should not just be a direct database write. It must be auditable.
    **File**: `backend/app/api/services/annotation_service.py`
    ```python
    # Add new method to AnnotationService
    def curate_fragment(self, user_id: int, infospace_id: int, asset_id: int, field_name: str, value: Any) -> Annotation:
        """Creates an auditable record for a manual curation action."""
        # 1. Create a special "Curation" schema if it doesn't exist
        schema_name = "Manual Curation"
        schema = self.session.exec(select(AnnotationSchema).where(AnnotationSchema.name == schema_name)).first()
        if not schema:
            schema = self.create_annotation_schema(...) # Create a generic schema

        # 2. Create a dedicated AnnotationRun for this single action
        run_name = f"Curation on Asset {asset_id} at {datetime.now(timezone.utc).isoformat()}"
        run = self.create_run(user_id, infospace_id, AnnotationRunCreate(name=run_name, schema_ids=[schema.id], target_asset_ids=[asset_id]))

        # 3. Create the annotation that represents the curated fact
        annotation = self.create_annotation(
            asset_id=asset_id,
            schema_id=schema.id,
            run_id=run.id,
            user_id=user_id,
            infospace_id=infospace_id,
            value={field_name: value}
        )
        
        # 4. (Optional but Recommended) A system-level pipeline could listen for these
        #    curation runs and automatically promote the fragment to the asset metadata.
        #    For now, we can do it directly.
        asset = self.session.get(Asset, asset_id)
        if asset:
            fragments = asset.fragments or {}
            fragments[field_name] = {
                "value": value,
                "source_ref": f"annotation_run:{run.id}",
                "curated_by_ref": f"user:{user_id}",
                "timestamp": datetime.now(timezone.utc).isoformat()
            }
            asset.fragments = fragments
            self.session.add(asset)
            self.session.commit()

        return annotation
    ```

---

## 🚀 **Part 3: The Intelligence Sandbox - Compositional Workflows**

With these new tools, the chat becomes a powerful compositional interface.

**Detailed Example Workflow:**

1.  **Analyst**: *"Find all reports from the 'Weekly Briefings' bundle related to 'Project Nightfall' and summarize them for me."*

2.  **AI's Internal Monologue & Actions**:
    *   **Goal**: Find assets, then summarize.
    *   **Action 1**: `list_bundles()` -> Finds that "Weekly Briefings" is Bundle ID `15`.
    *   **Action 2**: `search_assets(query='Project Nightfall', bundle_id=15)` -> Finds Asset IDs `[101, 108, 112]`.
    *   **Action 3**: `analyze_assets(asset_ids=[101, 108, 112], schema_id=42)` (where schema 42 is a "Summarization" schema) -> This kicks off `AnnotationRun` #55.
    *   **Response to User**: *"I have found 3 relevant reports and started a summarization task (Run #55). This may take a moment. I will notify you when it is complete."*

3.  **(After a short delay)**

4.  **AI's Internal Monologue & Actions**:
    *   **Goal**: Get the summaries and create a final report.
    *   **Action 1**: `get_annotations(run_id=55)` -> Retrieves the three summary annotations.
    *   **Internal Synthesis**: The AI processes the three summaries in its context window, creating a meta-summary.
    *   **Action 2**: `create_report(title="Project Nightfall - Weekly Synthesis", content="...", source_asset_ids=[101, 108, 112], source_run_ids=[55])` -> Creates `Asset` #120, a new `ARTICLE`.
    *   **Response to User**: *"The summarization is complete. I have created a final report (Asset #120) with the synthesized findings. Here is the summary: ... Would you like me to curate this as the official weekly briefing for 'Project Nightfall'?"*

5.  **Analyst**: *"Yes, please."*

6.  **AI's Internal Monologue & Actions**:
    *   **Goal**: Curate the summary onto the Project Nightfall bundle.
    *   **Action**: `curate_bundle_fragment(bundle_id=15, field_name="latest_briefing", value="...")` (A logical extension of our asset fragment tool).
    *   **Response to User**: *"Done. The summary has been curated as the 'latest_briefing' on the 'Weekly Briefings' bundle."*

This workflow demonstrates a move from simple Q&A to a truly interactive and productive partnership between the analyst and the AI, where the AI is actively creating and curating intelligence within the platform.


