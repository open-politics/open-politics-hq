"""
Presence infrastructure: backend-to-frontend event delivery via Redis Streams.

Three components:
- stream_key()    — canonical key construction
- StreamWriter    — sync XADD, fire-and-forget (used by tasks and routes)
- StreamHub       — async fan-out singleton (used by SSE subscription endpoint)

ctx.send() on TaskContext delegates to StreamWriter. The SSE endpoint in
routes/stream.py subscribes via StreamHub. If nobody's listening, events
sit briefly in Redis and get trimmed by MAXLEN.

No decorator, no registry, no hydration framework. Just a writer, a hub,
and an endpoint.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Any, Optional

logger = logging.getLogger(__name__)


# ── Stream key construction ──────────────────────────────────────────────────

def stream_key(
    iid: int,
    topic: str,
    resource_id: int | str,
    params: dict | None = None,
) -> str:
    """Build canonical Redis Stream key.

    Format: stream:{iid}:{topic}:{resource_id}
    With params: stream:{iid}:{topic}:{resource_id}:{param_hash}

    param_hash is a truncated SHA-256 of deterministic JSON. This accommodates
    future parameterized views (GQL queries, filtered projections) without
    changing the key format.
    """
    base = f"stream:{iid}:{topic}:{resource_id}"
    if params:
        canonical = json.dumps(params, sort_keys=True, separators=(",", ":"))
        h = hashlib.sha256(canonical.encode()).hexdigest()[:8]
        return f"{base}:{h}"
    return base


# ── Observability ────────────────────────────────────────────────────────────

def _incr(counter_key: str) -> None:
    """Increment a Redis counter. Best-effort, never raises."""
    try:
        from app.core.redis import get_redis
        get_redis().incr(counter_key)
    except Exception:
        pass


# ── StreamWriter (sync, for tasks and routes) ────────────────────────────────

class StreamWriter:
    """Fire-and-forget XADD to a Redis Stream.

    Used from Celery workers (ctx.send) and sync route handlers. Never raises.
    Failures are counted, not propagated.
    """

    MAXLEN: int = 1000  # approximate XADD MAXLEN
    IDLE_TTL: int = 3600  # 1 hour

    def __init__(self, key: str):
        self._key = key

    def send(self, event: str, data: Any) -> bool:
        """Append an event to the stream. Returns True on success."""
        try:
            from app.core.redis import get_redis
            r = get_redis()
            payload = {
                "type": event,
                "data": json.dumps(data, default=str),
                "ts": str(int(time.time() * 1000)),
            }
            r.xadd(self._key, payload, maxlen=self.MAXLEN, approximate=True)
            _incr("stream:sent")
            return True
        except Exception as exc:
            logger.warning("stream.send failed for %s: %s", self._key, exc)
            _incr("stream:dropped")
            return False

    def expire(self, ttl: int | None = None) -> None:
        """Set TTL on the stream key. Call after terminal events."""
        try:
            from app.core.redis import get_redis
            get_redis().expire(self._key, ttl or self.IDLE_TTL)
        except Exception:
            pass


# ── Family fan-out (annotation run extensions) ──────────────────────────────


class FamilyStreamWriter:
    """Writes the same event to a primary stream and an optional mirror stream.

    Used by annotation extension runs: events need to land on the child run's
    own stream (so anyone watching the child sees them) AND on the parent
    run's stream (so panels bound to the parent refetch on activity).

    Construct with the primary key and an optional mirror key. ``send`` and
    ``expire`` fan out to both. Mirror failures don't affect the primary.
    """

    def __init__(self, primary_key: str, mirror_key: str | None = None):
        self._primary = StreamWriter(primary_key)
        self._mirror = StreamWriter(mirror_key) if mirror_key else None

    def send(self, event: str, data: Any) -> bool:
        ok = self._primary.send(event, data)
        if self._mirror:
            self._mirror.send(event, data)
        return ok

    def expire(self, ttl: int | None = None) -> None:
        self._primary.expire(ttl)
        if self._mirror:
            self._mirror.expire(ttl)


# ── Async Redis client (for StreamHub) ───────────────────────────────────────

_async_pool = None


def _get_async_redis():
    """Lazy async Redis client. Separate pool from sync client."""
    global _async_pool
    if _async_pool is None:
        import redis.asyncio as aioredis
        from app.core.config import settings
        _async_pool = aioredis.ConnectionPool.from_url(
            settings.redis_url, decode_responses=True, max_connections=50,
        )
    import redis.asyncio as aioredis
    return aioredis.Redis(connection_pool=_async_pool)


# ── StreamHub (async fan-out singleton) ──────────────────────────────────────

@dataclass
class _HubEntry:
    """One entry per unique stream key in the hub."""
    subscribers: set  # set of asyncio.Queue
    reader_task: Optional[asyncio.Task] = None
    last_activity: float = field(default_factory=time.time)


class StreamHub:
    """Process-singleton fan-out hub.

    For each unique stream key with active subscribers, runs exactly one
    background asyncio.Task that calls XREAD with BLOCK. When entries arrive,
    fans out to all subscriber Queues.

    Subscriber count → 0: reader cancelled, key cleaned up, stream TTL set.

    Memory bounds:
    - Per-stream entries bounded by XADD MAXLEN (in StreamWriter)
    - Per-subscriber queue capped at MAX_QUEUE_SIZE (overflow drops counted)
    - Connection lifetime capped at MAX_CONNECTION_SECONDS (enforced by caller)
    """

    XREAD_BLOCK_MS: int = 5000
    XREAD_COUNT: int = 50
    MAX_QUEUE_SIZE: int = 200

    def __init__(self):
        self._entries: dict[str, _HubEntry] = {}
        self._lock = asyncio.Lock()

    async def subscribe(self, key: str, last_id: str = "$") -> asyncio.Queue:
        """Register a new SSE connection for this stream key.

        last_id: Redis Stream ID to read from. "$" for new events only.
        A real stream ID (from Last-Event-ID) replays from that point.

        Returns a Queue that receives dicts: {"id": str, "type": str, "data": str}.

        Reconnection contract: if a reader is already running (serving other
        subscribers), the reconnecting subscriber gets a one-time XRANGE
        catch-up from last_id to current. Duplicates between XRANGE and
        fan-out are possible — clients must handle idempotently.
        """
        q: asyncio.Queue = asyncio.Queue(maxsize=self.MAX_QUEUE_SIZE)
        needs_catchup = False
        async with self._lock:
            if key not in self._entries:
                # First subscriber — reader starts from their position
                entry = _HubEntry(subscribers=set())
                self._entries[key] = entry
                entry.reader_task = asyncio.create_task(
                    self._reader_loop(key, last_id),
                    name=f"stream-reader:{key}",
                )
            else:
                # Joining an existing reader — may need catch-up
                needs_catchup = last_id not in ("$", "0-0")
            self._entries[key].subscribers.add(q)
            self._entries[key].last_activity = time.time()

        # Catch-up: replay events from last_id for reconnecting subscribers
        # joining an existing reader that's already ahead. Some events may
        # also arrive via fan-out (duplicates), which is documented as the
        # client's responsibility to handle idempotently.
        if needs_catchup:
            try:
                r = _get_async_redis()
                entries = await r.xrange(key, min=last_id, count=self.MAX_QUEUE_SIZE)
                for entry_id, fields in entries:
                    if entry_id == last_id:
                        continue  # skip the event they already saw
                    try:
                        q.put_nowait({
                            "id": entry_id,
                            "type": fields.get("type", "message"),
                            "data": fields.get("data", "{}"),
                        })
                    except asyncio.QueueFull:
                        _incr("stream:queue_full")
                        break
            except Exception as exc:
                logger.warning("stream catchup failed for %s: %s", key, exc)

        _incr("stream:active_connections")
        return q

    async def unsubscribe(self, key: str, q: asyncio.Queue) -> None:
        """Remove a subscriber. If last one, cancel reader and clean up."""
        async with self._lock:
            entry = self._entries.get(key)
            if not entry:
                return
            entry.subscribers.discard(q)
            if not entry.subscribers:
                if entry.reader_task and not entry.reader_task.done():
                    entry.reader_task.cancel()
                del self._entries[key]
                # Set TTL on idle stream so Redis cleans it up
                try:
                    r = _get_async_redis()
                    await r.expire(key, StreamWriter.IDLE_TTL)
                except Exception:
                    pass
        _incr_neg("stream:active_connections")

    async def _reader_loop(self, key: str, start_id: str) -> None:
        """Background task: XREAD from Redis, fan out to subscribers."""
        r = _get_async_redis()
        cursor = start_id
        retry_delay = 1

        while True:
            try:
                result = await r.xread(
                    {key: cursor},
                    count=self.XREAD_COUNT,
                    block=self.XREAD_BLOCK_MS,
                )
                if result:
                    for _stream_key, entries in result:
                        for entry_id, fields in entries:
                            cursor = entry_id
                            self._fan_out(key, {
                                "id": entry_id,
                                "type": fields.get("type", "message"),
                                "data": fields.get("data", "{}"),
                            })
                retry_delay = 1  # reset on success
            except asyncio.CancelledError:
                return
            except Exception as exc:
                logger.warning("stream reader error for %s: %s", key, exc)
                await asyncio.sleep(min(retry_delay, 30))
                retry_delay = min(retry_delay * 2, 30)

    def _fan_out(self, key: str, message: dict) -> None:
        """Distribute a message to all subscribers for a key."""
        entry = self._entries.get(key)
        if not entry:
            return
        for q in list(entry.subscribers):
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                _incr("stream:queue_full")
        entry.last_activity = time.time()


def _incr_neg(counter_key: str) -> None:
    """Decrement a Redis counter. Best-effort."""
    try:
        from app.core.redis import get_redis
        get_redis().decr(counter_key)
    except Exception:
        pass


# ── Hub singleton ────────────────────────────────────────────────────────────

_hub: StreamHub | None = None


def get_hub() -> StreamHub:
    """Return the process-singleton StreamHub."""
    global _hub
    if _hub is None:
        _hub = StreamHub()
    return _hub
