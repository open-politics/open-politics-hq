"""BundleView CRUD - lightweight named subsets of a bundle."""

from datetime import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlmodel import Session, select

from app.api import dependency_injection
from app.models import BundleView, Bundle
from app.api.global_utils import validate_infospace_access
from pydantic import BaseModel

router = APIRouter()


class BundleViewCreate(BaseModel):
    name: str
    source_bundle_id: int
    path_prefix: str = ""


class BundleViewUpdate(BaseModel):
    name: Optional[str] = None
    path_prefix: Optional[str] = None


class BundleViewRead(BaseModel):
    id: int
    uuid: str
    name: str
    source_bundle_id: int
    path_prefix: str
    infospace_id: int
    user_id: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


@router.post("/infospaces/{infospace_id}/bundle-views", response_model=BundleViewRead, status_code=status.HTTP_201_CREATED)
def create_bundle_view(
    *,
    infospace_id: int,
    view_in: BundleViewCreate,
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user),
):
    """Create a BundleView (named subset of a bundle)."""
    validate_infospace_access(db, infospace_id, current_user.id, require_editor=True)
    bundle = db.get(Bundle, view_in.source_bundle_id)
    if not bundle or bundle.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Source bundle not found")
    view = BundleView(
        name=view_in.name,
        source_bundle_id=view_in.source_bundle_id,
        path_prefix=view_in.path_prefix or "",
        infospace_id=infospace_id,
        user_id=current_user.id,
    )
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


@router.get("/infospaces/{infospace_id}/bundle-views", response_model=List[BundleViewRead])
def list_bundle_views(
    infospace_id: int,
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user),
):
    """List BundleViews in an infospace."""
    validate_infospace_access(db, infospace_id, current_user.id)
    stmt = select(BundleView).where(BundleView.infospace_id == infospace_id)
    views = list(db.exec(stmt).all())
    return views


@router.get("/bundle-views/{view_id}", response_model=BundleViewRead)
def get_bundle_view(
    view_id: int,
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user),
):
    """Get a BundleView by ID."""
    view = db.get(BundleView, view_id)
    if not view:
        raise HTTPException(status_code=404, detail="BundleView not found")
    validate_infospace_access(db, view.infospace_id, current_user.id)
    return view


@router.put("/bundle-views/{view_id}", response_model=BundleViewRead)
def update_bundle_view(
    *,
    view_id: int,
    view_in: BundleViewUpdate,
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user),
):
    """Update a BundleView."""
    view = db.get(BundleView, view_id)
    if not view:
        raise HTTPException(status_code=404, detail="BundleView not found")
    validate_infospace_access(db, view.infospace_id, current_user.id, require_editor=True)
    if view_in.name is not None:
        view.name = view_in.name
    if view_in.path_prefix is not None:
        view.path_prefix = view_in.path_prefix
    db.add(view)
    db.commit()
    db.refresh(view)
    return view


@router.delete("/bundle-views/{view_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bundle_view(
    view_id: int,
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user),
):
    """Delete a BundleView."""
    view = db.get(BundleView, view_id)
    if not view:
        raise HTTPException(status_code=404, detail="BundleView not found")
    validate_infospace_access(db, view.infospace_id, current_user.id, require_editor=True)
    db.delete(view)
    db.commit()
