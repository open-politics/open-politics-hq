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
    
    # --- ADDED LOGGING INSIDE generate_pydantic_model ---
    fields_attr = getattr(scheme, 'fields', '[FIELDS_ATTRIBUTE_MISSING]')
    fields_len = len(fields_attr) if isinstance(fields_attr, list) else -1
    logger.error(f"[generate_pydantic_model] Checking scheme {scheme.id}. Has 'fields' attr? {hasattr(scheme, 'fields')}. Fields value type: {type(fields_attr)}. Fields len: {fields_len}")
    # --- END LOGGING ---
    
    # Ensure scheme has fields attribute and it's not None or empty
    # Use selectinload when fetching the scheme to ensure fields are loaded
    has_fields = hasattr(scheme, 'fields') and scheme.fields is not None and len(scheme.fields) > 0
    
    # --- ADDED LOGGING INSIDE generate_pydantic_model ---
    logger.error(f"[generate_pydantic_model] Scheme {scheme.id}: 'has_fields' evaluated to: {has_fields}")
    # --- END LOGGING ---
    
    if not has_fields:
        # --- ADDED LOGGING INSIDE generate_pydantic_model ---
        logger.error(f"[generate_pydantic_model] Scheme {scheme.id}: No fields found or loaded. Creating default 'classification_output' model.")
        # --- END LOGGING ---
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

# --- Removed Core Classification Logic ---
# def run_classification(...) -> Dict[str, Any]: ...

# --- Removed Helper Function ---
# def classify_text(...) -> Dict: ...

# --- Removed Old API Endpoints ---
# Removed: @router.post("/{scheme_id}/classify/{document_id}") ...
# Removed: @router.post("/classify") ...
