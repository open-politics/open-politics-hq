"""
probe.py — live model metadata, since nothing here is declared.
===============================================================

  probe_model(model_name)
       │
       ├─1─ POST /api/show
       │       model_info["{arch}.context_length"]   ─►  context_length
       │         │  missing ─►  "num_ctx <n>" in the parameters blob
       │       model_info["{arch}.embedding_length"]  ─►  dimension
       │       details.family/format/modelfile        ─►  is_embedding?
       │
       └─2─ dimension still 0  ─►  embed_batch([" "], name), measure it

  Cached on the instance per model name — one probe per model, ever.

  NOT IN THIS FILE
    models.py         list_models — the caller that filters on is_embedding.
    models_ollama.py  language's take on the same endpoint — same GET
                      /api/show, a different question (flags, not dimension).

  Was a private `_probe_model` that `modules/embedding/embed.py` reached
  anyway via `hasattr(instance._instance, "_probe_model")`; that call
  site now reads `hasattr(p, "probe_model")`.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)

PROVIDES = ("probe_model",)


async def probe_model(p, model_name: str) -> Dict[str, Any]:
    """Model metadata from the endpoint. Cached per model for the instance's life.

    Always returns a dict with ``dimension`` and ``context_length``; either may
    be ``0`` when the endpoint would not say.
    """
    cache = getattr(p, "_probe_cache", None)
    if cache is None:
        cache = {}
        setattr(p, "_probe_cache", cache)
    if model_name in cache:
        return cache[model_name]

    info: Dict[str, Any] = {
        "name": model_name,
        "dimension": 0,
        "context_length": 0,
        "description": "",
        "is_embedding": False,
    }

    try:
        response = await p.client.post(p.url("/api/show"), json={"model": model_name})
        if response.status_code == 200:
            data = response.json() or {}
            model_info = data.get("model_info") or {}

            # Keys are prefixed with the architecture: "bert.context_length".
            arch = (model_info.get("general.architecture") or "").lower()

            ctx = model_info.get(f"{arch}.context_length", 0) if arch else 0
            if not ctx:
                # Older builds only expose it in the parameters blob.
                match = re.search(r"num_ctx\s+(\d+)", data.get("parameters", "") or "")
                if match:
                    ctx = int(match.group(1))
            info["context_length"] = ctx

            info["dimension"] = model_info.get(f"{arch}.embedding_length", 0) if arch else 0

            details = data.get("details") or {}
            info["is_embedding"] = (
                "embed" in (details.get("family", "") or "").lower()
                or "embed" in (details.get("format", "") or "").lower()
                or "embedding" in (data.get("modelfile", "") or "").lower()
                or bool(details.get("is_embedding", False))
            )
            info["description"] = f"{model_name} ({info['dimension']}d, ctx={ctx})"
    except Exception as e:
        logger.debug("Could not probe %s metadata: %s", model_name, e)

    # Last resort for dimension: embed a space and measure the result.
    if not info["dimension"]:
        try:
            test = await p.embed_batch([" "], model_name)
            info["dimension"] = len(test[0])
        except Exception as e:
            logger.debug("Could not probe %s dimension by test embed: %s", model_name, e)

    cache[model_name] = info
    return info
