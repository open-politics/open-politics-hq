"""
Text Handler
============

Handles direct text content ingestion.
"""

import logging
from typing import Any, Dict, List, Optional

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from .base import BaseHandler

logger = logging.getLogger(__name__)


class TextHandler(BaseHandler):
    """Handle direct text content ingestion.

    Composes AssetBuilder setters directly — no from_X entry point.
    TextHandler owns the defaults for TEXT kind: ingestion_method, READY status.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """Handle text content ingestion.

        Args:
            locator: Text content string
            title: Optional custom title
            options: May contain event_timestamp, metadata

        Returns:
            List containing the created asset
        """
        text = locator if isinstance(locator, str) else str(locator)
        options = options or {}

        builder = (
            AssetBuilder(self.session, self.user_id, self.infospace_id)
            .as_kind(AssetKind.TEXT)
            .with_title(title or f"Text: {text[:30]}...")
            .with_text(text)
            .with_metadata(ingestion_method="direct_text")
            .with_processing_status(ProcessingStatus.READY)
            .no_dedup()  # text ingestion is always a fresh row
        )

        event_timestamp = options.get("event_timestamp")
        if event_timestamp:
            builder.with_timestamp(event_timestamp)

        if options.get("metadata"):
            builder.with_metadata(**options["metadata"])

        asset = await builder.build()
        self.session.commit()  # v2: builder flushes only; handler owns transaction
        self.session.refresh(asset)

        return [asset]
