import logging
from typing import List, Any, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session

from app.api import deps
from app.api.deps import CurrentUser, SessionDep
from app.models import IntelligencePipeline
from app.schemas import IntelligencePipelineCreate, IntelligencePipelineRead, IntelligencePipelineUpdate, PipelineExecutionRead
from app.api.services.pipeline_service import PipelineService
from app.api.services.annotation_service import AnnotationService
from app.api.services.analysis_service import AnalysisService
from app.api.services.bundle_service import BundleService

logger = logging.getLogger(__name__)
router = APIRouter()

# Use the dependency from deps.py
PipelineServiceDep = deps.Annotated[PipelineService, Depends(deps.get_pipeline_service)]

@router.post("/infospaces/{infospace_id}/pipelines", response_model=IntelligencePipelineRead, status_code=status.HTTP_201_CREATED)
def create_pipeline(
    *,
    infospace_id: int,
    pipeline_in: IntelligencePipelineCreate,
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """Create a new Intelligence Pipeline."""
    try:
        pipeline = service.create_pipeline(pipeline_in, current_user.id, infospace_id)
        return pipeline
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/infospaces/{infospace_id}/pipelines", response_model=List[IntelligencePipelineRead])
def list_pipelines(
    *,
    infospace_id: int,
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """List all Intelligence Pipelines in an infospace."""
    # This service method needs to be implemented
    pipelines = service.list_pipelines(user_id=current_user.id, infospace_id=infospace_id)
    return pipelines

@router.get("/{pipeline_id}", response_model=IntelligencePipelineRead)
def get_pipeline(
    *,
    pipeline_id: int,
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """Get a specific Intelligence Pipeline by ID."""
    pipeline = service.get_pipeline(pipeline_id=pipeline_id, user_id=current_user.id)
    if not pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return pipeline

@router.put("/{pipeline_id}", response_model=IntelligencePipelineRead)
def update_pipeline(
    *,
    pipeline_id: int,
    pipeline_in: IntelligencePipelineUpdate,
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """Update an Intelligence Pipeline."""
    updated_pipeline = service.update_pipeline(pipeline_id=pipeline_id, pipeline_in=pipeline_in, user_id=current_user.id)
    if not updated_pipeline:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return updated_pipeline

@router.delete("/{pipeline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_pipeline(
    *,
    pipeline_id: int,
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """Delete an Intelligence Pipeline."""
    success = service.delete_pipeline(pipeline_id=pipeline_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Pipeline not found")
    return

@router.post("/{pipeline_id}/execute", response_model=PipelineExecutionRead)
def execute_pipeline(
    *,
    pipeline_id: int,
    asset_ids: List[int], # For manual ad-hoc runs
    current_user: CurrentUser,
    service: PipelineServiceDep
):
    """Manually trigger an Intelligence Pipeline for a specific set of assets."""
    try:
        execution = service.trigger_pipeline(pipeline_id, asset_ids, trigger_type="MANUAL_ADHOC")
        return execution
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))

# ... other CRUD endpoints for Pipelines and Executions ... 