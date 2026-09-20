"""Feed parsing — the one place RSS/Atom XML becomes entries.

Shared by two entry modes (Q3 of the redesign): the **watched** ``RSSFeed`` *source*
(its ``read`` streams entries as ARTICLE items each poll) and the **one-shot**
``Feed`` *content type* (its ``process`` runs the same items through the acquire
spine). Same parse, two consumers — neither re-implements feedparser.

This module only reports what the feed said; whether an entry's ``content`` is
the article or a lede is decided downstream, in ``sources/rss.entries_to_items``.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

import feedparser

logger = logging.getLogger(__name__)


def parse_feed(source: Any) -> Tuple[str, List[Dict[str, Any]]]:
    """Parse an RSS/Atom feed (a URL, bytes, or str — feedparser accepts all three)
    → ``(feed_title, entries)``. Each entry is a plain dict:
    ``identity / title / link / content / summary / author / published / tags / images``.

    ``identity`` is the dedup key the ingest spine keys on — the article URL, so it
    agrees with every other network source."""
    feed = feedparser.parse(source)
    title = feed.feed.get("title", "RSS Feed")
    out: List[Dict[str, Any]] = []
    for e in feed.entries:
        # Identity prefers the LINK over the feed's declared id. Every other network
        # source (web, web_search, crawl) keys on the URL, so preferring an opaque guid
        # here would give the same article two identities and defeat cross-source dedup —
        # measured: 25k assets with non-URL identities, 41 articles duplicated that way.
        # A guid is marginally more stable within one feed, but drift is the source_token's
        # job, not identity's. Fall back to the id when a feed omits the link.
        identity = e.get("link") or e.get("id", "")
        if not identity:
            continue
        out.append({
            "identity": identity,
            "title": e.get("title", "RSS Item"),
            "link": e.get("link", ""),
            "content": _entry_content(e),
            "summary": e.get("summary", ""),
            "author": e.get("author", ""),
            "published": e.get("published") or e.get("updated"),
            "tags": [t.get("term", "") for t in e.get("tags", [])],
            "images": _entry_images(e),
        })
    return title, out


def _entry_content(entry: Any) -> str:
    """Prefer <content:encoded> (feedparser's entry.content); fall back to summary."""
    if getattr(entry, "content", None):
        return entry.content[0].get("value", "")
    return entry.get("summary", "") or entry.get("description", "")


def _entry_images(entry: Any) -> List[Dict[str, Any]]:
    """media:content image enclosures — reported for the consumer to turn into child
    IMAGE assets. This only *reports* them; it never builds."""
    images: List[Dict[str, Any]] = []
    for idx, media in enumerate(getattr(entry, "media_content", []) or []):
        url = media.get("url")
        if not url:
            continue
        mtype = media.get("type", "")
        is_image = (
            mtype.startswith("image")
            or mtype == "application/octet-stream"
            or url.lower().endswith((".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"))
        )
        if not is_image:
            continue
        images.append({
            "url": url,
            "role": "featured" if idx == 0 else "content",
            "media_credit": media.get("media_credit") or media.get("credit"),
            "part_index": idx,
        })
    return images
