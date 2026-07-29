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
from app.api.modules.content.asset_builder import content_hash
from app.api.modules.content.sources import (
    FetchedContent, Preview, RawItem, source_type, stage_blob,
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
                # For non-inline URLs, HEAD to capture a drift token (ETag / Last-Modified)
                # and content-type hint. The token feeds the stage-1 guard so re-polls of
                # unchanged pages skip before fetch. The ct hint lets fetch() skip its own HEAD.
                token = None
                meta = {"ingestion_method": "web_url"}
                if not text:
                    ct_hint, token = await _head_signals(url)
                    if ct_hint:
                        meta["_ct"] = ct_hint
                yield RawItem(
                    source_identifier=url,
                    kind=AssetKind.ARTICLE if text else None,
                    title=title or url,
                    locator=url,
                    text=text,
                    source_token=token,
                    metadata=meta,
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
            # Pass-through; the builder derives the hash from the text.
            return FetchedContent(text_content=item.text, metadata=item.metadata)
        url = item.locator
        ct = (item.metadata or {}).get("_ct") or await _head_content_type(url)
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


async def _head_signals(url: str) -> tuple[Optional[str], Optional[str]]:
    """HEAD → (content_type, drift_token). The drift token is built from ETag,
    Last-Modified, or Content-Length — whatever the server provides. Both None
    on failure (safe: the stage-1 guard treats None as 'no drift signal')."""
    import aiohttp
    try:
        async with aiohttp.ClientSession() as sess:
            async with sess.head(url, allow_redirects=True,
                                 timeout=aiohttp.ClientTimeout(total=15)) as resp:
                ct = (resp.headers.get("Content-Type") or "").split(";", 1)[0].strip().lower() or None
                etag = resp.headers.get("ETag")
                if etag:
                    token = f"etag:{etag}"
                else:
                    parts = []
                    lm = resp.headers.get("Last-Modified")
                    cl = resp.headers.get("Content-Length")
                    if lm:
                        parts.append(f"lm:{lm}")
                    if cl:
                        parts.append(f"cl:{cl}")
                    token = "|".join(parts) or None
                return ct, token
    except Exception:
        return None, None


async def _head_content_type(url: str) -> Optional[str]:
    """Fallback for fetch() when read() didn't capture a ct hint (one-shot intake)."""
    ct, _ = await _head_signals(url)
    return ct


async def _download(url: str) -> bytes:
    import aiohttp
    async with aiohttp.ClientSession() as sess:
        async with sess.get(url, allow_redirects=True,
                            timeout=aiohttp.ClientTimeout(total=120)) as resp:
            resp.raise_for_status()
            return await resp.read()


def _blob_name(url: str, ct: str) -> str:
    """Stable storage path for a downloaded web file: managed/web/<url-hash>/<name>.
    Reuses the one derivation as a path-safe key — not an identity, just a stable name."""
    base = (urlparse(url).path.rsplit("/", 1)[-1] or "download").split("?")[0]
    return f"managed/web/{content_hash(url)[:16]}/{base}"
