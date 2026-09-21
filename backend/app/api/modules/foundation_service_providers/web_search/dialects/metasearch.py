"""
metasearch.py — the SearXNG wire. Keyless and self-hostable.

  query ──► GET {base}/search ──► { results[] }        (nothing else)
                                         │
                                         └─ sliced to `limit` client-side —
                                            no reliable server-side cap
"""

from __future__ import annotations

import logging
from typing import Any, List

import httpx

from app.api.modules.foundation_service_providers.web_search import SearchHit, SearchResults
from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)

#: Caller options forwarded to the engine untouched.
PASSTHROUGH_PARAMS = ("categories", "language", "time_range")


class MetasearchSearch(Adapter):
    """SearXNG search."""

    timeout = 15.0

    async def search(self, query: str, *, limit: int = 20, **options: Any) -> SearchResults:
        params: dict = {
            "q": query,
            "format": "json",
            "pageno": options.get("page", 1),
            "number_of_results": limit,
        }
        for passthrough in PASSTHROUGH_PARAMS:
            if options.get(passthrough):
                params[passthrough] = options[passthrough]

        try:
            response = await self.client.get(self.url("/search"), params=params)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error("SearXNG HTTP %s for %r", e.response.status_code, query)
            raise IOError(f"Web search failed: HTTP {e.response.status_code}") from e
        except Exception as e:
            logger.error("SearXNG search failed for %r: %s", query, e, exc_info=True)
            raise IOError(f"Web search failed: {e}") from e

        # SearXNG has no reliable server-side cap; this slice enforces `limit`.
        hits: List[SearchHit] = [
            SearchHit(
                title=r.get("title", ""),
                url=r.get("url", ""),
                content=r.get("content", ""),
                score=r.get("score"),
                published_date=r.get("publishedDate"),   # note the camelCase on the wire
                provider=self.provider_key,
                raw=r,
            )
            for r in (data.get("results") or [])[:limit]
        ]

        logger.info("SearXNG search for %r returned %d hits", query, len(hits))
        return SearchResults(hits=hits, provider=self.provider_key)
