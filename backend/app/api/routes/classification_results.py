from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func
from typing import List, Optional, Union, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.orm import joinedload, selectinload
from pydantic import BaseModel, model_validator, Field
import time
import logging

from app.models import (
    ClassificationResult,
    ClassificationResultRead,
    EnhancedClassificationResultRead,
    DataRecord,
    ClassificationScheme,
    ClassificationSchemeRead,
    ClassificationJob,
    Workspace,
)
from app.api.deps import SessionDep, CurrentUser

router = APIRouter(
    prefix="/workspaces/{workspace_id}",
    tags=["ClassificationResults"]
)

@router.get("/classification_results/{result_id}", response_model=ClassificationResultRead)
def get_classification_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    result_id: int
) -> ClassificationResultRead:
    """
    Load (retrieve) an individual classification result by its ID.
    Verifies that the result belongs to the specified workspace via its job.
    """
    result = session.exec(
        select(ClassificationResult)
        .join(ClassificationJob)
        .where(
            ClassificationResult.id == result_id,
            ClassificationJob.workspace_id == workspace_id,
            ClassificationJob.user_id == current_user.id
        )
    ).first()

    if not result:
        raise HTTPException(status_code=404, detail="ClassificationResult not found in this workspace")

    return ClassificationResultRead.model_validate(result)

@router.get("/classification_results", response_model=List[EnhancedClassificationResultRead])
@router.get("/classification_results/", response_model=List[EnhancedClassificationResultRead])
def list_classification_results(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: Optional[int] = Query(None, description="Filter results by ClassificationJob ID"),
    datarecord_ids: Optional[List[int]] = Query(None, description="Filter results by DataRecord IDs"),
    scheme_ids: Optional[List[int]] = Query(None, description="Filter results by ClassificationScheme IDs"),
    skip: int = 0,
    limit: int = 100
) -> List[EnhancedClassificationResultRead]:
    """
    List classification results for the workspace, with optional filters.
    Requires workspace ownership verification.
    Returns enhanced results with calculated display_value.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    statement = select(ClassificationResult)
    statement = statement.join(ClassificationJob).where(
        ClassificationJob.workspace_id == workspace_id,
        ClassificationJob.user_id == current_user.id
    )

    statement = statement.options(
        selectinload(ClassificationResult.scheme).selectinload(ClassificationScheme.fields)
    )

    if job_id is not None:
        statement = statement.where(ClassificationResult.job_id == job_id)
    if datarecord_ids is not None:
        if datarecord_ids:
            statement = statement.where(ClassificationResult.datarecord_id.in_(datarecord_ids))
        else:
            return []
    if scheme_ids is not None:
        if scheme_ids:
            statement = statement.where(ClassificationResult.scheme_id.in_(scheme_ids))
        else:
            return []

    statement = statement.order_by(ClassificationResult.timestamp.desc()).offset(skip).limit(limit)

    results = session.exec(statement).unique().all()

    enhanced_results = []
    for result in results:
        try:
            enhanced_result = EnhancedClassificationResultRead.model_validate(result)
            enhanced_results.append(enhanced_result)
        except Exception as validation_error:
            logging.error(f"Error validating EnhancedClassificationResultRead for result ID {result.id}: {validation_error}", exc_info=True)

    return enhanced_results

@router.get("/classification_jobs/{job_id}/results", response_model=List[EnhancedClassificationResultRead])
def get_job_results(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    job_id: int,
    skip: int = 0,
    limit: int = 100
) -> List[EnhancedClassificationResultRead]:
    """
    Retrieve all classification results for a specific ClassificationJob.
    Verifies job ownership and workspace context.
    Returns enhanced results with calculated display_value.
    """
    job = session.get(ClassificationJob, job_id)
    if (
        not job
        or job.workspace_id != workspace_id
        or job.user_id != current_user.id
    ):
        raise HTTPException(status_code=404, detail="ClassificationJob not found in this workspace")

    statement = select(ClassificationResult)
    statement = statement.where(ClassificationResult.job_id == job_id)
    statement = statement.options(
        selectinload(ClassificationResult.scheme).selectinload(ClassificationScheme.fields)
    )
    statement = statement.order_by(ClassificationResult.timestamp.desc()).offset(skip).limit(limit)

    results = session.exec(statement).unique().all()

    enhanced_results = []
    for result in results:
        try:
            enhanced_result = EnhancedClassificationResultRead.model_validate(result)
            enhanced_results.append(enhanced_result)
        except Exception as validation_error:
            logging.error(f"Error validating EnhancedClassificationResultRead for result ID {result.id} (Job {job_id}): {validation_error}", exc_info=True)

    return enhanced_results
