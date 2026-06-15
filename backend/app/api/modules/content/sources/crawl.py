"""Crawl source — a site becomes a stream of discovered-page RawItems.

``read`` does the discovery: a bounded, same-origin BFS from ``base_url``
(depth- and count-capped), yielding one RawItem per discovered page. ``fetch``
realizes a page exactly like the ``web`` source (it IS web's fetch — crawl is
web plus a discovery read). Re-polls dedup on URL identity via the stage-1
guard, so a recurring crawl only ingests pages it hasn't seen.

  config = {base_url, max_depth?, max_urls?}
"""

from __future__ import annotations

import logging
from html.parser import HTMLParser
from typing import AsyncIterator, List, Optional, Set
from urllib.parse import urldefrag, urljoin, urlparse

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type,
)

logger = logging.getLogger(__name__)

_DEFAULT_MAX_DEPTH = 1
_DEFAULT_MAX_URLS = 50
_FETCH_TIMEOUT = 15
_SKIP_SCHEMES = ("mailto:", "tel:", "javascript:", "data:")


@source_type("crawl")
class SiteCrawl:
    """``config = {base_url, max_depth?, max_urls?}``."""

    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        # Uniform opener: a poll passes {base_url, ...} directly; intake passes
        # many via {"items": [...]}. One crawl per spec.
        for it in (config.get("items") or [config]):
            base_url = it.get("base_url") or it.get("url")
            if not base_url:
                raise ValueError("crawl source missing base_url")
            max_depth = int(it.get("max_depth", _DEFAULT_MAX_DEPTH))
            max_urls = int(it.get("max_urls", _DEFAULT_MAX_URLS))
            async for raw in self._crawl(base_url, max_depth, max_urls):
                yield raw

    async def _crawl(self, base_url: str, max_depth: int, max_urls: int) -> AsyncIterator[RawItem]:
        """Bounded same-origin BFS. Yields every discovered page (the base first);
        link extraction failures are per-page, never fatal to the crawl."""
        origin = urlparse(base_url).netloc
        seen: Set[str] = set()
        frontier: List[str] = [urldefrag(base_url)[0]]

        for depth in range(max_depth + 1):
            next_frontier: List[str] = []
            for url in frontier:
                if url in seen or len(seen) >= max_urls:
                    continue
                seen.add(url)
                yield RawItem(
                    source_identifier=url,
                    kind=None,                 # decided post-fetch via detect_kind
                    title=url,
                    locator=url,
                    metadata={"ingestion_method": "crawl", "crawl_depth": depth,
                              "crawl_base": base_url},
                )
                if depth < max_depth and len(seen) < max_urls:
                    try:
                        next_frontier.extend(
                            u for u in await _page_links(url, origin) if u not in seen
                        )
                    except Exception as e:
                        logger.warning("crawl: link extraction failed for %s: %s", url, e)
            if not next_frontier:
                break
            frontier = next_frontier

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, url=item.locator,
                       extra={"depth": item.metadata.get("crawl_depth")})

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        # A discovered page realizes exactly like a web URL (HTML stays a stub the
        # WebArticle type scrapes; a real file downloads to a blob).
        from app.api.modules.content.sources.web import WebPage
        return await WebPage().fetch(item, ctx)


# ── internal helpers ───────────────────────────────────────────────────────────

class _HrefParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.hrefs: List[str] = []

    def handle_starttag(self, tag, attrs):
        if tag == "a":
            for name, value in attrs:
                if name == "href" and value:
                    self.hrefs.append(value)


async def _page_links(url: str, origin: str) -> List[str]:
    """GET one page (HTML only) and return its same-origin, fragment-free links."""
    import aiohttp

    async with aiohttp.ClientSession() as sess:
        async with sess.get(url, allow_redirects=True,
                            timeout=aiohttp.ClientTimeout(total=_FETCH_TIMEOUT)) as resp:
            ct = (resp.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
            if resp.status != 200 or ct not in ("text/html", "application/xhtml+xml"):
                return []
            html = await resp.text(errors="ignore")

    parser = _HrefParser()
    try:
        parser.feed(html)
    except Exception:
        pass

    out: List[str] = []
    for href in parser.hrefs:
        if href.startswith(_SKIP_SCHEMES) or href.startswith("#"):
            continue
        absolute = urldefrag(urljoin(url, href))[0]
        p = urlparse(absolute)
        if p.scheme in ("http", "https") and p.netloc == origin:
            out.append(absolute)
    return out
