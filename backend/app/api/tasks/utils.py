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

    # NEW: If the top-level schema is not an object, wrap it in a root object
    # This allows schemas like a top-level array of strings to be processed.
    if json_schema.get("type") != "object":
        logger.info(f"Top-level schema for '{model_name}' is not an object (type: {json_schema.get('type')}). Wrapping it in a 'root' object for processing.")
        json_schema = {
            "type": "object",
            "properties": {
                "value": json_schema
            },
            "required": ["value"]
        }

    # Sanitize model_name to be a valid Python class name
    safe_model_name = make_python_identifier(model_name)
    if not safe_model_name.strip() or safe_model_name == "BaseModel": # Avoid empty or conflicting names
        safe_model_name = f"DynamicModel_{len(processed_models)}"


    if safe_model_name in processed_models:
        return processed_models[safe_model_name]

    fields: Dict[str, Any] = {}
    
    if not json_schema.get("properties"):
        logger.warning(f"JSON schema for '{safe_model_name}' does not contain any properties.")

    schema_properties = json_schema.get("properties", {})
    required_fields = set(json_schema.get("required", []))

    if is_per_modality_item_schema and json_schema.get("type") == "object":
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
        
        # The 'default' keyword in JSON schema is for validation/UI, not for the LLM's structural output definition.
        # Pydantic's Field(default=...) causes the provider library to see a 'default' key, which it doesn't support.
        # Optional fields will default to `None` automatically unless a value is provided.
        # By NOT passing `default` to `Field`, we prevent Pydantic from adding `"default": null` to the generated JSON schema.
        field_info = Field(description=prop_schema.get("description"))

        current_field_path = prop_name 

        if prop_type_json == "object" and "properties" in prop_schema:
            nested_model_name = f"{safe_model_name}_{field_name}"
            field_type = create_pydantic_model_from_json_schema(
                nested_model_name, 
                prop_schema, 
                processed_models,
                justification_mode=justification_mode,
                field_specific_justification_configs=field_specific_justification_configs,
                is_per_modality_item_schema=False
            )
        elif prop_type_json == "array" and "items" in prop_schema:
            items_schema = prop_schema["items"]
            items_type_json = items_schema.get("type")
            if items_type_json == "object" and "properties" in items_schema:
                array_item_model_name = f"{safe_model_name}_{field_name}_Item"
                # Determine if this array itself is a per_modality target
                current_prop_is_per_modality_array = prop_name.startswith("per_")
                
                list_item_type = create_pydantic_model_from_json_schema(
                    array_item_model_name, 
                    items_schema, 
                    processed_models,
                    justification_mode=justification_mode,
                    field_specific_justification_configs=field_specific_justification_configs,
                    is_per_modality_item_schema=current_prop_is_per_modality_array
                )
            else:
                list_item_type = map_json_type_to_python_type(items_type_json) if items_type_json else Any
            field_type = List[list_item_type]
        else:
            field_type = map_json_type_to_python_type(prop_type_json) if prop_type_json else Any

        if isinstance(prop_type_json, list) and "null" in prop_type_json:
            is_optional = True

        if is_optional:
            fields[field_name] = (Optional[field_type], field_info)
        else: 
            fields[field_name] = (field_type, field_info)

        needs_justification = False
        if justification_mode == "SCHEMA_DEFAULT":
            field_config_data = field_specific_justification_configs.get(current_field_path) 
            if field_config_data and isinstance(field_config_data, dict) and field_config_data.get("enabled", False):
                 needs_justification = True
            elif hasattr(field_config_data, 'enabled') and getattr(field_config_data, 'enabled', False):
                 needs_justification = True

        elif justification_mode.startswith("ALL_"):
            field_config_data = field_specific_justification_configs.get(current_field_path)
            if field_config_data and isinstance(field_config_data, dict) and field_config_data.get("enabled") is False:
                needs_justification = False
            elif hasattr(field_config_data, 'enabled') and getattr(field_config_data, 'enabled') is False:
                needs_justification = False
            else:
                needs_justification = True
        
        if needs_justification:
            justification_field_name = f"{field_name}_justification"
            fields[justification_field_name] = (
                Optional[JustificationSubModel], 
                Field(default=None, description=f"Automated justification for the field '{field_name}'.")
            )
            logger.debug(f"Added justification field: {justification_field_name} for {field_name} in model {safe_model_name}")

    final_model_name = safe_model_name
    counter = 1
    while final_model_name in processed_models and processed_models[final_model_name].__fields__.keys() != fields.keys():
        final_model_name = f"{safe_model_name}_{counter}"
        counter += 1
    
    if not fields:
        logger.info(f"Schema '{model_name}' did not result in any fields. Creating an empty Pydantic model: {final_model_name}")
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

def monitor_provider_cache():
    """
    Monitor provider cache status across tasks.
    This can be called from management commands or monitoring endpoints.
    """
    try:
        from app.api.tasks.annotate import get_cache_status
        cache_info = get_cache_status()
        print(f"Provider Cache Status:")
        print(f"  - Cache size: {cache_info['cache_size']}")
        print(f"  - Cached providers: {cache_info['cached_providers']}")
        return cache_info
    except ImportError:
        print("Error: Could not import cache utilities")
        return None

def clear_all_provider_caches():
    """
    Clear all provider caches. Useful for memory cleanup or cache invalidation.
    """
    try:
        from app.api.tasks.annotate import clear_provider_cache
        clear_provider_cache()
        print("Provider cache cleared successfully")
        return True
    except ImportError:
        print("Error: Could not import cache utilities")
        return False

def get_performance_recommendations(asset_count: int, schema_count: int) -> dict:
    """
    Provide performance recommendations based on workload size.
    """
    total_operations = asset_count * schema_count
    
    recommendations = {
        "total_operations": total_operations,
        "recommendations": []
    }
    
    if total_operations > 100:
        recommendations["recommendations"].append(
            "Consider breaking large annotation runs into smaller batches for better monitoring and error recovery"
        )
    
    if asset_count > 50:
        recommendations["recommendations"].append(
            "Large asset count detected. Ensure sufficient memory for asset pre-fetching optimization"
        )
    
    if schema_count > 10:
        recommendations["recommendations"].append(
            "Multiple schemas detected. Schema pre-validation optimization will provide significant performance benefits"
        )
    
    recommendations["estimated_improvement"] = "60-80% performance improvement with caching optimizations"
    
    return recommendations 
