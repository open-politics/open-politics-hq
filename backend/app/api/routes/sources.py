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
from app.api.dependency_injection import (
    SessionDep,
    CurrentUser,
)
from app.api.modules.content.services.source_service import (
    create_source as svc_create_source,
    activate_stream as svc_activate_stream,
    pause_stream as svc_pause_stream,
    execute_poll as svc_execute_poll,
    get_stream_stats as svc_get_stream_stats,
    trigger_source_processing as svc_trigger_source_processing,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
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
    target_bundle_id: Optional[int] = None
    target_bundle_name: Optional[str] = None

# Routes

@router.post("", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=SourceRead, status_code=status.HTTP_201_CREATED)
def create_source(
    *,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    source_in: SourceCreateRequest,
    session: SessionDep,
) -> SourceRead:
    """Create a source. ``details`` is the source kind's read-config, verbatim;
    the destination is the ``output_bundle_id`` column (resolved or created here),
    never a key inside ``details``. Active sources poll on their interval."""
    # Destination: explicit bundle id, or find/create one named for the source.
    bundle_id_to_use = source_in.output_bundle_id or source_in.target_bundle_id
    if not bundle_id_to_use:
        bundle_name = source_in.target_bundle_name or f"Ingestion for {source_in.name}"
        existing_bundle = session.exec(
            select(Bundle).where(Bundle.name == bundle_name, Bundle.infospace_id == infospace_id)
        ).first()
        if existing_bundle:
            bundle_id_to_use = existing_bundle.id
        else:
            from app.api.modules.content.tree import create_bundle as tree_create_bundle
            new_bundle = tree_create_bundle(
                session, infospace_id=infospace_id, user_id=access.user_id,
                name=bundle_name,
                description=f"Assets ingested from source: {source_in.name}",
            )
            session.commit()
            bundle_id_to_use = new_bundle.id

    source_create = SourceCreate.model_validate(source_in)
    source_create.output_bundle_id = bundle_id_to_use

    source = svc_create_source(
        session, user_id=access.user_id, infospace_id=infospace_id, source_in=source_create
    )
    session.refresh(source)
    return source

@router.get("", response_model=SourcesOut)
@router.get("/", response_model=SourcesOut)
def list_sources(
    *,
    access: Access = Requires(scope=None),
    infospace_id: int,
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve Sources for the infospace.
    """
    # Sources are operational infrastructure — not in PackageScope
    if access.scope:
        return SourcesOut(data=[], count=0)
    try:
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
        raise he
    except Exception as e:
        logger.exception(f"Route: Error listing sources: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.get("/{source_id}", response_model=SourceRead)
def get_source(
    *,
    access: Access = Requires(scope=None),
    infospace_id: int,
    source_id: int,
    include_counts: bool = Query(True, description="Include counts of assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Source by its ID.
    """
    if access.scope:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    try:
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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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
    access: Access = Requires(Capability.DELETE, scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Source.
    """
    logger.info(f"Route: Attempting to delete Source {source_id} from infospace {infospace_id}")
    try:
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
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting source {source_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.post("/{source_id}/process", status_code=status.HTTP_202_ACCEPTED)
def trigger_source_processing(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """
    Trigger processing for a specific source.
    """
    logger.info(f"Route: Triggering processing for Source {source_id} in infospace {infospace_id}")
    try:
        
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
        
        success = svc_trigger_source_processing(
            session,
            source_id=source_id,
            user_id=access.user_id,
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
    Validates organize on source, ingest on target.
    """
    try:
        resolve_access(session, request.source_infospace_id, current_user, Capability.ORGANIZE)
        resolve_access(session, request.target_infospace_id, current_user, Capability.INGEST)
        
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
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    request: RssSourceCreateRequest,
) -> Any:
    """Create a Source of kind ``rss`` and its output bundle. ``details`` is the
    rss source's read-config; the destination is the ``output_bundle_id`` column."""
    from app.api.modules.content.sources import rss
    from app.api.modules.content.tree import create_bundle as tree_create_bundle

    source_name = request.source_name
    if not source_name:
        try:
            feed_info = await rss.preview_feed(
                request.feed_url, max_items=0
            )
            source_name = f"RSS: {feed_info['feed_info']['title']}"
        except Exception:
            source_name = f"RSS Feed: {request.feed_url}"

    # Destination: explicit bundle id, or find/create one named for the feed.
    bundle_id_to_use = request.target_bundle_id
    if not bundle_id_to_use:
        bundle_name = request.target_bundle_name or f"RSS: {source_name}"
        existing_bundle = session.exec(
            select(Bundle).where(Bundle.name == bundle_name, Bundle.infospace_id == infospace_id)
        ).first()
        if existing_bundle:
            bundle_id_to_use = existing_bundle.id
        else:
            new_bundle = tree_create_bundle(
                session, infospace_id=infospace_id, user_id=access.user_id,
                name=bundle_name,
                description=f"Assets ingested from RSS feed: {source_name}",
            )
            session.commit()
            bundle_id_to_use = new_bundle.id

    stmt = select(Source).where(
        Source.infospace_id == infospace_id,
        Source.details["feed_url"].as_string() == request.feed_url,
    )
    existing_source = session.exec(stmt).first()

    if existing_source:
        source = existing_source
        if not source.output_bundle_id:
            source.output_bundle_id = bundle_id_to_use
            session.add(source)
            session.commit()
            session.refresh(source)
    else:
        source = Source(
            name=source_name,
            kind="rss",
            details={"feed_url": request.feed_url},
            output_bundle_id=bundle_id_to_use,
            infospace_id=infospace_id,
            user_id=access.user_id,
        )
        session.add(source)
        session.commit()
        session.refresh(source)

    return source


# ═══════════════════════════════════════════════════════════════
# STREAMING ENDPOINTS
# ═══════════════════════════════════════════════════════════════

@router.post("/{source_id}/activate", response_model=SourceRead, operation_id="Sources-activate_stream")
def activate_stream(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> SourceRead:
    """Activate a source stream - enable polling."""
    source = svc_activate_stream(session, source_id, access.user_id)

    return SourceRead.model_validate(source)


@router.post("/{source_id}/pause", response_model=SourceRead, operation_id="Sources-pause_stream")
def pause_stream(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> SourceRead:
    """Pause a source stream - disable polling."""
    source = svc_pause_stream(session, source_id, access.user_id)

    return SourceRead.model_validate(source)


@router.post("/{source_id}/poll", status_code=status.HTTP_202_ACCEPTED, operation_id="Sources-poll_source")
async def poll_source(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """Manually trigger a poll of a source."""
    from app.core.security import decrypt_credentials, CredentialDecryptionError
    from app.api.modules.identity_infospace_user.models import User

    # Retrieve user's stored API keys for search providers
    api_keys = {}
    user = session.get(User, access.user_id)
    if user and user.encrypted_credentials:
        try:
            api_keys = decrypt_credentials(user.encrypted_credentials)
        except CredentialDecryptionError as e:
            # Never fall back to {} — a keyless poll would look "broken" instead
            # of "blocked by a rotation/misconfig". Surface it.
            raise HTTPException(status_code=503, detail=str(e)) from e
    result = await svc_execute_poll(session, source_id, user_id=access.user_id, runtime_api_keys=api_keys)
    
    return result


@router.get("/{source_id}/stats", operation_id="Sources-get_stream_stats")
def get_stream_stats(
    *,
    access: Access = Requires(scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
) -> Dict[str, Any]:
    """Get stream statistics for a source."""
    stats = svc_get_stream_stats(session, source_id, access.user_id, infospace_id)
    
    return stats


@router.get("/{source_id}/poll-history", operation_id="Sources-get_poll_history")
def get_poll_history(
    *,
    access: Access = Requires(scope=None),
    infospace_id: int,
    source_id: int,
    session: SessionDep,
    limit: int = Query(default=20, le=100),
) -> Dict[str, Any]:
    """Get recent poll history for a source."""
    from app.models import IngestionJob, IngestionStatus

    # Verify source exists and belongs to infospace
    source = session.get(Source, source_id)
    if not source or source.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Source not found")

    # A poll IS an IngestionJob with source_id set (SourcePollHistory retired).
    jobs = session.exec(
        select(IngestionJob)
        .where(IngestionJob.source_id == source_id)
        .order_by(IngestionJob.created_at.desc())
        .limit(limit)
    ).all()

    def _record(job):
        counts = (job.cursor_state or {}).get("counts", {})
        ingested = job.processed_files or 0
        started = job.started_at or job.created_at
        status = ("success" if job.status == IngestionStatus.COMPLETED
                  else "failed" if job.status == IngestionStatus.FAILED
                  else job.status.value)
        return {
            "id": job.id,
            "started_at": started.isoformat() if started else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "status": status,
            "items_found": sum(counts.values()) if counts else ingested,
            "items_ingested": ingested,
            "error_message": job.error_message,
        }

    return {"source_id": source_id, "polls": [_record(j) for j in jobs]}
