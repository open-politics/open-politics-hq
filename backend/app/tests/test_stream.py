"""
Tests for the presence infrastructure — stream_key, StreamWriter, StreamHub.

Tests cover:
- stream_key: format, param hashing, determinism
- StreamWriter: XADD payload shape, fire-and-forget contract, counters
- StreamHub: subscribe/unsubscribe, fan-out, XRANGE catch-up, cleanup
- ctx.send: integration with TaskContext
"""
import asyncio
import json
import pytest
from unittest.mock import AsyncMock, MagicMock, patch, call

from app.core.stream import stream_key, StreamWriter, StreamHub


# ═══════════════════════════════════════════════════
# stream_key — canonical key construction
# ═══════════════════════════════════════════════════

class TestStreamKey:

    def test_basic_format(self):
        assert stream_key(5, "annotation_run", 42) == "stream:5:annotation_run:42"

    def test_string_resource_id(self):
        assert stream_key(1, "knowledge_graph", "curations") == "stream:1:knowledge_graph:curations"

    def test_with_params_adds_hash(self):
        key = stream_key(5, "graph", 7, {"types": ["PERSON"]})
        assert key.startswith("stream:5:graph:7:")
        assert len(key.split(":")) == 5  # 5 segments with param hash

    def test_param_hash_is_deterministic(self):
        params = {"types": ["PERSON"], "depth": 2}
        k1 = stream_key(1, "graph", 1, params)
        k2 = stream_key(1, "graph", 1, params)
        assert k1 == k2

    def test_param_hash_is_order_independent(self):
        """JSON sort_keys ensures key order doesn't matter."""
        k1 = stream_key(1, "g", 1, {"a": 1, "b": 2})
        k2 = stream_key(1, "g", 1, {"b": 2, "a": 1})
        assert k1 == k2

    def test_different_params_produce_different_keys(self):
        k1 = stream_key(1, "g", 1, {"types": ["PERSON"]})
        k2 = stream_key(1, "g", 1, {"types": ["ORG"]})
        assert k1 != k2

    def test_no_params_vs_empty_params(self):
        k1 = stream_key(1, "g", 1)
        k2 = stream_key(1, "g", 1, {})
        # Empty dict is falsy, treated as no params
        assert k1 == k2


# ═══════════════════════════════════════════════════
# StreamWriter — fire-and-forget XADD
# ═══════════════════════════════════════════════════

class TestStreamWriter:

    @patch("app.core.redis.get_redis")
    @patch("app.core.stream._incr")
    def test_send_calls_xadd_with_correct_payload(self, mock_incr, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        writer = StreamWriter("stream:5:test:1")
        result = writer.send("progress", {"done": 3, "total": 10})

        assert result is True
        mock_redis.xadd.assert_called_once()
        args, kwargs = mock_redis.xadd.call_args
        assert args[0] == "stream:5:test:1"

        payload = args[1]
        assert payload["type"] == "progress"
        assert json.loads(payload["data"]) == {"done": 3, "total": 10}
        assert "ts" in payload

        assert kwargs["maxlen"] == 1000
        assert kwargs["approximate"] is True
        mock_incr.assert_called_with("stream:sent")

    @patch("app.core.redis.get_redis")
    @patch("app.core.stream._incr")
    def test_send_never_raises_on_redis_error(self, mock_incr, mock_get_redis):
        mock_get_redis.side_effect = ConnectionError("Redis down")

        writer = StreamWriter("stream:5:test:1")
        result = writer.send("event", {"data": 1})

        assert result is False
        mock_incr.assert_called_with("stream:dropped")

    @patch("app.core.redis.get_redis")
    @patch("app.core.stream._incr")
    def test_send_never_raises_on_xadd_error(self, mock_incr, mock_get_redis):
        mock_redis = MagicMock()
        mock_redis.xadd.side_effect = Exception("XADD failed")
        mock_get_redis.return_value = mock_redis

        writer = StreamWriter("stream:5:test:1")
        result = writer.send("event", {})

        assert result is False
        mock_incr.assert_called_with("stream:dropped")

    @patch("app.core.redis.get_redis")
    def test_expire_sets_ttl(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        writer = StreamWriter("stream:5:test:1")
        writer.expire(7200)

        mock_redis.expire.assert_called_once_with("stream:5:test:1", 7200)

    @patch("app.core.redis.get_redis")
    def test_expire_uses_default_ttl(self, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        writer = StreamWriter("stream:5:test:1")
        writer.expire()

        mock_redis.expire.assert_called_once_with("stream:5:test:1", StreamWriter.IDLE_TTL)

    @patch("app.core.redis.get_redis")
    def test_expire_never_raises(self, mock_get_redis):
        mock_get_redis.side_effect = Exception("Redis gone")
        writer = StreamWriter("stream:5:test:1")
        writer.expire()  # should not raise

    def test_send_serializes_non_json_types(self):
        """Non-serializable types should be handled by default=str."""
        from datetime import datetime
        with patch("app.core.redis.get_redis") as mock_get_redis, \
             patch("app.core.stream._incr"):
            mock_redis = MagicMock()
            mock_get_redis.return_value = mock_redis

            writer = StreamWriter("stream:5:test:1")
            result = writer.send("event", {"ts": datetime(2026, 1, 1)})

            assert result is True
            payload = mock_redis.xadd.call_args[0][1]
            data = json.loads(payload["data"])
            assert "2026" in data["ts"]  # datetime serialized to string


# ═══════════════════════════════════════════════════
# StreamHub — async fan-out
# ═══════════════════════════════════════════════════

class TestStreamHub:

    @pytest.mark.asyncio
    async def test_fan_out_delivers_to_all_subscribers(self):
        hub = StreamHub()

        # Directly test fan_out without Redis
        from app.core.stream import _HubEntry
        q1 = asyncio.Queue(maxsize=10)
        q2 = asyncio.Queue(maxsize=10)
        hub._entries["test_key"] = _HubEntry(subscribers={q1, q2})

        msg = {"id": "1-0", "type": "progress", "data": '{"done": 1}'}
        hub._fan_out("test_key", msg)

        assert q1.qsize() == 1
        assert q2.qsize() == 1
        assert (await q1.get()) == msg
        assert (await q2.get()) == msg

    @pytest.mark.asyncio
    async def test_fan_out_drops_when_queue_full(self):
        hub = StreamHub()

        from app.core.stream import _HubEntry
        q = asyncio.Queue(maxsize=1)
        await q.put({"id": "0", "type": "fill", "data": "{}"})  # fill it
        hub._entries["test_key"] = _HubEntry(subscribers={q})

        with patch("app.core.stream._incr") as mock_incr:
            hub._fan_out("test_key", {"id": "1", "type": "drop", "data": "{}"})
            mock_incr.assert_called_with("stream:queue_full")

        assert q.qsize() == 1  # still just the original message

    @pytest.mark.asyncio
    async def test_fan_out_ignores_unknown_key(self):
        hub = StreamHub()
        hub._fan_out("nonexistent_key", {"id": "1", "type": "x", "data": "{}"})
        # should not raise

    @pytest.mark.asyncio
    async def test_unsubscribe_removes_queue(self):
        hub = StreamHub()

        from app.core.stream import _HubEntry
        q = asyncio.Queue()
        mock_task = MagicMock()
        mock_task.done.return_value = False
        hub._entries["key"] = _HubEntry(subscribers={q}, reader_task=mock_task)

        with patch("app.core.stream._get_async_redis") as mock_redis, \
             patch("app.core.stream._incr_neg"):
            mock_r = AsyncMock()
            mock_redis.return_value = mock_r

            await hub.unsubscribe("key", q)

        assert "key" not in hub._entries
        mock_task.cancel.assert_called_once()


# ═══════════════════════════════════════════════════
# ctx.send — TaskContext integration
# ═══════════════════════════════════════════════════

class TestCtxSend:

    @patch("app.core.redis.get_redis")
    @patch("app.core.stream._incr")
    def test_ctx_send_delegates_to_stream_writer(self, mock_incr, mock_get_redis):
        mock_redis = MagicMock()
        mock_get_redis.return_value = mock_redis

        from app.core.tasks import TaskContext
        ctx = TaskContext(
            infospace_id=5,
            settings=MagicMock(),
            task_name="test_task",
        )

        result = ctx.send("annotation_run", 42, "progress", {"done": 3})

        assert result is True
        mock_redis.xadd.assert_called_once()
        key = mock_redis.xadd.call_args[0][0]
        assert key == "stream:5:annotation_run:42"

    @patch("app.core.redis.get_redis")
    def test_ctx_send_never_raises(self, mock_get_redis):
        mock_get_redis.side_effect = Exception("Redis gone")

        from app.core.tasks import TaskContext
        ctx = TaskContext(
            infospace_id=5,
            settings=MagicMock(),
            task_name="test_task",
        )

        result = ctx.send("topic", 1, "event", {})
        assert result is False  # failed but didn't raise
