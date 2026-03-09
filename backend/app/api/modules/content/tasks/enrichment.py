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
    FACET_OCR_FAILED,
    FACET_QUALITY_SCORE,
    get_facet,
    merge_facets,
)
from app.api.modules.content.utils.resolve_source_file import resolve_source_file

logger = logging.getLogger(__name__)


@celery.task(name="enrich_geocoding")
def enrich_geocoding_task(asset_ids: List[int] | int):
    """
    Reactive watcher task: geocodes assets that have facets.location but are missing
    facets.location_lat / location_lon. Uses GeocodingProvider from task_context.
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        # Phase 1: Load assets, collect work (no external I/O) — short session
        work: List[tuple[int, str]] = []
        failed = 0
        geocoding = None
        with task_context(providers=["geocoding"]) as (session, prov):
            geocoding = prov.get("geocoding")
            if not geocoding:
                logger.warning("Geocoding provider not configured; skipping enrich_geocoding")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    failed += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY:
                    continue
                facets = asset.facets or {}
                location = get_facet(facets, FACET_LOCATION)
                lat = get_facet(facets, FACET_LOCATION_LAT)
                lon = get_facet(facets, FACET_LOCATION_LON)
                if not location or not isinstance(location, str) or not location.strip():
                    continue
                if lat is not None and lon is not None:
                    continue
                work.append((asset.id, location.strip()))

        # Phase 2: External API calls — no DB session held
        results: List[tuple[int, dict | None]] = []
        for asset_id, location in work:
            try:
                result = await geocoding.geocode(location)
                results.append((asset_id, result))
            except Exception as e:
                logger.warning(f"Geocoding failed for asset {asset_id}: {e}")
                failed += 1

        # Phase 3: Write results — short session, no await
        enriched = 0
        with task_context(providers=["geocoding"]) as (session, _):
            for asset_id, result in results:
                if not result or "coordinates" not in result:
                    failed += 1
                    continue
                coords = result["coordinates"]
                if len(coords) < 2:
                    failed += 1
                    continue
                patch = {
                    FACET_LOCATION_LON: float(coords[0]),
                    FACET_LOCATION_LAT: float(coords[1]),
                }
                if result.get("display_name"):
                    patch[FACET_LOCATION] = result["display_name"]
                try:
                    merge_facets(session, asset_id, patch)
                    enriched += 1
                    from app.core.events import emit
                    emit("asset.enriched", {"asset_id": asset_id, "enricher_name": "geocoding", "facet_key": FACET_LOCATION_LAT})
                except Exception as e:
                    logger.warning(f"Geocoding write failed for asset {asset_id}: {e}")
                    failed += 1
                    session.rollback()
            session.commit()

        return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)


@celery.task(name="enrich_file_hash")
def enrich_file_hash_task(asset_ids: List[int] | int):
    """
    Reactive watcher task: computes SHA-256 for READY assets with blob_path but no content_hash.
    Prefers get_file_path() for local_fs (zero-copy); falls back to get_file() for remote.
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
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
        # Phase 1: Load assets, collect blob_paths — short session
        work: List[tuple[int, str]] = []
        failed = 0
        storage = None
        with task_context(providers=["storage"]) as (session, prov):
            storage = prov.get("storage")
            if not storage:
                logger.warning("Storage provider not configured; skipping enrich_file_hash")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    failed += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY or not asset.blob_path or asset.content_hash:
                    continue
                work.append((asset.id, asset.blob_path))

        # Phase 2: Read files and compute hashes — no DB session held
        hashes: List[tuple[int, str | None]] = []
        for asset_id, blob_path in work:
            try:
                path_or_stream = None
                if storage and hasattr(storage, "get_file_path"):
                    try:
                        path_or_stream = storage.get_file_path(blob_path)
                    except NotImplementedError:
                        pass
                    except FileNotFoundError:
                        logger.warning(f"Hash enrichment skipped for asset {asset_id}: file '{blob_path}' not found")
                        failed += 1
                        continue
                if path_or_stream is None and storage:
                    try:
                        fh = await storage.get_file(blob_path)
                        try:
                            path_or_stream = io.BytesIO(fh.read())
                        finally:
                            fh.close()
                    except FileNotFoundError:
                        logger.warning(f"Hash enrichment skipped for asset {asset_id}: file '{blob_path}' not found")
                        failed += 1
                        continue
                if path_or_stream is not None:
                    computed = await asyncio.to_thread(_compute_sha256_sync, path_or_stream)
                    hashes.append((asset_id, computed))
                else:
                    failed += 1
            except FileNotFoundError:
                logger.warning(f"Hash enrichment skipped for asset {asset_id}: file '{blob_path}' not found")
                failed += 1
            except Exception as e:
                logger.warning(f"Hash enrichment failed for asset {asset_id}: {e}", exc_info=True)
                failed += 1

        # Phase 3: Write results — short session
        enriched = 0
        with task_context(providers=["storage"]) as (session, _):
            for asset_id, computed in hashes:
                if computed:
                    asset = session.get(Asset, asset_id)
                    if asset:
                        asset.content_hash = computed
                        session.add(asset)
                        enriched += 1
                        from app.core.events import emit
                        emit("asset.enriched", {"asset_id": asset_id, "enricher_name": "hash", "facet_key": "content_hash"})
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
def enrich_ocr_task(asset_ids: List[int] | int, force: bool = False):
    """
    Reactive watcher task: OCR assets (PDF_PAGE children) with no text_content.
    Groups pages by parent PDF and loads each PDF once for all its pages.
    Sets FACET_OCR_USED, FACET_OCR_ENGINE, FACET_OCR_CONFIDENCE.
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        from collections import defaultdict

        # Phase 1: Load assets, group by parent — short session
        pages_by_parent: dict[int, list[tuple[int, int | None]]] = defaultdict(list)  # parent_id -> [(asset_id, page_index)]
        blob_path_by_parent: dict[int, str] = {}
        skipped = 0
        storage = None
        ocr = None
        with task_context(providers=["storage", "ocr"]) as (session, prov):
            storage = prov.get("storage")
            ocr = prov.get("ocr")
            if not ocr:
                logger.warning("OCR provider not configured; skipping enrich_ocr")
                return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset:
                    skipped += 1
                    continue
                if asset.processing_status != ProcessingStatus.READY or asset.kind != AssetKind.PDF_PAGE:
                    continue
                if not force and get_facet(asset.facets or {}, FACET_OCR_USED):
                    continue
                if not asset.parent_asset_id:
                    continue
                blob_path, page_index = resolve_source_file(asset, session)
                pages_by_parent[asset.parent_asset_id].append((asset.id, page_index))
                if asset.parent_asset_id not in blob_path_by_parent:
                    blob_path_by_parent[asset.parent_asset_id] = blob_path

        failed = len(asset_ids) - sum(len(p) for p in pages_by_parent.values()) - skipped

        # Phase 2: Load PDFs, run OCR — no DB session held
        ocr_results: List[tuple[int, str | None, str, float]] = []  # (asset_id, text, engine, confidence)
        ocr_failed_ids: List[int] = []  # assets where OCR failed; set ocr_failed facet to stop re-dispatch
        for parent_id, page_list in pages_by_parent.items():
            if not page_list:
                continue
            blob_path = blob_path_by_parent.get(parent_id)
            if not blob_path:
                ocr_failed_ids.extend(aid for aid, _ in page_list)
                failed += len(page_list)
                continue
            try:
                pdf_bytes = None
                if storage and hasattr(storage, "get_file_path"):
                    try:
                        path = storage.get_file_path(blob_path)
                        pdf_bytes = io.BytesIO(path.read_bytes())
                    except (NotImplementedError, OSError):
                        pass
                if pdf_bytes is None and storage:
                    fh = await storage.get_file(blob_path)
                    try:
                        pdf_bytes = io.BytesIO(fh.read())
                    finally:
                        fh.close()
                if not pdf_bytes:
                    ocr_failed_ids.extend(aid for aid, _ in page_list)
                    failed += len(page_list)
                    continue
                for asset_id, page_index in page_list:
                    try:
                        pdf_bytes.seek(0)
                        image_bytes = await asyncio.to_thread(
                            _render_pdf_page_to_image, pdf_bytes, page_index or 0
                        )
                        result = await ocr.extract_text(image_bytes)
                        ocr_results.append((asset_id, result.text, result.engine, result.confidence))
                    except Exception as e:
                        logger.warning(f"OCR failed for asset {asset_id}: {e}", exc_info=True)
                        ocr_failed_ids.append(asset_id)
                        failed += 1
            except Exception as e:
                logger.warning(f"OCR failed loading PDF for parent {parent_id}: {e}", exc_info=True)
                ocr_failed_ids.extend(aid for aid, _ in page_list)
                failed += len(page_list)

        # Phase 3: Write results — short session
        enriched = 0
        with task_context(providers=["storage", "ocr"]) as (session, _):
            for asset_id, text, engine, confidence in ocr_results:
                try:
                    merge_facets(session, asset_id, {
                        FACET_OCR_USED: True,
                        FACET_OCR_ENGINE: engine,
                        FACET_OCR_CONFIDENCE: confidence,
                    })
                    if text:
                        asset = session.get(Asset, asset_id)
                        if asset:
                            asset.text_content = text
                            session.add(asset)
                    enriched += 1
                    from app.core.events import emit
                    emit("asset.enriched", {"asset_id": asset_id, "enricher_name": "ocr", "facet_key": FACET_OCR_USED})
                except Exception as e:
                    logger.warning(f"OCR write failed for asset {asset_id}: {e}")
                    failed += 1
                    session.rollback()
            for asset_id in ocr_failed_ids:
                try:
                    merge_facets(session, asset_id, {FACET_OCR_FAILED: True})
                except Exception as e:
                    logger.warning(f"OCR failed-facet write failed for asset {asset_id}: {e}")
                    session.rollback()
            session.commit()
        return {"total": len(asset_ids), "enriched": enriched, "failed": failed}

    return run_async_in_celery(_enrich_batch)


@celery.task(name="enrich_language")
def enrich_language_task(asset_ids: List[int] | int):
    """
    Detect language for assets with text_content but missing language facet.

    Intentional: CPU-only (langdetect), no I/O; single session acceptable.
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    async def _enrich_batch():
        try:
            import langdetect
        except ImportError:
            logger.warning("langdetect not installed; skipping language detection")
            return {"total": len(asset_ids), "enriched": 0, "failed": len(asset_ids)}
        with task_context(providers=[]) as (session, _):
            enriched = failed = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset or asset.processing_status != ProcessingStatus.READY or not (asset.text_content or "").strip():
                    continue
                facets = asset.facets or {}
                if get_facet(facets, "language"):
                    continue
                try:
                    detected = langdetect.detect(asset.text_content[:5000])
                    if detected:
                        merge_facets(session, asset.id, {"language": detected})
                        enriched += 1
                        from app.core.events import emit
                        emit("asset.enriched", {"asset_id": asset.id, "enricher_name": "language_detection", "facet_key": "language"})
                except Exception as e:
                    logger.warning(f"Language detection failed for asset {asset_id}: {e}")
                    failed += 1
                    session.rollback()
            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}
    return run_async_in_celery(_enrich_batch)


@celery.task(name="enrich_quality_score")
def enrich_quality_score_task(asset_ids: List[int] | int):
    """
    Entropy-based quality score for assets with text_content.

    Intentional: CPU-only (entropy calculation), no I/O; single session acceptable.
    """
    if isinstance(asset_ids, int):
        asset_ids = [asset_ids]
    if not asset_ids:
        return {"total": 0, "enriched": 0, "failed": 0}

    def _entropy_score(text: str) -> float:
        if not text or len(text) < 10:
            return 0.0
        from collections import Counter
        import math
        c = Counter(text)
        n = len(text)
        return -sum((count / n) * math.log2(count / n) for count in c.values() if count > 0)

    async def _enrich_batch():
        with task_context(providers=[]) as (session, _):
            enriched = failed = 0
            for asset_id in asset_ids:
                asset = session.get(Asset, asset_id)
                if not asset or asset.processing_status != ProcessingStatus.READY or not (asset.text_content or "").strip():
                    continue
                facets = asset.facets or {}
                if get_facet(facets, FACET_QUALITY_SCORE) is not None:
                    continue
                try:
                    score = round(_entropy_score(asset.text_content[:10000]), 4)
                    merge_facets(session, asset.id, {FACET_QUALITY_SCORE: score})
                    enriched += 1
                    from app.core.events import emit
                    emit("asset.enriched", {"asset_id": asset.id, "enricher_name": "quality_score", "facet_key": FACET_QUALITY_SCORE})
                except Exception as e:
                    logger.warning(f"Quality score failed for asset {asset_id}: {e}")
                    failed += 1
                    session.rollback()
            session.commit()
            return {"total": len(asset_ids), "enriched": enriched, "failed": failed}
    return run_async_in_celery(_enrich_batch)
