from __future__ import annotations

"""Dependencies for FastAPI routes."""
from collections.abc import Generator
from typing import Annotated, Any, Optional, Union, TYPE_CHECKING

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings
from app.core.db import engine
from app.models import TokenPayload, User

# --- Provider Imports ---
from app.api.services.providers.base import (
    StorageProvider,
    ScrapingProvider,
    ClassificationProvider,
    GeospatialProvider,
    SearchProvider,
)
from app.api.services.providers.storage import MinioStorageProvider, get_storage_provider
from app.api.services.providers.scraping import OpolScrapingProvider, get_scraping_provider
from app.api.services.providers.classification import OpolClassificationProvider, get_classification_provider
from app.api.services.providers.geospatial import OpolGeospatialProvider, get_geospatial_provider
from app.api.services.providers.search import OpolSearchProvider, get_search_provider

# --- Service Class Imports (for TYPE_CHECKING hints and direct use in getters) ---
# No longer just for TYPE_CHECKING in Annotated, getters will import them directly.
from app.api.services.classification import ClassificationService
from app.api.services.ingestion import IngestionService
from app.api.services.workspace import WorkspaceService
from app.api.services.shareable import ShareableService
from app.api.services.dataset import DatasetService

# Create global provider instances
storage_provider_instance = get_storage_provider()
scraping_provider_instance = get_scraping_provider()
classification_provider_instance = get_classification_provider()
geospatial_provider_instance = get_geospatial_provider()
search_provider_instance = get_search_provider()

# Simple dependency functions that return the global instances
def get_storage_provider_dep() -> StorageProvider:
    return storage_provider_instance

def get_scraping_provider_dep() -> ScrapingProvider:
    return scraping_provider_instance

def get_classification_provider_dep() -> ClassificationProvider:
    return classification_provider_instance

def get_geospatial_provider_dep() -> GeospatialProvider:
    return geospatial_provider_instance

def get_search_provider_dep() -> SearchProvider:
    return search_provider_instance

# Define annotated types for easy injection of providers
StorageProviderDep = Annotated[StorageProvider, Depends(get_storage_provider_dep)]
ScrapingProviderDep = Annotated[ScrapingProvider, Depends(get_scraping_provider_dep)]
ClassificationProviderDep = Annotated[ClassificationProvider, Depends(get_classification_provider_dep)]
GeospatialProviderDep = Annotated[GeospatialProvider, Depends(get_geospatial_provider_dep)]
SearchProviderDep = Annotated[SearchProvider, Depends(get_search_provider_dep)]

# --- Core Dependencies ---

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token",
    auto_error=False
)

def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]

def get_current_user(session: SessionDep, token: TokenDep) -> User:
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
            headers={"WWW-Authenticate": "Bearer"},
        )
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
    except (JWTError, ValidationError):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Could not validate credentials",
        )
    user = session.get(User, token_data.sub)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=400, detail="Inactive user")
    return user

def get_current_user_optional(session: SessionDep, token: TokenDep) -> Optional[User]:
    if not token:
        return None
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
        user = session.get(User, token_data.sub)
        if not user or not user.is_active:
            return None
        return user
    except (JWTError, ValidationError):
        return None

CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[Optional[User], Depends(get_current_user_optional)]

def get_current_active_superuser(current_user: CurrentUser) -> User:
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=400, detail="The user doesn't have enough privileges"
        )
    return current_user

# --- Service Getter Functions (Refactored for Request-Scoped Cache and Setter Injection) ---

def get_classification_service(
    request: Request,
    session: SessionDep,
    classification_provider: ClassificationProviderDep
) -> ClassificationService:
    service_name = "classification_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)
    
    instance = ClassificationService(session=session, classification_provider=classification_provider)
    setattr(request.state, service_name, instance)
    return instance

def get_ingestion_service(
    request: Request,
    session: SessionDep,
    storage_provider: StorageProviderDep,
    scraping_provider: ScrapingProviderDep
) -> IngestionService:
    service_name = "ingestion_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)
    
    # IngestionService __init__ does not have circular deps that need setters
    instance = IngestionService(
        session=session,
        storage_provider=storage_provider,
        scraping_provider=scraping_provider,
    )
    setattr(request.state, service_name, instance)
    return instance

def get_dataset_service(
    request: Request,
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> DatasetService:
    service_name = "dataset_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)

    # Resolve dependencies for DatasetService constructor
    classification_service_instance = get_classification_service(
        request=request, session=session, classification_provider=get_classification_provider_dep()
    )
    ingestion_service_instance = get_ingestion_service(
        request=request, session=session, storage_provider=storage_provider, scraping_provider=get_scraping_provider_dep()
    )
    
    source_instance_id = settings.INSTANCE_ID if settings.INSTANCE_ID else "default_instance"
    instance = DatasetService(
        session=session,
        classification_service=classification_service_instance,
        ingestion_service=ingestion_service_instance,
        storage_provider=storage_provider,
        source_instance_id=source_instance_id
    )
    setattr(request.state, service_name, instance)
    return instance

def get_workspace_service(
    request: Request,
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> WorkspaceService:
    service_name = "workspace_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)

    instance = WorkspaceService(
        session=session,
        storage_provider=storage_provider
    )
    setattr(request.state, service_name, instance) # Store before fetching circular dep

    # Setter injection
    shareable_service_instance = get_shareable_service(
        request=request,
        session=session,
        storage_provider=storage_provider
    )
    instance.shareable_service = shareable_service_instance
    return instance

def get_shareable_service(
    request: Request,
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> ShareableService:
    service_name = "shareable_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)

    # Resolve direct __init__ dependencies for ShareableService
    ingestion_service_instance = get_ingestion_service(
        request=request, session=session, storage_provider=storage_provider, scraping_provider=get_scraping_provider_dep()
    )
    classification_service_instance = get_classification_service(
        request=request, session=session, classification_provider=get_classification_provider_dep()
    )

    instance = ShareableService(
        session=session,
        ingestion_service=ingestion_service_instance,
        classification_service=classification_service_instance,
        storage_provider=storage_provider
    )
    setattr(request.state, service_name, instance) # Store before fetching circular deps

    # Setter injections
    workspace_service_instance = get_workspace_service(
        request=request,
        session=session,
        storage_provider=storage_provider
    )
    dataset_service_instance = get_dataset_service(
        request=request,
        session=session,
        storage_provider=storage_provider
    )
    instance.workspace_service = workspace_service_instance
    instance.dataset_service = dataset_service_instance
    return instance

# --- ...ServiceDep Aliases for Services (Defined AFTER getter functions) ---
# These use the actual service CLASSES for the first argument of Annotated.
# FastAPI uses these for type hinting in route signatures.

ClassificationServiceDep = Annotated[ClassificationService, Depends(get_classification_service)]
IngestionServiceDep = Annotated[IngestionService, Depends(get_ingestion_service)]
WorkspaceServiceDep = Annotated[WorkspaceService, Depends(get_workspace_service)]
ShareableServiceDep = Annotated[ShareableService, Depends(get_shareable_service)]
DatasetServiceDep = Annotated[DatasetService, Depends(get_dataset_service)]


