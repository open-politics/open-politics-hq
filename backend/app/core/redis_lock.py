"""
Redis advisory lock for flow execution.

Prevents concurrent execution of the same flow across workers.
Uses a shared connection pool to avoid exhausting Redis connections.
"""

import contextlib
import logging
from typing import Generator

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

_redis_pool: redis.ConnectionPool | None = None


def _get_redis_client():
    """Get Redis client from shared connection pool."""
    global _redis_pool
    if _redis_pool is None:
        _redis_pool = redis.ConnectionPool.from_url(
            settings.redis_url, decode_responses=True, max_connections=20
        )
    return redis.Redis(connection_pool=_redis_pool)


@contextlib.contextmanager
def flow_execution_lock(flow_id: int) -> Generator[bool, None, None]:
    """
    Acquire an advisory lock for flow execution.
    Yields True if lock acquired, False if another execution holds it.

    TTL set to 30 minutes — matches annotation_run_lock. A crashed worker's
    lock self-heals without manual intervention instead of blocking the flow
    for a full hour. Long-running flows that exceed 30 min should either
    be chunked via self_chain (the preferred pattern) or periodically
    refresh the lock.
    """
    client = _get_redis_client()
    lock_key = f"flow_exec:{flow_id}"
    lock = client.lock(lock_key, timeout=1800, blocking=False)  # 30 min
    acquired = lock.acquire()
    try:
        yield acquired
    finally:
        if acquired:
            try:
                lock.release()
            except Exception as e:
                logger.warning(f"Flow lock release failed for flow {flow_id}: {e}")


@contextlib.contextmanager
def annotation_run_lock(run_id: int) -> Generator[bool, None, None]:
    """
    Acquire an advisory lock for annotation run processing.
    Yields True if lock acquired, False if another execution holds it.

    TTL set to 30 minutes — long enough for one chunk's worth of LLM calls
    (chunk_size=50, ~30s/annotation worst case) but short enough that a
    crashed worker's lock self-heals without manual intervention. Chunked
    self-chains re-acquire the lock at each chunk boundary.
    """
    client = _get_redis_client()
    lock_key = f"annotation_run:{run_id}"
    lock = client.lock(lock_key, timeout=1800, blocking=False)  # 30 min
    acquired = lock.acquire()
    try:
        yield acquired
    finally:
        if acquired:
            try:
                lock.release()
            except Exception as e:
                logger.warning(f"Annotation run lock release failed for run {run_id}: {e}")
