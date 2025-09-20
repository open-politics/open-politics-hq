"""
Content Processing Tasks
=======================

Background tasks for content processing using the ContentService.

These tasks handle:
- Heavy content processing (large CSV/PDF files)
- Asset reprocessing with new options
- Bulk URL ingestion
- Retry mechanisms for failed processing
"""

import logging
import asyncio
from typing import Optional, Dict, Any, List
from sqlmodel import Session, select, func

from app.core.celery_app import celery
from app.core.db import engine
from app.models import Asset, AssetKind, ProcessingStatus
from app.api.providers.factory import create_storage_provider, create_scraping_provider
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.asset_service import AssetService
from app.core.config import settings
from app.api.tasks.utils import run_async_in_celery

logger = logging.getLogger(__name__)

@celery.task(bind=True, name="process_content")
def process_content(self, asset_id: int, options: Optional[Dict[str, Any]] = None):
    """
    Background task to process content for an asset.
    
    Args:
        asset_id: ID of the asset to process
        options: Processing options (delimiter, encoding, timeout, etc.)
    """
    logger.info(f"[Content Processing] Starting for asset {asset_id}")
    
    with Session(engine) as session:
        try:
            # Create services
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            asset_service = AssetService(session, storage_provider)
            content_service = ContentIngestionService(session)
            
            # Get the asset using AssetService
            asset = asset_service.get_asset(asset_id)
            if not asset:
                return {"success": False, "error": "Asset not found"}
            
            # Process the content using the helper function for proper event loop management
            run_async_in_celery(content_service._process_content, asset, options or {})
            
            # Count child assets created using proper query patterns
            child_count = session.exec(
                select(func.count(Asset.id)).where(Asset.parent_asset_id == asset_id)
            ).one()
            
            logger.info(f"[Content Processing] Success: created {child_count} child assets")
            return {"success": True, "child_count": child_count}
            
        except Exception as e:
            logger.exception(f"[Content Processing] Error: {e}")
            return {"success": False, "error": str(e)}

@celery.task(bind=True, name="reprocess_content")
def reprocess_content(self, asset_id: int, options: Optional[Dict[str, Any]] = None):
    """
    Background task to reprocess content with new options.
    
    Args:
        asset_id: ID of the asset to reprocess
        options: New processing options
    """
    logger.info(f"[Content Reprocessing] Starting for asset {asset_id}")
    
    with Session(engine) as session:
        try:
            # Create services
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            asset_service = AssetService(session, storage_provider)
            content_service = ContentIngestionService(session)
            
            # Get the asset using AssetService
            asset = asset_service.get_asset(asset_id)
            if not asset:
                return {"success": False, "error": "Asset not found"}
            
            # Reprocess the content using the helper function for proper event loop management
            run_async_in_celery(content_service._process_content, asset, options or {})
            
            # Count child assets created using proper query patterns
            child_count = session.exec(
                select(func.count(Asset.id)).where(Asset.parent_asset_id == asset_id)
            ).one()
            
            logger.info(f"[Content Reprocessing] Success: created {child_count} child assets")
            return {"success": True, "child_count": child_count}
            
        except Exception as e:
            logger.exception(f"[Content Reprocessing] Error: {e}")
            return {"success": False, "error": str(e)}

@celery.task(bind=True, name="ingest_bulk_urls")
def ingest_bulk_urls(
    self, 
    urls: List[str], 
    infospace_id: int, 
    user_id: int, 
    base_title: Optional[str] = None,
    scrape_immediately: bool = True,
    options: Optional[Dict[str, Any]] = None
):
    """
    Background task for bulk URL ingestion.
    
    Args:
        urls: List of URLs to ingest
        infospace_id: Target infospace ID
        user_id: User performing the ingestion
        base_title: Base title for generated assets
        scrape_immediately: Whether to scrape content immediately
        options: Scraping options
    """
    logger.info(f"[Bulk URL Ingestion] Processing {len(urls)} URLs for user {user_id}")
    
    async def process_urls():
        with Session(engine) as session:
            # Create content service
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            content_service = ContentIngestionService(session)
            
            assets_created = []
            errors = []
            
            for i, url in enumerate(urls):
                try:
                    url_title = f"{base_title} #{i+1}" if base_title else None
                    url_options = (options or {}).copy()
                    url_options.update({
                        "batch_index": i,
                        "batch_total": len(urls)
                    })
                    
                    assets = await content_service.ingest_content(
                        locator=url,
                        infospace_id=infospace_id,
                        user_id=user_id,
                        title=url_title,
                        options=url_options
                    )
                    assets_created.append(assets[0].id)
                    
                    # Small delay to be respectful to servers
                    if scrape_immediately:
                        await asyncio.sleep(0.5)
                    
                except Exception as e:
                    logger.error(f"Failed to process URL {url}: {e}")
                    errors.append({"url": url, "error": str(e)})
                    continue
            
            return assets_created, errors
    
    try:
        assets_created, errors = run_async_in_celery(process_urls)
        
        logger.info(f"[Bulk URL Ingestion] Completed: {len(assets_created)} successful, {len(errors)} failed")
        return {
            "success": True,
            "assets_created": len(assets_created),
            "asset_ids": assets_created,
            "errors": errors
        }
        
    except Exception as e:
        logger.exception(f"[Bulk URL Ingestion] Critical error: {e}")
        return {"success": False, "error": str(e)}

@celery.task(bind=True, name="retry_failed_content_processing")
def retry_failed_content_processing(self, infospace_id: int, max_retries: int = 3):
    """
    Background task to retry processing for assets with failed processing status.
    
    Args:
        infospace_id: Infospace to check for failed assets
        max_retries: Maximum number of retry attempts
    """
    logger.info(f"[Retry Failed Processing] Checking infospace {infospace_id}")
    
    with Session(engine) as session:
        try:
            # Create services
            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            
            # Find assets with failed processing status using proper query patterns
            failed_assets = session.exec(
                select(Asset).where(
                    Asset.infospace_id == infospace_id,
                    Asset.processing_status == ProcessingStatus.FAILED
                )
            ).all()
            
            if not failed_assets:
                logger.info("No failed assets found to retry")
                return {"success": True, "retried_count": 0}
            
            # Create content service
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            content_service = ContentIngestionService(session)
            
            retried_count = 0
            success_count = 0
            
            for asset in failed_assets:
                try:
                    # Check if we've already retried too many times
                    retry_count = asset.source_metadata.get('retry_count', 0)
                    if retry_count >= max_retries:
                        logger.info(f"Asset {asset.id} exceeded max retries ({max_retries})")
                        continue
                    
                    logger.info(f"Retrying processing for asset {asset.id} (attempt {retry_count + 1})")
                    
                    # Update retry count
                    asset.source_metadata['retry_count'] = retry_count + 1
                    session.add(asset)
                    session.flush()
                    
                    # Retry processing
                    run_async_in_celery(content_service._process_content, asset, {})
                    success_count += 1
                    retried_count += 1
                    
                except Exception as e:
                    logger.error(f"Retry failed for asset {asset.id}: {e}")
                    retried_count += 1
                    continue
            
            logger.info(f"[Retry Failed Processing] Completed: {success_count}/{retried_count} successful retries")
            return {
                "success": True,
                "retried_count": retried_count,
                "success_count": success_count
            }
            
        except Exception as e:
            logger.exception(f"[Retry Failed Processing] Critical error: {e}")
            return {"success": False, "error": str(e)}

@celery.task(bind=True, name="clean_orphaned_child_assets")
def clean_orphaned_child_assets(self, infospace_id: int):
    """
    Background task to clean up orphaned child assets.
    
    Args:
        infospace_id: Infospace to clean
    """
    logger.info(f"[Clean Orphaned Assets] Starting for infospace {infospace_id}")
    
    with Session(engine) as session:
        try:
            # Create services
            storage_provider = create_storage_provider(settings)
            asset_service = AssetService(session, storage_provider)
            
            # Find child assets whose parent no longer exists using proper query patterns
            orphaned_assets = session.exec(
                select(Asset).where(
                    Asset.infospace_id == infospace_id,
                    Asset.parent_asset_id.is_not(None),
                    ~Asset.parent_asset_id.in_(
                        select(Asset.id).where(Asset.infospace_id == infospace_id)
                    )
                )
            ).all()
            
            if not orphaned_assets:
                logger.info("No orphaned child assets found")
                return {"success": True, "cleaned_count": 0}
            
            cleaned_count = len(orphaned_assets)
            
            # Note: Using direct session.delete() for bulk cleanup efficiency
            # rather than AssetService.delete_asset() which does individual lookups
            for asset in orphaned_assets:
                session.delete(asset)
            
            session.commit()
            
            logger.info(f"[Clean Orphaned Assets] Cleaned {cleaned_count} orphaned assets")
            return {"success": True, "cleaned_count": cleaned_count}
            
        except Exception as e:
            logger.exception(f"[Clean Orphaned Assets] Error: {e}")
            session.rollback()
            return {"success": False, "error": str(e)}

@celery.task(bind=True, name="ingest_bulk_files")
def ingest_bulk_files(
    self, 
    file_paths: List[str], 
    infospace_id: int, 
    user_id: int, 
    process_immediately: bool = True,
    options: Optional[Dict[str, Any]] = None
):
    """
    Background task for bulk file ingestion.
    
    Args:
        file_paths: List of temporary file paths to process
        infospace_id: Target infospace ID
        user_id: User performing the ingestion
        process_immediately: Whether to process content immediately
        options: Processing options
    """
    logger.info(f"[Bulk File Ingestion] Processing {len(file_paths)} files for user {user_id}")
    
    async def process_files():
        with Session(engine) as session:
            # Create content service
            storage_provider = create_storage_provider(settings)
            scraping_provider = create_scraping_provider(settings)
            content_service = ContentIngestionService(session)
            
            assets_created = []
            errors = []
            
            for i, file_path in enumerate(file_paths):
                try:
                    file_options = (options or {}).copy()
                    file_options.update({
                        "batch_index": i,
                        "batch_total": len(file_paths)
                    })
                    
                    # Open the temporary file and process it
                    import os
                    from starlette.datastructures import UploadFile
                    
                    with open(file_path, 'rb') as file:
                        upload_file = UploadFile(
                            file=file,
                            filename=os.path.basename(file_path)
                        )
                        
                        assets = await content_service.ingest_content(
                            locator=upload_file,
                            infospace_id=infospace_id,
                            user_id=user_id,
                            title=os.path.basename(file_path),
                            options={"process_immediately": process_immediately, **file_options}
                        )
                        assets_created.append(assets[0].id)
                    
                    # Clean up temporary file
                    try:
                        os.unlink(file_path)
                    except OSError:
                        pass  # Ignore cleanup errors
                    
                except Exception as e:
                    logger.error(f"Failed to process file {file_path}: {e}")
                    errors.append({"file_path": file_path, "error": str(e)})
                    continue
            
            return assets_created, errors
    
    try:
        assets_created, errors = run_async_in_celery(process_files)
        
        logger.info(f"[Bulk File Ingestion] Completed: {len(assets_created)} successful, {len(errors)} failed")
        return {
            "success": True,
            "assets_created": len(assets_created),
            "asset_ids": assets_created,
            "errors": errors
        }
        
    except Exception as e:
        logger.exception(f"[Bulk File Ingestion] Critical error: {e}")
        return {"success": False, "error": str(e)} 