"""
language/dialects — registers the wires: blocks, turns, items.

  Language.dialect(name, module, adapter, path, quirks_type, baseline)

    blocks   /v1/messages        BlocksQuirks   anthropic · llamacpp
    turns    /chat/completions   TurnsQuirks    mistral   · ollama
    items    /responses          ItemsQuirks    openai

The dialect boundary is the conversation unit and the tool-result carrier;
everything else that differs between endpoints is a quirk on top of one.
"""

from app.api.modules.foundation_service_providers.language.models import LLMModelSpec
from app.api.modules.foundation_service_providers.language.provider import Language
from app.api.modules.foundation_service_providers.language.quirks import BlocksQuirks, ItemsQuirks, TurnsQuirks


Language.dialect("blocks", module="blocks", adapter="BlocksDialect",
                 path="/v1/messages", quirks_type=BlocksQuirks,
                 baseline=LLMModelSpec(
                     name="", supports_tools=True, supports_streaming=True,
                     supports_structured_output=True, supports_multimodal=True))
Language.dialect("turns", module="turns", adapter="TurnsDialect",
                 path="/chat/completions", quirks_type=TurnsQuirks,
                 baseline=LLMModelSpec(
                     name="", supports_tools=True, supports_streaming=True,
                     supports_structured_output=True))
Language.dialect("items", module="items", adapter="ItemsDialect",
                 path="/responses", quirks_type=ItemsQuirks,
                 baseline=LLMModelSpec(
                     name="", supports_tools=True, supports_streaming=True,
                     supports_structured_output=True, supports_multimodal=True))
