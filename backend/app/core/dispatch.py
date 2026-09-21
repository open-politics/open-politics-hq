"""
Dispatch infrastructure.

Three dispatch mechanisms:
- Schedule: beat task polls registered @tasks per their declared schedule
- Kick: on-demand full dispatch for an infospace (after import, admin, deploy)
- Events: handled by core/events.py, not in this file

The dispatcher iterates @task registry × infospaces. Per-task schedule controls
poll frequency. kick_tasks bypasses schedule for immediate dispatch.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from sqlmodel import Session

logger = logging.getLogger(__name__)

MAX_DISPATCH_PER_CYCLE = 2000
MAX_PER_TASK_PER_CYCLE = 500


def _get_enabled_enrichers() -> set[str]:
    """Enricher names switched on in HQ.yml."""
    from app.core.config import settings
    return {name for name, on in (settings.ENRICHERS or {}).items() if on}


def _get_redis():
    try:
        from app.core.redis import get_redis
        return get_redis()
    except Exception:
        return None


def _is_capability_configured(capability_name: str) -> bool:
    """Check if any provider for this capability is accessible in this deployment."""
    from app.api.modules.foundation_service_providers import CAPABILITIES, is_capability_available
    from app.core.config import settings
    if capability_name not in CAPABILITIES:
        return True  # unknown capability = don't block
    return is_capability_available(capability_name, settings)


def _is_due(descriptor) -> bool:
    """Check if enough time has passed since last dispatch for this task."""
    if descriptor.schedule is None:
        return False
    r = _get_redis()
    if not r:
        return True  # no Redis = dispatch (safe default)
    last = r.get(f"task:{descriptor.name}:last_dispatched")
    if not last:
        return True
    try:
        return (time.time() - float(last)) >= descriptor.schedule
    except (ValueError, TypeError):
        return True


def _chunk(lst, n):
    for i in range(0, len(lst), n):
        yield lst[i : i + n]


def _dispatch_task_for_infospace(desc, infospace_id: int, budget: int = MAX_PER_TASK_PER_CYCLE) -> int:
    """Core dispatch logic for one task × one infospace. Used by both beat and kick."""
    from app.core.db import engine
    from app.core.celery_app import celery_app
    from app.core.tasks import filter_failed_items, is_structurally_blocked

    if desc.capability and not _is_capability_configured(desc.capability):
        return 0

    # Structural block — set by previous ProviderError, cleared on config save.
    if is_structurally_blocked(desc.name, infospace_id):
        return 0

    if desc.dispatch_filter:
        try:
            # dispatch_filter receives infospace object, but we have only the id.
            from app.api.modules.identity_infospace_user.models import Infospace
            with Session(engine) as session:
                infospace = session.get(Infospace, infospace_id)
                if not infospace:
                    return 0
                session.expunge(infospace)
            if not desc.dispatch_filter(infospace):
                return 0
        except Exception as e:
            logger.warning("Dispatch filter failed for %s: %s", desc.name, e)
            return 0

    r = _get_redis()
    if r:
        try:
            if r.get(f"task:{desc.name}:{infospace_id}:backoff"):
                return 0
        except Exception:
            pass

    available_slots = desc.max_concurrency
    if r:
        try:
            from app.core.tasks import count_occupied_slots
            occupied = count_occupied_slots(r, desc.name, infospace_id, desc.max_concurrency)
            available_slots = desc.max_concurrency - occupied
            if available_slots <= 0:
                return 0
        except Exception:
            pass  # degrade to max_concurrency if count fails

    try:
        with engine.connect() as conn:
            with Session(bind=conn) as session:
                try:
                    query = desc.check(infospace_id).limit(min(budget, MAX_PER_TASK_PER_CYCLE))
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
            return 0

        ids = filter_failed_items(desc.name, ids, desc.max_item_failures)
        if not ids:
            return 0

        dispatched = 0
        total_items = 0
        for batch in _chunk(ids, desc.batch):
            if dispatched >= available_slots:
                break
            if total_items >= budget:
                break
            celery_app.send_task(
                desc.celery_task_name,
                args=[batch, infospace_id],
                queue=desc.queue,
            )
            dispatched += 1
            total_items += len(batch)

        return total_items

    except Exception as e:
        logger.error("Dispatch failed for %s infospace %d: %s",
                     desc.name, infospace_id, e, exc_info=True)
        return 0


def _dispatch_tasks_impl() -> dict[str, Any]:
    """Beat task: iterate scheduled @tasks × infospaces, dispatch work."""
    from app.core.db import engine
    from app.core.tasks import get_task_registry, topological_sort

    task_registry = get_task_registry()
    if not task_registry:
        return {"total_dispatched": 0, "tasks": {}}

    from app.api.modules.identity_infospace_user.models import Infospace
    from sqlmodel import select as _select
    with Session(engine) as session:
        infospaces = session.exec(_select(Infospace)).all()
        for isp in infospaces:
            session.expunge(isp)

    total_dispatched = 0
    task_results: dict[str, int] = {}
    budget = MAX_DISPATCH_PER_CYCLE

    sorted_tasks = topological_sort(list(task_registry.values()))

    for descriptor in sorted_tasks:
        if budget <= 0:
            break

        # Only dispatch tasks with a schedule (event/kick-only tasks skip)
        if not _is_due(descriptor):
            continue

        task_dispatched = 0

        for infospace in infospaces:
            if budget <= 0:
                break
            count = _dispatch_task_for_infospace(descriptor, infospace.id, budget)
            task_dispatched += count
            budget -= count

        if descriptor.schedule is not None:
            r = _get_redis()
            if r:
                try:
                    r.set(f"task:{descriptor.name}:last_dispatched", str(time.time()))
                except Exception:
                    pass

        task_results[descriptor.name] = task_dispatched
        total_dispatched += task_dispatched
        if task_dispatched:
            logger.info("Dispatched %s: %d items", descriptor.name, task_dispatched)

    return {"total_dispatched": total_dispatched, "tasks": task_results}


def kick_tasks(infospace_id: int, tags: frozenset[str] | None = None):
    """On-demand dispatch. Runs full check→fan-out logic, bypasses schedule."""
    from app.core.tasks import get_task_registry

    for name, desc in get_task_registry().items():
        if tags and not (desc.tags & tags):
            continue
        count = _dispatch_task_for_infospace(desc, infospace_id)
        if count:
            logger.info("kick_tasks: dispatched %s for infospace %d: %d items", name, infospace_id, count)


def _create_dispatch_task():
    from app.core.celery_app import celery_app

    @celery_app.task(name="dispatch_tasks")
    def dispatch_tasks() -> dict[str, Any]:
        return _dispatch_tasks_impl()

    return dispatch_tasks


dispatch_tasks = _create_dispatch_task()
