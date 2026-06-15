"""Web article content type (kind=WEB).

A scraped web page → cleaned text on the parent + extracted images as child
IMAGE assets (stub URL references, not downloads). RSS-sourced ARTICLE assets
carry their images in ``file_info["rss_images"]`` instead and are handled where
that flow is wired — this class owns the *scrape* path.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dateutil.parser

from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.types import content_type, Text, Image, article_preview

logger = logging.getLogger(__name__)


@content_type(
    kind=AssetKind.WEB,
    mimetypes={"text/html", "application/xhtml+xml"},
    is_container=True,
    modalities=[Text, Image],
    category="document",
)
class WebArticle:
    """Scrape a URL into text + image children. Modalities discovered: text,
    plus image when the page yields any."""

    async def process(self, context, asset: Asset) -> List[Asset]:
        if not asset.source_identifier:
            raise ValueError(f"WEB asset {asset.id} has no source_identifier")
        if not context.scraping_provider:
            raise ValueError("Scraping provider not available")

        scraped = await context.scraping_provider.scrape_url(
            asset.source_identifier, timeout=context.timeout,
        )
        if not scraped or not scraped.get("text_content"):
            raise ValueError("No content could be scraped from URL")

        asset.text_content = (scraped.get("text_content") or "").strip()
        if scraped.get("title"):
            asset.title = scraped["title"].strip()
        if scraped.get("publication_date"):
            try:
                dt = dateutil.parser.parse(scraped["publication_date"])
                asset.event_timestamp = dt.replace(tzinfo=dt.tzinfo or timezone.utc)
            except Exception:
                pass
        asset.file_info = {
            **(asset.file_info or {}),
            "scraped_at": datetime.now(timezone.utc).isoformat(),
            "scraped_title": scraped.get("title"),
            "top_image": scraped.get("top_image"),
            "summary": scraped.get("summary"),
            "publication_date": scraped.get("publication_date"),
            "content_length": len(asset.text_content),
        }

        children = _image_children(asset, scraped, context.max_images)
        if children:
            # Match by image URL (source_identifier) so a re-scrape keeps annotations on
            # images that are still present, orphans the gone ones (content.asset_builder).
            children = await context.persist_children(asset.id, children, match_key="source_identifier")
        asset.modalities = ["text", "image"] if children else ["text"]
        context.session.add(asset)
        logger.info("Processed WEB %s: %d image children", asset.id, len(children))
        return children

    def preview(self, asset: Asset, children: Optional[List[Asset]] = None) -> Dict[str, Any]:
        return article_preview(asset, children)


# ── internal helpers ───────────────────────────────────────────────────────────

_SKIP = (
    "logo", "icon", "avatar", "button", "badge", "banner", "header", "footer",
    "nav", "menu", "ad", "advertisement", "twitter.gif", "facebook.gif",
    "pixel.gif", "1x1.gif", "sprite", "tracking",
)


def _image_children(asset: Asset, scraped: Dict[str, Any], max_images: int) -> List[Asset]:
    """Build stub IMAGE child rows (URL references) for the page's images."""
    parent_info = {"title": asset.title, "url": asset.source_identifier, "asset_id": asset.id}
    scraped_at = (asset.file_info or {}).get("scraped_at", "")
    children: List[Asset] = []

    top = scraped.get("top_image")
    if top:
        children.append(Asset(
            title=f"Featured: {asset.title}", kind=AssetKind.IMAGE,
            user_id=asset.user_id, infospace_id=asset.infospace_id,
            source_identifier=top, processing_status=ProcessingStatus.READY,
            file_info={"image_role": "featured", "image_url": top,
                       "parent_article": parent_info, "scraped_at": scraped_at, "is_hero_image": True},
        ))

    start = 1 if top else 0
    for idx, url in enumerate(_filter_content_images(scraped.get("images", []), top)[:max_images]):
        children.append(Asset(
            title=f"Image {start + idx + 1}: {asset.title}", kind=AssetKind.IMAGE,
            user_id=asset.user_id, infospace_id=asset.infospace_id,
            source_identifier=url, processing_status=ProcessingStatus.READY,
            file_info={"image_role": "content", "image_url": url,
                       "parent_article": parent_info, "content_index": idx, "scraped_at": scraped_at},
        ))
    return children


def _filter_content_images(images: List[str], top_image: Optional[str] = None) -> List[str]:
    out: List[str] = []
    seen = {top_image} if top_image else set()
    for url in images or []:
        if url in seen:
            continue
        low = url.lower()
        if any(p in low for p in _SKIP) or any(d in url for d in ("16x16", "32x32", "64x64")):
            continue
        out.append(url)
        seen.add(url)
    return out
