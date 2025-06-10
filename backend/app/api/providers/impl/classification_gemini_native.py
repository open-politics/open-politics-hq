import logging
import os
from typing import Any, Dict, List, Optional, Type, Union

from pydantic import BaseModel
from google.oauth2 import service_account # For service account auth if needed
from google.auth.exceptions import DefaultCredentialsError

# Imports for GeminiClassificationProvider
from google import genai
from google.genai import types as genai_types
# For newer features, might need specific imports if thoughts/tool use logs are structured differently
# from google.generativeai.types import Candidate, Content, Part # etc.

from app.api.providers.base import ClassificationProvider # Protocol

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class GeminiNativeClassificationProvider(ClassificationProvider):
    """
    Native Google Gemini API implementation of the ClassificationProvider interface.
    Supports structured output and thinking.
    """
    def __init__(self, api_key: Optional[str] = None, model_name: str = "gemini-2.5-flash-preview-05-20"):
        """
        Initialize the Gemini classification provider.
        Args:
            api_key: Google API Key. If None, attempts to use GOOGLE_APPLICATION_CREDENTIALS.
            model_name: The Gemini model name to use (e.g., "gemini-2.5-flash-preview-05-20").
        """
        self.model_name = model_name
        self.api_key = api_key
        self.client = None

        try:
            if self.api_key:
                self.client = genai.Client(api_key=self.api_key)
                logger.info(f"GeminiNativeClassificationProvider initialized for model '{self.model_name}' using API Key.")
            else:
                # Try to use Application Default Credentials (ADC) if no API key
                credentials_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
                if credentials_path:
                    try:
                        genai.configure() # Will attempt to use ADC
                        self.client = genai.GenerativeModel(self.model_name)
                        logger.info(f"GeminiNativeClassificationProvider initialized for model '{self.model_name}' using Application Default Credentials (GOOGLE_APPLICATION_CREDENTIALS).")
                    except Exception as e_adc:
                        logger.error(f"Failed to initialize Gemini with ADC (path: {credentials_path}): {e_adc}", exc_info=True)
                        raise ConnectionError(f"Gemini ADC initialization failed: {e_adc}") from e_adc
                else:
                    logger.error("Gemini API key not provided and GOOGLE_APPLICATION_CREDENTIALS not set.")
                    raise ValueError("Google API key or GOOGLE_APPLICATION_CREDENTIALS must be configured for GeminiNativeClassificationProvider.")
            
            if not self.client:
                raise ConnectionError("Gemini client could not be initialized.")

        except DefaultCredentialsError as e_cred:
            logger.error(f"Google Default Credentials Error for Gemini: {e_cred}. Ensure GOOGLE_APPLICATION_CREDENTIALS is set or API key is provided.", exc_info=True)
            raise ConnectionError("Gemini authentication failed: No valid credentials found.") from e_cred
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
        if not self.client:
            raise RuntimeError("Gemini client not initialized.")

        active_client = self.client
        current_model_name = self.model_name # Default model name

        if provider_config and provider_config.get("model_name_override"):
            model_override = provider_config["model_name_override"]
            if model_override != self.model_name:
                logger.warning(f"Model override '{model_override}' provided. Using initialized model '{self.model_name}'.")
                # For full model switching, client re-init would be needed.

        # --- Prepare GenerationConfig ---
        gen_config_dict: Dict[str, Any] = {
            'response_mime_type': 'application/json',
            'response_schema': output_model_class,
        }
        if provider_config:
            for key in ['temperature', 'top_p', 'top_k', 'candidate_count', 'max_output_tokens']:
                if key in provider_config:
                    gen_config_dict[key] = provider_config[key]

        # --- NEW: Handle ThinkingConfig ---
        thinking_config_data = {}
        include_thoughts_requested = False
        if provider_config and provider_config.get("thinking_config"):
            run_thinking_config = provider_config["thinking_config"]
            if run_thinking_config.get("include_thoughts", False):
                thinking_config_data["include_thoughts"] = True
                include_thoughts_requested = True
                logger.info("Gemini: Thought summaries requested (include_thoughts=True).")
            
            if "thinking_budget" in run_thinking_config and "flash" in current_model_name.lower():
                try:
                    budget = int(run_thinking_config["thinking_budget"])
                    if 0 <= budget <= 24576:
                        thinking_config_data["thinking_budget"] = budget
                        logger.info(f"Gemini: Thinking budget set to {budget}.")
                    else:
                        logger.warning(f"Invalid thinking_budget value: {budget}. Must be 0-24576. Ignoring.")
                except ValueError:
                    logger.warning(f"Invalid thinking_budget format: {run_thinking_config['thinking_budget']}. Ignoring.")
        
        if thinking_config_data: # Only add if there are actual settings for it
            gen_config_dict["thinking_config"] = genai_types.ThinkingConfig(**thinking_config_data)
        
        generation_config_obj = genai_types.GenerationConfig(**gen_config_dict)
        
        # --- Prepare Content Parts (Text & Media) ---
        content_parts: List[Union[str, genai_types.Part]] = []
        prompt_elements = []

        if instructions:
            prompt_elements.append(instructions)
        if text_content:
            prompt_elements.append(f"\n\n--- Document Text to Analyze: ---\n{text_content}")

        media_inputs_from_config: Optional[List[Dict[str, Any]]] = provider_config.get('media_inputs') if provider_config else None
        if media_inputs_from_config:
            if not text_content and not instructions:
                 prompt_elements.append("Analyze the following media content:")
            prompt_elements.append("\n\n--- Associated Media: ---")
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
        if final_prompt_text:
            content_parts.insert(0, final_prompt_text)
        elif not content_parts:
            raise ValueError("At least text_content or media_inputs must be provided.")

        parsed_model_instance: Optional[BaseModel] = None
        thought_summaries_list: List[str] = []
        response = None # Define response here to have it in scope for final exception block

        try:
            logger.debug(f"Calling Gemini model '{current_model_name}' with {len(content_parts)} parts. Prompt (text part prefix): '{final_prompt_text[:250]}...'")
            
            response = await active_client.generate_content_async(
                contents=content_parts,
                generation_config=generation_config_obj
            )

            # --- NEW: Process Response Parts for Data and Thoughts ---
            if response.candidates and response.candidates[0].content and response.candidates[0].content.parts:
                for part in response.candidates[0].content.parts:
                    if not part.text:
                        continue
                    
                    if hasattr(part, 'thought') and part.thought:
                        thought_summaries_list.append(part.text)
                        logger.debug(f"Gemini Thought Summary part received: '{part.text[:100]}...'")
                    else:
                        if parsed_model_instance:
                            logger.warning("Multiple non-thought parts found in Gemini response. Using the first one for data.")
                            continue 
                        try:
                            if isinstance(part, output_model_class):
                                parsed_model_instance = part
                                logger.debug(f"Pydantic model instance directly from Gemini SDK part. Type: {type(parsed_model_instance)}")
                            else:
                                parsed_model_instance = output_model_class.model_validate_json(part.text)
                                logger.debug(f"Pydantic model parsed from Gemini part text. Type: {type(parsed_model_instance)}")
                        except Exception as e_parse_data_part:
                            logger.error(f"Error parsing main data part as {output_model_class.__name__}: {e_parse_data_part}. Part text: {part.text[:200]}...", exc_info=True)
            
            if not parsed_model_instance and response.text:
                logger.warning("No specific data part parsed from response.candidates. Attempting to parse full response.text.")
                try:
                    parsed_model_instance = output_model_class.model_validate_json(response.text)
                    logger.debug(f"Pydantic model parsed from full response.text as fallback. Type: {type(parsed_model_instance)}")
                except Exception as e_parse_full_text:
                    logger.error(f"Error parsing full response.text as {output_model_class.__name__}: {e_parse_full_text}. Response text: {response.text[:500]}...", exc_info=True)
                    if not parsed_model_instance:
                        prompt_feedback_info = f"Prompt Feedback: {response.prompt_feedback}" if hasattr(response, 'prompt_feedback') and response.prompt_feedback else "No prompt feedback."
                        raise RuntimeError(f"Failed to parse Gemini JSON (full text fallback): {e_parse_full_text}. {prompt_feedback_info}") from e_parse_full_text
            
            if not parsed_model_instance:
                prompt_feedback_info = f"Prompt Feedback: {response.prompt_feedback}" if hasattr(response, 'prompt_feedback') and response.prompt_feedback else "No prompt feedback."
                raise RuntimeError(f"Failed to obtain structured data from Gemini response matching {output_model_class.__name__}. {prompt_feedback_info}")

            # --- Log Usage Metadata (includes thoughts_token_count) ---
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
            if include_thoughts_requested:
                if thought_summaries_list:
                    final_thinking_trace = "\n---\n".join(thought_summaries_list)
                else:
                    final_thinking_trace = "Thought summaries requested, but none were explicitly found in response parts."
            
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