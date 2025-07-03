# Multi-Modal Annotation with Implicit Linking & Enhanced Justifications - Handover

**Date:** November 21, 2023 (Revised)

**Purpose:** This document details the current OSINT Kernel system architecture for multi-modal annotations. It focuses on the implicit, system-managed linking of analysis results to child assets and the enhanced capabilities for structured, field-specific justifications including evidence payloads.

## 1. Core Principle: User Simplicity, System Power

The primary goal is to simplify the multi-modal schema definition experience for users. Users should focus on the analytical outputs they desire, while the system transparently handles the complexities of:
*   Linking analysis of child media (images, audio clips) back to the correct child `Asset`.
*   Facilitating detailed, structured justifications for LLM outputs, including evidence.

## 2. Implicit Child Asset Linking Workflow

Users no longer need to define UUID fields for child media in their schemas or write instructions for the LLM to return these UUIDs.

**Key System Steps:**

1.  **User Schema Definition (Simplified):**
    *   In `AnnotationSchema.output_contract`, users define fields for `document` (parent asset) and `per_<modality>` sections (e.g., `per_image`, `per_audio`).
    *   Within `per_<modality>.items` (the schema for a single child media item), users **do not** include any fields like `image_asset_uuid`.
    *   User `instructions` focus purely on the analytical task.

2.  **Context Assembly (`assemble_multimodal_context` in `annotate.py`):**
    *   The parent asset's text content is prepended with a header clearly stating its UUID: `Parent Document (UUID: {parent_asset.uuid})\n---\n{text_content}`. This makes the parent UUID available for evidence linking.
    *   Child media items (images, audio) are fetched. Each item passed to the LLM context includes its own `uuid` (e.g., `Media Item 1: (Type: image, Title: ..., UUID: child-asset-uuid-123)`).

3.  **Dynamic Pydantic Model Augmentation (`create_pydantic_model_from_json_schema` in `utils.py`):**
    *   When generating the Pydantic model for items within a `per_<modality>` array (e.g., for a single image's analysis), the system **internally injects an `_system_asset_source_uuid: Optional[str]` field**.
    *   This field is invisible to the user during schema definition.

4.  **Automated Prompt Injection (`process_annotation_run` in `annotate.py`):**
    *   A system-level instruction is **automatically appended** to the user's prompt.
    *   This instruction directs the LLM to:
        *   Populate the `_system_asset_source_uuid` field in its output for each per-modality item.
        *   Use the exact UUID string provided in the input context for that specific media item as the value.
        *   This is emphasized as critical for correct data mapping.

5.  **LLM Processing:** The LLM receives the combined instructions and context, and generates output matching the augmented Pydantic model (including `_system_asset_source_uuid` for per-modality items and any justification fields).

6.  **Result Demultiplexing & Cleaning (`demultiplex_results` in `annotate.py`):**
    *   **Mapping:** For `per_modality` results, the system **exclusively** uses the `_system_asset_source_uuid` value from the LLM's output to link the analysis to the correct child `Asset` in the database (matching `Asset.uuid`, `parent_asset_id`, and `kind`).
    *   **Stripping:** After successful mapping, the `_system_asset_source_uuid` field is **removed** from the data dictionary for that item.
    *   **Storage:** The cleaned data dictionary (containing only user-defined analytical fields and any generated justification structures) is saved in `Annotation.value`.
    *   If `_system_asset_source_uuid` is missing or invalid, the item is skipped, and an error is logged. Positional fallback is no longer used.

## 3. Field-Specific Justifications & Evidence Payloads

The system provides robust support for field-specific justifications, allowing the LLM to explain its reasoning and provide structured evidence.

**Key System Steps:**

1.  **User Configuration:**
    *   **`AnnotationSchema.field_specific_justification_configs`**: Users can define per-field justification behavior:
        *   `enabled: bool`: Whether justification is sought for this field.
        *   `custom_prompt: Optional[str]`: A specific prompt for the LLM on how to justify this field.
    *   **`AnnotationRun.configuration`**:
        *   `justification_mode: str`: Controls overall strategy (e.g., "NONE", "SCHEMA_DEFAULT", "ALL_WITH_GLOBAL_PROMPT", "ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT").
        *   `default_justification_prompt: Optional[str]`: Template for default justification instructions (e.g., "Explain your reasoning for {field_name}.").
        *   `global_justification_prompt: Optional[str]`: Used if `justification_mode` is "ALL_WITH_GLOBAL_PROMPT".

2.  **Pydantic Model Augmentation (`create_pydantic_model_from_json_schema`):**
    *   Based on `justification_mode` and `field_specific_justification_configs`, the system determines which user-defined fields require justification.
    *   For each such field (e.g., `summary`), it injects a corresponding justification field (e.g., `summary_justification: Optional[JustificationSubModel]`) into the Pydantic model for the LLM.
    *   `JustificationSubModel` (defined in `schemas.py`) is structured to hold:
        *   `reasoning: Optional[str]`
        *   `text_spans: Optional[List[TextSpanEvidence]]`
        *   `image_regions: Optional[List[ImageRegionEvidence]]`
        *   `audio_segments: Optional[List[AudioSegmentEvidence]]`
        *   `additional_evidence: Optional[Dict[str, Any]]`

3.  **Prompt Engineering for Justifications (`process_annotation_run`):**
    *   The system identifies fields needing justification (iterating through properties from `schema_structure`).
    *   It assembles detailed instructions for the LLM, including:
        *   General structural guidance for `JustificationSubModel` (how to populate `reasoning`, `text_spans`, `image_regions`, etc.).
        *   Specific prompts for each `reasoning` field, derived from custom, global, or default settings.
        *   Guidance for evidence:
            *   `TextSpanEvidence`: Instructs to use `asset_uuid` (which can be the parent document's UUID now available in the prompt, or a child asset's UUID if applicable), `start_char_offset`, `end_char_offset`, `text_snippet`.
            *   `ImageRegionEvidence`: Instructs to use `asset_uuid` (the UUID of the specific child image asset) and `bounding_box` (with `x, y, width, height, label`).
            *   `AudioSegmentEvidence`: Instructs to use `asset_uuid` (the UUID of the specific child audio asset), `start_time_seconds`, `end_time_seconds`.
    *   These justification instructions are appended to the main prompt.

4.  **LLM Output & Storage:**
    *   The LLM populates the augmented schema, including the `fieldName_justification` objects with `reasoning` and structured evidence.
    *   This entire structure (user fields + their justifications) is stored in `Annotation.value`.

5.  **Overall `_thinking_trace`:**
    *   If `thinking_config.include_thoughts` is true and the provider returns a `_thinking_trace`, a single, separate `Justification` DB object is created (linked to the parent/document `Annotation`) to store this high-level reasoning. This is the *only* use of the separate `Justification` table.

## 4. Robustness of Evidence Payload Handling

Assuming the LLM correctly adheres to the (now more detailed) system-generated prompts for structuring evidence:

*   **`TextSpanEvidence.asset_uuid`**:
    *   **Enhanced by Parent UUID in Prompt:** The `assemble_multimodal_context` function now prepends the parent asset's UUID to the main text content (e.g., `Parent Document (UUID: parent-uuid)...`).
    *   The system prompts for justifications now guide the LLM to use this parent UUID when `asset_uuid` in `TextSpanEvidence` refers to the main document.
    *   If a text span were hypothetically derived from OCR of a child image (future capability), the LLM would use the child image's UUID (which it also sees in its context: `Media Item X (UUID: child-uuid)...`).
    *   **Robustness:** High, as the relevant UUIDs (parent and child) are directly available in the LLM's context.

*   **`ImageRegionEvidence.asset_uuid`**:
    *   The LLM is prompted to use the UUID of the specific child image asset it's analyzing (which is provided in its input context: `Media Item X (UUID: child-image-uuid)...`).
    *   **Robustness:** High, direct mapping.

*   **`ImageRegionEvidence.bounding_box`**:
    *   This relies on the LLM's capability to generate structured `BoundingBox` data (`x, y, width, height, label`) as per the `BoundingBox` Pydantic model defined in `schemas.py`.
    *   **Robustness:** Dependent on LLM's adherence to the nested JSON structure. The use of Pydantic models server-side for validation by the provider (like Gemini) significantly helps ensure correct formatting.

*   **`AudioSegmentEvidence.asset_uuid`**: Similar to image regions, the LLM uses the specific child audio asset's UUID.
    *   **Robustness:** High, direct mapping.

*   **Overall Structure of `JustificationSubModel`**:
    *   The `demultiplex_results` function takes the LLM's output (which should match the augmented Pydantic model including `JustificationSubModel` instances) and stores it in `Annotation.value`.
    *   **Robustness:** High for storage, as long as the LLM's output for the `fieldName_justification` field is a valid JSON representation of `JustificationSubModel`. Provider-side Pydantic validation is key here.

**Key Dependencies for Robust Evidence:**

1.  **LLM Adherence:** The LLM must reliably follow the detailed system-generated instructions for populating `_system_asset_source_uuid` and the fields within `JustificationSubModel`, including the correct `asset_uuid` for evidence.
2.  **Provider-Side Pydantic Validation:** If the LLM provider (e.g., Gemini with `response_schema`) validates its output against the (augmented) Pydantic model, this greatly increases the likelihood of receiving correctly structured justifications and evidence.
3.  **Clear System Prompts:** The system-appended prompts regarding evidence structure must be unambiguous.

The current setup, with explicit UUIDs in the LLM context and detailed system prompting for evidence structure, provides a strong foundation for robust evidence payload handling, assuming reliable LLM performance.

## 5. Summary of Modified Components & Workflow

*   **`initial_data.py`:** User-defined schemas simplified (no manual UUID fields for child media).
*   **`utils.py` (`create_pydantic_model_from_json_schema`):** Injects `_system_asset_source_uuid` and `fieldName_justification: JustificationSubModel` into Pydantic models for the LLM.
*   **`annotate.py` (`assemble_multimodal_context`):** Adds parent asset UUID to the main text prompt.
*   **`annotate.py` (`process_annotation_run`):**
    *   Injects system instructions for LLM to populate `_system_asset_source_uuid`.
    *   Injects detailed system instructions for LLM to populate `JustificationSubModel` (reasoning, evidence types with UUID guidance).
    *   Correctly identifies fields needing justification prompts.
*   **`annotate.py` (`demultiplex_results`):**
    *   Uses `_system_asset_source_uuid` for mapping child media results.
    *   Strips `_system_asset_source_uuid` before saving to `Annotation.value`.
    *   Stores the entire user-defined field value along with its `fieldName_justification` (if present) in `Annotation.value`.

This revised workflow streamlines the user experience while enhancing the system's internal capabilities for accurate multi-modal analysis and detailed, evidenced justifications.