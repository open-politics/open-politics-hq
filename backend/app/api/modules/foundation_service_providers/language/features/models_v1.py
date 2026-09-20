"""
models_v1.py — feature: list models from an OpenAI-style endpoint.
==================================================================

  PROVIDES = ("list_models",)

  list_models(p)
    base_url ends in "/v1"?  ──yes──►  {base}/models
                              ──no───►  {base}/v1/models
    {data: [{id, description?}, …]}
      ──►  LLMModelSpec(name=id, …capabilities copied from the DIALECT
           BASELINE — this response gives names only, no capabilities)

  NOT IN THIS FILE
    ../dialects/__init__.py   the baseline capabilities this inherits for
                               any name the declared specs don't curate.
    registry.list_models()    merges this behind the curated, declared
                               specs, so recommended models sort first.

Feature and dialect are independent choices: llama.cpp exposes this
endpoint while speaking the `blocks` wire, proving one doesn't imply
the other.
"""

from __future__ import annotations

import logging
from typing import List

from app.api.modules.foundation_service_providers.language import LLMModelSpec

logger = logging.getLogger(__name__)

PROVIDES = ("list_models",)


async def list_models(p) -> List[LLMModelSpec]:
    """Models the endpoint reports right now."""
    # Derived, not declared — whether the base URL carries /v1 is observable.
    versioned = (p.base_url or "").rstrip("/").endswith("/v1")
    path = "/models" if versioned else "/v1/models"
    try:
        response = await p.client.get(p.url(path))
        response.raise_for_status()
        entries = (response.json() or {}).get("data") or []
    except Exception as e:
        logger.warning("Could not list models from %s: %s", p.provider_key, e)
        return []

    # Unknown here, so inherit the baseline; defaulting False disabled tool features.
    baseline = p.descriptor.binding.dialect.baseline
    specs = [
        LLMModelSpec(
            name=entry["id"],
            description=entry.get("description", "") or "",
            supports_tools=getattr(baseline, "supports_tools", False),
            supports_streaming=getattr(baseline, "supports_streaming", True),
            supports_structured_output=getattr(baseline, "supports_structured_output", False),
            supports_multimodal=getattr(baseline, "supports_multimodal", False),
        )
        for entry in entries if entry.get("id")
    ]
    logger.info("Discovered %d models from %s", len(specs), p.provider_key)
    return specs
