"""Routes for annotations."""
import logging
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    Annotation,
    AnnotationSchema,
    FragmentCuration,
    EntityCanonical,
    Asset,
)
from app.schemas import (
    AnnotationRead,
    AnnotationCreate,
    AnnotationUpdate,
    AnnotationsOut,
    Message,
    AnnotationRetryRequest,
)
from app.api.deps import (
    SessionDep,
    CurrentUser,
    AnnotationServiceDep,
)
from app.api.services.service_utils import validate_infospace_access
from app.api.utils.entity_resolution import resolve_entity
from app.api.services.embedding_service import EmbeddingService
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
        # Cap limit to prevent unbounded responses
        limit = min(limit, 500)
        # Build base query
        query = select(Annotation).where(Annotation.infospace_id == infospace_id)
        # Add filters if provided
        if source_id is not None:
            # source_id parameter is actually asset_id (legacy naming)
            query = query.where(Annotation.asset_id == source_id)
        if schema_id is not None:
            query = query.where(Annotation.schema_id == schema_id)
        
        # Add pagination
        query = query.offset(skip).limit(limit)
        
        # Execute query
        annotations = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(Annotation.id)).where(Annotation.infospace_id == infospace_id)
        if source_id is not None:
            # source_id parameter is actually asset_id (legacy naming)
            count_query = count_query.where(Annotation.asset_id == source_id)
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
    annotation_retry_request: AnnotationRetryRequest,
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
            infospace_id=infospace_id,
            custom_prompt=annotation_retry_request.custom_prompt
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


def get_fragment_by_path(value: Dict[str, Any], path: str) -> Any:
    """Extract a fragment from annotation value by path (e.g., 'triplets[0]')."""
    parts = path.split('[')
    if len(parts) != 2:
        raise ValueError(f"Invalid fragment path: {path}")
    
    field_name = parts[0]
    index_str = parts[1].rstrip(']')
    
    try:
        index = int(index_str)
    except ValueError:
        raise ValueError(f"Invalid index in fragment path: {path}")
    
    if field_name not in value:
        raise ValueError(f"Field '{field_name}' not found in annotation value")
    
    field_value = value[field_name]
    if not isinstance(field_value, list):
        raise ValueError(f"Field '{field_name}' is not an array")
    
    if index < 0 or index >= len(field_value):
        raise ValueError(f"Index {index} out of range for '{field_name}'")
    
    return field_value[index]


def is_triplet(fragment: Any) -> bool:
    """Check if a fragment is a triplet (has subject_name, predicate, object_name)."""
    if not isinstance(fragment, dict):
        return False
    return all(key in fragment for key in ['subject_name', 'predicate', 'object_name'])


@router.post("/{annotation_id}/curate", response_model=dict, status_code=status.HTTP_201_CREATED)
async def curate_fragments(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    curation_request: dict,
    session: SessionDep,
) -> Any:
    """
    Curate annotation fragments with entity resolution.
    
    Body: {
        "fragment_paths": ["triplets[0]", "triplets[3]", ...],
        "resolve": true,  # Whether to resolve entities
        "status": "curated"  # "curated" or "rejected"
    }
    """
    try:
        # Get annotation
        annotation = session.get(Annotation, annotation_id)
        if not annotation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        
        # Verify annotation belongs to infospace
        if annotation.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Annotation not found in this infospace"
            )
        
        fragment_paths = curation_request.get("fragment_paths", [])
        should_resolve = curation_request.get("resolve", True)
        curation_status = curation_request.get("status", "curated")
        
        # Get embedding service if resolution is requested
        embedding_service = None
        if should_resolve:
            embedding_service = EmbeddingService(session=session, user_id=current_user.id)
        
        created_curations = []
        
        for path in fragment_paths:
            try:
                # Extract fragment from annotation value
                fragment = get_fragment_by_path(annotation.value, path)
                
                resolved_refs = None
                if should_resolve and is_triplet(fragment):
                    # Resolve entities
                    subject = await resolve_entity(
                        session, infospace_id,
                        fragment["subject_name"], fragment.get("subject_type", "UNKNOWN"),
                        embedding_service=embedding_service
                    )
                    object_entity = await resolve_entity(
                        session, infospace_id,
                        fragment["object_name"], fragment.get("object_type", "UNKNOWN"),
                        embedding_service=embedding_service
                    )
                    resolved_refs = {"subject_id": subject.id, "object_id": object_entity.id}
                
                # Check if curation already exists
                existing = session.exec(
                    select(FragmentCuration).where(
                        FragmentCuration.annotation_id == annotation_id,
                        FragmentCuration.fragment_path == path
                    )
                ).first()
                
                if existing:
                    # Update existing curation
                    existing.status = curation_status
                    existing.resolved_refs = resolved_refs
                    existing.curated_by = current_user.id
                    session.add(existing)
                    created_curations.append(existing.id)
                else:
                    # Create new curation record
                    curation = FragmentCuration(
                        annotation_id=annotation_id,
                        fragment_path=path,
                        status=curation_status,
                        resolved_refs=resolved_refs,
                        curated_by=current_user.id
                    )
                    session.add(curation)
                    session.flush()
                    created_curations.append(curation.id)
                    
            except ValueError as ve:
                logger.warning(f"Error curating fragment {path}: {ve}")
                continue
        
        session.commit()
        
        return {
            "message": f"Curated {len(created_curations)} fragments",
            "curation_ids": created_curations
        }
        
    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        logger.exception(f"Error curating fragments: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error curating fragments: {str(e)}"
        )


@router.delete("/{annotation_id}/curate/{fragment_path:path}", status_code=status.HTTP_204_NO_CONTENT)
def remove_curation(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    annotation_id: int,
    fragment_path: str,
    session: SessionDep,
) -> None:
    """Remove curation from an annotation fragment."""
    try:
        # Verify annotation belongs to infospace
        annotation = session.get(Annotation, annotation_id)
        if not annotation or annotation.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        
        # Find and delete curation
        curation = session.exec(
            select(FragmentCuration).where(
                FragmentCuration.annotation_id == annotation_id,
                FragmentCuration.fragment_path == fragment_path
            )
        ).first()
        
        if curation:
            session.delete(curation)
            session.commit()
        else:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Curation not found")
            
    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        logger.exception(f"Error removing curation: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error removing curation"
        )


@router.get("/curated/triplets", response_model=List[dict])
def get_curated_triplets(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    session: SessionDep,
) -> Any:
    """
    Get all curated triplets for an infospace.
    Returns triplets with resolved entity information.
    """
    try:
        # Get all curated fragments that are triplets
        curations = session.exec(
            select(FragmentCuration, Annotation)
            .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
            .where(
                Annotation.infospace_id == infospace_id,
                FragmentCuration.status == "curated",
                FragmentCuration.resolved_refs.isnot(None)
            )
        ).all()
        
        # Get all canonical entities for this infospace
        entities = session.exec(
            select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
        ).all()
        entity_map = {e.id: e for e in entities}
        
        curated_triplets = []
        
        for curation, annotation in curations:
            try:
                # Extract triplet from annotation
                fragment = get_fragment_by_path(annotation.value, curation.fragment_path)
                
                if not is_triplet(fragment):
                    continue
                
                resolved_refs = curation.resolved_refs or {}
                subject_id = resolved_refs.get("subject_id")
                object_id = resolved_refs.get("object_id")
                
                # Build triplet with resolved entities
                triplet_data = {
                    "id": curation.id,
                    "annotation_id": annotation.id,
                    "asset_id": annotation.asset_id,
                    "fragment_path": curation.fragment_path,
                    "predicate": fragment["predicate"],
                    "subject": {
                        "raw_name": fragment["subject_name"],
                        "raw_type": fragment.get("subject_type"),
                        "canonical_id": subject_id,
                        "canonical_name": entity_map.get(subject_id).canonical_name if subject_id and subject_id in entity_map else fragment["subject_name"],
                    },
                    "object": {
                        "raw_name": fragment["object_name"],
                        "raw_type": fragment.get("object_type"),
                        "canonical_id": object_id,
                        "canonical_name": entity_map.get(object_id).canonical_name if object_id and object_id in entity_map else fragment["object_name"],
                    },
                    "properties": {k: v for k, v in fragment.items() if k not in ['subject_name', 'subject_type', 'predicate', 'object_name', 'object_type']},
                    "curated_at": curation.curated_at.isoformat() if curation.curated_at else None,
                }
                
                curated_triplets.append(triplet_data)
                
            except (ValueError, KeyError) as e:
                logger.warning(f"Error processing curated triplet {curation.id}: {e}")
                continue
        
        return curated_triplets
        
    except Exception as e:
        logger.exception(f"Error fetching curated triplets: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Error fetching curated triplets"
        )