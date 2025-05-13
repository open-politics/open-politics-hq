"""Dependencies for FastAPI routes."""
from collections.abc import Generator
from typing import Annotated, Any, Optional, Union

from fastapi import Depends, HTTPException, status
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

# Create global provider instances
storage_provider = get_storage_provider()
scraping_provider = get_scraping_provider()
classification_provider = get_classification_provider()
geospatial_provider = get_geospatial_provider()
search_provider = get_search_provider()

# Simple dependency functions that return the global instances
def get_storage_provider_dep() -> StorageProvider:
    return storage_provider

def get_scraping_provider_dep() -> ScrapingProvider:
    return scraping_provider

def get_classification_provider_dep() -> ClassificationProvider:
    return classification_provider

def get_geospatial_provider_dep() -> GeospatialProvider:
    return geospatial_provider

def get_search_provider_dep() -> SearchProvider:
    return search_provider

# Define annotated types for easy injection
StorageProviderDep = Annotated[StorageProvider, Depends(get_storage_provider_dep)]
ScrapingProviderDep = Annotated[ScrapingProvider, Depends(get_scraping_provider_dep)]
ClassificationProviderDep = Annotated[ClassificationProvider, Depends(get_classification_provider_dep)]
GeospatialProviderDep = Annotated[GeospatialProvider, Depends(get_geospatial_provider_dep)]
SearchProviderDep = Annotated[SearchProvider, Depends(get_search_provider_dep)]

# --- Core Dependencies ---

reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token",
    auto_error=False  # Don't auto-raise errors for unauthenticated requests
)

def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[str, Depends(reusable_oauth2)]

def get_current_user(session: SessionDep, token: TokenDep) -> User:
    """Get the authenticated user or raise an exception if not authenticated."""
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
    """Get the authenticated user or return None if not authenticated."""
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

# --- Service Imports ---
from app.api.services.ingestion import IngestionService
from app.api.services.shareable import ShareableService
from app.api.services.dataset import DatasetService
from app.api.services.classification import ClassificationService
from app.api.services.workspace import WorkspaceService

# --- Service Dependencies ---

# First define the classification service dependency since others depend on it
def get_classification_service(
    session: SessionDep,
    storage_provider: StorageProviderDep
) -> ClassificationService:
    """Dependency provider for ClassificationService."""
    return ClassificationService(session=session, storage_provider=storage_provider)

ClassificationServiceDep = Annotated[ClassificationService, Depends(get_classification_service)]

def get_ingestion_service(
    session: SessionDep,
    storage_provider: StorageProviderDep,
    scraping_provider: ScrapingProviderDep,
    classification_provider: ClassificationProviderDep
) -> IngestionService:
    """Dependency provider for IngestionService."""
    return IngestionService(
        session=session,
        storage_provider=storage_provider,
        scraping_provider=scraping_provider,
        classification_provider=classification_provider
    )

IngestionServiceDep = Annotated[IngestionService, Depends(get_ingestion_service)]

def get_workspace_service(
    session: SessionDep, 
    storage_provider: StorageProviderDep, 
    shareable_service: ShareableServiceDep
) -> WorkspaceService:
    """Dependency provider for WorkspaceService."""
    return WorkspaceService(
        session=session, 
        storage_provider=storage_provider, 
        shareable_service=shareable_service
    )

WorkspaceServiceDep = Annotated[WorkspaceService, Depends(get_workspace_service)]

def get_dataset_service(
    session: SessionDep,
    classification_service: ClassificationServiceDep,
    ingestion_service: IngestionServiceDep,
    storage_provider: StorageProviderDep
) -> DatasetService:
    """Dependency provider for DatasetService."""
    source_instance_id = settings.INSTANCE_ID if settings.INSTANCE_ID else "default_instance"
    return DatasetService(
        session=session,
        classification_service=classification_service,
        ingestion_service=ingestion_service,
        storage_provider=storage_provider,
        source_instance_id=source_instance_id
    )

DatasetServiceDep = Annotated[DatasetService, Depends(get_dataset_service)]

def get_shareable_service(
    session: SessionDep,
    ingestion_service: IngestionServiceDep,
    classification_service: ClassificationServiceDep,
    workspace_service: WorkspaceServiceDep,
    dataset_service: DatasetServiceDep,
    storage_provider: StorageProviderDep
) -> ShareableService:
    """Dependency provider for ShareableService."""
    return ShareableService(
        session=session,
        ingestion_service=ingestion_service,
        classification_service=classification_service,
        workspace_service=workspace_service,
        dataset_service=dataset_service,
        storage_provider=storage_provider
    )

ShareableServiceDep = Annotated[ShareableService, Depends(get_shareable_service)]


