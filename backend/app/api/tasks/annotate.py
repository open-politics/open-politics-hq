"""Tasks for handling annotations."""
import logging
from typing import List, Dict, Any, Type, Optional, TYPE_CHECKING
from datetime import datetime, timezone
from celery import shared_task
from sqlmodel import Session, select
from sqlalchemy import func
import asyncio # Added for running async functions
import traceback # Added for exception handling

from app.models import (
    Annotation,
    AnnotationSchema,
    Asset,
    AssetKind,
    Bundle,
    RunStatus,
    AnnotationRun,
    ResultStatus,
    Justification,
    AnnotationSchemaTargetLevel
)
from app.schemas import AnnotationCreate
from app.core.db import engine
from app.api.providers.factory import create_classification_provider, create_storage_provider
from app.api.tasks.utils import create_pydantic_model_from_json_schema
from app.core.config import settings

if TYPE_CHECKING:
    from app.api.deps import StorageProviderDep # Import StorageProviderDep under TYPE_CHECKING

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

def validate_hierarchical_schema(output_contract: dict) -> bool:
    """Validate that hierarchical schema follows conventions"""
    valid_top_level = {"document", "per_image", "per_audio", "per_video", "per_page"}
    
    # Check if it looks like a hierarchical schema first
    is_hierarchical = any(key.startswith("per_") or key == "document" for key in output_contract.keys())
    has_only_valid_keys = all(key in valid_top_level for key in output_contract.keys() if key.startswith("per_") or key == "document")

    if not is_hierarchical:
        return True # Not hierarchical, so it's valid in this context (treated as flat/document-only)

    # If it is hierarchical, all top-level keys must be from the valid set
    all_keys = set(output_contract.keys())
    standard_keys_present = {key for key in all_keys if key == "document" or key.startswith("per_")}
    non_standard_keys = all_keys - standard_keys_present

    if non_standard_keys:
        logger.warning(f"Schema has mixed hierarchical and potentially flat structure with non-standard keys: {non_standard_keys}. This might be confusing.")
        return False # Contains non-standard top-level keys alongside hierarchical ones
        
    return True

def detect_schema_structure(output_contract: dict) -> dict:
    """Detect which sections apply to which asset types"""
    structure = {
        "document_fields": {},
        "per_modality_fields": {}
    }
    
    for key, value in output_contract.items():
        if key == "document":
            structure["document_fields"] = value
        elif key.startswith("per_"):
            modality = key[4:]  # Extract modality name
            # The `value` here is the schema for the array, so we need `value["items"]` for the item schema
            if isinstance(value, dict) and value.get("type") == "array" and "items" in value:
                structure["per_modality_fields"][modality] = value["items"]
            else:
                logger.warning(f"Per-modality field '{key}' in output_contract is not a valid array schema with items. Skipping for structure detection.")
    
    # If no hierarchical structure, assume all fields are document-level
    if not structure["document_fields"] and not structure["per_modality_fields"]:
        # If no "document" or "per_*" keys, assume the whole output_contract is for the document.
        # And it must be an object schema with properties to be useful here.
        if output_contract.get("type") == "object" and "properties" in output_contract:
            structure["document_fields"] = output_contract
        else: # It's a flat schema but not an object (e.g. just a string type), or empty.
              # In this case, no properties to iterate for justification prompts.
            logger.debug(f"Output contract is flat but not an object with properties. No document fields extracted for justification prompt generation. Contract: {output_contract}")
            
    return structure

async def fetch_asset_content(asset: Asset, storage_provider: 'StorageProviderDep') -> bytes:
    """Fetch asset content from storage using the injected storage_provider."""
    if not asset.blob_path:
        logger.warning(f"Asset {asset.id} has no blob_path. Cannot fetch content.")
        return b""

    logger.info(f"Fetching content for asset {asset.id} from blob_path: {asset.blob_path}")
    try:
        file_stream = await storage_provider.get_file(asset.blob_path)
        # The stream needs to be read. Minio's get_object returns a urllib3.response.HTTPResponse
        # whose `read()` method is synchronous. We need to handle this carefully in an async context.
        # For now, assuming `read()` can be awaited or is non-blocking, or using `asyncio.to_thread` if it's blocking.
        # Let's assume the provider's get_file or the returned stream object handles async reading appropriately
        # or we adapt it. For Minio, response.read() is blocking.
        # A common pattern is to use `asyncio.to_thread` for blocking I/O in async code.
        
        # Simplification: if storage_provider.get_file already returns bytes or an awaitable stream that yields bytes:
        # content = await file_stream.read() # if file_stream has an async read method
        # For Minio, this needs care. Let's assume for now the provider has an async-compatible way to get bytes.
        # If direct async read is not available from the stream object itself, we need a helper.

        # Correct handling for Minio which returns a urllib3.response.HTTPResponse:
        content = await asyncio.to_thread(file_stream.read) 
        file_stream.close() # Important to close the stream
        logger.info(f"Successfully fetched {len(content)} bytes for asset {asset.id}")
        return content
    except FileNotFoundError:
        logger.error(f"File not found in storage for asset {asset.id} at blob_path: {asset.blob_path}")
        return b""
    except Exception as e:
        logger.error(f"Failed to fetch content for asset {asset.id} from {asset.blob_path}: {e}", exc_info=True)
        return b""

async def assemble_multimodal_context(
    parent_asset: Asset,
    run_config: dict,
    db: Session,
    storage_provider: 'StorageProviderDep'
) -> tuple[str, dict]:
    """Assemble text content and media inputs for provider"""
    # Ensure parent_asset.uuid is a string for the prompt
    parent_asset_uuid_str = str(parent_asset.uuid) if parent_asset.uuid else "UNKNOWN_PARENT_ASSET_UUID"
    
    text_content_header = f"Parent Document (UUID: {parent_asset_uuid_str})\n---\n"
    text_content = f"{text_content_header}{parent_asset.text_content or ''}"
    
    media_inputs = []
    
    # Determine if any per_modality processing is expected by the schema to guide media inclusion.
    # This is a simplified check based on run_config flags. A more advanced check could inspect schema_structure.
    # For now, we rely on explicit run_config flags like include_images, include_audio.

    if run_config.get("include_images", False):
        # Query for child assets of kind 'image' or 'pdf_page' if it can act as an image etc.
        # The kind should match what the LLM is expected to process as an image.
        # For now, using a list of common image-like kinds.
        image_like_kinds = [AssetKind.IMAGE, AssetKind.IMAGE_REGION, AssetKind.PDF_PAGE] 
        # Convert AssetKind enum members to their string values for the DB query
        image_like_kind_values = [kind.value for kind in image_like_kinds]

        image_children = db.query(Asset).filter(
            Asset.parent_asset_id == parent_asset.id,
            Asset.kind.in_(image_like_kind_values) 
        ).order_by(Asset.id).all() # Consistent ordering for any positional refs in prompt
        
        for img_asset in image_children[:run_config.get("max_images_per_asset", 10)]:
            image_content_bytes = await fetch_asset_content(img_asset, storage_provider)
            if image_content_bytes:
                media_inputs.append({
                    "uuid": str(img_asset.uuid),
                    "type": "image", 
                    "content": image_content_bytes, 
                    "mime_type": img_asset.source_metadata.get("mime_type", "image/png"),
                    "metadata": {
                        "title": img_asset.title,
                        "original_kind": str(img_asset.kind.value) # e.g. "pdf_page"
                    }
                })
            else:
                logger.warning(f"Skipping image-like asset {img_asset.id} (Kind: {img_asset.kind.value}) due to missing content.")
    
    # Example for audio:
    if run_config.get("include_audio", False):
        audio_like_kinds = [AssetKind.AUDIO, AssetKind.AUDIO_SEGMENT]
        audio_like_kind_values = [kind.value for kind in audio_like_kinds]

        audio_children = db.query(Asset).filter(
            Asset.parent_asset_id == parent_asset.id,
            Asset.kind.in_(audio_like_kind_values)
        ).order_by(Asset.id).all()

        for audio_asset in audio_children[:run_config.get("max_audio_per_asset", 5)]:
            audio_content_bytes = await fetch_asset_content(audio_asset, storage_provider)
            if audio_content_bytes:
                media_inputs.append({
                    "uuid": str(audio_asset.uuid),
                    "type": "audio",
                    "content": audio_content_bytes,
                    "mime_type": audio_asset.source_metadata.get("mime_type", "audio/mpeg"),
                    "metadata": {
                        "title": audio_asset.title,
                        "original_kind": str(audio_asset.kind.value)
                    }
                })
            else:
                logger.warning(f"Skipping audio-like asset {audio_asset.id} (Kind: {audio_asset.kind.value}) due to missing content.")
       
    provider_config_out = {
        "media_inputs": media_inputs,
        "enable_thinking": run_config.get("enable_thinking", False),
        "thinking_budget": run_config.get("thinking_budget", 10000)
    }
    
    return text_content, provider_config_out

async def demultiplex_results(
    result: dict, # This is the raw dict from the LLM provider
    schema_structure: dict, # From detect_schema_structure
    parent_asset: Asset,
    schema: AnnotationSchema, # The AnnotationSchema instance used
    run: AnnotationRun, # The AnnotationRun instance
    db: Session
) -> list[Annotation]:
    """Map hierarchical results back to appropriate assets"""
    annotations = []
    
    # Create annotation for parent asset from document fields
    if schema_structure["document_fields"] and "document" in result:
        parent_annotation_value = result["document"]
        if isinstance(parent_annotation_value, dict):
            parent_annotation = Annotation(
                asset_id=parent_asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value=parent_annotation_value,
                status=ResultStatus.SUCCESS,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            annotations.append(parent_annotation)
        else:
            logger.warning(f"LLM result for 'document' in Run {run.id}, Asset {parent_asset.id} was not a dict. Got: {type(parent_annotation_value)}. Skipping parent annotation.")
    
    for modality, _ in schema_structure["per_modality_fields"].items():
        result_key_for_modality = f"per_{modality}"
        system_uuid_field_name = "_system_asset_source_uuid" # The internal field name
        
        if result_key_for_modality in result:
            modality_results = result[result_key_for_modality]
            
            if not isinstance(modality_results, list):
                logger.warning(f"LLM result for '{result_key_for_modality}' in Run {run.id}, Asset {parent_asset.id} was not a list. Got: {type(modality_results)}. Skipping child annotations for this modality.")
                continue

            for i, child_result_data_from_llm in enumerate(modality_results):
                child_asset_to_annotate: Optional[Asset] = None
                
                if not isinstance(child_result_data_from_llm, dict):
                    logger.warning(f"LLM result item for modality '{modality}', index {i}, in Run {run.id} (Parent Asset {parent_asset.id}) was not a dict. Got: {type(child_result_data_from_llm)}. Skipping this child annotation.")
                    continue

                llm_provided_uuid = child_result_data_from_llm.get(system_uuid_field_name)
                
                if not llm_provided_uuid:
                    logger.error(f"Critical: LLM failed to provide the required internal field '{system_uuid_field_name}' for modality '{modality}', item {i}, Run {run.id}, Parent Asset {parent_asset.id}. Cannot map this result. Skipping child annotation.")
                    continue # Skip this item as robust mapping is not possible
                
                if not isinstance(llm_provided_uuid, str):
                    logger.warning(f"LLM provided non-string internal UUID '{llm_provided_uuid}' ('{system_uuid_field_name}') for modality '{modality}', item {i}, Run {run.id}. Attempting to cast.")
                    try:
                        llm_provided_uuid = str(llm_provided_uuid)
                    except Exception:
                        logger.error(f"Could not cast provided internal UUID to string. Skipping child annotation for item {i}, modality '{modality}', Run {run.id}.")
                        continue
            
                found_asset = db.query(Asset).filter(
                    Asset.uuid == llm_provided_uuid,
                    Asset.parent_asset_id == parent_asset.id,
                    Asset.kind == modality
                ).first()
                
                if found_asset:
                    child_asset_to_annotate = found_asset
                    logger.info(f"Mapped LLM result for modality '{modality}' item {i} to Asset ID {found_asset.id} using internal UUID '{llm_provided_uuid}'.")
                else:
                    logger.error(f"Critical: LLM provided internal UUID '{llm_provided_uuid}' ('{system_uuid_field_name}') for modality '{modality}', item {i}, Run {run.id}, but no matching child asset found for Parent Asset {parent_asset.id}. Skipping child annotation.")
                    continue # Skip if no matching asset found

                # Remove the internal UUID field before storing the value
                final_child_value_for_storage = child_result_data_from_llm.copy()
                if system_uuid_field_name in final_child_value_for_storage:
                    del final_child_value_for_storage[system_uuid_field_name]
                else:
                    # This should ideally not happen if llm_provided_uuid was sourced from it, but log if it does.
                    logger.warning(f"Internal field '{system_uuid_field_name}' was expected but not found in child_result_data_from_llm for stripping. LLM output was: {child_result_data_from_llm.keys()}")

                child_annotation = Annotation(
                    asset_id=child_asset_to_annotate.id,
                    schema_id=schema.id,
                    run_id=run.id,
                    value=final_child_value_for_storage, 
                    status=ResultStatus.SUCCESS,
                    infospace_id=run.infospace_id,
                    user_id=run.user_id
                )
                annotations.append(child_annotation)
    
    return annotations

@shared_task
async def process_annotation_run(run_id: int) -> None:
    """
    Process an annotation run using the new multi-modal engine.
    Fetches target assets, applies schemas, calls providers, and demultiplexes results.
    """
    logger.info(f"Task: Processing annotation run {run_id} with multi-modal engine.")
    
    with Session(engine) as session:
        try:
            run = session.get(AnnotationRun, run_id)
            if not run:
                logger.error(f"Task: AnnotationRun {run_id} not found")
                return
            
            if run.status == RunStatus.RUNNING:
                logger.warning(f"Task: AnnotationRun {run_id} is already processing. Skipping.")
                return
            if run.status == RunStatus.COMPLETED or run.status == RunStatus.COMPLETED_WITH_ERRORS:
                logger.warning(f"Task: AnnotationRun {run_id} is already completed. Skipping.")
                return

            run.status = RunStatus.RUNNING
            run.started_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            session.refresh(run)

            # Get classification provider instance
            app_settings = settings
            try:
                classification_provider = create_classification_provider(settings=app_settings)
            except Exception as e_provider:
                logger.error(f"Task: Failed to create classification provider for Run {run.id}: {e_provider}", exc_info=True)
                run.status = RunStatus.FAILED
                run.error_message = f"Provider initialization failed: {str(e_provider)}"
                session.add(run)
                session.commit()
                return

            target_asset_ids_to_process: List[int] = []
            run_config = run.configuration or {}

            if run_config.get("target_asset_ids"):
                target_asset_ids_to_process.extend(run_config["target_asset_ids"])
            elif run_config.get("target_bundle_id"):
                bundle_id = run_config["target_bundle_id"]
                bundle = session.get(Bundle, bundle_id)
                if bundle and bundle.infospace_id == run.infospace_id:
                    # Assuming Bundle.assets is the correct relationship to get asset IDs
                    target_asset_ids_to_process.extend([asset.id for asset in bundle.assets])
                else:
                    logger.error(f"Task: Target Bundle {bundle_id} for Run {run.id} not found or not in infospace.")
                    run.status = RunStatus.FAILED
                    run.error_message = f"Target Bundle {bundle_id} not found/invalid."
                    session.add(run)
                    session.commit()
                    return
            
            if not target_asset_ids_to_process:
                logger.error(f"Task: No target assets for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No target assets found."
                session.add(run)
                session.commit()
                return

            schemas_to_apply = run.target_schemas
            if not schemas_to_apply:
                logger.error(f"Task: No schemas for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No schemas specified."
                session.add(run)
                session.commit()
                return
            
            logger.info(f"Task: Run {run.id} processing {len(target_asset_ids_to_process)} assets with {len(schemas_to_apply)} schemas.")
            
            errors_run_level = [] # Errors pertaining to the whole run or asset/schema processing that isn't an annotation status
            all_created_annotations: List[Annotation] = []
            all_created_justifications: List[Justification] = []

            for schema in schemas_to_apply:
                if not validate_hierarchical_schema(schema.output_contract):
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} has invalid hierarchical structure. Skipping this schema.")
                    errors_run_level.append(f"Schema {schema.id} ({schema.name}) invalid structure.")
                    continue
                
                schema_structure = detect_schema_structure(schema.output_contract)
                
                # Prepare justification-related configurations
                justification_mode = run_config.get("justification_mode", "NONE")
                default_justification_prompt_template = run_config.get("default_justification_prompt")
                global_justification_prompt = run_config.get("global_justification_prompt")
                # field_specific_justification_configs comes from schema.field_specific_justification_configs (already a dict)
                schema_justification_configs = schema.field_specific_justification_configs or {}

                try:
                    OutputModelClass = create_pydantic_model_from_json_schema(
                        model_name=f"DynamicOutput_{schema.name.replace(' ', '_')}_{schema.id}",
                        json_schema=schema.output_contract, # Original schema
                        justification_mode=justification_mode,
                        field_specific_justification_configs=schema_justification_configs
                        # The create_pydantic_model_from_json_schema now handles augmentation internally
                    )
                except Exception as e_model_create:
                    logger.error(f"Task: Failed to create Pydantic model for Schema {schema.id} ({schema.name}) in Run {run.id}: {e_model_create}", exc_info=True)
                    errors_run_level.append(f"Schema {schema.id} Pydantic model creation failed: {e_model_create}")
                    continue

                # Assemble justification prompts to append to schema.instructions
                final_schema_instructions = schema.instructions or ""
                justification_prompts_parts = []
                needs_any_field_specific_justification_prompts = False

                # Determine which fields will actually get a _justification field in the output model
                # This is a precursor to generating detailed prompts for them.
                fields_that_will_have_justification_submodel = []
                potential_fields_to_check_for_justification = []

                # Gather all top-level field names from the original schema structure
                # These are the keys that schema.field_specific_justification_configs would refer to.
                if schema_structure.get("document_fields"): # This is the sub-schema for document
                    doc_props = schema_structure["document_fields"].get("properties", {})
                    potential_fields_to_check_for_justification.extend(doc_props.keys())
                
                for modality, per_modality_item_schema in schema_structure.get("per_modality_fields", {}).items():
                    # per_modality_item_schema is the sub-schema for an item (e.g., for one image)
                    modality_props = per_modality_item_schema.get("properties", {})
                    potential_fields_to_check_for_justification.extend(modality_props.keys())
                
                # Remove duplicates if a field name could appear in multiple contexts and ensure consistent order
                potential_fields_to_check_for_justification = sorted(list(set(potential_fields_to_check_for_justification)))

                if justification_mode != "NONE":
                    for field_name_to_check in potential_fields_to_check_for_justification:
                        # Simplified check mimicking part of create_pydantic_model_from_json_schema's decision
                        should_add_just_for_this_field = False
                        # schema_justification_configs uses the direct field name as key as per current examples.
                        # It expects FieldJustificationConfig objects or dicts convertible to them.
                        field_config_from_schema = schema_justification_configs.get(field_name_to_check)

                        if justification_mode == "SCHEMA_DEFAULT":
                            # cfg is an instance of FieldJustificationConfig (or a dict that was part of the input)
                            if field_config_from_schema and getattr(field_config_from_schema, 'enabled', field_config_from_schema.get("enabled", False) if isinstance(field_config_from_schema, dict) else False):
                                should_add_just_for_this_field = True
                        elif justification_mode.startswith("ALL_"):
                            # Not explicitly disabled (enabled is not False)
                            if not (field_config_from_schema and getattr(field_config_from_schema, 'enabled', field_config_from_schema.get("enabled", True) if isinstance(field_config_from_schema, dict) else True) is False):
                                should_add_just_for_this_field = True
                        
                        if should_add_just_for_this_field:
                            fields_that_will_have_justification_submodel.append(field_name_to_check)

                if justification_mode != "NONE" and fields_that_will_have_justification_submodel:
                    needs_any_field_specific_justification_prompts = True
                    if justification_mode == "ALL_WITH_GLOBAL_PROMPT" and global_justification_prompt:
                        justification_prompts_parts.append(global_justification_prompt)
                        # If global prompt is very generic, we might still want to add structure info
                        justification_prompts_parts.append(
                            "When providing justifications as requested, ensure each justification object (e.g., 'fieldName_justification') includes a 'reasoning' text. "
                            "For evidence: use 'text_spans' (list of objects with 'start_char_offset', 'end_char_offset', 'text_snippet', optional 'asset_uuid'), "
                            "'image_regions' (list of objects with 'asset_uuid', 'bounding_box' dict {'x', 'y', 'width', 'height', 'label'}), "
                            "'audio_segments' (list of objects with 'asset_uuid', 'start_time_seconds', 'end_time_seconds'), "
                            "or 'additional_evidence' (a dictionary for other structured data)."
                        )
                    else: # SCHEMA_DEFAULT or ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT
                        # Add general structural guidance once if any field needs it
                        justification_prompts_parts.append(
                            "For any field requiring justification (e.g., 'fieldName_justification'), structure it with: "
                            "1. A 'reasoning' field (string) containing your explanation. "
                            "2. Optional evidence fields: "
                            "'text_spans': a list, each item an object with 'start_char_offset' (int), 'end_char_offset' (int), 'text_snippet' (str), and optionally 'asset_uuid' (str). "
                            "'image_regions': a list, each item an object with 'asset_uuid' (str) and a 'bounding_box' object (with 'x', 'y', 'width', 'height' as floats 0-1, and optional 'label' as str). "
                            "'audio_segments': a list, each item an object with 'asset_uuid' (str), 'start_time_seconds' (float), 'end_time_seconds' (float). "
                            "'additional_evidence': a dictionary for any other structured evidence types."
                        )
                        for field_name in fields_that_will_have_justification_submodel:
                            prompt_for_field_reasoning = None
                            field_config = schema_justification_configs.get(field_name)
                            
                            if field_config and field_config.get("custom_prompt"):
                                prompt_for_field_reasoning = field_config["custom_prompt"]
                            elif default_justification_prompt_template:
                                try:
                                    prompt_for_field_reasoning = default_justification_prompt_template.format(field_name=field_name, field_path=field_name)
                                except KeyError: # Handle if template has unexpected keys
                                    logger.warning(f"Default justification prompt template has unfulfillable keys for field {field_name}. Using basic prompt.")
                                    prompt_for_field_reasoning = f"Provide the reasoning for your value for the field '{field_name}'."
                            else:
                                prompt_for_field_reasoning = f"Provide the reasoning for your value for the field '{field_name}'."
                            
                            if prompt_for_field_reasoning:
                                # This prompt now focuses on the 'reasoning' part, structure is separate.
                                justification_prompts_parts.append(
                                    f"For the field '{field_name}', populate its '{field_name}_justification.reasoning' with: {prompt_for_field_reasoning}"
                                )
                
                if needs_any_field_specific_justification_prompts and justification_prompts_parts:
                    final_schema_instructions += "\\n\\n--- Justification Instructions ---\\n" + "\\n".join(justification_prompts_parts)
                elif justification_mode == "ALL_WITH_GLOBAL_PROMPT" and global_justification_prompt and justification_prompts_parts: # Case where only global prompt was added
                     final_schema_instructions += "\\n\\n--- Justification Instructions ---\\n" + "\\n".join(justification_prompts_parts)

                # --- System instruction for per-modality asset UUID mapping --- 
                # Check if the schema structure implies per-modality outputs that would need mapping
                if schema_structure.get("per_modality_fields"):
                    system_mapping_prompt = (
                        "\\n\\n--- System Data Mapping Instructions ---\\n"
                        "For each item you generate that corresponds to a specific media input (e.g., an item in a 'per_image' list, 'per_audio' list, etc.), "
                        "you MUST include a field named '_system_asset_source_uuid'. "
                        "The value of this '_system_asset_source_uuid' field MUST be the exact UUID string that was provided to you in the input prompt for that specific media item. "
                        "This is critical for correctly associating your analysis with the source media."
                    )
                    if final_schema_instructions:
                        final_schema_instructions += system_mapping_prompt
                    else:
                        final_schema_instructions = system_mapping_prompt[4:] # Remove leading \n\n if no prior instructions


                for asset_id in target_asset_ids_to_process:
                    parent_asset = session.get(Asset, asset_id)
                    if not parent_asset or parent_asset.infospace_id != run.infospace_id:
                        logger.warning(f"Task: Asset {asset_id} for Run {run.id} not found/invalid. Skipping.")
                        errors_run_level.append(f"Asset {asset_id} not found/invalid.")
                        continue
                    
                    try:
                        from app.api.providers.factory import create_storage_provider
                        storage_provider_instance = create_storage_provider(settings=settings)

                        text_content_for_provider, provider_specific_config = await assemble_multimodal_context(
                            parent_asset, run_config, session, storage_provider_instance
                        )
                        
                        full_provider_config_for_classify = {**run_config, **provider_specific_config}
                        # Pass thinking_config from run_config to provider_specific_config if not already there.
                        if "thinking_config" in run_config and "thinking_config" not in provider_specific_config:
                             provider_specific_config["thinking_config"] = run_config["thinking_config"]


                        logger.debug(f"Task: Calling provider for Asset {parent_asset.id}, Schema {schema.id}, Run {run.id}. Text length: {len(text_content_for_provider)}, Media items: {len(provider_specific_config.get('media_inputs',[]))}")

                        provider_response_envelope = await classification_provider.classify(
                            text_content=text_content_for_provider,
                            output_model_class=OutputModelClass, 
                            instructions=final_schema_instructions, # Use instructions with appended justification prompts
                            provider_config=full_provider_config_for_classify # contains media_inputs and thinking_config
                        )
                        
                        created_annotations_for_asset = await demultiplex_results(
                            result=provider_response_envelope.get("data", provider_response_envelope), # Assuming data is under 'data' key or is the envelope itself
                            schema_structure=schema_structure,
                            parent_asset=parent_asset,
                            schema=schema,
                            run=run,
                            db=session
                        )
                        
                        session.add_all(created_annotations_for_asset) # Add to session
                        session.flush() # Flush to get IDs for annotations

                        all_created_annotations.extend(created_annotations_for_asset)
                        
                        # Handle _thinking_trace
                        thinking_trace_content = provider_response_envelope.get("_thinking_trace")
                        include_thoughts = run_config.get("thinking_config", {}).get("include_thoughts", False)

                        if include_thoughts and thinking_trace_content:
                            # Find the parent document annotation among created_annotations_for_asset
                            # It's the one directly linked to parent_asset.id
                            parent_doc_annotation = next((ann for ann in created_annotations_for_asset if ann.asset_id == parent_asset.id), None)
                            if parent_doc_annotation and parent_doc_annotation.id: # Ensure it exists and has an ID
                                thinking_justification = Justification(
                                    annotation_id=parent_doc_annotation.id,
                                    field_name="_thinking_trace", # Special field name
                                    reasoning=thinking_trace_content,
                                    model_name=provider_response_envelope.get("_model_name", classification_provider.provider_name),
                                    evidence_payload={"trace_type": "provider_summary"} # Optional: add more context
                                )
                                all_created_justifications.append(thinking_justification)
                                logger.info(f"Task: Created Justification object for _thinking_trace for Annotation {parent_doc_annotation.id}, Run {run.id}.")
                            else:
                                logger.warning(f"Task: _thinking_trace received for Asset {parent_asset.id}, Run {run.id}, but parent document Annotation not found or has no ID. Cannot store trace.")
                        
                        logger.info(f"Task: Successfully processed Asset {parent_asset.id} with Schema {schema.id} for Run {run.id}. Created {len(created_annotations_for_asset)} annotations.")

                    except Exception as e_classify:
                        logger.error(f"Task: Error classifying Asset {parent_asset.id} with Schema {schema.id} for Run {run.id}: {e_classify}", exc_info=True)
                        errors_run_level.append(f"Asset {parent_asset.id}/Schema {schema.id} classification error: {str(e_classify)}")
                        # Optionally, create a FAILED annotation for the parent asset
                        failed_ann = Annotation(
                            asset_id=parent_asset.id,
                            schema_id=schema.id,
                            run_id=run.id,
                            value={"error": str(e_classify), "details": traceback.format_exc()},
                            status=ResultStatus.FAILED,
                            infospace_id=run.infospace_id,
                            user_id=run.user_id
                        )
                        all_created_annotations.append(failed_ann)
            
            # After processing all assets and schemas:
            if all_created_annotations:
                session.add_all(all_created_annotations)
            if all_created_justifications:
                session.add_all(all_created_justifications)
            
            # Determine final run status
            has_failed_annotations = any(ann.status == ResultStatus.FAILED for ann in all_created_annotations)
            if errors_run_level or has_failed_annotations:
                run.status = RunStatus.COMPLETED_WITH_ERRORS
                error_messages = errors_run_level
                if has_failed_annotations:
                    error_messages.append(f"{sum(1 for ann in all_created_annotations if ann.status == ResultStatus.FAILED)} annotations failed.")
                run.error_message = "\n".join(error_messages)
            else:
                run.status = RunStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            logger.info(f"Task: AnnotationRun {run.id} finished. Status: {run.status}. Total Annotations: {len(all_created_annotations)}, Justifications: {len(all_created_justifications)}.")
            
        except Exception as e_task_critical:
            logger.exception(f"Task: Critical unexpected error processing AnnotationRun {run_id}: {e_task_critical}")
            # Ensure run object is fetched again if it was lost due to session issues before the main try block
            run_to_fail = session.get(AnnotationRun, run_id) # Re-fetch or use run if available
            if run_to_fail:
                run_to_fail.status = RunStatus.FAILED
                run_to_fail.error_message = f"Critical task error: {str(e_task_critical)}"
                run_to_fail.updated_at = datetime.now(timezone.utc)
                run_to_fail.completed_at = datetime.now(timezone.utc) # Mark as completed even if failed
                session.add(run_to_fail)
                session.commit()

@shared_task
async def retry_failed_annotations(run_id: int) -> None:
    """
    Retry failed annotations in a run.
    This task will find annotations from the given run that are in a FAILED status
    and attempt to re-process them (currently by creating a new placeholder annotation or updating).
    """
    logger.info(f"Task: Retrying failed annotations for run {run_id}")
    
    with Session(engine) as session:
        try:
            run = session.get(AnnotationRun, run_id)
            if not run:
                logger.error(f"Task: AnnotationRun {run_id} not found for retry.")
                return
            
            if run.status not in [RunStatus.COMPLETED_WITH_ERRORS, RunStatus.FAILED]:
                logger.warning(f"Task: AnnotationRun {run_id} is not in a state that allows retry (Status: {run.status}). Skipping retry.")
                return

            original_status = run.status
            run.status = RunStatus.RUNNING # Mark run as processing again
            run.updated_at = datetime.now(timezone.utc)
            # Clear previous error message related to the run itself, individual annotation errors will be logged.
            run.error_message = None 
            session.add(run)
            session.commit()
            session.refresh(run)

            # Find annotations from this run that are marked as FAILED
            failed_annotations_to_retry = session.exec(
                select(Annotation).where(
                    Annotation.run_id == run.id,
                    Annotation.status == ResultStatus.FAILED
                )
            ).all()

            if not failed_annotations_to_retry:
                logger.info(f"Task: No failed annotations found to retry for Run {run_id}.")
                run.status = original_status # Revert to original status if no failed annotations
                if not errors and original_status == RunStatus.COMPLETED_WITH_ERRORS: # if all retries succeed
                     run.status = RunStatus.COMPLETED
                session.add(run)
                session.commit()
                return

            logger.info(f"Task: Found {len(failed_annotations_to_retry)} failed annotations to retry for Run {run_id}.")
            
            errors = []
            retried_count = 0

            for annotation_to_retry in failed_annotations_to_retry:
                try:
                    asset = session.get(Asset, annotation_to_retry.asset_id)
                    schema = session.get(AnnotationSchema, annotation_to_retry.schema_id)

                    if not asset or not schema or asset.infospace_id != run.infospace_id or schema.infospace_id != run.infospace_id:
                        logger.warning(f"Task: Skipping retry for Annotation {annotation_to_retry.id} due to invalid Asset or Schema or infospace mismatch.")
                        errors.append(f"Invalid context for Annotation {annotation_to_retry.id}")
                        continue

                    # Placeholder for actual re-annotation logic
                    new_annotation_value = {"placeholder_field": f"Retry for asset {asset.id} by schema {schema.id} in run {run.id}"}
                    
                    # Update existing failed annotation
                    annotation_to_retry.value = new_annotation_value
                    annotation_to_retry.status = ResultStatus.SUCCESS # Assume success on retry for now
                    annotation_to_retry.updated_at = datetime.now(timezone.utc)
                    # Clear previous error specific to this annotation if any was stored (not currently on model)
                    session.add(annotation_to_retry)
                    retried_count += 1
                    logger.debug(f"Task: Retried Annotation {annotation_to_retry.id} for Asset {asset.id}, Schema {schema.id}.")

                except Exception as e:
                    logger.error(f"Task: Error retrying Annotation {annotation_to_retry.id}: {e}", exc_info=True)
                    errors.append(f"Annotation {annotation_to_retry.id}: {str(e)}")
                    # Keep the annotation status as FAILED if retry itself fails
                    annotation_to_retry.status = ResultStatus.FAILED 
                    session.add(annotation_to_retry)
            
            # Finalize run status based on retry outcomes
            if errors:
                run.status = RunStatus.COMPLETED_WITH_ERRORS
                run.error_message = "\n".join(errors)
            else:
                # If there were no new errors, and all failed annotations were processed (even if some couldn't be retried due to context issues)
                # check if any annotations are still FAILED for this run
                still_failed_count = session.exec(
                    select(func.count(Annotation.id)).where(Annotation.run_id == run.id, Annotation.status == ResultStatus.FAILED)
                ).one_or_none() or 0
                
                if still_failed_count > 0:
                    run.status = RunStatus.COMPLETED_WITH_ERRORS
                    run.error_message = f"{still_failed_count} annotations remain in FAILED state after retry attempt."
                else:
                    run.status = RunStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc) # Update completed_at for this retry cycle
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            logger.info(f"Task: Retry for AnnotationRun {run_id} finished. Status: {run.status}. Annotations retried: {retried_count}.")

        except Exception as e:
            logger.exception(f"Task: Unexpected critical error during retry for AnnotationRun {run_id}: {e}")
            run_to_fail_retry = session.get(AnnotationRun, run_id)
            if run_to_fail_retry:
                run_to_fail_retry.status = RunStatus.FAILED
                run_to_fail_retry.error_message = f"Critical task error during retry: {str(e)}"
                run_to_fail_retry.updated_at = datetime.now(timezone.utc)
                session.add(run_to_fail_retry)
                session.commit() 