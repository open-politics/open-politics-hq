"""Web-search source — a query becomes ARTICLE RawItems via the search provider.

An answer engine returns whole articles; a metasearch engine returns two-line
snippets. Both arrive in the same field, so ``read`` applies the one length rule
(``SCRAPE_THRESHOLD``) and ``fetch`` acquires the article behind the URL when it
only got a snippet — the same shape ``/search/ingest`` already used when minting
``web`` jobs from the same hits, which is why the two paths used to disagree
about what the same result contained. A monitored query advances its cursor's
``seen_urls`` so re-polls skip already-ingested results.
"""

from __future__ import annotations

from typing import AsyncIterator

import dateutil.parser

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind
from app.api.modules.content.sources import (
    SCRAPE_THRESHOLD, FetchedContent, Preview, RawItem, realize_article, source_type,
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
            # `limit`, not `max_results`: the latter landed in **kwargs and matched
            # neither provider's option list, so it was silently dropped and each
            # engine used its own default.
            results = await ctx.search_provider.search(query, limit=it.get("max_results", 20))
            for i, r in enumerate(results):
                if not r.url or r.url in seen:
                    continue
                snippet = r.best_text or ""
                ts = None
                pub = r.published_date
                if pub:
                    try:
                        ts = dateutil.parser.parse(pub)
                    except Exception:
                        ts = None
                yield RawItem(
                    source_identifier=r.url,
                    kind=AssetKind.ARTICLE,
                    title=r.title or r.url,
                    # Drift token = publish date if the result has one, else None
                    # (= "no drift signal" → dedup on URL identity alone). NOT a hash of
                    # the snippet: search snippets wiggle between polls, which would
                    # spuriously re-ingest every result every cycle.
                    source_token=pub or None,
                    locator=r.url,
                    # Inline only when it IS the article; a snippet is preview
                    # metadata and `fetch` goes and gets the real thing.
                    text=(snippet if len(snippet) >= SCRAPE_THRESHOLD else None),
                    event_timestamp=ts,
                    metadata={
                        "search_query": query, "search_provider": getattr(r, "provider", None),
                        "search_score": getattr(r, "score", None), "search_rank": i + 1,
                        "search_snippet": snippet,
                    },
                )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, url=item.locator,
                       extra={"score": item.metadata.get("search_score")})

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        """Pass the article through; scrape the URL when read only got a snippet."""
        return await realize_article(
            item, ctx, preview=(item.metadata or {}).get("search_snippet") or "")
