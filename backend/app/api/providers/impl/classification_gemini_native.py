import logging
import os
import json
import re
from typing import Any, Dict, List, Optional, Type, Union

from pydantic import BaseModel, ValidationError
from google.oauth2 import service_account # For service account auth if needed
from google.auth.exceptions import DefaultCredentialsError

# Imports for GeminiClassificationProvider
import google.generativeai as genai
from google.generativeai import types as genai_types
# For newer features, might need specific imports if thoughts/tool use logs are structured differently
# from google.generativeai.types import Candidate, Content, Part # etc.

from app.api.providers.base import ClassificationProvider # Protocol
from app.api.providers.llm_config import llm_models_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class GeminiNativeClassificationProvider(ClassificationProvider):
    """
    Native Google Gemini API implementation of the ClassificationProvider interface.
    Supports structured output and thinking.
    """
    def __init__(self, api_key: Optional[str] = None, model_name: Optional[str] = None):
        """
        Initialize the Gemini classification provider.
        Args:
            api_key: Google API Key. This is required.
            model_name: The Gemini model name to use. If not provided, uses the default from config.
        """
        # Get model name from config if not provided
        if not model_name:
            try:
                # Get the recommended Gemini model from config
                gemini_models = llm_models_config.get_provider_models("gemini")
                if gemini_models:
                    # Use the first (and only) recommended model
                    model_name = list(gemini_models.keys())[0]
                else:
                    model_name = "gemini-2.5-flash-preview-05-20"  # Fallback
            except Exception as e:
                logger.warning(f"Could not get model from LLM config: {e}. Using fallback.")
                model_name = "gemini-2.5-flash-preview-05-20"
        
        self.model_name = model_name
        
        if not api_key:
            raise ValueError("A Google API key is required for the Gemini provider. Please configure it.")

        self.api_key = api_key
        self.model = None

        try:
            # Configure the library with the API key
            genai.configure(api_key=self.api_key)
            # Create the model instance
            self.model = genai.GenerativeModel(self.model_name)
            logger.info(f"GeminiNativeClassificationProvider initialized for model '{self.model_name}' using an API Key.")

            if not self.model:
                raise ConnectionError("Gemini model could not be initialized.")

        except Exception as e_init:
            logger.error(f"Unexpected error initializing GeminiNativeClassificationProvider: {e_init}", exc_info=True)
            raise ConnectionError(f"Gemini client failed to initialize: {e_init}") from e_init


    async def classify(self,
                       text_content: Optional[str],
                       output_model_class: Type[BaseModel],
                       instructions: Optional[str] = None,
                       provider_config: Optional[Dict[str, Any]] = None,
                       api_key_override: Optional[str] = None
                       ) -> Dict[str, Any]: # Ensure return type is Dict for the envelope
        if not self.model:
            raise RuntimeError("Gemini model not initialized.")

        current_model_name = self.model_name # Default model name

        if provider_config and provider_config.get("model_name_override"):
            model_override = provider_config["model_name_override"]
            if model_override != self.model_name:
                logger.warning(f"Model override '{model_override}' provided but not supported by this provider structure. Using initialized model '{self.model_name}'.")

        # --- Prepare GenerationConfig ---
        gen_config_dict: Dict[str, Any] = {}
        if provider_config:
            for key in ['temperature', 'top_p', 'top_k', 'candidate_count', 'max_output_tokens']:
                if key in provider_config:
                    gen_config_dict[key] = provider_config[key]
        
        generation_config_obj = genai_types.GenerationConfig(**gen_config_dict)

        # Handle ThinkingConfig - simplified to just a boolean
        thinking_config_data = {}
        include_thoughts_requested = False
        
        # Check for simple boolean thinking request
        enable_thinking = False
        thinking_budget = None
        
        if provider_config:
            # Support both old and new formats
            if provider_config.get("thinking_config"):
                thinking_config = provider_config["thinking_config"]
                if isinstance(thinking_config, dict):
                    enable_thinking = thinking_config.get("include_thoughts", False)
                    thinking_budget = thinking_config.get("thinking_budget")
                elif isinstance(thinking_config, bool):
                    enable_thinking = thinking_config
            elif "enable_thinking" in provider_config:
                enable_thinking = provider_config["enable_thinking"]
                thinking_budget = provider_config.get("thinking_budget")
        
        if enable_thinking:
            thinking_config_data["include_thoughts"] = True
            # Add thinking_budget if provided
            if thinking_budget is not None:
                thinking_config_data["thinking_budget"] = thinking_budget
            include_thoughts_requested = True
            logger.info("Gemini: Thinking/reasoning enabled.")
            
            # Check if the model supports thinking
            try:
                model_config = llm_models_config.get_model_config("gemini", current_model_name)
                if model_config and model_config.get("supports_thinking", False):
                    logger.info(f"Model {current_model_name} supports thinking.")
                else:
                    logger.warning(f"Model {current_model_name} may not support thinking, but proceeding anyway.")
            except Exception as e:
                logger.warning(f"Could not verify thinking support: {e}")

        # --- System Prompt Engineering ---
        # The new approach sends the schema in the prompt and asks for a JSON string,
        # moving validation to our side.
        json_schema_string = json.dumps(output_model_class.model_json_schema(), indent=2)
        system_prompt = (
            "Your task is to act as a structured data extractor. "
            "Analyze the provided text and media content. "
            "Your output MUST be a single, valid JSON object that strictly adheres to the following JSON schema. "
            "Do NOT include any explanatory text, markdown formatting (like ```json), or any other text before or after the JSON object. "
            "Your response must be only the JSON object itself."
            f"\n\n--- JSON Schema ---\n{json_schema_string}"
        )
        
        # --- Prepare Content Parts (Text & Media) ---
        content_parts: List[Union[str, genai_types.Part]] = []
        
        # Add the main system prompt and user instructions first
        prompt_elements = [system_prompt]
        if instructions:
            prompt_elements.append(f"\n\n--- User Instructions ---\n{instructions}")

        if text_content:
            prompt_elements.append(f"\n\n--- Document Text to Analyze ---\n{text_content}")

        media_inputs_from_config: Optional[List[Dict[str, Any]]] = provider_config.get('media_inputs') if provider_config else None
        if media_inputs_from_config:
            if not text_content and not instructions:
                 prompt_elements.append("Analyze the following media content:")
            prompt_elements.append("\n\n--- Associated Media ---")
            for i, media_item in enumerate(media_inputs_from_config):
                media_uuid = media_item.get('uuid', f'media_{i+1}')
                media_meta = media_item.get("metadata", {})
                media_title = media_meta.get("title", f"Media item {i+1}")
                media_type_from_input = media_item.get("type", "unknown")
                prompt_elements.append(f"- Media Item {i+1}: (Type: {media_type_from_input}, Title: {media_title}, UUID: {media_uuid})")
                
                media_content_bytes = media_item.get('content')
                media_mime_type = media_item.get('mime_type')
                if isinstance(media_content_bytes, bytes) and media_mime_type:
                    content_parts.append(genai_types.Part.from_data(data=media_content_bytes, mime_type=media_mime_type))
                else:
                    logger.warning(f"Media item {media_title} (UUID: {media_uuid}) is missing content bytes or mime_type. Skipping.")
            
        final_prompt_text = "\n".join(prompt_elements)
        content_parts.insert(0, final_prompt_text)

        parsed_model_instance: Optional[BaseModel] = None
        response = None
        thought_summaries_list: List[str] = []

        try:
            logger.debug(f"Calling Gemini model '{current_model_name}' with {len(content_parts)} parts. Prompt (text part prefix): '{final_prompt_text[:250]}...'")
            
            generation_kwargs = {
                "contents": content_parts,
                "generation_config": generation_config_obj,
            }
            if thinking_config_data:
                # Check if ThinkingConfig is available in the current library version
                thinking_config_obj = None
                try:
                    # Try to create ThinkingConfig if it exists
                    if hasattr(genai_types, 'ThinkingConfig'):
                        thinking_config_obj = genai_types.ThinkingConfig(**thinking_config_data)
                        generation_kwargs["thinking_config"] = thinking_config_obj
                        logger.info("Gemini: ThinkingConfig successfully applied")
                    else:
                        logger.warning("Gemini: ThinkingConfig not available in current library version. Thinking feature disabled for this request.")
                except AttributeError as e:
                    logger.warning(f"Gemini: ThinkingConfig not available: {e}. Thinking feature disabled for this request.")
                except Exception as e:
                    logger.warning(f"Gemini: Error setting up ThinkingConfig: {e}. Thinking feature disabled for this request.")
            
            response = await self.model.generate_content_async(**generation_kwargs)

            # --- Process Response for Data and Optional Thoughts ---
            primary_data_text = None
            
            # Check if response has valid text before accessing it
            try:
                primary_data_text = response.text
            except ValueError as ve:
                # Handle cases where response.text is not available (e.g., blocked by safety filters)
                error_msg = str(ve)
                
                # Check finish reason if available
                finish_reason = None
                if hasattr(response, 'candidates') and response.candidates:
                    candidate = response.candidates[0]
                    if hasattr(candidate, 'finish_reason'):
                        finish_reason = candidate.finish_reason
                
                if finish_reason == 2:  # SAFETY
                    raise RuntimeError(f"Gemini response was blocked by safety filters. This may be due to content policy violations. Consider revising your prompt or input content.")
                elif finish_reason == 3:  # RECITATION  
                    raise RuntimeError(f"Gemini response was blocked due to recitation concerns. The content may be too similar to training data.")
                elif finish_reason == 4:  # OTHER
                    raise RuntimeError(f"Gemini response was blocked for other reasons. {error_msg}")
                else:
                    raise RuntimeError(f"Gemini response text not accessible: {error_msg}. Finish reason: {finish_reason}")
            except Exception as e:
                raise RuntimeError(f"Error accessing Gemini response text: {e}")
            
            # Clean the response text to extract pure JSON
            # Models sometimes wrap JSON in ```json ... ```
            if primary_data_text:
                json_match = re.search(r"```(json)?\s*(?P<json>[\s\S]*?)\s*```", primary_data_text, re.DOTALL)
                if json_match:
                    primary_data_text = json_match.group("json").strip()
                    logger.debug("Extracted JSON from markdown block.")

            if not primary_data_text:
                prompt_feedback_info = f"Prompt Feedback: {response.prompt_feedback}" if hasattr(response, 'prompt_feedback') and response.prompt_feedback else "No prompt feedback."
                raise RuntimeError(f"Gemini response was empty or contained no processable text. {prompt_feedback_info}")

            # --- Parse and Validate the JSON response ---
            try:
                # Attempt to parse and validate the JSON
                logger.debug(f"Attempting to validate JSON with model {output_model_class.__name__}")
                parsed_model_instance = output_model_instance = output_model_class.model_validate_json(primary_data_text)
                logger.debug(f"Pydantic model parsed successfully from Gemini response. Type: {type(parsed_model_instance)}")
            except Exception as e_parse:
                error_msg = f"Failed to parse or validate Gemini JSON response as {output_model_class.__name__}"
                logger.error(f"{error_msg}. Error: {e_parse}. Response text: {primary_data_text}", exc_info=True)
                prompt_feedback_info = f"Prompt Feedback: {response.prompt_feedback}" if hasattr(response, 'prompt_feedback') and response.prompt_feedback else "No prompt feedback."
                raise RuntimeError(f"{error_msg}. {prompt_feedback_info}") from e_parse

            if not parsed_model_instance:
                 raise RuntimeError(f"Could not create a model instance from the response, even after parsing. Response text: {primary_data_text[:500]}")

            # --- Log Usage Metadata ---
            if hasattr(response, 'usage_metadata') and response.usage_metadata:
                usage = response.usage_metadata
                logger.info(
                    f"Gemini Usage - Prompt Tokens: {usage.prompt_token_count}, "
                    f"Candidates Tokens: {usage.candidates_token_count if hasattr(usage, 'candidates_token_count') else 'N/A'}, "
                    f"Total Tokens: {usage.total_token_count if hasattr(usage, 'total_token_count') else 'N/A'}"
                )
                if hasattr(usage, 'thoughts_token_count') and usage.thoughts_token_count is not None:
                    logger.info(f"Gemini Usage - Thoughts Tokens: {usage.thoughts_token_count}")
            
            # --- Construct Return Envelope ---
            final_thinking_trace = None
            if include_thoughts_requested and thought_summaries_list:
                final_thinking_trace = "\n---\n".join(thought_summaries_list)

            return_envelope = {
                "data": parsed_model_instance.model_dump(),
                "_model_name": current_model_name,
            }
            if final_thinking_trace:
                return_envelope["_thinking_trace"] = final_thinking_trace
            
            return return_envelope

        except ValueError as ve:
            logger.error(f"ValueError in Gemini provider: {str(ve)}", exc_info=True)
            raise
        except ConnectionError as ce:
            logger.error(f"ConnectionError for Gemini: {ce}", exc_info=True)
            raise
        except Exception as e:
            logger.error(f"Gemini classification failed for model {current_model_name}: {str(e)}", exc_info=True)
            prompt_feedback_info = ""
            if response and hasattr(response, 'prompt_feedback') and response.prompt_feedback:
                 prompt_feedback_info = f" Gemini Prompt Feedback: {response.prompt_feedback}"
            raise RuntimeError(f"Gemini classification failed: {str(e)}.{prompt_feedback_info}") from e
    
    def get_model_capabilities(self) -> Dict[str, Any]:
        """Get capabilities of the current model from the LLM config."""
        try:
            model_config = llm_models_config.get_model_config("gemini", self.model_name)
            if model_config:
                return {
                    "supports_multimodal": model_config.get("supports_multimodal", False),
                    "supports_structured_output": model_config.get("supports_structured_output", False),
                    "supports_thinking": model_config.get("supports_thinking", False),
                    "max_tokens": model_config.get("max_tokens"),
                    "context_length": model_config.get("context_length"),
                    "model_name": self.model_name,
                    "provider": "gemini"
                }
        except Exception as e:
            logger.warning(f"Could not get model capabilities: {e}")
        
        # Fallback capabilities for gemini-2.5-flash-preview-05-20
        return {
            "supports_multimodal": True,
            "supports_structured_output": True,
            "supports_thinking": True,
            "max_tokens": 8192,
            "context_length": 1048576,
            "model_name": self.model_name,
            "provider": "gemini"
        } 