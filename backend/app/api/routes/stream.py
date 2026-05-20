"""
Generic SSE subscription endpoint for presence streams.

Reads what ctx.send() writes. Clients subscribe to a topic + resource_id
and receive events as SSE frames. Supports Last-Event-ID for reconnection.

    GET /infospaces/{iid}/stream/{topic}/{resource_id}

Native async-generator endpoint — FastAPI's EventSourceResponse pipeline
applies ``_PING_INTERVAL = 3.0`` (set in ``main.py``) for keepalives that
survive nginx ``proxy_read_timeout``. Connection closes after 30 minutes
(client should reconnect with ``Last-Event-ID``).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.api.modules.identity_infospace_user.access import Access, Requires
from app.core.stream import get_hub, stream_key


def _parse_params_dep(
    params: Optional[str] = Query(None, description="JSON-encoded view parameters"),
) -> Optional[dict]:
    """Validate + parse the ``params`` query string before the SSE generator starts.

    Raising HTTPException here returns a proper 4xx response; raising
    inside the async-generator body would be too late — FastAPI's SSE
    pipeline has already started streaming.
    """
    if not params:
        return None
    try:
        return json.loads(params)
    except json.JSONDecodeError:
        raise HTTPException(status_code=400, detail="Invalid JSON in params")

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_CONNECTION_SECONDS = 1800  # 30 minutes


@router.get(
    "/infospaces/{infospace_id}/stream/{topic}/{resource_id}",
    response_class=EventSourceResponse,
    status_code=200,
    tags=["Live Streams"],
)
async def subscribe_stream(
    topic: str,
    resource_id: str,
    request: Request,
    access: Access = Requires(scope=None),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
    param_dict: Optional[dict] = Depends(_parse_params_dep),
):
    """Subscribe to a presence stream via SSE (native async-generator).

    Events are pushed by ``ctx.send()`` from background tasks or by
    ``StreamWriter`` from route handlers. ``_PING_INTERVAL = 3.0`` keeps the
    connection alive through proxies. Closes after 30 minutes — client
    reconnects with ``Last-Event-ID``.

    No-transform / no-buffering response headers are injected globally by
    ``SseNoTransformMiddleware`` in ``main.py`` for any ``text/event-stream``
    response — gzip in proxies (Next.js dev rewrites, nginx) batches small
    SSE frames into bulk delivery and defeats streaming.
    """
    key = stream_key(access.infospace_id, topic, resource_id, param_dict)

    if last_event_id and last_event_id != "0":
        from app.core.stream import _incr
        _incr("stream:reconnects")

    start_id = last_event_id or "$"
    if start_id == "0":
        start_id = "0"

    hub = get_hub()
    q = await hub.subscribe(key, last_id=start_id)
    loop = asyncio.get_running_loop()
    deadline = loop.time() + MAX_CONNECTION_SECONDS
    try:
        while True:
            remaining = deadline - loop.time()
            if remaining <= 0:
                yield ServerSentEvent(data="{}", event="deadline")
                return
            try:
                msg = await asyncio.wait_for(q.get(), timeout=remaining)
            except asyncio.TimeoutError:
                return  # deadline reached naturally
            if msg is None:
                return
            # The hub delivers `data` as an already-JSON-encoded string (that
            # is what StreamWriter wrote via json.dumps). FastAPI's
            # ServerSentEvent JSON-encodes whatever you put in `data`, so
            # passing our string there would double-encode it (the client
            # would receive a quoted JSON string and parse to a string
            # instead of the object). `raw_data` bypasses that encoding and
            # preserves the payload verbatim.
            yield ServerSentEvent(
                raw_data=msg.get("data", "{}"),
                event=msg.get("type", "message"),
                id=msg.get("id"),
            )
    except asyncio.CancelledError:
        pass
    finally:
        await hub.unsubscribe(key, q)
