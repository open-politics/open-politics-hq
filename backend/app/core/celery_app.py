"""
Celery app configuration.
"""
import os
import logging
from celery import Celery
from celery.schedules import crontab
from kombu import Queue

from app.core.config import settings

logger = logging.getLogger(__name__)

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
        'embed_asset': {'queue': 'embedding'},
        'embed_infospace': {'queue': 'embedding'},
        'embed_batch_assets': {'queue': 'embedding'},
        'reactive_embed_pending_assets': {'queue': 'embedding'},
        'reactive_curate_annotated': {'queue': 'llm'},
        'enrich_geocoding': {'queue': 'external_api'},
    },
    task_default_delivery_mode=2,  # persistent
    # Task time limits (avoid runaway workers)
    task_soft_time_limit=3600,
    task_time_limit=3720,
    # Task imports - only load when worker starts
    imports=(
        'app.core.dispatch',
        'app.api.modules.content.watchers',
        'app.api.modules.annotation.watchers',
        'app.api.modules.annotation.tasks.annotate',
        'app.api.modules.graph.tasks',
        'app.api.modules.content.tasks.ingest',
        'app.api.modules.flow.tasks.schedule',
        'app.api.modules.content.tasks.content_tasks',
        'app.api.modules.content.tasks.dataset_tasks',
        'app.api.modules.content.tasks.batch_processing',
        'app.api.modules.content.tasks.enrichment',
        'app.api.modules.sharing.tasks.backup',
        'app.api.modules.sharing.tasks.user_backup',
        'app.api.modules.embedding.tasks.embed',
        'app.api.modules.flow.tasks.flow_tasks',
        'app.api.modules.content.tasks.source_monitoring',
    ),
    # Beat schedule
    beat_schedule={
        'check-recurring-tasks-every-minute': {
            'task': 'app.api.modules.flow.tasks.schedule.check_recurring_tasks',
            'schedule': 60.0,
        },
        'check-on-arrival-flows-every-minute': {
            'task': 'app.api.modules.flow.tasks.flow_tasks.check_on_arrival_flows',
            'schedule': 60.0,
        },
        'poll-active-sources-every-minute': {
            'task': 'app.api.modules.content.tasks.source_monitoring.poll_active_sources',
            'schedule': 60.0,
        },
        'dispatch-reactive-work-every-minute': {
            'task': 'dispatch_reactive_work',
            'schedule': 60.0,
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
    }
)


# Alias for imports that use celery_app
celery_app = celery


@celery.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

if __name__ == '__main__':
    celery.start() 