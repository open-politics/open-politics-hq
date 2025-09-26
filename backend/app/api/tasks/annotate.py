"""Tasks for handling annotations."""
import json
import logging
from typing import List, Dict, Any, Type, Optional, TYPE_CHECKING, Tuple
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
from app.api.providers.factory import create_model_registry, create_storage_provider
from app.api.tasks.utils import create_pydantic_model_from_json_schema, make_python_identifier, run_async_in_celery
from app.core.config import settings

if TYPE_CHECKING:
    from app.api.deps import StorageProviderDep # Import StorageProviderDep under TYPE_CHECKING

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Module-level provider cache to avoid recreating providers in the same worker process
_provider_cache = {}

# Configuration for parallel processing
# These will be overridden by settings values
DEFAULT_ANNOTATION_CONCURRENCY = 5  # Number of concurrent classification API calls
MAX_ANNOTATION_CONCURRENCY = 20     # Maximum allowed concurrency

def get_annotation_processing_config():
    """Get annotation processing configuration from settings."""
    try:
        return {
            'default_concurrency': settings.DEFAULT_ANNOTATION_CONCURRENCY,
            'max_concurrency': settings.MAX_ANNOTATION_CONCURRENCY,
            'parallel_enabled': settings.ENABLE_PARALLEL_ANNOTATION_PROCESSING
        }
    except AttributeError:
        # Fallback to default values if settings not available
        logger.warning("Annotation processing settings not found, using defaults")
        return {
            'default_concurrency': DEFAULT_ANNOTATION_CONCURRENCY,
            'max_concurrency': MAX_ANNOTATION_CONCURRENCY,
            'parallel_enabled': True
        }

async def get_cached_provider(provider_type: str, settings_instance):
    """Get a cached provider instance or create a new one."""
    cache_key = f"{provider_type}_{id(settings_instance)}"
    
    if cache_key not in _provider_cache:
        if provider_type == "storage":
            _provider_cache[cache_key] = create_storage_provider(settings_instance)
        elif provider_type == "model_registry":
            model_registry = create_model_registry(settings_instance)
            await model_registry.initialize_providers()
            _provider_cache[cache_key] = model_registry
        else:
            raise ValueError(f"Unknown provider type: {provider_type}")
        
        logger.info(f"Task: Created and cached {provider_type} provider")
    else:
        logger.debug(f"Task: Using cached {provider_type} provider")
    
    return _provider_cache[cache_key]

def clear_provider_cache():
    """Clear the provider cache. Useful for memory management in long-running workers."""
    global _provider_cache
    cache_size = len(_provider_cache)
    _provider_cache.clear()
    logger.info(f"Task: Cleared provider cache ({cache_size} providers removed)")

def get_cache_status():
    """Get information about the current provider cache."""
    return {
        "cache_size": len(_provider_cache),
        "cached_providers": list(_provider_cache.keys())
    }

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
    
    # DEBUG: Log what we received
    logger.info(f"DEBUG: demultiplex_results called for Run {run.id}, Asset {parent_asset.id}")
    logger.info(f"DEBUG: result keys: {list(result.keys()) if result else 'None'}")
    logger.info(f"DEBUG: result type: {type(result)}, content preview: {str(result)[:200] if result else 'None'}")
    logger.info(f"DEBUG: schema_structure document_fields: {bool(schema_structure.get('document_fields'))}")
    
    # Create annotation for parent asset from document fields
    if schema_structure["document_fields"] and "document" in result:
        parent_annotation_value = result["document"]
        logger.info(f"DEBUG: Found document result, type: {type(parent_annotation_value)}, value: {parent_annotation_value}")
        
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
            logger.info(f"DEBUG: Created parent annotation for Asset {parent_asset.id}, Run {run.id}")
        else:
            logger.warning(f"LLM result for 'document' in Run {run.id}, Asset {parent_asset.id} was not a dict. Got: {type(parent_annotation_value)}. Skipping parent annotation.")
    else:
        logger.info(f"DEBUG: No 'document' key in result or no document_fields. Available keys: {list(result.keys()) if result else 'None'}")
        
        # FALLBACK: If no hierarchical structure, treat the entire result as document-level
        if not schema_structure["per_modality_fields"] and result:
            logger.info(f"DEBUG: No hierarchical structure detected, using entire result as document annotation")
            parent_annotation = Annotation(
                asset_id=parent_asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value=result,
                status=ResultStatus.SUCCESS,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            annotations.append(parent_annotation)
            logger.info(f"DEBUG: Created fallback annotation for Asset {parent_asset.id}, Run {run.id}")
    
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
    
    logger.info(f"DEBUG: demultiplex_results returning {len(annotations)} annotations for Run {run.id}, Asset {parent_asset.id}")
    return annotations

@shared_task
def process_annotation_run(run_id: int) -> None:
    """
    Process an annotation run using the new multi-modal engine. (sync wrapper)
    """
    logger.info(f"Task: Sync wrapper started for annotation run {run_id}")
    
    try:
        # Use the helper function for proper event loop management
        run_async_in_celery(_process_annotation_run_async, run_id)
    except Exception as e:
        logger.exception(f"Task: Critical unhandled error in async processing for run {run_id}: {e}")
        # If the async task fails with an unhandled exception, mark the run as FAILED.
        with Session(engine) as session:
            try:
                run = session.get(AnnotationRun, run_id)
                if run:
                    run.status = RunStatus.FAILED
                    run.error_message = f"Critical task execution error: {str(e)}"
                    run.completed_at = datetime.now(timezone.utc)
                    run.updated_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
            except Exception as db_exc:
                logger.error(f"Task: Could not even update run {run_id} to FAILED status: {db_exc}")
        raise  # Re-raise the exception so Celery knows the task failed

async def process_single_asset_schema(
    asset: Asset,
    schema_info: Dict[str, Any],
    run: AnnotationRun,
    run_config: Dict[str, Any],
    model_registry,
    storage_provider_instance,
    session: Session,
    semaphore: Optional[asyncio.Semaphore] = None
) -> Dict[str, Any]:
    """
    Process a single asset with a single schema.
    
    Args:
        asset: The asset to process
        schema_info: Schema information dict containing schema, structure, etc.
        run: The annotation run
        run_config: Run configuration
        model_registry: The model registry service instance
        storage_provider_instance: Storage provider instance
        session: Database session
        semaphore: Optional semaphore for concurrency control
    
    Returns:
        Dict with processing results including success status, annotations, justifications, and errors
    """
    if semaphore:
        await semaphore.acquire()
    
    try:
        schema = schema_info["schema"]
        schema_structure = schema_info["schema_structure"]
        OutputModelClass = schema_info["output_model_class"]
        final_schema_instructions = schema_info["final_instructions"]
        
        result = {
            "success": False,
            "asset_id": asset.id,
            "schema_id": schema.id,
            "annotations": [],
            "justifications": [],
            "error": None
        }
        
        try:
            logger.debug(f"Task: Processing Asset {asset.id} with Schema {schema.id} for Run {run.id}")
            
            # Assemble multimodal context for this asset
            text_content_for_provider, provider_specific_config = await assemble_multimodal_context(
                asset, run_config, session, storage_provider_instance
            )
            
            full_provider_config_for_classify = {**run_config, **provider_specific_config}
            # Pass thinking_config from run_config to provider_specific_config if not already there.
            if "thinking_config" in run_config and "thinking_config" not in provider_specific_config:
                provider_specific_config["thinking_config"] = run_config["thinking_config"]

            logger.debug(f"Task: Calling provider for Asset {asset.id}, Schema {schema.id}, Run {run.id}. Text length: {len(text_content_for_provider)}, Media items: {len(provider_specific_config.get('media_inputs',[]))}")

            # Call the model registry for structured classification
            # Get the model name from run config (frontend sends as ai_model) or use default
            model_name = run_config.get("ai_model") or run_config.get("model_name", "gemini-2.5-flash-preview-05-20")
            thinking_enabled = run_config.get("thinking_config", {}).get("include_thoughts", False)
            
            logger.info(f"Task: Using model '{model_name}' for Asset {asset.id}, Schema {schema.id}, Run {run.id}. Run config keys: {list(run_config.keys())}")
            
            provider_response = await model_registry.classify(
                text_content=text_content_for_provider,
                schema=OutputModelClass.model_json_schema(),
                model_name=model_name,
                instructions=final_schema_instructions,
                thinking_enabled=thinking_enabled,
                **{k: v for k, v in full_provider_config_for_classify.items() 
                   if k not in ['thinking_config', 'model_name']}
            )
            
            # Convert to envelope format for compatibility
            provider_response_envelope = {
                "data": json.loads(provider_response.content) if provider_response.content else {},
                "_model_name": provider_response.model_used,
                "_thinking_trace": provider_response.thinking_trace
            }
            
            # DEBUG: Log provider response details
            logger.info(f"DEBUG: Provider response for Asset {asset.id}, Schema {schema.id}, Run {run.id}")
            logger.info(f"DEBUG: Raw provider response content: {provider_response.content}")
            logger.info(f"DEBUG: Parsed envelope data: {provider_response_envelope.get('data')}")
            logger.info(f"DEBUG: Schema structure being used: {schema_structure}")
            
            # Demultiplex results to create annotations
            created_annotations_for_asset = await demultiplex_results(
                result=provider_response_envelope.get("data", provider_response_envelope),
                schema_structure=schema_structure,
                parent_asset=asset,
                schema=schema,
                run=run,
                db=session
            )
            
            result["annotations"] = created_annotations_for_asset
            
            # Handle _thinking_trace if present
            thinking_trace_content = provider_response_envelope.get("_thinking_trace")
            include_thoughts = run_config.get("thinking_config", {}).get("include_thoughts", False)

            if include_thoughts and thinking_trace_content:
                # Find the parent document annotation
                parent_doc_annotation = next((ann for ann in created_annotations_for_asset if ann.asset_id == asset.id), None)
                if parent_doc_annotation:
                    thinking_justification = Justification(
                        annotation_id=None,  # Will be set after annotation is saved
                        field_name="_thinking_trace",
                        reasoning=thinking_trace_content,
                        model_name=provider_response_envelope.get("_model_name", run_config.get("model_name", "unknown")),
                        evidence_payload={"trace_type": "provider_summary"}
                    )
                    result["justifications"] = [thinking_justification]
                    result["parent_annotation_ref"] = parent_doc_annotation  # Reference for later ID assignment
            
            result["success"] = True
            logger.debug(f"Task: Successfully processed Asset {asset.id} with Schema {schema.id} for Run {run.id}. Created {len(created_annotations_for_asset)} annotations.")
            
        except Exception as e_classify:
            error_msg = f"Asset {asset.id}/Schema {schema.id} classification error: {str(e_classify)}"
            logger.error(f"Task: Error classifying Asset {asset.id} with Schema {schema.id} for Run {run.id}: {e_classify}", exc_info=True)
            
            # Create a FAILED annotation for tracking
            failed_ann = Annotation(
                asset_id=asset.id,
                schema_id=schema.id,
                run_id=run.id,
                value={"error": str(e_classify), "details": traceback.format_exc()},
                status=ResultStatus.FAILED,
                infospace_id=run.infospace_id,
                user_id=run.user_id
            )
            result["annotations"] = [failed_ann]
            result["error"] = error_msg
            result["success"] = False
        
        return result
        
    finally:
        if semaphore:
            semaphore.release()

async def process_assets_parallel(
    assets_map: Dict[int, Asset],
    validated_schemas: List[Dict[str, Any]],
    run: AnnotationRun,
    run_config: Dict[str, Any],
    model_registry,
    storage_provider_instance,
    session: Session,
    concurrency_limit: int = DEFAULT_ANNOTATION_CONCURRENCY
) -> Tuple[List[Annotation], List[Justification], List[str]]:
    """
    Process assets and schemas in parallel with controlled concurrency.
    
    Returns:
        Tuple of (all_annotations, all_justifications, errors)
    """
    import asyncio
    
    # Create semaphore for concurrency control
    semaphore = asyncio.Semaphore(concurrency_limit)
    
    # Create tasks for all asset-schema combinations
    tasks = []
    for schema_info in validated_schemas:
        for asset_id, asset in assets_map.items():
            task = process_single_asset_schema(
                asset=asset,
                schema_info=schema_info,
                run=run,
                run_config=run_config,
                model_registry=model_registry,
                storage_provider_instance=storage_provider_instance,
                session=session,
                semaphore=semaphore
            )
            tasks.append(task)
    
    logger.info(f"Task: Starting parallel processing of {len(tasks)} asset-schema combinations with concurrency limit {concurrency_limit}")
    
    # Process all tasks in parallel
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # Collect results
    all_created_annotations = []
    all_created_justifications = []
    errors_run_level = []
    
    for i, result in enumerate(results):
        if isinstance(result, Exception):
            # Task failed with exception
            logger.error(f"Task: Parallel processing task {i} failed with exception: {result}", exc_info=True)
            errors_run_level.append(f"Task {i} failed: {str(result)}")
            continue
        
        if not isinstance(result, dict):
            logger.error(f"Task: Unexpected result type from parallel task {i}: {type(result)}")
            errors_run_level.append(f"Task {i} returned unexpected result type")
            continue
            
        # Collect annotations
        if result.get("annotations"):
            all_created_annotations.extend(result["annotations"])
        
        # Collect justifications (need to handle annotation ID assignment)
        if result.get("justifications") and result.get("parent_annotation_ref"):
            for justification in result["justifications"]:
                # The annotation reference will be updated with the actual ID after session.add_all
                justification._parent_annotation_ref = result["parent_annotation_ref"]
                all_created_justifications.append(justification)
        
        # Collect errors
        if result.get("error"):
            errors_run_level.append(result["error"])
    
    logger.info(f"Task: Parallel processing completed. Created {len(all_created_annotations)} annotations, {len(all_created_justifications)} justifications, {len(errors_run_level)} errors")
    
    return all_created_annotations, all_created_justifications, errors_run_level

async def process_assets_sequential(
    assets_map: Dict[int, Asset],
    validated_schemas: List[Dict[str, Any]],
    run: AnnotationRun,
    run_config: Dict[str, Any],
    model_registry,
    storage_provider_instance,
    session: Session
) -> Tuple[List[Annotation], List[Justification], List[str]]:
    """
    Process assets and schemas sequentially (fallback for when parallel processing is disabled).
    
    Returns:
        Tuple of (all_annotations, all_justifications, errors)
    """
    all_created_annotations = []
    all_created_justifications = []
    errors_run_level = []
    
    logger.info(f"Task: Starting sequential processing of {len(assets_map)} assets with {len(validated_schemas)} schemas")
    
    for schema_info in validated_schemas:
        schema = schema_info["schema"]
        schema_structure = schema_info["schema_structure"]
        OutputModelClass = schema_info["output_model_class"]
        final_schema_instructions = schema_info["final_instructions"]

        for asset_id, parent_asset in assets_map.items():
            try:
                logger.debug(f"Task: Sequentially processing Asset {parent_asset.id} with Schema {schema.id} for Run {run.id}")
                
                # Assemble multimodal context for this asset
                text_content_for_provider, provider_specific_config = await assemble_multimodal_context(
                    parent_asset, run_config, session, storage_provider_instance
                )
                
                full_provider_config_for_classify = {**run_config, **provider_specific_config}
                # Pass thinking_config from run_config to provider_specific_config if not already there.
                if "thinking_config" in run_config and "thinking_config" not in provider_specific_config:
                     provider_specific_config["thinking_config"] = run_config["thinking_config"]

                logger.debug(f"Task: Calling provider for Asset {parent_asset.id}, Schema {schema.id}, Run {run.id}. Text length: {len(text_content_for_provider)}, Media items: {len(provider_specific_config.get('media_inputs',[]))}")

                # Call the model registry for structured classification
                # Get the model name from run config (frontend sends as ai_model) or use default
                model_name = run_config.get("ai_model") or run_config.get("model_name", "gemini-2.5-flash-preview-05-20")
                thinking_enabled = run_config.get("thinking_config", {}).get("include_thoughts", False)
                
                logger.info(f"Task: Using model '{model_name}' for Asset {parent_asset.id}, Schema {schema.id}, Run {run.id}. Run config keys: {list(run_config.keys())}")
                
                provider_response = await model_registry.classify(
                    text_content=text_content_for_provider,
                    schema=OutputModelClass.model_json_schema(),
                    model_name=model_name,
                    instructions=final_schema_instructions,
                    thinking_enabled=thinking_enabled,
                    **{k: v for k, v in full_provider_config_for_classify.items() 
                       if k not in ['thinking_config', 'model_name']}
                )
                
                # Convert to envelope format for compatibility
                provider_response_envelope = {
                    "data": json.loads(provider_response.content) if provider_response.content else {},
                    "_model_name": provider_response.model_used,
                    "_thinking_trace": provider_response.thinking_trace
                }
                
                # DEBUG: Log provider response details (sequential path)
                logger.info(f"DEBUG: Sequential - Provider response for Asset {parent_asset.id}, Schema {schema.id}, Run {run.id}")
                logger.info(f"DEBUG: Sequential - Raw provider response content: {provider_response.content}")
                logger.info(f"DEBUG: Sequential - Parsed envelope data: {provider_response_envelope.get('data')}")
                logger.info(f"DEBUG: Sequential - Schema structure being used: {schema_structure}")
                
                created_annotations_for_asset = await demultiplex_results(
                    result=provider_response_envelope.get("data", provider_response_envelope),
                    schema_structure=schema_structure,
                    parent_asset=parent_asset,
                    schema=schema,
                    run=run,
                    db=session
                )
                
                all_created_annotations.extend(created_annotations_for_asset)
                
                # Handle _thinking_trace
                thinking_trace_content = provider_response_envelope.get("_thinking_trace")
                include_thoughts = run_config.get("thinking_config", {}).get("include_thoughts", False)

                if include_thoughts and thinking_trace_content:
                    # Find the parent document annotation among created_annotations_for_asset
                    parent_doc_annotation = next((ann for ann in created_annotations_for_asset if ann.asset_id == parent_asset.id), None)
                    if parent_doc_annotation:
                        thinking_justification = Justification(
                            annotation_id=None,  # Will be set after annotation is saved
                            field_name="_thinking_trace",
                            reasoning=thinking_trace_content,
                            model_name=provider_response_envelope.get("_model_name", run_config.get("model_name", "unknown")),
                            evidence_payload={"trace_type": "provider_summary"}
                        )
                        thinking_justification._parent_annotation_ref = parent_doc_annotation
                        all_created_justifications.append(thinking_justification)
                        logger.debug(f"Task: Created Justification object for _thinking_trace for Asset {parent_asset.id}, Run {run.id}.")
                
                logger.debug(f"Task: Successfully processed Asset {parent_asset.id} with Schema {schema.id} for Run {run.id}. Created {len(created_annotations_for_asset)} annotations.")

            except Exception as e_classify:
                error_msg = f"Asset {parent_asset.id}/Schema {schema.id} classification error: {str(e_classify)}"
                logger.error(f"Task: Error classifying Asset {parent_asset.id} with Schema {schema.id} for Run {run.id}: {e_classify}", exc_info=True)
                errors_run_level.append(error_msg)
                
                # Create a FAILED annotation for the parent asset
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
    
    logger.info(f"Task: Sequential processing completed. Created {len(all_created_annotations)} annotations, {len(all_created_justifications)} justifications, {len(errors_run_level)} errors")
    
    return all_created_annotations, all_created_justifications, errors_run_level

async def _process_annotation_run_async(run_id: int) -> None:
    """
    Process an annotation run using the new multi-modal engine.
    Fetches target assets, applies schemas, calls providers, and demultiplexes results.
    """
    import time
    start_time = time.time()
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

            # OPTIMIZATION 1: Create providers once per run, not per asset
            provider_start_time = time.time()
            app_settings = settings
            try:
                model_registry = await get_cached_provider("model_registry", app_settings)
                storage_provider_instance = await get_cached_provider("storage", app_settings)
                provider_creation_time = time.time() - provider_start_time
                logger.info(f"Task: Provider creation/retrieval took {provider_creation_time:.3f}s for Run {run.id}")
            except Exception as e_provider:
                logger.error(f"Task: Failed to create providers for Run {run.id}: {e_provider}", exc_info=True)
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
            
            if not target_asset_ids_to_process:
                logger.error(f"Task: No target assets for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No target assets found."
                session.add(run)
                session.commit()

            # CSV Row Expansion: Check for CSV parent assets and optionally expand to their CSV_ROW children
            csv_row_processing = run_config.get("csv_row_processing", True)  # Default to True for CSV row processing
            
            logger.info(f"Task: CSV row processing setting for Run {run.id}: {csv_row_processing}")
            logger.info(f"Task: Initial target asset IDs for Run {run.id}: {target_asset_ids_to_process}")
            
            if csv_row_processing:
                expanded_asset_ids = []
                csv_parents_processed = []
                
                for asset_id in target_asset_ids_to_process:
                    asset = session.get(Asset, asset_id)
                    logger.debug(f"Task: Checking asset {asset_id} - Kind: {asset.kind if asset else 'NOT_FOUND'}, Infospace: {asset.infospace_id if asset else 'N/A'}")
                    
                    if asset and asset.infospace_id == run.infospace_id and asset.kind == AssetKind.CSV:
                        # This is a CSV parent asset - fetch its CSV_ROW children
                        csv_row_children = session.exec(
                            select(Asset).where(
                                Asset.parent_asset_id == asset.id,
                                Asset.kind == AssetKind.CSV_ROW,
                                Asset.infospace_id == run.infospace_id
                            ).order_by(Asset.part_index)
                        ).all()
                        
                        logger.info(f"Task: Found {len(csv_row_children)} CSV_ROW children for CSV asset {asset.id}")
                        
                        if csv_row_children:
                            logger.info(f"Task: Expanding CSV asset {asset.id} ({asset.title}) to {len(csv_row_children)} CSV row children for Run {run.id}")
                            expanded_asset_ids.extend([child.id for child in csv_row_children])
                            csv_parents_processed.append(asset.id)
                        else:
                            logger.warning(f"Task: CSV asset {asset.id} has no CSV_ROW children. Including parent asset for Run {run.id}")
                            expanded_asset_ids.append(asset_id)
                    else:
                        # Not a CSV parent or asset not found - include as-is
                        expanded_asset_ids.append(asset_id)
                
                # Update the target asset list with expanded CSV rows
                target_asset_ids_to_process = expanded_asset_ids
                
                logger.info(f"Task: Final target asset IDs after CSV expansion for Run {run.id}: {target_asset_ids_to_process}")
                
                if csv_parents_processed:
                    logger.info(f"Task: Run {run.id} expanded {len(csv_parents_processed)} CSV parent assets to {len(target_asset_ids_to_process)} total assets including CSV rows")
            else:
                logger.info(f"Task: CSV row processing disabled for Run {run.id}. Processing CSV parent assets directly.")

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

            # OPTIMIZATION 2: Pre-validate all schemas before processing assets
            validated_schemas = []
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

                # NEW: Validate that the created model is not empty
                if not OutputModelClass.model_fields:
                    logger.error(f"Task: Schema {schema.id} ({schema.name}) for Run {run.id} resulted in an empty model with no fields. This schema cannot be used for structured output. Skipping this schema.")
                    errors_run_level.append(f"Schema {schema.id} ('{schema.name}') is invalid or empty and was skipped.")
                    continue

                # Assemble justification prompts to append to schema.instructions
                final_schema_instructions = schema.instructions or ""
                justification_prompts_parts = []
                needs_any_field_specific_justification_prompts = False

                # This is a precursor to generating detailed prompts for them.
                fields_that_will_have_justification_submodel = []
                potential_fields_to_check_for_justification = []
                
                # We need to map the python-safe field name back to its original schema and title
                field_metadata_map = {}

                # Gather all top-level field names from the original schema structure
                # These are the keys that schema.field_specific_justification_configs would refer to.
                if schema_structure.get("document_fields"): # This is the sub-schema for document
                    doc_props = schema_structure["document_fields"].get("properties", {})
                    for prop_name, prop_schema in doc_props.items():
                        py_name = make_python_identifier(prop_name)
                        potential_fields_to_check_for_justification.append(py_name)
                        field_metadata_map[py_name] = {"original_name": prop_name, "title": prop_schema.get("title")}
                
                for modality, per_modality_item_schema in schema_structure.get("per_modality_fields", {}).items():
                    # per_modality_item_schema is the sub-schema for an item (e.g., for one image)
                    modality_props = per_modality_item_schema.get("properties", {})
                    for prop_name, prop_schema in modality_props.items():
                        py_name = make_python_identifier(prop_name)
                        potential_fields_to_check_for_justification.append(py_name)
                        field_metadata_map[py_name] = {"original_name": prop_name, "title": prop_schema.get("title")}
                
                # Remove duplicates if a field name could appear in multiple contexts and ensure consistent order
                potential_fields_to_check_for_justification = sorted(list(set(potential_fields_to_check_for_justification)))

                if justification_mode != "NONE":
                    for field_name_to_check in potential_fields_to_check_for_justification:
                        # Use original name to check config
                        original_name = field_metadata_map.get(field_name_to_check, {}).get("original_name", field_name_to_check)
                        
                        # Simplified check mimicking part of create_pydantic_model_from_json_schema's decision
                        should_add_just_for_this_field = False
                        # schema_justification_configs uses the direct field name as key as per current examples.
                        # It expects FieldJustificationConfig objects or dicts convertible to them.
                        field_config_from_schema = schema_justification_configs.get(original_name)

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
                            "For evidence: use 'text_spans' - IMPORTANT: Provide 2-5 high-quality text spans that directly support your reasoning. "
                            "Each span should be a complete sentence or meaningful phrase. Ensure character offsets align with sentence boundaries when possible. "
                            "Prefer fewer, more meaningful spans over many short fragments. Avoid overlapping spans. "
                            "Format: list of objects with 'start_char_offset', 'end_char_offset', 'text_snippet', optional 'asset_uuid'. "
                            "Other evidence types: 'image_regions' (list of objects with 'asset_uuid', 'bounding_box' dict {'x', 'y', 'width', 'height', 'label'}), "
                            "'audio_segments' (list of objects with 'asset_uuid', 'start_time_seconds', 'end_time_seconds'), "
                            "or 'additional_evidence' (a dictionary for any other structured data)."
                        )
                    else: # SCHEMA_DEFAULT or ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT
                        # Add general structural guidance once if any field needs it
                        justification_prompts_parts.append(
                            "For any field requiring justification (e.g., 'fieldName_justification'), structure it with: "
                            "1. A 'reasoning' field (string) containing your explanation. "
                            "2. Optional evidence fields: "
                            "'text_spans': IMPORTANT TEXT EVIDENCE GUIDELINES - Provide 2-5 high-quality text spans that directly support your reasoning. "
                            "Each span should be a complete sentence or meaningful phrase. Ensure character offsets align with sentence boundaries when possible. "
                            "Format: list of objects with 'start_char_offset' (int), 'end_char_offset' (int), 'text_snippet' (str), and optionally 'asset_uuid' (str). "
                            "Prefer fewer, more meaningful spans over many short fragments. Avoid overlapping spans. "
                            "'image_regions': a list, each item an object with 'asset_uuid' (str) and a 'bounding_box' object (with 'x', 'y', 'width', 'height' as floats 0-1, and optional 'label' as str). "
                            "'audio_segments': a list, each item an object with 'asset_uuid' (str), 'start_time_seconds' (float), 'end_time_seconds' (float). "
                            "'additional_evidence': a dictionary for any other structured evidence types."
                        )
                        for field_name in fields_that_will_have_justification_submodel:
                            prompt_for_field_reasoning = None
                            metadata = field_metadata_map.get(field_name, {})
                            original_name = metadata.get("original_name", field_name)
                            title = metadata.get("title")
                            
                            field_display_name = f"'{original_name}'"
                            if title and title.lower() != original_name.lower():
                                field_display_name += f" (titled '{title}')"

                            field_config = schema_justification_configs.get(original_name)
                            
                            if field_config and field_config.get("custom_prompt"):
                                prompt_for_field_reasoning = field_config["custom_prompt"]
                            elif default_justification_prompt_template:
                                try:
                                    prompt_for_field_reasoning = default_justification_prompt_template.format(field_name=original_name, field_path=original_name)
                                except KeyError: # Handle if template has unexpected keys
                                    logger.warning(f"Default justification prompt template has unfulfillable keys for field {original_name}. Using basic prompt.")
                                    prompt_for_field_reasoning = f"Provide the reasoning for your value for the field {field_display_name}."
                            else:
                                prompt_for_field_reasoning = f"Provide the reasoning for your value for the field {field_display_name}."
                            
                            if prompt_for_field_reasoning:
                                # This prompt now focuses on the 'reasoning' part, structure is separate.
                                justification_prompts_parts.append(
                                    f"For the field {field_display_name}, populate its '{field_name}_justification.reasoning' with: {prompt_for_field_reasoning}"
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

                # Store the validated schema with all computed values
                validated_schemas.append({
                    "schema": schema,
                    "schema_structure": schema_structure,
                    "output_model_class": OutputModelClass,
                    "final_instructions": final_schema_instructions
                })

            if not validated_schemas:
                logger.error(f"Task: No valid schemas for Run {run.id} after validation.")
                run.status = RunStatus.FAILED
                run.error_message = "No valid schemas after validation."
                session.add(run)
                session.commit()
                return

            # OPTIMIZATION 3: Pre-fetch all assets to reduce DB queries
            assets_map = {}
            for asset_id in target_asset_ids_to_process:
                asset = session.get(Asset, asset_id)
                if asset and asset.infospace_id == run.infospace_id:
                    assets_map[asset_id] = asset
                else:
                    logger.warning(f"Task: Asset {asset_id} for Run {run.id} not found/invalid. Skipping.")
                    errors_run_level.append(f"Asset {asset_id} not found/invalid.")

            if not assets_map:
                logger.error(f"Task: No valid assets for Run {run.id}.")
                run.status = RunStatus.FAILED
                run.error_message = "No valid assets found."
                session.add(run)
                session.commit()
                return

            # OPTIMIZATION 4: Process schemas and assets with parallel or sequential processing
            # Get processing configuration
            processing_config = get_annotation_processing_config()
            
            # Get concurrency limit from run config or use configured default
            concurrency_limit = run_config.get("annotation_concurrency", processing_config['default_concurrency'])
            concurrency_limit = min(concurrency_limit, processing_config['max_concurrency'])  # Cap at maximum
            concurrency_limit = max(concurrency_limit, 1)  # Ensure at least 1
            
            # Check if parallel processing is enabled and feasible
            parallel_enabled = processing_config['parallel_enabled'] and run_config.get("enable_parallel_processing", True)
            
            if parallel_enabled and len(assets_map) * len(validated_schemas) > 1:
                logger.info(f"Task: Using parallel processing with concurrency limit of {concurrency_limit} for Run {run.id}")
                
                # Use parallel processing
                all_created_annotations, all_created_justifications, errors_run_level = await process_assets_parallel(
                    assets_map=assets_map,
                    validated_schemas=validated_schemas,
                    run=run,
                    run_config=run_config,
                    model_registry=model_registry,
                    storage_provider_instance=storage_provider_instance,
                    session=session,
                    concurrency_limit=concurrency_limit
                )
            else:
                logger.info(f"Task: Using sequential processing for Run {run.id} (parallel_enabled={parallel_enabled})")
                
                # Fallback to sequential processing
                all_created_annotations, all_created_justifications, errors_run_level = await process_assets_sequential(
                    assets_map=assets_map,
                    validated_schemas=validated_schemas,
                    run=run,
                    run_config=run_config,
                    model_registry=model_registry,
                    storage_provider_instance=storage_provider_instance,
                    session=session
                )

            # After processing all assets and schemas:
            if all_created_annotations:
                session.add_all(all_created_annotations)
                session.flush()  # Flush to get annotation IDs
                
                # Now update justification annotation IDs
                for justification in all_created_justifications:
                    if hasattr(justification, '_parent_annotation_ref'):
                        parent_annotation = justification._parent_annotation_ref
                        if parent_annotation and parent_annotation.id:
                            justification.annotation_id = parent_annotation.id
                        delattr(justification, '_parent_annotation_ref')  # Clean up temporary reference
            
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

            # Compute aggregates for this run and update monitor aggregates if applicable
            try:
                from app.api.services.annotation_service import AnnotationService
                from app.api.services.asset_service import AssetService
                asset_service = AssetService(session, storage_provider_instance)
                annotation_service = AnnotationService(session, model_registry, asset_service)
                annotation_service.compute_run_aggregates(run_id=run.id)
                if run.monitor_id:
                    annotation_service.update_monitor_aggregates(monitor_id=run.monitor_id, run_id=run.id)
            except Exception as agg_exc:
                logger.error(f"Task: Aggregation failed for run {run.id}: {agg_exc}", exc_info=True)
            
            total_time = time.time() - start_time
            logger.info(f"Task: AnnotationRun {run.id} finished. Status: {run.status}. Total Annotations: {len(all_created_annotations)}, Justifications: {len(all_created_justifications)}. Total time: {total_time:.2f}s")
            
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

async def _retry_failed_annotations_async(run_id: int) -> None:
    """
    Async function to retry failed annotations using actual LLM re-processing.
    Reuses the existing LLM processing pipeline.
    """
    logger.info(f"Task: Starting async retry of failed annotations for run {run_id}")
    
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
            run.error_message = None # Clear previous error message
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
                if original_status == RunStatus.COMPLETED_WITH_ERRORS:
                     run.status = RunStatus.COMPLETED
                session.add(run)
                session.commit()
                return

            logger.info(f"Task: Found {len(failed_annotations_to_retry)} failed annotations to retry for Run {run_id}.")
            
            # Set up providers (reuse from original processing)
            app_settings = settings
            try:
                model_registry = await get_cached_provider("model_registry", app_settings)
                storage_provider_instance = await get_cached_provider("storage", app_settings)
                logger.info(f"Task: Providers initialized for retry of Run {run.id}")
            except Exception as e_provider:
                logger.error(f"Task: Failed to create providers for retry of Run {run.id}: {e_provider}", exc_info=True)
                run.status = RunStatus.FAILED
                run.error_message = f"Provider initialization failed during retry: {str(e_provider)}"
                session.add(run)
                session.commit()
                return

            run_config = run.configuration or {}
            errors = []
            retried_count = 0
            successful_retries = 0

            # Group failed annotations by asset-schema pairs to avoid redundant processing
            retry_pairs = {}
            for annotation in failed_annotations_to_retry:
                key = (annotation.asset_id, annotation.schema_id)
                if key not in retry_pairs:
                    retry_pairs[key] = []
                retry_pairs[key].append(annotation)

            logger.info(f"Task: Retrying {len(retry_pairs)} unique asset-schema pairs for Run {run_id}.")

            for (asset_id, schema_id), annotations_for_pair in retry_pairs.items():
                try:
                    asset = session.get(Asset, asset_id)
                    schema = session.get(AnnotationSchema, schema_id)

                    if not asset or not schema or asset.infospace_id != run.infospace_id or schema.infospace_id != run.infospace_id:
                        logger.warning(f"Task: Skipping retry for Asset {asset_id}, Schema {schema_id} due to invalid context.")
                        errors.append(f"Invalid context for Asset {asset_id}, Schema {schema_id}")
                        continue

                    # Validate and prepare schema (reuse from original processing)
                    if not validate_hierarchical_schema(schema.output_contract):
                        logger.error(f"Task: Schema {schema.id} has invalid hierarchical structure during retry. Skipping.")
                        errors.append(f"Schema {schema.id} invalid structure during retry.")
                        continue
                    
                    schema_structure = detect_schema_structure(schema.output_contract)
                    
                    # Create output model (reuse from original processing)
                    try:
                        OutputModelClass = create_pydantic_model_from_json_schema(
                            model_name=f"RetryOutput_{schema.name.replace(' ', '_')}_{schema.id}",
                            json_schema=schema.output_contract,
                            justification_mode=run_config.get("justification_mode", "NONE"),
                            field_specific_justification_configs=schema.field_specific_justification_configs or {}
                        )
                    except Exception as e_model:
                        logger.error(f"Task: Failed to create Pydantic model for Schema {schema.id} during retry: {e_model}", exc_info=True)
                        errors.append(f"Schema {schema.id} model creation failed during retry: {e_model}")
                        continue

                    if not OutputModelClass.model_fields:
                        logger.error(f"Task: Schema {schema.id} resulted in empty model during retry. Skipping.")
                        errors.append(f"Schema {schema.id} is invalid or empty during retry.")
                        continue

                    # Prepare final instructions (reuse from original processing)
                    final_schema_instructions = schema.instructions or ""
                    
                    # Add system mapping prompt for per-modality fields if needed
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

                    schema_info = {
                        "schema": schema,
                        "schema_structure": schema_structure,
                        "output_model_class": OutputModelClass,
                        "final_instructions": final_schema_instructions
                    }

                    # Call the actual LLM processing function
                    logger.info(f"Task: Processing retry for Asset {asset.id}, Schema {schema.id} in Run {run.id}")
                    result = await process_single_asset_schema(
                        asset=asset,
                        schema_info=schema_info,
                        run=run,
                        run_config=run_config,
                        model_registry=model_registry,
                        storage_provider_instance=storage_provider_instance,
                        session=session
                    )

                    if result.get("success"):
                        # Delete old failed annotations and add new ones
                        for old_annotation in annotations_for_pair:
                            session.delete(old_annotation)
                        
                        # Add new annotations from the result
                        new_annotations = result.get("annotations", [])
                        if new_annotations:
                            session.add_all(new_annotations)
                            successful_retries += len(new_annotations)
                            logger.info(f"Task: Successfully retried Asset {asset.id}, Schema {schema.id} - created {len(new_annotations)} new annotations")
                        
                        # Add justifications if any
                        new_justifications = result.get("justifications", [])
                        if new_justifications:
                            session.add_all(new_justifications)
                    else:
                        # LLM processing failed, keep original annotations as FAILED
                        error_msg = result.get("error", "Unknown error during retry")
                        logger.error(f"Task: Retry failed for Asset {asset.id}, Schema {schema.id}: {error_msg}")
                        errors.append(f"Asset {asset.id}/Schema {schema.id}: {error_msg}")

                    retried_count += len(annotations_for_pair)

                except Exception as e:
                    logger.error(f"Task: Error retrying Asset {asset_id}, Schema {schema_id}: {e}", exc_info=True)
                    errors.append(f"Asset {asset_id}/Schema {schema_id}: {str(e)}")
                    retried_count += len(annotations_for_pair)
            
            # Finalize run status based on retry outcomes
            if errors:
                run.status = RunStatus.COMPLETED_WITH_ERRORS
                run.error_message = "\n".join(errors)
            else:
                # Check if any annotations are still FAILED for this run
                still_failed_count = session.exec(
                    select(func.count(Annotation.id)).where(Annotation.run_id == run.id, Annotation.status == ResultStatus.FAILED)
                ).one_or_none() or 0
                
                if still_failed_count > 0:
                    run.status = RunStatus.COMPLETED_WITH_ERRORS
                    run.error_message = f"{still_failed_count} annotations remain in FAILED state after retry attempt."
                else:
                    run.status = RunStatus.COMPLETED
            
            run.completed_at = datetime.now(timezone.utc)
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            logger.info(f"Task: Retry for AnnotationRun {run_id} finished. Status: {run.status}. Annotations retried: {retried_count}, Successful: {successful_retries}.")

        except Exception as e:
            logger.exception(f"Task: Unexpected critical error during async retry for AnnotationRun {run_id}: {e}")
            run_to_fail_retry = session.get(AnnotationRun, run_id)
            if run_to_fail_retry:
                run_to_fail_retry.status = RunStatus.FAILED
                run_to_fail_retry.error_message = f"Critical task error during retry: {str(e)}"
                run_to_fail_retry.updated_at = datetime.now(timezone.utc)
                session.add(run_to_fail_retry)
                session.commit()


@shared_task
def retry_failed_annotations(run_id: int) -> None:
    """
    Retry failed annotations in a run using actual LLM re-processing.
    This task will find annotations from the given run that are in a FAILED status
    and attempt to re-process them using the same LLM pipeline as the original run.
    """
    logger.info(f"Task: Sync wrapper started for retry of failed annotations in run {run_id}")
    
    try:
        # Use the helper function for proper event loop management
        run_async_in_celery(_retry_failed_annotations_async, run_id)
    except Exception as e:
        logger.exception(f"Task: Critical unhandled error in async retry processing for run {run_id}: {e}")
        # If the async task fails with an unhandled exception, mark the run as FAILED.
        with Session(engine) as session:
            try:
                run = session.get(AnnotationRun, run_id)
                if run:
                    run.status = RunStatus.FAILED
                    run.error_message = f"Critical task execution error during retry: {str(e)}"
                    run.completed_at = datetime.now(timezone.utc)
                    run.updated_at = datetime.now(timezone.utc)
                    session.add(run)
                    session.commit()
            except Exception as db_exc:
                logger.error(f"Task: Could not even update run {run_id} to FAILED status during retry: {db_exc}")
        raise  # Re-raise the exception so Celery knows the task failed 