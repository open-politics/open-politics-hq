from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api import deps
from app.models import (
    Monitor,
    User
)
from app.schemas import (
    MonitorCreate,
    MonitorUpdate,
    MonitorRead,
    Message,
)
from app.api.services.monitor_service import MonitorService
from app.api.services.service_utils import validate_infospace_access

router = APIRouter()

# Use the dependency from deps.py
MonitorServiceDep = deps.Annotated[MonitorService, Depends(deps.get_monitor_service)]

@router.post("/infospaces/{infospace_id}/monitors", response_model=MonitorRead, status_code=status.HTTP_201_CREATED)
def create_monitor(
    *,
    infospace_id: int,
    monitor_in: MonitorCreate,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep
) -> Monitor:
    """Create a new monitor in an infospace."""
    try:
        monitor = service.create_monitor(
            monitor_in=monitor_in,
            infospace_id=infospace_id,
            user_id=current_user.id
        )
        return monitor
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/infospaces/{infospace_id}/monitors", response_model=List[MonitorRead])
def list_monitors(
    *,
    infospace_id: int,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep,
    skip: int = 0,
    limit: int = 100
):
    """List all monitors in an infospace."""
    return service.list_monitors(user_id=current_user.id, infospace_id=infospace_id, skip=skip, limit=limit)

@router.get("/monitors/{monitor_id}", response_model=MonitorRead)
def get_monitor(
    *,
    monitor_id: int,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep
):
    """Get a specific monitor by ID."""
    # We need the infospace_id for validation, which we get from the monitor itself
    monitor = service.session.get(Monitor, monitor_id)
    if not monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    
    # Now validate user has access to that infospace
    validate_infospace_access(service.session, monitor.infospace_id, current_user.id)
    return monitor

@router.put("/monitors/{monitor_id}", response_model=MonitorRead)
def update_monitor(
    *,
    monitor_id: int,
    monitor_in: MonitorUpdate,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep
):
    """Update a monitor."""
    db_monitor = service.session.get(Monitor, monitor_id)
    if not db_monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    
    updated_monitor = service.update_monitor(
        monitor_id=monitor_id,
        monitor_in=monitor_in,
        user_id=current_user.id,
        infospace_id=db_monitor.infospace_id
    )
    return updated_monitor

@router.delete("/monitors/{monitor_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_monitor(
    *,
    monitor_id: int,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep
):
    """Delete a monitor."""
    db_monitor = service.session.get(Monitor, monitor_id)
    if not db_monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")

    success = service.delete_monitor(
        monitor_id=monitor_id,
        user_id=current_user.id,
        infospace_id=db_monitor.infospace_id
    )
    if not success:
        raise HTTPException(status_code=404, detail="Monitor could not be deleted.")
    return

@router.post("/monitors/{monitor_id}/execute", response_model=Message)
def execute_monitor_manually(
    *,
    monitor_id: int,
    current_user: User = Depends(deps.get_current_user),
    service: MonitorServiceDep
):
    """Manually trigger a monitor to check for new assets and create a run."""
    db_monitor = service.session.get(Monitor, monitor_id)
    if not db_monitor:
        raise HTTPException(status_code=404, detail="Monitor not found")
    validate_infospace_access(service.session, db_monitor.infospace_id, current_user.id)
    
    try:
        service.execute_monitor(monitor_id)
        return Message(message="Monitor execution triggered successfully.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to trigger monitor: {str(e)}")

# Additional CRUD endpoints for Monitors will be added here
# (GET, LIST, UPDATE, DELETE, EXECUTE) 