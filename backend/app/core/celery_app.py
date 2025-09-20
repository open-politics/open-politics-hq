"""
Celery app configuration.
"""
import os
from celery import Celery
from celery.schedules import crontab 
from app.core.config import settings

# Get Redis URL from environment variable, default if not set
redis_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')

# Initialize Celery with minimal configuration 
celery = Celery(
    __name__,
    broker=redis_url,
    backend=redis_url,
)

# We'll set task imports dynamically to avoid circular dependencies
# Tasks register themselves using the @celery.task decorator
# No eager loading of tasks here to avoid issues

# Add Celery Beat Schedule
celery.conf.beat_schedule = {
    'check-recurring-tasks-every-minute': {
        'task': 'app.api.tasks.schedule.check_recurring_tasks',
        'schedule': 60.0,  # Run every 60 seconds
        # Optionally args or kwargs if the task needs them
        # 'args': (16, 16),
    },
    'automatic-backup-all-infospaces': {
        'task': 'automatic_backup_all_infospaces',
        'schedule': 86400.0,  # Run daily (24 hours = 86400 seconds)
        'kwargs': {'backup_type': 'auto'},
    },
    'cleanup-expired-backups': {
        'task': 'cleanup_expired_backups', 
        'schedule': 43200.0,  # Run twice daily (12 hours = 43200 seconds)
    },
    'cleanup-expired-user-backups': {
        'task': 'cleanup_expired_user_backups',
        'schedule': 86400.0,  # Run daily (24 hours = 86400 seconds)
    },
    'weekly-system-backup': {
        'task': 'backup_all_users',
        'schedule': crontab(day_of_week=0, hour=2, minute=0),  # Run Sunday at 2 AM
        'kwargs': {'backup_type': 'system', 'admin_user_id': 1},
    },
    # Add more scheduled tasks here if needed
}
celery.conf.timezone = 'UTC' # Explicitly set timezone

# Optional Celery configuration
celery.conf.update(
    task_serializer='json',
    accept_content=['json'],  # Ignore other content
    result_serializer='json',
    enable_utc=True,
    # Add other configurations as needed
    # Example: task_track_started=True,
    imports=(  # Tasks will only import when a worker starts, not when Celery app is created
        'app.api.tasks.annotate',
        'app.api.tasks.ingest',
        'app.api.tasks.schedule',
        'app.api.tasks.content_tasks',
        'app.api.tasks.backup',
        'app.api.tasks.user_backup',
        'app.api.tasks.monitor_tasks',
        'app.api.tasks.pipeline_tasks',
    )
)

@celery.task(bind=True)
def debug_task(self):
    print(f'Request: {self.request!r}')

if __name__ == '__main__':
    celery.start() 