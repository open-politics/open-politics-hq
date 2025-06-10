"""Routes for assets."""
import logging
from typing import Any, List, Optional, Dict
from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, status, BackgroundTasks, UploadFile, File, Form
from pydantic import BaseModel
import json

from app.models import (
    Asset,
    Source,
    SourceStatus,
)
from app.schemas import AssetRead, AssetCreate, AssetUpdate, AssetsOut, Message
from app.api.deps import (
    SessionDep,
    CurrentUser,
    StorageProviderDep,
    ContentServiceDep,
)
from app.api.services.service_utils import validate_infospace_access
from app.api.providers.factory import create_scraping_provider, create_storage_provider
from app.core.config import settings
from sqlmodel import select
from app.api.tasks.content_tasks import process_content, ingest_bulk_urls
from app.core.celery_app import celery
from app.api.services.content_service import ContentService
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

class ReprocessOptions(BaseModel):
    delimiter: Optional[str] = None
    encoding: Optional[str] = "utf-8"
    skip_rows: Optional[int] = 0
    max_rows: Optional[int] = None
    timeout: Optional[int] = 30

@router.post("", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=AssetRead, status_code=status.HTTP_201_CREATED)
async def create_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentServiceDep,
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
        
        # Route based on content type
        if asset_in.source_identifier and (
            asset_in.source_identifier.startswith('http://') or 
            asset_in.source_identifier.startswith('https://')
        ):
            # Handle URL ingestion
            asset = await content_service.ingest_url(
                url=asset_in.source_identifier,
                infospace_id=infospace_id,
                user_id=current_user.id,
                title=asset_in.title,
                scrape_immediately=True
            )
        elif asset_in.text_content:
            # Handle text content ingestion
            asset = content_service.ingest_text(
                text_content=asset_in.text_content,
                infospace_id=infospace_id,
                user_id=current_user.id,
                title=asset_in.title,
                event_timestamp=asset_in.event_timestamp
            )
        else:
            # Handle basic asset creation (fallback to AssetService for compatibility)
            from app.api.services.asset_service import AssetService
            asset_service = AssetService(session, content_service.storage)
            
            # Ensure required fields are set
            asset_in.user_id = current_user.id
            asset_in.infospace_id = infospace_id
            
            asset = asset_service.create_asset(asset_in)
        
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
    content_service: ContentServiceDep,
    infospace_id: int,
    file: UploadFile = File(...),
    title: Optional[str] = Form(None),
    process_immediately: bool = Form(True)
) -> Any:
    """
    Upload a file and create an asset.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        asset = await content_service.ingest_file(
            file=file,
            infospace_id=infospace_id,
            user_id=current_user.id,
            title=title,
            process_immediately=process_immediately
        )
        
        return AssetRead.model_validate(asset)
        
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
    content_service: ContentServiceDep,
    infospace_id: int,
    url: str,
    title: Optional[str] = None,
    scrape_immediately: bool = True
) -> Any:
    """
    Ingest content from a URL.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        asset = await content_service.ingest_url(
            url=url,
            infospace_id=infospace_id,
            user_id=current_user.id,
            title=title,
            scrape_immediately=scrape_immediately
        )
        
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
    content_service: ContentServiceDep,
    infospace_id: int,
    text_content: str,
    title: Optional[str] = None,
    event_timestamp: Optional[datetime] = None
) -> Any:
    """
    Ingest direct text content.
    """
    try:
        validate_infospace_access(session, infospace_id, current_user.id)
        
        asset = content_service.ingest_text(
            text_content=text_content,
            infospace_id=infospace_id,
            user_id=current_user.id,
            title=title,
            event_timestamp=event_timestamp
        )
        
        return AssetRead.model_validate(asset)
        
    except Exception as e:
        logger.error(f"Text ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Text ingestion failed: {str(e)}"
        )

@router.post("/bulk-ingest-urls", response_model=List[AssetRead])
async def bulk_ingest_urls(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentServiceDep,
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
        assets = await content_service.ingest_bulk_urls(
            urls=bulk_request.urls,
            infospace_id=infospace_id,
            user_id=current_user.id,
            base_title=bulk_request.base_title,
            scrape_immediately=bulk_request.scrape_immediately
        )
        
        return [AssetRead.model_validate(asset) for asset in assets]
        
    except Exception as e:
        logger.error(f"Bulk URL ingestion failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Bulk URL ingestion failed: {str(e)}"
        )

@router.post("/{asset_id}/reprocess", response_model=Message)
async def reprocess_asset(
    *,
    session: SessionDep,
    current_user: CurrentUser,
    content_service: ContentServiceDep,
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
        Asset.infospace_id == infospace_id,
        Asset.user_id == current_user.id
    )
    
    if parent_asset_id is not None:
        query = query.where(Asset.parent_asset_id == parent_asset_id)
    
    # Get total count
    count_query = select(Asset.id).where(
        Asset.infospace_id == infospace_id,
        Asset.user_id == current_user.id
    )
    if parent_asset_id is not None:
        count_query = count_query.where(Asset.parent_asset_id == parent_asset_id)
    
    total_count = len(session.exec(count_query).all())
    
    # Get assets with pagination
    query = query.offset(skip).limit(limit).order_by(Asset.created_at.desc())
    assets = session.exec(query).all()
    
    return AssetsOut(
        data=[AssetRead.model_validate(asset) for asset in assets],
        count=total_count
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
    Delete an asset and its children.
    """
    validate_infospace_access(session, infospace_id, current_user.id)
    
    asset = session.get(Asset, asset_id)
    if not asset or asset.infospace_id != infospace_id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Asset not found"
        )
    
    # Delete children first
    children = session.exec(
        select(Asset).where(Asset.parent_asset_id == asset_id)
    ).all()
    
    for child in children:
        session.delete(child)
    
    # Delete the asset itself
    session.delete(asset)
    session.commit()
    
    return Message(message=f"Asset {asset_id} and {len(children)} children deleted")

@router.get("/supported-types", response_model=Dict[str, List[str]])
def get_supported_content_types(
    content_service: ContentServiceDep
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
    current_user: CurrentUser
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
        content_service = ContentService(session, storage_provider, scraping_provider)
        
        # Upload files and create assets
        task_ids = []
        asset_ids = []
        
        for file in files:
            try:
                # Create asset immediately (fast operation)
                asset = await content_service.ingest_file(
                    file=file,
                    infospace_id=infospace_id,
                    user_id=current_user.id,
                    process_immediately=False,  # Don't process yet
                    options=upload_options
                )
                asset_ids.append(asset.id)
                
                # Trigger background processing if needed
                if content_service._needs_processing(asset.kind):
                    task = process_content.delay(asset.id, upload_options)
                    task_ids.append({
                        "asset_id": asset.id,
                        "task_id": task.id,
                        "filename": file.filename
                    })
                else:
                    task_ids.append({
                        "asset_id": asset.id,
                        "task_id": None,
                        "filename": file.filename,
                        "status": "complete"
                    })
                    
            except Exception as e:
                logger.error(f"Failed to upload {file.filename}: {e}")
                task_ids.append({
                    "asset_id": None,
                    "task_id": None,
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
    current_user: CurrentUser
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
        storage_provider = create_storage_provider(settings)
        scraping_provider = create_scraping_provider(settings)
        content_service = ContentService(session, storage_provider, scraping_provider)
        
        # Upload files and add to bundle
        task_ids = []
        
        for file in files:
            try:
                # Create asset
                asset = await content_service.ingest_file(
                    file=file,
                    infospace_id=infospace_id,
                    user_id=current_user.id,
                    process_immediately=False,
                    options=upload_options
                )
                
                # Add to bundle
                bundle_service.add_asset_to_bundle(
                    bundle_id=bundle_id,
                    asset_id=asset.id,
                    infospace_id=infospace_id,
                    user_id=current_user.id
                )
                
                # Trigger background processing if needed
                if content_service._needs_processing(asset.kind):
                    task = process_content.delay(asset.id, upload_options)
                    task_ids.append({
                        "asset_id": asset.id,
                        "task_id": task.id,
                        "filename": file.filename
                    })
                else:
                    task_ids.append({
                        "asset_id": asset.id,
                        "task_id": None,
                        "filename": file.filename,
                        "status": "complete"
                    })
                    
            except Exception as e:
                logger.error(f"Failed to upload {file.filename} to bundle: {e}")
                task_ids.append({
                    "asset_id": None,
                    "task_id": None,
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