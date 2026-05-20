"""Routes for annotation schemas."""
import copy
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    AnnotationSchema,
    Annotation,
)
from app.schemas import (
    AnnotationSchemaRead,
    AnnotationSchemaCreate,
    AnnotationSchemaUpdate,
    AnnotationSchemasOut,
    FieldJustificationConfig,
)
from app.api.dependency_injection import SessionDep, get_annotation_service
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from sqlmodel import select, func
from app.api.modules.annotation.services import AnnotationService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/annotation_schemas",
    tags=["AnnotationSchemas"]
)


# ── Justification config bidirectional translator (FE compat shim) ─────────
#
# Storage is canonical inline on each output_contract property:
#   {"include_justification": bool, "justification_prompt": str?, "justification_rigor_level": str?}
#
# The legacy API request/response shape carried a separate
# ``field_specific_justification_configs: {field: {enabled, custom_prompt, rigor_level}}``
# block. Until the FE schema editor is updated to write inline directly, the
# route translates between the two shapes — write lifts into inline, read
# derives back into the legacy block. Reading is a pure projection of the
# inline keys; nothing is double-stored.

def _find_property_anywhere(contract: Dict[str, Any], field_name: str) -> Optional[Dict[str, Any]]:
    """Find a property by name, recursing into nested ``properties`` blocks.

    HQ schemas use a hierarchical layout: output_contract.properties.document.
    properties.<field> for document-level fields, plus per-modality wrappers
    and array<object> items. Configs key by leaf name only — this walker
    drills through wrappers to find the leaf.
    """
    if not isinstance(contract, dict):
        return None
    stack: list = [contract]
    while stack:
        node = stack.pop()
        props = node.get("properties") if isinstance(node, dict) else None
        if not isinstance(props, dict):
            continue
        if field_name in props and isinstance(props[field_name], dict):
            return props[field_name]
        for child in props.values():
            if not isinstance(child, dict):
                continue
            if isinstance(child.get("properties"), dict):
                stack.append(child)
            items = child.get("items")
            if isinstance(items, dict) and isinstance(items.get("properties"), dict):
                stack.append(items)
    return None


def _lift_configs_into_contract(
    output_contract: Optional[Dict[str, Any]],
    configs: Optional[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    """Lift each config entry into inline keys on the matching field anywhere
    in the contract (top-level, inside ``document``, inside per-modality
    wrappers, or inside array<object> items). Returns the deep-copied contract.
    """
    if not configs:
        return output_contract
    if not isinstance(output_contract, dict):
        return output_contract
    contract = copy.deepcopy(output_contract)
    if not isinstance(contract.get("properties"), dict):
        return contract
    for field_name, cfg in configs.items():
        if not isinstance(cfg, dict):
            continue
        prop = _find_property_anywhere(contract, field_name)
        if prop is None:
            continue
        enabled = bool(cfg.get("enabled"))
        if enabled:
            prop["include_justification"] = True
            custom = cfg.get("custom_prompt")
            if custom:
                prop["justification_prompt"] = custom
            rigor = cfg.get("rigor_level")
            if rigor is not None:
                prop["justification_rigor_level"] = rigor
        else:
            # Explicit disable removes any inline flag.
            prop.pop("include_justification", None)
            prop.pop("justification_prompt", None)
            prop.pop("justification_rigor_level", None)
    return contract


def _derive_configs_from_contract(
    output_contract: Optional[Dict[str, Any]],
) -> Dict[str, FieldJustificationConfig]:
    """Walk the contract recursively and rebuild the legacy
    ``field_specific_justification_configs`` block from inline flags wherever
    they appear (top-level, inside document, inside list-of-object items).

    Returns FieldJustificationConfig instances (not raw dicts) so the response
    model serializes without Pydantic ``UnexpectedValue`` warnings.
    """
    out: Dict[str, FieldJustificationConfig] = {}

    def _walk(node: Any) -> None:
        if not isinstance(node, dict):
            return
        props = node.get("properties")
        if not isinstance(props, dict):
            return
        for field_name, prop in props.items():
            if not isinstance(prop, dict):
                continue
            if prop.get("include_justification"):
                entry_kwargs: Dict[str, Any] = {"enabled": True}
                if prop.get("justification_prompt"):
                    entry_kwargs["custom_prompt"] = prop["justification_prompt"]
                if prop.get("justification_rigor_level") is not None:
                    entry_kwargs["rigor_level"] = prop["justification_rigor_level"]
                # Last write wins on name collisions across nested levels —
                # acceptable since the legacy shape is a flat dict and never
                # supported nested disambiguation.
                out[field_name] = FieldJustificationConfig(**entry_kwargs)
            if isinstance(prop.get("properties"), dict):
                _walk(prop)
            items = prop.get("items")
            if isinstance(items, dict) and isinstance(items.get("properties"), dict):
                _walk(items)

    _walk(output_contract)
    return out


def _attach_legacy_configs(schema_read: AnnotationSchemaRead, schema: AnnotationSchema) -> AnnotationSchemaRead:
    """Populate the legacy configs block on a Read response from inline flags."""
    schema_read.field_specific_justification_configs = _derive_configs_from_contract(
        schema.output_contract
    )
    return schema_read

@router.post("", response_model=AnnotationSchemaRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AnnotationSchemaRead, status_code=status.HTTP_201_CREATED)
def create_annotation_schema(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    schema_in: AnnotationSchemaCreate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> AnnotationSchemaRead:
    """
    Create a new Annotation Schema.
    """
    logger.info(f"Route: Creating annotation schema in infospace {access.infospace_id}")
    try:
        # Lift legacy justification configs (if the FE still sends them) into
        # inline keys on the output_contract. Storage is inline-only.
        legacy_configs = schema_in.field_specific_justification_configs
        legacy_configs_as_dict: Dict[str, Any] = {}
        if legacy_configs:
            legacy_configs_as_dict = {
                k: v.model_dump(exclude_unset=True) for k, v in legacy_configs.items()
            }
        output_contract = _lift_configs_into_contract(
            schema_in.output_contract, legacy_configs_as_dict
        )

        schema = annotation_service.create_annotation_schema(
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            name=schema_in.name,
            description=schema_in.description,
            output_contract=output_contract,
            instructions=schema_in.instructions,
            version=schema_in.version,
        )
        return _attach_legacy_configs(AnnotationSchemaRead.model_validate(schema), schema)
        
    except ValueError as e:
        logger.error(f"Route: Validation error creating schema: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating schema: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("", response_model=AnnotationSchemasOut)
@router.get("/", response_model=AnnotationSchemasOut)
def list_annotation_schemas(
    *,
    access: Access = Requires(scope=None),
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of annotations using this schema"),
    include_archived: bool = Query(False, description="Include archived (inactive) schemas"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Annotation Schemas for the infospace.
    """
    try:
        infospace_id = access.infospace_id
        # Build query for schemas
        query = select(AnnotationSchema).where(AnnotationSchema.infospace_id == infospace_id)
        query = access.scope_filter(query, AnnotationSchema.id, "schema_ids")

        if not include_archived:
            query = query.where(AnnotationSchema.is_active == True)
        
        query = query.offset(skip).limit(limit)
        
        # Execute query
        schemas = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(AnnotationSchema.id)).where(
            AnnotationSchema.infospace_id == infospace_id
        )
        count_query = access.scope_filter(count_query, AnnotationSchema.id, "schema_ids")
        if not include_archived:
            count_query = count_query.where(AnnotationSchema.is_active == True)

        total_count = session.exec(count_query).one()
        
        # Convert to read models and add counts if requested
        result_schemas = []
        for schema in schemas:
            schema_read = _attach_legacy_configs(
                AnnotationSchemaRead.model_validate(schema), schema
            )

            if include_counts:
                annotations_count_query = select(func.count(Annotation.id)).where(
                    Annotation.schema_id == schema.id
                )
                schema_read.annotation_count = session.exec(annotations_count_query).one() or 0

            result_schemas.append(schema_read)
            
        return AnnotationSchemasOut(data=result_schemas, count=total_count)
    
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing schemas: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{schema_id}", response_model=AnnotationSchemaRead)
def get_annotation_schema(
    *,
    access: Access = Requires(scope=None),
    schema_id: int,
    include_counts: bool = Query(True, description="Include counts of annotations using this schema"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Annotation Schema by its ID.
    """
    try:
        infospace_id = access.infospace_id
        # Get the schema
        schema = session.get(AnnotationSchema, schema_id)
        if not schema:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation Schema not found"
            )
        
        # Verify schema belongs to infospace
        if schema.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation Schema not found in this infospace"
            )
        access.require_in_scope("schema_ids", schema_id)

        # Convert to read model + reconstruct legacy configs from inline flags
        schema_read = _attach_legacy_configs(
            AnnotationSchemaRead.model_validate(schema), schema
        )

        # Add counts if requested
        if include_counts:
            annotations_count_query = select(func.count(Annotation.id)).where(
                Annotation.schema_id == schema.id
            )
            schema_read.annotation_count = session.exec(annotations_count_query).one() or 0

        return schema_read

    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting schema {schema_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{schema_id}", response_model=AnnotationSchemaRead)
def update_annotation_schema(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    schema_id: int,
    schema_in: AnnotationSchemaUpdate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> Any:
    """
    Update an Annotation Schema.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("schema_ids", schema_id)
    logger.info(f"Route: Updating AnnotationSchema {schema_id} in infospace {infospace_id}")
    try:
        # Get the schema
        schema = session.get(AnnotationSchema, schema_id)
        if not schema:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation Schema not found"
            )
        
        # Verify schema belongs to infospace
        if schema.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation Schema not found in this infospace"
            )
        
        update_data = schema_in.model_dump(exclude_unset=True)

        # Translate legacy justification configs (if present) into inline keys
        # on the output_contract. The configs key itself never lands on the row.
        legacy_configs = update_data.pop("field_specific_justification_configs", None)
        if legacy_configs is not None or "output_contract" in update_data:
            base_contract = update_data.get("output_contract", schema.output_contract)
            if legacy_configs is not None:
                update_data["output_contract"] = _lift_configs_into_contract(
                    base_contract, legacy_configs
                )

        for field, value in update_data.items():
            setattr(schema, field, value)

        schema.updated_at = datetime.now(timezone.utc)

        session.add(schema)
        session.commit()
        session.refresh(schema)

        return _attach_legacy_configs(AnnotationSchemaRead.model_validate(schema), schema)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating schema {schema_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{schema_id}", response_model=AnnotationSchemaRead, status_code=status.HTTP_200_OK)
def delete_annotation_schema(
    *,
    access: Access = Requires(Capability.DELETE, scope=None),
    schema_id: int,
    session: SessionDep,
) -> AnnotationSchemaRead:
    """
    Archive an annotation schema by setting it to inactive (soft delete).
    This is a non-destructive operation.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("schema_ids", schema_id)

    # Get schema
    db_schema = session.get(AnnotationSchema, schema_id)
    if not db_schema:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation schema {schema_id} not found"
        )
    
    # Verify schema belongs to infospace
    if db_schema.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation schema {schema_id} not found in infospace {infospace_id}"
        )
    
    # Instead of deleting, we set the schema to inactive (soft delete)
    # This prevents the foreign key violation and is a non-destructive action.
    db_schema.is_active = False
    db_schema.updated_at = datetime.now(timezone.utc)
    session.add(db_schema)
    session.commit()
    session.refresh(db_schema)

    return db_schema
    
    # The previous checks for annotations and run links are no longer necessary for a soft delete,
    # as we want to preserve the history for completed runs.

@router.post("/{schema_id}/restore", response_model=AnnotationSchemaRead)
def restore_annotation_schema(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    schema_id: int,
    session: SessionDep,
) -> AnnotationSchemaRead:
    """
    Restores an archived (soft-deleted) annotation schema.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("schema_ids", schema_id)

    schema = session.get(AnnotationSchema, schema_id)
    if not schema or schema.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Annotation schema {schema_id} not found"
        )

    if schema.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Schema {schema_id} is already active."
        )

    schema.is_active = True
    schema.updated_at = datetime.now(timezone.utc)
    session.add(schema)
    session.commit()
    session.refresh(schema)

    return schema 