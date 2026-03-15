"""Routes for assets."""
import logging
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel, Field, Field
import json

from app.models import (
    Asset,
    AssetKind,
    Source,
    SourceStatus,
    Infospace,
    ProcessingStatus,
)
from app.schemas import AssetRead, AssetCreate, AssetUpdate, AssetsOut, Message
from app.api.dependency_injection import (
    SessionDep,
    CurrentUser,
    StorageProviderDep,
    BundleServiceDep,
    IngestionContextFactoryDep,
    AssetServiceDep,
    ProcessingServiceDep,
    CheckUploadSizeDep,
)
from app.api.global_utils import validate_infospace_access
from app.api.modules.foundation_service_providers.registry import get_scraping_provider, get_storage_provider
from app.core.config import settings
from sqlalchemy import func
from sqlmodel import select, delete
from app.core.celery_app import celery
from app.api.modules.content.services import BundleService
from app.api.modules.content.ingest import ingest
from app.core.db import engine
from sqlmodel import Session

logging.basicConfig(level=logging.INFO, format="%(asctime)s - %(levelname)s - %(message)s")
logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/infospaces/{infospace_id}/assets",
    tags=["Assets"]
)

class BulkUrlIngestion(BaseModel):
    urls: List[str]
    base_title: Optional[str] = None
    scrape_immediately: bool = True
    bundle_id: Optional[int] = None

class ReprocessOptions(BaseModel):
    delimiter: Optional[str] = None
    encoding: Optional[str] = "utf-8"
    skip_rows: Optional[int] = 0
    max_rows: Optional[int] = None
    timeout: Optional[int] = 30

class ArticleComposition(BaseModel):
    title: str
    content: str
    summary: Optional[str] = None
    embedded_assets: Optional[List[Dict[str, Any]]] = None
    referenced_bundles: Optional[List[int]] = None
    metadata: Optional[Dict[str, Any]] = None
    event_timestamp: Optional[datetime] = None

class RSSDiscoveryRequest(BaseModel):
    country: str
    category_filter: Optional[str] = None
    max_feeds: int = 10
    max_items_per_feed: int = 20
    bundle_id: Optional[int] = None
    options: Optional[Dict[str, Any]] = None


class SearchResultItem(BaseModel):
    """Single search result with pre-fetched content"""
    title: str
    url: str
    content: str
    score: Optional[float] = None
    provider: Optional[str] = None
    facets: Optional[Dict[str, Any]] = None
    file_info: Optional[Dict[str, Any]] = None

class BulkSearchResultIngestion(BaseModel):
    """Bulk ingestion of search results with their pre-fetched content"""
    results: List[SearchResultItem]
    bundle_id: Optional[int] = None


class BatchAssetCreateRequest(BaseModel):
    """Batch create assets - single pattern for CSV rows, PDF pages, directory imports."""
    assets: List[AssetCreate]
    batch_size: int = 500
    skip_dedupe: bool = True


@router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    ingestion_context_factory: IngestionContextFactoryDep,
    processing_service: ProcessingServiceDep,
    infospace_id: int,
    asset_in: AssetCreate
) -> Any:
    """
    Generic asset creation endpoint that routes to appropriate specific endpoint.
    
    This endpoint maintains backward compatibility while using the new ContentService.
    Based on the asset data provided, it routes to the appropriate ingestion method:
    - If source_identifier (URL) is provided: ingest as web content
    - If text_content is provided: ingest as text
    - Otherwise: create a basic asset record
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        locator: Any = None
        options: Dict[str, Any] = {}

        if asset_in.source_identifier and (
            asset_in.source_identifier.startswith('http://') or 
            asset_in.source_identifier.startswith('https://')
        ):
            locator = asset_in.source_identifier
            options['scrape_immediately'] = True
        elif asset_in.text_content:
            locator = asset_in.text_content
            options['event_timestamp'] = asset_in.event_timestamp
        
        if locator:
            context = ingestion_context_factory(
                user_id=current_user.id,
                infospace_id=infospace_id,
                options=options,
            )
            assets = await ingest(
                context,
                locator,
                title=asset_in.title,
                options=options,
            )
            asset = assets[0] if assets else None
        else:
            from app.api.modules.content.processors import detect_asset_kind_from_extension, needs_processing

            context = ingestion_context_factory(current_user.id, infospace_id, {})
            asset_in.user_id = current_user.id
            asset_in.infospace_id = infospace_id

            if asset_in.blob_path:
                import os
                file_ext = os.path.splitext(asset_in.blob_path)[1].lower()
                detected_kind = detect_asset_kind_from_extension(file_ext)
                if detected_kind != AssetKind.FILE:
                    asset_in.kind = detected_kind
                    logger.info(f"Detected asset kind '{detected_kind.value}' from blob_path: {asset_in.blob_path}")

            asset = context.asset_service.create_asset(asset_in)
            
            # Process if needed (using centralized detection)
            if asset.blob_path and needs_processing(asset.kind):
                try:
                    await processing_service.process_content(asset, options)
                except Exception as e:
                    logger.error(f"Processing failed for asset {asset.id}: {e}")
                    # Don't fail the request, asset is already created

        if not asset:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from provided data.")

        return AssetRead.model_validate(asset)
        
    except Exception as e:
        logger.error(f"Asset creation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {str(e)}"
        )


@router.post("/batch", response_model=List[AssetRead])
def batch_create_assets(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    asset_service: AssetServiceDep,
    infospace_id: int,
    request: BatchAssetCreateRequest,
) -> List[AssetRead]:
    """
    Batch create assets. Single pattern for CSV rows, PDF pages, directory imports, RSS articles.
    Uses per-batch commits (default 500) for scale.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    if not request.assets:
        return []
    # Ensure user_id and infospace_id on each asset
    normalized = []
    for ac in request.assets:
        data = ac.model_dump(exclude_unset=True)
        data["user_id"] = current_user.id
        data["infospace_id"] = infospace_id
        normalized.append(data)
    created = asset_service.batch_create_assets(
        normalized,
        batch_size=request.batch_size,
        skip_dedupe=request.skip_dedupe,
    )
    return [AssetRead.model_validate(a) for a in created]


@router.post("/upload", response_model=AssetRead)
async def upload_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    make_ingestion_context: IngestionContextFactoryDep,
    infospace_id: int,
    _: CheckUploadSizeDep,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    process_immediately: bool = Form(True)
) -> Any:
    """
    Upload a file and create an asset.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        from app.api.modules.content.handlers import FileHandler

        context = make_ingestion_context(
            current_user.id, infospace_id, {"process_immediately": process_immediately}
        )
        handler = FileHandler(context)
        assets = await handler.handle(file, title, {"process_immediately": process_immediately})
        
        if not assets:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from uploaded file.")

        return AssetRead.model_validate(assets[0])
        
    except Exception as e:
        logger.error(f"File upload failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"File upload failed: {str(e)}"
        )

@router.post("/ingest-url", response_model=AssetRead)
async def ingest_url(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    make_ingestion_context: IngestionContextFactoryDep,
    infospace_id: int,
    url: str,
    title: Optional[str] = None,
    scrape_immediately: bool = True
) -> Any:
    """
    Ingest content from a URL.

    Uses WebHandler directly for clean URL ingestion.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)

        from app.api.modules.content.handlers import WebHandler

        context = make_ingestion_context(
            current_user.id, infospace_id, {"scrape_immediately": scrape_immediately}
        )
        handler = WebHandler(context)
        assets = await handler.handle(url, title, {"scrape_immediately": scrape_immediately})

        if not assets:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from URL.")

        return AssetRead.model_validate(assets[0])
        
    except Exception as e:
        logger.error(f"URL ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"URL ingestion failed: {str(e)}"
        )

@router.post("/ingest-text", response_model=AssetRead)
async def ingest_text(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    make_ingestion_context: IngestionContextFactoryDep,
    infospace_id: int,
    text_content: str,
    title: Optional[str] = None,
    event_timestamp: Optional[datetime] = None
) -> Any:
    """
    Ingest direct text content.

    Uses TextHandler directly for clean text ingestion.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)

        from app.api.modules.content.handlers import TextHandler

        options = {"event_timestamp": event_timestamp} if event_timestamp else {}
        context = make_ingestion_context(current_user.id, infospace_id, options)
        handler = TextHandler(context)
        assets = await handler.handle(text_content, title, options)

        if not assets:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from text.")

        return AssetRead.model_validate(assets[0])
        
    except Exception as e:
        logger.error(f"Text ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Text ingestion failed: {str(e)}"
        )

@router.post("/compose-article", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def compose_article(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    composition: ArticleComposition
) -> Any:
    """
    Compose a free-form article with embedded assets and bundle references.
    """
    try:
        from app.api.modules.content.services.asset_builder import AssetBuilder

        validate_infospace_access(session, infospace_id, current_user.id)

        article = await AssetBuilder.compose_article(
            session=session,
            user_id=current_user.id,
            infospace_id=infospace_id,
            title=composition.title,
            content=composition.content,
            summary=composition.summary,
            embedded_assets=composition.embedded_assets,
            referenced_bundles=composition.referenced_bundles,
            metadata=composition.metadata,
            event_timestamp=composition.event_timestamp,
        )
        
        return AssetRead.model_validate(article)
        
    except Exception as e:
        logger.error(f"Article composition failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Article composition failed: {str(e)}"
        )

@router.post("/bulk-ingest-urls", response_model=List[AssetRead])
async def bulk_ingest_urls(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    ingestion_context_factory: IngestionContextFactoryDep,
    infospace_id: int,
    bulk_request: BulkUrlIngestion
) -> Any:
    """
    Ingest multiple URLs as separate assets.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)

        if len(bulk_request.urls) > 100:
            # For large batches, create IngestionJob — @task picks it up via event
            from app.models import IngestionJob, IngestionStatus
            from app.core.events import emit
            job = IngestionJob(
                infospace_id=infospace_id,
                user_id=current_user.id,
                source_locator="bulk_urls",
                kind="bulk_urls",
                status=IngestionStatus.PENDING,
                total_files=len(bulk_request.urls),
                cursor_state={
                    "stage": "pending", "message": "Queued",
                    "progress_pct": 0, "urls": bulk_request.urls,
                    "base_title": bulk_request.base_title,
                    "scrape_immediately": bulk_request.scrape_immediately,
                    "options": {},
                },
            )
            session.add(job)
            session.commit()
            emit("ingestion_job.created", {"infospace_id": infospace_id})
            return {"message": f"Bulk ingestion of {len(bulk_request.urls)} URLs started in background"}

        # For smaller batches, process immediately
        context = ingestion_context_factory(
            user_id=current_user.id,
            infospace_id=infospace_id,
            options={
                "base_title": bulk_request.base_title,
                "scrape_immediately": bulk_request.scrape_immediately,
            },
        )
        assets = await ingest(
            context,
            bulk_request.urls,
            options={
                "base_title": bulk_request.base_title,
                "scrape_immediately": bulk_request.scrape_immediately,
            },
        )
        
        return [AssetRead.model_validate(asset) for asset in assets]
        
    except Exception as e:
        logger.error(f"Bulk URL ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Bulk URL ingestion failed: {str(e)}"
        )

@router.post("/ingest-search-results", response_model=List[AssetRead])
async def ingest_search_results(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    bundle_service: BundleServiceDep,
    infospace_id: int,
    bulk_request: BulkSearchResultIngestion
) -> Any:
    """
    Ingest search results with their pre-fetched content (no re-scraping).
    
    This endpoint is optimized for search results from providers like Tavily
    that already include the full content. We create ARTICLE assets directly 
    using the new AssetBuilder pattern.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        from app.api.modules.content.services import AssetBuilder
        from app.schemas import SearchResult
        
        created_assets = []
        failed_count = 0
        
        for idx, result in enumerate(bulk_request.results):
            try:
                # Convert to SearchResult format for AssetBuilder
                search_result = SearchResult(
                    title=result.title,
                    url=result.url,
                    content=result.content,  # This is the short snippet
                    score=result.score,
                    provider=result.provider or "unknown",
                    raw_data={
                        "raw_content": result.content,  # Use full content as markdown
                        **(result.file_info or {}),
                        **(result.facets or {})
                    }
                )
                
                # Build asset using AssetBuilder pattern
                asset = await (AssetBuilder(session, current_user.id, infospace_id)
                    .from_search_result(search_result, query="ingested search results")
                    .with_metadata(
                        ingestion_rank=idx + 1,
                        ingestion_source="search_result_ingestor",
                        ingestion_batch=datetime.now(timezone.utc).isoformat()
                    )
                    .build())
                
                created_assets.append(asset)
                
                # Add to bundle if specified
                if bulk_request.bundle_id:
                    try:
                        bundle_service.add_asset_to_bundle(
                            bundle_id=bulk_request.bundle_id,
                            asset_id=asset.id,
                            infospace_id=infospace_id,
                            user_id=current_user.id
                        )
                    except Exception as bundle_error:
                        logger.warning(f"Failed to add asset {asset.id} to bundle: {bundle_error}")
                
                logger.info(f"✓ Created ARTICLE asset from search result: {result.title}")
                    
            except Exception as e:
                failed_count += 1
                logger.error(f"Failed to ingest search result '{result.title}': {e}")
                continue
        
        # Commit all changes
        session.commit()
        
        logger.info(
            f"Search results ingestion completed: {len(created_assets)} success, {failed_count} failed"
        )
        
        return [AssetRead.model_validate(asset) for asset in created_assets]
        
    except Exception as e:
        logger.error(f"Bulk search results ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Bulk search results ingestion failed: {str(e)}"
        )

@router.post("/{asset_id}/materialize-csv", response_model=AssetRead)
async def materialize_csv_from_rows(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    asset_id: int,
    storage_provider: StorageProviderDep,
) -> Any:
    """
    Materialize a chat-generated CSV container into a real CSV file.

    Uses registry-driven materializer from ContentTypeDescriptor.
    Generates a CSV file from the row assets and uploads it to storage,
    then updates the parent asset with the blob_path.
    """
    validate_infospace_access(session, infospace_id, current_user.id)

    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset {asset_id} not found",
        )

    from app.api.modules.content.types import get_content_type_registry

    registry = get_content_type_registry()
    descriptor = registry.by_kind(asset.kind)
    if not descriptor or not descriptor.materializer_class:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Asset type does not support materialization (kind: {asset.kind.value})",
        )

    materializer = descriptor.materializer_class()
    try:
        return await materializer.materialize(asset, session, storage_provider)
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )



@router.post("/{asset_id}/reprocess", response_model=Message)
async def reprocess_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    processing_service: ProcessingServiceDep,
    infospace_id: int,
    asset_id: int,
    options: ReprocessOptions
) -> Any:
    """
    Reprocess an asset with new options.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the asset
        asset = session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        # Convert options to dict
        reprocess_options = options.model_dump(exclude_none=True)
        
        # Reprocess the asset
        await processing_service.reprocess_content(asset, reprocess_options)
        
        return Message(message=f"Asset {asset_id} reprocessed successfully")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Asset reprocessing failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset reprocessing failed: {str(e)}"
        )


@router.put("/{asset_id}/update-csv-content", response_model=Message)
async def update_asset_content(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    processing_service: ProcessingServiceDep,
    infospace_id: int,
    asset_id: int,
    file: UploadFile = File(...),
) -> Any:
    """
    Update CSV asset content and trigger reprocessing.
    
    This endpoint:
    1. Validates the asset exists and user has access
    2. Updates the blob storage with new CSV content
    3. Updates existing child row assets in-place (preserves IDs and relationships)
    4. Creates new assets for added rows, deletes assets for removed rows
    
    IMPORTANT: Row assets are updated in-place rather than deleted/recreated.
    This preserves annotations, fragments, and all relationships that reference these assets.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Get the asset
        asset = session.get(Asset, asset_id)
        if not asset or asset.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Asset not found"
            )
        
        # Verify this is a CSV asset
        if asset.kind != AssetKind.CSV:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Only CSV assets can be updated with this endpoint"
            )
        
        if not asset.blob_path:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Asset has no blob_path to update"
            )
        
        logger.info(f"Updating CSV content for asset {asset_id}, blob_path: {asset.blob_path}")
        
        # Read the uploaded file
        file_content = await file.read()
        
        # Update the blob storage (overwrite existing file)
        # Use upload_from_bytes to overwrite the existing file
        await storage_provider.upload_from_bytes(
            file_bytes=file_content,
            object_name=asset.blob_path,
            filename=file.filename,
            content_type='text/csv'
        )
        
        logger.info(f"Updated blob storage at {asset.blob_path} ({len(file_content)} bytes)")
        
        # Update the asset's updated_at timestamp
        asset.updated_at = datetime.now(timezone.utc)
        session.add(asset)
        session.commit()
        session.refresh(asset)
        
        # Reprocess the asset with existing options
        # This will update child row assets in-place (preserving their IDs and relationships)
        reprocess_options = (asset.file_info or {}).get('processing_options', {})
        await processing_service.reprocess_content(asset, reprocess_options)
        
        logger.info(f"Asset {asset_id} content updated and row assets updated in-place")
        
        return Message(message=f"CSV content updated and reprocessing initiated")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Asset content update failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update asset content: {str(e)}"
        )

@router.get("", response_model=AssetsOut)
@router.get("/", response_model=AssetsOut)
def list_assets(
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    skip: int = 0,
    limit: int = 100,
    parent_asset_id: Optional[int] = None
) -> Any:
    """
    Retrieve assets for an infospace.
    """
    validate_infospace_access(session, infospace_id, current_user.id)

    if parent_asset_id is not None:
        parent_asset = session.get(Asset, parent_asset_id)
        if not parent_asset or parent_asset.infospace_id != infospace_id or parent_asset.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent asset not found"
            )

    from app.api.modules.content.query import AssetQuery

    q = (
        AssetQuery(session, infospace_id)
        .parent_asset(parent_asset_id)
        .user_id(current_user.id if parent_asset_id is None else None)
        .sort("created_at_desc")
        .offset(skip)
        .paginate(cursor=None, limit=limit)
    )
    total_count = q.count()
    assets = q.execute()

    return AssetsOut(
        data=[AssetRead.model_validate(asset) for asset in assets],
        count=total_count
    )

@router.get("/discover-rss-feeds")
async def discover_rss_feeds(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    country: Optional[str] = None,
    category: Optional[str] = None,
    limit: int = 50
) -> Any:
    """
    Discover RSS feeds from the awesome-rss-feeds repository.
    
    Args:
        country: Country name (e.g., "Australia", "United States") - if None, returns all countries
        category: Category filter (e.g., "News", "Technology") - if None, returns all categories
        limit: Maximum number of feeds to return
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)

        from app.api.modules.content.handlers import RSSHandler

        feeds = await RSSHandler.discover_rss_feeds_from_awesome_repo(
            country=country,
            category=category,
            limit=limit
        )

        return {
            "feeds": feeds,
            "count": len(feeds),
            "country": country,
            "category": category,
            "limit": limit
        }

    except Exception as e:
        logger.error(f"RSS feed discovery failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RSS feed discovery failed: {str(e)}"
        )

@router.get("/preview-rss-feed")
async def preview_rss_feed(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    feed_url: str,
    max_items: int = 20
) -> Any:
    """
    Preview the content of an RSS feed.
    """
    try:
        from app.api.modules.content.handlers import RSSHandler

        preview_data = await RSSHandler.preview_rss_feed(feed_url, max_items)
        return preview_data
    except Exception as e:
        logger.error(f"Error previewing RSS feed {feed_url}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to preview RSS feed: {str(e)}",
        ) from e



@router.post("/ingest-selected-articles")
async def ingest_selected_articles(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    ingestion_context_factory: IngestionContextFactoryDep,
    infospace_id: int,
    feed_url: str,
    selected_articles: List[Dict[str, Any]],
    bundle_id: Optional[int] = None
) -> Any:
    """
    Ingest selected articles from an RSS feed preview.
    
    Args:
        feed_url: URL of the RSS feed
        selected_articles: List of article objects with at least 'link' and 'title'
        bundle_id: Optional bundle to add articles to
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        if not selected_articles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No articles selected for ingestion"
            )
        
        # Extract URLs from selected articles
        article_urls = [article.get('link') for article in selected_articles if article.get('link')]
        
        if not article_urls:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid article URLs found in selection"
            )
        
        # Ingest articles using bulk URL processing
        opts = {
            "scrape_immediately": True,
            "use_bulk_scraping": True,
            "max_threads": 4,
            "source_type": "rss_selective_ingestion",
            "feed_url": feed_url,
        }
        context = ingestion_context_factory(
            user_id=current_user.id,
            infospace_id=infospace_id,
            options=opts,
        )
        assets = await ingest(
            context,
            article_urls,
            bundle_id=bundle_id,
            options=opts,
        )
        
        return {
            "message": f"Successfully ingested {len(assets)} articles",
            "assets": [AssetRead.model_validate(asset) for asset in assets],
            "feed_url": feed_url,
            "selected_count": len(selected_articles),
            "ingested_count": len(assets)
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Selective article ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Selective article ingestion failed: {str(e)}"
        )

@router.get("/{asset_id}", response_model=AssetRead)
def get_asset(
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    asset_id: int
) -> Any:
    """
    Get a specific asset.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    return AssetRead.model_validate(asset)

@router.get("/{asset_id}/children", response_model=List[AssetRead])
def get_asset_children(
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    asset_id: int,
    skip: int = 0,
    limit: int = 100
) -> Any:
    """
    Get child assets of a specific asset.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
    # Verify parent asset exists and belongs to user
    parent_asset = session.get(Asset, asset_id)
    if not parent_asset or parent_asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parent asset not found"
        )
    
    # Get child assets
    query = select(Asset).where(
        Asset.parent_asset_id == asset_id,
        Asset.infospace_id == infospace_id
    ).offset(skip).limit(limit).order_by(Asset.part_index, Asset.created_at)
    
    children = session.exec(query).all()
    
    return [AssetRead.model_validate(child) for child in children]

@router.put("/{asset_id}", response_model=AssetRead)
def update_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    asset_id: int,
    asset_in: AssetUpdate
) -> Any:
    """
    Update an asset.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    update_data = asset_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(asset, field, value)
    
    session.add(asset)
    session.commit()
    session.refresh(asset)
    
    return AssetRead.model_validate(asset)

@router.delete("/{asset_id}", response_model=Message)
def delete_asset(
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    asset_id: int
) -> Any:
    """
    Delete an asset and its children (explicitly handled for reliability).
    """
    validate_infospace_access(session, infospace_id, current_user.id, require_editor=True)
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Delete children in batches to avoid unbounded memory
    from app.models import AssetChunk, Annotation
    num_children = 0
    batch_size = 1000
    while True:
        batch = session.exec(
            select(Asset).where(Asset.parent_asset_id == asset_id).limit(batch_size)
        ).all()
        if not batch:
            break
        for child in batch:
            session.exec(delete(AssetChunk).where(AssetChunk.asset_id == child.id))
            session.exec(delete(Annotation).where(Annotation.asset_id == child.id))
            session.delete(child)
            num_children += 1
        session.flush()
    
    # Delete related records for parent asset
    from app.models import AssetChunk, Annotation
    session.exec(
        delete(AssetChunk).where(AssetChunk.asset_id == asset_id)
    )
    session.exec(
        delete(Annotation).where(Annotation.asset_id == asset_id)
    )
    
    # Finally delete the parent asset
    session.delete(asset)
    session.commit()
    
    return Message(message=f"Asset {asset_id} and {num_children} children deleted")

class BulkDeleteRequest(BaseModel):
    asset_ids: List[int]

@router.post("/bulk-delete", response_model=Message)
def bulk_delete_assets(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    infospace_id: int,
    request: BulkDeleteRequest
) -> Any:
    """
    Delete multiple assets in one request.
    
    Much more efficient than individual DELETE requests when cleaning up
    multiple assets at once. Validates all assets belong to the infospace
    before deleting any.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
    if not request.asset_ids:
        return Message(message="No assets to delete")
    
    # Get all assets and validate they belong to this infospace
    assets_to_delete = session.exec(
        select(Asset)
        .where(Asset.id.in_(request.asset_ids))
        .where(Asset.infospace_id == infospace_id)
    ).all()
    
    found_ids = {asset.id for asset in assets_to_delete}
    missing_ids = [aid for aid in request.asset_ids if aid not in found_ids]
    
    if missing_ids:
        logger.warning(f"Some assets not found in infospace {infospace_id}: {missing_ids}")
    
    # Delete all assets (cascade will handle children)
    deleted_count = 0
    for asset in assets_to_delete:
        session.delete(asset)
        deleted_count += 1
    
    session.commit()
    
    message = f"Deleted {deleted_count} asset{'s' if deleted_count != 1 else ''}"
    if missing_ids:
        message += f" ({len(missing_ids)} not found)"
    
    logger.info(f"Bulk deleted {deleted_count} assets from infospace {infospace_id}")
    return Message(message=message)

class AssetTransferRequest(BaseModel):
    asset_ids: List[int]
    source_infospace_id: int
    target_infospace_id: int
    should_copy: bool = True  # renamed from 'copy' to avoid shadowing BaseModel.copy()

@router.post("/transfer", response_model=List[AssetRead])
def transfer_assets(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    request: AssetTransferRequest
) -> Any:
    """
    Transfer assets between infospaces.
    
    This endpoint allows you to copy or move multiple assets from one infospace to another.
    When copying (should_copy=True), new assets are created in the target infospace with the same content.
    When moving (should_copy=False), assets are moved by changing their infospace_id.
    
    Args:
        asset_ids: List of asset IDs to transfer
        source_infospace_id: Source infospace ID
        target_infospace_id: Target infospace ID
        should_copy: If True, copy assets (default). If False, move them.
    
    Returns:
        List of transferred assets in the target infospace
    """
    # Validate access to both infospaces
    validate_infospace_access(session, request.source_infospace_id, current_user.id)
    validate_infospace_access(session, request.target_infospace_id, current_user.id)
    
    # Get asset service
    from app.api.modules.content.services import AssetService
    from app.api.modules.foundation_service_providers.registry import get_storage_provider
    from app.core.config import settings
    
    storage_provider = get_storage_provider(settings)
    asset_service = AssetService(session, storage_provider)
    
    # Transfer assets
    transferred_assets = asset_service.transfer_assets(
        asset_ids=request.asset_ids,
        source_infospace_id=request.source_infospace_id,
        target_infospace_id=request.target_infospace_id,
        user_id=current_user.id,
        copy=request.should_copy
    )
    
    if not transferred_assets:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No assets were transferred. Check that assets exist in source infospace."
        )
    
    return [AssetRead.model_validate(asset) for asset in transferred_assets]

@router.get("/supported-types", response_model=Dict[str, List[str]])
def get_supported_content_types() -> Any:
    """
    Get list of supported content types.
    """
    from app.api.modules.content.types import get_supported_content_types as get_types
    return get_types()

@router.post("/bulk-upload-background", response_model=dict)
async def create_assets_background_bulk(
    *,
    infospace_id: int,
    files: List[UploadFile] = File(...),
    options: str = Form("{}"),
    current_user: CurrentUser,
):
    """
    Upload multiple files as individual assets using background processing.
    Returns task IDs for progress tracking.
    """
    logger.info(f"Background bulk upload: {len(files)} files for infospace {infospace_id}")

    # Parse options
    try:
        upload_options = json.loads(options) if options else {}
    except json.JSONDecodeError:
        upload_options = {}

    with Session(engine) as session:
        from app.api.modules.content.handlers import IngestionContext
        from app.api.modules.content.ingest import ingest
        from app.api.modules.foundation_service_providers.registry import get_storage_provider, get_scraping_provider, get_web_search_provider
        from app.api.modules.content.services.asset_service import AssetService
        from app.api.modules.content.services.bundle_service import BundleService

        storage = get_storage_provider(settings)
        scraping = get_scraping_provider(settings)
        try:
            search = get_web_search_provider(settings)
        except Exception:
            search = None
        asset_service = AssetService(session, storage)
        bundle_service = BundleService(session)

        opts = {"process_immediately": False, **upload_options}
        context = IngestionContext(
            session=session,
            storage_provider=storage,
            scraping_provider=scraping,
            search_provider=search,
            asset_service=asset_service,
            bundle_service=bundle_service,
            user_id=current_user.id,
            infospace_id=infospace_id,
            settings=settings,
            options=opts,
        )

        task_ids = []
        asset_ids = []

        for file in files:
            try:
                assets = await ingest(
                    context,
                    file,
                    options=opts,
                )
                asset = assets[0]
                asset_ids.append(asset.id)

                # Track task info
                task_ids.append({
                    "asset_id": asset.id,
                    "filename": file.filename,
                    "status": "queued" if asset.processing_status == ProcessingStatus.PENDING else "complete"
                })
                    
            except Exception as e:
                logger.error(f"Failed to upload {file.filename}: {e}")
                task_ids.append({
                    "asset_id": None,
                    "filename": file.filename,
                    "status": "failed",
                    "error": str(e)
                })
        
        return {
            "message": f"Background upload initiated for {len(files)} files",
            "tasks": task_ids,
            "asset_ids": asset_ids
        }

@router.post("/bulk-urls-background", response_model=dict)
async def create_assets_background_urls(
    *,
    infospace_id: int,
    request: BulkUrlIngestion,
    current_user: CurrentUser,
    session: SessionDep,
):
    """
    Ingest multiple URLs using background processing.
    Creates IngestionJob — @task picks it up via event bus.
    """
    logger.info(f"Background URL ingestion: {len(request.urls)} URLs for infospace {infospace_id}")

    from app.models import IngestionJob, IngestionStatus
    from app.core.events import emit
    job = IngestionJob(
        infospace_id=infospace_id,
        user_id=current_user.id,
        source_locator="bulk_urls",
        kind="bulk_urls",
        status=IngestionStatus.PENDING,
        total_files=len(request.urls),
        cursor_state={
            "stage": "pending", "message": "Queued",
            "progress_pct": 0, "urls": request.urls,
            "base_title": getattr(request, 'base_title', None),
            "scrape_immediately": True,
            "options": {},
        },
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    emit("ingestion_job.created", {"infospace_id": infospace_id})

    return {
        "message": f"Background URL ingestion initiated for {len(request.urls)} URLs",
        "job_id": job.id,
        "url_count": len(request.urls)
    }

@router.post("/bundles/{bundle_id}/add-files-background", response_model=dict)
async def add_files_to_bundle_background(
    *,
    infospace_id: int,
    bundle_id: int,
    _: CheckUploadSizeDep,
    files: List[UploadFile] = File(...),
    options: str = Form("{}"),
    current_user: CurrentUser,
):
    """
    Add files to existing bundle using background processing.
    """
    logger.info(f"Background bundle upload: {len(files)} files to bundle {bundle_id}")

    # Parse options
    try:
        upload_options = json.loads(options) if options else {}
    except json.JSONDecodeError:
        upload_options = {}

    with Session(engine) as session:
        from app.api.modules.content.handlers import IngestionContext
        from app.api.modules.content.ingest import ingest
        from app.api.modules.foundation_service_providers.registry import get_storage_provider, get_scraping_provider, get_web_search_provider
        from app.api.modules.content.services.asset_service import AssetService
        from app.api.modules.content.services.bundle_service import BundleService as BundleServiceCls

        storage = get_storage_provider(settings)
        scraping = get_scraping_provider(settings)
        try:
            search = get_web_search_provider(settings)
        except Exception:
            search = None
        asset_service = AssetService(session, storage)
        bundle_service = BundleServiceCls(session)

        bundle = bundle_service.get_bundle(bundle_id, infospace_id, current_user.id)
        if not bundle:
            raise HTTPException(status_code=404, detail="Bundle not found")

        opts = {"process_immediately": False, **upload_options}
        context = IngestionContext(
            session=session,
            storage_provider=storage,
            scraping_provider=scraping,
            search_provider=search,
            asset_service=asset_service,
            bundle_service=bundle_service,
            user_id=current_user.id,
            infospace_id=infospace_id,
            settings=settings,
            options=opts,
        )

        task_ids = []

        for file in files:
            try:
                assets = await ingest(
                    context,
                    file,
                    bundle_id=bundle_id,
                    options=opts,
                )
                asset = assets[0]
                # ingest() with bundle_id already added to bundle

                # Track task info
                task_ids.append({
                    "asset_id": asset.id,
                    "filename": file.filename,
                    "status": "queued" if asset.processing_status == ProcessingStatus.PENDING else "complete"
                })
                    
            except Exception as e:
                logger.error(f"Failed to upload {file.filename} to bundle: {e}")
                task_ids.append({
                    "asset_id": None,
                    "filename": file.filename,
                    "status": "failed",
                    "error": str(e)
                })
        
        return {
            "message": f"Background upload to bundle initiated for {len(files)} files",
            "tasks": task_ids,
            "bundle_id": bundle_id
        }

@router.get("/tasks/{task_id}/status", response_model=dict)
async def get_task_status(
    task_id: str,
    current_user: CurrentUser
):
    """
    Get the status of a background task.
    """
    try:
        task_result = celery.AsyncResult(task_id)
        
        if task_result.state == 'PENDING':
            return {
                "task_id": task_id,
                "state": "PENDING",
                "status": "Task is waiting to be processed"
            }
        elif task_result.state == 'PROGRESS':
            return {
                "task_id": task_id,
                "state": "PROGRESS",
                "current": task_result.info.get('current', 0),
                "total": task_result.info.get('total', 1),
                "status": task_result.info.get('status', 'Processing...')
            }
        elif task_result.state == 'SUCCESS':
            return {
                "task_id": task_id,
                "state": "SUCCESS",
                "result": task_result.result,
                "status": "Task completed successfully"
            }
        else:  # FAILURE
            return {
                "task_id": task_id,
                "state": "FAILURE",
                "error": str(task_result.info),
                "status": "Task failed"
            }
            
    except Exception as e:
        logger.error(f"Error getting task status for {task_id}: {e}")
        return {
            "task_id": task_id,
            "state": "ERROR",
            "error": str(e),
            "status": "Error retrieving task status"
        }



@router.post("/ingest-rss-feeds-from-awesome", response_model=List[AssetRead])
async def ingest_rss_feeds_from_awesome(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    make_ingestion_context: IngestionContextFactoryDep,
    infospace_id: int,
    request: RSSDiscoveryRequest
) -> Any:
    """
    Discover and ingest RSS feeds from the awesome-rss-feeds repository.
    
    This endpoint will:
    1. Fetch RSS feeds from the specified country
    2. Optionally filter by category
    3. Ingest the feeds and their content
    4. Optionally add to a bundle
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)

        from app.api.modules.content.handlers import RSSHandler

        context = make_ingestion_context(
            user_id=current_user.id,
            infospace_id=infospace_id,
            options=request.options,
        )

        assets = await RSSHandler.ingest_from_awesome_repo(
            context,
            country=request.country,
            category_filter=request.category_filter,
            max_feeds=request.max_feeds,
            max_items_per_feed=request.max_items_per_feed,
            bundle_id=request.bundle_id,
            options=request.options,
        )

        return [AssetRead.model_validate(asset) for asset in assets]

    except Exception as e:
        logger.error(f"RSS feed ingestion from awesome repo failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RSS feed ingestion failed: {str(e)}"
        )


@router.post("/{asset_id}/enrichment/{enricher_name}/retry", response_model=Message)
async def retry_asset_enrichment(
    infospace_id: int,
    asset_id: int,
    enricher_name: str,
    session: SessionDep,
    current_user: CurrentUser,
):
    """Clear enrichment state for an asset so it is eligible for re-enrichment."""
    validate_infospace_access(session, infospace_id, current_user)

    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Asset not in this infospace")

    from app.api.modules.content.enrichers import retry_enrichment
    retry_enrichment(session, asset_id, enricher_name)
    session.commit()

    return Message(message=f"Enrichment '{enricher_name}' reset for asset {asset_id}")