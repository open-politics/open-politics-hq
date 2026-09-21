"""
vision_prompt.py — OCR by asking a vision model to transcribe.

  image bytes ──► base64 ──► POST {base}/api/chat ──► message.content
"""

from __future__ import annotations

import base64
import logging
from pathlib import Path
from typing import Optional, Union

import httpx

from app.api.modules.foundation_service_providers.ocr import OcrResult
from app.api.modules.foundation_service_providers.base import Adapter

logger = logging.getLogger(__name__)

PROMPT = (
    "Extract all text from this image. Return only the raw extracted text, "
    "preserving line breaks. Do not add any explanation or formatting."
)


class VisionPromptOcr(Adapter):
    """A vision model asked to transcribe.

    A bad response or an exception yields empty text rather than raising.
    """

    def __init__(self, model: str = "llava", **kw):
        super().__init__(**kw)
        self.default_model = model
        self.timeout = self.quirks.timeout

    async def extract_text(
        self,
        source: Union[Path, bytes],
        *,
        language_hint: Optional[str] = None,
        model: Optional[str] = None,
    ) -> OcrResult:
        chosen = model or self.default_model
        image_bytes = source if isinstance(source, bytes) else Path(source).read_bytes()

        prompt = PROMPT
        if language_hint:
            prompt = f"{PROMPT} The text is primarily in {language_hint}."

        payload = {
            "model": chosen,
            "stream": False,
            "messages": [{
                "role": "user",
                "content": prompt,
                "images": [base64.b64encode(image_bytes).decode("ascii")],
            }],
        }

        try:
            response = await self.client.post(self.url("/api/chat"), json=payload)
            response.raise_for_status()
            content = (response.json().get("message") or {}).get("content", "").strip()
            return OcrResult(
                text=content,
                confidence=0.85,
                engine=f"vision:{chosen}",
                page_count=1,
            )
        except httpx.HTTPStatusError as e:
            logger.warning("Vision OCR HTTP %s: %s", e.response.status_code, e.response.text[:200])
        except Exception as e:
            logger.warning("Vision OCR failed: %s", e, exc_info=True)

        return OcrResult(text="", confidence=0.0, engine=f"vision:{chosen}", page_count=1)
