"""
Provider discovery endpoints.

Exposes available models and deployment capabilities to the frontend so it can
populate setup UIs. Discovery is infospace-scoped and gated on the SETUP
capability: browsing providers is a configuration action inside an infospace.
"""

import logging
from typing import Any, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from app.api.dependency_injection import SessionDep, SettingsDep, get_current_user
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.api.modules.foundation_service_providers import (
    list_providers,
    list_models,
    resolve,
    is_capability_available,
    ProviderError,
    CAPABILITIES,
    LLMModelSpec,
    EmbeddingModelSpec,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/providers", tags=["Providers"],
                   dependencies=[Depends(get_current_user)])


@router.get("/{infospace_id}/models")
async def discover_models(
    capability: str = Query(
        ...,
        description="Domain name: 'language', 'embedding', 'ocr', 'geocoding', 'web_search'",
    ),
    provider_key: Optional[str] = Query(
        None,
        description="Restrict to one provider. Required to reach an endpoint's live listing.",
    ),
    runtime_key: Optional[str] = Query(
        None,
        description="Optional BYOK key for the probed provider (setup flow)",
    ),
    access: Access = Requires(Capability.SETUP, scope=None),
    session: SessionDep = None,
) -> Dict[str, Any]:
    """Models available for a domain inside this infospace.

    With ``provider_key``, returns that endpoint's curated models followed by
    whatever it reports live. Without it, enumerates the curated models across
    every provider for the domain — fast, no credentials.

    Declared models are defaults that rank the good ones to the top, never an
    allowlist: a model absent from this listing still resolves and still runs.
    """
    if capability not in CAPABILITIES:
        raise HTTPException(400, f"Unknown capability: {capability}")

    if provider_key:
        try:
            specs = await list_models(
                capability, provider_key,
                infospace_id=access.infospace_id,
                runtime_key=runtime_key,
                session=session,
            )
        except ProviderError as e:
            raise HTTPException(400, str(e))
        return {
            "capability": capability,
            "provider": provider_key,
            "models": [_entry(spec, provider_key) for spec in specs],
            "count": len(specs),
        }

    results = [
        _entry(spec, pk)
        for pk, desc in list_providers(capability)
        for spec in desc.models
    ]
    return {"capability": capability, "models": results, "count": len(results)}


def _entry(spec, provider_key: str) -> Dict[str, Any]:
    """One model, flattened for the wire. Only the fields that domain has."""
    entry: Dict[str, Any] = {"name": spec.name, "provider": provider_key}
    if isinstance(spec, LLMModelSpec):
        entry.update({
            "supports_tools": spec.supports_tools,
            "supports_streaming": spec.supports_streaming,
            "supports_thinking": spec.supports_thinking,
            "supports_multimodal": spec.supports_multimodal,
            "supports_structured_output": spec.supports_structured_output,
            "supports_prompt_caching": spec.supports_prompt_caching,
        })
        if spec.max_tokens is not None:
            entry["max_tokens"] = spec.max_tokens
        if spec.context_length is not None:
            entry["context_length"] = spec.context_length
    elif isinstance(spec, EmbeddingModelSpec):
        entry["dimension"] = spec.dimension
        entry["max_sequence_length"] = spec.max_sequence_length
    if spec.description:
        entry["description"] = spec.description
    return entry


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
    from app.api.modules.foundation_service_providers import EnrichmentConfig

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
        sel = config.provider_for(name) if config else None

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


# ── catalog ───────────────────────────────────────────────────────────────────


class CatalogModel(BaseModel):
    """One model as a picker needs it. Domain-specific fields stay None."""
    name: str
    description: str = ""
    #: "curated" — declared in providers.py. "live" — reported by the endpoint.
    source: str = "curated"
    supports_tools: Optional[bool] = None
    supports_streaming: Optional[bool] = None
    supports_thinking: Optional[bool] = None
    supports_multimodal: Optional[bool] = None
    supports_structured_output: Optional[bool] = None
    supports_prompt_caching: Optional[bool] = None
    max_tokens: Optional[int] = None
    context_length: Optional[int] = None
    dimension: Optional[int] = None
    max_sequence_length: Optional[int] = None


class CatalogProvider(BaseModel):
    """One endpoint serving one domain, as the setup UI needs it."""
    id: str
    name: str
    description: str = ""
    requires_api_key: bool
    api_key_name: Optional[str] = None
    api_key_url: Optional[str] = None
    is_local: bool
    has_env_fallback: bool
    model_required: bool
    #: The wire this endpoint speaks. Two providers sharing one share a wire.
    dialect: str
    features: List[str] = []
    #: Whether this endpoint's model inventory is mutable from here. Derived
    #: from the declaration, so a UI never needs `provider.id === "ollama"`.
    pullable: bool
    models: List[CatalogModel] = []


class CatalogResponse(BaseModel):
    """Every provider, every domain, in one call.

    Keyed by the REAL registered domain names. The previous endpoint keyed off a
    hand-written map that listed five of seven, under a docstring promising every
    one — so `scraping` and `storage` were invisible and the next domain anyone
    registered would have been too.
    """
    domains: Dict[str, List[CatalogProvider]]


def _catalog_model(spec) -> CatalogModel:
    return CatalogModel(
        name=spec.name,
        description=getattr(spec, "description", "") or "",
        supports_tools=getattr(spec, "supports_tools", None),
        supports_streaming=getattr(spec, "supports_streaming", None),
        supports_thinking=getattr(spec, "supports_thinking", None),
        supports_multimodal=getattr(spec, "supports_multimodal", None),
        supports_structured_output=getattr(spec, "supports_structured_output", None),
        supports_prompt_caching=getattr(spec, "supports_prompt_caching", None),
        max_tokens=getattr(spec, "max_tokens", None),
        context_length=getattr(spec, "context_length", None),
        dimension=getattr(spec, "dimension", None),
        max_sequence_length=getattr(spec, "max_sequence_length", None),
    )


@router.get("/{infospace_id}/catalog", response_model=CatalogResponse)
async def provider_catalog(
    access: Access = Requires(Capability.SETUP, scope=None),
    settings: SettingsDep = None,
) -> CatalogResponse:
    """Every provider across every registered domain, with capability flags.

    One call replaces the setup UI's previous three: the unified listing, a
    per-domain model call for capability flags, and string-matching a feature
    name to decide whether a model-management panel should appear.

    Curated models only — fast, no credentials, no network. An endpoint's live
    inventory needs a key, so it stays on ``/{infospace_id}/models``.
    """
    domains: Dict[str, List[CatalogProvider]] = {}

    for domain in sorted(CAPABILITIES):
        entries: List[CatalogProvider] = []
        for provider_key, desc in list_providers(domain):
            endpoint = desc.endpoint
            api_key = endpoint.api_key
            feature_names = sorted(f.name for f in desc.features)
            entries.append(CatalogProvider(
                id=provider_key,
                name=endpoint.name,
                description=endpoint.description,
                requires_api_key=desc.requires_api_key,
                api_key_name=api_key.label if api_key else None,
                api_key_url=api_key.url if api_key else None,
                is_local=desc.is_local,
                has_env_fallback=bool(api_key and api_key.read(settings)),
                model_required=desc.model_required,
                dialect=desc.binding.dialect.name,
                features=feature_names,
                pullable="model_pull" in feature_names,
                models=[_catalog_model(s) for s in desc.models],
            ))
        domains[domain] = entries

    return CatalogResponse(domains=domains)


# ── model management ──────────────────────────────────────────────────────────


class ModelRequest(BaseModel):
    capability: str
    provider_key: str
    model_name: str


class ModelActionResponse(BaseModel):
    message: str


def _manager(capability: str, provider_key: str, model_name: str,
             infospace_id: int, session):
    """Resolve a provider for a model-inventory action.

    The model being pulled is passed as the model to resolve with. Without it an
    endpoint declaring ``model_required`` refuses to construct for the very call
    that installs one — ollama raises "requires a model selection" against a
    model that by definition is not there yet.
    """
    if capability not in CAPABILITIES:
        raise HTTPException(400, f"Unknown capability: {capability}")
    try:
        return resolve(capability, provider_key, model_name,
                       infospace_id=infospace_id, session=session)
    except ProviderError as e:
        raise HTTPException(400, str(e))


@router.post("/{infospace_id}/models/pull", response_model=ModelActionResponse)
async def pull_model(
    body: ModelRequest,
    infospace_id: int,
    access: Access = Requires(Capability.SETUP, scope=None),
    session: SessionDep = None,
) -> ModelActionResponse:
    """Install a model on an endpoint that manages its own inventory.

    Generic over any provider declaring the ``model_pull`` feature. The previous
    route was a hardcoded Ollama URL, which meant the read side could be
    de-branded (``features`` reported ``model_pull`` honestly) while the write
    side could not — a second local endpoint would light up the button and have
    nowhere to send it.
    """
    p = _manager(body.capability, body.provider_key, body.model_name,
                 infospace_id, session)
    if not hasattr(p, "pull_model"):
        raise HTTPException(
            400,
            f"{body.provider_key} does not manage its own models. "
            f"Providers that do declare the 'model_pull' feature.",
        )
    try:
        await p.pull_model(body.model_name)
    except Exception as e:
        logger.error("Pull failed for %s/%s: %s", body.provider_key, body.model_name, e)
        raise HTTPException(502, f"Could not pull {body.model_name}: {e}")
    return ModelActionResponse(message=f"Pulled {body.model_name}")


@router.delete("/{infospace_id}/models/pull", response_model=ModelActionResponse)
async def delete_model(
    body: ModelRequest,
    infospace_id: int,
    access: Access = Requires(Capability.SETUP, scope=None),
    session: SessionDep = None,
) -> ModelActionResponse:
    """Remove a model from an endpoint that manages its own inventory."""
    p = _manager(body.capability, body.provider_key, body.model_name,
                 infospace_id, session)
    if not hasattr(p, "delete_model"):
        raise HTTPException(400, f"{body.provider_key} does not manage its own models.")
    try:
        await p.delete_model(body.model_name)
    except Exception as e:
        logger.error("Delete failed for %s/%s: %s", body.provider_key, body.model_name, e)
        raise HTTPException(502, f"Could not delete {body.model_name}: {e}")
    return ModelActionResponse(message=f"Deleted {body.model_name}")
