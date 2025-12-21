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
)
from app.schemas import AssetRead, AssetCreate, AssetUpdate, AssetsOut, Message
from app.api.deps import (
    SessionDep,
    CurrentUser,
    StorageProviderDep,
    ContentIngestionServiceDep,
    BundleServiceDep,
)
from app.api.services.service_utils import validate_infospace_access
from app.api.providers.factory import create_scraping_provider, create_storage_provider
from app.core.config import settings
from sqlmodel import select, delete
from app.api.tasks.content_tasks import process_content, ingest_bulk_urls
from app.core.celery_app import celery
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.bundle_service import BundleService
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
    source_metadata: Optional[Dict[str, Any]] = None

class BulkSearchResultIngestion(BaseModel):
    """Bulk ingestion of search results with their pre-fetched content"""
    results: List[SearchResultItem]
    bundle_id: Optional[int] = None

@router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentIngestionServiceDep,
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
            assets = await content_service.ingest_content(
                locator=locator,
                infospace_id=infospace_id,
                user_id=current_user.id,
                title=asset_in.title,
                options=options
            )
            asset = assets[0] if assets else None
        else:
            # No locator - create asset record
            from app.api.services.asset_service import AssetService
            from app.api.processors import detect_asset_kind_from_extension, needs_processing
            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            
            asset_in.user_id = current_user.id
            asset_in.infospace_id = infospace_id
            
            # Detect kind from blob_path if provided (fixes frontend upload issue)
            if asset_in.blob_path:
                import os
                file_ext = os.path.splitext(asset_in.blob_path)[1].lower()
                detected_kind = detect_asset_kind_from_extension(file_ext)
                if detected_kind != AssetKind.FILE:
                    # Override with detected kind (unless it's generic FILE)
                    asset_in.kind = detected_kind
                    logger.info(f"Detected asset kind '{detected_kind.value}' from blob_path: {asset_in.blob_path}")
            
            # Create the asset
            asset = asset_service.create_asset(asset_in)
            
            # Process if needed (using centralized detection)
            if asset.blob_path and needs_processing(asset.kind):
                try:
                    await content_service._process_content(asset, options)
                except Exception as e:
                    logger.error(f"Processing failed for asset {asset.id}: {e}")
                    # Don't fail the request, asset is already created

        if not asset:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from provided data.")

        # Auto-embed if infospace has embedding enabled
        infospace = session.get(Infospace, infospace_id)
        if infospace and infospace.embedding_model and asset.text_content:
            from app.api.tasks.embed import embed_asset_task
            embed_asset_task.delay(
                asset_id=asset.id,
                infospace_id=infospace_id,
                user_id=current_user.id
            )
            logger.debug(f"Triggered auto-embedding for asset {asset.id}")

        return AssetRead.model_validate(asset)
        
    except Exception as e:
        logger.error(f"Asset creation failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Asset creation failed: {str(e)}"
        )

@router.post("/upload", response_model=AssetRead)
async def upload_file(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    storage_provider: StorageProviderDep,
    infospace_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    process_immediately: bool = Form(True)
) -> Any:
    """
    Upload a file and create an asset.
    
    Uses FileHandler directly for clean, testable file ingestion.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        # Use FileHandler directly (new pattern)
        from app.api.handlers import FileHandler, IngestionContext
        from app.api.services.asset_service import AssetService
        from app.api.services.bundle_service import BundleService
        
        scraping_provider = create_scraping_provider(settings)
        asset_service = AssetService(session, storage_provider)
        bundle_service = BundleService(session)
        
        context = IngestionContext(
            session=session,
            storage_provider=storage_provider,
            scraping_provider=scraping_provider,
            search_provider=None,
            asset_service=asset_service,
            bundle_service=bundle_service,
            user_id=current_user.id,
            infospace_id=infospace_id,
            settings=settings,
            options={"process_immediately": process_immediately}
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
        
        # Use WebHandler directly (new pattern)
        from app.api.handlers import WebHandler
        
        handler = WebHandler(session)
        asset = await handler.handle(
            url=url,
            infospace_id=infospace_id,
            user_id=current_user.id,
            title=title,
            options={"scrape_immediately": scrape_immediately}
        )

        if not asset:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from URL.")
        
        return AssetRead.model_validate(asset)
        
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
        
        # Use TextHandler directly (new pattern)
        from app.api.handlers import TextHandler
        
        handler = TextHandler(session)
        asset = await handler.handle(
            text=text_content,
            infospace_id=infospace_id,
            user_id=current_user.id,
            title=title,
            event_timestamp=event_timestamp,
            options={}
        )
        
        if not asset:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Failed to create asset from text.")

        return AssetRead.model_validate(asset)
        
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
    content_service: ContentIngestionServiceDep,
    infospace_id: int,
    composition: ArticleComposition
) -> Any:
    """
    Compose a free-form article with embedded assets and bundle references.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        article = await content_service.compose_article(
            title=composition.title,
            content=composition.content,
            infospace_id=infospace_id,
            user_id=current_user.id,
            summary=composition.summary,
            embedded_assets=composition.embedded_assets,
            referenced_bundles=composition.referenced_bundles,
            metadata=composition.metadata,
            event_timestamp=composition.event_timestamp
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
    content_service: ContentIngestionServiceDep,
    infospace_id: int,
    bulk_request: BulkUrlIngestion
) -> Any:
    """
    Ingest multiple URLs as separate assets.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        if len(bulk_request.urls) > 100:
            # For large batches, use background task
            from app.api.tasks.content_tasks import ingest_bulk_urls
            ingest_bulk_urls.delay(
                urls=bulk_request.urls,
                infospace_id=infospace_id,
                user_id=current_user.id,
                base_title=bulk_request.base_title,
                scrape_immediately=bulk_request.scrape_immediately
            )
            return {"message": f"Bulk ingestion of {len(bulk_request.urls)} URLs started in background"}
        
        # For smaller batches, process immediately
        assets = await content_service.ingest_content(
            locator=bulk_request.urls,
            infospace_id=infospace_id,
            user_id=current_user.id,
            options={
                "base_title": bulk_request.base_title,
                "scrape_immediately": bulk_request.scrape_immediately
            }
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
    content_service: ContentIngestionServiceDep,
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
        
        from app.api.services.asset_builder import AssetBuilder
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
                        **(result.source_metadata or {})
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
    
    Generates a CSV file from the row assets and uploads it to storage,
    then updates the parent asset with the blob_path.
    """
    # Validate infospace access
    validate_infospace_access(session, infospace_id, current_user.id)
    
    # Get the CSV container asset
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Asset {asset_id} not found"
        )
    
    if asset.kind != AssetKind.CSV:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Asset is not a CSV container (kind: {asset.kind.value})"
        )
    
    # Get columns from metadata
    columns = asset.source_metadata.get("columns", [])
    if not columns:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV container has no column schema defined"
        )
    
    # Get all child rows ordered by part_index
    child_rows = session.exec(
        select(Asset)
        .where(Asset.parent_asset_id == asset_id)
        .where(Asset.kind == AssetKind.CSV_ROW)
        .order_by(Asset.part_index)
    ).all()
    
    if len(child_rows) == 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV container has no rows to materialize"
        )
    
    # Generate CSV content
    import csv
    from io import StringIO
    
    csv_buffer = StringIO()
    writer = csv.DictWriter(csv_buffer, fieldnames=columns)
    writer.writeheader()
    
    for row_asset in child_rows:
        row_data = row_asset.source_metadata.get("original_row_data", {})
        # Ensure all columns are present
        row_dict = {col: row_data.get(col, "") for col in columns}
        writer.writerow(row_dict)
    
    csv_content = csv_buffer.getvalue()
    csv_buffer.close()
    
    # Upload to blob storage
    filename = f"{asset.title.replace(' ', '_')}.csv"
    csv_bytes = csv_content.encode('utf-8')
    
    # Generate object name (storage path)
    import uuid
    object_name = f"infospaces/{infospace_id}/csv_materialized/{uuid.uuid4().hex[:10]}_{filename}"
    
    await storage_provider.upload_from_bytes(
        file_bytes=csv_bytes,
        object_name=object_name,
        filename=filename,
        content_type='text/csv'
    )
    
    blob_path = object_name
    
    # Update the asset with the blob_path
    asset.blob_path = blob_path
    if asset.source_metadata is None:
        asset.source_metadata = {}
    asset.source_metadata['materialized_at'] = datetime.now(timezone.utc).isoformat()
    asset.source_metadata['materialized_row_count'] = len(child_rows)
    session.add(asset)
    session.commit()
    session.refresh(asset)
    
    logger.info(f"Materialized CSV {asset_id}: {len(child_rows)} rows -> {blob_path}")
    
    return asset



@router.post("/{asset_id}/reprocess", response_model=Message)
async def reprocess_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentIngestionServiceDep,
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
        await content_service.reprocess_content(asset, reprocess_options)
        
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
    content_service: ContentIngestionServiceDep,
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
        reprocess_options = asset.source_metadata.get('processing_options', {}) if asset.source_metadata else {}
        await content_service.reprocess_content(asset, reprocess_options)
        
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
    
    # Build query
    query = select(Asset).where(
        Asset.infospace_id == infospace_id
    )
    
    # For child assets, we need to be more permissive with user filtering
    # since child assets might be created by system processes
    if parent_asset_id is not None:
        # Verify the parent asset belongs to the user
        parent_asset = session.get(Asset, parent_asset_id)
        if not parent_asset or parent_asset.infospace_id != infospace_id or parent_asset.user_id != current_user.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent asset not found"
            )
        query = query.where(Asset.parent_asset_id == parent_asset_id)
    else:
        # For top-level assets, filter by user
        query = query.where(Asset.user_id == current_user.id)
    
    # Get total count
    count_query = select(Asset.id).where(
        Asset.infospace_id == infospace_id
    )
    if parent_asset_id is not None:
        count_query = count_query.where(Asset.parent_asset_id == parent_asset_id)
    else:
        count_query = count_query.where(Asset.user_id == current_user.id)
    
    total_count = len(session.exec(count_query).all())
    
    # Get assets with pagination
    query = query.offset(skip).limit(limit).order_by(Asset.created_at.desc())
    assets = session.exec(query).all()
    
    return AssetsOut(
        data=[AssetRead.model_validate(asset) for asset in assets],
        count=total_count
    )

@router.get("/discover-rss-feeds")
async def discover_rss_feeds(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentIngestionServiceDep,
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
        
        feeds = await content_service.discover_rss_feeds_from_awesome_repo(
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
    content_service: ContentIngestionServiceDep,
    infospace_id: int,
    feed_url: str,
    max_items: int = 20
) -> Any:
    """
    Preview the content of an RSS feed.
    """
    # Use the content ingestion service to fetch and parse the feed
    try:
        preview_data = await content_service.preview_rss_feed(feed_url, max_items)
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
    content_service: ContentIngestionServiceDep,
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
        assets = await content_service.ingest_content(
            locator=article_urls,
            infospace_id=infospace_id,
            user_id=current_user.id,
            bundle_id=bundle_id,
            options={
                "scrape_immediately": True,
                "use_bulk_scraping": True,
                "max_threads": 4,
                "source_type": "rss_selective_ingestion",
                "feed_url": feed_url
            }
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
    validate_infospace_access(session, infospace_id, current_user.id)
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Get all children before deletion
    children = session.exec(
        select(Asset).where(Asset.parent_asset_id == asset_id)
    ).all()
    num_children = len(children)
    
    # Explicitly delete children first (including their related records)
    for child in children:
        # Delete related records for child
        from app.models import AssetChunk, Annotation
        session.exec(
            delete(AssetChunk).where(AssetChunk.asset_id == child.id)
        )
        session.exec(
            delete(Annotation).where(Annotation.asset_id == child.id)
        )
        session.delete(child)
    
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
    from app.api.services.asset_service import AssetService
    from app.api.providers.factory import create_storage_provider
    from app.core.config import settings
    
    storage_provider = create_storage_provider(settings)
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
def get_supported_content_types(
    content_service: ContentIngestionServiceDep
) -> Any:
    """
    Get list of supported content types.
    """
    return content_service.get_supported_content_types()

@router.post("/bulk-upload-background", response_model=dict)
async def create_assets_background_bulk(
    *,
    infospace_id: int,
    files: List[UploadFile] = File(...),
    options: str = Form("{}"),
    current_user: CurrentUser,
    content_service: ContentIngestionServiceDep
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
    
    # Create content service
    with Session(engine) as session:
        storage_provider = create_storage_provider(settings)
        scraping_provider = create_scraping_provider(settings)
        content_service_instance = ContentIngestionService(session=session)
        
        # Upload files and create assets
        task_ids = []
        asset_ids = []
        
        for file in files:
            try:
                # Create asset and queue background processing
                # ContentIngestionService handles processing logic internally
                assets = await content_service_instance.ingest_content(
                    locator=file,
                    infospace_id=infospace_id,
                    user_id=current_user.id,
                    options={"process_immediately": False, **upload_options}
                )
                asset = assets[0]
                asset_ids.append(asset.id)
                
                # Track task info (note: actual task_id is managed internally by ContentIngestionService)
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
    current_user: CurrentUser
):
    """
    Ingest multiple URLs using background processing.
    Returns task ID for progress tracking.
    """
    logger.info(f"Background URL ingestion: {len(request.urls)} URLs for infospace {infospace_id}")
    
    # Trigger background task
    task = ingest_bulk_urls.delay(
        urls=request.urls,
        infospace_id=infospace_id,
        user_id=current_user.id,
        base_title=getattr(request, 'base_title', None),
        scrape_immediately=True,
        options={}
    )
    
    return {
        "message": f"Background URL ingestion initiated for {len(request.urls)} URLs",
        "task_id": task.id,
        "url_count": len(request.urls)
    }

@router.post("/bundles/{bundle_id}/add-files-background", response_model=dict)
async def add_files_to_bundle_background(
    *,
    infospace_id: int,
    bundle_id: int,
    files: List[UploadFile] = File(...),
    options: str = Form("{}"),
    current_user: CurrentUser,
    content_service: ContentIngestionServiceDep
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
    
    # Verify bundle exists
    with Session(engine) as session:
        bundle_service = BundleService(session)
        bundle = bundle_service.get_bundle(bundle_id, infospace_id, current_user.id)
        if not bundle:
            raise HTTPException(status_code=404, detail="Bundle not found")
        
        # Create content service
        content_service_instance = ContentIngestionService(session=session)
        
        # Upload files and add to bundle
        task_ids = []
        
        for file in files:
            try:
                # Create asset and queue background processing
                # ContentIngestionService handles processing logic internally
                assets = await content_service_instance.ingest_content(
                    locator=file,
                    infospace_id=infospace_id,
                    user_id=current_user.id,
                    options={"process_immediately": False, **upload_options}
                )
                asset = assets[0]
                
                # Add to bundle
                bundle_service.add_asset_to_bundle(
                    bundle_id=bundle_id,
                    asset_id=asset.id,
                    infospace_id=infospace_id,
                    user_id=current_user.id
                )
                
                # Track task info (note: actual task_id is managed internally by ContentIngestionService)
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
    content_service: ContentIngestionServiceDep,
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
        
        assets = await content_service.ingest_rss_feeds_from_awesome_repo(
            country=request.country,
            infospace_id=infospace_id,
            user_id=current_user.id,
            category_filter=request.category_filter,
            max_feeds=request.max_feeds,
            max_items_per_feed=request.max_items_per_feed,
            bundle_id=request.bundle_id,
            options=request.options
        )
        
        return [AssetRead.model_validate(asset) for asset in assets]
        
    except Exception as e:
        logger.error(f"RSS feed ingestion from awesome repo failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"RSS feed ingestion failed: {str(e)}"
        ) 