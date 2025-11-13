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

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse
from app.core.config import settings

logger = logging.getLogger(__name__)


class AnthropicLanguageModelProvider(LanguageModelProvider):
    """
    Anthropic (Claude) implementation using the native Anthropic SDK.
    Handles chat, structured output, tool calls, and streaming with full feature support.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.anthropic.com"):
        try:
            from anthropic import Anthropic
        except ImportError:
            raise ImportError("Anthropic SDK not installed. Run: pip install anthropic")
        
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = Anthropic(
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
            # Hardcoded list of supported Claude models
            # These are the main production models from Anthropic
            claude_models = [
                {
                    "name": "claude-sonnet-3.5",
                    "description": "Claude 3.5 Sonnet - Balanced performance and intelligence",
                    "supports_thinking": False,
                },
                {
                    "name": "claude-sonnet-4-20250514",
                    "description": "Claude Sonnet 4 - Enhanced reasoning and analysis",
                    "supports_thinking": True,
                },
                {
                    "name": "claude-sonnet-4-5",
                    "description": "Claude Sonnet 4.5 - Latest model with best performance",
                    "supports_thinking": True,  # Supports extended thinking
                },
            ]
            
            models = []
            for model_data in claude_models:
                model_info = ModelInfo(
                    name=model_data["name"],
                    provider="anthropic",
                    supports_structured_output=True,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_thinking=model_data.get("supports_thinking", False),
                    supports_multimodal=True,  # Claude supports image inputs
                    max_tokens=None,  # Varies by model
                    context_length=None,  # Varies by model (200K for newer models)
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
        
        # Extract system messages - Anthropic requires them in a separate parameter
        system_messages = []
        non_system_messages = []
        
        for msg in messages:
            # Skip messages with empty content (Anthropic requirement)
            content = msg.get("content", "")
            if isinstance(content, str) and not content.strip():
                logger.warning(f"Skipping message with empty content: role={msg.get('role')}")
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
        
        # Build the base request parameters
        base_params = {
            "model": model_name,
            "messages": processed_messages,
            "max_tokens": kwargs.get("max_tokens", 4096),
        }
        
        # Add system parameter if we have system messages
        if system_messages:
            # Combine multiple system messages into one
            base_params["system"] = "\n\n".join(system_messages)
            logger.debug(f"Extracted {len(system_messages)} system message(s) to system parameter")
        
        # Add tools if provided
        if tools:
            base_params["tools"] = self._prepare_tools_for_anthropic(tools)
        
        # Add other parameters
        if "temperature" in kwargs:
            # Anthropic caps temperature at 1.0
            temp = min(kwargs["temperature"], 1.0)
            base_params["temperature"] = temp
        if "top_p" in kwargs:
            base_params["top_p"] = kwargs["top_p"]
        if "stop_sequences" in kwargs:
            base_params["stop_sequences"] = kwargs["stop_sequences"]
        
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
        
        max_iterations = 10
        iteration = 0
        
        # Build conversation by appending to messages array
        conversation_messages = list(request_params.get("messages", []))
        
        # Track all tool executions for the frontend
        all_tool_executions = []
        
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
                with self.client.messages.stream(**loop_params) as stream:
                    for event in stream:
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
                
                # If no tool calls, we're done
                if not accumulated_tool_uses:
                    logger.info(f"Tool loop iteration {iteration}: No tool calls, completing")
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=current_model,
                        usage=None,
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
                        
                        # Extract separate streams for LLM and frontend
                        llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)
                        
                        # Check if tool execution failed
                        has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
                        
                        # Update execution status with FULL data for frontend
                        # Include both result (for backward compatibility) and structured_content (for frontend renderers)
                        all_tool_executions[-1].update({
                            "result": frontend_data if not has_error else None,
                            "structured_content": frontend_data if not has_error else None,  # Explicit structured_content for frontend
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
                        
                        # Update execution with error
                        all_tool_executions[-1].update({
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
            
            # Max iterations reached
            logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
            yield GenerationResponse(
                content="Maximum tool execution iterations reached",
                model_used=current_model,
                usage=None,
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
        
        max_iterations = 10
        iteration = 0
        
        # Build conversation by appending to messages array
        conversation_messages = list(request_params.get("messages", []))
        
        # Track all tool executions for the frontend
        all_tool_executions = []
        
        while iteration < max_iterations:
            iteration += 1
            logger.debug(f"Tool loop iteration {iteration}/{max_iterations}")
            
            # Prepare request for this iteration
            loop_params = request_params.copy()
            loop_params["messages"] = conversation_messages
            # Remove stream parameter if present (not needed for create())
            loop_params.pop("stream", None)
            
            # Make the API call using native SDK
            response = self.client.messages.create(**loop_params)
            
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
                    
                    # Extract separate streams for LLM and frontend
                    llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)
                    
                    # Check if tool execution failed
                    has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
                    
                    # Record execution with FULL data for frontend
                    # Include both result (for backward compatibility) and structured_content (for frontend renderers)
                    all_tool_executions.append({
                        "id": tool_use["id"],
                        "tool_name": name,
                        "arguments": args,
                        "result": frontend_data if not has_error else None,
                        "structured_content": frontend_data if not has_error else None,  # Explicit structured_content for frontend
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
                    
                    # Record failed execution
                    all_tool_executions.append({
                        "id": tool_use["id"],
                        "tool_name": name,
                        "arguments": args,
                        "error": str(e),
                        "status": "failed",
                        "iteration": iteration
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
        
        # Max iterations reached
        logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
        final_response = self.client.messages.create(**loop_params)
        
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
    
    async def _generate(self, request_params: Dict) -> GenerationResponse:
        """Handle non-streaming generation using Anthropic SDK."""
        try:
            response = self.client.messages.create(**request_params)
            
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
            logger.error(f"Anthropic generation error: {e}")
            raise RuntimeError(f"Anthropic generation failed: {str(e)}")
    
    async def _stream_generate(self, request_params: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation using Anthropic SDK."""
        try:
            accumulated_content = ""
            accumulated_thinking = ""
            accumulated_tool_calls = []
            model_used = request_params["model"]

            # Remove 'stream' key - messages.stream() is already a streaming method
            request_params.pop("stream", None)
            
            with self.client.messages.stream(**request_params) as stream:
                for event in stream:
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
            
            # Build Anthropic-compatible tool definition
            formatted_tools.append({
                "name": name,
                "description": description or f"Execute {name}",
                "input_schema": parameters
            })
        
        logger.info(f"Prepared {len(formatted_tools)} tools for Anthropic")
        return formatted_tools
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)