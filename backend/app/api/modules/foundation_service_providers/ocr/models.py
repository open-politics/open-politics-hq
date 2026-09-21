"""
ocr/models.py — OcrResult · OcrQuirks.
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
    """Endpoint deviations within an OCR dialect."""
    #: engine language code when the caller passes none. (tesseract.)
    default_language: str = "eng"
    #: seconds to wait on the model. (vision_prompt/ollama.)
    timeout: float = 120.0
