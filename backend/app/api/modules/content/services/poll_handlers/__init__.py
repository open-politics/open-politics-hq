"""
Poll Handler Registry
=====================

Defines the PollHandler protocol and handler registry for Source polling.
Each Source kind (rss, search, directory_inbox, etc.) registers a handler
that knows how to poll that source type and return new assets.

The registry replaces the elif chain in SourceService.execute_poll().
New source kinds are added by defining a handler class and decorating it
with @register_poll_handler("kind_name").
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Protocol, Type, runtime_checkable

from app.models import Asset, Source
from app.api.modules.content.handlers.base import IngestionContext

logger = logging.getLogger(__name__)


@dataclass
class PollResult:
    """Result of a single source poll."""
    assets: List[Asset] = field(default_factory=list)
    cursor_update: Dict[str, Any] = field(default_factory=dict)
    summary: str = ""
    post_commit_actions: List[Any] = field(default_factory=list)
    """Callables to run after the DB commit succeeds (e.g. move files to _processed)."""


@runtime_checkable
class PollHandler(Protocol):
    """
    Protocol for source poll handlers.

    Each handler encapsulates the polling logic for one Source kind.
    It receives the Source and an IngestionContext, performs the poll,
    and returns a PollResult with any new assets and cursor state updates.
    """

    async def poll(
        self,
        source: Source,
        context: IngestionContext,
        runtime_options: Optional[Dict[str, Any]] = None,
    ) -> PollResult: ...


# --------------- Registry ---------------

_POLL_HANDLERS: Dict[str, Type[PollHandler]] = {}


def register_poll_handler(kind: str):
    """
    Decorator that registers a PollHandler class for a Source kind.

    Usage::

        @register_poll_handler("rss")
        class RSSPollHandler:
            async def poll(self, source, context, runtime_options=None) -> PollResult:
                ...
    """
    def decorator(cls: Type[PollHandler]):
        if kind in _POLL_HANDLERS:
            logger.warning("Overwriting poll handler for kind=%s", kind)
        _POLL_HANDLERS[kind] = cls
        logger.debug("Registered poll handler: %s -> %s", kind, cls.__name__)
        return cls
    return decorator


def get_poll_handler(kind: str) -> Optional[Type[PollHandler]]:
    """Look up a registered handler class by source kind."""
    return _POLL_HANDLERS.get(kind)


def registered_poll_kinds() -> List[str]:
    """Return all registered source kinds."""
    return list(_POLL_HANDLERS.keys())
