"""
Handler Registry
================

Declarative registry for ingestion handlers. Replaces resolve.py if/elif chain.
Each handler registers with can_handle(locator, context) predicate and priority.
"""

from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Union

from fastapi import UploadFile

from .base import IngestionContext


@dataclass
class ResolvedHandler:
    """Result of resolve_handler: handler class and invocation kwargs."""
    handler_cls: type
    method: str
    kwargs: Dict[str, Any]
from .file_handler import FileHandler
from .web_handler import WebHandler
from .text_handler import TextHandler
from .archive_handler import ArchiveHandler
from .rss_handler import RSSHandler
from app.api.modules.content.processors import is_archive_url, is_rss_feed_url


@dataclass
class HandlerRegistration:
    """Registration entry for a handler."""
    handler_cls: type
    can_handle: Callable[[Any, IngestionContext], bool]
    build_kwargs: Callable[[Any, IngestionContext, Optional[str], Dict], Dict[str, Any]]
    method: str = "handle"
    priority: int = 0  # Higher = checked first


_registry: List[HandlerRegistration] = []


def register_handler(reg: HandlerRegistration) -> None:
    _registry.append(reg)
    _registry.sort(key=lambda r: -r.priority)


def resolve_handler(
    locator: Union[str, List[str], UploadFile],
    context: IngestionContext,
    title: Optional[str] = None,
    options: Optional[Dict[str, Any]] = None,
):
    """Resolve handler via registry lookup. Returns ResolvedHandler."""
    opts = options or {}
    for reg in _registry:
        if reg.can_handle(locator, context):
            kwargs = reg.build_kwargs(locator, context, title, opts)
            return ResolvedHandler(handler_cls=reg.handler_cls, method=reg.method, kwargs=kwargs)
    raise ValueError(f"Unsupported locator type: {type(locator)}")


def _file_kwargs(loc, ctx, title, opts):
    return {"file": loc, "title": title, "options": opts}


def _bulk_web_kwargs(loc, ctx, title, opts):
    return {"urls": loc, "base_title": title or "Bulk URL Collection", "options": opts}


def _archive_kwargs(loc, ctx, title, opts):
    return {
        "archive_url": loc,
        "infospace_id": ctx.infospace_id,
        "user_id": ctx.user_id,
        "title": title,
        "options": opts,
        "user_agent": opts.get("user_agent"),
    }


def _rss_kwargs(loc, ctx, title, opts):
    return {"locator": loc, "title": title, "options": opts}


def _web_kwargs(loc, ctx, title, opts):
    return {"locator": loc, "title": title, "options": opts}


def _text_kwargs(loc, ctx, title, opts):
    text_opts = dict(opts)
    if opts.get("event_timestamp"):
        text_opts["event_timestamp"] = opts["event_timestamp"]
    return {"locator": loc, "title": title, "options": text_opts}


# Register handlers (priority: specific before generic)
register_handler(HandlerRegistration(
    handler_cls=FileHandler,
    can_handle=lambda loc, _: isinstance(loc, UploadFile),
    method="handle",
    priority=100,
    build_kwargs=_file_kwargs,
))
register_handler(HandlerRegistration(
    handler_cls=WebHandler,
    can_handle=lambda loc, _: isinstance(loc, list),
    method="handle_bulk",
    priority=90,
    build_kwargs=_bulk_web_kwargs,
))
register_handler(HandlerRegistration(
    handler_cls=ArchiveHandler,
    can_handle=lambda loc, _: isinstance(loc, str) and loc.startswith(("http://", "https://")) and is_archive_url(loc),
    method="handle",
    priority=30,
    build_kwargs=_archive_kwargs,
))
register_handler(HandlerRegistration(
    handler_cls=RSSHandler,
    can_handle=lambda loc, _: isinstance(loc, str) and is_rss_feed_url(loc),
    method="handle",
    priority=20,
    build_kwargs=_rss_kwargs,
))
register_handler(HandlerRegistration(
    handler_cls=WebHandler,
    can_handle=lambda loc, _: isinstance(loc, str) and loc.startswith(("http://", "https://")),
    method="handle",
    priority=10,
    build_kwargs=_web_kwargs,
))
register_handler(HandlerRegistration(
    handler_cls=TextHandler,
    can_handle=lambda loc, _: isinstance(loc, str),
    method="handle",
    priority=0,
    build_kwargs=_text_kwargs,
))
