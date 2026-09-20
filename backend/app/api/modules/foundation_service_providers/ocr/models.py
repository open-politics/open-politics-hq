"""
ocr/models.py — this domain's data models.
==========================================

  OcrResult   text · confidence · engine · page_count
  OcrQuirks   endpoint deviations within a dialect
"""

from __future__ import annotations
from dataclasses import dataclass


@dataclass(frozen=True)
class OcrResult:
    """What an OCR pass produced."""
    text: str
    confidence: float
    engine: str
    page_count: int = 1


@dataclass(frozen=True)
class OcrQuirks:
    """Endpoint deviations within an OCR dialect.

    Every field names the endpoint that forced it, so the graduation review in
    ``MAP.md`` can actually be done.
    """
    #: Engine language when a caller passes none. (tesseract — once unreachable.)
    default_language: str = "eng"
    #: Seconds to wait. (vision_prompt/ollama — CPU multimodal beats no OCR binary.)
    timeout: float = 120.0
