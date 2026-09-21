"""
probe.py — per-model metadata from ollama's /api/show, cached per model name.
"""

from __future__ import annotations

import logging
import re
from typing import Any, Dict

logger = logging.getLogger(__name__)

PROVIDES = ("probe_model",)


async def probe_model(p, model_name: str) -> Dict[str, Any]:
    """Model metadata from the endpoint, cached per model for the instance's life.

    Always returns ``dimension`` and ``context_length``; either may be ``0``.
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

            # model_info keys are architecture-prefixed: "bert.context_length"
            arch = (model_info.get("general.architecture") or "").lower()

            ctx = model_info.get(f"{arch}.context_length", 0) if arch else 0
            if not ctx:
                # older builds only expose it in the parameters blob
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

    if not info["dimension"]:
        try:
            test = await p.embed_batch([" "], model_name)
            info["dimension"] = len(test[0])
        except Exception as e:
            logger.debug("Could not probe %s dimension by test embed: %s", model_name, e)

    cache[model_name] = info
    return info
