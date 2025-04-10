from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select, func
from typing import Any, List, Optional
from datetime import datetime, timezone

from app.api.deps import SessionDep, CurrentUser
from app.models import (
    User,
    ClassificationRun,
    ClassificationRunCreate,
    ClassificationRunRead,
    ClassificationRunsOut,
    ClassificationResult, # Needed for result_count query
    Workspace, # Needed for authorization checks
    ClassificationRunStatus,
    ClassificationRunUpdate,
)

router = APIRouter(
    prefix="/workspaces/{workspace_id}/classification_runs",
    tags=["ClassificationRuns"]
)

@router.post("", response_model=ClassificationRunRead)
@router.post("/", response_model=ClassificationRunRead)
def create_classification_run(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    run_in: ClassificationRunCreate,
) -> Any:
    """
    Create a new classification run.
    Workspace must exist and belong to the current user.
    """
    # Check if workspace exists and belongs to the user
    workspace = session.get(Workspace, workspace_id)
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    if workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to create a run in this workspace")

    # Convert Pydantic model to dict
    obj_in_data = run_in.model_dump()
    # Create DB model instance, adding user_id
    run = ClassificationRun(**obj_in_data, user_id=current_user.id) # Directly create the ClassificationRun object
    session.add(run)
    session.commit()
    session.refresh(run)
    return run

@router.get("", response_model=ClassificationRunsOut)
def read_classification_runs(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(default=100, le=500)
) -> Any:
    """
    Retrieve classification runs for a specific workspace
    """
    # Add workspace validation
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    query = (
        select(ClassificationRun, func.count(ClassificationResult.id).label("result_count"))
        .outerjoin(ClassificationResult, ClassificationRun.id == ClassificationResult.run_id)
        .where(ClassificationRun.user_id == current_user.id)
        .group_by(ClassificationRun.id)
        .order_by(ClassificationRun.created_at.desc())
    )

    total_count_query = select(func.count(ClassificationRun.id)).where(ClassificationRun.user_id == current_user.id)

    total_count = session.exec(total_count_query).one()

    runs_with_counts = session.exec(query.offset(skip).limit(limit)).all()

    # Adapt the structure for ClassificationRunRead including result_count
    runs_read = []
    for run, count in runs_with_counts:
        run_data = run.model_dump()
        run_data["result_count"] = count
        runs_read.append(ClassificationRunRead.model_validate(run_data))

    return ClassificationRunsOut(data=runs_read, count=total_count)

@router.get("/{run_id}", response_model=ClassificationRunRead)
def read_classification_run(
    *,
    session: SessionDep,
    run_id: int,
    current_user: CurrentUser,
) -> Any:
    """
    Get a specific classification run by ID.
    Only returns runs belonging to the user.
    """
    query = (
        select(ClassificationRun, func.count(ClassificationResult.id).label("result_count"))
        .outerjoin(ClassificationResult, ClassificationRun.id == ClassificationResult.run_id)
        .where(ClassificationRun.id == run_id)
        .group_by(ClassificationRun.id)
    )

    run_with_count = session.exec(query).first()

    if not run_with_count:
        raise HTTPException(status_code=404, detail="Classification run not found")

    run, count = run_with_count

    if run.user_id != current_user.id:
         raise HTTPException(status_code=403, detail="Not authorized to access this run")

    run_data = run.model_dump()
    run_data["result_count"] = count
    return ClassificationRunRead.model_validate(run_data)

# --- ADDED: PATCH and DELETE endpoints --- 

@router.patch("/{run_id}", response_model=ClassificationRunRead)
def update_classification_run(
    *,
    session: SessionDep,
    run_id: int,
    run_in: ClassificationRunUpdate,
    current_user: CurrentUser,
) -> Any:
    """
    Update a specific classification run by ID.
    Only allows updates to runs belonging to the user.
    """
    run = session.get(ClassificationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Classification run not found")
    if run.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to update this run")

    update_data = run_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(run, field, value)
    
    # Update the timestamp
    run.updated_at = datetime.now(timezone.utc)
    
    session.add(run)
    session.commit()
    session.refresh(run)
    
    # Recalculate result_count after update (though unlikely to change here)
    count_query = select(func.count(ClassificationResult.id)).where(ClassificationResult.run_id == run_id)
    result_count = session.exec(count_query).one_or_none() or 0
    
    run_data = run.model_dump()
    run_data["result_count"] = result_count
    return ClassificationRunRead.model_validate(run_data)

@router.delete("/{run_id}", status_code=204) # Use 204 No Content for successful deletion
def delete_classification_run(
    *,
    session: SessionDep,
    run_id: int,
    current_user: CurrentUser,
) -> None:
    """
    Delete a specific classification run by ID.
    Only allows deletion of runs belonging to the user.
    Note: This will cascade delete associated ClassificationResults if the DB constraint is active.
          If not, results might be orphaned. Consider handling orphans separately if needed.
    """
    run = session.get(ClassificationRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Classification run not found")
    if run.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to delete this run")

    # Optional: Handle orphaned results before deleting the run if FK constraint is not enforced
    # e.g., session.query(ClassificationResult).filter(ClassificationResult.run_id == run_id).delete()

    session.delete(run)
    session.commit()
    return None # Return None for 204 status code
