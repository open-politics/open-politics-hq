"""
Provider discovery endpoints.

Exposes available models and deployment capabilities to the frontend so it can
populate setup UIs. Discovery is infospace-scoped and gated on the SETUP
capability: browsing providers is a configuration action inside an infospace.
"""

import logging
from typing import Any, Dict, Optional

from fastapi import APIRouter, HTTPException, Query

from app.api.dependency_injection import SessionDep, SettingsDep
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.api.modules.foundation_service_providers import (
    list_providers,
    is_capability_available,
    resolve,
    ProviderError,
    CAPABILITIES,
)
from app.api.modules.foundation_service_providers.base import (
    LLMModelSpec,
    EmbeddingModelSpec,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/providers", tags=["Providers"])


@router.get("/{infospace_id}/models")
async def discover_models(
    capability: str = Query(
        ...,
        description="Capability name: 'language', 'embedding', 'ocr', 'geocoding', 'web_search'",
    ),
    provider_key: Optional[str] = Query(
        None,
        description="Optional: probe a specific provider's runtime models (requires credentials)",
    ),
    runtime_key: Optional[str] = Query(
        None,
        description="Optional BYOK key for the probed provider (setup flow)",
    ),
    access: Access = Requires(Capability.SETUP, scope=None),
    session: SessionDep = None,
) -> Dict[str, Any]:
    """
    Discover models for a capability inside this infospace.

    Default behavior: enumerate statically-declared models across all providers
    for the capability (fast, no credentials needed).

    When ``provider_key`` is supplied, resolve that specific provider in the
    infospace context and call its ``.discover_models()`` API — used by setup
    flows where the user has just saved a key and wants to see real models.
    """
    if capability not in CAPABILITIES:
        raise HTTPException(400, f"Unknown capability: {capability}")

    if provider_key:
        try:
            p = resolve(
                capability, provider_key, "probe",
                infospace_id=access.infospace_id,
                runtime_key=runtime_key,
                session=session,
            )
        except ProviderError as e:
            # Static probe also valid — we tried dynamic, fall back to descriptor models.
            logger.info("Dynamic probe failed: %s — falling back to static models", e)
            p = None

        if p is not None and hasattr(p._instance, "discover_models"):
            try:
                raw = await p.discover_models()
                return {
                    "capability": capability,
                    "provider": provider_key,
                    "models": [
                        {"name": getattr(m, "name", m), "provider": provider_key}
                        for m in raw
                    ],
                    "count": len(raw),
                    "source": "runtime",
                }
            except Exception as e:
                logger.warning("Runtime discovery failed for %s/%s: %s", capability, provider_key, e)

    # Static enumeration — no credentials needed, just descriptor specs.
    results = []
    for pk, desc in list_providers(capability):
        if provider_key and pk != provider_key.lower():
            continue
        for spec in desc.models:
            entry: Dict[str, Any] = {"name": spec.name, "provider": pk}
            if isinstance(spec, LLMModelSpec):
                entry.update({
                    "supports_tools": spec.supports_tools,
                    "supports_streaming": spec.supports_streaming,
                    "supports_thinking": spec.supports_thinking,
                    "supports_multimodal": spec.supports_multimodal,
                    "supports_structured_output": spec.supports_structured_output,
                })
                if spec.max_tokens:
                    entry["max_tokens"] = spec.max_tokens
                if spec.context_length:
                    entry["context_length"] = spec.context_length
            elif isinstance(spec, EmbeddingModelSpec):
                entry["dimension"] = spec.dimension
                entry["max_sequence_length"] = spec.max_sequence_length
            if spec.description:
                entry["description"] = spec.description
            results.append(entry)

    return {
        "capability": capability,
        "models": results,
        "count": len(results),
        "source": "static",
    }


@router.get("/capabilities")
async def system_capabilities(
    settings: SettingsDep = None,
) -> Dict[str, Any]:
    """Return what capabilities this deployment provides.

    Deployment-level info — no infospace context needed. Used by the frontend
    to show/hide UI elements based on what the operator has configured.
    """
    return {
        "capabilities": {
            name: {"available": is_capability_available(name, settings)}
            for name in CAPABILITIES
        }
    }


@router.get("/enrichment/status")
async def enrichment_status(
    settings: SettingsDep = None,
) -> Dict[str, Any]:
    """
    Deployment-level status of registered enrichment tasks.

    Aggregates stats across all infospaces. Per-infospace status (with
    structural-block reasons and enricher-enabled state) lives at
    ``/infospaces/{infospace_id}/enrichment/status`` and is the endpoint
    the enrichment-config UI should read.
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


@router.get("/{infospace_id}/enrichment/status")
async def infospace_enrichment_status(
    access: Access = Requires(scope=None),
) -> Dict[str, Any]:
    """
    Per-infospace enrichment status — the source of truth for the setup UI.

    For each registered enricher, returns:
      - ``enabled``: whether this infospace's enrichment_config opts into it
      - ``capability``: the provider capability it needs (may be None)
      - ``selection``: explicit provider/model from enrichment_config, if any
      - ``block``: structural-block reason if a previous run hit ProviderError,
                   else null. When set, dispatch is skipping this enricher
                   until the user fixes their setup (config save clears it).
      - ``stats``: done / failed / skipped counters and last_run timestamp
                   for this specific infospace
    """
    from app.core.tasks import get_task_registry, list_structural_blocks
    from app.api.modules.foundation_service_providers.base import EnrichmentConfig

    iid = access.infospace_id
    config = access.infospace.enrichment_config
    if isinstance(config, dict):
        config = EnrichmentConfig(**config)

    blocks = list_structural_blocks(iid)  # {task_name: reason}

    registry = get_task_registry()
    entries = []
    for name, desc in sorted(registry.items()):
        # Only surface enrichment-tagged tasks; plain @tasks live elsewhere in the UI.
        if "enrichment" not in desc.tags:
            continue

        enabled = bool(config and config.is_enabled(name)) if config else False
        sel = config.get_selection(name) if config else None

        entry = {
            "name": name,
            "capability": desc.capability,
            "enabled": enabled,
            "selection": sel.model_dump() if sel else None,
            "block": blocks.get(name),
        }

        try:
            from app.core.redis import get_redis
            r = get_redis()
            stats = r.hgetall(f"task:{name}:{iid}:stats") or {}
            entry["stats"] = {
                "done": int(stats.get("done", 0)),
                "failed": int(stats.get("failed", 0)),
                "skipped": int(stats.get("skipped", 0)),
                "last_run": stats.get("last_run"),
                "last_duration_ms": int(stats.get("last_duration_ms", 0)) or None,
            }
        except Exception:
            entry["stats"] = None

        entries.append(entry)

    return {
        "infospace_id": iid,
        "enrichers": entries,
        "blocked_count": sum(1 for e in entries if e["block"]),
    }
