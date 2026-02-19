"""
Handler Resolution (Single-Dispatch)
====================================

Resolves the appropriate handler and invocation args for a given locator.
Replaces manual if/elif chains in ContentIngestionService.
"""

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple, Union

from fastapi import UploadFile

from .base import IngestionContext
from .file_handler import FileHandler
from .web_handler import WebHandler
from .text_handler import TextHandler
from .archive_handler import ArchiveHandler
from .rss_handler import RSSHandler

from app.api.content.processors import is_archive_url, is_rss_feed_url


@dataclass
class ResolvedHandler:
    """Result of resolve_handler: handler class and invocation kwargs."""

    handler_cls: type
    method: str  # 'handle' or 'handle_bulk'
    kwargs: Dict[str, Any]


def resolve_handler(
    locator: Union[str, List[str], UploadFile],
    context: IngestionContext,
    title: Optional[str] = None,
    options: Optional[Dict[str, Any]] = None,
) -> ResolvedHandler:
    """
    Single-dispatch: resolve the appropriate handler and invocation for a locator.

    Args:
        locator: File, URL(s), or text content
        context: IngestionContext with session, providers, user_id, infospace_id
        title: Optional custom title
        options: Processing options

    Returns:
        ResolvedHandler with handler_cls, method name, and kwargs for the call
    """
    opts = options or {}

    if isinstance(locator, UploadFile):
        return ResolvedHandler(
            handler_cls=FileHandler,
            method="handle",
            kwargs={"file": locator, "title": title, "options": opts},
        )

    if isinstance(locator, list):
        return ResolvedHandler(
            handler_cls=WebHandler,
            method="handle_bulk",
            kwargs={
                "urls": locator,
                "base_title": title or "Bulk URL Collection",
                "options": opts,
            },
        )

    if isinstance(locator, str):
        if locator.startswith(("http://", "https://")):
            if is_archive_url(locator):
                return ResolvedHandler(
                    handler_cls=ArchiveHandler,
                    method="handle",
                    kwargs={
                        "archive_url": locator,
                        "infospace_id": context.infospace_id,
                        "user_id": context.user_id,
                        "title": title,
                        "options": opts,
                        "user_agent": opts.get("user_agent"),
                    },
                )
            if is_rss_feed_url(locator):
                return ResolvedHandler(
                    handler_cls=RSSHandler,
                    method="handle",
                    kwargs={"locator": locator, "title": title, "options": opts},
                )
            return ResolvedHandler(
                handler_cls=WebHandler,
                method="handle",
                kwargs={"locator": locator, "title": title, "options": opts},
            )
        # Plain text
        text_opts = dict(opts)
        if opts.get("event_timestamp"):
            text_opts["event_timestamp"] = opts["event_timestamp"]
        return ResolvedHandler(
            handler_cls=TextHandler,
            method="handle",
            kwargs={"locator": locator, "title": title, "options": text_opts},
        )

    raise ValueError(f"Unsupported locator type: {type(locator)}")
