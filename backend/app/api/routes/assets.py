"""Routes for assets."""
import logging
from pathlib import Path
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
    ProcessingServiceDep,
    CheckUploadSizeDep,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
from app.api.modules.foundation_service_providers import resolve
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


class IngestSearchResultsResponse(BaseModel):
    """Response for /ingest-search-results.

    Search providers split into two groups:

    - Tavily-style: result ``content`` already holds the full article text.
      Those become assets inline and are returned in ``assets``.
    - SearXNG-style: result ``content`` is a 200-300 char metasearch snippet.
      Those URLs are handed off to the existing ``run_bulk_url_import`` @task,
      which scrapes them in the background. ``scrape_job_id`` points at the
      ``IngestionJob`` so the client can subscribe to its progress stream
      (``/streams/ingestion_job/{job_id}``) and surface live updates.

    ``scrape_job_id`` is null when no URLs needed scraping (pure-Tavily batch).
    """
    assets: List[AssetRead]
    scrape_job_id: Optional[int] = None
    scrape_url_count: int = 0


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
    access: Access = Requires(Capability.INGEST, scope=None),
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
                user_id=access.user_id,
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

            context = ingestion_context_factory(access.user_id, infospace_id, {})
            asset_in.user_id = access.user_id
            asset_in.infospace_id = infospace_id

            if asset_in.blob_path:
                import os
                file_ext = os.path.splitext(asset_in.blob_path)[1].lower()
                detected_kind = detect_asset_kind_from_extension(file_ext)
                if detected_kind != AssetKind.FILE:
                    asset_in.kind = detected_kind
                    logger.info(f"Detected asset kind '{detected_kind.value}' from blob_path: {asset_in.blob_path}")

            from app.api.modules.content.services.asset_builder import AssetBuilder
            builder = AssetBuilder(session, access.user_id, infospace_id)
            if asset_in.kind is not None:
                builder.as_kind(asset_in.kind)
            builder.with_title(asset_in.title or "Untitled")
            if asset_in.text_content is not None:
                builder.with_text(asset_in.text_content)
            if asset_in.blob_path:
                builder.with_blob(asset_in.blob_path)
            if asset_in.source_identifier:
                builder.with_source(asset_in.source_identifier)
            if asset_in.content_hash:
                builder.with_content_hash(asset_in.content_hash)
            if asset_in.event_timestamp:
                builder.with_timestamp(asset_in.event_timestamp)
            if asset_in.facets:
                builder.with_facets(**asset_in.facets)
            if asset_in.file_info:
                builder.with_metadata(**asset_in.file_info)
            if asset_in.processing_status is not None:
                builder.with_processing_status(asset_in.processing_status)
            # Dedup by content_hash if caller supplied one; otherwise keep as-is.
            if asset_in.content_hash:
                builder.dedup_on(content_hash=asset_in.content_hash).on_match("skip")
            elif asset_in.source_identifier:
                builder.dedup_on(source_identifier=asset_in.source_identifier).on_match("skip")
            else:
                builder.no_dedup()
            asset = await builder.build()
            session.commit()
            session.refresh(asset)

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
async def batch_create_assets(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    request: BatchAssetCreateRequest,
) -> List[AssetRead]:
    """
    Batch create assets. Single pattern for CSV rows, PDF pages, directory imports, RSS articles.
    Uses AssetBuilder.build_batch — flushes every 500, single commit at the end.
    """
    if not request.assets:
        return []

    # Materialize Asset blueprints from the incoming AssetCreate payloads.
    # Filter to valid Asset columns (excludes relationships, chunks, etc.).
    valid = set(Asset.model_fields.keys()) - {
        "chunks", "infospace", "user", "source", "bundle", "annotations",
        "parent_asset", "children_assets", "previous_asset", "next_versions",
    }
    assets: List[Asset] = []
    for ac in request.assets:
        data = ac.model_dump(exclude_unset=True)
        data["user_id"] = access.user_id
        data["infospace_id"] = infospace_id
        if "processing_status" not in data:
            data["processing_status"] = ProcessingStatus.READY
        if not data.get("title"):
            data["title"] = "Untitled"
        assets.append(Asset(**{k: v for k, v in data.items() if k in valid}))

    from app.api.modules.content.services.asset_builder import AssetBuilder
    builder = AssetBuilder(session, access.user_id, infospace_id)
    created = await builder.build_batch(assets)
    session.commit()
    for a in created:
        session.refresh(a)
    return [AssetRead.model_validate(a) for a in created]


@router.post("/upload", response_model=AssetRead)
async def upload_file(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
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
        from app.api.modules.content.handlers import FileHandler

        context = make_ingestion_context(
            access.user_id, infospace_id, {"process_immediately": process_immediately}
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
    access: Access = Requires(Capability.INGEST, scope=None),
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
        from app.api.modules.content.handlers import WebHandler

        context = make_ingestion_context(
            access.user_id, infospace_id, {"scrape_immediately": scrape_immediately}
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
    access: Access = Requires(Capability.INGEST, scope=None),
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
        from app.api.modules.content.handlers import TextHandler

        options = {"event_timestamp": event_timestamp} if event_timestamp else {}
        context = make_ingestion_context(access.user_id, infospace_id, options)
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
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    composition: ArticleComposition
) -> Any:
    """
    Compose a free-form article with embedded assets and bundle references.
    """
    try:
        from app.api.modules.content.services.asset_builder import AssetBuilder
        from app.models import Asset, AssetKind, ProcessingStatus
        from sqlmodel import select

        # Build parent article
        file_info = {
            "content_format": "markdown",
            "content_source": "user",
            "composition_type": "free_form_article",
            "ingestion_method": "article_composition",
        }
        if composition.embedded_assets:
            file_info["embedded_assets"] = composition.embedded_assets
        if composition.referenced_bundles:
            file_info["referenced_bundles"] = composition.referenced_bundles
            file_info["bundle_references"] = len(composition.referenced_bundles)
        if composition.metadata:
            file_info.update(composition.metadata)

        facets = {"summary": composition.summary} if composition.summary else {}

        builder = (
            AssetBuilder(session, access.user_id, infospace_id)
            .as_kind(AssetKind.ARTICLE)
            .with_title(composition.title)
            .with_text(composition.content)
            .with_metadata(**file_info)
            .with_processing_status(ProcessingStatus.READY)
            .no_dedup()  # user-composed articles are always fresh
        )
        if facets:
            builder = builder.with_facets(**facets)
        if composition.event_timestamp:
            builder = builder.with_timestamp(composition.event_timestamp)

        article = await builder.build()

        # Create embed-reference child assets (stub refs to other assets)
        if composition.embedded_assets:
            children: list[Asset] = []
            for i, embed in enumerate(composition.embedded_assets):
                target_id = embed.get("asset_id")
                if not target_id:
                    continue
                referenced = session.get(Asset, target_id)
                if not referenced or referenced.infospace_id != infospace_id:
                    logger.warning(f"Embedded asset {target_id} not found/accessible")
                    continue
                children.append(Asset(
                    kind=AssetKind.TEXT,
                    title=f"Embed: {embed.get('caption', referenced.title)}",
                    text_content=f"Reference to: {referenced.title}",
                    user_id=access.user_id,
                    infospace_id=infospace_id,
                    processing_status=ProcessingStatus.READY,
                    part_index=i,
                    file_info={
                        "embed_type": "asset_reference",
                        "target_asset_id": target_id,
                        "embed_mode": embed.get("mode", "card"),
                        "embed_size": embed.get("size", "medium"),
                        "caption": embed.get("caption"),
                        "position": embed.get("position", i),
                        "ingestion_method": "article_embed",
                    },
                ))
            if children:
                child_builder = AssetBuilder(session, access.user_id, infospace_id)
                await child_builder.build_children(article.id, children)

        session.commit()
        session.refresh(article)
        logger.info(f"Composed article {article.id}")

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
    access: Access = Requires(Capability.INGEST, scope=None),
    ingestion_context_factory: IngestionContextFactoryDep,
    infospace_id: int,
    bulk_request: BulkUrlIngestion
) -> Any:
    """
    Ingest multiple URLs as separate assets.
    """
    try:
        if len(bulk_request.urls) > 100:
            # For large batches, create IngestionJob — @task picks it up via event
            from app.models import IngestionJob, IngestionStatus
            from app.core.events import emit
            job = IngestionJob(
                infospace_id=infospace_id,
                user_id=access.user_id,
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
            user_id=access.user_id,
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

@router.post("/ingest-search-results", response_model=IngestSearchResultsResponse)
async def ingest_search_results(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    bundle_service: BundleServiceDep,
    infospace_id: int,
    bulk_request: BulkSearchResultIngestion
) -> Any:
    """
    Ingest search results, splitting by whether scraping is needed.

    Per result:
    - ``len(content) >= SCRAPE_THRESHOLD`` → Tavily-style with pre-fetched
      full text. Built into an asset inline and returned in ``assets``.
    - Below threshold → SearXNG-style snippet. URL is queued for the
      ``run_bulk_url_import`` @task to scrape via Newspaper4k. The client
      gets a ``scrape_job_id`` and can subscribe to the job's stream for
      live progress.
    """
    # 800 chars: well above any SearXNG metasearch snippet (~150-300 chars)
    # and well below Tavily's raw_content (multi-thousand chars). Avoids both
    # false positives (over-scraping Tavily) and false negatives (storing
    # SearXNG snippets as if they were articles).
    SCRAPE_THRESHOLD = 800

    try:
        from app.api.modules.content.services import AssetBuilder
        from app.api.modules.content.handlers.search_handler import _compose_search_result
        from app.core.tree import copy as tree_copy
        from app.schemas import SearchResult
        from app.models import IngestionJob, IngestionStatus
        from app.core.events import emit

        created_assets: List[Any] = []
        urls_to_scrape: List[str] = []
        failed_count = 0

        for idx, result in enumerate(bulk_request.results):
            content = result.content or ""
            # Short snippet → defer to background scraper. The URL is the only
            # thing the @task needs; it builds the asset itself via WebHandler.
            if len(content) < SCRAPE_THRESHOLD and result.url:
                urls_to_scrape.append(result.url)
                continue

            try:
                search_result = SearchResult(
                    title=result.title,
                    url=result.url,
                    content=result.content,
                    score=result.score,
                    provider=result.provider or "unknown",
                    raw_data={
                        "raw_content": result.content,
                        **(result.file_info or {}),
                        **(result.facets or {}),
                    },
                )
                builder = AssetBuilder(session, access.user_id, infospace_id)
                builder = _compose_search_result(builder, search_result, "ingested search results")
                asset = await (
                    builder
                    .with_metadata(
                        ingestion_rank=idx + 1,
                        ingestion_source="search_result_ingestor",
                        ingestion_batch=datetime.now(timezone.utc).isoformat(),
                    )
                    .build()
                )
                created_assets.append(asset)

                if bulk_request.bundle_id:
                    try:
                        tree_copy(session, asset_ids=[asset.id], to=bulk_request.bundle_id)
                    except Exception as bundle_error:
                        logger.warning(f"Failed to add asset {asset.id} to bundle: {bundle_error}")

                logger.info(f"✓ Created ARTICLE asset from search result: {result.title}")

            except Exception as e:
                failed_count += 1
                logger.error(f"Failed to ingest search result '{result.title}': {e}")
                continue

        session.commit()

        scrape_job_id: Optional[int] = None
        if urls_to_scrape:
            # Hand off to the existing run_bulk_url_import @task. Same primitive
            # the >100-URL branch of /ingest-urls uses; we just submit smaller
            # batches and let the task stream progress via ctx.job_progress.
            job = IngestionJob(
                infospace_id=infospace_id,
                user_id=access.user_id,
                source_locator="bulk_urls",
                kind="bulk_urls",
                status=IngestionStatus.PENDING,
                total_files=len(urls_to_scrape),
                cursor_state={
                    "stage": "pending",
                    "message": f"Queued {len(urls_to_scrape)} URLs for scraping",
                    "progress_pct": 0,
                    "urls": urls_to_scrape,
                    "base_title": None,
                    "scrape_immediately": True,
                    "options": {"bundle_id": bulk_request.bundle_id} if bulk_request.bundle_id else {},
                },
            )
            session.add(job)
            session.commit()
            session.refresh(job)
            emit("ingestion_job.created", {"infospace_id": infospace_id})
            scrape_job_id = job.id
            logger.info(f"Queued IngestionJob {scrape_job_id} for {len(urls_to_scrape)} URLs")

        logger.info(
            f"Ingest split: {len(created_assets)} inline, {len(urls_to_scrape)} queued, {failed_count} failed"
        )

        return IngestSearchResultsResponse(
            assets=[AssetRead.model_validate(asset) for asset in created_assets],
            scrape_job_id=scrape_job_id,
            scrape_url_count=len(urls_to_scrape),
        )

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
    access: Access = Requires(Capability.COMPUTE, scope=None),
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
    access: Access = Requires(Capability.COMPUTE, scope=None),
    processing_service: ProcessingServiceDep,
    infospace_id: int,
    asset_id: int,
    options: ReprocessOptions
) -> Any:
    """
    Reprocess an asset with new options.
    """
    try:
        
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
    access: Access = Requires(Capability.INGEST, scope=None),
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
    access: Access = Requires(scope=None),
    infospace_id: int = 0,
    skip: int = 0,
    limit: int = 100,
    parent_asset_id: Optional[int] = None
) -> Any:
    """
    Retrieve assets for an infospace.
    """
    if parent_asset_id is not None:
        parent_asset = session.get(Asset, parent_asset_id)
        if not parent_asset or parent_asset.infospace_id != infospace_id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Parent asset not found"
            )

    from app.api.modules.content.query import AssetQuery

    q = (
        AssetQuery(session, infospace_id)
        .scope(access.scope)
        .parent_asset(parent_asset_id)
        .user_id(None)  # all infospace assets visible to any collaborator
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
    access: Access = Requires(scope=None),
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
    access: Access = Requires(scope=None),
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
    access: Access = Requires(Capability.INGEST, scope=None),
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
            user_id=access.user_id,
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
    access: Access = Requires(scope=None),
    infospace_id: int = 0,
    asset_id: int = 0,
) -> Any:
    """
    Get a specific asset.
    """
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    access.require_in_scope("asset_ids", asset_id)

    result = AssetRead.model_validate(asset)
    # Strip blob_path for scoped users who don't have download permission
    if access.scope is not None and not access.can_download(asset_id):
        result.blob_path = None
    return result

@router.get("/{asset_id}/children", response_model=List[AssetRead])
def get_asset_children(
    session: SessionDep,
    access: Access = Requires(scope=None),
    infospace_id: int = 0,
    asset_id: int = 0,
    skip: int = 0,
    limit: int = 100,
) -> Any:
    """
    Get child assets of a specific asset.
    """
    
    # Verify parent asset exists and belongs to user
    parent_asset = session.get(Asset, asset_id)
    if not parent_asset or parent_asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Parent asset not found"
        )
    access.require_in_scope("asset_ids", asset_id)

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
    access: Access = Requires(Capability.ORGANIZE, scope=None),
    infospace_id: int,
    asset_id: int,
    asset_in: AssetUpdate
) -> Any:
    """
    Update an asset.
    """
    
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
    access: Access = Requires(Capability.DELETE, scope=None),
    infospace_id: int = 0,
    asset_id: int = 0,
) -> Any:
    """
    Delete an asset and its children (explicitly handled for reliability).
    """
    
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
    access: Access = Requires(Capability.DELETE, scope=None),
    infospace_id: int,
    request: BulkDeleteRequest
) -> Any:
    """
    Delete multiple assets in one request.

    Much more efficient than individual DELETE requests when cleaning up
    multiple assets at once. Validates all assets belong to the infospace
    before deleting any.
    """
    
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
async def transfer_assets(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    request: AssetTransferRequest
) -> Any:
    """
    Transfer assets between infospaces.
    Validates organize capability on source, ingest capability on target.
    """
    # Cross-infospace: resolve access for both sides
    resolve_access(session, request.source_infospace_id, current_user, Capability.ORGANIZE)
    resolve_access(session, request.target_infospace_id, current_user, Capability.INGEST)

    from app.api.modules.content.asset_ops import transfer_assets as _transfer_assets
    transferred_assets = await _transfer_assets(
        session,
        asset_ids=request.asset_ids,
        source_infospace_id=request.source_infospace_id,
        target_infospace_id=request.target_infospace_id,
        user_id=current_user.id,
        copy=request.should_copy,
    )
    session.commit()
    for a in transferred_assets:
        session.refresh(a)

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

_ARCHIVE_EXTS = (".tar.gz", ".tar.bz2", ".tgz", ".tbz2", ".zip", ".tar")

def _is_archive_filename(name: str) -> bool:
    n = (name or "").lower()
    return any(n.endswith(ext) for ext in _ARCHIVE_EXTS)

def _archive_stem(name: str) -> str:
    n = (name or "").lower()
    for ext in _ARCHIVE_EXTS:
        if n.endswith(ext):
            return name[: -len(ext)]
    return Path(name).stem


@router.post("/bulk-upload-background", response_model=dict)
async def create_assets_background_bulk(
    *,
    infospace_id: int,
    files: List[UploadFile] = File(default_factory=list),
    relative_paths: Optional[List[str]] = Form(None),
    bundle_name: Optional[str] = Form(None),
    parent_bundle_id: Optional[int] = Form(None),
    text_items: Optional[str] = Form(None),
    options: str = Form("{}"),
    access: Access = Requires(Capability.INGEST, scope=None),
):
    """
    Upload N files — optionally as a nested Bundle tree.

    Modes (by which form fields are present):
    - `relative_paths` provided → build Bundle tree from directory structure. Each
      unique directory becomes a Bundle chained via `parent_bundle_id`. Files land
      in their parent Bundle.
    - `parent_bundle_id` → root is an existing bundle (subbundles nest under it).
    - `bundle_name` → a new root Bundle is created by that name.
    - If neither and paths share one top-level folder → that folder is root.
    - If none of the above → files become individual top-level assets (legacy flat).

    Zips (`.zip/.tar/.tar.gz/...`) dissolve into the tree: extracted in-place under
    a bundle named after the zip's stem. The zip itself is not retained as an asset.

    Returns `{tasks[], asset_ids[], bundles_created[]}` for per-item UI feedback.
    """
    import tempfile
    import os as _os
    from starlette.datastructures import UploadFile as StarletteUploadFile
    from app.api.modules.content.handlers.archive_handler import ArchiveHandler
    from app.schemas import BundleCreate

    logger.info(f"Bulk upload: {len(files)} files, paths={'yes' if relative_paths else 'no'}, "
                f"bundle_name={bundle_name!r}, parent_bundle_id={parent_bundle_id}")

    try:
        upload_options = json.loads(options) if options else {}
    except json.JSONDecodeError:
        upload_options = {}

    if relative_paths is not None and len(relative_paths) != len(files):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"relative_paths length ({len(relative_paths)}) must match files length ({len(files)})",
        )

    with tempfile.TemporaryDirectory(prefix="bulk_upload_") as workdir:
        # ── Zip pre-pass ────────────────────────────────────────────────────
        # Build list of (source, rel_path) where source is either UploadFile or disk path.
        expanded: List[tuple[Any, str]] = []
        for idx, uf in enumerate(files):
            raw_path = (relative_paths[idx] if relative_paths else uf.filename) or uf.filename or f"file_{idx}"
            rel_path = raw_path.replace("\\", "/").lstrip("/")
            if _is_archive_filename(uf.filename or ""):
                arc_path = _os.path.join(workdir, f"arc_{idx}_{Path(uf.filename).name}")
                with open(arc_path, "wb") as fh:
                    while True:
                        chunk = await uf.read(8 * 1024 * 1024)
                        if not chunk:
                            break
                        fh.write(chunk)
                await uf.close()
                extract_dir = _os.path.join(workdir, f"ext_{idx}")
                try:
                    await ArchiveHandler.extract_archive(arc_path, extract_dir)
                except Exception as e:
                    logger.error(f"Archive extraction failed for {uf.filename}: {e}")
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Failed to extract archive {uf.filename!r}: {e}",
                    )
                parent_dir = _os.path.dirname(rel_path)
                stem = _archive_stem(Path(uf.filename).name)
                archive_rel = (f"{parent_dir}/{stem}" if parent_dir else stem).strip("/")
                for root_dir, _dirs, fns in _os.walk(extract_dir):
                    for fn in fns:
                        abs_p = _os.path.join(root_dir, fn)
                        sub = _os.path.relpath(abs_p, extract_dir).replace(_os.sep, "/")
                        expanded.append((abs_p, f"{archive_rel}/{sub}"))
            else:
                expanded.append((uf, rel_path))

        # Parse text items early so text-only submits skip the file path cleanly.
        _text_payload: List[dict] = []
        if text_items:
            try:
                _text_payload = json.loads(text_items) or []
            except json.JSONDecodeError:
                _text_payload = []

        if not expanded and not _text_payload:
            return {"message": "No files to process", "tasks": [], "asset_ids": [], "bundles_created": []}

        # ── Process (root resolution + tree build + ingest) ─────────────────
        with Session(engine) as session:
            from app.api.modules.content.handlers import IngestionContext
            from app.api.modules.content.ingest import ingest
            from app.api.modules.content.services.bundle_service import BundleService

            storage = resolve("storage", session=session)
            scraping = resolve("scraping", session=session)
            try:
                search = resolve("web_search", infospace_id=infospace_id, session=session)
            except Exception:
                search = None
            bundle_service = BundleService(session)

            opts = {"process_immediately": False, **upload_options}
            context = IngestionContext(
                session=session,
                storage_provider=storage,
                scraping_provider=scraping,
                search_provider=search,
                bundle_service=bundle_service,
                user_id=access.user_id,
                infospace_id=infospace_id,
                settings=settings,
                options=opts,
            )

            bundles_created: List[dict] = []
            # "" → root bundle id (0 == no root bundle; files become top-level)
            dir_to_bundle: Dict[str, int] = {}

            from app.api.modules.content.destination import resolve_or_create_bundle
            try:
                root = resolve_or_create_bundle(
                    session, infospace_id, access.user_id,
                    bundle_id=parent_bundle_id, bundle_name=bundle_name,
                )
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))

            if root is not None:
                dir_to_bundle[""] = root.id
                if bundle_name:  # only record as "created" when we made a new bundle
                    bundles_created.append({"id": root.id, "name": root.name, "parent_bundle_id": None})
            else:
                # Fallback: if every path starts with the same top folder, use it as root.
                tops = {p.split("/", 1)[0] for _, p in expanded if "/" in p}
                flats = [p for _, p in expanded if "/" not in p]
                if tops and not flats and len(tops) == 1:
                    top = tops.pop()
                    auto_root = bundle_service.create_bundle(
                        bundle_in=BundleCreate(name=top),
                        infospace_id=infospace_id,
                        user_id=access.user_id,
                    )
                    dir_to_bundle[""] = auto_root.id
                    bundles_created.append({"id": auto_root.id, "name": auto_root.name, "parent_bundle_id": None})
                    expanded = [(f, p[len(top) + 1:]) for f, p in expanded]
                else:
                    dir_to_bundle[""] = 0  # no root bundle — legacy flat behavior

            def _ensure_dir(dir_path: str) -> Optional[int]:
                """Create bundles along dir_path as needed, memoize, return leaf bundle id (or None for rootless)."""
                if dir_path == "":
                    bid = dir_to_bundle.get("", 0)
                    return bid if bid else None
                if dir_path in dir_to_bundle:
                    bid = dir_to_bundle[dir_path]
                    return bid if bid else None
                parts = dir_path.split("/")
                accum = ""
                parent_id = dir_to_bundle.get("", 0)
                for i, part in enumerate(parts):
                    accum = part if i == 0 else f"{accum}/{part}"
                    if accum in dir_to_bundle:
                        parent_id = dir_to_bundle[accum]
                        continue
                    create_parent = parent_id if parent_id else None
                    b = bundle_service.create_bundle(
                        bundle_in=BundleCreate(name=part, parent_bundle_id=create_parent),
                        infospace_id=infospace_id,
                        user_id=access.user_id,
                    )
                    dir_to_bundle[accum] = b.id
                    bundles_created.append({"id": b.id, "name": b.name, "parent_bundle_id": create_parent})
                    parent_id = b.id
                return parent_id

            # ── Ingest each file ────────────────────────────────────────────
            task_results: List[dict] = []
            asset_ids: List[int] = []

            for file_ref, rel_path in expanded:
                dir_path = _os.path.dirname(rel_path).strip("/")
                filename = _os.path.basename(rel_path) or "file"
                upload_obj: Optional[Any] = None
                opened_handle = None
                try:
                    bundle_id_for_file = _ensure_dir(dir_path)
                    if isinstance(file_ref, StarletteUploadFile):
                        upload_obj = file_ref
                    else:
                        opened_handle = open(file_ref, "rb")
                        upload_obj = StarletteUploadFile(filename=filename, file=opened_handle)

                    assets = await ingest(
                        context, upload_obj,
                        title=filename,
                        bundle_id=bundle_id_for_file,
                        options=opts,
                    )
                    # `ingest` → `tree_copy` issues an UPDATE but doesn't commit;
                    # without this the session rollback on exit would drop the link.
                    session.commit()
                    asset = assets[0]
                    asset_ids.append(asset.id)
                    task_results.append({
                        "asset_id": asset.id,
                        "filename": filename,
                        "relative_path": rel_path,
                        "status": "queued" if asset.processing_status == ProcessingStatus.PENDING else "complete",
                    })
                except Exception as e:
                    logger.exception(f"Failed to ingest {rel_path}: {e}")
                    task_results.append({
                        "asset_id": None,
                        "filename": filename,
                        "relative_path": rel_path,
                        "status": "failed",
                        "error": str(e),
                    })
                finally:
                    if opened_handle is not None:
                        try:
                            opened_handle.close()
                        except Exception:
                            pass

            # ── Text items (optional) ──────────────────────────────────────
            # Run sync alongside file processing: they share the same resolved
            # destination bundle and land via the same ingest() primitive.
            text_payload = _text_payload
            root_id_for_text = dir_to_bundle.get("") or None
            for t in text_payload:
                title = (t.get("title") or "").strip() or "Text"
                content = (t.get("content") or "").strip()
                if not content:
                    continue
                try:
                    assets = await ingest(
                        context, content,
                        title=title,
                        bundle_id=root_id_for_text,
                        options=opts,
                    )
                    session.commit()
                    a = assets[0]
                    asset_ids.append(a.id)
                    task_results.append({
                        "asset_id": a.id, "filename": title,
                        "relative_path": title, "status": "complete",
                    })
                except Exception as e:
                    logger.exception(f"Failed to ingest text item {title!r}: {e}")
                    task_results.append({
                        "asset_id": None, "filename": title,
                        "relative_path": title, "status": "failed", "error": str(e),
                    })

            return {
                "message": f"Upload initiated for {len(expanded)} files"
                           + (f" + {len(text_payload)} text items" if text_payload else ""),
                "tasks": task_results,
                "asset_ids": asset_ids,
                "bundles_created": bundles_created,
                "root_bundle_id": dir_to_bundle.get("") or None,
            }

@router.post("/bulk-urls-background", response_model=dict)
async def create_assets_background_urls(
    *,
    infospace_id: int,
    request: BulkUrlIngestion,
    access: Access = Requires(Capability.INGEST, scope=None),
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
        user_id=access.user_id,
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
    access: Access = Requires(Capability.INGEST, scope=None),
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
        from app.api.modules.content.handlers import RSSHandler

        context = make_ingestion_context(
            user_id=access.user_id,
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
    access: Access = Requires(Capability.COMPUTE, scope=None),
):
    """Clear enrichment state and kick the enricher for an asset (or its children)."""
    from app.api.modules.content.enrichers import (
        retry_enrichment,
        enrich_ocr, enrich_geocoding, enrich_hash,
        enrich_language, enrich_quality_score, enrich_embedding,
    )

    _ENRICHER_FNS = {
        "ocr": enrich_ocr, "geocoding": enrich_geocoding,
        "hash": enrich_hash, "language_detection": enrich_language,
        "quality_score": enrich_quality_score, "embedding": enrich_embedding,
    }

    fn = _ENRICHER_FNS.get(enricher_name)
    if not fn:
        raise HTTPException(status_code=404, detail=f"Unknown enricher '{enricher_name}'")

    asset = session.get(Asset, asset_id)
    if not asset:
        raise HTTPException(status_code=404, detail="Asset not found")
    if asset.infospace_id != infospace_id:
        raise HTTPException(status_code=404, detail="Asset not in this infospace")

    # For container assets (e.g. PDF), target children instead
    target_ids = []
    if asset.is_container:
        from sqlmodel import select
        children = session.exec(
            select(Asset.id).where(Asset.parent_asset_id == asset_id)
        ).all()
        target_ids = list(children)
    else:
        target_ids = [asset_id]

    for tid in target_ids:
        retry_enrichment(session, tid, enricher_name)
    session.commit()

    # Kick the enricher via @task direct invocation
    if target_ids:
        fn.delay(target_ids, infospace_id)

    count = len(target_ids)
    return Message(message=f"Enrichment '{enricher_name}' triggered for {count} asset(s)")