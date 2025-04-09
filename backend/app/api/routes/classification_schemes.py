from fastapi import APIRouter, Depends, HTTPException, Query
from app.models import Document,ClassificationScheme, ClassificationSchemeCreate, ClassificationSchemeRead, ClassificationSchemeUpdate, Workspace, ClassificationResult, ClassificationResultCreate, ClassificationResultRead, SavedResultSet, SavedResultSetCreate, SavedResultSetRead, DocumentRead, FileRead, ClassificationField, FieldType
from sqlmodel import Session, select, func
from app.api.deps import SessionDep, CurrentUser
from typing import List, Any, Dict
from datetime import datetime, timezone
from pydantic import BaseModel, Field, create_model
import os
from app.core.opol_config import opol
from sqlalchemy.orm import joinedload
from sqlalchemy import distinct

router = APIRouter(prefix="/workspaces/{workspace_id}/classification_schemes")

@router.post("/saved_results", response_model=SavedResultSetRead)
def create_saved_result_set(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    result_set_in: SavedResultSetCreate
) -> SavedResultSetRead:
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    result_set = SavedResultSet(
        **result_set_in.model_dump(),
        workspace_id=workspace_id
    )
    
    session.add(result_set)
    session.commit()
    session.refresh(result_set)
    return result_set

@router.get("/saved_results", response_model=List[SavedResultSetRead])
def read_saved_result_sets(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = Query(0, ge=0),
    limit: int = Query(100, ge=1)
) -> List[SavedResultSetRead]:
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    statement = select(SavedResultSet).where(
        SavedResultSet.workspace_id == workspace_id
    ).offset(skip).limit(limit)
    result_sets = session.exec(statement).all()
    
    return [
        SavedResultSetRead(
            id=rs.id,
            name=rs.name,
            document_ids=rs.document_ids or [],
            scheme_ids=rs.scheme_ids or [],
            workspace_id=rs.workspace_id,
            created_at=rs.created_at,
            updated_at=rs.updated_at
        )
        for rs in result_sets
    ]

@router.post("/", response_model=ClassificationSchemeRead)
@router.post("", response_model=ClassificationSchemeRead)
def create_classification_scheme(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_in: ClassificationSchemeCreate
) -> ClassificationSchemeRead:
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Validate fields
    for field in scheme_in.fields:
        if field.type == FieldType.INT:
            if field.scale_min is None or field.scale_max is None:
                raise HTTPException(
                    400, 
                    f"Field '{field.name}': scale_min and scale_max are required for integer fields"
                )
            if field.scale_min >= field.scale_max:
                raise HTTPException(
                    400, 
                    f"Field '{field.name}': scale_min must be less than scale_max"
                )

        elif field.type == FieldType.LIST_STR and field.is_set_of_labels:
            if not field.labels or len(field.labels) < 2:
                raise HTTPException(
                    400, 
                    f"Field '{field.name}': at least 2 labels required for list-based fields"
                )

        elif field.type == FieldType.LIST_DICT:
            if not field.dict_keys or len(field.dict_keys) < 1:
                raise HTTPException(
                    400,
                    f"Field '{field.name}': dict_keys required for structured data fields"
                )
            valid_types = {'str', 'int', 'float', 'bool'}
            for key_def in field.dict_keys:
                if key_def.type not in valid_types:
                    raise HTTPException(
                        400,
                        f"Field '{field.name}': Invalid type '{key_def.type}' for key '{key_def.name}'. Must be one of: {', '.join(valid_types)}"
                    )

    # Create scheme
    scheme = ClassificationScheme(
        name=scheme_in.name,
        description=scheme_in.description,
        model_instructions=scheme_in.model_instructions,
        validation_rules=scheme_in.validation_rules,
        workspace_id=workspace_id,
        user_id=current_user.id
    )
    session.add(scheme)
    session.flush()  # Get scheme.id without committing

    # Create fields
    for field_data in scheme_in.fields:
        field = ClassificationField(
            scheme_id=scheme.id,
            name=field_data.name,
            description=field_data.description,
            type=field_data.type,
            scale_min=field_data.scale_min,
            scale_max=field_data.scale_max,
            is_set_of_labels=field_data.is_set_of_labels,
            labels=field_data.labels,
            dict_keys=field_data.dict_keys
        )
        session.add(field)

    session.commit()
    session.refresh(scheme)
    return scheme

@router.get("", response_model=List[ClassificationSchemeRead])
@router.get("/", response_model=List[ClassificationSchemeRead])
def read_classification_schemes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    skip: int = 0,
    limit: int = 100
) -> List[ClassificationSchemeRead]:
    # Verify workspace access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    # Updated query to include fields relationship
    stmt = (
        select(
            ClassificationScheme,
            func.count(ClassificationResult.id).label('classification_count'),
            func.count(distinct(ClassificationResult.document_id)).label('document_count')
        )
        .options(joinedload(ClassificationScheme.fields))
        .join(ClassificationResult, ClassificationResult.scheme_id == ClassificationScheme.id, isouter=True)
        .where(ClassificationScheme.workspace_id == workspace_id)
        .group_by(ClassificationScheme.id)
        .offset(skip)
        .limit(limit)
    )

    # Add .unique() to handle the collection joinedload
    results = session.exec(stmt).unique().all()

    return [
        ClassificationSchemeRead(
            **scheme.model_dump(),
            classification_count=classification_count,
            document_count=document_count,
            fields=scheme.fields
        )
        for scheme, classification_count, document_count in results
    ]

@router.get("/{scheme_id}", response_model=ClassificationSchemeRead)
def read_classification_scheme(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int
) -> ClassificationSchemeRead:
    scheme = session.get(ClassificationScheme, scheme_id)
    if (
        not scheme
        or scheme.workspace_id != workspace_id
        or scheme.workspace.user_id_ownership != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification scheme not found")
    return scheme

@router.patch("/{scheme_id}", response_model=ClassificationSchemeRead)
def update_classification_scheme(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int,
    scheme_in: ClassificationSchemeUpdate
) -> ClassificationSchemeRead:
    scheme = session.get(ClassificationScheme, scheme_id)
    if (
        not scheme
        or scheme.workspace_id != workspace_id
        or scheme.workspace.user_id_ownership != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification scheme not found")
    
    for field, value in scheme_in.model_dump(exclude_unset=True).items():
        setattr(scheme, field, value)
    scheme.updated_at = datetime.now(timezone.utc)
    
    session.add(scheme)
    session.commit()
    session.refresh(scheme)
    return scheme

@router.delete("/{scheme_id}")
def delete_classification_scheme(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int
) -> Any:
    scheme = session.get(ClassificationScheme, scheme_id)
    if (
        not scheme
        or scheme.workspace_id != workspace_id
        or scheme.workspace.user_id_ownership != current_user.id
    ):
        raise HTTPException(status_code=404, detail="Classification scheme not found")
    session.delete(scheme)
    session.commit()
    return {"message": "Classification scheme deleted successfully"}

@router.post("/{scheme_id}/classify/{document_id}", response_model=ClassificationResultRead)
def classify_document(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    scheme_id: int,
    document_id: int
) -> Any:
    # Verify workspace access
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    # Get scheme and document
    scheme = session.get(ClassificationScheme, scheme_id)
    document = session.exec(
        select(Document)
        .options(joinedload(Document.files))
        .where(Document.id == document_id)
    ).unique().one()
    
    if not scheme or scheme.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Classification scheme not found")
    if not document or document.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Prepare text for classification
    classification_text = f"{document.title}: {document.text_content[:200]}" if document.text_content else document.title
    
    # Create dynamic Pydantic model based on all scheme fields
    if not scheme.fields:
        raise HTTPException(status_code=400, detail="Classification scheme has no fields defined")
    
    field_definitions = {}
    for field in scheme.fields:
        if field.type == FieldType.INT:
            field_definitions[field.name] = (
                float,
                Field(
                    ...,
                    ge=field.scale_min if field.scale_min is not None else 0,
                    le=field.scale_max if field.scale_max is not None else 10,
                    description=field.description
                )
            )
        elif field.type == FieldType.STR:
            field_definitions[field.name] = (
                str,
                Field(..., description=field.description)
            )
        elif field.type == FieldType.LIST_STR:
            if field.is_set_of_labels and field.labels:
                field_definitions[field.name] = (
                    List[str],
                    Field(..., description=field.description)
                )
        elif field.type == FieldType.LIST_DICT:
            if field.dict_keys:
                field_definitions[field.name] = (
                    List[Dict[str, Any]],
                    Field(..., description=field.description)
                )

    DynamicClassification = create_model(
        'DynamicClassification',
        **field_definitions
    )
    
    # Run classification
    fastclass = opol.classification(
        provider="Google",
        model_name="gemini-2.0-flash",
        llm_api_key=os.getenv("GOOGLE_API_KEY")
    )
    
    try:
        result = fastclass.classify(DynamicClassification, scheme.model_instructions or "", classification_text)
        score = result.score
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Classification failed: {str(e)}")
    
    # Store result
    classification_result = ClassificationResult(
        document_id=document_id,
        scheme_id=scheme_id,
        score=score
    )
    session.add(classification_result)
    session.commit()
    session.refresh(classification_result)
    
    # Return the result with explicit field mapping
    return ClassificationResultRead(
        id=classification_result.id,
        document_id=document_id,
        scheme_id=scheme_id,
        score=classification_result.score,
        timestamp=classification_result.timestamp,
        document=DocumentRead(
            id=document.id,
            title=document.title,
            insertion_date=document.insertion_date,
            workspace_id=document.workspace_id,
            user_id=document.user_id,
            url=document.url,
            content_type=document.content_type,
            source=document.source,
            text_content=document.text_content,
            summary=document.summary,
            files=[FileRead.model_validate(f) for f in document.files]
        ),
        scheme=ClassificationSchemeRead.model_validate(scheme)
    )

@router.get("/saved_results/{result_set_id}", response_model=SavedResultSetRead)
def get_saved_result_set(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int,
    result_set_id: int
) -> SavedResultSetRead:
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    result_set = session.get(SavedResultSet, result_set_id)
    if not result_set or result_set.workspace_id != workspace_id:
        raise HTTPException(status_code=404, detail="Result set not found")

    # Get associated classification results
    results_stmt = select(ClassificationResult).where(
        ClassificationResult.document_id.in_(result_set.document_ids),
        ClassificationResult.scheme_id.in_(result_set.scheme_ids)
    )
    results = session.exec(results_stmt).all()

    return SavedResultSetRead(
        id=result_set.id,
        name=result_set.name,
        document_ids=result_set.document_ids,
        scheme_ids=result_set.scheme_ids,
        workspace_id=result_set.workspace_id,
        created_at=result_set.created_at,
        updated_at=result_set.updated_at,
        results=results  # Add this field to SavedResultSetRead model
    )

@router.delete("")
@router.delete("/")
def delete_all_classification_schemes(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    workspace_id: int
) -> Any:
    workspace = session.get(Workspace, workspace_id)
    if not workspace or workspace.user_id_ownership != current_user.id:
        raise HTTPException(status_code=404, detail="Workspace not found")

    statement = select(ClassificationScheme).where(ClassificationScheme.workspace_id == workspace_id)
    schemes = session.exec(statement).all()

    for scheme in schemes:
        session.delete(scheme)

    session.commit()
    return {"message": "All classification schemes deleted successfully"}
