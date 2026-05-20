"""
Web Handler
===========

Handles URL scraping and web content ingestion. WebHandler owns the shape of
a scraped web page (what fields the scraping provider returns, how they map
to asset metadata) and composes AssetBuilder setters directly.
"""

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dateutil.parser

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from app.api.modules.foundation_service_providers import resolve
from .base import BaseHandler

logger = logging.getLogger(__name__)


async def _compose_url_stub(
    builder: AssetBuilder, url: str, title: Optional[str]
) -> AssetBuilder:
    """URL bookmark — no scraping. Dedupes on URL to avoid duplicate bookmarks."""
    return (
        builder
        .as_kind(AssetKind.WEB)
        .as_stub(True)
        .with_title(title or url)
        .with_source(url)
        .with_metadata(ingestion_method="url_bookmark")
        .with_processing_status(ProcessingStatus.READY)
        .dedup_on(source_identifier=url)
        .on_match("skip")
    )


async def _compose_scraped_url(
    builder: AssetBuilder,
    url: str,
    title: Optional[str],
    infospace_id: int,
) -> AssetBuilder:
    """Scrape URL via scraping provider, compose builder from the result.

    Scraping failures don't fail the build — they mark the metadata and leave
    text_content empty. An enricher (or a manual retry) can fill it later.
    """
    base = (
        builder
        .as_kind(AssetKind.WEB)
        .with_title(title or f"Web: {url}")
        .with_source(url)
        .with_metadata(ingestion_method="url_scraping")
    )

    try:
        scraping = resolve("scraping", infospace_id=infospace_id)
        scraped = await scraping.scrape_url(url, timeout=30)
    except Exception as e:
        logger.error(f"Error scraping URL {url}: {e}")
        return (
            base
            .with_metadata(scraping_error=str(e))
            .dedup_on(source_identifier=url)
            .on_match("skip")
        )

    if not scraped or not scraped.get("text_content"):
        logger.warning(f"No content scraped from {url}")
        return base.dedup_on(source_identifier=url).on_match("skip")

    metadata = {
        "content_format": "markdown",
        "content_source": "web_scrape",
        "scraped_at": datetime.now(timezone.utc).isoformat(),
        "scraped_title": scraped.get("title"),
        "top_image": scraped.get("top_image"),
        "summary": scraped.get("summary"),
        "publication_date": scraped.get("publication_date"),
        "author": scraped.get("author"),
        "content_length": len(scraped["text_content"]),
    }

    scraped_title = scraped.get("title")
    composed = (
        base
        .with_text(scraped["text_content"])
        .with_metadata(**metadata)
        .dedup_on(source_identifier=url)
        .on_match("skip")
    )

    if scraped_title and not (title or "").startswith("Web:"):
        composed = composed.with_title(scraped_title)

    pub = scraped.get("publication_date")
    if pub:
        try:
            composed = composed.with_timestamp(dateutil.parser.parse(pub))
        except Exception:
            pass

    logger.info(f"Scraped {len(scraped['text_content'])} characters from {url}")
    return composed


class WebHandler(BaseHandler):
    """Handle web URL ingestion. Stub or full-scrape paths.

    Composes AssetBuilder setters directly — no from_X entry point.
    WebHandler owns scraping-provider invocation and result shape.
    """

    async def handle(
        self,
        locator: Any,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """Handle URL ingestion.

        Args:
            locator: URL string to scrape
            title: Optional custom title
            options: Scraping options (e.g. scrape_immediately)

        Returns:
            List containing the created asset
        """
        url = locator if isinstance(locator, str) else str(locator)
        options = options or {}
        scrape_immediately = options.get("scrape_immediately", True)

        builder = AssetBuilder(self.session, self.user_id, self.infospace_id)
        if scrape_immediately:
            builder = await _compose_scraped_url(builder, url, title, self.infospace_id)
        else:
            builder = await _compose_url_stub(builder, url, title)

        asset = await builder.build()
        self.session.commit()  # v2: builder flushes only; handler owns transaction
        self.session.refresh(asset)
        return [asset]

    async def handle_bulk(
        self,
        urls: List[str],
        base_title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> List[Asset]:
        """Handle bulk URL ingestion.

        Args:
            urls: List of URLs to scrape
            base_title: Base title for assets
            options: Scraping options

        Returns:
            List of created assets
        """
        assets = []
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                asset_list = await self.handle(url, url_title, options)
                assets.extend(asset_list)
            except Exception as e:
                logger.error(f"Failed to ingest URL {url}: {e}")
                continue

        return assets
