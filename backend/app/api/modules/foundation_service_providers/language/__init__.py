"""
language — messages in, a streamed reply out.

  models.py      the data       Turn · Reply · Delta · GenerationResponse …
  base.py        the contracts  LanguageModelProvider · LanguageDialect
  quirks.py      the deviations scoped per dialect
  provider.py    the Domain     Language = Domain(name="language", …)
  transforms.py  shared shaping used by every dialect
  engine.py      the turn loop built on those contracts
       │
       ▼
  dialects/  ──►  blocks · turns · items
  features/  ──►  six optional surfaces
"""

from app.api.modules.foundation_service_providers.language.models import (
    ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, Delta, GenerationOptions,
    GenerationResponse, LLMModelSpec, Reply, ToolCall, ToolChoice, ToolDef,
    ToolExecutor, ToolOutcome, Turn,
)
from app.api.modules.foundation_service_providers.language.base import LanguageDialect, LanguageModelProvider
from app.api.modules.foundation_service_providers.language.quirks import (
    BlocksQuirks, ItemsQuirks, LanguageQuirks, TurnsQuirks,
)
from app.api.modules.foundation_service_providers.language.provider import Language

# Register the wires and surfaces. Must follow the Domain they attach to.
from app.api.modules.foundation_service_providers.language import dialects, features  # noqa: F401


__all__ = [
    "Language", "LanguageModelProvider", "LanguageDialect",
    "LanguageQuirks", "BlocksQuirks", "TurnsQuirks", "ItemsQuirks",
    "LLMModelSpec", "GenerationResponse", "GenerationOptions",
    "Turn", "Reply", "Delta", "ToolDef", "ToolCall", "ToolOutcome",
    "ToolChoice", "ToolExecutor", "ALLOWED_IMAGE_TYPES", "MAX_IMAGE_BYTES",
]
