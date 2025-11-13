"""
OpenAI Language Model Provider Implementation using Official SDK
"""
import logging
import json
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Callable, Awaitable

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse
from app.core.config import settings

logger = logging.getLogger(__name__)

# Default OpenAI model configurations
DEFAULT_OPENAI_MODELS = {
    "gpt-5-nano": {
        "description": "GPT-5 Nano - Efficient reasoning model optimized for intelligence analysis",
        "supports_thinking": True,
    },
}


class OpenAILanguageModelProvider(LanguageModelProvider):
    """
    OpenAI implementation using the official OpenAI SDK.
    Handles chat, structured output, tool calls, and streaming with the Responses API.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        try:
            from openai import AsyncOpenAI
        except ImportError:
            raise ImportError("OpenAI SDK not installed. Run: pip install openai")
        
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = AsyncOpenAI(
            api_key=api_key,
            base_url=base_url
        )
        self._model_cache = {}
        logger.info(f"OpenAI SDK provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Discover available OpenAI models using default list.
        
        Returns hardcoded list of supported models since API-based discovery
        requires a valid API key (which is only provided at runtime from frontend).
        """
        models = []
        
        for model_name, model_config in DEFAULT_OPENAI_MODELS.items():
            model_info = ModelInfo(
                name=model_name,
                provider="openai",
                supports_structured_output=True,
                supports_tools=True,
                supports_streaming=True,
                supports_thinking=model_config.get("supports_thinking", False),
                supports_multimodal=True,
                max_tokens=None,
                context_length=None,
                description=model_config.get("description", f"OpenAI {model_name}")
            )
            models.append(model_info)
            self._model_cache[model_name] = model_info
        
        logger.info(f"Loaded {len(models)} OpenAI models from defaults")
        return models
    
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
        Generate response using OpenAI's Responses API via the official SDK.
        """
        # Separate system instructions from messages
        system_instructions = None
        input_messages = list(messages)
        if input_messages and input_messages[0].get("role") == "system":
            system_instructions = input_messages.pop(0).get("content")
        
        # Convert messages to Responses API input format
        input_items = self._messages_to_responses_input(input_messages)
        
        # Build the base request parameters
        base_params = {
            "model": model_name,
            "input": input_items,
            "stream": stream,
            "store": False,  # Use stateless mode - build conversation in input
        }
        
        # Add system instructions if present
        if system_instructions:
            base_params["instructions"] = system_instructions
        
        # Add tools if provided
        if tools:
            base_params["tools"] = self._prepare_tools_for_responses(tools, kwargs.get("mcp_headers"))
        
        # Add structured output format if provided
        if response_format:
            base_params["text"] = {
                "format": {
                    "type": "json_schema",
                    "name": response_format.get("title", "StructuredOutput"),
                    "schema": self._clean_json_schema_for_openai(response_format)
                }
            }
        
        # Add other parameters
        if "temperature" in kwargs:
            base_params["temperature"] = kwargs["temperature"]
        if "max_tokens" in kwargs:
            base_params["max_output_tokens"] = kwargs["max_tokens"]
        if "top_p" in kwargs:
            base_params["top_p"] = kwargs["top_p"]
        
        # Try with thinking first if enabled
        if thinking_enabled and tools:
            request_params = base_params.copy()
            request_params["reasoning"] = {"effort": "medium"}
            
            try:
                if stream:
                    # When we have tools with executor, wrap the tool loop for streaming
                    if tool_executor:
                        logger.info("Streaming with thinking + tools: wrapping tool loop execution")
                        return self._stream_tool_loop_wrapper(request_params, tool_executor)
                    else:
                        return self._stream_generate_responses(request_params)
                else:
                    return await self._generate_responses(request_params, tool_executor)
            except Exception as e:
                error_str = str(e)
                # Check if the error is about unsupported reasoning parameter
                if "reasoning" in error_str and ("unsupported" in error_str or "not supported" in error_str):
                    logger.warning(f"Model {model_name} doesn't support reasoning, retrying without thinking")
                    # Fall back to request without reasoning
                    if stream:
                        if tool_executor and base_params.get("tools"):
                            logger.info("Fallback: Streaming with tools (no thinking)")
                            return self._stream_tool_loop_wrapper(base_params, tool_executor)
                        else:
                            return self._stream_generate_responses(base_params)
                    else:
                        return await self._generate_responses(base_params, tool_executor)
                else:
                    # Re-raise if it's a different error
                    raise
        
        # No thinking enabled, use base params directly
        try:
            if stream:
                logger.info(f"Using streaming mode")
                # When we have tools with executor, we need to wrap the non-streaming tool loop
                # in an async generator that yields the final result
                if tool_executor and base_params.get("tools"):
                    logger.info("Streaming with tools: wrapping tool loop execution")
                    return self._stream_tool_loop_wrapper(base_params, tool_executor)
                else:
                    return self._stream_generate_responses(base_params)
            else:
                logger.info(f"Using non-streaming mode with tools={len(base_params.get('tools', []))} tool_executor={tool_executor is not None}")
                return await self._generate_responses(base_params, tool_executor)
        except Exception as e:
            logger.error(f"OpenAI SDK generation error: {e}", exc_info=True)
            raise RuntimeError(f"OpenAI generation failed: {str(e)}")
    
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
    
    async def _stream_tool_loop_wrapper(self, request_params: Dict, tool_executor: Callable) -> AsyncIterator[GenerationResponse]:
        """
        Wrapper that executes the tool loop and yields the final result for streaming.
        
        The Responses API tool loop is not truly streaming - it executes all tool calls
        synchronously and returns the final result. This wrapper makes it compatible with
        streaming endpoints by yielding the final response.
        """
        try:
            # Execute the entire tool loop
            final_response = await self._tool_loop_generate_responses(request_params, tool_executor)
            
            # Yield the final response
            yield final_response
            
        except Exception as e:
            logger.error(f"Tool loop streaming wrapper error: {e}", exc_info=True)
            raise
    
    async def _generate_responses(self, request_params: Dict, tool_executor: Optional[Callable] = None) -> GenerationResponse:
        """Handle non-streaming generation using the Responses API with tool execution loop."""
        try:
            # If we have a tool executor, implement the tool loop
            if tool_executor and request_params.get("tools"):
                logger.info(f"Starting tool loop with {len(request_params.get('tools', []))} tools")
                return await self._tool_loop_generate_responses(request_params, tool_executor)
            
            # Otherwise, do a simple single-shot generation
            logger.info("No tool executor or tools - doing single-shot generation")
            response = await self.client.responses.create(**request_params)
            
            # Check response status and handle errors
            logger.info(f"Response status: {response.status}")
            if response.error:
                logger.error(f"OpenAI API error: {response.error}")
                raise RuntimeError(f"OpenAI API returned error: {response.error}")
            
            if response.status != "completed":
                logger.warning(f"Response status is '{response.status}', not 'completed'")
                if response.status in ["failed", "cancelled"]:
                    raise RuntimeError(f"Response generation {response.status}")
            
            # Extract content from the response
            content = ""
            tool_calls = []
            
            logger.info(f"Response has {len(response.output)} output items")
            for output_item in response.output:
                logger.debug(f"Processing output item: type={output_item.type}, role={getattr(output_item, 'role', 'N/A')}")
                
                # Handle top-level function_call output items
                if output_item.type == "function_call":
                    logger.info(f"Found top-level function call: {output_item.name}")
                    tool_calls.append({
                        "id": output_item.id or f"call_{output_item.name}",
                        "type": "function",
                        "function": {
                            "name": output_item.name,
                            "arguments": output_item.arguments or "{}"
                        }
                    })
                # Handle message output items with content
                elif output_item.type == "message" and output_item.role == "assistant":
                    for content_part in output_item.content:
                        if content_part.type == "output_text":
                            content = content_part.text
                        elif content_part.type == "function_call":
                            logger.info(f"Found function call in message content: {content_part.name}")
                            tool_calls.append({
                                "id": content_part.id or f"call_{content_part.name}",
                                "type": "function",
                                "function": {
                                    "name": content_part.name,
                                    "arguments": content_part.arguments or "{}"
                                }
                            })
            
            # Log warning if we got neither content nor tool calls
            if not content and not tool_calls:
                logger.warning("Response generated neither content nor tool calls!")
                logger.debug(f"Raw response: {response.model_dump() if hasattr(response, 'model_dump') else response}")
            
            return GenerationResponse(
                content=content,
                model_used=response.model,
                usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else response.usage,
                thinking_trace=self._extract_thinking_trace(response),
                finish_reason=getattr(response, 'finish_reason', None),
                tool_calls=tool_calls if tool_calls else None,
                raw_response=response.model_dump() if hasattr(response, 'model_dump') else response,
            )
            
        except Exception as e:
            logger.error(f"OpenAI SDK non-streaming error: {e}")
            raise RuntimeError(f"OpenAI generation failed: {str(e)}")
    
    async def _tool_loop_generate_responses(self, request_params: Dict, tool_executor: Callable) -> GenerationResponse:
        """Execute a tool loop for the Responses API, handling tool calls until completion.
        
        This implements agentic behavior where the model can:
        1. Make tool calls
        2. Receive tool results
        3. Make additional tool calls or provide a final response
        
        Returns structured tool execution history for frontend display.
        """
        import json
        
        max_iterations = 10  # Prevent infinite loops
        iteration = 0
        
        # Stateless mode: build conversation by appending function_call + function_call_output to input
        conversation_input = list(request_params.get("input", []))
        
        # Track all tool executions for the frontend
        all_tool_executions = []
        
        while iteration < max_iterations:
            iteration += 1
            logger.debug(f"Tool loop iteration {iteration}/{max_iterations}")
            
            # Prepare request for this iteration (stateless mode)
            loop_params = request_params.copy()
            loop_params["input"] = conversation_input
            
            # Log request structure
            logger.debug(f"Request has {len(conversation_input)} input items")
            
            # Make the API call
            response = await self.client.responses.create(**loop_params)
            
            # Check response status and handle errors
            logger.info(f"Tool loop iteration {iteration}: Response id={response.id}, status: {response.status}")
            if response.error:
                logger.error(f"OpenAI API error in tool loop: {response.error}")
                raise RuntimeError(f"OpenAI API returned error: {response.error}")
            
            if response.status != "completed":
                logger.warning(f"Response status is '{response.status}', not 'completed'")
                if response.status in ["failed", "cancelled"]:
                    raise RuntimeError(f"Response generation {response.status}")
            
            # Extract content and tool calls
            content = ""
            tool_calls = []
            
            logger.info(f"Tool loop iteration {iteration}: Response has {len(response.output)} output items")
            
            for output_item in response.output:
                
                # Handle top-level function_call output items
                if output_item.type == "function_call":
                    # Use call_id (not id) - call_id is the function call identifier for matching
                    call_id = output_item.call_id or output_item.id or f"call_{output_item.name}"
                    logger.info(f"Tool loop: Found top-level function call: {output_item.name} with call_id={call_id}")
                    tool_calls.append({
                        "id": call_id,
                        "name": output_item.name,
                        "arguments": output_item.arguments or "{}"
                    })
                # Handle message output items with content
                elif output_item.type == "message" and output_item.role == "assistant":
                    for content_part in output_item.content:
                        if content_part.type == "output_text":
                            content = content_part.text
                        elif content_part.type == "function_call":
                            # Use call_id (not id) for matching
                            call_id = content_part.call_id or content_part.id or f"call_{content_part.name}"
                            logger.info(f"Tool loop: Found function call in message content: {content_part.name} with call_id={call_id}")
                            tool_calls.append({
                                "id": call_id,
                                "name": content_part.name,
                                "arguments": content_part.arguments or "{}"
                            })
            
            # If no tool calls, we're done
            if not tool_calls:
                logger.info(f"Tool loop iteration {iteration}: No tool calls, completing with content length: {len(content)}")
                if content:
                    logger.info(f"Response preview: {content[:100]}...")
                else:
                    logger.warning("Response has no content and no tool calls")
                return GenerationResponse(
                    content=content,
                    model_used=response.model,
                    usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else response.usage,
                    thinking_trace=self._extract_thinking_trace(response),
                    finish_reason=getattr(response, 'finish_reason', None),
                    tool_calls=None,
                    tool_executions=all_tool_executions if all_tool_executions else None,
                    raw_response=response.model_dump() if hasattr(response, 'model_dump') else response,
                )
            
            # Execute tool calls
            logger.info(f"Executing {len(tool_calls)} tool calls in iteration {iteration}")
            tool_results = []
            
            for tc in tool_calls:
                try:
                    name = tc["name"]
                    args_str = tc.get("arguments", "{}")
                    
                    # Parse arguments
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else (args_str or {})
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse tool arguments for {name}: {args_str}")
                        args = {}
                    
                    # Execute the tool
                    logger.info(f"Executing tool: {name} with args: {args}")
                    tool_result = await tool_executor(name, args)
                    
                    # Extract separate streams for LLM and frontend
                    llm_content, frontend_data = self._extract_tool_result_streams(tool_result, name)
                    
                    # Check if tool execution failed
                    has_error = isinstance(tool_result, dict) and bool(tool_result.get("error"))
                    
                    # Send ONLY concise content to LLM
                    tool_results.append({
                        "call_id": tc["id"],
                        "output": llm_content
                    })
                    
                    # Record execution with FULL data for frontend
                    # Include both result (for backward compatibility) and structured_content (for frontend renderers)
                    all_tool_executions.append({
                        "id": tc["id"],
                        "tool_name": name,
                        "arguments": args,
                        "result": frontend_data if not has_error else None,
                        "structured_content": frontend_data if not has_error else None,  # Explicit structured_content for frontend
                        "error": tool_result.get("error") if has_error and isinstance(tool_result, dict) else None,
                        "status": "failed" if has_error else "completed",
                        "iteration": iteration
                    })
                    
                    llm_chars = len(llm_content) if isinstance(llm_content, str) else 0
                    logger.info(f"Tool {name} executed - sent {llm_chars} chars to LLM")
                    
                    if has_error:
                        logger.warning(f"Tool {name} returned error: {tool_result.get('error')}")
                    else:
                        logger.info(f"Tool {name} executed successfully")
                    
                except Exception as e:
                    logger.error(f"Tool execution failed for {name}: {e}", exc_info=True)
                    error_result = {"error": f"Tool execution failed: {str(e)}"}
                    tool_results.append({
                        "call_id": tc["id"],
                        "output": error_result
                    })
                    
                    # Record failed execution
                    all_tool_executions.append({
                        "id": tc["id"],
                        "tool_name": name,
                        "arguments": args,
                        "error": str(e),
                        "status": "failed",
                        "iteration": iteration
                    })
            
            # Add tool results to the next request by appending them to the conversation
            # The Responses API will use previous_response_id to continue the conversation
            # and we'll need to add function_call_output items
            
            # Create a new input with tool results
            tool_result_items = []
            for result in tool_results:
                tool_result_items.append({
                    "type": "function_call_output",
                    "call_id": result["call_id"],
                    "output": json.dumps(result["output"])
                })
            
            # Stateless mode: append function_call items from response.output
            # followed by function_call_output items
            # According to OpenAI docs: "function_call must be immediately followed by function_call_output"
            logger.info(f"Tool loop: Appending function_call items from response to conversation")
            for output_item in response.output:
                if output_item.type == "function_call":
                    # Convert SDK object to dict for proper serialization
                    func_call_dict = output_item.model_dump(exclude_none=True)
                    conversation_input.append(func_call_dict)
                    logger.info(f"  - Appended function_call: {func_call_dict.get('name')} with call_id={func_call_dict.get('call_id')}")
            
            logger.info(f"Tool loop: Appending {len(tool_result_items)} function_call_output items to conversation")
            for item in tool_result_items:
                logger.info(f"  - call_id={item['call_id']}")
                conversation_input.append(item)
            
        # Max iterations reached
        logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
        return GenerationResponse(
            content=content or "Maximum tool execution iterations reached",
            model_used=response.model,
            usage=response.usage.model_dump() if hasattr(response.usage, 'model_dump') else response.usage,
            thinking_trace=self._extract_thinking_trace(response),
            finish_reason="max_iterations",
            tool_calls=None,
            tool_executions=all_tool_executions if all_tool_executions else None,
            raw_response=response.model_dump() if hasattr(response, 'model_dump') else {},
        )
    
    async def _stream_generate_responses(self, request_params: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation using the Responses API."""
        try:
            logger.debug(f"Creating streaming response with params: {request_params}")
            response_stream = await self.client.responses.create(**request_params)
            
            accumulated_content = ""
            model_used = request_params["model"]
            thinking_trace = ""
            tool_calls = []
            
            logger.debug(f"Response stream type: {type(response_stream)}")
            logger.debug(f"Has __aiter__: {hasattr(response_stream, '__aiter__')}")
            
            # Check if this is actually a streaming response or a complete response
            if hasattr(response_stream, 'output'):
                # This is a complete response, not a stream
                logger.debug("Received complete response instead of stream, converting to streaming format")
                content = ""
                for output_item in response_stream.output:
                    if output_item.type == "message" and output_item.role == "assistant":
                        for content_part in output_item.content:
                            if content_part.type == "output_text":
                                content = content_part.text
                
                # Yield the complete response as a single streaming event
                yield GenerationResponse(
                    content=content,
                    model_used=response_stream.model,
                    usage=response_stream.usage,
                    thinking_trace=self._extract_thinking_trace(response_stream),
                    finish_reason=getattr(response_stream, 'finish_reason', None),
                    tool_calls=None,  # TODO: Extract tool calls if present
                    raw_response=response_stream.model_dump() if hasattr(response_stream, 'model_dump') else response_stream,
                )
            elif hasattr(response_stream, '__aiter__'):
                # Async iterator
                logger.debug("Using async iterator for streaming")
                async for event in response_stream:
                    logger.debug(f"Received streaming event: {type(event)}")
                    response = self._process_streaming_event(event, accumulated_content, model_used, thinking_trace, tool_calls)
                    # Update accumulated content for next iteration
                    accumulated_content = response.content
                    thinking_trace = response.thinking_trace or ""
                    yield response
            else:
                # Sync iterator (fallback)
                logger.debug("Using sync iterator for streaming")
                for event in response_stream:
                    logger.debug(f"Received streaming event: {type(event)}")
                    response = self._process_streaming_event(event, accumulated_content, model_used, thinking_trace, tool_calls)
                    # Update accumulated content for next iteration
                    accumulated_content = response.content
                    thinking_trace = response.thinking_trace or ""
                    yield response
                    
        except Exception as e:
            error_str = str(e)
            # Check if the error is about unsupported reasoning parameter
            if "reasoning" in error_str and ("unsupported" in error_str or "not supported" in error_str):
                logger.warning(f"Model {request_params.get('model', 'unknown')} doesn't support reasoning in streaming, retrying without thinking")
                # Remove reasoning parameter and retry
                fallback_params = request_params.copy()
                if "reasoning" in fallback_params:
                    del fallback_params["reasoning"]
                
                try:
                    response_stream = await self.client.responses.create(**fallback_params)
                    
                    accumulated_content = ""
                    model_used = fallback_params["model"]
                    thinking_trace = ""
                    tool_calls = []
                    
                    # Handle streaming response
                    if hasattr(response_stream, '__aiter__'):
                        # Async iterator
                        async for event in response_stream:
                            response = self._process_streaming_event(event, accumulated_content, model_used, thinking_trace, tool_calls)
                            # Update accumulated content for next iteration
                            accumulated_content = response.content
                            thinking_trace = response.thinking_trace or ""
                            yield response
                    else:
                        # Sync iterator (fallback)
                        for event in response_stream:
                            response = self._process_streaming_event(event, accumulated_content, model_used, thinking_trace, tool_calls)
                            # Update accumulated content for next iteration
                            accumulated_content = response.content
                            thinking_trace = response.thinking_trace or ""
                            yield response
                except Exception as fallback_e:
                    logger.error(f"OpenAI SDK streaming fallback error: {fallback_e}")
                    raise RuntimeError(f"OpenAI streaming failed even without reasoning: {str(fallback_e)}")
            else:
                logger.error(f"OpenAI SDK streaming error: {e}")
                raise RuntimeError(f"OpenAI streaming failed: {str(e)}")
    
    def _process_streaming_event(self, event, accumulated_content: str, model_used: str, thinking_trace: str, tool_calls: list) -> GenerationResponse:
        """Process a single streaming event and return a GenerationResponse."""
        try:
            event_type = getattr(event, 'type', '')
            
            # Debug logging to see what events we're getting
            logger.debug(f"Streaming event type: {event_type}, event: {event}")
            
            # Handle different event types
            if event_type == "response.output_text.delta":
                delta = getattr(event, 'delta', '')
                if delta:
                    accumulated_content += delta
                    logger.debug(f"Text delta: '{delta}' (total: {len(accumulated_content)} chars)")
            elif event_type in ("response.reasoning_summary_text.delta", "response.reasoning_text.delta"):
                delta = getattr(event, 'delta', '')
                if delta:
                    thinking_trace += delta
                    logger.debug(f"Reasoning delta: '{delta}' (total: {len(thinking_trace)} chars)")
            elif event_type == "response.function_call_arguments.delta":
                # Handle function call arguments streaming
                logger.debug("Function call arguments delta")
            elif event_type == "response.function_call_arguments.done":
                # Handle completed function call
                logger.debug("Function call arguments done")
            elif event_type == "response.done":
                logger.debug("Response done event")
            elif event_type == "response.output_text.done":
                logger.debug("Output text done event")
            elif event_type == "response.reasoning.done":
                logger.debug("Reasoning done event")
            else:
                logger.debug(f"Unhandled event type: {event_type}")
                # Log the full event structure for debugging
                logger.debug(f"Full event structure: {event}")
            
            return GenerationResponse(
                content=accumulated_content,
                model_used=model_used,
                thinking_trace=thinking_trace or None,
                tool_calls=tool_calls if tool_calls else None,
                raw_response=event.model_dump() if hasattr(event, 'model_dump') else event,
            )
            
        except Exception as e:
            logger.error(f"Error processing streaming event: {e}")
            return GenerationResponse(
                content=accumulated_content,
                model_used=model_used,
                thinking_trace=thinking_trace or None,
                tool_calls=tool_calls if tool_calls else None,
                raw_response={},
            )
    
    def _messages_to_responses_input(self, messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """Convert messages to the Responses API input format."""
        input_items = []
        
        for message in messages:
            role = message.get("role", "user")
            content_text = message.get("content", "")
            
            # For the Responses API, use simple string format for content
            # The error suggests "input_text" is not supported, so use plain string
            input_items.append({
                "type": "message",
                "role": role,
                "content": content_text
            })
            
        return input_items
    
    def _prepare_tools_for_responses(self, tools: List[Dict[str, Any]], mcp_headers: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """Convert tools to OpenAI function calling format."""
        responses_tools = []
        
        for tool in tools:
            # Extract tool info based on format
            if tool.get("type") == "mcp":
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
                output_schema = tool.get("output_schema")
            elif tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                func = tool["function"]
                name = func.get("name")
                description = func.get("description")
                parameters = func.get("parameters")
                output_schema = func.get("output_schema")
            else:
                # Bare function format
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
                output_schema = tool.get("output_schema")
            
            # Skip tools with missing required fields
            if not name or not parameters:
                logger.warning(f"Skipping tool with missing name or parameters: {tool}")
                continue
            
            # Build OpenAI tool definition
            func_tool = {
                "type": "function",
                "name": name,
                "description": description or f"Execute {name}",
                "parameters": self._clean_json_schema_for_openai(parameters)
            }
            
            # Add output schema if available (for structured responses)
            if output_schema:
                func_tool["output_schema"] = self._clean_json_schema_for_openai(output_schema)
            
            responses_tools.append(func_tool)
        
        logger.info(f"Prepared {len(responses_tools)} tools for OpenAI")
        return responses_tools
    
    def _clean_json_schema_for_openai(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Clean JSON schema for OpenAI's structured output requirements."""
        if not isinstance(schema, dict):
            return schema
        
        # Remove unsupported 'default' field
        clean_schema = {k: v for k, v in schema.items() if k != 'default'}
        
        # Apply additionalProperties: false to all objects
        is_object = (
            'properties' in clean_schema or
            clean_schema.get('type') == 'object' or
            any(key in clean_schema for key in ['required', 'patternProperties', 'propertyNames'])
        )
        
        if is_object:
            clean_schema['additionalProperties'] = False
        
        # Set required array to all properties for objects
        if 'properties' in clean_schema and isinstance(clean_schema['properties'], dict):
            clean_schema['required'] = list(clean_schema['properties'].keys())
            clean_schema['properties'] = {
                name: self._clean_json_schema_for_openai(prop)
                for name, prop in clean_schema['properties'].items()
            }
            
        # Recursively clean nested schemas
        for key in ['items', 'not']:
            if key in clean_schema and isinstance(clean_schema[key], dict):
                clean_schema[key] = self._clean_json_schema_for_openai(clean_schema[key])
        
        for union_key in ['anyOf', 'oneOf', 'allOf']:
            if union_key in clean_schema and isinstance(clean_schema[union_key], list):
                clean_schema[union_key] = [
                    self._clean_json_schema_for_openai(item)
                    for item in clean_schema[union_key]
                ]
        
        for conditional_key in ['if', 'then', 'else']:
            if conditional_key in clean_schema and isinstance(clean_schema[conditional_key], dict):
                clean_schema[conditional_key] = self._clean_json_schema_for_openai(clean_schema[conditional_key])
                
        if '$defs' in clean_schema and isinstance(clean_schema['$defs'], dict):
            clean_schema['$defs'] = {
                name: self._clean_json_schema_for_openai(definition)
                for name, definition in clean_schema['$defs'].items()
            }
            
        return clean_schema
    
    def _extract_thinking_trace(self, response) -> Optional[str]:
        """Extract thinking trace from response."""
        try:
            for output_item in response.output:
                if output_item.type == "reasoning":
                    for summary_part in getattr(output_item, 'summary', []):
                        if summary_part.type == "summary_text":
                            return summary_part.text
        except (AttributeError, TypeError):
            pass
        return None
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)