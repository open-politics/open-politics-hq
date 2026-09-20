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
# IngestionJobRead is the canonical job-tracking DTO (defined alongside the job
# routes). Ingest endpoints that mint an IngestionJob return it so the frontend
# tracks progress via the same useIngestionJobs polling infra. No import cycle:
# ingestion_jobs.py imports only models/schemas/access/DI, never routes/assets.
from app.api.routes.ingestion_jobs import IngestionJobRead
from app.api.dependency_injection import (
    SessionDep,
    CurrentUser,
    StorageProviderDep,
    CheckUploadSizeDep,
)
from app.api.modules.identity_infospace_user.access import (
    Access, Capability, Requires, resolve_access,
)
from app.api.modules.foundation_service_providers import resolve
from app.core.config import settings
from sqlalchemy import func
from sqlmodel import select
from app.core.celery_app import celery
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

class IntakeItem(BaseModel):
    """One thing to ingest — exactly one of url/text/query/storage_path says what it
    is (field dispatch → source kind). ``storage_path`` is a pre-staged blob."""
    url: Optional[str] = None
    text: Optional[str] = None
    query: Optional[str] = None
    storage_path: Optional[str] = None
    title: Optional[str] = None
    filename: Optional[str] = None

class IntakeRequest(BaseModel):
    items: List[IntakeItem]
    bundle_id: Optional[int] = None
    bundle_name: Optional[str] = None
    parent_bundle_id: Optional[int] = None

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
    infospace_id: int,
    asset_in: AssetCreate
) -> Any:
    """Author an asset directly from metadata (title, text, blob_path, facets, …).

    Authoring only — no external fetch. To ingest a URL, text, file, or search, POST
    to ``/intake`` (mints an IngestionJob; the ``ingest`` task does the work). A
    blob_path with a processable kind is created PENDING and the processing cascade
    picks it up via ``asset.ingested``; everything else is born READY.
    """
    try:
        from app.api.modules.content.types import detect_asset_kind_from_extension, needs_processing
        from app.api.modules.content.asset_builder import AssetBuilder

        asset_in.user_id = access.user_id
        asset_in.infospace_id = infospace_id

        # Infer kind from the blob extension when the caller left it generic.
        if asset_in.blob_path and asset_in.kind in (None, AssetKind.FILE):
            import os
            detected = detect_asset_kind_from_extension(os.path.splitext(asset_in.blob_path)[1].lower())
            if detected != AssetKind.FILE:
                asset_in.kind = detected

        builder = AssetBuilder(session, access.user_id, infospace_id)
        if asset_in.kind is not None:
            builder.as_kind(asset_in.kind)
        builder.with_title(asset_in.title or "Untitled")
        if asset_in.text_content is not None:
            builder.with_text(asset_in.text_content)
        if asset_in.blob_path:
            # AssetCreate.content_hash is documented "For deduplication" — it is a KEY,
            # not a content assertion, so it only rides along when it describes bytes
            # the builder cannot see. For text the builder derives its own.
            builder.with_blob(asset_in.blob_path, asset_in.content_hash)
        if asset_in.source_identifier:
            builder.with_source(asset_in.source_identifier)
        if asset_in.event_timestamp:
            builder.with_timestamp(asset_in.event_timestamp)
        if asset_in.facets:
            builder.with_facets(**asset_in.facets)
        if asset_in.file_info:
            builder.with_metadata(**asset_in.file_info)

        # A processable blob → PENDING (the cascade expands it); else honor the
        # caller's status, defaulting to READY.
        will_process = (
            bool(asset_in.blob_path) and asset_in.kind is not None
            and needs_processing(asset_in.kind)
        )
        if asset_in.processing_status is not None:
            builder.with_processing_status(asset_in.processing_status)
        elif will_process:
            builder.with_processing_status(ProcessingStatus.PENDING)

        if asset_in.content_hash:
            builder.dedup_on(content_hash=asset_in.content_hash).on_match("skip")
        elif asset_in.source_identifier:
            builder.dedup_on(source_identifier=asset_in.source_identifier).on_match("skip")
        else:
            builder.no_dedup()

        asset = (await builder.build()).asset
        session.commit()
        session.refresh(asset)

        if asset.processing_status == ProcessingStatus.PENDING:
            from app.core.events import emit
            emit("asset.ingested", {"infospace_id": infospace_id})

        return AssetRead.model_validate(asset)

    except HTTPException:
        raise
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
    """Batch create assets — the bulk path for intrinsic parts (CSV rows, PDF pages).

    Identity-bearing ROOT rows are routed through the builder's identity path instead of
    the bulk insert, so a repeated POST is idempotent and cannot violate
    ``ux_asset_live_identity``. Children keep the bulk path: siblings legitimately share
    an identifier (a page's images, an archive's members), and the unique index is scoped
    to roots precisely so that stays legal.
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

    from app.api.modules.content.asset_builder import AssetBuilder

    created: List[Asset] = []
    bulk: List[Asset] = []
    for a in assets:
        if a.parent_asset_id is None and a.source_identifier:
            created.append((await (
                AssetBuilder(session, access.user_id, infospace_id)
                .dedup_on(source_identifier=a.source_identifier)
                .on_match("skip")
                .persist(a)
            )).asset)
        else:
            bulk.append(a)
            created.append(a)

    if bulk:
        await AssetBuilder(session, access.user_id, infospace_id).build_batch(bulk)

    session.commit()
    for a in created:
        session.refresh(a)
    return [AssetRead.model_validate(a) for a in created]


@router.post("/upload", response_model=IngestionJobRead)
async def upload_file(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    _: CheckUploadSizeDep,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    bundle_id: Optional[int] = Form(None),
) -> Any:
    """Stage an uploaded file to storage, then mint an ``upload`` IngestionJob — the
    multipart face of ``/intake`` (JSON intake can't carry bytes). Returns the job;
    the ``ingest`` task detects the kind from the staged blob and the processing
    cascade expands it. Poll the job (or the ``useIngestionJobs`` hook) for progress.
    """
    import os
    import uuid
    from app.api.modules.foundation_service_providers import resolve
    from app.api.modules.content.intake import intake

    file_ext = os.path.splitext(file.filename or "")[1].lower()
    storage_path = f"user_{access.user_id}/{uuid.uuid4()}{file_ext}"
    storage = resolve("storage")
    await storage.upload_file(file, storage_path)

    jobs = intake(
        session, infospace_id=infospace_id, user_id=access.user_id,
        groups={"upload": [{
            "storage_path": storage_path,
            "filename": file.filename,
            "title": title or file.filename,
            "file_info": {
                "original_filename": file.filename,
                "mime_type": getattr(file, "content_type", None),
                "ingestion_method": "file_upload",
            },
        }]},
        dest_id=bundle_id,
    )
    return _job_read(jobs[0])

# /ingest-url and /ingest-text were removed — both collapse into POST /intake
# (url → web source, text → text source). Dialogs post to /intake and track the
# returned IngestionJob via the useIngestionJobs poll path.

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
        from app.api.modules.content.asset_builder import AssetBuilder
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

        article = (await builder.build()).asset

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

@router.post("/bulk-ingest-urls", response_model=IngestionJobRead)
async def bulk_ingest_urls(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    bulk_request: BulkUrlIngestion
) -> Any:
    """Ingest multiple URLs as web assets via the unified ``run_ingestion`` path.

    Mints a single ``web`` IngestionJob; ``run_ingestion`` enumerates the URLs
    (the ``web`` source yields one WEB RawItem per URL), builds a WEB asset per
    URL as PENDING, and ``process_pending`` → ``WebArticle.process`` scrapes each.
    Returns the job so the client can track progress (poll
    ``/ingestion-jobs/{id}`` or the ``useIngestionJobs`` hook). Replaces the old
    sync/≤100 + ``bulk_urls`` split — one job, one source-driven loop, accurate
    BuildOutcome counters (no len()-inflation).
    """
    from app.api.modules.content.intake import intake

    urls = [u.strip() for u in (bulk_request.urls or []) if u and u.strip()]
    if not urls:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No URLs provided.",
        )

    # The web source's read unpacks {urls, title} per spec; WebArticle.process
    # overwrites the title with the scraped <title>, so a per-URL title is moot.
    jobs = intake(
        session, infospace_id=infospace_id, user_id=access.user_id,
        groups={"web": [{"urls": urls, "title": bulk_request.base_title}]},
        dest_id=bulk_request.bundle_id,
    )
    return _job_read(jobs[0])


def _job_read(job) -> IngestionJobRead:
    """IngestionJob → IngestionJobRead, surfacing cursor_state progress fields."""
    d = job.model_dump(mode="json")
    cs = job.cursor_state or {}
    d["progress_pct"] = cs.get("progress_pct", 0)
    d["stage_message"] = cs.get("message", "")
    return IngestionJobRead(**d)


# Field dispatch: which field is present → which source kind. URLs are NOT
# string-classified (all → web); the real kind is decided post-fetch by detect_kind.
_INTAKE_DISPATCH = [
    ("url",          "web",        lambda it: {"url": it.url, "title": it.title}),
    ("query",        "web_search", lambda it: {"query": it.query}),
    ("storage_path", "upload",     lambda it: {"storage_path": it.storage_path,
                                               "filename": it.filename, "title": it.title}),
    ("text",         "text",       lambda it: {"text": it.text, "title": it.title}),
]


@router.post("/intake", response_model=List[IngestionJobRead])
async def create_intake(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    request: IntakeRequest,
) -> Any:
    """Dump anything → ingestion jobs. Each item is field-dispatched to a source kind;
    same-kind items batch into one PENDING IngestionJob (``cursor_state.config.items``);
    ``run_ingestion`` does the work via the uniform ``read`` opener. One destination for
    the whole dump. The single producer the dialogs should call (supersedes the scattered
    per-shape ingest endpoints). File bytes are staged by the caller into ``storage_path``."""
    from app.api.modules.content.tree import resolve_or_create_bundle
    from app.api.modules.content.intake import intake

    if not request.items:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No items to ingest.")

    try:
        dest = resolve_or_create_bundle(
            session, infospace_id, access.user_id,
            bundle_id=request.bundle_id, bundle_name=request.bundle_name,
            parent_bundle_id=request.parent_bundle_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    dest_id = dest.id if dest is not None else None

    groups: Dict[str, List[dict]] = {}
    for it in request.items:
        for field, kind, build in _INTAKE_DISPATCH:
            if getattr(it, field) not in (None, ""):
                groups.setdefault(kind, []).append(build(it))
                break

    if not groups:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="No recognizable items (each needs one of url/text/query/storage_path).",
        )

    jobs = intake(session, infospace_id=infospace_id, user_id=access.user_id,
                  groups=groups, dest_id=dest_id)
    return [_job_read(j) for j in jobs]

@router.post("/ingest-search-results", response_model=IngestSearchResultsResponse)
async def ingest_search_results(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    bulk_request: BulkSearchResultIngestion
) -> Any:
    """Ingest search results through the unified web path. A result whose ``content`` is
    the full article (≥ threshold) carries it inline → ``web.fetch`` passes it through
    (no re-scrape); a short metasearch snippet carries no ``text`` → the web source
    scrapes the URL. One ``web`` IngestionJob; poll it (or the useIngestionJobs hook)."""
    from app.api.modules.content.intake import intake
    from app.api.modules.content.sources import SCRAPE_THRESHOLD

    specs: List[dict] = []
    for result in bulk_request.results:
        if not result.url:
            continue
        spec = {"url": result.url, "title": result.title}
        if len(result.content or "") >= SCRAPE_THRESHOLD:
            spec["text"] = result.content   # full article in hand → passthrough, no re-scrape
        specs.append(spec)

    if not specs:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST,
                            detail="No ingestable results (each needs a url).")

    jobs = intake(session, infospace_id=infospace_id, user_id=access.user_id,
                  groups={"web": specs}, dest_id=bulk_request.bundle_id)
    job = jobs[0] if jobs else None
    return IngestSearchResultsResponse(
        assets=[],   # all async now — the web job builds them; poll scrape_job_id
        scrape_job_id=job.id if job else None,
        scrape_url_count=sum(1 for s in specs if "text" not in s),
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
    if not descriptor or not descriptor.materializer:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Asset type does not support materialization (kind: {asset.kind.value})",
        )

    try:
        return await descriptor.materializer(asset, session, storage_provider)
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

        # Re-extract via the type's processor; persist_children reconciles matched rows
        # in place so their annotations survive.
        from app.api.modules.content.tasks.processing import process_asset
        await process_asset(session, asset, storage=resolve("storage"),
                            scraping=resolve("scraping"), options=reprocess_options)
        
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
        
        # Re-extract; persist_children updates row assets in place (IDs + annotations kept).
        reprocess_options = (asset.file_info or {}).get('processing_options', {})
        from app.api.modules.content.tasks.processing import process_asset
        await process_asset(session, asset, storage=storage_provider,
                            scraping=resolve("scraping"), options=reprocess_options)
        
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
    assets = q.assets()

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

        from app.api.modules.content.sources import rss

        feeds = await rss.discover_feeds(country=country, category=category, limit=limit)

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
        from app.api.modules.content.sources import rss

        preview_data = await rss.preview_feed(feed_url, max_items)
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
    infospace_id: int,
    feed_url: str,
    selected_articles: List[Dict[str, Any]],
    bundle_id: Optional[int] = None
) -> Any:
    """Ingest selected articles from an RSS feed preview as a ``web`` job (the web source
    scrapes each link). Returns the job id to poll."""
    try:
        if not selected_articles:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No articles selected for ingestion",
            )
        specs = [{"url": a["link"], "title": a.get("title")}
                 for a in selected_articles if a.get("link")]
        if not specs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No valid article URLs found in selection",
            )

        from app.api.modules.content.intake import intake
        jobs = intake(session, infospace_id=infospace_id, user_id=access.user_id,
                      groups={"web": specs}, dest_id=bundle_id)
        job = jobs[0] if jobs else None
        return {
            "message": f"Queued {len(specs)} article(s) for ingestion",
            "job_id": job.id if job else None,
            "feed_url": feed_url,
            "selected_count": len(selected_articles),
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
    
    # Hard-destroy through the one tree primitive: descendants, chunks, annotations,
    # graph edges, and version refs — scale-safe (recursive CTE, no IN-list).
    from app.api.modules.content.tree import purge
    destroyed = purge(session, {asset_id})
    session.commit()

    return Message(message=f"Deleted asset {asset_id} ({destroyed} assets removed incl. descendants)")

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
    
    # Hard-destroy through the one tree primitive (descendants + all FK cleanup, scale-safe).
    from app.api.modules.content.tree import purge
    destroyed = purge(session, found_ids) if found_ids else 0
    session.commit()

    message = f"Deleted {len(found_ids)} asset{'s' if len(found_ids) != 1 else ''} ({destroyed} rows incl. descendants)"
    if missing_ids:
        message += f" ({len(missing_ids)} not found)"

    logger.info(f"Bulk deleted {len(found_ids)} assets ({destroyed} rows) from infospace {infospace_id}")
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

    from app.api.modules.content.asset_builder import transfer_assets as _transfer_assets
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
    """Upload N files (optionally a folder tree) + optional text items as ONE intake.

    Each file stages to storage and becomes an ``upload`` spec carrying its relative
    folder as ``path``; the upload source's ``ensure_path_bundles`` rebuilds the folder
    tree as sub-bundles, and a ``.zip`` is detected ARCHIVE (by extension) and dissolved
    in place by the ARCHIVE type — no client-side extraction. Text items become ``text``
    specs. Async — returns the job(s) to poll.
    """
    import os as _os
    import uuid as _uuid
    from app.api.modules.content.tree import resolve_or_create_bundle
    from app.api.modules.content.intake import intake

    if relative_paths is not None and len(relative_paths) != len(files):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"relative_paths length ({len(relative_paths)}) must match files length ({len(files)})",
        )

    text_payload: List[dict] = []
    if text_items:
        try:
            text_payload = json.loads(text_items) or []
        except json.JSONDecodeError:
            text_payload = []

    if not files and not text_payload:
        return {"message": "No files to process", "jobs": [], "job_ids": []}

    storage = resolve("storage")

    with Session(engine) as session:
        try:
            dest = resolve_or_create_bundle(
                session, infospace_id, access.user_id,
                bundle_id=parent_bundle_id, bundle_name=bundle_name,
            )
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))
        dest_id = dest.id if dest is not None else None

        # Stage each file to storage → an `upload` spec carrying its relative folder as
        # `path`. The upload source rebuilds the folder tree (ensure_path_bundles); a zip
        # rides in as an ARCHIVE asset the ARCHIVE type dissolves — no pre-extraction.
        upload_specs: List[dict] = []
        for idx, uf in enumerate(files):
            rel = (((relative_paths[idx] if relative_paths else uf.filename) or uf.filename
                    or f"file_{idx}").replace("\\", "/").lstrip("/"))
            ext = _os.path.splitext(uf.filename or "")[1].lower()
            storage_path = f"user_{access.user_id}/{_uuid.uuid4()}{ext}"
            await storage.upload_file(uf, storage_path)
            name = _os.path.basename(rel) or (uf.filename or "file")
            upload_specs.append({
                "storage_path": storage_path,
                "filename": name,
                "title": name,
                "path": _os.path.dirname(rel),
            })

        text_specs = [
            {"text": c, "title": (t.get("title") or "Text").strip() or "Text"}
            for t in text_payload
            if (c := (t.get("content") or "").strip())
        ]

        groups: Dict[str, List[dict]] = {}
        if upload_specs:
            groups["upload"] = upload_specs
        if text_specs:
            groups["text"] = text_specs

        jobs = intake(session, infospace_id=infospace_id, user_id=access.user_id,
                      groups=groups, dest_id=dest_id)

    return {
        "message": (f"Queued {len(upload_specs)} file(s)"
                    + (f" + {len(text_specs)} text item(s)" if text_specs else "")
                    + " for ingestion"),
        "jobs": [_job_read(j).model_dump(mode="json") for j in jobs],
        "job_ids": [j.id for j in jobs],
        "root_bundle_id": dest_id,
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

    from app.api.modules.content.intake import intake
    jobs = intake(
        session, infospace_id=infospace_id, user_id=access.user_id,
        groups={"web": [{"urls": request.urls, "title": getattr(request, "base_title", None)}]},
        dest_id=getattr(request, "bundle_id", None),
    )
    job = jobs[0] if jobs else None

    return {
        "message": f"Background URL ingestion initiated for {len(request.urls)} URLs",
        "job_id": job.id if job else None,
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



@router.post("/ingest-rss-feeds-from-awesome", response_model=List[IngestionJobRead])
async def ingest_rss_feeds_from_awesome(
    *,
    session: SessionDep,
    access: Access = Requires(Capability.INGEST, scope=None),
    infospace_id: int,
    request: RSSDiscoveryRequest
) -> Any:
    """Discover feeds from the awesome-rss-feeds repo (the ``rss`` source's module fn) and
    ingest them as a single ``rss`` job whose source reads every feed spec. Returns the
    job to poll."""
    from app.api.modules.content.sources import rss
    from app.api.modules.content.intake import intake

    feeds = await rss.discover_feeds(
        country=request.country, category=request.category_filter, limit=request.max_feeds,
    )
    feed_urls = [f["url"] for f in feeds if f.get("url")][: request.max_feeds]
    if not feed_urls:
        return []
    specs = [{"feed_url": u, "max_items": request.max_items_per_feed} for u in feed_urls]
    jobs = intake(session, infospace_id=infospace_id, user_id=access.user_id,
                  groups={"rss": specs}, dest_id=request.bundle_id)
    return [_job_read(j) for j in jobs]


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