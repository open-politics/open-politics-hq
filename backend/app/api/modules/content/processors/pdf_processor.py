"""
PDF Processor
=============

Processes PDF files into page assets.
"""

import asyncio
import logging
import fitz  # PyMuPDF
from typing import List
from app.api.modules.content.models import Asset, AssetKind
from app.schemas import AssetCreate
from .base import BaseProcessor, ProcessingError

logger = logging.getLogger(__name__)


def extract_pdf_metadata(
    *,
    pdf_bytes: bytes | None = None,
    file_path: str | None = None,
    sample_pages: int = 3,
) -> dict:
    """
    Lightweight PDF metadata extraction for Phase 1 content detection.
    Samples first N pages to detect image-only PDFs without fully processing.
    """
    if file_path is not None:
        doc = fitz.open(filename=file_path)
    elif pdf_bytes is not None:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    else:
        raise ProcessingError("Either pdf_bytes or file_path must be provided")

    with doc:
        page_count = doc.page_count
        total_chars = 0
        to_sample = min(sample_pages, page_count)
        for i in range(to_sample):
            try:
                page = doc.load_page(i)
                text = page.get_text("text").replace("\x00", "").strip()
                total_chars += len(text)
            except Exception:
                pass
        avg_chars = total_chars / max(1, to_sample)
        is_image_only = avg_chars < 50
        return {
            "page_count": page_count,
            "text_layer_chars": total_chars,
            "is_image_only": is_image_only,
            "embedded_images": 0,  # PyMuPDF would need image list; use chars heuristic for now
        }


class PDFProcessor(BaseProcessor):
    """
    Process PDF files.
    
    Extracts text from each page and creates page assets.
    """
    
    def can_process(self, asset: Asset) -> bool:
        """Check if asset is a processable PDF."""
        return (
            asset.kind == AssetKind.PDF and
            asset.blob_path is not None
        )
    
    async def process(self, asset: Asset) -> List[Asset]:
        """
        Process PDF file and create page assets.
        
        Detects image-only PDFs (scanned documents with no extractable text)
        and reclassifies them as IMAGE assets for multimodal annotation.
        
        Args:
            asset: Parent PDF asset
            
        Returns:
            List of PDF_PAGE child assets (or empty list if reclassified as IMAGE)
        """
        if not self.can_process(asset):
            raise ProcessingError(f"Cannot process asset {asset.id} as PDF")
        
        max_pages = self.context.max_pages

        # Use filesystem path when available (local_fs) to avoid loading full file into memory
        storage = self.context.storage_provider
        if hasattr(storage, "get_file_path"):
            file_path = storage.get_file_path(asset.blob_path)
            full_text, child_assets, metadata = await asyncio.to_thread(
                self._process_pdf_sync, asset, max_pages, file_path=str(file_path)
            )
        else:
            file_stream = await storage.get_file(asset.blob_path)
            pdf_bytes = await asyncio.to_thread(file_stream.read)
            full_text, child_assets, metadata = await asyncio.to_thread(
                self._process_pdf_sync, asset, max_pages, pdf_bytes=pdf_bytes
            )
        
        # Per Foundation: "A PDF with scanned pages is still a PDF. Processing discovers
        # that its pages are image-dominant; it does not reclassify the PDF."
        # We store discovered_modalities as first-class column for queryable OCR/multimodal routing.
        is_image_only = metadata.get('is_image_only', False)
        asset.source_metadata = asset.source_metadata or {}
        asset.source_metadata.update(metadata)
        asset.discovered_modalities = ['image'] if is_image_only else ['text']
        if is_image_only:
            logger.info(f"PDF {asset.id} is image-dominant (no extractable text). Kept as PDF, set discovered_modalities=['image'].")
        
        asset.text_content = full_text
        if metadata.get('extracted_title') and (not asset.title or not asset.title.startswith('Uploaded')):
            asset.title = metadata['extracted_title']
        
        # Save child assets in batches (PDF_PAGE children, each with discovered_modalities in source_metadata)
        saved_children = []
        batch_size = 500
        for i in range(0, len(child_assets), batch_size):
            batch = child_assets[i : i + batch_size]
            batch_assets = [Asset(**c.model_dump()) for c in batch]
            saved_children.extend(batch_assets)
            self.context.session.add_all(batch_assets)
            self.context.session.flush()
        self.context.session.commit()
        logger.info(f"Processed PDF: {metadata['processed_pages']} pages extracted, created {len(saved_children)} page assets")
        
        return saved_children
    
    def _process_pdf_sync(
        self,
        asset: Asset,
        max_pages: int,
        *,
        pdf_bytes: bytes | None = None,
        file_path: str | None = None,
    ) -> tuple[str, List[AssetCreate], dict]:
        """
        Synchronous PDF processing (runs in thread).
        
        Detects image-only PDFs by checking if extractable text is minimal/absent.
        Uses file_path when available (zero-copy for local_fs), else pdf_bytes.
        
        Returns:
            Tuple of (full_text, child_assets, metadata)
        """
        if file_path is not None:
            doc = fitz.open(filename=file_path)
        elif pdf_bytes is not None:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
        else:
            raise ProcessingError("Either pdf_bytes or file_path must be provided")

        full_text = ""
        child_assets = []
        total_chars_extracted = 0

        with doc:
            page_count = doc.page_count
            pdf_title = None
            
            if doc.metadata and doc.metadata.get('title'):
                pdf_title = doc.metadata['title'].strip()
            
            pages_to_process = min(page_count, max_pages) if max_pages > 0 else page_count
            
            # Sample first few pages to detect image-only PDFs
            sample_pages = min(3, pages_to_process)  # Check first 3 pages
            
            for page_num in range(pages_to_process):
                try:
                    page = doc.load_page(page_num)
                    text = page.get_text("text").replace('\x00', '').strip()
                    
                    if text:
                        full_text += text + "\n\n"
                        total_chars_extracted += len(text)
                        page_modalities = ['text']
                        page_metadata = {'page_number': page_num + 1, 'char_count': len(text)}
                    else:
                        page_modalities = ['image']
                        page_metadata = {'page_number': page_num + 1, 'char_count': 0}
                    
                    child_asset_create = AssetCreate(
                        title=f"Page {page_num + 1}",
                        kind=AssetKind.PDF_PAGE,
                        user_id=asset.user_id,
                        infospace_id=asset.infospace_id,
                        parent_asset_id=asset.id,
                        part_index=page_num,
                        text_content=text if text else None,
                        source_metadata=page_metadata,
                        discovered_modalities=page_modalities,
                    )
                    child_assets.append(child_asset_create)
                        
                except Exception as e:
                    logger.error(f"Error processing PDF page {page_num + 1}: {e}")
                    continue
            
            # Determine if this is an image-only PDF
            # Heuristic: If we extracted very little text relative to page count,
            # it's likely an image-only (scanned) document
            avg_chars_per_page = total_chars_extracted / max(1, sample_pages)
            is_image_only = avg_chars_per_page < 50  # Less than 50 chars per page avg
            
            if is_image_only:
                logger.info(
                    f"Detected image-only PDF: {page_count} pages, "
                    f"{total_chars_extracted} chars extracted, "
                    f"{avg_chars_per_page:.1f} chars/page average"
                )
            
            metadata = {
                'page_count': page_count,
                'processed_pages': len(child_assets),
                'extracted_title': pdf_title,
                'total_chars_extracted': total_chars_extracted,
                'avg_chars_per_page': avg_chars_per_page,
                'is_image_only': is_image_only,
                'processing_options': self.context.options
            }
            
        return full_text.strip(), child_assets, metadata

