"""
verify.py — credential check: embed one space, see whether a vector comes back.
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

PROVIDES = ("verify",)


async def verify(p, model_name: str | None = None) -> bool:
    """True if the endpoint accepts our credential. ``model_name`` defaults to
    the first declared spec."""
    if model_name is None:
        declared = p.descriptor.models
        if not declared:
            logger.debug("verify: no declared model to probe with")
            return False
        model_name = declared[0].name

    try:
        vectors = await p.embed_texts([" "], model_name)
        return bool(vectors and vectors[0])
    except Exception as e:
        logger.info("verify failed for %s: %s", p.descriptor.provider_key, e)
        return False
