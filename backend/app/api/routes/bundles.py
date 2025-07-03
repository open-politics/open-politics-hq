from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session

from app.api import deps
from app.models import (
    Bundle,
    Asset
)
from app.schemas import (
    BundleCreate,
    BundleUpdate,
    BundleRead,
    AssetRead,
    Message,
)
from app.api.services.bundle_service import BundleService
from app.api.services.service_utils import validate_infospace_access

router = APIRouter()

@router.post("/infospaces/{infospace_id}/bundles", response_model=BundleRead, status_code=status.HTTP_201_CREATED)
def create_bundle(
    *,
    infospace_id: int,
    bundle_in: BundleCreate,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Create a new bundle in an infospace."""
    bundle = service.create_bundle(
        bundle_in=bundle_in,
        infospace_id=infospace_id,
        user_id=current_user.id
    )
    if not bundle:
        raise HTTPException(status_code=400, detail="Could not create bundle")
    return bundle

@router.get("/bundles/{bundle_id}", response_model=BundleRead)
def get_bundle(
    bundle_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Get a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)
    return bundle

@router.get("/infospaces/{infospace_id}/bundles", response_model=List[BundleRead])
def get_bundles(
    infospace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> List[Bundle]:
    """Get bundles for an infospace."""
    return service.get_bundles(
        infospace_id=infospace_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit
    )

@router.put("/bundles/{bundle_id}", response_model=BundleRead)
def update_bundle(
    *,
    bundle_id: int,
    bundle_in: BundleUpdate,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Update a bundle."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)
    
    bundle = service.update_bundle(
        bundle_id=bundle_id,
        bundle_in=bundle_in,
        infospace_id=bundle.infospace_id,
        user_id=current_user.id
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found or update failed")
    return bundle

@router.delete("/bundles/{bundle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bundle(
    bundle_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
):
    """Delete a bundle."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)
    
    success = service.delete_bundle(bundle_id=bundle_id, infospace_id=bundle.infospace_id, user_id=current_user.id)
    if not success:
        raise HTTPException(status_code=404, detail="Bundle not found during deletion attempt")
    return None

@router.post("/bundles/{bundle_id}/assets/{asset_id}", response_model=BundleRead, status_code=status.HTTP_200_OK)
def add_asset_to_bundle(
    *,
    bundle_id: int,
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Add an existing asset to a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)

    updated_bundle = service.add_asset_to_bundle(
        bundle_id=bundle_id,
        asset_id=asset_id,
        infospace_id=bundle.infospace_id,
        user_id=current_user.id
    )
    if not updated_bundle:
        raise HTTPException(status_code=404, detail="Failed to add asset to bundle. Asset may not exist or access denied.")
    return updated_bundle

@router.delete("/bundles/{bundle_id}/assets/{asset_id}", response_model=BundleRead, status_code=status.HTTP_200_OK)
def remove_asset_from_bundle(
    *,
    bundle_id: int,
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Remove an asset from a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)

    updated_bundle = service.remove_asset_from_bundle(
        bundle_id=bundle_id,
        asset_id=asset_id,
        infospace_id=bundle.infospace_id,
        user_id=current_user.id
    )
    if not updated_bundle:
        raise HTTPException(status_code=404, detail="Failed to remove asset from bundle. Asset may not be in bundle or access denied.")
    return updated_bundle

@router.get("/infospaces/{infospace_id}/bundles/{bundle_id}/assets", response_model=List[AssetRead])
def get_assets_in_bundle(
    bundle_id: int,
    infospace_id: int,
    service: BundleService = Depends(deps.get_bundle_service),
    current_user = Depends(deps.get_current_user),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
):
    """
    Get all assets within a specific bundle.
    """
    assets = service.get_assets_for_bundle(
        bundle_id=bundle_id,
        infospace_id=infospace_id,
        user_id=current_user.id,
        skip=skip,
        limit=limit
    )
    return assets

@router.get("/assets/{asset_id}", response_model=AssetRead)
def get_asset(
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Asset:
    """Get an asset by ID."""
    asset = db.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    validate_infospace_access(db, asset.infospace_id, current_user.id)
    return asset

@router.post("/bundles/{bundle_id}/transfer", response_model=BundleRead)
def transfer_bundle(
    *,
    bundle_id: int,
    target_infospace_id: int,
    copy: bool = True,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Transfer a bundle to another infospace."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    validate_infospace_access(db, bundle.infospace_id, current_user.id)

    bundle = service.transfer_bundle(
        bundle_id=bundle_id,
        user_id=current_user.id,
        source_infospace_id=bundle.infospace_id,
        target_infospace_id=target_infospace_id,
        copy=copy
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found or transfer failed")
    return bundle 