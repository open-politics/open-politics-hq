"""
ocr/base.py — the contract.
===========================

  image bytes  ──►  extract_text()  ──►  OcrResult
                          │                  │
                    language_hint · model    text · confidence
                    (both per call)          engine · page_count

  local_engine   a binary on this machine     (tesseract)
  vision_prompt  a multimodal model           (ollama)

Both params were once unreachable: language_hint was hardcoded to English;
model was required by model_required then silently discarded.
"""

from __future__ import annotations
from pathlib import Path
from typing import Optional, Protocol, Union, runtime_checkable


@runtime_checkable
class OcrProvider(Protocol):
    """Extract text from image content or an image-only PDF page."""

    async def extract_text(
        self,
        source: Union[Path, bytes],
        *,
        language_hint: Optional[str] = None,
        model: Optional[str] = None,
    ) -> OcrResult:
        """Extract text from an image or a rendered PDF page.

        ``language_hint`` is an engine language code (``"eng"``, ``"deu"``).
        Both adapters default it from the declaration rather than hardcoding —
        before the rewrite, Tesseract's ``language_hint`` was a constructor
        parameter that nothing ever supplied, so every document in the system
        was OCR'd as English regardless of its actual language.

        ``model`` lets a caller pass the resolved model through for dialects
        that have one (``vision_prompt``). It used to be demanded by
        ``model_required`` and then silently discarded, because the adapter read
        its model from an env var and ``extract_text`` had no way to receive one.
        """
        ...
