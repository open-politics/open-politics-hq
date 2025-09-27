"""
OpenAI Language Model Provider Implementation
"""
import logging
import json
import httpx
import re
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Callable, Awaitable

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse
from app.core.config import settings

logger = logging.getLogger(__name__)


class OpenAILanguageModelProvider(LanguageModelProvider):
    """
    OpenAI implementation of the LanguageModelProvider interface.
    Handles chat, structured output, tool calls, and streaming with OpenAI-specific edge cases.
    """
    
    def __init__(self, api_key: str, base_url: str = "https://api.openai.com/v1"):
        self.api_key = api_key
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json"
            },
            timeout=300.0
        )
        self._model_cache = {}
        logger.info(f"OpenAI provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """OpenAI: GET /v1/models (kept minimal; single model assumed during testing)."""
        try:
            response = await self.client.get(f"{self.base_url}/models")
            response.raise_for_status()
            data = response.json()
            models: List[ModelInfo] = []
            for model_data in data.get("data", []):
                model_name = model_data["id"]
                info = ModelInfo(
                    name=model_name,
                    provider="openai",
                    supports_structured_output=True,
                    supports_tools=True,
                    supports_streaming=True,
                    supports_thinking=True,
                    supports_multimodal=True,
                    max_tokens=None,
                    context_length=None,
                    description=f"OpenAI {model_name}"
                )
                models.append(info)
                self._model_cache[model_name] = info
            logger.info(f"Discovered {len(models)} OpenAI models (capabilities assumed during testing)")
            return models
         
        except Exception as e:
            logger.error(f"Failed to discover OpenAI models: {e}")
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
        
        # Generate with OpenAI Responses API
        
        # ALWAYS use Responses API - it's the only API we want to use
        # The Responses API is a superset of Chat Completions and handles everything better
            # Reasoning models do not support tools/function calling
            # They may support MCP tools via Responses API; include if provided
            # Remove params not supported by reasoning models
            # Only pass through a very small set of known-safe parameters to Responses API
            clean_kwargs: Dict[str, Any] = {}
            # Map max_tokens -> max_output_tokens if provided
            if "max_tokens" in kwargs and isinstance(kwargs.get("max_tokens"), int):
                clean_kwargs["max_output_tokens"] = kwargs.get("max_tokens")
            if "temperature" in kwargs and isinstance(kwargs.get("temperature"), (int, float)):
                clean_kwargs["temperature"] = kwargs.get("temperature")
            
            # DO NOT pass through any other kwargs to avoid unsupported parameters
            # Explicitly filter out response_format since we handle it separately via text.format

            # For Responses API, separate system instructions from input messages
            system_instructions = None
            input_messages = messages
            if messages and messages[0].get("role") == "system":
                system_instructions = messages[0].get("content")
                input_messages = messages[1:]

            # Allow direct override with already-formatted Responses input (e.g., tool loop)
            responses_input_override: Optional[Union[str, List[Dict[str, Any]]]] = kwargs.pop("responses_input", None)

            # Non-streaming with tools: implement tool loop
            if not stream and tools and tool_executor:
                return await self._tool_loop_generate(
                    messages=messages,
                    model_name=model_name,
                    tools=tools,
                    thinking_enabled=thinking_enabled,
                    tool_executor=tool_executor,
                    response_format=response_format,
                    **kwargs
                )
            
            # Always allow tools during testing
            if tools:
                # No capability heuristics, always pass tools
                pass

            payload: Dict[str, Any] = {
                "model": model_name,
                "input": responses_input_override if responses_input_override is not None else self._messages_to_responses_input(system_instructions, input_messages),
                "stream": stream,
                # Keep the payload minimal; add only known-safe parameters
                **clean_kwargs,
            }
            
            # Get context token from kwargs to build dynamic MCP server URL
            mcp_context_token = kwargs.get("mcp_context_token")
            mcp_headers = kwargs.get("mcp_headers")

            # Add reasoning if thinking is enabled - use correct format from docs
            if thinking_enabled and payload.get("tools"):
                # Per research, the flagship gpt-5 model requires the reasoning parameter
                # to be present when tools are used.
                payload["reasoning"] = {
                    "effort": "medium"
                }

            # Responses API: handle both MCP tools and function tools
            if tools:
                responses_tools = self._prepare_tools_for_responses(tools, mcp_context_token, mcp_headers)
                if responses_tools:
                    payload["tools"] = responses_tools
            
            # Add structured output format if provided (Responses API uses text.format)
            if response_format:
                # Ensure we don't override existing text config, merge instead
                if "text" not in payload:
                    payload["text"] = {}
                # Clean the schema to remove unsupported fields like 'default'
                clean_schema = self._clean_json_schema_for_openai(response_format)
                payload["text"]["format"] = {
                    "type": "json_schema",
                    "name": clean_schema.get("title", "StructuredOutput"),
                    "schema": clean_schema
                }
                
            # Execute the request directly - no fallback needed now that schema cleaning works
            if stream:
                return self._stream_generate_responses(payload)
            else:
                return await self._generate_responses(payload)
    
    async def _tool_loop_generate(self,
                                 messages: List[Dict[str, str]],
                                 model_name: str,
                                 tools: List[Dict],
                                 thinking_enabled: bool,
                                 tool_executor: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
                                 response_format: Optional[Dict] = None,
                                 **kwargs) -> GenerationResponse:
        """Handle non-streaming generation with a tool execution loop."""
        
        system_instructions = None
        input_messages = list(messages)  # Work with a copy
        if input_messages and input_messages[0].get("role") == "system":
            system_instructions = input_messages.pop(0).get("content")

        # Initialize the conversation history correctly, once.
        conversation_history = self._messages_to_responses_input(system_instructions, input_messages)
        
        # Limit tool loop iterations to prevent infinite loops
        for _ in range(5): 
            # First, generate a response from the model
            generation_payload = {
                "model": model_name,
                "input": conversation_history,
                "stream": False,
                "tools": self._normalize_tools_for_responses(tools),
                "reasoning": {"effort": "medium"} if thinking_enabled else None
            }
            
            # Add structured output format if provided
            if response_format:
                if "text" not in generation_payload:
                    generation_payload["text"] = {}
                # Clean the schema to remove unsupported fields like 'default'
                clean_schema = self._clean_json_schema_for_openai(response_format)
                generation_payload["text"]["format"] = {
                    "type": "json_schema",
                    "name": clean_schema.get("title", "StructuredOutput"),
                    "schema": clean_schema
                }
            
            # Clean up None values
            generation_payload = {k: v for k, v in generation_payload.items() if v is not None}

            resp_obj = await self._generate_responses(generation_payload)
            
            # Append model's output to the conversation history
            if resp_obj.raw_response and resp_obj.raw_response.get("output"):
                conversation_history.extend(resp_obj.raw_response.get("output", []))

            # Check for tool calls
            tool_calls = resp_obj.tool_calls
            if not tool_calls:
                return resp_obj

            # Execute tool calls
            for tool_call in tool_calls:
                function_info = tool_call.get("function", {})
                tool_name = function_info.get("name")
                
                try:
                    args_str = function_info.get("arguments", "{}")
                    arguments = json.loads(args_str)
                except json.JSONDecodeError:
                    arguments = {}

                if tool_name:
                    try:
                        tool_result = await tool_executor(tool_name, arguments)
                        conversation_history.append({
                            "type": "function_call_output",
                            "call_id": tool_call.get("id"),
                            "output": json.dumps(tool_result)
                        })
                    except Exception as e:
                        error_result = {"error": f"Tool execution failed: {str(e)}"}
                        conversation_history.append({
                            "type": "function_call_output",
                            "call_id": tool_call.get("id"),
                            "output": json.dumps(error_result)
                        })

        # If loop finishes, we need to make one final call to get the model's response
        final_payload = {
            "model": model_name,
            "input": conversation_history,
            "stream": False,
            "reasoning": {"effort": "medium"} if thinking_enabled else None
        }
        return await self._generate_responses({k: v for k, v in final_payload.items() if v is not None})

    # Removed legacy /chat/completions code paths; always use /responses

    async def _generate_responses(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation via the Responses API (o1/o3)."""
        try:
            response = await self.client.post(f"{self.base_url}/responses", json=payload)
            response.raise_for_status()
            data = response.json()

            # Extract content from the nested structure
            content = ""
            output_items = data.get("output", [])
            for item in output_items:
                if item.get("type") == "message":
                    content_blocks = item.get("content", [])
                    for block in content_blocks:
                        if block.get("type") == "output_text":
                            content = block.get("text", "")
                            break
                    if content:
                        break
            
            # Fallback to other possible locations
            if not content:
                content = (
                    data.get("output_text") or
                    data.get("content") or 
                    data.get("response", {}).get("output_text") or
                    ""
                )

            # Extract function tool calls if present
            tool_calls = self._extract_function_tool_calls_from_responses(data)

            return GenerationResponse(
                content=content,
                model_used=data.get("model", payload["model"]),
                usage=data.get("usage"),
                thinking_trace=self._extract_thinking_trace_responses(data),
                finish_reason=data.get("finish_reason"),
                tool_calls=tool_calls,
                raw_response=data,
            )
        except httpx.HTTPStatusError as e:
            try:
                error_detail = e.response.text
                logger.error(f"OpenAI Responses API error: {e.response.status_code}")
                logger.error(f"Error response: {error_detail}")
                # Try to parse as JSON to get detailed error
                try:
                    error_json = json.loads(error_detail)
                    logger.error(f"OpenAI detailed error: {json.dumps(error_json, indent=2)}")
                except:
                    pass
                logger.error(f"Failed payload was: {json.dumps(payload, indent=2)}")
            except Exception:
                logger.error(f"OpenAI Responses API error: {e.response.status_code} - {str(e)}")
            raise RuntimeError(f"OpenAI generation failed: {e.response.text if hasattr(e.response, 'text') else str(e)}")
        except Exception as e:
            logger.error(f"OpenAI Responses generation error: {e}")
            raise RuntimeError(f"OpenAI generation failed: {str(e)}")

    async def _stream_generate_responses(self, payload: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming via the Responses API (o1/o3)."""
        try:
            async with self.client.stream("POST", f"{self.base_url}/responses", json=payload) as response:
                response.raise_for_status()

                accumulated_content = ""
                model_used = payload["model"]
                thinking_trace = ""
                tool_events: List[Dict[str, Any]] = []
                # Accumulate function tool calls as they stream
                function_calls: Dict[str, Dict[str, Any]] = {}

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk_data = line[6:]
                    if chunk_data.strip() == "[DONE]":
                        break
                    try:
                        event = json.loads(chunk_data)
                        event_type = event.get("type", "")
                        
                        # Handle text content deltas
                        if event_type == "response.output_text.delta":
                            delta = event.get("delta", "")
                            if delta:
                                accumulated_content += delta
                        
                        # Handle reasoning/thinking traces
                        elif event_type in (
                            "response.reasoning_summary_text.delta", 
                            "response.reasoning_text.delta"
                        ):
                            delta = event.get("delta", "")
                            if delta:
                                thinking_trace += delta

                        # Handle function tool call lifecycle
                        elif event_type == "response.output_item.added":
                            item = event.get("item", {})
                            if item.get("type") == "function_call":
                                item_id = item.get("id") or event.get("item_id")
                                name = item.get("name")
                                call_id = item.get("call_id")
                                if item_id and name:
                                    function_calls[item_id] = {
                                        "id": item_id,
                                        "call_id": call_id,
                                        "type": "function",
                                        "function": {
                                            "name": name,
                                            "arguments": "",
                                        },
                                    }
                        elif event_type == "response.function_call_arguments.delta":
                            item_id = event.get("item_id")
                            delta = event.get("delta", "")
                            if item_id and item_id in function_calls and isinstance(delta, str):
                                function_calls[item_id]["function"]["arguments"] += delta
                        elif event_type == "response.function_call_arguments.done":
                            item = event.get("item", {})
                            item_id = item.get("id") or event.get("item_id")
                            args_full = item.get("arguments") or event.get("arguments")
                            if item_id and item_id in function_calls and isinstance(args_full, str):
                                function_calls[item_id]["function"]["arguments"] = args_full

                        # Handle MCP tool events (for completeness)
                        elif event_type in (
                            "response.mcp_call_arguments.delta",
                            "response.mcp_call_arguments.done",
                            "response.mcp_call.in_progress",
                            "response.mcp_call.completed",
                            "response.mcp_call.failed",
                        ):
                            tool_events.append(event)

                        # Always yield the current state for streaming
                        current_tool_calls = None
                        if function_calls:
                            current_tool_calls = list(function_calls.values())
                        elif tool_events:
                            current_tool_calls = self._mcp_events_to_tool_calls(tool_events)
                            
                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=model_used,
                            thinking_trace=thinking_trace or None,
                            tool_calls=current_tool_calls,
                            raw_response=event,
                        )
                    except json.JSONDecodeError:
                        continue
        except httpx.HTTPStatusError as e:
            error_text = e.response.text if hasattr(e.response, 'text') else str(e)
            logger.error(f"OpenAI Responses streaming error: {e.response.status_code} - {error_text}")
            raise RuntimeError(f"OpenAI streaming failed: {error_text}")
        except Exception as e:
            logger.error(f"OpenAI Responses streaming error: {e}")
            raise RuntimeError(f"OpenAI streaming failed: {str(e)}")
    
    def _mcp_events_to_tool_calls(self, events: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
        """Convert MCP tool streaming events into a compact tool_calls list."""
        calls: Dict[str, Dict[str, Any]] = {}
        for e in events:
            et = e.get("type")
            item_id = e.get("item_id")
            if not item_id:
                # list tools events have no item_id; skip for tool_calls
                continue
            call = calls.setdefault(item_id, {"id": item_id, "type": "function", "function": {"name": "", "arguments": ""}})
            
            # Extract tool name from events that provide it
            if et in ("response.mcp_call.in_progress", "response.mcp_call.completed", "response.mcp_call.failed"):
                item = e.get("item", {})
                if item.get("name"):
                    call["function"]["name"] = item["name"]
    
            if et == "response.mcp_call_arguments.delta":
                # Append delta to arguments string
                delta = e.get("delta", "")
                if isinstance(delta, str):
                    call["function"]["arguments"] += delta
            elif et == "response.mcp_call_arguments.done":
                args = e.get("arguments", "")
                call["function"]["arguments"] = args
        
        # Filter out calls where a name was never found
        named_calls = [c for c in calls.values() if c.get("function", {}).get("name")]
        return named_calls if named_calls else None

    def _clean_json_schema_for_openai(self, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Clean JSON schema for OpenAI's strict structured output requirements:
        1. Remove 'default' fields (not supported)
        2. Set 'additionalProperties: false' on ALL objects
        3. Include ALL properties in 'required' array
        """
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

    def _prepare_tools_for_responses(self, tools: List[Dict[str, Any]], mcp_context_token: Optional[str] = None, mcp_headers: Optional[Dict[str, str]] = None) -> List[Dict[str, Any]]:
        """Prepare tools for the OpenAI Responses API.
        
        OpenAI now has native MCP support, so we can pass MCP tools directly.
        We also handle traditional function tools for backward compatibility.
        """
        responses_tools: List[Dict[str, Any]] = []
        
        # Check if we have our intelligence MCP tools
        has_mcp_tools = any(tool.get("type") == "mcp" for tool in tools)
        
        if has_mcp_tools:
            if not mcp_context_token and not mcp_headers:
                logger.warning("MCP tools are present, but no mcp_context_token or mcp_headers were provided. MCP server may lack context or fail auth.")
            
            # For our intelligence analysis tools, create a single MCP server entry
            # Get the MCP server URL from environment or use default
            import os 
            mcp_server_url = f"http://localhost:{os.getenv('BACKEND_PORT')}/tools/mcp"
            
            mcp_server_tool = {
                "type": "mcp",
                "server_label": "intelligence_analysis",
                "server_url": mcp_server_url,
                "allowed_tools": [tool.get("name") for tool in tools if tool.get("type") == "mcp"],
                "require_approval": "never"
            }

            if mcp_headers:
                mcp_server_tool["headers"] = mcp_headers

            responses_tools.append(mcp_server_tool)
        
        # Handle traditional function tools
        for tool in tools:
            try:
                if isinstance(tool, dict) and tool.get("type") == "function" and isinstance(tool.get("function"), dict):
                    # Flatten the nested structure for the Responses API
                    func = tool["function"]
                    parameters = func.get("parameters")
                    flattened_tool = {
                        "type": "function",
                        "name": func.get("name"),
                        "description": func.get("description"),
                        "parameters": self._clean_json_schema_for_openai(parameters) if parameters else None,
                    }
                    if flattened_tool.get("name"):
                        responses_tools.append(flattened_tool)
                elif isinstance(tool, dict) and tool.get("name") and tool.get("parameters") and tool.get("type") != "mcp":
                    # This is already a bare/flattened function dict, but ensure type is set
                    parameters = tool.get("parameters")
                    responses_tools.append({
                        "type": "function",
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "parameters": self._clean_json_schema_for_openai(parameters) if parameters else None,
                    })
                elif tool.get("type") == "mcp":
                    # Skip individual MCP tools as they're handled above
                    continue
                else:
                    logger.warning(f"Skipping invalid Responses tool definition: {tool}")
            except Exception as e:
                logger.warning(f"Skipping invalid Responses tool encountered during normalization: {e}")
                continue
        
        return responses_tools

    def _extract_function_tool_calls_from_responses(self, data: Dict[str, Any]) -> Optional[List[Dict[str, Any]]]:
        """Extract function tool calls from a non-streaming Responses API payload into Chat-Completions-like shape."""
        try:
            calls: List[Dict[str, Any]] = []
            output_items = data.get("output") or data.get("response", {}).get("output") or []
            if isinstance(output_items, list):
                for item in output_items:
                    try:
                        if isinstance(item, dict) and item.get("type") == "function_call":
                            item_id = item.get("id") or item.get("call_id")
                            name = item.get("name")
                            args = item.get("arguments") or ""
                            call_id = item.get("call_id")
                            if name:
                                calls.append({
                                    "id": item_id or f"call_{name}",
                                    "call_id": call_id,
                                    "type": "function",
                                    "function": {"name": name, "arguments": args},
                                })
                    except Exception:
                        continue
            return calls or None
        except Exception:
            return None

    def _messages_to_responses_input(self, system_instructions: Optional[str], messages: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        """Convert messages to the expected Responses API input format.
        
        The v1/responses endpoint requires a specific nested structure for input messages,
        where each message's content is an array of content parts. The system prompt is
        also passed as a message with the 'system' role.
        """
        response_input = []

        # Add the system prompt first, if it exists
        if system_instructions:
            response_input.append({
                "type": "message",
                "role": "system",
                "content": [{"type": "input_text", "text": system_instructions}]
            })

        # Process the rest of the messages
        for m in messages:
            role = m.get("role", "user")
            # Skip any duplicate system messages that might be in the list
            if role == "system":
                continue

            content_text = m.get("content", "")
            content_parts = [{"type": "input_text", "text": content_text}]
            
            response_input.append({
                "type": "message",
                "role": role,
                "content": content_parts
            })
            
        return response_input

    def _extract_thinking_trace_responses(self, data: Dict[str, Any]) -> Optional[str]:
        """Best-effort extraction of reasoning/trace from Responses API payloads."""
        try:
            output_items = data.get("output", [])
            for item in output_items:
                if item.get("type") == "reasoning":
                    summary_parts = item.get("summary", [])
                    # Look for summary text, which contains the reasoning
                    for part in summary_parts:
                        if part.get("type") == "summary_text":
                            return part.get("text")
        except (TypeError, AttributeError):
            pass  # Ignore parsing errors if structure is unexpected
        return None

    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)



