"""RSS/Atom feed *document* content type — a fetched-or-uploaded feed file.

A feed URL fetched by ``web`` (or an uploaded ``.rss`` / ``.xml``) is detected here
and expanded **into a bundle named after the feed**: each entry becomes an ARTICLE
asset carrying the feed's **inline content** (no re-scrape of the article URL), and
the feed artifact sits beside them. This is the *document* half; the *watched
subscription* is the ``rss`` SOURCE, which yields the same inline-content ARTICLE
items per poll. Both run the ONE acquire spine — ``parse_feed`` → ``entries_to_items``
→ ``intake_items`` — so a feed ingested as a document and the same feed watched as a
subscription converge on identical assets, not two shapes that drift apart.

Articles are standalone documents → they land as **bundle members** (not children of
the feed). ARTICLE has no processor, so they are born READY; enrichment (embedding,
geocoding) rides the enricher schedule.
"""

from __future__ import annotations

import asyncio
import logging
from typing import List, Optional

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
        from app.api.modules.content.contexts import SourceContext
        from app.api.modules.content.sources.rss import RSSFeed, entries_to_items
        from app.api.modules.content.tasks.ingestion import intake_items
        from app.api.modules.content.tree import expand_into_bundle
        from app.api.modules.content.utils.feed_parse import parse_feed
        from app.api.modules.content.utils.storage_access import read_to_bytes
        from app.core.config import settings

        raw = await read_to_bytes(context.storage_provider, asset.blob_path)
        feed_title, entries = await asyncio.to_thread(parse_feed, raw)

        # One bundle named after the feed; the feed artifact moves inside it.
        bundle_id = expand_into_bundle(context.session, asset.infospace_id, asset.user_id,
                                       asset, feed_title or asset.title or "feed")

        # Run the ONE acquire spine rather than a second build loop. This path used to
        # compose its own AssetBuilder chain — disagreeing with the rss *source* on
        # metadata keys and match policy, so the same feed ingested as a document vs a
        # subscription produced two different asset shapes. Now both go through
        # entries_to_items + intake_items and land identically, with the bulk guard,
        # drift tokens and BuildOutcome counting for free.
        items = entries_to_items(feed_title, entries, (asset.file_info or {}).get("rss_feed_url"))
        sctx = SourceContext(
            session=context.session, user_id=context.user_id,
            infospace_id=context.infospace_id, settings=settings,
            storage_provider=context.storage_provider,
            scraping_provider=context.scraping_provider,
        )
        counts = await intake_items(items, RSSFeed(), sctx, dest_id=bundle_id)

        asset.file_info = {**(asset.file_info or {}), "feed_title": feed_title,
                           "entry_count": sum(counts.values())}
        context.session.add(asset)
        context.session.commit()
        logger.info("Expanded FEED %s '%s' into bundle %s: %s",
                    asset.id, feed_title, bundle_id, counts)
        return []

    def preview(self, asset: Asset, children: Optional[List[Asset]] = None) -> dict:
        return {"feed_title": (asset.file_info or {}).get("feed_title"),
                "entry_count": (asset.file_info or {}).get("entry_count", 0)}
