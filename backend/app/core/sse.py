"""
SSEResponse — EventSourceResponse that serializes ServerSentEvent objects.

FastAPI's native SSE pipeline only activates for generator endpoints.
Dual-mode endpoints (JSON or SSE based on Accept header) return the
response explicitly, bypassing that pipeline. This subclass handles
serialization so generators can yield ServerSentEvent objects from
any code path.

    from app.core.sse import SSEResponse

    # Dual-mode: JSON or SSE
    if not wants_sse(request):
        return MyModel(...)  # JSON via response_model

    async def generate():
        yield ServerSentEvent(data=MyModel(...).model_dump_json(), event="results")

    return SSEResponse(generate())

Data handling:
- ServerSentEvent with data=str → used as-is (pre-serialized via .model_dump_json())
- ServerSentEvent with raw_data=str → used as-is (pre-encoded, e.g. from Redis)
- ServerSentEvent with data=Model → calls model.model_dump_json() (Pydantic v2 Rust)
- ServerSentEvent with data=dict → json.dumps fallback
- Plain bytes/str → passed through
- Plain dict → auto-wrapped as SSE data field
"""

import json

from fastapi.sse import EventSourceResponse, ServerSentEvent, format_sse_event


class SSEResponse(EventSourceResponse):
    """EventSourceResponse that serializes ServerSentEvent objects to SSE wire format."""

    def __init__(self, content, **kwargs):
        super().__init__(self._serialize(content), **kwargs)

    @staticmethod
    async def _serialize(agen):
        async for item in agen:
            if isinstance(item, ServerSentEvent):
                data_str = None
                if item.raw_data is not None:
                    data_str = item.raw_data
                elif item.data is not None:
                    d = item.data
                    if hasattr(d, "model_dump_json"):
                        data_str = d.model_dump_json()
                    elif isinstance(d, str):
                        data_str = d
                    else:
                        data_str = json.dumps(d, default=str)
                yield format_sse_event(
                    data_str=data_str, event=item.event,
                    id=item.id, retry=item.retry, comment=item.comment,
                )
            elif isinstance(item, bytes):
                yield item
            elif isinstance(item, str):
                yield item.encode("utf-8")
            else:
                yield format_sse_event(data_str=json.dumps(item, default=str))
