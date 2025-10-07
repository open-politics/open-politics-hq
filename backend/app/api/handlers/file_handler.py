"""
File Handler
============

Handles file uploads and routes them through AssetBuilder.
"""

import os
import uuid
import logging
from typing import Optional, Dict, Any, List, Optional
from fastapi import UploadFile
from datetime import datetime, timezone

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.services.asset_builder import AssetBuilder
from app.api.processors import (
    ProcessingContext, 
    get_processor, 
    should_process_immediately,
    detect_asset_kind_from_extension,
    needs_processing,
)
from .base import BaseHandler, IngestionContext

logger = logging.getLogger(__name__)


class FileHandler(BaseHandler):
    """
    Handle file uploads.
    
    Responsibilities:
    - Upload file to storage
    - Detect content type
    - Route to AssetBuilder
    - Determine processing strategy
    """
    
    async def handle(
        self,
        file: UploadFile,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Handle file upload and create asset.
        
        Args:
            file: Uploaded file
            title: Optional custom title
            options: Processing options
            
        Returns:
            List of created assets (parent + children if processed immediately)
        """
        options = options or {}
        
        # Detect content type using centralized function
        file_ext = os.path.splitext(file.filename or "")[1].lower()
        content_kind = detect_asset_kind_from_extension(file_ext)
        
        # Upload to storage
        storage_path = f"user_{self.user_id}/{uuid.uuid4()}{file_ext}"
        await self.storage_provider.upload_file(file, storage_path)
        logger.info(f"Uploaded file to {storage_path}")
        
        # Prepare metadata
        source_metadata = {
            "original_filename": file.filename,
            "file_size": getattr(file, 'size', None),
            "mime_type": getattr(file, 'content_type', None),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "ingestion_method": "file_upload"
        }
        
        # Build asset using AssetBuilder
        asset_title = title or file.filename or f"Uploaded {content_kind.value}"
        
        builder = (AssetBuilder(self.session, self.user_id, self.infospace_id)
            .as_kind(content_kind)
            .with_title(asset_title)
            .with_metadata(**source_metadata))
        
        # Set blob path directly (file already uploaded)
        builder.blueprint.blob_path = storage_path
        
        # Determine if processing is needed using centralized function
        needs_proc = needs_processing(content_kind)
        
        if needs_proc:
            # Determine strategy: immediate or background
            file_size = getattr(file, 'size', None)
            user_preference = options.get('process_immediately')
            
            # Create a temporary asset to check strategy
            from app.schemas import AssetCreate
            temp_asset = Asset(**AssetCreate(
                title=asset_title,
                kind=content_kind,
                user_id=self.user_id,
                infospace_id=self.infospace_id,
                blob_path=storage_path
            ).model_dump())
            
            immediate = should_process_immediately(temp_asset, user_preference, file_size)
            
            if immediate:
                # Process immediately using processor
                builder.with_processing_status(ProcessingStatus.PENDING)
                asset = await builder.build()
                
                # Get processor and process
                processor_context = self.context.to_processor_context(options)
                
                # Get processor class from registry
                from app.api.processors.registry import get_registry
                processor_class = get_registry().get_processor_class(asset)
                
                if processor_class:
                    processor = processor_class(processor_context)
                    asset.processing_status = ProcessingStatus.PROCESSING
                    self.session.add(asset)
                    self.session.commit()
                    
                    try:
                        child_assets = await processor.process(asset)
                        
                        # Child assets are already saved by processor
                        asset.processing_status = ProcessingStatus.READY
                        self.session.add(asset)
                        self.session.commit()
                        
                        logger.info(
                            f"Processed asset {asset.id} immediately, "
                            f"created {len(child_assets)} children"
                        )
                        return [asset] + child_assets
                    except Exception as e:
                        asset.processing_status = ProcessingStatus.FAILED
                        asset.processing_error = str(e)
                        self.session.add(asset)
                        self.session.commit()
                        logger.error(f"Processing failed for asset {asset.id}: {e}")
                        raise
                else:
                    asset.processing_status = ProcessingStatus.READY
                    self.session.add(asset)
                    self.session.commit()
            else:
                # Queue for background processing
                builder.with_processing_status(ProcessingStatus.PENDING)
                asset = await builder.build()
                
                # Trigger background task
                from app.api.tasks.content_tasks import process_content
                process_content.delay(asset.id, options)
                logger.info(f"Queued background processing for asset {asset.id}")
        else:
            # No processing needed
            builder.with_processing_status(ProcessingStatus.READY)
            asset = await builder.build()
        
        return [asset]
    
    # NOTE: Content type detection moved to app.api.processors.registry
    # Use detect_asset_kind_from_extension() and needs_processing() instead

