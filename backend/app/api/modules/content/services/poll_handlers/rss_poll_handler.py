"""
RSS Poll Handler
================

Extracted from StreamSourceService.execute_poll() elif branch for source.kind == 'rss'.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models import Asset, Source
from app.api.modules.content.handlers import RSSHandler
from app.api.modules.content.handlers.base import IngestionContext
from . import PollResult, register_poll_handler

logger = logging.getLogger(__name__)


@register_poll_handler("rss")
class RSSPollHandler:
    async def poll(
        self,
        source: Source,
        context: IngestionContext,
        runtime_options: Optional[Dict[str, Any]] = None,
    ) -> PollResult:
        feed_url = source.details.get("feed_url")
        if not feed_url:
            raise ValueError("RSS source missing feed_url")

        options = source.details.get("processing_options", {}).copy()
        options["cursor_state"] = source.cursor_state

        handler = RSSHandler(context)
        assets: List[Asset] = await handler.handle(feed_url, None, options)

        cursor_update: Dict[str, Any] = {}
        if assets:
            last_entry = assets[-1]
            cursor_update["last_guid"] = (
                last_entry.source_metadata.get("guid")
                or last_entry.source_identifier
            )
        cursor_update["last_poll_timestamp"] = datetime.now(timezone.utc).isoformat()

        return PollResult(
            assets=assets,
            cursor_update=cursor_update,
            summary=f"Fetched {len(assets)} RSS entries",
        )
