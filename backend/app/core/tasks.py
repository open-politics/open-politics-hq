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

from pydantic import BaseModel
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
    # Direct-invocation-only typed params. When set, triggers/schedule are
    # forbidden (user-initiated action pattern — v2 §9). The celery wrapper
    # signature becomes (batch_ids, infospace_id, params_dict) and the wrapper
    # deserializes params_dict via params_model(**params_dict) before calling
    # the user function.
    params_model: Optional[Type[BaseModel]] = None


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


def cached_resolve(
    capability: str,
    provider_key: str | None = None,
    model: str | None = None,
    *,
    infospace_id: int | None = None,
    context: str | None = None,
    runtime_key: str | None = None,
):
    """Resolve provider with per-worker cache, invalidated on config change.

    Cache key includes infospace_id so different infospaces (with different
    owners and different credentials) never share a cached instance.

    Runtime-key calls bypass the cache entirely — BYOK must not leak across
    invocations.
    """
    global _cache_config_hash
    current = _settings_hash()
    if _cache_config_hash != current:
        _provider_cache.clear()
        _cache_config_hash = current

    # Runtime key → bypass cache (BYOK isolation).
    if runtime_key:
        from app.api.modules.foundation_service_providers.registry import resolve
        return resolve(
            capability, provider_key, model,
            infospace_id=infospace_id, context=context, runtime_key=runtime_key,
        )

    cache_key = f"{capability}:{provider_key or '_'}:{model or '_'}:{infospace_id or 'system'}:{context or '_'}"
    if cache_key not in _provider_cache:
        from app.api.modules.foundation_service_providers.registry import resolve
        _provider_cache[cache_key] = resolve(
            capability, provider_key, model,
            infospace_id=infospace_id, context=context,
        )
    return _provider_cache[cache_key]


class TaskContext:
    """Injected into every @task function."""

    def __init__(
        self,
        infospace_id: int,
        settings: Any,
        task_name: str,
        failure_memory: int = 3600,
        task_id: str | None = None,
    ):
        self.infospace_id = infospace_id
        self.settings = settings
        self._task_name = task_name
        self._failure_memory = failure_memory
        self._stats: dict[str, int] = {}
        # Celery task id for this run. Forwarded from self_task.request.id in
        # the wrapper. Used for deterministic stream-key composition in
        # user-initiated action tasks: f"{resource_id}:{ctx.task_id}".
        self.task_id: str | None = task_id

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        """Fresh session per phase. Don't hold during external I/O."""
        from app.core.db import engine
        with Session(engine) as s:
            yield s

    def provider(
        self,
        capability,
        provider_key: str | None = None,
        model: str | None = None,
        *,
        context: str | None = None,
        runtime_key: str | None = None,
    ):
        """Resolve provider for this task's infospace. Cached per-worker.

        `capability` accepts either a capability name (``"storage"``) or a
        Protocol class (``StorageProvider``). Selection follows the normal
        chain: explicit args → infospace enrichment_config → owner defaults →
        system default env var.
        """
        if not isinstance(capability, str):
            from app.api.modules.foundation_service_providers.registry import CAPABILITIES
            for name, proto in CAPABILITIES.items():
                if proto is capability:
                    capability = name
                    break
            else:
                raise ValueError(f"Unknown provider Protocol: {capability!r}")
        return cached_resolve(
            capability, provider_key, model,
            infospace_id=self.infospace_id,
            context=context,
            runtime_key=runtime_key,
        )

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

    def job_progress(
        self,
        job_id: int,
        *,
        status: str = "progress",
        stage: str | None = None,
        message: str | None = None,
        progress_pct: float | None = None,
        processed: int | None = None,
        failed: int | None = None,
        total: int | None = None,
        **extra: Any,
    ) -> None:
        """Update an IngestionJob row and emit the matching stream event.

        One call replaces the cursor_state write + ctx.send pair every
        ingestion task used to do by hand. Fire-and-forget (never raises).

        ``status`` is both the IngestionJob status transition signal and the
        stream event name. Values: ``"progress"`` (no DB status change),
        ``"completed"`` (sets IngestionStatus.COMPLETED, completed_at),
        ``"failed"`` (sets IngestionStatus.FAILED, error_message, last_error_at),
        ``"item_started" | "item_done" | "item_failed"`` (per-item events in a
        batch job — don't change the job's top-level DB status).
        """
        from datetime import datetime, timezone

        from app.models import IngestionJob, IngestionStatus

        payload: dict[str, Any] = {k: v for k, v in {
            "stage": stage,
            "message": message,
            "progress_pct": progress_pct,
            "processed": processed,
            "failed": failed,
            "total": total,
        }.items() if v is not None}
        payload.update(extra)

        try:
            with self.session() as session:
                job = session.get(IngestionJob, job_id)
                if job is None:
                    return
                cs = dict(job.cursor_state or {})
                if stage is not None: cs["stage"] = stage
                if message is not None: cs["message"] = message[:500]
                if progress_pct is not None: cs["progress_pct"] = progress_pct
                for k, v in extra.items():
                    cs[k] = v
                job.cursor_state = cs
                if processed is not None:
                    job.processed_files = processed
                if failed is not None:
                    job.failed_files = failed
                if total is not None:
                    job.total_files = total
                if status == "completed":
                    job.status = IngestionStatus.COMPLETED
                    job.completed_at = datetime.now(timezone.utc)
                    cs.setdefault("progress_pct", 100)
                    job.cursor_state = cs
                elif status == "failed":
                    job.status = IngestionStatus.FAILED
                    job.last_error_at = datetime.now(timezone.utc)
                    job.retry_count = (job.retry_count or 0) + 1
                    if message:
                        job.error_message = message[:500]
                job.updated_at = datetime.now(timezone.utc)
                session.add(job)
                session.commit()
        except Exception as e:
            logger.warning("ctx.job_progress DB write failed for job %s: %s", job_id, e)

        self.send("ingestion_job", job_id, status, payload)


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


# ── Structural block (provider misconfig) ────────────────────────────────────
#
# Transient failures (API timeouts, DB hiccups) use the short `:backoff` key.
# Structural failures (missing credentials, no provider configured, model_required
# violation) set a `:block` key with no TTL — dispatch skips indefinitely until
# the user fixes their setup and the save handler clears the block.
#
# 30-day sanity backstop so stale blocks don't hang around forever if a cleanup
# is missed; any reasonable fix cycle is much shorter.

_STRUCTURAL_BLOCK_TTL = 30 * 24 * 3600


def _block_key(task_name: str, infospace_id: int) -> str:
    return f"task:{task_name}:{infospace_id}:block"


def is_structurally_blocked(task_name: str, infospace_id: int) -> Optional[str]:
    """Return the block reason, or None if not blocked. Cheap Redis lookup."""
    r = _get_redis()
    if not r:
        return None
    try:
        raw = r.get(_block_key(task_name, infospace_id))
        if not raw:
            return None
        return raw.decode() if isinstance(raw, bytes) else raw
    except Exception:
        return None


def set_structural_block(task_name: str, infospace_id: int, reason: str) -> None:
    """Mark this (task, infospace) as structurally blocked. Cleared by config save."""
    r = _get_redis()
    if not r:
        return
    try:
        r.set(_block_key(task_name, infospace_id), reason, ex=_STRUCTURAL_BLOCK_TTL)
        logger.info("Structural block: %s infospace=%d reason=%s", task_name, infospace_id, reason)
    except Exception as e:
        logger.warning("Failed to set structural block: %s", e)


def clear_structural_blocks(
    infospace_id: int,
    task_names: Optional[list[str]] = None,
    capability: Optional[str] = None,
) -> int:
    """Clear structural blocks for an infospace. Called by config-save handlers.

    Precedence:
      - ``task_names`` given → clear those tasks exactly.
      - ``capability`` given → resolve to every registered task with that
        capability, clear those. Config changes for a capability should only
        unblock tasks that actually depend on it (embedding config change
        must not unblock OCR).
      - Both None → clear everything for the infospace. Use sparingly
        (e.g., full config reset, not targeted field updates).

    Returns the count of keys actually deleted.
    """
    r = _get_redis()
    if not r:
        return 0

    names: Optional[list[str]] = None
    if task_names:
        names = list(task_names)
    elif capability:
        names = [
            name for name, desc in _task_registry.items()
            if desc.capability == capability
        ]
        if not names:
            return 0  # no registered tasks care about this capability

    try:
        if names is not None:
            keys = [_block_key(n, infospace_id) for n in names]
            # Filter to keys that actually exist — r.delete returns count of
            # keys deleted, but sending non-existent keys is wasted work.
            keys = [k for k in keys if r.exists(k)]
        else:
            keys = list(r.scan_iter(match=f"task:*:{infospace_id}:block"))
        if not keys:
            return 0
        return int(r.delete(*keys))
    except Exception as e:
        logger.warning("Failed to clear structural blocks: %s", e)
        return 0


def capabilities_served_by_provider(provider_key: str) -> set[str]:
    """Return the set of capabilities a given provider_key implements.

    Used when the user saves a credential for provider X — we want to clear
    blocks for every capability that provider implements (e.g. ``openai``
    implements both ``language`` and ``embedding``).
    """
    from app.api.modules.foundation_service_providers.registry import _registry
    return {cap for (cap, pk) in _registry if pk == provider_key.lower()}


def list_structural_blocks(infospace_id: int) -> dict[str, str]:
    """Return {task_name: reason} for all current structural blocks in an infospace.

    Used by the enrichment/status endpoint so the UI can surface setup problems.
    """
    r = _get_redis()
    if not r:
        return {}
    out: dict[str, str] = {}
    try:
        for raw_key in r.scan_iter(match=f"task:*:{infospace_id}:block"):
            key = raw_key.decode() if isinstance(raw_key, bytes) else raw_key
            # key format: task:{name}:{infospace_id}:block
            parts = key.split(":")
            if len(parts) != 4:
                continue
            name = parts[1]
            val = r.get(key)
            if val is not None:
                out[name] = val.decode() if isinstance(val, bytes) else val
    except Exception as e:
        logger.warning("Failed to list structural blocks: %s", e)
    return out


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
    check: Callable[[int], Any] | None = None,
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
    # Direct-invocation-only typed params — v2 user-action pattern.
    params_model: Type[BaseModel] | None = None,
):
    """
    Decorator that turns a function into a managed reactive Celery task.

    The decorated function signature: fn(ctx: TaskContext, entity_ids: list[int])

    When ``params_model`` is set: the function becomes direct-invocation-only
    (no triggers, no schedule). The signature gains a third argument:
    ``fn(ctx, entity_ids, params: params_model)``. Invoke via
    ``fn.delay(ids, iid, params=MyParams(...))``.
    """
    triggers = triggers or []

    # ── Decorator-time invariants ────────────────────────────────────────
    #
    # ``params_model`` is direct-invocation-only. Mixing it with triggers or
    # schedules would mean the dispatcher/event bus needs to know the params
    # schema, which it doesn't. Fail fast at module load time — a
    # misconfigured @task should not be silently half-wired.
    if params_model is not None:
        assert not triggers, (
            f"@task {name}: params_model is direct-invocation-only. "
            "Tasks with typed params cannot declare triggers."
        )
        assert schedule is None, (
            f"@task {name}: params_model is direct-invocation-only. "
            "Tasks with typed params cannot declare a schedule."
        )
        assert check is None, (
            f"@task {name}: params_model is direct-invocation-only. "
            "Tasks with typed params cannot declare a check query "
            "(self-query mode doesn't apply)."
        )
    else:
        assert check is not None, (
            f"@task {name}: check= is required unless params_model is set."
        )

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
            params_model=params_model,
        )

        # Register in task registry
        _task_registry[name] = descriptor

        # Generate Celery task
        def _celery_impl(
            self_task,
            batch_ids: list[int] | None,
            infospace_id: int,
            params_dict: dict[str, Any] | None = None,
            _chain_depth: int = 0,
        ):
            """Generated Celery task wrapper."""
            from app.core.config import settings

            start = time.perf_counter()

            # Structural block check: if a previous run hit ProviderError, the
            # block stays set until the user fixes their config (which clears it).
            # Skips event-triggered and direct invocations too.
            block_reason = is_structurally_blocked(name, infospace_id)
            if block_reason:
                logger.debug("Task %s skipped (blocked): %s", name, block_reason)
                return

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
                if check is None:
                    # params_model tasks are direct-invocation only.
                    logger.warning(
                        "Task %s invoked without batch_ids but has no check query; "
                        "direct-invocation-only tasks cannot self-query.", name,
                    )
                    return
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
                task_id = None
                try:
                    task_id = self_task.request.id
                except Exception:
                    pass
                ctx = context_cls(
                    infospace_id=infospace_id,
                    settings=settings,
                    task_name=name,
                    failure_memory=failure_memory,
                    task_id=task_id,
                )

                # Call decorated function — params_model tasks get a third
                # positional argument; plain tasks stay binary.
                if params_model is not None:
                    if params_dict is None:
                        raise ValueError(
                            f"Task {name} requires params (params_model={params_model.__name__}); "
                            "none provided"
                        )
                    params = params_model(**params_dict)
                    fn(ctx, batch_ids, params)
                else:
                    fn(ctx, batch_ids)

                # Flush stats
                duration_ms = (time.perf_counter() - start) * 1000
                _flush_stats(name, infospace_id, ctx._stats, duration_ms)

            except Exception as e:
                # Structural failures (provider misconfig) block indefinitely.
                # Transient failures set a short backoff + optional retry.
                from app.api.modules.foundation_service_providers.registry import ProviderError
                if isinstance(e, ProviderError):
                    logger.warning("Task %s structurally blocked: %s", name, e)
                    set_structural_block(name, infospace_id, str(e))
                    return
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
                # Honor the task-level backoff key. When the task body signals
                # a transient problem (e.g. lock held by a live sibling), it can
                # write this key to pause chains for its TTL — avoids tight
                # loops firing MAX_CHAIN_DEPTH invocations in a second.
                backoff_countdown = 0
                try:
                    if r:
                        raw_backoff = r.get(f"task:{name}:{infospace_id}:chain_backoff")
                        if raw_backoff:
                            try:
                                backoff_countdown = int(raw_backoff.decode() if isinstance(raw_backoff, bytes) else raw_backoff)
                            except (TypeError, ValueError):
                                backoff_countdown = 30
                except Exception:
                    pass

                _depth = _chain_depth or 0
                try:
                    from app.core.db import engine
                    with Session(engine) as session:
                        more = session.exec(check(infospace_id).limit(1)).first()
                    if more:
                        kwargs = {"_chain_depth": _depth + 1}
                        if backoff_countdown > 0:
                            kwargs["_chain_depth"] = 0
                            self_task.apply_async(
                                args=[None, infospace_id],
                                kwargs=kwargs,
                                countdown=backoff_countdown,
                            )
                        elif _depth >= MAX_CHAIN_DEPTH:
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

        if params_model is not None:
            # Direct-invocation API: fn.delay(ids, iid, params=Model(...))
            # Wraps the params into a dict before sending to Celery.
            def _delay(batch_ids, infospace_id, *, params: BaseModel | None = None):
                args = [batch_ids, infospace_id]
                if params is not None:
                    if not isinstance(params, params_model):
                        raise TypeError(
                            f"Task {name} expects params of type "
                            f"{params_model.__name__}, got {type(params).__name__}"
                        )
                    args.append(params.model_dump(mode="json"))
                return celery_task.apply_async(args=args)

            def _apply_async(args=None, kwargs=None, *, params: BaseModel | None = None, **celery_kwargs):
                outgoing = list(args or [])
                if params is not None:
                    if len(outgoing) < 2:
                        raise ValueError(
                            f"{name}: apply_async requires batch_ids + infospace_id in args"
                        )
                    outgoing.append(params.model_dump(mode="json"))
                return celery_task.apply_async(args=outgoing, kwargs=kwargs, **celery_kwargs)

            fn.delay = _delay
            fn.apply_async = _apply_async
        else:
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

