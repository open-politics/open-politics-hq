"""
ocr/base.py — the OcrProvider protocol.

  image bytes ──► extract_text(language_hint, model) ──► OcrResult
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

        ``language_hint`` is an engine language code (``"eng"``, ``"deu"``);
        ``model`` is passed through for dialects that have one.
        """
        ...
