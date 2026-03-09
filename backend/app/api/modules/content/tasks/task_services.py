"""
Task Services Factory
=====================

Centralizes provider + service construction for Celery tasks.
The Celery equivalent of dependency_injection.py for routes.

Every task that needs processing, ingestion, or bundle operations
calls create_task_services(session) and uses the specific service it needs.
"""

from dataclasses import dataclass
import logging

from sqlmodel import Session

from app.core.config import settings
from app.api.modules.foundation_service_providers.base import (
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
)
from app.api.modules.foundation_service_providers.registry import (
    resolve,
    system_default_type_key,
)
from app.api.modules.content.services.asset_service import AssetService
from app.api.modules.content.services.bundle_service import BundleService
from app.api.modules.content.services.processing_service import ProcessingService

logger = logging.getLogger(__name__)


@dataclass
class TaskServices:
    """Bundle of providers and services for Celery task use."""

    session: Session
    storage: StorageProvider
    scraping: ScrapingProvider
    search: WebSearchProvider | None
    asset: AssetService
    bundle: BundleService
    processing: ProcessingService


def create_task_services(session: Session) -> TaskServices:
    """
    Build providers and services for Celery task context.
    Same dependency graph as routes (dependency_injection.py) but for tasks.
    Providers are cached per worker process via task_primitives.
    """
    from app.core.task_primitives import _get_cached_provider
    import app.api.modules.foundation_service_providers.base as base

    def _resolve_system(proto_name, cache_key):
        def factory():
            protocol = getattr(base, proto_name)
            type_key = system_default_type_key(protocol, settings)
            if not type_key:
                raise ValueError(f"No system default for '{proto_name}'")
            provider = resolve(protocol, type_key, settings)
            if not provider:
                raise ValueError(f"Provider '{proto_name}/{type_key}' not available")
            return provider
        return _get_cached_provider(cache_key, factory)

    storage = _resolve_system("StorageProvider", "storage")
    scraping = _resolve_system("ScrapingProvider", "scraping")
    try:
        search = _resolve_system("WebSearchProvider", "web_search")
    except Exception as e:
        logger.warning(f"Search provider init failed: {e}")
        search = None

    asset_svc = AssetService(session, storage)
    bundle_svc = BundleService(session)
    processing = ProcessingService(
        session=session,
        storage_provider=storage,
        scraping_provider=scraping,
        asset_service=asset_svc,
    )

    return TaskServices(
        session=session,
        storage=storage,
        scraping=scraping,
        search=search,
        asset=asset_svc,
        bundle=bundle_svc,
        processing=processing,
    )
