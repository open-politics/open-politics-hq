"""
SSEResponse — EventSourceResponse that serializes ServerSentEvent objects.

FastAPI's native SSE pipeline only activates for generator endpoints.
Dual-mode endpoints (JSON or SSE based on Accept header) return the
response explicitly, bypassing that pipeline.
"""

import json
import logging
from typing import Any, AsyncIterator, TypeVar

from fastapi.sse import EventSourceResponse, ServerSentEvent, format_sse_event

logger = logging.getLogger(__name__)

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
    is skipped.
    """

    # Imported inside to dodge circular imports (content.schemas imports from
    # graph.schemas).
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
                if primary is None:
                    primary = ev.section
                else:
                    primary.items = list(primary.items) + list(ev.section.items)
                    primary.has_more = ev.section.has_more
                    primary.cursor_next = ev.section.cursor_next
            elif ev.role == "grouped":
                grouped.append(ev.section)
        elif isinstance(ev, NavEvent):
            nav = ev.nav
        elif isinstance(ev, CountEvent):
            # A deferred count resolves the pending total of the section carrying
            # this at_parent (None for root/flat, the parent node id for a child
            # level). An unmatched count means emitter and drain disagree on identity.
            target = (
                primary if (primary is not None and primary.at_parent == ev.at_parent)
                else next((s for s in grouped if s.at_parent == ev.at_parent), None)
            )
            if target is not None:
                target.total = ev.total
                target.has_more = bool(target.cursor_next)
            else:
                logger.warning("drain: CountEvent(at_parent=%r) matched no section", ev.at_parent)
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
            raise ValueError("tree drained without a primary section")
        if nav is None:
            raise ValueError("tree drained without a nav event")
        return AssetTree(
            nav=nav,
            section=primary,
            meta=meta if isinstance(meta, AssetTreeMeta) else None,
        )  # type: ignore[return-value]

    if envelope_type is AssetSearch:
        from app.api.modules.content.schemas import AssetSearchMeta
        if primary is None:
            raise ValueError("flat drained without a primary section")
        return AssetSearch(
            primary=primary,
            grouped=grouped,
            meta=meta if isinstance(meta, AssetSearchMeta) else AssetSearchMeta(query="", mode="text"),
        )  # type: ignore[return-value]

    if envelope_type is AssetFeed:
        if primary is None:
            raise ValueError("flat drained without a primary section")
        return AssetFeed(section=primary, meta=None)  # type: ignore[return-value]

    # Annotation-domain envelopes — caller passes the concrete envelope class.
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
