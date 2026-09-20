"""
scraping/base.py — the contract.
================================

  url  ──►  scrape_url()  ──►  { text_content · title · publication_date
                                 top_image · summary · images  … }
                                        │
                                        └─ the six keys content/types/
                                           web_article.py actually reads

  url  ──►  analyze_source()  ──►  { feed_urls · categories
                                      recent_articles }

  discover_rss_feeds()  ──►  just the feed_urls from analyze_source()

  article_parser   a library, no wire — a second parser would share this
"""

from __future__ import annotations
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


@runtime_checkable
class ScrapingProvider(Protocol):
    """Extract article content from web pages."""

    async def scrape_url(self, url: str, *, timeout: Optional[int] = None,
                         retry_attempts: int = 1) -> Dict[str, Any]:
        """Scrape one URL. Raises ``ValueError`` if nothing could be extracted.

        Returns a dict whose load-bearing keys are ``text_content``, ``title``,
        ``publication_date``, ``top_image``, ``summary`` and ``images`` — the six
        ``content/types/web_article.py`` reads. The rest is metadata that reaches
        the HTTP surface unchanged.
        """
        ...

    async def analyze_source(self, base_url: str) -> Dict[str, Any]:
        """Discover feeds, categories and recent articles for a news source."""
        ...

    async def discover_rss_feeds(self, base_url: str) -> List[str]:
        """Just the feed URLs from ``analyze_source``."""
        ...
