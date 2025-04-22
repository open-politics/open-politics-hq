from fastapi import APIRouter, Depends, HTTPException, Query
from app.models import ClassificationScheme, ClassificationSchemeCreate, ClassificationSchemeRead, ClassificationSchemeUpdate, Workspace, ClassificationResult, ClassificationResultRead, ClassificationField, FieldType
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

@router.get("")
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

    # Updated query to include fields relationship and classification count
    stmt = (
        select(
            ClassificationScheme,
            func.count(ClassificationResult.id).label('classification_count')
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
            fields=scheme.fields
        )
        for scheme, classification_count in results
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
