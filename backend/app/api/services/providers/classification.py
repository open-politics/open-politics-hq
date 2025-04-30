"""
Concrete implementations of classification providers.
"""
import logging
import os # Import os for environment variables
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, Field, create_model
from pydantic.fields import FieldInfo

from app.core.opol_config import get_fastclass
from app.models import ClassificationScheme, FieldType
from app.api.services.providers.base import ClassificationProvider
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
                 api_key: Optional[str] = None) -> Dict[str, Any]:
        """
        Classify text using the provided Pydantic model and OPOL.

        Args:
            text: The text to classify.
            model_class: The dynamically generated Pydantic model class representing the scheme.
            instructions: Optional instructions for the classification model (usually from the scheme).
            api_key: Optional API key for the provider.

        Returns:
            Classification results as a dictionary.
        """
        if not text:
            logger.warning("Provider received empty text. Returning empty result.")
            return {}

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


# Factory function moved here
def get_classification_provider(
    provider: str = "Google",
    model_name: str = "gemini-2.0-flash"
) -> ClassificationProvider:
    """
    Factory function to create and return a configured ClassificationProvider instance.
    This allows for dependency injection in FastAPI routes.
    
    Args:
        provider: The AI provider to use
        model_name: The model name to use
        
    Returns:
        A configured ClassificationProvider instance
    """
    return OpolClassificationProvider(provider=provider, model_name=model_name) 