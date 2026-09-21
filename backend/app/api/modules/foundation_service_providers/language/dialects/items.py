"""
items.py — the /responses flat item log; call and output are siblings.

  POST {base}/responses            serves: openai

  ENCODE  Turn ──────────────────────────────────────────► request body
    _to_items        messages ─► flat items
                        leading system ─► top-level `instructions`
                        later system    ─► `developer` or `system` item
                        already wire items (function_call*) ─► pass through
    _attach_media    images ─► last user item's content, text first
    tools            encode_tools() tries `mcp` passthrough per tool first
    response_format  text.format: json_schema — coexists with tools here
    store: false     opt out of server-side retention (ItemsQuirks.store)

  DECODE  SSE ───────────────────────────────────────────► Reply
    response.output_text.delta                  text append
    response.reasoning[_summary]_text.delta     thinking append
    response.output_item.added (function_call)  opens a call slot
    response.function_call_arguments.delta      slot's JSON append
    response.completed                          finish_reason + usage
    error                                       raise RuntimeError(message)

  ITEM SHAPE
    {type: message, role, content}
    {type: function_call, call_id, …}
    {type: function_call_output, call_id, output}

  A call and its output are two items back-to-back in one flat list; the
  endpoint requires the output to immediately follow its call.
"""

from __future__ import annotations

import json
import logging
from typing import Any, AsyncIterator, Dict, List

from app.api.modules.foundation_service_providers.language import (
    Delta, LanguageDialect, Reply, ToolCall, Turn,
)
from app.api.modules.foundation_service_providers.language.transforms import (
    normalize_media, shape_schema, tool_parts, usage_from,
)

logger = logging.getLogger(__name__)

#: Neutral tool_choice → this wire's shape. None means omit the field.
TOOL_CHOICE = {"auto": None, "any": "required", "none": "none"}

#: Wire usage key → our key.
USAGE_KEYS = {"input_tokens": "input_tokens", "output_tokens": "output_tokens"}

#: Nested usage detail; reasoning tokens are billed.
INPUT_DETAIL_KEYS = {"cached_tokens": "cache_read_input_tokens"}
OUTPUT_DETAIL_KEYS = {"reasoning_tokens": "reasoning_tokens"}


class ItemsDialect(LanguageDialect):
    """Responses-style item log."""

    def headers(self) -> dict:
        return {"Authorization": f"Bearer {self.api_key}",
                "content-type": "application/json"}

    @property
    def _path(self) -> str:
        return self.descriptor.path

    # ── encode ───────────────────────────────────────────────────────────────

    def encode(self, turn: Turn) -> Dict[str, Any]:
        instructions, items = self._to_items(self.expand_history(turn.messages))
        items = self._attach_media(items, turn.options.media)

        payload: Dict[str, Any] = {
            "model": turn.model,
            "input": items,
            "stream": True,
        }
        if instructions:
            payload["instructions"] = instructions
        if self.quirks.store is False:
            # Opt out of server-side retention: we own conversation state.
            payload["store"] = False

        if turn.tools:
            payload["tools"] = self.encode_tools(turn.tools, turn.options.mcp_headers)
            choice = _tool_choice(turn.options.tool_choice)
            if choice is not None:
                payload["tool_choice"] = choice

        if turn.response_format:
            payload["text"] = {"format": {
                "type": "json_schema",
                "name": turn.response_format.get("title", "StructuredOutput"),
                "schema": shape_schema(turn.response_format, strict=self.quirks.strict_tools),
            }}

        if turn.thinking:
            payload["reasoning"] = {"effort": "medium"}

        opts = turn.options
        if opts.temperature is not None:
            payload["temperature"] = opts.temperature
        if opts.top_p is not None:
            payload["top_p"] = opts.top_p
        if turn.max_tokens:
            payload[self.quirks.max_tokens_field] = turn.max_tokens

        return payload

    def encode_tools(self, tools: List[Dict[str, Any]],
                     mcp_headers: Dict[str, str] | None = None) -> List[Dict[str, Any]]:
        """Flat definitions: ``{type: "function", name, description, parameters}``.

        The ``mcp`` feature, when attached, turns a declared MCP tool into a
        native passthrough entry the endpoint calls itself.
        """
        out: List[Dict[str, Any]] = []
        mcp = getattr(getattr(self, "host", None), "mcp_tool", None)

        for tool in tools:
            if mcp is not None and tool.get("type") == "mcp":
                entry = mcp(tool, mcp_headers)
                if entry:
                    out.append(entry)
                    continue

            parts = tool_parts(tool)
            if not parts:
                continue
            entry = {
                "type": "function",
                "name": parts.name,
                "description": parts.description,
                "parameters": shape_schema(parts.parameters, strict=self.quirks.strict_tools),
            }
            if parts.output_schema:
                entry["output_schema"] = shape_schema(
                    parts.output_schema, strict=self.quirks.strict_tools)
            if self.quirks.strict_tools:
                entry["strict"] = True
            out.append(entry)
        return out

    def _to_items(self, messages: List[Dict[str, Any]]):
        """Messages → (instructions, item list). A leading system message becomes
        the top-level ``instructions``, a later one a ``developer``/``system`` item.
        """
        instructions = None
        items: List[Dict[str, Any]] = []

        for i, msg in enumerate(messages):
            # Replayed tool activity arrives as bare wire items (`type`, no `role`).
            if msg.get("type") in ("function_call", "function_call_output"):
                items.append(msg)
                continue

            role = msg.get("role", "user")
            content = msg.get("content")

            if role == "system" and i == 0:
                instructions = _flatten(content)
                continue
            if role == "system":
                role = "developer" if self.quirks.developer_role else "system"

            # An assistant turn we appended ourselves carries wire items inline.
            if isinstance(content, list) and content and all(
                isinstance(b, dict) and b.get("type") in ("function_call",
                                                          "function_call_output")
                for b in content
            ):
                items.extend(content)
                continue

            text = _flatten(content)
            if text:
                items.append({"type": "message", "role": role, "content": text})

        return instructions, items

    @staticmethod
    def _attach_media(items: List[Dict[str, Any]],
                      media: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        images = normalize_media(media)
        if not images:
            return items

        out = list(items)
        for i in range(len(out) - 1, -1, -1):
            if out[i].get("type") != "message" or out[i].get("role") != "user":
                continue
            parts: List[Any] = [
                {"type": "input_image",
                 "image_url": f"data:{m['mime_type']};base64,{m['data']}"}
                for m in images
            ]
            text = out[i].get("content")
            if isinstance(text, str) and text.strip():
                parts.insert(0, {"type": "input_text", "text": text})
            out[i] = {**out[i], "content": parts}
            logger.debug("Attached %d image(s) to the last user item", len(images))
            break
        return out

    # ── history ──────────────────────────────────────────────────────────────

    def encode_history(self, executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Per iteration: every ``function_call``, then every matching output —
        the endpoint requires a call to be followed by its output."""
        out: List[Dict[str, Any]] = []
        for iteration, entries in self.by_iteration(executions):
            for e in entries:
                args = e.get("arguments") or {}
                out.append({
                    "type": "function_call",
                    "call_id": e.get("id") or f"call_{e.get('tool_name')}_{iteration}",
                    "name": e.get("tool_name"),
                    "arguments": args if isinstance(args, str) else json.dumps(args),
                })
            for e in entries:
                content = self.replay_content(e)
                out.append({
                    "type": "function_call_output",
                    "call_id": e.get("id") or f"call_{e.get('tool_name')}_{iteration}",
                    "output": content if isinstance(content, str) else json.dumps(content),
                })
        return out

    def extend(self, messages: List[Dict[str, Any]], reply: Reply,
               executions: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        out = list(messages)
        if reply.text:
            out.append({"role": "assistant", "content": reply.text})
        out.append({"role": "assistant", "content": [
            *[{"type": "function_call", "call_id": c.id, "name": c.name,
               "arguments": json.dumps(c.arguments)} for c in reply.tool_calls],
            *[{"type": "function_call_output", "call_id": e["id"],
               "output": (lambda v: v if isinstance(v, str) else json.dumps(v))(
                   self.replay_content(e))} for e in executions],
        ]})
        return out

    # ── stream ───────────────────────────────────────────────────────────────

    async def stream(self, turn: Turn) -> AsyncIterator[Delta]:
        payload = self.encode(turn)
        reply = Reply(model=turn.model)
        partial: Dict[str, Dict[str, Any]] = {}

        async for event in self.sse(self.url(self._path), payload):
            kind = event.get("type", "")

            if kind == "response.output_text.delta":
                reply.text += event.get("delta", "")
                yield Delta(reply=reply)

            elif kind in ("response.reasoning_summary_text.delta",
                          "response.reasoning_text.delta"):
                reply.thinking += event.get("delta", "")
                yield Delta(reply=reply)

            elif kind == "response.output_item.added":
                item = event.get("item") or {}
                if item.get("type") == "function_call":
                    partial[item.get("id") or item.get("call_id")] = {
                        "call_id": item.get("call_id") or item.get("id"),
                        "name": item.get("name"), "json": "",
                    }

            elif kind == "response.function_call_arguments.delta":
                slot = partial.get(event.get("item_id"))
                if slot is not None:
                    slot["json"] += event.get("delta", "")

            elif kind == "response.completed":
                response = event.get("response") or {}
                reply.model = response.get("model") or reply.model
                reply.finish_reason = response.get("status") or "stop"
                reply.usage.update(_usage(response.get("usage") or {}))

            elif kind == "error":
                message = (event.get("error") or {}).get("message", "unknown error")
                raise RuntimeError(f"Generation failed: {message}")

        for slot in partial.values():
            if not slot.get("name"):
                continue
            try:
                args = json.loads(slot["json"]) if slot["json"] else {}
            except json.JSONDecodeError:
                logger.error("Unparseable tool arguments for %s: %.120s",
                             slot["name"], slot["json"])
                args = {}
            reply.tool_calls.append(
                ToolCall(id=slot["call_id"] or f"call_{slot['name']}",
                         name=slot["name"], arguments=args)
            )

        yield Delta(reply=reply, done=True)


# ── helpers ───────────────────────────────────────────────────────────────────


def _flatten(content: Any) -> str:
    """Content blocks → plain text: callers hand every dialect the same block
    lists, and this wire has no block form."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n\n".join(
            b.get("text", "") for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ).strip()
    return ""


def _tool_choice(choice):
    if isinstance(choice, dict) and choice.get("tool"):
        return {"type": "function", "name": choice["tool"]}
    return TOOL_CHOICE.get(choice)


def _usage(raw: Dict[str, Any]) -> Dict[str, int]:
    out = usage_from(raw, USAGE_KEYS)
    out.update(usage_from(raw.get("input_tokens_details") or {}, INPUT_DETAIL_KEYS))
    out.update(usage_from(raw.get("output_tokens_details") or {}, OUTPUT_DETAIL_KEYS))
    return out
