"""RSS/Atom feed *document* content type — a fetched-or-uploaded feed file.

A feed URL fetched by ``web`` (or an uploaded ``.rss`` / ``.xml``) is detected here
and expanded **into a bundle named after the feed**: each entry becomes an ARTICLE
asset carrying the feed's **inline content** (no re-scrape of the article URL), and
the feed artifact sits beside them. This is the *document* half; the *watched
subscription* is the ``rss`` SOURCE, which yields the same inline-content ARTICLE
items per poll. Both call the one ``parse_feed`` — neither re-implements feedparser.

Articles are standalone documents → they land as **bundle members** (not children of
the feed). ARTICLE has no processor, so they are born READY; enrichment (embedding,
geocoding) rides the enricher schedule.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import List, Optional
from urllib.parse import urlparse

import dateutil.parser

from app.api.modules.content.models import Asset, AssetKind
from app.api.modules.content.types import content_type

logger = logging.getLogger(__name__)


@content_type(
    kind=AssetKind.RSS_FEED,
    mimetypes={"application/rss+xml", "application/atom+xml", "application/x-rss+xml"},
    is_container=True,
    category="document",
)
class FeedDocument:
    """A fetched feed file → one inline-content ARTICLE asset per entry, in a bundle."""

    @staticmethod
    def recognizes(head: bytes) -> bool:
        h = head[:1024].lower()
        return b"<rss" in h or b"<feed" in h or b"<rdf:rdf" in h

    async def process(self, context, asset: Asset) -> List[Asset]:
        if not asset.blob_path:
            raise ValueError(f"RSS_FEED has no blob_path: asset {asset.id}")
        from app.api.modules.content.utils.storage_access import read_to_bytes
        from app.api.modules.content.utils.feed_parse import parse_feed
        from app.api.modules.content.asset_builder import AssetBuilder
        from app.api.modules.content.tree import expand_into_bundle

        raw = await read_to_bytes(context.storage_provider, asset.blob_path)
        feed_title, entries = await asyncio.to_thread(parse_feed, raw)

        # One bundle named after the feed; the feed artifact moves inside it.
        bundle_id = expand_into_bundle(context.session, asset.infospace_id, asset.user_id,
                                       asset, feed_title or asset.title or "feed")
        created = skipped = 0
        for e in entries:
            guid = e.get("guid") or e.get("link")
            if not guid:
                continue
            content = e.get("content") or e.get("summary") or ""
            builder = (
                AssetBuilder(context.session, context.user_id, context.infospace_id)
                .as_kind(AssetKind.ARTICLE).with_title(e.get("title") or guid)
                .with_source(guid).dedup_on(source_identifier=guid).on_match("skip")
                .with_text(content)
                .with_content_hash(
                    hashlib.md5(f"{guid}|{content[:1000]}".encode("utf-8", "ignore")).hexdigest()
                )
                .into_bundle(bundle_id)
                .with_metadata(
                    rss_link=e.get("link"), rss_summary=e.get("summary"),
                    rss_author=e.get("author"), rss_tags=e.get("tags"),
                    rss_images=e.get("images"), feed_title=feed_title,
                    content_format="html", content_source="rss_feed",
                )
            )
            pub = e.get("published")
            if pub:
                try:
                    builder.with_timestamp(dateutil.parser.parse(pub))
                except Exception:
                    pass
            status = (await builder.build_outcome()).status
            if status == "created":
                created += 1
            elif status == "skipped":
                skipped += 1

        asset.file_info = {**(asset.file_info or {}), "feed_title": feed_title,
                           "entry_count": created + skipped}
        context.session.add(asset)
        context.session.commit()
        logger.info("Expanded FEED %s '%s' into bundle %s: %d new, %d existing",
                    asset.id, feed_title, bundle_id, created, skipped)
        return []

    def preview(self, asset: Asset, children: Optional[List[Asset]] = None) -> dict:
        return {"feed_title": (asset.file_info or {}).get("feed_title"),
                "entry_count": (asset.file_info or {}).get("entry_count", 0)}
