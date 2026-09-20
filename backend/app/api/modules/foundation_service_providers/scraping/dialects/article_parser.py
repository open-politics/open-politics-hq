"""
article_parser.py — article extraction via newspaper4k.
=======================================================

  url ──► newspaper.article() ──► Article ──► the 21-key dict (public API)
             │   (sync; wrapped in asyncio.to_thread)
             └─ empty text ──► retry w/ linear backoff ──► ValueError

  base_url ──► newspaper.build() ──► Source
                  ├─ feed_urls()
                  ├─ category_urls()      each independent; one failing
                  └─ articles[:20]        source still reports the rest

No wire: newspaper4k is a local, synchronous library, so the "dialect"
here is the parsing strategy, not a vendor.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List
from urllib.parse import urlparse

import newspaper

from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)


def _readable(url_path: str, *, fallback: str) -> str:
    """Turn a URL path segment into something a human can read."""
    try:
        parts = [p for p in urlparse(url_path).path.split("/") if p]
        if not parts:
            return fallback
        tail = parts[-1]
        for ext in (".html", ".htm", ".php", ".asp", ".aspx"):
            if tail.endswith(ext):
                tail = tail[: -len(ext)]
                break
        return tail.replace("-", " ").replace("_", " ").title()
    except Exception:
        return fallback


class ArticleParserScraper(Adapter):
    """newspaper4k."""

    def __init__(self, **kw):
        super().__init__(**kw)
        self._config = self._build_config()

    def _build_config(self) -> "newspaper.Config":
        q = self.quirks
        config = newspaper.Config()
        config.browser_user_agent = q.user_agent
        config.request_timeout = q.timeout
        config.number_threads = q.threads
        config.fetch_images = q.fetch_images
        config.memoize_articles = q.memoize_articles
        config.follow_meta_refresh = q.follow_meta_refresh
        config.http_success_only = q.http_success_only
        config.language = q.language
        return config

    # ── one article ──────────────────────────────────────────────────────────

    async def scrape_url(self, url: str, *, timeout: int | None = None,
                         retry_attempts: int = 1) -> Dict[str, Any]:
        config = self._build_config()
        if timeout is not None:
            config.request_timeout = timeout

        last_error: Exception | None = None
        for attempt in range(retry_attempts + 1):
            try:
                article = await asyncio.to_thread(newspaper.article, url, config=config)
                if article and article.text:
                    result = await self._extract(article, url)
                    logger.info("Scraped %s — %r, %d chars",
                                url, result["title"][:50], result["content_length"])
                    return result
                last_error = ValueError("Scraping yielded no content")
            except Exception as e:
                last_error = e
                logger.debug("Scrape attempt %d/%d failed for %s: %s",
                             attempt + 1, retry_attempts + 1, url, e)
            if attempt < retry_attempts:
                await asyncio.sleep(1 * (attempt + 1))      # linear backoff

        raise ValueError(f"Failed to scrape {url}: {last_error}")

    async def _extract(self, article: Any, original_url: str) -> Dict[str, Any]:
        """newspaper4k Article → the 21-key dict that is already public API."""
        if self.quirks.enable_nlp and hasattr(article, "nlp"):
            try:
                await asyncio.to_thread(article.nlp)
            except Exception as e:
                logger.warning("NLP pass failed for %s: %s", original_url, e)

        publication_date = None
        raw_date = getattr(article, "publish_date", None)
        if raw_date:
            publication_date = raw_date if isinstance(raw_date, str) else raw_date.isoformat()

        authors = list(getattr(article, "authors", None) or [])
        images = list(getattr(article, "images", None) or [])
        nlp_on = self.quirks.enable_nlp
        keywords = list(getattr(article, "keywords", None) or []) if nlp_on else []
        summary = getattr(article, "summary", "") if nlp_on else ""
        text = getattr(article, "text", "") or ""

        return {
            "url": original_url,
            "final_url": getattr(article, "url", original_url),   # redirects
            "title": getattr(article, "title", "") or "",
            "text_content": text,
            "publication_date": publication_date,
            "authors": authors,
            "top_image": getattr(article, "top_image", None),
            "images": images,
            "summary": summary,
            "keywords": keywords,
            "meta_description": getattr(article, "meta_description", "") or "",
            "meta_keywords": getattr(article, "meta_keywords", "") or "",
            "meta_lang": getattr(article, "meta_lang", "") or "",
            "canonical_link": getattr(article, "canonical_link", "") or "",
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scraping_method": "newspaper4k",
            "content_length": len(text),
            "image_count": len(images),
            "author_count": len(authors),
            "keyword_count": len(keywords),
            "raw_scraped_data": {
                "html_length": len(getattr(article, "html", "") or ""),
                "article_html_length": len(getattr(article, "article_html", "") or ""),
                "download_state": getattr(article, "download_state", None),
                "is_parsed": getattr(article, "is_parsed", False),
            },
        }

    # ── a whole source ───────────────────────────────────────────────────────

    async def analyze_source(self, base_url: str) -> Dict[str, Any]:
        """Discover feeds, categories and a sample of recent articles."""
        analysed_at = datetime.now(timezone.utc).isoformat()
        try:
            source = await asyncio.to_thread(newspaper.build, base_url, config=self._config)
        except Exception as e:
            logger.error("Source analysis failed for %s: %s", base_url, e)
            return {"base_url": base_url, "error": str(e),
                    "analyzed_at": analysed_at, "analysis_method": "newspaper4k"}

        result: Dict[str, Any] = {
            "base_url": base_url,
            "brand": getattr(source, "brand", "") or "",
            "description": getattr(source, "description", "") or "",
            "size": source.size(),
            "domain": getattr(source, "domain", "") or "",
            "favicon": getattr(source, "favicon", "") or "",
            "logo_url": getattr(source, "logo_url", "") or "",
            "rss_feeds": [], "feed_urls": [],
            "categories": [], "category_urls": [],
            "recent_articles": [],
            "analyzed_at": analysed_at,
            "analysis_method": "newspaper4k",
        }

        # Independent steps: a site with no feeds still reports its categories.
        try:
            feeds = list(source.feed_urls())
            result["feed_urls"] = feeds
            result["rss_feeds"] = [{"url": u, "title": "RSS Feed"} for u in feeds]
        except Exception as e:
            logger.warning("No RSS feeds from %s: %s", base_url, e)

        try:
            cats = list(source.category_urls())
            result["category_urls"] = cats
            result["categories"] = [
                {"url": u, "title": _readable(u, fallback="Category")} for u in cats
            ]
        except Exception as e:
            logger.warning("No categories from %s: %s", base_url, e)

        try:
            result["recent_articles"] = [
                {"url": a.url,
                 "title": getattr(a, "title", "") or _readable(a.url, fallback="Article")}
                for a in source.articles[:20]
            ]
        except Exception as e:
            logger.warning("No recent articles from %s: %s", base_url, e)

        logger.info("Analysed %s — %d feeds, %d categories, %d articles", base_url,
                    len(result["rss_feeds"]), len(result["categories"]),
                    len(result["recent_articles"]))
        return result

    async def discover_rss_feeds(self, base_url: str) -> List[str]:
        return (await self.analyze_source(base_url)).get("feed_urls", [])
