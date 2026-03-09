"""
Reactive dispatch infrastructure.

Provides:
- ReactiveWatcher protocol: watchers define SQL-pushdown queries for "work to do"
- Watcher registry: register_watcher(), get_watchers()
- Beat dispatcher task: dispatch_reactive_work iterates watchers, runs queries,
  and dispatches tasks by name string (no cross-domain imports).
"""

from __future__ import annotations

import logging
from typing import Any, Optional, Protocol, runtime_checkable

from sqlmodel import Session

logger = logging.getLogger(__name__)

MAX_DISPATCH_PER_CYCLE = 2000  # raised: 500 was too low for 400GB datasets
MAX_PER_WATCHER_PER_CYCLE = 500  # no single watcher takes more than this

# Type for queries that yield (id,) tuples when executed
# SQLModel/SQLAlchemy Select objects work with session.exec()
QueryLike = Any


def _get_enabled_watchers() -> set[str]:
    """Parse ENABLED_WATCHERS config into a set. Used by watcher modules at import time."""
    from app.core.config import settings

    raw = getattr(settings, "ENABLED_WATCHERS", "") or ""
    return {e.strip() for e in raw.split(",") if e.strip()}


_CAPABILITY_NAME_TO_PROTOCOL: dict[str, type] = {}


def _get_protocol_for_capability(name: str) -> type | None:
    """Lazy-load protocol mapping to avoid import-time circular deps."""
    if not _CAPABILITY_NAME_TO_PROTOCOL:
        from app.api.modules.foundation_service_providers.base import (
            GeocodingProvider, OcrProvider, StorageProvider, EmbeddingProvider,
            LanguageModelProvider, WebSearchProvider, ScrapingProvider,
        )
        _CAPABILITY_NAME_TO_PROTOCOL.update({
            "geocoding": GeocodingProvider,
            "ocr": OcrProvider,
            "storage": StorageProvider,
            "embedding": EmbeddingProvider,
            "language": LanguageModelProvider,
            "web_search": WebSearchProvider,
            "scraping": ScrapingProvider,
        })
    return _CAPABILITY_NAME_TO_PROTOCOL.get(name)


def _is_capability_configured(capability_name: str) -> bool:
    """
    Check if any provider for this capability is accessible in this deployment.
    Used as a circuit breaker to skip watchers whose capability is unavailable.
    """
    protocol = _get_protocol_for_capability(capability_name)
    if not protocol:
        return True  # unknown capability, assume configured

    from app.core.config import settings
    from app.api.modules.foundation_service_providers.registry import is_capability_available
    return is_capability_available(protocol, settings)


@runtime_checkable
class ReactiveWatcher(Protocol):
    """
    Protocol for reactive work watchers.

    Watchers define "what entities need work" via a SQL-pushdown query.
    They never import from the domain that executes the work; they dispatch
    by Celery task name string.
    """

    name: str
    """Human-readable watcher name for logging."""

    task_name: str
    """Celery task name as string, e.g. 'app.api.modules.search.tasks.embed.embed_task'."""

    batch_size: int
    """Max IDs to pass per task invocation."""

    depends_on: Optional[str] = None
    """Name of another watcher that must run first. Enables two-pass dispatch."""

    def build_query(self, session: Session) -> QueryLike:
        """
        Build a query that selects (id,) for entities that need work.

        The query is executed by the dispatcher. Must yield rows of (entity_id,).
        """
        ...


_WATCHERS: list[ReactiveWatcher] = []


def register_watcher(watcher: ReactiveWatcher) -> None:
    """Register a reactive watcher. Call at module import time."""
    _WATCHERS.append(watcher)
    logger.debug("Registered watcher: %s -> %s", watcher.name, watcher.task_name)


def get_watchers() -> list[ReactiveWatcher]:
    """Return all registered watchers."""
    return list(_WATCHERS)


def _dispatch_reactive_work_impl() -> dict[str, Any]:
    """
    Implementation of dispatch_reactive_work.
    Separate so the Celery task can be defined after imports resolve.
    Two-pass dispatch: independent watchers first, then dependent watchers.
    Per-watcher budget prevents one watcher from starving others.
    """
    from app.core.db import engine
    from app.core.celery_app import celery_app

    total_dispatched = 0
    watcher_results: dict[str, int] = {}
    watchers = get_watchers()
    global_budget = MAX_DISPATCH_PER_CYCLE

    # Two-pass: independent (no depends_on) first, then dependent
    independent = [w for w in watchers if not getattr(w, "depends_on", None)]
    dependent = [w for w in watchers if getattr(w, "depends_on", None)]

    # One connection per watcher: avoids InFailedSqlTransaction cascade when one
    # watcher fails (connection is invalidated and discarded; next watcher gets fresh).
    for watcher in independent + dependent:
        if global_budget <= 0:
            logger.warning(
                "Global dispatch budget exhausted (%d); deferring remaining work",
                MAX_DISPATCH_PER_CYCLE,
            )
            watcher_results[watcher.name] = -2  # budget sentinel
            continue

        watcher_budget = min(MAX_PER_WATCHER_PER_CYCLE, global_budget)

        capability = getattr(watcher, "capability", None) or (
            getattr(getattr(watcher, "enricher", None), "capability", None)
        )
        if capability and not _is_capability_configured(capability):
            logger.debug(
                "Skipping watcher %s: capability %s not available",
                watcher.name,
                capability,
            )
            watcher_results[watcher.name] = 0
            continue

        try:
            with engine.connect() as conn:
                with Session(bind=conn) as session:
                    try:
                        query = watcher.build_query(session)
                        rows = session.exec(query).all()
                        ids = [
                            row[0] if hasattr(row, "__getitem__") and not isinstance(row, (int, str))
                            else row
                            for row in (rows or [])
                        ]
                    except Exception:
                        conn.invalidate()
                        raise

            if not ids:
                watcher_results[watcher.name] = 0
                continue

            ids = ids[:watcher_budget]

            # Batch IDs
            batched = [
                ids[i : i + watcher.batch_size]
                for i in range(0, len(ids), watcher.batch_size)
            ]
            for batch in batched:
                celery_app.send_task(
                    watcher.task_name,
                    args=[batch],
                    kwargs={},
                )
                total_dispatched += len(batch)

            global_budget -= len(ids)
            watcher_results[watcher.name] = len(ids)
            logger.info(
                "Dispatched %s: %d IDs to %s",
                watcher.name,
                len(ids),
                watcher.task_name,
            )
        except Exception as e:
            logger.error(
                "Watcher %s failed: %s",
                watcher.name,
                e,
                exc_info=True,
            )
            watcher_results[watcher.name] = -1  # error sentinel

    return {
        "total_dispatched": total_dispatched,
        "watchers": watcher_results,
    }


def _create_dispatch_task():
    from app.core.celery_app import celery_app

    @celery_app.task(name="dispatch_reactive_work")
    def dispatch_reactive_work() -> dict[str, Any]:
        """
        Beat task: iterate registered watchers, run queries, dispatch work.

        Replaces ad-hoc Beat tasks for source polling, flow on-arrival,
        and enrichment. Watchers are registered by content domain at import time.
        """
        return _dispatch_reactive_work_impl()

    return dispatch_reactive_work


# Task instance for Beat schedule (wired in cleanup-and-wire step)
dispatch_reactive_work = _create_dispatch_task()
