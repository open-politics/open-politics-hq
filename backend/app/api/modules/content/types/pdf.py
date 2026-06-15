"""PDF content type.

One class = one content type. The decorator declares what a PDF *is*; the methods
are what it *does*. Whatever it doesn't do, it simply doesn't define.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Optional

import fitz  # PyMuPDF

from app.api.modules.content.models import Asset, AssetKind
from app.api.modules.content.types import content_type, Text, Image
from app.schemas import AssetCreate

logger = logging.getLogger(__name__)


@content_type(
    kind=AssetKind.PDF,
    extensions={".pdf"},
    mimetypes={"application/pdf"},
    is_container=True,
    child_kind=AssetKind.PDF_PAGE,
    modalities=[Text, Image],
)
class PDF:
    """A PDF becomes one PDF_PAGE child per page. A scanned PDF stays a PDF
    (Foundation: never reclassify) — its pages carry an ``image`` modality so the
    OCR enricher picks them up. Modalities are discovered per page, in dominance
    order, and unioned onto the parent."""

    @staticmethod
    def recognizes(head: bytes) -> bool:
        """%PDF magic — the definitive signal when a server mislabels the mimetype."""
        return head.startswith(b"%PDF-")

    async def metadata(self, asset: Asset, storage) -> Optional[Dict[str, Any]]:
        """Phase-1 detection: sample the first pages to spot image-only PDFs."""
        if not asset.blob_path:
            return None
        from app.api.modules.content.utils.storage_access import read_to_path
        try:
            path, is_temp = await read_to_path(storage, asset.blob_path)
            try:
                return await asyncio.to_thread(_sample_pages, str(path))
            finally:
                if is_temp:
                    _unlink(path)
        except Exception:
            return None

    async def process(self, context, asset: Asset) -> List[Asset]:
        """Extract pages into PDF_PAGE children. Children flush through AssetBuilder
        (flush-never-commit) — the caller owns the transaction."""
        if not asset.blob_path:
            raise ValueError(f"PDF has no blob_path: asset {asset.id}")

        from app.api.modules.content.utils.storage_access import read_to_path
        path, is_temp = await read_to_path(context.storage_provider, asset.blob_path)
        try:
            full_text, pages, meta = await asyncio.to_thread(
                _extract_pages, asset, context.max_pages, str(path), context.options,
            )
        finally:
            if is_temp:
                _unlink(path)

        asset.file_info = {**(asset.file_info or {}), **meta}
        asset.modalities = meta.get("modality_union") or ["text"]
        asset.text_content = full_text
        if meta.get("extracted_title") and (not asset.title or not asset.title.startswith("Uploaded")):
            asset.title = meta["extracted_title"]
        if meta.get("is_image_only"):
            logger.info("PDF %s is image-dominant; kept as PDF, modalities=%s", asset.id, asset.modalities)
        context.session.add(asset)

        children = [Asset(**c.model_dump()) for c in pages]
        # First process → build; reprocess → reconcile pages in place by index, so a
        # page's annotations survive a re-extract (content.asset_builder.persist_children).
        saved = await context.persist_children(asset.id, children, match_key="part_index")
        logger.info("Processed PDF %s: %d pages", asset.id, len(saved))
        return saved

    def preview(self, asset: Asset, children: Optional[List[Asset]] = None) -> Dict[str, Any]:
        """Tree-UI preview: page count + first-page excerpt + file size."""
        out: Dict[str, Any] = {
            "page_count": len(children) if children is not None
            else (asset.file_info or {}).get("page_count", 0)
        }
        if asset.text_content:
            out["excerpt"] = asset.text_content[:200].strip() + ("..." if len(asset.text_content) > 200 else "")
        if (asset.file_info or {}).get("file_size"):
            out["file_size"] = asset.file_info["file_size"]
        return out


# ── internal helpers (sync; run in a thread) ───────────────────────────────────

def _unlink(path) -> None:
    try:
        path.unlink()
    except OSError:
        pass


def _extract_pages(
    asset: Asset, max_pages: int, file_path: str, options: Dict[str, Any],
) -> tuple[str, List[AssetCreate], dict]:
    """Walk the PDF, build a PDF_PAGE AssetCreate per page with ordered modalities,
    and return (full_text, pages, parent metadata)."""
    doc = fitz.open(filename=file_path)
    full_text = ""
    pages: List[AssetCreate] = []
    total_chars = 0
    seen: set[str] = set()

    with doc:
        page_count = doc.page_count
        title = (doc.metadata or {}).get("title", "").strip() or None
        to_process = min(page_count, max_pages) if max_pages > 0 else page_count
        sample = min(3, to_process)

        for n in range(to_process):
            try:
                page = doc.load_page(n)
                text = page.get_text("text").replace("\x00", "").strip()
                images = page.get_images()

                modalities: List[str] = []
                if text:
                    modalities.append("text")
                    full_text += text + "\n\n"
                    total_chars += len(text)
                if images:
                    modalities.append("image")
                if not modalities:
                    modalities = ["image"]  # blank / vector-only page
                seen.update(modalities)

                pages.append(AssetCreate(
                    title=f"Page {n + 1}",
                    kind=AssetKind.PDF_PAGE,
                    user_id=asset.user_id,
                    infospace_id=asset.infospace_id,
                    parent_asset_id=asset.id,
                    part_index=n,
                    text_content=text or None,
                    file_info={"page_number": n + 1, "char_count": len(text), "image_count": len(images)},
                    modalities=modalities,
                ))
            except Exception as e:
                logger.error("Error processing PDF page %d: %s", n + 1, e)
                continue

        avg_chars = total_chars / max(1, sample)
        ordered = [m for m in ("text", "image") if m in seen]  # dominance order
        meta = {
            "page_count": page_count,
            "processed_pages": len(pages),
            "extracted_title": title,
            "total_chars_extracted": total_chars,
            "avg_chars_per_page": avg_chars,
            "is_image_only": avg_chars < 50,
            "modality_union": ordered or ["text"],
            "processing_options": options,
        }
    return full_text.strip(), pages, meta


def _sample_pages(file_path: str, sample_pages: int = 3) -> dict:
    """Cheap first-pages sample for Phase-1 image-only detection."""
    doc = fitz.open(filename=file_path)
    with doc:
        page_count = doc.page_count
        chars = images = 0
        for i in range(min(sample_pages, page_count)):
            try:
                page = doc.load_page(i)
                chars += len(page.get_text("text").replace("\x00", "").strip())
                images += len(page.get_images())
            except Exception:
                pass
        return {
            "page_count": page_count,
            "text_layer_chars": chars,
            "is_image_only": (chars / max(1, min(sample_pages, page_count))) < 50,
            "embedded_images": images,
        }
