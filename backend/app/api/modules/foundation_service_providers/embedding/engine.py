"""
embedding/engine.py — the batch loop above a dialect.

  embed_texts ─► truncate to the char budget ─► adapter.embed_batch
              ─► on failure, retry each text alone and keep what survives
"""

from __future__ import annotations

import logging
from typing import List, Optional

logger = logging.getLogger(__name__)


class Batcher:
    """Wraps an embedding dialect adapter with truncation and salvage retry.

    Delegates anything it does not implement to the adapter.
    """

    def __init__(self, adapter, descriptor):
        self.adapter = adapter
        self.descriptor = descriptor

    def __getattr__(self, name):
        return getattr(self.adapter, name)

    # ── budget ───────────────────────────────────────────────────────────────

    async def _max_chars(self, model_name: str) -> Optional[int]:
        """Character budget for this model — live probe, else declared spec, else None."""
        context_length = 0

        # features compose onto the Batcher, not the adapter
        probe = getattr(self, "probe_model", None)
        if probe is not None:
            try:
                context_length = (await probe(model_name)).get("context_length", 0)
            except Exception as e:
                logger.debug("probe_model failed for %s: %s", model_name, e)

        if not context_length:
            spec = self.descriptor.get_model(model_name)
            context_length = getattr(spec, "max_sequence_length", 0) or 0

        if not context_length:
            return None
        return int(context_length * self.adapter.quirks.char_budget_ratio)

    # ── contract ─────────────────────────────────────────────────────────────

    async def embed_texts(self, texts: List[str],
                          model_name: Optional[str] = None) -> List[List[float]]:
        if not texts:
            return []
        if not model_name:
            raise ValueError("model_name is required for embeddings")

        max_chars = await self._max_chars(model_name)
        if max_chars:
            prepared = []
            for t in texts:
                if len(t) > max_chars:
                    logger.debug("Truncating %d chars to %d for %s",
                                 len(t), max_chars, model_name)
                    prepared.append(t[:max_chars])
                else:
                    prepared.append(t)
        else:
            prepared = list(texts)
            logger.debug(
                "No context length known for %s — sending %d text(s) untruncated; "
                "the endpoint may reject or silently truncate them",
                model_name, len(prepared),
            )

        try:
            return await self.adapter.embed_batch(prepared, model_name)
        except Exception as e:
            logger.warning("Batch embed failed for %s (%s) — retrying %d texts individually",
                           model_name, e, len(prepared))

        return await self._embed_individually(prepared, model_name)

    async def _embed_individually(self, prepared: List[str],
                                  model_name: str) -> List[List[float]]:
        """Salvage pass: every text alone, every success kept, raising once at
        the end with the indices that failed."""
        results: List[Optional[List[float]]] = []
        failures: List[str] = []

        for i, t in enumerate(prepared):
            try:
                one = await self.adapter.embed_batch([t], model_name)
                results.append(one[0])
            except Exception as e:
                logger.error("Failed to embed text %d (%d chars) for %s: %s",
                             i, len(t), model_name, e)
                results.append(None)
                failures.append(f"#{i} ({len(t)} chars): {e}")

        if failures:
            raise RuntimeError(
                f"{len(failures)} of {len(prepared)} texts could not be embedded with "
                f"{model_name}; {len(prepared) - len(failures)} succeeded. "
                f"Failures: {'; '.join(failures[:5])}"
                + (f" …and {len(failures) - 5} more" if len(failures) > 5 else "")
            )

        return [r for r in results if r is not None]

    async def embed_single(self, text: str,
                           model_name: Optional[str] = None) -> List[float]:
        vectors = await self.embed_texts([text], model_name)
        if not vectors:
            raise RuntimeError(f"No embedding returned for {model_name}")
        return vectors[0]
