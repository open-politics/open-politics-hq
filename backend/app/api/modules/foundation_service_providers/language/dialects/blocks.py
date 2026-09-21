"""
blocks.py — typed content blocks; a tool result rides inside a user turn.

  POST {base}/v1/messages          serves: anthropic · llamacpp

  ENCODE  Turn ──────────────────────────────────────────► request body
    expand_history   replay prior tool turns (base class)
    _split_system    system turns ─► ONE string, or ONE flat block list
    _attach_media    images ─► last user turn, images before text
    _drop_empty      messages the wire rejects  ◄── AFTER media, never before
    cache markers    host.apply_cache_markers, else strip `cacheable`
    tools │ schema   mutually exclusive ─┐
                                    ├─ tools ─► encode_tools + tool_choice
                                    └─ schema ─► ONE forced `extract` tool
                                        (no native JSON mode on this wire)

  DECODE  SSE ───────────────────────────────────────────► Reply
    content_block_start   opens a thinking block or a tool_use slot
    content_block_delta   text│thinking│signature│input_json append
    message_delta         finish_reason + usage
    on close              parse each tool_use slot's JSON arguments,
                          then undo the extract fiction ─► reply.text

  MESSAGE SHAPE
    assistant [ text, tool_use ]
    user      [ tool_result, … ]

Talks HTTP directly, not through the Anthropic SDK: the SDK refuses
non-streaming requests whose max_tokens implies a long wall time, and it
hardcodes x-api-key, which llama-server cannot use.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, List, Optional

from app.api.modules.foundation_service_providers.language.transforms import (
    normalize_media, shape_schema, tool_parts, usage_from,
)
from app.api.modules.foundation_service_providers.language import (
    Delta, LanguageDialect, Reply, ToolCall, Turn,
)

logger = logging.getLogger(__name__)

#: Beta opt-in for reasoning that continues across tool calls.
INTERLEAVED_THINKING = "interleaved-thinking-2025-05-14"

#: Neutral tool_choice → this wire's shape. A named tool is shaped below.
TOOL_CHOICE = {"auto": {"type": "auto"}, "any": {"type": "any"}, "none": {"type": "none"}}

#: Wire usage key → our key; the cache fields are how caching is verified.
USAGE_KEYS = {
    "input_tokens": "input_tokens",
    "output_tokens": "output_tokens",
    "cache_creation_input_tokens": "cache_creation_input_tokens",
    "cache_read_input_tokens": "cache_read_input_tokens",
}

#: Forced tool standing in for a native JSON mode this wire does not have.
EXTRACT_TOOL = "extract"

#: Output cap when neither caller nor spec names one; a ceiling, not a target.
DEFAULT_MAX_TOKENS = 16_384


class BlocksDialect(LanguageDialect):
    """Anthropic-style messages."""

    def headers(self) -> dict:
        key = self.api_key or self.quirks.placeholder_api_key or ""
        auth = ({"Authorization": f"Bearer {key}"}
                if self.quirks.auth_header == "bearer" else {"x-api-key": key})
        return {**auth, "anthropic-version": "2023-06-01", "content-type": "application/json"}

    # ── encode ───────────────────────────────────────────────────────────────

    def encode(self, turn: Turn) -> Dict[str, Any]:
        system, messages = self._split_system(self.expand_history(turn.messages))
        messages = self._attach_media(messages, turn.options.media, turn.spec)
        messages = self._drop_empty(messages)

        apply_cache = getattr(getattr(self, "host", None), "apply_cache_markers", None)
        if apply_cache:
            system, messages = apply_cache(system, messages)
        else:
            system, messages = _strip_cache_markers(system, messages)

        payload: Dict[str, Any] = {
            "model": turn.model,
            "messages": messages,
            "max_tokens": turn.max_tokens or DEFAULT_MAX_TOKENS,
            "stream": True,
        }
        if system:
            payload["system"] = system

        if turn.tools:
            payload["tools"] = self.encode_tools(turn.tools)
            payload["tool_choice"] = _tool_choice(turn.options.tool_choice)
        elif turn.response_format:
            # No native JSON mode here — structured output is a forced tool call.
            payload["tools"] = [{
                "name": EXTRACT_TOOL,
                "description": "Extract structured data",
                "input_schema": shape_schema(turn.response_format,
                                             strict=self.quirks.strict_tools),
            }]
            payload["tool_choice"] = {"type": "tool", "name": EXTRACT_TOOL}

        if turn.thinking:
            payload["thinking"] = {
                "type": "enabled",
                "budget_tokens": turn.options.thinking_budget or 2000,
            }
        elif self.quirks.no_thinking_template_kwarg:
            # No "do not reason" on this wire; llama-server takes it through
            # the chat template's own kwargs.
            payload["chat_template_kwargs"] = {
                self.quirks.no_thinking_template_kwarg: False,
            }

        opts = turn.options
        if opts.temperature is not None:
            payload["temperature"] = min(opts.temperature, 1.0)   # this wire caps at 1.0
        if opts.top_p is not None:
            payload["top_p"] = opts.top_p
        if opts.stop:
            payload["stop_sequences"] = opts.stop

        return payload

    def encode_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Flat definitions: ``{name, description, input_schema}``."""
        out = []
        for tool in tools:
            parts = tool_parts(tool)
            if not parts:
                continue
            entry = {
                "name": parts.name,
                "description": parts.description,
                "input_schema": shape_schema(parts.parameters, strict=self.quirks.strict_tools),
            }
            out.append(entry)
        return out

    @staticmethod
    def _split_system(messages: List[Dict[str, Any]]):
        """Hoist system turns into the top-level parameter this wire requires.

        Returns ``(system, rest)``: a string, or a flat list of blocks — the
        only two shapes the wire accepts, never a list of lists. Any fragment
        that carries ``cache_control`` forces the block form.
        """
        fragments: List[Any] = []
        rest: List[Dict[str, Any]] = []
        for msg in messages:
            if msg.get("role") != "system":
                rest.append(msg)
                continue
            content = msg.get("content")
            if content:
                fragments.append(content)

        if not fragments:
            return "", rest

        if all(isinstance(f, str) for f in fragments):
            return "\n\n".join(f for f in fragments if f.strip()), rest

        blocks: List[Dict[str, Any]] = []
        for fragment in fragments:
            if isinstance(fragment, str):
                if fragment.strip():
                    blocks.append({"type": "text", "text": fragment})
            elif isinstance(fragment, list):
                blocks.extend(b for b in fragment if isinstance(b, dict))
            elif isinstance(fragment, dict):
                blocks.append(fragment)
        return blocks, rest

    @staticmethod
    def _drop_empty(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Remove messages this wire would reject for having no content.

        Runs after media attaches: an image-only user turn arrives with empty
        text and its image still in ``options.media``.
        """
        kept = []
        for msg in messages:
            content = msg.get("content")
            if isinstance(content, str) and not content.strip():
                continue
            if isinstance(content, list) and not content:
                continue
            kept.append(msg)
        return kept

    @staticmethod
    def _attach_media(messages: List[Dict[str, Any]],
                      media: List[Dict[str, Any]],
                      spec: Any = None) -> List[Dict[str, Any]]:
        """Put images in the last user turn, before its text — this wire's
        documented preference."""
        images = normalize_media(media)
        if not images:
            return messages
        if spec is not None and not getattr(spec, "supports_multimodal", False):
            logger.warning("Dropping %d image(s): %s is not multimodal",
                           len(images), getattr(spec, "name", "this model"))
            return messages

        out = list(messages)
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("role") != "user":
                continue
            blocks: List[Any] = [
                {"type": "image",
                 "source": {"type": "base64", "media_type": m["mime_type"], "data": m["data"]}}
                for m in images
            ]
            content = out[i].get("content")
            if isinstance(content, list):
                blocks.extend(content)
            elif isinstance(content, str) and content.strip():
                blocks.append({"type": "text", "text": content})
            out[i] = {**out[i], "content": blocks}
            logger.debug("Attached %d image(s) to the last user turn", len(images))
            break
        return out

    # ── history ──────────────────────────────────────────────────────────────

    @staticmethod
    def _call_id(e: Dict[str, Any], iteration: Any = None) -> str:
        """The id linking a ``tool_use`` to its ``tool_result``. Both sides must
        agree or the wire rejects the pair."""
        return e.get("id") or f"toolu_{e.get('tool_name')}_{iteration}"

    def _tool_result_block(self, e: Dict[str, Any], call_id: str) -> Dict[str, Any]:
        """One ``tool_result`` block, shaped the same for a replayed turn and for
        the turn just executed."""
        content = self.replay_content(e)
        block: Dict[str, Any] = {
            "type": "tool_result",
            "tool_use_id": call_id,
            "content": content if isinstance(content, (str, list)) else json.dumps(content),
        }
        # Only when true: a present `is_error: false` is a distinct, wrong signal.
        if e.get("error") or e.get("status") == "failed":
            block["is_error"] = True
        return block

    def encode_history(self, executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Replay prior tool turns: per iteration an assistant turn of ``tool_use``
        blocks, then a user turn of matching ``tool_result`` blocks.

        The wire requires that adjacency — a ``tool_use`` must be answered by
        the immediately following turn.
        """
        out: List[Dict[str, Any]] = []
        for iteration, entries in self.by_iteration(executions):
            uses, results = [], []
            for e in entries:
                call_id = self._call_id(e, iteration)
                uses.append({"type": "tool_use", "id": call_id,
                             "name": e.get("tool_name"), "input": e.get("arguments") or {}})
                results.append(self._tool_result_block(e, call_id))
            if uses:
                out.append({"role": "assistant", "content": uses})
                out.append({"role": "user", "content": results})
        return out

    def extend(self, messages: List[Dict[str, Any]], reply: Reply,
               executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Append this turn's assistant content and its tool results."""
        assistant: List[Dict[str, Any]] = []
        # Thinking blocks must carry their signature or this wire rejects them.
        for block in (reply.native or {}).get("thinking_blocks", []):
            if block.get("signature"):
                assistant.append(block)
        if reply.text:
            assistant.append({"type": "text", "text": reply.text})
        for call in reply.tool_calls:
            assistant.append({"type": "tool_use", "id": call.id,
                              "name": call.name, "input": call.arguments})

        out = list(messages)
        if assistant:
            out.append({"role": "assistant", "content": assistant})

        results = [self._tool_result_block(e, self._call_id(e)) for e in executions]
        if results:
            out.append({"role": "user", "content": results})
        return out

    # ── stream ───────────────────────────────────────────────────────────────

    async def stream(self, turn: Turn) -> AsyncIterator[Delta]:
        payload = self.encode(turn)
        reply = Reply(model=turn.model)
        thinking_blocks: List[Dict[str, Any]] = []
        partial: Dict[int, Dict[str, Any]] = {}

        async for event in self.sse(self.url(self.descriptor.path), payload,
                                    _beta_headers(turn)):
            kind = event.get("type")

            if kind == "content_block_start":
                block = event.get("content_block") or {}
                index = event.get("index", 0)
                if block.get("type") == "thinking":
                    thinking_blocks.append({"type": "thinking", "thinking": "", "signature": None})
                elif block.get("type") == "tool_use":
                    partial[index] = {"id": block.get("id"), "name": block.get("name"), "json": ""}

            elif kind == "content_block_delta":
                delta = event.get("delta") or {}
                dtype = delta.get("type")
                if dtype == "text_delta":
                    reply.text += delta.get("text", "")
                    yield Delta(reply=reply)
                elif dtype == "thinking_delta":
                    if not thinking_blocks:
                        thinking_blocks.append({"type": "thinking", "thinking": "", "signature": None})
                    thinking_blocks[-1]["thinking"] += delta.get("thinking", "")
                    reply.thinking = thinking_blocks[0]["thinking"]
                    yield Delta(reply=reply)
                elif dtype == "signature_delta" and thinking_blocks:
                    thinking_blocks[-1]["signature"] = (
                        (thinking_blocks[-1].get("signature") or "") + delta.get("signature", "")
                    )
                elif dtype == "input_json_delta":
                    slot = partial.get(event.get("index", 0))
                    if slot is not None:
                        slot["json"] += delta.get("partial_json", "")

            elif kind == "message_delta":
                reply.finish_reason = (event.get("delta") or {}).get("stop_reason")
                reply.usage.update(_usage(event.get("usage") or {}))

            elif kind == "message_start":
                message = event.get("message") or {}
                reply.model = message.get("model") or reply.model
                reply.usage.update(_usage(message.get("usage") or {}))

        for slot in partial.values():
            try:
                args = json.loads(slot["json"]) if slot["json"] else {}
            except json.JSONDecodeError:
                logger.error("Unparseable tool arguments for %s: %.120s",
                             slot.get("name"), slot["json"])
                args = {}
            reply.tool_calls.append(
                ToolCall(id=slot["id"] or f"toolu_{slot['name']}", name=slot["name"], arguments=args)
            )

        reply.native = {"thinking_blocks": thinking_blocks}

        # Undo the extract fiction: the forced call's arguments ARE the object.
        if turn.response_format and not turn.tools:
            extract = next((c for c in reply.tool_calls if c.name == EXTRACT_TOOL), None)
            if extract is not None:
                reply.text = json.dumps(extract.arguments)
                reply.tool_calls = [c for c in reply.tool_calls if c is not extract]
                reply.finish_reason = reply.finish_reason or "stop"

        if reply.finish_reason == "max_tokens":
            logger.warning(
                "Stopped on max_tokens (%s) — structured output may be truncated. "
                "Raise GenerationOptions.max_tokens if this recurs.",
                payload.get("max_tokens"),
            )

        yield Delta(reply=reply, done=True)


# ── helpers ───────────────────────────────────────────────────────────────────


def _beta_headers(turn: Turn) -> Optional[Dict[str, str]]:
    """Opt in to reasoning that continues between tool calls."""
    if turn.thinking and turn.tools:
        return {"anthropic-beta": INTERLEAVED_THINKING}
    return None


def _tool_choice(choice) -> Dict[str, Any]:
    if isinstance(choice, dict) and choice.get("tool"):
        return {"type": "tool", "name": choice["tool"]}
    return TOOL_CHOICE.get(choice, TOOL_CHOICE["auto"])


def _usage(raw: Dict[str, Any]) -> Dict[str, int]:
    return usage_from(raw, USAGE_KEYS)


def _strip_cache_markers(system, messages):
    """Remove ``cacheable`` markers when the caching feature is not attached —
    this wire rejects an unknown key outright."""
    def clean(blocks):
        if not isinstance(blocks, list):
            return blocks
        return [{k: v for k, v in b.items() if k != "cacheable"} if isinstance(b, dict) else b
                for b in blocks]

    return (
        clean(system),
        [{**m, "content": clean(m.get("content"))} for m in messages],
    )
