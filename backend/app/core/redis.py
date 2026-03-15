"""
Shared Redis client for task infrastructure.

Reuses the connection pool from redis_lock.py to avoid exhausting connections.
"""

import redis as _redis

from app.core.config import settings

_pool: _redis.ConnectionPool | None = None


def get_redis() -> _redis.Redis:
    """Get a Redis client from the shared pool."""
    global _pool
    if _pool is None:
        _pool = _redis.ConnectionPool.from_url(
            settings.redis_url, decode_responses=True, max_connections=20
        )
    return _redis.Redis(connection_pool=_pool)
