"""
ocr — an image in, text out.

  base.py      OcrProvider
  models.py    OcrResult · OcrQuirks
  provider.py  the Ocr domain
  dialects/    local_engine (tesseract) · vision_prompt (ollama)
"""

from app.api.modules.foundation_service_providers.ocr.base import OcrProvider
from app.api.modules.foundation_service_providers.ocr.models import (
    OcrQuirks, OcrResult,
)
from app.api.modules.foundation_service_providers.ocr.provider import Ocr

# side-effect import: registers the dialects onto the Domain
from app.api.modules.foundation_service_providers.ocr import dialects  # noqa: F401


__all__ = [
    "Ocr",
    "OcrProvider",
    "OcrResult",
    "OcrQuirks",
]
