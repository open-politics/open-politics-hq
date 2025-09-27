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
        self.client = httpx.AsyncClient(timeout=300.0)
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
        
        # Non-streaming with tools: implement tool loop
        if not stream and tools and tool_executor:
            return await self._tool_loop_generate(
                messages=messages,
                model_name=model_name,
                tools=tools,
                thinking_enabled=thinking_enabled,
                tool_executor=tool_executor,
                **kwargs
            )

        # Work on a defensive copy of messages; never mutate caller's list
        try:
            messages_for_request: List[Dict[str, Any]] = [dict(m) for m in (messages or [])]
        except Exception:
            # Fallback to original reference if copying fails
            messages_for_request = messages
        
        # Ollama thinking mode - encourage <think> tags (modify copy only)
        if thinking_enabled:
            system_msg = {
                "role": "system",
                "content": """When solving problems, please show your thinking process using <think></think> 
                              tags before providing your final answer. If tool calls are requested, get to 
                              the call quickly"""            
            }
            system_exists = False
            for msg in messages_for_request:
                if msg.get("role") == "system":
                    msg["content"] = (msg.get("content") or "") + "\n\n" + system_msg["content"]
                    system_exists = True
                    break
            if not system_exists:
                messages_for_request.insert(0, system_msg)

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
    
    async def _tool_loop_generate(self,
                                 messages: List[Dict[str, str]],
                                 model_name: str,
                                 tools: List[Dict],
                                 thinking_enabled: bool,
                                 tool_executor: Callable[[str, Dict[str, Any]], Awaitable[Dict[str, Any]]],
                                 **kwargs) -> GenerationResponse:
        """Handle non-streaming generation with a tool execution loop for Ollama."""
        
        iterative_messages = list(messages)
        
        for _ in range(5): # Limit tool loop iterations
            resp = await self.generate(
                messages=iterative_messages,
                model_name=model_name,
                tools=tools,
                stream=False,
                thinking_enabled=thinking_enabled,
                **kwargs
            )
            
            tool_calls = getattr(resp, "tool_calls", None) or []
            if not tool_calls:
                return resp
            
            # Append model's response to the conversation history before tool results
            # This is important for some models to see their own tool call requests.
            if resp.raw_response and resp.raw_response.get("message"):
                iterative_messages.append(resp.raw_response["message"])

            for tc in tool_calls:
                try:
                    name = ((tc or {}).get("function") or {}).get("name") or tc.get("name")
                    args_str = ((tc or {}).get("function") or {}).get("arguments") or tc.get("arguments") or "{}"
                    
                    try:
                        args = json.loads(args_str) if isinstance(args_str, str) else (args_str or {})
                    except json.JSONDecodeError:
                        args = {}
                    
                    if not name:
                        continue

                    tool_result = await tool_executor(name, args)
                    
                    # Append tool result back to the conversation for the model to use
                    # Ollama expects a specific format for tool results
                    iterative_messages.append({
                        "role": "tool", 
                        "content": json.dumps(tool_result)
                    })
                except Exception as e:
                    # If a single tool call fails, provide error message to model
                    error_result = {"error": f"Tool execution failed: {str(e)}"}
                    iterative_messages.append({
                        "role": "tool",
                        "content": json.dumps(error_result)
                    })
                    continue
        
        # If loop finishes, return the last response from the model
        return await self.generate(
            messages=iterative_messages,
            model_name=model_name,
            tools=tools,
            stream=False,
            thinking_enabled=thinking_enabled,
            **kwargs
        )

    async def _generate(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation"""
        try:
            # Log the payload for debugging tool issues
            if payload.get("tools"):
                logger.info(f"Ollama request with tools: {json.dumps(payload.get('tools'), indent=2)}")
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
                logger.error(f"Ollama API error: {getattr(e.response, 'status_code', None) if hasattr(e, 'response') else 'unknown'} - {error_text}")
                
                # Log tools specifically if they're present
                if payload.get("tools"):
                    logger.error(f"Request included {len(payload['tools'])} tools")
                    logger.error(f"First tool sample: {json.dumps(payload['tools'][0] if payload['tools'] else {}, indent=2)}")
                
                # Check if error mentions tools
                if "tool" in error_text.lower() or "function" in error_text.lower():
                    logger.error(f"Error appears to be tool-related: {error_text}")
                elif "parameter" in error_text.lower() or "schema" in error_text.lower():
                    logger.error(f"Error appears to be schema-related: {error_text}")
                
                # Try to get more detailed error information
                try:
                    if hasattr(e, 'response') and hasattr(e.response, 'json'):
                        error_json = e.response.json()
                        logger.error(f"Detailed error JSON: {json.dumps(error_json, indent=2)}")
                except Exception:
                    pass
                    
                try:
                    logger.error(f"Full Ollama request payload: {json.dumps(payload, indent=2)}")
                except Exception:
                    logger.error("Ollama request payload: <unserializable>")
            except Exception:
                logger.error("Ollama API error (unable to log payload)")
            if should_retry_without_tools:
                retry_payload = dict(payload)
                retry_payload.pop("tools", None)
                logger.info("Retrying Ollama /api/chat without tools due to 400 error")
                response = await self.client.post(f"{self.base_url}/api/chat", json=retry_payload)
                response.raise_for_status()
                data = response.json()
            raise RuntimeError(f"Ollama generation failed: {e.response.text}")
        except Exception as e:
            logger.error(f"Ollama generation error: {e}")
            raise RuntimeError(f"Ollama generation failed: {str(e)}")
    
    async def _stream_generate(self, payload: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation"""
        try:
            async with self.client.stream("POST", f"{self.base_url}/api/chat", json=payload) as response:
                response.raise_for_status()
                
                accumulated_content = ""
                thinking_trace = ""
                in_thinking = False
                model_used = payload["model"]
                
                async for line in response.aiter_lines():
                    try:
                        chunk = json.loads(line)
                        if chunk.get("done"):
                            break
                        
                        msg = chunk.get("message", {}) or {}
                        content_delta = msg.get("content", "")
                        accumulated_content += content_delta
                        
                        # Handle Ollama thinking tags in streaming
                        if "<think>" in content_delta:
                            in_thinking = True
                        if "</think>" in content_delta:
                            in_thinking = False
                        
                        if in_thinking or "<think>" in content_delta or "</think>" in content_delta:
                            thinking_trace += content_delta
                        
                        tool_calls = msg.get("tool_calls") or self._extract_tool_calls(accumulated_content)
                        
                        yield GenerationResponse(
                            content=self._remove_thinking_tags(accumulated_content),
                            model_used=model_used,
                            thinking_trace=self._clean_thinking_trace(thinking_trace) if thinking_trace else None,
                            tool_calls=tool_calls,
                            raw_response=chunk
                        )
                        
                    except json.JSONDecodeError:
                        continue
                        
        except httpx.HTTPStatusError as e:
            error_text = None
            try:
                error_bytes = await e.response.aread()
                try:
                    error_text = (
                        error_bytes.decode("utf-8", errors="replace")
                        if isinstance(error_bytes, (bytes, bytearray))
                        else str(error_bytes)
                    )
                except Exception:
                    error_text = str(error_bytes)
            except Exception:
                error_text = str(e)
            try:
                logger.error(f"Ollama streaming error: {e.response.status_code} - {error_text}")
                try:
                    logger.error(f"Ollama request payload: {json.dumps(payload, indent=2)}")
                except Exception:
                    logger.error("Ollama request payload: <unserializable>")
            except Exception:
                logger.error("Ollama streaming error (unable to log payload)")
            # Retry once without tools on 400
            if e.response.status_code == 400 and isinstance(payload, dict) and payload.get("tools"):
                retry_payload = dict(payload)
                retry_payload.pop("tools", None)
                logger.info("Retrying Ollama streaming without tools due to 400 error")
                async with self.client.stream("POST", f"{self.base_url}/api/chat", json=retry_payload) as response:
                    response.raise_for_status()
                    accumulated_content = ""
                    thinking_trace = ""
                    in_thinking = False
                    model_used = retry_payload["model"]
                    async for line in response.aiter_lines():
                        try:
                            chunk = json.loads(line)
                            if chunk.get("done"):
                                break
                            msg = chunk.get("message", {}) or {}
                            content_delta = msg.get("content", "")
                            accumulated_content += content_delta
                            if "<think>" in content_delta:
                                in_thinking = True
                            if "</think>" in content_delta:
                                in_thinking = False
                            if in_thinking or "<think>" in content_delta or "</think>" in content_delta:
                                thinking_trace += content_delta
                            yield GenerationResponse(
                                content=self._remove_thinking_tags(accumulated_content),
                                model_used=model_used,
                                thinking_trace=self._clean_thinking_trace(thinking_trace) if thinking_trace else None,
                                tool_calls=None,
                                raw_response=chunk
                            )
                        except json.JSONDecodeError:
                            continue
                return
            raise RuntimeError(f"Ollama streaming failed: {error_text}")
        except Exception as e:
            logger.error(f"Ollama streaming error: {e}")
            raise RuntimeError(f"Ollama streaming failed: {str(e)}")
    
    def _extract_thinking_trace(self, content: str) -> Optional[str]:
        """Ollama: Extract content between <think></think> tags"""
        think_pattern = r'<think>(.*?)</think>'
        matches = re.findall(think_pattern, content, re.DOTALL)
        
        if matches:
            return '\n'.join(matches).strip()
        return None
    
    def _remove_thinking_tags(self, content: str) -> str:
        """Remove <think></think> tags and their content from the main response"""
        return re.sub(r'<think>.*?</think>', '', content, flags=re.DOTALL).strip()
    
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
        """
        Normalize tools for Ollama compatibility.
        
        This converts MCP tools to the 'function' format that many models expect,
        improving compatibility.
        """
        normalized_tools = []
        for tool in tools:
            if isinstance(tool, dict) and tool.get("type") == "mcp":
                # Convert MCP tool to function tool format
                normalized_tools.append({
                    "type": "function",
                    "function": {
                        "name": tool.get("name"),
                        "description": tool.get("description"),
                        "parameters": tool.get("parameters", {"type": "object", "properties": {}})
                    }
                })
            elif isinstance(tool, dict) and tool.get("type") == "function":
                # Pass native function tools through
                normalized_tools.append(tool)
            else:
                logger.warning(f"Skipping unsupported tool type for Ollama: {tool.get('type')}")
        
        return normalized_tools

    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)
    

