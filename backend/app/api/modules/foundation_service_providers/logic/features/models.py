"""
models.py — feature: report the checkpoint a System One endpoint has loaded.

  PROVIDES = ("list_models",)

  list_models(p)
    GET {base}/v1/models
      {models: [{id, run, base, temperature}]}   kev
      {data:   [{id, …}]}                        an OpenAI-shaped server
        ──►  [ModelSpec(name=run or id, description="loaded checkpoint")]

Listing here is a read, never a choice. A decision server loads one checkpoint
at startup and has no endpoint to load another, so which one it is comes from
HQ.yml (`foundation.providers.kev.run`) and a restart. This feature exists so a
setup UI shows what is actually answering instead of offering a menu the server
would ignore — the same bargain llama.cpp's model listing makes.
"""

from __future__ import annotations

import logging
from typing import List

from app.api.modules.foundation_service_providers.models import ModelSpec

logger = logging.getLogger(__name__)

PROVIDES = ("list_models",)


async def list_models(p) -> List[ModelSpec]:
    """The checkpoint this endpoint is serving right now, or nothing."""
    try:
        response = await p.client.get(p.url("/v1/models"))
        response.raise_for_status()
        body = response.json() or {}
    except Exception as e:
        # A server still downloading weights is the common case here, and it is
        # not an error worth failing a settings page over.
        logger.warning("Could not list models from %s: %s", p.provider_key, e)
        return []

    listed = body.get("models") or body.get("data") or []
    specs: List[ModelSpec] = []
    for entry in listed:
        # `run` names the checkpoint that answers; `id` is an alias like
        # "kev-latest", which tells a reader nothing they could trace back.
        name = entry.get("run") or entry.get("id")
        if not name:
            continue
        temperature = entry.get("temperature")
        detail = "loaded checkpoint"
        if entry.get("base"):
            detail += f" · {entry['base']}"
        if temperature:
            detail += f" · calibrated at T={temperature}"
        specs.append(ModelSpec(name=name, description=detail))
    return specs
