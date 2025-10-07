"""
PDF Processor
=============

Processes PDF files into page assets.
"""

import asyncio
import logging
import fitz  # PyMuPDF
from typing import List
from app.models import Asset, AssetKind
from app.schemas import AssetCreate
from .base import BaseProcessor, ProcessingError

logger = logging.getLogger(__name__)


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
        
        Args:
            asset: Parent PDF asset
            
        Returns:
            List of PDF_PAGE child assets
        """
        if not self.can_process(asset):
            raise ProcessingError(f"Cannot process asset {asset.id} as PDF")
        
        max_pages = self.context.max_pages
        
        # Read file
        file_stream = await self.context.storage_provider.get_file(asset.blob_path)
        pdf_bytes = await asyncio.to_thread(file_stream.read)
        
        # Process PDF
        full_text, child_assets, metadata = await asyncio.to_thread(
            self._process_pdf_sync, pdf_bytes, asset, max_pages
        )
        
        # Update parent asset
        asset.text_content = full_text
        if metadata.get('extracted_title') and not asset.title.startswith('Uploaded'):
            asset.title = metadata['extracted_title']
        asset.source_metadata.update(metadata)
        
        # Save child assets
        saved_children = []
        for child_create in child_assets:
            child_asset = self.context.asset_service.create_asset(child_create)
            saved_children.append(child_asset)
        
        logger.info(f"Processed PDF: {metadata['processed_pages']} pages extracted, created {len(saved_children)} page assets")
        
        return saved_children
    
    def _process_pdf_sync(
        self, 
        pdf_bytes: bytes, 
        asset: Asset, 
        max_pages: int
    ) -> tuple[str, List[AssetCreate], dict]:
        """
        Synchronous PDF processing (runs in thread).
        
        Returns:
            Tuple of (full_text, child_assets, metadata)
        """
        full_text = ""
        child_assets = []
        
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            page_count = doc.page_count
            pdf_title = None
            
            if doc.metadata and doc.metadata.get('title'):
                pdf_title = doc.metadata['title'].strip()
            
            pages_to_process = min(page_count, max_pages)
            
            for page_num in range(pages_to_process):
                try:
                    page = doc.load_page(page_num)
                    text = page.get_text("text").replace('\x00', '').strip()
                    
                    if text:
                        full_text += text + "\n\n"
                        
                        child_asset_create = AssetCreate(
                            title=f"Page {page_num + 1}",
                            kind=AssetKind.PDF_PAGE,
                            user_id=asset.user_id,
                            infospace_id=asset.infospace_id,
                            parent_asset_id=asset.id,
                            part_index=page_num,
                            text_content=text,
                            source_metadata={
                                'page_number': page_num + 1,
                                'char_count': len(text)
                            }
                        )
                        child_assets.append(child_asset_create)
                        
                except Exception as e:
                    logger.error(f"Error processing PDF page {page_num + 1}: {e}")
                    continue
            
            metadata = {
                'page_count': page_count,
                'processed_pages': len(child_assets),
                'extracted_title': pdf_title,
                'processing_options': self.context.options
            }
            
            return full_text.strip(), child_assets, metadata

