"""SearXNG web search provider — self-hosted, no API key required."""

import logging
from typing import Any, Dict, List, Optional

import httpx

from app.api.modules.foundation_service_providers.base import WebSearchProvider

logger = logging.getLogger(__name__)


class SearXNGWebSearchProvider(WebSearchProvider):
    """
    SearXNG implementation of the WebSearchProvider interface.

    SearXNG is a self-hosted metasearch engine. No API key needed —
    just a base URL pointing at the instance.
    """

    def __init__(self, base_url: str = "http://searxng:8080"):
        self.base_url = base_url.rstrip("/")
        logger.info("SearXNGWebSearchProvider initialized: %s", self.base_url)

    async def search(self, query: str, skip: int = 0, limit: int = 20, **kwargs) -> List[Dict[str, Any]]:
        params = {
            "q": query,
            "format": "json",
            "pageno": (skip // limit) + 1 if limit else 1,
            "number_of_results": limit,
        }

        if "categories" in kwargs:
            params["categories"] = kwargs["categories"]
        if "language" in kwargs:
            params["language"] = kwargs["language"]
        if "time_range" in kwargs:
            params["time_range"] = kwargs["time_range"]

        try:
            async with httpx.AsyncClient(timeout=15) as client:
                response = await client.get(f"{self.base_url}/search", params=params)
                response.raise_for_status()
                data = response.json()

            results = []
            for item in data.get("results", [])[:limit]:
                results.append({
                    "title": item.get("title", ""),
                    "url": item.get("url", ""),
                    "content": item.get("content", ""),
                    "score": item.get("score"),
                    "published_date": item.get("publishedDate"),
                    "raw": item,
                })

            logger.info("SearXNG search for '%s' returned %d results.", query, len(results))
            return results

        except Exception as e:
            logger.error("SearXNG search failed for '%s': %s", query, e, exc_info=True)
            raise IOError(f"SearXNG search failed: {e}") from e

    async def search_by_entity(self, entity: str, date: Optional[str] = None, limit: int = 20) -> List[Dict[str, Any]]:
        kwargs = {}
        if date:
            kwargs["time_range"] = "month"
        return await self.search(query=f'"{entity}"', limit=limit, **kwargs)
