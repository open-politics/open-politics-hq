"""Graph domain task registration. Imported by celery_app.py."""
from app.api.modules.graph.tasks import curation, maintenance, proposals
