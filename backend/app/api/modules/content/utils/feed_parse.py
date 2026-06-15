"""Feed parsing — the one place RSS/Atom XML becomes entries.

Shared by two entry modes (Q3 of the redesign): the **watched** ``RSSFeed`` *source*
(its ``read`` streams entries as inline-content ARTICLE items each poll) and the
**one-shot** ``Feed`` *content type* (its ``process`` turns a dumped feed blob into
child WEB stubs that re-enter acquisition). Same parse, two consumers — neither
re-implements feedparser.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Tuple

import feedparser

logger = logging.getLogger(__name__)


def parse_feed(source: Any) -> Tuple[str, List[Dict[str, Any]]]:
    """Parse an RSS/Atom feed (a URL, bytes, or str — feedparser accepts all three)
    → ``(feed_title, entries)``. Each entry is a plain dict:
    ``guid / title / link / content / summary / author / published / tags / images``."""
    feed = feedparser.parse(source)
    title = feed.feed.get("title", "RSS Feed")
    out: List[Dict[str, Any]] = []
    for e in feed.entries:
        guid = e.get("id") or e.get("link", "")
        if not guid:
            continue
        out.append({
            "guid": guid,
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
