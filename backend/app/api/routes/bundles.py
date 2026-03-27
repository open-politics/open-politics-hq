import logging
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlmodel import Session
from sqlalchemy.exc import IntegrityError
from pydantic import BaseModel

from app.api import dependency_injection
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
from app.api.modules.content.services import BundleService
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires,
)
from app.core.tree import ROOT, copy as tree_copy, move as tree_move, delete as tree_delete, seal_subtree, unseal_subtree

logger = logging.getLogger(__name__)

router = APIRouter()

class MaterializeVfolderRequest(BaseModel):
    """Request body for materializing a virtual folder as a real bundle."""
    source_bundle_id: int
    path_prefix: str = ""
    name: str


@router.post("/infospaces/{infospace_id}/bundles/from-vfolder", response_model=BundleRead, status_code=status.HTTP_201_CREATED)
def materialize_virtual_folder(
    *,
    request: MaterializeVfolderRequest,
    access: Access = Requires(Capability.ORGANIZE),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Bundle:
    """Create a real bundle from a virtual folder (path prefix within a source bundle)."""
    try:
        bundle = service.materialize_virtual_folder(
            source_bundle_id=request.source_bundle_id,
            path_prefix=request.path_prefix,
            name=request.name,
            infospace_id=access.infospace_id,
            user_id=access.user_id,
        )
        return bundle
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.post("/infospaces/{infospace_id}/bundles", response_model=BundleRead, status_code=status.HTTP_201_CREATED)
def create_bundle(
    *,
    bundle_in: BundleCreate,
    access: Access = Requires(Capability.ORGANIZE),
    service: BundleService = Depends(dependency_injection.get_bundle_service)
) -> Bundle:
    """Create a new bundle in an infospace."""
    try:
        bundle = service.create_bundle(
            bundle_in=bundle_in,
            infospace_id=access.infospace_id,
            user_id=access.user_id
        )
    except IntegrityError:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f'A bundle named "{bundle_in.name}" already exists in this infospace.',
        )
    if not bundle:
        raise HTTPException(status_code=400, detail="Could not create bundle")

    # Kick background population if a source_query was provided
    if bundle.bundle_metadata and bundle.bundle_metadata.get("source_query"):
        from app.api.modules.content.tasks.bundle_populate import populate_bundle_from_query
        populate_bundle_from_query.delay([bundle.id], access.infospace_id)

    return bundle

@router.get("/infospaces/{infospace_id}/bundles/{bundle_id}", response_model=BundleRead)
def get_bundle(
    bundle_id: int,
    access: Access = Requires(),
    db: Session = Depends(dependency_injection.get_db),
) -> Bundle:
    """Get a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")
    access.require_in_scope("bundle_ids", bundle_id)
    return bundle

@router.get("/infospaces/{infospace_id}/bundles", response_model=List[BundleRead])
def get_bundles(
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
    access: Access = Requires(),
    service: BundleService = Depends(dependency_injection.get_bundle_service)
) -> List[Bundle]:
    """Get bundles for an infospace."""
    bundles = service.get_bundles(
        infospace_id=access.infospace_id,
        user_id=access.user_id,
        skip=skip,
        limit=limit
    )
    if access.scope is not None:
        visible = set(access.scope.bundle_ids)
        bundles = [b for b in bundles if b.id in visible]
    return bundles

@router.put("/infospaces/{infospace_id}/bundles/{bundle_id}", response_model=BundleRead)
def update_bundle(
    *,
    bundle_id: int,
    bundle_in: BundleUpdate,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Bundle:
    """Update a bundle."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    bundle = service.update_bundle(
        bundle_id=bundle_id,
        bundle_in=bundle_in,
        infospace_id=access.infospace_id,
        user_id=access.user_id,
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found or update failed")
    return bundle

@router.delete("/infospaces/{infospace_id}/bundles/{bundle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_bundle(
    bundle_id: int,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
):
    """Delete a bundle."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    try:
        tree_delete(db, bundle_ids=[bundle_id], out_of=bundle.parent_bundle_id, confirm=True)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

class BulkDeleteBundlesRequest(BaseModel):
    bundle_ids: List[int]

@router.post("/infospaces/{infospace_id}/bundles/bulk-delete", response_model=Message)
def bulk_delete_bundles(
    *,
    request: BulkDeleteBundlesRequest,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Message:
    """
    Delete multiple bundles in one request.
    Expands all requested bundles through descendants via core.tree.delete.
    """
    if not request.bundle_ids:
        return Message(message="No bundles to delete")

    # Validate all requested bundles belong to this infospace
    valid_ids: set[int] = set()
    failed_count = 0
    for bundle_id in request.bundle_ids:
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != access.infospace_id:
            failed_count += 1
            continue
        valid_ids.add(bundle_id)

    try:
        result = tree_delete(db, bundle_ids=list(valid_ids), out_of=ROOT, confirm=True)
        db.commit()
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    message = result.message
    if failed_count > 0:
        message += f" ({failed_count} not found)"

    return Message(message=message)

@router.post("/infospaces/{infospace_id}/bundles/{bundle_id}/assets/{asset_id}", response_model=BundleRead, status_code=status.HTTP_200_OK)
def add_asset_to_bundle(
    *,
    bundle_id: int,
    asset_id: int,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Bundle:
    """Add an existing asset to a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")
    asset = db.get(Asset, asset_id)
    if not asset or asset.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Asset not found")

    try:
        tree_copy(db, asset_ids=[asset_id], to=bundle_id)
        db.commit()
        db.refresh(bundle)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return bundle

@router.delete("/infospaces/{infospace_id}/bundles/{bundle_id}/assets/{asset_id}", response_model=BundleRead, status_code=status.HTTP_200_OK)
def remove_asset_from_bundle(
    *,
    bundle_id: int,
    asset_id: int,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Bundle:
    """Remove an asset from a bundle by ID."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    try:
        tree_delete(db, asset_ids=[asset_id], out_of=bundle_id, confirm=True)
        db.commit()
        db.refresh(bundle)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return bundle

@router.get("/infospaces/{infospace_id}/bundles/{bundle_id}/assets", response_model=List[AssetRead])
def get_assets_in_bundle(
    bundle_id: int,
    access: Access = Requires(),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1, le=100),
):
    """
    Get all assets within a specific bundle.
    """
    access.require_in_scope("bundle_ids", bundle_id)
    assets = service.get_assets_for_bundle(
        bundle_id=bundle_id,
        infospace_id=access.infospace_id,
        user_id=access.user_id,
        skip=skip,
        limit=limit
    )
    return assets


@router.post("/infospaces/{infospace_id}/bundles/{bundle_id}/transfer", response_model=BundleRead)
def transfer_bundle(
    *,
    bundle_id: int,
    target_infospace_id: int,
    copy: bool = True,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
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
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    bundle = service.transfer_bundle(
        bundle_id=bundle_id,
        user_id=access.user_id,
        source_infospace_id=access.infospace_id,
        target_infospace_id=target_infospace_id,
        copy=copy,
    )
    if not bundle:
        raise HTTPException(status_code=404, detail="Bundle not found or transfer failed")
    return bundle

@router.post("/infospaces/{infospace_id}/bundles/{bundle_id}/move", response_model=BundleRead)
def move_bundle_to_parent(
    *,
    bundle_id: int,
    move_request: BundleMoveRequest,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> Bundle:
    """Move a bundle into another bundle or to root level."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    target = move_request.parent_bundle_id if move_request.parent_bundle_id is not None else ROOT
    try:
        tree_move(db, bundle_ids=[bundle_id], out_of=bundle.parent_bundle_id, to=target)
        db.commit()
        db.refresh(bundle)
        return bundle
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/infospaces/{infospace_id}/bundles/{bundle_id}/hierarchy", response_model=BundleHierarchy)
def get_bundle_hierarchy(
    *,
    bundle_id: int,
    max_depth: int = Query(default=10, ge=1, le=20),
    access: Access = Requires(),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service),
) -> BundleHierarchy:
    """Get bundle with its complete child hierarchy."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")

    hierarchy = service.get_bundle_hierarchy(
        bundle_id=bundle_id,
        infospace_id=access.infospace_id,
        user_id=access.user_id,
        max_depth=max_depth,
    )
    if not hierarchy:
        raise HTTPException(status_code=404, detail="Bundle not found or access denied")
    return hierarchy

@router.get("/infospaces/{infospace_id}/bundles/root", response_model=List[BundleRead])
def get_root_bundles(
    *,
    access: Access = Requires(),
    service: BundleService = Depends(dependency_injection.get_bundle_service)
) -> List[Bundle]:
    """Get all top-level bundles (those without parent bundles) in an infospace."""
    bundles = service.get_root_bundles(
        infospace_id=access.infospace_id,
        user_id=access.user_id
    )
    if access.scope is not None:
        visible = set(access.scope.bundle_ids)
        bundles = [b for b in bundles if b.id in visible]
    return bundles

@router.get("/infospaces/{infospace_id}/bundles/bulk-assets", response_model=dict)
def get_bulk_bundle_assets(
    *,
    bundle_ids: str = Query(..., description="Comma-separated list of bundle IDs"),
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=100),
    access: Access = Requires(),
    db: Session = Depends(dependency_injection.get_db),
    service: BundleService = Depends(dependency_injection.get_bundle_service)
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

    # Scope filter: restrict to visible bundles
    if access.scope is not None:
        visible = set(access.scope.bundle_ids)
        bundle_id_list = [bid for bid in bundle_id_list if bid in visible]

    results = {}
    for bundle_id in bundle_id_list:
        bundle = db.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != access.infospace_id:
            results[bundle_id] = {
                "error": "Bundle not found",
                "assets": [],
                "total": 0
            }
            continue

        try:
            assets = service.get_assets_for_bundle(
                bundle_id=bundle_id,
                infospace_id=access.infospace_id,
                user_id=access.user_id,
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


@router.post("/infospaces/{infospace_id}/bundles/{bundle_id}/seal", response_model=Message)
def seal_bundle(
    *,
    bundle_id: int,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
) -> Message:
    """Seal a bundle and all descendants. Immutable membership after sealing."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")
    count = seal_subtree(db, bundle_id)
    db.commit()
    return Message(message=f"Sealed {count} bundles.")


@router.post("/infospaces/{infospace_id}/bundles/{bundle_id}/unseal", response_model=Message)
def unseal_bundle(
    *,
    bundle_id: int,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
) -> Message:
    """Unseal a bundle and all descendants. Rejects if active packages reference the subtree."""
    bundle = db.get(Bundle, bundle_id)
    if not bundle or bundle.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="Bundle not found")
    try:
        count = unseal_subtree(db, bundle_id)
        db.commit()
        return Message(message=f"Unsealed {count} bundles.")
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))