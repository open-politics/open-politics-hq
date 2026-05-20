"""Web-search composition.

One module; two shapes:

* ``search_web`` — call an external web-search provider (Tavily, etc.) and
  return raw results. Optionally ingest immediately and return assets.
* ``create_assets_from_urls`` — given a URL list, ingest each via ``ingest()``.
* ``create_assets_from_results`` — given search-result dicts (already scraped
  upstream), create assets in a single ``SearchHandler.handle_bulk`` call.

Route handlers become thin adapters. The infospace owner's credentials drive
provider resolution; a ``runtime_key`` overrides at call time.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.api.modules.content.handlers import IngestionContext, SearchHandler
from app.api.modules.content.ingest import ingest
from app.api.modules.foundation_service_providers import resolve, ProviderError
from app.core.tree import copy as tree_copy
from app.models import Asset
from app.schemas import SearchResult

logger = logging.getLogger(__name__)


async def search_web(
    session: Session,
    infospace_id: int,
    query: str,
    *,
    provider: str = "tavily",
    limit: int = 10,
    runtime_key: str | None = None,
    provider_params: Optional[Dict[str, Any]] = None,
) -> List[Dict[str, Any]]:
    """Run a web search and return raw provider results.

    Does NOT create assets. Caller decides whether to hand results back to
    the user, feed to ``create_assets_from_results``, or otherwise compose.
    """

    try:
        web_search_provider = resolve(
            "web_search", provider,
            infospace_id=infospace_id,
            runtime_key=runtime_key,
            session=session,
        )
    except ProviderError as e:
        raise ValueError(str(e)) from e

    params = provider_params or {}
    raw_results = await web_search_provider.search(query=query, limit=limit, **params)
    logger.info(f"Web search provider '{provider}' returned {len(raw_results)} results for '{query}'")
    return list(raw_results or [])


async def search_and_ingest(
    context: IngestionContext,
    query: str,
    *,
    provider: str = "tavily",
    limit: int = 10,
    runtime_key: str | None = None,
    provider_params: Optional[Dict[str, Any]] = None,
    bundle_id: Optional[int] = None,
    scrape_content: bool = True,
) -> tuple[List[Dict[str, Any]], List[Asset]]:
    """Run a web search and create assets in one composed call.

    Returns ``(raw_results, assets)``. Callers that only want results use
    ``search_web`` directly; this is the asset-producing shortcut.
    """

    raw_results = await search_web(
        context.session, context.infospace_id, query,
        provider=provider, limit=limit, runtime_key=runtime_key,
        provider_params=provider_params,
    )

    search_results = [
        SearchResult(
            title=r.get("title", ""),
            url=r.get("url", ""),
            content=r.get("content", ""),
            score=r.get("score"),
            provider=provider,
            raw_data=r.get("raw", r),
        )
        for r in raw_results
    ]

    handler = SearchHandler(context)
    assets = await handler.handle_bulk(
        results=search_results,
        query=query,
        options={"limit": limit, "scrape_content": scrape_content},
    )

    if bundle_id and assets:
        asset_ids = [a.id for a in assets if a.parent_asset_id is None]
        if asset_ids:
            tree_copy(context.session, asset_ids=asset_ids, to=bundle_id)
            context.session.commit()

    return raw_results, assets


async def create_assets_from_urls(
    context: IngestionContext,
    urls: List[str],
    *,
    bundle_id: Optional[int] = None,
    scrape_content: bool = True,
    search_metadata: Optional[Dict[str, Any]] = None,
) -> tuple[List[Asset], List[str]]:
    """Ingest each URL via ``ingest()`` and return ``(assets, failed_urls)``.

    One call per URL so handlers can deduplicate / handle_url each.
    """

    opts = {
        "scrape_immediately": scrape_content,
        "search_metadata": search_metadata,
    }

    assets: List[Asset] = []
    failed_urls: List[str] = []
    for url in urls:
        try:
            result = await ingest(context, url, bundle_id=bundle_id, options=opts)
            assets.extend(result)
        except Exception as e:
            logger.error(f"Failed to create asset from URL {url}: {e}")
            failed_urls.append(url)

    return assets, failed_urls


async def create_assets_from_results(
    context: IngestionContext,
    search_results: List[Dict[str, Any]],
    *,
    bundle_id: Optional[int] = None,
    search_metadata: Optional[Dict[str, Any]] = None,
) -> List[Asset]:
    """Create assets directly from search-result dicts (no re-scrape).

    Uses ``SearchHandler.handle_bulk`` so duplicate detection + bundle
    assignment match the ``search_and_ingest`` path exactly.
    """

    provider = (search_metadata or {}).get("provider", "unknown")
    query = (search_metadata or {}).get("query", "Search Results")

    results = [
        SearchResult(
            title=r.get("title", ""),
            url=r.get("url", ""),
            content=r.get("content", ""),
            score=r.get("score"),
            provider=provider,
            raw_data=r.get("raw", {}),
        )
        for r in search_results
    ]

    handler = SearchHandler(context)
    assets = await handler.handle_bulk(results=results, query=query, options={})

    if bundle_id and assets:
        asset_ids = [a.id for a in assets if a.parent_asset_id is None]
        if asset_ids:
            tree_copy(context.session, asset_ids=asset_ids, to=bundle_id)

    context.session.commit()
    return assets
