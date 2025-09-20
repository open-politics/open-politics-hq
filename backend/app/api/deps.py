from __future__ import annotations
import logging
from collections.abc import Generator
from typing import Annotated, Any, Optional, Union, TYPE_CHECKING

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
from app.api.providers.base import (
    StorageProvider,
    ScrapingProvider, 
    SearchProvider,
    GeospatialProvider,
    EmbeddingProvider
)
from app.api.providers.model_registry import ModelRegistryService
from app.api.providers.factory import (
    create_storage_provider,
    create_scraping_provider,
    create_search_provider,
    create_embedding_provider,
    create_geospatial_provider,
    create_model_registry,
)
from app.api.services.annotation_service import AnnotationService
from app.api.services.infospace_service import InfospaceService 
from app.api.services.shareable_service import ShareableService 
from app.api.services.package_service import PackageService
from app.api.services.bundle_service import BundleService 
from app.api.services.asset_service import AssetService 
from app.api.services.analysis_service import AnalysisService
from app.api.services.dataset_service import DatasetService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.backup_service import BackupService
from app.api.services.user_backup_service import UserBackupService
from app.api.services.task_service import TaskService
from app.api.services.source_service import SourceService
from app.api.services.chunking_service import ChunkingService
from app.api.services.embedding_service import EmbeddingService
from app.api.services.monitor_service import MonitorService
from app.api.services.pipeline_service import PipelineService
from app.api.services.conversation_service import IntelligenceConversationService

# --- Service Class Imports --- 
# Use TYPE_CHECKING to ensure imports are only for type analysis, avoiding runtime circularities
# The actual classes will be resolved from their modules by FastAPI when dependencies are built.
if TYPE_CHECKING:
    from app.api.services.annotation_service import AnnotationService
    from app.api.services.infospace_service import InfospaceService 
    from app.api.services.shareable_service import ShareableService 
    from app.api.services.package_service import PackageService 
    from app.api.services.bundle_service import BundleService 
    from app.api.services.asset_service import AssetService 
    from app.api.services.task_service import TaskService 
    from app.api.services.analysis_service import AnalysisService
    from app.api.services.dataset_service import DatasetService

# These imports are needed if service classes are directly referenced in `Annotated` without string literals,
# but using string literals (e.g., Annotated['InfospaceService', ...]) is safer for complex DI graphs.
# For Pylance to be happy with direct types in Annotated, these imports must be resolvable.
from app.api.services.annotation_service import AnnotationService
from app.api.services.infospace_service import InfospaceService 
from app.api.services.shareable_service import ShareableService 
from app.api.services.package_service import PackageService
from app.api.services.bundle_service import BundleService 
from app.api.services.asset_service import AssetService 
from app.api.services.analysis_service import AnalysisService
from app.api.services.dataset_service import DatasetService
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.backup_service import BackupService
from app.api.services.user_backup_service import UserBackupService
from app.api.services.task_service import TaskService
from app.api.services.source_service import SourceService
from app.api.services.chunking_service import ChunkingService
from app.api.services.embedding_service import EmbeddingService
from app.api.services.monitor_service import MonitorService
from app.api.services.pipeline_service import PipelineService
from app.api.services.conversation_service import IntelligenceConversationService

logger = logging.getLogger(__name__) 

# --- Core Dependencies ---
reusable_oauth2 = OAuth2PasswordBearer(
    tokenUrl=f"{settings.API_V1_STR}/login/access-token", 
    auto_error=False 
)

SettingsDep = Annotated[AppSettings, Depends(lambda: settings)]

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

# --- Provider Dependencies (using factories that take settings) ---
def get_storage_provider_dependency(settings: SettingsDep) -> StorageProvider:
    return create_storage_provider(settings)

def get_scraping_provider_dependency(settings: SettingsDep) -> ScrapingProvider:
    return create_scraping_provider(settings)

def get_search_provider_dependency(settings: SettingsDep) -> SearchProvider:
    return create_search_provider(settings)

def get_geospatial_provider_dependency(settings: SettingsDep) -> GeospatialProvider:
    return create_geospatial_provider(settings)

def get_embedding_provider_dependency(settings: SettingsDep) -> EmbeddingProvider:
    return create_embedding_provider(settings)

async def get_model_registry_dependency(settings: SettingsDep):
    """Create and initialize model registry"""
    from app.api.providers.model_registry import ModelRegistryService
    registry = create_model_registry(settings)
    await registry.initialize_providers()
    return registry

StorageProviderDep = Annotated[StorageProvider, Depends(get_storage_provider_dependency)]
ScrapingProviderDep = Annotated[ScrapingProvider, Depends(get_scraping_provider_dependency)]
SearchProviderDep = Annotated[SearchProvider, Depends(get_search_provider_dependency)]
GeospatialProviderDep = Annotated[GeospatialProvider, Depends(get_geospatial_provider_dependency)]
EmbeddingProviderDep = Annotated[EmbeddingProvider, Depends(get_embedding_provider_dependency)]
ModelRegistryDep = Annotated['ModelRegistryService', Depends(get_model_registry_dependency)]


# --- Service Dependencies (Per-Request with Request State Caching) ---
# Using direct class types now, assuming they are all defined and imported above.

def get_infospace_service(request: Request, session: SessionDep, settings: SettingsDep, storage_provider: StorageProviderDep) -> InfospaceService:
    service_name = "infospace_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = InfospaceService(session=session, settings=settings, storage_provider=storage_provider)
    setattr(request.state, service_name, instance)
    return instance
InfospaceServiceDep = Annotated[InfospaceService, Depends(get_infospace_service)]

def get_asset_service(request: Request, session: SessionDep, storage_provider: StorageProviderDep) -> AssetService:
    service_name = "asset_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = AssetService(session=session, storage_provider=storage_provider)
    setattr(request.state, service_name, instance)
    return instance
AssetServiceDep = Annotated[AssetService, Depends(get_asset_service)]

def get_bundle_service(request: Request, session: SessionDep) -> BundleService:
    service_name = "bundle_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = BundleService(db=session) 
    setattr(request.state, service_name, instance)
    return instance
BundleServiceDep = Annotated[BundleService, Depends(get_bundle_service)]

async def get_annotation_service(
    request: Request, session: SessionDep, model_registry: ModelRegistryDep, 
    asset_service: AssetServiceDep
) -> AnnotationService:
    service_name = "annotation_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = AnnotationService(session=session, model_registry=model_registry, asset_service=asset_service)
    setattr(request.state, service_name, instance)
    return instance
AnnotationServiceDep = Annotated[AnnotationService, Depends(get_annotation_service)]

def get_content_ingestion_service(
    request: Request, session: SessionDep
) -> ContentIngestionService:
    service_name = "content_ingestion_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = ContentIngestionService(session=session)
    setattr(request.state, service_name, instance)
    return instance

ContentIngestionServiceDep = Annotated[ContentIngestionService, Depends(get_content_ingestion_service)]

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
    annotation_service: AnnotationServiceDep, content_ingestion_service: ContentIngestionServiceDep, 
    asset_service: AssetServiceDep, bundle_service: BundleServiceDep, 
    dataset_service: DatasetServiceDep,
    settings: SettingsDep 
) -> PackageService:
    service_name = "package_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = PackageService(
        session=session, 
        storage_provider=storage_provider, 
        asset_service=asset_service, 
        annotation_service=annotation_service, 
        ingestion_service=content_ingestion_service, 
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
    asset_service: AssetServiceDep, bundle_service: BundleServiceDep,
    dataset_service: DatasetServiceDep
) -> ShareableService:
    service_name = "shareable_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = ShareableService(
        session=session, settings=settings, 
        annotation_service=annotation_service, storage_provider=storage_provider,
        infospace_service=infospace_service, dataset_service=dataset_service, 
        package_service=package_service, asset_service=asset_service, 
        bundle_service=bundle_service
    )
    setattr(request.state, service_name, instance)
    return instance
ShareableServiceDep = Annotated[ShareableService, Depends(get_shareable_service)]

async def get_analysis_service(
    request: Request, session: SessionDep, model_registry: ModelRegistryDep,
    annotation_service: AnnotationServiceDep, asset_service: AssetServiceDep,
    current_user: CurrentUser, settings: SettingsDep 
) -> AnalysisService:
    service_name = "analysis_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = AnalysisService(session=session, model_registry=model_registry, 
                             annotation_service=annotation_service, asset_service=asset_service,
                             current_user=current_user, settings=settings)
    setattr(request.state, service_name, instance)
    return instance
AnalysisServiceDep = Annotated[AnalysisService, Depends(get_analysis_service)]

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

def get_monitor_service(
    request: Request, session: SessionDep, 
    annotation_service: AnnotationServiceDep, 
    task_service: TaskServiceDep
) -> MonitorService:
    service_name = "monitor_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = MonitorService(
        session=session, 
        annotation_service=annotation_service,
        task_service=task_service
    )
    setattr(request.state, service_name, instance)
    return instance
MonitorServiceDep = Annotated[MonitorService, Depends(get_monitor_service)]

def get_pipeline_service(
    request: Request, session: SessionDep,
    annotation_service: AnnotationServiceDep,
    analysis_service: AnalysisServiceDep,
    bundle_service: BundleServiceDep
) -> PipelineService:
    service_name = "pipeline_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = PipelineService(
        session=session,
        annotation_service=annotation_service,
        analysis_service=analysis_service,
        bundle_service=bundle_service
    )
    setattr(request.state, service_name, instance)
    return instance
PipelineServiceDep = Annotated[PipelineService, Depends(get_pipeline_service)]

def get_embedding_service(
    session: SessionDep,
    embedding_provider: EmbeddingProviderDep
) -> EmbeddingService:
    return EmbeddingService(session=session, embedding_provider=embedding_provider)

async def get_conversation_service(
    request: Request, session: SessionDep, model_registry: ModelRegistryDep,
    asset_service: AssetServiceDep, annotation_service: AnnotationServiceDep,
    content_ingestion_service: ContentIngestionServiceDep
) -> IntelligenceConversationService:
    service_name = "conversation_service"
    if hasattr(request.state, service_name): return getattr(request.state, service_name)
    instance = IntelligenceConversationService(
        session=session,
        model_registry=model_registry,
        asset_service=asset_service,
        annotation_service=annotation_service,
        content_ingestion_service=content_ingestion_service
    )
    setattr(request.state, service_name, instance)
    return instance
ConversationServiceDep = Annotated[IntelligenceConversationService, Depends(get_conversation_service)]


