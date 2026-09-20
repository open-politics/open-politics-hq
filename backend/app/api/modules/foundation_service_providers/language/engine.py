"""
language/engine.py — the turn loop; every dialect runs through this one.
========================================================================

  generate(stream=True)   ──►  _run(turn)                 (bare generator)
  generate(stream=False)  ──►  drains _run(turn), returns its last snapshot

  _run(turn), one iteration:
    _stream_turn(turn) ──► adapter.stream(turn) ──► Delta, Delta, …
    reply = last delta.reply ──► ledger.add_usage · yield ledger.snapshot()
    no tool_calls?        ──► EXIT stop / empty
    tools, no executor?   ──► EXIT tool_calls        (surfaced, not run)
    else: execute each ──► ledger.completed(entry) ──► yield snapshot()
          adapter.extend(...) ──► loop, or EXIT terminate_signal /
                                        max_iterations

  Ledger   cross-turn state, rebuilt nowhere else
    tool_executions   the WHOLE list, every yield — ids stable across yields
    usage             summed across iterations
    transcript        prefix + current, \n\n-joined so no iteration
                       overwrites an earlier one

  RETRIES — in _stream_turn, selected by quirk, never by vendor name
    "does not support tools"     ──► retry once, tools=[]
    "does not support <param>"   ──► retry once, bare sampling options

  NOT IN THIS FILE
    transforms.py   tool_result, join_transcript — the pure steps this calls.
    <dialect>.py    the only place that varies per vendor: encode / decode.

Five providers each carried two copies of this loop (streaming and not) —
Anthropic's alone was 744 + 280 lines. Mistral's ledger copy forgot to store
`model_view`, silently losing tool results on a second turn; one `Ledger`
makes that bug unrepresentable.
"""

from __future__ import annotations

import json
import logging
from itertools import count
from typing import Any, AsyncIterator, Dict, List, Optional, Union

from app.api.modules.foundation_service_providers.language import (
    GenerationOptions, GenerationResponse, Reply, ToolCall, ToolExecutor,
    ToolOutcome, Turn,
)
from app.api.modules.foundation_service_providers.language.transforms import (
    join_transcript, tool_result,
)

logger = logging.getLogger(__name__)


# ── Ledger ────────────────────────────────────────────────────────────────────


class Ledger:
    """Cross-turn state: tool executions, cumulative usage, running transcript.

    Every snapshot carries the **whole** execution list, because the frontend
    replaces rather than merges, and ids stay stable across yields because the
    UI keys directive dedup and ``<tool_results id=…/>`` resolution off them.
    """

    def __init__(self, model: str):
        self.model = model
        self.executions: List[Dict[str, Any]] = []
        self.usage: Dict[str, int] = {}
        self.prefix = ""                 # narration from completed iterations
        self.current = ""                # this iteration's text

    # ── transcript ───────────────────────────────────────────────────────────

    @property
    def transcript(self) -> str:
        return join_transcript(self.prefix, self.current)

    def close_iteration(self) -> None:
        """Fold this iteration's narration into the transcript prefix."""
        if self.current:
            self.prefix = join_transcript(self.prefix, self.current)
        self.current = ""

    def add_usage(self, usage: Dict[str, int]) -> None:
        for k, v in (usage or {}).items():
            if isinstance(v, int):
                self.usage[k] = self.usage.get(k, 0) + v

    # ── executions ───────────────────────────────────────────────────────────

    def running(self, call: ToolCall, iteration: int, thinking: Optional[str]) -> Dict[str, Any]:
        entry = {
            "id": call.id,
            "tool_name": call.name,
            "arguments": call.arguments,
            "result": None,
            "structured_content": None,
            "error": None,
            "status": "running",
            "iteration": iteration,
            "thinking_before": thinking or None,
        }
        self.executions.append(entry)
        return entry

    def completed(self, entry: Dict[str, Any], outcome: ToolOutcome) -> None:
        entry.update({
            "result": None if outcome.failed else outcome.display,
            "structured_content": None if outcome.failed else outcome.display,
            # Written on failures too, or replay drops the entry and the model retries it.
            "model_view": outcome.llm_content,
            "error": outcome.error,
            "status": "failed" if outcome.failed else "completed",
        })

    def results_for(self, iteration: int) -> List[Dict[str, Any]]:
        return [e for e in self.executions if e.get("iteration") == iteration]

    # ── snapshots ────────────────────────────────────────────────────────────

    def snapshot(self, *, thinking: Optional[str] = None,
                 finish: Optional[str] = None,
                 final: bool = False) -> GenerationResponse:
        return GenerationResponse(
            content=self.transcript,
            model_used=self.model,
            usage=dict(self.usage) if (final and self.usage) else None,
            tool_calls=None,
            tool_executions=[dict(e) for e in self.executions] or None,
            thinking_trace=thinking or None,
            finish_reason=finish,
        )


# ── Provider ──────────────────────────────────────────────────────────────────


class DialectProvider:
    """Satisfies ``LanguageModelProvider`` over any language dialect.

    Delegates unknown attributes to the dialect adapter so features composed
    onto this object and adapter internals both stay reachable.
    """

    def __init__(self, adapter, descriptor):
        self.adapter = adapter
        self.descriptor = descriptor
        self.quirks = adapter.quirks

    def __getattr__(self, name):
        return getattr(self.adapter, name)

    # ── public contract ──────────────────────────────────────────────────────

    async def generate(
        self,
        messages: List[Dict[str, Any]],
        model_name: str,
        response_format: Optional[Dict] = None,
        tools: Optional[List[Dict]] = None,
        stream: bool = False,
        thinking_enabled: bool = False,
        tool_executor: Optional[ToolExecutor] = None,
        options: Optional[GenerationOptions] = None,
        **kwargs: Any,
    ) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """Run one generation.

        With ``stream=True`` this returns a bare async generator — the caller
        awaits this coroutine, then iterates the result. That two-step shape is
        what every consumer in the codebase is written against.
        """
        opts = options if options is not None else GenerationOptions(**kwargs)

        spec = self.descriptor.get_model(model_name) or self.descriptor.binding.dialect.baseline
        turn = Turn(
            messages=list(messages),
            model=model_name,
            options=opts,
            tools=list(tools or []),
            response_format=response_format,
            # Only where the model actually reasons; this once read an empty cache.
            thinking=bool(thinking_enabled and getattr(spec, "supports_thinking", False)),
            executor=tool_executor,
            spec=spec,
        )

        if stream:
            return self._run(turn)
        return await self._drain(turn)

    async def _drain(self, turn: Turn) -> GenerationResponse:
        """Collect the loop and return its final snapshot."""
        last: Optional[GenerationResponse] = None
        async for snapshot in self._run(turn):
            last = snapshot
        if last is None:
            # Belt-and-braces: a caller must never get None back.
            return GenerationResponse(content="", model_used=turn.model,
                                      finish_reason="empty")
        return last

    # ── the loop ─────────────────────────────────────────────────────────────

    async def _run(self, turn: Turn) -> AsyncIterator[GenerationResponse]:
        """The turn loop. Every yield is a snapshot the SSE route relays."""
        ledger = Ledger(turn.model)

        for iteration in count(1):
            reply: Optional[Reply] = None

            async for delta in self._stream_turn(turn):
                reply = delta.reply
                ledger.current = reply.text
                yield ledger.snapshot(thinking=reply.thinking)

            if reply is None:
                yield ledger.snapshot(finish="empty", final=True)
                return

            ledger.model = reply.model or ledger.model
            ledger.add_usage(reply.usage)

            if not reply.tool_calls:
                yield ledger.snapshot(thinking=reply.thinking,
                                      finish=reply.finish_reason or "stop", final=True)
                return

            if turn.executor is None:
                # Tools offered, no executor: surface the calls, don't loop.
                snap = ledger.snapshot(thinking=reply.thinking, finish="tool_calls", final=True)
                snap.tool_calls = [
                    {"id": c.id, "type": "function",
                     "function": {"name": c.name, "arguments": json.dumps(c.arguments)}}
                    for c in reply.tool_calls
                ]
                yield snap
                return

            terminated = False
            for call in reply.tool_calls:
                entry = ledger.running(call, iteration, reply.thinking)
                yield ledger.snapshot()

                outcome = await self._execute(call, turn.executor)
                ledger.completed(entry, outcome)
                yield ledger.snapshot()

                if outcome.load_tools:
                    turn = turn.with_tools(outcome.load_tools)
                    logger.info("Loaded %d tool(s) mid-turn", len(outcome.load_tools))
                if outcome.terminate:
                    terminated = True

            turn = turn.with_messages(
                self.adapter.extend(turn.messages, reply, ledger.results_for(iteration))
            )
            ledger.close_iteration()

            if terminated:
                logger.info("Tool loop terminated by executor sentinel at iteration %d", iteration)
                yield ledger.snapshot(finish="terminate_signal", final=True)
                return

            if iteration >= turn.options.iterations:
                logger.warning("Tool loop hit its cap of %d iterations", turn.options.iterations)
                yield ledger.snapshot(finish="max_iterations", final=True)
                return

    async def _execute(self, call: ToolCall, executor: ToolExecutor) -> ToolOutcome:
        """Run one tool call. A failure is data the model sees, not an exception."""
        try:
            logger.info("Executing tool %s with %s", call.name, call.arguments)
            return tool_result(await executor(call.name, call.arguments), call.name)
        except Exception as e:
            logger.error("Tool execution failed for %s: %s", call.name, e, exc_info=True)
            payload = {"error": f"Tool execution failed: {e}"}
            return ToolOutcome(llm_content=json.dumps(payload), display=payload, error=str(e))

    # ── retries, driven by quirks ────────────────────────────────────────────

    async def _stream_turn(self, turn: Turn):
        """One model turn, with the retries that used to live in five places.

        ``retry_without_tools_on_400`` existed twice inside the Ollama provider
        alone, with the two copies having drifted apart. The "does not support
        tools" and "does not support temperature" retries lived in
        ``conversation_service`` as string matches against error text — a
        provider concern that had leaked into a service.
        """
        try:
            async for delta in self.adapter.stream(turn):
                yield delta
            return
        except Exception as e:
            retry = self._retry_for(e, turn)
            if retry is None:
                raise
            logger.warning("Retrying turn without %s: %s", retry[1], e)
            turn = retry[0]

        async for delta in self.adapter.stream(turn):
            yield delta

    def _retry_for(self, error: Exception, turn: Turn) -> Optional[tuple[Turn, str]]:
        """Decide whether this failure has a narrower request worth trying."""
        text = str(error).lower()
        status = getattr(getattr(error, "response", None), "status_code", None)

        tools_rejected = (
            "does not support tools" in text
            or ("tool" in text and "unsupported" in text)
            or (status == 400 and self.quirks.retry_without_tools_on_400 and turn.tools)
        )
        if tools_rejected and turn.tools:
            from dataclasses import replace
            return replace(turn, tools=[], response_format=turn.response_format), "tools"

        params_rejected = (
            "unsupported_value" in text
            or ("temperature" in text and "does not support" in text)
            or ("reasoning" in text and ("unsupported" in text or "not supported" in text))
        )
        if params_rejected:
            from dataclasses import replace
            bare = turn.options.model_copy(update={
                "temperature": None, "top_p": None, "thinking_budget": None,
            })
            return replace(turn, options=bare, thinking=False), "sampling parameters"

        return None
