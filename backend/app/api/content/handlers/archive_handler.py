"""
Archive Handler
===============

Handles remote archive (ZIP, TAR, etc.) downloads and extraction.
Uses DirectoryImportHandler after extraction for flat bundle + virtual folders.
"""

import os
import re
import logging
import tempfile
import zipfile
import tarfile
import aiohttp
from pathlib import Path
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from app.models import Asset, AssetKind, Bundle, ProcessingStatus, DatasetIngestionJob, IngestionStatus
from app.api.content.services.asset_builder import AssetBuilder
from app.api.content.services.bundle_service import BundleService
from .base import BaseHandler, IngestionContext
from .directory_import_handler import DirectoryImportHandler

logger = logging.getLogger(__name__)


class ArchiveHandler(BaseHandler):
    """
    Handle remote archive file ingestion.
    
    Flow:
    - Stream download large archives (multi-GB)
    - Extract to {LOCAL_STORAGE_BASE_PATH}/managed/archives/{name}/
    - DirectoryImportHandler.handle(extracted_path, copy_mode=False)
    - Flat bundle + virtual folders (no nested bundles)
    """

    def __init__(self, context: IngestionContext):
        super().__init__(context)
    
    async def handle(
        self,
        archive_url: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
        user_agent: Optional[str] = None
    ) -> List[Asset]:
        """
        Handle archive URL ingestion.
        
        Flow:
        1. Create root bundle for the dataset
        2. Download archive (streaming)
        3. Extract to managed/archives/{name}/
        4. DirectoryImportHandler for flat bundle + virtual folders
        
        Args:
            archive_url: URL of archive file
            infospace_id: Target infospace
            user_id: User ingesting the archive
            title: Optional custom title for root bundle
            options: Processing options
            
        Returns:
            List of created assets (root bundle asset + any immediate children)
        """
        options = options or {}
        
        logger.info(f"Starting archive ingestion from {archive_url}")
        
        # Extract filename from URL
        filename = archive_url.split('/')[-1].split('?')[0]
        base_title = title or f"Dataset: {filename}"
        
        # Check for existing bundles with same name and append number if needed
        # This prevents duplicate key errors when retrying failed ingestions
        from sqlmodel import select
        from app.models import Bundle
        
        archive_title = base_title
        counter = 1
        while True:
            existing = self.session.exec(
                select(Bundle).where(
                    Bundle.infospace_id == infospace_id,
                    Bundle.name == archive_title
                )
            ).first()
            if not existing:
                break
            counter += 1
            archive_title = f"{base_title} ({counter})"
        
        logger.info(f"Creating bundle with unique name: {archive_title}")
        
        # Create root bundle for this dataset
        from app.schemas import BundleCreate
        root_bundle_data = BundleCreate(
            name=archive_title,
            description=f"Extracted from {archive_url}",
            bundle_metadata={},
        )
        
        root_bundle = self.bundle_service.create_bundle(
            bundle_in=root_bundle_data,
            infospace_id=infospace_id,
            user_id=user_id
        )
        
        logger.info(f"Created root bundle {root_bundle.id} for archive dataset")
        
        # For large archives, queue background processing
        use_background = options.get('use_background', True)
        
        if use_background:
            # Create ingestion job for tracking (following Source model pattern)
            job = DatasetIngestionJob(
                infospace_id=infospace_id,
                user_id=user_id,
                source_locator=archive_url,
                kind=self._detect_archive_type(archive_url),
                root_bundle_id=root_bundle.id,
                status=IngestionStatus.PENDING,
                cursor_state={
                    "stage": "pending",
                    "message": "Queued for processing",
                    "progress_pct": 0,
                    "options": options
                }
            )
            self.session.add(job)
            self.session.commit()
            self.session.refresh(job)
            
            # Queue celery task for background processing
            from app.api.content.tasks.dataset_tasks import ingest_archive_task
            task = ingest_archive_task.delay(
                job_id=job.id,
                archive_url=archive_url,
                root_bundle_id=root_bundle.id,
                infospace_id=infospace_id,
                user_id=user_id,
                options=options,
                user_agent=user_agent  # Pass browser's User-Agent
            )
            
            # Update job with task ID
            job.task_id = task.id
            job.started_at = datetime.now(timezone.utc)
            self.session.add(job)
            self.session.commit()
            
            logger.info(f"Created ingestion job {job.id} with task {task.id}")
            
            # Return stub asset for the root bundle
            stub_asset = await (AssetBuilder(self.session, user_id, infospace_id)
                .as_kind(AssetKind.FILE)
                .with_title(archive_title)
                .with_metadata(
                    source_locator=archive_url,
                    root_bundle_id=root_bundle.id,
                    task_id=task.id,
                    job_id=job.id,
                    job_uuid=str(job.uuid),
                    processing_status="queued"
                )
                .build())
            
            return [stub_asset]
        
        else:
            # Process immediately (not recommended for large archives)
            return await self._process_archive_sync(
                archive_url, root_bundle, infospace_id, user_id, options
            )
    
    async def _process_archive_sync(
        self,
        archive_url: str,
        root_bundle: Bundle,
        infospace_id: int,
        user_id: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Process archive synchronously (for small archives or testing).
        
        Flow:
        1. Download archive
        2. Extract to {LOCAL_STORAGE_BASE_PATH}/managed/archives/{name}/
        3. DirectoryImportHandler.handle(extracted_path, copy_mode=False)
        4. Delete archive file (keep extracted files)
        """
        from app.core.config import settings
        from app.api.providers.factory import create_storage_provider

        storage_base = Path(settings.LOCAL_STORAGE_BASE_PATH)
        managed_archives = storage_base / "managed" / "archives"
        managed_archives.mkdir(parents=True, exist_ok=True)

        # Safe name from archive filename
        filename = archive_url.split('/')[-1].split('?')[0]
        base_name = Path(filename).stem or "archive"
        safe_name = re.sub(r'[^\w\-_.]', '_', base_name)[:64]
        extract_dir = managed_archives / safe_name
        extract_dir.mkdir(parents=True, exist_ok=True)

        with tempfile.TemporaryDirectory() as temp_dir:
            ua = options.get('user_agent')
            archive_path = await self._download_archive(archive_url, temp_dir, user_agent=ua)
            # Extract to persistent location (archive in temp_dir is deleted when with exits)
            await self._extract_archive(str(archive_path), str(extract_dir))

        # Use DirectoryImportHandler for flat bundle + virtual folders
        from app.api.content.handlers.base import IngestionContext
        from app.api.content.services.asset_service import AssetService
        allowed_paths = [p.strip() for p in (settings.ALLOWED_IMPORT_PATHS or "").split(",") if p.strip()]
        if not allowed_paths:
            allowed_paths = [str(storage_base)]
        managed_path = str(storage_base / "managed")
        if managed_path not in allowed_paths:
            allowed_paths = list(allowed_paths) + [managed_path]
        dir_context = IngestionContext(
            session=self.session,
            storage_provider=None,
            scraping_provider=self.scraping_provider,
            search_provider=self.search_provider,
            asset_service=AssetService(self.session, create_storage_provider(settings)),
            bundle_service=self.bundle_service,
            user_id=user_id,
            infospace_id=infospace_id,
            settings=settings,
            options={"allowed_import_paths": allowed_paths},
        )
        handler = DirectoryImportHandler(dir_context)
        assets = await handler.handle(
            source_path=str(extract_dir),
            options={"copy_mode": False, "root_bundle_id": root_bundle.id},
        )
        logger.info(f"Archive processing complete: {len(assets)} assets created")
        return list(assets)
    
    async def _download_archive(self, url: str, temp_dir: str, user_agent: Optional[str] = None) -> str:
        """
        Download archive file with streaming (for large files).
        
        Returns path to downloaded file.
        """
        filename = url.split('/')[-1].split('?')[0]
        filepath = os.path.join(temp_dir, filename)
        
        logger.info(f"Downloading archive from {url} to {filepath}")
        
        # Use browser's User-Agent if provided, otherwise fallback to settings
        # This allows passing the actual browser's UA from frontend for better compatibility
        if not user_agent:
            user_agent = getattr(self.settings, 'GEOCODING_USER_AGENT', 
                                 'Mozilla/5.0 (compatible; OpenPoliticsHQ/1.0; +https://open-politics.org)')
        
        headers = {
            'User-Agent': user_agent,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate, br',
            'DNT': '1',
            'Connection': 'keep-alive',
            'Upgrade-Insecure-Requests': '1',
            'Referer': url  # Some sites require referrer
        }
        
        logger.info(f"Downloading with User-Agent: {user_agent[:60]}...")
        
        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3600)) as response:
                response.raise_for_status()
                
                # Stream download in chunks (avoid loading entire file in memory)
                with open(filepath, 'wb') as f:
                    chunk_size = 8192
                    downloaded = 0
                    async for chunk in response.content.iter_chunked(chunk_size):
                        f.write(chunk)
                        downloaded += len(chunk)
                        
                        # Log progress every 10MB
                        if downloaded % (10 * 1024 * 1024) < chunk_size:
                            logger.info(f"Downloaded {downloaded // (1024 * 1024)}MB...")
        
        logger.info(f"Archive download complete: {os.path.getsize(filepath)} bytes")
        return filepath
    
    async def _extract_archive(self, archive_path: str, extract_dir: str) -> str:
        """
        Extract archive to directory.
        
        Supports ZIP, TAR, TAR.GZ, etc.
        
        Returns path to extraction directory.
        """
        os.makedirs(extract_dir, exist_ok=True)
        
        logger.info(f"Extracting archive {archive_path} to {extract_dir}")
        
        # Detect archive type and extract
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path, 'r') as zip_ref:
                zip_ref.extractall(extract_dir)
        elif tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, 'r:*') as tar_ref:
                tar_ref.extractall(extract_dir)
        else:
            raise ValueError(f"Unsupported archive format: {archive_path}")
        
        logger.info(f"Archive extraction complete")
        return extract_dir
    
    def _detect_archive_type(self, url: str) -> str:
        """Detect archive type from URL extension."""
        url_lower = url.lower().split('?')[0].split('#')[0]
        
        if url_lower.endswith('.zip'):
            return 'zip'
        elif url_lower.endswith(('.tar.gz', '.tgz')):
            return 'tar.gz'
        elif url_lower.endswith('.tar'):
            return 'tar'
        elif url_lower.endswith('.7z'):
            return '7z'
        elif url_lower.endswith('.rar'):
            return 'rar'
        else:
            return 'archive'


