"""
indexed.py — the OpenAI-shaped embeddings wire.

  POST {base}/embeddings ──► {data:[{index, embedding}]}, sorted by index
  quirks: encoding_format · input_type · base_url_is_full_path
"""

from __future__ import annotations

import logging
from typing import List

import httpx

from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)


class IndexedEmbedder(Adapter):
    """OpenAI-shaped embeddings."""

    timeout = 120.0

    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def _endpoint(self) -> str:
        # jina's configured base_url is already the full endpoint path
        if self.quirks.base_url_is_full_path:
            return self.base_url
        return self.url(self.descriptor.path)

    async def embed_batch(self, texts: List[str], model_name: str) -> List[List[float]]:
        if not self.api_key:
            raise ValueError("API key is required for embeddings")

        payload: dict = {"model": model_name, "input": texts}
        if self.quirks.encoding_format:
            payload["encoding_format"] = "float"
        if self.quirks.input_type:
            payload["input_type"] = self.quirks.input_type

        try:
            response = await self.client.post(self._endpoint(), json=payload)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as e:
            logger.error("Embedding HTTP %s: %s", e.response.status_code, e.response.text[:300])
            raise RuntimeError(f"Embedding failed: {e.response.text[:300]}") from e
        except Exception as e:
            logger.error("Embedding request failed: %s", e)
            raise RuntimeError(f"Embedding failed: {e}") from e

        items = data.get("data")
        if not items:
            logger.error("No `data` field in embedding response: %s", str(data)[:300])
            raise RuntimeError("Embedding response contained no data")

        # the wire does not promise request order
        vectors: List[List[float]] = []
        for item in sorted(items, key=lambda x: x.get("index", 0)):
            vector = item.get("embedding")
            if vector is None:
                logger.error("No embedding in response item: %s", str(item)[:200])
                raise RuntimeError("Embedding response item had no vector")
            vectors.append(vector)

        logger.debug("Generated %d embeddings with %s", len(vectors), model_name)
        return vectors
