"""
RSS Handler
===========

Handles RSS feed ingestion, preview, and discovery from awesome-rss-feeds.
RSSHandler owns the shape of a feedparser entry (content:encoded extraction,
media:content image shape, publication-date parsing) and composes AssetBuilder
setters directly.

Instance methods (require IngestionContext):
- handle(locator, title, options): Ingest RSS feed at URL, create article assets.

Static/class methods (no context needed):
- preview_rss_feed(feed_url, max_items): Parse feed, return feed_info + items (no DB).
- discover_rss_feeds_from_awesome_repo(country, category, limit): Fetch OPML from
  plenaryapp/awesome-rss-feeds, return list of {title, url, description, ...}.
"""

import asyncio
import logging
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dateutil.parser
import feedparser

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


def _extract_rss_content(entry: Any) -> str:
    """Prefer <content:encoded> via feedparser's entry.content; fall back to summary."""
    if hasattr(entry, "content") and entry.content:
        return entry.content[0].get("value", "")
    return entry.get("summary", "") or entry.get("description", "")


def _extract_rss_images(entry: Any) -> List[Dict[str, Any]]:
    """Extract media:content images from an RSS entry.

    Returns a list of {url, title, role, media_credit, part_index} dicts.
    """
    images: List[Dict[str, Any]] = []
    if not hasattr(entry, "media_content"):
        return images

    for idx, media in enumerate(entry.media_content):
        media_type = media.get("type", "")
        image_url = media.get("url")
        if not image_url:
            continue

        is_image = (
            (media_type and media_type.startswith("image"))
            or media_type == "application/octet-stream"
            or any(image_url.lower().endswith(ext) for ext in [
                ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"
            ])
        )
        if not is_image:
            continue

        image_title = None
        if "media_title" in media:
            image_title = media.get("media_title")
        elif hasattr(media, "title"):
            image_title = media.title
        if not image_title and hasattr(entry, "media_title"):
            image_title = entry.media_title

        images.append({
            "url": image_url,
            "title": image_title,
            "role": "featured" if idx == 0 else "content",
            "media_credit": media.get("media_credit") or media.get("credit"),
            "part_index": idx,
        })
    return images


def _compose_rss_entry(
    builder: AssetBuilder, entry: Any, feed_url: str, part_index: int = 0
) -> AssetBuilder:
    """Configure builder from a feedparser entry. Private helper — RSS-only."""
    title = entry.get("title", "RSS Item")
    content_text = _extract_rss_content(entry)
    image_urls = _extract_rss_images(entry)

    metadata = {
        "content_format": "html",
        "content_source": "rss_feed",
        "ingestion_method": "rss_content_extraction",
        "guid": entry.get("id", ""),
        "author": entry.get("author", ""),
        "publication_date": entry.get("published", ""),
        "summary": entry.get("summary", ""),
        "top_image": image_urls[0]["url"] if image_urls else None,
        "rss_feed_url": feed_url,
        "rss_item_id": entry.get("id", ""),
        "rss_published_date": entry.get("published", ""),
        "rss_updated_date": entry.get("updated", ""),
        "rss_author": entry.get("author", ""),
        "rss_summary": entry.get("summary", ""),
        "rss_tags": [tag.get("term", "") for tag in entry.get("tags", [])],
        "rss_link": entry.get("link", ""),
        "has_full_content": bool(hasattr(entry, "content") and entry.content),
        "content_length": len(content_text),
        "rss_images": image_urls,
    }

    composed = (
        builder
        .as_kind(AssetKind.ARTICLE)
        .with_title(title)
        .with_text(content_text)
        .with_source(entry.get("link", ""))
        .with_part_index(part_index)
        .with_metadata(**metadata)
        .with_processing_status(ProcessingStatus.READY)
        # Dedupe by RSS GUID (or link fallback). on_match="supersede" combined
        # with AssetBuilder's skip-if-content-identical semantics gives us
        # supersede-on-content-change: same GUID + same content → skip,
        # same GUID + different content → old superseded, new row linked via
        # previous_asset_id. Closes a silent-duplicate bug in the RSS handler.
        .dedup_on(source_identifier=entry.get("id") or entry.get("link", ""))
        .on_match("supersede")
    )

    pub_date = entry.get("published") or entry.get("updated")
    if pub_date:
        try:
            composed = composed.with_timestamp(dateutil.parser.parse(pub_date))
        except Exception:
            pass

    return composed


def _build_rss_image_children(
    session,
    user_id: int,
    infospace_id: int,
    image_urls: List[Dict[str, Any]],
) -> List[Asset]:
    """Construct Asset rows for RSS-entry media:content images.

    Stub image assets — just URL references, no download. Handler later
    calls builder.build_children(parent_id, children) to insert them.
    """
    children: List[Asset] = []
    for idx, img in enumerate(image_urls):
        image_url = img.get("url")
        if not image_url:
            continue
        is_featured = idx == 0
        role = img.get("role", "featured" if is_featured else "content")
        children.append(Asset(
            kind=AssetKind.IMAGE,
            stub=True,
            title=img.get("title") or ("Featured image" if is_featured else f"Image {idx + 1}"),
            source_identifier=image_url,
            user_id=user_id,
            infospace_id=infospace_id,
            processing_status=ProcessingStatus.READY,
            file_info={
                "source": "rss_media_content",
                "image_role": role,
                "is_hero_image": is_featured,
                "image_url": image_url,
                "media_credit": img.get("media_credit"),
                "extracted_from_rss": True,
                "ingestion_method": "url_bookmark",
            },
        ))
    return children


class RSSHandler(BaseHandler):
    """Handle RSS feed ingestion.

    Composes AssetBuilder setters directly — no from_X entry point.
    RSSHandler owns feedparser shape, content extraction, image extraction.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """Handle RSS feed ingestion.

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

            articles: List[Asset] = []
            for i, entry in enumerate(feed.entries[:max_items]):
                try:
                    builder = AssetBuilder(
                        self.session, self.user_id, self.infospace_id
                    )
                    builder = _compose_rss_entry(builder, entry, feed_url, i)
                    builder = builder.with_metadata(**feed_metadata)
                    article = await builder.build()

                    # Create child image assets (stub bookmarks)
                    image_urls = _extract_rss_images(entry)
                    if image_urls:
                        children = _build_rss_image_children(
                            self.session, self.user_id, self.infospace_id, image_urls,
                        )
                        child_builder = AssetBuilder(
                            self.session, self.user_id, self.infospace_id
                        )
                        await child_builder.build_children(article.id, children)

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
                        file_info = asset.file_info or {}
                        file_info.update({
                                "discovery_source": "awesome-rss-feeds",
                                "discovery_country": country,
                                "discovery_category": category_filter,
                                "feed_description": feed_info.get("description", ""),
                                "feed_text": feed_info.get("text", ""),
                            })
                        asset.file_info = file_info

                    all_assets.extend(feed_assets)

                    if bundle_id and feed_assets:
                        root_ids = [a.id for a in feed_assets if a.parent_asset_id is None]
                        if root_ids:
                            from app.core.tree import copy as tree_copy
                            tree_copy(context.session, asset_ids=root_ids, to=bundle_id)

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
