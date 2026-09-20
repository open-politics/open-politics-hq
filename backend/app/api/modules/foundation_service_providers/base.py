"""
base.py — the transport every dialect adapter shares.
=====================================================

  Adapter(descriptor, quirks, api_key, base_url, **extra)
       ├──► .descriptor / .quirks / .api_key / .base_url / .extra
       └──► .client   lazy httpx.AsyncClient — one per instance
                 timeout   self.timeout, 900s default, per-subclass override
                 headers   self.headers(), {} unless a wire overrides it

  .url(path) ──► f"{base_url}/{path.lstrip('/')}"

  ONE PRIMITIVE, TWO FRAMINGS
    ._stream_lines(url, payload)
         raises on HTTP >=400 BEFORE the first yield — so retry logic
         can inspect the error instead of an already-consumed stream
              ├──► .sse(...)     ``data:`` lines, JSON, skips "[DONE]"
              └──► .ndjson(...)  one JSON object per line, no prefix

  Fourteen dialect adapters share this file. Before it existed, four
  of five language providers configured no timeout at all.

  NOT IN THIS FILE
    primitives.py            Setting — what api_key/base_url resolve from.
    <domain>/dialects/*.py   the subclasses that call these.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

logger = logging.getLogger(__name__)

# Generous, because local CPU inference is legitimately slow — but finite.
DEFAULT_TIMEOUT_SECONDS = 900.0


class Adapter:
    """Base for every dialect adapter.

    Subclasses implement the domain protocol (``geocode``, ``embed_texts``,
    ``extract_text``, …). They get ``self.base_url`` / ``self.api_key`` /
    ``self.quirks`` / ``self.descriptor`` for free, plus a lazily-created shared
    ``httpx`` client.

    ``**extra`` swallows whatever an ``extra=`` lambda supplied on the
    declaration; subclasses that need those values name them explicitly in
    their own ``__init__`` and pass the rest up.
    """

    #: Per-adapter override. Set on a subclass when its wire needs a different budget.
    timeout: float = DEFAULT_TIMEOUT_SECONDS

    def __init__(
        self,
        *,
        descriptor: Any = None,
        quirks: Any = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
        **extra: Any,
    ):
        self.descriptor = descriptor
        self.quirks = quirks
        self.api_key = api_key
        self.base_url = base_url.rstrip("/") if base_url else None
        self.extra = extra
        self._client: Optional[httpx.AsyncClient] = None

    # ── transport ────────────────────────────────────────────────────────────

    @property
    def client(self) -> httpx.AsyncClient:
        """Lazily-created async client. One per adapter instance.

        Adapter instances are currently per-resolve (see
        `docs/plans/found-adjacent-2026-09.md` §5 — pooling these is a
        follow-up), so this is created on first use rather than in ``__init__``
        to keep construction free for the many resolves that never make a call.
        """
        if self._client is None:
            self._client = httpx.AsyncClient(timeout=self.timeout, headers=self.headers())
        return self._client

    def headers(self) -> dict:
        """Auth headers for this endpoint. Override where the wire differs."""
        return {}

    def url(self, path: str) -> str:
        """Join a path onto the endpoint's base URL."""
        if not self.base_url:
            raise ValueError(f"{type(self).__name__} has no base_url configured")
        return f"{self.base_url}/{path.lstrip('/')}"

    # ── streaming frames ─────────────────────────────────────────────────────
    # Two framings cover every endpoint; they live here because they are transport.

    async def _stream_lines(self, url: str, payload: dict, headers: dict | None = None):
        """POST and iterate response lines, raising on a non-2xx before any yield.

        Failing *before* the first yield is what lets the engine's retry logic
        inspect the error — a failure surfacing mid-iteration is far harder to
        recover from, because the caller has already seen partial output.
        """
        async with self.client.stream("POST", url, json=payload,
                                      headers=headers or None) as response:
            if response.status_code >= 400:
                body = (await response.aread()).decode("utf-8", "replace")
                logger.error("HTTP %s from %s: %.500s", response.status_code, url, body)
                raise httpx.HTTPStatusError(
                    f"HTTP {response.status_code}: {body[:500]}",
                    request=response.request, response=response,
                )
            async for line in response.aiter_lines():
                yield line

    async def sse(self, url: str, payload: dict, headers: dict | None = None):
        """Server-sent events: JSON objects on ``data:`` lines."""
        async for line in self._stream_lines(url, payload, headers):
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            try:
                yield json.loads(data)
            except json.JSONDecodeError:
                logger.debug("Unparseable SSE frame: %.120s", data)

    async def ndjson(self, url: str, payload: dict):
        """Newline-delimited JSON: one complete object per line, no prefix."""
        async for line in self._stream_lines(url, payload):
            if not line.strip():
                continu
