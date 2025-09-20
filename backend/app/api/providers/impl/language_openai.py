"""
OpenAI Language Model Provider Implementation
"""
import logging
import json
import httpx
import re
from typing import Dict, List, Optional, AsyncIterator, Union, Any

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse

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
            timeout=60.0
        )
        self._model_cache = {}
        logger.info(f"OpenAI provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """OpenAI: GET /v1/models with enhanced capability detection"""
        try:
            response = await self.client.get(f"{self.base_url}/models")
            response.raise_for_status()
            data = response.json()
            
            # Get enhanced model information from OpenAI's model capabilities
            enhanced_capabilities = await self._get_enhanced_model_capabilities()
            
            models = []
            for model_data in data.get("data", []):
                model_name = model_data["id"]
                
                # Only include models that support chat completions
                if not self._is_chat_model(model_name):
                    continue
                
                # Use enhanced capabilities if available, otherwise fall back to heuristics
                caps = None
                
                # Try exact match first
                if model_name in enhanced_capabilities:
                    caps = enhanced_capabilities[model_name]
                else:
                    # Try pattern matching for model variations
                    for pattern, pattern_caps in enhanced_capabilities.items():
                        if model_name.startswith(pattern):
                            caps = pattern_caps
                            break
                
                if caps:
                    supports_structured_output = caps.get("structured_output", self._supports_structured_output(model_name))
                    supports_tools = caps.get("tools", self._supports_tools(model_name))
                    supports_thinking = caps.get("thinking", self._supports_thinking(model_name))
                    supports_multimodal = caps.get("multimodal", self._supports_multimodal(model_name))
                    max_tokens = caps.get("max_tokens", self._get_max_tokens(model_name))
                    context_length = caps.get("context_length", self._get_context_length(model_name))
                    description = caps.get("description", f"OpenAI {model_name}")
                else:
                    # Fall back to heuristics
                    supports_structured_output = self._supports_structured_output(model_name)
                    supports_tools = self._supports_tools(model_name)
                    supports_thinking = self._supports_thinking(model_name)
                    supports_multimodal = self._supports_multimodal(model_name)
                    max_tokens = self._get_max_tokens(model_name)
                    context_length = self._get_context_length(model_name)
                    description = f"OpenAI {model_name}"
                
                model_info = ModelInfo(
                    name=model_name,
                    provider="openai",
                    supports_structured_output=supports_structured_output,
                    supports_tools=supports_tools,
                    supports_streaming=True,  # All OpenAI chat models support streaming
                    supports_thinking=supports_thinking,
                    supports_multimodal=supports_multimodal,
                    max_tokens=max_tokens,
                    context_length=context_length,
                    description=description
                )
                models.append(model_info)
                self._model_cache[model_name] = model_info
            
            logger.info(f"Discovered {len(models)} OpenAI models with enhanced capability detection")
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
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        
        # Route reasoning (o1/o3) models to the Responses API; others to Chat Completions
        if self._use_responses_api(model_name):
            # Reasoning models do not support tools/function calling
            # They may support MCP tools via Responses API; include if provided
            # Remove params not supported by reasoning models
            clean_kwargs = {k: v for k, v in kwargs.items() if k not in ["temperature", "top_p", "top_k", "max_tokens", "frequency_penalty", "presence_penalty"]}
            payload: Dict[str, Any] = {
                "model": model_name,
                # Use a robust plain-text input constructed from messages
                "input": self._messages_to_input(messages),
                "stream": stream,
                **clean_kwargs,
            }

            # Structured outputs for Responses API
            if response_format:
                payload["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {
                        "name": "response_schema",
                        "schema": response_format,
                        "strict": True,
                    },
                }

            # Pass only MCP tools through to Responses API
            if tools:
                mcp_tools = [t for t in tools if isinstance(t, dict) and t.get("type") == "mcp"]
                if mcp_tools:
                    payload["tools"] = mcp_tools

            if stream:
                return self._stream_generate_responses(payload)
            else:
                return await self._generate_responses(payload)

        # Build Chat Completions payload for standard models
        payload = {
            "model": model_name,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        # OpenAI structured output format
        if response_format:
            payload["response_format"] = {
                "type": "json_schema",
                "json_schema": {
                    "name": "response_schema",
                    "schema": response_format,
                    "strict": True
                }
            }
        
        # OpenAI tools format (exclude MCP entries)
        if tools:
            non_mcp_tools = [t for t in tools if not (isinstance(t, dict) and t.get("type") == "mcp")]
            if non_mcp_tools:
                payload["tools"] = self._normalize_tools(non_mcp_tools)
                # Nudge the model to actually use tools
                payload.setdefault("tool_choice", "auto")
        
        # OpenAI thinking mode (for o1/o3 models)
        if thinking_enabled and self._supports_thinking(model_name):
            # o1 models automatically include reasoning, but we can encourage it
            if not any(msg["role"] == "system" for msg in messages):
                messages.insert(0, {
                    "role": "system", 
                    "content": "Please show your step-by-step reasoning before providing your final answer."
                })
        
        if stream:
            return self._stream_generate(payload)
        else:
            return await self._generate(payload)
    
    async def _generate(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation"""
        try:
            response = await self.client.post(f"{self.base_url}/chat/completions", json=payload)
            response.raise_for_status()
            data = response.json()
            
            choice = data["choices"][0]
            message = choice["message"]
            
            return GenerationResponse(
                content=(message.get("content") or ""),
                model_used=data.get("model", payload.get("model", "")),
                usage=data.get("usage"),
                tool_calls=message.get("tool_calls"),
                thinking_trace=self._extract_thinking_trace(data),
                finish_reason=choice.get("finish_reason"),
                raw_response=data
            )
            
        except httpx.HTTPStatusError as e:
            text = e.response.text
            logger.error(f"OpenAI API error: {e.response.status_code} - {text}")
            # Fallback: some projects expect legacy 'functions' instead of 'tools'
            if (
                e.response.status_code == 400
                and payload.get("tools")
                and ("tools[0].name" in text or "tools[0].function.name" in text or "missing_required_parameter" in text)
            ):
                try:
                    legacy_payload = dict(payload)
                    tools = legacy_payload.pop("tools", [])
                    legacy_payload["functions"] = self._tools_to_legacy_functions(tools)
                    # default to auto
                    legacy_payload["function_call"] = "auto"
                    response2 = await self.client.post(f"{self.base_url}/chat/completions", json=legacy_payload)
                    response2.raise_for_status()
                    data = response2.json()
                    choice = data.get("choices", [{}])[0]
                    message = choice.get("message", {}) if isinstance(choice, dict) else {}
                    return GenerationResponse(
                        content=(message.get("content") or ""),
                        model_used=data.get("model", payload.get("model", "")),
                        usage=data.get("usage"),
                        tool_calls=message.get("tool_calls"),
                        thinking_trace=self._extract_thinking_trace(data),
                        finish_reason=choice.get("finish_reason"),
                        raw_response=data,
                    )
                except Exception as e2:
                    logger.error(f"Legacy functions fallback failed: {e2}")
            raise RuntimeError(f"OpenAI generation failed: {text}")
        except Exception as e:
            logger.error(f"OpenAI generation error: {e}")
            raise RuntimeError(f"OpenAI generation failed: {str(e)}")
    
    async def _stream_generate(self, payload: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation"""
        try:
            async with self.client.stream("POST", f"{self.base_url}/chat/completions", json=payload) as response:
                response.raise_for_status()
                
                accumulated_content = ""
                accumulated_tool_calls = []
                thinking_trace = ""
                model_used = payload["model"]
                
                async for line in response.aiter_lines():
                    if line.startswith("data: "):
                        chunk_data = line[6:]
                        if chunk_data.strip() == "[DONE]":
                            break
                        
                        try:
                            chunk = json.loads(chunk_data)
                            choice = chunk["choices"][0]
                            delta = choice.get("delta", {})
                            
                            # Handle content
                            if "content" in delta and delta["content"]:
                                content_delta = delta["content"]
                                accumulated_content += content_delta
                                
                                # Check if this is thinking content for reasoning models
                                if self._is_thinking_content(content_delta, model_used):
                                    thinking_trace += content_delta
                            
                            # Handle tool calls (complex in streaming)
                            if "tool_calls" in delta:
                                self._accumulate_tool_calls(accumulated_tool_calls, delta["tool_calls"])
                            
                            yield GenerationResponse(
                                content=accumulated_content,
                                model_used=model_used,
                                tool_calls=accumulated_tool_calls if accumulated_tool_calls else None,
                                thinking_trace=thinking_trace if thinking_trace else None,
                                finish_reason=choice.get("finish_reason"),
                                raw_response=chunk
                            )
                            
                        except json.JSONDecodeError:
                            continue
                            
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI streaming error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"OpenAI streaming failed: {e.response.text}")
        except Exception as e:
            logger.error(f"OpenAI streaming error: {e}")
            raise RuntimeError(f"OpenAI streaming failed: {str(e)}")

    async def _generate_responses(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation via the Responses API (o1/o3)."""
        try:
            response = await self.client.post(f"{self.base_url}/responses", json=payload)
            response.raise_for_status()
            data = response.json()

            # The Responses API typically returns output_text and model
            content = (
                data.get("output_text")
                or data.get("content")
                or data.get("response", {}).get("output_text")
                or ""
            )

            return GenerationResponse(
                content=content,
                model_used=data.get("model", payload["model"]),
                usage=data.get("usage"),
                thinking_trace=self._extract_thinking_trace_responses(data),
                finish_reason=data.get("finish_reason"),
                raw_response=data,
            )
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI Responses API error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"OpenAI generation failed: {e.response.text}")
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

                async for line in response.aiter_lines():
                    if not line.startswith("data: "):
                        continue
                    chunk_data = line[6:]
                    if chunk_data.strip() == "[DONE]":
                        break
                    try:
                        event = json.loads(chunk_data)
                        # Responses API emits delta events like response.output_text.delta
                        if event.get("type", "").endswith("output_text.delta"):
                            delta = event.get("delta", "") or event.get("item", {}).get("delta", "")
                            if delta:
                                accumulated_content += delta
                        # Capture any reasoning/trace fields if available
                        if (event.get("type", "").startswith("response.") and
                            "reasoning" in event):
                            thinking_trace += event.get("reasoning", "")

                        # Capture MCP tool events
                        et = event.get("type", "")
                        if et in (
                            "response.mcp_call_arguments.delta",
                            "response.mcp_call_arguments.done",
                            "response.mcp_call.in_progress",
                            "response.mcp_call.completed",
                            "response.mcp_call.failed",
                            "mcp_list_tools.in_progress",
                            "mcp_list_tools.completed",
                            "mcp_list_tools.failed",
                        ):
                            tool_events.append(event)

                        yield GenerationResponse(
                            content=accumulated_content,
                            model_used=model_used,
                            thinking_trace=thinking_trace or None,
                            tool_calls=self._mcp_events_to_tool_calls(tool_events) if tool_events else None,
                            raw_response=event,
                        )
                    except json.JSONDecodeError:
                        continue
        except httpx.HTTPStatusError as e:
            logger.error(f"OpenAI Responses streaming error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"OpenAI streaming failed: {e.response.text}")
        except Exception as e:
            logger.error(f"OpenAI Responses streaming error: {e}")
            raise RuntimeError(f"OpenAI streaming failed: {str(e)}")
    
    def _extract_thinking_trace(self, response: Dict) -> Optional[str]:
        """OpenAI: Extract thinking traces from o1/o3 models"""
        try:
            choice = response.get("choices", [{}])[0]
            message = choice.get("message", {}) if isinstance(choice, dict) else {}
            content = message.get("content", "") or ""
            model_used = response.get("model") or ""
            
            # For o1/o3 models, thinking is often embedded in the content
            if model_used and self._is_reasoning_model(model_used):
                # Simple heuristic: separate reasoning from final answer
                reasoning_indicators = [
                    "Let me think", "I need to consider", "First, let me", "To solve this",
                    "Let me work through", "I'll approach this", "Breaking this down"
                ]
                
                if any(isinstance(content, str) and content.startswith(indicator) for indicator in reasoning_indicators):
                    # Try to separate reasoning from final answer
                    lines = content.split('\n') if isinstance(content, str) else []
                    reasoning_lines = []
                    answer_lines = []
                    in_answer = False
                    
                    for line in lines:
                        if any(isinstance(line, str) and line.startswith(marker) for marker in ["Therefore", "So the answer", "Final answer", "In conclusion"]):
                            in_answer = True
                        
                        if in_answer:
                            answer_lines.append(line)
                        else:
                            reasoning_lines.append(line)
                    
                    if reasoning_lines and len(reasoning_lines) > 1:  # Only if substantial reasoning
                        return '\n'.join(reasoning_lines).strip()
        except Exception:
            return None
        
        return None

    def _normalize_tools(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Normalize universal tool specs to OpenAI function-calling shape.

        Accepts either already-OpenAI-shaped tools ({type:function, function:{name,...}})
        or bare function dicts ({name, description, parameters}).
        """
        normalized: List[Dict[str, Any]] = []
        for tool in tools:
            try:
                if isinstance(tool, dict) and tool.get("type") == "function" and isinstance(tool.get("function"), dict) and tool["function"].get("name"):
                    normalized.append(tool)
                elif isinstance(tool, dict) and tool.get("name") and tool.get("parameters"):
                    normalized.append({"type": "function", "function": tool})
                else:
                    logger.warning(f"Skipping invalid tool definition: {tool}")
            except Exception:
                logger.warning("Skipping invalid tool definition encountered during normalization")
                continue
        return normalized

    def _mcp_events_to_tool_calls(self, events: List[Dict[str, Any]]) -> Optional[List[Dict[str, Any]]]:
        """Convert MCP tool streaming events into a compact tool_calls list."""
        calls: Dict[str, Dict[str, Any]] = {}
        for e in events:
            et = e.get("type")
            item_id = e.get("item_id")
            if not item_id:
                # list tools events have no item_id; skip for tool_calls
                continue
            call = calls.setdefault(item_id, {"id": item_id, "type": "function", "function": {"name": "mcp_tool", "arguments": ""}})
            if et == "response.mcp_call_arguments.delta":
                # Append delta to arguments string
                delta = e.get("delta", "")
                call["function"]["arguments"] += delta
            elif et == "response.mcp_call_arguments.done":
                args = e.get("arguments", "")
                call["function"]["arguments"] = args
        return list(calls.values()) if calls else None

    def _tools_to_legacy_functions(self, tools: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Convert 'tools' (function type) into legacy 'functions' array."""
        legacy: List[Dict[str, Any]] = []
        for t in tools:
            try:
                if isinstance(t, dict) and t.get("type") == "function" and isinstance(t.get("function"), dict):
                    func = t["function"]
                    # Keep only fields expected in legacy function spec
                    legacy.append({
                        "name": func.get("name"),
                        "description": func.get("description"),
                        "parameters": func.get("parameters"),
                    })
            except Exception:
                continue
        return legacy
    
    def _accumulate_tool_calls(self, accumulated: List[Dict], new_calls: List[Dict]):
        """Handle streaming tool call accumulation (OpenAI specific)"""
        for new_call in new_calls:
            call_index = new_call.get("index", 0)
            
            # Ensure we have enough slots
            while len(accumulated) <= call_index:
                accumulated.append({"id": "", "type": "function", "function": {"name": "", "arguments": ""}})
            
            # Accumulate the call data
            if "id" in new_call:
                accumulated[call_index]["id"] = new_call["id"]
            
            if "function" in new_call:
                func = new_call["function"]
                if "name" in func:
                    accumulated[call_index]["function"]["name"] += func["name"]
                if "arguments" in func:
                    accumulated[call_index]["function"]["arguments"] += func["arguments"]
    
    def _is_thinking_content(self, content: str, model_name: str) -> bool:
        """Check if content appears to be thinking/reasoning"""
        if not self._is_reasoning_model(model_name):
            return False
        
        thinking_patterns = [
            "Let me think", "I need to", "First,", "To solve", "Breaking this down",
            "Let me work through", "I'll approach", "Considering"
        ]
        return any(pattern in content for pattern in thinking_patterns)
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)
    
    # Helper methods for capability detection
    def _is_chat_model(self, model_name: str) -> bool:
        """Check if model supports chat completions based on OpenAI API response"""
        # Only exclude models that are clearly not for chat completions
        non_chat_models = [
            "text-embedding", "whisper", "dall-e", "tts"
        ]
        
        # If it's returned by the /models endpoint and isn't clearly a non-chat model,
        # assume it supports chat completions. Let the API tell us if we're wrong.
        is_non_chat = any(non_chat in model_name for non_chat in non_chat_models)
        
        return not is_non_chat
    
    def _supports_thinking(self, model_name: Optional[str]) -> bool:
        """OpenAI reasoning models (o1, o3, future gpt-5)"""
        if not model_name:
            return False
        return model_name.startswith(("o1-", "o3-", "gpt-5"))
    
    def _is_reasoning_model(self, model_name: str) -> bool:
        """Same as supports_thinking for OpenAI"""
        return self._supports_thinking(model_name)
    
    def _supports_structured_output(self, model_name: Optional[str]) -> bool:
        """Most OpenAI chat models support structured output"""
        if not model_name:
            return False
        return model_name.startswith(("gpt-4", "gpt-3.5", "gpt-4o", "gpt-4.1", "o1-", "o3-"))
    
    def _supports_tools(self, model_name: Optional[str]) -> bool:
        """OpenAI models that support function calling"""
        if not model_name:
            return False
        # o1/o3 models currently don't support function calling
        return (
            (model_name.startswith(("gpt-4", "gpt-3.5", "gpt-4o", "gpt-4.1")))
            and not model_name.startswith(("o1-", "o3-"))
        )
    
    def _supports_multimodal(self, model_name: Optional[str]) -> bool:
        """OpenAI models with vision capabilities"""
        if not model_name:
            return False
        return (
            "vision" in model_name
            or model_name.startswith("gpt-4o")
            or model_name.startswith("gpt-4.1")
        )
    
    def _get_max_tokens(self, model_name: Optional[str]) -> Optional[int]:
        """Get max tokens for model (rough estimates)"""
        if not model_name:
            return None
        if model_name.startswith("gpt-4"):
            return 4096 if "gpt-4o" not in model_name else 16384
        elif model_name.startswith("gpt-3.5"):
            return 4096
        elif model_name.startswith(("o1-", "o3-")):
            return 65536  # Higher for reasoning models
        elif model_name.startswith(("gpt-4.1")):
            return 16384
        return None
    
    def _get_context_length(self, model_name: Optional[str]) -> Optional[int]:
        """Get context length for model (rough estimates)"""
        if not model_name:
            return None
        if model_name.startswith("gpt-4"):
            return 128000 if "gpt-4o" in model_name else 32000
        elif model_name.startswith("gpt-3.5"):
            return 16385
        elif model_name.startswith(("o1-", "o3-")):
            return 128000
        elif model_name.startswith("gpt-4.1"):
            return 128000
        return None
    
    async def _get_enhanced_model_capabilities(self) -> Dict[str, Dict[str, Any]]:
        """Get enhanced model capabilities with up-to-date information"""
        # OpenAI model capabilities database - patterns for flexibility
        capabilities_db = {
            # GPT-5 family (latest generation)
            "gpt-5": {
                "structured_output": True,
                "tools": True,
                "thinking": True,
                "multimodal": True,
                "max_tokens": 32768,
                "context_length": 200000,
                "description": "OpenAI GPT-5 - Latest generation model with advanced capabilities"
            },
            # GPT-4 family
            "gpt-4o": {
                "structured_output": True,
                "tools": True,
                "thinking": False,
                "multimodal": True,
                "max_tokens": 16384,
                "context_length": 128000,
                "description": "OpenAI GPT-4o - Multimodal with vision capabilities"
            },
            "gpt-4o-mini": {
                "structured_output": True,
                "tools": True,
                "thinking": False,
                "multimodal": True,
                "max_tokens": 16384,
                "context_length": 128000,
                "description": "OpenAI GPT-4o-mini - Efficient multimodal model"
            },
            "gpt-4.1": {
                "structured_output": True,
                "tools": True,
                "thinking": False,
                "multimodal": True,
                "max_tokens": 16384,
                "context_length": 128000,
                "description": "OpenAI GPT-4.1 - Advanced multimodal model"
            },
            "gpt-4": {
                "structured_output": True,
                "tools": True,
                "thinking": False,
                "multimodal": False,
                "max_tokens": 4096,
                "context_length": 32000,
                "description": "OpenAI GPT-4 - Advanced reasoning and analysis"
            },
            # GPT-3.5 family
            "gpt-3.5": {
                "structured_output": True,
                "tools": True,
                "thinking": False,
                "multimodal": False,
                "max_tokens": 4096,
                "context_length": 16385,
                "description": "OpenAI GPT-3.5 - Efficient and reliable"
            },
            # Reasoning models (o1/o3 family)
            "o1": {
                "structured_output": True,
                "tools": False,  # o1 models don't support function calling
                "thinking": True,
                "multimodal": False,
                "max_tokens": 65536,
                "context_length": 128000,
                "description": "OpenAI o1 - Advanced reasoning model"
            },
            "o3": {
                "structured_output": True,
                "tools": False,  # o3 models don't support function calling  
                "thinking": True,
                "multimodal": False,
                "max_tokens": 65536,
                "context_length": 128000,
                "description": "OpenAI o3 - Next-generation reasoning model"
            }
        }
        
        # Create a mapping that handles partial matches
        enhanced_capabilities = {}
        for model_pattern, capabilities in capabilities_db.items():
            enhanced_capabilities[model_pattern] = capabilities
            
            # Also add common variations
            if model_pattern == "gpt-4o":
                enhanced_capabilities["gpt-4o-2024-08-06"] = capabilities
                enhanced_capabilities["gpt-4o-2024-05-13"] = capabilities
            elif model_pattern == "gpt-4o-mini":
                enhanced_capabilities["gpt-4o-mini-2024-07-18"] = capabilities
            elif model_pattern == "gpt-4-turbo":
                enhanced_capabilities["gpt-4-turbo-2024-04-09"] = capabilities
                enhanced_capabilities["gpt-4-1106-preview"] = capabilities
                enhanced_capabilities["gpt-4-0125-preview"] = capabilities
            elif model_pattern == "gpt-3.5-turbo":
                enhanced_capabilities["gpt-3.5-turbo-0125"] = capabilities
                enhanced_capabilities["gpt-3.5-turbo-1106"] = capabilities
        
        return enhanced_capabilities

    def _use_responses_api(self, model_name: Optional[str]) -> bool:
        """Whether to route the request through the Responses API."""
        if not model_name:
            return False
        return model_name.startswith(("o1-", "o3-"))

    def _messages_to_input(self, messages: List[Dict[str, str]]) -> str:
        """Convert messages to a plain text input suitable for the Responses API."""
        parts: List[str] = []
        for m in messages:
            role = m.get("role", "user").capitalize()
            content = m.get("content", "")
            parts.append(f"{role}: {content}")
        return "\n\n".join(parts)

    def _extract_thinking_trace_responses(self, data: Dict[str, Any]) -> Optional[str]:
        """Best-effort extraction of reasoning/trace from Responses API payloads."""
        # No standard field; return None by default
        return None



