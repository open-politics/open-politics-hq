"""
models_ollama.py — feature: list local models with their real capabilities.

  PROVIDES = ("list_models", "model_capabilities")

  model_capabilities(p, name)
    POST /api/show {model}  ──►  {capabilities: [...]}   cached per instance

  list_models(p)
    GET /api/tags  ──►  entries[].name
      │  per entry: model_capabilities(p, name)
      ├─ "embedding" in caps  ──►  skip (that's the embedding picker's model)
      └─ else  ──►  LLMModelSpec(supports_tools="tools" in caps,
                                 supports_multimodal="vision" in caps,
                                 supports_thinking="thinking" in caps, …)
"""

from __future__ import annotations

import logging
from typing import List, Set

from app.api.modules.foundation_service_providers.language import LLMModelSpec

logger = logging.getLogger(__name__)

PROVIDES = ("list_models", "model_capabilities")


async def model_capabilities(p, model_name: str) -> Set[str]:
    """Capability set the endpoint reports for one model. Cached per instance."""
    cache = getattr(p, "_capability_cache", None)
    if cache is None:
        cache = {}
        setattr(p, "_capability_cache", cache)
    if model_name in cache:
        return cache[model_name]

    caps: Set[str] = set()
    try:
        response = await p.client.post(p.url("/api/show"), json={"model": model_name})
        if response.status_code == 200:
            caps = {str(c).lower() for c in ((response.json() or {}).get("capabilities") or [])}
    except Exception as e:
        logger.debug("Could not read capabilities for %s: %s", model_name, e)

    cache[model_name] = caps
    return caps


async def list_models(p) -> List[LLMModelSpec]:
    """Models the endpoint has pulled, with their real capabilities."""
    try:
        response = await p.client.get(p.url("/api/tags"))
        response.raise_for_status()
        entries = (response.json() or {}).get("models") or []
    except Exception as e:
        logger.warning("Could not list models from %s: %s", p.provider_key, e)
        return []

    specs: List[LLMModelSpec] = []
    for entry in entries:
        name = entry.get("name")
        if not name:
            continue
        caps = await model_capabilities(p, name)
        if "embedding" in caps:
            continue                     # belongs to the embedding domain's picker
        specs.append(LLMModelSpec(
            name=name,
            description=f"{name} (local)",
            supports_tools="tools" in caps,
            supports_multimodal="vision" in caps,
            supports_thinking="thinking" in caps,
            supports_streaming=True,
            supports_structured_output=True,     # this wire takes a schema for any model
        ))

    logger.info("Discovered %d local models from %s", len(specs), p.provider_key)
    return specs
