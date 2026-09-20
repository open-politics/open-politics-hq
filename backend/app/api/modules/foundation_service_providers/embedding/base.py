"""
embedding/base.py — the contract.
=================================

  texts  ──►  embed_texts()  ──►  [[float]]   one vector per text, in order

  indexed   {data:[{index,embedding}]}    openai · voyage · jina
  flat      {embeddings:[[…]]}            ollama

  NOT IN THIS FILE
    models.py  EmbeddingQuirks — the deviations a dialect reads.
    dialects/  embed_batch() — one level below this Protocol; called
               only by the Batcher, never directly by a caller.
    engine.py  Batcher — truncation budget, retry-alone-on-failure.
"""

from __future__ import annotations
from typing import List, Optional, Protocol, runtime_checkable


@runtime_checkable
class EmbeddingProvider(Protocol):
    """Generate embeddings."""

    async def embed_texts(self, texts: List[str],
                          model_name: Optional[str] = None) -> List[List[float]]:
        """Embed a batch. Order of the result matches order of the input."""
        ...

    async def embed_single(self, text: str,
                           model_name: Optional[str] = None) -> List[float]:
        """Embed one text."""
        ...
