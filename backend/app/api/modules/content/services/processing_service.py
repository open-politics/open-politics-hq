"""
Processing Service
==================

Phase 1–2 pipeline orchestration: metadata extraction, content processing.

Used by:
- process_pending (@task in content/tasks/processing.py): Process PENDING assets
- reprocess_content() method: Re-run pipeline on existing asset (called by routes directly)

Flow: PENDING → Phase 1 (metadata + type refinement) → Phase 2 (processor) → READY.
Enrichment (geocoding, embedding) is reactive: @enricher tasks dispatch when facets are missing.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.models import Asset, ProcessingStatus
from app.api.modules.foundation_service_providers.base import StorageProvider, ScrapingProvider
from app.api.modules.content.services.asset_service import AssetService

logger = logging.getLogger(__name__)


class ProcessingService:
    """
    Orchestrates the processing pipeline: Phase 1 (metadata + type refinement),
    Phase 2 (content extraction), Phase 3 (enrichment).
    """

    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        scraping_provider: ScrapingProvider,
        asset_service: AssetService,
    ):
        self.session = session
        self.storage_provider = storage_provider
        self.scraping_provider = scraping_provider
        self.asset_service = asset_service

    async def _run_phase1_metadata(self, asset: Asset) -> Optional[Dict[str, Any]]:
        """
        Phase 1: Extract metadata for content detection.
        Iterates descriptor.metadata_extractors; returns first non-None result.
        """
        from app.api.modules.content.types import get_content_type_registry

        descriptor = get_content_type_registry().by_kind(asset.kind)
        if not descriptor or not descriptor.metadata_extractors:
            return None
        for extractor_cls in descriptor.metadata_extractors:
            result = await extractor_cls().extract(asset, self.storage_provider)
            if result is not None:
                return result
        return None

    async def process_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """
        Process asset content: Phase 1 → 2 → 3.
        Used by process_pending (@task), reprocess_content (triggered).
        """
        from app.api.modules.content.types import get_content_type_registry

        descriptor = get_content_type_registry().by_kind(asset.kind)
        if descriptor and descriptor.skip_processing:
            logger.info(
                f"Skipping processing for {asset.kind.value} asset {asset.id} - children already extracted"
            )
            return

        # Phase 1: Metadata extraction + type refinement
        metadata = await self._run_phase1_metadata(asset)
        if metadata is not None:
            from app.api.modules.content.detection import detect_content_kind

            new_kind = detect_content_kind(asset, metadata)
            if new_kind is not None and new_kind != asset.kind:
                old_kind = asset.kind
                asset.kind = new_kind
                file_info = asset.file_info or {}
                file_info["original_kind"] = str(old_kind).split(".")[-1]
                file_info["detected_by"] = "content_detection"
                asset.file_info = file_info
                if get_content_type_registry().get_processor_class(asset) is None:
                    asset.processing_status = ProcessingStatus.READY
                self.session.add(asset)
                self.session.commit()
                if asset.processing_status == ProcessingStatus.READY:
                    return

        # Phase 2: Content extraction
        from app.api.modules.content.processors.base import ProcessingContext
        from app.api.modules.content.services.bundle_service import BundleService

        processor_class = get_content_type_registry().get_processor_class(asset)
        if not processor_class:
            logger.warning(f"No processor for asset kind {asset.kind}, marking READY")
            asset.processing_status = ProcessingStatus.READY
            self.session.add(asset)
            self.session.commit()
            return

        asset.processing_status = ProcessingStatus.PROCESSING
        self.session.add(asset)
        self.session.commit()

        try:
            from app.core.config import settings
            opts = dict(options or {})
            if "max_pages" not in opts:
                opts["max_pages"] = settings.PDF_MAX_PAGES  # 0 = no limit
            context = ProcessingContext(
                session=self.session,
                storage_provider=self.storage_provider,
                scraping_provider=self.scraping_provider,
                asset_service=self.asset_service,
                bundle_service=BundleService(self.session),
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                options=opts,
            )
            processor = processor_class(context)
            child_assets = await processor.process(asset)

            asset.processing_status = ProcessingStatus.READY
            self.session.add(asset)
            self.session.commit()

            from app.core.events import emit
            for c in child_assets:
                emit(
                    "asset.processed",
                    {"asset_id": c.id, "kind": c.kind.value, "infospace_id": c.infospace_id},
                )

            logger.info(
                f"Processed asset {asset.id} using {processor_class.__name__}, "
                f"created {len(child_assets)} children"
            )
        except Exception as e:
            asset.processing_status = ProcessingStatus.FAILED
            asset.processing_error = str(e)
            self.session.add(asset)
            self.session.commit()
            logger.error(f"Processing failed for asset {asset.id}: {e}")
            raise

    async def reprocess_content(
        self, asset: Asset, options: Optional[Dict[str, Any]] = None
    ) -> None:
        """Reprocess asset with new options. Preserves children when reprocess_strategy is preserve_children."""
        from app.api.modules.content.types import get_content_type_registry

        descriptor = get_content_type_registry().by_kind(asset.kind)
        if descriptor and descriptor.reprocess_strategy == "preserve_children" and descriptor.materializer_class:
            materializer = descriptor.materializer_class()
            if not asset.blob_path:
                await materializer.materialize(asset, self.session, self.storage_provider)
            await materializer.reprocess_preserving_children(
                asset, self.session, self.storage_provider, self.asset_service, options or {}
            )
        else:
            children = self.session.exec(
                select(Asset).where(Asset.parent_asset_id == asset.id)
            ).all()
            if children:
                for child in children:
                    self.session.delete(child)
                self.session.flush()
                logger.info(f"Deleted {len(children)} existing child assets")
            await self.process_content(asset, options or {})
