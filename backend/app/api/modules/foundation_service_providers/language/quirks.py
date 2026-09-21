"""
quirks.py — where an endpoint deviates inside its dialect.

  LanguageQuirks          read by every dialect
  ├── BlocksQuirks        blocks   · anthropic · llamacpp
  ├── TurnsQuirks         turns    · mistral   · ollama
  └── ItemsQuirks         items    · openai

A quirk is typed by the dialect that reads it. `supports_*` belongs to model
capability on LLMModelSpec and is never used here.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional


@dataclass(frozen=True)
class LanguageQuirks:
    """Read by every language dialect, or by the engine above them."""

    #: Tool defs carry `strict: true` and schemas are shaped for it. (openai.)
    strict_tools: bool = False

    #: Retry once without tools after a 400. (ollama — models reject, not ignore.)
    retry_without_tools_on_400: bool = False


@dataclass(frozen=True)
class BlocksQuirks(LanguageQuirks):
    """`blocks` — typed content blocks, tool_result inside a user turn."""

    #: Which header carries the credential. (llamacpp: bearer; anthropic: x-api-key.)
    auth_header: Literal["x-api-key", "bearer"] = "x-api-key"

    #: Placeholder for a keyless server whose client wants a string. (llamacpp.)
    placeholder_api_key: Optional[str] = None

    #: llama-server `chat_template_kwargs` key turning the GGUF's own reasoning
    #: off — this wire has no other way to say "do not reason". (llamacpp.)
    no_thinking_template_kwarg: Optional[str] = None


@dataclass(frozen=True)
class TurnsQuirks(LanguageQuirks):
    """`turns` — role-tagged messages, tool result as its own message."""

    #: How tool-call arguments arrive and go back. (ollama: dict; mistral: JSON string.)
    tool_args_encoding: Literal["json_string", "object"] = "json_string"

    #: Tool results must echo the call id. (mistral requires it; ollama has no field.)
    tool_result_needs_call_id: bool = True

    #: Where an image goes. (ollama: message-level `images: [b64]`.)
    image_placement: Literal["content_part", "message_array"] = "content_part"

    #: Field carrying the JSON schema. (ollama: `format`; mistral: `response_format`.)
    schema_field: Literal["response_format", "format"] = "response_format"

    #: Where sampling params live. (ollama nests under `options`, renames max_tokens.)
    params_envelope: Literal["top_level", "options"] = "top_level"

    #: Field name for the output cap. (chat-completions deprecated `max_tokens`.)
    max_tokens_field: str = "max_tokens"

    #: How streamed chunks are framed. (ollama: NDJSON; mistral: SSE `choices[].delta`.)
    stream_frame: Literal["sse_delta", "ndjson"] = "sse_delta"

    #: Reasoning arrives inline in `<think>` tags. (ollama — some emit only `</think>`.)
    thinking_tags: bool = False

    #: Endpoint parses tool calls itself; false ⇒ we recover prose JSON. (ollama.)
    native_tool_parsing: bool = True


@dataclass(frozen=True)
class ItemsQuirks(LanguageQuirks):
    """`items` — a flat typed item log; call and output are siblings."""

    #: Field name for the output cap. (openai's responses API renamed it.)
    max_tokens_field: str = "max_tokens"

    #: System prompt rides a `developer` role rather than `system`. (openai.)
    developer_role: bool = False

    #: Send `store: false` to opt out of server-side retention. (openai responses.)
    store: bool = False
