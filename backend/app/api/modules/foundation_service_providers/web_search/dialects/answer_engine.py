"""
answer_engine.py — the Tavily wire.
===================================

  query ──► POST {base}/search ──► { results[] · answer · images · … }
                                           │
                                           └─ top-level extras, not
                                              smuggled into results[0]["raw"]

  NOT IN THIS FILE
    ../base.py     the SearchResults / SearchHit shapes these fill.
    metasearch.py  the other wire — no answer, no images, hits only.

Those extras used to be smuggled into results[0]["raw"] under
summary_answer / tavily_images, which is how mcp_server/server.py ended
up reading Tavily-specific keys off whatever provider was configured.

Talks HTTP directly, not through tavily-python: the SDK is synchronous
(every call would need an executor hop), and going direct gives this
adapter the same timeout policy as every other wire.
"""

from __future__ import annotations

import logging
from typing import Any, List

import httpx

from app.api.modules.foundation_service_providers.web_search import SearchHit, SearchResults
from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)

#: Caller options forwarded to the engine untouched.
PASSTHROUGH_PARAMS = ("include_domains", "exclude_domains", "time_range",
                      "days", "country", "chunks_per_source")

DEFAULT_BASE_URL = "https://api.tavily.com"


class AnswerEngineSearch(Adapter):
    """Tavily search."""

    timeout = 60.0

    def __init__(self, **kw):
        super().__init__(**kw)
        if not self.base_url:
            self.base_url = DEFAULT_BASE_URL
        if not self.api_key:
            raise ValueError("answer_engine search requires an API key")

    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}"}

    async def search(self, query: str, *, limit: int = 10, **options: Any) -> SearchResults:
        q = self.quirks
        payload: dict = {
            "query": query,
            "max_results": limit,
            "topic": options.get("topic", q.topic),
            "search_depth": options.get("depth", q.depth),
            "include_answer": options.get("answer", q.answer),
            "include_raw_content": options.get("raw_content", q.raw_content),
            "include_images": options.get("images", q.images),
            "include_image_descriptions": options.get("images", q.images),
            "include_favicon": True,
        }
        for passthrough in PASSTHROUGH_PARAMS:
            if options.get(passthrough):
                payload[passthrough] = options[passthrough]

        try:
            response = await self.client.post(self.url("/search"), json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error("Tavily HTTP %s for %r: %s",
                         e.response.status_code, query, e.response.text[:200])
            raise IOError(f"Web search failed: HTTP {e.response.status_code}") from e
        except Exception as e:
            logger.error("Tavily search failed for %r: %s", query, e, exc_info=True)
            raise IOError(f"Web search failed: {e}") from e

        hits: List[SearchHit] = [
            SearchHit(
                title=r.get("title", ""),
                url=r.get("url", ""),
                content=r.get("content", ""),
                raw_content=r.get("raw_content") or None,
                score=r.get("score"),
                published_date=r.get("published_date"),
                favicon=r.get("favicon"),
                provider=self.provider_key,
                raw=r,
            )
            for r in (data.get("results") or [])
        ]

        logger.info("Tavily search for %r returned %d hits, %d images",
                    query, len(hits), len(data.get("images") or []))

        return SearchResults(
            hits=hits,
            answer=data.get("answer"),
            images=data.get("images") or [],
            provider=self.provider_key,
        )
