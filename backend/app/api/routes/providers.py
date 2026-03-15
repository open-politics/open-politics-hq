"""
Provider discovery endpoints.

Exposes available models and system capabilities to the frontend so it can
populate model selection dropdowns and conditionally show/hide UI features.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, Query

from app.api.dependency_injection import (
    CurrentUser,
    OptionalUser,
    SessionDep,
    SettingsDep,
)
from app.api.modules.foundation_service_providers.registry import (
    discover_models as _discover_models,
    is_capability_available,
    load_credentials,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/providers", tags=["Providers"])


@router.get("/models")
async def discover_models(
    capability: str = Query(
        ...,
        description="Capability type: 'llm', 'embedding'",
        examples=["llm", "embedding"],
    ),
    current_user: OptionalUser = None,
    session: SessionDep = None,
    settings: SettingsDep = None,
) -> Dict[str, Any]:
    """
    Discover available models for a given capability.

    Returns combined list of models from all available providers
    (system + user-keyed). Frontend uses this for model selection dropdowns
    in annotation, embedding, OCR config.
    """
    from app.api.modules.foundation_service_providers.base import (
        LanguageModelProvider,
        EmbeddingProvider,
    )

    _CAPABILITY_MAP = {
        "llm": LanguageModelProvider,
        "embedding": EmbeddingProvider,
    }

    protocol = _CAPABILITY_MAP.get(capability)
    if not protocol:
        return {"error": f"Unknown capability: {capability}", "models": []}

    credentials = {}
    if current_user:
        credentials = load_credentials(session, current_user.id)

    models = _discover_models(protocol, settings, credentials)

    return {
        "capability": capability,
        "models": models,
        "count": len(models),
    }


@router.get("/capabilities")
async def system_capabilities(
    settings: SettingsDep = None,
) -> Dict[str, Any]:
    """
    Return what capabilities this deployment provides.

    Frontend uses this to show/hide UI elements based on what's available
    (e.g., hide OCR settings if no OCR provider, hide embedding if not configured).
    """
    from app.api.modules.foundation_service_providers.base import (
        StorageProvider,
        EmbeddingProvider,
        OcrProvider,
        LanguageModelProvider,
        GeocodingProvider,
        WebSearchProvider,
        ScrapingProvider,
    )

    protocols = {
        "storage": StorageProvider,
        "embedding": EmbeddingProvider,
        "ocr": OcrProvider,
        "llm": LanguageModelProvider,
        "geocoding": GeocodingProvider,
        "web_search": WebSearchProvider,
        "scraping": ScrapingProvider,
    }

    capabilities = {}
    for name, protocol in protocols.items():
        available = is_capability_available(protocol, settings)
        capabilities[name] = {
            "available": available,
        }

    return {"capabilities": capabilities}


@router.get("/enrichment/status")
async def enrichment_status(
    settings: SettingsDep = None,
) -> Dict[str, Any]:
    """
    Return status of registered enrichment tasks.

    Shows active tasks, done/failed/skipped counts from Redis stats.
    """
    from app.core.tasks import get_task_registry

    registry = get_task_registry()
    tasks_info = []

    for name, descriptor in sorted(registry.items()):
        info: Dict[str, Any] = {
            "name": name,
            "queue": descriptor.queue,
            "batch": descriptor.batch,
            "tags": list(descriptor.tags),
            "depends_on": descriptor.depends_on,
            "capability": descriptor.capability,
        }
        # Try to get stats from Redis
        try:
            from app.core.redis import get_redis
            r = get_redis()
            # Aggregate across all infospaces (just show total)
            keys = r.keys(f"task:{name}:*:stats")
            total_done = total_failed = total_skipped = 0
            last_run = None
            for key in keys:
                stats = r.hgetall(key)
                total_done += int(stats.get("done", 0))
                total_failed += int(stats.get("failed", 0))
                total_skipped += int(stats.get("skipped", 0))
                lr = stats.get("last_run")
                if lr and (last_run is None or lr > last_run):
                    last_run = lr
            info["stats"] = {
                "done": total_done,
                "failed": total_failed,
                "skipped": total_skipped,
                "last_run": last_run,
            }
        except Exception:
            info["stats"] = None

        tasks_info.append(info)

    return {"tasks": tasks_info, "count": len(tasks_info)}
