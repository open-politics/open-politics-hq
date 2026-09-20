"""The `live_runs` reconciler — the heartbeat that keeps a live run alive.

A live run reconciles in place: when new content lands in its watched bundle
(subtree), this scheduled @task flips the caught-up run back to PENDING and
re-emits ``annotation_run.created``. ``process_annotation_run``'s streaming
delta then annotates only the new (asset, schema) pairs and the run returns to
COMPLETED ("watching"). Monitoring falls out of this — it isn't a feature.

The check is deliberately coarse (all live, caught-up, bundle-watching runs):
the precise "is there new work in the bundle subtree above my watermark" gate
can't be expressed as one SQL select (the subtree is a recursive CTE and the
watermark is per-run JSON), so the body applies it by reusing the processor's
own ``_delta_query`` — same logic, so the gate and the work can never drift.
Live runs are few, so dispatching the body per cycle is cheap; the body only
re-pends when there is genuinely new content, so an idle bundle stays quiet.

It is also the only thing that can RESUME a stranded run, which is why the
check covers PENDING as well as the terminal states. ``process_annotation_run``
has no schedule — it moves on the ``annotation_run.created`` event and on its
own self-chain — so a run left PENDING by a broken chain is reachable by
nothing. That happens on every worker restart mid-chunk: the task is
redelivered (``task_acks_late``), finds the crashed worker's 30-minute Redis
lock still held, backs off, and after the lock expires nothing asks again. The
run then sits PENDING with live content arriving and no heartbeat, for good.
Re-emitting is idempotent — the streaming delta and the pair-level skip mean a
spurious dispatch is a no-op — so the recovery costs nothing when it is not
needed. ``STRANDED_AFTER`` keeps it from racing a run that is simply working.
"""

import logging
from datetime import datetime, timedelta, timezone

from sqlmodel import select

from app.api.modules.annotation.models import AnnotationRun, RunStatus
from app.core.events import emit
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)

#: How long a PENDING live run may go untouched before it counts as stranded.
#: Comfortably longer than one chunk of LLM calls, so a run that is simply
#: working is never mistaken for one whose chain died.
STRANDED_AFTER = timedelta(minutes=15)

_WATCHED = [RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS, RunStatus.PENDING]


@task("live_runs",
      check=lambda iid: (
          select(AnnotationRun.id)
          .where(
              AnnotationRun.infospace_id == iid,
              AnnotationRun.live == True,
              AnnotationRun.status.in_(_WATCHED),
          )
          .order_by(AnnotationRun.id)
      ),
      schedule=120,
      batch=20,
      tags=frozenset({"annotation"}))
def live_runs(ctx: TaskContext, run_ids: list[int]) -> None:
    """Keep every live run moving: re-pend the caught-up, re-dispatch the stranded.

    Scope-agnostic: the body's ``_delta_query`` resolves whatever the run
    watches (bundle subtree or explicit list). A static list never has new
    work, so it's a cheap no-op; a bundle-watching run picks up new content.
    """
    from app.api.modules.annotation.tasks.annotate import _delta_query, WATERMARK_KEY

    for run_id in run_ids:
        with ctx.session() as session:
            run = session.get(AnnotationRun, run_id)
            if not run or not run.live:
                continue
            if run.status not in _WATCHED:
                continue

            if run.status == RunStatus.PENDING:
                # Already where a caught-up run would be re-pended TO, so the
                # only thing missing is the dispatch. Re-emit if it has gone
                # quiet for long enough that nothing can still be chaining.
                touched = run.updated_at
                if touched is not None and touched.tzinfo is None:
                    touched = touched.replace(tzinfo=timezone.utc)
                if touched is not None and \
                        datetime.now(timezone.utc) - touched < STRANDED_AFTER:
                    continue
                emit("annotation_run.created", {"infospace_id": run.infospace_id})
                logger.warning(
                    "live_runs: re-dispatched stranded run %d (PENDING and untouched "
                    "since %s — its chain died)", run_id, touched)
                ctx.stat("unstranded")
                continue

            watermark = int((run.configuration or {}).get(WATERMARK_KEY, 0) or 0)
            delta = _delta_query(session, run, watermark, limit=1)
            if delta is None or session.exec(delta).first() is None:
                continue  # caught up — nothing new in the subtree above the watermark

            # New content landed. Re-pend; process_annotation_run streams the delta.
            run.status = RunStatus.PENDING
            run.completed_at = None
            run.progress_total = None
            run.progress_current = 0
            run.updated_at = datetime.now(timezone.utc)
            session.add(run)
            session.commit()
            emit("annotation_run.created", {"infospace_id": run.infospace_id})
            logger.info("live_runs: re-pended run %d (new content in watched subtree)", run_id)
            ctx.stat("repended")
