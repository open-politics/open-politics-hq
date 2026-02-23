"""
Tesseract OCR Provider Implementation

Extracts text from images using pytesseract (Tesseract). Used for PDF pages
rendered to image. Industry-standard, CPU-bound, no GPU required.
"""

import asyncio
import io
import logging
from pathlib import Path
from typing import Optional, Union

from app.api.modules.foundation_service_providers.base import OcrProvider, OcrResult

logger = logging.getLogger(__name__)

try:
    import pytesseract
    from PIL import Image
    PYTESSERACT_AVAILABLE = True
except ImportError:
    PYTESSERACT_AVAILABLE = False


class TesseractOcrProvider(OcrProvider):
    """
    Tesseract-based OCR for images. Use with rendered PDF pages.
    """

    def __init__(self, language_hint: str = "eng"):
        if not PYTESSERACT_AVAILABLE:
            raise ImportError(
                "pytesseract and Pillow required. pip install pytesseract pillow"
            )
        self.language_hint = language_hint

    async def extract_text(
        self,
        file_path_or_bytes: Union[Path, bytes],
        language_hint: Optional[str] = None,
    ) -> OcrResult:
        """
        Extract text from an image file or image bytes.
        For PDFs, caller must render the page to image first.
        """
        lang = language_hint or self.language_hint
        # Run sync pytesseract in executor
        def _run():
            if isinstance(file_path_or_bytes, bytes):
                img = Image.open(io.BytesIO(file_path_or_bytes))
            else:
                img = Image.open(file_path_or_bytes)
            text = pytesseract.image_to_string(img, lang=lang)
            # pytesseract doesn't return confidence per-page easily; use 0.8 as default
            return OcrResult(
                text=text.strip() if text else "",
                confidence=0.8,
                engine="tesseract",
                page_count=1,
            )
        return await asyncio.to_thread(_run)
