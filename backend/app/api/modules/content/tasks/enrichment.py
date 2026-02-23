"""
Provider-gated enrichment tasks.
Dispatched by ReactiveWatchers when assets need backfilled data (geocoding, OCR, hashing, etc.).
"""

import asyncio
import hashlib
import io
import logging
from typing import List

import fitz  # PyMuPDF

from app.core.celery_app import celery
from app.core.task_primitives import task_context
from app.core.task_utils import run_async_in_celery

from app.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.facets import (
    FACET_LOCATION,
    FACET_LOCATION_LAT,
    FACET_LOCATION_LON,
    FACET_OCR_USED,
    FACET_OCR_ENGINE,
    FACET_OCR_CONFIDENCE,
    get_facet,
    set_facet,
)
from app.api.modules.content.utils.resolve_source_file import resolve_source_file

logger = logging.getLogger(__name__)


@celery.task(name="enrich_geocoding")
def enrich_geocoding_task(asset_ids: List[int]):
    """
    Reactive watcher task: geocodes assets that have facets.location but are missing
    facets.location_lat / location_lon. Uses GeocodingProvider from task_context.
    """
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        with task_context(providers=["geocoding"]) as (session, prov):
            geocoding = prov.get("geocoding")
            if not geocoding:
                logger.warning("Geocoding provider not configured; skipping enrich_geocoding")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}

            enriched = 0
            failed = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    failed += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY:
                    continue
                meta = asset.source_metadata or {}
                location = get_facet(meta, FACET_LOCATION)
                lat = get_facet(meta, FACET_LOCATION_LAT)
                lon = get_facet(meta, FACET_LOCATION_LON)
                if not location or not isinstance(location, str) or not location.strip():
                    continue
                if lat is not None and lon is not None:
                    continue  # Already has coordinates
                try:
                    result = await geocoding.geocode(location.strip())
                    if result and "coordinates" in result:
                        coords = result["coordinates"]
                        if len(coords) >= 2:
                            set_facet(meta, FACET_LOCATION_LON, float(coords[0]))
                            set_facet(meta, FACET_LOCATION_LAT, float(coords[1]))
                            if result.get("display_name"):
                                set_facet(meta, FACET_LOCATION, result["display_name"])
                            asset.source_metadata = meta
                            session.add(asset)
                            enriched += 1
                        else:
                            failed += 1
                    else:
                        logger.debug(f"No geocoding result for asset {asset_id} location '{location[:50]}'")
                        failed += 1
                except Exception as e:
                    logger.warning(f"Geocoding failed for asset {asset_id}: {e}")
                    failed += 1
            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)


@celery.task(name="enrich_file_hash")
def enrich_file_hash_task(asset_ids: List[int]):
    """
    Reactive watcher task: computes SHA-256 for READY assets with blob_path but no content_hash.
    Prefers get_file_path() for local_fs (zero-copy); falls back to get_file() for remote.
    """
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    def _compute_sha256_sync(path_or_bytes):
        h = hashlib.sha256()
        if hasattr(path_or_bytes, "read"):
            while chunk := path_or_bytes.read(65536):
                h.update(chunk)
            return h.hexdigest()
        with open(path_or_bytes, "rb") as f:
            while chunk := f.read(65536):
                h.update(chunk)
        return h.hexdigest()

    async def _enrich_batch():
        with task_context(providers=["storage"]) as (session, prov):
            storage = prov.get("storage")
            if not storage:
                logger.warning("Storage provider not configured; skipping enrich_file_hash")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}

            enriched = 0
            failed = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    failed += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY:
                    continue
                if not asset.blob_path:
                    continue
                if asset.content_hash:
                    continue  # Already hashed
                try:
                    path_or_stream = None
                    if hasattr(storage, "get_file_path"):
                        try:
                            path_or_stream = storage.get_file_path(asset.blob_path)
                        except NotImplementedError:
                            pass
                    if path_or_stream is None:
                        fh = await storage.get_file(asset.blob_path)
                        path_or_stream = io.BytesIO(fh.read())
                        fh.close()
                    computed = await asyncio.to_thread(_compute_sha256_sync, path_or_stream)
                    asset.content_hash = computed
                    session.add(asset)
                    enriched += 1
                except Exception as e:
                    logger.warning(f"Hash enrichment failed for asset {asset_id}: {e}", exc_info=True)
                    failed += 1
            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)


def _render_pdf_page_to_image(pdf_path_or_bytes, page_index: int) -> bytes:
    """Render a PDF page to PNG bytes for OCR."""
    if hasattr(pdf_path_or_bytes, "read"):
        doc = fitz.open(stream=pdf_path_or_bytes.read(), filetype="pdf")
    else:
        doc = fitz.open(filename=str(pdf_path_or_bytes))
    try:
        page = doc.load_page(page_index)
        pix = page.get_pixmap(dpi=150)
        return pix.tobytes("png")
    finally:
        doc.close()


@celery.task(name="enrich_ocr")
def enrich_ocr_task(asset_ids: List[int], force: bool = False):
    """
    Reactive watcher task: OCR assets (PDF_PAGE children) with no text_content.
    Groups pages by parent PDF and loads each PDF once for all its pages.
    Sets FACET_OCR_USED, FACET_OCR_ENGINE, FACET_OCR_CONFIDENCE.
    """
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        from collections import defaultdict

        with task_context(providers=["storage", "ocr"]) as (session, prov):
            storage = prov.get("storage")
            ocr = prov.get("ocr")
            if not ocr:
                logger.warning("OCR provider not configured; skipping enrich_ocr")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}

            # Group PDF_PAGE assets by parent_asset_id to load each PDF once
            pages_by_parent: dict[int, list[Asset]] = defaultdict(list)
            skipped = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    skipped += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY:
                    continue
                if asset.kind != AssetKind.PDF_PAGE:
                    continue
                if not force and get_facet(asset.source_metadata or {}, FACET_OCR_USED):
                    continue
                if not asset.parent_asset_id:
                    continue
                pages_by_parent[asset.parent_asset_id].append(asset)

            enriched = 0
            failed = len(asset_ids) - sum(len(p) for p in pages_by_parent.values()) - skipped

            for parent_id, page_assets in pages_by_parent.items():
                if not page_assets:
                    continue
                try:
                    blob_path, _ = resolve_source_file(page_assets[0], session)
                    pdf_bytes = None
                    if hasattr(storage, "get_file_path"):
                        try:
                            path = storage.get_file_path(blob_path)
                            pdf_bytes = io.BytesIO(path.read_bytes())
                        except (NotImplementedError, OSError):
                            pass
                    if pdf_bytes is None:
                        fh = await storage.get_file(blob_path)
                        try:
                            pdf_bytes = io.BytesIO(fh.read())
                        finally:
                            fh.close()

                    for asset in page_assets:
                        try:
                            _, page_index = resolve_source_file(asset, session)
                            pdf_bytes.seek(0)
                            image_bytes = await asyncio.to_thread(
                                _render_pdf_page_to_image, pdf_bytes, page_index or 0
                            )
                            result = await ocr.extract_text(image_bytes)
                            meta = asset.source_metadata or {}
                            if "facets" not in meta or meta["facets"] is None:
                                meta["facets"] = {}
                            meta["facets"][FACET_OCR_USED] = True
                            meta["facets"][FACET_OCR_ENGINE] = result.engine
                            meta["facets"][FACET_OCR_CONFIDENCE] = result.confidence
                            asset.source_metadata = meta
                            if result.text:
                                asset.text_content = result.text
                            session.add(asset)
                            enriched += 1
                        except Exception as e:
                            logger.warning(f"OCR failed for asset {asset.id}: {e}", exc_info=True)
                            failed += 1
                except Exception as e:
                    logger.warning(f"OCR failed loading PDF for parent {parent_id}: {e}", exc_info=True)
                    failed += len(page_assets)

            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)
