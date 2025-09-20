"""
Ollama Language Model Provider Implementation
"""
import logging
import json
import httpx
import re
from typing import Dict, List, Optional, AsyncIterator, Union, Any

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse

logger = logging.getLogger(__name__)


class OllamaLanguageModelProvider(LanguageModelProvider):
    """
    Ollama implementation of the LanguageModelProvider interface.
    Handles chat, structured output, tool calls, and streaming with Ollama-specific edge cases.
    """
    
    def __init__(self, base_url: str = "http://ollama:11434"):
        self.base_url = base_url.rstrip('/')
        self.client = httpx.AsyncClient(timeout=60.0)
        self._model_cache = {}
        logger.info(f"Ollama provider initialized with base_url: {self.base_url}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Ollama: GET /api/tags with enhanced capability detection"""
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
                
                # Check enhanced capabilities first, then fall back to heuristics
                capabilities = enhanced_capabilities.get(model_name) or enhanced_capabilities.get(base_name)
                if capabilities:
                    supports_tools = "tools" in capabilities
                    supports_multimodal = "vision" in capabilities
                    supports_thinking = "thinking" in capabilities
                else:
                    supports_tools = self._supports_tools_heuristic(model_name)
                    supports_multimodal = self._supports_multimodal(model_name)
                    supports_thinking = True  # Most models can do basic thinking
                
                model_info = ModelInfo(
                    name=model_name,
                    provider="ollama",
                    supports_structured_output=True,  # Ollama supports format parameter
                    supports_tools=supports_tools,
                    supports_streaming=True,
                    supports_thinking=supports_thinking,
                    supports_multimodal=supports_multimodal,
                    max_tokens=None,  # Ollama doesn't expose this in tags
                    context_length=None,
                    description=f"Ollama {model_name}" + (" (Tools)" if supports_tools else " (Chat)")
                )
                models.append(model_info)
                self._model_cache[model_name] = model_info
            
            logger.info(f"Discovered {len(models)} Ollama models with enhanced capability detection")
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
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        
        # Respect discovered capabilities: drop tools if model doesn't support them
        model_info = self._model_cache.get(model_name)
        if tools and model_info and not model_info.supports_tools:
            logger.info(f"Model {model_name} does not support tools; ignoring provided tools")
            tools = None

        # Ollama payload format
        payload = {
            "model": model_name,
            "messages": messages,
            "stream": stream,
            **kwargs
        }
        
        # Ollama structured output format (uses "format" parameter)
        if response_format:
            payload["format"] = response_format
        
        # Ollama tools format
        if tools:
            payload["tools"] = tools
        
        # Ollama thinking mode - encourage <think> tags
        if thinking_enabled:
            system_msg = {
                "role": "system",
                "content": "When solving problems, please show your thinking process using <think></think> tags before providing your final answer."
            }
            
            # Add or append to system message
            system_exists = False
            for msg in messages:
                if msg["role"] == "system":
                    msg["content"] += "\n\n" + system_msg["content"]
                    system_exists = True
                    break
            
            if not system_exists:
                messages.insert(0, system_msg)
        
        if stream:
            return self._stream_generate(payload)
        else:
            return await self._generate(payload)
    
    async def _generate(self, payload: Dict) -> GenerationResponse:
        """Handle non-streaming generation"""
        try:
            response = await self.client.post(f"{self.base_url}/api/chat", json=payload)
            response.raise_for_status()
            data = response.json()
            
            content = data["message"]["content"]
            thinking_trace = self._extract_thinking_trace(content)
            clean_content = self._remove_thinking_tags(content)
            
            return GenerationResponse(
                content=clean_content,
                model_used=data["model"],
                usage=data.get("usage"),  # Ollama may not provide usage
                tool_calls=self._extract_tool_calls(content),
                thinking_trace=thinking_trace,
                finish_reason=data.get("done_reason"),
                raw_response=data
            )
            
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama API error: {e.response.status_code} - {e.response.text}")
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
                        
                        content_delta = chunk["message"]["content"]
                        accumulated_content += content_delta
                        
                        # Handle Ollama thinking tags in streaming
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
                            tool_calls=self._extract_tool_calls(accumulated_content),
                            raw_response=chunk
                        )
                        
                    except json.JSONDecodeError:
                        continue
                        
        except httpx.HTTPStatusError as e:
            logger.error(f"Ollama streaming error: {e.response.status_code} - {e.response.text}")
            raise RuntimeError(f"Ollama streaming failed: {e.response.text}")
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
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)
    
    def _supports_tools(self, model_name: str) -> bool:
        """Check if Ollama model supports tools - used only as fallback during discover_models"""
        return self._supports_tools_heuristic(model_name)
    
    def _supports_tools_heuristic(self, model_name: str) -> bool:
        """Fallback heuristic for tool support detection"""
        model_lower = model_name.lower()
        
        # Models that definitely don't support tools
        non_tool_models = ["embed", "embedding", "sentence-transformer"]
        # Reasoning-only families typically don't implement function calling
        non_tool_models += ["o1", "o3", "r1", "deepseek-r1", "reason", "think"]
        if any(non_tool in model_lower for non_tool in non_tool_models):
            return False
        
        # Models known to support tools
        tool_supporting_models = [
            "llama3.1", "llama3.2", "qwen2.5", "qwen2", "mistral", "mixtral",
            "codellama", "phi3", "gemma2", "command-r", "nous-hermes"
        ]
        
        return any(supported_model in model_lower for supported_model in tool_supporting_models)
    
    def _supports_multimodal(self, model_name: str) -> bool:
        """Ollama models with vision capabilities"""
        vision_models = ["llava", "bakllava", "moondream", "llama3.2-vision"]
        return any(vision_model in model_name.lower() for vision_model in vision_models)
