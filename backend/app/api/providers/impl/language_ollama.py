"""
Ollama Language Model Provider Implementation
"""
import logging
import json
import httpx
import re
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Callable, Awaitable

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse

logger = logging.getLogger(__name__)


class OllamaLanguageModelProvider(LanguageModelProvider):
    """
    Ollama implementation of the LanguageModelProvider interface.
    Handles chat, structured output, tool calls, and streaming with Ollama-specific edge cases.
    """
    
    def __init__(self, base_url: str = "http://ollama:11434"):
        self.base_url = base_url.rstrip('/')
        # Increased timeout for thinking models and complex tool chains
        self.client = httpx.AsyncClient(timeout=900.0)  # 15 minutes
        self._model_cache = {}
        logger.info(f"Ollama provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Discover local Ollama models and derive capabilities without heuristics.

        - Primary source: internal utils endpoint providing explicit capabilities.
        - Fallback: use /api/show per model to detect 'vision' capability only.
        - If no capability info is available, do not assume tool support.
        """
        try:
            response = await self.client.get(f"{self.base_url}/api/tags")
            response.raise_for_status()
            data = response.json()
            
            # Try to get enhanced capabilities from the utils endpoint
            enhanced_capabilities = {}
            try:
                utils_response = await self.client.get("http://localhost:8022/api/v1/utils/ollama/available-models?limit=200")
                if utils_response.status_code == 200:
                    utils_data = utils_response.json()
                    for model in utils_data.get("models", []):
                        model_name = model.get("name", "")
                        base_name = model.get("base_model", "")
                        capabilities = model.get("capabilities", [])
                        
                        # Store capabilities for both full name and base name
                        enhanced_capabilities[model_name] = capabilities
                        if base_name:
                            enhanced_capabilities[base_name] = capabilities
                            
                    logger.info(f"Enhanced capabilities loaded for {len(enhanced_capabilities)} Ollama models")
            except Exception as e:
                logger.debug(f"Could not load enhanced capabilities: {e}")
            
            models = []
            for model_data in data.get("models", []):
                model_name = model_data["name"]
                base_name = model_name.split(":")[0]
                
                # Capabilities from enhanced source when available
                capabilities = enhanced_capabilities.get(model_name) or enhanced_capabilities.get(base_name)
                if capabilities:
                    try:
                        caps_set = {str(c).lower() for c in capabilities}
                    except Exception:
                        caps_set = set()
                else:
                    caps_set = set()
                supports_tools = "tools" in caps_set
                supports_multimodal = "vision" in caps_set
                supports_thinking = "thinking" in caps_set

                # Always probe /api/show for actual capabilities as the authoritative source
                try:
                    show_resp = await self.client.post(f"{self.base_url}/api/show", json={"model": model_name})
                    if show_resp.status_code == 200:
                        show_data = show_resp.json() or {}
                        raw_caps = show_data.get("capabilities") or []
                        try:
                            show_caps = {str(c).lower() for c in raw_caps}
                        except Exception:
                            show_caps = set()
                        # Use actual capabilities from Ollama as authoritative source
                        supports_tools = "tools" in show_caps
                        supports_multimodal = "vision" in show_caps
                        supports_thinking = "thinking" in show_caps
                        logger.info(f"Model {model_name} actual capabilities from Ollama: {show_caps}")
                except Exception:
                    pass
                
                model_info = ModelInfo(
                    name=model_name,
                    provider="ollama",
                    supports_structured_output=True, 
                    supports_tools=supports_tools,
                    supports_streaming=True,
                    supports_thinking=supports_thinking,
                    supports_multimodal=supports_multimodal,
                    max_tokens=None,  # Ollama doesn't expose this in tags
                    context_length=None,
                    description=f"Ollama {model_name}"
                )
                models.append(model_info)
                self._model_cache[model_name] = model_info
            
            logger.info(f"Discovered {len(models)} Ollama models")
            return models
            
        except Exception as e:
            logger.error(f"Failed to discover Ollama models: {e}")
            return []
    
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
        Generate response using Ollama API.
        
        Supports image inputs via media_inputs in kwargs:
        - media_inputs: List of dicts with {type: "image", content: bytes, mime_type: str}
        - Images are added to the last user message in Ollama's format
        """
        # Extract media_inputs from kwargs
        media_inputs = kwargs.pop("media_inputs", [])
        if media_inputs:
            logger.info(f"Processing {len(media_inputs)} media inputs for Ollama")
            # Process images and add to messages
            messages = self._prepare_messages_with_media(messages, media_inputs)
        
        # Tools with executor: implement tool loop (both streaming and non-streaming)
        if tools and tool_executor:
            if stream:
                # Streaming with tools: wrap tool loop to yield final result
                logger.info("Ollama streaming with tools: wrapping tool loop execution")
                return self._stream_tool_loop_wrapper(
                    messages=messages,
                    model_name=model_name,
                    tools=tools,
                    thinking_enabled=thinking_enabled,
                    tool_executor=tool_executor,
                    **kwargs
                )
            else:
                # Non-streaming with tools: collect all streaming results and return final
                final_response = None
                async for response in self._tool_loop_generate_streaming(
                    messages=messages,
                    model_name=model_name,
                    tools=tools,
                    thinking_enabled=thinking_enabled,
                    tool_executor=tool_executor,
                    **kwargs
                ):
                    final_response = response  # Keep updating until we get the final one
                return final_response

        # Work on a defensive copy of messages; never mutate caller's list
        try:
            messages_for_request: List[Dict[str, Any]] = [dict(m) for m in (messages or [])]
        except Exception:
            # Fallback to original reference if copying fails
            messages_for_request = messages
        
        # Ollama thinking mode - CRITICAL: DON'T add system message prompts about <think> tags
        # 
        # Models with thinking capability (like Qwen3-Thinking) have <think> baked into their
        # chat template. They output only </think> to mark the end of thinking.
        # 
        # Adding prompt instructions like "use <think></think> tags" confuses these models.
        # Instead, let the model's native chat template handle thinking automatically.
        # Our extraction logic handles both complete tags and Qwen-style (missing opening).

        # Build payload using the local copy
        payload: Dict[str, Any] = {
            "model": model_name,
            "messages": messages_for_request,
            "stream": stream,
        }
        
        # Ollama structured output format (uses "format" parameter)
        if response_format:
            payload["format"] = response_format
        
        # Ollama tools format - normalize tools to ensure compatibility
        if tools:
            payload["tools"] = self._normalize_tools_for_ollama(tools)
        
        # Enable thinking mode if supported (some models support it, some don't)
        if thinking_enabled:
            model_info = self._model_cache.get(model_name)
            if model_info and model_info.supports_thinking:
                payload["thinking"] = True
                logger.info(f"Ollama: Enabled native thinking mode for {model_name}")
        
        # Map a few known-safe options into Ollama's options object
        options: Dict[str, Any] = {}
        try:
            if isinstance(kwargs.get("temperature"), (int, float)):
                options["temperature"] = kwargs.get("temperature")
            if isinstance(kwargs.get("top_p"), (int, float)):
                options["top_p"] = kwargs.get("top_p")
            if isinstance(kwargs.get("max_tokens"), int):
                options["num_predict"] = kwargs.get("max_tokens")
        except Exception:
            pass
        if options:
            payload["options"] = options
        # Keep-alive passthrough if explicitly provided
        if "keep_alive" in kwargs:
            payload["keep_alive"] = kwargs["keep_alive"]
        
        if stream:
            return self._stream_generate(payload)
        else:
            return await self._generate(payload)
    
    def _prepare_messages_with_media(
        self,
        messages: List[Dict[str, Any]],
        media_inputs: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """
        Convert text + media_inputs into Ollama message format.
        
        Ollama supports images in messages as base64-encoded strings in content arrays.
        Format: {"role": "user", "content": [{"type": "image", "source": {"type": "base64", "media_type": "...", "data": "..."}}, {"type": "text", "text": "..."}]}
        
        Args:
            messages: Original message list
            media_inputs: List of media items with type, content (bytes), mime_type
            
        Returns:
            Updated messages list with images added to last user message
        """
        import base64
        
        if not media_inputs:
            return messages
        
        # Find the last user message
        processed_messages = list(messages)
        last_user_idx = -1
        for i in range(len(processed_messages) - 1, -1, -1):
            if processed_messages[i].get("role") == "user":
                last_user_idx = i
                break
        
        if last_user_idx == -1:
            logger.warning("No user message found to attach images to")
            return messages
        
        # Get the last user message
        last_msg = processed_messages[last_user_idx]
        original_content = last_msg.get("content", "")
        
        # Build content array for Ollama
        content_array = []
        
        # Add images FIRST (similar to Anthropic best practice)
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
            
            # Add image block (Ollama format)
            content_array.append({
                "type": "image",
                "source": {
                    "type": "base64",
                    "media_type": mime_type,
                    "data": image_base64
                }
            })
            
            logger.debug(f"Added image block: {mime_type}, {len(image_bytes)} bytes")
        
        # Add text content AFTER images
        if isinstance(original_content, str) and original_content.strip():
            content_array.append({
                "type": "text",
                "text": original_content
            })
        elif isinstance(original_content, list):
            # Already content blocks - extend them
            content_array.extend(original_content)
        
        # Update the last user message
        processed_messages[last_user_idx] = {
            **last_msg,
            "content": content_array if content_array else original_content
        }
        
        logger.info(f"Added {len([m for m in media_inputs if m.get('type') == 'image'])} images to last user message")
        return processed_messages
    
    def _extract_tool_result_streams(self, tool_result: Any, tool_name: str) -> tuple[str, Any]:
        """
        Extract separate LLM and frontend streams from tool result.
        
        Returns:
            Tuple of (llm_content, frontend_data) where:
            - llm_content: Concise text for model conversation (~200-500 chars)
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
            # Extract concise content for LLM
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
    
    async def _stream_tool_loop_wrapper(self,
                                       messages: List[Dict[str, str]],
                                       model_name: str,
                                       tools: List[Dict],
                                       thinking_enabled: bool,
                                       tool_executor: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
                                       **kwargs) -> AsyncIterator[GenerationResponse]:
        """
        Streaming wrapper that yields intermediate results during tool loop execution.
        This provides real-time updates like Anthropic's implementation.
        """
        try:
            logger.info("Executing Ollama tool loop with streaming updates")
            
            # Execute tool loop and yield intermediate results
            async for response in self._tool_loop_generate_streaming(
                messages=messages,
                model_name=model_name,
                tools=tools,
                thinking_enabled=thinking_enabled,
                tool_executor=tool_executor,
                **kwargs
            ):
                yield response
            
        except Exception as e:
            logger.error(f"Ollama tool loop streaming wrapper error: {e}", exc_info=True)
            raise
    
    async def _tool_loop_generate_streaming(self,
                                           messages: List[Dict[str, str]],
                                           model_name: str,
                                           tools: List[Dict],
                                           thinking_enabled: bool,
                                           tool_executor: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
                                           **kwargs) -> AsyncIterator[GenerationResponse]:
        """
        Handle tool loop with streaming updates and segmented thinking (like Anthropic).
        Yields intermediate results during generation AND tool execution.
        """
        
        iterative_messages = list(messages)
        all_tool_executions = []  # Track all tool executions for frontend display
        max_iterations = 10
        accumulated_content = ""
        
        for iteration in range(1, max_iterations + 1):
            logger.info(f"Ollama tool loop iteration {iteration}/{max_iterations} - streaming generation")
            
            # Stream the generation and collect the final response
            iteration_content = ""
            current_thinking = None
            final_resp = None
            tool_calls = []
            
            # Build payload for direct streaming (bypass generate() to avoid coroutine issues)
            try:
                messages_for_request: List[Dict[str, Any]] = [dict(m) for m in (iterative_messages or [])]
            except Exception:
                messages_for_request = list(iterative_messages or [])
            
            # DON'T add thinking prompts - let model use native thinking capability
            
            payload = {
                "model": model_name,
                "messages": messages_for_request,
                "stream": True,
                "tools": self._normalize_tools_for_ollama(tools),
                "options": kwargs.get("options", {})
            }
            
            # Enable native thinking mode if supported and requested
            if thinking_enabled:
                model_info = self._model_cache.get(model_name)
                if model_info and model_info.supports_thinking:
                    payload["thinking"] = True
            
            # Call _stream_generate directly to get the async iterator
            async for chunk in self._stream_generate(payload):
                final_resp = chunk
                iteration_content = chunk.content or ""
                current_thinking = chunk.thinking_trace
                tool_calls = getattr(chunk, "tool_calls", None) or []
                
                # Yield streaming content updates
                yield GenerationResponse(
                    content=accumulated_content + iteration_content,
                    model_used=chunk.model_used,
                    thinking_trace=current_thinking,
                    tool_calls=None,
                    tool_executions=all_tool_executions.copy() if all_tool_executions else None,
                    raw_response=chunk.raw_response
                )
            
            # After streaming completes, check for tool calls
            logger.info(f"Ollama iteration {iteration} complete. Content: {len(iteration_content)} chars, Tools: {len(tool_calls)}")
            
            # If no tool calls, we're done
            if not tool_calls:
                logger.info(f"Ollama tool loop completed at iteration {iteration} with no more tool calls")
                # Accumulate final content
                accumulated_content += iteration_content
                
                # Yield final response with all tool executions
                final_response = GenerationResponse(
                    content=accumulated_content,
                    model_used=final_resp.model_used if final_resp else model_name,
                    thinking_trace=current_thinking,
                    tool_calls=None,
                    tool_executions=all_tool_executions if all_tool_executions else None,
                    raw_response=final_resp.raw_response if final_resp else None
                )
                yield final_response
                return
            
            # We have tool calls - accumulate content and prepare to execute tools
            logger.info(f"Ollama tool loop iteration {iteration}: Executing {len(tool_calls)} tool calls")
            accumulated_content += iteration_content
            
            # Append model's response to the conversation history before tool results
            # Build the message structure that Ollama expects
            if final_resp and final_resp.raw_response and final_resp.raw_response.get("message"):
                iterative_messages.append(final_resp.raw_response["message"])
            else:
                # Fallback: construct message manually
                iterative_messages.append({
                    "role": "assistant",
                    "content": iteration_content,
                    "tool_calls": tool_calls
                })

            # Process each tool call and yield intermediate updates
            for tc in tool_calls:
                try:
                    name = ((tc or {}).get("function") or {}).get("name") or tc.get("name")
                    args_str = ((tc or {}).get("function") or {}).get("arguments") or tc.get("arguments") or "{}"
                    
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else (args_str or {})
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse tool arguments for {name}: {args_str}")
                        args = {}
                    
                    if not name:
                        logger.warning("Tool call missing name, skipping")
                        continue

                    logger.info(f"Executing Ollama tool: {name} with args: {args}")
                    tool_result = await tool_executor(name, args)
                    
                    # Extract separate streams for LLM and frontend
                    llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)
                    
                    # Check if tool execution failed
                    has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
                    
                    # Record execution with FULL data for frontend
                    tool_execution = {
                        "id": tc.get("id") or f"call_{name}_{iteration}",
                        "tool_name": name,
                        "arguments": args,
                        "result": frontend_data if not has_error else None,
                        "error": tool_result.get("error") if has_error and isinstance(tool_result, dict) else None,
                        "status": "failed" if has_error else "completed",
                        "iteration": iteration,
                        "thinking_before": current_thinking if current_thinking else None  # Attach thinking to tool
                    }
                    all_tool_executions.append(tool_execution)
                    
                    llm_chars = len(llm_content) if isinstance(llm_content, str) else 0
                    logger.info(f"Tool {name} executed - sent {llm_chars} chars to LLM")
                    
                    # Yield intermediate update with this tool execution
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=final_resp.model_used if final_resp else model_name,
                        thinking_trace=None,  # Thinking is attached to tool now
                        tool_calls=None,
                        tool_executions=all_tool_executions.copy(),
                        raw_response=final_resp.raw_response if final_resp else None
                    )
                    
                    if has_error:
                        logger.warning(f"Tool {name} returned error: {tool_result.get('error') if isinstance(tool_result, dict) else tool_result}")
                    
                    # Send ONLY concise content to LLM conversation
                    iterative_messages.append({
                        "role": "tool", 
                        "content": llm_content
                    })
                except Exception as e:
                    logger.error(f"Tool execution failed for {name}: {e}", exc_info=True)
                    # If a single tool call fails, provide error message to model
                    error_result = {"error": f"Tool execution failed: {str(e)}"}
                    
                    # Record failed execution with thinking
                    failed_execution = {
                        "id": tc.get("id") or f"call_{name}_{iteration}",
                        "tool_name": name,
                        "arguments": args,
                        "error": str(e),
                        "status": "failed",
                        "iteration": iteration,
                        "thinking_before": current_thinking if current_thinking else None
                    }
                    all_tool_executions.append(failed_execution)
                    
                    # Yield intermediate update for failed execution
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=final_resp.model_used if final_resp else model_name,
                        thinking_trace=None,
                        tool_calls=None,
                        tool_executions=all_tool_executions.copy(),
                        raw_response=final_resp.raw_response if final_resp else None
                    )
                    
                    iterative_messages.append({
                        "role": "tool",
                        "content": json.dumps(error_result)
                    })
                    continue
        
        # Max iterations reached - stream one more time and yield final result
        logger.warning(f"Ollama tool loop reached maximum iterations ({max_iterations})")
        
        last_content = ""
        last_thinking = None
        last_resp = None
        
        # Build payload for direct streaming
        try:
            messages_for_request: List[Dict[str, Any]] = [dict(m) for m in (iterative_messages or [])]
        except Exception:
            messages_for_request = list(iterative_messages or [])
        
        # DON'T add thinking prompts - let model use native thinking capability
        
        payload = {
            "model": model_name,
            "messages": messages_for_request,
            "stream": True,
            "tools": self._normalize_tools_for_ollama(tools),
            "options": kwargs.get("options", {})
        }
        
        # Enable native thinking mode if supported and requested
        if thinking_enabled:
            model_info = self._model_cache.get(model_name)
            if model_info and model_info.supports_thinking:
                payload["thinking"] = True
        
        # Call _stream_generate directly
        async for chunk in self._stream_generate(payload):
            last_resp = chunk
            last_content = chunk.content or ""
            last_thinking = chunk.thinking_trace
            
            # Yield streaming updates
            yield GenerationResponse(
                content=accumulated_content + last_content,
                model_used=chunk.model_used,
                thinking_trace=last_thinking,
                tool_calls=None,
                tool_executions=all_tool_executions if all_tool_executions else None,
                raw_response=chunk.raw_response
            )
        
        # Final yield with accumulated content
        accumulated_content += last_content
        yield GenerationResponse(
            content=accumulated_content,
            model_used=last_resp.model_used if last_resp else model_name,
            thinking_trace=last_thinking,
            tool_calls=None,
            tool_executions=all_tool_executions if all_tool_executions else None,
            raw_response=last_resp.raw_response if last_resp else None
        )

    async def _generate(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation"""
        try:
            # Log the payload for debugging tool issues
            # if payload.get("tools"):
                # logger.info(f"Ollama request with tools: {json.dumps(payload.get('tools'), indent=2)}")
                # Also log the full payload to see if there are other issues
                # logger.info(f"Full Ollama payload: {json.dumps(payload, indent=2)}")
            
            response = await self.client.post(f"{self.base_url}/api/chat", json=payload)
            response.raise_for_status()
            
            try:
                data = response.json()
            except json.JSONDecodeError as e:
                logger.error(f"Failed to parse Ollama response JSON: {e}")
                logger.error(f"Raw response: {response.text}")
                raise RuntimeError(f"Invalid JSON response from Ollama: {str(e)}")
            
            message_obj = data.get("message", {}) or {}
            content = message_obj.get("content", "")
            
            # Debug: Log the full response structure when content is empty
            if not content or content.strip() == "":
                logger.error(f"Ollama returned empty content. Full response structure:")
                logger.error(f"  - Response keys: {list(data.keys())}")
                logger.error(f"  - Message object: {message_obj}")
                logger.error(f"  - Model: {data.get('model', 'unknown')}")
                logger.error(f"  - Done: {data.get('done', 'unknown')}")
                logger.error(f"  - Done reason: {data.get('done_reason', 'unknown')}")
                
                # Check if this was a JSON schema request
                if payload.get("format") == "json":
                    logger.error("This was a structured JSON request. Complex schemas may cause empty responses.")
                    logger.error("Consider: 1) Simplifying the schema, 2) Using a more capable model, 3) Adding examples to the prompt")
                    logger.error("RECOMMENDATION: For complex political analysis schemas, use OpenAI models (GPT-4) instead of smaller Ollama models.")
                
                # Don't raise an error - let the annotation system handle the empty response
                logger.warning("Continuing with empty content - this will result in a failed annotation.")
            thinking_trace = self._extract_thinking_trace(content)
            clean_content = self._remove_thinking_tags(content)
            
            return GenerationResponse(
                content=clean_content,
                model_used=data["model"],
                usage=data.get("usage"),  # Ollama may not provide usage
                tool_calls=message_obj.get("tool_calls") or self._extract_tool_calls(content),
                thinking_trace=thinking_trace,
                finish_reason=data.get("done_reason"),
                raw_response=data
            )
            
        except httpx.HTTPStatusError as e:
            # If tools may be rejected, retry once without tools
            status = getattr(e, "response", None).status_code if getattr(e, "response", None) else None
            should_retry_without_tools = bool(status == 400 and isinstance(payload, dict) and payload.get("tools"))
            try:
                error_text = getattr(e.response, 'text', '') if hasattr(e, 'response') else str(e)
                error_json = None
                try:
                    if hasattr(e, 'response') and hasattr(e.response, 'json'):
                        error_json = e.response.json()
                except Exception:
                    pass
                
                logger.error(f"Ollama API error: {getattr(e.response, 'status_code', None) if hasattr(e, 'response') else 'unknown'} - {error_text}")
                if error_json:
                    logger.error(f"Ollama error JSON: {json.dumps(error_json, indent=2)}")
                
                # Check for memory-related errors (500 with memory error message)
                if status == 500:
                    error_lower = (error_text or "").lower()
                    if "memory" in error_lower or "requires more" in error_lower:
                        model_name = payload.get("model", "the model")
                        user_friendly_error = (
                            f"Model '{model_name}' requires more memory than available. "
                            f"Try: 1) Using a smaller model, 2) Increasing Docker memory limits, "
                            f"3) Using a model with quantization (e.g., qwen3-vl:8b-q4_K_M instead of qwen3-vl:8b)"
                        )
                        logger.error(user_friendly_error)
                        raise RuntimeError(user_friendly_error)
                
                # Log tools specifically if they're present
                if payload.get("tools"):
                    logger.error(f"Request included {len(payload['tools'])} tools")
                    logger.error(f"First tool sample: {json.dumps(payload['tools'][0] if payload['tools'] else {}, indent=2)}")
                
                # Check if error mentions tools
                if "tool" in error_text.lower() or "function" in error_text.lower():
                    logger.error(f"Error appears to be tool-related: {error_text}")
                elif "parameter" in error_text.lower() or "schema" in error_text.lower():
                    logger.error(f"Error appears to be schema-related: {error_text}")
                    
                try:
                    logger.error(f"Full Ollama request payload: {json.dumps(payload, indent=2)}")
                except Exception:
                    logger.error("Ollama request payload: <unserializable>")
            except RuntimeError:
                # Re-raise memory errors
                raise
            except Exception:
                logger.error("Ollama API error (unable to log payload)")
            if should_retry_without_tools:
                retry_payload = dict(payload)
                retry_payload.pop("tools", None)
                logger.info("Retrying Ollama /api/chat without tools due to 400 error")
                response = await self.client.post(f"{self.base_url}/api/chat", json=retry_payload)
                response.raise_for_status()
                data = response.json()
            
            # For other 500 errors, provide more context
            if status == 500:
                model_name = payload.get("model", "the model")
                raise RuntimeError(
                    f"Ollama server error with model '{model_name}'. "
                    f"This may be due to insufficient memory, model not found, or server issues. "
                    f"Check Ollama logs for details. Error: {error_text or 'Unknown error'}"
                )
            
            raise RuntimeError(f"Ollama generation failed: {e.response.text}")
        except Exception as e:
            logger.error(f"Ollama generation error: {e}")
            raise RuntimeError(f"Ollama generation failed: {str(e)}")
    
    async def _stream_generate(self, payload: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation - stream as-is, extract thinking at the end"""
        try:
            async with self.client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                response.raise_for_status()
                
                accumulated_content = ""
                model_used = payload["model"]
                chunk_count = 0
                
                async for line in response.aiter_lines():
                    try:
                        # Debug: Log raw first few lines
                        if chunk_count < 3:
                            logger.info(f"Ollama RAW line #{chunk_count + 1}: {line[:200] if line else 'EMPTY'}")
                        
                        chunk = json.loads(line)
                        chunk_count += 1
                        
                        # Debug: Log first few chunks to diagnose missing <think> tag
                        if chunk_count <= 5:
                            msg_preview = chunk.get("message", {})
                            content_preview = msg_preview.get("content", "") if isinstance(msg_preview, dict) else ""
                            logger.info(f"Ollama chunk #{chunk_count}: "
                                       f"content_length={len(content_preview)}, "
                                       f"has_<think>={'<think>' in content_preview}, "
                                       f"content_preview={repr(content_preview[:150]) if content_preview else 'EMPTY'}, "
                                       f"chunk_keys={list(chunk.keys())}, "
                                       f"message_keys={list(msg_preview.keys()) if isinstance(msg_preview, dict) else 'N/A'}")
                        
                        if chunk.get("done"):
                            # NOW extract thinking and clean content
                            final_thinking = self._extract_thinking_trace(accumulated_content)
                            final_content = self._remove_thinking_tags(accumulated_content)
                            
                            # Debug logging
                            has_opening = "<think>" in accumulated_content
                            has_closing = "</think>" in accumulated_content
                            logger.info(f"Ollama stream complete. Total: {len(accumulated_content)} chars, "
                                       f"<think>: {has_opening}, </think>: {has_closing}, "
                                       f"Extracted thinking: {len(final_thinking) if final_thinking else 0} chars, "
                                       f"Final content: {len(final_content)} chars")
                            
                            if has_opening and not has_closing:
                                logger.warning("Ollama: Opening <think> tag found but no closing tag!")
                            
                            tool_calls = chunk.get("message", {}).get("tool_calls") if chunk.get("message") else None
                            
                            yield GenerationResponse(
                                content=final_content,
                                model_used=model_used,
                                thinking_trace=final_thinking,
                                tool_calls=tool_calls,
                                raw_response=chunk
                            )
                            break
                        
                        msg = chunk.get("message", {}) or {}
                        content_delta = msg.get("content", "")
                        
                        if not content_delta:
                            # Log if we're skipping chunks that might contain metadata
                            if chunk_count <= 5 and msg:
                                logger.debug(f"Ollama chunk #{chunk_count}: Skipping empty content (msg keys: {list(msg.keys())})")
                            continue
                        
                        accumulated_content += content_delta
                        
                        # Debug: Log when we see thinking tags
                        if "<think>" in content_delta:
                            logger.info(f"Ollama: Detected <think> tag in stream. Accumulated so far: {len(accumulated_content)} chars")
                        if "</think>" in content_delta:
                            logger.info(f"Ollama: Detected </think> tag in stream. Total content: {len(accumulated_content)} chars")
                        
                        # Stream content delta as-is (with tags included temporarily)
                        tool_calls = msg.get("tool_calls") or None
                        
                        yield GenerationResponse(
                            content=accumulated_content,  # Stream raw accumulated content
                            model_used=model_used,
                            thinking_trace=None,  # Don't extract until complete
                            tool_calls=tool_calls,
                            raw_response=chunk
                        )
                        
                    except json.JSONDecodeError:
                        continue
                        
        except httpx.HTTPStatusError as e:
            error_text = None
            error_json = None
            try:
                # Ensure the response content is read before accessing .text
                await e.response.aread()
                error_text = e.response.text if hasattr(e.response, 'text') else str(e)
                # Try to parse JSON error response
                try:
                    error_json = e.response.json() if hasattr(e.response, 'json') else None
                except Exception:
                    pass
            except Exception:
                error_text = str(e)
            
            try:
                logger.error(f"Ollama streaming error: {e.response.status_code} - {error_text}")
                if error_json:
                    logger.error(f"Ollama error JSON: {json.dumps(error_json, indent=2)}")
                try:
                    logger.error(f"Ollama request payload: {json.dumps(payload, indent=2)}")
                except Exception:
                    logger.error("Ollama request payload: <unserializable>")
            except Exception:
                logger.error("Ollama streaming error (unable to log payload)")
            
            # Check for memory-related errors (500 with memory error message)
            if e.response.status_code == 500:
                # Check if error mentions memory
                error_lower = (error_text or "").lower()
                if "memory" in error_lower or "requires more" in error_lower:
                    # Extract model name from payload
                    model_name = payload.get("model", "the model")
                    user_friendly_error = (
                        f"Model '{model_name}' requires more memory than available. "
                        f"Try: 1) Using a smaller model, 2) Increasing Docker memory limits, "
                        f"3) Using a model with quantization (e.g., qwen3-vl:8b-q4_K_M instead of qwen3-vl:8b)"
                    )
                    logger.error(user_friendly_error)
                    raise RuntimeError(user_friendly_error)
            
            # Retry once without tools on 400
            if e.response.status_code == 400 and isinstance(payload, dict) and payload.get("tools"):
                retry_payload = dict(payload)
                retry_payload.pop("tools", None)
                logger.info("Retrying Ollama streaming without tools due to 400 error")
                async with self.client.stream("POST", f"{self.base_url}/api/chat", json=retry_payload) as response:
                    response.raise_for_status()
                    accumulated_content = ""
                    model_used = retry_payload["model"]
                    
                    async for line in response.aiter_lines():
                        try:
                            chunk = json.loads(line)
                            if chunk.get("done"):
                                # Final extraction
                                final_thinking = self._extract_thinking_trace(accumulated_content)
                                final_content = self._remove_thinking_tags(accumulated_content)
                                yield GenerationResponse(
                                    content=final_content,
                                    model_used=model_used,
                                    thinking_trace=final_thinking,
                                    tool_calls=None,
                                    raw_response=chunk
                                )
                                break
                            
                            msg = chunk.get("message", {}) or {}
                            content_delta = msg.get("content", "")
                            if not content_delta:
                                continue
                            
                            accumulated_content += content_delta
                            
                            # Stream as-is
                            yield GenerationResponse(
                                content=accumulated_content,
                                model_used=model_used,
                                thinking_trace=None,
                                tool_calls=None,
                                raw_response=chunk
                            )
                        except json.JSONDecodeError:
                            continue
                return
            
            # For other 500 errors, provide more context
            if e.response.status_code == 500:
                model_name = payload.get("model", "the model")
                raise RuntimeError(
                    f"Ollama server error with model '{model_name}'. "
                    f"This may be due to insufficient memory, model not found, or server issues. "
                    f"Check Ollama logs for details. Error: {error_text or 'Unknown error'}"
                )
            
            raise RuntimeError(f"Ollama streaming failed: {error_text}")
        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            raise RuntimeError(f"Ollama streaming failed: {str(e)}")
    
    def _extract_thinking_trace(self, content: str) -> Optional[str]:
        """Ollama: Extract content between <think></think> tags
        
        Handles both:
        - Complete tags: <think>...</think>
        - Qwen-style (missing opening): Everything before </think>
          Note: Some models like Qwen3-Thinking bake <think> into their chat template,
          so they only output </think>. This is intentional behavior.
        """
        # First try complete tags
        think_pattern = r'<think>(.*?)</think>'
        matches = re.findall(think_pattern, content, re.DOTALL)
        
        if matches:
            return '\n'.join(matches).strip()
        
        # Qwen-style: Only has closing tag (opening is in chat template)
        # Extract everything before </think>
        if '</think>' in content and '<think>' not in content:
            parts = content.split('</think>', 1)
            if parts[0].strip():
                logger.debug(f"Ollama: Qwen-style thinking detected (missing opening tag), extracted {len(parts[0])} chars")
                return parts[0].strip()
        
        return None
    
    def _remove_thinking_tags(self, content: str) -> str:
        """Remove <think></think> tags and their content from the main response
        
        Handles both:
        - Complete tags: <think>...</think>
        - Qwen-style (missing opening): Everything before </think>
        """
        # Remove complete thinking blocks
        cleaned = re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL)
        
        # Qwen-style: Only has closing tag, remove everything before it
        if '</think>' in cleaned and '<think>' not in cleaned:
            parts = cleaned.split('</think>', 1)
            cleaned = parts[1] if len(parts) > 1 else cleaned
        
        return cleaned.strip()
    
    def _clean_thinking_trace(self, thinking_trace: str) -> str:
        """Clean up thinking trace by removing tags"""
        return thinking_trace.replace("<think>", "").replace("</think>", "").strip()
    
    def _extract_tool_calls(self, content: str) -> Optional[List[Dict]]:
        """Ollama: Extract tool calls from content (they're embedded as JSON)"""
        # Look for JSON objects that look like tool calls
        json_pattern = r'\{[^}]*"function"[^}]*\}'
        matches = re.findall(json_pattern, content)
        
        tool_calls = []
        for match in matches:
            try:
                tool_call = json.loads(match)
                if "function" in tool_call:
                    tool_calls.append(tool_call)
            except json.JSONDecodeError:
                continue
        
        return tool_calls if tool_calls else None
    
    def _normalize_tools_for_ollama(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert tools to Ollama's function calling format."""
        normalized_tools = []
        
        for tool in tools:
            # Extract tool info based on format
            if tool.get("type") == "mcp":
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
            elif tool.get("type") == "function":
                if isinstance(tool.get("function"), dict):
                    # Already in function format, pass through
                    normalized_tools.append(tool)
                    continue
                else:
                    # Bare function format
                    name = tool.get("name")
                    description = tool.get("description")
                    parameters = tool.get("parameters")
            else:
                logger.warning(f"Skipping tool with unknown type: {tool.get('type')}")
                continue
            
            # Skip tools with missing required fields
            if not name or not parameters:
                logger.warning(f"Skipping tool with missing name or parameters: {tool}")
                continue
            
            # Build Ollama tool definition (nested function format)
            normalized_tools.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": description or f"Execute {name}",
                    "parameters": parameters
                }
            })
        
        return normalized_tools

    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)
    

