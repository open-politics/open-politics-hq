"""
Concrete implementations of classification providers.
"""
import logging
from typing import Any, Dict, List, Optional, Type

from pydantic import BaseModel, Field, create_model
from pydantic.fields import FieldInfo

from app.core.opol_config import get_fastclass
from app.models import ClassificationScheme, FieldType
from app.api.services.providers.base import ClassificationProvider

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
    
    def _generate_pydantic_model(self, model_spec: Dict[str, Any]) -> Type[BaseModel]:
        """
        Dynamically generate a Pydantic model based on the model specification.
        
        Args:
            model_spec: Dictionary containing model field definitions
            
        Returns:
            A Pydantic model class
        """
        field_definitions = {}
        
        # Handle direct schema definitions
        if "fields" in model_spec:
            fields = model_spec["fields"]
            for field in fields:
                field_name = field.get("name")
                if not field_name:
                    continue
                    
                field_description = field.get("description", f"Value for {field_name}")
                field_type = field.get("type", "str")
                
                if field_type == "int" or field_type == FieldType.INT:
                    scale_min = field.get("scale_min")
                    scale_max = field.get("scale_max")
                    field_definitions[field_name] = (
                        float,  # Use float for flexibility with LLM
                        Field(description=f"{field_description} (Scale: {scale_min}-{scale_max})")
                    )
                elif field_type == "list_str" or field_type == FieldType.LIST_STR:
                    labels = field.get("labels", [])
                    if field.get("is_set_of_labels") and labels:
                        field_definitions[field_name] = (
                            List[str],
                            Field(
                                description=f"{field_description}. Select one or more from: {', '.join(labels)}",
                            )
                        )
                    else:
                        field_definitions[field_name] = (
                            List[str],
                            Field(description=field_description)
                        )
                elif field_type == "str" or field_type == FieldType.STR:
                    field_definitions[field_name] = (
                        str,
                        Field(description=field_description)
                    )
                elif field_type == "list_dict" or field_type == FieldType.LIST_DICT:
                    dict_keys = field.get("dict_keys", [])
                    if dict_keys:
                        # Create a nested model for the dictionary structure
                        dict_fields = {}
                        for key_def in dict_keys:
                            key_name = key_def.get("name")
                            key_type_str = key_def.get("type", "str")
                            if key_name:
                                if key_type_str == "str":
                                    dict_fields[key_name] = (Optional[str], ...)
                                elif key_type_str == "int":
                                    dict_fields[key_name] = (Optional[int], ...)
                                elif key_type_str == "float":
                                    dict_fields[key_name] = (Optional[float], ...)
                                elif key_type_str == "bool":
                                    dict_fields[key_name] = (Optional[bool], ...)
                                    
                        InnerDictModel = create_model(
                            f"DictItem_{field_name}", 
                            **dict_fields
                        )
                        field_definitions[field_name] = (
                            List[InnerDictModel],
                            Field(description=field_description)
                        )
                    else:
                        field_definitions[field_name] = (
                            List[Dict[str, Any]],
                            Field(description=field_description)
                        )
        
        # If no fields defined, use a simple text output field
        if not field_definitions:
            field_definitions["classification_output"] = (
                str,
                Field(description="Classification result")
            )
        
        # Create the dynamic model
        model_name = model_spec.get("name", "DynamicClassification")
        model_doc = model_spec.get("instructions", model_spec.get("description", "Classification Model"))
        
        DynamicModel = create_model(
            f"Dynamic_{model_name.replace(' ', '')}",
            __doc__=model_doc,
            **field_definitions
        )
        
        return DynamicModel
    
    def _prepare_model_from_scheme(self, scheme: ClassificationScheme) -> Type[BaseModel]:
        """
        Prepare a Pydantic model from a ClassificationScheme.
        
        Args:
            scheme: The ClassificationScheme to convert
            
        Returns:
            A Pydantic model class
        """
        model_spec = {
            "name": scheme.name,
            "description": scheme.description,
            "instructions": scheme.model_instructions,
            "fields": []
        }
        
        if hasattr(scheme, 'fields') and scheme.fields:
            for field in scheme.fields:
                field_dict = {
                    "name": field.name,
                    "description": field.description,
                    "type": field.type,
                    "scale_min": field.scale_min,
                    "scale_max": field.scale_max,
                    "is_set_of_labels": field.is_set_of_labels,
                    "labels": field.labels,
                    "dict_keys": field.dict_keys
                }
                model_spec["fields"].append(field_dict)
        
        return self._generate_pydantic_model(model_spec)
    
    def classify(self, text: str, model_spec: Dict[str, Any], 
                instructions: Optional[str] = None) -> Dict[str, Any]:
        """
        Classify text according to the given model specification.
        
        Args:
            text: The text to classify
            model_spec: Dictionary specifying the model format or a ClassificationScheme
            instructions: Optional additional instructions to guide the classification
            
        Returns:
            Classification results as a dictionary
        """
        if not text:
            logger.warning("Received empty text for classification. Returning empty result.")
            return {}
        
        try:
            # Get API key from model_spec if provided
            api_key = model_spec.get("api_key")
            
            # Initialize the classification client
            fastclass = get_fastclass(
                provider=self.provider,
                model_name=self.model_name,
                api_key=api_key
            )
            
            # Prepare the model
            if isinstance(model_spec, ClassificationScheme):
                # If passed a ClassificationScheme directly
                ModelClass = self._prepare_model_from_scheme(model_spec)
                instructions = model_spec.model_instructions or instructions
            else:
                # If passed a model specification dictionary
                ModelClass = self._generate_pydantic_model(model_spec)
            
            # Perform the classification
            result = fastclass.classify(ModelClass, instructions or "", text)
            return result.model_dump()
            
        except Exception as e:
            logger.error(f"Classification failed: {str(e)}", exc_info=True)
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