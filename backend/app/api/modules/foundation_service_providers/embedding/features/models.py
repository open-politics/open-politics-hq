"""
embedding/features/models.py — list_models, from the endpoint itself.
=====================================================================

  GET /api/tags  ──►  every pulled model (generative AND embedding)
                    │
                    ▼  for each: probe_model(name)
             not is_embedding  ─►  dropped (most pulled models are)
                 is_embedding  ─►  EmbeddingModelSpec(dim, max_seq_len)

  registry.list_models()  merges this OVER the curated declared specs,
                          so a picker ranks recommended models first.

  NOT IN THIS FILE
    probe.py     probe_model — the per-model metadata this feature calls.
    provider.py  Embedding.feature("list_models", module="models") —
                 the registration binding this name to the surface.
"""

from __future__ import annotations

import logging
from typing import List

from app.api.modules.foundation_service_providers.embedding import EmbeddingModelSpec

logger = logging.getLogger(__name__)

PROVIDES = ("list_models",)


async def list_models(p) -> List[EmbeddingModelSpec]:
    """Embedding models the endpoint reports right now.

    Non-embedding models are filtered out: ``/api/tags`` lists every pulled
    model, most of which are generative, and offering those in an embedding
    picker produces a confusing failure later rather than an honest absence now.
    """
    try:
        response = await p.client.get(p.url("/api/tags"))
        response.raise_for_status()
        entries = (response.json() or {}).get("models") or []
    except Exception as e:
        logger.warning("Could not list embedding models: %s", e)
        return []

    probe = getattr(p, "probe_model", None)
    specs: List[EmbeddingModelSpec] = []

    for entry in entries:
        name = entry.get("name")
        if not name:
            continue
        if probe is None:
            specs.append(EmbeddingModelSpec(name=name))
            continue
        try:
            info = await probe(name)
        except Exception:
            continue
        if not info.get("is_embedding"):
            continue
        specs.append(EmbeddingModelSpec(
            name=name,
            description=info.get("description", ""),
            dimension=info.get("dimension", 0),
            max_sequence_length=info.get("context_length", 0),
        ))

    logger.info("Discovered %d embedding models", len(specs))
    return specs
