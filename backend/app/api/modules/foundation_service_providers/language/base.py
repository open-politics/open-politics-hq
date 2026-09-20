"""
language/base.py — the two contracts a dialect sits between.
============================================================

  LanguageModelProvider          what a CALLER may rely on
    generate(...)  ──►  GenerationResponse, or an async generator of them

  LanguageDialect                what a WIRE must implement
    ── to implement ──               ── provided ──
    encode(turn)       body          expand_history   replay tool history
    stream(turn)       Deltas        by_iteration     group execs by turn
    encode_history()   replay        replay_content   model_view → content
    extend()           append

  NOT IN THIS FILE
    models.py   Turn · Reply · Delta — what these methods pass around.
    quirks.py   LanguageQuirks — what a dialect reads to vary its shape.
    engine.py   the loop, ledger and retries built above these four.
"""

from __future__ import annotations
import json
from itertools import groupby
from typing import (
    Any, AsyncIterator, Awaitable, Callable, Dict, List, Literal, Optional,
    Protocol, Union, runtime_checkable,
)
from app.api.modules.foundation_service_providers.base import Adapter

from app.api.modules.foundation_service_providers.base import Adapter
from app.api.modules.foundation_service_providers.language.models import (
    Delta, GenerationOptions, GenerationResponse,
    Reply, ToolCall, ToolExecutor, Turn,
)


@runtime_checkable
class LanguageModelProvider(Protocol):
    """Chat, structured output, tools and streaming over any dialect."""

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        response_format: Optional[Dict] = None,
        tools: Optional[List[Dict]] = None,
        stream: bool = False,
        thinking_enabled: bool = False,
        tool_executor: Optional[ToolExecutor] = None,
        **options: Any,
    ) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """Run one generation.

        With ``stream=True`` this returns a **bare async generator** — callers
        ``await`` the coroutine and then ``async for`` the result. That shape is
        load-bearing: all three consumers in the codebase are written against it.

        ``**options`` is validated into ``GenerationOptions``; unknown keys are
        refused rather than silently dropped.
        """
        ...


class LanguageDialect(Adapter):
    """What a language dialect must implement.

    Four methods. ``encode`` shapes a request, ``stream`` sends it and decodes
    the reply, ``encode_history`` replays prior tool activity, and ``extend``
    appends the turn just completed. Everything else — the loop, the ledger, the
    retries — belongs to the engine.

    ``expand_history`` below is the piece worth reading. Conversation history
    arrives with prior tool activity attached to assistant messages as
    ``tool_executions``: the ledger the engine wrote on an earlier turn. Each
    dialect must turn that back into its own wire shape or the model forgets
    what it looked up. Three of the five old providers did this; Mistral did
    not, which is exactly why a two-turn Mistral conversation lost its tool
    results. Here the base drives it and a dialect only fills in the shape.
    """

    timeout = 900.0

    # ── to implement ─────────────────────────────────────────────────────────

    def encode(self, turn) -> Dict[str, Any]:
        """Neutral ``Turn`` → this wire's request payload."""
        raise NotImplementedError

    async def stream(self, turn) -> AsyncIterator:
        """Send, and yield a ``Delta`` per decoded chunk. Last one has ``done``."""
        raise NotImplementedError

    def encode_history(self, executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Prior tool executions → wire items, grouped by iteration."""
        raise NotImplementedError

    def extend(self, messages: List[Dict[str, Any]], reply,
               executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Append the assistant turn just completed and its tool results."""
        raise NotImplementedError

    # ── provided ─────────────────────────────────────────────────────────────

    def expand_history(self, messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Replace assistant messages carrying tool history with wire items.

        The assistant's own prose is kept *after* the replayed exchange, so a
        later turn sees both the raw tool data and the model's last summary of
        it. Dropping either measurably degrades follow-up answers.
        """
        out: List[Dict[str, Any]] = []
        for msg in messages:
            executions = msg.get("tool_executions") if msg.get("role") == "assistant" else None
            if not executions:
                out.append(msg)
                continue

            replayable = [e for e in executions if self.replay_content(e) is not None]
            if replayable:
                out.extend(self.encode_history(replayable))

            text = msg.get("content") or ""
            if isinstance(text, str) and text.strip():
                out.append({"role": "assistant", "content": text})
        return out

    @staticmethod
    def by_iteration(executions: List[Dict[str, Any]]):
        """Group executions by the turn they happened on, in order.

        The grouping is load-bearing for ``blocks``, where a ``tool_use`` must
        be answered by the immediately following turn.
        """
        ordered = sorted(executions, key=lambda e: e.get("iteration", 1))
        for iteration, group in groupby(ordered, key=lambda e: e.get("iteration", 1)):
            yield iteration, list(group)

    @staticmethod
    def replay_content(execution: Dict[str, Any]) -> Any:
        """What the model should see for this execution on a later turn.

        Prefers ``model_view`` — the exact bytes it saw originally, so replay is
        faithful and a cached prefix stays stable. Falls back to the structured
        payload for entries written before ``model_view`` existed. ``None`` means
        nothing is replayable and the entry is skipped.
        """
        view = execution.get("model_view")
        if view is not None:
            return view
        payload = execution.get("structured_content") or execution.get("result")
        if payload is None:
            return None
        return payload if isinstance(payload, str) else json.dumps(payload, ensure_ascii=False)
