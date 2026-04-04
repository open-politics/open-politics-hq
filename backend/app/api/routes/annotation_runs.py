"""Routes for annotation runs."""
import asyncio
import logging
from typing import Any, AsyncIterable, Optional, Dict, Union
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
from fastapi.sse import ServerSentEvent
from app.core.sse import SSEResponse
from pydantic import BaseModel
import csv
import io

from app.models import (
    AnnotationRun,
    RunStatus,
    Annotation,
    Asset,
    AnnotationSchema,
)
from app.schemas import (
    AnnotationRunRead,
    AnnotationRunCreate,
    AnnotationRunUpdate,
    AnnotationRunsOut,
    Message,
    PackageRead,
    CreatePackageFromRunRequest,
    SSEError,
)
from app.api.dependency_injection import (
    SessionDep,
    get_annotation_service,
    get_package_service
)
from app.api.modules.annotation.services import AnnotationService
from app.api.modules.sharing.services import PackageService
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from sqlmodel import select, func

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/runs",
    tags=["Runs"]
)

@router.post("", response_model=AnnotationRunRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AnnotationRunRead, status_code=status.HTTP_201_CREATED)
def create_run(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    run_in: AnnotationRunCreate,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service)
) -> AnnotationRunRead:
    """
    Create a new Run.
    """
    logger.info(f"Route: Creating run in infospace {access.infospace_id}")
    try:
        # Create the run
        run = annotation_service.create_run(
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            run_in=run_in
        )
        
        return run
        
    except ValueError as e:
        logger.error(f"Route: Validation error creating run: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating run: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

# ─── SSE phase models for run list ───

class RunsPhase(BaseModel):
    data: list[AnnotationRunRead]
    count: int  # -1 = still counting

class RunsCountPhase(BaseModel):
    count: int


def _wants_sse(request: Request) -> bool:
    return "text/event-stream" in request.headers.get("accept", "")


def _fetch_runs(session, access, infospace_id: int, skip: int, limit: int, include_counts: bool):
    """Fetch runs + batch annotation counts. Returns (result_runs, counts_by_run)."""
    query = (
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == infospace_id)
    )
    query = access.scope_filter(query, AnnotationRun.id, "run_ids")
    query = query.offset(skip).limit(limit)
    runs = list(session.exec(query).all())

    # Batch annotation counts via GROUP BY (replaces N+1 per-run COUNT)
    run_ids = [r.id for r in runs]
    counts_by_run: dict[int, int] = {}
    if include_counts and run_ids:
        count_rows = session.exec(
            select(Annotation.run_id, func.count(Annotation.id))
            .where(Annotation.run_id.in_(run_ids))
            .group_by(Annotation.run_id)
        ).all()
        counts_by_run = dict(count_rows)

    result_runs = []
    for run in runs:
        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        run_read.schema_ids = [s.id for s in run.target_schemas] if run.target_schemas else []
        if include_counts:
            run_read.annotation_count = counts_by_run.get(run.id, 0)
        result_runs.append(run_read)

    return result_runs


@router.get(
    "",
    response_model=AnnotationRunsOut,
    responses={200: {"content": {"text/event-stream": {}}}},
)
@router.get(
    "/",
    response_model=AnnotationRunsOut,
    responses={200: {"content": {"text/event-stream": {}}}},
)
async def list_runs(
    *,
    request: Request,
    access: Access = Requires(scope=None),
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    session: SessionDep,
):
    """
    Retrieve Runs for the infospace.

    JSON by default. SSE (Accept: text/event-stream) delivers runs fast
    with annotation counts, then streams total count later.
    """
    infospace_id = access.infospace_id

    if not _wants_sse(request):
        # JSON path: fetch everything, return merged response
        result_runs = await asyncio.to_thread(
            _fetch_runs, session, access, infospace_id, skip, limit, include_counts,
        )
        count_query = select(func.count(AnnotationRun.id)).where(
            AnnotationRun.infospace_id == infospace_id
        )
        count_query = access.scope_filter(count_query, AnnotationRun.id, "run_ids")
        total_count = await asyncio.to_thread(lambda: session.exec(count_query).one())
        return AnnotationRunsOut(data=result_runs, count=total_count)

    # SSE path: runs fast, count deferred
    async def generate():
        try:
            result_runs = await asyncio.to_thread(
                _fetch_runs, session, access, infospace_id, skip, limit, include_counts,
            )
            yield ServerSentEvent(
                data=RunsPhase(data=result_runs, count=-1).model_dump_json(),
                event="runs",
            )

            count_query = select(func.count(AnnotationRun.id)).where(
                AnnotationRun.infospace_id == infospace_id
            )
            count_query = access.scope_filter(count_query, AnnotationRun.id, "run_ids")
            total_count = await asyncio.to_thread(
                lambda: session.exec(count_query).one()
            )
            yield ServerSentEvent(
                data=RunsCountPhase(count=total_count).model_dump_json(),
                event="count",
            )
        except Exception as e:
            logger.exception("SSE list_runs error")
            yield ServerSentEvent(data=SSEError(detail=str(e)).model_dump_json(), event="error")

    return SSEResponse(generate())

@router.get("/{run_id}", response_model=AnnotationRunRead)
def get_run(
    *,
    access: Access = Requires(scope=None),
    run_id: int,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    session: SessionDep,
) -> Any:
    """
    Retrieve a specific Run by its ID.
    """
    try:
        infospace_id = access.infospace_id
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
        access.require_in_scope("run_ids", run_id)
        
        # Convert to read model
        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        
        # Populate schema_ids from target_schemas relationship
        run_read.schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []
        
        # DEBUG: Log schema relationship details
        logger.info(f"DEBUG: Retrieved run {run_id} with {len(run.target_schemas) if run.target_schemas else 0} target schemas")
        if run.target_schemas:
            for schema in run.target_schemas:
                logger.info(f"DEBUG: Run {run_id} has target schema: ID={schema.id}, Name='{schema.name}', UUID={schema.uuid}")
        else:
            logger.warning(f"DEBUG: Run {run_id} has NO target schemas!")
        
        # DEBUG: Check if annotations exist for this run
        annotation_count_query = select(func.count(Annotation.id)).where(Annotation.run_id == run.id)
        actual_annotation_count = session.exec(annotation_count_query).one() or 0
        logger.info(f"DEBUG: Run {run_id} has {actual_annotation_count} annotations in database")
        
        # Add counts if requested
        if include_counts:
            # Count annotations for this run
            annotations_count_query = select(func.count(Annotation.id)).where(
                Annotation.run_id == run.id
            )
            run_read.annotation_count = session.exec(annotations_count_query).one() or 0
        else:
            run_read.annotation_count = actual_annotation_count
        
        return run_read
    
    except HTTPException as he:
        # Re-raise HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Error getting run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.patch("/{run_id}", response_model=AnnotationRunRead)
def update_run(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    run_id: int,
    run_in: AnnotationRunUpdate,
    session: SessionDep,
) -> Any:
    """
    Update a Run.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("run_ids", run_id)
    logger.info(f"Route: Updating Run {run_id} in infospace {infospace_id}")
    try:
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )

        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )

        # Apply updates
        update_data = run_in.model_dump(exclude_unset=True)
        if not update_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid fields provided for update"
            )
        
        # Update fields
        for field, value in update_data.items():
            setattr(run, field, value)
        
        if "description" in update_data:
            run.description = update_data["description"]

        run.updated_at = datetime.now(timezone.utc)
        
        # Save changes
        session.add(run)
        session.commit()
        session.refresh(run)
        
        # Return updated run
        # Ensure trigger_context is a dict and tags is a list, not None
        run_dict = run.model_dump(exclude_none=False)
        if run_dict.get('trigger_context') is None:
            run_dict['trigger_context'] = {}
        if run_dict.get('tags') is None:
            run_dict['tags'] = []
        return AnnotationRunRead.model_validate(run_dict)
    
    except ValueError as ve:
        session.rollback()
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise HTTP exceptions
        session.rollback()
        raise he
    except Exception as e:
        session.rollback()
        logger.exception(f"Route: Error updating run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.delete("/{run_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_run(
    *,
    access: Access = Requires(Capability.DELETE, scope=None),
    run_id: int,
    session: SessionDep,
) -> None:
    """
    Delete a Run.
    """
    infospace_id = access.infospace_id
    access.require_in_scope("run_ids", run_id)
    logger.info(f"Route: Attempting to delete Run {run_id} from infospace {infospace_id}")
    try:
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Check if run can be deleted (not in progress)
        if run.status == RunStatus.RUNNING:
            raise ValueError("Cannot delete a run that is currently processing. Cancel it first.")
        
        # Delete the run
        session.delete(run)
        session.commit()
        logger.info(f"Route: Run {run_id} successfully deleted")
        
    except ValueError as ve:
        # Handle validation errors
        session.rollback()
        logger.error(f"Route: Validation error deleting run {run_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise HTTP exceptions
        session.rollback()
        raise he
    except Exception as e:
        # Handle unexpected errors
        session.rollback()
        logger.exception(f"Route: Unexpected error deleting run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error during deletion")

@router.post("/{run_id}/retry_failures", response_model=Message, status_code=status.HTTP_202_ACCEPTED)
def retry_failed_annotations(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    run_id: int,
    session: SessionDep,
    service: AnnotationService = Depends(get_annotation_service),
) -> Message:
    """
    Retry failed annotations in a run.
    """
    try:
        infospace_id = access.infospace_id
        access.require_in_scope("run_ids", run_id)
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )

        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )

        # Trigger retry
        success = service.trigger_retry_failed_annotations(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=infospace_id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to trigger retry of failed annotations"
            )
        
        return Message(message="Retry of failed annotations triggered successfully")
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error triggering retry for run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")

@router.post("/{run_id}/create_package", response_model=PackageRead, status_code=status.HTTP_201_CREATED)
async def create_package_from_run_endpoint(
    *,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    run_id: int,
    request_data: CreatePackageFromRunRequest,
    session: SessionDep,
    package_service: PackageService = Depends(get_package_service)
):
    """
    Create a package from a run.
    """
    infospace_id = access.infospace_id
    logger.info(f"Route: Creating package from run {run_id} in infospace {infospace_id} with name '{request_data.name}'")
    try:
        package = await package_service.create_package_from_run(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=infospace_id,
            name=request_data.name,
            description=request_data.description
        )

        # FastAPI will automatically validate the returned 'package' (DB model instance)
        # against the PackageRead response_model.
        return package

    except ValueError as ve:
        # Service methods might raise ValueError for business logic errors (e.g., not found, bad state)
        logger.error(f"Route: Value error creating package from run {run_id}: {ve}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except HTTPException as he:
        # Re-raise known HTTP exceptions
        raise he
    except Exception as e:
        logger.exception(f"Route: Unexpected error creating package from run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error while creating package from run")


from app.api.modules.sharing.csv_writers import flatten_dict as _flatten_dict


@router.get("/{run_id}/export/csv")
def export_run_annotations_csv(
    *,
    access: Access = Requires(scope=None),
    run_id: int,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service),
    flatten_json: bool = Query(True, description="Flatten nested JSON fields into dot-notation columns"),
    include_metadata: bool = Query(True, description="Include asset and schema metadata"),
    include_justifications: bool = Query(False, description="Include justification text (adds columns)"),
) -> StreamingResponse:
    """
    Export annotation run results as CSV.

    Flattens nested JSON into columns like:
    - value.field_name
    - value.nested.field
    - value.items[0].property

    Perfect for loading into pandas, Excel, or ML tools like lazypredict.
    """
    logger.info(f"Route: Exporting run {run_id} annotations as CSV (flatten={flatten_json}, include_metadata={include_metadata})")
    access.require_in_scope("run_ids", run_id)

    try:
        infospace_id = access.infospace_id
        # Get the run
        run = session.get(AnnotationRun, run_id)
        if not run:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found"
            )
        
        # Verify run belongs to infospace
        if run.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Run not found in this infospace"
            )
        
        # Get all annotations for this run (no pagination)
        annotations = annotation_service.get_annotations_for_run(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=infospace_id,
            skip=0,
            limit=1_000_000  # Get all annotations
        )
        
        if not annotations:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No annotations found for this run"
            )
        
        logger.info(f"Route: Found {len(annotations)} annotations to export")
        
        # Build CSV rows
        rows = []
        for ann in annotations:
            row = {
                'annotation_id': ann.id,
                'annotation_uuid': ann.uuid,
                'asset_id': ann.asset_id,
                'schema_id': ann.schema_id,
                'run_id': ann.run_id,
                'status': ann.status.value,
                'timestamp': ann.timestamp.isoformat() if ann.timestamp else None,
                'event_timestamp': ann.event_timestamp.isoformat() if ann.event_timestamp else None,
            }
            
            # Add metadata if requested
            if include_metadata:
                # Get asset info
                asset = session.get(Asset, ann.asset_id)
                if asset:
                    row['asset_title'] = asset.title
                    row['asset_kind'] = asset.kind.value
                    row['asset_uuid'] = asset.uuid
                    row['source_id'] = asset.source_id
                    row['asset_created_at'] = asset.created_at.isoformat() if asset.created_at else None
                    
                    # Add parent info if available
                    if asset.parent_asset_id:
                        row['parent_asset_id'] = asset.parent_asset_id
                        row['part_index'] = asset.part_index
                
                # Get schema info
                schema = session.get(AnnotationSchema, ann.schema_id)
                if schema:
                    row['schema_name'] = schema.name
                    row['schema_version'] = schema.version
            
            # Add justifications if requested
            if include_justifications and ann.justifications:
                justification_texts = []
                for j in ann.justifications:
                    if j.reasoning:
                        field_label = f"{j.field_name}:" if j.field_name else ""
                        justification_texts.append(f"{field_label}{j.reasoning}")
                row['justifications'] = " | ".join(justification_texts)
            
            # Handle annotation value
            if flatten_json and ann.value:
                # Flatten nested JSON into dot-notation columns
                flattened = _flatten_dict(ann.value, parent_key='value')
                row.update(flattened)
            else:
                # Just stringify the JSON
                row['value_json'] = str(ann.value)
            
            rows.append(row)
        
        if not rows:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="No data to export"
            )
        
        # Collect all unique fieldnames from all rows (annotations may have different fields)
        all_fieldnames = set()
        for row in rows:
            all_fieldnames.update(row.keys())
        
        # Sort fieldnames for consistent output (metadata first, then value fields)
        metadata_fields = [f for f in all_fieldnames if not f.startswith('value.')]
        value_fields = sorted([f for f in all_fieldnames if f.startswith('value.')])
        fieldnames = sorted(metadata_fields) + value_fields
        
        # Create CSV in memory
        output = io.StringIO()
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)
        
        # Get CSV content as bytes
        output.seek(0)
        csv_content = output.getvalue().encode('utf-8')
        
        # Generate filename
        safe_run_name = run.name.replace(' ', '_').replace('/', '_')[:50]
        filename = f"annotations_run_{run_id}_{safe_run_name}.csv"
        
        logger.info(f"Route: Exporting {len(rows)} rows to {filename}")
        
        # Return as downloadable file
        return StreamingResponse(
            io.BytesIO(csv_content),
            media_type="text/csv",
            headers={
                "Content-Disposition": f"attachment; filename={filename}",
                "Content-Length": str(len(csv_content))
            }
        )
    
    except HTTPException as he:
        raise he
    except Exception as e:
        logger.exception(f"Route: Error exporting run {run_id} to CSV: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error generating CSV export: {str(e)}"
        ) 