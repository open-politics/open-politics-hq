"""
local_engine.py — OCR via Tesseract, on this machine.

  image bytes ──► asyncio.to_thread ──► pytesseract.image_to_string(lang)
"""

from __future__ import annotations

import asyncio
import io
import logging
from pathlib import Path
from typing import Optional, Union

from app.api.modules.foundation_service_providers.ocr import OcrResult
from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)

try:
    import pytesseract
    from PIL import Image
    PYTESSERACT_AVAILABLE = True
except ImportError:                                     # optional dependency
    PYTESSERACT_AVAILABLE = False


class LocalEngineOcr(Adapter):
    """Tesseract via pytesseract.

    Confidence is a flat 0.8 — pytesseract exposes per-word confidences but no
    per-page number.
    """

    def __init__(self, **kw):
        super().__init__(**kw)
        if not PYTESSERACT_AVAILABLE:
            raise ImportError(
                "pytesseract and Pillow required. pip install pytesseract pillow"
            )

    async def extract_text(
        self,
        source: Union[Path, bytes],
        *,
        language_hint: Optional[str] = None,
        model: Optional[str] = None,      # one engine — accepted and ignored
    ) -> OcrResult:
        lang = language_hint or self.quirks.default_language

        def _run() -> OcrResult:
            img = Image.open(io.BytesIO(source)) if isinstance(source, bytes) \
                else Image.open(source)
            text = pytesseract.image_to_string(img, lang=lang)
            return OcrResult(
                text=text.strip() if text else "",
                confidence=0.8,
                engine=f"tesseract:{lang}",
                page_count=1,
            )

        return await asyncio.to_thread(_run)
