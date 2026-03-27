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
from app.api.dependency_injection import (
    SessionDep,
    AnnotationServiceDep,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from app.api.modules.graph.resolution import resolve_entity
from app.api.modules.graph.models import GraphEdge
from app.api.modules.graph.schemas import CurateFragmentsRequest
from app.api.modules.embedding.services import EmbeddingService
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
    access: Access = Requires(Capability.ORGANIZE),
    annotation_in: AnnotationCreate,
    session: SessionDep,
    annotation_service: AnnotationServiceDep
) -> AnnotationRead:
    """
    Create a new annotation.
    """
    logger.info(f"Route: Creating annotation in infospace {access.infospace_id}")
    try:
        # Create annotation using service
        annotation = annotation_service.create_annotation(
            user_id=access.user_id,
            infospace_id=access.infospace_id,
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
    access: Access = Requires(),
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
        infospace_id = access.infospace_id
        # Cap limit to prevent unbounded responses
        limit = min(limit, 500)
        # Build base query
        query = select(Annotation).where(Annotation.infospace_id == infospace_id)
        query = access.scope_filter(query, Annotation.run_id, "run_ids")
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
        count_query = access.scope_filter(count_query, Annotation.run_id, "run_ids")
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
    access: Access = Requires(),
    annotation_id: int,
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Annotation by its ID.
    """
    try:
        infospace_id = access.infospace_id
        annotation = session.get(Annotation, annotation_id)
        if not annotation or annotation.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        access.require_in_scope("run_ids", annotation.run_id)
        
        return AnnotationRead.model_validate(annotation)
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting annotation {annotation_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{annotation_id}", response_model=AnnotationRead)
def update_annotation(
    *,
    access: Access = Requires(Capability.ORGANIZE),
    annotation_id: int,
    annotation_in: AnnotationUpdate,
    session: SessionDep,
    annotation_service: AnnotationServiceDep
) -> Any:
    """
    Update an Annotation.
    """
    infospace_id = access.infospace_id
    logger.info(f"Route: Updating Annotation {annotation_id} in infospace {infospace_id}")
    try:
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
        access.require_in_scope("run_ids", annotation.run_id)

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
    access: Access = Requires(Capability.DELETE),
    annotation_id: int,
    session: SessionDep,
) -> None:
    """
    Delete an Annotation.
    """
    infospace_id = access.infospace_id
    logger.info(f"Route: Attempting to delete Annotation {annotation_id} from infospace {infospace_id}")
    try:
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
        access.require_in_scope("run_ids", annotation.run_id)

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
    access: Access = Requires(Capability.ORGANIZE),
    annotations: List[AnnotationCreate],
    annotation_service: AnnotationServiceDep
) -> Message:
    """
    Create multiple annotations in a batch.
    """
    logger.info(f"Route: Creating batch of {len(annotations)} annotations in infospace {access.infospace_id}")
    try:
        # Service method handles validation and creation
        success = annotation_service.create_batch_annotations(
            annotations=annotations,
            user_id=access.user_id,
            infospace_id=access.infospace_id
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
    access: Access = Requires(),
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
    access.require_in_scope("run_ids", run_id)
    try:
        results = annotation_service.get_annotations_for_run(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=access.infospace_id,
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
    access: Access = Requires(Capability.COMPUTE),
    annotation_id: int,
    annotation_retry_request: AnnotationRetryRequest,
    session: SessionDep,
    annotation_service: AnnotationServiceDep,
) -> AnnotationRead:
    """
    Retries a single failed annotation synchronously.
    """
    logger.info(f"Route: Received request to retry single annotation {annotation_id}")
    # Defense-in-depth: check the annotation's run is in scope
    annotation = session.get(Annotation, annotation_id)
    if annotation:
        access.require_in_scope("run_ids", annotation.run_id)
    try:
        updated_annotation = annotation_service.retry_single_annotation(
            annotation_id=annotation_id,
            user_id=access.user_id,
            infospace_id=access.infospace_id,
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
    """Extract a fragment from annotation value by path (e.g., 'triplets[0]').

    Handles the common `{document: {triplets: [...]}}` nesting — looks in the
    top-level dict first, then falls back to `value["document"]`.
    """
    parts = path.split('[')
    if len(parts) != 2:
        raise ValueError(f"Invalid fragment path: {path}")

    field_name = parts[0]
    index_str = parts[1].rstrip(']')

    try:
        index = int(index_str)
    except ValueError:
        raise ValueError(f"Invalid index in fragment path: {path}")

    # Try top-level first, then nested under "document"
    container = value
    if field_name not in container:
        doc = value.get("document")
        if isinstance(doc, dict) and field_name in doc:
            container = doc
        else:
            raise ValueError(f"Field '{field_name}' not found in annotation value")

    field_value = container[field_name]
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
    access: Access = Requires(Capability.ORGANIZE),
    annotation_id: int,
    curation_request: CurateFragmentsRequest,
    session: SessionDep,
) -> Any:
    """
    Curate selected annotation fragments into the knowledge graph.

    Resolves entities, creates FragmentCuration records and materialized GraphEdge rows.
    Nothing enters the persistent graph without this explicit action (or a flow step).
    """
    try:
        infospace_id = access.infospace_id
        annotation = session.get(Annotation, annotation_id)
        if not annotation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        if annotation.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found in this infospace")
        access.require_in_scope("run_ids", annotation.run_id)

        # Derive graph_id: explicit request param > run's graph_config > None (infospace default)
        graph_id = curation_request.graph_id
        run = None
        if annotation.run_id:
            from app.api.modules.annotation.models import AnnotationRun
            run = session.get(AnnotationRun, annotation.run_id)
            if graph_id is None and run and run.graph_config and isinstance(run.graph_config, dict):
                graph_id = run.graph_config.get("graph_id") or run.graph_config.get("target_graph_id")

        # Build merge normalization: request-level merges override graph_config merges.
        # This carries the user's manual merge decisions from the run-scoped graph panel.
        merge_normalize: dict[str, str] = {}
        merge_type_override: dict[str, str] = {}
        # Base: graph_config merges (if any)
        if run and run.graph_config and isinstance(run.graph_config, dict):
            for group in run.graph_config.get("entity_merges", []):
                keep = group.get("keep", "")
                forced_type = group.get("type")
                for name in group.get("names", []):
                    if name.strip().lower() != keep.strip().lower():
                        merge_normalize[name.strip().lower()] = keep
                if forced_type:
                    merge_type_override[keep.strip().lower()] = forced_type
        # Override: request-level merges (user's ad-hoc decisions from the UI)
        if curation_request.entity_merges:
            for hint in curation_request.entity_merges:
                for name in hint.names:
                    if name.strip().lower() != hint.keep.strip().lower():
                        merge_normalize[name.strip().lower()] = hint.keep
                if hint.type:
                    merge_type_override[hint.keep.strip().lower()] = hint.type

        embedding_service = EmbeddingService(session=session, user_id=access.user_id)
        created_curations = []
        created_edges = []

        for path in curation_request.fragment_paths:
            try:
                fragment = get_fragment_by_path(annotation.value, path)

                subject_entity_id = None
                object_entity_id = None

                if is_triplet(fragment):
                    # Apply merge normalization before resolution
                    sub_name = fragment["subject_name"]
                    sub_type = fragment.get("subject_type", "UNKNOWN")
                    obj_name = fragment["object_name"]
                    obj_type = fragment.get("object_type", "UNKNOWN")
                    sub_name = merge_normalize.get(sub_name.strip().lower(), sub_name)
                    obj_name = merge_normalize.get(obj_name.strip().lower(), obj_name)
                    sub_type = merge_type_override.get(sub_name.strip().lower(), sub_type)
                    obj_type = merge_type_override.get(obj_name.strip().lower(), obj_type)

                    subject = await resolve_entity(
                        session, infospace_id,
                        sub_name, sub_type,
                        embedding_service=embedding_service,
                    )
                    object_entity = await resolve_entity(
                        session, infospace_id,
                        obj_name, obj_type,
                        embedding_service=embedding_service,
                    )
                    subject_entity_id = subject.id
                    object_entity_id = object_entity.id

                # Upsert FragmentCuration
                existing = session.exec(
                    select(FragmentCuration).where(
                        FragmentCuration.annotation_id == annotation_id,
                        FragmentCuration.fragment_path == path,
                    )
                ).first()

                if existing:
                    existing.status = curation_request.status
                    existing.subject_entity_id = subject_entity_id
                    existing.object_entity_id = object_entity_id
                    existing.curated_by = access.user_id
                    session.add(existing)
                    session.flush()
                    created_curations.append(existing.id)
                else:
                    fc = FragmentCuration(
                        annotation_id=annotation_id,
                        fragment_path=path,
                        status=curation_request.status,
                        subject_entity_id=subject_entity_id,
                        object_entity_id=object_entity_id,
                        curated_by=access.user_id,
                    )
                    session.add(fc)
                    session.flush()
                    created_curations.append(fc.id)

                # Create materialized GraphEdge for triplets
                if subject_entity_id and object_entity_id and is_triplet(fragment):
                    edge = GraphEdge(
                        subject_entity_id=subject_entity_id,
                        object_entity_id=object_entity_id,
                        predicate=fragment.get("predicate"),
                        annotation_id=annotation_id,
                        infospace_id=infospace_id,
                        graph_id=graph_id,
                    )
                    session.add(edge)
                    session.flush()
                    created_edges.append(edge.id)

            except ValueError as ve:
                logger.warning(f"Skipping fragment {path}: {ve}")
                continue

        session.commit()

        return {
            "curated": len(created_curations),
            "edges_created": len(created_edges),
            "curation_ids": created_curations,
            "edge_ids": created_edges,
        }

    except HTTPException:
        session.rollback()
        raise
    except Exception as e:
        session.rollback()
        logger.exception(f"Error curating fragments: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error curating fragments: {str(e)}",
        )


@router.delete("/{annotation_id}/curate/{fragment_path:path}", status_code=status.HTTP_204_NO_CONTENT)
def remove_curation(
    *,
    access: Access = Requires(Capability.DELETE),
    annotation_id: int,
    fragment_path: str,
    session: SessionDep,
) -> None:
    """Remove curation from an annotation fragment."""
    try:
        infospace_id = access.infospace_id
        # Verify annotation belongs to infospace
        annotation = session.get(Annotation, annotation_id)
        if not annotation or annotation.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Annotation not found")
        access.require_in_scope("run_ids", annotation.run_id)

        # Find and delete curation + associated GraphEdge
        curation = session.exec(
            select(FragmentCuration).where(
                FragmentCuration.annotation_id == annotation_id,
                FragmentCuration.fragment_path == fragment_path,
            )
        ).first()

        if not curation:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Curation not found")

        # Remove the materialized edge for this curation
        if curation.subject_entity_id and curation.object_entity_id:
            edge = session.exec(
                select(GraphEdge).where(
                    GraphEdge.annotation_id == annotation_id,
                    GraphEdge.subject_entity_id == curation.subject_entity_id,
                    GraphEdge.object_entity_id == curation.object_entity_id,
                )
            ).first()
            if edge:
                session.delete(edge)

        session.delete(curation)
        session.commit()
            
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
    access: Access = Requires(),
    graph_id: Optional[int] = Query(default=None, description="Filter to a specific knowledge graph"),
    limit: int = Query(default=500, le=2000),
    offset: int = Query(default=0, ge=0),
    session: SessionDep,
) -> Any:
    """
    Get curated triplets for an infospace, optionally filtered to a specific knowledge graph.
    Returns triplets with resolved entity information.
    """
    try:
        infospace_id = access.infospace_id
        from sqlalchemy import or_

        stmt = (
            select(FragmentCuration, Annotation)
            .join(Annotation, FragmentCuration.annotation_id == Annotation.id)
            .where(
                Annotation.infospace_id == infospace_id,
                FragmentCuration.status == "curated",
                or_(
                    FragmentCuration.subject_entity_id.isnot(None),
                    FragmentCuration.object_entity_id.isnot(None),
                ),
            )
        )

        # Filter by graph: join through GraphEdge which carries graph_id
        if graph_id is not None:
            stmt = stmt.join(
                GraphEdge,
                (GraphEdge.annotation_id == FragmentCuration.annotation_id)
                & (GraphEdge.subject_entity_id == FragmentCuration.subject_entity_id)
                & (GraphEdge.object_entity_id == FragmentCuration.object_entity_id),
            ).where(GraphEdge.graph_id == graph_id)

        stmt = access.scope_filter(stmt, Annotation.run_id, "run_ids")
        stmt = stmt.offset(offset).limit(limit)
        curations = session.exec(stmt).all()

        # Build entity map — scoped to graph if filtering
        entity_stmt = select(EntityCanonical).where(EntityCanonical.infospace_id == infospace_id)
        if graph_id is not None:
            entity_stmt = entity_stmt.where(EntityCanonical.graph_id == graph_id)
        entities = session.exec(entity_stmt).all()
        entity_map = {e.id: e for e in entities}

        # Also load infospace-level entities (graph_id IS NULL) as fallback
        if graph_id is not None:
            fallback = session.exec(
                select(EntityCanonical).where(
                    EntityCanonical.infospace_id == infospace_id,
                    EntityCanonical.graph_id.is_(None),
                )
            ).all()
            for e in fallback:
                entity_map.setdefault(e.id, e)

        curated_triplets = []

        for curation, annotation in curations:
            try:
                fragment = get_fragment_by_path(annotation.value, curation.fragment_path)

                if not is_triplet(fragment):
                    continue

                subject_id = curation.subject_entity_id
                object_id = curation.object_entity_id

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
                        "canonical_name": entity_map[subject_id].canonical_name if subject_id and subject_id in entity_map else fragment["subject_name"],
                    },
                    "object": {
                        "raw_name": fragment["object_name"],
                        "raw_type": fragment.get("object_type"),
                        "canonical_id": object_id,
                        "canonical_name": entity_map[object_id].canonical_name if object_id and object_id in entity_map else fragment["object_name"],
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
            detail="Error fetching curated triplets",
        )