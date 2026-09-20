"""
props.py — feature: ask llama-server about its own launch config.
=================================================================

  PROVIDES = ("server_props", "server_context_length")

  server_props(p)                cached on p._props_cache — needs a
    GET /props ──► {...}         restart to change, so one read per
                                  process is enough

  server_context_length(p)
    server_props(p) ──► first present, positive int of:
      n_ctx │ default_generation_settings.n_ctx │ n_ctx_train
    none present ──► None

  NOT IN THIS FILE
    ../quirks.py   `fixed_context` said the same thing this feature now
                   answers directly; graduated here 2026-09-17, deleted.

n_ctx is a launch flag, not a model property: the same GGUF loaded twice
with different flags reports two different context lengths, so only the
running server can say — nothing declared ahead of time can know it.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

PROVIDES = ("server_props", "server_context_length")


async def server_props(p) -> Dict[str, Any]:
    """Raw server properties. Cached — this cannot change without a restart."""
    cached = getattr(p, "_props_cache", None)
    if cached is not None:
        return cached

    props: Dict[str, Any] = {}
    try:
        response = await p.client.get(p.url("/props"))
        response.raise_for_status()
        props = response.json() or {}
    except Exception as e:
        logger.debug("Could not read /props from %s: %s", p.provider_key, e)

    setattr(p, "_props_cache", props)
    return props


async def server_context_length(p) -> Optional[int]:
    """The context window this server was launched with, if it will say."""
    props = await server_props(p)
    for key in ("n_ctx", "default_generation_settings.n_ctx", "n_ctx_train"):
        node: Any = props
        for part in key.split("."):
            node = node.get(part) if isinstance(node, dict) else None
        if isinstance(node, int) and node > 0:
            return node
    return None
