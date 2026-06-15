"""RSS source — a feed becomes a stream of article RawItems.

This file owns ONLY the RSS-specific knowledge: how to read a feed, preview an
entry, realize an entry's content, and discover feeds. It does NOT build assets
and does NOT create image children:

  • The @task build loop composes the ARTICLE asset from each RawItem and counts
    the BuildOutcome (dedup lives there + in AssetBuilder, not here).
  • The web_article *type* turns the entry's enclosure images (surfaced in
    metadata["rss_images"]) into child assets when it processes the article.

Identity = entry guid/link; change-token = the entry's updated/published date
(so a revised entry re-fetches and supersedes); provenance = rss://host/…#guid.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Dict, List, Optional

import dateutil.parser
import feedparser

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type,
)
from app.api.modules.content.utils.feed_parse import parse_feed, _entry_content

logger = logging.getLogger(__name__)


# ── The source ─────────────────────────────────────────────────────────────────

@source_type("rss")
class RSSFeed:
    """Feed → article RawItems. config = {feed_url, max_items?}."""

    async def read(
        self, config: Dict[str, Any], cursor: Dict[str, Any], ctx: SourceContext
    ) -> AsyncIterator[RawItem]:
        # Uniform opener: a poll passes {feed_url, max_items} directly; the intake route
        # passes many via {"items": [...]}. One feed spec per iteration.
        for it in (config.get("items") or [config]):
            async for raw in self._read_feed(it, cursor, ctx):
                yield raw

    async def _read_feed(
        self, config: Dict[str, Any], cursor: Dict[str, Any], ctx: SourceContext
    ) -> AsyncIterator[RawItem]:
        feed_url = config.get("feed_url")
        if not feed_url:
            raise ValueError("RSS source missing feed_url")
        max_items = int(config.get("max_items", 50))

        feed_title, entries = parse_feed(feed_url)
        for entry in entries[:max_items]:
            guid = entry["guid"]
            content = entry["content"]
            pub = entry["published"]
            ts: Optional[datetime] = None
            if pub:
                try:
                    ts = dateutil.parser.parse(pub)
                except Exception:
                    ts = None
            # Drift token: the entry's publish/revision date if present (bumps when the
            # feed revises the entry), else None (= "no drift signal" → dedup on guid
            # identity alone). NOT a content hash — feed bodies wiggle (ads, relative
            # timestamps), which would spuriously re-ingest every entry every poll.
            token = pub or None

            yield RawItem(
                source_identifier=guid,
                kind=AssetKind.ARTICLE,
                title=entry["title"],
                source_token=token,
                locator=entry["link"],
                text=content,  # RSS content arrives inline — free during read
                event_timestamp=ts,
                metadata={
                    "guid": guid,
                    "author": entry["author"],
                    "summary": entry["summary"],
                    "rss_link": entry["link"],
                    "rss_tags": entry["tags"],
                    "rss_images": entry["images"],
                    "rss_feed_url": feed_url,
                    "feed_title": feed_title,
                    "content_format": "html",
                    "content_source": "rss_feed",
                },
            )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        images = item.metadata.get("rss_images") or []
        return Preview(
            title=item.title,
            summary=item.metadata.get("summary"),
            url=item.locator or item.source_identifier,
            thumbnail_url=images[0]["url"] if images else None,
            extra={"author": item.metadata.get("author"), "tags": item.metadata.get("rss_tags")},
        )

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        # RSS content is inline (read already has it); fetch just packages it and
        # stamps a content hash so AssetBuilder can detect a real content change.
        text = item.text or ""
        return FetchedContent(
            text_content=text,
            content_hash=hashlib.md5(
                f"{item.source_identifier}|{text[:1000]}".encode("utf-8", "ignore")
            ).hexdigest(),
            event_timestamp=item.event_timestamp,
            metadata=item.metadata,
        )


# ── Preview / discovery (no ingestion needed) — used by routes ─────────────────

async def preview_feed(feed_url: str, max_items: int = 20) -> Dict[str, Any]:
    """Parse a feed and return its info + items, creating nothing. (Was
    RSSHandler.preview_rss_feed.)"""
    feed = feedparser.parse(feed_url)
    if feed.bozo:
        raise ValueError(f"Feed parsing error: {feed.bozo_exception}")
    return {
        "feed_info": {
            "title": feed.feed.get("title", "Unknown Feed"),
            "description": feed.feed.get("description", ""),
            "link": feed.feed.get("link", ""),
            "language": feed.feed.get("language", ""),
            "updated": feed.feed.get("updated", ""),
            "total_items": len(feed.entries),
        },
        "items": [
            {
                "index": i,
                "title": e.get("title", ""),
                "link": e.get("link", ""),
                "summary": e.get("summary", ""),
                "published": e.get("published", ""),
                "author": e.get("author", ""),
                "tags": [t.get("term", "") for t in e.get("tags", [])],
                "id": e.get("id", ""),
                "content": _entry_content(e),
            }
            for i, e in enumerate(feed.entries[:max_items])
        ],
        "feed_url": feed_url,
        "previewed_at": datetime.now(timezone.utc).isoformat(),
    }


async def discover_feeds(
    country: Optional[str] = None, category: Optional[str] = None, limit: int = 50,
) -> List[Dict[str, Any]]:
    """Discover feeds from the awesome-rss-feeds repo. (Was
    RSSHandler.discover_rss_feeds_from_awesome_repo.)"""
    base = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master"
    if country:
        feeds = await _fetch_opml(f"{base}/countries/with_category/{country}.opml", country)
    else:
        feeds = await _fetch_all_countries(base)
    if category:
        c = category.lower()
        feeds = [f for f in feeds if c in f.get("title", "").lower() or c in f.get("description", "").lower()]
    return feeds[:limit]


async def _fetch_opml(opml_url: str, country: str) -> List[Dict[str, Any]]:
    import aiohttp
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(opml_url) as resp:
                if resp.status != 200:
                    return []
                return _parse_opml(await resp.text(), country)
    except Exception as e:
        logger.error("Error fetching OPML for %s: %s", country, e)
        return []


async def _fetch_all_countries(base: str) -> List[Dict[str, Any]]:
    countries = [
        "Australia", "Bangladesh", "Brazil", "Canada", "Germany", "Spain", "France",
        "United Kingdom", "Hong Kong SAR China", "Indonesia", "Ireland", "India",
        "Iran", "Italy", "Japan", "Myanmar (Burma)", "Mexico", "Nigeria",
        "Philippines", "Pakistan", "Poland", "Russia", "Ukraine", "United States",
        "South Africa",
    ]
    sem = asyncio.Semaphore(5)

    async def one(c: str):
        async with sem:
            return await _fetch_opml(f"{base}/countries/with_category/{c}.opml", c)

    out: List[Dict[str, Any]] = []
    for res in await asyncio.gather(*[one(c) for c in countries], return_exceptions=True):
        if isinstance(res, list):
            out.extend(res)
    return out


def _parse_opml(opml_content: str, country: str) -> List[Dict[str, Any]]:
    try:
        root = ET.fromstring(opml_content)
    except ET.ParseError as e:
        logger.error("Failed to parse OPML for %s: %s", country, e)
        return []
    feeds = []
    for outline in root.iter():
        if outline.get("xmlUrl"):
            feeds.append({
                "title": outline.get("title", ""),
                "description": outline.get("description", ""),
                "url": outline.get("xmlUrl", ""),
                "text": outline.get("text", ""),
                "country": country,
                "source": "awesome-rss-feeds",
                "discovered_at": datetime.now(timezone.utc).isoformat(),
            })
    return feeds
