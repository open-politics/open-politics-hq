"""
Celery app configuration.
"""
import logging
import time

from celery import Celery
from celery.schedules import crontab
from kombu import Queue

from app.core.config import settings

logger = logging.getLogger(__name__)

redis_url = settings.redis_url

# The domain task modules. Importing any of them runs its @task / @enricher
# decorators, which (a) register the Celery task, (b) populate the in-process @task
# registry, and (c) wire its event-bus subscriptions. The worker loads these via
# Celery's ``imports`` below. The web process must load the SAME set at startup
# (``load_task_modules()``) so producer-side ``emit()`` / ``kick_tasks()`` — which
# dispatch via the in-process subscriber/registry — reach their tasks identically
# from API routes and the chat MCP tools.
TASK_MODULES = (
    'app.core.events',
    'app.core.dispatch',
    'app.api.modules.content.enrichers',
    'app.api.modules.content.tasks',
    'app.api.modules.graph.tasks',
    'app.api.modules.annotation.tasks',
    'app.api.modules.flow.tasks',
    'app.api.modules.sharing.tasks',
)


def load_task_modules() -> None:
    """Import every module in ``TASK_MODULES``. Idempotent (import caches)."""
    import importlib

    for module in TASK_MODULES:
        importlib.import_module(module)

celery = Celery(
    "app",
    broker=redis_url,
    backend=redis_url,
)

# Task queue routing: separate queues for concurrency limits and rate limiting
# default: flow execution, source polling, dispatch
# processing: content processing, metadata extraction (CPU-bound)
# llm: language detection, quality scoring, annotation (LLM API rate limits)
# embedding: embed_task, entity similarity (embedding API limits)
# external_api: geocoding, OCR (external API limits)
CELERY_TASK_QUEUES = (
    Queue('default'),
    Queue('processing'),
    Queue('llm'),
    Queue('embedding'),
    Queue('external_api'),
)

celery.conf.update(
    broker_url=redis_url,
    result_backend=redis_url,
    result_expires=86400,  # 24h TTL for task results
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    broker_transport_options={
        'visibility_timeout': 3600,
        'fanout_prefix': True,
        'fanout_patterns': True,
    },
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    enable_utc=True,
    timezone='UTC',
    task_queues=CELERY_TASK_QUEUES,
    task_default_queue='default',
    task_routes={},  # Queue routing handled by @task queue parameter
    task_default_delivery_mode=2,  # persistent
    task_annotations={},
    # Crash resilience: tasks are re-queued if worker dies before ack (OOM, kill, etc.)
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_soft_time_limit=3600,
    task_time_limit=3720,
    imports=TASK_MODULES,
    # All @task schedule params are handled by dispatch_tasks internally.
    beat_schedule={
        'dispatch-tasks': {
            'task': 'dispatch_tasks',
            'schedule': settings.DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS,
        },
        'cleanup-expired-user-backups': {
            'task': 'cleanup_expired_user_backups',
            'schedule': 86400.0,
        },
        'weekly-system-backup': {
            'task': 'backup_all_users',
            'schedule': crontab(day_of_week=0, hour=2, minute=0),
            'kwargs': {'backup_type': 'system', 'admin_user_id': 1},
        },
    }
)

# Fork safety: prefork workers inherit parent's connection pool; dispose in each child
from celery.signals import worker_process_init


@worker_process_init.connect
def reset_db_pool_on_fork(**kwargs):
    from app.core.db import engine

    # close=False is the post-fork variant: "replace the connection pool in a
    # child process without interfering with the connections used by the parent
    # process."
    engine.dispose(close=False)
    logger.info("DB connection pool disposed after worker fork")

    # Report which providers this deployment can actually reach, and which
    # deployment API keys are genuinely shared with users vs BYOK-only.
    try:
        from app.api.modules.foundation_service_providers import probe_providers
        probe_providers()
    except Exception as e:
        logger.warning("Provider probe failed at worker start: %s", e)

    # Fail fast if FragmentCuration schema is mismatched (e.g. old code vs migrated DB)
    try:
        from sqlmodel import Session, select
        from app.api.modules.graph.models import FragmentCuration

        with Session(engine) as session:
            # Explicitly use source_asset_superseded to detect old code (resolved_refs) or missing migration
            session.exec(
                select(FragmentCuration.id).where(FragmentCuration.source_asset_superseded == False).limit(1)
            ).first()
    except Exception as e:
        logger.critical(
            "FragmentCuration schema mismatch: %s. "
            "Ensure migration b3c4d5e6f7g8 is applied and workers run latest code (restart after deploy).",
            e,
        )
        raise

    try:
        from app.core.tasks import get_task_registry
        registry = get_task_registry()
        names = sorted(registry.keys())
        if names:
            logger.info("Registered tasks (%d):\n%s", len(names), "\n".join(f"  - {n}" for n in names))
        else:
            logger.info("Registered tasks: (none)")
    except Exception as e:
        logger.warning("Could not log registered tasks: %s", e)


_task_start_times: dict[str, float] = {}


@celery.on_after_configure.connect
def _setup_task_duration_logging(sender, **kwargs):
    from celery.signals import task_prerun, task_postrun

    @task_prerun.connect
    def _on_prerun(sender, task_id, **kw):
        _task_start_times[task_id] = time.perf_counter()

    @task_postrun.connect
    def _on_postrun(sender, task_id, retval, state, **kw):
        start = _task_start_times.pop(task_id, None)
        if start is not None:
            duration_ms = (time.perf_counter() - start) * 1000
            task_name = getattr(sender, "name", str(sender))
            logger.info(
                "task_duration task=%s task_id=%s duration_ms=%.0f state=%s",
                task_name,
                task_id,
                duration_ms,
                state,
            )


# Alias for imports that use celery_app
celery_app = celery


@celery.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

if __name__ == '__main__':
    celery.start() 