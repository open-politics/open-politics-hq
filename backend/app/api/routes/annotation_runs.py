"""Routes for annotation runs."""
import json
import asyncio
import logging
from typing import Any, AsyncIterable, Literal, Optional, Dict, Union
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
from pydantic import BaseModel, Field
import csv
import io

from app.models import (
    AnnotationRun,
    RunStatus,
    Annotation,
    Asset,
    AnnotationSchema,
    Infospace,
)
from app.api.modules.annotation.contract_resolution import FieldInjection
from app.api.modules.annotation.panel_config import Projection
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
from sqlalchemy import text

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


def _fetch_runs(
    session, access, infospace_id: int, skip: int, limit: int,
    include_counts: bool, live: Optional[bool] = None,
    status: Optional[RunStatus] = None,
):
    """Fetch runs + per-run annotation counts.

    One row per run — there is no family tier. A run is a single durable object;
    extension grows it in place and a live run's annotations accumulate on the
    same row, so its own ``status`` and count are the whole truth.

    Ordered by ``updated_at`` descending. A live run's row is touched every time
    its annotations grow, so "most recently changed" and "what is actually
    moving" are the same question — and it is the one a monitoring list is for.
    Before this the query had no ORDER BY at all, so the page you got was
    whatever order the database felt like returning.
    """
    query = (
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == infospace_id)
    )
    if live is not None:
        query = query.where(AnnotationRun.live == live)
    if status is not None:
        query = query.where(AnnotationRun.status == status)
    query = access.scope_filter(query, AnnotationRun.id, "run_ids")
    query = query.order_by(AnnotationRun.updated_at.desc(), AnnotationRun.id.desc())
    query = query.offset(skip).limit(limit)
    runs = list(session.exec(query).all())

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


@router.get("", response_model=AnnotationRunsOut)
@router.get("/", response_model=AnnotationRunsOut)
async def list_runs(
    *,
    access: Access = Requires(scope=None),
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    live: Optional[bool] = Query(None, description="Only live runs, or only non-live"),
    status: Optional[RunStatus] = Query(None, description="Only runs in this status"),
    session: SessionDep,
):
    """Retrieve runs for the infospace (JSON), most recently changed first.

    For a progressive SSE version (runs first, count later), call the
    sibling endpoint ``GET /stream``.
    """
    infospace_id = access.infospace_id

    result_runs = await asyncio.to_thread(
        _fetch_runs, session, access, infospace_id, skip, limit, include_counts,
        live, status,
    )
    count_query = select(func.count(AnnotationRun.id)).where(
        AnnotationRun.infospace_id == infospace_id
    )
    # The count must agree with the page, or a filtered list reports a total it
    # is not showing.
    if live is not None:
        count_query = count_query.where(AnnotationRun.live == live)
    if status is not None:
        count_query = count_query.where(AnnotationRun.status == status)
    count_query = access.scope_filter(count_query, AnnotationRun.id, "run_ids")
    total_count = await asyncio.to_thread(lambda: session.exec(count_query).one())
    return AnnotationRunsOut(data=result_runs, count=total_count)


@router.get("/stream", response_class=EventSourceResponse)
async def list_runs_stream(
    *,
    access: Access = Requires(scope=None),
    skip: int = 0,
    limit: int = 100,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    live: Optional[bool] = Query(None, description="Only live runs, or only non-live"),
    status: Optional[RunStatus] = Query(None, description="Only runs in this status"),
    session: SessionDep,
):
    """Progressive SSE feed for run list — runs first, count later.

    Same ordering and filters as the JSON sibling; they share ``_fetch_runs``.

    Native async-generator endpoint; FastAPI's SSE pipeline attaches
    3s keepalive pings (survives nginx ``proxy_read_timeout``).
    """
    infospace_id = access.infospace_id

    try:
        result_runs = await asyncio.to_thread(
            _fetch_runs, session, access, infospace_id, skip, limit, include_counts,
            live, status,
        )
    except Exception as e:
        logger.exception("SSE list_runs error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")
        return

    yield ServerSentEvent(
        data=RunsPhase(data=result_runs, count=-1),
        event="runs",
    )

    try:
        count_query = select(func.count(AnnotationRun.id)).where(
            AnnotationRun.infospace_id == infospace_id
        )
        if live is not None:
            count_query = count_query.where(AnnotationRun.live == live)
        if status is not None:
            count_query = count_query.where(AnnotationRun.status == status)
        count_query = access.scope_filter(count_query, AnnotationRun.id, "run_ids")
        total_count = await asyncio.to_thread(
            lambda: session.exec(count_query).one()
        )
        yield ServerSentEvent(
            data=RunsCountPhase(count=total_count),
            event="count",
        )
    except Exception as e:
        logger.exception("SSE list_runs count error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")

@router.get("/{run_id}", response_model=AnnotationRunRead)
def get_run(
    *,
    access: Access = Requires(scope=None),
    run_id: int,
    include_counts: bool = Query(True, description="Include counts of annotations and assets"),
    session: SessionDep,
) -> Any:
    """Retrieve a specific Run by its ID.

    A run is one durable object — its own ``status`` and annotation count are
    the whole truth (extension grows it in place; a live run accumulates on the
    same row).
    """
    try:
        infospace_id = access.infospace_id
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
        access.require_in_scope("run_ids", run_id)

        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        run_read.schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []

        if include_counts:
            run_read.annotation_count = session.exec(
                select(func.count(Annotation.id)).where(Annotation.run_id == run.id)
            ).one() or 0
        else:
            run_read.annotation_count = None

        return run_read

    except HTTPException as he:
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
        
        # Human curation is the one child a cascade must never take (see
        # u1_infospace_cascade_delete), so its FK stays NO ACTION and this path
        # clears it deliberately — the same thing delete_infospace does. Without
        # it the FK would refuse the delete once anyone had curated a fragment.
        session.execute(
            text("DELETE FROM fragmentcuration WHERE annotation_id IN "
                 "(SELECT id FROM annotation WHERE run_id = :rid)"),
            {"rid": run_id},
        )
        # Everything else is composition: annotations, aggregates and schema
        # links go with the run via ON DELETE CASCADE.
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

class ExtendRunRequest(BaseModel):
    """Request body for ``POST /runs/{run_id}/extend``.

    At least one of ``asset_ids``, ``bundle_id``, ``schema_ids`` must be set.
    The run grows in place — no child run — and is re-pended; only the new
    (asset, schema) pairs are processed.
    """
    asset_ids: Optional[list[int]] = None
    bundle_id: Optional[int] = None
    schema_ids: Optional[list[int]] = None
    configuration_overrides: Optional[Dict[str, Any]] = None


@router.post("/{run_id}/extend", response_model=AnnotationRunRead, status_code=status.HTTP_201_CREATED)
def extend_run(
    *,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    run_id: int,
    body: ExtendRunRequest,
    session: SessionDep,
    annotation_service: AnnotationService = Depends(get_annotation_service),
) -> AnnotationRunRead:
    """Grow a run with new assets and/or schemas, in place.

    Appends to the same run's scope, resets its streaming watermark, and
    re-pends it. The universal delta-skip processes only the new (asset,
    schema) pairs. Returns the same (now re-pended) run.

    Gates: must be a one_off run, no ``flow_execution_id``.
    """
    access.require_in_scope("run_ids", run_id)
    try:
        run = annotation_service.extend_run(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            asset_ids=body.asset_ids,
            bundle_id=body.bundle_id,
            schema_ids=body.schema_ids,
            configuration_overrides=body.configuration_overrides,
        )
        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        run_read.schema_ids = [s.id for s in run.target_schemas] if run.target_schemas else []
        run_read.annotation_count = session.exec(
            select(func.count(Annotation.id)).where(Annotation.run_id == run.id)
        ).one() or 0
        return run_read
    except ValueError as e:
        logger.warning(f"Route: Extension rejected for run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except Exception as e:
        logger.exception(f"Route: Unexpected error extending run {run_id}: {e}")
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Internal server error")


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


def _collect_inline_justifications(value: Optional[Dict[str, Any]]) -> list:
    """Walk an annotation value JSONB and pull every inline justification reasoning string.

    The structured-output pipeline injects:
      * sibling ``{field}_justification`` blocks at the parent level for scalars,
        objects, and primitive arrays;
      * inline ``justification`` fields inside each item of an array<object> field;
      * top-level ``_thinking_trace`` for provider thinking summaries.

    Returns a list of ``"label:reasoning"`` strings for the CSV ``justifications`` column.
    """
    if not isinstance(value, dict):
        return []
    out = []
    for key, sub in value.items():
        if not isinstance(sub, dict):
            continue
        if key.endswith("_justification") and sub.get("reasoning"):
            label = key[: -len("_justification")]
            out.append(f"{label}:{sub['reasoning']}")
        elif key == "_thinking_trace" and sub.get("reasoning"):
            out.append(f"_thinking_trace:{sub['reasoning']}")
    for key, sub in value.items():
        if isinstance(sub, list):
            for i, item in enumerate(sub):
                if isinstance(item, dict):
                    j = item.get("justification")
                    if isinstance(j, dict) and j.get("reasoning"):
                        out.append(f"{key}[{i}]:{j['reasoning']}")
    return out


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
            limit=1_000_000,  # Get all annotations
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
            
            # Add justifications if requested — read inline from the value JSONB.
            if include_justifications:
                texts = _collect_inline_justifications(ann.value)
                if texts:
                    row['justifications'] = " | ".join(texts)
            
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


# ─── Composable /view endpoint ───
# One endpoint, multiple materializations. The caller declares what it
# needs (rows, aggregate, graph — any combination) and the backend
# streams each requested section as an SSE phase.

from app.core.filters import FilterSet, MergeMap
from app.api.modules.annotation.query import (
    AnnotationQuery,
    DistinctValueEntry,
)
from app.api.modules.annotation.formula import Formula
from app.api.modules.annotation.formula_query import (
    FormulaQuery,
    RowsView,
    _edge_to_dict,
    _node_to_dict,
)
from app.api.modules.annotation.panel_config import Scope


class RowsParams(BaseModel):
    """Per-phase params for the rows view.

    The Formula carries the data scope (filter, schema, merge_maps); these
    params only control pagination."""

    cursor: str | int | None = None
    limit: int = 100
    # Errored annotations are hidden by default so they don't consume the page
    # budget (a failed-heavy run would otherwise show an empty table). Set true to
    # include them (the table's "show failed" toggle).
    include_failed: bool = False


class GraphParams(BaseModel):
    """Per-phase params for the graph view.

    ``triplet_field`` falls back to ``formula.group[0].path`` when omitted
    (per the FormulaQuery.graph_view contract).

    **Every field applies to both endpoints.** ``/view`` and ``/view/stream``
    both configure through ``_graph_kwargs`` → ``FormulaQuery._graph_source``,
    so the same body yields the same graph either way; the JSON endpoint just
    collects the chunks. Only ``chunk_size`` is streaming-specific, and it
    controls SSE frame size rather than what the graph contains.
    """

    projections: list[Projection] = Field(default_factory=list)
    """Authoritative source of graph atoms. Empty falls back to
    ``triplet_field`` / ``formula.group[0].path`` — the legacy single-triplet
    shape — so panels authored before projections keep working."""
    triplet_field: str | None = None
    q: str | None = Field(
        default=None,
        description="GQL — see modules/graph/gql.py. Filters, hops, traversal.",
    )
    dedup: Literal["exact", "normalized"] = "exact"
    top_n_nodes: int | None = None
    top_n_edges: int | None = None
    # streaming-only params (used by /view/stream)
    chunk_size: int = 100
    edge_weight_field: str | None = None
    edge_weight_mode: str = "count"
    forward_properties: list[dict[str, Any]] = []
    node_group_by: str | None = None
    edge_group_by: str | None = None
    null_policy: Literal["skip", "zero"] = "skip"
    doc_place: str | None = None
    doc_time: str | None = None
    """The document rung of the place / time ladders — see ``GraphConfig``.
    Annotation-scoped, so they are configured here rather than on a
    projection: what a filing is *about* applies to everything it mentions."""
    rows_limit: int = 200
    """How many section rows ride along with the graph. Zero disables them.

    The rows are the table half of one view (``MVP`` §4): the same ``q``
    produces both, so a pane can render the proposition a row states instead of
    a count of the fragments assembly left. Paged independently of
    ``top_n_nodes`` — a table that inherited the canvas's truncation would
    report "8 payments" for a run holding two hundred, and be believed."""
    rows_cursor: str | None = None
    """``"<annotation_id>:<ord>"``. Tuple-shaped because one annotation fans
    into many rows and a scalar cursor drops the tail of any array that
    overflows a page."""


class ViewRequest(BaseModel):
    """The unified /view request.

    One shared :class:`Formula` is the data scope across every requested
    phase. Phase params (``rows``, ``aggregate``, ``graph``) act as
    toggles + per-phase tuning. ``aggregate`` is present-or-absent; the
    Formula's group/measures drive the actual computation.

    ``merge_maps`` are panel-local value aliases. Run-wide aliases live
    on ``AnnotationRun.views_config['aliases']`` and are loaded by the
    route. The Formula itself does not carry merge maps — those belong
    to the run/panel context, not the data spec. See
    ``docs/INTELLIGENCE.md``.
    """

    formula: Formula
    q: str | None = None
    """The panel's GQL string — see :class:`Panel.q`.

    Panel-level rather than under ``graph`` because the query is what the PANEL
    asks, not how one phase draws. ``GraphParams.q`` remains as the fallback for
    clients that have not migrated; ``_effective_q`` is the single reader.
    """
    fields: list[str] | None = None
    incoming_scopes: list[Scope] = Field(default_factory=list)
    merge_maps: list[MergeMap] = Field(default_factory=list)
    additional_run_ids: list[int] = Field(default_factory=list)
    rows: RowsParams | None = None
    aggregate: dict[str, Any] | None = None  # presence = request aggregate
    graph: GraphParams | None = None


# --- SSE response models ---


class ViewRowsPhase(BaseModel):
    items: list[dict]
    assets: dict[int, dict]
    total: int
    cursor_next: str | None
    fields: list[str] = Field(default_factory=list)


class ViewGraphPhase(BaseModel):
    nodes: list[dict]
    edges: list[dict]
    rows: list[dict] | None = None
    """The rows behind the picture — **one table per named section**.

    Same query, two surfaces. ``nodes``/``edges`` are for layout; ``rows`` is for
    reading, and entity cells carry the node id the assembler minted so a click
    in either surface selects in both.

    A list because ``SECTION:interests,observations`` is two questions, not one:
    the sections are different relations and unioning them yields a table that
    is mostly empty cells. Each entry names its own section, and the pane takes
    that name — a pane called "rows" sitting above a list of interests is a
    label that tells the reader nothing they could not already see.

    See ``graph/rows.py`` and ``docs/plans/observation-model/MVP.md`` §4."""
    meta: dict = Field(default_factory=dict)
    """What the engine actually ran, so the panel does not have to guess.

    Two things, and both were previously unknowable from the client:

    ``layers``
        the RESOLVED projections — path, what each row is about, the node roles
        that were inferred, which bindings are set, and how many nodes and edges
        each one contributed. A panel that re-derives this from the schema map
        drifts from what the engine did; a panel that cannot see it at all shows
        a configuration surface for a set it is only guessing at.

    ``frames``
        per-frame coverage. Which of time · geo · interest · event can actually
        position this graph, so the axis control can grey out a plane before it
        is chosen rather than after."""


def _resolve_family(session, infospace_id: int, run_id: int) -> list[int]:
    """Return ``[run_id]``.

    A run is one durable object now — extension grows it in place, so there is
    no family to resolve. Kept as a single seam in case explicit multi-run
    composition wants to expand here later.
    """
    return [run_id]


def _build_formula_query(
    session, access: Access, run_id: int, body: "ViewRequest",
) -> FormulaQuery:
    """Translate a :class:`ViewRequest` into a configured
    :class:`FormulaQuery`. Single boundary between the wire format and
    the engine.

    The query covers the run (and any explicitly-requested ``additional_run_ids``).
    Package scope is still enforced via ``AnnotationQuery.scope`` — runs outside
    the grant's ``run_ids`` get filtered in the materialization SQL.
    """
    explicit_ids = [run_id] + body.additional_run_ids
    for rid in explicit_ids:
        access.require_in_scope("run_ids", rid)

    rolled: list[int] = []
    seen: set[int] = set()
    for rid in explicit_ids:
        for fid in _resolve_family(session, access.infospace_id, rid):
            if fid not in seen:
                seen.add(fid)
                rolled.append(fid)

    _run = session.get(AnnotationRun, run_id)
    # Run-wide aliases library lives on AnnotationRun.views_config['aliases'].
    # Compose: scope merge_maps → panel merge_maps → run aliases (first-match
    # wins, so scope and panel take precedence over the global library).
    run_aliases = (
        (_run.views_config.get("aliases") or [])
        if _run and isinstance(_run.views_config, dict) else []
    )
    # Canon value vocabulary — the durable, lowest-precedence base layer. A run
    # with a canon attached auto-canonicalizes its grouped fields from the
    # canon's value-typed entries (the read-time inverse of value-fold promotion),
    # so promoted aliases apply without re-entering them per run.
    canon_aliases: list = []
    canon_ids = getattr(_run, "canon_ids", None) or [] if _run else []
    if canon_ids:
        from app.api.modules.graph.promote import canon_value_merge_maps
        field_paths = [d.path for d in body.formula.group if getattr(d, "path", None)]
        field_paths += [f for f in (body.fields or []) if f]
        canon_aliases = canon_value_merge_maps(session, canon_ids[0], field_paths)
    return FormulaQuery(
        session, access, rolled, body.formula,
        incoming_scopes=body.incoming_scopes,
        panel_merge_maps=body.merge_maps,
        run_aliases=run_aliases,
        canon_aliases=canon_aliases,
    )


def _build_view_phases(session, access, run_id: int, body: "ViewRequest") -> dict:
    """Synchronous materialization of every requested view phase.

    Shape: one :class:`FormulaQuery` is constructed per request; each
    phase packer method reuses the same configured engine state. No
    Formula handling duplicated per phase, no body-level filter
    plumbing.
    """
    fq = _build_formula_query(session, access, run_id, body)
    result: dict[str, BaseModel] = {}

    if body.rows is not None:
        result["rows"] = fq.rows_view(
            fields=body.fields,
            cursor=body.rows.cursor,
            limit=body.rows.limit,
            include_failed=body.rows.include_failed,
        )

    if body.aggregate is not None:
        result["aggregate"] = fq.aggregate_view()

    if body.graph is not None:
        if body.q and not body.graph.q:
            # Panel-level `q` wins for a client that has migrated; a client
            # still sending it under `graph` keeps working untouched.
            body.graph = body.graph.model_copy(update={"q": body.q})
        gr = fq.graph_view(**_graph_kwargs(body.graph))
        # Built once and handed to both: the panes are named after the tables,
        # so computing them twice would be two queries whose answers could
        # disagree about what the panel is showing.
        tables = _graph_rows(fq, body.graph)
        result["graph"] = ViewGraphPhase(
            nodes=[_node_to_dict(n) for n in gr.nodes],
            edges=[_edge_to_dict(e) for e in gr.edges],
            rows=tables,
            meta=_graph_meta(fq, body.graph, gr, tables),
        )

    return result


#: Rows per non-acts section when the query named none. The docs fold wants
#: breadth — every section a document filled — not depth in any one of them;
#: `SECTION:` is how a reader asks for depth, and it then gets the full budget.
_FOLD_ROWS_PER_SECTION = 50


def _graph_rows(fq, gp: "GraphParams") -> list[dict] | None:
    """The table half of a graph view: **one table per named section**.

    Built from the same source object the canvas was built from, so the two
    surfaces cannot answer the same question differently — ``MVP`` S3 holds
    because there is one filter implementation, not two that agree.

    Which sections, and which columns, come out of the query itself:

    .. code-block:: text

        SECTION:interests,observations  →  TWO tables, in the order written
        (absent)                        →  one: the acts, not the cast
        SHOW:by,to,magnitude            →  the columns, applied to each

    A comma list splits rather than merges because the sections are *different
    relations*: interests have a name and a domain, observations have a payer
    and an amount. Unioning them produces a table that is mostly empty cells
    with a column header for every field in the schema, which is what a "show
    me everything" surface always degenerates into.

    Never raises. A view that renders a canvas and 500s on its table is worse
    than one that renders a canvas and says why the table is missing, so every
    failure becomes a note the reader can see.
    """
    if not gp.rows_limit:
        return None
    from app.api.modules.graph import rows as rowmod

    try:
        source, _gq = fq._graph_source(
            projections=gp.projections or None,
            triplet_field=gp.triplet_field,
            dedup=gp.dedup,
            q=gp.q,
            doc_place=gp.doc_place,
            doc_time=gp.doc_time,
        )
        source._resolve()
        projections = list(getattr(source, "projections", None) or [])
        if not projections:
            return None

        shared: list[str] = []
        requested, show = _rows_clauses(gp.q, projections, shared)
        by_name = rowmod.section_names(projections)
        chosen = [
            by_name[h] for h in (rowmod.parse_path(r).head for r in requested)
            if h in by_name
        ]
        budget = min(gp.rows_limit, 1000)

        if chosen:
            cursor: tuple[int, int] | None = None
            if gp.rows_cursor and ":" in gp.rows_cursor and len(chosen) == 1:
                a, _, b = gp.rows_cursor.partition(":")
                if a.isdigit() and b.isdigit():
                    cursor = (int(a), int(b))
            # Split the page budget so N tables cost what one did. A reader
            # asking for three sections wants to see all three, not the first
            # one in full.
            per = max(1, budget // len(chosen))
            return [
                _one_table(source, proj, show, per, cursor, list(shared))
                for proj in chosen
            ]

        # ── Nothing named ────────────────────────────────────────────────
        #
        # **Which sections go on the wire is not the same question as which
        # pane opens.** They used to be one: absent a query, exactly one table
        # was built, so the docs pane — which is a *fold of the tables already
        # on the wire* and deliberately has no scope of its own — could only
        # ever show that one section. A document listing its observations and
        # nothing else is not a document view; it is the acts table grouped by
        # asset, wearing the docs pane's title.
        #
        # So: every section is built, and `choose_section` decides only which
        # one a *table pane* is named after (see `_graph_meta`). The acts keep
        # the full budget because that is the surface read line by line; the
        # rest are bounded, because the fold is an overview and `SECTION:` is
        # how a reader asks for one of them in full.
        acts = rowmod.choose_section(projections, None)
        if acts is None:
            return None
        cursor = None
        if gp.rows_cursor and ":" in gp.rows_cursor:
            a, _, b = gp.rows_cursor.partition(":")
            if a.isdigit() and b.isdigit():
                cursor = (int(a), int(b))
        tables = [_one_table(source, acts, show, budget, cursor, list(shared))]
        fold_per = max(1, min(_FOLD_ROWS_PER_SECTION, budget))
        tables += [
            _one_table(source, p, show, fold_per, None, [])
            for p in projections if p is not acts
        ]
        return tables
    except Exception:  # noqa: BLE001 — a table must never cost the canvas
        logger.warning("graph rows: could not build the table", exc_info=True)
        return None


def _one_table(source, proj, show, limit, cursor, notes) -> dict:
    """One section, projected. The unit a pane renders and is named after."""
    from app.api.modules.graph import rows as rowmod
    from app.api.modules.graph.stream import _node_id

    items, nxt, total, census = source.section_rows(proj, limit=limit, cursor=cursor)
    elements = [it["element"] for it in items]
    columns = rowmod.columns_for(proj, elements, show, census)
    section = rowmod.section_of(proj.path)

    packed = [
        {
            "id": f"{it['annotation_id']}:{section}:{it['ord']}",
            "annotationId": it["annotation_id"],
            "assetId": it["asset_id"],
            # **The node this row minted, when it minted one.**
            #
            # Without it a row could only be reached through its participants,
            # so selecting the ACT itself — a payment, a meeting — matched no
            # row and the table emptied with "Nothing in the selection touches
            # these rows". The row IS the act; not linking it to its own node
            # was the one link the whole two-surface design turns on.
            "nodeId": _row_node_id(proj, it),
            "cells": rowmod.cells_for(it["element"], columns, _node_id),
            "justification": rowmod._grounds(it["element"]),
        }
        for it in items
    ]
    if show:
        got = {c.key.lower() for c in columns}
        missing = [
            s for s in show
            if s.strip() != "*"
            and (rowmod.parse_path(s).segments[-1:] or [s])[0].lower() not in got
        ]
        if missing:
            # Per table, not shared: `SHOW:name` is a real column on interests
            # and no column at all on observations, and one note for both would
            # be wrong about one of them.
            notes = [*notes,
                     f"no column for: {', '.join(missing)} in {section}"]
    if nxt:
        notes = [*notes, f"showing {len(packed)} of {total} rows"]

    return rowmod.SectionRows(
        section=section, path=proj.path, columns=columns, items=packed,
        total=total, cursor_next=f"{nxt[0]}:{nxt[1]}" if nxt else None,
        notes=notes,
    ).as_dict()


def _row_node_id(proj, item: dict) -> str | None:
    """The occurrence node id this row produced, reproduced exactly.

    Mirrors ``AnnotationGraphSource._occurrence_name`` + ``_node_id``: a
    declared ``node_name`` when the row supplies one, else the positional
    address, and the type from ``node_type_path`` then ``node_type``. Computed
    rather than plumbed because the rows and the graph are two separate SQL
    passes — and if the two ever disagree, a click selects the wrong thing,
    which is worse than not linking at all. The mirror is the risk; a shared
    helper would be better and is a bigger change than this.
    """
    if getattr(proj, "about", None) != "self":
        return None
    from app.api.modules.graph.stream import _node_id

    el = item.get("element") or {}
    name = None
    if getattr(proj, "node_name", None):
        raw = el.get(proj.node_name)
        if isinstance(raw, str) and raw.strip():
            name = raw.strip()
    if name is None:
        name = f"{item['annotation_id']}:{proj.path}:{item['ord']}"

    declared = el.get(proj.node_type_path) if getattr(proj, "node_type_path", None) else None
    node_type = (
        (str(declared).strip() if isinstance(declared, str) and declared.strip() else None)
        or getattr(proj, "node_type", None)
        or ("Occurrence" if getattr(proj, "node_kind", "occurrence") != "entity"
            else "Entity")
    )
    return _node_id(name, node_type)


def _rows_clauses(
    q: str | None, projections: list, notes: list[str],
) -> tuple[list[str], list[str]]:
    """``SECTION:`` and ``SHOW:`` off the query string.

    An unresolvable section is **reported**, not silently ignored: the whole
    point of naming a section by its own word is that getting it wrong should
    say so, and an empty table under a name the analyst typed is the exact
    failure this grammar replaces.
    """
    if not q:
        return [], []
    from app.api.modules.graph.channels import parse_channels
    from app.api.modules.graph.rows import parse_path, section_names

    try:
        chans = parse_channels(q)
    except Exception:  # noqa: BLE001
        return [], []
    requested = [s.path for s in chans.selectors_for("SECTION") if s.path]
    show = [s.path for s in chans.selectors_for("SHOW") if s.path]
    known = set(section_names(projections))
    unknown = [r for r in requested if parse_path(r).head not in known]
    if unknown:
        notes.append(
            "no section called " + ", ".join(unknown)
            + " — this run has: " + ", ".join(sorted(known)),
        )
    return requested, show


def _graph_meta(fq, gp: "GraphParams", gr, tables: list[dict] | None = None) -> dict:
    """Resolved layers + frame coverage for one graph phase.

    Computed from the *same* source object the packer used, so what the panel
    displays and what the engine ran cannot drift — the failure this replaces
    was a configuration surface describing a projection set nobody had checked
    against the one in play.
    """
    from app.api.modules.graph.stream import frame_coverage

    layers: list[dict] = []
    # Bound in the try below and read again further down for the inferred
    # panes. Declared here so that read is an explicit `is None` check rather
    # than a NameError caught by a bare `except`.
    source: Any = None
    try:
        # `_graph_kwargs` carries the packer's caps too; `_graph_source` takes
        # only the configuration half. Filtered by the signature rather than by
        # a second hand-maintained list, which is what would drift.
        import inspect
        accepted = set(inspect.signature(fq._graph_source).parameters)
        source, _ = fq._graph_source(
            **{k: v for k, v in _graph_kwargs(gp).items() if k in accepted})
        source._resolve()
        node_counts: dict[str, int] = {}
        for n in gr.nodes:
            for path in (n.source_paths or []):
                node_counts[path] = node_counts.get(path, 0) + 1
        edge_counts: dict[str, int] = {}
        for e in gr.edges:
            for path in (getattr(e, "source_paths", None) or []):
                edge_counts[path] = edge_counts.get(path, 0) + 1

        for p in source.projections:
            bound = [k for k in ("node_type_path", "node_name", "time", "place",
                                 "activity", "weight", "evidence", "properties")
                     if getattr(p, k, None)]
            layers.append({
                "path": p.path,
                "about": p.about,
                "node_kind": p.node_kind,
                "roles": [r.label or r.path or "" for r in p.nodes],
                "bound": bound,
                "nodes": node_counts.get(p.path, 0),
                "edges": edge_counts.get(p.path, 0),
            })
    except Exception:  # noqa: BLE001 — meta is never worth failing a view over
        logger.warning("graph meta: could not resolve layers", exc_info=True)

    # What the engine decided and the query did not say. Every entry is a
    # choice a reader would otherwise have to reverse-engineer from the
    # picture: which size scale, which denominator, over which population, and
    # whether a bound frame had to be folded because three dimensions were
    # already spent. A refusal nobody is told about looks exactly like a bug.
    # **S1/S2: what the engine resolved in a way the writer may not have meant.**
    #
    # Separate from `legend`, which says what the engine DID. A note says what
    # it *could not do with what you wrote* — a reserved word colliding with a
    # field name, a section this run has never heard of. The panel renders these
    # amber; the legend renders neutral. Conflating them would make a warning
    # look like a setting.
    notes: list[str] = []
    try:
        from app.api.modules.graph.channels import (
            parse_channels, unresolved_sections,
        )
        from app.api.modules.graph.gql import parse as parse_gql
        from app.api.modules.graph.channels import unwired
        from app.api.modules.graph.stream import cluster_notes, size_notes
        notes.extend(parse_gql(gp.q or "").notes)
        notes.extend(size_notes())
        if gp.q:
            notes.extend(unwired(parse_channels(gp.q)))
        notes.extend(cluster_notes())
    except Exception:  # noqa: BLE001 — a note is never worth failing a view over
        logger.warning("graph meta: could not read query notes", exc_info=True)

    legend: list[str] = []
    try:
        from app.api.modules.graph.channels import (
            frames_spent, parse_channels, resolve_vector_fold,
        )
        from app.api.modules.graph.stream import cluster_legend, size_legend

        legend.extend(size_legend())
        legend.extend(cluster_legend(gr.nodes))
        chans = parse_channels(gp.q or "")
        # **The legend says what the engine DID.** `VECTOR:` printed
        # "vector: embed fold → z" — a confident sentence about a fold that
        # reaches no renderer — which is worse than silence, because silence is
        # ambiguous and a legend is a claim. The clause is reported as unwired
        # in `notes` instead; a channel that lands nothing describes nothing.
        if chans.unknown:
            legend.append("unrecognised clauses: " + ", ".join(chans.unknown))
    except Exception:  # noqa: BLE001 — meta is never worth failing a view over
        logger.warning("graph meta: could not resolve legend", exc_info=True)

    # **What an empty bar means.** The panes a contract's own declarations
    # imply, so a panel nobody has configured opens with the panes that make
    # sense for its schema rather than with nothing. An invisible default is a
    # magic layout; a stated one is a starting point — and because it resolves
    # through declared ROLES, a contract whose sections are called `motives`
    # and `exhibits` gets the same panes as one that says `interests` and
    # `evidence`, without either name appearing anywhere.
    defaults: list[dict] = []
    try:
        from app.api.modules.graph.channels import PRESETS_BY_NAME, infer_defaults
        from app.api.modules.graph.stream import _roles_by_path, types_by_role

        projections = list(getattr(source, "projections", None) or []) if source else []
        inferred = infer_defaults(projections)
        panel = inferred.get("PANEL")
        if panel:
            # **A pane needs a selector, not just a name.** Emitting bare names
            # left every pane folding the whole node set, so "Interests" listed
            # everything with a count nobody could identify. The preset says
            # which declared ROLE it is about; this turns that into the entity
            # types those sections actually produced, so the scope is a real
            # filter and still contains no noun.
            #
            # Read from the **declarations**, not from `gr.nodes`. The assembled
            # graph is whatever the current query left, so deriving scopes from
            # it made them collapse the moment someone narrowed: a query for
            # `SECTION:places` produced a graph of Locations, every other pane
            # therefore resolved to no type, and Observations and Interests both
            # silently reverted to listing everything. A pane's scope is a
            # property of the contract and must not move when the filter does.
            # **Scope by SECTION, not by guessed type.**
            #
            # A claim section mints an OCCURRENCE and its fields' entity types
            # are the *participants* — so scoping Observations by type produced
            # `type:"Location","Person","Evidence"`, which is the cast rather
            # than the acts. The section's own name is exact, is what the
            # analyst would write, and is tier 1: the scan for every other
            # projection never happens.
            #
            # `kind:` then separates the act from the people in it, which is
            # the one distinction a section name cannot carry.
            by_role: dict[str, list[str]] = {}
            mints_acts: dict[str, bool] = {}
            for p in getattr(source, "projections", None) or []:
                role = (getattr(p, "role", None) or "").strip().lower()
                path = getattr(p, "path", "") or ""
                if not role or not path:
                    continue
                section = path.rsplit(".", 1)[-1].removesuffix("[*]")
                by_role.setdefault(role, []).append(section)
                # `about: self` is the declaration that says a row IS a thing
                # that happened — the one field in the model that decides act
                # versus property versus relation. `node_kind` defaults to
                # "occurrence" whether or not anyone declared it, so trusting
                # it put `kind:occurrence` on the Places and Interests panes,
                # which are rosters of entities and came back empty.
                # …and an explicit `node_kind: entity` overrides it. `evidence`
                # is `about: self` — an exhibit is a thing in its own right —
                # while still being an ENTITY, because an exhibit persists and
                # recurs rather than happening. Both halves of the declaration
                # have to be read or the Evidence pane asks for occurrences
                # that were never minted and comes back empty.
                mints = (
                    getattr(p, "about", None) == "self"
                    and getattr(p, "node_kind", "occurrence") != "entity"
                )
                mints_acts[role] = mints_acts.get(role, False) or mints

            # **A table pane is named after the section it shows.** `rows` is
            # what the binding is called, not what the pane is: a pane titled
            # "rows" sitting above a list of interests is a label that tells the
            # reader nothing they could not already see, and with two sections
            # open it tells them nothing about which is which.
            named = tables if tables is not None else (_graph_rows(fq, gp) or [])
            # **A pane is a layout decision; the tables on the wire are a data
            # one.** Absent a `SECTION:`, every section is now built so the docs
            # fold is complete — but opening a pane per section would turn an
            # unconfigured panel into eight stacked tables. One pane, the acts,
            # which is what `choose_section` is for; naming sections opens one
            # pane each, because then the reader asked for them.
            if _rows_clauses(gp.q, projections, [])[0]:
                pane_tables = named
            else:
                pane_tables = named[:1]
            for sel in panel.selectors:
                if sel.path == "rows":
                    for t in pane_tables:
                        defaults.append({
                            "name": t["section"],
                            "q": f"SECTION:{t['section']}",
                            "kind": "table",
                        })
                    continue
                preset = PRESETS_BY_NAME.get(sel.path)
                if preset and preset.kind == "docs":
                    # A fold of the tables already on the wire — it needs no
                    # scope of its own, and giving it one would let it disagree
                    # with the tables it is folding.
                    defaults.append({"name": "docs", "q": "", "kind": "docs"})
                    continue
                parts: list[str] = []
                if preset and preset.role:
                    sections = by_role.get(preset.role) or []
                    if sections:
                        parts.append("SECTION:" + ",".join(sections))
                        if mints_acts.get(preset.role):
                            parts.append("kind:occurrence")
                if preset and preset.name == "places":
                    parts.append("BY place")
                elif preset and preset.name == "clusters":
                    parts.append("BY type")
                defaults.append({
                    "name": sel.path,
                    "q": " ".join(parts),
                    "kind": preset.kind if preset else None,
                })
    except Exception:  # noqa: BLE001 — a panel must render without them
        logger.warning("graph meta: could not infer panes", exc_info=True)

    return {
        "layers": layers,
        "frames": frame_coverage(gr.nodes, gr.edges),
        "legend": legend,
        "notes": notes,
        "panes": defaults,
        "index": _graph_index(source, gr),
    }


def _graph_index(source: Any, gr) -> dict:
    """Everything this run is addressable BY, at every level.

    One structure so the bar can complete, the ✨ prompt can enumerate and the
    resolution ladder can be *shown* — three surfaces that were each guessing
    separately, which is how `CLUSTER:Location` came to mean nothing while
    looking like it should mean something obvious.

    The ladder a bare word walks, and the order is the answer to "what did you
    think I meant":

    .. code-block:: text

        type · kind · role · place · section     a reserved key
        <section>.<field>                        the row's own column
        Location · Interest                      an entity TYPE — the neighbour
        places · interests                       a SECTION — the types it minted
        anything else                            a property on the node

    Read off the **assembled graph** rather than the contract, because that is
    what a completion has to be true of: offering `Location` on a run whose
    query has already excluded every place is a suggestion that returns nothing.
    """
    from app.api.modules.graph.rows import columns_for, section_of

    out: dict[str, Any] = {
        "sections": {}, "types": [], "roles": [], "predicates": [], "properties": [],
    }
    try:
        for p in getattr(source, "projections", None) or ():
            name = section_of(getattr(p, "path", "") or "")
            if name:
                out["sections"][name] = [
                    {"key": c.key, "label": c.label, "kind": c.kind,
                     "ref": c.ref, "source": c.source}
                    for c in columns_for(p, [])
                ]
        types, roles, props = set(), set(), set()
        for n in gr.nodes:
            t = (n.node_type or n.type or "").strip()
            if t:
                types.add(t)
            roles.update(n.roles or ())
            props.update((n.properties or {}).keys())
        out["types"] = sorted(types)
        out["roles"] = sorted(roles)
        out["properties"] = sorted(props)
        out["predicates"] = sorted({
            e.predicate for e in gr.edges if getattr(e, "predicate", None)
        })
    except Exception:  # noqa: BLE001 — an index is never worth failing a view over
        logger.warning("graph meta: could not build the index", exc_info=True)
    return out


def _effective_q(body: "ViewRequest") -> str | None:
    """The query this request runs, wherever the client put it.

    One reader, so the panel-level field and the graph-phase one cannot be
    consulted in different orders by different call sites — which is how a
    panel ends up drawing one query and reporting another.
    """
    if body.q:
        return body.q
    return (body.graph.q if body.graph else None) or None


def _graph_kwargs(gp: "GraphParams") -> dict:
    """Every :class:`GraphParams` knob, as packer kwargs.

    One helper so the JSON and SSE endpoints configure the graph from the
    *same* fields. They used to diverge: the SSE path built its source by hand
    and dropped ``projections`` and ``q`` on the floor, while the JSON path
    ignored the aggregation knobs. Same body, two different graphs.
    """
    return {
        "projections": list(gp.projections),
        "triplet_field": gp.triplet_field,
        "q": gp.q,
        "dedup": gp.dedup,
        "top_n_nodes": gp.top_n_nodes,
        "top_n_edges": gp.top_n_edges,
        "edge_weight_field": gp.edge_weight_field,
        "edge_weight_mode": gp.edge_weight_mode,
        "forward_properties": list(gp.forward_properties or []),
        "node_group_by": gp.node_group_by,
        "edge_group_by": gp.edge_group_by,
        "null_policy": gp.null_policy,
        "doc_place": gp.doc_place,
        "doc_time": gp.doc_time,
    }


def _validated_view_body(body: ViewRequest) -> ViewRequest:
    """Body-level validation run pre-generator.

    Ensures the 400 returns as a JSON response, not as an SSE error event.
    HTTPException raised inside an async-generator route is too late —
    FastAPI's SSE pipeline has already started streaming.
    """
    if body.rows is None and body.aggregate is None and body.graph is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of rows, aggregate, or graph must be specified",
        )
    return body


@router.post("/{run_id}/view")
async def view_run(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: ViewRequest = Depends(_validated_view_body),
):
    """Composable analysis view for a run (JSON).

    Send any combination of ``rows``, ``aggregate``, and ``graph`` configs
    in the request body. Returns all requested phases as a single JSON
    object. For a progressive SSE feed call ``POST /view/stream``.
    """
    result = await asyncio.to_thread(_build_view_phases, session, access, run_id, body)
    return {k: v.model_dump() for k, v in result.items()}


@router.post("/{run_id}/view/stream", response_class=EventSourceResponse)
async def view_run_stream(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: ViewRequest = Depends(_validated_view_body),
):
    """Progressive SSE stream of the composable analysis view.

    Wire protocol:

    - ``rows`` — single event with the paginated row page
    - ``aggregate`` — single event with buckets
    - ``graph_chunk`` — one per chunk; frontends that want progressive
      rendering accumulate these
    - ``graph`` — final single event carrying the full (bounded) graph, so
      clients that only listen for ``graph`` still get a correct answer

    Rows and aggregate run inside ``to_thread`` because the underlying
    ``AnnotationQuery`` methods do sync DB I/O. Graph iterates in pure
    async over ``FormulaQuery.graph_stream_view`` — its sync session reads
    happen inline but ``async for`` yields control on each chunk, so
    keepalives and peer backpressure work correctly.

    The graph phase goes through the **same** ``_graph_kwargs`` +
    ``FormulaQuery`` path as ``POST /view``. Do not reach past it into
    ``AnnotationQuery.graph_stream``: that is how this endpoint previously
    came to drop ``projections`` and ``q`` silently.
    """
    try:
        fq = _build_formula_query(session, access, run_id, body)

        # rows — sync, one event
        if body.rows is not None:
            rows_payload = await asyncio.to_thread(
                fq.rows_view,
                fields=body.fields,
                cursor=body.rows.cursor,
                limit=body.rows.limit,
                include_failed=body.rows.include_failed,
            )
            yield ServerSentEvent(data=rows_payload.model_dump(), event="rows")

        # aggregate — sync, one event (OutputRelation wire shape)
        if body.aggregate is not None:
            rel = await asyncio.to_thread(fq.aggregate_view)
            yield ServerSentEvent(data=rel.model_dump(), event="aggregate")

        # graph — chunks, then a final full payload. Same packer the JSON
        # endpoint uses (``_graph_kwargs`` + ``FormulaQuery``), so the two
        # cannot return different graphs for the same body.
        if body.graph is not None:
            accumulated_nodes: list[dict] = []
            accumulated_edges: list[dict] = []
            async for chunk in fq.graph_stream_view(
                chunk_size=body.graph.chunk_size, **_graph_kwargs(body.graph),
            ):
                chunk_nodes = [_node_to_dict(n) for n in chunk.nodes]
                chunk_edges = [_edge_to_dict(e) for e in chunk.edges]
                yield ServerSentEvent(
                    data={"nodes": chunk_nodes, "edges": chunk_edges},
                    event="graph_chunk",
                )
                accumulated_nodes.extend(chunk_nodes)
                accumulated_edges.extend(chunk_edges)

            yield ServerSentEvent(
                data={"nodes": accumulated_nodes, "edges": accumulated_edges},
                event="graph",
            )

    except HTTPException as he:
        yield ServerSentEvent(data=SSEError(detail=str(he.detail)), event="error")
        return
    except Exception as e:
        logger.exception("SSE view error")
        yield ServerSentEvent(data=SSEError(detail=str(e)), event="error")
        return


# ─── Distinct values — backing endpoint for the Value Alias manager ────────


class DistinctValuesRequest(BaseModel):
    """Request shape for ``POST /runs/{run_id}/distinct_values``."""

    field_path: str
    search: str | None = None
    limit: int = 100
    filters: FilterSet | None = None
    merge_maps: list[MergeMap] = []
    schema_ids: list[int] = []
    asset_ids: list[int] = []
    additional_run_ids: list[int] = []


class DistinctValuesResponse(BaseModel):
    """Response shape for distinct-values queries."""

    field_path: str
    items: list[DistinctValueEntry]
    truncated: bool


@router.post("/{run_id}/distinct_values", response_model=DistinctValuesResponse)
async def distinct_values(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: DistinctValuesRequest,
):
    """Distinct values for a field path within a run, with optional search.

    Powers the panel Value Alias manager. Server-side ILIKE prefix filter
    keeps the scan bounded even on high-cardinality fields at 5M-annotation
    scale. Applies any provided ``merge_maps`` so aliased buckets appear
    pre-normalized.
    """
    explicit_ids = [run_id] + body.additional_run_ids
    for rid in explicit_ids:
        access.require_in_scope("run_ids", rid)

    def _run() -> DistinctValuesResponse:
        rolled: list[int] = []
        seen: set[int] = set()
        for rid in explicit_ids:
            for fid in _resolve_family(session, access.infospace_id, rid):
                if fid not in seen:
                    seen.add(fid)
                    rolled.append(fid)
        aq = (
            AnnotationQuery(session, access.infospace_id)
            .scope(access.scope)
            .runs(rolled)
        )
        if body.schema_ids:
            aq.schemas(body.schema_ids)
        if body.asset_ids:
            aq.assets(body.asset_ids)
        if body.filters:
            aq.filter(body.filters)
        for mm in body.merge_maps:
            aq.merge(mm)
        limit = min(max(1, body.limit), 1000)
        items = aq.distinct_values(
            body.field_path,
            search=body.search,
            limit=limit,
        )
        return DistinctValuesResponse(
            field_path=body.field_path,
            items=items,
            truncated=len(items) >= limit,
        )

    return await asyncio.to_thread(_run)


# Row/asset/node/edge dict helpers moved to formula_query.py — single
# source of truth for the wire shapes those phase responses emit.


# ─── Canon binding preflight ─────────────────────────────────────────────
#
# Canon injection changes every prompt of a run: the type vocabulary the model
# may use, and the property slots it is asked to fill. Both are cheap in tokens
# — entity *names* are deliberately never injected (see
# `contract_resolution`) — so this is an inspection surface first and a cost
# guard second: what will this binding actually do, and did any of it land
# nowhere? Same resolution path the task will run, no run required, nothing
# written.


# ─── The graph query context packet ──────────────────────────────────────────


class GraphContextResponse(BaseModel):
    """What a writer — human or model — needs to write a query for THIS run.

    Three tiers, and the split is an engineering fact rather than a design
    principle: the fixed half is identical across every run and belongs in a
    cached prompt prefix; the declared half is small and per-run.

    * **A · fixed** — the algebra and the gotchas, generated from ``TOKENS``
      and the channel table. The same for every run, forever.
    * **B · declared** — this schema's own declarations, *rendered*. Not a
      vocabulary list assembled alongside the engine (which goes stale the
      moment a schema declares something new) but the same ``sections.py`` +
      ``derive_projections`` output the engine itself reads, so it is
      structurally unable to drift.
    * **C · instantiated** — read off the assembled graph. Roster contents,
      type counts, the time window, and **fill density**.

    Tier C is the one that is easy to think optional and is not. A declaration
    teaches that a slot exists; a filled row teaches multi-word-ness, casing,
    quoting — and whether anyone fills it at all. ``role:via degree>20`` against
    a corpus where ``via`` is populated in 12% of rows returns almost nothing,
    and the writer should know that *before* writing it, not after the panel
    comes back empty.
    """

    grammar: str
    """Tier A. The filter and channel halves, generated."""
    declared: Dict[str, Any]
    """Tier B. Sections with their roles, frames and declared axes."""
    instantiated: Dict[str, Any]
    """Tier C. Roster contents, counts, window, fill density, sample rows."""


class GraphValidateRequest(BaseModel):
    q: str


class GraphValidateResponse(BaseModel):
    """Why a query might not answer what was asked.

    Two failure modes, kept apart because they have different fixes:

    * ``unknown`` — a **fixed-half** miss. ``sector:finance`` is not a prefix,
      so it silently became a free-text substring match on node names and
      returned something plausible. Right for a half-typed human, dangerous for
      a model.
    * ``empty_risk`` — a **declared-half** miss. ``serves:opacity`` parses
      perfectly and this run has no interest by that name. This is the one that
      fires constantly in early testing and is the whole payoff of tier B.

    Both render as amber pills rather than red errors: the query still runs,
    and the reading is still a reading.
    """

    parsed: list[Dict[str, Any]]
    unknown: list[Dict[str, Any]]
    empty_risk: list[Dict[str, Any]]


def _declared_types_by_role(source: Any) -> dict[str, list[str]]:
    """``declared layout role -> the entity types its sections DECLARE``.

    From the contract, so it is a fixed property of the run rather than of
    whatever the current query happened to leave standing. A section's entity
    types are the `x-entityType` values on the fields inside it, which is the
    same thing `resolve_contract` closes an enum against.
    """
    out: dict[str, list[str]] = {}
    try:
        smap = source._schema_map()
    except Exception:  # noqa: BLE001 — a panel renders without scopes
        return out
    if smap is None:
        return out

    for p in getattr(source, "projections", None) or ():
        role = getattr(p, "role", None)
        path = getattr(p, "path", "") or ""
        if not role or not path:
            continue
        stem = path.replace("[*]", "")
        seen = out.setdefault(str(role).strip().lower(), [])
        for f in smap.fields:
            if not f.entity_type or not f.path.startswith(stem):
                continue
            if f.entity_type not in seen:
                seen.append(f.entity_type)
    return {k: v for k, v in out.items() if v}


def _graph_vocabulary(session, access, run_id: int) -> dict[str, Any]:
    """Declared + instantiated value spaces for one run.

    Enumerable spaces come back in full; node names do not, because there are
    as many of them as there are nodes. Returning a shape for those — a count
    and a sample — is what makes a writer reach for a substring rather than
    guess at an exact ``label==``.
    """
    from app.api.modules.annotation.panel_config import derive_projections
    from app.api.modules.annotation.schema_map import schema_map_for
    from app.api.modules.annotation.models import AnnotationSchema

    run = session.get(AnnotationRun, run_id)
    out: dict[str, Any] = {"sections": [], "entity_types": [], "roles": []}
    if run is None:
        return out

    for schema in (run.target_schemas or []):
        try:
            smap = schema_map_for(schema.output_contract)
        except Exception:  # noqa: BLE001 — a packet must not fail a panel
            continue
        for p in derive_projections(smap) or ():
            path = getattr(p, "path", "") or ""
            out["sections"].append({
                "path": path,
                "section": path.rsplit(".", 1)[-1].removesuffix("[*]"),
                "role": getattr(p, "role", None),
                "frame": getattr(p, "frame", None),
                "roles": sorted(getattr(p, "roles", None) or []),
            })
        for f in smap.fields:
            if f.entity_type and f.entity_type not in out["entity_types"]:
                out["entity_types"].append(f.entity_type)
    return out


@router.get("/{run_id}/graph/context", response_model=GraphContextResponse)
async def graph_context(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
):
    """Everything a writer needs to produce a query that answers something."""
    access.require_in_scope("run_ids", run_id)

    def _run() -> GraphContextResponse:
        from app.api.modules.graph import channels as ch_mod
        from app.api.modules.graph import gql as gql_mod

        grammar = "\n\n".join(
            filter(None, [gql_mod.grammar_block(), ch_mod.grammar_block()])
        )
        declared = _graph_vocabulary(session, access, run_id)

        instantiated: dict[str, Any] = {}
        try:
            # Same boundary the view endpoints use, so the packet describes the
            # graph a query would actually run against rather than a second
            # assembly that could differ.
            #
            # `formula` is required and is the *data scope*, not the shape —
            # an empty one means "this run, unfiltered", which is exactly what
            # a context packet should describe. Omitting it raised a validation
            # error that the surrounding `except` swallowed, so tier C came back
            # empty and the writer was left guessing at predicates and interest
            # names — the one thing tier C exists to prevent.
            probe = ViewRequest(
                formula=Formula(id="graph-context", name="graph context"),
                graph=GraphParams(top_n_nodes=400, top_n_edges=1200),
            )
            fq = _build_formula_query(session, access, run_id, probe)
            result = fq.graph_view(**_graph_kwargs(probe.graph))
            types: dict[str, int] = {}
            interests: list[str] = []
            names: list[str] = []
            for n in result.nodes:
                t = (n.type or "").strip()
                if t:
                    types[t] = types.get(t, 0) + 1
                if t.lower() == "interest" and n.name not in interests:
                    interests.append(n.name)
                if len(names) < 25:
                    names.append(n.name)
            preds: dict[str, int] = {}
            roles: dict[str, int] = {}
            for e in result.edges:
                p = (e.predicate or "").strip()
                if p:
                    preds[p] = preds.get(p, 0) + 1
                r = (getattr(e, "role", None) or "").strip()
                if r:
                    roles[r] = roles.get(r, 0) + 1
            stamps = [n.t0 for n in result.nodes if n.t0]
            instantiated = {
                "node_count": len(result.nodes),
                "edge_count": len(result.edges),
                "entity_types": types,
                "predicates": preds,
                # Fill density, as a count per role: `via` at 12 out of 340
                # edges is the difference between a good query and an empty
                # panel, and no schema can show it.
                "role_fill": roles,
                # Enumerable — returned whole, because a writer guessing at an
                # interest name is the single most common way a query comes
                # back empty.
                "interests": sorted(interests),
                # Not enumerable. A shape instead, so the reader reaches for a
                # substring rather than inventing an exact name.
                "names": {"count": len(result.nodes), "sample": names},
                "window": {
                    "from": min(stamps) if stamps else None,
                    "to": max(stamps) if stamps else None,
                },
            }
        except Exception:  # noqa: BLE001 — tiers A and B are still useful
            logger.warning("graph context: could not instantiate", exc_info=True)

        return GraphContextResponse(
            grammar=grammar, declared=declared, instantiated=instantiated,
        )

    return await asyncio.to_thread(_run)


@router.post("/{run_id}/graph/validate", response_model=GraphValidateResponse)
async def graph_validate(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: GraphValidateRequest,
):
    """Re-parse a query and report what this run cannot answer."""
    access.require_in_scope("run_ids", run_id)

    def _run() -> GraphValidateResponse:
        from app.api.modules.graph import channels as ch_mod
        from app.api.modules.graph import gql as gql_mod

        chans = ch_mod.parse_channels(body.q or "")
        parsed_q = gql_mod.parse(chans.rest)

        parsed: list[dict[str, Any]] = []
        unknown: list[dict[str, Any]] = []
        empty_risk: list[dict[str, Any]] = []

        for clause in chans.unknown:
            unknown.append({
                "token": clause,
                "why": f"`{clause.split(':', 1)[0]}` is not a channel — "
                       "it was reported rather than treated as free text.",
                "did_you_mean": [c.name for c in ch_mod.CHANNELS][:6],
            })

        for b in chans.bindings:
            parsed.append({"token": b.render(), "tier": 2, "ok": True})

        # Free text is the fixed-half miss: a mistyped prefix lands here and
        # silently becomes a substring search on node names.
        if parsed_q.text:
            unknown.append({
                "token": parsed_q.text,
                "why": "no prefix matched — this became a free-text substring "
                       "match on node names, which usually returns something "
                       "and rarely returns the answer.",
                "did_you_mean": [t.token for t in gql_mod.TOKENS if t.prefix][:6],
            })

        vocab = _graph_vocabulary(session, access, run_id)
        known_types = {t.lower() for t in vocab.get("entity_types", [])}
        for t in parsed_q.types:
            parsed.append({"token": f"type:{t}", "tier": 2, "ok": True})
            if known_types and t.lower() not in known_types:
                empty_risk.append({
                    "token": f"type:{t}",
                    "why": f"no entity type named `{t}` is declared by this "
                           "run's schemas.",
                    "did_you_mean": sorted(vocab.get("entity_types", []))[:6],
                })

        for c in parsed_q.shape_conditions:
            parsed.append({"token": f"{c.key}{c.op}{c.value}", "tier": 2, "ok": True})
        for c in parsed_q.row_conditions:
            parsed.append({"token": f"{c.key}{c.op}{c.value}", "tier": 1, "ok": True})
        for s in parsed_q.serves:
            parsed.append({"token": f"serves:{s}", "tier": 2, "ok": True})
        if parsed_q.seeds:
            parsed.append({"token": "from:", "tier": 3, "ok": True})

        return GraphValidateResponse(
            parsed=parsed, unknown=unknown, empty_risk=empty_risk,
        )

    return await asyncio.to_thread(_run)


class GraphAssistRequest(BaseModel):
    prose: str


class GraphAssistResponse(BaseModel):
    q: str


#: What the writer is told before it writes. The gotchas ride in the generated
#: grammar; this is only the contract for the reply.
_ASSIST_SYSTEM = """\
You write graph query strings for an analysis panel. Reply with the query and \
nothing else — no explanation, no code fence, no leading verb.

Rules that decide whether the query answers the question:

* Use ONLY the tokens in the grammar below. An unrecognised token silently \
  becomes a substring match on node names and returns something plausible and \
  wrong, so inventing one is worse than omitting it.
* Use ONLY values that appear in the run's instantiated vocabulary. Interests \
  and entity types are listed in full; if the value you want is not there, the \
  run cannot answer that question and a narrower query is the honest reply.
* Interest names are usually multi-word. Quote them: serves:"port access"+
* If the question is about alignment WITHOUT contact, that is two tokens — \
  converge> for the affinity and contact> for the distance. Neither alone \
  says it. Use `contact>1`, which means "not directly connected": two actors \
  who share an interest are exactly TWO hops apart *through the interest node \
  itself*, so `contact>2` excludes the very pairs the question is about.
* Prefer fewer tokens. A query that returns too much is readable; one that \
  returns nothing teaches the analyst that the panel is broken.

**Never nest a filter inside a channel.** A channel takes a *path* — a section \
name, `docs`, or `any` — never another clause. `CONNECT:field:document.places[*]` \
is not a thing; it is `CONNECT:places`, or more often nothing at all, because \
everything is connected by default and `CONNECT:` only says so redundantly. \
Reach for `DISCONNECT:` when a dense layer should come off the canvas.

**`PANEL:` names a pane; it does not filter.** `PANEL:interests` opens a pane \
already scoped to interests — do not also add a filter for them, because a \
filter narrows the CANVAS and the question was about a pane. If the canvas \
should narrow too, say so with a filter and mean it.

**`serves:` runs one way; traversal runs the other.** This is the pair of \
forms most questions about the why-axis need, and reaching for the wrong one \
returns nothing:

    who serves X            serves:"X"
    what does X serve       from:"X" hops:1 type:Interest
    where does X converge   serves:"X" type:Location
    what X routes through   from:"X" hops:1 role:via

Separate `serves:` tokens **union**. Listing three interests asks for anyone \
serving any of them, which is almost never the question — if you do not know \
which interest, traverse from the actor instead of guessing names.
"""


@router.post("/{run_id}/graph/assist", response_model=GraphAssistResponse)
async def graph_assist(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: GraphAssistRequest,
):
    """Prose → a proposed query.

    Returns a string for the **draft**. Nothing here applies it: the writer
    proposes and only a person commits, which is the difference between an
    assistant and a panel that changes under you.
    """
    access.require_in_scope("run_ids", run_id)

    packet = await graph_context(run_id=run_id, access=access, session=session)

    from app.api.modules.foundation_service_providers import (
        ProviderError, get_configured_foundation_provider, resolve,
    )

    # **The user's own language settings, through the normal cascade.**
    #
    # `context="chat"` because this is an interactive request made on someone's
    # behalf, not a batch annotation — so it honours the `chat` override in
    # `LanguageDefaults` before falling back to `default`, which is exactly
    # what a person configuring "the model I talk to" expects it to mean.
    # (An unrecognised context is not an error here: `LanguageDefaults.resolve`
    # falls through to `default`, so a wrong string silently ignores the
    # override rather than failing. That is why this one has to be right.)
    #
    # The cascade itself is `resolve`'s: infospace `enrichment_config` → the
    # owner's `provider_defaults` → deployment default. Nothing is hardcoded
    # here, which matters for a deployment running self-hosted models where a
    # guessed provider name simply does not exist.
    configured = get_configured_foundation_provider(
        session, access.infospace_id, "language", context="chat",
    )
    try:
        provider = resolve(
            "language",
            configured.provider_key if configured else None,
            configured.model_name if configured else None,
            infospace_id=access.infospace_id,
            context="chat",
            session=session,
        )
    except ProviderError as e:
        # Actionable, because the fix is a setting rather than a retry.
        raise HTTPException(
            status_code=400,
            detail=(
                f"No language model available for this infospace: {e}. "
                "Set one under the infospace's providers, or in your own "
                "defaults."
            ),
        ) from e

    context_block = json.dumps(
        {"declared": packet.declared, "instantiated": packet.instantiated},
        ensure_ascii=False, default=str,
    )[:12000]

    response = await provider.generate(
        messages=[
            {"role": "system",
             "content": f"{_ASSIST_SYSTEM}\n\nGRAMMAR\n{packet.grammar}"},
            {"role": "user",
             "content": f"THIS RUN\n{context_block}\n\nQUESTION\n{body.prose}"},
        ],
        model_name=provider.model,
    )
    # `content`, which is what `GenerationResponse` actually calls it. A
    # wrong attribute name here fails silently — `getattr` returns None, the
    # bar gets an empty draft, and it reads as "the model had nothing to say".
    text = (getattr(response, "content", None) or "").strip()
    # Models fence things. Strip it rather than handing a bar a line of
    # backticks that will parse as free text.
    if text.startswith("```"):
        text = text.strip("`").split("\n", 1)[-1].rsplit("```", 1)[0].strip()
    return GraphAssistResponse(q=text.splitlines()[0].strip() if text else "")


class PreviewBindingsRequest(BaseModel):
    """What a prospective run would inject. Deliberately run-less so the launch
    dialog and the companion can both ask before committing."""

    schema_ids: list[int]
    canon_bindings: Dict[str, Any] = Field(default_factory=dict)
    canon_ids: list[int] = Field(default_factory=list)
    asset_count: Optional[int] = Field(
        default=None,
        description="Assets the run would cover; enables a total projection.",
    )


class SchemaBindingPreview(BaseModel):
    schema_id: int
    schema_name: str
    fields: list[FieldInjection] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    est_tokens_per_asset: int = 0


class PreviewBindingsResponse(BaseModel):
    schemas: list[SchemaBindingPreview] = Field(default_factory=list)
    injected_types: int = 0
    injected_properties: int = 0
    est_tokens_per_asset: int = 0
    projected_total_tokens: Optional[int] = None
    blocking: bool = Field(
        default=False,
        description="A type list large enough to suggest an uncurated canon — "
                    "the UI should ask for an explicit acknowledgement.",
    )
    summary: str = ""
    warnings: list[str] = Field(default_factory=list)


def _binding_summary(resp: PreviewBindingsResponse, asset_count: Optional[int]) -> str:
    if not resp.est_tokens_per_asset:
        return "No canon vocabulary is injected — prompts are unchanged."
    parts = []
    if resp.injected_types:
        parts.append(f"{resp.injected_types} entity type{'s' if resp.injected_types != 1 else ''}")
    if resp.injected_properties:
        parts.append(
            f"{resp.injected_properties} property slot"
            f"{'s' if resp.injected_properties != 1 else ''}"
        )
    what = " and ".join(parts) or "canon vocabulary"
    out = f"This run adds {what} to every prompt (≈{resp.est_tokens_per_asset:,} tokens/asset"
    if asset_count and resp.projected_total_tokens:
        out += f" × {asset_count:,} assets ≈ {resp.projected_total_tokens:,} tokens"
    return out + ")."


@router.post("/preview-bindings", response_model=PreviewBindingsResponse)
async def preview_bindings(
    *,
    access: Access = Requires(scope=None),
    session: SessionDep,
    body: PreviewBindingsRequest,
):
    """Resolve a prospective run's canon bindings and report what they cost.

    Runs the *same* ``resolve_for_run`` the annotate task will run, so the
    number shown is the number charged — no parallel estimator to drift. Creates
    nothing and dispatches nothing.
    """
    def _run() -> PreviewBindingsResponse:
        from app.api.modules.annotation.contract_resolution import (
            TYPES_COST_WARN,
            resolve_for_run,
        )
        from app.api.modules.annotation.schema_map import (
            SchemaRefCycleError,
            schema_map_for,
        )

        infospace = session.get(Infospace, access.infospace_id)
        default_canon_id = getattr(infospace, "default_canon_id", None)

        previews: list[SchemaBindingPreview] = []
        all_warnings: list[str] = []

        for sid in body.schema_ids:
            schema = session.get(AnnotationSchema, sid)
            if not schema or schema.infospace_id != access.infospace_id:
                all_warnings.append(f"schema {sid}: not found in this infospace")
                continue
            try:
                smap = schema_map_for(schema.output_contract)
            except SchemaRefCycleError as e:
                all_warnings.append(f"schema {sid}: cyclic x-ref ({e})")
                continue
            _contract, report = resolve_for_run(
                session, schema.output_contract, smap,
                run_bindings=body.canon_bindings,
                run_canon_ids=body.canon_ids,
                default_canon_id=default_canon_id,
            )
            previews.append(SchemaBindingPreview(
                schema_id=sid,
                schema_name=schema.name,
                fields=list(report.fields),
                warnings=list(report.warnings),
                est_tokens_per_asset=report.est_tokens_per_asset,
            ))
            all_warnings.extend(f"{schema.name}: {w}" for w in report.warnings)

        resp = PreviewBindingsResponse(
            schemas=previews,
            injected_types=sum(len(f.types) for p in previews for f in p.fields),
            injected_properties=sum(len(f.properties) for p in previews for f in p.fields),
            est_tokens_per_asset=sum(p.est_tokens_per_asset for p in previews),
            warnings=all_warnings,
        )
        if body.asset_count and resp.est_tokens_per_asset:
            resp.projected_total_tokens = resp.est_tokens_per_asset * body.asset_count
        resp.blocking = resp.injected_types > TYPES_COST_WARN
        resp.summary = _binding_summary(resp, body.asset_count)
        return resp

    return await asyncio.to_thread(_run)


# ─── User-initiated actions ──────────────────────────────────────────────
#
# First instance of the @task(params_model=...) composition pattern. The
# route resolves scoped annotation ids, builds typed params, dispatches,
# and returns {task_id, watch_url}. All subsequent actions (translation,
# sentiment recalibration, ...) follow the exact same shape.

from app.api.modules.annotation.schemas import GeocodeActionRequest, GeocodeParams
from app.api.modules.annotation.tasks.geocode import geocode as geocode_task
from app.api.modules.content.schemas import ActionAcceptedResponse


@router.post("/{run_id}/action/geocode", response_model=ActionAcceptedResponse)
def kick_geocode(
    *,
    run_id: int,
    body: GeocodeActionRequest,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    session: SessionDep,
) -> ActionAcceptedResponse:
    """Kick a geocoding action on this run.

    Resolves scoped annotation ids, dispatches the ``geocode`` @task with
    typed ``GeocodeParams``. Returns the task_id and the existing
    ``/stream`` watch_url. The frontend subscribes on that URL to receive
    live ``resolved`` markers as the geocoder fills in each location.

    No DB migration, no GeocodingJob. Results land on
    ``CanonEntry.properties['coords']``.
    """
    access.require_in_scope("run_ids", run_id)

    aq = AnnotationQuery(session, access.infospace_id).scope(access.scope).runs([run_id])
    if body.annotation_ids:
        aq = aq.assets(body.annotation_ids)
    page = aq.paginate(limit=500).results()
    resolved_ids = [r.annotation_id for r in page.items]

    # Diagnostic — when the dispatched task instantly bails with 0
    # annotation_ids the user has no way to see why, so log enough
    # context to tell scope-filtering apart from a genuinely empty run.
    logger.info(
        "kick_geocode: run=%s field_path=%r resolved_ids_count=%s body_ids=%s scope=%s",
        run_id,
        body.field_path,
        len(resolved_ids),
        len(body.annotation_ids or []),
        access.scope,
    )

    params = GeocodeParams(
        run_id=run_id,
        field_path=body.field_path,
        annotation_ids=resolved_ids,
    )
    result = geocode_task.delay(resolved_ids, access.infospace_id, params=params)

    watch_url = (
        f"/infospaces/{access.infospace_id}/stream/annotation.geocoding/"
        f"{run_id}:{result.id}"
    )
    return ActionAcceptedResponse(task_id=result.id, watch_url=watch_url)


class GeocodedEntityOut(BaseModel):
    """One already-resolved location, sourced from CanonEntry.properties."""
    entity_id: int
    name: str
    coords: list[float]  # [lon, lat]
    display_name: str | None = None
    bbox: list[float] | None = None
    # Real polygon/multi-polygon geometry from Nominatim (simplified to ~10m
    # precision before persistence). When present the map renderer prefers
    # this over the bbox-derived rectangle — solves the "France's bbox spans
    # the Atlantic because of overseas territories" problem because the
    # MultiPolygon places mainland and territories as separate parts.
    geometry: dict | None = None


@router.get("/{run_id}/geocoded_entities", response_model=list[GeocodedEntityOut])
def get_geocoded_entities(
    *,
    run_id: int,
    field_path: str = Query(..., description="Dot-path into annotation.value where location strings live"),
    access: Access = Requires(scope=None),
    session: SessionDep,
) -> list[GeocodedEntityOut]:
    """Return the already-resolved coords for every location string that
    appears at ``field_path`` in any annotation of this run.

    Used by the map panel on mount so re-opening a previously-geocoded
    dashboard doesn't show an empty map — the markers seed in without
    having to kick the action again. Cache-hits only; this endpoint never
    calls the geocoder. Pressing "Geocode" from the UI is always safe
    (cached entries complete near-instantly).
    """
    from app.api.modules.annotation.tasks.geocode import _extract_location_strings
    from app.api.modules.graph.models import CanonEntry

    access.require_in_scope("run_ids", run_id)

    # Pull all annotations for this run within the user's scope.
    aq = AnnotationQuery(session, access.infospace_id).scope(access.scope).runs([run_id])
    page = aq.paginate(limit=10_000).results()
    annotation_ids = [r.annotation_id for r in page.items]
    if not annotation_ids:
        return []

    annotations = session.exec(
        select(Annotation).where(Annotation.id.in_(annotation_ids))
    ).all()

    strings: set[str] = set()
    for ann in annotations:
        for s in _extract_location_strings(ann, field_path):
            strings.add(s.strip())

    if not strings:
        return []

    # Match entries case-insensitively by canonical. Only return
    # those with resolved coords — skip the unresolved/unseen ones.
    # Type matched through `norm_type`, which exists for exactly this failure:
    # "extraction cannot guarantee casing — `Person` and `person` used to
    # resolve to two separate populations". A literal `== "location"` reproduced
    # it here, so any entry written as `Location` — by a curated import, by a
    # hand-seeded canon, by anything but this one action — was invisible and the
    # map came back empty with no error. The graph never had the problem because
    # `_attach_coords` does not filter on type at all.
    from app.api.modules.graph.resolution import norm_type

    lowered = [s.lower() for s in strings]
    entities = session.exec(
        select(CanonEntry).where(
            CanonEntry.infospace_id == access.infospace_id,
            func.lower(func.trim(CanonEntry.type)) == norm_type("location"),
            func.lower(CanonEntry.canonical).in_(lowered),
        )
    ).all()

    out: list[GeocodedEntityOut] = []
    for ent in entities:
        coords = (ent.properties or {}).get("coords")
        if not coords or not isinstance(coords, list) or len(coords) != 2:
            continue
        out.append(GeocodedEntityOut(
            entity_id=ent.id,
            name=ent.canonical,
            coords=list(coords),
            display_name=(ent.properties or {}).get("display_name"),
            bbox=(ent.properties or {}).get("bbox"),
            geometry=(ent.properties or {}).get("geometry"),
        ))
    return out

