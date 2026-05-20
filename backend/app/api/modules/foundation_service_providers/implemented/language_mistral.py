"""
Mistral Language Model Provider Implementation using Official Mistral SDK

This implementation uses the official Mistral Python SDK for full feature support:
- Chat completions with streaming
- Structured output via JSON schema
- Tool use with automatic tool loop execution
- Standard OpenAI-compatible message format
- EU hosting for data sovereignty
"""
import logging
import json
import asyncio
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Callable, Awaitable

from app.api.modules.foundation_service_providers.base import LanguageModelProvider, ModelInfo, GenerationResponse

logger = logging.getLogger(__name__)

# Default Mistral model configurations
DEFAULT_MISTRAL_MODELS = {
    "mistral-small-latest": {
        "description": "Mistral Small - Efficient and fast model",
        "supports_thinking": False,
    },
    "mistral-medium-latest": {
        "description": "Mistral Medium - Balanced performance",
        "supports_thinking": False,
    },
    "mistral-large-latest": {
        "description": "Mistral Large - Most capable model",
        "supports_thinking": False,
    },
}


class MistralLanguageModelProvider(LanguageModelProvider):
    """
    Mistral AI implementation using the official Mistral SDK.
    Handles chat, structured output, tool calls, and streaming.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.mistral.ai"):
        try:
            from mistralai import Mistral
        except ImportError:
            raise ImportError("Mistral SDK not installed. Run: pip install mistralai")
        
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        # Mistral SDK uses context manager pattern, but we'll use it directly
        self.client = Mistral(api_key=api_key)
        self._model_cache = {}
        logger.info(f"Mistral provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Discover available Mistral models.
        
        Returns a curated list of Mistral models with their capabilities.
        """
        try:
            models = []
            
            for model_name, model_config in DEFAULT_MISTRAL_MODELS.items():
                model_info = ModelInfo(
                    name=model_name,
                    provider="mistral",
                    supports_structured_output=True,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_thinking=model_config.get("supports_thinking", False),
                    supports_multimodal=False,  # Mistral doesn't support images yet
                    max_tokens=None,  # Varies by model
                    context_length=None,  # Varies by model
                    description=model_config.get("description", f"Mistral {model_name}")
                )
                models.append(model_info)
                self._model_cache[model_name] = model_info
            
            logger.info(f"Discovered {len(models)} Mistral models")
            return models
         
        except Exception as e:
            logger.error(f"Failed to discover Mistral models: {e}")
            return []
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get information about a specific model."""
        return self._model_cache.get(model_name)
    
    def _prepare_tools_for_mistral(self, tools: List[Dict]) -> List[Dict]:
        """Convert tools to Mistral format."""
        mistral_tools = []
        for tool in tools:
            # Extract tool info based on format
            if tool.get("type") == "mcp":
                # MCP tool format
                name = tool.get("name")
                description = tool.get("description")
                parameters = tool.get("parameters")
            elif isinstance(tool, dict) and "function" in tool:
                # OpenAI-style tool format
                func = tool["function"]
                name = func.get("name")
                description = func.get("description")
                parameters = func.get("parameters")
            elif tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                # Already in Mistral/OpenAI format
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
            
            # Build Mistral tool definition (same format as OpenAI)
            mistral_tools.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": description or f"Execute {name}",
                    "parameters": parameters
                }
            })
        
        logger.info(f"Prepared {len(mistral_tools)} tools for Mistral")
        return mistral_tools
    
    def _prepare_messages_for_mistral(self, messages: List[Dict[str, str]]) -> List[Dict]:
        """Prepare messages for Mistral API (standard OpenAI format)."""
        mistral_messages = []
        for msg in messages:
            role = msg.get("role")
            content = msg.get("content", "")
            
            # Skip empty messages
            if isinstance(content, str) and not content.strip():
                logger.warning(f"Skipping message with empty content: role={role}")
                continue
            
            mistral_messages.append({
                "role": role,
                "content": content
            })
        
        return mistral_messages
    
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
        Generate response using Mistral's chat completions API.
        """
        # Prepare messages
        mistral_messages = self._prepare_messages_for_mistral(messages)
        
        # Build base request parameters
        request_params = {
            "model": model_name,
            "messages": mistral_messages,
        }
        
        # Add tools if provided
        if tools:
            request_params["tools"] = self._prepare_tools_for_mistral(tools)
            # Default tool_choice is "auto" - let model decide
            if kwargs.get("tool_choice"):
                request_params["tool_choice"] = kwargs["tool_choice"]
        
        # Add structured output format if provided
        if response_format:
            # Mistral supports JSON schema mode
            request_params["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": response_format.get("title", "StructuredOutput"),
                    "schema": response_format,
                    "strict": response_format.get("strict", False)
                }
            }
        
        # Add other parameters
        if "temperature" in kwargs:
            request_params["temperature"] = kwargs["temperature"]
        if "max_tokens" in kwargs:
            request_params["max_tokens"] = kwargs["max_tokens"]
        if "top_p" in kwargs:
            request_params["top_p"] = kwargs["top_p"]
        if "frequency_penalty" in kwargs:
            request_params["frequency_penalty"] = kwargs["frequency_penalty"]
        if "presence_penalty" in kwargs:
            request_params["presence_penalty"] = kwargs["presence_penalty"]
        if "stop" in kwargs:
            request_params["stop"] = kwargs["stop"]
        if "random_seed" in kwargs:
            request_params["random_seed"] = kwargs["random_seed"]
        
        # Parallel tool calls (default: true)
        if tools:
            request_params["parallel_tool_calls"] = kwargs.get("parallel_tool_calls", True)
        
        # Execute with or without tool loop
        if tool_executor and tools:
            if stream:
                logger.info("Mistral streaming with tools: wrapping tool loop execution")
                return self._stream_tool_loop_wrapper(request_params, tool_executor)
            else:
                logger.info("Mistral with tools: executing tool loop")
                return await self._tool_loop_generate(request_params, tool_executor)
        else:
            if stream:
                return self._stream_generate(request_params)
            else:
                return await self._generate(request_params)
    
    async def _generate(self, request_params: Dict) -> GenerationResponse:
        """Handle non-streaming generation."""
        try:
            # Mistral SDK is synchronous, wrap in thread to avoid blocking
            response = await asyncio.to_thread(self.client.chat.complete, **request_params)
            
            # Extract content and tool calls
            content = ""
            tool_calls = []
            
            if response.choices and len(response.choices) > 0:
                choice = response.choices[0]
                message = choice.message
                
                if message.content:
                    content = message.content
                
                # Extract tool calls
                if hasattr(message, 'tool_calls') and message.tool_calls:
                    for tc in message.tool_calls:
                        tool_calls.append({
                            "id": tc.id if hasattr(tc, 'id') else f"call_{tc.function.name}",
                            "type": "function",
                            "function": {
                                "name": tc.function.name if hasattr(tc, 'function') else tc.get("function", {}).get("name"),
                                "arguments": tc.function.arguments if hasattr(tc, 'function') and hasattr(tc.function, 'arguments') else json.dumps(tc.get("function", {}).get("arguments", {}))
                            }
                        })
            
            usage = None
            if hasattr(response, 'usage'):
                usage = {
                    "prompt_tokens": response.usage.prompt_tokens if hasattr(response.usage, 'prompt_tokens') else 0,
                    "completion_tokens": response.usage.completion_tokens if hasattr(response.usage, 'completion_tokens') else 0,
                    "total_tokens": response.usage.total_tokens if hasattr(response.usage, 'total_tokens') else 0,
                }
            
            return GenerationResponse(
                content=content,
                model_used=response.model if hasattr(response, 'model') else request_params["model"],
                usage=usage,
                thinking_trace=None,  # Mistral doesn't support thinking mode yet
                finish_reason=response.choices[0].finish_reason if response.choices and hasattr(response.choices[0], 'finish_reason') else None,
                tool_calls=tool_calls if tool_calls else None,
                raw_response=response.model_dump() if hasattr(response, 'model_dump') else str(response),
            )
            
        except Exception as e:
            logger.error(f"Mistral SDK non-streaming error: {e}", exc_info=True)
            raise RuntimeError(f"Mistral generation failed: {str(e)}")
    
    async def _stream_generate(self, request_params: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation."""
        try:
            request_params["stream"] = True
            
            accumulated_content = ""
            tool_calls = []
            current_model = request_params["model"]
            
            # Mistral SDK is synchronous, iterate over stream in thread
            def iterate_stream():
                """Helper to iterate over synchronous stream."""
                response_stream = self.client.chat.stream(**request_params)
                chunks = []
                for chunk in response_stream:
                    chunks.append(chunk)
                return chunks
            
            # Get all chunks in a thread
            chunks = await asyncio.to_thread(iterate_stream)
            
            # Process chunks and yield responses
            for chunk in chunks:
                if hasattr(chunk, 'choices') and chunk.choices:
                    choice = chunk.choices[0]
                    delta = choice.delta if hasattr(choice, 'delta') else None
                    
                    if delta:
                        # Accumulate content
                        if hasattr(delta, 'content') and delta.content:
                            accumulated_content += delta.content
                        
                        # Accumulate tool calls
                        if hasattr(delta, 'tool_calls') and delta.tool_calls:
                            for tc_delta in delta.tool_calls:
                                idx = tc_delta.index if hasattr(tc_delta, 'index') else 0
                                
                                # Ensure we have enough tool call slots
                                while len(tool_calls) <= idx:
                                    tool_calls.append({
                                        "id": "",
                                        "type": "function",
                                        "function": {"name": "", "arguments": ""}
                                    })
                                
                                # Update tool call
                                if hasattr(tc_delta, 'id') and tc_delta.id:
                                    tool_calls[idx]["id"] = tc_delta.id
                                
                                if hasattr(tc_delta, 'function'):
                                    func = tc_delta.function
                                    if hasattr(func, 'name') and func.name:
                                        tool_calls[idx]["function"]["name"] = func.name
                                    if hasattr(func, 'arguments') and func.arguments:
                                        tool_calls[idx]["function"]["arguments"] += func.arguments
                        
                        # Yield incremental response
                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=current_model,
                            usage=None,  # Usage available at end
                            tool_calls=tool_calls if tool_calls else None,
                        )
            
            # Final response with usage if available
            yield GenerationResponse(
                content=accumulated_content,
                model_used=current_model,
                usage=None,
                finish_reason="stop",
                tool_calls=tool_calls if tool_calls else None,
            )
            
        except Exception as e:
            logger.error(f"Mistral SDK streaming error: {e}", exc_info=True)
            raise RuntimeError(f"Mistral streaming failed: {str(e)}")
    
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
        
        Mistral's tool loop is not truly streaming - it executes all tool calls
        synchronously and returns the final result. This wrapper makes it compatible with
        streaming endpoints by yielding the final response.
        """
        try:
            # Execute the entire tool loop
            final_response = await self._tool_loop_generate(request_params, tool_executor)
            
            # Yield the final response
            yield final_response
            
        except Exception as e:
            logger.error(f"Tool loop streaming wrapper error: {e}", exc_info=True)
            raise
    
    async def _tool_loop_generate(self, request_params: Dict, tool_executor: Callable) -> GenerationResponse:
        """Execute a tool loop for Mistral, handling tool calls until completion."""
        import json
        
        # Bumped from 10 → 20 in 2026-04 (matches Anthropic/OpenAI) — see
        # conversation_service system prompt for the routing guidance that
        # should keep real paths well under this cap.
        max_iterations = 20
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
            loop_params.pop("stream", None)  # Remove stream for non-streaming tool loop
            
            # Make the API call
            try:
                # Mistral SDK is synchronous, wrap in thread to avoid blocking
                response = await asyncio.to_thread(self.client.chat.complete, **loop_params)
            except Exception as e:
                logger.error(f"Mistral API error in tool loop: {e}", exc_info=True)
                raise RuntimeError(f"Mistral API error: {str(e)}")
            
            # Extract content and tool calls
            content = ""
            tool_calls = []
            
            if response.choices and len(response.choices) > 0:
                choice = response.choices[0]
                message = choice.message
                
                if message.content:
                    content = message.content
                
                # Extract tool calls
                if hasattr(message, 'tool_calls') and message.tool_calls:
                    for tc in message.tool_calls:
                        # Extract tool call ID - ensure it's never None
                        tool_call_id = None
                        if hasattr(tc, 'id'):
                            tool_call_id = tc.id
                            logger.debug(f"Extracted tool call ID from tc.id: {tool_call_id}")
                        
                        # If ID is None or empty, generate one
                        if not tool_call_id:
                            func_name = None
                            if hasattr(tc, 'function') and hasattr(tc.function, 'name'):
                                func_name = tc.function.name
                            elif isinstance(tc, dict) and tc.get("function"):
                                func_name = tc["function"].get("name")
                            
                            if func_name:
                                tool_call_id = f"call_{func_name}_{iteration}_{len(tool_calls)}"
                            else:
                                tool_call_id = f"call_{iteration}_{len(tool_calls)}"
                            
                            logger.warning(f"Tool call ID was None/empty, generated: {tool_call_id}")
                        
                        tool_calls.append({
                            "id": tool_call_id,
                            "name": tc.function.name if hasattr(tc, 'function') and hasattr(tc.function, 'name') else (tc.get("function", {}).get("name") if isinstance(tc, dict) else "unknown"),
                            "arguments": tc.function.arguments if hasattr(tc, 'function') and hasattr(tc.function, 'arguments') else (tc.get("function", {}).get("arguments", "{}") if isinstance(tc, dict) else json.dumps({}))
                        })
                        logger.debug(f"Added tool call: name={tool_calls[-1]['name']}, id={tool_call_id}")
            
            # If no tool calls, we're done
            if not tool_calls:
                logger.info(f"Tool loop iteration {iteration}: No tool calls, completing with content length: {len(content)}")
                usage = None
                if hasattr(response, 'usage'):
                    usage = {
                        "prompt_tokens": response.usage.prompt_tokens if hasattr(response.usage, 'prompt_tokens') else 0,
                        "completion_tokens": response.usage.completion_tokens if hasattr(response.usage, 'completion_tokens') else 0,
                        "total_tokens": response.usage.total_tokens if hasattr(response.usage, 'total_tokens') else 0,
                    }
                
                return GenerationResponse(
                    content=content,
                    model_used=response.model if hasattr(response, 'model') else request_params["model"],
                    usage=usage,
                    finish_reason=choice.finish_reason if hasattr(choice, 'finish_reason') else None,
                    tool_calls=None,
                    tool_executions=all_tool_executions if all_tool_executions else None,
                    raw_response=response.model_dump() if hasattr(response, 'model_dump') else str(response),
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
                    
                    # Send concise content to LLM with tool_call_id
                    # Mistral requires tool_call_id to match the tool call ID
                    tool_call_id = tc.get("id")
                    if not tool_call_id:
                        tool_call_id = f"call_{name}_{iteration}"
                        logger.warning(f"Tool call missing ID, generated: {tool_call_id}")
                    
                    logger.debug(f"Adding tool result for {name} with tool_call_id: {tool_call_id}")
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": llm_content
                    })
                    
                    # Record execution with FULL data for frontend
                    all_tool_executions.append({
                        "id": tc["id"],
                        "tool_name": name,
                        "arguments": args,
                        "result": frontend_data if not has_error else None,
                        "structured_content": frontend_data if not has_error else None,
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
                    # Ensure we have a tool_call_id even for errors
                    tool_call_id = tc.get("id") if tc else f"call_{name}_{iteration}"
                    if not tool_call_id:
                        tool_call_id = f"call_{name}_{iteration}"
                    
                    tool_results.append({
                        "role": "tool",
                        "tool_call_id": tool_call_id,
                        "content": json.dumps(error_result)
                    })
                    
                    # Record failed execution
                    tool_call_id = tc.get("id") if tc and isinstance(tc, dict) else f"call_{name}_{iteration}"
                    all_tool_executions.append({
                        "id": tool_call_id,
                        "tool_name": name,
                        "arguments": args if 'args' in locals() else {},
                        "error": str(e),
                        "status": "failed",
                        "iteration": iteration
                    })
            
            # Add assistant message and tool results to conversation
            assistant_message = {
                "role": "assistant",
                "content": content if content else None
            }
            
            # Add tool calls to assistant message if present
            if tool_calls:
                assistant_message["tool_calls"] = [
                    {
                        "id": tc["id"],
                        "type": "function",
                        "function": {
                            "name": tc["name"],
                            "arguments": tc["arguments"]
                        }
                    }
                    for tc in tool_calls
                ]
            
            conversation_messages.append(assistant_message)
            
            # Add tool results
            conversation_messages.extend(tool_results)
        
        # Max iterations reached
        logger.warning(f"Tool loop reached maximum iterations ({max_iterations})")
        return GenerationResponse(
            content="Maximum tool execution iterations reached",
            model_used=request_params["model"],
            usage=None,
            finish_reason="max_iterations",
            tool_calls=None,
            tool_executions=all_tool_executions if all_tool_executions else None,
            raw_response=None,
        )
