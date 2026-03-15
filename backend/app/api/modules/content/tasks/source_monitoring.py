"""
Source monitoring @task: poll active sources for new content.

Replaces legacy poll_active_sources + execute_source_poll + bulk_poll_sources.
Single @task discovers sources due for polling, executes poll inline.
"""

import logging
from datetime import datetime, timezone

from sqlalchemy import or_, func
from sqlmodel import Session, select

from app.api.modules.content.models import Source, SourceStatus
from app.core.events import emit
from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery

logger = logging.getLogger(__name__)

POLL_CIRCUIT_BREAKER_THRESHOLD = 5


@task("poll_sources",
      check=lambda iid: (
          select(Source.id)
          .where(
              Source.infospace_id == iid,
              Source.is_active == True,
              Source.next_poll_at <= func.now(),
              or_(
                  Source.consecutive_failures.is_(None),
                  Source.consecutive_failures <= POLL_CIRCUIT_BREAKER_THRESHOLD,
              ),
          )
          .order_by(Source.next_poll_at)
      ),
      schedule=300,
      batch=10,
      self_chain=True,
      queue="default",
      timeout=600,
      tags=frozenset({"content", "source"}))
def poll_sources(ctx: TaskContext, source_ids: list[int]):
    """Poll sources that are due. One source per iteration with error isolation."""
    from app.api.modules.content.services.source_service import SourceService

    for source_id in source_ids:
        try:
            async def _poll(sid):
                with ctx.session() as session:
                    source = session.get(Source, sid)
                    if not source or not source.is_active:
                        return None
                    svc = SourceService(session)
                    return await svc.execute_poll(
                        source_id=sid,
                        user_id=source.user_id,
                    )

            result = run_async_in_celery(_poll, source_id)

            if isinstance(result, dict) and result.get("status") == "success":
                emit("source.polled", {
                    "source_id": source_id,
                    "new_asset_ids": result.get("new_asset_ids", []),
                    "infospace_id": ctx.infospace_id,
                })
            ctx.stat("done")

        except Exception as e:
            logger.error("Poll failed for source %d: %s", source_id, e, exc_info=True)
            with ctx.session() as session:
                source = session.get(Source, source_id)
                if source:
                    source.status = SourceStatus.FAILED
                    source.error_message = str(e)[:500]
                    source.consecutive_failures = (source.consecutive_failures or 0) + 1
                    source.last_error_at = datetime.now(timezone.utc)
                    session.add(source)
                    session.commit()
            ctx.item_failed(source_id)
            ctx.stat("failed")
