from fastapi import APIRouter, Query, Depends, HTTPException, Header
from typing import Optional, List, Dict, Any, Type, Literal
from pydantic import BaseModel, Field, create_model, conint, model_validator
import os
from datetime import datetime, timezone
# from sqlalchemy.orm import Session #Unnecessary import
from app.models import ClassificationScheme, Document, ClassificationResult, ClassificationResultRead, FieldType, ClassificationField
from app.api.deps import SessionDep, CurrentUser
from app.core.db import engine  # Import the engine
from sqlmodel import Session  # Import Session from sqlmodel
from sqlalchemy import select
from sqlalchemy.orm import joinedload
from app.core.opol_config import opol, available_providers, get_fastclass


router = APIRouter()

@router.get("/available_providers")
async def  get_providers():
    return available_providers

class RequestClassification(BaseModel):
    """
    Query to get the classification of the query
    """
    query: str

@router.get("/location_from_query")
async def get_location_from_query(query: str):
    
    class QueryLocation(BaseModel):
        """
        Location most relevant to the query
        """
        location: str

    fastclass = get_fastclass()
    location = fastclass.classify(QueryLocation, "Location most relevant to the query", query)

    coordinates, location_type, bbox, area = opol.geo.code(location)

    return {
        "location": location,
        "coordinates": coordinates,
        "location_type": location_type,
        "bbox": bbox,
        "area": area
    }

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
    field_definitions = {}
    
    # Ensure scheme has fields attribute and it's not None or empty
    has_fields = hasattr(scheme, 'fields') and scheme.fields is not None and len(scheme.fields) > 0
    
    if not has_fields:
        # Create a simple model with a single text field if no fields are defined
        field_definitions["text"] = (
            str,
            Field(description="Text classification result")
        )
    else:
        # Process each field in the scheme
        for field in scheme.fields:
            if field.type == FieldType.INT:
                field_definitions[field.name] = (
                    conint(ge=field.scale_min, le=field.scale_max),
                    Field(description=f"Scale from {field.scale_min} to {field.scale_max}")
                )
            elif field.type == FieldType.LIST_STR:
                if field.is_set_of_labels and field.labels:
                    # For selection from predefined labels
                    field_definitions[field.name] = (
                        List[str],
                        Field(
                            description=f"Select from: {', '.join(field.labels)}",
                            examples=[field.labels],
                            max_items=field.max_labels if hasattr(field, 'max_labels') and field.max_labels else None
                        )
                    )
                else:
                    # For free-form lists
                    field_definitions[field.name] = (
                        List[str],
                        Field(
                            description=field.description,
                            max_items=field.max_labels if hasattr(field, 'max_labels') and field.max_labels else None
                        )
                    )
            elif field.type == FieldType.STR:
                # For free-form text input
                field_definitions[field.name] = (
                    str, 
                    Field(description=field.description)
                )
            elif field.type == FieldType.LIST_DICT:
                field_definitions[field.name] = (
                    List[Dict[str, Any]], 
                    Field(description=field.description)
                )
    
    # Create the model with the field definitions
    model = create_model(
        scheme.name or "DefaultClassification",
        __doc__=scheme.model_instructions or scheme.description or "Default classification model",
        **field_definitions
    )
    
    # Add validators for fields with labels
    if has_fields:
        for field in scheme.fields:
            if field.type == FieldType.LIST_STR and field.is_set_of_labels and field.labels:
                def create_validator(field_name, valid_labels):
                    @model_validator(mode='before')
                    def validate_labels(cls, values):
                        value = values.get(field_name)
                        if value:
                            invalid_labels = [v for v in value if v not in valid_labels]
                            if invalid_labels:
                                raise ValueError(
                                    f"Invalid labels: {', '.join(invalid_labels)}. "
                                    f"Must be from: {', '.join(valid_labels)}"
                                )
                        return values
                    return validate_labels
                
                setattr(model, f'validate_{field.name}', create_validator(field.name, field.labels))
    
    return model

@router.post("/{scheme_id}/classify/{document_id}")
async def classify_document(
    scheme_id: int,
    document_id: int,
    session: SessionDep,
    current_user: CurrentUser,
    x_api_key: str | None = Header(None, alias="X-API-Key"),
    provider: str | None = Query("Google"),
    model: str | None = Query("gemini-2.0-flash"),
    run_id: int | None = None,
    run_name: str | None = None,
    run_description: str | None = None
) -> ClassificationResultRead:
    scheme = session.get(ClassificationScheme, scheme_id)
    document = session.get(Document, document_id)
    
    # Check for existing result with the same run_id
    if run_id:
        existing_result = session.exec(
            select(ClassificationResult)
            .where(
                ClassificationResult.document_id == document_id,
                ClassificationResult.scheme_id == scheme_id,
                ClassificationResult.run_id == run_id
            )
        ).first()
        
        if existing_result:
            return ClassificationResultRead.model_validate(existing_result)
    
    # Generate dynamic Pydantic model
    ModelClass = generate_pydantic_model(scheme)
    
    # Get fastclass instance with provided API key
    if os.environ["LOCAL_LLM"] == "True":
        fastclass = opol.classification(
            provider="ollama", 
            model_name=os.environ.get("LOCAL_LLM_MODEL", "llama3.2:latest"), 
            llm_api_key=""
        )
    else:
        fastclass = get_fastclass(
            provider=provider,
            model_name=model,
            api_key=x_api_key
        )

    # Classify using OPOL
    result = fastclass.classify(ModelClass, "", document.text_content)
    
    # Store result
    classification_result = ClassificationResult(
        document_id=document_id,
        scheme_id=scheme_id,
        value=result.model_dump(),
        timestamp=datetime.now(timezone.utc),
        run_id=run_id,
        run_name=run_name,
        run_description=run_description
    )
    
    session.add(classification_result)
    session.commit()
    session.refresh(classification_result)
    
    return ClassificationResultRead.model_validate(classification_result)

def classify_text(text: str, scheme_id: int, x_api_key: str | None = Header(None, alias="X-API-Key")) -> Dict:
    try:
        with Session(engine) as session:
            # Get the classification scheme with its fields
            statement = select(ClassificationScheme).where(
                ClassificationScheme.id == scheme_id
            ).options(
                joinedload(ClassificationScheme.fields)
            )
            scheme = session.exec(statement).first()
            
            if not scheme:
                raise HTTPException(status_code=404, detail=f"Classification scheme with id {scheme_id} not found")
            
            # Check if scheme has fields attribute before accessing it
            has_fields = hasattr(scheme, 'fields') and scheme.fields is not None
            
            # If fields attribute is missing, try to load it explicitly
            if not has_fields:
                print(f"Fields attribute missing, trying to load fields explicitly for scheme {scheme_id}")
                # Get fields directly
                fields_statement = select(ClassificationField).where(
                    ClassificationField.scheme_id == scheme_id
                )
                field_rows = session.exec(fields_statement).all()
                
                # Since we can't modify the scheme object directly (it's a SQLAlchemy Row),
                # we'll create a new ClassificationScheme instance with the same data
                # Use getattr with default values to handle missing attributes
                scheme_data = {}
                
                # Try to access attributes safely
                try:
                    scheme_data["id"] = scheme_id  # Use the provided scheme_id instead of trying to access scheme.id
                    scheme_data["name"] = getattr(scheme, 'name', f"Scheme {scheme_id}")
                    scheme_data["description"] = getattr(scheme, 'description', f"Description for scheme {scheme_id}")
                    scheme_data["model_instructions"] = getattr(scheme, 'model_instructions', None)
                    scheme_data["validation_rules"] = getattr(scheme, 'validation_rules', None)
                    scheme_data["workspace_id"] = getattr(scheme, 'workspace_id', 1)  # Default to workspace 1
                    scheme_data["user_id"] = getattr(scheme, 'user_id', 1)  # Default to user 1
                    scheme_data["created_at"] = getattr(scheme, 'created_at', datetime.now(timezone.utc))
                    scheme_data["updated_at"] = getattr(scheme, 'updated_at', datetime.now(timezone.utc))
                except Exception as attr_error:
                    print(f"Error accessing scheme attributes: {attr_error}")
                    # If we can't access attributes, create minimal data
                    scheme_data = {
                        "id": scheme_id,
                        "name": f"Scheme {scheme_id}",
                        "description": f"Description for scheme {scheme_id}",
                        "workspace_id": 1,
                        "user_id": 1,
                        "created_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc)
                    }
                
                # Create a new scheme instance
                scheme = ClassificationScheme(**scheme_data)
                
                # Create proper ClassificationField instances from the raw data
                fields = []
                for field_row in field_rows:
                    try:
                        field_data = {
                            "id": getattr(field_row, 'id', None),
                            "scheme_id": scheme_id,
                            "name": getattr(field_row, 'name', 'default_field'),
                            "description": getattr(field_row, 'description', ''),
                            "type": getattr(field_row, 'type', FieldType.STR),
                            "scale_min": getattr(field_row, 'scale_min', None),
                            "scale_max": getattr(field_row, 'scale_max', None),
                            "is_set_of_labels": getattr(field_row, 'is_set_of_labels', None),
                            "labels": getattr(field_row, 'labels', None),
                            "dict_keys": getattr(field_row, 'dict_keys', None),
                        }
                        fields.append(ClassificationField(**field_data))
                    except Exception as field_error:
                        print(f"Error creating field from row: {field_error}")
                
                # Set the fields on the scheme
                scheme.fields = fields
                has_fields = len(fields) > 0
            
            # Check if scheme has fields, but don't raise an error - we'll create a default model if needed
            if not has_fields or len(scheme.fields) == 0:
                print(f"Warning: Classification scheme with id {scheme_id} has no fields defined. Using default model.")
            
            # Generate dynamic Pydantic model
            ModelClass = generate_pydantic_model(scheme)
            
            # Get fastclass instance with provided API key
            fastclass = get_fastclass(x_api_key)
            
            # Classify using OPOL
            result = fastclass.classify(ModelClass, "", text)
            
            # Return the raw model dump to preserve structure
            return result.model_dump()
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Log the error and provide a more helpful message
        print(f"Error in classify_text: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")

@router.post("/classify")
async def classify(text: str, scheme_id: int, x_api_key: str | None = Header(None, alias="X-API-Key")):
    return classify_text(text, scheme_id, x_api_key)
