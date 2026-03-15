"""
Shared task utilities: async execution in Celery, Pydantic model generation from JSON schema,
task status updates. Used across content, annotation, search, flow domains.
Re-export shim at api/tasks/utils.py.
"""
import logging
from typing import Optional, Type, Dict, Any, List, Union, Literal
from sqlmodel import Session
from app.models import Task
from app.core.db import engine
from pydantic import create_model, BaseModel, Field
import re
from app.schemas import JustificationSubModel

logger = logging.getLogger(__name__)


def update_task_status(task_id: int, status: str, message: Optional[str] = None):
    """Updates the status, message, timestamps, and failure count of the RecurringTask."""
    try:
        with Session(engine) as session:
            task = session.get(Task, task_id)
            if task:
                task.last_run_status = status
                task.last_run_message = message
                if status == "success":
                    task.last_successful_run_at = task.last_run_at
                    task.consecutive_failure_count = 0
                else:
                    task.consecutive_failure_count = (task.consecutive_failure_count or 0) + 1

                session.add(task)
                session.commit()
                logger.info(f"RecurringTask {task_id} final status updated: {status}. Failures: {task.consecutive_failure_count}")
            else:
                logger.error(f"RecurringTask {task_id} not found during final status update.")
    except Exception as e:
        logger.error(f"Error updating final status for RecurringTask {task_id}: {e}", exc_info=True)
        raise e


def make_python_identifier(name: str) -> str:
    """Converts a string to a valid Python identifier."""
    name = re.sub(r'[^0-9a-zA-Z_]', '', name)
    name = re.sub(r'^[^a-zA-Z_]+', '', name)
    if not name:
        return "unnamed_field"
    elif name[0].isdigit():
        return f"_{name}"
    return name


def create_literal_type(enum_values: List[str]) -> Type:
    """Create a Literal type from a list of enum values."""
    if len(enum_values) == 1:
        return Literal[enum_values[0]]
    elif len(enum_values) == 2:
        return Union[Literal[enum_values[0]], Literal[enum_values[1]]]
    else:
        result = Union[Literal[enum_values[-2]], Literal[enum_values[-1]]]
        for v in reversed(enum_values[:-2]):
            result = Union[Literal[v], result]
        return result


def map_json_type_to_python_type(json_type: Union[str, List[str]]) -> Any:
    """Maps JSON schema types to Python types for Pydantic models."""
    if isinstance(json_type, list):
        non_null_types = [t for t in json_type if t != "null"]
        if not non_null_types:
            return Any
        json_type = non_null_types[0]

    if json_type == "string":
        return str
    elif json_type == "number":
        return float
    elif json_type == "integer":
        return int
    elif json_type == "boolean":
        return bool
    elif json_type == "array":
        return List[Any]
    elif json_type == "object":
        return Dict[str, Any]
    else:
        return Any


def create_pydantic_model_from_json_schema(
    model_name: str,
    json_schema: Dict[str, Any],
    processed_models: Optional[Dict[str, Type[BaseModel]]] = None,
    justification_mode: str = "NONE",
    field_specific_justification_configs: Optional[Dict[str, Any]] = None,
    is_per_modality_item_schema: bool = False
) -> Type[BaseModel]:
    """
    Dynamically creates a Pydantic model from a JSON schema dictionary.
    Handles nested objects and arrays of objects.
    Augments the model with justification fields based on configuration.
    """
    if processed_models is None:
        processed_models = {}
    if field_specific_justification_configs is None:
        field_specific_justification_configs = {}

    if json_schema.get("type") != "object":
        logger.info(f"Top-level schema for '{model_name}' is not an object. Wrapping it in a 'root' object.")
        json_schema = {
            "type": "object",
            "properties": {"value": json_schema},
            "required": ["value"]
        }

    safe_model_name = make_python_identifier(model_name)
    if not safe_model_name.strip() or safe_model_name == "BaseModel":
        safe_model_name = f"DynamicModel_{len(processed_models)}"

    if safe_model_name in processed_models:
        return processed_models[safe_model_name]

    fields: Dict[str, Any] = {}
    schema_properties = json_schema.get("properties", {})
    required_fields = set(json_schema.get("required", []))

    if is_per_modality_item_schema and json_schema.get("type") == "object":
        system_uuid_field_name = "system_asset_source_uuid"
        if system_uuid_field_name not in schema_properties:
            fields[system_uuid_field_name] = (Optional[str], Field(default=None, description="Internal system field for mapping to source asset UUID."))
        else:
            logger.warning(f"Could not add internal field '{system_uuid_field_name}' to model {safe_model_name} as it conflicts with a user-defined property.")

    for prop_name, prop_schema in schema_properties.items():
        field_name = make_python_identifier(prop_name)
        is_optional = field_name not in required_fields
        prop_type_json = prop_schema.get("type")
        field_info_kwargs = {"description": prop_schema.get("description")}
        if prop_type_json == "number":
            if "minimum" in prop_schema:
                field_info_kwargs["ge"] = prop_schema["minimum"]
            if "maximum" in prop_schema:
                field_info_kwargs["le"] = prop_schema["maximum"]
        field_info = Field(**field_info_kwargs)
        current_field_path = prop_name

        if prop_type_json == "object" and "properties" in prop_schema:
            nested_model_name = f"{safe_model_name}_{field_name}"
            field_type = create_pydantic_model_from_json_schema(
                nested_model_name, prop_schema, processed_models,
                justification_mode=justification_mode,
                field_specific_justification_configs=field_specific_justification_configs,
                is_per_modality_item_schema=False
            )
        elif prop_type_json == "array" and "items" in prop_schema:
            items_schema = prop_schema["items"]
            items_type_json = items_schema.get("type")
            if items_type_json == "object" and "properties" in items_schema:
                array_item_model_name = f"{safe_model_name}_{field_name}_Item"
                current_prop_is_per_modality_array = prop_name.startswith("per_")
                list_item_type = create_pydantic_model_from_json_schema(
                    array_item_model_name, items_schema, processed_models,
                    justification_mode=justification_mode,
                    field_specific_justification_configs=field_specific_justification_configs,
                    is_per_modality_item_schema=current_prop_is_per_modality_array
                )
            else:
                list_item_type = map_json_type_to_python_type(items_type_json) if items_type_json else Any
                if "enum" in items_schema and isinstance(items_schema["enum"], list) and len(items_schema["enum"]) > 0:
                    enum_values = items_schema["enum"]
                    if items_type_json == "string":
                        list_item_type = create_literal_type(enum_values)
            field_type = List[list_item_type]
        else:
            field_type = map_json_type_to_python_type(prop_type_json) if prop_type_json else Any
            if prop_type_json == "string" and "enum" in prop_schema:
                enum_values = prop_schema["enum"]
                if isinstance(enum_values, list) and len(enum_values) > 0:
                    field_type = create_literal_type(enum_values)

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

    final_model_name = safe_model_name
    counter = 1
    while final_model_name in processed_models and processed_models[final_model_name].__fields__.keys() != fields.keys():
        final_model_name = f"{safe_model_name}_{counter}"
        counter += 1

    if not fields:
        DynamicModel = create_model(final_model_name, __base__=BaseModel)
    else:
        DynamicModel = create_model(final_model_name, **fields, __base__=BaseModel)

    processed_models[final_model_name] = DynamicModel
    return DynamicModel


def run_async_in_celery(async_func, *args, **kwargs):
    """
    Safely run an async function in a Celery task context.
    Manages the event loop to avoid "Event loop is closed" errors.
    """
    import asyncio
    loop = None
    try:
        current_loop = asyncio.get_event_loop()
        if current_loop and not current_loop.is_closed() and not current_loop.is_running():
            loop = current_loop
        else:
            raise RuntimeError("Current loop is not usable")
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)

    if not loop:
        raise RuntimeError("Could not obtain a usable event loop")

    try:
        return loop.run_until_complete(async_func(*args, **kwargs))
    except Exception as e:
        logger.error(f"Error in async function {async_func.__name__}: {e}", exc_info=True)
        raise
    finally:
        try:
            pending_tasks = [t for t in asyncio.all_tasks(loop) if not t.done()]
            if pending_tasks:
                for t in pending_tasks:
                    if not t.done():
                        t.cancel()
                try:
                    loop.run_until_complete(asyncio.wait_for(asyncio.gather(*pending_tasks, return_exceptions=True), timeout=5.0))
                except (asyncio.TimeoutError, Exception):
                    pass
        except Exception:
            pass
