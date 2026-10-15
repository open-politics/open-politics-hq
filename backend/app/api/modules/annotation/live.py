"""Following a run from a long-lived read — the overview and network streams.

A stream that shows a run re-reads it whenever the run commits, for as long as
the run can still change, and for at most half an hour per connection: a
pooled connection held longer sits *idle in transaction* and blocks every
migration on the tables it touched. Past the cap the client reconnects.
"""
from __future__ import annotations

from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from app.core.stream import bursts, stream_key

__all__ = ["MAX_CONNECTION_SECONDS", "is_open", "changes"]

MAX_CONNECTION_SECONDS = 1800
#: How long to keep listening after the first commit before re-reading. A run
#: commits rows in bursts; one re-read per burst, not one per row.
COALESCE_SECONDS = 1.5
_ACTIVE = {"pending", "running"}
#: Run stream messages after which a run cannot change again.
_TERMINAL = {"completed", "completed_with_errors", "failed"}


def is_open(frame: dict[str, Any]) -> bool:
    """Can the run in this frame (``overview.frame``) still change?"""
    return bool(frame["run"]["live"]) or frame["run"]["status"] in _ACTIVE


async def changes(
    infospace_id: int,
    run_id: int,
    *,
    is_disconnected: Callable[[], Awaitable[bool]],
) -> AsyncIterator[bool]:
    """Once per burst of activity on the run: ``True`` when the burst finished
    it — worth one last read even when no row moved the watermark, because the
    status did. Ends at the connection cap or when the client goes."""
    async for burst in bursts(
        stream_key(infospace_id, "annotation_run", run_id),
        is_disconnected=is_disconnected,
        max_seconds=MAX_CONNECTION_SECONDS, coalesce=COALESCE_SECONDS,
    ):
        yield any(m.get("type") in _TERMINAL for m in burst)
