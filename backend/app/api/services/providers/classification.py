"""
Concrete implementations of classification providers.
"""
import logging
import os # Import os for environment variables
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, Field, create_model
from pydantic.fields import FieldInfo

# Imports for GeminiClassificationProvider
from google import genai
from google.genai import types as genai_types

from app.core.opol_config import get_fastclass
from app.models import ClassificationScheme, FieldType
from app.api.services.providers.base import ClassificationProvider # Assuming base.py exists
# from app.api.v2.classification import classify_text as core_classify_text # No longer needed

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)


class OpolClassificationProvider(ClassificationProvider):
    """
    OPOL implementation of the ClassificationProvider interface.
    """
    
    def __init__(self, provider: str = "Google", model_name: str = "gemini-2.0-flash"):
        """
        Initialize the OPOL classification provider.
        
        Args:
            provider: The AI provider to use
            model_name: The model name to use
        """
        self.provider = provider
        self.model_name = model_name
        # Note: We defer actual client initialization until classification time
        # so we can use per-request API keys
        logger.info(f"OPOL classification provider initialized for {provider}/{model_name}")
    
    def classify(self, 
                 text: str, 
                 model_class: Type[BaseModel], # Expect the generated Pydantic model class
                 instructions: Optional[str] = None,
                 api_key: Optional[str] = None,
                 provider_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]: # Added provider_config
        """
        Classify text using the provided Pydantic model and OPOL.

        Args:
            text: The text to classify.
            model_class: The dynamically generated Pydantic model class representing the scheme.
            instructions: Optional instructions for the classification model (usually from the scheme).
            api_key: Optional API key for the provider.
            provider_config: Optional provider-specific configuration.
                             For OPOL, known keys: None currently.

        Returns:
            Classification results as a dictionary.
        """
        if not text:
            logger.warning("Provider received empty text. Returning empty result.")
            return {}

        if provider_config:
            if provider_config.get('thinking_budget') is not None:
                logger.warning("OpolClassificationProvider received 'thinking_budget' in provider_config, but it's not natively supported by fastclass directly. The underlying model might use its default thinking.")
            if provider_config.get('images'):
                logger.warning("OpolClassificationProvider received 'images' in provider_config, but image input is not supported by this provider.")

        # Ensure instructions is at least an empty string
        instructions = instructions or ""

        try:
            # Get OPOL fastclass instance
            # Determine provider/model settings based on environment or defaults
            if os.environ.get("LOCAL_LLM") == "True":
                 provider_name = "ollama"
                 model_name = os.environ.get("LOCAL_LLM_MODEL", "llama3.2:latest")
                 current_api_key = "" # Ollama doesn't typically use API keys
            else:
                # Use defaults from provider initialization or potentially other config
                provider_name = self.provider 
                model_name = self.model_name 
                current_api_key = api_key # Use provided key or potentially a default/global one
                
            logger.debug(f"Initializing fastclass with provider: {provider_name}, model: {model_name}")
            fastclass = get_fastclass(
                provider=provider_name,
                model_name=model_name,
                api_key=current_api_key
            )

            # Classify using OPOL with the provided ModelClass
            logger.debug(f"Calling fastclass.classify with model: {model_class.__name__}, instructions: '{instructions[:50]}...'")
            result = fastclass.classify(model_class, instructions, text)
            
            # Log the raw result type and value before dumping
            logger.debug(f"Raw result from fastclass.classify (type: {type(result)}): {result}")

            # Return the validated & structured data as a dictionary
            if isinstance(result, BaseModel):
                return result.model_dump()
            else:
                # This case shouldn't typically happen if fastclass works correctly
                logger.warning(f"Fastclass returned non-Pydantic result: {type(result)}. Returning as is.")
                return result 

        except Exception as e:
            logger.error(f"OPOL classification failed in provider for model {model_class.__name__}: {str(e)}", exc_info=True)
            raise RuntimeError(f"Classification failed: {str(e)}")

class GeminiClassificationProvider(ClassificationProvider):
    """
    Native Google Gemini API implementation of the ClassificationProvider interface.
    Supports structured output and thinking.
    """
    def __init__(self, model_name: str):
        """
        Initialize the Gemini classification provider.
        Args:
            model_name: The Gemini model name to use (e.g., "gemini-1.5-flash-latest", "gemini-2.5-flash-preview-04-17").
        """
        self.model_name = model_name
        logger.info(f"Gemini native classification provider initialized for model {self.model_name}")

    def classify(self,
                 text: str,
                 model_class: Type[BaseModel],
                 instructions: Optional[str] = None,
                 api_key: Optional[str] = None,
                 provider_config: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        """
        Classify text using the native Gemini API with structured output and thinking.

        Args:
            text: The text to classify.
            model_class: The Pydantic model class defining the desired output structure.
            instructions: Optional instructions for the classification model (e.g., from scheme description).
            api_key: API key for Google Gemini.
            provider_config: Dictionary with provider-specific configurations.
                             Known keys: 'thinking_budget' (int), 'images' (List[bytes]).

        Returns:
            Classification results as a dictionary.
        """
        # Text input is still required, even if images are primary for some tasks.
        # It can be an empty string if not applicable.
        # if not text and not (provider_config and provider_config.get('images')):
        #     logger.warning("Gemini provider received no text and no images. Returning empty result.")
        #     return {}
        # Simpler: allow empty text if images are present. If both empty, it might fail or return empty.

        final_api_key = api_key or os.getenv("GOOGLE_API_KEY")
        if not final_api_key:
            logger.error("Gemini API key not provided directly or via GOOGLE_API_KEY environment variable.")
            raise ValueError("Google API key is required for GeminiClassificationProvider.")

        try:
            client = genai.Client(api_key=final_api_key)

            thinking_budget_value = None
            if provider_config:
                tb_value = provider_config.get('thinking_budget')
                if tb_value is not None:
                    try:
                        thinking_budget_value = int(tb_value)
                        # Clamp to valid range for Gemini API (0-24576)
                        thinking_budget_value = max(0, min(thinking_budget_value, 24576))
                        logger.info(f"Gemini thinking_budget set to: {thinking_budget_value}")
                    except ValueError:
                        logger.warning(f"Non-integer thinking_budget value: {tb_value}. Disabling thinking or using model default.")
                        thinking_budget_value = None # Explicitly None to let model decide or disable if 0
            
            gen_config_params = {
                'response_mime_type': 'application/json',
                'response_schema': model_class,
            }
            # Re-enable adding thinking_config if budget is set
            if thinking_budget_value is not None: 
                gen_config_params['thinking_config'] = genai_types.ThinkingConfig(thinking_budget=thinking_budget_value)
                logger.info(f"PROVIDER DEBUG: thinking_config added to gen_config_params with budget: {thinking_budget_value}")
            else:
                 logger.info("PROVIDER DEBUG: thinking_config NOT added as budget is None.")

            # Create the config object
            generation_config_obj = genai_types.GenerateContentConfig(**gen_config_params)

            # Construct content for the LLM
            # Base content is the text to analyze.
            # If instructions are provided, prepend them.
            # If images are provided, add them as Parts.
            
            content_parts = []
            effective_prompt = text # Start with the base text
            if instructions:
                # Prepend instructions. This forms the main textual part of the prompt.
                effective_prompt = f"{instructions}\n\nText to analyze:\n{text}"
            
            content_parts.append(effective_prompt) # Text part always present, even if empty string

            # Handle images if provided in provider_config
            images_data: Optional[List[bytes]] = None
            if provider_config and provider_config.get('images'):
                images_data = provider_config['images']
                if isinstance(images_data, list):
                    for i, img_bytes in enumerate(images_data):
                        if isinstance(img_bytes, bytes):
                            # Assuming JPEG for now, or make mime_type configurable if needed
                            content_parts.append(genai_types.Part.from_bytes(data=img_bytes, mime_type='image/jpeg'))
                            logger.debug(f"Added image {i+1} to Gemini request parts.")
                        else:
                            logger.warning(f"Image data at index {i} is not bytes, skipping.")
                else:
                    logger.warning("'images' in provider_config is not a list, skipping image processing.")
            
            logger.debug(f"Calling Gemini model {self.model_name} with content (first 100 chars of text part): '{str(content_parts[0])[:100]}...'")
            if thinking_budget_value is not None:
                logger.debug(f"Gemini thinking_budget: {thinking_budget_value}")
            if images_data:
                 logger.debug(f"Gemini request includes {len(images_data)} images.")

            # --- Use config= parameter AND add 'models/' prefix --- 
            logger.debug(f"Calling generate_content with model, contents, and config object. Config keys: {list(gen_config_params.keys())}")
            try:
                response = client.models.generate_content(
                    model=f"models/{self.model_name}", # ADDED 'models/' prefix
                    contents=content_parts, 
                    config=generation_config_obj # Use the bundled config object
                )
                logger.info("generate_content succeeded using config= parameter.")
            except Exception as e:
                 logger.error(f"Error calling generate_content with config= parameter: {e}", exc_info=True)
                 # Optionally, try direct args as a last resort if config= fails?
                 # For now, just raise the error from the config= attempt.
                 raise RuntimeError(f"Gemini classification failed (API call error with config=): {e}") from e
            # --- End Call --- 
            
            logger.debug(f"Raw Gemini response text (first 100 chars): '{response.text[:100]}...'")

            # --- Restore Response Parsing Logic --- 
            parsed_object: Optional[BaseModel] = None
            if hasattr(response, 'parsed') and response.parsed:
                if isinstance(response.parsed, model_class):
                    parsed_object = response.parsed
                    logger.debug(f"Successfully used response.parsed from Gemini. Type: {type(parsed_object)}")
                else:
                    logger.warning(f"Gemini response.parsed was not of expected type {model_class.__name__}, but: {type(response.parsed)}. Attempting fallback.")
                    if response.text:
                        try:
                            parsed_object = model_class.model_validate_json(response.text)
                            logger.debug(f"Successfully parsed response.text as fallback from unexpected .parsed type. Type: {type(parsed_object)}")
                        except Exception as e_parse_fallback:
                            logger.error(f"Error parsing response.text as fallback: {e_parse_fallback}")
                            raise RuntimeError(f"Failed to parse Gemini response JSON (fallback): {e_parse_fallback}") from e_parse_fallback
            elif response.text:
                 logger.debug("Gemini response.parsed not available or suitable, attempting manual parsing from response.text.")
                 try:
                     parsed_object = model_class.model_validate_json(response.text)
                     logger.debug(f"Successfully parsed response.text from Gemini. Type: {type(parsed_object)}")
                 except Exception as e_parse:
                     logger.error(f"Error parsing response.text from Gemini: {e_parse}")
                     raise RuntimeError(f"Failed to parse Gemini response JSON: {e_parse}") from e_parse
            
            if not parsed_object:
                logger.error("Could not obtain parsed Pydantic object from Gemini response.")
                if hasattr(response, 'prompt_feedback'):
                    logger.error(f"Gemini Prompt Feedback: {response.prompt_feedback}")
                raise RuntimeError("Failed to obtain structured data from Gemini response.")

            return parsed_object.model_dump()
            # --- End Restore Response Parsing --- 

        except ValueError as ve: # Catch API key error specifically
            logger.error(f"ValueError in GeminiClassificationProvider: {str(ve)}")
            raise ve
        except Exception as e:
            logger.error(f"Gemini classification failed for model {model_class.__name__} (model: {self.model_name}): {str(e)}", exc_info=True)
            if hasattr(e, 'response') and hasattr(e.response, 'prompt_feedback'):
                 logger.error(f"Gemini Prompt Feedback on error: {e.response.prompt_feedback}")
            raise RuntimeError(f"Gemini classification failed: {str(e)}")


# Factory function updated
def get_classification_provider(
    provider: Optional[str] = None,  # Allow None
    model_name: Optional[str] = None, # Allow None
    api_key: Optional[str] = None    # ADDED api_key argument
) -> ClassificationProvider:
    """
    Factory function to create and return a configured ClassificationProvider instance.
    This allows for dependency injection in FastAPI routes or direct use in tasks.
    
    Args:
        provider: The AI provider name (e.g., "Google", "Gemini", "Ollama"). Defaults if None.
        model_name: The model name to use. Defaults if None.
        api_key: Optional API key to pass to the provider instance.
        
    Returns:
        A configured ClassificationProvider instance
    """
    # Determine defaults if arguments are None
    # Priority: Argument > Environment Variable > Hardcoded Default
    
    # Provider Defaulting
    final_provider = provider
    if not final_provider:
        if os.environ.get("LOCAL_LLM") == "True":
            final_provider = "ollama"
        else:
            final_provider = "Gemini" # NEW Default: Native Gemini
    
    # Model Defaulting (depends on provider)
    final_model_name = model_name
    if not final_model_name:
        provider_lower_for_default = final_provider.lower()
        if provider_lower_for_default == "ollama":
            final_model_name = os.environ.get("LOCAL_LLM_MODEL", "llama3.2:latest") # Ollama default
        elif provider_lower_for_default == "gemini":
             final_model_name = "gemini-2.5-flash-preview-04-17" # NEW default model
        else: # Includes "google" and any other fallback
             final_model_name = "gemini-2.0-flash" # OPOL/Google default

    provider_lower = final_provider.lower()
    logger.info(f"Attempting to get classification provider: '{provider_lower}' with model: '{final_model_name}'")

    if provider_lower == "gemini":
        # This is for the new native Gemini provider
        # Requires GOOGLE_API_KEY env var OR api_key arg
        # The provider itself checks for the key during classify
        if not api_key and not os.getenv("GOOGLE_API_KEY"):
             logger.warning("Gemini provider selected, but no API key provided via arg or GOOGLE_API_KEY env var. Classification will likely fail.")
        # We don't pass the key here; the provider handles it internally using the passed arg or env var.
        return GeminiClassificationProvider(model_name=final_model_name)
    
    elif provider_lower == "google":
        # This is the existing OPOL-based provider
        # Pass the *resolved* model name. Provider name is fixed to "Google" for fastclass setup.
        # The api_key is passed directly to the provider constructor/classify method.
        # OPOL Provider constructor doesn't take api_key, it uses it in classify.
        return OpolClassificationProvider(provider="Google", model_name=final_model_name)
    
    elif provider_lower == "ollama":
        # OPOL provider can handle Ollama if LOCAL_LLM is set, or directly via provider name.
        # No API key needed typically.
        return OpolClassificationProvider(provider="ollama", model_name=final_model_name)
    
    else:
        logger.warning(
            f"Unsupported classification provider type: '{final_provider}'. "
            f"Defaulting to 'Google' (OPOL-based) with model '{final_model_name}'."
        )
        # Default to OPOL/Google provider
        return OpolClassificationProvider(provider="Google", model_name=final_model_name) 