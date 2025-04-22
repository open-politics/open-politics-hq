import os
from celery import Celery

# Get Redis URL from environment variable, default if not set
redis_url = os.getenv('CELERY_BROKER_URL', 'redis://localhost:6379/0')

# Initialize Celery
celery = Celery(
    __name__,
    broker=redis_url,
    backend=redis_url,
    include=[
        'app.tasks.ingestion', # Add other task modules here as needed
        'app.tasks.classification' # Include the new classification tasks
    ]
)

# Optional Celery configuration
celery.conf.update(
    task_serializer='json',
    accept_content=['json'],  # Ignore other content
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    # Add other configurations as needed
    # Example: task_track_started=True
)

if __name__ == '__main__':
    celery.start() 