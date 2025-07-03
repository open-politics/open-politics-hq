import logging
import os
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel

from app.core.opol_config import get_fastclass # Relies on global opol instance configured by settings
from app.api.providers.base import ClassificationProvider # Protocol
from app.api.providers.llm_config import llm_models_config

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

class OpolClassificationProvider(ClassificationProvider):
    """
    OPOL (via fastclass) implementation of the ClassificationProvider interface.
    """
    def __init__(
        self, 
        provider_for_fastclass: str, 
        model_name_for_fastclass: str, 
        api_key_for_fastclass: Optional[str] = None, # API key for the underlying model if OPOL passes it through
        ollama_base_url: Optional[str] = None, # Specific for Ollama via OPOL
        opol_mode: Optional[str] = None, # OPOL's own mode, if its initialization changes
        opol_api_key: Optional[str] = None # OPOL's own API key, if it has one separate from model keys
    ):
        """
        Initialize the OPOL classification provider wrapper.

        Args:
            provider_for_fastclass: The name of the provider OPOL's fastclass should use (e.g., "Google", "Ollama").
            model_name_for_fastclass: The model name for OPOL's fastclass.
            api_key_for_fastclass: API key for the underlying LLM service if OPOL requires it explicitly here.
            ollama_base_url: Base URL for Ollama if provider_for_fastclass is "Ollama".
            opol_mode: OPOL library operating mode (e.g., "direct", "container"). (Note: global opol instance uses settings.OPOL_MODE)
            opol_api_key: API key for OPOL platform itself, if applicable.
        """
        self.provider_for_fastclass = provider_for_fastclass
        self.model_name_for_fastclass = model_name_for_fastclass
        self.api_key_for_fastclass = api_key_for_fastclass
        self.ollama_base_url = ollama_base_url 
        # self.opol_mode = opol_mode # Not stored if global opol instance is used
        # self.opol_api_key = opol_api_key # Not stored if global opol instance is used

        logger.info(f"OpolClassificationProvider initialized to use fastclass with provider: '{self.provider_for_fastclass}', model: '{self.model_name_for_fastclass}'.")
        if self.provider_for_fastclass.lower() == "ollama" and self.ollama_base_url:
             logger.info(f"Ollama base URL for OPOL: {self.ollama_base_url}")
        # The global `opol` instance from `opol_config` is configured using `settings.OPOL_MODE` and `settings.OPOL_API_KEY`.
        # `get_fastclass` uses this global `opol` instance.

    async def classify(self, 
                 text_content: Optional[str], 
                 output_model_class: Type[BaseModel], 
                 instructions: Optional[str] = None,
                 provider_config: Optional[Dict[str, Any]] = None,
                 api_key_override: Optional[str] = None # API key for the underlying model (passed to fastclass)
                ) -> Dict[str, Any]:
        """
        Classify text using OPOL's fastclass.
        `provider_config` can include 'model_name_override' and potentially 'thinking_budget' (conceptual).
        `media_inputs` in `provider_config` will be logged as a warning as fastclass typically expects text.
        `api_key_override` is for the underlying LLM if fastclass needs it explicitly.
        """
        if not text_content and not (provider_config and provider_config.get('media_inputs')):
            logger.warning("OpolClassificationProvider received no text_content and no media_inputs. Returning empty result.")
            # If media_inputs were present but text_content is None, we might still proceed if fastclass could handle it.
            # However, fastclass is primarily text-based. For now, require text_content if no media_inputs for OPOL.
            if not text_content: # Double check to be explicit for this path
                return {}

        current_model_name = self.model_name_for_fastclass
        if provider_config and provider_config.get("model_name_override"):
            current_model_name = provider_config["model_name_override"]
            logger.info(f"OPOL Provider using model_name_override: {current_model_name}")
        
        effective_llm_api_key = api_key_override if api_key_override is not None else self.api_key_for_fastclass

        fc_instance = get_fastclass(
            provider=self.provider_for_fastclass,
            model_name=current_model_name,
            api_key=effective_llm_api_key,
            # Pass ollama_base_url if fc_instance needs it directly; 
            # otherwise, it's assumed to be configured globally for OPOL if provider is Ollama.
            ollama_base_url=self.ollama_base_url if self.provider_for_fastclass.lower() == "ollama" else None
        )

        prompt_instructions = instructions or ""
        
        if provider_config and provider_config.get('thinking_budget') is not None:
            logger.info(f"OPOL Provider: 'thinking_budget': {provider_config['thinking_budget']} requested. Ensure instructions prompt for reasoning.")
        
        media_inputs: Optional[List[Dict[str, Any]]] = provider_config.get('media_inputs') if provider_config else None
        final_text_for_fastclass = text_content or "" # Default to empty string if text_content is None

        if media_inputs and isinstance(media_inputs, list):
            logger.warning("OpolClassificationProvider (fastclass) received 'media_inputs'. Fastclass primarily processes text. Media information will be textually represented in the prompt if possible.")
            media_references_for_prompt = []
            for i, media_item in enumerate(media_inputs):
                media_uuid = media_item.get('uuid', f'media_{i+1}')
                media_filename = media_item.get('original_filename', f'media_file_{i+1}')
                media_kind = media_item.get('kind', 'unknown')
                media_references_for_prompt.append(f"- Associated Media {i+1}: (Kind: {media_kind}, UUID: {media_uuid}, Filename: {media_filename})")
            
            if media_references_for_prompt:
                media_section = "\n\n--- Associated Media (References Only): ---\n" + "\n".join(media_references_for_prompt)
                if final_text_for_fastclass: # Append to existing text
                    final_text_for_fastclass += media_section
                else: # If no original text_content, this becomes the main text
                    final_text_for_fastclass = media_section
                if not instructions and final_text_for_fastclass: # If only media refs, add a generic instruction
                    prompt_instructions = "Analyze the provided media references." 
        
        if not final_text_for_fastclass and not prompt_instructions:
            logger.error("OpolClassificationProvider: No text content or instructions available to send to fastclass after processing inputs.")
            return {} # Cannot proceed if everything is empty

        try:
            logger.debug(f"Calling OPOL fastclass.classify with model_class: {output_model_class.__name__}, instructions (prefix): '{prompt_instructions[:50]}...', text (prefix): '{final_text_for_fastclass[:50]}...'")
            result = fc_instance.classify(output_model_class, prompt_instructions, final_text_for_fastclass)
            
            if isinstance(result, BaseModel):
                return result.model_dump()
            elif isinstance(result, dict):
                logger.warning(f"OPOL fastclass returned a dict, not a Pydantic model instance for {output_model_class.__name__}. Returning as is.")
                return result
            else:
                logger.error(f"OPOL fastclass returned an unexpected type: {type(result)} for {output_model_class.__name__}. Content: {str(result)[:200]}")
                raise RuntimeError(f"OPOL fastclass classification returned an unexpected type: {type(result)}.")

        except Exception as e:
            logger.error(f"OPOL fastclass classification failed for model_class {output_model_class.__name__} (provider: {self.provider_for_fastclass}, model: {current_model_name}): {str(e)}", exc_info=True)
            raise RuntimeError(f"OPOL (fastclass) classification failed: {str(e)}") from e
    
    def get_model_capabilities(self) -> Dict[str, Any]:
        """Get capabilities of the current model from the LLM config."""
        try:
            # Map provider names to config names
            provider_map = {
                "Google": "gemini",
                "OpenAI": "openai", 
                "Ollama": "ollama"
            }
            
            config_provider = provider_map.get(self.provider_for_fastclass, self.provider_for_fastclass.lower())
            model_config = llm_models_config.get_model_config(config_provider, self.model_name_for_fastclass)
            
            if model_config:
                return {
                    "supports_multimodal": False,  # OPOL/fastclass is primarily text-based
                    "supports_structured_output": True,  # OPOL supports structured output
                    "supports_thinking": model_config.get("supports_thinking", False),
                    "max_tokens": model_config.get("max_tokens"),
                    "context_length": model_config.get("context_length"),
                    "model_name": self.model_name_for_fastclass,
                    "provider": f"opol_{self.provider_for_fastclass.lower()}"
                }
        except Exception as e:
            logger.warning(f"Could not get model capabilities from config: {e}")
        
        # Fallback capabilities
        return {
            "supports_multimodal": False,
            "supports_structured_output": True,
            "supports_thinking": False,
            "max_tokens": 4096,
            "context_length": 32768,
            "model_name": self.model_name_for_fastclass,
            "provider": f"opol_{self.provider_for_fastclass.lower()}"
        } 