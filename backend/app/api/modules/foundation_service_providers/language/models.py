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

   GenerationResponse   the PUBLIC snapshot the SSE route relays
   GenerationOptions    caller knobs; extra="forbid", so a typo raises
   ToolDef/Call/Outcome a tool as declared · as requested · as executed

  Beside the contract, not in the engine, so no dialect imports an engine —
  a dialect implements a contract and does not know one exists.
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

    These are **model** capabilities. How an *endpoint* expresses them on the
    wire is a separate question answered by ``LanguageQuirks`` — a model either
    reasons or it does not (``supports_thinking``), while a server either wraps
    that reasoning in ``<think>`` tags or does not (``thinking_tags``). Ollama
    serves both kinds of model over one wire that always needs tag salvage,
    which is why the two must stay independent.

    ``max_tokens`` is a **default**, never a ceiling: a caller's
    ``GenerationOptions.max_tokens`` always outranks it. Advanced extraction
    depends on being able to raise it per run.
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
    """One snapshot of a generation. The public contract, unchanged.

    Streaming yields many of these; non-streaming returns one. Three invariants
    the whole stack depends on:

    * ``content`` is **cumulative**, never a delta. The frontend assigns it on
      every chunk rather than appending, and across tool-loop iterations it is
      ``\\n\\n``-joined so earlier narration is not overwritten.
    * ``tool_executions`` is the **whole list on every yield**, with ids stable
      across yields — the UI keys directive dedup and ``<tool_results id=…/>``
      resolution off them.
    * A generation always yields **at least once**, or ``_drain_stream`` in the
      annotation task returns ``None`` and Phase A raises.

    ``raw_response`` is gone: it was produced by every provider and read by
    nothing.
    """
    content: str
    model_used: str
    usage: Optional[Dict[str, int]] = None
    tool_calls: Optional[List[Dict]] = None
    tool_executions: Optional[List[Dict]] = None
    thinking_trace: Optional[str] = None
    finish_reason: Optional[str] = None


class GenerationOptions(BaseModel):
    """Everything tunable about one generation.

    **Unknown keys are refused, not dropped.** Before this existed, the
    annotation task splatted a run's free-form ``configuration`` JSONB straight
    into ``generate(**kwargs)`` and every provider swallowed what it did not
    recognise — so a typo'd ``temperatur`` silently did nothing. A silent drop
    teaches an operator that the switch is broken rather than that the name is
    wrong.
    """
    model_config = ConfigDict(extra="forbid", frozen=True)

    temperature: Optional[float] = None
    top_p: Optional[float] = None

    #: Output cap. Always outranks ``LLMModelSpec.max_tokens``, a starting default.
    max_tokens: Optional[int] = None

    #: Iterations of the tool loop before giving up. Clamped to [1, 100].
    max_tool_iterations: int = 20

    #: "auto" | "any" (some tool) | "none" | {"tool": "<name>"} (that one).
    tool_choice: ToolChoice = "auto"

    #: Reasoning budget in tokens, for models that take one.
    thinking_budget: Optional[int] = None

    #: For the last user turn: ``{type, content: bytes, mime_type, uuid?}``.
    media: List[Dict[str, Any]] = Field(default_factory=list)

    #: Stop sequences.
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
    #: An MCP server's promised result shape; dropping it broke that promise.
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

    ``llm_content`` is what the model sees — a string, or a list of content
    blocks when the tool returned images. ``display`` is the full structured
    payload the UI renders. They are different on purpose: the model gets a
    summary, the interface gets everything.
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
    """One streaming chunk. Slotted because it is allocated per chunk.

    ``reply`` is the running accumulation for *this* turn, not the delta — the
    engine folds it into the cross-turn transcript.
    """
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
        """Grow the tool set mid-turn.

        A catalogue ``load`` op returns ``_load_tools`` so the model can call
        newly-relevant tools on *later* iterations of the same turn — browse,
        then load, then act. Dedup by name.
        """
        have = {t.get("name") or (t.get("function") or {}).get("name") for t in self.tools}
        additions = [
            t for t in extra
            if (t.get("name") or (t.get("function") or {}).get("name")) not in have
        ]
        return replace(self, tools=[*self.tools, *additions]) if additions else self

    @property
    def max_tokens(self) -> Optional[int]:
        """Caller's cap, else the model's declared default.

        Precedence matters: a declared ``max_tokens`` is a sensible starting
        point, not a ceiling the caller has to argue with.
        """
        if self.options.max_tokens:
            return self.options.max_tokens
        return getattr(self.spec, "max_tokens", None)
