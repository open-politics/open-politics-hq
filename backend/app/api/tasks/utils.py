import logging
from typing import Optional, Type, Dict, Any, List, Union
from sqlmodel import Session
from app.models import Task
from app.core.db import engine  # Import engine for session creation
from pydantic import create_model, BaseModel, Field
import re
# Import JustificationSubModel
from app.schemas import JustificationSubModel

logger = logging.getLogger(__name__)

# Moved from recurring_ingestion.py
def update_task_status(task_id: int, status: str, message: Optional[str] = None):
    """Updates the status, message, timestamps, and failure count of the RecurringTask."""
    try:
        with Session(engine) as session:
            task = session.get(Task, task_id)
            if task:
                task.last_run_status = status
                task.last_run_message = message
                # last_run_at is set by the scheduler before dispatch

                # Update last_successful_run_at only on success
                if status == "success":
                    # Assuming task.last_run_at was set correctly by the scheduler
                    task.last_successful_run_at = task.last_run_at
                    task.consecutive_failure_count = 0 # Reset counter on success
                else:
                    # Increment failure count, handling None initial value
                    task.consecutive_failure_count = (task.consecutive_failure_count or 0) + 1

                session.add(task)
                session.commit()
                logger.info(f"RecurringTask {task_id} final status updated: {status}. Failures: {task.consecutive_failure_count}")
            else:
                logger.error(f"RecurringTask {task_id} not found during final status update.")
    except Exception as e:
        logger.error(f"Error updating final status for RecurringTask {task_id}: {e}", exc_info=True)
        # We're managing our own session here, so we should handle errors and rollback if needed
        # Re-raise or handle as needed, but logging is important
        # Consider re-raising to allow the calling task to handle it
        raise e 

def make_python_identifier(name: str) -> str:
    """Converts a string to a valid Python identifier."""
    # Remove invalid characters
    name = re.sub(r'[^0-9a-zA-Z_]', '', name)
    # Remove leading characters until we find a letter or underscore
    name = re.sub(r'^[^a-zA-Z_]+', '', name)
    if not name: # if empty after stripping
        return "unnamed_field"
    elif name[0].isdigit(): # if starts with digit, prefix with underscore
        return f"_{name}"
    return name

def map_json_type_to_python_type(json_type: Union[str, List[str]]) -> Any:
    """Maps JSON schema types to Python types for Pydantic models."""
    # Handle simple case first
    if isinstance(json_type, list):
        # For ["null", "string"], prefer "string" and make it Optional
        # This is a simplification; more sophisticated union handling might be needed
        non_null_types = [t for t in json_type if t != "null"]
        if not non_null_types: # Only "null" or empty list
            return Any # Or raise error
        # If multiple non-null types, it's a Union, Pydantic handles this with Union[...]
        # For simplicity here, pick the first non-null type.
        # A more robust version would construct Union[type1, type2, ...]
        # and handle Optional[Union[...]]
        json_type = non_null_types[0]
        # Presence of "null" implies Optional, will be handled by default value or field definition
    
    if json_type == "string":
        return str
    elif json_type == "number": # JSON schema "number" can be float or int
        return float # Default to float, can be refined by format
    elif json_type == "integer":
        return int
    elif json_type == "boolean":
        return bool
    elif json_type == "array":
        return List[Any] # Placeholder, ideally should be List[<item_type>]
    elif json_type == "object":
        return Dict[str, Any] # Placeholder, ideally a nested Pydantic model
    else: # "null" or unknown
        return Any

def create_pydantic_model_from_json_schema(
    model_name: str,
    json_schema: Dict[str, Any],
    processed_models: Optional[Dict[str, Type[BaseModel]]] = None,
    # New parameters for justification
    justification_mode: str = "NONE", # e.g., "NONE", "SCHEMA_DEFAULT", "ALL_WITH_GLOBAL_PROMPT"
    field_specific_justification_configs: Optional[Dict[str, Any]] = None, # From AnnotationSchema
    # default_justification_prompt: Optional[str] = None, # Not used by this function, but part of the thinking
    # global_justification_prompt: Optional[str] = None, # Not used by this function
    # base_path: str = "" # To construct full field paths for justification_configs lookup
    # New parameter to indicate if we are processing a schema for an item within a per_modality array
    is_per_modality_item_schema: bool = False
) -> Type[BaseModel]:
    """
    Dynamically creates a Pydantic model from a JSON schema dictionary.
    Handles nested objects and arrays of objects.
    Augments the model with justification fields based on configuration.
    `processed_models` is used for caching and preventing re-definition of nested models.
    """
    if processed_models is None:
        processed_models = {}
    
    if field_specific_justification_configs is None:
        field_specific_justification_configs = {}

    # Sanitize model_name to be a valid Python class name
    safe_model_name = make_python_identifier(model_name)
    if not safe_model_name.strip() or safe_model_name == "BaseModel": # Avoid empty or conflicting names
        safe_model_name = f"DynamicModel_{len(processed_models)}"


    if safe_model_name in processed_models:
        # If model name already processed, check if the current call needs justification augmentation
        # This is a simplified check. A more robust system might need to version models based on augmentation.
        # For now, if it exists, we assume it was processed with the correct context or that augmentation isn't needed at this level.
        return processed_models[safe_model_name]

    fields: Dict[str, Any] = {}
    
    if json_schema.get("type") != "object" or not json_schema.get("properties"):
        logger.warning(f"JSON schema for '{safe_model_name}' is not a valid object with properties. Augmentation for justification might not apply as expected.")
        # Fallback for non-object schema (e.g. a schema that is just a string):
        if "type" in json_schema:
             py_type = map_json_type_to_python_type(json_schema["type"])
             if json_schema.get("type") != "object":
                 logger.info(f"Schema '{safe_model_name}' is of type '{json_schema.get('type')}', not object. Creating empty model without justification fields.")
                 # return create_model(safe_model_name, __base__=BaseModel) # empty model - original behavior

    schema_properties = json_schema.get("properties", {})
    required_fields = set(json_schema.get("required", []))

    # Inject _system_asset_source_uuid if this is identified as a per-modality item schema
    if is_per_modality_item_schema and json_schema.get("type") == "object":
        # Ensure it doesn't clash with a user-defined field (unlikely with this name)
        # This field is for internal LLM output mapping, to be stripped before final storage.
        system_uuid_field_name = "_system_asset_source_uuid"
        if system_uuid_field_name not in schema_properties:
            fields[system_uuid_field_name] = (Optional[str], Field(default=None, description="Internal system field for mapping to source asset UUID."))
            logger.debug(f"Added internal field '{system_uuid_field_name}' to model {safe_model_name} for per-modality item.")
        else:
            logger.warning(f"Could not add internal field '{system_uuid_field_name}' to model {safe_model_name} as it conflicts with a user-defined property.")

    for prop_name, prop_schema in schema_properties.items():
        field_name = make_python_identifier(prop_name)
        is_optional = field_name not in required_fields
        
        prop_type_json = prop_schema.get("type")
        default_value = prop_schema.get("default")
        if is_optional and default_value is None :
            default_value = None

        current_field_path = prop_name # For a flat schema, path is just prop_name
                                      # For nested, this would be built up, e.g. "document.summary"

        if prop_type_json == "object" and "properties" in prop_schema:
            nested_model_name = f"{safe_model_name}_{field_name}"
            # Pass justification parameters down for nested models
            field_type = create_pydantic_model_from_json_schema(
                nested_model_name, 
                prop_schema, 
                processed_models,
                justification_mode=justification_mode, # Pass through
                field_specific_justification_configs=field_specific_justification_configs, # Pass through (might need path-based lookup)
                # base_path=f"{base_path}{prop_name}." # For constructing full field paths if needed
                is_per_modality_item_schema=False # Standard nested object, not directly a per-modality item unless explicitly set
            )
        elif prop_type_json == "array" and "items" in prop_schema:
            items_schema = prop_schema["items"]
            items_type_json = items_schema.get("type")
            if items_type_json == "object" and "properties" in items_schema:
                array_item_model_name = f"{safe_model_name}_{field_name}_Item"
                # Pass justification parameters down for objects within arrays
                # Determine if this array itself is a per_modality target
                # This is a heuristic: if the original property name (before sanitization) starts with "per_"
                current_prop_is_per_modality_array = prop_name.startswith("per_")
                
                list_item_type = create_pydantic_model_from_json_schema(
                    array_item_model_name, 
                    items_schema, 
                    processed_models,
                    justification_mode=justification_mode, # Pass through
                    field_specific_justification_configs=field_specific_justification_configs, # Pass through
                    # base_path=f"{base_path}{prop_name}[]." # Placeholder for path in array
                    is_per_modality_item_schema=current_prop_is_per_modality_array # Set flag if this is a per_modality array's items
                )
            else:
                list_item_type = map_json_type_to_python_type(items_type_json) if items_type_json else Any
            field_type = List[list_item_type]
        else:
            field_type = map_json_type_to_python_type(prop_type_json) if prop_type_json else Any

        if isinstance(prop_type_json, list) and "null" in prop_type_json:
            is_optional = True

        if is_optional:
            fields[field_name] = (Union[field_type, None], Field(default=default_value, description=prop_schema.get("description")))
        else: # Required field
            fields[field_name] = (field_type, Field(description=prop_schema.get("description")))

        # --- Add justification field if needed ---
        # This logic applies to properties of the current object schema being processed.
        # It doesn't try to guess paths into nested structures for field_specific_justification_configs
        # but relies on the configs being relevant to the current schema's properties.
        needs_justification = False
        if justification_mode == "SCHEMA_DEFAULT":
            # field_specific_justification_configs is expected to be Dict[str, FieldJustificationConfig]
            # FieldJustificationConfig is a Pydantic model {enabled: bool, custom_prompt: Optional[str]}
            # So, field_config would be an instance of FieldJustificationConfig or None.
            field_config_data = field_specific_justification_configs.get(current_field_path) 
            if field_config_data and isinstance(field_config_data, dict) and field_config_data.get("enabled", False):
                 needs_justification = True
            elif hasattr(field_config_data, 'enabled') and getattr(field_config_data, 'enabled', False):
                 needs_justification = True # If it's already an object with an enabled attribute

        elif justification_mode.startswith("ALL_"): # "ALL_WITH_GLOBAL_PROMPT" or "ALL_WITH_SCHEMA_OR_DEFAULT_PROMPT"
            field_config_data = field_specific_justification_configs.get(current_field_path)
            if field_config_data and isinstance(field_config_data, dict) and field_config_data.get("enabled") is False:
                needs_justification = False # Explicitly disabled
            elif hasattr(field_config_data, 'enabled') and getattr(field_config_data, 'enabled') is False:
                needs_justification = False # Explicitly disabled
            else:
                needs_justification = True
        
        if needs_justification:
            justification_field_name = f"{field_name}_justification"
            fields[justification_field_name] = (
                Optional[JustificationSubModel], 
                Field(default=None, description=f"Automated justification for the field '{field_name}'.")
            )
            logger.debug(f"Added justification field: {justification_field_name} for {field_name} in model {safe_model_name}")

    # Create the model
    # Ensure unique model name if recursion or multiple calls might generate same name
    final_model_name = safe_model_name
    counter = 1
    while final_model_name in processed_models and processed_models[final_model_name].__fields__.keys() != fields.keys(): # basic check for conflict
        final_model_name = f"{safe_model_name}_{counter}"
        counter += 1
    
    if not fields and json_schema.get("type") != "object": # Handle case of non-object schema like simple "string"
        # This part is tricky for a generic model creator.
        # The ClassificationProvider expects a BaseModel. If schema is just "string",
        # we might need to return a model with a single field, e.g., Model(value: str).
        # Or the provider itself should handle primitive types if schema is not an object.
        # For now, let's assume `classify` will typically get object schemas.
        # If truly a non-object schema, creating an empty model:
        logger.info(f"Schema '{model_name}' did not result in any fields (type: {json_schema.get('type')}). Creating an empty Pydantic model: {final_model_name}")
        DynamicModel = create_model(final_model_name, __base__=BaseModel)
    elif not fields and json_schema.get("type") == "object" and not schema_properties:
        logger.info(f"Schema '{model_name}' is an object with no properties. Creating an empty Pydantic model: {final_model_name}")
        DynamicModel = create_model(final_model_name, __base__=BaseModel)
    else:
        DynamicModel = create_model(final_model_name, **fields, __base__=BaseModel)

    processed_models[final_model_name] = DynamicModel
    return DynamicModel

# Example Usage (for testing this utility):
if __name__ == "__main__":
    test_schema = {
        "type": "object",
        "properties": {
            "summary": {"type": "string", "description": "A summary of the document."},
            "sentiment": {"type": "string", "enum": ["positive", "negative", "neutral"]},
            "keywords": {"type": "array", "items": {"type": "string"}},
            "is_urgent": {"type": "boolean", "default": False},
            "confidence_score": {"type": "number"},
            "cited_references": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "citation_id": {"type": "string"},
                        "source_document_uuid": {"type": "string"},
                        "details": {"type": "string"}
                    },
                    "required": ["citation_id"]
                }
            },
            "author_details": {
                "type": "object",
                "properties": {
                    "name": {"type": "string"},
                    "affiliation": {"type": ["string", "null"]} # Optional string
                },
                "required": ["name"]
            },
            "complex-field-name!": {"type": "integer"}
        },
        "required": ["summary", "sentiment"]
    }
    
    GeneratedModel = create_pydantic_model_from_json_schema("MyGeneratedSchema", test_schema)
    print(f"Generated Model: {GeneratedModel.__name__}")
    print(GeneratedModel.model_json_schema(indent=2))

    # Test instantiation
    try:
        instance = GeneratedModel(
            summary="This is a test.",
            sentiment="positive",
            keywords=["test", "pydantic", "dynamic"],
            confidence_score=0.95,
            cited_references=[
                {"citation_id": "ref1", "source_document_uuid": "uuid_abc", "details": "Some details"},
                {"citation_id": "ref2"}
            ],
            author_details={"name": "Dr. Schema", "affiliation": "Generics University"},
            complex_field_name=123
        )
        print("\nInstance created successfully:")
        print(instance.model_dump_json(indent=2))
    except Exception as e:
        print(f"\nError instantiating: {e}")

    # Test optional field not provided
    try:
        instance_min = GeneratedModel(summary="Min test", sentiment="neutral")
        print("\nMinimal instance:")
        print(instance_min.model_dump_json(indent=2)) # is_urgent should be False (default)
                                                    # affiliation should be None
    except Exception as e:
        print(f"\nError instantiating minimal: {e}")

    # Test another schema for array of objects
    image_analysis_schema = {
        "type": "object",
        "properties": {
            "image_objects": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "child_asset_uuid": {"type": "string"},
                        "label": {"type": "string"},
                        "box": {"type": "array", "items": {"type": "number"}}
                    },
                    "required": ["child_asset_uuid", "label"]
                }
            }
        }
    }
    ImageAnalysisModel = create_pydantic_model_from_json_schema("ImageAnalysisOutput", image_analysis_schema)
    print(f"\nGenerated Model: {ImageAnalysisModel.__name__}")
    print(ImageAnalysisModel.model_json_schema(indent=2))
    img_instance = ImageAnalysisModel(image_objects=[
        {"child_asset_uuid": "img_uuid_1", "label": "cat", "box": [0.1, 0.1, 0.5, 0.5]},
        {"child_asset_uuid": "img_uuid_2", "label": "dog", "box": [0.2, 0.2, 0.6, 0.6]}
    ])
    print(img_instance.model_dump_json(indent=2)) 
