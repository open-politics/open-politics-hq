"""
Celery app configuration.
"""
import os
import logging
from celery import Celery
from celery.schedules import crontab 
from app.core.config import settings

# Setup logging to debug Redis connection issues
logger = logging.getLogger(__name__)

# Get Redis URL from settings (uses computed property)
redis_url = settings.redis_url

# Initialize Celery with explicit configuration to avoid parsing issues
celery = Celery(
    __name__,
    broker=redis_url,
    backend=redis_url,
)

# Consolidated Celery configuration
celery.conf.update(
    # Broker and backend URLs - set multiple times to ensure they stick
    broker_url=redis_url,
    result_backend=redis_url,
    # Connection retry configuration
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
    # Task imports - only load when worker starts
    imports=(
        'app.api.tasks.annotate',
        'app.api.tasks.ingest',
        'app.api.tasks.schedule',
        'app.api.tasks.content_tasks',
        'app.api.tasks.backup',
        'app.api.tasks.user_backup',
        'app.api.tasks.monitor_tasks',
        'app.api.tasks.pipeline_tasks',
        'app.api.tasks.embed',
    ),
    # Beat schedule
    beat_schedule={
        'check-recurring-tasks-every-minute': {
            'task': 'app.api.tasks.schedule.check_recurring_tasks',
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


@celery.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

if __name__ == '__main__':
    celery.start() 