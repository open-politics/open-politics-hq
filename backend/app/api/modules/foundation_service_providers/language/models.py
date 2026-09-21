"""
language/models.py — the vocabulary a turn is written in.

   Turn ────────────────────────────────────► every dialect consumes one
     messages · model · options · tools          and produces a Reply
     response_format · thinking · executor · spec
                                   │
   Reply  ◄── one decoded assistant turn ──┤
     text · thinking · tool_calls · usage · finish_reason · native
   Delta  ◄── one streamed chunk ──────────┘
     reply · done

   GenerationResponse   the public snapshot the SSE route relays
   GenerationOptions    caller knobs; extra="forbid", so a typo raises
   ToolDef/Call/Outcome a tool as declared · as requested · as executed
"""

from __future__ import annotations
from dataclasses import dataclass, field, replace
from typing import (
    Any, AsyncIterator, Awaitable, Callable, Dict, List, Literal, Optional,
    Protocol, Union, runtime_checkable,
)
from pydantic import BaseModel, ConfigDict, Field
from app.api.modules.foundation_service_providers.models import ModelSpec

from app.api.modules.foundation_service_providers.models import ModelSpec


ALLOWED_IMAGE_TYPES = ("image/jpeg", "image/png", "image/gif", "image/webp")


MAX_IMAGE_BYTES = 3_750_000


ToolChoice = Union[Literal["auto", "any", "none"], Dict[str, str]]


ToolExecutor = Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]


@dataclass(frozen=True)
class LLMModelSpec(ModelSpec):
    """What a language model can do.

    Model capabilities, not wire shape: a model reasons or it does not
    (``supports_thinking``); whether the server wraps that in ``<think>`` tags
    is ``TurnsQuirks.thinking_tags``. ``max_tokens`` is a default, not a cap.
    """
    supports_tools: bool = False
    supports_streaming: bool = True
    supports_thinking: bool = False
    supports_multimodal: bool = False
    supports_structured_output: bool = False
    supports_prompt_caching: bool = False
    max_tokens: Optional[int] = None
    context_length: Optional[int] = None


@dataclass
class GenerationResponse:
    """One snapshot of a generation; streaming yields many, non-streaming one.

    Three invariants callers rely on: ``content`` is cumulative, never a delta;
    ``tool_executions`` is the whole list on every yield, with stable ids; and
    a generation always yields at least once.
    """
    content: str
    model_used: str
    usage: Optional[Dict[str, int]] = None
    tool_calls: Optional[List[Dict]] = None
    tool_executions: Optional[List[Dict]] = None
    thinking_trace: Optional[str] = None
    finish_reason: Optional[str] = None


class GenerationOptions(BaseModel):
    """Everything tunable about one generation. Unknown keys raise."""
    model_config = ConfigDict(extra="forbid", frozen=True)

    temperature: Optional[float] = None
    top_p: Optional[float] = None

    #: Output cap. Outranks ``LLMModelSpec.max_tokens``.
    max_tokens: Optional[int] = None

    #: Iterations of the tool loop before giving up. Clamped to [1, 100].
    max_tool_iterations: int = 20

    #: "auto" | "any" (some tool) | "none" | {"tool": "<name>"} (that one).
    tool_choice: ToolChoice = "auto"

    #: Reasoning budget in tokens, for models that take one.
    thinking_budget: Optional[int] = None

    #: For the last user turn: ``{type, content: bytes, mime_type, uuid?}``.
    media: List[Dict[str, Any]] = Field(default_factory=list)

    stop: Optional[List[str]] = None

    #: Penalise by prior frequency / presence. Never sent when unset.
    frequency_penalty: Optional[float] = None
    presence_penalty: Optional[float] = None

    #: Deterministic sampling seed, where the endpoint honours one.
    seed: Optional[int] = None

    #: Allow several tool calls in one reply. None leaves the endpoint's default.
    parallel_tool_calls: Optional[bool] = None

    #: Forwarded to a provider-native MCP passthrough, when `mcp` is attached.
    mcp_headers: Optional[Dict[str, str]] = None

    @property
    def iterations(self) -> int:
        return max(1, min(int(self.max_tool_iterations), 100))


@dataclass(frozen=True, slots=True)
class ToolDef:
    """One tool as the wire needs it, unpacked from whatever shape arrived."""
    name: str
    description: str
    parameters: Dict[str, Any]
    #: An MCP server's declared result shape, when it declares one.
    output_schema: Optional[Dict[str, Any]] = None


@dataclass(frozen=True, slots=True)
class ToolCall:
    """One tool invocation the model asked for."""
    id: str
    name: str
    arguments: Dict[str, Any]


@dataclass(frozen=True, slots=True)
class ToolOutcome:
    """What came back from executing one tool call.

    ``llm_content`` is what the model sees — a string, or content blocks when
    the tool returned images. ``display`` is the full payload the UI renders.
    """
    llm_content: Union[str, List[Dict[str, Any]]]
    display: Any
    error: Optional[str] = None
    terminate: bool = False                       # executor asked to stop the loop
    load_tools: List[Dict[str, Any]] = field(default_factory=list)

    @property
    def failed(self) -> bool:
        return self.error is not None


@dataclass(slots=True)
class Reply:
    """One assistant turn, decoded."""
    text: str = ""
    thinking: str = ""
    tool_calls: List[ToolCall] = field(default_factory=list)
    usage: Dict[str, int] = field(default_factory=dict)
    finish_reason: Optional[str] = None
    model: str = ""
    #: The dialect's own shape for this turn, so replay is verbatim.
    native: Any = None


@dataclass(slots=True)
class Delta:
    """One streaming chunk. ``reply`` is the running accumulation for this
    turn, not the delta."""
    reply: Reply
    done: bool = False


@dataclass(frozen=True, slots=True)
class Turn:
    """A generation request in neutral terms."""
    messages: List[Dict[str, Any]]
    model: str
    options: GenerationOptions
    tools: List[Dict[str, Any]] = field(default_factory=list)
    response_format: Optional[Dict[str, Any]] = None
    thinking: bool = False
    executor: Optional[ToolExecutor] = None
    spec: Optional[Any] = None                    # LLMModelSpec for this model

    def with_messages(self, messages: List[Dict[str, Any]]) -> "Turn":
        return replace(self, messages=messages)

    def with_tools(self, extra: List[Dict[str, Any]]) -> "Turn":
        """Grow the tool set mid-turn, deduped by name.

        A catalogue ``load`` op returns ``_load_tools`` so the model can call
        newly-relevant tools on later iterations of the same turn.
        """
        have = {t.get("name") or (t.get("function") or {}).get("name") for t in self.tools}
        additions = [
            t for t in extra
            if (t.get("name") or (t.get("function") or {}).get("name")) not in have
        ]
        return replace(self, tools=[*self.tools, *additions]) if additions else self

    @property
    def max_tokens(self) -> Optional[int]:
        """Caller's cap, else the model's declared default."""
        if self.options.max_tokens:
            return self.options.max_tokens
        return getattr(self.spec, "max_tokens", None)
