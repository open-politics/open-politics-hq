"""
Destination bundle resolution for ingestion.

Single contract for "create the bundle if a name was given, validate it if an
id was given, return nothing if neither". Shared by the multipart file-upload
route and the batch ingestion-job route so both paths build the same shape.
"""

from __future__ import annotations

from typing import Optional

from sqlmodel import Session

from app.models import Bundle
from app.schemas import BundleCreate
from app.api.modules.content.services.bundle_service import BundleService
from app.core.tree import ROOT, _assert_bundle_exists, _assert_not_sealed


def resolve_or_create_bundle(
    session: Session,
    infospace_id: int,
    user_id: int,
    *,
    bundle_id: Optional[int] = None,
    bundle_name: Optional[str] = None,
    parent_bundle_id: Optional[int] = None,
) -> Optional[Bundle]:
    """Resolve a destination bundle from caller-supplied identifiers.

    - ``bundle_name`` given → create a new bundle (child of ``parent_bundle_id``
      or ROOT) and return it.
    - ``bundle_id`` given → validate it exists, belongs to this infospace, and
      isn't sealed; return the Bundle row.
    - Neither → return ``None`` (caller treats as ROOT — items land top-level).
    - Both → ``ValueError`` (ambiguous contract).
    """
    if bundle_id is not None and bundle_name is not None:
        raise ValueError("Provide at most one of bundle_id or bundle_name")

    if bundle_id is not None:
        _assert_bundle_exists(session, bundle_id)
        _assert_not_sealed(session, bundle_id, "ingest into")
        bundle = session.get(Bundle, bundle_id)
        if not bundle or bundle.infospace_id != infospace_id:
            raise ValueError(f"Bundle {bundle_id} not found in this infospace")
        return bundle

    if bundle_name is not None:
        parent = parent_bundle_id if parent_bundle_id is not None else ROOT
        if parent != ROOT:
            _assert_bundle_exists(session, parent)
            _assert_not_sealed(session, parent, "nest under")
        return BundleService(session).create_bundle(
            bundle_in=BundleCreate(name=bundle_name, parent_bundle_id=parent),
            infospace_id=infospace_id,
            user_id=user_id,
        )

    return None
