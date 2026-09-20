"""
language/transforms.py — shared shaping, called by every dialect.
=================================================================

  TOOL RESULTS
    tool_result(result, name)  ──►  ToolOutcome (llm_content · display ·
                                     error). content_blocks ─► an
                                     image-returning tool. _terminate_loop /
                                     _load_tools sentinels read by the engine.

  MEDIA
    normalize_media(media)  ──►  allowlist ─► magic-byte check ─► size cap
                                  ──► [{mime_type, data (b64), raw_bytes}]

  SCHEMAS
    shape_schema(schema, strict=)  ──►  strict: additionalProperties=False,
                                         required=every key, recursed into
                                         items/not/if/then/else, anyOf/oneOf/
                                         allOf, $defs

  DECODE SALVAGE                 (only where a quirk says the wire needs it —
    salvage_thinking(text)        see TurnsQuirks.thinking_tags)
      ──► (thinking, clean_text); handles both <think>…</think> and a bare
          trailing </think> some models emit with no opening tag
    salvage_tool_calls(text)  ──►  [ToolCall, …] recovered from prose JSON

  TOOL DEFS / USAGE / TRANSCRIPT
    tool_parts(tool)       ──►  ToolDef, from an MCP / OpenAI-nested / bare
                                 tool-dict shape, or None to skip it
    usage_from(raw, keys)  ──►  wire usage dict → ours, via a key table
    join_transcript(prefix, current)  ──►  prefix + current, \n\n-joined

  NOT IN THIS FILE
    dialects/*.py   the one caller of each of these per wire.
    engine.py       join_transcript's other caller — the Ledger.

No speculative helpers: a step lands here only once a SECOND dialect actually
reuses it. Four old copies of the tool-result split had drifted; only one
supported image-returning tools, so three endpoints silently broke on them.
"""

from __future__ import annotations

import base64
import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple, Union

from app.api.modules.foundation_service_providers.language import (
    ALLOWED_IMAGE_TYPES, MAX_IMAGE_BYTES, ToolCall, ToolDef, ToolOutcome,
)

logger = logging.getLogger(__name__)

#: Required leading bytes — upstream MIME detectors mislabel, vendors 400.
MAGIC_BYTES = {
    "image/jpeg": (b"\xff\xd8\xff",),
    "image/png": (b"\x89PNG\r\n\x1a\n",),
    "image/gif": (b"GIF87a", b"GIF89a"),
}

#: JSON-schema keys whose values are themselves schemas, so shaping recurses.
SCHEMA_BRANCH_KEYS = ("items", "not", "if", "then", "else")


# ── Tool results ──────────────────────────────────────────────────────────────


def tool_result(result: Any, tool_name: str) -> ToolOutcome:
    """Split a tool's return into what the model sees and what the UI renders.

    A tool may return:
      * ``{"content": str, "structured_content": ...}`` — a summary for the
        model, full data for the interface. The common case.
      * ``{"content_blocks": [...]}`` — typed blocks, which is how a tool
        returns an **image**. Only one of the four old copies understood this.
      * ``{"error": ...}`` — a failure the model should see and can react to.
      * anything else — serialized to both.

    Two sentinels are recognised because the engine acts on them:
    ``_terminate_loop`` ends the loop cleanly (otherwise ``tool_choice="any"``
    forces another call and the loop only stops at the iteration cap), and
    ``_load_tools`` grows the tool set mid-turn.
    """
    if hasattr(result, "model_dump"):
        result = result.model_dump()
    elif not isinstance(result, (dict, list, str, int, float, bool, type(None))):
        result = str(result)

    if not isinstance(result, dict):
        payload = result if isinstance(result, str) else json.dumps(result)
        return ToolOutcome(llm_content=payload, display=result)

    error = result.get("error")
    terminate = bool(result.get("_terminate_loop"))
    load_tools = result.get("_load_tools") or []

    if error:
        # Verbatim, on replay too, so the model never retries a known failure.
        return ToolOutcome(
            llm_content=json.dumps(result), display=result,
            error=str(error), terminate=terminate, load_tools=load_tools,
        )

    blocks = result.get("content_blocks")
    if isinstance(blocks, list) and blocks and all(
        isinstance(b, dict) and b.get("type") in ("text", "image") for b in blocks
    ):
        return ToolOutcome(
            llm_content=blocks,
            display=result.get("structured_content", result),
            terminate=terminate, load_tools=load_tools,
        )

    content = result.get("content")
    if not content:
        # No summary: sending the whole payload would blow the context.
        content = f"[Tool {tool_name} executed - no summary available]"

    return ToolOutcome(
        llm_content=content,
        display=result.get("structured_content", result),
        terminate=terminate, load_tools=load_tools,
    )


# ── Media ─────────────────────────────────────────────────────────────────────


def normalize_media(media: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Validate and base64-encode image inputs. Drops what cannot be sent.

    Returns entries of ``{mime_type, data (base64 str), raw_bytes}``.

    Three checks, all salvaged from the one provider that had them:

    1. **Type allowlist** — anything else is not an image we can send.
    2. **Magic bytes must match the claimed MIME.** Upstream detectors fall back
       to ``image/png`` when the content is really a PDF or another container;
       sending those produces a generic "could not process image" 400 that is
       miserable to diagnose. Reject at this boundary instead of trusting the
       label.
    3. **Size cap.** Skip an oversized image rather than failing the whole
       request — the text still reaches the model, and the skip is logged so the
       operator can fix it upstream (usually by lowering PDF render DPI).
    """
    out: List[Dict[str, Any]] = []

    for item in media or []:
        if item.get("type") != "image":
            continue

        mime = item.get("mime_type", "image/png")
        if mime not in ALLOWED_IMAGE_TYPES:
            logger.warning("Unsupported image type %s — skipping", mime)
            continue

        data = item.get("content")
        if not isinstance(data, bytes) or not data:
            logger.warning("Image content is %s, not non-empty bytes — skipping", type(data))
            continue

        if mime == "image/webp":
            mismatched = not (data.startswith(b"RIFF") and b"WEBP" in data[8:12])
        else:
            prefixes = MAGIC_BYTES.get(mime, ())
            mismatched = bool(prefixes) and not any(data.startswith(p) for p in prefixes)
        if mismatched:
            logger.warning(
                "Image %s claims %s but magic bytes %r disagree — skipping "
                "(likely a non-image container mislabeled upstream)",
                item.get("uuid") or "<unknown>", mime, data[:16],
            )
            continue

        if len(data) > MAX_IMAGE_BYTES:
            logger.warning(
                "Image %s is %.2f MB, over the %.2f MB cap — skipping. "
                "Lower the render DPI or downsize upstream.",
                item.get("uuid") or "<unknown>",
                len(data) / (1024 * 1024), MAX_IMAGE_BYTES / (1024 * 1024),
            )
            continue

        out.append({
            "mime_type": mime,
            "data": base64.b64encode(data).decode("utf-8"),
            "raw_bytes": len(data),
        })

    return out


# ── Schemas ───────────────────────────────────────────────────────────────────


def shape_schema(schema: Dict[str, Any], *, strict: bool = False) -> Dict[str, Any]:
    """Prepare a JSON schema for a structured-output request.

    ``strict`` mode (OpenAI) demands ``additionalProperties: false`` on every
    object and *every* property listed in ``required``, and rejects ``default``.
    Other endpoints accept the schema as authored. Recursion covers ``items``,
    ``$defs``, the union keywords and the conditional keywords, because a nested
    object that misses the treatment fails the whole request.
    """
    if not isinstance(schema, dict):
        return schema
    if not strict:
        return schema

    out = {k: v for k, v in schema.items() if k != "default"}

    is_object = (
        "properties" in out
        or out.get("type") == "object"
        or any(k in out for k in ("required", "patternProperties", "propertyNames"))
    )
    if is_object:
        out["additionalProperties"] = False

    props = out.get("properties")
    if isinstance(props, dict):
        out["required"] = list(props.keys())
        out["properties"] = {k: shape_schema(v, strict=True) for k, v in props.items()}

    for key in SCHEMA_BRANCH_KEYS:
        if isinstance(out.get(key), dict):
            out[key] = shape_schema(out[key], strict=True)

    for key in ("anyOf", "oneOf", "allOf"):
        if isinstance(out.get(key), list):
            out[key] = [shape_schema(i, strict=True) for i in out[key]]

    if isinstance(out.get("$defs"), dict):
        out["$defs"] = {k: shape_schema(v, strict=True) for k, v in out["$defs"].items()}

    return out


# ── Decode salvage ────────────────────────────────────────────────────────────

_THINK_BLOCK = re.compile(r"<think>(.*?)</think>", re.DOTALL)
_TOOLCALL_JSON = re.compile(r'\{[^{}]*"function"[^{}]*\}')


def salvage_thinking(content: str) -> Tuple[Optional[str], str]:
    """Pull inline ``<think>`` reasoning out of a content stream.

    Returns ``(thinking, clean_content)``.

    Handles the Qwen shape as well as the complete one: some models bake the
    *opening* tag into their chat template and emit only ``</think>``, so
    everything before that marker is the reasoning. Treating that as content
    leaks a model's scratchpad into the answer.
    """
    matches = _THINK_BLOCK.findall(content)
    if matches:
        return "\n".join(m.strip() for m in matches), _THINK_BLOCK.sub("", content).strip()

    if "</think>" in content and "<think>" not in content:
        head, _, tail = content.partition("</think>")
        if head.strip():
            return head.strip(), tail.strip()

    return None, content


def salvage_tool_calls(content: str) -> List[ToolCall]:
    """Recover tool calls a model emitted as prose instead of structured output.

    Only used where ``native_tool_parsing`` is false. Small local models
    routinely describe the call in text rather than using the grammar, and
    losing those turns the loop into a no-op.
    """
    calls: List[ToolCall] = []
    for i, match in enumerate(_TOOLCALL_JSON.findall(content or "")):
        try:
            parsed = json.loads(match)
        except json.JSONDecodeError:
            continue
        fn = parsed.get("function")
        if not isinstance(fn, dict) or not fn.get("name"):
            continue
        args = fn.get("arguments") or {}
        if isinstance(args, str):
            try:
                args = json.loads(args)
            except json.JSONDecodeError:
                args = {}
        calls.append(ToolCall(id=f"salvaged_{fn['name']}_{i}", name=fn["name"], arguments=args))
    if calls:
        logger.info("Salvaged %d tool call(s) from prose", len(calls))
    return calls


def join_transcript(prefix: str, current: str) -> str:
    """Join completed-iteration narration with the current turn's text.

    ``content`` is cumulative on the wire to the frontend, which *assigns* it on
    every chunk rather than appending. Without carrying the prefix, a later
    tool-loop iteration's text overwrites everything the model said before it
    and the message appears to vanish.
    """
    if prefix and current:
        return f"{prefix}\n\n{current}"
    return prefix or current


# ── Tool definitions ──────────────────────────────────────────────────────────


def tool_parts(tool: Dict[str, Any]) -> Optional[ToolDef]:
    """Any tool-dict shape → one ToolDef, or None to skip it.

    Callers hand us three shapes interchangeably — MCP, OpenAI-nested and bare.
    ``output_schema`` is optional and rides along: the MCP client populates it
    whenever a server declares one, and dropping it silently stripped that
    contract before it reached the endpoint.
    """
    if tool.get("type") == "function" and isinstance(tool.get("function"), dict):
        src = tool["function"]
    else:
        src = tool

    name = src.get("name")
    parameters = src.get("parameters") or src.get("input_schema")
    if not name or not parameters:
        logger.warning("Skipping tool with no name or parameters: %s", str(tool)[:120])
        return None

    return ToolDef(
        name=name,
        description=src.get("description") or f"Execute {name}",
        parameters=parameters,
        output_schema=src.get("output_schema") or tool.get("output_schema"),
    )

def usage_from(raw: Dict[str, Any], keys: Dict[str, str]) -> Dict[str, int]:
    """Wire usage dict → ours, via the caller's key table. Ints only."""
    return {ours: raw[theirs] for theirs, ours in keys.items()
            if isinstance(raw.get(theirs), int)}
