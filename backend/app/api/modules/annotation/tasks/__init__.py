"""Annotation domain task registration. Imported by celery_app.py."""
from app.api.modules.annotation.tasks import annotate, followup, geocode
