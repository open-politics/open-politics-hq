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
)
from sqlmodel import select, func
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/sources",
    tags=["Sources"]
)

class RssSourceCreateRequest(BaseModel):
    feed_url: str
    source_name: Optional[str] = None
    auto_monitor: bool = False
    monitoring_schedule: Optional[str] = None
    target_bundle_id: Optional[int] = None
    target_bundle_name: Optional[str] = None

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
) -> SourceRead:
    """
    Create a new source with optional streaming configuration.
    
    If streaming is enabled (is_active=True), the source will automatically poll
    for new content at the specified interval. Content will be routed to the
    output_bundle_id or a newly created bundle.
    """
    source_service = SourceService(session)
    # Use output_bundle_id (streaming) or target_bundle_id (legacy monitoring) or create new
    bundle_id_to_use = source_in.output_bundle_id or source_in.target_bundle_id

    # Create a bundle if necessary (always create one for ingestion)
    if not bundle_id_to_use:
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
    
    # Store the target bundle ID in the source details for use during ingestion
    if bundle_id_to_use:
        source_details = source_in.details or {}
        source_details['target_bundle_id'] = bundle_id_to_use
        source_create = SourceCreate.model_validate(source_in)
        source_create.details = source_details
        # Set output_bundle_id for streaming
        source_create.output_bundle_id = bundle_id_to_use
    else:
        source_create = SourceCreate.model_validate(source_in)
    
    # Set streaming fields if provided
    if hasattr(source_in, 'is_active') and source_in.is_active is not None:
        source_create.is_active = source_in.is_active
    if hasattr(source_in, 'poll_interval_seconds') and source_in.poll_interval_seconds is not None:
        source_create.poll_interval_seconds = source_in.poll_interval_seconds

    # Create the source
    source = source_service.create_source(
        user_id=current_user.id, infospace_id=infospace_id, source_in=source_create
    )

    # Note: Monitoring tasks are deprecated. Use the Flows API to create
    # processing workflows that watch this source's output bundle instead.

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

@router.post("/{source_id}/process", status_code=status.HTTP_202_ACCEPTED)
def trigger_source_processing(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """
    Trigger processing for a specific source.
    """
    logger.info(f"Route: Triggering processing for Source {source_id} in infospace {infospace_id}")
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
        
        # Check if source is already processing
        if source.status == SourceStatus.PROCESSING:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Source is already being processed"
            )
        
        # Use SourceService to trigger processing
        source_service = SourceService(session)
        success = source_service.trigger_source_processing(
            source_id=source_id,
            user_id=current_user.id,
            infospace_id=infospace_id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to trigger source processing"
            )
        
        return {
            "message": "Source processing triggered successfully",
            "source_id": source_id,
            "status": "processing_queued"
        }
        
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error triggering processing for source {source_id}: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, 
            detail="Internal server error during processing trigger"
        )

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

@router.post("/create-rss-source", response_model=SourceRead)
async def create_rss_source(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    request: RssSourceCreateRequest,
    content_service: ContentIngestionServiceDep,
    bundle_service: BundleServiceDep,
) -> Any:
    """
    Create a new Source of kind 'rss' and its output bundle.
    
    Note: The auto_monitor parameter is deprecated. Use the Flows API to create
    processing workflows that watch this source's output bundle.
    """
    source_name = request.source_name
    if not source_name:
        try:
            feed_info = await content_service.preview_rss_feed(
                request.feed_url, max_items=0
            )
            source_name = f"RSS: {feed_info['feed_info']['title']}"
        except Exception:
            source_name = f"RSS Feed: {request.feed_url}"

    # 1. Determine or create the target bundle first
    bundle_id_to_use = request.target_bundle_id
    if not bundle_id_to_use:
        # Create a new bundle
        bundle_name = request.target_bundle_name or f"RSS: {source_name}"
        
        # Check if bundle with this name already exists
        existing_bundle = session.exec(
            select(Bundle).where(Bundle.name == bundle_name, Bundle.infospace_id == infospace_id)
        ).first()
        
        if existing_bundle:
            bundle_id_to_use = existing_bundle.id
        else:
            bundle_create = BundleCreate(
                name=bundle_name,
                description=f"Assets ingested from RSS feed: {source_name}",
            )
            new_bundle = bundle_service.create_bundle(
                bundle_in=bundle_create, user_id=current_user.id, infospace_id=infospace_id
            )
            bundle_id_to_use = new_bundle.id
    
    # 2. Create the Source with bundle_id in details
    source_create = SourceCreate(
        name=source_name, 
        kind="rss", 
        details={
            "feed_url": request.feed_url,
            "target_bundle_id": bundle_id_to_use  # Store bundle_id for processing
        }
    )

    stmt = select(Source).where(
        Source.infospace_id == infospace_id,
        Source.details["feed_url"].as_string() == request.feed_url,
    )
    existing_source = session.exec(stmt).first()

    if existing_source:
        source = existing_source
        # Update the target_bundle_id if it's not already set
        if not existing_source.details or 'target_bundle_id' not in existing_source.details:
            if not existing_source.details:
                existing_source.details = {}
            existing_source.details['target_bundle_id'] = bundle_id_to_use
            session.add(existing_source)
            session.commit()
            session.refresh(existing_source)
    else:
        source = Source.model_validate(
            source_create,
            update={"infospace_id": infospace_id, "user_id": current_user.id},
        )
        session.add(source)
        session.commit()
        session.refresh(source)

    # Note: auto_monitor is deprecated. Users should create a Flow via /flows API
    # to set up processing workflows for this source's output bundle.
    if request.auto_monitor:
        logger.warning(
            f"auto_monitor is deprecated. Create a Flow watching bundle {bundle_id_to_use} "
            f"instead for source {source.id}"
        )

    return source


# ═══════════════════════════════════════════════════════════════
# STREAMING ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/{source_id}/activate", response_model=SourceRead, operation_id="Sources-activate_stream")
def activate_stream(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> SourceRead:
    """Activate a source stream - enable polling."""
    validate_infospace_access(session, infospace_id, current_user.id)

    source_service = SourceService(session)
    source = source_service.activate_stream(source_id, current_user.id)

    return SourceRead.model_validate(source)


@router.post("/{source_id}/pause", response_model=SourceRead, operation_id="Sources-pause_stream")
def pause_stream(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> SourceRead:
    """Pause a source stream - disable polling."""
    validate_infospace_access(session, infospace_id, current_user.id)

    source_service = SourceService(session)
    source = source_service.pause_stream(source_id, current_user.id)

    return SourceRead.model_validate(source)


@router.post("/{source_id}/poll", status_code=status.HTTP_202_ACCEPTED, operation_id="Sources-poll_source")
async def poll_source(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """Manually trigger a poll of a source."""
    from app.core.security import decrypt_credentials
    
    validate_infospace_access(session, infospace_id, current_user.id)
    
    # Retrieve user's stored API keys for search providers
    api_keys = {}
    if current_user.encrypted_credentials:
        api_keys = decrypt_credentials(current_user.encrypted_credentials)
    
    source_service = SourceService(session)
    result = await source_service.execute_poll(source_id, user_id=current_user.id, runtime_api_keys=api_keys)
    
    return result


@router.get("/{source_id}/stats", operation_id="Sources-get_stream_stats")
def get_stream_stats(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """Get stream statistics for a source."""
    validate_infospace_access(session, infospace_id, current_user.id)
    
    source_service = SourceService(session)
    stats = source_service.get_stream_stats(source_id, current_user.id, infospace_id)
    
    return stats


@router.get("/{source_id}/poll-history", operation_id="Sources-get_poll_history")
def get_poll_history(
    *,
    current_user: CurrentUser,
    infospace_id: int,
    source_id: int,
    session: SessionDep,
    limit: int = Query(default=20, le=100),
) -> Dict[str, Any]:
    """Get recent poll history for a source."""
    from app.models import SourcePollHistory
    
    validate_infospace_access(session, infospace_id, current_user.id)
    
    # Verify source exists and belongs to infospace
    source = session.get(Source, source_id)
    if not source or source.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Source not found")
    
    polls = session.exec(
        select(SourcePollHistory)
        .where(SourcePollHistory.source_id == source_id)
        .order_by(SourcePollHistory.started_at.desc())
        .limit(limit)
    ).all()
    
    return {
        "source_id": source_id,
        "polls": [
            {
                "id": poll.id,
                "started_at": poll.started_at.isoformat(),
                "completed_at": poll.completed_at.isoformat() if poll.completed_at else None,
                "status": poll.status,
                "items_found": poll.items_found,
                "items_ingested": poll.items_ingested,
                "error_message": poll.error_message,
            }
            for poll in polls
        ],
    }
