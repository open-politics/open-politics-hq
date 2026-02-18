"""
RSS Handler
===========

Handles RSS feed ingestion, preview, and discovery from awesome-rss-feeds.

Instance methods (require IngestionContext):
- handle(locator, title, options): Ingest RSS feed at URL, create article assets.

Static/class methods (no context needed):
- preview_rss_feed(feed_url, max_items): Parse feed, return feed_info + items (no DB).
- discover_rss_feeds_from_awesome_repo(country, category, limit): Fetch OPML from
  plenaryapp/awesome-rss-feeds, return list of {title, url, description, ...}.

Class methods (require IngestionContext):
- ingest_from_awesome_repo(context, country, ...): Discover feeds for country,
  ingest each via handle(), add to bundle if specified.
"""

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import feedparser

from app.models import Asset, AssetKind
from app.api.content.services.asset_builder import AssetBuilder
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


class RSSHandler(BaseHandler):
    """
    Handle RSS feed ingestion.

    Uses AssetBuilder's from_rss_entry() pattern.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Handle RSS feed ingestion.

        Args:
            locator: URL of RSS feed
            title: Unused (feed supplies titles)
            options: Processing options (max_items, etc.)

        Returns:
            List of created article assets
        """
        feed_url = locator if isinstance(locator, str) else str(locator)
        options = options or {}
        max_items = options.get("max_items", 50)

        try:
            feed = feedparser.parse(feed_url)

            feed_title = feed.feed.get("title", "RSS Feed")
            feed_metadata = {
                "feed_title": feed_title,
                "feed_url": feed_url,
                "feed_description": feed.feed.get("description", ""),
                "feed_language": feed.feed.get("language", ""),
                "feed_updated": feed.feed.get("updated", ""),
                "feed_generator": feed.feed.get("generator", ""),
            }

            logger.info(
                f"Processing RSS feed '{feed_title}' with "
                f"{len(feed.entries[:max_items])} entries"
            )

            articles = []
            for i, entry in enumerate(feed.entries[:max_items]):
                try:
                    article = await (
                        AssetBuilder(
                            self.session, self.user_id, self.infospace_id
                        )
                        .from_rss_entry(entry, feed_url, i)
                        .as_kind(AssetKind.ARTICLE)
                        .build()
                    )

                    if article.source_metadata:
                        article.source_metadata.update(feed_metadata)
                        self.session.add(article)

                    articles.append(article)
                    logger.debug(f"Created article: {article.title}")

                except Exception as e:
                    logger.error(f"Failed to process RSS entry {i}: {e}")
                    continue

            self.session.commit()
            logger.info(
                f"RSS feed processing completed: {len(articles)} articles "
                f"created from '{feed_title}'"
            )
            return articles

        except ImportError:
            raise ValueError(
                "feedparser library not installed. "
                "Install with: pip install feedparser"
            )
        except Exception as e:
            raise ValueError(f"RSS feed processing failed: {e}")

    # ─────────────────────────────────────────────────────────────────
    # RSS discovery and preview (no ingestion context needed)
    # ─────────────────────────────────────────────────────────────────

    @staticmethod
    async def preview_rss_feed(feed_url: str, max_items: int = 20) -> Dict[str, Any]:
        """Preview RSS feed without creating assets."""
        try:
            feed = feedparser.parse(feed_url)

            if feed.bozo:
                raise ValueError(f"Feed parsing error: {feed.bozo_exception}")

            feed_info = {
                "title": feed.feed.get("title", "Unknown Feed"),
                "description": feed.feed.get("description", ""),
                "link": feed.feed.get("link", ""),
                "language": feed.feed.get("language", ""),
                "updated": feed.feed.get("updated", ""),
                "total_items": len(feed.entries),
            }

            items = []
            for i, entry in enumerate(feed.entries[:max_items]):
                item = {
                    "index": i,
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "summary": entry.get("summary", ""),
                    "published": entry.get("published", ""),
                    "author": entry.get("author", ""),
                    "tags": [tag.get("term", "") for tag in entry.get("tags", [])],
                    "id": entry.get("id", ""),
                    "content": (
                        entry.get("content", [{}])[0].get("value", "")
                        if entry.get("content")
                        else ""
                    ),
                }
                items.append(item)

            return {
                "feed_info": feed_info,
                "items": items,
                "feed_url": feed_url,
                "previewed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"Failed to preview RSS feed {feed_url}: {e}", exc_info=True)
            raise

    @staticmethod
    async def discover_rss_feeds_from_awesome_repo(
        country: Optional[str] = None,
        category: Optional[str] = None,
        limit: int = 50,
    ) -> List[Dict[str, Any]]:
        """Discover RSS feeds from awesome-rss-feeds GitHub repository."""
        try:
            base_url = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master"

            if country:
                feeds = await RSSHandler._fetch_and_parse_opml(
                    f"{base_url}/countries/with_category/{country}.opml", country
                )
            else:
                feeds = await RSSHandler._fetch_all_country_feeds(
                    base_url, category, limit
                )

            if category:
                feeds = [
                    feed
                    for feed in feeds
                    if category.lower() in feed.get("title", "").lower()
                    or category.lower() in feed.get("description", "").lower()
                ]

            return feeds[:limit]

        except Exception as e:
            logger.error(f"Failed to discover RSS feeds: {e}")
            return []

    @staticmethod
    async def _fetch_and_parse_opml(opml_url: str, country: str) -> List[Dict[str, Any]]:
        """Fetch and parse OPML file."""
        try:
            import aiohttp

            async with aiohttp.ClientSession() as session:
                async with session.get(opml_url) as response:
                    if response.status == 200:
                        opml_content = await response.text()
                        return RSSHandler._parse_opml_content(opml_content, country)
                    else:
                        logger.warning(
                            f"Failed to fetch OPML for {country}: HTTP {response.status}"
                        )
                        return []
        except Exception as e:
            logger.error(f"Error fetching OPML for {country}: {e}")
            return []

    @staticmethod
    async def _fetch_all_country_feeds(
        base_url: str,
        category: Optional[str],
        limit: int,
    ) -> List[Dict[str, Any]]:
        """Fetch feeds from all countries."""
        countries = [
            "Australia", "Bangladesh", "Brazil", "Canada", "Germany", "Spain", "France",
            "United Kingdom", "Hong Kong SAR China", "Indonesia", "Ireland", "India",
            "Iran", "Italy", "Japan", "Myanmar (Burma)", "Mexico", "Nigeria",
            "Philippines", "Pakistan", "Poland", "Russia", "Ukraine", "United States",
            "South Africa",
        ]

        all_feeds = []
        semaphore = asyncio.Semaphore(5)

        async def fetch_country_feeds(country_name):
            async with semaphore:
                opml_url = f"{base_url}/countries/with_category/{country_name}.opml"
                return await RSSHandler._fetch_and_parse_opml(opml_url, country_name)

        tasks = [fetch_country_feeds(c) for c in countries]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for result in results:
            if isinstance(result, list):
                all_feeds.extend(result)
            elif isinstance(result, Exception):
                logger.error(f"Error fetching country feeds: {result}")

        return all_feeds

    @staticmethod
    def _parse_opml_content(opml_content: str, country: str) -> List[Dict[str, Any]]:
        """Parse OPML and extract feed info."""
        try:
            root = ET.fromstring(opml_content)
            feeds = []

            for outline in root.iter():
                if outline.get("xmlUrl"):
                    feed_info = {
                        "title": outline.get("title", ""),
                        "description": outline.get("description", ""),
                        "url": outline.get("xmlUrl", ""),
                        "text": outline.get("text", ""),
                        "country": country,
                        "source": "awesome-rss-feeds",
                        "discovered_at": datetime.now(timezone.utc).isoformat(),
                    }
                    feeds.append(feed_info)

            logger.info(f"Parsed {len(feeds)} RSS feeds from {country}")
            return feeds

        except ET.ParseError as e:
            logger.error(f"Failed to parse OPML for {country}: {e}")
            return []
        except Exception as e:
            logger.error(f"Error parsing OPML for {country}: {e}")
            return []

    @classmethod
    async def ingest_from_awesome_repo(
        cls,
        context: IngestionContext,
        country: str,
        category_filter: Optional[str] = None,
        max_feeds: int = 10,
        max_items_per_feed: int = 20,
        bundle_id: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """
        Discover and ingest RSS feeds from awesome-rss-feeds repository.
        """
        from app.api.tree_builder import add_assets_to_bundle

        try:
            discovered_feeds = await cls.discover_rss_feeds_from_awesome_repo(
                country=country,
                category=category_filter,
                limit=max_feeds,
            )

            if not discovered_feeds:
                logger.warning(f"No RSS feeds found for country: {country}")
                return []

            logger.info(f"Discovered {len(discovered_feeds)} RSS feeds for {country}")

            handler = cls(context)
            all_assets = []

            for i, feed_info in enumerate(discovered_feeds):
                try:
                    feed_url = feed_info["url"]
                    feed_title = feed_info["title"]

                    logger.info(
                        f"Processing RSS feed {i+1}/{len(discovered_feeds)}: {feed_title}"
                    )

                    feed_options = {
                        "max_items": max_items_per_feed,
                        **(options or {}),
                    }

                    feed_assets = await handler.handle(feed_url, None, feed_options)

                    for asset in feed_assets:
                        if asset.source_metadata:
                            asset.source_metadata.update({
                                "discovery_source": "awesome-rss-feeds",
                                "discovery_country": country,
                                "discovery_category": category_filter,
                                "feed_description": feed_info.get("description", ""),
                                "feed_text": feed_info.get("text", ""),
                            })

                    all_assets.extend(feed_assets)

                    if bundle_id and feed_assets:
                        root_ids = [a.id for a in feed_assets if a.parent_asset_id is None]
                        if root_ids:
                            add_assets_to_bundle(
                                context.session,
                                bundle_id,
                                root_ids,
                                context.infospace_id,
                                include_children=True,
                            )

                except Exception as e:
                    logger.error(
                        f"Failed to process RSS feed {feed_info.get('title', 'Unknown')}: {e}"
                    )
                    continue

            context.session.commit()
            logger.info(
                f"RSS feed ingestion completed: {len(all_assets)} assets created "
                f"from {len(discovered_feeds)} feeds"
            )

            return all_assets

        except Exception as e:
            logger.error(f"RSS feed ingestion from awesome repo failed: {e}")
            return []
