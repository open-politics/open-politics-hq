import os
from celery import Celery
from celery.schedules import crontab # Import crontab

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
        'task': 'app.api.tasks.scheduling.check_recurring_tasks',
        'schedule': 60.0,  # Run every 60 seconds
        # Optionally add args or kwargs if the task needs them
        # 'args': (16, 16),
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
        'app.api.tasks.ingestion',
        'app.api.tasks.classification',
        'app.api.tasks.scheduling',
        'app.api.tasks.recurring_ingestion',
        'app.api.tasks.recurring_classification'
    )
)

if __name__ == '__main__':
    celery.start() 