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
"""

import logging
from datetime import datetime, timezone

from sqlmodel import select

from app.api.modules.annotation.models import AnnotationRun, RunStatus
from app.core.events import emit
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


@task("live_runs",
      check=lambda iid: (
          select(AnnotationRun.id)
          .where(
              AnnotationRun.infospace_id == iid,
              AnnotationRun.live == True,
              AnnotationRun.status.in_([RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS]),
          )
          .order_by(AnnotationRun.id)
      ),
      schedule=120,
      batch=20,
      tags=frozenset({"annotation"}))
def live_runs(ctx: TaskContext, run_ids: list[int]) -> None:
    """Re-pend each live, caught-up run that has new work in its scope.

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
            if run.status not in (RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS):
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
