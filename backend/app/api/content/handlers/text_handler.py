"""
Text Handler
============

Handles direct text content ingestion.
"""

import logging
from datetime import datetime
from typing import Any, Dict, List, Optional

from app.models import Asset
from app.api.content.services.asset_builder import AssetBuilder
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


class TextHandler(BaseHandler):
    """
    Handle direct text content ingestion.

    Uses AssetBuilder's from_text() pattern.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle text content ingestion.

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
            .from_text(text, title)
        )

        event_timestamp = options.get("event_timestamp")
        if event_timestamp:
            builder.with_timestamp(event_timestamp)

        if options.get("metadata"):
            builder.with_metadata(**options["metadata"])

        asset = await builder.build()

        return [asset]
