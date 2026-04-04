"""
Universal reactive task infrastructure.

Two primitives:
- @task: decorator that turns a function into a managed reactive Celery task
- TaskDescriptor: runtime metadata for registered tasks (used by dispatcher)
- TaskContext: injected into every @task function

The @enricher specialization lives in content/enrichers.py.

Error handling convention for @task functions:
- Domain errors (bad PDF, parse failure): catch in function body, mark item failed
  via ctx.item_failed(), do NOT re-raise. The wrapper sees success, self-chain continues.
- Infrastructure errors (DB down, provider unavailable): let bubble to wrapper.
  Wrapper sets 5-minute backoff, optionally retries. Chain stops, kick/schedule recovers.
"""

from __future__ import annotations

import logging
import time
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any, Callable, Generator, Optional, Type

from sqlmodel import Session

logger = logging.getLogger(__name__)

MAX_CHAIN_DEPTH = 50


# ── Task registry ─────────────────────────────────────────────────────────────

@dataclass
class TaskDescriptor:
    """Runtime metadata for a registered task."""
    name: str
    check: Callable[[int], Any]  # infospace_id -> Select
    celery_task_name: str
    batch: int = 50
    queue: str = "default"
    timeout: int = 120
    retries: int = 0
    retry_delay: int = 60
    max_item_failures: int = 5
    failure_memory: int = 3600
    max_concurrency: int = 4
    depends_on: Optional[str] = None
    self_chain: bool = False
    triggers: list[str] = field(default_factory=list)
    tags: frozenset[str] = field(default_factory=frozenset)
    context_cls: Type[TaskContext] = None  # set after TaskContext is defined
    dispatch_filter: Optional[Callable] = None
    capability: Optional[str] = None
    schedule: Optional[int] = None  # seconds between dispatcher polls, None = never polled


_task_registry: dict[str, TaskDescriptor] = {}


def get_task_registry() -> dict[str, TaskDescriptor]:
    """Return all registered task descriptors."""
    return _task_registry


# ── TaskContext ────────────────────────────────────────────────────────────────

_provider_cache: dict[str, Any] = {}
_cache_config_hash: Optional[str] = None


def _settings_hash() -> str:
    from app.core.config import settings
    keys = [
        settings.STORAGE_PROVIDER_TYPE,
        getattr(settings, "OCR_PROVIDER_TYPE", ""),
        getattr(settings, "SCRAPING_PROVIDER_TYPE", ""),
        getattr(settings, "GEOCODING_PROVIDER_TYPE", ""),
    ]
    return "|".join(str(k) for k in keys)


def cached_resolve(protocol: Type, provider_key: str, settings: Any, credentials: dict | None = None) -> Any:
    """Resolve provider with per-worker cache, invalidated on config change."""
    global _cache_config_hash
    current = _settings_hash()
    if _cache_config_hash != current:
        _provider_cache.clear()
        _cache_config_hash = current
    cache_key = f"{protocol.__name__}:{provider_key}"
    if cache_key not in _provider_cache:
        from app.api.modules.foundation_service_providers.registry import resolve
        instance = resolve(protocol, provider_key, settings, credentials)
        if instance is None:
            return None
        _provider_cache[cache_key] = instance
    return _provider_cache[cache_key]


class TaskContext:
    """Injected into every @task function."""

    def __init__(
        self,
        infospace_id: int,
        settings: Any,
        task_name: str,
        failure_memory: int = 3600,
    ):
        self.infospace_id = infospace_id
        self.settings = settings
        self._task_name = task_name
        self._failure_memory = failure_memory
        self._stats: dict[str, int] = {}

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        """Fresh session per phase. Don't hold during external I/O."""
        from app.core.db import engine
        with Session(engine) as s:
            yield s

    def provider(self, protocol: Type, provider_key: str | None = None) -> Any:
        """Resolve provider. Cached per (protocol, provider_key) per worker."""
        from app.api.modules.foundation_service_providers.registry import (
            select_provider,
            system_default_provider_key,
        )
        key = provider_key or system_default_provider_key(protocol, self.settings)
        if not key:
            raise ValueError(f"No provider_key for {protocol.__name__}")
        return cached_resolve(protocol, key, self.settings)

    def stat(self, key: str, count: int = 1):
        """Increment batch stats (flushed to Redis after function returns)."""
        self._stats[key] = self._stats.get(key, 0) + count

    def item_failed(self, item_id: int):
        """Increment Redis failure counter for item."""
        try:
            from app.core.redis import get_redis
            r = get_redis()
            fkey = f"task:{self._task_name}:{item_id}:failures"
            r.incr(fkey)
            r.expire(fkey, self._failure_memory)
        except Exception as e:
            logger.warning("item_failed redis error: %s", e)

    def send(self, topic: str, resource_id: int | str, event: str, data: Any = None) -> bool:
        """Push a presence update to browsers watching this resource.

        Fire-and-forget. Never raises. Returns True on success.
        Same pattern as stat() and item_failed() — optional side-channel
        that doesn't affect task execution.
        """
        try:
            from app.core.stream import stream_key, StreamWriter
            key = stream_key(self.infospace_id, topic, resource_id)
            return StreamWriter(key).send(event, data)
        except Exception as e:
            logger.warning("ctx.send failed: %s", e)
            return False


# Set default context_cls on TaskDescriptor after TaskContext is defined
TaskDescriptor.context_cls = TaskContext  # type: ignore


# ── Redis helpers ──────────────────────────────────────────────────────────────

def _get_redis():
    """Lazy Redis connection."""
    try:
        from app.core.redis import get_redis
        return get_redis()
    except Exception:
        return None


# Lua script: try to acquire one of N slots atomically.
# Returns the slot index (>= 0) on success, -1 if all slots occupied.
_ACQUIRE_SLOT_LUA = """
local prefix = KEYS[1]
local max = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
for i = 0, max - 1 do
    local key = prefix .. ":" .. i
    if redis.call("SET", key, "1", "NX", "EX", ttl) then
        return i
    end
end
return -1
"""

# Lua script: count how many of N slots are currently occupied.
_COUNT_SLOTS_LUA = """
local prefix = KEYS[1]
local max = tonumber(ARGV[1])
local count = 0
for i = 0, max - 1 do
    if redis.call("EXISTS", prefix .. ":" .. i) == 1 then
        count = count + 1
    end
end
return count
"""


def _slot_prefix(task_name: str, infospace_id: int) -> str:
    return f"task:{task_name}:{infospace_id}:slot"


def acquire_slot(r, task_name: str, infospace_id: int, max_concurrency: int, timeout: int) -> int:
    """Try to acquire a concurrency slot. Returns slot index (>= 0) or -1 if full."""
    prefix = _slot_prefix(task_name, infospace_id)
    return r.eval(_ACQUIRE_SLOT_LUA, 1, prefix, max_concurrency, timeout)


def release_slot(r, task_name: str, infospace_id: int, slot: int):
    """Release a previously acquired concurrency slot."""
    r.delete(f"{_slot_prefix(task_name, infospace_id)}:{slot}")


def count_occupied_slots(r, task_name: str, infospace_id: int, max_concurrency: int) -> int:
    """Count how many concurrency slots are currently occupied."""
    prefix = _slot_prefix(task_name, infospace_id)
    return r.eval(_COUNT_SLOTS_LUA, 1, prefix, max_concurrency)


def filter_failed_items(task_name: str, ids: list[int], max_failures: int) -> list[int]:
    """Remove items that have exceeded max_item_failures."""
    r = _get_redis()
    if not r or max_failures <= 0:
        return ids
    pipe = r.pipeline(transaction=False)
    for item_id in ids:
        pipe.get(f"task:{task_name}:{item_id}:failures")
    results = pipe.execute()
    return [
        item_id for item_id, count in zip(ids, results)
        if not count or int(count) < max_failures
    ]


def _flush_stats(task_name: str, infospace_id: int, stats: dict, duration_ms: float):
    """Flush task stats to Redis."""
    r = _get_redis()
    if not r:
        return
    key = f"task:{task_name}:{infospace_id}:stats"
    pipe = r.pipeline(transaction=False)
    for stat_key, count in stats.items():
        pipe.hincrby(key, stat_key, count)
    pipe.hset(key, "last_run", time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()))
    pipe.hset(key, "last_duration_ms", int(duration_ms))
    pipe.expire(key, 3600)
    pipe.execute()


# ── @task decorator ────────────────────────────────────────────────────────────

def task(
    name: str,
    check: Callable[[int], Any],
    *,
    schedule: int | None = None,
    batch: int = 50,
    max_concurrency: int = 4,
    queue: str = "default",
    timeout: int = 120,
    retries: int = 0,
    retry_delay: int = 60,
    max_item_failures: int = 5,
    failure_memory: int = 3600,
    depends_on: str | None = None,
    self_chain: bool = False,
    triggers: list[str] | None = None,
    tags: frozenset[str] = frozenset(),
    # Internal extension API (for @enricher and other wrappers)
    context_cls: Type[TaskContext] = TaskContext,
    dispatch_filter: Callable | None = None,
    capability: str | None = None,
):
    """
    Decorator that turns a function into a managed reactive Celery task.

    The decorated function signature: fn(ctx: TaskContext, entity_ids: list[int])
    """
    triggers = triggers or []

    def decorator(fn: Callable) -> Callable:
        descriptor = TaskDescriptor(
            name=name,
            check=check,
            celery_task_name=name,
            batch=batch,
            queue=queue,
            timeout=timeout,
            retries=retries,
            retry_delay=retry_delay,
            max_item_failures=max_item_failures,
            failure_memory=failure_memory,
            max_concurrency=max_concurrency,
            depends_on=depends_on,
            self_chain=self_chain,
            triggers=triggers,
            tags=tags,
            context_cls=context_cls,
            dispatch_filter=dispatch_filter,
            capability=capability,
            schedule=schedule,
        )

        # Register in task registry
        _task_registry[name] = descriptor

        # Generate Celery task
        def _celery_impl(self_task, batch_ids: list[int] | None, infospace_id: int, _chain_depth: int = 0):
            """Generated Celery task wrapper."""
            from app.core.config import settings

            start = time.perf_counter()

            # Check dispatch_filter before doing any work (respects ENABLED_ENRICHERS etc.)
            # Event-triggered tasks bypass the dispatcher, so this is the only gate.
            if dispatch_filter is not None:
                try:
                    from app.core.db import engine
                    from app.api.modules.identity_infospace_user.models import Infospace
                    with Session(engine) as session:
                        infospace = session.get(Infospace, infospace_id)
                        if not infospace:
                            return
                        session.expunge(infospace)
                    if not dispatch_filter(infospace):
                        return
                except Exception as e:
                    logger.warning("Dispatch filter check failed for %s: %s", name, e)
                    return

            # Self-query mode (event-triggered, batch_ids=None)
            if batch_ids is None:
                try:
                    from app.core.db import engine
                    with Session(engine) as session:
                        query = check(infospace_id).limit(batch)
                        rows = session.exec(query).all()
                        batch_ids = [
                            row[0] if hasattr(row, "__getitem__") and not isinstance(row, (int, str))
                            else row
                            for row in (rows or [])
                        ]
                except Exception as e:
                    logger.error("Self-query failed for %s: %s", name, e)
                    return
                if not batch_ids:
                    return

            # Filter failed items
            batch_ids = filter_failed_items(name, batch_ids, max_item_failures)
            if not batch_ids:
                return

            # Acquire concurrency slot
            r = _get_redis()
            slot = -1
            if r:
                slot = acquire_slot(r, name, infospace_id, max_concurrency, timeout)
                if slot < 0:
                    # No slot available — direct invocations re-queue, others bail
                    if batch_ids is not None and _chain_depth == 0:
                        self_task.apply_async(
                            args=[batch_ids, infospace_id],
                            countdown=30,
                        )
                    return

            try:
                # Build context
                ctx = context_cls(
                    infospace_id=infospace_id,
                    settings=settings,
                    task_name=name,
                    failure_memory=failure_memory,
                )

                # Call decorated function
                fn(ctx, batch_ids)

                # Flush stats
                duration_ms = (time.perf_counter() - start) * 1000
                _flush_stats(name, infospace_id, ctx._stats, duration_ms)

            except Exception as e:
                logger.error("Task %s failed: %s", name, e, exc_info=True)
                if r:
                    r.set(f"task:{name}:{infospace_id}:backoff", "1", ex=300)
                if retries > 0:
                    raise self_task.retry(countdown=retry_delay, exc=e)
                return
            finally:
                # Release slot before self-chain to avoid deadlock
                if r and slot >= 0:
                    release_slot(r, name, infospace_id, slot)

            # Self-chain (runs after slot is released)
            if self_chain:
                _depth = _chain_depth or 0
                try:
                    from app.core.db import engine
                    with Session(engine) as session:
                        more = session.exec(check(infospace_id).limit(1)).first()
                    if more:
                        kwargs = {"_chain_depth": _depth + 1}
                        if _depth >= MAX_CHAIN_DEPTH:
                            kwargs["_chain_depth"] = 0
                            self_task.apply_async(
                                args=[None, infospace_id],
                                kwargs=kwargs,
                                countdown=10,
                            )
                        else:
                            self_task.apply_async(
                                args=[None, infospace_id],
                                kwargs=kwargs,
                            )
                except Exception as e:
                    logger.warning("Self-chain check failed for %s, retrying in 30s: %s", name, e)
                    self_task.apply_async(args=[None, infospace_id], countdown=30)

        # Register with Celery
        from app.core.celery_app import celery_app
        celery_task = celery_app.task(
            bind=True,
            name=name,
            queue=queue,
            soft_time_limit=timeout,
            max_retries=retries,
        )(_celery_impl)

        # Register event triggers
        if triggers:
            from app.core.events import subscribe

            # Build config-level gate for tasks with dispatch_filter (enrichers).
            # This prevents the task from being sent at all when globally disabled,
            # eliminating log noise and wasted worker slots.
            event_gate = None
            if dispatch_filter is not None:
                def _make_gate(task_name, cap):
                    def _gate() -> bool:
                        # Check ENABLED_ENRICHERS (global config)
                        try:
                            from app.core.dispatch import _get_enabled_enrichers
                            enabled = _get_enabled_enrichers()
                            if enabled is not None and task_name not in enabled:
                                return False
                        except Exception:
                            pass
                        # Check capability availability
                        if cap:
                            try:
                                from app.core.dispatch import _is_capability_configured
                                if not _is_capability_configured(cap):
                                    return False
                            except Exception:
                                pass
                        return True
                    return _gate
                event_gate = _make_gate(name, capability)

            for event_name in triggers:
                subscribe(event_name, name, args_key="infospace_id", null_prefix=True, gate=event_gate)

        # Attach references
        fn._task_descriptor = descriptor
        fn._celery_task = celery_task
        fn.delay = celery_task.delay
        fn.apply_async = celery_task.apply_async

        return fn

    return decorator


# ── Topological sort for dispatch ordering ─────────────────────────────────────

def topological_sort(descriptors: list[TaskDescriptor]) -> list[TaskDescriptor]:
    """Sort tasks by depends_on. Tasks with no dependencies come first."""
    by_name = {d.name: d for d in descriptors}
    visited: set[str] = set()
    result: list[TaskDescriptor] = []

    def visit(d: TaskDescriptor):
        if d.name in visited:
            return
        visited.add(d.name)
        if d.depends_on and d.depends_on in by_name:
            visit(by_name[d.depends_on])
        result.append(d)

    for d in descriptors:
        visit(d)

    return result

