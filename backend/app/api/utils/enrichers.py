"""
Enricher Registry
=================

Phase 3 enrichment: language detection, quality scoring, OCR (future).
Simple registry of callables — no classes, no hierarchy.
"""

import logging
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Set

from app.models import Asset, AssetKind
from sqlmodel import Session

from .facets import FACET_LANGUAGE, FACET_QUALITY_SCORE, set_facet

logger = logging.getLogger(__name__)


@dataclass
class Enricher:
    """Enricher descriptor: name, target facet, applicable kinds, run function."""

    name: str
    target_facet: str
    applicable_kinds: Set[AssetKind]  # Empty = all kinds with text_content
    run: Callable[["Asset", Session], None]


ENRICHER_REGISTRY: Dict[str, Enricher] = {}


def register_enricher(enricher: Enricher) -> None:
    """Register an enricher by name."""
    ENRICHER_REGISTRY[enricher.name] = enricher


def get_enricher(name: str) -> Optional[Enricher]:
    """Get enricher by name."""
    return ENRICHER_REGISTRY.get(name)


def get_applicable_enrichers(asset: Asset) -> List[Enricher]:
    """Return enrichers that apply to this asset (has text_content)."""
    if not asset.text_content or not asset.text_content.strip():
        return []

    result = []
    for enricher in ENRICHER_REGISTRY.values():
        if not enricher.applicable_kinds or asset.kind in enricher.applicable_kinds:
            result.append(enricher)
    return result


# ─────────────────────────────────────────────────────────────────────────────
# Built-in enrichers
# ─────────────────────────────────────────────────────────────────────────────


def _run_language_detection(asset: Asset, session: Session) -> None:
    """Detect language and write to facets.language."""
    try:
        import langdetect

        text = (asset.text_content or "")[:50000]
        if not text.strip():
            return
        lang = langdetect.detect(text)
        if lang:
            meta = asset.source_metadata or {}
            set_facet(meta, FACET_LANGUAGE, lang)
            asset.source_metadata = meta
    except Exception as e:
        logger.warning(f"Language detection failed for asset {asset.id}: {e}")
        raise


def _run_quality_score(asset: Asset, session: Session) -> None:
    """Compute text quality score (0-1) and write to facets.quality_score."""
    text = (asset.text_content or "").strip()
    if not text:
        return

    # Simple heuristics: length, character diversity, word count, whitespace
    length = len(text)
    if length == 0:
        return

    words = text.split()
    word_count = len(words)
    unique_chars = len(set(text))
    whitespace_ratio = sum(1 for c in text if c.isspace()) / length

    # Score components (each 0-1)
    length_score = min(1.0, length / 500)  # 500+ chars = full score
    diversity_score = min(1.0, unique_chars / 50)  # 50+ unique chars
    word_score = min(1.0, word_count / 100)  # 100+ words
    # Prefer 10-30% whitespace (reasonable for prose)
    ws_ideal = 0.2
    ws_score = 1.0 - abs(whitespace_ratio - ws_ideal) * 5  # Penalize far from ideal
    ws_score = max(0, min(1.0, ws_score))

    score = (length_score * 0.3 + diversity_score * 0.3 + word_score * 0.3 + ws_score * 0.1)
    score = max(0, min(1.0, round(score, 4)))

    meta = asset.source_metadata or {}
    set_facet(meta, FACET_QUALITY_SCORE, score)
    asset.source_metadata = meta


# Register built-in enrichers
register_enricher(
    Enricher(
        name="language_detection",
        target_facet=FACET_LANGUAGE,
        applicable_kinds=set(),
        run=_run_language_detection,
    )
)
register_enricher(
    Enricher(
        name="quality_score",
        target_facet=FACET_QUALITY_SCORE,
        applicable_kinds=set(),
        run=_run_quality_score,
    )
)
