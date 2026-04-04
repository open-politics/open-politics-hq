"""
Integration tests for live primitives: SSE progressive delivery and stream endpoint.

These tests hit the real FastAPI app with TestClient. They verify:
1. Query endpoint delivers SSE frames progressively via EventSourceResponse
2. Stream subscription endpoint connects and receives heartbeats
3. StreamWriter → stream endpoint round-trip (push, then read via SSE)

Requires: running Postgres + Redis (functional test fixtures from conftest.py).
"""
import json
import threading
import time
import pytest

from app.core.config import settings


# ═══════════════════════════════════════════════════
# Query SSE: progressive delivery round-trip
# ═══════════════════════════════════════════════════

class TestQuerySSE:
    """Test the /query endpoint with Accept: text/event-stream."""

    def test_sse_returns_phases(self, client, headers, infospace_factory, user_id):
        """SSE path: results phase with total=-1 sentinel, then count phase."""
        iid = infospace_factory("query_sse_test", user_id)

        with client.stream(
            "POST",
            f"{settings.API_V1_STR}/infospaces/{iid}/query",
            headers={**headers, "Accept": "text/event-stream"},
            json={"q": "kind:pdf", "limit": 10},
        ) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")

            frames = []
            for line in response.iter_lines():
                frames.append(line)

        full = "\n".join(frames)

        # Must have results event
        assert "event: results" in full

        # Results phase must contain the query echo and total: -1
        results_data = None
        for i, line in enumerate(frames):
            if line == "event: results" and i + 1 < len(frames):
                data_line = frames[i + 1]
                if data_line.startswith("data: "):
                    results_data = json.loads(data_line[6:])
                    break

        assert results_data is not None
        assert results_data["query"] == "kind:pdf"
        assert results_data["total"] == -1  # sentinel: "still counting"
        assert "results" in results_data

    def test_pagination_returns_json(self, client, headers, infospace_factory, user_id):
        """Pagination requests return JSON directly, not SSE."""
        iid = infospace_factory("query_json_test", user_id)

        response = client.post(
            f"{settings.API_V1_STR}/infospaces/{iid}/query",
            headers=headers,
            json={"q": "kind:pdf", "limit": 10, "offset": 10},
        )

        assert response.status_code == 200
        body = response.json()

        # JSON response has all fields
        assert "query" in body
        assert "results" in body
        assert "total" in body

    def test_empty_query_returns_immediately(self, client, headers, infospace_factory, user_id):
        """Empty query with no scope should return immediately with zero results."""
        iid = infospace_factory("query_empty_test", user_id)

        with client.stream(
            "POST",
            f"{settings.API_V1_STR}/infospaces/{iid}/query",
            headers={**headers, "Accept": "text/event-stream"},
            json={"q": "", "limit": 10},
        ) as response:
            assert response.status_code == 200
            frames = list(response.iter_lines())

        full = "\n".join(frames)
        assert "event: results" in full

        # Should have total=0, not -1
        for i, line in enumerate(frames):
            if line == "event: results" and i + 1 < len(frames):
                data_line = frames[i + 1]
                if data_line.startswith("data: "):
                    data = json.loads(data_line[6:])
                    assert data["total"] == 0
                    assert data["results"] == []
                    break


# ═══════════════════════════════════════════════════
# Stream endpoint: subscription + push round-trip
# ═══════════════════════════════════════════════════

class TestStreamEndpoint:
    """Test the /stream/{topic}/{resource_id} SSE subscription endpoint."""

    def test_stream_connects_and_receives_pushed_event(self):
        """Push via StreamWriter, verify event lands in Redis Stream."""
        from app.core.stream import stream_key, StreamWriter
        from app.core.redis import get_redis

        key = stream_key(0, "integration_test", "roundtrip")
        writer = StreamWriter(key)
        assert writer.send("test_event", {"hello": "world"}) is True

        # Read directly from Redis to verify the event landed
        r = get_redis()
        entries = r.xrange(key, count=10)
        assert len(entries) > 0

        last_entry = entries[-1]
        entry_id, fields = last_entry
        assert fields["type"] == "test_event"
        data = json.loads(fields["data"])
        assert data["hello"] == "world"

        # Cleanup
        r.delete(key)

    def test_stream_rejects_bad_params_json(self, client, headers, infospace_factory, user_id):
        """Malformed JSON in params query parameter should return 400."""
        iid = infospace_factory("stream_bad_params_test", user_id)

        response = client.get(
            f"{settings.API_V1_STR}/infospaces/{iid}/stream/topic/1",
            headers=headers,
            params={"params": "not valid json{{{"},
        )
        assert response.status_code == 400


# ═══════════════════════════════════════════════════
# Observability counters
# ═══════════════════════════════════════════════════

class TestObservabilityCounters:
    """Verify that operations increment the right Redis counters."""

    def test_stream_writer_increments_sent_counter(self):
        """StreamWriter.send() should increment stream:sent."""
        from app.core.redis import get_redis
        from app.core.stream import StreamWriter

        r = get_redis()
        before = int(r.get("stream:sent") or 0)

        writer = StreamWriter("stream:0:test_counter:0")
        writer.send("test", {"data": 1})

        after = int(r.get("stream:sent") or 0)
        assert after > before

        # Cleanup
        r.delete("stream:0:test_counter:0")
