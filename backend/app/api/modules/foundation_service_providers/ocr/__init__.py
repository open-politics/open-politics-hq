"""
ocr — an image in, text out.
============================

  base.py      the contract         OcrProvider
  models.py    the data             OcrResult · OcrQuirks
  provider.py  the Domain           Ocr
  dialects/    the wires            local_engine · vision_prompt
"""

from app.api.modules.foundation_service_providers.ocr.base import OcrProvider
from app.api.modules.foundation_service_providers.ocr.models import (
    OcrQuirks, OcrResult,
)
from app.api.modules.foundation_service_providers.ocr.provider import Ocr

# Registers the dialects. Must follow the Domain it registers onto.
from app.api.modules.foundation_service_providers.ocr import dialects  # noqa: F401


__all__ = [
    "Ocr",
    "OcrProvider",
    "OcrResult",
    "OcrQuirks",
]
