"""
Helper for child-level enrichers that need the parent's source file.

PDF_PAGE and other child assets have no blob_path; the file lives on the parent.
Returns (blob_path, page_index) for the task to open PDF and extract page.
"""

import logging
from typing import Any, Optional, Tuple

from app.models import Asset

logger = logging.getLogger(__name__)


def resolve_source_file(
    asset: Asset,
    session: Any,
) -> Tuple[str, Optional[int]]:
    """
    Resolve the blob_path and optional page index for an asset.

    For assets with blob_path: returns (blob_path, None).
    For child assets (e.g. PDF_PAGE): loads parent, returns (parent.blob_path, part_index).

    Returns:
        Tuple of (blob_path, page_index).
        - blob_path: Object name in storage (e.g. "datasets/foo/doc.pdf").
        - page_index: 0-based page index for PDF pages, or None for non-paginated.
    """
    if asset.blob_path:
        return asset.blob_path, None

    parent_id = getattr(asset, "parent_asset_id", None)
    part_index = getattr(asset, "part_index", None) or 0
    if not parent_id:
        raise ValueError(f"Asset {asset.id} has no blob_path and no parent_asset_id")

    parent = session.get(Asset, parent_id)
    if not parent or not parent.blob_path:
        raise ValueError(
            f"Asset {asset.id} parent {parent_id} has no blob_path"
        )
    return parent.blob_path, part_index
