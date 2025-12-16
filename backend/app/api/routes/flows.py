"""
Flow Routes
===========

API endpoints for managing Flows - the unified workflow abstraction.
"""

import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.models import FlowStatus, FlowInputType, RunStatus
from app.schemas import (
    FlowCreate,
    FlowUpdate,
    FlowRead,
    FlowsOut,
    FlowExecutionCreate,
    FlowExecutionRead,
    FlowExecutionsOut,
)
from app.api.deps import CurrentUser, SessionDep

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/flows",
    tags=["Flows"],
)


def get_flow_service(session: SessionDep):
    """Get FlowService instance."""
    from app.api.services.flow_service import FlowService
    return FlowService(session)


# ═══════════════════════════════════════════════════════════════════════════
# FLOW CRUD
# ═══════════════════════════════════════════════════════════════════════════

@router.post("", response_model=FlowRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=FlowRead, status_code=status.HTTP_201_CREATED)
async def create_flow(
    *,
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_in: FlowCreate,
) -> FlowRead:
    """
    Create a new Flow.
    
    A Flow defines a processing workflow with:
    - Input: What to watch (bundle, source stream, or manual)
    - Steps: What processing to apply (annotate, filter, curate, route)
    - Trigger: When to run (on_arrival, scheduled, manual)
    """
    flow_service = get_flow_service(session)
    
    try:
        flow = flow_service.create_flow(
            flow_in=flow_in,
            user_id=current_user.id,
            infospace_id=infospace_id,
        )
        return FlowRead.model_validate(flow)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("", response_model=FlowsOut)
@router.get("/", response_model=FlowsOut)
async def list_flows(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=500),
    status: Optional[str] = Query(None, description="Filter by status"),
    input_type: Optional[str] = Query(None, description="Filter by input type"),
    tags: Optional[str] = Query(None, description="Comma-separated tags to filter by"),
) -> FlowsOut:
    """List all Flows in the infospace."""
    flow_service = get_flow_service(session)
    
    status_filter = FlowStatus(status) if status else None
    input_type_filter = FlowInputType(input_type) if input_type else None
    tags_filter = tags.split(",") if tags else None
    
    flows, total = flow_service.list_flows(
        user_id=current_user.id,
        infospace_id=infospace_id,
        skip=skip,
        limit=limit,
        status_filter=status_filter,
        input_type_filter=input_type_filter,
        tags_filter=tags_filter,
    )
    
    return FlowsOut(
        data=[FlowRead.model_validate(f) for f in flows],
        count=total,
    )


@router.get("/{flow_id}", response_model=FlowRead)
async def get_flow(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> FlowRead:
    """Get a specific Flow by ID."""
    flow_service = get_flow_service(session)
    
    flow = flow_service.get_flow(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flow not found"
        )
    
    return FlowRead.model_validate(flow)


@router.put("/{flow_id}", response_model=FlowRead)
async def update_flow(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
    flow_in: FlowUpdate,
) -> FlowRead:
    """Update a Flow."""
    flow_service = get_flow_service(session)
    
    try:
        flow = flow_service.update_flow(
            flow_id=flow_id,
            flow_in=flow_in,
            user_id=current_user.id,
            infospace_id=infospace_id,
        )
        
        if not flow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Flow not found"
            )
        
        return FlowRead.model_validate(flow)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.delete("/{flow_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_flow(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> None:
    """Delete a Flow and all its executions."""
    flow_service = get_flow_service(session)
    
    deleted = flow_service.delete_flow(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not deleted:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flow not found"
        )


# ═══════════════════════════════════════════════════════════════════════════
# FLOW LIFECYCLE
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/{flow_id}/activate", response_model=FlowRead)
async def activate_flow(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> FlowRead:
    """
    Activate a Flow for processing.
    
    The Flow must have at least one step and valid input configuration.
    """
    flow_service = get_flow_service(session)
    
    try:
        flow = flow_service.activate_flow(
            flow_id=flow_id,
            user_id=current_user.id,
            infospace_id=infospace_id,
        )
        
        if not flow:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Flow not found"
            )
        
        return FlowRead.model_validate(flow)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/{flow_id}/pause", response_model=FlowRead)
async def pause_flow(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> FlowRead:
    """Pause a Flow."""
    flow_service = get_flow_service(session)
    
    flow = flow_service.pause_flow(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flow not found"
        )
    
    return FlowRead.model_validate(flow)


# ═══════════════════════════════════════════════════════════════════════════
# FLOW EXECUTION
# ═══════════════════════════════════════════════════════════════════════════

@router.post("/{flow_id}/execute", response_model=FlowExecutionRead, status_code=status.HTTP_202_ACCEPTED)
async def trigger_flow_execution(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
    execution_in: Optional[FlowExecutionCreate] = None,
) -> FlowExecutionRead:
    """
    Trigger a Flow execution manually.
    
    If asset_ids are provided in the request body, only those assets will be processed.
    Otherwise, the Flow will process all pending (delta) assets based on its input configuration.
    """
    flow_service = get_flow_service(session)
    
    try:
        execution = flow_service.trigger_execution(
            flow_id=flow_id,
            user_id=current_user.id,
            infospace_id=infospace_id,
            execution_in=execution_in,
            triggered_by="manual",
        )
        
        return FlowExecutionRead.model_validate(execution)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/{flow_id}/executions", response_model=FlowExecutionsOut)
async def list_flow_executions(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    status: Optional[str] = Query(None, description="Filter by status"),
) -> FlowExecutionsOut:
    """List executions for a Flow."""
    flow_service = get_flow_service(session)
    
    status_filter = RunStatus(status) if status else None
    
    executions, total = flow_service.list_executions(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
        skip=skip,
        limit=limit,
        status_filter=status_filter,
    )
    
    return FlowExecutionsOut(
        data=[FlowExecutionRead.model_validate(e) for e in executions],
        count=total,
    )


@router.get("/{flow_id}/executions/{execution_id}", response_model=FlowExecutionRead)
async def get_flow_execution(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
    execution_id: int,
) -> FlowExecutionRead:
    """Get a specific Flow execution."""
    flow_service = get_flow_service(session)
    
    execution = flow_service.get_execution(
        execution_id=execution_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not execution or execution.flow_id != flow_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Execution not found"
        )
    
    return FlowExecutionRead.model_validate(execution)


# ═══════════════════════════════════════════════════════════════════════════
# FLOW UTILITIES
# ═══════════════════════════════════════════════════════════════════════════

@router.get("/{flow_id}/pending-assets", response_model=List[int])
async def get_pending_assets(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> List[int]:
    """
    Get the list of asset IDs that would be processed on the next execution.
    
    This is useful for previewing what the Flow will process.
    """
    flow_service = get_flow_service(session)
    
    flow = flow_service.get_flow(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flow not found"
        )
    
    return flow_service._get_delta_assets(flow)


@router.post("/{flow_id}/reset-cursor", response_model=FlowRead)
async def reset_flow_cursor(
    current_user: CurrentUser,
    session: SessionDep,
    infospace_id: int,
    flow_id: int,
) -> FlowRead:
    """
    Reset the Flow's cursor state, allowing it to reprocess all assets.
    
    Use with caution - this will cause all assets to be reprocessed on next execution.
    """
    flow_service = get_flow_service(session)
    
    flow = flow_service.get_flow(
        flow_id=flow_id,
        user_id=current_user.id,
        infospace_id=infospace_id,
    )
    
    if not flow:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Flow not found"
        )
    
    flow.cursor_state = {}
    session.add(flow)
    session.commit()
    session.refresh(flow)
    
    logger.info(f"Reset cursor for Flow {flow_id}")
    
    return FlowRead.model_validate(flow)
