"""Routes for annotation schemas."""
import logging
from typing import Any
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status, Path

from app.models import (
    AnnotationSchema,
    Annotation,
    RunSchemaLink,
)
from app.schemas import (
    AnnotationSchemaRead,
    AnnotationSchemaCreate,
    AnnotationSchemaUpdate,
    AnnotationSchemasOut,
)
from app.api.deps import SessionDep, CurrentUser, get_annotation_service
from app.api.services.service_utils import validate_infospace_access
from sqlmodel import select, func
from app.api.services.annotation_service import AnnotationService

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/annotation_schemas",
    tags=["AnnotationSchemas"]
)

@router.post("", response_model=AnnotationSchemaRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AnnotationSchemaRead, status_code=status.HTTP_201_CREATED)
def create_annotation_schema(
    *,
    current_user: CurrentUser,
    infospace_id: int = Path(..., description="The ID of the infospace"),
    schema_in: AnnotationSchemaCreate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> AnnotationSchemaRead:
    """
    Create a new Annotation Schema.
    """
    logger.info(f"Route: Creating annotation schema in infospace {infospace_id}")
    try:
        # Manually convert justification configs to dicts before passing to service
        just_configs = schema_in.field_specific_justification_configs
        just_configs_as_dict = {}
        if just_configs:
            just_configs_as_dict = {
                k: v.model_dump(exclude_unset=True) for k, v in just_configs.items()
            }

        # Create schema using service
        schema = annotation_service.create_annotation_schema(
            user_id=current_user.id,
            infospace_id=infospace_id,
            name=schema_in.name,
            description=schema_in.description,
            output_contract=schema_in.output_contract,
            instructions=schema_in.instructions,
            version=schema_in.version,
            field_specific_justification_configs=just_configs_as_dict
        )
        return schema
        
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
    current_user: CurrentUser,
    infospace_id: int = Path(..., description="The ID of the infospace"),
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
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Build query for schemas
        query = select(AnnotationSchema).where(AnnotationSchema.infospace_id == infospace_id)

        if not include_archived:
            query = query.where(AnnotationSchema.is_active == True)
        
        query = query.offset(skip).limit(limit)
        
        # Execute query
        schemas = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(AnnotationSchema.id)).where(
            AnnotationSchema.infospace_id == infospace_id
        )
        if not include_archived:
            count_query = count_query.where(AnnotationSchema.is_active == True)

        total_count = session.exec(count_query).one()
        
        # Convert to read models and add counts if requested
        result_schemas = []
        for schema in schemas:
            schema_read = AnnotationSchemaRead.model_validate(schema)
            
            # Add counts if requested
            if include_counts:
                # Count annotations using this schema
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
    current_user: CurrentUser,
    infospace_id: int = Path(..., description="The ID of the infospace"),
    schema_id: int,
    include_counts: bool = Query(True, description="Include counts of annotations using this schema"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Annotation Schema by its ID.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
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
        
        # Convert to read model
        schema_read = AnnotationSchemaRead.model_validate(schema)
        
        # Add counts if requested
        if include_counts:
            # Count annotations using this schema
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
    current_user: CurrentUser,
    infospace_id: int = Path(..., description="The ID of the infospace"),
    schema_id: int,
    schema_in: AnnotationSchemaUpdate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> Any:
    """
    Update an Annotation Schema.
    """
    logger.info(f"Route: Updating AnnotationSchema {schema_id} in infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
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
        
        # Validate schema if it's being updated
        update_data = schema_in.model_dump(exclude_unset=True)
        
        if "schema" in update_data: # This should be output_contract
            # The validation logic will be handled by the new hierarchical schema validation
            pass
        
        # Update fields
        for field, value in update_data.items():
            setattr(schema, field, value)
        
        schema.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(schema)
        session.commit()
        session.refresh(schema)
        
        return AnnotationSchemaRead.model_validate(schema)
    
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
    current_user: CurrentUser,
    infospace_id: int = Path(..., description="The ID of the infospace"),
    schema_id: int,
    session: SessionDep,
) -> AnnotationSchemaRead:
    """
    Archive an annotation schema by setting it to inactive (soft delete).
    This is a non-destructive operation.
    """
    # Validate infospace access
    validate_infospace_access(session, infospace_id, current_user.id)
    
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
    current_user: CurrentUser,
    infospace_id: int,
    schema_id: int,
    session: SessionDep,
) -> AnnotationSchemaRead:
    """
    Restores an archived (soft-deleted) annotation schema.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
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