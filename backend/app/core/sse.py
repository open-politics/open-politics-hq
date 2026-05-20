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

drain(events, envelope_type): single source of truth for render → envelope
collapse. Used by every ``collect_X`` to mirror its ``render_X`` sibling.
"""

import json
from typing import Any, AsyncIterator, TypeVar

from fastapi.sse import EventSourceResponse, ServerSentEvent, format_sse_event

T = TypeVar("T")


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


async def drain(events: AsyncIterator[Any], envelope_type: type[T]) -> T:
    """Drain a render generator into its envelope.

    Consumes a ``StreamEvent`` async iterator and folds the events into the
    target envelope type (``AssetTree`` / ``AssetSearch`` / ``AssetFeed`` or
    an annotation-domain envelope). Any event that doesn't fit the envelope
    is skipped. Raises ``StopAsyncIteration`` if the stream never yielded a
    usable event.

    Used by every ``collect_X`` so the blocking and streaming paths share one
    implementation.
    """

    # Imported inside to dodge circular imports (content.schemas imports from
    # graph.schemas, and we don't want sse.py pulling content.schemas at
    # load time).
    from app.api.modules.content.schemas import (
        AggregateSectionEvent,
        AssetFeed,
        AssetSearch,
        AssetTree,
        AssetTreeMeta,
        CountEvent,
        DoneEvent,
        GraphChunkEvent,
        GraphSectionEvent,
        NavEvent,
        SectionEvent,
    )

    primary = None
    grouped: list = []
    nav = None
    meta = None
    aggregate = None
    graph_blocking = None
    graph_chunks: list[GraphChunkEvent] = []

    async for ev in events:
        if isinstance(ev, SectionEvent):
            if ev.role in ("primary", "level"):
                primary = ev.section
            elif ev.role == "grouped":
                grouped.append(ev.section)
        elif isinstance(ev, NavEvent):
            nav = ev.nav
        elif isinstance(ev, CountEvent):
            if ev.at_parent is None:
                if primary is not None:
                    primary.total = ev.total
                    primary.has_more = bool(primary.cursor_next)
            else:
                for section in grouped:
                    if section.at_parent == ev.at_parent:
                        section.total = ev.total
                        section.has_more = bool(section.cursor_next)
                        break
        elif isinstance(ev, AggregateSectionEvent):
            aggregate = ev
        elif isinstance(ev, GraphSectionEvent):
            graph_blocking = ev
        elif isinstance(ev, GraphChunkEvent):
            graph_chunks.append(ev)
        elif isinstance(ev, DoneEvent):
            break
        # SkeletonEvent / ErrorEvent are informational for the drain.

    if envelope_type is AssetTree:
        if primary is None:
            raise ValueError("render_tree drained without a primary section")
        if nav is None:
            raise ValueError("render_tree drained without a nav event")
        return AssetTree(
            nav=nav,
            section=primary,
            meta=meta if isinstance(meta, AssetTreeMeta) else None,
        )  # type: ignore[return-value]

    if envelope_type is AssetSearch:
        from app.api.modules.content.schemas import AssetSearchMeta
        if primary is None:
            raise ValueError("render_search drained without a primary section")
        return AssetSearch(
            primary=primary,
            grouped=grouped,
            meta=meta if isinstance(meta, AssetSearchMeta) else AssetSearchMeta(query="", mode="text"),
        )  # type: ignore[return-value]

    if envelope_type is AssetFeed:
        if primary is None:
            raise ValueError("render_feed drained without a primary section")
        return AssetFeed(section=primary, meta=None)  # type: ignore[return-value]

    # Annotation-domain envelopes — caller passes the concrete envelope class.
    # By convention: primary → items page, aggregate/graph → dedicated fields.
    # collect_* in annotation/views.py uses these returns directly.
    result: dict[str, Any] = {}
    if primary is not None:
        result["primary"] = primary
    if aggregate is not None:
        result["aggregate"] = aggregate
    if graph_blocking is not None:
        result["graph"] = graph_blocking
    if graph_chunks:
        result["graph_chunks"] = graph_chunks
    return envelope_type(**result)  # type: ignore[return-value]
