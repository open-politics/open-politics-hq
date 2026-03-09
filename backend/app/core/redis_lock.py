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
    """
    client = _get_redis_client()
    lock_key = f"flow_exec:{flow_id}"
    lock = client.lock(lock_key, timeout=3600, blocking=False)  # 1h max
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
    Timeout 2h for long runs.
    """
    client = _get_redis_client()
    lock_key = f"annotation_run:{run_id}"
    lock = client.lock(lock_key, timeout=7200, blocking=False)  # 2h max
    acquired = lock.acquire()
    try:
        yield acquired
    finally:
        if acquired:
            try:
                lock.release()
            except Exception as e:
                logger.warning(f"Annotation run lock release failed for run {run_id}: {e}")
