"""Web-search composition — search, and turn results/URLs into ingestion jobs.

Three shapes, all over the unified content path (no handlers):

* ``search_web``    — call a web-search provider, return raw results. Creates nothing.
* ``ingest_results`` — already-fetched result dicts → a ``web`` IngestionJob. Full
  content rides inline (``web.fetch`` passes it through, no re-scrape); a short
  metasearch snippet carries no ``text`` so the web source scrapes the URL.
* ``ingest_urls``   — a URL list → a ``web`` IngestionJob (the web source scrapes each).

Routes are thin adapters. The infospace owner's credentials drive provider resolution;
a ``runtime_key`` overrides at call time. Ingestion is async — callers get the job back
and poll it (the ``useIngestionJobs`` path).
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from sqlmodel import Session

from app.api.modules.content.intake import intake
from app.api.modules.foundation_service_providers import ProviderError, resolve

logger = logging.getLogger(__name__)

# Full article vs metasearch snippet: above any SearXNG snippet (~150-300 chars),
# below Tavily raw_content (multi-thousand). Full → inline passthrough; snippet → scrape.
SCRAPE_THRESHOLD = 800


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
    """Run a web search and return raw provider results. Creates nothing — the caller
    decides whether to hand them back to the user or pass them to ``ingest_results``."""
    try:
        web_search_provider = resolve(
            "web_search", provider,
            infospace_id=infospace_id, runtime_key=runtime_key, session=session,
        )
    except ProviderError as e:
        raise ValueError(str(e)) from e

    params = provider_params or {}
    raw_results = await web_search_provider.search(query=query, limit=limit, **params)
    logger.info("Web search '%s' via %s → %d results", query, provider, len(raw_results or []))
    return list(raw_results or [])


def _result_spec(r: Dict[str, Any]) -> Optional[dict]:
    """A raw result dict → a ``web`` intake spec. Full content rides inline (passthrough);
    a short snippet carries no ``text`` so the web source scrapes the locator."""
    url = r.get("url")
    if not url:
        return None
    spec: dict = {"url": url, "title": r.get("title")}
    content = r.get("raw_content") or r.get("content") or ""
    if len(content) >= SCRAPE_THRESHOLD:
        spec["text"] = content
    return spec


def ingest_results(
    session: Session,
    infospace_id: int,
    user_id: int,
    results: List[Dict[str, Any]],
    *,
    bundle_id: Optional[int] = None,
) -> Optional[Any]:
    """Mint one ``web`` IngestionJob from already-fetched result dicts. Returns the job
    (or None if nothing ingestable)."""
    specs = [s for s in (_result_spec(r) for r in results) if s]
    if not specs:
        return None
    jobs = intake(session, infospace_id=infospace_id, user_id=user_id,
                  groups={"web": specs}, dest_id=bundle_id)
    return jobs[0] if jobs else None


def ingest_urls(
    session: Session,
    infospace_id: int,
    user_id: int,
    urls: List[str],
    *,
    bundle_id: Optional[int] = None,
) -> Optional[Any]:
    """Mint one ``web`` IngestionJob from a URL list (the web source scrapes each).
    Returns the job (or None if no URLs)."""
    clean = [u.strip() for u in (urls or []) if u and u.strip()]
    if not clean:
        return None
    jobs = intake(session, infospace_id=infospace_id, user_id=user_id,
                  groups={"web": [{"url": u} for u in clean]}, dest_id=bundle_id)
    return jobs[0] if jobs else None
