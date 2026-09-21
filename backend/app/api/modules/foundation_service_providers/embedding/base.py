"""
embedding/base.py — the EmbeddingProvider protocol.

  texts ──► embed_texts() ──► [[float]], one vector per text, in order
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
