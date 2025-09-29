"""Routes for source operations."""
import logging
from typing import Any, Dict, Optional
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import (
    Asset,
    Source,
    SourceStatus,
    Bundle,
)
from app.api.deps import (
    SessionDep,
    CurrentUser,
    ContentIngestionServiceDep,
    BundleServiceDep,
    TaskServiceDep,
)
from app.api.services.source_service import SourceService
from app.api.services.service_utils import validate_infospace_access
from app.schemas import (
    SourceCreate,
    SourceRead,
    SourcesOut,
    SourceUpdate,
    SourceTransferRequest,
    SourceTransferResponse,
    SourceCreateRequest,
    BundleCreate,
    TaskCreate,
)
from sqlmodel import select, func

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/sources",
    tags=["Sources"]
)

# Routes

@router.post("", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
def create_source(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_in: SourceCreateRequest,
    session: SessionDep,
    bundle_service: BundleServiceDep,
    task_service: TaskServiceDep,
) -> SourceRead:
    """
    Create a new source. If monitoring is enabled, a corresponding ingestion task
    and a destination bundle will also be created.
    """
    source_service = SourceService(session)
    bundle_id_to_use = source_in.target_bundle_id

    # Create a bundle if necessary
    if source_in.enable_monitoring and not bundle_id_to_use:
        bundle_name = (
            source_in.target_bundle_name or f"Ingestion for {source_in.name}"
        )
        
        # Check if bundle with this name already exists
        existing_bundle = session.exec(
            select(Bundle).where(Bundle.name == bundle_name, Bundle.infospace_id == infospace_id)
        ).first()

        if existing_bundle:
            bundle_id_to_use = existing_bundle.id
        else:
            bundle_create = BundleCreate(
                name=bundle_name,
                description=f"Assets ingested from source: {source_in.name}",
            )
            new_bundle = bundle_service.create_bundle(
                bundle_in=bundle_create, user_id=current_user.id, infospace_id=infospace_id
            )
            bundle_id_to_use = new_bundle.id

    # Create the source
    source_create = SourceCreate.model_validate(source_in)
    source = source_service.create_source(
        user_id=current_user.id, infospace_id=infospace_id, source_in=source_create
    )

    # Create a monitoring task if enabled
    if source_in.enable_monitoring and source_in.schedule:
        task_create = TaskCreate(
            name=f"Ingest from {source.name}",
            type="ingest",
            schedule=source_in.schedule,
            configuration={
                "target_bundle_id": bundle_id_to_use,
            },
            source_id=source.id,
        )
        task_service.create_task(
            task_in=task_create, user_id=current_user.id, infospace_id=infospace_id
        )

    session.refresh(source)
    return source

@router.get("", response_model=SourcesOut)
@router.get("/", response_model=SourcesOut)
def list_sources(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Sources for the infospace.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Build query for sources
        query = (
            select(Source)
            .where(Source.infospace_id == infospace_id)
            .offset(skip)
            .limit(limit)
        )
        
        # Execute query
        sources = session.exec(query).all()
        
        # Get total count
        count_query = select(func.count(Source.id)).where(
            Source.infospace_id == infospace_id
        )
        total_count = session.exec(count_query).one()
        
        # Convert to read models and add counts if requested
        result_sources = []
        for source in sources:
            source_read = SourceRead.model_validate(source)
            
            # Add counts if requested
            if include_counts:
                # Count assets for this source
                assets_count_query = select(func.count(Asset.id)).where(
                    Asset.source_id == source.id
                )
                source_read.asset_count = session.exec(assets_count_query).one() or 0
            
            result_sources.append(source_read)
            
        return SourcesOut(data=result_sources, count=total_count)
    
    except ValueError as ve:
        # Should not happen if validation is correct
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_infospace_access
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing sources: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{source_id}", response_model=SourceRead)
def get_source(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    include_counts: bool = Query(True, description="Include counts of assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Source by its ID.
    """
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the source
        source = session.get(Source, source_id)
        if not source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found"
            )
        
        # Verify source belongs to infospace
        if source.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found in this infospace"
            )
        
        # Convert to read model
        source_read = SourceRead.model_validate(source)
        
        # Add counts if requested
        if include_counts:
            # Count assets for this source
            assets_count_query = select(func.count(Asset.id)).where(
                Asset.source_id == source.id
            )
            source_read.asset_count = session.exec(assets_count_query).one() or 0
        
        return source_read
    
    except HTTPException as he:
        # Re-raise HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting source {source_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{source_id}", response_model=SourceRead)
def update_source(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    source_in: SourceUpdate,
    session: SessionDep,
) -> Any:
    """
    Update a Source.
    """
    logger.info(f"Route: Updating Source {source_id} in infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the source
        source = session.get(Source, source_id)
        if not source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found"
            )
        
        # Verify source belongs to infospace
        if source.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found in this infospace"
            )
        
        # Apply updates
        update_data = source_in.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid fields provided for update"
            )
        
        # Update fields
        for field, value in update_data.items():
            setattr(source, field, value)
        
        source.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(source)
        session.commit()
        session.refresh(source)
        
        return SourceRead.model_validate(source)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise HTTP exceptions
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating source {source_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{source_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_source(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Source.
    """
    logger.info(f"Route: Attempting to delete Source {source_id} from infospace {infospace_id}")
    try:
        # Validate infospace access
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the source
        source = session.get(Source, source_id)
        if not source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found"
            )
        
        # Verify source belongs to infospace
        if source.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Source not found in this infospace"
            )
        
        # Check if source can be deleted (not in progress)
        if source.status == SourceStatus.PROCESSING:
            raise ValueError("Cannot delete a source that is currently processing. Cancel it first.")
        
        # Delete the source
        session.delete(source)
        session.commit()
        logger.info(f"Route: Source {source_id} successfully deleted")
        
    except ValueError as ve:
        # Handle validation errors
        session.rollback()
        logger.error(f"Route: Validation error deleting source {source_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise exceptions from validate_infospace_access
        session.rollback()
        raise he
    except Exception as e:
        # Handle unexpected errors
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting source {source_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.post("/transfer", response_model=SourceTransferResponse)
def transfer_sources(
    *,
    current_user: CurrentUser,
    request: SourceTransferRequest,
    session: SessionDep,
) -> SourceTransferResponse:
    """
    Transfer sources between infospaces.
    """
    try:
        # Validate source infospace access
        validate_infospace_access(session, request.source_infospace_id, current_user.id)
        
        # Validate target infospace access
        validate_infospace_access(session, request.target_infospace_id, current_user.id)
        
        # Get sources
        sources_to_transfer = []
        for source_id in request.source_ids:
            source = session.get(Source, source_id)
            if not source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail=f"Source {source_id} not found"
                )
            if source.infospace_id != request.source_infospace_id:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Source {source_id} does not belong to source infospace"
                )
            sources_to_transfer.append(source)
        
        # Transfer sources
        new_source_ids = []
        errors = {}
        
        for source in sources_to_transfer:
            try:
                if request.copy_sources:
                    # Create new source in target infospace
                    new_source = Source(
                        name=source.name,
                        kind=source.kind,
                        details=source.details,
                        infospace_id=request.target_infospace_id,
                        user_id=current_user.id
                    )
                    session.add(new_source)
                    session.flush()
                    new_source_ids.append(new_source.id)
                else:
                    # Move source to target infospace
                    source.infospace_id = request.target_infospace_id
                    session.add(source)
            except Exception as e:
                errors[source.id] = str(e)
        
        session.commit()
        
        return SourceTransferResponse(
            success=len(errors) == 0,
            message="Source transfer completed",
            new_source_ids=new_source_ids if request.copy_sources else None,
            errors=errors if errors else None
        )
        
    except HTTPException as he:
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error transferring sources: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during source transfer")
