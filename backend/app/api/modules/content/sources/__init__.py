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
#
# Note there is no hashing helper here. A source realizes *content*, not digests —
# `AssetBuilder.content_hash()` is the one derivation, and the builder applies it.
# The single exception is a source that stages a blob: it holds bytes the builder
# never sees, so it imports that same function rather than growing a second one.


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
