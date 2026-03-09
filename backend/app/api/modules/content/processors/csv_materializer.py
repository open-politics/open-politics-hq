"""
CSV Materializer
================

Materializes a CSV container asset (with CSV_ROW children) into a downloadable CSV file.
Inverse of CSVProcessor: rows → file instead of file → rows.

Registered on ContentTypeDescriptor.materializer_class for AssetKind.CSV.
"""

import csv
import logging
import uuid
from datetime import datetime, timezone
from io import StringIO
from typing import TYPE_CHECKING, Any

from sqlmodel import Session, select

from app.api.modules.content.models import Asset, AssetKind

if TYPE_CHECKING:
    from app.api.modules.foundation_service_providers.base import StorageProvider

logger = logging.getLogger(__name__)


class CsvMaterializer:
    """
    Materialize a CSV container asset into a real CSV file.

    Streams child rows in batches to avoid unbounded memory.
    Uploads to storage and updates the parent asset with blob_path.
    """

    async def materialize(
        self,
        asset: Asset,
        session: Session,
        storage_provider: "StorageProvider",
    ) -> Asset:
        """
        Build CSV from row assets, upload to storage, update asset.

        Args:
            asset: CSV container asset (must have columns in file_info)
            session: DB session (will commit)
            storage_provider: Storage for upload

        Returns:
            Updated asset with blob_path and materialized_at metadata
        """
        columns = asset.file_info.get("columns", []) if asset.file_info else []
        if not columns:
            raise ValueError("CSV container has no column schema defined")

        csv_buffer = StringIO()
        writer = csv.DictWriter(csv_buffer, fieldnames=columns)
        writer.writeheader()

        batch_size = 500
        offset = 0
        total_rows = 0

        while True:
            child_rows = session.exec(
                select(Asset)
                .where(Asset.parent_asset_id == asset.id)
                .where(Asset.kind == AssetKind.CSV_ROW)
                .order_by(Asset.part_index)
                .offset(offset)
                .limit(batch_size)
            ).all()
            if not child_rows:
                break
            for row_asset in child_rows:
                row_data = (row_asset.file_info or {}).get("original_row_data", {})
                row_dict = {col: row_data.get(col, "") for col in columns}
                writer.writerow(row_dict)
                total_rows += 1
            offset += batch_size

        if total_rows == 0:
            raise ValueError("CSV container has no rows to materialize")

        csv_content = csv_buffer.getvalue()
        csv_buffer.close()
        csv_bytes = csv_content.encode("utf-8")

        filename = f"{asset.title.replace(' ', '_')}.csv"
        object_name = (
            f"infospaces/{asset.infospace_id}/csv_materialized/"
            f"{uuid.uuid4().hex[:10]}_{filename}"
        )

        await storage_provider.upload_from_bytes(
            file_bytes=csv_bytes,
            object_name=object_name,
            filename=filename,
            content_type="text/csv",
        )

        asset.blob_path = object_name
        file_info = asset.file_info or {}
        file_info["materialized_at"] = datetime.now(timezone.utc).isoformat()
        file_info["materialized_row_count"] = total_rows
        asset.file_info = file_info
        session.add(asset)
        session.commit()
        session.refresh(asset)

        logger.info(f"Materialized CSV {asset.id}: {total_rows} rows -> {object_name}")
        return asset

    async def reprocess_preserving_children(
        self,
        asset: Asset,
        session: Session,
        storage_provider: "StorageProvider",
        asset_service: Any,
        options: dict,
    ) -> None:
        """
        Reprocess CSV by updating existing row assets in-place.
        Used when descriptor.reprocess_strategy == "preserve_children".
        """
        from app.api.modules.content.processors import get_processor
        from app.api.modules.content.processors.base import ProcessingContext
        from app.api.modules.content.services.bundle_service import BundleService
        from app.core.config import settings

        existing_children = session.exec(
            select(Asset)
            .where(Asset.parent_asset_id == asset.id)
            .order_by(Asset.part_index)
        ).all()

        logger.info(
            "Reprocessing CSV asset %s with %d existing children",
            asset.id, len(existing_children),
        )

        opts = dict(options or {})
        if "max_pages" not in opts:
            opts["max_pages"] = settings.PDF_MAX_PAGES
        context = ProcessingContext(
            session=session,
            storage_provider=storage_provider,
            scraping_provider=None,
            asset_service=asset_service,
            bundle_service=BundleService(session),
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
                existing_asset.file_info = row_create.file_info
                existing_asset.part_index = row_create.part_index
                existing_asset.updated_at = datetime.now(timezone.utc)
                session.add(existing_asset)
            else:
                new_asset = asset_service.create_asset(row_create)
                session.add(new_asset)

        if len(existing_children) > len(new_row_creates):
            for old_asset in existing_children[len(new_row_creates):]:
                session.delete(old_asset)

        session.flush()
        logger.info(
            "CSV reprocessing complete: %d updated, %d created, %d deleted",
            min(len(existing_children), len(new_row_creates)),
            max(0, len(new_row_creates) - len(existing_children)),
            max(0, len(existing_children) - len(new_row_creates)),
        )
