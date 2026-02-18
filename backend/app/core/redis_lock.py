"""
Redis advisory lock for flow execution.

Prevents concurrent execution of the same flow across workers.
"""

import contextlib
import logging
from typing import Generator

from app.core.config import settings

logger = logging.getLogger(__name__)


def _get_redis_client():
    """Get Redis client from settings."""
    import redis
    # Parse redis_url for connection
    url = settings.redis_url
    return redis.from_url(url, decode_responses=True)


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
