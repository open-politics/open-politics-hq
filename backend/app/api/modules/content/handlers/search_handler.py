"""
Search Handler
==============

Handles search result ingestion — SearchHandler owns the shape of a
provider-returned search result (Tavily, SearXNG, etc.) and composes
AssetBuilder setters directly. No from_X entry point on the builder.
"""

import logging
from typing import Any, Dict, List, Optional

import dateutil.parser

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from app.schemas import SearchResult
from .base import BaseHandler

logger = logging.getLogger(__name__)


def _compose_search_result(
    builder: AssetBuilder, result: SearchResult, query: str
) -> AssetBuilder:
    """Configure the builder from a SearchResult.

    Private helper — only SearchHandler calls this. Keeps the shape of a
    search-provider response out of the AssetBuilder primitive.
    """
    # Prefer raw_content (markdown) over summary
    content = ""
    if result.raw_data and "raw_content" in result.raw_data and result.raw_data["raw_content"]:
        content = result.raw_data["raw_content"]
    else:
        content = result.content

    metadata = {
        "content_format": "markdown",
        "content_source": "search_result",
        "search_query": query,
        "search_provider": result.provider,
        "search_score": result.score,
        "ingestion_method": "search_result",
    }

    # Provider-extra enrichment
    if result.raw_data:
        if "favicon" in result.raw_data:
            metadata["favicon"] = result.raw_data["favicon"]
        if "tavily_answer" in result.raw_data:
            metadata["ai_summary"] = result.raw_data["tavily_answer"]
        if "published_date" in result.raw_data:
            metadata["published_date"] = result.raw_data["published_date"]

    builder = (
        builder
        .as_kind(AssetKind.ARTICLE)
        .with_title(result.title)
        .with_text(content)
        .with_source(result.url)
        .with_metadata(**metadata)
        .with_processing_status(ProcessingStatus.READY)
        .dedup_on(source_identifier=result.url)
        .on_match("skip")
    )

    # Parse publication date into event_timestamp if present
    pub = (result.raw_data or {}).get("published_date")
    if pub:
        try:
            builder = builder.with_timestamp(dateutil.parser.parse(pub))
        except Exception as e:
            logger.warning(f"Could not parse publication date: {e}")

    return builder


class SearchHandler(BaseHandler):
    """Handle search result ingestion.

    Composes AssetBuilder setters directly — no from_X entry point.
    SearchHandler owns the shape of a provider-returned search result.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """Handle single search result ingestion.

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

        builder = AssetBuilder(self.session, self.user_id, self.infospace_id)
        builder = _compose_search_result(builder, result, query)
        builder = builder.with_metadata(search_rank=rank + 1).with_depth(depth)

        asset = await builder.build()
        self.session.commit()  # v2: builder flushes only; handler owns transaction
        self.session.refresh(asset)

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
