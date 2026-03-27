"""
Package CRUD Routes
===================

Endpoints for creating, managing, and discovering packages.
Packages are the universal sharing primitive — curated selections of items
from an infospace with per-item download/copy controls.

See FOUNDATION.md § Access Control and OVERVIEW.md § Access Control.
"""

import asyncio
import logging
import mimetypes
import os
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Any, List, Optional

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, status
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlmodel import Session, select

from app.api import dependency_injection
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, _resolve_package_token,
)
from app.api.modules.sharing.models import Package, PackageItem, PackageVisibility

logger = logging.getLogger(__name__)

router = APIRouter()


# ─── Request/Response schemas ───

class PackageItemCreate(BaseModel):
    """Exactly one of the ID fields must be set."""
    bundle_id: Optional[int] = None
    run_id: Optional[int] = None
    graph_id: Optional[int] = None
    schema_id: Optional[int] = None
    asset_id: Optional[int] = None
    entity_canonical_id: Optional[int] = None
    allow_download: Optional[bool] = None
    allow_copy: Optional[bool] = None


class PackageCreate(BaseModel):
    name: str
    description: Optional[str] = None
    visibility: str = Field(default="token", description="token, internal, or public")
    default_allow_download: bool = False
    default_allow_copy: bool = False
    expires_at: Optional[datetime] = None
    items: List[PackageItemCreate] = []


class PackageUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    visibility: Optional[str] = None
    default_allow_download: Optional[bool] = None
    default_allow_copy: Optional[bool] = None
    is_active: Optional[bool] = None
    expires_at: Optional[datetime] = None


class PackageItemRead(BaseModel):
    id: int
    resource_type: str
    resource_id: int
    allow_download: Optional[bool]
    allow_copy: Optional[bool]

    model_config = {"from_attributes": True}


class PackageRead(BaseModel):
    id: int
    uuid: str
    name: str
    description: Optional[str]
    token: str
    visibility: str
    infospace_id: int
    user_id: Optional[int]
    default_allow_download: bool
    default_allow_copy: bool
    is_active: bool
    expires_at: Optional[Any] = None
    created_at: Any
    items: List[PackageItemRead] = []

    model_config = {"from_attributes": True}


class PackagePublicRead(BaseModel):
    """Public-facing package info (no token exposed)."""
    uuid: str
    name: str
    description: Optional[str]
    visibility: str
    item_count: int
    created_at: str


# ─── Routes ───

@router.post(
    "/infospaces/{infospace_id}/packages",
    response_model=PackageRead,
    status_code=status.HTTP_201_CREATED,
)
def create_package(
    *,
    infospace_id: int,
    body: PackageCreate,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Create a new package in an infospace. Requires organize capability (curator+)."""
    pkg = Package(
        name=body.name,
        description=body.description,
        visibility=body.visibility,
        default_allow_download=body.default_allow_download,
        default_allow_copy=body.default_allow_copy,
        expires_at=body.expires_at,
        infospace_id=infospace_id,
        user_id=access.user_id,
    )
    db.add(pkg)
    db.flush()

    for item in body.items:
        db.add(PackageItem(
            package_id=pkg.id,
            bundle_id=item.bundle_id,
            run_id=item.run_id,
            graph_id=item.graph_id,
            schema_id=item.schema_id,
            asset_id=item.asset_id,
            entity_canonical_id=item.entity_canonical_id,
            allow_download=item.allow_download,
            allow_copy=item.allow_copy,
        ))

    db.commit()
    db.refresh(pkg)
    logger.info(f"Package '{pkg.name}' created (id={pkg.id}, token={pkg.token[:8]}...)")
    return pkg


@router.get("/infospaces/{infospace_id}/packages", response_model=List[PackageRead])
def list_packages(
    *,
    infospace_id: int,
    access: Access = Requires(),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """List packages in an infospace. Scoped users cannot enumerate packages."""
    if access.scope:
        return []
    packages = db.exec(
        select(Package)
        .where(Package.infospace_id == infospace_id, Package.is_active == True)
        .order_by(Package.created_at.desc())
    ).all()
    return list(packages)


@router.get("/infospaces/{infospace_id}/packages/{package_id}", response_model=PackageRead)
def get_package(
    *,
    infospace_id: int,
    package_id: int,
    access: Access = Requires(),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Get a package by ID. Scoped users cannot view package details."""
    if access.scope:
        raise HTTPException(status_code=404, detail="Not found")
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")
    return pkg


@router.put("/infospaces/{infospace_id}/packages/{package_id}", response_model=PackageRead)
def update_package(
    *,
    infospace_id: int,
    package_id: int,
    body: PackageUpdate,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Update a package. Requires organize capability."""
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")

    update_data = body.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(pkg, field, value)

    db.add(pkg)
    db.commit()
    db.refresh(pkg)
    return pkg


@router.delete(
    "/infospaces/{infospace_id}/packages/{package_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_package(
    *,
    infospace_id: int,
    package_id: int,
    access: Access = Requires(Capability.DELETE),
    db: Session = Depends(dependency_injection.get_db),
) -> None:
    """Delete a package. Requires delete capability."""
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")

    db.delete(pkg)  # Cascade deletes PackageItems
    db.commit()


# ─── Package items ───

@router.post(
    "/infospaces/{infospace_id}/packages/{package_id}/items",
    response_model=PackageItemRead,
    status_code=status.HTTP_201_CREATED,
)
def add_package_item(
    *,
    infospace_id: int,
    package_id: int,
    body: PackageItemCreate,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Add an item to a package. Requires organize capability."""
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")

    item = PackageItem(
        package_id=pkg.id,
        bundle_id=body.bundle_id,
        run_id=body.run_id,
        graph_id=body.graph_id,
        schema_id=body.schema_id,
        asset_id=body.asset_id,
        entity_canonical_id=body.entity_canonical_id,
        allow_download=body.allow_download,
        allow_copy=body.allow_copy,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.delete(
    "/infospaces/{infospace_id}/packages/{package_id}/items/{item_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def remove_package_item(
    *,
    infospace_id: int,
    package_id: int,
    item_id: int,
    access: Access = Requires(Capability.ORGANIZE),
    db: Session = Depends(dependency_injection.get_db),
) -> None:
    """Remove an item from a package."""
    item = db.get(PackageItem, item_id)
    if not item or item.package_id != package_id:
        raise HTTPException(status_code=404, detail="Item not found")

    # Verify package belongs to infospace
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")

    db.delete(item)
    db.commit()


# ─── Discovery (no infospace_id required) ───

@router.get("/packages/discover", response_model=List[PackagePublicRead])
def discover_packages(
    *,
    visibility: str = Query("public", description="Filter: 'public' or 'internal'"),
    limit: int = Query(50, ge=1, le=200),
    db: Session = Depends(dependency_injection.get_db),
    current_user=Depends(dependency_injection.get_current_user_optional),
) -> Any:
    """
    Discover packages by visibility level.

    - PUBLIC packages: visible to everyone (no auth required).
    - INTERNAL packages: visible to any authenticated user on the instance.

    Packages from private infospaces are never shown unless the user is
    an owner or collaborator of that infospace.
    """
    from app.models import Infospace, InfospaceCollaborator

    query = select(Package).where(Package.is_active == True)

    if visibility == "public":
        query = query.where(Package.visibility == "public")
    elif visibility == "internal":
        if not current_user:
            raise HTTPException(status_code=401, detail="Authentication required for internal packages")
        query = query.where(Package.visibility.in_(["internal", "public"]))
    else:
        raise HTTPException(status_code=400, detail="visibility must be 'public' or 'internal'")

    # Security: filter out packages from private infospaces the user cannot access
    query = query.join(Infospace, Package.infospace_id == Infospace.id)
    if current_user:
        query = query.where(
            (Infospace.visibility.in_(["internal", "public"]))
            | (Infospace.owner_id == current_user.id)
            | (Infospace.id.in_(
                select(InfospaceCollaborator.infospace_id).where(
                    InfospaceCollaborator.user_id == current_user.id
                )
            ))
        )
    else:
        query = query.where(Infospace.visibility == "public")

    packages = db.exec(query.order_by(Package.created_at.desc()).limit(limit)).all()

    return [
        PackagePublicRead(
            uuid=pkg.uuid,
            name=pkg.name,
            description=pkg.description,
            visibility=pkg.visibility,
            item_count=len(pkg.items) if pkg.items else 0,
            created_at=str(pkg.created_at),
        )
        for pkg in packages
    ]


@router.get("/p/{token}")
def access_package_by_token(
    *,
    token: str,
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """
    Access a package by its token. This is the external-facing URL for shared packages.
    Returns package metadata and item list (without exposing the token again).
    """
    pkg = db.exec(
        select(Package).where(Package.token == token, Package.is_active == True)
    ).first()

    if not pkg:
        raise HTTPException(status_code=404, detail="Not found")

    if pkg.is_expired:
        raise HTTPException(status_code=410, detail="This package has expired")

    items = db.exec(
        select(PackageItem).where(PackageItem.package_id == pkg.id)
    ).all()

    return {
        "uuid": pkg.uuid,
        "name": pkg.name,
        "description": pkg.description,
        "infospace_id": pkg.infospace_id,
        "infospace_name": pkg.infospace.name if pkg.infospace else None,
        "items": [
            {
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
                "resource_name": _resolve_resource_name(db, item),
                "allow_download": item.effective_allow_download(),
                "allow_copy": item.effective_allow_copy(),
            }
            for item in items
        ],
    }


def _resolve_resource_name(db: Session, item: PackageItem) -> Optional[str]:
    """Resolve the display name for a PackageItem's target resource."""
    _queries = {
        "bundle": ("bundle", "name", "bundle_id"),
        "run": ("annotationrun", "name", "run_id"),
        "graph": ("knowledgegraph", "name", "graph_id"),
        "schema": ("annotationschema", "name", "schema_id"),
        "asset": ("asset", "title", "asset_id"),
        "entity": ("entitycanonical", "name", "entity_canonical_id"),
    }
    rtype = item.resource_type
    if rtype not in _queries:
        return None
    table, col, fk_attr = _queries[rtype]
    rid = getattr(item, fk_attr)
    if not rid:
        return None
    row = db.execute(text(f"SELECT {col} FROM {table} WHERE id = :id"), {"id": rid}).first()
    return row[0] if row else None


def _validate_package_token(db: Session, token: str) -> Package:
    """Validate a package token: must be active and not expired. Returns the package."""
    pkg = db.exec(
        select(Package).where(Package.token == token, Package.is_active == True)
    ).first()
    if not pkg:
        raise HTTPException(status_code=404, detail="Not found")
    if pkg.is_expired:
        raise HTTPException(status_code=410, detail="This package has expired")
    return pkg


# ─── Package file access (token-based) ───

@router.get("/p/{token}/assets/{asset_id}/stream")
async def stream_package_asset(
    *,
    token: str,
    asset_id: int,
    db: Session = Depends(dependency_injection.get_db),
    storage_provider=Depends(dependency_injection.get_storage_provider_dependency),
) -> StreamingResponse:
    """Stream an asset file through a package token. Enforces allow_download."""
    from app.api.modules.content.models import Asset

    pkg = _validate_package_token(db, token)
    scope = _resolve_package_token(db, pkg.infospace_id, token)
    if scope is None:
        raise HTTPException(status_code=404, detail="Not found")

    # Visibility check
    if asset_id not in scope.asset_ids:
        # Also check bundle-derived assets
        bundle_asset = db.execute(
            text("SELECT 1 FROM asset WHERE id = :aid AND bundle_ids && CAST(:bids AS int[])"),
            {"aid": asset_id, "bids": list(scope.bundle_ids) if scope.bundle_ids else []},
        ).first()
        if not bundle_asset:
            raise HTTPException(status_code=404, detail="Not found")

    # Permission check
    if asset_id not in scope.downloadable_asset_ids:
        raise HTTPException(status_code=403, detail="Download not allowed for this item")

    asset = db.get(Asset, asset_id)
    if not asset or not asset.blob_path:
        raise HTTPException(status_code=404, detail="Asset has no downloadable file")

    try:
        file_obj = await storage_provider.get_file(asset.blob_path)
        filename = (asset.file_info or {}).get("original_filename") or \
                   (asset.file_info or {}).get("filename") or \
                   Path(asset.blob_path).name
        media_type, _ = mimetypes.guess_type(filename)
        media_type = media_type or "application/octet-stream"
        return StreamingResponse(file_obj, media_type=media_type)
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found in storage")
    except Exception as e:
        logger.error(f"Failed to stream package asset: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not retrieve file")


@router.get("/p/{token}/assets/{asset_id}/download", response_class=FileResponse)
async def download_package_asset(
    *,
    token: str,
    asset_id: int,
    db: Session = Depends(dependency_injection.get_db),
    storage_provider=Depends(dependency_injection.get_storage_provider_dependency),
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Download an asset file through a package token. Enforces allow_download."""
    from app.api.modules.content.models import Asset

    pkg = _validate_package_token(db, token)
    scope = _resolve_package_token(db, pkg.infospace_id, token)
    if scope is None:
        raise HTTPException(status_code=404, detail="Not found")

    # Visibility check — asset must be in scope (direct, bundle, or run-derived)
    if asset_id not in scope.asset_ids:
        bundle_asset = db.execute(
            text("SELECT 1 FROM asset WHERE id = :aid AND bundle_ids && CAST(:bids AS int[])"),
            {"aid": asset_id, "bids": list(scope.bundle_ids) if scope.bundle_ids else []},
        ).first()
        if not bundle_asset:
            raise HTTPException(status_code=404, detail="Not found")

    # Permission check
    if asset_id not in scope.downloadable_asset_ids:
        raise HTTPException(status_code=403, detail="Download not allowed for this item")

    asset = db.get(Asset, asset_id)
    if not asset or not asset.blob_path:
        raise HTTPException(status_code=404, detail="Asset has no downloadable file")

    try:
        file_obj = await storage_provider.get_file(asset.blob_path)
        content = await asyncio.to_thread(file_obj.read)
        if hasattr(file_obj, "close"):
            await asyncio.to_thread(file_obj.close)

        filename = (asset.file_info or {}).get("original_filename") or \
                   (asset.file_info or {}).get("filename") or \
                   Path(asset.blob_path).name

        tmp = tempfile.NamedTemporaryFile(delete=False, suffix=Path(filename).suffix)
        tmp.write(content)
        tmp.close()

        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(path=tmp.name, filename=filename, media_type="application/octet-stream")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="File not found in storage")
    except Exception as e:
        logger.error(f"Failed to download package asset: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not retrieve file")


@router.get("/p/{token}/export", response_class=FileResponse)
async def export_package(
    *,
    token: str,
    db: Session = Depends(dependency_injection.get_db),
    storage_provider=Depends(dependency_injection.get_storage_provider_dependency),
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Export all downloadable assets in a package as a ZIP archive."""
    import zipfile

    pkg = _validate_package_token(db, token)
    scope = _resolve_package_token(db, pkg.infospace_id, token)
    if scope is None:
        raise HTTPException(status_code=404, detail="Not found")

    if not scope.downloadable_asset_ids:
        raise HTTPException(status_code=404, detail="No downloadable items in this package")

    from app.api.modules.content.models import Asset

    assets = db.exec(
        select(Asset).where(Asset.id.in_(scope.downloadable_asset_ids))
    ).all()
    assets_with_blobs = [a for a in assets if a.blob_path]

    if not assets_with_blobs:
        raise HTTPException(status_code=404, detail="No files available for download")

    tmp_zip = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp_zip.close()

    try:
        with zipfile.ZipFile(tmp_zip.name, "w", zipfile.ZIP_DEFLATED) as zf:
            for asset in assets_with_blobs:
                try:
                    file_obj = await storage_provider.get_file(asset.blob_path)
                    content = await asyncio.to_thread(file_obj.read)
                    if hasattr(file_obj, "close"):
                        await asyncio.to_thread(file_obj.close)

                    filename = (asset.file_info or {}).get("original_filename") or \
                               (asset.file_info or {}).get("filename") or \
                               Path(asset.blob_path).name
                    zf.writestr(filename, content)
                except Exception as e:
                    logger.warning(f"Skipping asset {asset.id} in export: {e}")

        background_tasks.add_task(os.unlink, tmp_zip.name)
        return FileResponse(
            path=tmp_zip.name,
            filename=f"{pkg.name or 'package'}.zip",
            media_type="application/zip",
        )
    except Exception as e:
        os.unlink(tmp_zip.name)
        logger.error(f"Failed to export package: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not create export")
