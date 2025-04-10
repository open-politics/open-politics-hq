from fastapi import APIRouter, Depends, HTTPException, Query
from sqlmodel import Session, select
from typing import List, Optional, Union, Dict, Any
from datetime import datetime, timezone
from sqlalchemy.orm import joinedload
from pydantic import BaseModel, model_validator, Field
import time

from app.models import (
    ClassificationResult,
    ClassificationResultCreate,
    ClassificationResultRead,
    EnhancedClassificationResultRead,
    Document,
    DocumentRead,
    ClassificationScheme,
    ClassificationSchemeRead,
    Workspace,
    ClassificationField,
    FieldType
)
from app.api.deps import SessionDep, CurrentUser
from app.api.v2.classification import classify_text 

router = APIRouter(
    prefix="/workspaces/{workspace_id}/classification_results",
    tags=["ClassificationResults"]
)

@router.post("", response_model=ClassificationResultRead)
def create_classification_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    result_in: ClassificationResultCreate
) -> ClassificationResultRead:
    """
    Create (store) an individual classification result.
    Verifies that the workspace exists and that the referenced document and scheme belong to that workspace.
    """
    # Check workspace permission
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    # Retrieve and validate document
    document = session.get(Document, result_in.document_id)
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Document not found in this workspace")
    
    # Retrieve and validate scheme with eager loading of fields
    scheme_stmt = select(ClassificationScheme).where(
        ClassificationScheme.id == result_in.scheme_id
    ).options(
        joinedload(ClassificationScheme.fields)
    )
    scheme = session.exec(scheme_stmt).first()
    
    if not scheme or scheme.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Classification scheme not found in this workspace")
    
    # Check if scheme has fields attribute before accessing it
    has_fields = hasattr(scheme, 'fields') and scheme.fields is not None
    
    # If fields attribute is missing, try to load it explicitly
    if not has_fields:
        print(f"Fields attribute missing in create_classification_result, trying to load fields explicitly for scheme {result_in.scheme_id}")
        # Get fields directly
        fields_statement = select(ClassificationField).where(
            ClassificationField.scheme_id == result_in.scheme_id
        )
        field_rows = session.exec(fields_statement).all()
        
        # Since we can't modify the scheme object directly (it's a SQLAlchemy Row),
        # we'll create a new ClassificationScheme instance with the same data
        # Use getattr with default values to handle missing attributes
        scheme_data = {}
        
        # Try to access attributes safely
        try:
            scheme_data["id"] = result_in.scheme_id  # Use the provided scheme_id
            scheme_data["name"] = getattr(scheme, 'name', f"Scheme {result_in.scheme_id}")
            scheme_data["description"] = getattr(scheme, 'description', f"Description for scheme {result_in.scheme_id}")
            scheme_data["model_instructions"] = getattr(scheme, 'model_instructions', None)
            scheme_data["validation_rules"] = getattr(scheme, 'validation_rules', None)
            scheme_data["workspace_id"] = getattr(scheme, 'workspace_id', workspace_id)  # Use the provided workspace_id
            scheme_data["user_id"] = getattr(scheme, 'user_id', current_user.id)  # Use the current user's ID
            scheme_data["created_at"] = getattr(scheme, 'created_at', datetime.now(timezone.utc))
            scheme_data["updated_at"] = getattr(scheme, 'updated_at', datetime.now(timezone.utc))
        except Exception as attr_error:
            print(f"Error accessing scheme attributes: {attr_error}")
            # If we can't access attributes, create minimal data
            scheme_data = {
                "id": result_in.scheme_id,
                "name": f"Scheme {result_in.scheme_id}",
                "description": f"Description for scheme {result_in.scheme_id}",
                "workspace_id": workspace_id,
                "user_id": current_user.id,
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
                    "scheme_id": result_in.scheme_id,
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
    
    # Before checking existing results
    if result_in.run_id and result_in.run_id > 2147483647:
        result_in.run_id = None  # Treat as unique classification
    
    # Check for existing result with same run_id
    if result_in.run_id:
        try:
            existing_result = session.exec(
                select(ClassificationResult)
                .where(
                    ClassificationResult.document_id == result_in.document_id,
                    ClassificationResult.scheme_id == result_in.scheme_id,
                    ClassificationResult.run_id == result_in.run_id
                )
            ).first()
            
            if existing_result:
                return ClassificationResultRead.model_validate(existing_result)
        except Exception as e:
            print(f"Error checking for existing result: {e}")
            # Continue with classification even if checking for existing result fails
    
    try:
        # Get classification result
        classification_output = classify_text(document.text_content, scheme.id)
        
        # Create the classification result storing the raw output
        classification_result = ClassificationResult(
            document_id=result_in.document_id,
            scheme_id=result_in.scheme_id,
            value=classification_output,
            timestamp=result_in.timestamp or datetime.now(timezone.utc),
            run_id=result_in.run_id, # Pass run_id directly from input
        )
        
        session.add(classification_result)
        session.commit()
        session.refresh(classification_result)
        
        return ClassificationResultRead.model_validate(classification_result)
    except Exception as e:
        print(f"Error in create_classification_result: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")


@router.get("/{result_id}", response_model=ClassificationResultRead)
def get_classification_result(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    result_id: int
) -> ClassificationResultRead:
    """
    Load (retrieve) an individual classification result by its ID.
    Verifies that this result's document and scheme belong to the workspace.
    """
    # Check that the workspace exists and belongs to the current user
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    # Updated query with joinedload
    result = session.exec(
        select(ClassificationResult)
        .options(
            joinedload(ClassificationResult.document),
            joinedload(ClassificationResult.scheme)
        )
        .where(ClassificationResult.id == result_id)
    ).first()

    if not result or not result.document or not result.scheme:
        raise HTTPException(status_code=404, detail="Result not found")

    # Simplify response construction
    return ClassificationResultRead(
        id=result.id,
        document_id=result.document_id,
        scheme_id=result.scheme_id,
        value=result.value,
        timestamp=result.timestamp,
        run_name=result.run_name,
        run_description=result.run_description,
        document=DocumentRead.model_validate(result.document),
        scheme=ClassificationSchemeRead.model_validate(result.scheme)
    )

@router.get("", response_model=List[EnhancedClassificationResultRead])
@router.get("/", response_model=List[EnhancedClassificationResultRead])
def list_classification_results(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    document_ids: List[int] = Query(None),
    scheme_ids: List[int] = Query(None),
    run_name: Optional[str] = Query(None),
    skip: int = 0,
    limit: int = 100
) -> List[EnhancedClassificationResultRead]:
    """
    List all classification results for the given workspace.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    base_stmt = select(ClassificationResult).where(
        ClassificationResult.document_id.in_(
            select(Document.id).where(Document.workspace_id == workspace_id)
        )
    )

    if document_ids:
        base_stmt = base_stmt.where(ClassificationResult.document_id.in_(document_ids))
    if scheme_ids:
        base_stmt = base_stmt.where(ClassificationResult.scheme_id.in_(scheme_ids))
    if run_name:
        base_stmt = base_stmt.where(ClassificationResult.run_name == run_name)

    statement = base_stmt.offset(skip).limit(limit)
    results = session.exec(statement).all()
    
    enhanced_results = []
    for result in results:
        result_data = {
            'id': result.id,
            'document_id': result.document_id,
            'scheme_id': result.scheme_id,
            'value': result.value,
            'timestamp': result.timestamp,
            'run_name': result.run_name,
            'run_description': result.run_description,
            'document': result.document,
            'scheme': result.scheme,
            'run_id': result.run_id
        }
        
        # Ensure value is always a dict
        if not isinstance(result_data['value'], dict):
            result_data['value'] = {'value': result_data['value']}
        
        enhanced_results.append(
            EnhancedClassificationResultRead.model_validate(result_data)
        )
    
    return enhanced_results

@router.get("/by_run/{run_id}", response_model=List[ClassificationResultRead])
def get_results_by_run(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    run_id: int
) -> List[ClassificationResultRead]:
    """
    Retrieve all classification results for a specific run ID.
    """
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    results = session.exec(
        select(ClassificationResult)
        .options(
            joinedload(ClassificationResult.document),
            joinedload(ClassificationResult.scheme)
        )
        .where(
            ClassificationResult.run_id == run_id,
            ClassificationResult.document_id.in_(
                select(Document.id).where(Document.workspace_id == workspace_id)
            )
        )
    ).all()
    
    return [ClassificationResultRead.model_validate(result) for result in results]
