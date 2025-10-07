from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session
from pydantic import BaseModel

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
    BundleMoveRequest,
    BundleHierarchy,
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

class BulkDeleteBundlesRequest(BaseModel):
    bundle_ids: List[int]

@router.post("/bundles/bulk-delete", response_model=Message)
def bulk_delete_bundles(
    *,
    request: BulkDeleteBundlesRequest,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Message:
    """
    Delete multiple bundles in one request.
    
    More efficient than individual DELETE requests when cleaning up
    multiple bundles at once.
    """
    if not request.bundle_ids:
        return Message(message="No bundles to delete")
    
    deleted_count = 0
    failed_count = 0
    
    for bundle_id in request.bundle_ids:
        try:
            bundle = db.get(Bundle, bundle_id)
            if not bundle:
                failed_count += 1
                continue
            
            validate_infospace_access(db, bundle.infospace_id, current_user.id)
            
            success = service.delete_bundle(
                bundle_id=bundle_id,
                infospace_id=bundle.infospace_id,
                user_id=current_user.id
            )
            if success:
                deleted_count += 1
            else:
                failed_count += 1
        except Exception as e:
            logger.error(f"Failed to delete bundle {bundle_id}: {e}")
            failed_count += 1
    
    message = f"Deleted {deleted_count} bundle{'s' if deleted_count != 1 else ''}"
    if failed_count > 0:
        message += f" ({failed_count} failed)"
    
    return Message(message=message)

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
    """
    Transfer a bundle to another infospace.
    
    When copying (copy=True), both the bundle and all its assets are copied to the target infospace.
    When moving (copy=False), the bundle is moved but cross-infospace asset movement has limitations.
    
    Args:
        bundle_id: ID of bundle to transfer
        target_infospace_id: Target infospace ID
        copy: If True, copy bundle and all assets. If False, move bundle.
    """
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

@router.post("/bundles/{bundle_id}/move", response_model=BundleRead)
def move_bundle_to_parent(
    *,
    bundle_id: int,
    move_request: BundleMoveRequest,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> Bundle:
    """Move a bundle into another bundle or to root level."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    
    try:
        moved_bundle = service.move_bundle_to_parent(
            child_bundle_id=bundle_id,
            parent_bundle_id=move_request.parent_bundle_id,
            infospace_id=bundle.infospace_id,
            user_id=current_user.id
        )
        if not moved_bundle:
            raise HTTPException(status_code=404, detail="Bundle not found or move failed")
        return moved_bundle
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/bundles/{bundle_id}/hierarchy", response_model=BundleHierarchy)
def get_bundle_hierarchy(
    *,
    bundle_id: int,
    max_depth: int = Query(default=10, ge=1, le=20),
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> BundleHierarchy:
    """Get bundle with its complete child hierarchy."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found")
    
    hierarchy = service.get_bundle_hierarchy(
        bundle_id=bundle_id,
        infospace_id=bundle.infospace_id,
        user_id=current_user.id,
        max_depth=max_depth
    )
    if not hierarchy:
        raise HTTPException(status_code=404, detail="Bundle not found or access denied")
    return hierarchy

@router.get("/infospaces/{infospace_id}/bundles/root", response_model=List[BundleRead])
def get_root_bundles(
    *,
    infospace_id: int,
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> List[Bundle]:
    """Get all top-level bundles (those without parent bundles) in an infospace."""
    return service.get_root_bundles(
        infospace_id=infospace_id,
        user_id=current_user.id
    )

@router.get("/infospaces/{infospace_id}/bundles/bulk-assets", response_model=dict)
def get_bulk_bundle_assets(
    *,
    infospace_id: int,
    bundle_ids: str = Query(..., description="Comma-separated list of bundle IDs"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    db: Session = Depends(deps.get_db),
    current_user = Depends(deps.get_current_user),
    service: BundleService = Depends(deps.get_bundle_service)
) -> dict:
    """
    Get assets from multiple bundles in a single request.
    Returns a dictionary mapping bundle IDs to their assets.
    """
    # Parse comma-separated bundle IDs
    try:
        bundle_id_list = [int(bid.strip()) for bid in bundle_ids.split(',') if bid.strip()]
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid bundle IDs format")
    
    if not bundle_id_list:
        raise HTTPException(status_code=400, detail="No bundle IDs provided")
    
    if len(bundle_id_list) > 20:
        raise HTTPException(status_code=400, detail="Maximum 20 bundles per request")
    
    results = {}
    for bundle_id in bundle_id_list:
        # Verify bundle exists and user has access
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            results[bundle_id] = {
                "error": "Bundle not found",
                "assets": [],
                "total": 0
            }
            continue
        
        try:
            validate_infospace_access(db, bundle.infospace_id, current_user.id)
            assets = service.get_assets_for_bundle(
                bundle_id=bundle_id,
                infospace_id=infospace_id,
                user_id=current_user.id,
                skip=skip,
                limit=limit
            )
            results[bundle_id] = {
                "bundle_name": bundle.name,
                "assets": [AssetRead.model_validate(a) for a in assets],
                "total": bundle.asset_count,
                "shown": len(assets)
            }
        except Exception as e:
            results[bundle_id] = {
                "error": str(e),
                "assets": [],
                "total": 0
            }
    
    return results 