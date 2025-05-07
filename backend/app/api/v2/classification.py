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

import traceback # Import traceback for detailed logging
import enum # Added for dynamic enum creation
import re # Added for creating valid Python identifiers for Enum names

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
    into two categories: pure, moral, victimized people and a corrupt, malfunctioning elite. 

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
    
    has_fields = hasattr(scheme, 'fields') and scheme.fields is not None and len(scheme.fields) > 0
    
    if not has_fields:
        field_definitions["classification_output"] = (
            str,
            Field(description="Default text classification result as scheme has no fields.")
        )
    else:
        # Process each field in the scheme
        for field_model in scheme.fields: # field_model is ClassificationField instance
            field_name = field_model.name
            field_description = field_model.description or f"Value for {field_name}"

            # Determine if justification is requested for this field
            field_requests_justification = False
            if field_model.request_justification is True:
                field_requests_justification = True
            elif field_model.request_justification is None and scheme.request_justifications_globally is True:
                field_requests_justification = True

            pydantic_field_type: Any = None
            pydantic_field_args = {"description": field_description}

            if field_model.type == FieldType.INT:
                pydantic_field_type = float # Use float for LLM flexibility, validate later
                scale_min = int(field_model.scale_min) if field_model.scale_min is not None else None
                scale_max = int(field_model.scale_max) if field_model.scale_max is not None else None
                if scale_min is not None and scale_max is not None:
                    # Forcing conint can be too strict for LLMs.
                    # Description guidance is often better.
                    pydantic_field_args["description"] = f"{field_description} (Numeric value, ideally integer between {scale_min}-{scale_max})"
                else:
                    pydantic_field_args["description"] = f"{field_description} (Numeric value, ideally integer)"

            elif field_model.type == FieldType.LIST_STR:
                if field_model.is_set_of_labels and field_model.labels and field_model.use_enum_for_labels:
                    # Create a dynamic Enum for the labels
                    # Sanitize scheme and field names for Enum class name
                    sanitized_scheme_name = re.sub(r'\W|^(?=\d)', '', scheme.name.replace(' ', ''))
                    sanitized_field_name = re.sub(r'\W|^(?=\d)', '', field_name.replace(' ', ''))
                    enum_name = f"{sanitized_scheme_name}_{sanitized_field_name}_LabelEnum"
                    
                    # Ensure labels are valid enum members (string, no weird chars for names)
                    # Enum values can be the labels themselves. Enum *names* must be valid identifiers.
                    # We will use the labels as values. The names can be generated or also be the labels if valid.
                    label_map = {label.upper().replace(' ', '_').replace('-', '_').replace(r'[^A-Z0-9_]', ''): label for label in field_model.labels}
                    # Filter out empty names that might result from sanitization
                    label_map = {k: v for k, v in label_map.items() if k}

                    if not label_map:
                         pydantic_field_type = List[str]
                         pydantic_field_args["description"] = f"{field_description}. Select one or more. Available options: {', '.join(field_model.labels or [])}"
                    else:
                        try:
                            DynamicEnum = enum.Enum(enum_name, label_map)
                            pydantic_field_type = List[DynamicEnum]
                            pydantic_field_args["description"] = f"{field_description}. Select one or more from the predefined labels."
                        except Exception as e:
                            pydantic_field_type = List[str]
                            pydantic_field_args["description"] = f"{field_description}. Select one or more. Available options: {', '.join(field_model.labels or [])}"
                elif field_model.is_set_of_labels and field_model.labels:
                     pydantic_field_type = List[str]
                     pydantic_field_args["description"] = f"{field_description}. Select one or more from: {', '.join(field_model.labels)}"
                else:
                    pydantic_field_type = List[str]
            
            elif field_model.type == FieldType.STR:
                pydantic_field_type = str
            
            elif field_model.type == FieldType.LIST_DICT:
                if field_model.dict_keys:
                    dict_structure = {}
                    key_types_map = {'str': str, 'int': int, 'float': float, 'bool': bool}
                    for key_def_obj in field_model.dict_keys: # This is List[DictKeyDefinition]
                        # In models.py, dict_keys is defined as Optional[List[Dict[str, str]]] for DB
                        # But in ClassificationFieldCreate, it's Optional[List[DictKeyDefinition]]
                        # Assuming field_model.dict_keys here is List[DictKeyDefinition] as per Create model logic used for scheme building
                        key_name = key_def_obj.name
                        key_type_literal = key_def_obj.type # Literal['str', 'int', 'float', 'bool']
                        actual_key_type = key_types_map.get(key_type_literal, str)
                        dict_structure[key_name] = (Optional[actual_key_type], ...) # All dict keys are optional
                    
                    sanitized_scheme_name = re.sub(r'\W|^(?=\d)', '', scheme.name.replace(' ', ''))
                    sanitized_field_name = re.sub(r'\W|^(?=\d)', '', field_name.replace(' ', ''))
                    InnerDictModel = create_model(f"{sanitized_scheme_name}_{sanitized_field_name}_DictItem", **dict_structure)
                    pydantic_field_type = List[InnerDictModel]
                else:
                    pydantic_field_type = List[Dict[str, Any]]
                    pydantic_field_args["description"] = f"{field_description} (List of dictionaries with flexible structure)"

            if pydantic_field_type is None: # Fallback if type wasn't set
                pydantic_field_type = str

            field_definitions[field_name] = (pydantic_field_type, Field(**pydantic_field_args))

            # Add justification field if requested
            if field_requests_justification:
                justification_field_name = f"{field_name}_justification"
                field_definitions[justification_field_name] = (
                    Optional[str],
                    Field(description=f"Justification or reasoning for the value provided for '{field_name}'.")
                )

            # Add bounding_boxes field if requested and global image analysis is on
            if field_model.request_bounding_boxes and scheme.enable_image_analysis_globally:
                boxes_field_name = f"{field_name}_boxes"
                # Bounding box format: [ymin, xmin, ymax, xmax] normalized to 0-1000
                # So, a list of such lists if multiple objects contribute to the field's value
                field_definitions[boxes_field_name] = (
                    Optional[List[List[conint(ge=0, le=1000)]]], # List of 4-integer lists
                    Field(description=f"Bounding boxes related to '{field_name}'. Each box is [ymin, xmin, ymax, xmax] normalized to 0-1000.")
                    )
    
    # Create the main model
    model_docstring = scheme.model_instructions or scheme.description or "Classification Model"
    # Sanitize scheme name for Pydantic model name
    sanitized_model_name_base = re.sub(r'\W|^(?=\d)', '', scheme.name.replace(' ', '')) if scheme.name else "Classification"
    DynamicModel = create_model(
        f"Dynamic_{sanitized_model_name_base}_{scheme.id}", # Ensure unique model name
        __doc__=model_docstring,
        **field_definitions
    )
    
    return DynamicModel

# --- Removed Core Classification Logic ---
# def run_classification(...) -> Dict[str, Any]: ...

# --- Removed Helper Function ---
# def classify_text(...) -> Dict: ...

# --- Removed Old API Endpoints ---
# Removed: @router.post("/{scheme_id}/classify/{document_id}") ...
# Removed: @router.post("/classify") ...
