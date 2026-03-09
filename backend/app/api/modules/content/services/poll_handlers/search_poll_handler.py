"""
Search Poll Handler
===================

Extracted from StreamSourceService.execute_poll() elif branch for source.kind == 'search'.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from app.models import Asset, Source
from app.api.modules.content.handlers import SearchHandler
from app.api.modules.content.handlers.base import IngestionContext
from . import PollResult, register_poll_handler

logger = logging.getLogger(__name__)


@register_poll_handler("search")
class SearchPollHandler:
    async def poll(
        self,
        source: Source,
        context: IngestionContext,
        runtime_options: Optional[Dict[str, Any]] = None,
    ) -> PollResult:
        search_config = source.details.get("search_config", {})
        if not search_config:
            raise ValueError("Search source missing search_config")

        query = search_config.get("query")
        if not query:
            raise ValueError("Search config missing query")

        provider = search_config.get("provider", "tavily")
        max_results = search_config.get("max_results", 10)

        # --- resolve API key (priority: runtime > source config > env) ---
        runtime_api_keys = (runtime_options or {}).get("runtime_api_keys") or {}
        api_key = runtime_api_keys.get(provider)
        if not api_key:
            api_key = runtime_api_keys.get(f"{provider.upper()}_API_KEY") or runtime_api_keys.get("TAVILY_API_KEY")
        if not api_key:
            api_key = search_config.get("api_key")
        if not api_key and provider == "tavily":
            from app.core.config import settings
            api_key = settings.TAVILY_API_KEY

        # --- execute search ---
        from app.api.modules.foundation_service_providers.base import WebSearchProvider
        from app.api.modules.foundation_service_providers.registry import get_provider
        from app.core.config import settings as app_settings

        search_provider = get_provider(
            WebSearchProvider, provider, app_settings,
            api_key_override=api_key,
        )

        logger.info("Executing search query: '%s' with provider %s", query, provider)
        search_results_raw = await search_provider.search(
            query=query,
            limit=max_results,
            **search_config.get("provider_params", {}),
        )

        # --- deduplicate via cursor ---
        seen_urls = set(source.cursor_state.get("seen_urls", []))

        from app.schemas import SearchResult

        search_results: List[SearchResult] = []
        new_urls: List[str] = []

        for result_dict in search_results_raw:
            url = result_dict.get("url") or result_dict.get("link") or result_dict.get("href")
            if not url or url in seen_urls:
                continue
            search_results.append(
                SearchResult(
                    title=result_dict.get("title", "Untitled"),
                    url=url,
                    content=(
                        result_dict.get("content")
                        or result_dict.get("snippet")
                        or result_dict.get("description")
                        or ""
                    ),
                    score=result_dict.get("score") or result_dict.get("relevance_score"),
                    provider=provider,
                    raw_data=result_dict,
                )
            )
            new_urls.append(url)

        seen_urls.update(new_urls)

        # --- create assets ---
        assets: List[Asset] = []
        if search_results:
            handler_options = {
                "scrape_content": search_config.get("scrape_content", True),
                "cursor_state": source.cursor_state,
            }
            search_handler = SearchHandler(context)
            assets = await search_handler.handle_bulk(
                results=search_results,
                query=query,
                options=handler_options,
            )
        else:
            logger.info("No new search results found for query '%s'", query)

        cursor_update = {
            "seen_urls": list(seen_urls),
            "last_query_timestamp": datetime.now(timezone.utc).isoformat(),
            "last_query": query,
        }

        return PollResult(
            assets=assets,
            cursor_update=cursor_update,
            summary=f"Found {len(assets)} new results for '{query}'",
        )
