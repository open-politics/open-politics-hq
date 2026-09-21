"""
base.py — the transport every dialect adapter shares.

  Adapter(descriptor, quirks, api_key, base_url, **extra)
       ├──► .descriptor / .quirks / .api_key / .base_url / .extra
       └──► .client   lazy httpx.AsyncClient — one per instance
                 timeout   self.timeout, 900s default, per-subclass override
                 headers   self.headers(), {} unless a wire overrides it

  .url(path) ──► f"{base_url}/{path.lstrip('/')}"

  ONE PRIMITIVE, TWO FRAMINGS
    ._stream_lines(url, payload)   raises on HTTP >=400 before the first yield
              ├──► .sse(...)     ``data:`` lines, JSON, skips "[DONE]"
              └──► .ndjson(...)  one JSON object per line, no prefix

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

DEFAULT_TIMEOUT_SECONDS = 900.0


class Adapter:
    """Base for every dialect adapter: the resolved declaration plus transport.

    ``**extra`` swallows values from an ``extra=`` lambda that the subclass
    does not name in its own ``__init__``.
    """

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

    @property
    def provider_key(self) -> Optional[str]:
        """Which declaration this adapter came from. Features name it in logs."""
        return self.descriptor.provider_key if self.descriptor else None

    # ── transport ────────────────────────────────────────────────────────────

    @property
    def client(self) -> httpx.AsyncClient:
        """Lazily-created async client, one per adapter instance."""
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

    async def _stream_lines(self, url: str, payload: dict, headers: dict | None = None):
        """POST and iterate response lines, raising on a non-2xx before any yield."""
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
                continue
            try:
                yield json.loads(line)
            except json.JSONDecodeError:
                logger.debug("Unparseable NDJSON frame: %.120s", line)
