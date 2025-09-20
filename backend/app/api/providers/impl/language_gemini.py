"""
Gemini Language Model Provider Implementation
Migrated from classification_gemini_native.py with unified interface
"""
import logging
import json
import re
from typing import Dict, List, Optional, AsyncIterator, Union, Any, Type
from pydantic import BaseModel

import google.generativeai as genai
from google.generativeai import types as genai_types

from app.api.providers.base import LanguageModelProvider, ModelInfo, GenerationResponse

logger = logging.getLogger(__name__)

# Default Gemini model configurations (replaces JSON config)
DEFAULT_GEMINI_MODELS = {
    "gemini-2.5-flash-preview-05-20": {
        "description": "Latest Gemini model with reasoning, multimodal capabilities, and structured output",
        "max_tokens": 8192,
        "context_length": 1048576,
        "supports_multimodal": True,
        "supports_structured_output": True,
        "supports_thinking": True
    },
    "gemini-2.5-flash-lite-preview-06-17": {
        "description": "Gemini 2.5 Flash-Lite Preview",
        "max_tokens": 8192,
        "context_length": 1048576,
        "supports_multimodal": True,
        "supports_structured_output": True,
        "supports_thinking": True
    }
}


class GeminiLanguageModelProvider(LanguageModelProvider):
    """
    Gemini implementation of the LanguageModelProvider interface.
    Migrated from GeminiNativeClassificationProvider with enhanced capabilities.
    """
    
    def __init__(self, api_key: str, model_name: Optional[str] = None):
        self.api_key = api_key
        
        # Get model name from defaults if not provided
        if not model_name:
            model_name = list(DEFAULT_GEMINI_MODELS.keys())[0]  # Use first default model
        
        self.default_model = model_name
        self._model_cache = {}
        
        try:
            genai.configure(api_key=self.api_key)
            self.client = genai.GenerativeModel(self.default_model)
            logger.info(f"Gemini provider initialized with model: {self.default_model}")
        except Exception as e:
            logger.error(f"Failed to initialize Gemini provider: {e}")
            raise ConnectionError(f"Gemini client failed to initialize: {e}")
    
    async def discover_models(self) -> List[ModelInfo]:
        """Gemini: Use default configurations since Gemini doesn't have a models endpoint"""
        models = []
        
        for model_name, model_config in DEFAULT_GEMINI_MODELS.items():
            model_info = ModelInfo(
                name=model_name,
                provider="gemini",
                supports_structured_output=model_config.get("supports_structured_output", True),
                supports_tools=model_config.get("supports_tools", False),  # Gemini function calling
                supports_streaming=True,
                supports_thinking=model_config.get("supports_thinking", True),
                supports_multimodal=model_config.get("supports_multimodal", True),
                max_tokens=model_config.get("max_tokens"),
                context_length=model_config.get("context_length"),
                description=model_config.get("description", f"Gemini {model_name}")
            )
            models.append(model_info)
            self._model_cache[model_name] = model_info
        
        logger.info(f"Loaded {len(models)} Gemini models from defaults")
        return models
    
    async def generate(self, 
                      messages: List[Dict[str, str]],
                      model_name: str,
                      response_format: Optional[Dict] = None,
                      tools: Optional[List[Dict]] = None,
                      stream: bool = False,
                      thinking_enabled: bool = False,
                      **kwargs) -> Union[GenerationResponse, AsyncIterator[GenerationResponse]]:
        
        # Create model instance for this specific model
        model = genai.GenerativeModel(model_name)
        
        # Convert messages to Gemini format
        content_parts = self._convert_messages_to_gemini_format(messages, response_format)
        
        # Prepare generation config
        gen_config_dict = {}
        for key in ['temperature', 'top_p', 'top_k', 'candidate_count', 'max_output_tokens']:
            if key in kwargs:
                gen_config_dict[key] = kwargs[key]
        
        generation_config = genai_types.GenerationConfig(**gen_config_dict)
        
        # Handle thinking mode
        thinking_config = None
        if thinking_enabled:
            thinking_config_data = {"include_thoughts": True}
            if "thinking_budget" in kwargs:
                thinking_config_data["thinking_budget"] = kwargs["thinking_budget"]
            
            try:
                if hasattr(genai_types, 'ThinkingConfig'):
                    thinking_config = genai_types.ThinkingConfig(**thinking_config_data)
                    logger.info("Gemini: ThinkingConfig enabled")
                else:
                    logger.warning("Gemini: ThinkingConfig not available in current library version")
            except Exception as e:
                logger.warning(f"Gemini: Error setting up ThinkingConfig: {e}")
        
        # Prepare generation kwargs
        generation_kwargs = {
            "contents": content_parts,
            "generation_config": generation_config,
        }
        
        if thinking_config:
            generation_kwargs["thinking_config"] = thinking_config
        
        # Handle tools (Gemini function calling)
        if tools:
            # Convert tools to Gemini format
            gemini_tools = self._convert_tools_to_gemini_format(tools)
            generation_kwargs["tools"] = gemini_tools
        
        if stream:
            return self._stream_generate(model, generation_kwargs)
        else:
            return await self._generate(model, generation_kwargs)
    
    async def _generate(self, model, generation_kwargs: Dict) -> GenerationResponse:
        """Handle non-streaming generation"""
        try:
            response = await model.generate_content_async(**generation_kwargs)
            
            # Extract content
            try:
                content = response.text
            except ValueError as ve:
                # Handle safety filter blocks
                finish_reason = None
                if hasattr(response, 'candidates') and response.candidates:
                    candidate = response.candidates[0]
                    if hasattr(candidate, 'finish_reason'):
                        finish_reason = candidate.finish_reason
                
                if finish_reason == 2:  # SAFETY
                    raise RuntimeError("Gemini response blocked by safety filters")
                elif finish_reason == 3:  # RECITATION
                    raise RuntimeError("Gemini response blocked due to recitation concerns")
                else:
                    raise RuntimeError(f"Gemini response text not accessible: {ve}")
            
            # Clean JSON from markdown blocks if present
            if content:
                json_match = re.search(r"```(?:json)?\s*(?P<json>[\s\S]*?)\s*```", content, re.DOTALL)
                if json_match:
                    content = json_match.group("json").strip()
            
            # Extract thinking trace
            thinking_trace = self._extract_thinking_trace(response)
            
            # Extract usage
            usage = None
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                usage_meta = response.usage_metadata
                usage = {
                    "prompt_tokens": getattr(usage_meta, 'prompt_token_count', 0),
                    "completion_tokens": getattr(usage_meta, 'candidates_token_count', 0),
                    "total_tokens": getattr(usage_meta, 'total_token_count', 0)
                }
                if hasattr(usage_meta, 'thoughts_token_count') and usage_meta.thoughts_token_count:
                    usage["thoughts_tokens"] = usage_meta.thoughts_token_count
            
            return GenerationResponse(
                content=content,
                model_used=generation_kwargs.get("model", self.default_model),
                usage=usage,
                thinking_trace=thinking_trace,
                raw_response=response
            )
            
        except Exception as e:
            logger.error(f"Gemini generation error: {e}")
            raise RuntimeError(f"Gemini generation failed: {str(e)}")
    
    async def _stream_generate(self, model, generation_kwargs: Dict) -> AsyncIterator[GenerationResponse]:
        """Handle streaming generation"""
        try:
            # Gemini streaming
            response_stream = model.generate_content(**generation_kwargs, stream=True)
            
            accumulated_content = ""
            thinking_trace = ""
            
            for chunk in response_stream:
                try:
                    chunk_text = chunk.text
                    accumulated_content += chunk_text
                    
                    # Check for thinking content
                    if self._is_thinking_content(chunk_text):
                        thinking_trace += chunk_text
                    
                    yield GenerationResponse(
                        content=accumulated_content,
                        model_used=generation_kwargs.get("model", self.default_model),
                        thinking_trace=thinking_trace if thinking_trace else None,
                        raw_response=chunk
                    )
                    
                except ValueError:
                    # Skip chunks that don't have text (safety filters, etc.)
                    continue
                    
        except Exception as e:
            logger.error(f"Gemini streaming error: {e}")
            raise RuntimeError(f"Gemini streaming failed: {str(e)}")
    
    def _convert_messages_to_gemini_format(self, messages: List[Dict[str, str]], response_format: Optional[Dict] = None) -> List[str]:
        """Convert standard messages to Gemini content format"""
        content_parts = []
        
        # Build system prompt
        system_parts = []
        user_parts = []
        
        for message in messages:
            role = message["role"]
            content = message["content"]
            
            if role == "system":
                system_parts.append(content)
            elif role == "user":
                user_parts.append(content)
            elif role == "assistant":
                # For conversation history, we'd need to handle this differently
                # For now, treat as user input
                user_parts.append(f"Assistant said: {content}")
        
        # Add structured output instructions if needed
        if response_format:
            json_schema_string = json.dumps(response_format, indent=2)
            system_parts.append(
                "Your task is to act as a structured data extractor. "
                "Analyze the provided text and media content. "
                "Your output MUST be a single, valid JSON object that strictly adheres to the following JSON schema. "
                "Do NOT include any explanatory text, markdown formatting (like ```json), or any other text before or after the JSON object. "
                "Your response must be only the JSON object itself."
                f"\n\n--- JSON Schema ---\n{json_schema_string}"
            )
        
        # Combine system and user content
        final_prompt = ""
        if system_parts:
            final_prompt += "\n\n".join(system_parts) + "\n\n"
        if user_parts:
            final_prompt += "--- User Content ---\n" + "\n\n".join(user_parts)
        
        return [final_prompt]
    
    def _convert_tools_to_gemini_format(self, tools: List[Dict]) -> List[Any]:
        """Convert standard tool format to Gemini function declarations"""
        # Gemini function calling format is different
        # This would need to be implemented based on Gemini's specific requirements
        logger.warning("Gemini function calling not yet fully implemented")
        return []
    
    def _extract_thinking_trace(self, response) -> Optional[str]:
        """Gemini: Extract thinking from usage metadata if available"""
        if hasattr(response, 'usage_metadata') and response.usage_metadata:
            usage = response.usage_metadata
            if hasattr(usage, 'thoughts_token_count') and usage.thoughts_token_count:
                return f"Thinking tokens used: {usage.thoughts_token_count}"
        return None
    
    def _is_thinking_content(self, content: str) -> bool:
        """Check if content appears to be thinking/reasoning"""
        thinking_patterns = [
            "Let me think", "I need to", "First,", "To solve", "Breaking this down",
            "Let me work through", "I'll approach", "Considering"
        ]
        return any(pattern in content for pattern in thinking_patterns)
    
    def get_model_info(self, model_name: str) -> Optional[ModelInfo]:
        """Get cached model info"""
        return self._model_cache.get(model_name)
