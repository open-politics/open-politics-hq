"""
flat.py — the Ollama-shaped embeddings wire.
============================================

  embed_batch(texts, model)
       │
       ▼
  POST {base}/api/embed  {model, input: texts, truncate?}
       │
       ▼
  { embeddings: [ [float, …], … ] }
       │
       └─ positional  ─►  vectors, array order IS the input's order

  quirks read here: server_truncate — char_budget_ratio is spent one
                    level up, in engine.py's truncation budget.

  NOT IN THIS FILE
    ../base.py    the embed_texts()/embed_single() contract one level up.
    ../engine.py  Batcher — where char_budget_ratio is actually spent.

  Nothing to sort by, unlike indexed.py — that is the whole difference
  between the two wires.
"""

from __future__ import annotations

import logging
from typing import List

import httpx

from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)


class FlatEmbedder(Adapter):
    """Ollama-shaped embeddings."""

    timeout = 600.0     # embedding on CPU is slow, and local means no meter running

    async def embed_batch(self, texts: List[str], model_name: str) -> List[List[float]]:
        payload: dict = {"model": model_name, "input": texts}
        if self.quirks.server_truncate:
            payload["truncate"] = True

        try:
            response = await self.client.post(
                self.url(self.descriptor.path), json=payload
            )
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error("Embedding HTTP %s: %s", e.response.status_code, e.response.text[:300])
            raise RuntimeError(f"Embedding failed: {e.response.text[:300]}") from e
        except Exception as e:
            logger.error("Embedding request failed: %s", e)
            raise RuntimeError(f"Embedding failed: {e}") from e

        vectors = data.get("embeddings") or []
        if not vectors:
            logger.error("No embeddings returned for model %s", model_name)
            raise RuntimeError(f"No embeddings returned for {model_name}")

        logger.debug("Generated %d embeddings with %s", len(vectors), model_name)
        return vectors
