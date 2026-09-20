"""
ocr/dialects — which wires exist.
=================================

  local_engine    a binary on this machine     (tesseract)
  vision_prompt   a multimodal model            (ollama)
"""

from app.api.modules.foundation_service_providers.ocr.provider import Ocr


Ocr.dialect("local_engine", module="local_engine", adapter="LocalEngineOcr")
Ocr.dialect("vision_prompt", module="vision_prompt", adapter="VisionPromptOcr")
