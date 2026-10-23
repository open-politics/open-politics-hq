"""
Exclusive holds across workers on one named thing — an annotation run, a flow
execution.

Both are ``lease``s (``core.tasks``): held by the slot heartbeat, so a worker
that dies frees its hold within ``SLOT_TTL``. They used to be fixed 30-minute
locks, which a killed process held for the full half hour — long enough for the
redelivered task to find it taken, back off, and leave the run sitting.
"""

from contextlib import AbstractContextManager

from app.core.redis import get_redis
from app.core.tasks import lease


def run_lease_key(run_id: int) -> str:
    return f"annotation_run:{run_id}"


def annotation_run_lock(run_id: int) -> AbstractContextManager[bool]:
    """Hold an annotation run for one batch. Yields whether we got it."""
    return lease(get_redis(), run_lease_key(run_id))


def flow_execution_lock(flow_id: int) -> AbstractContextManager[bool]:
    """Hold a flow execution while it steps. Yields whether we got it."""
    return lease(get_redis(), f"flow_exec:{flow_id}")


def run_is_held(run_id: int) -> bool:
    """Is a worker holding this run right now? True when Redis cannot say, so
    nothing takes a run back from a worker it simply could not see."""
    try:
        return bool(get_redis().exists(run_lease_key(run_id)))
    except Exception:
        return True
