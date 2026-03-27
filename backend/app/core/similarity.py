"""
Cosine-similarity deduplication primitive.

Embeds a list of strings, computes pairwise cosine similarity,
returns pairs above a threshold. Provider-agnostic — takes any
async embed callable. No DB, no sessions, no domain knowledge.

Usage:
    from app.core.similarity import find_duplicates

    pairs = await find_duplicates(
        items=["Angela Merkel", "A. Merkel", "Joe Biden"],
        embed=provider.embed_texts,   # or any async (list[str]) -> list[list[float]]
        threshold=0.85,
    )
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Awaitable, Callable, List

MAX_ITEMS = 500  # O(n²) pairwise — keep bounded


@dataclass(frozen=True, slots=True)
class SimilarPair:
    """Two items whose cosine similarity meets or exceeds the threshold."""
    a_index: int
    b_index: int
    a_item: str
    b_item: str
    similarity: float


def _norm(v: List[float]) -> float:
    return math.sqrt(sum(x * x for x in v))


def cosine(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors. Returns 0.0 for zero-norm vectors."""
    dot = sum(x * y for x, y in zip(a, b))
    na = _norm(a)
    nb = _norm(b)
    if na == 0.0 or nb == 0.0:
        return 0.0
    return dot / (na * nb)


async def find_duplicates(
    items: list[str],
    embed: Callable[[list[str]], Awaitable[list[list[float]]]],
    threshold: float = 0.85,
    max_items: int = MAX_ITEMS,
) -> list[SimilarPair]:
    """
    Embed items, compute pairwise cosine similarity, return pairs above threshold.

    Handles exact (case-insensitive) duplicates without embedding.
    Deduplicates identical strings before calling embed to save tokens.
    Pre-computes norms so each vector is normalized once, not n-1 times.
    Returns pairs sorted by similarity descending.

    Args:
        items: Strings to compare (entity names, labels, whatever).
        embed: Async callable: list[str] -> list[list[float]].
               Works with any EmbeddingProvider.embed_texts.
        threshold: Minimum cosine similarity to report (0.0–1.0).
        max_items: Hard cap on input size. O(n²) pairwise — default 500.

    Raises:
        ValueError: If len(items) exceeds max_items.
    """
    if len(items) > max_items:
        raise ValueError(f"Too many items ({len(items)}); max is {max_items}")
    if len(items) < 2:
        return []

    # ── Exact duplicates (case-insensitive, free) ────────────────────────
    norm_to_indices: dict[str, list[int]] = {}
    for i, item in enumerate(items):
        key = item.strip().lower()
        norm_to_indices.setdefault(key, []).append(i)

    pairs: list[SimilarPair] = []
    for indices in norm_to_indices.values():
        if len(indices) > 1:
            for j in range(1, len(indices)):
                pairs.append(SimilarPair(
                    a_index=indices[0], b_index=indices[j],
                    a_item=items[indices[0]], b_item=items[indices[j]],
                    similarity=1.0,
                ))

    # ── Embedding similarity (one representative per normalized string) ──
    unique_keys = list(norm_to_indices.keys())
    if len(unique_keys) < 2:
        return sorted(pairs, key=lambda p: p.similarity, reverse=True)

    # Use the original-cased representative for embedding (preserves semantics)
    representatives = [items[norm_to_indices[k][0]] for k in unique_keys]
    rep_indices = [norm_to_indices[k][0] for k in unique_keys]

    vectors = await embed(representatives)
    if len(vectors) != len(representatives):
        return sorted(pairs, key=lambda p: p.similarity, reverse=True)

    # Pre-compute norms once (each vector's norm used n-1 times in pairwise)
    norms = [_norm(v) for v in vectors]

    for i in range(len(representatives)):
        if norms[i] == 0.0:
            continue
        for j in range(i + 1, len(representatives)):
            if norms[j] == 0.0:
                continue
            dot = sum(a * b for a, b in zip(vectors[i], vectors[j]))
            sim = dot / (norms[i] * norms[j])
            if sim >= threshold:
                pairs.append(SimilarPair(
                    a_index=rep_indices[i], b_index=rep_indices[j],
                    a_item=items[rep_indices[i]], b_item=items[rep_indices[j]],
                    similarity=round(sim, 4),
                ))

    return sorted(pairs, key=lambda p: p.similarity, reverse=True)
