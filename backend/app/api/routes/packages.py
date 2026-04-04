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


# ─── Item FK validation ───
# Maps each PackageItem FK field to its (model_class, infospace_fk_attr) pair.
# All six resource models carry infospace_id directly.

_ITEM_FK_VALIDATORS: dict[str, tuple] = {}  # populated lazily to avoid circular imports


def _get_item_fk_validators() -> dict[str, tuple]:
    """Lazy-load the FK validator mapping to avoid circular imports at module level."""
    global _ITEM_FK_VALIDATORS
    if _ITEM_FK_VALIDATORS:
        return _ITEM_FK_VALIDATORS
    from app.api.modules.content.models import Asset, Bundle
    from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema
    from app.api.modules.graph.models import EntityCanonical, KnowledgeGraph
    _ITEM_FK_VALIDATORS = {
        "bundle_id": (Bundle, "infospace_id"),
        "run_id": (AnnotationRun, "infospace_id"),
        "schema_id": (AnnotationSchema, "infospace_id"),
        "asset_id": (Asset, "infospace_id"),
        "graph_id": (KnowledgeGraph, "infospace_id"),
        "entity_canonical_id": (EntityCanonical, "infospace_id"),
    }
    return _ITEM_FK_VALIDATORS


def _validate_item_belongs_to_infospace(
    db: Session, body, infospace_id: int
) -> None:
    """Assert that the referenced resource exists and belongs to the infospace.

    Raises HTTPException(404) if the resource is missing or from another infospace.
    """
    for fk_field, (model_cls, iid_attr) in _get_item_fk_validators().items():
        resource_id = getattr(body, fk_field, None)
        if resource_id is None:
            continue
        entity = db.get(model_cls, resource_id)
        if not entity or getattr(entity, iid_attr) != infospace_id:
            resource_label = fk_field.replace("_id", "").replace("_", " ").title()
            raise HTTPException(status_code=404, detail=f"{resource_label} not found in this infospace")

# ─── Derived item expansion ───
# When a user adds a run/bundle/graph, structural dependencies are auto-materialized
# as derived PackageItems with provenance. Only structural items (not assets).


class DerivationType:
    BUNDLE_SUBTREE = "bundle_subtree"
    RUN_SCHEMA = "run_schema"
    GRAPH_RUN = "graph_run"


def _derived_exists(
    db: Session, package_id: int, derived_from: int, **fk_kwargs
) -> bool:
    """Check if a derived item already exists for this parent+resource combination."""
    q = select(PackageItem.id).where(
        PackageItem.package_id == package_id,
        PackageItem.derived_from_item_id == derived_from,
    )
    for fk_name, fk_val in fk_kwargs.items():
        q = q.where(getattr(PackageItem, fk_name) == fk_val)
    return db.exec(q).first() is not None


def _expand_derived_items(db: Session, parent_item: PackageItem) -> list:
    """Compute and insert derived items for a newly-persisted PackageItem.

    Derivation rules (structural only — not individual assets):
      bundle → child bundles via subtree_ids
      run    → schemas via RunSchemaLink
      graph  → runs via GraphEdge→Annotation, then chain run→schemas
    """
    derived = []

    if parent_item.bundle_id is not None:
        from app.core.tree import subtree_ids
        all_ids = subtree_ids(db, {parent_item.bundle_id})
        child_ids = all_ids - {parent_item.bundle_id}
        for bid in child_ids:
            if not _derived_exists(db, parent_item.package_id, parent_item.id, bundle_id=bid):
                item = PackageItem(
                    package_id=parent_item.package_id,
                    bundle_id=bid,
                    derived_from_item_id=parent_item.id,
                    derivation_type=DerivationType.BUNDLE_SUBTREE,
                )
                db.add(item)
                derived.append(item)

    elif parent_item.run_id is not None:
        from app.api.modules.annotation.models import RunSchemaLink
        schema_rows = db.exec(
            select(RunSchemaLink.schema_id).where(RunSchemaLink.run_id == parent_item.run_id)
        ).all()
        for sid in schema_rows:
            if not _derived_exists(db, parent_item.package_id, parent_item.id, schema_id=sid):
                item = PackageItem(
                    package_id=parent_item.package_id,
                    schema_id=sid,
                    derived_from_item_id=parent_item.id,
                    derivation_type=DerivationType.RUN_SCHEMA,
                )
                db.add(item)
                derived.append(item)

    elif parent_item.graph_id is not None:
        from app.api.modules.graph.models import GraphEdge
        from app.api.modules.annotation.models import Annotation, RunSchemaLink
        run_rows = db.exec(
            select(Annotation.run_id).where(
                Annotation.id.in_(
                    select(GraphEdge.annotation_id).where(
                        GraphEdge.graph_id == parent_item.graph_id
                    )
                )
            ).distinct()
        ).all()
        run_ids = {r for r in run_rows if r is not None}
        for rid in run_ids:
            if not _derived_exists(db, parent_item.package_id, parent_item.id, run_id=rid):
                run_item = PackageItem(
                    package_id=parent_item.package_id,
                    run_id=rid,
                    derived_from_item_id=parent_item.id,
                    derivation_type=DerivationType.GRAPH_RUN,
                )
                db.add(run_item)
                db.flush()  # need run_item.id for chained expansion
                derived.append(run_item)
                # Chain: derived run → schemas
                derived.extend(_expand_derived_items(db, run_item))

    return derived


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
    resource_name: Optional[str] = None
    resource_kind: Optional[str] = None
    allow_download: Optional[bool]
    allow_copy: Optional[bool]
    derived_from_item_id: Optional[int] = None
    derivation_type: Optional[str] = None

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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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

    for item_body in body.items:
        _validate_item_belongs_to_infospace(db, item_body, infospace_id)
        pkg_item = PackageItem(
            package_id=pkg.id,
            bundle_id=item_body.bundle_id,
            run_id=item_body.run_id,
            graph_id=item_body.graph_id,
            schema_id=item_body.schema_id,
            asset_id=item_body.asset_id,
            entity_canonical_id=item_body.entity_canonical_id,
            allow_download=item_body.allow_download,
            allow_copy=item_body.allow_copy,
        )
        db.add(pkg_item)
        db.flush()
        _expand_derived_items(db, pkg_item)

    db.commit()
    db.refresh(pkg)
    logger.info(f"Package '{pkg.name}' created (id={pkg.id}, token={pkg.token[:8]}...)")
    return _enrich_package(db, pkg)


@router.get("/infospaces/{infospace_id}/packages", response_model=List[PackageRead])
def list_packages(
    *,
    infospace_id: int,
    access: Access = Requires(scope=None),
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
    return [_enrich_package(db, pkg) for pkg in packages]


@router.get("/infospaces/{infospace_id}/packages/{package_id}", response_model=PackageRead)
def get_package(
    *,
    infospace_id: int,
    package_id: int,
    access: Access = Requires(scope=None),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Get a package by ID. Scoped users cannot view package details."""
    if access.scope:
        raise HTTPException(status_code=404, detail="Not found")
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")
    return _enrich_package(db, pkg)


@router.put("/infospaces/{infospace_id}/packages/{package_id}", response_model=PackageRead)
def update_package(
    *,
    infospace_id: int,
    package_id: int,
    body: PackageUpdate,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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
    return _enrich_package(db, pkg)


@router.delete(
    "/infospaces/{infospace_id}/packages/{package_id}",
    status_code=status.HTTP_204_NO_CONTENT,
)
def delete_package(
    *,
    infospace_id: int,
    package_id: int,
    access: Access = Requires(Capability.DELETE, scope=None),
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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    db: Session = Depends(dependency_injection.get_db),
) -> Any:
    """Add an item to a package. Requires organize capability."""
    pkg = db.get(Package, package_id)
    if not pkg or pkg.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Package not found")

    _validate_item_belongs_to_infospace(db, body, infospace_id)

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
    db.flush()
    _expand_derived_items(db, item)
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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
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
                "id": item.id,
                "resource_type": item.resource_type,
                "resource_id": item.resource_id,
                "resource_name": _resolve_resource_name(db, item),
                "resource_kind": _resolve_resource_kind(db, item),
                "allow_download": item.effective_allow_download(),
                "allow_copy": item.effective_allow_copy(),
                "derived_from_item_id": item.derived_from_item_id,
                "derivation_type": item.derivation_type,
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


def _resolve_resource_kind(db: Session, item: PackageItem) -> Optional[str]:
    """Resolve the asset kind for asset-type PackageItems. Returns None for non-assets."""
    if item.resource_type != "asset" or not item.asset_id:
        return None
    row = db.execute(text("SELECT kind FROM asset WHERE id = :id"), {"id": item.asset_id}).first()
    return row[0] if row else None


def _enrich_package(db: Session, pkg: Package) -> dict:
    """Convert a Package ORM object to a response dict with resolved resource names."""
    items = []
    for item in (pkg.items or []):
        items.append({
            "id": item.id,
            "resource_type": item.resource_type,
            "resource_id": item.resource_id,
            "resource_name": _resolve_resource_name(db, item),
            "resource_kind": _resolve_resource_kind(db, item),
            "allow_download": item.allow_download,
            "allow_copy": item.allow_copy,
            "derived_from_item_id": item.derived_from_item_id,
            "derivation_type": item.derivation_type,
        })
    return {
        "id": pkg.id,
        "uuid": pkg.uuid,
        "name": pkg.name,
        "description": pkg.description,
        "token": pkg.token,
        "visibility": pkg.visibility,
        "infospace_id": pkg.infospace_id,
        "user_id": pkg.user_id,
        "default_allow_download": pkg.default_allow_download,
        "default_allow_copy": pkg.default_allow_copy,
        "is_active": pkg.is_active,
        "expires_at": str(pkg.expires_at) if pkg.expires_at else None,
        "created_at": str(pkg.created_at) if pkg.created_at else None,
        "items": items,
    }


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


@router.get("/p/{token}/assets/{asset_id}/download", response_class=FileResponse, status_code=200)
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


@router.get("/p/{token}/export", response_class=FileResponse, status_code=200)
async def export_package(
    *,
    token: str,
    db: Session = Depends(dependency_injection.get_db),
    storage_provider=Depends(dependency_injection.get_storage_provider_dependency),
    settings: dependency_injection.SettingsDep,
    background_tasks: BackgroundTasks,
) -> FileResponse:
    """Export a package as a self-contained intelligence product.

    Produces a ZIP with:
    - manifest.json — full HQ-native data for round-trip import
    - files/ — original source documents
    - data/*.csv — human-readable analysis results
    - provenance/lineage.csv — audit trail
    - explore.py — self-documenting script
    """
    from app.api.modules.sharing.services.package_service import PackageBuilder

    pkg = _validate_package_token(db, token)
    scope = _resolve_package_token(db, pkg.infospace_id, token)
    if scope is None:
        raise HTTPException(status_code=404, detail="Not found")

    builder = PackageBuilder(db, storage_provider, settings.INSTANCE_ID, settings)
    data_package = await builder.build_package_export(pkg, scope)

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=".zip")
    tmp.close()

    try:
        data_package.to_zip(tmp.name)
        background_tasks.add_task(os.unlink, tmp.name)
        return FileResponse(
            path=tmp.name,
            filename=f"{pkg.name or 'package'}.zip",
            media_type="application/zip",
        )
    except Exception as e:
        os.unlink(tmp.name)
        logger.error(f"Failed to export package: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail="Could not create export")
