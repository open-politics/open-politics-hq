"""
Recurring task scheduler @task.

Checks user-created Task records with cron schedules and dispatches
the appropriate work when due.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from croniter import croniter
from sqlmodel import Session, select

from app.core.tasks import TaskContext, task
from app.models import Task, TaskType, TaskStatus

logger = logging.getLogger(__name__)


def _is_task_due(t: Task, now: datetime) -> bool:
    """Check if task is due based on its cron schedule and last_run_at."""
    if not t.schedule or not t.schedule.strip():
        return False
    if t.last_run_at is None:
        return True
    try:
        base_time = t.last_run_at
        if base_time.tzinfo is None:
            base_time = base_time.replace(tzinfo=timezone.utc)
        cron = croniter(t.schedule.strip(), base_time)
        next_run = cron.get_next(datetime)
        if next_run.tzinfo is None:
            next_run = next_run.replace(tzinfo=timezone.utc)
        return next_run <= now
    except (ValueError, KeyError) as e:
        logger.warning("Invalid cron expression for task %d: %r: %s", t.id, t.schedule, e)
        return False


def _update_task_status(session: Session, task_id: int, status: str, message: Optional[str] = None):
    """Update task status and message."""
    t = session.get(Task, task_id)
    if not t:
        return
    t.last_run_status = status
    t.last_run_message = message
    t.last_run_at = datetime.now(timezone.utc)
    if status == "success":
        t.last_successful_run_at = t.last_run_at
        t.consecutive_failure_count = 0
    elif status == "error":
        t.consecutive_failure_count = (t.consecutive_failure_count or 0) + 1
    session.add(t)
    session.commit()


@task("check_recurring_tasks",
      check=lambda iid: (
          select(Task.id)
          .where(
              Task.infospace_id == iid,
              Task.status == TaskStatus.ACTIVE,
              Task.is_enabled == True,
          )
      ),
      schedule=300,
      batch=50,
      queue="default",
      tags=frozenset({"flow"}))
def check_recurring(ctx: TaskContext, task_ids: list[int]):
    """Check which scheduled tasks are due and dispatch them."""
    from app.core.events import emit

    now = datetime.now(timezone.utc)

    with ctx.session() as session:
        for task_id in task_ids:
            t = session.get(Task, task_id)
            if not t or not _is_task_due(t, now):
                continue

            try:
                if t.type == TaskType.INGEST:
                    _dispatch_ingest_task(session, t)
                elif t.type == TaskType.ANNOTATE:
                    _dispatch_annotate_task(session, t)
                elif t.type == TaskType.FLOW:
                    _dispatch_flow_task(session, t, emit)
                elif t.type == TaskType.SOURCE_POLL:
                    _dispatch_source_poll_task(session, t)
                elif t.type == TaskType.EMBED:
                    _dispatch_embed_task(session, t)
                elif t.type in (TaskType.MONITOR, TaskType.PIPELINE):
                    logger.warning("Task %d uses deprecated %s type. Migrate to FLOW.", t.id, t.type)
                else:
                    logger.warning("Unknown task type %r for task %d", t.type, t.id)

                ctx.stat("done")
            except Exception as e:
                logger.error("Failed to dispatch task %d: %s", t.id, e, exc_info=True)
                _update_task_status(session, t.id, "error", f"Dispatch failed: {str(e)}")
                ctx.stat("failed")


def _dispatch_ingest_task(session: Session, t: Task):
    """Dispatch an INGEST task via @task direct invocation."""
    target_source_id = t.configuration.get("target_source_id")
    if not target_source_id:
        _update_task_status(session, t.id, "error", "Missing target_source_id in configuration")
        return

    from app.api.modules.content.models import Source, SourceStatus
    source = session.get(Source, target_source_id)
    if not source:
        _update_task_status(session, t.id, "error", f"Source {target_source_id} not found")
        return

    # Store user override in source.details
    source.details = {**(source.details or {}), "user_id": t.user_id}
    source.status = SourceStatus.PENDING
    session.add(source)
    session.commit()

    from app.api.modules.content.tasks.ingest import process_source
    process_source.delay([target_source_id], t.infospace_id)
    _update_task_status(session, t.id, "running", "Dispatched to process_source")


def _dispatch_flow_task(session: Session, t: Task, emit_fn):
    """Dispatch a FLOW task by creating a FlowExecution and emitting event."""
    from app.api.modules.flow.services.flow_service import FlowService

    flow_id = t.configuration.get("flow_id") or t.configuration.get("target_id")
    if not flow_id:
        _update_task_status(session, t.id, "error", "Missing flow_id in configuration")
        return

    from app.api.modules.flow.models import Flow
    flow = session.get(Flow, flow_id)
    if not flow:
        _update_task_status(session, t.id, "error", "Flow not found")
        return

    svc = FlowService(session)
    execution = svc.trigger_execution(
        flow_id=flow_id,
        user_id=flow.user_id,
        infospace_id=flow.infospace_id,
        triggered_by="task",
        triggered_by_task_id=t.id,
    )
    _update_task_status(session, t.id, "running", f"Triggered execution {execution.id}")


def _dispatch_source_poll_task(session: Session, t: Task):
    """Dispatch a SOURCE_POLL task via @task direct invocation."""
    source_id = t.configuration.get("source_id") or t.configuration.get("target_source_id")
    if not source_id:
        _update_task_status(session, t.id, "error", "Missing source_id in configuration")
        return
    from app.api.modules.content.tasks.source_monitoring import poll_sources
    poll_sources.delay([source_id], t.infospace_id)
    _update_task_status(session, t.id, "running", "Dispatched to poll_sources")


def _dispatch_embed_task(session: Session, t: Task):
    """Dispatch an EMBED task to the @enricher system."""
    from app.api.modules.content.models import Asset
    from app.api.modules.content.enrichers import retry_enrichment

    infospace_id = t.configuration.get("infospace_id") or t.infospace_id
    if not infospace_id:
        _update_task_status(session, t.id, "error", "Missing infospace_id")
        return

    overwrite = t.configuration.get("overwrite", False)

    asset_ids = list(session.exec(
        select(Asset.id).where(
            Asset.infospace_id == infospace_id,
            Asset.text_content.isnot(None),
            Asset.parent_asset_id.is_(None),
        )
    ).all())

    if overwrite and asset_ids:
        from sqlalchemy import delete as sa_delete
        from app.api.modules.content.models import AssetChunk
        session.execute(sa_delete(AssetChunk).where(AssetChunk.asset_id.in_(asset_ids)))
        for aid in asset_ids:
            retry_enrichment(session, aid, "embedding")
        session.commit()

    batch_size = 20
    from app.api.modules.content.enrichers import enrich_embedding
    for i in range(0, len(asset_ids), batch_size):
        batch = asset_ids[i : i + batch_size]
        enrich_embedding.delay(batch, infospace_id)
    _update_task_status(session, t.id, "running", f"Dispatched {len(asset_ids)} assets")


def _dispatch_annotate_task(session: Session, t: Task):
    """Dispatch an ANNOTATE task by creating an AnnotationRun."""
    from app.api.modules.annotation.services.annotation_service import AnnotationService
    from app.api.modules.content.services.asset_service import AssetService
    from app.schemas import AnnotationRunCreate

    asset_service = AssetService(session)
    annotation_service = AnnotationService(session=session, asset_service=asset_service)

    run_config = t.configuration or {}

    create_run_payload = AnnotationRunCreate(
        name=f"Scheduled: {t.name} - {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        schema_ids=run_config.get("schema_ids", []),
        target_asset_ids=run_config.get("target_asset_ids"),
        target_bundle_id=run_config.get("target_bundle_id"),
        configuration=run_config.get("run_specific_config", {}),
        include_parent_context=run_config.get("include_parent_context", False),
        context_window=run_config.get("context_window", 0),
    )

    if not create_run_payload.schema_ids:
        _update_task_status(session, t.id, "error", "Missing schema_ids in configuration")
        return

    new_run = annotation_service.create_run(
        user_id=t.user_id,
        infospace_id=t.infospace_id,
        run_in=create_run_payload,
    )
    _update_task_status(session, t.id, "running", f"Created annotation run {new_run.id}")
