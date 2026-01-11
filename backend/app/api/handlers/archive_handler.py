"""
Archive Handler
===============

Handles remote archive (ZIP, TAR, etc.) downloads and extraction.
Creates bundle hierarchy mirroring directory structure.
"""

import os
import logging
import tempfile
import zipfile
import tarfile
import aiohttp
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone

from app.models import Asset, AssetKind, Bundle, ProcessingStatus, DatasetIngestionJob, IngestionStatus
from app.api.services.asset_builder import AssetBuilder
from app.api.services.bundle_service import BundleService
from .base import IngestionContext

logger = logging.getLogger(__name__)


class ArchiveHandler:
    """
    Handle remote archive file ingestion.
    
    Responsibilities:
    - Stream download large archives (multi-GB)
    - Extract to temporary directory
    - Create bundle hierarchy mirroring directory structure
    - Queue contained files for processing
    """
    
    def __init__(self, context: IngestionContext):
        self.context = context
        self.session = context.session
        self.storage_provider = context.storage_provider
        self.asset_service = context.asset_service
        self.bundle_service = context.bundle_service
        self.user_id = context.user_id
        self.infospace_id = context.infospace_id
        self.settings = context.settings
        self.options = context.options
    
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
        3. Extract to temp directory
        4. Walk directory structure
        5. Create bundle hierarchy
        6. Queue files for processing
        
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
            bundle_metadata={
                "source_url": archive_url,
                "ingestion_type": "remote_archive",
                "ingested_at": datetime.now(timezone.utc).isoformat()
            }
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
                source_url=archive_url,
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
            from app.api.tasks.dataset_tasks import ingest_archive_task
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
                    source_url=archive_url,
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
        
        This method downloads, extracts, and processes the entire archive
        in the current request. Not recommended for large datasets.
        """
        with tempfile.TemporaryDirectory() as temp_dir:
            # Download archive (pass user_agent if available in options)
            ua = options.get('user_agent')
            archive_path = await self._download_archive(archive_url, temp_dir, user_agent=ua)
            
            # Extract archive
            extract_dir = await self._extract_archive(archive_path, temp_dir)
            
            # Walk directory and create bundles + assets
            created_assets = await self._process_directory_structure(
                extract_dir, root_bundle, infospace_id, user_id, options
            )
            
            logger.info(f"Synchronous archive processing complete: {len(created_assets)} assets created")
            return created_assets
    
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
    
    async def _extract_archive(self, archive_path: str, temp_dir: str) -> str:
        """
        Extract archive to directory.
        
        Supports ZIP, TAR, TAR.GZ, etc.
        
        Returns path to extraction directory.
        """
        extract_dir = os.path.join(temp_dir, 'extracted')
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
    
    async def _process_directory_structure(
        self,
        base_path: str,
        root_bundle: Bundle,
        infospace_id: int,
        user_id: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Walk directory structure and create bundles + assets.
        
        Creates:
        - Nested bundles for directories
        - Asset records for files (queued for processing)
        
        Returns list of created assets.
        """
        from app.api.handlers import FileHandler
        from fastapi import UploadFile
        from app.schemas import BundleCreate
        
        created_assets = []
        bundle_map = {base_path: root_bundle}  # Map paths to Bundle objects
        
        logger.info(f"Walking directory structure from {base_path}")
        
        # Walk directory tree
        for dirpath, dirnames, filenames in os.walk(base_path):
            # Get or create bundle for this directory
            current_bundle = bundle_map.get(dirpath, root_bundle)
            
            # Create bundles for subdirectories
            for dirname in dirnames:
                subdir_path = os.path.join(dirpath, dirname)
                
                # Find parent bundle
                parent_bundle = current_bundle
                
                # Create nested bundle
                bundle_data = BundleCreate(
                    name=dirname,
                    description=f"Folder from archive",
                    parent_bundle_id=parent_bundle.id
                )
                
                sub_bundle = self.bundle_service.create_bundle(
                    bundle_in=bundle_data,
                    infospace_id=infospace_id,
                    user_id=user_id
                )
                
                bundle_map[subdir_path] = sub_bundle
                logger.debug(f"Created bundle {sub_bundle.id} for directory: {dirname}")
            
            # Process files in this directory
            for filename in filenames:
                file_path = os.path.join(dirpath, filename)
                
                try:
                    # Read file and create asset
                    with open(file_path, 'rb') as f:
                        file_content = f.read()
                    
                    # Create UploadFile-like object
                    from io import BytesIO
                    file_obj = BytesIO(file_content)
                    file_obj.name = filename
                    
                    upload_file = UploadFile(
                        file=file_obj,
                        filename=filename
                    )
                    
                    # Use FileHandler to process file
                    file_handler = FileHandler(self.context)
                    file_assets = await file_handler.handle(
                        file=upload_file,
                        title=filename,
                        options={'process_immediately': True}
                    )
                    
                    # Add assets to current bundle
                    if file_assets:
                        for asset in file_assets:
                            if asset.parent_asset_id is None:  # Only top-level assets
                                self.bundle_service.add_asset_to_bundle(
                                    bundle_id=current_bundle.id,
                                    asset_id=asset.id,
                                    infospace_id=infospace_id,
                                    user_id=user_id,
                                    include_child_assets=False  # Children already linked via parent_asset_id
                                )
                        
                        created_assets.extend(file_assets)
                        logger.debug(f"Processed file: {filename} -> {len(file_assets)} assets")
                
                except Exception as e:
                    logger.error(f"Failed to process file {filename}: {e}")
                    continue
        
        logger.info(f"Directory processing complete: {len(created_assets)} total assets created")
        return created_assets
    
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


