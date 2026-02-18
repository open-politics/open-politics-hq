"""
Search Handler
==============

Handles search result ingestion.
"""

import logging
from typing import Any, Dict, List, Optional

from app.models import Asset
from app.api.content.services.asset_builder import AssetBuilder
from app.schemas import SearchResult
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


class SearchHandler(BaseHandler):
    """
    Handle search result ingestion.

    Uses AssetBuilder's from_search_result() pattern.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle single search result ingestion.

        Args:
            locator: SearchResult to ingest, or dict with keys: result, query, rank
            title: Unused
            options: Must contain "query" if locator is SearchResult.
                    May contain: query, rank, depth

        Returns:
            List containing the created asset
        """
        options = options or {}
        depth = options.get("depth", 0)

        if isinstance(locator, SearchResult):
            result = locator
            query = options.get("query", "")
            rank = options.get("rank", 0)
        else:
            result = locator.get("result")
            query = locator.get("query", options.get("query", ""))
            rank = locator.get("rank", options.get("rank", 0))

        asset = await (
            AssetBuilder(self.session, self.user_id, self.infospace_id)
            .from_search_result(result, query)
            .with_metadata(search_rank=rank + 1)
            .with_depth(depth)
            .build()
        )

        return [asset]

    async def handle_bulk(
        self,
        results: List[SearchResult],
        query: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle bulk search result ingestion.

        Args:
            results: List of search results
            query: Original search query
            options: Processing options (depth, etc.)

        Returns:
            List of created assets
        """
        assets = []
        for i, result in enumerate(results):
            try:
                asset_list = await self.handle(
                    result,
                    None,
                    {**(options or {}), "query": query, "rank": i},
                )
                assets.extend(asset_list)
            except Exception as e:
                logger.error(
                    f"Failed to ingest search result '{result.title}': {e}"
                )
                continue

        return assets
