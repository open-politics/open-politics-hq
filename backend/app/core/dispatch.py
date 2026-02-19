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
from typing import Any, Protocol, runtime_checkable

from sqlmodel import Session

logger = logging.getLogger(__name__)

# Type for queries that yield (id,) tuples when executed
# SQLModel/SQLAlchemy Select objects work with session.exec()
QueryLike = Any


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
    """
    from app.core.db import engine
    from app.core.celery_app import celery_app

    total_dispatched = 0
    watcher_results: dict[str, int] = {}

    with Session(engine) as session:
        for watcher in get_watchers():
            try:
                query = watcher.build_query(session)
                rows = session.exec(query).all()
                ids = [row[0] for row in rows] if rows else []

                if not ids:
                    watcher_results[watcher.name] = 0
                    continue

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
