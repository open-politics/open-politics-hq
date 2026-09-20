"""
verify.py — is this credential good?
====================================

  verify(model_name=None)
       │
       ├─ no model_name given  ─►  first declared spec (needs *some* model)
       ▼
  embed_texts([" "], model_name)  ─►  vector came back?  ─►  True / False

  Called from the setup flow, right after a user pastes a key —
  the cheapest possible proof it works, before it gets saved.

  NOT IN THIS FILE
    ../provider.py  Embedding.feature("verify", …) — who gets this
                    surface (openai · jina · voyage; ollama has no key).
"""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)

PROVIDES = ("verify",)


async def verify(p, model_name: str | None = None) -> bool:
    """True if the endpoint accepts our credential.

    ``model_name`` defaults to the first declared spec — verification needs
    *some* model and the curated list is exactly the right place to get one.
    """
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
