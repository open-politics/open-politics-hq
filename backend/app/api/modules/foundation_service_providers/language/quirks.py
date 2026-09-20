"""
quirks.py — where an endpoint deviates INSIDE its dialect.
==========================================================

  A quirk is typed by the DIALECT that reads it, never by the domain.
  One a dialect cannot read is a TypeError at import, not a silent no-op.

    LanguageQuirks          read by every dialect
    ├── BlocksQuirks        blocks   · anthropic · llamacpp
    ├── TurnsQuirks         turns    · mistral   · ollama
    └── ItemsQuirks         items    · openai

  WHY SCOPED                        THREE EXITS — it stages, never accumulates
  ──────────                        ──────────────────────────────────────────
  One flat class let llamacpp         → feature      it gates an API surface
  declare thinking_tags and           → dialect step a cluster co-occurs and
  native_tool_parsing against           describes a wire shape
  `blocks`, which reads neither.      → deleted      its one endpoint is gone
  Declared, accepted, inert — and
  only a cold read found it.        REVIEW TRIGGER
                                      a NEW endpoint needs a flag that already
  NAMING                              exists. That is the first real evidence
  `supports_*` is reserved for        of a pattern.
  MODEL capability on LLMModelSpec.
  Nothing here uses it, so the two
  vocabularies never read as one.

Every field names the endpoint that forced it: provenance is what makes the
graduation review possible. Three fields were deleted rather than scoped —
`stream_options` (no setter, no reader), `fixed_context` (redundant with the
`props` feature, its own graduation candidate) and `base_url_has_version`
(derivable from the base URL, and dead in both directions).
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

    #: Template kwarg that turns the model's OWN reasoning off. (llamacpp.)
    #:
    #: On this wire `thinking` is opt-IN — Anthropic reasons only when the
    #: request asks it to, so "caller wants no thinking" is expressed by sending
    #: nothing. A GGUF served by llama-server reasons because its *chat template*
    #: does, and silence leaves that on. There is no way to say "off" through the
    #: Anthropic vocabulary, so llama-server exposes `chat_template_kwargs`.
    #:
    #: Measured on Ornith-1.5-35B: reasoning ran to the whole 8192-token output
    #: cap before emitting any tool call, on every turn of the annotation tool
    #: loop. The turn stopped on `max_tokens` with no call in it, which the loop
    #: correctly reads as "the model chose not to call a tool" — so a forced-tool
    #: turn silently produced nothing. With this set, the same document reaches
    #: `done` in one turn and ~25% fewer output tokens.
    #:
    #: Only consulted when the caller asked for thinking OFF; a caller that wants
    #: reasoning gets it, and an endpoint that does not declare this is untouched.
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
