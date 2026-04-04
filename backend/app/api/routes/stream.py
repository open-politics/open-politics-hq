"""
Generic SSE subscription endpoint for presence streams.

Reads what ctx.send() writes. Clients subscribe to a topic + resource_id
and receive events as SSE frames. Supports Last-Event-ID for reconnection.

    GET /infospaces/{iid}/stream/{topic}/{resource_id}

Uses native EventSourceResponse with 3s keepalive pings to survive tight
proxy timeouts (nginx proxy_read_timeout=5s). Connection closes after
30 minutes (client should reconnect with Last-Event-ID).
"""

from __future__ import annotations

import asyncio
import json
import logging
from typing import Optional

from fastapi import APIRouter, Header, HTTPException, Query, Request
from fastapi.responses import Response
from fastapi.sse import ServerSentEvent
from app.core.sse import SSEResponse

from app.api.modules.identity_infospace_user.access import Access, Requires
from app.core.stream import get_hub, stream_key

logger = logging.getLogger(__name__)

router = APIRouter()

MAX_CONNECTION_SECONDS = 1800  # 30 minutes


@router.get(
    "/infospaces/{infospace_id}/stream/{topic}/{resource_id}",
    status_code=200,
    tags=["Live Streams"],
)
async def subscribe_stream(
    topic: str,
    resource_id: str,
    request: Request,
    access: Access = Requires(scope=None),
    last_event_id: Optional[str] = Header(None, alias="Last-Event-ID"),
    params: Optional[str] = Query(None, description="JSON-encoded view parameters"),
) -> Response:
    """Subscribe to a presence stream via SSE.

    Events are pushed by ctx.send() from background tasks or by StreamWriter
    from route handlers. Pings every 3s keep the connection alive through
    proxies. Connection closes after 30 minutes (client should reconnect
    with Last-Event-ID).
    """
    param_dict = None
    if params:
        try:
            param_dict = json.loads(params)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in params")
    key = stream_key(access.infospace_id, topic, resource_id, param_dict)

    if last_event_id and last_event_id != "0":
        from app.core.stream import _incr
        _incr("stream:reconnects")

    start_id = last_event_id or "$"
    if start_id == "0":
        start_id = "0"

    async def generate():
        hub = get_hub()
        q = await hub.subscribe(key, last_id=start_id)
        loop = asyncio.get_running_loop()
        deadline = loop.time() + MAX_CONNECTION_SECONDS
        try:
            while True:
                remaining = deadline - loop.time()
                if remaining <= 0:
                    yield ServerSentEvent(raw_data="{}", event="deadline")
                    return
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=remaining)
                except asyncio.TimeoutError:
                    return  # deadline reached naturally
                if msg is None:
                    return
                yield ServerSentEvent(
                    raw_data=msg.get("data", "{}"),
                    event=msg.get("type", "message"),
                    id=msg.get("id"),
                )
        except asyncio.CancelledError:
            pass
        finally:
            await hub.unsubscribe(key, q)

    return SSEResponse(generate())
