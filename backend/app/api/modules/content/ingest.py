"""
Ingestion Operation
===================

Standalone async function for content ingestion.
Takes IngestionContext + locator, returns created assets.

One place to modify if the ingestion protocol changes.
"""

import logging
from typing import Any, Dict, List, Optional, Union

from fastapi import UploadFile
from sqlmodel import Session

from app.models import Asset, Bundle
from app.api.modules.content.handlers import IngestionContext
from app.api.modules.content.handlers.registry import resolve_handler

logger = logging.getLogger(__name__)


async def ingest(
    context: IngestionContext,
    locator: Union[str, List[str], UploadFile],
    *,
    title: Optional[str] = None,
    bundle_id: Optional[int] = None,
    options: Optional[Dict[str, Any]] = None,
) -> List[Asset]:
    """
    Ingest content from a locator (file, URL, text) into the infospace.

    Args:
        context: IngestionContext with session, providers, user_id, infospace_id
        locator: File (UploadFile), URL(s) (str or List[str]), or text content
        title: Optional custom title
        bundle_id: Optional bundle to add created assets to
        options: Processing and discovery options

    Returns:
        List of created assets (root assets only for containers)
    """
    opts = options or {}

    if bundle_id:
        bundle = context.session.get(Bundle, bundle_id)
        if not bundle:
            raise ValueError(
                f"Bundle {bundle_id} not found. Cannot ingest content into non-existent bundle."
            )
        logger.info(f"Validated bundle {bundle_id} exists for ingestion")

    resolved = resolve_handler(locator, context, title=title, options=opts)
    handler = resolved.handler_cls(context)
    method = getattr(handler, resolved.method)
    assets = await method(**resolved.kwargs)

    if bundle_id and assets:
        context.bundle_service.add_assets_to_bundle(
            asset_ids=[a.id for a in assets if a.parent_asset_id is None],
            bundle_id=bundle_id,
        )

    return assets
