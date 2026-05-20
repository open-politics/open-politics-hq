"""
Anthropic Language Model Provider Implementation using Native Anthropic SDK

This implementation uses the official Anthropic Python SDK for full feature support:
- Extended thinking with proper thinking block exposure
- Tool use with correct content block formatting
- Interleaved thinking support
- Prompt caching, PDFs, citations, and all native features
- Vision (image inputs) with proper content block formatting

For tool use with extended thinking, this properly preserves thinking blocks
as required by Anthropic's API.

Image Support:
- Images are passed via media_inputs in kwargs
- Supports base64 image sources (jpeg, png, gif, webp)
- Images placed before text for optimal performance
- Tool results can include image content blocks
"""
import logging
import json
import base64
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Callable, Awaitable

from app.api.modules.foundation_service_providers.base import LanguageModelProvider, ModelInfo, GenerationResponse
from app.core.config import settings

logger = logging.getLogger(__name__)


# Curated Claude model registry — the single source of truth for per-model
# ``max_tokens`` (hard output ceiling) and ``context_length``. Used both by
# ``discover_models`` (to populate ModelInfo) and by ``_generate`` (to set the
# default request cap dynamically). Update this list when Anthropic ships new
# models or raises ceilings.
#
# Why this matters: ``max_tokens`` is a *ceiling*, not a target. Claude stops
# at end_turn when the response is complete and never pads up to the cap. So
# defaulting to the model's hard limit costs nothing on small responses while
# letting complex structured-output schemas (deep nested arrays — triplets,
# actors, indicators, financial records) finish without truncation.
CLAUDE_MODEL_REGISTRY: List[Dict[str, Any]] = [
    {
        "name": "claude-sonnet-4-6",
        "description": "Claude Sonnet 4.6 - Latest Sonnet with enhanced reasoning",
        "supports_thinking": True,
        "max_tokens": 64_000,
        "context_length": 200_000,
    },
    {
        "name": "claude-opus-4-6",
        "description": "Claude Opus 4.6 - Most capable model for complex tasks",
        "supports_thinking": True,
        "max_tokens": 32_000,
        "context_length": 200_000,
    },
    {
        "name": "claude-opus-4-7",
        "description": "Claude Opus 4.7 - Most capable model",
        "supports_thinking": True,
        "max_tokens": 32_000,
        "context_length": 200_000,
    },
    {
        "name": "claude-haiku-4-5",
        "description": "Claude Haiku 4.5 - Fast, affordable",
        "supports_thinking": False,
        "max_tokens": 64_000,
        "context_length": 200_000,
    },
]

# Lookup index for O(1) ceiling resolution from any code path.
CLAUDE_MAX_TOKENS_BY_NAME: Dict[str, int] = {
    m["name"]: m["max_tokens"] for m in CLAUDE_MODEL_REGISTRY if m.get("max_tokens")
}

# Floor used when the requested model isn't in the registry (e.g. a user
# typed a free-form name, or Anthropic shipped a new model we haven't added).
# Generous enough for most structured-output schemas; well under any current
# Claude model's hard ceiling so the API itself won't reject it.
DEFAULT_MAX_TOKENS_FALLBACK = 16_384


def _resolve_max_output_tokens(model_name: str) -> int:
    """Return the dynamic default ``max_tokens`` for a Claude model.

    Looks up the model in ``CLAUDE_MAX_TOKENS_BY_NAME``; falls back to
    ``DEFAULT_MAX_TOKENS_FALLBACK`` for unknown names. Used as the request
    default — caller-passed ``max_tokens`` always wins over this.
    """
    return CLAUDE_MAX_TOKENS_BY_NAME.get(model_name, DEFAULT_MAX_TOKENS_FALLBACK)


def _splice_tool_history_anthropic(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Expand assistant messages carrying ``tool_executions`` into native Anthropic shape.

    Each assistant message that carries prior tool history is replaced by a sequence:
        [assistant content=[tool_use, …]  →  user content=[tool_result, …]]  per iteration,
    followed by the assistant's final text content (the message's own ``content``).
    This restores the model's view across turn boundaries — without it, only the
    final text and any ``<tool_results .../>`` markers survive and the actual JSON
    the tool returned is gone by the next turn.

    Tool results are taken from the ``model_view`` field (the exact ``llm_content``
    the model received on the original turn). Falls back to ``structured_content``
    serialised as JSON for legacy entries that pre-date ``model_view``.
    """
    out: List[Dict[str, Any]] = []
    for msg in messages:
        if msg.get("role") != "assistant" or not msg.get("tool_executions"):
            out.append(msg)
            continue

        execs: List[Dict[str, Any]] = msg["tool_executions"] or []
        # Group by iteration so each tool_use has its tool_result in the immediately
        # following user message, which Anthropic requires.
        by_iter: Dict[int, List[Dict[str, Any]]] = {}
        for ex in execs:
            by_iter.setdefault(ex.get("iteration", 1), []).append(ex)

        for it in sorted(by_iter.keys()):
            replayable = [e for e in by_iter[it] if _replay_content(e) is not None]
            if not replayable:
                continue

            tool_use_blocks = [
                {
                    "type": "tool_use",
                    "id": e.get("id") or f"toolu_{e.get('tool_name')}_{it}",
                    "name": e.get("tool_name"),
                    "input": e.get("arguments") or {},
                }
                for e in replayable
            ]
            out.append({"role": "assistant", "content": tool_use_blocks})

            tool_result_blocks = []
            for e in replayable:
                content = _replay_content(e)
                block: Dict[str, Any] = {
                    "type": "tool_result",
                    "tool_use_id": e.get("id") or f"toolu_{e.get('tool_name')}_{it}",
                    "content": content if isinstance(content, (str, list)) else json.dumps(content),
                }
                # Mirror the original turn's is_error flag so the model can recognise
                # historical failures on replay, not just successes.
                if e.get("error") or e.get("status") == "failed":
                    block["is_error"] = True
                tool_result_blocks.append(block)
            out.append({"role": "user", "content": tool_result_blocks})

        # Final assistant text — keep the model's own prose (with any markers) so
        # subsequent reasoning has both the raw tool data AND the model's last summary.
        final_text = msg.get("content") or ""
        if isinstance(final_text, str) and final_text.strip():
            out.append({"role": "assistant", "content": final_text})

    return out


_CACHE_CONTROL_EPHEMERAL = {"type": "ephemeral"}


def _apply_cache_markers_to_messages(messages: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Translate ``{cacheable: True}`` markers on user/assistant content blocks.

    Callers (Phase B in particular) tag the document text block as cacheable so
    the prefix lands in Anthropic's ephemeral cache and subsequent loop turns
    re-use it at ~10% the input cost. The marker is stripped before sending —
    the SDK rejects unknown keys.
    """
    out: List[Dict[str, Any]] = []
    for msg in messages:
        content = msg.get("content")
        if not isinstance(content, list):
            out.append(msg)
            continue
        new_blocks: List[Any] = []
        for block in content:
            if isinstance(block, dict) and block.pop("cacheable", False):
                # Anthropic accepts cache_control on text / image / tool_use /
                # tool_result blocks. Setting it here is safe across types.
                block.setdefault("cache_control", _CACHE_CONTROL_EPHEMERAL)
            new_blocks.append(block)
        new_msg = dict(msg)
        new_msg["content"] = new_blocks
        out.append(new_msg)
    return out


def _apply_cache_markers_to_tools(tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Same translation for tool definitions. Each tool dict that carries
    ``cacheable=True`` gets ``cache_control: ephemeral`` so the tool surface
    stays in the cached prefix across the loop's turns."""
    out: List[Dict[str, Any]] = []
    for tool in tools:
        if isinstance(tool, dict) and tool.pop("cacheable", False):
            tool = dict(tool)
            tool.setdefault("cache_control", _CACHE_CONTROL_EPHEMERAL)
        out.append(tool)
    return out


def _build_structured_system(system_messages: List[Any]) -> Any:
    """Coalesce extracted system messages into the Anthropic system parameter.

    When any fragment is a content-block list carrying ``cacheable``, we keep
    the structured form (list of typed blocks) so cache_control can attach.
    Otherwise we fall back to the simple concatenated string form for
    backward compatibility with everything that came before.
    """
    has_blocks = any(isinstance(s, list) for s in system_messages)
    if not has_blocks:
        # Plain strings → preserve old single-string shape.
        return "\n\n".join(s for s in system_messages if isinstance(s, str))

    blocks: List[Dict[str, Any]] = []
    for fragment in system_messages:
        if isinstance(fragment, str):
            if fragment.strip():
                blocks.append({"type": "text", "text": fragment})
            continue
        if isinstance(fragment, list):
            for b in fragment:
                if not isinstance(b, dict):
                    continue
                b = dict(b)
                if b.pop("cacheable", False):
                    b.setdefault("cache_control", _CACHE_CONTROL_EPHEMERAL)
                blocks.append(b)
    return blocks


def _replay_content(execution: Dict[str, Any]) -> Any:
    """Pick the correct content for a tool_result block on replay.

    Prefers ``model_view`` (the exact bytes the model saw originally — faithful
    replay). Falls back to ``structured_content`` / ``result`` serialised as JSON
    for legacy entries written before ``model_view`` was introduced. Returns
    ``None`` for entries that have no replayable content (e.g. failed tool calls).
    """
    mv = execution.get("model_view")
    if mv is not None:
        return mv
    sc = execution.get("structured_content") or execution.get("result")
    if sc is None:
        return None
    return sc if isinstance(sc, str) else json.dumps(sc, ensure_ascii=False)


class AnthropicLanguageModelProvider(LanguageModelProvider):
    """
    Anthropic (Claude) implementation using the native Anthropic SDK.
    Handles chat, structured output, tool calls, and streaming with full feature support.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.anthropic.com"):
        try:
            from anthropic import AsyncAnthropic
        except ImportError:
            raise ImportError("Anthropic SDK not installed. Run: pip install anthropic")

        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        # AsyncAnthropic is required here — this provider is called from an
        # asyncio event loop (annotate.process_assets_parallel). A sync client
        # would block the loop and serialize all concurrent annotations,
        # defeating the `concurrency_limit` semaphore.
        self.client = AsyncAnthropic(
            api_key=api_key,
            base_url=base_url
        )
        self._model_cache = {}
        logger.info(f"Anthropic provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Discover available Anthropic Claude models.
        
        Returns a curated list of Claude models with their capabilities.
        """
        try:
            models = []
            for model_data in CLAUDE_MODEL_REGISTRY:
                model_info = ModelInfo(
                    name=model_data["name"],
                    provider="anthropic",
                    supports_structured_output=True,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_thinking=model_data.get("supports_thinking", False),
                    supports_multimodal=True,  # Claude supports image inputs
                    supports_prompt_caching=True,  # cache_control: ephemeral on every Claude 4 model
                    max_tokens=model_data.get("max_tokens"),
                    context_length=model_data.get("context_length"),
                    description=model_data["description"]
                )
                models.append(model_info)
                self._model_cache[model_data["name"]] = model_info
            
            logger.info(f"Discovered {len(models)} Anthropic Claude models")
            return models
         
        except Exception as e:
            logger.error(f"Failed to discover Anthropic models: {e}")
            return []
    
    def _prepare_content_with_media(
        self,
        text_content: Union[str, List[Dict]],
        media_inputs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Convert text + media_inputs into Anthropic content blocks.
        
        Images are placed BEFORE text (Anthropic best practice for better performance).
        
        Args:
            text_content: Text string or existing content blocks array
            media_inputs: List of media items with type, content (bytes), mime_type
            
        Returns:
            List of content blocks formatted for Anthropic API
        """
        content_blocks = []
        
        # Add images FIRST (Anthropic best practice)
        for media in media_inputs:
            if media.get("type") != "image":
                continue  # Skip non-image media for now
            
            # Validate media type
            mime_type = media.get("mime_type", "image/png")
            allowed_types = ["image/jpeg", "image/png", "image/gif", "image/webp"]
            
            if mime_type not in allowed_types:
                logger.warning(f"Unsupported image type: {mime_type}, skipping (allowed: {allowed_types})")
                continue
            
            # Get image bytes
            image_bytes = media.get("content")
            if not isinstance(image_bytes, bytes):
                logger.warning(f"Image content is not bytes (got {type(image_bytes)}), skipping")
                continue

            if len(image_bytes) == 0:
                logger.warning("Image content is empty, skipping")
                continue

            # Sanity-check: the claimed MIME must match the actual magic bytes.
            # Upstream detectors sometimes fall back to ``image/png`` when the
            # content is really a PDF or another container — sending those as
            # PNG produces Anthropic's generic "Could not process image" 400.
            # Reject mismatched payloads at this boundary instead of trusting
            # the upstream label.
            MAGIC = {
                "image/jpeg": (b"\xff\xd8\xff",),
                "image/png": (b"\x89PNG\r\n\x1a\n",),
                "image/gif": (b"GIF87a", b"GIF89a"),
                "image/webp": None,  # RIFF...WEBP — checked separately
            }
            mismatched = False
            if mime_type == "image/webp":
                if not (image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[8:12]):
                    mismatched = True
            else:
                prefixes = MAGIC.get(mime_type) or ()
                if prefixes and not any(image_bytes.startswith(p) for p in prefixes):
                    mismatched = True
            if mismatched:
                logger.warning(
                    "Image %s claimed as %s but magic bytes %r disagree; skipping. "
                    "(Likely a non-image container mislabeled upstream.)",
                    media.get("uuid") or "<unknown>",
                    mime_type,
                    image_bytes[:16],
                )
                continue

            # Anthropic hard-rejects images whose base64 payload exceeds ~5MB.
            # Raw → base64 inflates by 4/3, so we cap raw bytes at ~3.75MB. Skip
            # oversized images rather than letting the whole request 400 — the
            # text content still reaches the model, and the skip is logged for
            # the operator to address upstream (e.g. lower PDF render DPI).
            MAX_RAW_BYTES = 3_750_000
            if len(image_bytes) > MAX_RAW_BYTES:
                logger.warning(
                    "Image %s (%s) is %.2fMB — exceeds Anthropic's ~5MB base64 cap; skipping. "
                    "Consider lowering render DPI or downsizing upstream.",
                    media.get("uuid") or media.get("metadata", {}).get("title") or "<unknown>",
                    mime_type,
                    len(image_bytes) / (1024 * 1024),
                )
                continue

            # Convert to base64
            try:
                image_base64 = base64.b64encode(image_bytes).decode('utf-8')
            except Exception as e:
                logger.error(f"Failed to encode image to base64: {e}")
                continue
            
            # Add image block
            content_blocks.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": image_base64
                }
            })
            
            logger.debug(f"Added image block: {mime_type}, {len(image_bytes)} bytes")
        
        # Add text content AFTER images
        if isinstance(text_content, list):
            # Already content blocks - extend them
            content_blocks.extend(text_content)
        elif isinstance(text_content, str) and text_content.strip():
            # String - wrap in text block
            content_blocks.append({
                "type": "text",
                "text": text_content
            })
        
        return content_blocks
    
    async def generate(self, 
                      messages: List[Dict[str, str]],
                      model_name: str,
                      response_format: Optional[Dict] = None,
                      tools: Optional[List[Dict]] = None,
                      stream: bool = False,
                      thinking_enabled: bool = False,
                      tool_executor: Optional[Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]]] = None,
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        """
        Generate response using Anthropic's native SDK.
        
        Supports image inputs via media_inputs in kwargs:
        - media_inputs: List of dicts with {type: "image", content: bytes, mime_type: str}
        - Images are added to the last user message in content blocks format
        """
        # Extract media_inputs from kwargs
        media_inputs = kwargs.pop("media_inputs", [])
        if media_inputs:
            logger.info(f"Processing {len(media_inputs)} media inputs for Anthropic")

        # Splice prior tool turns: any assistant message carrying `tool_executions`
        # gets expanded into native [assistant tool_use → user tool_result → assistant text]
        # so the model can see what its earlier tool calls returned. Without this,
        # tool data evaporates at the turn boundary.
        messages = _splice_tool_history_anthropic(messages)

        # Extract system messages - Anthropic requires them in a separate parameter
        system_messages = []
        non_system_messages = []

        for msg in messages:
            # Skip messages with empty content (Anthropic requirement). Block-list
            # contents (tool_use / tool_result) are kept as-is.
            content = msg.get("content", "")
            if isinstance(content, str) and not content.strip():
                logger.warning(f"Skipping message with empty content: role={msg.get('role')}")
                continue
            if isinstance(content, list) and not content:
                continue

            if msg.get("role") == "system":
                system_messages.append(content)
            else:
                non_system_messages.append(msg)
        
        # Process messages: add media to LAST user message if media_inputs provided
        processed_messages = []
        last_msg_idx = len(non_system_messages) - 1
        
        for idx, msg in enumerate(non_system_messages):
            # Add media only to last message if it's a user message and we have media
            if idx == last_msg_idx and msg.get("role") == "user" and media_inputs:
                content_blocks = self._prepare_content_with_media(
                    msg["content"], 
                    media_inputs
                )
                processed_messages.append({
                    "role": "user",
                    "content": content_blocks
                })
                logger.debug(f"Added {len([b for b in content_blocks if b.get('type') == 'image'])} images to last user message")
            else:
                # Keep message as-is
                processed_messages.append(msg)
        
        # Dynamic ``max_tokens``: default to the model's hard output ceiling
        # from the registry. ``max_tokens`` is a cap, not a target — Claude
        # stops at end_turn naturally — so high defaults cost nothing on
        # small responses while letting complex structured-output schemas
        # finish. Caller-passed ``max_tokens`` (e.g. cost-bounded streaming)
        # always wins over the registry default.
        resolved_max_tokens = kwargs.get("max_tokens") or _resolve_max_output_tokens(model_name)

        # Translate the protocol-level ``cacheable=True`` markers into Anthropic's
        # native ``cache_control: {type: "ephemeral"}`` form. Callers tag any
        # content block (or tool definition) they want kept in the prefix cache;
        # the marker is stripped before sending so the SDK doesn't choke on
        # unknown keys.
        processed_messages = _apply_cache_markers_to_messages(processed_messages)

        base_params = {
            "model": model_name,
            "messages": processed_messages,
            "max_tokens": resolved_max_tokens,
        }

        # Add system parameter if we have system messages.
        # We promote system to the structured form when ANY system fragment
        # carries a cacheable marker, so cache_control can attach.
        if system_messages:
            structured_system = _build_structured_system(system_messages)
            base_params["system"] = structured_system
            logger.debug(f"Extracted {len(system_messages)} system message(s) to system parameter")

        # Add tools if provided
        if tools:
            base_params["tools"] = _apply_cache_markers_to_tools(self._prepare_tools_for_anthropic(tools))
        
        # Add other parameters
        if "temperature" in kwargs:
            # Anthropic caps temperature at 1.0
            temp = min(kwargs["temperature"], 1.0)
            base_params["temperature"] = temp
        if "top_p" in kwargs:
            base_params["top_p"] = kwargs["top_p"]
        if "stop_sequences" in kwargs:
            base_params["stop_sequences"] = kwargs["stop_sequences"]
        # Caller-provided tool_choice (e.g. ``{"type": "any"}`` to force any
        # tool, or ``{"type": "tool", "name": "submit"}`` to force a specific
        # one) wins over the structured-output default below.
        if "tool_choice" in kwargs:
            base_params["tool_choice"] = kwargs["tool_choice"]

        # Caller-tunable iteration cap for the tool loop. Stored under a
        # leading-underscore key so the loop wrapper pops it before sending
        # to the SDK (the SDK rejects unknown keys). Default 20 is set in
        # the wrapper itself; callers can raise it for dense extraction.
        if "max_tool_iterations" in kwargs:
            base_params["_max_tool_iterations"] = kwargs.pop("max_tool_iterations")
        
        # Add extended thinking support if enabled
        if thinking_enabled:
            model_info = self._model_cache.get(model_name)
            if model_info and model_info.supports_thinking:
                base_params["thinking"] = {
                    "type": "enabled",
                    "budget_tokens": kwargs.get("thinking_budget_tokens", 2000)
                }
                logger.info(f"Enabled extended thinking for {model_name}")
        
        # Anthropic enforces structured output via tool_choice (forced tool call)
        if response_format and not tools:
            base_params["tools"] = [{
                "name": "extract",
                "description": "Extract structured data",
                "input_schema": response_format
            }]
            base_params["tool_choice"] = {"type": "tool", "name": "extract"}
            logger.info("Enforcing structured output via forced tool call")
        
        # Execute with or without tool loop
        if tool_executor and tools:
            if stream:
                logger.info("Anthropic streaming with tools: wrapping tool loop execution")
                return self._stream_tool_loop_wrapper(base_params, tool_executor)
            else:
                logger.info("Anthropic with tools: executing tool loop")
                return await self._tool_loop_generate(base_params, tool_executor)
        else:
            if stream:
                return self._stream_generate(base_params)
            else:
                return await self._generate(base_params)
    
    def _extract_tool_result_streams(self, tool_result: Any, tool_name: str) -> tuple[Union[str, List[Dict]], Any]:
        """
        Extract separate LLM and frontend streams from tool result.
        
        NEW: Supports Anthropic content blocks for tools that return images.
        Tools can return: {"content_blocks": [{type: "text", ...}, {type: "image", ...}]}
        
        Returns:
            Tuple of (llm_content, frontend_data) where:
            - llm_content: String OR array of content blocks (for images)
            - frontend_data: Full structured data for UI rendering
        """
        # Ensure serializable
        if hasattr(tool_result, 'model_dump'):
            tool_result = tool_result.model_dump()
        elif not isinstance(tool_result, (dict, list, str, int, float, bool, type(None))):
            tool_result = str(tool_result)
        
        # Check for error
        is_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
        
        if isinstance(tool_result, dict) and not is_error:
            # NEW: Check if tool result has Anthropic content blocks
            # Tools can return: {"content_blocks": [{type: "text", ...}, {type: "image", ...}]}
            if "content_blocks" in tool_result:
                content_blocks = tool_result["content_blocks"]
                # Validate it's a proper content blocks array
                if isinstance(content_blocks, list) and all(
                    isinstance(b, dict) and b.get("type") in ["text", "image"] 
                    for b in content_blocks
                ):
                    # Use content blocks directly for LLM (enables image tool results!)
                    llm_content = content_blocks
                    frontend_data = tool_result.get("structured_content", tool_result)
                    logger.debug(f"Tool {tool_name} returned {len(content_blocks)} content blocks")
                    return llm_content, frontend_data
            
            # Original string-based extraction
            llm_content = tool_result.get("content")
            if not llm_content:
                # No content provided - error case, don't send full structured data
                llm_content = f"[Tool {tool_name} executed - no summary available]"
            
            # Extract full data for frontend
            frontend_data = tool_result.get("structured_content", tool_result)
        else:
            # Error or simple response - send as-is to both
            llm_content = json.dumps(tool_result) if not isinstance(tool_result, str) else tool_result
            frontend_data = tool_result
        
        return llm_content, frontend_data
    
    async def _stream_tool_loop_wrapper(self, request_params: Dict, tool_executor: Callable) -> AsyncIterator[GenerationResponse]:
        """
        Wrapper that executes the tool loop and yields intermediate streaming results.
        This provides real-time updates during tool execution instead of batching.
        """
        import json
        
        # Enable interleaved thinking if thinking is enabled
        thinking_enabled = request_params.get("thinking") is not None
        if thinking_enabled:
            request_params.setdefault("extra_headers", {})
            request_params["extra_headers"]["anthropic-beta"] = "interleaved-thinking-2025-05-14"
        
        # Iteration cap: caller-tunable via ``max_tool_iterations`` in
        # request_params; defaults to 20. Phase B passes a higher value
        # (40+) for dense list extraction on big docs. Bumped from 10 → 20
        # default in 2026-04 because legitimate multi-tool workflows were
        # hitting the cap even when the model picked the right path.
        max_iterations = request_params.pop("_max_tool_iterations", 20)
        max_iterations = max(1, min(int(max_iterations), 100))
        iteration = 0

        # Build conversation by appending to messages array
        conversation_messages = list(request_params.get("messages", []))

        # Track all tool executions for the frontend
        all_tool_executions = []

        # Set when a tool returns ``_terminate_loop: True``. Used by Phase B's
        # ``done()`` tool to break the loop cleanly even when ``tool_choice=any``
        # would otherwise force another tool call on the next turn.
        terminate_signal = False

        # Cumulative usage across all turns of this loop. Without this,
        # callers can't verify prompt caching is actually paying off — every
        # ``GenerationResponse`` would land with ``usage=None``. The provider
        # is the only place we can see ``cache_creation_input_tokens`` and
        # ``cache_read_input_tokens`` from the SDK.
        cumulative_usage: Dict[str, int] = {
            "input_tokens": 0,
            "output_tokens": 0,
            "cache_creation_input_tokens": 0,
            "cache_read_input_tokens": 0,
        }

        try:
            while iteration < max_iterations:
                iteration += 1
                logger.debug(f"Tool loop iteration {iteration}/{max_iterations}")
                
                # Prepare request for this iteration
                loop_params = request_params.copy()
                loop_params["messages"] = conversation_messages
                # Remove 'stream' key - messages.stream() is already a streaming method
                loop_params.pop("stream", None)
                
                # Variables to accumulate streaming response
                accumulated_content = ""
                accumulated_tool_uses = []
                accumulated_thinking_blocks = []
                current_model = request_params["model"]
                
                # Make the streaming API call using native SDK
                async with self.client.messages.stream(**loop_params) as stream:
                    async for event in stream:
                        if event.type == "content_block_start":
                            if event.content_block.type == "thinking":
                                # Start of a thinking block - initialize it
                                accumulated_thinking_blocks.append({
                                    "type": "thinking",
                                    "thinking": "",
                                    "signature": None
                                })
                            elif event.content_block.type == "text":
                                # Start of text block
                                pass
                            elif event.content_block.type == "tool_use":
                                # Start of tool use block
                                accumulated_tool_uses.append({
                                    "type": "tool_use",
                                    "id": event.content_block.id,
                                    "name": event.content_block.name,
                                    "input": {}
                                })
                        
                        elif event.type == "content_block_delta":
                            if event.delta.type == "thinking_delta":
                                # Accumulate thinking to the last thinking block
                                thinking_text = event.delta.thinking
                                if accumulated_thinking_blocks:
                                    accumulated_thinking_blocks[-1]["thinking"] += thinking_text
                                else:
                                    # Shouldn't happen, but just in case
                                    accumulated_thinking_blocks.append({
                                        "type": "thinking",
                                        "thinking": thinking_text,
                                        "signature": None
                                    })
                            
                            elif event.delta.type == "signature_delta":
                                # Accumulate signature for thinking block
                                if accumulated_thinking_blocks:
                                    if "signature" not in accumulated_thinking_blocks[-1]:
                                        accumulated_thinking_blocks[-1]["signature"] = ""
                                    if accumulated_thinking_blocks[-1]["signature"] is None:
                                        accumulated_thinking_blocks[-1]["signature"] = ""
                                    accumulated_thinking_blocks[-1]["signature"] += event.delta.signature
                                
                                # Yield thinking delta
                                yield GenerationResponse(
                                    content=accumulated_content,
                                    model_used=current_model,
                                    thinking_trace=accumulated_thinking_blocks[0].get("thinking") if accumulated_thinking_blocks else None,
                                    tool_calls=None,
                                    tool_executions=all_tool_executions if all_tool_executions else None,
                                )
                            
                            elif event.delta.type == "text_delta":
                                # Accumulate content
                                accumulated_content += event.delta.text
                                
                                # Yield content delta
                                yield GenerationResponse(
                                    content=accumulated_content,
                                    model_used=current_model,
                                    thinking_trace=accumulated_thinking_blocks[0].get("thinking") if accumulated_thinking_blocks else None,
                                    tool_calls=None,
                                    tool_executions=all_tool_executions if all_tool_executions else None,
                                )
                            
                            elif event.delta.type == "input_json_delta":
                                # Accumulate tool input JSON string (don't parse yet - it's incremental)
                                if accumulated_tool_uses:
                                    if "input_json_str" not in accumulated_tool_uses[-1]:
                                        accumulated_tool_uses[-1]["input_json_str"] = ""
                                    accumulated_tool_uses[-1]["input_json_str"] += event.delta.partial_json

                # Pull this turn's full usage (cache_creation/read tokens
                # only land on ``get_final_message().usage``; streaming
                # events alone don't carry the cache fields).
                try:
                    final_msg = await stream.get_final_message()
                    if final_msg and getattr(final_msg, "usage", None):
                        u = final_msg.usage
                        turn_input = getattr(u, "input_tokens", 0) or 0
                        turn_output = getattr(u, "output_tokens", 0) or 0
                        turn_cache_create = getattr(u, "cache_creation_input_tokens", 0) or 0
                        turn_cache_read = getattr(u, "cache_read_input_tokens", 0) or 0
                        cumulative_usage["input_tokens"] += turn_input
                        cumulative_usage["output_tokens"] += turn_output
                        cumulative_usage["cache_creation_input_tokens"] += turn_cache_create
                        cumulative_usage["cache_read_input_tokens"] += turn_cache_read
                        # Per-turn cache stats — the only way to verify the
                        # cache_control markers are actually firing. Look for
                        # ``cache_read>0`` from turn 2 onward in worker logs.
                        cached_pct = (
                            int(round(100 * turn_cache_read / max(1, turn_input + turn_cache_create + turn_cache_read)))
                            if (turn_input + turn_cache_create + turn_cache_read) else 0
                        )
                        logger.info(
                            f"Tool loop turn {iteration} usage: "
                            f"input={turn_input} cache_create={turn_cache_create} "
                            f"cache_read={turn_cache_read} ({cached_pct}% cached) "
                            f"output={turn_output}"
                        )
                except Exception as e:
                    logger.debug(f"Could not extract per-turn usage at iteration {iteration}: {e}")

                # If no tool calls, we're done
                if not accumulated_tool_uses:
                    logger.info(f"Tool loop iteration {iteration}: No tool calls, completing")
                    logger.info(
                        f"Tool loop CUMULATIVE usage: input={cumulative_usage['input_tokens']} "
                        f"cache_create={cumulative_usage['cache_creation_input_tokens']} "
                        f"cache_read={cumulative_usage['cache_read_input_tokens']} "
                        f"output={cumulative_usage['output_tokens']}"
                    )
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=current_model,
                        usage=dict(cumulative_usage),
                        thinking_trace=accumulated_thinking_blocks[0].get("thinking") if accumulated_thinking_blocks else None,
                        finish_reason="stop",
                        tool_calls=None,
                        tool_executions=all_tool_executions if all_tool_executions else None,
                        raw_response=None,
                    )
                    return
                
                # Build assistant message content with proper Anthropic format
                assistant_content = []
                
                # Add thinking blocks first (only if they have signatures)
                for thinking_block in accumulated_thinking_blocks:
                    # Only include thinking blocks that have a valid signature
                    if thinking_block.get("signature"):
                        assistant_content.append(thinking_block)
                    else:
                        logger.warning(f"Skipping thinking block without signature (may be incomplete)")
                
                # Add text if present
                if accumulated_content:
                    assistant_content.append({
                        "type": "text",
                        "text": accumulated_content
                    })
                
                # Add tool uses
                for tool_use in accumulated_tool_uses:
                    # Parse the accumulated JSON string
                    if "input_json_str" in tool_use:
                        try:
                            tool_use["input"] = json.loads(tool_use["input_json_str"])
                        except json.JSONDecodeError as e:
                            logger.error(f"Failed to parse tool input JSON: {tool_use.get('input_json_str')[:100]}... Error: {e}")
                            tool_use["input"] = {}
                    elif "input" not in tool_use:
                        # No input received
                        tool_use["input"] = {}
                    
                    assistant_content.append({
                        "type": "tool_use",
                        "id": tool_use["id"],
                        "name": tool_use["name"],
                        "input": tool_use["input"]
                    })
                
                # Add assistant message to conversation (only if content is non-empty)
                if assistant_content:
                    conversation_messages.append({
                        "role": "assistant",
                        "content": assistant_content
                    })
                else:
                    logger.warning("Skipping assistant message with empty content array")
                
                # Execute tool calls and collect results
                logger.info(f"Executing {len(accumulated_tool_uses)} tool calls in iteration {iteration}")
                
                tool_results_content = []
                
                for tool_idx, tool_use in enumerate(accumulated_tool_uses):
                    try:
                        name = tool_use["name"]
                        args = tool_use["input"]
                        
                        # Attach thinking blocks to this tool execution
                        thinking_before = None
                        thinking_after = None
                        
                        # In interleaved thinking, thinking blocks appear between tool uses
                        # Pattern: [thinking_0] [tool_0] [thinking_1] [tool_1] [thinking_2] ...
                        if accumulated_thinking_blocks:
                            if tool_idx < len(accumulated_thinking_blocks):
                                thinking_before = accumulated_thinking_blocks[tool_idx].get("thinking")
                            # If there's a thinking block after the last tool, attach it
                            if tool_idx == len(accumulated_tool_uses) - 1 and len(accumulated_thinking_blocks) > len(accumulated_tool_uses):
                                thinking_after = accumulated_thinking_blocks[-1].get("thinking")
                        
                        # Yield status update before execution
                        pending_execution = {
                            "id": tool_use["id"],
                            "tool_name": name,
                            "arguments": args,
                            "status": "running",
                            "iteration": iteration,
                            "thinking_before": thinking_before,
                            "thinking_after": thinking_after,
                        }
                        all_tool_executions.append(pending_execution)
                        
                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=current_model,
                            thinking_trace=None,
                            tool_calls=None,
                            tool_executions=all_tool_executions,
                        )
                        
                        # Execute the tool
                        logger.info(f"Executing tool: {name} with args: {args}")
                        tool_result = await tool_executor(name, args)

                        # Honour the executor's terminate sentinel. Phase B's
                        # ``done()`` tool returns ``_terminate_loop: True``;
                        # without this check, ``tool_choice={"type":"any"}``
                        # would force another tool call on the next turn and
                        # the loop would only exit on the iteration cap.
                        if isinstance(tool_result, dict) and tool_result.get("_terminate_loop"):
                            terminate_signal = True

                        # Extract separate streams for LLM and frontend
                        llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)

                        # Check if tool execution failed
                        has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
                        
                        # Update execution status with FULL data for frontend
                        # Include both result (for backward compatibility) and structured_content (for frontend renderers).
                        # model_view is the exact llm_content the model saw on this turn — persisted so we can
                        # reconstruct tool_result blocks on subsequent turns and stop the cross-turn drop. Stored
                        # even on errors: _extract_tool_result_streams returns json.dumps({"error": ...}) as
                        # llm_content when the tool reported an error, so the model sees the failure on replay too.
                        all_tool_executions[-1].update({
                            "result": frontend_data if not has_error else None,
                            "structured_content": frontend_data if not has_error else None,
                            "model_view": llm_content,
                            "error": tool_result.get("error") if has_error and isinstance(tool_result, dict) else None,
                            "status": "failed" if has_error else "completed",
                        })
                        
                        # Yield status update after execution
                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=current_model,
                            thinking_trace=None,
                            tool_calls=None,
                            tool_executions=all_tool_executions,
                        )
                        
                        # NEW: Support both string and content blocks for tool results
                        # Determine content format for tool_result
                        if isinstance(llm_content, list):
                            # Array of content blocks (includes images!)
                            tool_result_content = llm_content
                        elif isinstance(llm_content, str):
                            # Simple string
                            tool_result_content = llm_content
                        else:
                            # Fallback: stringify
                            tool_result_content = json.dumps(llm_content)
                        
                        tool_result_block = {
                            "type": "tool_result",
                            "tool_use_id": tool_use["id"],
                            "content": tool_result_content,
                        }
                        # Only add is_error if True (it's optional)
                        if has_error:
                            tool_result_block["is_error"] = True
                        tool_results_content.append(tool_result_block)
                        
                        if has_error:
                            logger.warning(f"Tool {name} returned error: {tool_result.get('error') if isinstance(tool_result, dict) else tool_result}")
                        else:
                            if isinstance(llm_content, str):
                                logger.info(f"Tool {name} executed - sent {len(llm_content)} chars to LLM")
                            elif isinstance(llm_content, list):
                                logger.info(f"Tool {name} executed - sent {len(llm_content)} content blocks to LLM")
                            else:
                                logger.info(f"Tool {name} executed")
                        
                    except Exception as e:
                        logger.error(f"Tool execution failed for {name}: {e}", exc_info=True)
                        error_result = {"error": f"Tool execution failed: {str(e)}"}

                        # Persist the same error JSON the model saw as model_view so the
                        # failure is visible on subsequent turns — without it, the splicer
                        # would skip this entry and the model would have no record that
                        # the call ever happened.
                        all_tool_executions[-1].update({
                            "model_view": json.dumps(error_result),
                            "error": str(e),
                            "status": "failed",
                        })
                        
                        # Yield error status
                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=current_model,
                            thinking_trace=None,
                            tool_calls=None,
                            tool_executions=all_tool_executions,
                        )
                        
                        # Add error result
                        tool_results_content.append({
                            "type": "tool_result",
                            "tool_use_id": tool_use["id"],
                            "content": json.dumps(error_result),
                            "is_error": True  # This is already a boolean
                        })
                
                # CRITICAL: Add all tool results in a single user message
                if tool_results_content:
                    conversation_messages.append({
                        "role": "user",
                        "content": tool_results_content
                    })

                # Executor-driven termination (Phase B done()). Yield a final
                # response and exit cleanly — saves up to N-iteration extra
                # forced tool calls when the model has signalled completion.
                if terminate_signal:
                    logger.info(f"Tool loop terminated by executor sentinel at iteration {iteration}")
                    logger.info(
                        f"Tool loop CUMULATIVE usage: input={cumulative_usage['input_tokens']} "
                        f"cache_create={cumulative_usage['cache_creation_input_tokens']} "
                        f"cache_read={cumulative_usage['cache_read_input_tokens']} "
                        f"output={cumulative_usage['output_tokens']}"
                    )
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=current_model,
                        usage=dict(cumulative_usage),
                        thinking_trace=accumulated_thinking_blocks[0].get("thinking") if accumulated_thinking_blocks else None,
                        finish_reason="terminate_signal",
                        tool_calls=None,
                        tool_executions=all_tool_executions if all_tool_executions else None,
                        raw_response=None,
                    )
                    return

            # Max iterations reached
            logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
            logger.info(
                f"Tool loop CUMULATIVE usage at cap: input={cumulative_usage['input_tokens']} "
                f"cache_create={cumulative_usage['cache_creation_input_tokens']} "
                f"cache_read={cumulative_usage['cache_read_input_tokens']} "
                f"output={cumulative_usage['output_tokens']}"
            )
            yield GenerationResponse(
                content="Maximum tool execution iterations reached",
                model_used=current_model,
                usage=dict(cumulative_usage),
                thinking_trace=None,
                finish_reason="max_iterations",
                tool_calls=None,
                tool_executions=all_tool_executions if all_tool_executions else None,
                raw_response=None,
            )
            
        except Exception as e:
            logger.error(f"Tool loop streaming wrapper error: {e}", exc_info=True)
            raise
    
    async def _tool_loop_generate(self, request_params: Dict, tool_executor: Callable) -> GenerationResponse:
        """Execute a tool loop for Anthropic, handling tool calls until completion."""
        import json
        
        # Enable interleaved thinking if thinking is enabled
        thinking_enabled = request_params.get("thinking") is not None
        if thinking_enabled:
            request_params.setdefault("extra_headers", {})
            request_params["extra_headers"]["anthropic-beta"] = "interleaved-thinking-2025-05-14"
        
        # Iteration cap: caller-tunable via ``max_tool_iterations`` in
        # request_params; defaults to 20. See streaming wrapper for rationale.
        max_iterations = request_params.pop("_max_tool_iterations", 20)
        max_iterations = max(1, min(int(max_iterations), 100))
        iteration = 0

        # Build conversation by appending to messages array
        conversation_messages = list(request_params.get("messages", []))

        # Track all tool executions for the frontend
        all_tool_executions = []

        # Mirrors the streaming-wrapper sentinel: Phase B's ``done()`` returns
        # ``_terminate_loop: True`` and the loop breaks cleanly instead of
        # being held open by ``tool_choice=any`` until the iteration cap.
        terminate_signal = False

        while iteration < max_iterations:
            iteration += 1
            logger.debug(f"Tool loop iteration {iteration}/{max_iterations}")
            
            # Prepare request for this iteration
            loop_params = request_params.copy()
            loop_params["messages"] = conversation_messages

            # Stream under the hood and assemble the final message — same
            # rationale as ``_generate``: avoids the SDK's 10-minute guard on
            # ``messages.create`` when ``max_tokens`` is high. Tool blocks,
            # thinking blocks, and stop_reason all come through identically.
            response = await self._streamed_final(loop_params)
            
            # Extract content blocks
            content_text = ""
            tool_uses = []
            thinking_blocks = []
            
            for block in response.content:
                if block.type == "thinking":
                    thinking_block = {
                        "type": "thinking",
                        "thinking": block.thinking
                    }
                    # Add signature if available (required for tool use with thinking)
                    if hasattr(block, 'signature') and block.signature:
                        thinking_block["signature"] = block.signature
                    thinking_blocks.append(thinking_block)
                elif block.type == "text":
                    content_text = block.text
                elif block.type == "tool_use":
                    tool_uses.append({
                        "type": "tool_use",
                        "id": block.id,
                        "name": block.name,
                        "input": block.input
                    })
            
            # If no tool calls, we're done
            if not tool_uses:
                logger.info(f"Tool loop iteration {iteration}: No tool calls, completing")
                return GenerationResponse(
                    content=content_text,
                    model_used=response.model,
                    usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else response.usage.__dict__,
                    thinking_trace=thinking_blocks[0].get("thinking") if thinking_blocks else None,
                    finish_reason=response.stop_reason,
                    tool_calls=None,
                    tool_executions=all_tool_executions if all_tool_executions else None,
                    raw_response=response.model_dump() if hasattr(response, 'model_dump') else None,
                )
            
            # Build assistant message content with proper Anthropic format
            assistant_content = []
            
            # Add thinking blocks first (only if they have signatures)
            for thinking_block in thinking_blocks:
                # Only include thinking blocks that have a valid signature
                if thinking_block.get("signature"):
                    assistant_content.append(thinking_block)
                else:
                    logger.warning(f"Skipping thinking block without signature (may be incomplete)")
            
            # Add text if present
            if content_text:
                assistant_content.append({
                    "type": "text",
                    "text": content_text
                })
            
            # Add tool uses
            for tool_use in tool_uses:
                assistant_content.append(tool_use)
            
            # Add assistant message to conversation (only if content is non-empty)
            if assistant_content:
                conversation_messages.append({
                    "role": "assistant",
                    "content": assistant_content
                })
            else:
                logger.warning("Skipping assistant message with empty content array")
            
            # Execute tool calls and collect results
            logger.info(f"Executing {len(tool_uses)} tool calls in iteration {iteration}")
            
            tool_results_content = []
            
            for tool_idx, tool_use in enumerate(tool_uses):
                try:
                    name = tool_use["name"]
                    args = tool_use["input"]
                    
                    # Attach thinking blocks to this tool execution
                    thinking_before = None
                    thinking_after = None
                    
                    # In interleaved thinking, thinking blocks appear between tool uses
                    # Pattern: [thinking_0] [tool_0] [thinking_1] [tool_1] [thinking_2] ...
                    if thinking_blocks:
                        if tool_idx < len(thinking_blocks):
                            thinking_before = thinking_blocks[tool_idx].get("thinking")
                        # If there's a thinking block after the last tool, attach it
                        if tool_idx == len(tool_uses) - 1 and len(thinking_blocks) > len(tool_uses):
                            thinking_after = thinking_blocks[-1].get("thinking")
                    
                    # Execute the tool
                    logger.info(f"Executing tool: {name} with args: {args}")
                    tool_result = await tool_executor(name, args)

                    # Honour executor's terminate sentinel (Phase B done()).
                    if isinstance(tool_result, dict) and tool_result.get("_terminate_loop"):
                        terminate_signal = True

                    # Extract separate streams for LLM and frontend
                    llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)

                    # Check if tool execution failed
                    has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))

                    # Record execution with FULL data for frontend.
                    # model_view is the exact llm_content the model saw on this turn — persisted so we can
                    # reconstruct tool_result blocks on subsequent turns and stop the cross-turn drop. Stored
                    # even on errors so the failure is visible on replay (llm_content holds the error JSON).
                    all_tool_executions.append({
                        "id": tool_use["id"],
                        "tool_name": name,
                        "arguments": args,
                        "result": frontend_data if not has_error else None,
                        "structured_content": frontend_data if not has_error else None,
                        "model_view": llm_content,
                        "error": tool_result.get("error") if has_error and isinstance(tool_result, dict) else None,
                        "status": "failed" if has_error else "completed",
                        "iteration": iteration,
                        "thinking_before": thinking_before,
                        "thinking_after": thinking_after,
                    })
                    
                    # NEW: Support both string and content blocks for tool results
                    # Determine content format for tool_result
                    if isinstance(llm_content, list):
                        # Array of content blocks (includes images!)
                        tool_result_content = llm_content
                    elif isinstance(llm_content, str):
                        # Simple string
                        tool_result_content = llm_content
                    else:
                        # Fallback: stringify
                        tool_result_content = json.dumps(llm_content)
                    
                    tool_result_block = {
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": tool_result_content,
                    }
                    # Only add is_error if True (it's optional)
                    if has_error:
                        tool_result_block["is_error"] = True
                    tool_results_content.append(tool_result_block)
                    
                    if has_error:
                        logger.warning(f"Tool {name} returned error: {tool_result.get('error') if isinstance(tool_result, dict) else tool_result}")
                    else:
                        if isinstance(llm_content, str):
                            logger.info(f"Tool {name} executed - sent {len(llm_content)} chars to LLM")
                        elif isinstance(llm_content, list):
                            logger.info(f"Tool {name} executed - sent {len(llm_content)} content blocks to LLM")
                        else:
                            logger.info(f"Tool {name} executed")
                    
                except Exception as e:
                    logger.error(f"Tool execution failed for {name}: {e}", exc_info=True)
                    error_result = {"error": f"Tool execution failed: {str(e)}"}

                    # Record failed execution — model_view holds the same error JSON the model saw
                    # so the failure is visible on subsequent turns instead of being skipped.
                    all_tool_executions.append({
                        "id": tool_use["id"],
                        "tool_name": name,
                        "arguments": args,
                        "model_view": json.dumps(error_result),
                        "error": str(e),
                        "status": "failed",
                        "iteration": iteration,
                    })
                    
                    # Add error result
                    tool_results_content.append({
                        "type": "tool_result",
                        "tool_use_id": tool_use["id"],
                        "content": json.dumps(error_result),
                        "is_error": True  # This is already a boolean
                    })
            
            # CRITICAL: Add all tool results in a single user message
            if tool_results_content:
                conversation_messages.append({
                    "role": "user",
                    "content": tool_results_content
                })

            # Executor-driven termination (Phase B done()). Return cleanly.
            if terminate_signal:
                logger.info(f"Tool loop terminated by executor sentinel at iteration {iteration}")
                return GenerationResponse(
                    content=content_text,
                    model_used=response.model,
                    usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else dict(response.usage),
                    thinking_trace=thinking_blocks[0].get("thinking") if thinking_blocks else None,
                    finish_reason="terminate_signal",
                    tool_calls=None,
                    tool_executions=all_tool_executions if all_tool_executions else None,
                    raw_response=None,
                )

        # Max iterations reached
        logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
        final_response = await self._streamed_final(loop_params)
        
        return GenerationResponse(
            content=final_response.content[0].text if final_response.content else "Maximum tool execution iterations reached",
            model_used=final_response.model,
            usage=final_response.usage.model_dump() if hasattr(final_response.usage, 'model_dump') else final_response.usage.__dict__,
            thinking_trace=None,
            finish_reason="max_iterations",
            tool_calls=None,
            tool_executions=all_tool_executions if all_tool_executions else None,
            raw_response=final_response.model_dump() if hasattr(final_response, 'model_dump') else None,
        )
    
    async def _streamed_final(self, request_params: Dict):
        """Run the request via streaming and return the final assembled message.

        The Anthropic SDK refuses ``messages.create`` (its non-streaming
        primitive) when ``max_tokens`` is high enough that the worst-case
        wall-time could exceed 10 minutes — the cutoff exists because long
        non-streaming requests get killed by proxies and load balancers.
        ``messages.stream`` carries no such guard: chunks keep the
        connection alive, and ``get_final_message()`` hands back a
        ``ParsedMessage`` with exactly the same shape ``messages.create``
        would have returned (same content blocks, usage, stop_reason).

        So our two non-streaming paths (``_generate`` and the per-iteration
        call inside ``_tool_loop_generate``) route through this helper. The
        external contract — ``generate(stream=False)`` returns one
        ``GenerationResponse`` — is preserved; only the SDK transport changes.
        Callers that want progressive chunks still use ``_stream_generate``
        and ``_stream_tool_loop_wrapper``.

        ``stream`` and our internal ``_max_tool_iterations`` sentinel get
        popped before the SDK call — ``messages.stream`` is itself the
        streaming method and rejects unknown kwargs. The tool-loop wrappers
        already pop ``_max_tool_iterations`` upstream, but the no-tool
        path (e.g. forced-tool-call structured output) routes here directly,
        so the pop is needed at this boundary too.
        """
        request_params.pop("stream", None)
        request_params.pop("_max_tool_iterations", None)
        async with self.client.messages.stream(**request_params) as stream:
            return await stream.get_final_message()

    async def _generate(self, request_params: Dict) -> GenerationResponse:
        """Handle non-streaming generation using Anthropic SDK.

        Streams under the hood via ``_streamed_final`` so the SDK's 10-minute
        non-streaming guard never trips on high ``max_tokens``. The caller
        receives one assembled ``GenerationResponse`` exactly as before.
        """
        try:
            response = await self._streamed_final(request_params)
            
            # Extract content
            content_text = ""
            thinking_text = None
            tool_calls = []
            
            for block in response.content:
                if block.type == "thinking":
                    thinking_text = block.thinking
                elif block.type == "text":
                    content_text = block.text
                elif block.type == "tool_use":
                    tool_calls.append({
                        "id": block.id,
                        "type": "function",
                        "function": {
                            "name": block.name,
                            "arguments": json.dumps(block.input)
                        }
                    })
                    # For forced tool calls (structured output), return the input as JSON
                    if block.name == "extract" and not content_text:
                        content_text = json.dumps(block.input)

            # Success-path visibility: log stop_reason, all four usage fields,
            # and content size. The cache fields are how we verify caching is
            # actually firing — ``cache_read>0`` on a second call to the same
            # prefix means the markers are working. A ``max_tokens`` stop on
            # a forced-tool call is the common cause of "200 OK but empty
            # structured output" — this line makes both diagnosable without
            # flipping the whole worker to DEBUG.
            try:
                u = response.usage
                in_tokens = getattr(u, "input_tokens", 0) or 0
                out_tokens = getattr(u, "output_tokens", 0) or 0
                cache_create = getattr(u, "cache_creation_input_tokens", 0) or 0
                cache_read = getattr(u, "cache_read_input_tokens", 0) or 0
            except Exception:
                in_tokens = out_tokens = cache_create = cache_read = 0
            cached_pct = (
                int(round(100 * cache_read / max(1, in_tokens + cache_create + cache_read)))
                if (in_tokens + cache_create + cache_read) else 0
            )
            logger.info(
                "Anthropic response — model=%s stop_reason=%s "
                "input=%s cache_create=%s cache_read=%s (%s%% cached) output=%s "
                "content_chars=%d max_tokens=%s",
                response.model, response.stop_reason,
                in_tokens, cache_create, cache_read, cached_pct, out_tokens,
                len(content_text or ""), request_params.get("max_tokens"),
            )
            if response.stop_reason == "max_tokens":
                logger.warning(
                    "Anthropic stopped on max_tokens (%s). Structured-output tool call "
                    "may be truncated — downstream parsers likely see empty/partial JSON. "
                    "Bump ``max_tokens`` in kwargs if this recurs.",
                    request_params.get("max_tokens"),
                )

            return GenerationResponse(
                content=content_text,
                model_used=response.model,
                usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else response.usage.__dict__,
                thinking_trace=thinking_text,
                finish_reason=response.stop_reason,
                tool_calls=tool_calls if tool_calls else None,
                raw_response=response.model_dump() if hasattr(response, 'model_dump') else None,
            )
            
        except Exception as e:
            # Dump the full Anthropic error body + request shape so intermittent
            # 400s can be diagnosed from logs. The SDK's BadRequestError
            # carries the raw JSON on ``body``; ``response.text`` may also hold
            # it. Terminal log tailing tends to truncate long single lines, so
            # we split the diagnostic across separate log records.
            full_body = None
            try:
                body = getattr(e, "body", None)
                if body is not None:
                    full_body = body if isinstance(body, str) else json.dumps(body, default=str)
            except Exception:
                pass
            if full_body is None:
                resp = getattr(e, "response", None)
                if resp is not None:
                    try:
                        full_body = resp.text
                    except Exception:
                        full_body = None

            msgs = request_params.get("messages") or []
            num_imgs = 0
            total_img_bytes = 0
            largest_img_bytes = 0
            largest_img_mime = None
            for m in msgs:
                content = m.get("content")
                if not isinstance(content, list):
                    continue
                for block in content:
                    if isinstance(block, dict) and block.get("type") == "image":
                        src = block.get("source") or {}
                        data = src.get("data") or ""
                        # Base64 length → roughly 3/4 decoded size.
                        decoded_bytes = int(len(data) * 0.75)
                        num_imgs += 1
                        total_img_bytes += decoded_bytes
                        if decoded_bytes > largest_img_bytes:
                            largest_img_bytes = decoded_bytes
                            largest_img_mime = src.get("media_type")

            tool_schema_size = 0
            tools_param = request_params.get("tools")
            if tools_param:
                try:
                    tool_schema_size = len(json.dumps(tools_param))
                except Exception:
                    tool_schema_size = -1

            logger.error(
                "Anthropic generation error: type=%s msg=%s",
                type(e).__name__, e,
            )
            logger.error(
                "Anthropic request shape — model=%s messages=%d images=%d "
                "total_image_bytes=%d largest_image_bytes=%d largest_image_mime=%s "
                "tool_schema_size=%d max_tokens=%s",
                request_params.get("model"), len(msgs), num_imgs,
                total_img_bytes, largest_img_bytes, largest_img_mime,
                tool_schema_size, request_params.get("max_tokens"),
            )
            if full_body:
                # Log body in chunks to survive tty-tail truncation. 1500 chars
                # per line is conservative for most terminals.
                CHUNK = 1500
                for i in range(0, len(full_body), CHUNK):
                    logger.error("Anthropic 400 body[%d:%d]: %s", i, i + CHUNK, full_body[i : i + CHUNK])
            raise RuntimeError(f"Anthropic generation failed: {str(e)}")

    async def _stream_generate(self, request_params: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation using Anthropic SDK."""
        try:
            accumulated_content = ""
            accumulated_thinking = ""
            accumulated_tool_calls = []
            model_used = request_params["model"]

            # Remove 'stream' key - messages.stream() is already a streaming method.
            # Also drop our internal ``_max_tool_iterations`` sentinel so it
            # never reaches the SDK on no-tool streaming paths (the tool-loop
            # wrappers pop it earlier on tool paths).
            request_params.pop("stream", None)
            request_params.pop("_max_tool_iterations", None)

            async with self.client.messages.stream(**request_params) as stream:
                async for event in stream:
                    if event.type == "content_block_start":
                        if event.content_block.type == "tool_use":
                            # Start of a new tool call
                            accumulated_tool_calls.append({
                                "id": event.content_block.id,
                                "type": "function",
                                "function": {
                                    "name": event.content_block.name,
                                    "arguments": ""
                                }
                            })

                    elif event.type == "content_block_delta":
                        if event.delta.type == "thinking_delta":
                            accumulated_thinking += event.delta.thinking
                        elif event.delta.type == "text_delta":
                            accumulated_content += event.delta.text
                        elif event.delta.type == "input_json_delta":
                            # Accumulate tool arguments (incremental JSON string)
                            if accumulated_tool_calls:
                                accumulated_tool_calls[-1]["function"]["arguments"] += event.delta.partial_json

                    # Yield current state
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=model_used,
                        thinking_trace=accumulated_thinking if accumulated_thinking else None,
                        tool_calls=accumulated_tool_calls if accumulated_tool_calls else None,
                        raw_response=None,
                    )

                # After streaming completes, pull final usage including cache
                # stats. Without this, single-shot streamed calls (Phase A,
                # any caller passing ``stream=True`` without tools) report
                # ``usage=None`` and we can't tell whether caching is firing.
                final_usage_dict: Optional[Dict[str, Any]] = None
                try:
                    final_msg = await stream.get_final_message()
                    if final_msg and getattr(final_msg, "usage", None):
                        u = final_msg.usage
                        final_usage_dict = {
                            "input_tokens": getattr(u, "input_tokens", 0) or 0,
                            "output_tokens": getattr(u, "output_tokens", 0) or 0,
                            "cache_creation_input_tokens": getattr(u, "cache_creation_input_tokens", 0) or 0,
                            "cache_read_input_tokens": getattr(u, "cache_read_input_tokens", 0) or 0,
                        }
                        cached_pct = (
                            int(round(100 * final_usage_dict["cache_read_input_tokens"]
                                / max(1, final_usage_dict["input_tokens"]
                                       + final_usage_dict["cache_creation_input_tokens"]
                                       + final_usage_dict["cache_read_input_tokens"])))
                            if (final_usage_dict["input_tokens"]
                                + final_usage_dict["cache_creation_input_tokens"]
                                + final_usage_dict["cache_read_input_tokens"]) else 0
                        )
                        logger.info(
                            f"Anthropic stream usage: input={final_usage_dict['input_tokens']} "
                            f"cache_create={final_usage_dict['cache_creation_input_tokens']} "
                            f"cache_read={final_usage_dict['cache_read_input_tokens']} "
                            f"({cached_pct}% cached) output={final_usage_dict['output_tokens']}"
                        )
                except Exception as e:
                    logger.debug(f"Could not extract final stream usage: {e}")

                # Final yield carries the usage dict so callers can stamp it
                # onto annotations (Phase A telemetry path).
                yield GenerationResponse(
                    content=accumulated_content,
                    model_used=model_used,
                    usage=final_usage_dict,
                    thinking_trace=accumulated_thinking if accumulated_thinking else None,
                    tool_calls=accumulated_tool_calls if accumulated_tool_calls else None,
                    finish_reason="stop",
                    raw_response=None,
                )

        except Exception as e:
            logger.error(f"Anthropic streaming error: {e}")
            raise RuntimeError(f"Anthropic streaming failed: {str(e)}")
    
    def _prepare_tools_for_anthropic(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert tools to Anthropic's native format."""
        formatted_tools = []
        
        for tool in tools:
            # Extract tool info based on format
            if tool.get("type") == "mcp":
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
            elif tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                func = tool["function"]
                name = func.get("name")
                description = func.get("description")
                parameters = func.get("parameters")
            else:
                # Bare function format
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
            
            # Skip tools with missing required fields
            if not name or not parameters:
                logger.warning(f"Skipping tool with missing name or parameters: {tool}")
                continue
            
            # Build Anthropic-compatible tool definition. Preserve the
            # ``cacheable`` marker so ``_apply_cache_markers_to_tools`` can
            # translate it into ``cache_control: ephemeral`` after this step.
            formatted_tool = {
                "name": name,
                "description": description or f"Execute {name}",
                "input_schema": parameters,
            }
            if tool.get("cacheable"):
                formatted_tool["cacheable"] = True
            formatted_tools.append(formatted_tool)
        
        logger.info(f"Prepared {len(formatted_tools)} tools for Anthropic")
        return formatted_tools
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)