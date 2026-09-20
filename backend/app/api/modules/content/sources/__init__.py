"""Source registry — one file per source type, uniform ``read`` / ``view`` / ``fetch``.

A Source is a **cursor-advancing item generator**. It NEVER builds assets — it
yields ``RawItem``s and the ingestion ``@task`` owns the build loop (composing
assets via ``AssetBuilder`` and counting ``BuildOutcome``s). One registry serves
both one-shot ingest (``read`` from an empty cursor) and a live poll (``read``
from the Source's stored cursor) — monitoring is the same act on a schedule.

  read(config, cursor, ctx)  -> async iterator of RawItem   # enumerate the map; cheap, no bytes
  view(item, ctx)            -> Preview                      # drill into one item, no ingest
  fetch(item, ctx)           -> FetchedContent               # realize content for the build loop

The cheap/expensive split is the scale lever: ``read`` yields lightweight
descriptors (identity + change-token + provenance), the task bulk-guards those
against what's already ingested, and only the survivors are ``fetch``ed. Drift
detection falls out the same way — a changed ``source_token`` means re-fetch.

Add a source: create ``sources/<kind>.py``, implement the three methods, decorate
with ``@source_type("<kind>")``. The registry indexes it; nothing else changes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, AsyncIterator, Dict, List, Optional, Protocol, Type, runtime_checkable

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind


@dataclass
class RawItem:
    """One thing a source surfaced — identity, change-token, and provenance, with
    no realized bytes (unless the source got content for free, e.g. an RSS entry's
    inline body, in which case ``text`` is populated)."""

    source_identifier: str                 # stable dedup key: URL, guid, absolute path
    kind: Optional[AssetKind]               # what this item IS, if read can name it cheaply
                                            # (filename/assertion); None → classify post-fetch
    title: str
    source_token: Optional[str] = None      # cheap drift signal: etag / mtime / pubdate
    path: Optional[str] = None               # folder position → bundle placement (transient; "" = flat)
    locator: Optional[str] = None            # what fetch() pulls (URL / path); may == source_identifier
    text: Optional[str] = None               # inline content when the source already had it
    event_timestamp: Optional[datetime] = None
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class FetchedContent:
    """Realized content for one item, ready for the build loop to compose an asset."""

    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    content_hash: Optional[str] = None
    event_timestamp: Optional[datetime] = None
    mimetype: Optional[str] = None          # e.g. a HEAD's Content-Type → detect_kind
    head: Optional[bytes] = None            # first bytes, for format sniffing → detect_kind
    metadata: Dict[str, Any] = field(default_factory=dict)


@dataclass
class Preview:
    """A look at one item without ingesting it — for the 'before you ingest' UI."""

    title: str
    summary: Optional[str] = None
    url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    extra: Dict[str, Any] = field(default_factory=dict)


@runtime_checkable
class SourceHandler(Protocol):
    """A source type: enumerate (read), preview one item (view), realize one (fetch)."""

    def read(
        self, config: Dict[str, Any], cursor: Dict[str, Any], ctx: SourceContext
    ) -> AsyncIterator[RawItem]:
        """Yield RawItems for the given config + cursor. Cheap; no content download."""
        ...

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        """Preview one item without ingesting it."""
        ...

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        """Realize one item's content (stream bytes / scrape) for the build loop."""
        ...


# ── Registry ─────────────────────────────────────────────────────────────────

_SOURCES: Dict[str, Type[SourceHandler]] = {}


def source_type(kind: str):
    """Decorator: register a SourceHandler class for a source kind. Symmetric with @content_type."""

    def deco(cls: Type[SourceHandler]) -> Type[SourceHandler]:
        _SOURCES[kind] = cls
        return cls

    return deco


def get_source_handler(kind: str) -> Optional[Type[SourceHandler]]:
    """Look up the registered source handler class for a kind."""
    return _SOURCES.get(kind)


def registered_source_kinds() -> List[str]:
    """All registered source kinds (for the ingestion @task's check query)."""
    return list(_SOURCES.keys())


# ── Shared helpers (what ≥2 source classes reach for) ──────────────────────────

#: Where "the source already had the content" stops and "the source had a
#: preview of it" begins, in characters.
#:
#: The realization contract says inline ``text`` is only for the FULL content —
#: a snippet is preview metadata, never ``text``. Some wires hand over both
#: shapes through the same field and nothing but length distinguishes them: an
#: RSS ``content:encoded`` body is the article, an RSS ``description`` is two
#: sentences of it, and both arrive as ``entry.content``. Above any metasearch
#: snippet (~150-300 chars), below a real article body.
#:
#: Lives here, with the contract it enforces, because ``search.web`` (L3) and
#: the RSS source (L2) apply the SAME rule and content cannot import from
#: search. It was defined in search first, which is why the feed path never got
#: it.
SCRAPE_THRESHOLD = 800

# Note there is no hashing helper here. A source realizes *content*, not digests —
# `AssetBuilder.content_hash()` is the one derivation, and the builder applies it.
# The single exception is a source that stages a blob: it holds bytes the builder
# never sees, so it imports that same function rather than growing a second one.


async def realize_article(
    item: "RawItem", ctx: "SourceContext", *, preview: str = "",
) -> "FetchedContent":
    """Second half of the realization contract, for the sources that need it.

    ``read`` sets ``text`` only when it already held the WHOLE article. Empty
    means the wire gave us a preview and the article is at ``item.locator``.
    This walks the locator and hands back the best text available:

    .. code-block:: text

        item.text                 ──► pass through, no network
        scrape(locator) ≥ preview ──► the article
        anything else             ──► the preview, marked as such

    **The scrape never fails the item.** A monitor that drops a story because a
    publisher answered 403 is worse than one that keeps the headline: the
    headline is still evidence the story ran, it still dedups on the same
    identity, and the article is recoverable on a later drift. That is also why
    this is not a content type — a processor that raises marks the asset FAILED
    and removes it from every run's scope permanently.

    A "scrape" shorter than the preview we already have is a consent wall or a
    stub page, not the article, so the preview wins on length rather than on
    presence.

    ``content_source`` on the returned metadata records which branch ran, so the
    corpus can be read honestly — "mean 2k chars" means nothing if a tenth of
    the rows are ledes and nothing says which.
    """
    if item.text:
        return FetchedContent(text_content=item.text,
                              event_timestamp=item.event_timestamp,
                              metadata=item.metadata)

    def _preview(source: str) -> "FetchedContent":
        return FetchedContent(text_content=preview,
                              event_timestamp=item.event_timestamp,
                              metadata={**(item.metadata or {}), "content_source": source})

    url = item.locator
    if not url or not ctx.scraping_provider:
        return _preview("preview_only")

    import logging
    try:
        scraped = await ctx.scraping_provider.scrape_url(url, timeout=30)
    except Exception as e:
        logging.getLogger(__name__).info(
            "Could not scrape %s (%s) — keeping the preview text", url, e)
        return _preview("preview_after_scrape_failed")

    text = ((scraped or {}).get("text_content") or "").strip()
    if len(text) < len(preview):
        return _preview("preview_beat_scrape")

    ts = item.event_timestamp
    if not ts and scraped.get("publication_date"):
        import dateutil.parser
        try:
            ts = dateutil.parser.parse(scraped["publication_date"])
        except Exception:
            pass
    return FetchedContent(
        text_content=text,
        event_timestamp=ts,
        metadata={
            **(item.metadata or {}),
            "content_source": "scraped",
            "content_format": "text",
            "scraped_title": scraped.get("title"),
            "top_image": scraped.get("top_image"),
            "content_length": len(text),
        },
    )


async def stage_blob(
    ctx: "SourceContext", data: bytes, object_name: str, *,
    filename: Optional[str] = None, content_type: Optional[str] = None,
) -> str:
    """Upload bytes to storage and return the blob_path (for sources that realize files)."""
    await ctx.storage_provider.upload_from_bytes(
        file_bytes=data, object_name=object_name,
        filename=filename or object_name.rsplit("/", 1)[-1],
        content_type=content_type or "application/octet-stream",
    )
    return object_name


# Side-effect imports: each source module runs @source_type on load.
# archive is no longer a source — a remote archive URL is fetched by `web` and
# unrolled by the ARCHIVE *content type* (content/types/archive.py).
from . import crawl, rss, text, web, web_search, upload, directory  # noqa: E402,F401
