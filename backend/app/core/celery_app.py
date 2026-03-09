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

# Build task annotations for rate limiting (only if configured)
def _process_content_annotations():
    limit = getattr(settings, "PROCESS_CONTENT_RATE_LIMIT", None) or ""
    if limit and limit.strip():
        return {"rate_limit": limit.strip()}
    return {}

redis_url = settings.redis_url

# Initialize Celery with explicit configuration
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

# Celery configuration
celery.conf.update(
    broker_url=redis_url,
    result_backend=redis_url,
    result_expires=86400,  # 24h TTL for task results
    # Connection retry on broker failures
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    # Redis transport options
    broker_transport_options={
        'visibility_timeout': 3600,
        'fanout_prefix': True,
        'fanout_patterns': True,
    },
    # Serialization
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    enable_utc=True,
    timezone='UTC',
    # Queue routing
    task_queues=CELERY_TASK_QUEUES,
    task_default_queue='default',
    task_routes={
        'app.api.modules.annotation.tasks.annotate.process_annotation_run': {'queue': 'llm'},
        'app.api.modules.annotation.tasks.annotate.retry_failed_annotations': {'queue': 'llm'},
        'process_content': {'queue': 'processing'},
        'reprocess_content': {'queue': 'processing'},
        'ingest_bulk_urls': {'queue': 'processing'},
        'ingest_bulk_files': {'queue': 'processing'},
        'batch_process_pending': {'queue': 'processing'},
        'batch_enrich': {'queue': 'processing'},
        'ingest_archive_task': {'queue': 'processing'},
        'import_directory_task': {'queue': 'processing'},
        'enrich_embedding': {'queue': 'embedding'},
        'reactive_curate_annotated': {'queue': 'llm'},
        'enrich_geocoding': {'queue': 'external_api'},
        'enrich_ocr': {'queue': 'external_api'},
        'enrich_file_hash': {'queue': 'processing'},
        'enrich_language': {'queue': 'processing'},
        'enrich_quality_score': {'queue': 'processing'},
        'create_followup_annotation_runs': {'queue': 'llm'},
        're_resolve_entity_singletons': {'queue': 'default'},
        'flag_superseded_entity_sources': {'queue': 'default'},
        'reset_stale_processing_assets': {'queue': 'default'},
    },
    task_default_delivery_mode=2,  # persistent
    task_annotations={
        "process_content": _process_content_annotations(),
    },
    # Crash resilience: tasks are re-queued if worker dies before ack (OOM, kill, etc.)
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    # Task time limits (avoid runaway workers)
    task_soft_time_limit=3600,
    task_time_limit=3720,
    # Task imports - only load when worker starts
    imports=(
        'app.core.events',
        'app.core.dispatch',
        'app.api.modules.content.watchers',
        'app.api.modules.annotation.watchers',
        'app.api.modules.graph.watchers',
        'app.api.modules.annotation.tasks.annotate',
        'app.api.modules.graph.tasks',
        'app.api.modules.content.tasks.ingest',
        'app.api.modules.flow.tasks.schedule',
        'app.api.modules.content.tasks.content_tasks',
        'app.api.modules.content.tasks.ingestion_tasks',
        'app.api.modules.content.tasks.batch_processing',
        'app.api.modules.content.tasks.enrichment',
        'app.api.modules.sharing.tasks.backup',
        'app.api.modules.sharing.tasks.user_backup',
        'app.api.modules.embedding.tasks.embed',
        'app.api.modules.flow.tasks.flow_tasks',
        'app.api.modules.content.tasks.source_monitoring',
        'app.api.modules.content.services.poll_handlers.rss_poll_handler',
        'app.api.modules.content.services.poll_handlers.search_poll_handler',
        'app.api.modules.content.services.poll_handlers.inbox_poll_handler',
    ),
    # Beat schedule
    beat_schedule={
        'check-recurring-tasks-every-5min': {
            'task': 'check_recurring_tasks',
            'schedule': 300.0,
        },
        'check-on-arrival-flows-every-5min': {
            'task': 'app.api.modules.flow.tasks.flow_tasks.check_on_arrival_flows',
            'schedule': 300.0,
        },
        'poll-active-sources-every-5min': {
            'task': 'app.api.modules.content.tasks.source_monitoring.poll_active_sources',
            'schedule': 300.0,
        },
        'dispatch-reactive-work': {
            'task': 'dispatch_reactive_work',
            'schedule': settings.DISPATCH_REACTIVE_WORK_INTERVAL_SECONDS,
        },
        'automatic-backup-all-infospaces': {
            'task': 'automatic_backup_all_infospaces',
            'schedule': 86400.0,
            'kwargs': {'backup_type': 'auto'},
        },
        'cleanup-expired-backups': {
            'task': 'cleanup_expired_backups', 
            'schedule': 43200.0,
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
        'reset-stale-processing-assets-hourly': {
            'task': 'reset_stale_processing_assets',
            'schedule': 3600.0,
        },
    }
)

# Fork safety: prefork workers inherit parent's connection pool; dispose in each child
from celery.signals import worker_process_init


@worker_process_init.connect
def reset_db_pool_on_fork(**kwargs):
    from app.core.db import engine

    engine.dispose()
    logger.info("DB connection pool disposed after worker fork")

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

    # Log enabled reactive watchers (helps verify ENABLED_WATCHERS config)
    try:
        from app.core.dispatch import get_watchers

        watchers = get_watchers()
        names = sorted(w.name for w in watchers)
        if names:
            logger.info("Reactive watchers enabled: %s", ", ".join(names))
        else:
            logger.info("Reactive watchers enabled: (none — set ENABLED_WATCHERS to opt in)")
    except Exception as e:
        logger.warning("Could not log enabled watchers: %s", e)


# Task duration logging for observability
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