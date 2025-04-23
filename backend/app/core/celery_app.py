import os
from celery import Celery
from celery.schedules import crontab # Import crontab

# Get Redis URL from environment variable, default if not set
redis_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')

# Initialize Celery
celery = Celery(
    __name__,
    broker=redis_url,
    backend=redis_url,
    include=[
        'app.tasks.ingestion', # Add other task modules here as needed
        'app.tasks.classification', # Include the new classification tasks
        'app.tasks.scheduling', # Add the new scheduling task module
        'app.tasks.recurring_ingestion', # Add the new recurring ingestion task module
        'app.tasks.recurring_classification' # Add the new recurring classification task module
    ]
)

# Add Celery Beat Schedule
celery.conf.beat_schedule = {
    'check-recurring-tasks-every-minute': {
        'task': 'app.tasks.scheduling.check_recurring_tasks',
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
    # Example: task_track_started=True
)

if __name__ == '__main__':
    celery.start() 