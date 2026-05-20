from __future__ import annotations
import logging
from collections.abc import Generator
from typing import Annotated, Any, Optional, Union

from fastapi import Depends, HTTPException, status, Request
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from pydantic import ValidationError
from sqlmodel import Session

from app.core import security
from app.core.config import settings, AppSettings
from app.core.db import engine
from app.models import User
from app.schemas import TokenPayload

# --- Provider Protocols ---
from app.api.modules.foundation_service_providers.base import (
    StorageProvider,
    ScrapingProvider,
    WebSearchProvider,
    GeocodingProvider,
)
from app.api.modules.foundation_service_providers import resolve
# --- Service Class Imports (direct paths to avoid circular import) ---
from app.api.modules.annotation.services import AnnotationService
from app.api.modules.identity_infospace_user.services import InfospaceService
from app.api.modules.sharing.services import ShareableService, PackageService, BackupService, UserBackupService
from app.api.modules.content.services import (
    BundleService, SourceService,
    ProcessingService, DatasetService,
)
from app.api.modules.flow.services import TaskService
from app.api.modules.conversational_intelligence.services.conversation_service import (
    IntelligenceConversationService,
)

logger = logging.getLogger(__name__) 

# --- Core Dependencies ---
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token", 
    auto_error=False 
)

SettingsDep = Annotated[AppSettings, Depends(lambda: settings)]


def check_upload_size(request: Request, settings: SettingsDep) -> None:
    """Enforce MAX_UPLOAD_SIZE_BYTES from config. Raise 413 if exceeded."""
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            size = int(content_length)
            if size > settings.MAX_UPLOAD_SIZE_BYTES:
                raise HTTPException(
                    status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                    detail=f"Request body exceeds maximum size of {settings.MAX_UPLOAD_SIZE_BYTES} bytes",
                )
        except ValueError:
            pass


CheckUploadSizeDep = Annotated[None, Depends(check_upload_size)]


def get_db() -> Generator[Session, None, None]:
    with Session(engine) as session:
        yield session

SessionDep = Annotated[Session, Depends(get_db)]
TokenDep = Annotated[Optional[str], Depends(reusable_oauth2)]

# --- User Authentication Dependencies ---
def get_current_user(session: SessionDep, token: TokenDep, settings: SettingsDep) -> User: 
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if token is None: 
        raise credentials_exception
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[security.ALGORITHM]
        )
        token_data = TokenPayload(**payload)
        if token_data.sub is None: 
            raise credentials_exception
    except (JWTError, ValidationError) as e:
        logger.error(f"JWT/Validation error: {e}", exc_info=True) 
        raise credentials_exception from e
        
    user = session.get(User, token_data.sub)
    if user is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user")
    return user

def get_current_user_optional(session: SessionDep, token: TokenDep, settings: SettingsDep) -> Optional[User]: 
    if not token:
        return None
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[security.ALGORITHM])
        token_data = TokenPayload(**payload)
        if token_data.sub is None: return None
        user = session.get(User, token_data.sub)
        if not user or not user.is_active: return None
        return user
    except (JWTError, ValidationError):
        return None

CurrentUser = Annotated[User, Depends(get_current_user)]
OptionalUser = Annotated[Optional[User], Depends(get_current_user_optional)]

def get_current_active_superuser(current_user: CurrentUser) -> User: 
    if not getattr(current_user, 'is_superuser', False): 
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The user doesn't have enough privileges"
        )
    return current_user

# --- Provider Dependencies ---
# Infrastructure providers (storage, scraping) resolve at the deployment level.
# Credential-bearing capabilities (web_search, geocoding) need an infospace_id —
# routes that need them should call resolve() directly with access.infospace_id
# rather than using a generic dep factory.

def get_storage_provider_dependency() -> StorageProvider:
    return resolve("storage")

def get_scraping_provider_dependency() -> ScrapingProvider:
    return resolve("scraping")

StorageProviderDep = Annotated[StorageProvider, Depends(get_storage_provider_dependency)]
ScrapingProviderDep = Annotated[ScrapingProvider, Depends(get_scraping_provider_dependency)]



# --- Service Dependencies (Per-Request with Request State Caching) ---
# Using direct class types now, assuming they are all defined and imported above.

def get_infospace_service(request: Request, session: SessionDep, settings: SettingsDep, storage_provider: StorageProviderDep) -> InfospaceService:
    service_name = "infospace_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = InfospaceService(session=session, settings=settings, storage_provider=storage_provider)
    setattr(request.state, service_name, instance)
    return instance
InfospaceServiceDep = Annotated[InfospaceService, Depends(get_infospace_service)]

def get_bundle_service(request: Request, session: SessionDep) -> BundleService:
    service_name = "bundle_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = BundleService(db=session) 
    setattr(request.state, service_name, instance)
    return instance
BundleServiceDep = Annotated[BundleService, Depends(get_bundle_service)]

def get_source_service(request: Request, session: SessionDep) -> SourceService:
    service_name = "source_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = SourceService(session=session)
    setattr(request.state, service_name, instance)
    return instance
SourceServiceDep = Annotated[SourceService, Depends(get_source_service)]

def get_processing_service(
    request: Request,
    session: SessionDep,
    storage_provider: StorageProviderDep,
    scraping_provider: ScrapingProviderDep,
) -> ProcessingService:
    service_name = "processing_service"
    if hasattr(request.state, service_name):
        return getattr(request.state, service_name)
    instance = ProcessingService(
        session=session,
        storage_provider=storage_provider,
        scraping_provider=scraping_provider,
    )
    setattr(request.state, service_name, instance)
    return instance

ProcessingServiceDep = Annotated[ProcessingService, Depends(get_processing_service)]

def get_annotation_service(
    request: Request, session: SessionDep,
) -> AnnotationService:
    service_name = "annotation_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = AnnotationService(session=session)
    setattr(request.state, service_name, instance)
    return instance
AnnotationServiceDep = Annotated[AnnotationService, Depends(get_annotation_service)]


def get_ingestion_context_factory(
    session: SessionDep,
    storage_provider: StorageProviderDep,
    scraping_provider: ScrapingProviderDep,
    bundle_service: BundleServiceDep,
    settings: SettingsDep,
):
    """Factory that builds IngestionContext given user_id, infospace_id, options.

    ``search_provider`` (web_search) is resolved inside the factory because it
    needs ``infospace_id`` for credential resolution — that's not known at
    dependency-injection time.
    """

    def factory(
        user_id: int,
        infospace_id: int,
        options: Optional[dict] = None,
    ):
        from app.api.modules.content.handlers import IngestionContext
        from app.api.modules.foundation_service_providers import resolve, ProviderError
        try:
            search_provider = resolve("web_search", infospace_id=infospace_id, session=session)
        except ProviderError:
            search_provider = None  # optional: ingestion can skip search-driven paths
        return IngestionContext(
            session=session,
            storage_provider=storage_provider,
            scraping_provider=scraping_provider,
            search_provider=search_provider,
            bundle_service=bundle_service,
            user_id=user_id,
            infospace_id=infospace_id,
            settings=settings,
            options=options or {},
        )

    return factory


IngestionContextFactoryDep = Annotated[
    Any,  # Callable[[int, int, Optional[dict]], IngestionContext]
    Depends(get_ingestion_context_factory),
]

def get_dataset_service(
    request: Request, session: SessionDep, 
    storage_provider: StorageProviderDep, settings: SettingsDep
) -> DatasetService:
    service_name = "dataset_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = DatasetService(
        session=session, 
        storage_provider=storage_provider, 
        source_instance_id=settings.INSTANCE_ID
    )
    setattr(request.state, service_name, instance)
    return instance

DatasetServiceDep = Annotated[DatasetService, Depends(get_dataset_service)]

def get_package_service(
    request: Request, session: SessionDep, storage_provider: StorageProviderDep,
    annotation_service: AnnotationServiceDep,
    bundle_service: BundleServiceDep,
    dataset_service: DatasetServiceDep,
    settings: SettingsDep
) -> PackageService:
    service_name = "package_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = PackageService(
        session=session,
        storage_provider=storage_provider,
        annotation_service=annotation_service,
        bundle_service=bundle_service,
        dataset_service=dataset_service,
        settings=settings
    )
    setattr(request.state, service_name, instance)
    return instance
PackageServiceDep = Annotated[PackageService, Depends(get_package_service)]

def get_task_service( 
    request: Request, session: SessionDep, annotation_service: AnnotationServiceDep
) -> TaskService:
    service_name = "task_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = TaskService(
        session=session, 
        annotation_service=annotation_service
    )
    setattr(request.state, service_name, instance)
    return instance
TaskServiceDep = Annotated[TaskService, Depends(get_task_service)]

def get_shareable_service(
    request: Request, session: SessionDep, storage_provider: StorageProviderDep,
    settings: SettingsDep,
    annotation_service: AnnotationServiceDep,
    infospace_service: InfospaceServiceDep, package_service: PackageServiceDep,
    bundle_service: BundleServiceDep,
    dataset_service: DatasetServiceDep
) -> ShareableService:
    service_name = "shareable_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = ShareableService(
        session=session, settings=settings,
        annotation_service=annotation_service, storage_provider=storage_provider,
        infospace_service=infospace_service, dataset_service=dataset_service,
        package_service=package_service,
        bundle_service=bundle_service
    )
    setattr(request.state, service_name, instance)
    return instance
ShareableServiceDep = Annotated[ShareableService, Depends(get_shareable_service)]

def get_backup_service(
    request: Request, session: SessionDep, storage_provider: StorageProviderDep,
    settings: SettingsDep
) -> BackupService:
    service_name = "backup_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = BackupService(
        session=session, 
        storage_provider=storage_provider,
        settings=settings
    )
    setattr(request.state, service_name, instance)
    return instance
BackupServiceDep = Annotated[BackupService, Depends(get_backup_service)]

def get_user_backup_service(
    request: Request, session: SessionDep, storage_provider: StorageProviderDep,
    settings: SettingsDep
) -> UserBackupService:
    service_name = "user_backup_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = UserBackupService(
        session=session, 
        storage_provider=storage_provider,
        settings=settings
    )
    setattr(request.state, service_name, instance)
    return instance
UserBackupServiceDep = Annotated[UserBackupService, Depends(get_user_backup_service)]

def get_conversation_service(
    request: Request, session: SessionDep,
    annotation_service: AnnotationServiceDep,
    settings: SettingsDep,
) -> IntelligenceConversationService:
    service_name = "conversation_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = IntelligenceConversationService(
        session=session,
        annotation_service=annotation_service,
        settings=settings,
    )
    setattr(request.state, service_name, instance)
    return instance
ConversationServiceDep = Annotated[IntelligenceConversationService, Depends(get_conversation_service)]


