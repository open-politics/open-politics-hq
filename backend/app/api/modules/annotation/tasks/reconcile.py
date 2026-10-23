"""The run reconciler — the heartbeat that keeps every run moving.

``process_annotation_run`` has no schedule: it moves on the
``annotation_run.created`` event and on its own self-chain. Anything that
breaks the chain leaves a run that nothing will ever ask about again, so this
scheduled @task looks at every run that should be moving and does the one thing
each needs (``reconcile``):

    RUNNING, no worker holds it    a worker died mid-batch (its lease lapsed
                                   within SLOT_TTL) → hand back to PENDING
    PENDING, quiet                 its chain died, or its dispatch was lost →
                                   dispatch again
    live, caught up, new content   new material landed in the watched bundle →
                                   re-pend; the streaming delta reads only it

Monitoring falls out of the last line — it isn't a feature. Every re-dispatch
is idempotent (the claim, the streaming delta and the pair-level skip), so one
that was not needed costs a check query.

The same function answers ``POST /runs/{id}/action/continue``, without the
quiet period: someone asked.
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Literal, Optional

from sqlalchemy import and_, or_
from sqlmodel import Session, select

from app.api.modules.annotation.models import AnnotationRun, RunStatus
from app.core.events import emit
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)

#: How long a PENDING run may sit untouched before it is dispatched again. A
#: run that is working is RUNNING, so PENDING only ever waits — for a free slot,
#: or for a dispatch that will never come. Re-asking is harmless in the first
#: case, and the whole cure in the second.
QUIET_AFTER = timedelta(minutes=2)

_CAUGHT_UP = [RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS]

Verdict = Literal["reclaimed", "dispatched", "repended"]


def reconcile(
    session: Session, run: AnnotationRun, *, held: bool, force: bool = False,
) -> Optional[Verdict]:
    """What *run* needs to keep moving, applied to the session (the caller
    commits, then emits ``annotation_run.created`` for any verdict).

    ``held``: a worker holds the run's lease right now. ``force``: skip the
    quiet period. None means the run needs nothing — it is moving, or done.
    """
    from app.api.modules.annotation.tasks.annotate import _delta_query, WATERMARK_KEY

    now = datetime.now(timezone.utc)

    if run.status == RunStatus.RUNNING:
        if held:
            return None
        run.status = RunStatus.PENDING
        run.updated_at = now
        session.add(run)
        return "reclaimed"

    if run.status == RunStatus.PENDING:
        touched = run.updated_at
        if touched is not None and touched.tzinfo is None:
            touched = touched.replace(tzinfo=timezone.utc)
        if not force and touched is not None and now - touched < QUIET_AFTER:
            return None
        return "dispatched"

    if run.live and run.status in _CAUGHT_UP:
        watermark = int((run.configuration or {}).get(WATERMARK_KEY, 0) or 0)
        delta = _delta_query(session, run, watermark, limit=1)
        if delta is None or session.exec(delta).first() is None:
            return None  # caught up — nothing new in the subtree above the watermark
        run.status = RunStatus.PENDING
        run.completed_at = None
        run.progress_total = None
        run.progress_current = 0
        run.updated_at = now
        session.add(run)
        return "repended"

    return None


@task("reconcile_runs",
      check=lambda iid: (
          select(AnnotationRun.id)
          .where(
              AnnotationRun.infospace_id == iid,
              or_(
                  AnnotationRun.status.in_([RunStatus.PENDING, RunStatus.RUNNING]),
                  and_(AnnotationRun.live == True, AnnotationRun.status.in_(_CAUGHT_UP)),  # noqa: E712
              ),
          )
          .order_by(AnnotationRun.id)
      ),
      schedule=120,
      batch=20,
      tags=frozenset({"annotation"}))
def reconcile_runs(ctx: TaskContext, run_ids: list[int]) -> None:
    """Keep every run moving: hand back the orphaned, re-dispatch the quiet,
    re-pend the caught-up live runs that have new content."""
    from app.core.redis_lock import run_is_held

    for run_id in run_ids:
        with ctx.session() as session:
            run = session.get(AnnotationRun, run_id)
            if run is None:
                continue
            verdict = reconcile(session, run, held=run_is_held(run_id))
            if verdict is None:
                continue
            session.commit()
            emit("annotation_run.created", {"infospace_id": run.infospace_id})
            logger.info("reconcile_runs: run %d %s", run_id, verdict)
            ctx.stat(verdict)
