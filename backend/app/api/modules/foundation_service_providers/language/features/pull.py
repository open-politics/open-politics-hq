"""
pull.py — feature: pull or delete a model on the endpoint itself.
=================================================================

  PROVIDES = ("pull_model", "delete_model")

  pull_model(p, name)     POST /api/pull {name}      timeout: PULL_TIMEOUT
  delete_model(p, name)   DELETE /api/delete {name}

  both: raise RuntimeError(...) on failure — the bool return is never
        actually False, only True or an exception

  NOT IN THIS FILE
    ProviderHub.tsx (frontend)   should gate its model-management panel
                                 on `hasattr(p, "pull_model")`, not on
                                 `provider.id === 'ollama'`.

Only meaningful where the model inventory is mutable: an operator can pull
a model onto their own machine, nobody pulls one onto someone else's API.
PULL_TIMEOUT is generous (an hour) because a multi-gigabyte download over
a slow link legitimately takes a while.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

PROVIDES = ("pull_model", "delete_model")

#: Pulling a multi-gigabyte model over a slow link legitimately takes a while.
PULL_TIMEOUT = 3600.0


async def pull_model(p, model_name: str) -> bool:
    """Download a model onto the endpoint. Blocks until it finishes."""
    try:
        response = await p.client.post(
            p.url("/api/pull"), json={"name": model_name}, timeout=PULL_TIMEOUT
        )
        response.raise_for_status()
        logger.info("Pulled %s onto %s", model_name, p.provider_key)
        return True
    except Exception as e:
        logger.error("Failed to pull %s onto %s: %s", model_name, p.provider_key, e)
        raise RuntimeError(f"Could not pull {model_name}: {e}") from e


async def delete_model(p, model_name: str) -> bool:
    """Remove a model from the endpoint, reclaiming its disk."""
    try:
        response = await p.client.request(
            "DELETE", p.url("/api/delete"), json={"name": model_name}
        )
        response.raise_for_status()
        logger.info("Deleted %s from %s", model_name, p.provider_key)
        return True
    except Exception as e:
        logger.error("Failed to delete %s from %s: %s", model_name, p.provider_key, e)
        raise RuntimeError(f"Could not delete {model_name}: {e}") from e
