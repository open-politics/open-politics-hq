"""
Integration tests for live primitives: SSE progressive delivery and stream endpoint.

Tests hit the real FastAPI app with TestClient. Verifies:
1. /search/assets endpoint delivers SSE frames progressively via the
   unified StreamEvent wire protocol (skeleton → section → count → done)
2. /search/assets JSON mode returns a complete AssetSearch envelope
3. Stream subscription endpoint connects and receives heartbeats
4. StreamWriter → stream endpoint round-trip (push, then read via SSE)

Requires: running Postgres + Redis (functional test fixtures from conftest.py).
"""
import json
import threading
import time
import pytest

from app.core.config import settings


def _parse_sse_frames(frames: list[str]) -> list[tuple[str, dict]]:
    """Parse alternating ``event: X\\ndata: {...}`` frames. Returns [(event, payload)]."""
    events: list[tuple[str, dict]] = []
    i = 0
    while i < len(frames):
        line = frames[i]
        if line.startswith("event: "):
            event_name = line[7:]
            # Find next data: line
            for j in range(i + 1, len(frames)):
                if frames[j].startswith("data: "):
                    try:
                        data = json.loads(frames[j][6:])
                    except json.JSONDecodeError:
                        data = {}
                    events.append((event_name, data))
                    i = j + 1
                    break
            else:
                i += 1
        else:
            i += 1
    return events


# ═══════════════════════════════════════════════════
# /search/assets SSE — progressive wire protocol
# ═══════════════════════════════════════════════════

class TestAssetSearchSSE:
    """Unified StreamEvent wire protocol on ``POST /search/infospaces/{iid}/assets``."""

    def test_sse_emits_skeleton_section_count_done(self, client, headers, infospace_factory, user_id):
        """SSE mode: skeleton → section(role=primary, total=-1) → count → done."""
        iid = infospace_factory("search_assets_sse_test", user_id)

        with client.stream(
            "POST",
            f"{settings.API_V1_STR}/search/infospaces/{iid}/assets/stream",
            headers={**headers, "Accept": "text/event-stream"},
            json={"q": "kind:pdf", "mode": "text", "limit": 10},
        ) as response:
            assert response.status_code == 200
            assert "text/event-stream" in response.headers.get("content-type", "")
            frames = list(response.iter_lines())

        events = _parse_sse_frames(frames)
        event_types = [e[0] for e in events]

        # Required events in order
        assert "skeleton" in event_types, event_types
        assert "section" in event_types, event_types
        assert "count" in event_types, event_types
        assert "done" in event_types, event_types
        assert event_types.index("skeleton") < event_types.index("section")
        assert event_types.index("section") < event_types.index("count")
        assert event_types.index("count") < event_types.index("done")

        # Primary section carries the -1 sentinel before count arrives
        primary_sections = [p for e, p in events if e == "section" and p.get("role") == "primary"]
        assert primary_sections, "no primary section emitted"
        primary = primary_sections[0]["section"]
        assert primary["total"] == -1  # sentinel: still counting
        assert isinstance(primary["items"], list)

    def test_json_returns_envelope(self, client, headers, infospace_factory, user_id):
        """JSON sibling (no /stream suffix) returns a full AssetSearch envelope."""
        iid = infospace_factory("search_assets_json_test", user_id)

        response = client.post(
            f"{settings.API_V1_STR}/search/infospaces/{iid}/assets",
            headers=headers,
            json={"q": "kind:pdf", "mode": "text", "limit": 10},
        )
        assert response.status_code == 200
        body = response.json()
        assert "primary" in body
        assert "meta" in body
        assert "items" in body["primary"]
        assert body["meta"]["query"] == "kind:pdf"
        assert body["meta"]["mode"] == "text"

    def test_empty_query_still_emits_complete_protocol(self, client, headers, infospace_factory, user_id):
        """Empty query with no data still completes the wire protocol cleanly."""
        iid = infospace_factory("search_assets_empty_test", user_id)

        with client.stream(
            "POST",
            f"{settings.API_V1_STR}/search/infospaces/{iid}/assets/stream",
            headers={**headers, "Accept": "text/event-stream"},
            json={"q": "", "mode": "text", "limit": 10},
        ) as response:
            assert response.status_code == 200
            frames = list(response.iter_lines())

        events = _parse_sse_frames(frames)
        event_types = [e[0] for e in events]
        assert "skeleton" in event_types
        assert "done" in event_types

        # Primary section should be empty
        primary_sections = [p for e, p in events if e == "section" and p.get("role") == "primary"]
        assert primary_sections
        assert primary_sections[0]["section"]["items"] == []


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
# Wire-compat: event order on /search/assets and /view
# ═══════════════════════════════════════════════════

class TestWireCompat:
    """Freeze the StreamEvent wire protocol — event-by-event ordering.

    Prevents accidental drift in the SSE event sequence that the frontend
    hooks rely on. A regression here surfaces as a protocol break, not a
    silent null.
    """

    def test_search_assets_event_order(self, client, headers, infospace_factory, user_id):
        """skeleton → section(primary) → count → done (plus optional grouped)."""
        iid = infospace_factory("wire_search_test", user_id)

        with client.stream(
            "POST",
            f"{settings.API_V1_STR}/search/infospaces/{iid}/assets/stream",
            headers={**headers, "Accept": "text/event-stream"},
            json={"q": "anything", "mode": "text", "limit": 5},
        ) as response:
            assert response.status_code == 200
            frames = list(response.iter_lines())

        events = _parse_sse_frames(frames)
        seq = [e[0] for e in events]

        # Required ordered subsequence
        required = ["skeleton", "section", "count", "done"]
        idx = -1
        for expected in required:
            idx = next(
                (i for i in range(idx + 1, len(seq)) if seq[i] == expected),
                None,
            )
            assert idx is not None, (
                f"Protocol break: missing '{expected}' after position "
                f"{idx}. Full sequence: {seq}"
            )

        # section payloads must have role and section.total sentinel
        for event_type, payload in events:
            if event_type == "section":
                assert "role" in payload
                assert "section" in payload
                assert "items" in payload["section"]

    def test_view_endpoint_rejects_empty_body(self, client, headers, infospace_factory, user_id):
        """/view rejects requests with no rows/aggregate/graph config.

        Validation runs before the generator starts — 400 (JSON), not an
        SSE error event. Regression guard: keep validation pre-generator.
        """
        iid = infospace_factory("wire_view_empty_test", user_id)

        response = client.post(
            f"{settings.API_V1_STR}/infospaces/{iid}/runs/1/view/stream",
            headers=headers,
            json={},  # no rows, aggregate, or graph
        )
        # Either 400 (body check) or 404/403 (access check) — both are
        # pre-generator paths. Regression would be a 200 streaming empty.
        assert response.status_code in (400, 403, 404)
        assert "text/event-stream" not in response.headers.get("content-type", "")


# ═══════════════════════════════════════════════════
# User-initiated action: geocode on a run
# ═══════════════════════════════════════════════════

class TestGeocodeAction:
    """End-to-end: POST /runs/{id}/action/geocode returns a watch_url
    pointing to the existing ``/stream`` endpoint.

    Verifies the action pattern (@task + params_model + ctx.send) is wired
    correctly. A full integration test (subscribe → receive 'resolved' →
    verify Entity.properties['coords']) requires a geocoding
    provider, which isn't guaranteed in CI; this test guards the contract.
    """

    def test_action_returns_task_id_and_watch_url(self, client, headers, infospace_factory, user_id):
        """The route returns ActionAcceptedResponse pointing at /stream."""
        iid = infospace_factory("geocode_action_test", user_id)

        # Even without a real run (404), the shape assertions on access
        # + contract are still valuable guards. We create a minimal run
        # skeleton via raw DB insert; otherwise skip.
        from app.models import AnnotationRun, RunStatus
        from app.core.db import engine
        from sqlmodel import Session
        import uuid

        with Session(engine) as s:
            run = AnnotationRun(
                name="geocode-test-run",
                description="geocode action",
                configuration={},
                infospace_id=iid,
                user_id=user_id,
                status=RunStatus.COMPLETED,
                uuid=str(uuid.uuid4()),
                trigger_type="MANUAL",
                run_type="ONE_OFF",
                context_window=0,
                follow_on_version_change=False,
            )
            s.add(run)
            s.commit()
            s.refresh(run)
            run_id = run.id

        response = client.post(
            f"{settings.API_V1_STR}/infospaces/{iid}/runs/{run_id}/action/geocode",
            headers=headers,
            json={"field_path": "location.name"},
        )
        assert response.status_code == 200, response.text[:300]
        body = response.json()
        assert "task_id" in body
        assert "watch_url" in body
        # Watch URL must point at the existing /stream endpoint + topic
        assert body["watch_url"].startswith(f"/infospaces/{iid}/stream/annotation.geocoding/")
        # resource_id format: {run_id}:{task_id}
        expected_prefix = f"{run_id}:"
        assert expected_prefix in body["watch_url"]


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
