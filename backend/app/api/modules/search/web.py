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
# The full-vs-snippet rule belongs to the source realization contract, not to
# search — the RSS source needs the identical cut and cannot import from L3.
# Re-exported here because callers and tests already import it from this module.
from app.api.modules.content.sources import SCRAPE_THRESHOLD
from app.api.modules.foundation_service_providers import ProviderError, resolve

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
) -> "SearchResults":
    """Run a web search. Creates nothing — the caller decides whether to hand the
    results back to the user or pass them to ``ingest_results``."""
    try:
        web_search_provider = resolve(
            "web_search", provider,
            infospace_id=infospace_id, runtime_key=runtime_key, session=session,
        )
    except ProviderError as e:
        raise ValueError(str(e)) from e

    results = await web_search_provider.search(query, limit=limit, **(provider_params or {}))
    logger.info("Web search %r via %s → %d hits", query, provider, len(results))
    return results


def _result_spec(hit: "SearchHit") -> Optional[dict]:
    """A hit → a ``web`` intake spec. Full content rides inline (passthrough); a
    short snippet carries no ``text``, so the web source scrapes the locator."""
    if not hit.url:
        return None
    spec: dict = {"url": hit.url, "title": hit.title}
    if len(hit.best_text) >= SCRAPE_THRESHOLD:
        spec["text"] = hit.best_text
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
