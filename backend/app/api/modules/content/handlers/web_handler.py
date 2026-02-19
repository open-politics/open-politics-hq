"""
Web Handler
===========

Handles URL scraping and web content ingestion.
"""

import logging
from typing import Any, Dict, List, Optional

from app.models import Asset
from app.api.modules.content.services.asset_builder import AssetBuilder
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


class WebHandler(BaseHandler):
    """
    Handle web URL ingestion.

    Responsibilities:
    - Route URL to AssetBuilder
    - Use existing from_url() pattern
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle URL ingestion.

        Args:
            locator: URL string to scrape
            title: Optional custom title
            options: Scraping options (e.g. scrape_immediately)

        Returns:
            List containing the created asset
        """
        url = locator if isinstance(locator, str) else str(locator)
        options = options or {}
        scrape_immediately = options.get("scrape_immediately", True)

        if scrape_immediately:
            asset = await (
                AssetBuilder(self.session, self.user_id, self.infospace_id)
                .from_url(url, title)
                .build()
            )
        else:
            asset = await (
                AssetBuilder(self.session, self.user_id, self.infospace_id)
                .from_url_stub(url, title)
                .build()
            )

        return [asset]

    async def handle_bulk(
        self,
        urls: List[str],
        base_title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle bulk URL ingestion.

        Args:
            urls: List of URLs to scrape
            base_title: Base title for assets
            options: Scraping options

        Returns:
            List of created assets
        """
        assets = []
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                asset_list = await self.handle(url, url_title, options)
                assets.extend(asset_list)
            except Exception as e:
                logger.error(f"Failed to ingest URL {url}: {e}")
                continue

        return assets
