"""
Flow execution @task functions.

- execute_pending_flows: claim and run PENDING FlowExecutions
- resume_waiting_flows: resume flows waiting on async steps (annotation)
- check_on_arrival_flows: trigger flows with on_arrival mode when new assets arrive
- trigger_source_poll_flows: check STREAM flows when sources are polled
"""

import logging
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.api.modules.flow.models import Flow, FlowExecution, FlowStatus, FlowTriggerMode, FlowInputType
from app.models import AnnotationRun, RunStatus
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


# ── execute_pending_flows ─────────────────────────────────────────────────────

@task("execute_pending_flows",
      check=lambda iid: (
          select(FlowExecution.id)
          .join(Flow, FlowExecution.flow_id == Flow.id)
          .where(
              Flow.infospace_id == iid,
              FlowExecution.status == RunStatus.PENDING,
          )
          .order_by(FlowExecution.created_at)
      ),
      schedule=None,
      triggers=["flow.execute"],
      batch=1,
      self_chain=True,
      queue="default",
      timeout=3600,
      max_concurrency=1,
      tags=frozenset({"flow"}))
def execute_pending_flows(ctx: TaskContext, execution_ids: list[int]):
    """Claim and run PENDING FlowExecutions."""
    from app.api.modules.flow.services.flow_service import FlowService
    from app.core.redis_lock import flow_execution_lock

    for execution_id in execution_ids:
        with ctx.session() as session:
            execution = session.get(FlowExecution, execution_id)
            if not execution or execution.status != RunStatus.PENDING:
                continue
            flow_id = execution.flow_id

        with flow_execution_lock(flow_id) as acquired:
            if not acquired:
                logger.info("Flow %d already executing, will retry later (setting chain_backoff)", flow_id)
                # Throttle self_chain so a live sibling-worker (or stale
                # lock whose TTL hasn't expired) doesn't trigger a tight
                # loop. Mirrors the annotate.py pattern.
                try:
                    from app.core.redis import get_redis
                    r = get_redis()
                    if r:
                        r.set(f"task:execute_pending_flows:{ctx.infospace_id}:chain_backoff", "60", ex=120)
                except Exception:
                    logger.debug("chain_backoff set failed", exc_info=True)
                continue

            try:
                with ctx.session() as session:
                    svc = FlowService(session)
                    svc.run_execution(execution_id)
                ctx.stat("done")

            except Exception as e:
                logger.error("FlowExecution %d failed: %s", execution_id, e, exc_info=True)
                with ctx.session() as session:
                    execution = session.get(FlowExecution, execution_id)
                    if execution:
                        execution.status = RunStatus.FAILED
                        execution.error_message = str(e)[:500]
                        execution.completed_at = datetime.now(timezone.utc)
                        session.add(execution)
                        session.commit()
                ctx.item_failed(execution_id)
                ctx.stat("failed")


# ── resume_waiting_flows ──────────────────────────────────────────────────────

@task("resume_waiting_flows",
      check=lambda iid: (
          select(FlowExecution.id)
          .join(Flow, FlowExecution.flow_id == Flow.id)
          .where(
              Flow.infospace_id == iid,
              FlowExecution.status == RunStatus.WAITING,
          )
      ),
      schedule=None,
      triggers=["annotation_run.completed"],
      batch=1,
      self_chain=True,
      queue="default",
      timeout=3600,
      tags=frozenset({"flow"}))
def resume_waiting_flows(ctx: TaskContext, execution_ids: list[int]):
    """Resume FlowExecutions waiting on completed async steps."""
    from app.api.modules.flow.services.flow_service import FlowService

    for execution_id in execution_ids:
        with ctx.session() as session:
            execution = session.get(FlowExecution, execution_id)
            if not execution or execution.status != RunStatus.WAITING:
                continue

            # Check that the pending annotation run is actually completed
            pending_run_id = (execution.execution_state or {}).get("pending_run_id")
            if pending_run_id:
                run = session.get(AnnotationRun, pending_run_id)
                if run and run.status not in (RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS):
                    continue

            execution.status = RunStatus.RUNNING
            session.add(execution)
            session.commit()

            try:
                svc = FlowService(session)
                svc.run_execution(execution_id)
                ctx.stat("done")
            except Exception as e:
                logger.error("Flow resume failed for execution %d: %s", execution_id, e, exc_info=True)
                ctx.item_failed(execution_id)
                ctx.stat("failed")


# ── check_on_arrival_flows ────────────────────────────────────────────────────

@task("check_on_arrival_flows",
      check=lambda iid: (
          select(Flow.id)
          .where(
              Flow.infospace_id == iid,
              Flow.status == FlowStatus.ACTIVE,
              Flow.trigger_mode == FlowTriggerMode.ON_ARRIVAL,
          )
      ),
      schedule=300,
      batch=10,
      queue="default",
      tags=frozenset({"flow"}))
def check_on_arrival(ctx: TaskContext, flow_ids: list[int]):
    """Check on_arrival flows for new assets and trigger execution."""
    from app.api.modules.flow.services.flow_service import FlowService

    with ctx.session() as session:
        svc = FlowService(session)
        for flow_id in flow_ids:
            try:
                flow = session.get(Flow, flow_id)
                if not flow:
                    continue
                delta_assets = svc._get_delta_assets(flow)
                if delta_assets:
                    svc.trigger_execution(
                        flow_id=flow.id,
                        user_id=flow.user_id,
                        infospace_id=flow.infospace_id,
                        triggered_by="on_arrival",
                    )
                    ctx.stat("done")
            except Exception as e:
                logger.error("On-arrival check failed for flow %d: %s", flow_id, e)
                ctx.stat("failed")


# ── trigger_source_poll_flows ─────────────────────────────────────────────────

@task("trigger_source_poll_flows",
      check=lambda iid: (
          select(Flow.id)
          .where(
              Flow.infospace_id == iid,
              Flow.input_type == FlowInputType.STREAM,
              Flow.status == FlowStatus.ACTIVE,
          )
      ),
      schedule=None,
      triggers=["source.polled"],
      batch=10,
      queue="default",
      tags=frozenset({"flow"}))
def trigger_source_poll_flows(ctx: TaskContext, flow_ids: list[int]):
    """Check active STREAM flows and trigger execution when their source has new content."""
    from app.api.modules.flow.services.flow_service import FlowService

    with ctx.session() as session:
        svc = FlowService(session)
        for flow_id in flow_ids:
            try:
                flow = session.get(Flow, flow_id)
                if not flow or not flow.input_source_id:
                    continue
                delta_assets = svc._get_delta_assets(flow)
                if delta_assets:
                    svc.trigger_execution(
                        flow_id=flow.id,
                        user_id=flow.user_id,
                        infospace_id=flow.infospace_id,
                        triggered_by="source_poll",
                        triggered_by_source_id=flow.input_source_id,
                    )
                    ctx.stat("done")
            except Exception as e:
                logger.error("Failed to trigger Flow %d: %s", flow_id, e)
                ctx.stat("failed")
