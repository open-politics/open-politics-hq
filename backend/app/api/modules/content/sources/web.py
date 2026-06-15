"""Web source — an http(s) URL becomes one RawItem; its real kind is decided
*after* fetch.

``read`` only locates (yields the URL, kind left unset). ``fetch`` does a cheap
HEAD to learn the content-type: an HTML page stays a stub (the ``WebArticle`` type
scrapes it in ``process``), while a real file (pdf, image, …) is downloaded to a
blob so its own type can expand it. ``run_ingestion`` then names the kind via the
one ``detect_kind`` seam from the mimetype/head ``fetch`` hands back — so a dumped
PDF/image URL ingests as that type, not as a dead WEB stub.
"""

from __future__ import annotations

from typing import AsyncIterator, Optional
from urllib.parse import urlparse

from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import AssetKind
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, content_hash,
    source_type, stage_blob,
)


@source_type("web")
class WebPage:
    """``config = {urls: [str]}`` (or ``{url: str}``). A URL list folds in here —
    there's no separate 'url_list' source."""

    async def read(self, config: dict, cursor: dict, ctx: SourceContext) -> AsyncIterator[RawItem]:
        # Uniform opener: poll/single passes config directly; intake passes {"items": [...]}.
        # A spec carries one `url` or a `urls` list, and — when the content was already
        # realized upstream (a search result with its body) — an inline `text`. Inline
        # `text` makes `fetch` a pass-through; otherwise fetch scrapes/downloads the locator.
        for it in (config.get("items") or [config]):
            urls = it.get("urls") or ([it["url"]] if it.get("url") else [])
            title = it.get("title")
            text = it.get("text") or None
            for url in urls:
                if not url:
                    continue
                yield RawItem(
                    source_identifier=url,
                    # Content already in hand → it's an ARTICLE; else kind is decided
                    # post-fetch via detect_kind (HTML→WEB, pdf/img/…→that type).
                    kind=AssetKind.ARTICLE if text else None,
                    title=title or url,
                    locator=url,            # always kept → fetch can still scrape if needed
                    text=text,
                    metadata={"ingestion_method": "web_url"},
                )

    async def view(self, item: RawItem, ctx: SourceContext) -> Preview:
        return Preview(title=item.title, url=item.locator)

    async def fetch(self, item: RawItem, ctx: SourceContext) -> FetchedContent:
        """Realize content. Inline already (a search result carrying its body) → pass it
        through, no network. Else HEAD the URL: HTML/unknown → a stub the WebArticle type
        scrapes in ``process``; a real file → download to a blob. Either way return the
        mimetype/head so detect_kind names the kind. ``locator`` is always kept, so a
        future ``scrape_full`` knob could override the passthrough."""
        if item.text:
            return FetchedContent(
                text_content=item.text,
                content_hash=content_hash(item.text),
                metadata=item.metadata,
            )
        url = item.locator
        ct = await _head_content_type(url)
        if ct is None or ct in _HTML_CTS:
            # Page (or unknown content-type) — stay a stub; WebArticle.process realizes it.
            return FetchedContent(mimetype=ct or "text/html",
                                  metadata={"ingestion_method": "web_url"})
        # A real file: download once so the kind's process has the bytes.
        # NOTE: reads the whole body into memory — fine for typical web files
        # (pdf/image/doc); streaming + a size cap is a refinement for huge URLs.
        data = await _download(url)
        object_name = _blob_name(url, ct)
        await stage_blob(ctx, data, object_name, filename=item.title, content_type=ct)
        return FetchedContent(blob_path=object_name, mimetype=ct, head=data[:8192],
                              metadata={"ingestion_method": "web_url"})


# ── internal helpers ───────────────────────────────────────────────────────────

_HTML_CTS = {"text/html", "application/xhtml+xml"}


async def _head_content_type(url: str) -> Optional[str]:
    """Cheap HEAD → bare content-type (charset stripped). None if HEAD fails or
    omits it (treated as 'probably a page')."""
    import aiohttp
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.head(url, allow_redirects=True,
                                 timeout=aiohttp.ClientTimeout(total=15)) as resp:
                ct = (resp.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower()
                return ct or None
    except Exception:
        return None


async def _download(url: str) -> bytes:
    import aiohttp
    async with aiohttp.ClientSession() as sess:
        async with sess.get(url, allow_redirects=True,
                            timeout=aiohttp.ClientTimeout(total=120)) as resp:
            resp.raise_for_status()
            return await resp.read()


def _blob_name(url: str, ct: str) -> str:
    """Stable storage path for a downloaded web file: managed/web/<url-hash>/<name>."""
    base = (urlparse(url).path.rsplit("/", 1)[-1] or "download").split("?")[0]
    return f"managed/web/{content_hash(url)[:16]}/{base}"
