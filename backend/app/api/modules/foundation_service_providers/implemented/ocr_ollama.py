"""
Ollama Vision OCR Provider Implementation

Uses Ollama's multimodal models (e.g. llava, bakllava) to extract text from images.
Same base URL and config as LLM provider. For PDF pages, caller renders to image first.
"""

import base64
import logging
from pathlib import Path
from typing import Optional, Union

import httpx

from app.api.modules.foundation_service_providers.base import OcrProvider, OcrResult

logger = logging.getLogger(__name__)

# Prompt optimized for OCR extraction
OCR_PROMPT = "Extract all text from this image. Return only the raw extracted text, preserving line breaks. Do not add any explanation or formatting."


class OllamaOcrProvider(OcrProvider):
    """
    Ollama-based OCR using vision models (llava, bakllava, etc).
    Uses the same OLLAMA_BASE_URL as the LLM provider.
    """

    def __init__(
        self,
        base_url: str = "http://host.docker.internal:11434",
        model: str = "llava",
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.client = httpx.AsyncClient(timeout=120.0)
        logger.info(
            "OllamaOcrProvider initialized: base_url=%s model=%s",
            self.base_url,
            self.model,
        )

    async def extract_text(
        self,
        file_path_or_bytes: Union[Path, bytes],
        language_hint: Optional[str] = None,
    ) -> OcrResult:
        """
        Extract text from an image using Ollama vision API.
        For PDFs, caller must render the page to image first.
        """
        if isinstance(file_path_or_bytes, bytes):
            image_bytes = file_path_or_bytes
        else:
            image_bytes = Path(file_path_or_bytes).read_bytes()

        b64 = base64.b64encode(image_bytes).decode("ascii")

        payload = {
            "model": self.model,
            "stream": False,
            "messages": [
                {
                    "role": "user",
                    "content": OCR_PROMPT,
                    "images": [b64],
                }
            ],
        }

        try:
            response = await self.client.post(
                f"{self.base_url}/api/chat",
                json=payload,
            )
            response.raise_for_status()
            data = response.json()
            content = data.get("message", {}).get("content", "").strip()
            return OcrResult(
                text=content if content else "",
                confidence=0.85,
                engine=f"ollama:{self.model}",
                page_count=1,
            )
        except httpx.HTTPStatusError as e:
            logger.warning(
                "Ollama OCR HTTP error: %s %s",
                e.response.status_code,
                e.response.text[:200],
            )
            return OcrResult(
                text="",
                confidence=0.0,
                engine=f"ollama:{self.model}",
                page_count=1,
            )
        except Exception as e:
            logger.warning("Ollama OCR failed: %s", e, exc_info=True)
            return OcrResult(
                text="",
                confidence=0.0,
                engine=f"ollama:{self.model}",
                page_count=1,
            )
