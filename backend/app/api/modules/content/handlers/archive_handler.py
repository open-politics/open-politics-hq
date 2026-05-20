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

from app.models import Asset, AssetKind, Bundle, ProcessingStatus, IngestionJob, IngestionStatus
from app.api.modules.content.services.asset_builder import AssetBuilder
from app.api.modules.content.services.bundle_service import BundleService
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
            job = IngestionJob(
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
            
            # Emit event — @task discovers PENDING IngestionJob via event bus
            from app.core.events import emit
            emit("ingestion_job.created", {"infospace_id": infospace_id})

            logger.info(f"Created ingestion job {job.id}, emitted ingestion_job.created")

            # Return stub asset for the root bundle
            stub_asset = await (AssetBuilder(self.session, user_id, infospace_id)
                .as_kind(AssetKind.FILE)
                .with_title(archive_title)
                .with_metadata(
                    source_locator=archive_url,
                    root_bundle_id=root_bundle.id,
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
        options: Dict[str, Any],
        on_download_progress: Optional[Any] = None,
    ) -> List[Asset]:
        """
        Process archive synchronously (for small archives or testing).

        Flow:
        1. Download archive (streams bytes; calls `on_download_progress(done, total)`
           throttled to once per ~500 ms)
        2. Extract to {LOCAL_STORAGE_BASE_PATH}/managed/archives/{name}/
        3. DirectoryImportHandler.handle(extracted_path, copy_mode=False)
        """
        from app.core.config import settings
        from app.api.modules.foundation_service_providers import resolve

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
            archive_path = await self._download_archive(
                archive_url, temp_dir, user_agent=ua, on_progress=on_download_progress
            )
            # Extract to persistent location (archive in temp_dir is deleted when with exits)
            await ArchiveHandler.extract_archive(str(archive_path), str(extract_dir))

        # Use DirectoryImportHandler for flat bundle + virtual folders
        from app.api.modules.content.handlers.base import IngestionContext
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
            bundle_service=self.bundle_service,
            user_id=user_id,
            infospace_id=infospace_id,
            settings=settings,
            options={"allowed_import_paths": allowed_paths},
        )
        handler = DirectoryImportHandler(dir_context)
        assets, _ = await handler.handle(
            source_path=str(extract_dir),
            options={"copy_mode": False, "root_bundle_id": root_bundle.id},
        )
        logger.info(f"Archive processing complete: {len(assets)} assets created")
        return list(assets)
    
    async def _download_archive(
        self,
        url: str,
        temp_dir: str,
        user_agent: Optional[str] = None,
        on_progress: Optional[Any] = None,
    ) -> str:
        """
        Stream-download a remote archive to `temp_dir`.

        `on_progress(downloaded_bytes, total_bytes_or_None)` is invoked at most
        once every ~500 ms — cheap enough to write to the DB + Redis stream on
        each tick.

        Returns the local filepath of the downloaded archive.
        """
        import time

        filename = url.split('/')[-1].split('?')[0]
        filepath = os.path.join(temp_dir, filename)

        if not user_agent:
            user_agent = getattr(self.settings, 'GEOCODING_USER_AGENT',
                                 'Mozilla/5.0 (compatible; OpenPoliticsHQ/1.0; +https://open-politics.org)')

        headers = {
            'User-Agent': user_agent,
            'Accept': '*/*',
            'Accept-Encoding': 'identity',  # disable gzip — we need accurate content-length for progress
            'Connection': 'keep-alive',
        }

        logger.info(f"Downloading archive from {url} to {filepath}")

        # 256 KiB chunks: far fewer async hops than 8 KiB for slow/large transfers.
        CHUNK = 256 * 1024
        PROGRESS_INTERVAL = 0.5  # seconds

        async with aiohttp.ClientSession(headers=headers) as session:
            async with session.get(url, timeout=aiohttp.ClientTimeout(total=3600)) as response:
                response.raise_for_status()
                total = response.content_length  # may be None

                with open(filepath, 'wb') as f:
                    downloaded = 0
                    last_tick = time.monotonic()
                    last_log_mb = 0
                    if on_progress:
                        on_progress(0, total)
                    async for chunk in response.content.iter_chunked(CHUNK):
                        f.write(chunk)
                        downloaded += len(chunk)
                        now = time.monotonic()
                        if on_progress and (now - last_tick) >= PROGRESS_INTERVAL:
                            on_progress(downloaded, total)
                            last_tick = now
                        # Log once per 50 MB to avoid log spam on slow tunnels.
                        cur_mb = downloaded // (50 * 1024 * 1024)
                        if cur_mb > last_log_mb:
                            last_log_mb = cur_mb
                            logger.info(f"Downloaded {downloaded // (1024 * 1024)}MB"
                                        f"{f' / {total // (1024 * 1024)}MB' if total else ''}...")
                    if on_progress:
                        on_progress(downloaded, total)

        logger.info(f"Archive download complete: {os.path.getsize(filepath)} bytes")
        return filepath
    
    @staticmethod
    def _is_macos_sidecar(member_name: str) -> bool:
        """True for macOS Finder metadata: __MACOSX/ trees and ._ AppleDouble files.

        A Mac-zipped folder carries both. Neither represents real content;
        ingesting them pollutes the tree with fake PDFs, images, etc.
        """
        normalized = member_name.replace("\\", "/").lstrip("/")
        parts = normalized.split("/")
        if any(p == "__MACOSX" for p in parts):
            return True
        basename = parts[-1] if parts else ""
        return basename.startswith("._")

    @staticmethod
    async def extract_archive(archive_path: str, extract_dir: str) -> str:
        """
        Extract a zip/tar archive to `extract_dir`, safely.

        Rejects entries whose resolved path escapes `extract_dir` (zip-slip),
        symlinks and device files (via tarfile's `data` filter), and skips
        macOS Finder sidecars (``__MACOSX/``, ``._*``).

        Returns path to extraction directory.
        """
        os.makedirs(extract_dir, exist_ok=True)
        extract_root = Path(extract_dir).resolve()

        logger.info(f"Extracting archive {archive_path} to {extract_dir}")

        skipped = 0
        if zipfile.is_zipfile(archive_path):
            with zipfile.ZipFile(archive_path, 'r') as zf:
                for info in zf.infolist():
                    member = info.filename
                    if ArchiveHandler._is_macos_sidecar(member):
                        skipped += 1
                        continue
                    target = (extract_root / member).resolve()
                    if extract_root != target and extract_root not in target.parents:
                        raise ValueError(f"Archive entry escapes target directory: {member!r}")
                    zf.extract(info, extract_dir)
        elif tarfile.is_tarfile(archive_path):
            with tarfile.open(archive_path, 'r:*') as tf:
                def _filter(member, dest):
                    if ArchiveHandler._is_macos_sidecar(member.name):
                        nonlocal skipped
                        skipped += 1
                        return None
                    # Chain the data filter for absolute-path / traversal / symlink / device rejection.
                    return tarfile.data_filter(member, dest)
                tf.extractall(extract_dir, filter=_filter)
        else:
            raise ValueError(f"Unsupported archive format: {archive_path}")

        if skipped:
            logger.info(f"Archive extraction complete (skipped {skipped} macOS sidecars)")
        else:
            logger.info("Archive extraction complete")
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


