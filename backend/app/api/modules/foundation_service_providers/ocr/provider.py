"""
ocr/provider.py — the Domain itself.
====================================

  base.py     OcrProvider  ─┐
  models.py   OcrQuirks    ─┴──►  Ocr = Domain(…)
                                      │
  dialects/__init__.py  ──►  Ocr.dialect("local_engine") · ("vision_prompt")
  providers.py           ──►  Ocr(dialect=…, quirks=…) per endpoint
"""

from __future__ import annotations

from app.api.modules.foundation_service_providers.primitives import Domain
from app.api.modules.foundation_service_providers.ocr.base import OcrProvider
from app.api.modules.foundation_service_providers.ocr.models import OcrQuirks


Ocr = Domain(
    name="ocr",
    protocol=OcrProvider,
    package="app.api.modules.foundation_service_providers.ocr",
    system_default="OCR_PROVIDER_TYPE",
    quirks_type=OcrQuirks,
)
