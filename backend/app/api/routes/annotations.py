"""Routes for annotations."""
import logging
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    Annotation,
    AnnotationSchema,
)
from app.schemas import (
    AnnotationRead,
    AnnotationCreate,
    AnnotationUpdate,
    AnnotationsOut,
    Message,
)
from app.api.deps import (
    SessionDep,
    CurrentUser,
    AnnotationServiceDep,
)
from app.api.services.service_utils import validate_infospace_access
from sqlmodel import select, func

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/annotations",
    tags=["Annotations"]
)

@router.post("", response_model=AnnotationRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AnnotationRead, status_code=status.HTTP_201_CREATED)
def create_annotation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_in: AnnotationCreate,
    session: SessionDep,
    annotation_service: AnnotationServiceDep
) -> AnnotationRead:
    """
    Create a new annotation.
    """
    logger.info(f"Route: Creating annotation in infospace {infospace_id}")
    try:
        # Create annotation using service
        annotation = annotation_service.create_annotation(
            user_id=current_user.id,
            infospace_id=infospace_id,
            annotation_in=annotation_in
        )
        return annotation
        
    except ValueError as e:
        logger.error(f"Route: Validation error creating annotation: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating annotation: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("", response_model=AnnotationsOut)
@router.get("/", response_model=AnnotationsOut)
def list_annotations(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    skip: int = 0,
    limit: int = 100,
    source_id: Optional[int] = None,
    schema_id: Optional[int] = None,
    session: SessionDep,
) -> Any:
    """
    Retrieve Annotations for the infospace.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Build base query
        query = select(Annotation).where(Annotation.infospace_id == infospace_id)
        
        # Add filters if provided
        if source_id is not None:
            query = query.where(Annotation.source_id == source_id)
        if schema_id is not None:
            query = query.where(Annotation.schema_id == schema_id)
        
        # Add pagination
        query = query.offset(skip).limit(limit)
        
        # Execute query
        annotations = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(Annotation.id)).where(Annotation.infospace_id == infospace_id)
        if source_id is not None:
            count_query = count_query.where(Annotation.source_id == source_id)
        if schema_id is not None:
            count_query = count_query.where(Annotation.schema_id == schema_id)
        total_count = session.exec(count_query).one()
        
        # Convert to read models
        result_annotations = [AnnotationRead.model_validate(a) for a in annotations]
        
        return AnnotationsOut(data=result_annotations, count=total_count)
    
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing annotations: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{annotation_id}", response_model=AnnotationRead)
def get_annotation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Annotation by its ID.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the annotation
        annotation = session.get(Annotation, annotation_id)
        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found"
            )
        
        # Verify annotation belongs to infospace
        if annotation.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found in this infospace"
            )
        
        return AnnotationRead.model_validate(annotation)
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting annotation {annotation_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{annotation_id}", response_model=AnnotationRead)
def update_annotation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    annotation_in: AnnotationUpdate,
    session: SessionDep,
    annotation_service: AnnotationServiceDep
) -> Any:
    """
    Update an Annotation.
    """
    logger.info(f"Route: Updating Annotation {annotation_id} in infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the annotation
        annotation = session.get(Annotation, annotation_id)
        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found"
            )
        
        # Verify annotation belongs to infospace
        if annotation.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found in this infospace"
            )
        
        # Get schema for validation if data is being updated
        update_data = annotation_in.model_dump(exclude_unset=True)
        if "data" in update_data:
            schema = session.get(AnnotationSchema, annotation.schema_id)
            if not schema:
                raise ValueError(f"AnnotationSchema with ID {annotation.schema_id} not found")
            if not annotation_service.validate_annotation(update_data["data"], schema.schema):
                raise ValueError("Invalid annotation data format")
        
        # Update fields
        for field, value in update_data.items():
            setattr(annotation, field, value)
        
        annotation.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(annotation)
        session.commit()
        session.refresh(annotation)
        
        return AnnotationRead.model_validate(annotation)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating annotation {annotation_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{annotation_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_annotation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    session: SessionDep,
) -> None:
    """
    Delete an Annotation.
    """
    logger.info(f"Route: Attempting to delete Annotation {annotation_id} from infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the annotation
        annotation = session.get(Annotation, annotation_id)
        if not annotation:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found"
            )
        
        # Verify annotation belongs to infospace
        if annotation.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found in this infospace"
            )
        
        # Delete the annotation
        session.delete(annotation)
        session.commit()
        logger.info(f"Route: Annotation {annotation_id} successfully deleted")
        
    except ValueError as ve:
        session.rollback()
        logger.error(f"Route: Validation error deleting annotation {annotation_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting annotation {annotation_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.post("/batch", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
def create_batch_annotations(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotations: List[AnnotationCreate],
    annotation_service: AnnotationServiceDep
) -> Message:
    """
    Create multiple annotations in a batch.
    """
    logger.info(f"Route: Creating batch of {len(annotations)} annotations in infospace {infospace_id}")
    try:
        # Service method handles validation and creation
        success = annotation_service.create_batch_annotations(
            annotations=annotations,
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        
        if success:
            return Message(message=f"Successfully queued {len(annotations)} annotations for processing")
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to queue batch annotations"
            )
            
    except ValueError as ve:
        logger.warning(f"Route: Validation error in batch annotation creation: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error in batch annotation creation: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/run/{run_id}/results", response_model=List[AnnotationRead])
def get_run_results(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    run_id: int,
    skip: int = 0,
    limit: int = 100,
    session: SessionDep,
    annotation_service: AnnotationServiceDep,
) -> List[AnnotationRead]:
    """
    Retrieve all annotations for a specific AnnotationRun.
    The service handles run ownership and infospace context verification.
    """
    try:
        results = annotation_service.get_annotations_for_run(
            run_id=run_id,
            user_id=current_user.id,
            infospace_id=infospace_id,
            skip=skip,
            limit=limit
        )
        return results
    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing results for run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.post("/{annotation_id}/retry", response_model=AnnotationRead)
def retry_single_annotation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    session: SessionDep,
    annotation_service: AnnotationServiceDep,
) -> AnnotationRead:
    """
    Retries a single failed annotation synchronously.
    """
    logger.info(f"Route: Received request to retry single annotation {annotation_id}")
    try:
        updated_annotation = annotation_service.retry_single_annotation(
            annotation_id=annotation_id,
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        return AnnotationRead.model_validate(updated_annotation)

    except ValueError as ve:
        logger.warning(f"Route: Validation or retry error for annotation {annotation_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error retrying annotation {annotation_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during annotation retry")