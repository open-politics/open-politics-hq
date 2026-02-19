"""
Processing Service
==================

Phase 1–2 pipeline orchestration: metadata extraction, content processing.

Used by:
- batch_process_pending (Celery): Process PENDING assets in batches
- reprocess_content (route + Celery): Re-run pipeline on existing asset
- ContentIngestionService._process_content: Delegates from celery content_tasks

Flow: PENDING → Phase 1 (metadata + type refinement) → Phase 2 (processor) → READY.
Enrichment (geocoding, embedding) is reactive: watchers dispatch tasks when facets are missing.
"""

import asyncio
import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlmodel import Session, select

from app.models import Asset, AssetKind, ProcessingStatus
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
        Returns metadata dict or None if no extractor for this type.
        """
        if asset.kind == AssetKind.PDF and asset.blob_path:
            from app.api.modules.content.processors.pdf_processor import extract_pdf_metadata

            storage = self.storage_provider
            if hasattr(storage, "get_file_path"):
                try:
                    file_path = storage.get_file_path(asset.blob_path)
                    return await asyncio.to_thread(
                        extract_pdf_metadata, file_path=str(file_path)
                    )
                except Exception:
                    pass
            try:
                file_stream = await storage.get_file(asset.blob_path)
                pdf_bytes = await asyncio.to_thread(file_stream.read)
                return await asyncio.to_thread(
                    extract_pdf_metadata, pdf_bytes=pdf_bytes
                )
            except Exception:
                pass
        return None

    async def process_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """
        Process asset content: Phase 1 → 2 → 3.
        Used by batch_process_pending, reprocess_content.
        """
        if asset.kind == AssetKind.RSS_FEED:
            logger.info(
                f"Skipping processing for RSS_FEED asset {asset.id} - children already extracted"
            )
            return

        if asset.processing_status == ProcessingStatus.PROCESSING:
            return

        from app.api.modules.content.types import get_content_type_registry

        # Phase 1: Metadata extraction + type refinement
        metadata = await self._run_phase1_metadata(asset)
        if metadata is not None:
            from app.api.modules.content.detection import detect_content_kind

            new_kind = detect_content_kind(asset, metadata)
            if new_kind is not None and new_kind != asset.kind:
                old_kind = asset.kind
                asset.kind = new_kind
                meta = asset.source_metadata or {}
                if "file" not in meta:
                    meta["file"] = {}
                meta["file"]["original_kind"] = str(old_kind).split(".")[-1]
                meta["file"]["detected_by"] = "content_detection"
                asset.source_metadata = meta
                self.session.add(asset)
                self.session.commit()
                if get_content_type_registry().get_processor_class(asset) is None:
                    asset.processing_status = ProcessingStatus.READY
                    self.session.add(asset)
                    self.session.commit()
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
        """Reprocess asset with new options. Preserves CSV row children in-place."""
        if asset.kind == AssetKind.CSV:
            if not asset.blob_path:
                await self._materialize_csv_from_rows(asset)
            await self._reprocess_csv_preserving_children(asset, options or {})
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

    async def _materialize_csv_from_rows(self, asset: Asset) -> None:
        """Materialize chat-generated CSV from child rows into storage."""
        import csv
        import uuid
        from io import StringIO

        columns = asset.source_metadata.get("columns", [])
        if not columns:
            raise ValueError(f"CSV container {asset.id} has no column schema")

        child_rows = self.session.exec(
            select(Asset)
            .where(Asset.parent_asset_id == asset.id)
            .where(Asset.kind == AssetKind.CSV_ROW)
            .order_by(Asset.part_index)
        ).all()

        if not child_rows:
            raise ValueError(f"CSV container {asset.id} has no rows to materialize")

        csv_buffer = StringIO()
        writer = csv.DictWriter(csv_buffer, fieldnames=columns)
        writer.writeheader()
        for row_asset in child_rows:
            row_data = row_asset.source_metadata.get("original_row_data", {})
            row_dict = {col: row_data.get(col, "") for col in columns}
            writer.writerow(row_dict)
        csv_content = csv_buffer.getvalue()
        csv_buffer.close()

        filename = f"{asset.title.replace(' ', '_')}.csv"
        csv_bytes = csv_content.encode("utf-8")
        object_name = f"infospaces/{asset.infospace_id}/csv_materialized/{uuid.uuid4().hex[:10]}_{filename}"

        await self.storage_provider.upload_from_bytes(
            file_bytes=csv_bytes,
            object_name=object_name,
            filename=filename,
            content_type="text/csv",
        )

        asset.blob_path = object_name
        if asset.source_metadata is None:
            asset.source_metadata = {}
        asset.source_metadata["materialized_at"] = datetime.now(timezone.utc).isoformat()
        asset.source_metadata["materialized_row_count"] = len(child_rows)
        self.session.add(asset)
        self.session.commit()

        logger.info(f"Materialized CSV {asset.id}: {len(child_rows)} rows -> {object_name}")

    async def _reprocess_csv_preserving_children(
        self, asset: Asset, options: Dict[str, Any]
    ) -> None:
        """Reprocess CSV by updating existing row assets in-place."""
        from app.api.modules.content.processors import get_processor
        from app.api.modules.content.processors.base import ProcessingContext
        from app.api.modules.content.services.bundle_service import BundleService

        existing_children = self.session.exec(
            select(Asset)
            .where(Asset.parent_asset_id == asset.id)
            .order_by(Asset.part_index)
        ).all()

        logger.info(
            f"Reprocessing CSV asset {asset.id} with {len(existing_children)} existing children"
        )

        from app.core.config import settings
        opts = dict(options or {})
        if "max_pages" not in opts:
            opts["max_pages"] = settings.PDF_MAX_PAGES
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
        processor = get_processor(asset, context)
        if not processor:
            raise ValueError(f"No processor found for asset kind: {asset.kind}")

        new_row_creates = await processor.process(asset)

        for i, row_create in enumerate(new_row_creates):
            if i < len(existing_children):
                existing_asset = existing_children[i]
                existing_asset.title = row_create.title
                existing_asset.text_content = row_create.text_content
                existing_asset.source_metadata = row_create.source_metadata
                existing_asset.part_index = row_create.part_index
                existing_asset.updated_at = datetime.now(timezone.utc)
                self.session.add(existing_asset)
            else:
                new_asset = self.asset_service.create_asset(row_create)
                self.session.add(new_asset)

        if len(existing_children) > len(new_row_creates):
            for old_asset in existing_children[len(new_row_creates) :]:
                self.session.delete(old_asset)

        self.session.flush()
        logger.info(
            f"CSV reprocessing complete: {min(len(existing_children), len(new_row_creates))} updated, "
            f"{max(0, len(new_row_creates) - len(existing_children))} created, "
            f"{max(0, len(existing_children) - len(new_row_creates))} deleted"
        )
