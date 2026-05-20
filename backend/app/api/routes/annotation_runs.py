"""Routes for annotation runs."""
import asyncio
import logging
from typing import Any, AsyncIterable, Optional, Dict, Union
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import StreamingResponse
from fastapi.sse import EventSourceResponse, ServerSentEvent
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


def _fetch_runs(
    session, access, infospace_id: int, skip: int, limit: int,
    include_counts: bool, include_children: bool = False,
):
    """Fetch runs + batch annotation counts.

    By default returns only family roots (``parent_run_id IS NULL``) so the
    history list shows one row per unit of analysis. Extensions are folded in
    via family rollup (annotation_count, effective_status) on the parent row.

    Pass ``include_children=True`` to surface every run, e.g. for diagnostics.
    """
    query = (
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == infospace_id)
    )
    if not include_children:
        query = query.where(AnnotationRun.parent_run_id.is_(None))
    query = access.scope_filter(query, AnnotationRun.id, "run_ids")
    query = query.offset(skip).limit(limit)
    runs = list(session.exec(query).all())

    run_ids = [r.id for r in runs]

    # Family rollup: discover descendants for each parent in one query so the
    # counts query can fan to (parent + descendants) without N+1 lookups.
    family_by_root: dict[int, list[int]] = {rid: [rid] for rid in run_ids}
    if run_ids:
        descendant_rows = session.exec(
            select(AnnotationRun.id, AnnotationRun.parent_run_id, AnnotationRun.status)
            .where(
                AnnotationRun.parent_run_id.in_(run_ids),
                AnnotationRun.infospace_id == infospace_id,
            )
        ).all()
        # status of each descendant — used to compute effective_status below.
        descendants_by_root: dict[int, list[tuple[int, str]]] = {}
        for child_id, parent_id, child_status in descendant_rows:
            family_by_root.setdefault(parent_id, [parent_id]).append(child_id)
            descendants_by_root.setdefault(parent_id, []).append((child_id, child_status))
    else:
        descendants_by_root = {}

    counts_by_run: dict[int, int] = {}
    if include_counts and run_ids:
        all_family_ids = [fid for ids in family_by_root.values() for fid in ids]
        # Sum annotations per family root: GROUP BY runs that belong to the
        # family, then aggregate in Python (cheap — <100 runs/family typical).
        count_rows = session.exec(
            select(Annotation.run_id, func.count(Annotation.id))
            .where(Annotation.run_id.in_(all_family_ids))
            .group_by(Annotation.run_id)
        ).all()
        counts_per_run = dict(count_rows)
        for root_id, family_ids in family_by_root.items():
            counts_by_run[root_id] = sum(counts_per_run.get(fid, 0) for fid in family_ids)

    non_terminal = {RunStatus.PENDING.value, RunStatus.RUNNING.value, RunStatus.WAITING.value}
    result_runs = []
    for run in runs:
        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        run_read.schema_ids = [s.id for s in run.target_schemas] if run.target_schemas else []
        if include_counts:
            run_read.annotation_count = counts_by_run.get(run.id, 0)

        descendants = descendants_by_root.get(run.id, [])
        run_read.extension_count = len(descendants)
        # Effective status: any non-terminal descendant lifts the run into
        # RUNNING. The stored ``status`` field stays accurate to the parent's
        # own lifecycle.
        if descendants and any(
            (s if isinstance(s, str) else getattr(s, "value", str(s))) in non_terminal
            for _cid, s in descendants
        ):
            run_read.effective_status = RunStatus.RUNNING
        else:
            run_read.effective_status = run.status
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
    include_children: bool = Query(
        False,
        description=(
            "When False (default), only family roots are returned — extension "
            "runs are folded into their parent's annotation_count and "
            "effective_status. Set True to surface every run, e.g. for diagnostics."
        ),
    ),
    session: SessionDep,
):
    """Retrieve runs for the infospace (JSON).

    For a progressive SSE version (runs first, count later), call the
    sibling endpoint ``GET /stream``.
    """
    infospace_id = access.infospace_id

    result_runs = await asyncio.to_thread(
        _fetch_runs, session, access, infospace_id, skip, limit, include_counts, include_children,
    )
    count_query = select(func.count(AnnotationRun.id)).where(
        AnnotationRun.infospace_id == infospace_id
    )
    if not include_children:
        count_query = count_query.where(AnnotationRun.parent_run_id.is_(None))
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
    include_children: bool = Query(
        False,
        description="See list_runs — same flag, default folds extensions into parents.",
    ),
    session: SessionDep,
):
    """Progressive SSE feed for run list — runs first, count later.

    Native async-generator endpoint; FastAPI's SSE pipeline attaches
    3s keepalive pings (survives nginx ``proxy_read_timeout``).
    """
    infospace_id = access.infospace_id

    try:
        result_runs = await asyncio.to_thread(
            _fetch_runs, session, access, infospace_id, skip, limit, include_counts, include_children,
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
        if not include_children:
            count_query = count_query.where(AnnotationRun.parent_run_id.is_(None))
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

    Returns family-rolled-up fields:
      * ``annotation_count`` — sum across the run and its descendants.
      * ``effective_status`` — RUNNING when any descendant is non-terminal,
        else the parent's own status. The stored ``status`` is unchanged.
      * ``progress_total`` / ``progress_current`` — when a descendant is
        actively running, these reflect the descendant's progress so the UI
        shows live extension activity.
      * ``extension_count`` — number of descendant runs.
    """
    try:
        infospace_id = access.infospace_id
        run = session.get(AnnotationRun, run_id)
        if not run or run.infospace_id != infospace_id:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
        access.require_in_scope("run_ids", run_id)

        run_read = AnnotationRunRead.model_validate(run.model_dump(exclude_none=False))
        run_read.schema_ids = [schema.id for schema in run.target_schemas] if run.target_schemas else []

        # Family lookup — descendants and their statuses for rollup.
        descendants = session.exec(
            select(AnnotationRun).where(
                AnnotationRun.parent_run_id == run.id,
                AnnotationRun.infospace_id == infospace_id,
            )
        ).all()
        run_read.extension_count = len(descendants)

        non_terminal_states = {RunStatus.PENDING, RunStatus.RUNNING, RunStatus.WAITING}
        active_descendants = [d for d in descendants if d.status in non_terminal_states]
        if active_descendants:
            run_read.effective_status = RunStatus.RUNNING
            # Surface the active extension's progress so the UI shows live
            # numbers while the extension processes. Multiple actives sum.
            total = sum((d.progress_total or 0) for d in active_descendants)
            current = sum((d.progress_current or 0) for d in active_descendants)
            if total > 0:
                run_read.progress_total = total
                run_read.progress_current = current
        else:
            run_read.effective_status = run.status

        if include_counts:
            family_ids = [run.id] + [d.id for d in descendants]
            run_read.annotation_count = session.exec(
                select(func.count(Annotation.id)).where(Annotation.run_id.in_(family_ids))
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

class ExtendRunRequest(BaseModel):
    """Request body for ``POST /runs/{run_id}/extend``.

    At least one of ``asset_ids``, ``bundle_id``, ``schema_ids`` must be set.
    The service resolves the family-scoped delta and creates a child run
    (``parent_run_id`` = root). Existing annotations in the run's family are
    not re-processed.
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
    """Extend a run with new assets and/or schemas.

    Creates a child run (``parent_run_id`` = root of the family) carrying
    only the (asset, schema) delta — pairs already annotated within the
    family are skipped. The parent run stays untouched. Reads via ``/view``
    transparently merge family annotations.

    Gates: parent must be a one_off run in a terminal state, no
    ``flow_execution_id``, no ``source_bundle_id``.
    """
    access.require_in_scope("run_ids", run_id)
    try:
        child = annotation_service.extend_run(
            run_id=run_id,
            user_id=access.user_id,
            infospace_id=access.infospace_id,
            asset_ids=body.asset_ids,
            bundle_id=body.bundle_id,
            schema_ids=body.schema_ids,
            configuration_overrides=body.configuration_overrides,
        )
        run_read = AnnotationRunRead.model_validate(child.model_dump(exclude_none=False))
        run_read.schema_ids = [s.id for s in child.target_schemas] if child.target_schemas else []
        run_read.annotation_count = 0
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
    include_descendants: bool = Query(
        True,
        description=(
            "Default True: include annotations from extension (child) runs so "
            "the export reflects what the dashboard shows. Pass False to scope "
            "the export to this run id only."
        ),
    ),
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
            include_descendants=include_descendants,
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
    AnnotationRow as AQRow,
    AssetSummary as AQAssetSummary,
    AggregateBucket as AQBucket,
    DistinctValueEntry,
    GraphNode as AQNode,
    GraphEdge as AQEdge,
)
from app.api.modules.annotation.formula import Formula
from app.api.modules.annotation.views import (
    AggregateViewConfig,
    GraphViewConfig,
    collect_graph as _collect_graph_view,
    collect_aggregate as _collect_aggregate_view,
    collect_rows as _collect_rows_view,
    render_aggregate,
    render_graph,
    render_rows,
)


class RowsConfig(BaseModel):
    # Opaque cursor string (from a prior ResultsPage.cursor_next). Legacy
    # callers may still send an int annotation id — AnnotationQuery.paginate
    # decodes both.
    cursor: str | int | None = None
    limit: int = 100


# Route-level config aliases to the single source of truth in
# ``annotation/views.py``. Preserves the wire names ``AggregateConfig`` and
# ``GraphConfig`` for existing clients while collapsing drift.
AggregateConfig = AggregateViewConfig
GraphConfig = GraphViewConfig


class FormulaViewConfig(BaseModel):
    """The Formula phase of ``/view`` — run a :class:`Formula`, get its
    ``OutputRelation``. Same Formula shape the prompt bar and the Dashboard
    Operator emit. The engine does no entity resolution, so there are no
    canon knobs."""

    formula: Formula
    cursor: str | int | None = None
    limit: int = 100


class ViewRequest(BaseModel):
    """Composable view request. Send any combination of rows/aggregate/graph/dossier."""
    # Shared
    filters: FilterSet | None = None
    merge_maps: list[MergeMap] = []
    schema_ids: list[int] = []
    asset_ids: list[int] = []
    additional_run_ids: list[int] = []
    # Materializations (any combo)
    rows: RowsConfig | None = None
    aggregate: AggregateConfig | None = None
    graph: GraphConfig | None = None
    formula: FormulaViewConfig | None = None


# --- SSE response models ---

class ViewRowsPhase(BaseModel):
    items: list[dict]
    assets: dict[int, dict]
    total: int
    cursor_next: str | None


class ViewAggregatePhase(BaseModel):
    buckets: list[dict]
    field_path: str
    interval: str | None
    total_count: int
    split_field_path: str | None = None


class ViewGraphPhase(BaseModel):
    nodes: list[dict]
    edges: list[dict]




def _resolve_family(session, infospace_id: int, run_id: int) -> list[int]:
    """Return ``[run_id]`` plus every descendant linked via ``parent_run_id``.

    The annotation run family is flat by construction (``extend_run`` always
    points new children at the *root*), so a single-level lookup suffices.
    Descendants are server-resolved on every read so panels stay naive — they
    bind to the parent run id and the family rolls up underneath.
    """
    descendants = list(session.exec(
        select(AnnotationRun.id).where(
            AnnotationRun.parent_run_id == run_id,
            AnnotationRun.infospace_id == infospace_id,
        )
    ).all())
    return [run_id] + descendants


def _build_query(
    session, access: Access, run_id: int, body: ViewRequest,
) -> AnnotationQuery:
    """Construct an AnnotationQuery from shared ViewRequest fields.

    The query covers the run *and* its descendants. Package scope is still
    enforced via ``AnnotationQuery.scope`` — descendants outside the grant's
    ``run_ids`` get filtered in the materialization SQL.
    """
    # Scope-check the explicitly requested ids.
    explicit_ids = [run_id] + body.additional_run_ids
    for rid in explicit_ids:
        access.require_in_scope("run_ids", rid)

    # Family rollup — always include descendants of the requested run, plus
    # descendants of any explicit ``additional_run_ids``. Dedup before applying.
    rolled: list[int] = []
    seen: set[int] = set()
    for rid in explicit_ids:
        for fid in _resolve_family(session, access.infospace_id, rid):
            if fid not in seen:
                seen.add(fid)
                rolled.append(fid)

    aq = AnnotationQuery(session, access.infospace_id).scope(access.scope)
    aq.runs(rolled)

    if body.schema_ids:
        aq.schemas(body.schema_ids)
    if body.asset_ids:
        aq.assets(body.asset_ids)
    if body.filters:
        aq.filter(body.filters)
    for mm in body.merge_maps:
        aq.merge(mm)

    return aq


def _build_view_phases(session, access, run_id: int, body: "ViewRequest") -> dict:
    """Synchronous materialization of view phases. Runs via to_thread.

    Graph path routes through ``collect_graph`` (which iterates
    ``stream_graph``) so scale is bounded by the ``top_n_*`` caps even when
    the caller wants a JSON envelope. The non-streaming ``AnnotationQuery.graph()``
    is deprecated and not used here.
    """
    import asyncio

    aq = _build_query(session, access, run_id, body)
    result: dict[str, BaseModel] = {}

    if body.rows:
        aq.paginate(cursor=body.rows.cursor, limit=body.rows.limit)
        page = aq.results()
        result["rows"] = ViewRowsPhase(
            items=[_row_to_dict(r) for r in page.items],
            assets={aid: _asset_to_dict(a) for aid, a in page.assets.items()},
            total=page.total,
            cursor_next=page.cursor_next,
        )

    if body.aggregate:
        ac = body.aggregate
        agg = aq.aggregate(
            ac.group_by,
            interval=ac.interval,
            function=ac.function,
            value_field=ac.value_field,
            top_n=ac.top_n,
            split_by=ac.split_by,
        )
        result["aggregate"] = ViewAggregatePhase(
            buckets=[
                {
                    "key": b.key,
                    "count": b.count,
                    "stats": b.stats,
                    "split_value": b.split_value,
                }
                for b in agg.buckets
            ],
            field_path=agg.field_path,
            interval=agg.interval,
            total_count=agg.total_count,
            split_field_path=agg.split_field_path,
        )

    if body.graph:
        gc = body.graph
        # Route through the streaming primitive so 5M-annotation runs don't
        # materialize the whole graph in memory. ``asyncio.run`` is safe here
        # because ``_build_view_phases`` runs inside ``asyncio.to_thread`` —
        # no parent event loop in this thread.
        gr = asyncio.run(_collect_graph_view(aq, gc))
        result["graph"] = ViewGraphPhase(
            nodes=[_node_to_dict(n) for n in gr.nodes],
            edges=[_edge_to_dict(e) for e in gr.edges],
        )

    if body.formula:
        fc = body.formula
        aq.paginate(cursor=fc.cursor, limit=fc.limit)
        _run = session.get(AnnotationRun, run_id)
        _attach_formula_lookup(
            aq, _run.views_config if _run and isinstance(_run.views_config, dict) else {}
        )
        rel = aq.relation(fc.formula)
        result["formula"] = rel.model_dump()

    return result


def _validated_view_body(body: ViewRequest) -> ViewRequest:
    """Body-level validation run pre-generator.

    Ensures the 400 returns as a JSON response, not as an SSE error event.
    HTTPException raised inside an async-generator route is too late —
    FastAPI's SSE pipeline has already started streaming.
    """
    if not body.rows and not body.aggregate and not body.graph and not body.formula:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="At least one of rows, aggregate, graph, or formula must be specified",
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
    - ``graph_chunk`` — emitted for each chunk as ``graph_stream`` produces
      them; frontends that want progressive rendering accumulate these
    - ``graph`` — final single event carrying the full (bounded) graph, so
      clients that only listen for ``graph`` still get a correct answer

    Rows and aggregate run inside ``to_thread`` because the underlying
    ``AnnotationQuery`` methods do sync DB I/O. Graph iterates in pure
    async over ``graph_stream`` — its sync session reads happen inline but
    ``async for`` yields control on each chunk, so keepalives and peer
    backpressure work correctly.
    """
    try:
        aq = _build_query(session, access, run_id, body)

        # rows — sync, one event
        if body.rows:
            aq.paginate(cursor=body.rows.cursor, limit=body.rows.limit)
            page = await asyncio.to_thread(aq.results)
            rows_payload = ViewRowsPhase(
                items=[_row_to_dict(r) for r in page.items],
                assets={aid: _asset_to_dict(a) for aid, a in page.assets.items()},
                total=page.total,
                cursor_next=page.cursor_next,
            )
            yield ServerSentEvent(data=rows_payload.model_dump(), event="rows")

        # aggregate — sync, one event
        if body.aggregate:
            ac = body.aggregate
            agg = await asyncio.to_thread(
                aq.aggregate,
                ac.group_by,
                interval=ac.interval,
                function=ac.function,
                value_field=ac.value_field,
                top_n=ac.top_n,
            )
            agg_payload = ViewAggregatePhase(
                buckets=[{"key": b.key, "count": b.count, "stats": b.stats} for b in agg.buckets],
                field_path=agg.field_path,
                interval=agg.interval,
                total_count=agg.total_count,
            )
            yield ServerSentEvent(data=agg_payload.model_dump(), event="aggregate")

        # graph — progressive chunks, then a final full payload
        if body.graph:
            gc = body.graph
            accumulated_nodes: list[dict] = []
            accumulated_edges: list[dict] = []
            async for chunk in aq.graph_stream(
                gc.triplet_field,
                dedup=gc.dedup,
                top_n_nodes=gc.top_n_nodes,
                top_n_edges=gc.top_n_edges,
                chunk_size=gc.chunk_size,
                edge_weight_field=gc.edge_weight_field,
                edge_weight_mode=gc.edge_weight_mode,
                forward_properties=list(gc.forward_properties or []),
                node_group_by=gc.node_group_by,
                edge_group_by=gc.edge_group_by,
                null_policy=gc.null_policy,
            ):
                chunk_nodes = [_node_to_dict(n) for n in chunk.nodes]
                chunk_edges = [_edge_to_dict(e) for e in chunk.edges]
                yield ServerSentEvent(
                    data={"nodes": chunk_nodes, "edges": chunk_edges},
                    event="graph_chunk",
                )
                accumulated_nodes.extend(chunk_nodes)
                accumulated_edges.extend(chunk_edges)

            # Final summary event — wire-compatible with the JSON endpoint.
            yield ServerSentEvent(
                data={"nodes": accumulated_nodes, "edges": accumulated_edges},
                event="graph",
            )

        # formula — sync, one event (chunked streaming is a later add)
        if body.formula:
            fc = body.formula
            def _run_formula():
                aq.paginate(cursor=fc.cursor, limit=fc.limit)
                _run = session.get(AnnotationRun, run_id)
                _attach_formula_lookup(
                    aq,
                    _run.views_config
                    if _run and isinstance(_run.views_config, dict) else {},
                )
                return aq.relation(fc.formula)
            rel = await asyncio.to_thread(_run_formula)
            yield ServerSentEvent(data=rel.model_dump(), event="formula")

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
    # Reuse the shared query builder shape.
    class _ViewLike:
        pass

    view_like = _ViewLike()
    view_like.filters = body.filters
    view_like.merge_maps = body.merge_maps
    view_like.schema_ids = body.schema_ids
    view_like.asset_ids = body.asset_ids
    view_like.additional_run_ids = body.additional_run_ids

    def _run() -> DistinctValuesResponse:
        aq = _build_query(session, access, run_id, view_like)  # type: ignore[arg-type]
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


def _row_to_dict(r: AQRow) -> dict:
    return {
        "annotation_id": r.annotation_id,
        "asset_id": r.asset_id,
        "schema_id": r.schema_id,
        "run_id": r.run_id,
        "value": r.value,
        "timestamp": r.timestamp.isoformat() if r.timestamp else None,
        "status": r.status,
        "element": r.element,
        "element_index": r.element_index,
    }


def _asset_to_dict(a: AQAssetSummary) -> dict:
    return {
        "id": a.id,
        "title": a.title,
        "kind": a.kind,
        "parent_asset_id": a.parent_asset_id,
        "parent_title": a.parent_title,
    }


def _node_to_dict(n: AQNode) -> dict:
    return {
        "id": n.id,
        "name": n.name,
        "type": n.type,
        "frequency": n.frequency,
        "source_annotation_ids": n.source_annotation_ids,
        # Schema field renamed in the canon-graph rework: canonical_entity_id → entity_id.
        # Wire shape exposes both keys for one release to give the frontend
        # time to migrate without breaking existing consumers.
        "entity_id": n.entity_id,
        "canonical_entity_id": n.entity_id,
        "group_value": n.group_value,
        "properties": n.properties,
        "evidence": getattr(n, "evidence", []),
    }


def _edge_to_dict(e: AQEdge) -> dict:
    return {
        "source": e.source,
        "target": e.target,
        "predicate": e.predicate,
        "weight": e.weight,
        "computed_weight": e.computed_weight,
        "group_value": e.group_value,
        "properties": e.properties,
        "evidence": getattr(e, "evidence", []),
    }


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
    ``Entity.properties['coords']``.
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
    """One already-resolved location, sourced from Entity.properties."""
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
    from app.api.modules.graph.models import Entity

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

    # Match entities case-insensitively by canonical_name. Only return
    # those with resolved coords — skip the unresolved/unseen ones.
    lowered = [s.lower() for s in strings]
    entities = session.exec(
        select(Entity).where(
            Entity.infospace_id == access.infospace_id,
            Entity.entity_type == "location",
            func.lower(Entity.canonical_name).in_(lowered),
        )
    ).all()

    out: list[GeocodedEntityOut] = []
    for ent in entities:
        coords = (ent.properties or {}).get("coords")
        if not coords or not isinstance(coords, list) or len(coords) != 2:
            continue
        out.append(GeocodedEntityOut(
            entity_id=ent.id,
            name=ent.canonical_name,
            coords=list(coords),
            display_name=(ent.properties or {}).get("display_name"),
            bbox=(ent.properties or {}).get("bbox"),
            geometry=(ent.properties or {}).get("geometry"),
        ))
    return out

# ─── M5: Observation snapshots ──────────────────────────────────────────────
#
# Observation snapshots — immutable frozen outputs of formulas. Persisted as
# JSON entries on ``AnnotationRun.views_config['observations']``. See
# ``docs/intelligence/HOW_TO.md`` § Observations.

from app.api.modules.annotation import snapshots as _snapshots
from app.api.modules.annotation.formulas import resolve_formula as _resolve_formula
from app.api.modules.annotation.formulas import attach_formula_lookup as _attach_formula_lookup


class _ObservationSnapshotRequest(BaseModel):
    formula_name: str
    note: Optional[str] = None
    schema_id: Optional[int] = None
    canon_id: Optional[int] = None
    allow_unresolved: bool = False


@router.post("/{run_id}/observations", response_model=_snapshots.Observation, status_code=status.HTTP_201_CREATED)
def create_observation_snapshot(
    *,
    run_id: int,
    body: _ObservationSnapshotRequest,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    session: SessionDep,
) -> _snapshots.Observation:
    """Snapshot a formula's current output to ``DashboardConfig.observations[]``.

    Runs the named formula against the current corpus, freezes the output
    relation + provenance, inlines the formula body for cite-stability, and
    stores the result on the run's dashboard config. The snapshot is
    immutable — editing the source Formula afterwards does not mutate this
    Observation. Re-snapshot to capture new corpus state.
    """
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")

    dashboard = run.views_config if isinstance(run.views_config, dict) else {}
    try:
        formula = _resolve_formula(body.formula_name, dashboard)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))

    aq = (
        AnnotationQuery(session, access.infospace_id)
        .scope(access.scope)
        .runs([run_id])
    )
    _attach_formula_lookup(aq, dashboard if isinstance(dashboard, dict) else {})
    result = aq.relation(formula)

    obs = _snapshots.snapshot_from_formula(
        run=run,
        formula_name=body.formula_name,
        relation=result,
        note=body.note,
        schema_id=body.schema_id,
    )
    _snapshots.append_observation(run, obs)
    session.add(run)
    session.commit()
    return obs


@router.get("/{run_id}/observations", response_model=list[_snapshots.Observation])
def list_observation_snapshots(
    *,
    run_id: int,
    access: Access = Requires(scope=None),
    session: SessionDep,
) -> list[_snapshots.Observation]:
    """List all snapshots stored on this run's dashboard. Pull-back path."""
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    return _snapshots.list_observations(run)


@router.get("/{run_id}/observations/{obs_id}", response_model=_snapshots.Observation)
def get_observation_snapshot(
    *,
    run_id: int,
    obs_id: str,
    access: Access = Requires(scope=None),
    session: SessionDep,
) -> _snapshots.Observation:
    """Read one snapshot — no recompute. The cite-stability path."""
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    obs = _snapshots.get_observation(run, obs_id)
    if obs is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Observation not found")
    return obs


@router.delete("/{run_id}/observations/{obs_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_observation_snapshot(
    *,
    run_id: int,
    obs_id: str,
    access: Access = Requires(Capability.COMPUTE, scope=None),
    session: SessionDep,
) -> None:
    """Drop a snapshot. Cited findings stay broken unless the user takes
    explicit action — snapshots are not silently recreated."""
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if not run or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Run not found")
    if not _snapshots.remove_observation(run, obs_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Observation not found")
    session.add(run)
    session.commit()
