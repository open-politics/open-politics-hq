"""
turns.py — role-tagged messages; a tool result is its own message.
==================================================================

  POST {base}/chat/completions (mistral)  ·  {base}/api/chat (ollama)

  SIX FLAGS, ZERO VENDOR BRANCHES BELOW (TurnsQuirks)
    tool_args_encoding          ollama sends a dict, mistral a JSON string
    tool_result_needs_call_id   mistral requires it, ollama has no such field
    image_placement             ollama: message-level `images` array
    schema_field                ollama: `format` · mistral: `response_format`
    params_envelope              ollama nests sampling params under `options`
    stream_frame                 ollama: NDJSON · mistral: SSE deltas

  ENCODE  Turn ──────────────────────────────────────────► request body
    _apply_params    sampling params ─► nested or flat, by `params_envelope`
    _attach_media    images ─► last user turn, shaped by `image_placement`
    tools            encode_tools() — nested {type:"function", function:{…}}
    response_format  schema ─► `format` or `response_format`, by
                     `schema_field` — coexists with tools on this wire

  DECODE  frame ─────────────────────────────────────────► Reply
    ndjson     message.content / .tool_calls, `done` ─► finish_reason
    sse        choices[0].delta.{content,tool_calls}; usage rides the
               choice-less frame
    always     thinking_tags ─► salvage_thinking(raw)
               not native_tool_parsing ─► salvage_tool_calls(reply.text)

  MESSAGE SHAPE                          WHY ITS OWN MESSAGE
    assistant [content, tool_calls]        the structural signature that
    tool {role: "tool", content,           separates this wire from `blocks`
          tool_call_id?}                   (nested in a user turn) and
                                            `items` (a sibling item)

  NOT IN THIS FILE
    ../transforms.py   normalize_media · salvage_* · shape_schema — shared.
    ../engine.py        the turn loop, the ledger, retries.
    ../quirks.py        TurnsQuirks — the six flags above, typed and named.

Mistral and Ollama looked like different APIs and were two files, 1914 lines
between them — the whole difference turned out to be the six flags above.
Zero vendor branches in the loop is the test of whether a dialect boundary
sits in the right place.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, List

from app.api.modules.foundation_service_providers.language import (
    Delta, LanguageDialect, Reply, ToolCall, Turn,
)
from app.api.modules.foundation_service_providers.language.transforms import (
    normalize_media, salvage_thinking, salvage_tool_calls, shape_schema, tool_parts,
    usage_from,
)

logger = logging.getLogger(__name__)

#: Sampling fields forwarded verbatim when set; never sent unset.
SAMPLING_PASSTHROUGH = ("frequency_penalty", "presence_penalty", "seed",
                        "parallel_tool_calls")

#: Neutral tool_choice → this wire's shape. None means omit the field.
TOOL_CHOICE = {"auto": None, "any": "required", "none": "none"}

#: Wire usage key → our key.
USAGE_KEYS = {"prompt_tokens": "input_tokens", "completion_tokens": "output_tokens"}


class TurnsDialect(LanguageDialect):
    """Chat-completions-style messages."""

    def headers(self) -> dict:
        base = {"content-type": "application/json"}
        return {**base, "Authorization": f"Bearer {self.api_key}"} if self.api_key else base

    @property
    def _path(self) -> str:
        return self.descriptor.path

    # ── encode ───────────────────────────────────────────────────────────────

    def encode(self, turn: Turn) -> Dict[str, Any]:
        messages = self._attach_media(
            self.expand_history(turn.messages), turn.options.media, turn.spec
        )
        messages = [m for m in messages if m.get("content") or m.get("tool_calls")]

        payload: Dict[str, Any] = {
            "model": turn.model,
            "messages": messages,
            "stream": True,
        }

        if turn.tools:
            payload["tools"] = self.encode_tools(turn.tools)
            choice = _tool_choice(turn.options.tool_choice)
            if choice is not None:
                payload["tool_choice"] = choice

        if turn.response_format:
            schema = shape_schema(turn.response_format, strict=self.quirks.strict_tools)
            if self.quirks.schema_field == "format":
                # Ollama takes the bare schema.
                payload["format"] = schema
            else:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": turn.response_format.get("title", "StructuredOutput"),
                        "schema": schema,
                        "strict": self.quirks.strict_tools,
                    },
                }

        if turn.thinking:
            payload["think"] = True

        self._apply_params(payload, turn)
        return payload

    def _apply_params(self, payload: Dict[str, Any], turn: Turn) -> None:
        """Sampling parameters, wherever this endpoint keeps them."""
        opts = turn.options
        nested = self.quirks.params_envelope == "options"
        target: Dict[str, Any] = {} if nested else payload

        if opts.temperature is not None:
            target["temperature"] = opts.temperature
        if opts.top_p is not None:
            target["top_p"] = opts.top_p
        if turn.max_tokens:
            target["num_predict" if nested else self.quirks.max_tokens_field] = turn.max_tokens
        if opts.stop:
            target["stop"] = opts.stop
        for field in SAMPLING_PASSTHROUGH:
            value = getattr(opts, field, None)
            if value is not None:
                target[field] = value

        if nested and target:
            payload["options"] = target

    def encode_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Nested definitions: ``{type: "function", function: {...}}``."""
        out = []
        for tool in tools:
            parts = tool_parts(tool)
            if not parts:
                continue
            out.append({
                "type": "function",
                "function": {
                    "name": parts.name,
                    "description": parts.description,
                    "parameters": shape_schema(parts.parameters, strict=self.quirks.strict_tools),
                },
            })
        return out

    def _attach_media(self, messages: List[Dict[str, Any]],
                      media: List[Dict[str, Any]],
                      spec: Any = None) -> List[Dict[str, Any]]:
        """Attach images, but only to a model that can actually read them.

        The capability gate is not cosmetic. A text-only model handed an
        ``images`` array commonly hard-errors, where dropping them degrades to a
        text-only answer that still succeeds. The old provider checked a live
        probe; the spec cascade now answers the same question with no I/O.
        """
        images = normalize_media(media)
        if not images:
            return messages
        if spec is not None and not getattr(spec, "supports_multimodal", False):
            logger.warning(
                "Dropping %d image(s): %s does not report multimodal support",
                len(images), getattr(spec, "name", "this model"),
            )
            return messages

        out = list(messages)
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("role") != "user":
                continue
            content = out[i].get("content")
            if self.quirks.image_placement == "message_array":
                # Ollama: content stays a string, images ride alongside it.
                out[i] = {
                    **out[i],
                    "content": content if isinstance(content, str) else str(content),
                    "images": [m["data"] for m in images],
                }
            else:
                parts: List[Any] = [
                    {"type": "image_url",
                     "image_url": {"url": f"data:{m['mime_type']};base64,{m['data']}"}}
                    for m in images
                ]
                if isinstance(content, str) and content.strip():
                    parts.insert(0, {"type": "text", "text": content})
                elif isinstance(content, list):
                    parts = [*content, *parts]
                out[i] = {**out[i], "content": parts}
            logger.debug("Attached %d image(s) to the last user turn", len(images))
            break
        return out

    # ── history ──────────────────────────────────────────────────────────────

    def _encode_args(self, args: Any) -> Any:
        """Arguments in whichever form this endpoint expects them back."""
        if self.quirks.tool_args_encoding == "object":
            return args if isinstance(args, dict) else json.loads(args or "{}")
        return args if isinstance(args, str) else json.dumps(args or {})

    def _tool_message(self, execution: Dict[str, Any]) -> Dict[str, Any]:
        content = self.replay_content(execution)
        message: Dict[str, Any] = {
            "role": "tool",
            "content": content if isinstance(content, str) else json.dumps(content),
        }
        if self.quirks.tool_result_needs_call_id:
            message["tool_call_id"] = execution.get("id")
        return message

    def encode_history(self, executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Per iteration: an assistant message carrying the calls, then one
        ``role: "tool"`` message per result."""
        out: List[Dict[str, Any]] = []
        for iteration, entries in self.by_iteration(executions):
            calls = [{
                "id": e.get("id") or f"call_{e.get('tool_name')}_{iteration}",
                "type": "function",
                "function": {"name": e.get("tool_name"),
                             "arguments": self._encode_args(e.get("arguments"))},
            } for e in entries]
            out.append({"role": "assistant", "content": "", "tool_calls": calls})
            out.extend(self._tool_message(e) for e in entries)
        return out

    def extend(self, messages: List[Dict[str, Any]], reply: Reply,
               executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = list(messages)
        out.append({
            "role": "assistant",
            "content": reply.text or "",
            "tool_calls": [{
                "id": c.id, "type": "function",
                "function": {"name": c.name, "arguments": self._encode_args(c.arguments)},
            } for c in reply.tool_calls],
        })
        out.extend(self._tool_message(e) for e in executions)
        return out

    # ── stream ───────────────────────────────────────────────────────────────

    async def stream(self, turn: Turn) -> AsyncIterator[Delta]:
        payload = self.encode(turn)
        url = self.url(self._path)
        frames = (self.ndjson(url, payload) if self.quirks.stream_frame == "ndjson"
                  else self.sse(url, payload))

        reply = Reply(model=turn.model)
        raw = ""                       # pre-salvage text, needed for <think> and prose calls
        partial: Dict[int, Dict[str, Any]] = {}

        async for frame in frames:
            if self.quirks.stream_frame == "ndjson":
                message = frame.get("message") or {}
                raw += message.get("content") or ""
                for call in message.get("tool_calls") or []:
                    fn = call.get("function") or {}
                    if fn.get("name"):
                        reply.tool_calls.append(ToolCall(
                            id=call.get("id") or f"call_{fn['name']}_{len(reply.tool_calls)}",
                            name=fn["name"],
                            arguments=fn.get("arguments") if isinstance(fn.get("arguments"), dict)
                            else json.loads(fn.get("arguments") or "{}"),
                        ))
                if frame.get("done"):
                    reply.finish_reason = frame.get("done_reason") or "stop"
                    reply.model = frame.get("model") or reply.model
            else:
                choices = frame.get("choices") or []
                if not choices:
                    reply.usage.update(_usage(frame.get("usage") or {}))
                    continue
                choice = choices[0]
                delta = choice.get("delta") or {}
                raw += delta.get("content") or ""
                for tc in delta.get("tool_calls") or []:
                    slot = partial.setdefault(tc.get("index", 0),
                                              {"id": "", "name": "", "json": ""})
                    if tc.get("id"):
                        slot["id"] = tc["id"]
                    fn = tc.get("function") or {}
                    if fn.get("name"):
                        slot["name"] = fn["name"]
                    if fn.get("arguments"):
                        slot["json"] += fn["arguments"]
                if choice.get("finish_reason"):
                    reply.finish_reason = choice["finish_reason"]
                reply.model = frame.get("model") or reply.model

            reply.text = raw
            yield Delta(reply=reply)

        for slot in partial.values():
            if not slot["name"]:
                continue
            try:
                args = json.loads(slot["json"]) if slot["json"] else {}
            except json.JSONDecodeError:
                logger.error("Unparseable tool arguments for %s: %.120s",
                             slot["name"], slot["json"])
                args = {}
            reply.tool_calls.append(
                ToolCall(id=slot["id"] or f"call_{slot['name']}", name=slot["name"], arguments=args)
            )

        # Decode pipeline — each step selected by a quirk, not by a provider name.
        if self.quirks.thinking_tags:
            thinking, clean = salvage_thinking(raw)
            reply.thinking, reply.text = thinking or "", clean
        if not self.quirks.native_tool_parsing and not reply.tool_calls:
            reply.tool_calls = salvage_tool_calls(reply.text)

        yield Delta(reply=reply, done=True)


def _tool_choice(choice):
    if isinstance(choice, dict) and choice.get("tool"):
        return {"type": "function", "function": {"name": choice["tool"]}}
    return TOOL_CHOICE.get(choice)


def _usage(raw: Dict[str, Any]) -> Dict[str, int]:
    return usage_from(raw, USAGE_KEYS)
