"""Web-search source — a query becomes ARTICLE RawItems via the search provider.

Search results carry their snippet/content inline, so ``read`` populates ``text``
and ``fetch`` packages it (no separate scrape). A monitored query advances its
cursor's ``seen_urls`` so re-polls skip already-ingested results.
"""

from __future__ import annotations

from typing import AsyncIterator

import dateutil.parser

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type,
)


@source_type("web_search")
class WebSearch:
    """``config = {query, max_results?}``; uses ``ctx.search_provider``."""

    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        if not ctx.search_provider:
            raise ValueError("No search provider configured for this infospace")
        seen = set(cursor.get("seen_urls", []))
        # Uniform opener: poll passes {query,...} directly; intake passes {"items": [...]}.
        for it in (config.get("items") or [config]):
            query = it.get("query")
            if not query:
                raise ValueError("web_search source missing query")
            results = await ctx.search_provider.search(query, max_results=it.get("max_results", 20))
            for i, r in enumerate(results):
                if not getattr(r, "url", None) or r.url in seen:
                    continue
                text = (getattr(r, "raw_data", None) or {}).get("raw_content") or getattr(r, "content", "") or ""
                ts = None
                pub = (getattr(r, "raw_data", None) or {}).get("published_date")
                if pub:
                    try:
                        ts = dateutil.parser.parse(pub)
                    except Exception:
                        ts = None
                yield RawItem(
                    source_identifier=r.url,
                    kind=AssetKind.ARTICLE,
                    title=getattr(r, "title", None) or r.url,
                    # Drift token = publish date if the result has one, else None
                    # (= "no drift signal" → dedup on URL identity alone). NOT a hash of
                    # the snippet: search snippets wiggle between polls, which would
                    # spuriously re-ingest every result every cycle.
                    source_token=pub or None,
                    locator=r.url,
                    text=text,
                    event_timestamp=ts,
                    metadata={
                        "search_query": query, "search_provider": getattr(r, "provider", None),
                        "search_score": getattr(r, "score", None), "search_rank": i + 1,
                        "content_source": "search_result",
                    },
                )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, url=item.locator,
                       extra={"score": item.metadata.get("search_score")})

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        # Pass-through: read already carried the body. The builder derives the hash.
        return FetchedContent(
            text_content=item.text,
            event_timestamp=item.event_timestamp, metadata=item.metadata,
        )
