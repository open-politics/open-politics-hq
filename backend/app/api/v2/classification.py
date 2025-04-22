from fastapi import APIRouter, Query, Depends, HTTPException, Header
from typing import Optional, List, Dict, Any, Type, Literal
from pydantic import BaseModel, Field, create_model, conint, model_validator
import os
from datetime import datetime, timezone
# from sqlalchemy.orm import Session #Unnecessary import
# Remove old model imports if no longer needed directly in API endpoints here
from app.models import (
    ClassificationScheme,
    # Document, # Removed
    # ClassificationResult, # Results created by task
    # ClassificationResultRead, # Results created/read via different route
    FieldType,
    ClassificationField
)
from app.api.deps import SessionDep, CurrentUser # Keep if needed for other potential v2 routes
from app.core.db import engine  # Import the engine for potential session use in helpers
from sqlmodel import Session  # Import Session from sqlmodel
from sqlalchemy import select
from sqlalchemy.orm import joinedload, selectinload
from app.core.opol_config import opol, available_providers, get_fastclass

import logging
import traceback # Import traceback for detailed logging

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

# Keep router if other v2 endpoints exist or are planned
router = APIRouter()

@router.get("/available_providers")
async def get_providers():
    return available_providers

# Removed old /location_from_query example unless needed
# class RequestClassification(BaseModel): ...
# @router.get("/location_from_query") ...

### How to use opol fastclass
## Create a pydantic model for the classification
## Prompt and annotations will be fed to the LLM generating the response
## The response will be a pydantic model

# E.g. Populist Rehetoric
class PopulistRehetoric(BaseModel):
    """
    Definition: Populist rhetoric s a special type of political talk that divides the population 
    into two categories: pure, moral, and victimized people and a corrupt, malfunctioning elite. 

    Populism constructs fear and is related to the various real or imagined dangers posed 
    by "scapegoats" (LGBT people, minorities, feminists, marginalized groups) that are blamed 
    for threatening or damaging societies.
    """
    populist_rhetoric_used: int = Field(description="On a scale from 1-10, how much populist rhetoric is used in the text?")


## Which would be applied like this:
# classification = fastclass.classify(PopulistRehetoric, "", text)
# pop_score = classification.populist_rhetoric_used
# The "" empty string needs to be passed as second argument. It's useful to inject or override instructions

def generate_pydantic_model(scheme: ClassificationScheme) -> Type[BaseModel]:
    """Generates a Pydantic model dynamically based on ClassificationScheme fields."""
    field_definitions = {}
    
    # Ensure scheme has fields attribute and it's not None or empty
    # Use selectinload when fetching the scheme to ensure fields are loaded
    has_fields = hasattr(scheme, 'fields') and scheme.fields is not None and len(scheme.fields) > 0
    
    if not has_fields:
        # Create a simple model with a single text field if no fields are defined
        field_definitions["classification_output"] = (
            str,
            Field(description="Default text classification result as scheme has no fields.")
        )
    else:
        # Process each field in the scheme
        for field in scheme.fields:
            field_name = field.name # Use field.name directly
            field_description = field.description or f"Value for {field_name}"

            if field.type == FieldType.INT:
                # Ensure scale limits are integers if provided
                scale_min = int(field.scale_min) if field.scale_min is not None else None
                scale_max = int(field.scale_max) if field.scale_max is not None else None
                # Add validation rule for range if both min and max are defined
                if scale_min is not None and scale_max is not None:
                    field_definitions[field_name] = (
                         # Use float initially, allow LLM flexibility, validate later if strict int needed
                        float, # Changed to float to be more permissive for LLM
                        # conint(ge=scale_min, le=scale_max), # This is too strict for LLM sometimes
                        Field(description=f"{field_description} (Scale: {scale_min}-{scale_max})")
                    )
                else:
                     field_definitions[field_name] = (float, Field(description=field_description))

            elif field.type == FieldType.LIST_STR:
                if field.is_set_of_labels and field.labels:
                    # For selection from predefined labels
                    field_definitions[field_name] = (
                        List[str],
                        Field(
                            description=f"{field_description}. Select one or more from: {', '.join(field.labels)}",
                            # examples=[field.labels] # Example might confuse LLM
                        )
                    )
                else:
                    # For free-form lists
                    field_definitions[field_name] = (
                        List[str],
                        Field(description=field_description)
                    )
            elif field.type == FieldType.STR:
                # For free-form text input
                field_definitions[field_name] = (
                    str,
                    Field(description=field_description)
                )
            elif field.type == FieldType.LIST_DICT:
                 # Define the structure of the dict if dict_keys are provided
                if field.dict_keys:
                    dict_structure = {}
                    key_types = {FieldType.STR: str, FieldType.INT: int, FieldType.FLOAT: float, FieldType.BOOL: bool}
                    for key_def in field.dict_keys:
                        key_name = key_def.get('name')
                        key_type_str = key_def.get('type', 'str') # Default to string
                        key_type = key_types.get(key_type_str, str)
                        if key_name:
                            dict_structure[key_name] = (Optional[key_type], ...)
                    
                    InnerDictModel = create_model(f"{scheme.name}_{field_name}_DictItem", **dict_structure)
                    field_definitions[field_name] = (
                         List[InnerDictModel], 
                         Field(description=field_description)
                    )
                else:
                    # Fallback if no dict_keys defined
                    field_definitions[field_name] = (
                        List[Dict[str, Any]],
                        Field(description=f"{field_description} (List of dictionaries)")
                    )
    
    # Create the main model
    DynamicModel = create_model(
        f"Dynamic_{scheme.name.replace(' ', '')}" if scheme.name else "DynamicClassification",
        __doc__=scheme.model_instructions or scheme.description or "Classification Model",
        **field_definitions
    )
    
    # Add validators AFTER model creation if needed (e.g., for labels)
    # Pydantic v2 validators are often defined within the model or using decorators,
    # dynamically adding them post-creation is complex. Simpler to rely on LLM guidance.
    # Consider post-processing validation after getting the result if strict checks are needed.
    
    return DynamicModel

# --- Core Classification Logic (No longer an API endpoint) ---

def run_classification(text: str, scheme: ClassificationScheme, api_key: str | None = None) -> Dict[str, Any]:
    """
    Runs classification on the provided text using the given scheme.
    This is the core logic called by the background task.
    Assumes scheme object includes loaded fields.
    """
    if not text:
        logger.warning(f"Received empty text for classification with scheme {scheme.id}. Returning empty result.")
        # Return a structure matching what generate_pydantic_model would expect,
        # but with empty/null values.
        ModelClass = generate_pydantic_model(scheme)
        try:
            # Create an empty instance if possible (might fail for complex models)
            empty_instance = ModelClass.model_validate({})
            return empty_instance.model_dump()
        except Exception:
             # Fallback to just an empty dict if model validation fails
            return {}
            
    logger.debug(f"Running classification for scheme {scheme.id} ('{scheme.name}')")
    # Generate dynamic Pydantic model from the scheme
    try:
        ModelClass = generate_pydantic_model(scheme)
    except Exception as model_gen_err:
        logger.error(f"Failed to generate Pydantic model for scheme {scheme.id}: {model_gen_err}")
        raise ValueError(f"Model generation error for scheme {scheme.id}") from model_gen_err

    # Get OPOL fastclass instance
    # TODO: Get provider/model from scheme or job configuration if needed
    try:
        if os.environ.get("LOCAL_LLM") == "True":
             provider = "ollama"
             model_name = os.environ.get("LOCAL_LLM_MODEL", "llama3.2:latest")
             current_api_key = "" # Ollama doesn't typically use API keys
        else:
            # Use defaults or fetch from config/job
            provider = "Google" # Example default
            model_name = "gemini-2.0-flash" # Example default
            current_api_key = api_key # Use provided key or default
            
        fastclass = get_fastclass(
            provider=provider,
            model_name=model_name,
            api_key=current_api_key
        )
    except Exception as fastclass_err:
        logger.error(f"Failed to get fastclass instance: {fastclass_err}")
        raise ConnectionError("Failed to initialize classification service") from fastclass_err

    # Classify using OPOL
    try:
        logger.debug(f"Calling fastclass.classify for scheme {scheme.id}...")
        # Pass model instructions from scheme if they exist
        instructions = scheme.model_instructions or ""
        result = fastclass.classify(ModelClass, instructions, text)
        logger.debug(f"Classification successful for scheme {scheme.id}")
        # Return the validated & structured data as a dictionary
        return result.model_dump()
    except Exception as classification_err:
        # Log the specific error from the classification library
        logger.error(f"OPOL classification failed for scheme {scheme.id}: {classification_err}")
        # Re-raise a more generic error to be caught by the task
        raise RuntimeError(f"Classification failed: {classification_err}") from classification_err


# --- Helper Function (Used by Tasks) ---

def classify_text(text: str, scheme_id: int, api_key: str | None = None) -> Dict:
    """
    Fetches the scheme and runs classification.
    Called by background tasks.
    """
    try:
        with Session(engine) as session:
            # Get the classification scheme using session.get()
            scheme = session.get(ClassificationScheme, scheme_id)

            if not scheme:
                raise ValueError(f"Classification scheme with id {scheme_id} not found")

            # Ensure fields are loaded. session.get might lazy-load,
            # so explicitly refresh the relationship if needed.
            # Check if fields are already loaded (might be by session.get depending on context)
            if 'fields' not in scheme.__dict__:
                # If not loaded, refresh the relationship
                session.refresh(scheme, attribute_names=['fields'])
            # Alternatively, access scheme.fields once to trigger lazy loading (less explicit):
            # _ = scheme.fields 

            # Verify fields are loaded before passing to run_classification
            if not scheme.fields:
                # If still not loaded after refresh/access, log a warning.
                # run_classification has a fallback, but good to know.
                logger.warning(f"Scheme {scheme_id} fields appear empty after fetching.")

            # Now call the core logic function with the fetched scheme object
            return run_classification(text, scheme, api_key)

    except Exception as e:
        # Log the error and provide a more helpful message
        # --- MODIFIED LOGGING (Simpler) ---
        tb_str = traceback.format_exc()
        # logger.error(f"Error in classify_text helper for scheme {scheme_id}. Exception Type: {type(e).__name__}, Message: {str(e)}\nTraceback:\n{tb_str}")
        logger.error(f"CLASSIFY_TEXT ERROR (Scheme {scheme_id}):\n{tb_str}") # Log only traceback
        # --- END MODIFIED LOGGING ---
        # Re-raise the exception so the calling task can handle it (e.g., mark as error)
        raise

# --- Removed Old API Endpoints --- 

# Removed: @router.post("/{scheme_id}/classify/{document_id}") ...

# Removed: @router.post("/classify") ...
