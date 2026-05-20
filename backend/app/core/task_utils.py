"""
Shared task utilities: async execution in Celery, Pydantic model generation from JSON schema,
task status updates. Used across content, annotation, search, flow domains.
Re-export shim at api/tasks/utils.py.
"""
import copy
import logging
import re
from typing import Optional, Tuple, Type, Dict, Any, List, Union, Literal
from sqlmodel import Session
from app.models import Task
from app.core.db import engine
from pydantic import create_model, BaseModel, Field
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


def split_schema_for_extraction(
    output_contract: Dict[str, Any],
) -> Tuple[Dict[str, Any], List[Dict[str, Any]]]:
    """Split an output_contract into (scalar_subset, list_field_descriptors).

    The two-phase iterative extraction pipeline (Phase A scalars + Phase B
    open-ended tool loop) routes ``array<object>`` fields to Phase B because
    their cardinality is model-determined and risks blowing past per-call
    output caps. Everything else — scalars, enums, objects, ``array<primitive>``
    fields — is bounded and lives in Phase A.

    HQ schemas are typically hierarchical: the real fields live at
    ``output_contract.properties.document.properties.<field>``. Per-modality
    wrappers (``per_image``, ``per_audio``) are bounded by the input media
    count and stay in Phase A regardless of their item shape.

    Args:
        output_contract: full schema as stored on AnnotationSchema.

    Returns:
        scalar_subset: deep-copied output_contract with each ``array<object>``
            field at the document level removed from ``properties`` AND from
            ``required``. The Pydantic builder fed this contract produces a
            partial model that the LLM can fill in one Phase A call.
        list_fields: ordered list of descriptors, one per removed field::

            {
                "name": str,                # bare field name, e.g. "triplets"
                "path": str,                # dotted path, e.g. "document.triplets"
                "item_schema": dict,        # JSON Schema for the array's items
                "description": str | None,  # field description (for prompts)
            }

        Empty list_fields means the schema has no Phase B work — the caller
        should fall back to single-shot.
    """
    if not isinstance(output_contract, dict):
        return output_contract or {}, []

    contract = copy.deepcopy(output_contract)
    props = contract.get("properties")
    if not isinstance(props, dict):
        return contract, []

    # Locate the layer holding the actual fields. Hierarchical schemas wrap in
    # ``document.properties``; flat schemas have fields directly at top level.
    document_node = props.get("document")
    if isinstance(document_node, dict) and isinstance(document_node.get("properties"), dict):
        target_props: Dict[str, Any] = document_node["properties"]
        target_required = document_node.get("required") if isinstance(document_node.get("required"), list) else []
        path_prefix = "document"
        required_owner = document_node
    else:
        target_props = props
        target_required = contract.get("required") if isinstance(contract.get("required"), list) else []
        path_prefix = ""
        required_owner = contract

    # Identify ``array<object>`` fields. Per-modality wrappers (``per_*``) are
    # explicitly bounded by input media — leave them in Phase A even when
    # their items are objects.
    list_fields: List[Dict[str, Any]] = []
    list_field_names: List[str] = []
    for name, prop in list(target_props.items()):
        if name.startswith("per_"):
            continue
        if not isinstance(prop, dict):
            continue
        if prop.get("type") != "array":
            continue
        items = prop.get("items")
        if not isinstance(items, dict):
            continue
        if items.get("type") != "object":
            continue
        if not isinstance(items.get("properties"), dict):
            continue
        list_fields.append({
            "name": name,
            "path": f"{path_prefix}.{name}" if path_prefix else name,
            "item_schema": copy.deepcopy(items),
            "description": prop.get("description"),
            "include_justification": bool(prop.get("include_justification")),
            "justification_prompt": prop.get("justification_prompt"),
        })
        list_field_names.append(name)

    # Strip them from the scalar subset.
    for name in list_field_names:
        target_props.pop(name, None)
    if list_field_names and target_required:
        new_required = [r for r in target_required if r not in list_field_names]
        required_owner["required"] = new_required

    return contract, list_fields


def create_pydantic_model_from_json_schema(
    model_name: str,
    json_schema: Dict[str, Any],
    processed_models: Optional[Dict[str, Type[BaseModel]]] = None,
    justifications_enabled: bool = True,
    is_per_modality_item_schema: bool = False,
    inject_self_justification: bool = False,
) -> Type[BaseModel]:
    """
    Dynamically creates a Pydantic model from a JSON schema dictionary.
    Handles nested objects and arrays of objects.

    Justification placement is shape-driven:
      * scalar / object / array<primitive>: sibling field at parent level
        (``{field}_justification``) — preserves the historical contract.
      * array<object>: ``justification`` field injected INSIDE each item
        submodel (via ``inject_self_justification`` on the recursive call).
        One justification per item — matches how evidence actually attaches
        when items emerge across multiple turns or describe distinct facts
        within one document.

    Per-field opt-in lives inline on each property as ``include_justification:
    bool`` (set by the schema author or via the migration that lifted the
    legacy ``field_specific_justification_configs`` block). The run-level
    ``justifications_enabled`` master switch defaults to True; passing False
    suppresses all justification fields regardless of the per-field flag.
    """
    if processed_models is None:
        processed_models = {}

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

        needs_justification = bool(
            justifications_enabled and prop_schema.get("include_justification")
        )
        is_array_of_object = (
            prop_type_json == "array"
            and "items" in prop_schema
            and isinstance(prop_schema["items"], dict)
            and prop_schema["items"].get("type") == "object"
            and "properties" in prop_schema["items"]
        )
        # Per-item placement for array<object>; sibling-at-parent for everything else.
        inject_into_item = needs_justification and is_array_of_object

        if prop_type_json == "object" and "properties" in prop_schema:
            nested_model_name = f"{safe_model_name}_{field_name}"
            field_type = create_pydantic_model_from_json_schema(
                nested_model_name, prop_schema, processed_models,
                justifications_enabled=justifications_enabled,
                is_per_modality_item_schema=False,
            )
        elif prop_type_json == "array" and "items" in prop_schema:
            items_schema = prop_schema["items"]
            items_type_json = items_schema.get("type")
            if items_type_json == "object" and "properties" in items_schema:
                array_item_model_name = f"{safe_model_name}_{field_name}_Item"
                current_prop_is_per_modality_array = prop_name.startswith("per_")
                list_item_type = create_pydantic_model_from_json_schema(
                    array_item_model_name, items_schema, processed_models,
                    justifications_enabled=justifications_enabled,
                    is_per_modality_item_schema=current_prop_is_per_modality_array,
                    inject_self_justification=inject_into_item,
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

        # Sibling justification at parent level — skipped when array<object>
        # already had it injected into each item.
        if needs_justification and not inject_into_item:
            justification_field_name = f"{field_name}_justification"
            fields[justification_field_name] = (
                Optional[JustificationSubModel],
                Field(default=None, description=f"Automated justification for the field '{field_name}'.")
            )

    if inject_self_justification:
        # Reserved name. Schema authors using a literal field named
        # ``justification`` on a list-of-object item will collide with this;
        # a future enhancement can detect and rename.
        fields["justification"] = (
            Optional[JustificationSubModel],
            Field(default=None, description="Automated justification for this item.")
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
