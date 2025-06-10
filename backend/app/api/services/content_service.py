"""
Content Service
==============

Comprehensive service for all content ingestion and processing.

This service handles:
- File uploads (CSV, PDF, images, documents)
- Web content (URLs, scraping, articles)
- Direct text content
- Bulk operations
- Content processing (CSV parsing, PDF extraction, web scraping)

Replaces the scattered functionality from:
- IngestionService
- StreamlinedIngestionService
- Processing core functions
- Asset processing tasks
"""

import logging
import os
import uuid
import asyncio
import csv
import io
import fitz
import dateutil.parser
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

from fastapi import UploadFile, HTTPException
from sqlmodel import Session, select

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import AssetCreate
from app.api.providers.base import StorageProvider, ScrapingProvider
from app.api.services.service_utils import validate_infospace_access

logger = logging.getLogger(__name__)

class ContentService:
    """
    Comprehensive content service for all ingestion and processing needs.
    
    This service provides a clean, unified interface for:
    - Ingesting files, URLs, and text content
    - Processing content to extract structured data
    - Creating hierarchical assets (parent/child relationships)
    - Background processing for heavy operations
    """
    
    def __init__(
        self,
        session: Session,
        storage_provider: StorageProvider,
        scraping_provider: Optional[ScrapingProvider] = None
    ):
        self.session = session
        self.storage = storage_provider
        self.scraper = scraping_provider
        logger.info("ContentService initialized")

    # ─────────────── Public Ingestion Methods ─────────────── #

    async def ingest_file(
        self,
        file: UploadFile,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        process_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Ingest a file upload and optionally process it immediately.
        
        Args:
            file: The uploaded file
            infospace_id: Target infospace ID
            user_id: User performing the ingestion
            title: Optional custom title
            process_immediately: Whether to process content immediately
            options: Processing options (delimiter, encoding, etc.)
            
        Returns:
            The created asset
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Detect content type and generate storage path
        file_ext = os.path.splitext(file.filename or "")[1].lower()
        content_kind = self._detect_content_kind(file_ext)
        storage_path = f"user_{user_id}/{uuid.uuid4()}{file_ext}"
        
        # Upload to storage
        await self.storage.upload_file(file, storage_path)
        
        # Create base asset
        asset_title = title or file.filename or f"Uploaded {content_kind.value}"
        asset = Asset(
            title=asset_title,
            kind=content_kind,
            user_id=user_id,
            infospace_id=infospace_id,
            blob_path=storage_path,
            processing_status=ProcessingStatus.READY,
            source_metadata={
                "original_filename": file.filename,
                "file_size": getattr(file, 'size', None),
                "mime_type": getattr(file, 'content_type', None),
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "file_upload"
            }
        )
        
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        # Process immediately if requested and needed
        if process_immediately and self._needs_processing(content_kind):
            try:
                await self.process_content(asset, options or {})
            except Exception as e:
                logger.error(f"Content processing failed for asset {asset.id}: {e}")
                asset.processing_status = ProcessingStatus.FAILED
                asset.processing_error = str(e)
                self.session.add(asset)
                self.session.commit()
        
        return asset

    async def ingest_url(
        self,
        url: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        scrape_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Ingest web content from a URL.
        
        Args:
            url: The URL to scrape
            infospace_id: Target infospace ID
            user_id: User performing the ingestion
            title: Optional custom title (will be overridden by scraped title if available)
            scrape_immediately: Whether to scrape content immediately
            options: Scraping options (timeout, etc.)
            
        Returns:
            The created asset
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        if not self.scraper:
            raise ValueError("Web scraping not available - scraping provider not configured")
        
        # Create base asset with temporary title
        asset_title = title or f"Article: {url}"
        asset = Asset(
            title=asset_title,
            kind=AssetKind.WEB,
            user_id=user_id,
            infospace_id=infospace_id,
            source_identifier=url,
            processing_status=ProcessingStatus.READY,
            source_metadata={
                "original_url": url,
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "url_scraping",
                "provided_title": title  # Store the originally provided title
            }
        )
        
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        # Scrape immediately if requested
        if scrape_immediately:
            try:
                await self.process_content(asset, options or {})
            except Exception as e:
                logger.error(f"Web scraping failed for asset {asset.id}: {e}")
                asset.processing_status = ProcessingStatus.FAILED
                asset.processing_error = str(e)
                self.session.add(asset)
                self.session.commit()
        
        return asset

    def ingest_text(
        self,
        text_content: str,
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        event_timestamp: Optional[datetime] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Asset:
        """
        Ingest direct text content.
        
        Args:
            text_content: The text content to ingest
            infospace_id: Target infospace ID
            user_id: User performing the ingestion
            title: Optional title
            event_timestamp: Optional timestamp for the content
            metadata: Additional metadata
            
        Returns:
            The created asset
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        asset_title = title or f"Text Content ({len(text_content)} chars)"
        source_metadata = {
            "content_length": len(text_content),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "ingestion_method": "direct_text"
        }
        
        if metadata:
            source_metadata.update(metadata)
        
        asset = Asset(
            title=asset_title,
            kind=AssetKind.TEXT,
            user_id=user_id,
            infospace_id=infospace_id,
            text_content=text_content,
            event_timestamp=event_timestamp,
            processing_status=ProcessingStatus.READY,
            source_metadata=source_metadata
        )
        
        self.session.add(asset)
        self.session.commit()
        self.session.refresh(asset)
        
        return asset

    async def ingest_bulk_urls(
        self,
        urls: List[str],
        infospace_id: int,
        user_id: int,
        base_title: Optional[str] = None,
        scrape_immediately: bool = True,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Ingest multiple URLs as separate web assets.
        
        Args:
            urls: List of URLs to ingest
            infospace_id: Target infospace ID
            user_id: User performing the ingestion
            base_title: Base title for generated assets
            scrape_immediately: Whether to scrape content immediately
            options: Scraping options
            
        Returns:
            List of created assets
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        assets = []
        base_options = options or {}
        
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                url_options = base_options.copy()
                url_options.update({
                    "batch_index": i,
                    "batch_total": len(urls)
                })
                
                asset = await self.ingest_url(
                    url=url,
                    infospace_id=infospace_id,
                    user_id=user_id,
                    title=url_title,
                    scrape_immediately=scrape_immediately,
                    options=url_options
                )
                assets.append(asset)
                
                # Small delay to be respectful to servers
                if scrape_immediately:
                    await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Failed to ingest URL {url} in bulk operation: {e}")
                continue
        
        logger.info(f"Bulk URL ingestion completed: {len(assets)}/{len(urls)} successful")
        return assets

    # ─────────────── Content Processing Methods ─────────────── #

    async def process_content(
        self,
        asset: Asset,
        options: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Process content based on asset type.
        
        Args:
            asset: The asset to process
            options: Processing options specific to content type
        """
        if asset.processing_status == ProcessingStatus.PROCESSING:
            logger.warning(f"Asset {asset.id} is already being processed")
            return
        
        asset.processing_status = ProcessingStatus.PROCESSING
        asset.processing_error = None
        self.session.add(asset)
        self.session.commit()
        
        try:
            if asset.kind == AssetKind.CSV:
                await self._process_csv(asset, options or {})
            elif asset.kind == AssetKind.PDF:
                await self._process_pdf(asset, options or {})
            elif asset.kind == AssetKind.WEB:
                await self._process_web_content(asset, options or {})
            else:
                logger.info(f"No processing needed for asset kind: {asset.kind}")
                return
            
            asset.processing_status = ProcessingStatus.READY
            self.session.add(asset)
            self.session.commit()
            
        except Exception as e:
            asset.processing_status = ProcessingStatus.FAILED
            asset.processing_error = str(e)
            self.session.add(asset)
            self.session.commit()
            raise

    async def reprocess_content(
        self,
        asset: Asset,
        options: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Reprocess existing content with new options.
        
        Args:
            asset: The asset to reprocess
            options: New processing options
        """
        # Delete existing child assets
        children = self.session.exec(
            select(Asset).where(Asset.parent_asset_id == asset.id)
        ).all()
        
        if children:
            for child in children:
                self.session.delete(child)
            self.session.flush()
            logger.info(f"Deleted {len(children)} existing child assets")
        
        # Reprocess with new options
        await self.process_content(asset, options)

    # ─────────────── Internal Processing Methods ─────────────── #

    async def _process_csv(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process CSV file to create row assets."""
        if not asset.blob_path:
            raise ValueError("CSV asset has no file content")
        
        # Get processing options
        delimiter = options.get('delimiter')
        encoding = options.get('encoding', 'utf-8')
        skip_rows = options.get('skip_rows', 0)
        max_rows = options.get('max_rows', 50000)
        
        # Get CSV content
        file_stream = await self.storage.get_file(asset.blob_path)
        csv_bytes = await asyncio.to_thread(file_stream.read)
        
        # Decode with error handling
        try:
            csv_text = csv_bytes.decode(encoding, errors='replace')
        except UnicodeDecodeError:
            # Try common fallback encodings
            for fallback in ['utf-8', 'latin1', 'cp1252']:
                try:
                    csv_text = csv_bytes.decode(fallback, errors='replace')
                    encoding = fallback
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("Could not decode CSV file with any common encoding")
        
        # Auto-detect delimiter if not provided
        if not delimiter:
            delimiter = self._detect_csv_delimiter(csv_text)
        
        # Parse CSV
        csv_lines = csv_text.split('\n')
        csv_reader = csv.reader(csv_lines, delimiter=delimiter)
        
        # Skip initial rows
        for _ in range(skip_rows):
            try:
                next(csv_reader)
            except StopIteration:
                raise ValueError(f"CSV has fewer rows than skip_rows={skip_rows}")
        
        # Get header
        try:
            header = [h.strip() for h in next(csv_reader) if h.strip()]
        except StopIteration:
            raise ValueError("CSV is empty or has no header row")
        
        if not header:
            raise ValueError("CSV header row is empty")
        
        # Process data rows
        child_assets = []
        full_text_parts = [f"CSV Headers: {' | '.join(header)}"]
        rows_processed = 0
        
        for idx, row in enumerate(csv_reader):
            if rows_processed >= max_rows:
                logger.warning(f"CSV processing stopped at {max_rows} rows limit")
                break
                
            # Skip empty rows
            if not any(cell.strip() for cell in row if cell):
                continue
            
            # Normalize row length
            while len(row) < len(header):
                row.append('')
            if len(row) > len(header):
                row = row[:len(header)]
            
            # Clean row data
            cleaned_row = [cell.replace('\x00', '').strip() for cell in row]
            row_data = {header[j]: cleaned_row[j] for j in range(len(header))}
            row_text = f"| {' | '.join(cleaned_row)} |"
            full_text_parts.append(row_text)
            
            child_asset = Asset(
                title=f"Row {rows_processed + 1}",
                kind=AssetKind.CSV_ROW,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                part_index=rows_processed,
                text_content=row_text,
                processing_status=ProcessingStatus.READY,
                source_metadata={
                    'row_number': skip_rows + rows_processed + 2,  # +1 for header, +1 for 1-based
                    'data_row_index': rows_processed,
                    'original_row_data': row_data
                }
            )
            child_assets.append(child_asset)
            rows_processed += 1
            
            # Periodic yield for large files
            if rows_processed % 1000 == 0:
                await asyncio.sleep(0.01)
        
        # Update parent asset
        asset.text_content = "\n".join(full_text_parts)
        asset.source_metadata.update({
            'columns': header,
            'delimiter_used': delimiter,
            'encoding_used': encoding,
            'rows_processed': rows_processed,
            'column_count': len(header),
            'processing_options': options
        })
        
        # Create child assets
        if child_assets:
            self.session.add_all(child_assets)
            self.session.flush()
        
        logger.info(f"Processed CSV: {rows_processed} rows, {len(header)} columns")

    async def _process_pdf(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process PDF file to create page assets."""
        if not asset.blob_path:
            raise ValueError("PDF asset has no file content")
        
        max_pages = options.get('max_pages', 1000)
        
        # Get PDF content
        file_stream = await self.storage.get_file(asset.blob_path)
        pdf_bytes = await asyncio.to_thread(file_stream.read)
        
        def process_pdf_sync():
            full_text = ""
            child_assets = []
            
            with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
                page_count = doc.page_count
                pdf_title = None
                
                # Extract title from metadata
                if doc.metadata and doc.metadata.get('title'):
                    pdf_title = doc.metadata['title'].strip()
                
                pages_to_process = min(page_count, max_pages)
                
                for page_num in range(pages_to_process):
                    try:
                        page = doc.load_page(page_num)
                        text = page.get_text("text").replace('\x00', '').strip()
                        
                        if text:
                            full_text += text + "\n\n"
                            
                            child_asset = Asset(
                                title=f"Page {page_num + 1}",
                                kind=AssetKind.PDF_PAGE,
                                user_id=asset.user_id,
                                infospace_id=asset.infospace_id,
                                parent_asset_id=asset.id,
                                part_index=page_num,
                                text_content=text,
                                processing_status=ProcessingStatus.READY,
                                source_metadata={
                                    'page_number': page_num + 1,
                                    'char_count': len(text)
                                }
                            )
                            child_assets.append(child_asset)
                            
                    except Exception as e:
                        logger.error(f"Error processing PDF page {page_num + 1}: {e}")
                        continue
                
                return full_text.strip(), child_assets, {
                    'page_count': page_count,
                    'processed_pages': len(child_assets),
                    'extracted_title': pdf_title,
                    'processing_options': options
                }
        
        full_text, child_assets, metadata = await asyncio.to_thread(process_pdf_sync)
        
        # Update parent asset
        asset.text_content = full_text
        if metadata.get('extracted_title') and not asset.title.startswith('Uploaded'):
            asset.title = metadata['extracted_title']
        asset.source_metadata.update(metadata)
        
        # Create child assets
        if child_assets:
            self.session.add_all(child_assets)
            self.session.flush()
        
        logger.info(f"Processed PDF: {metadata['processed_pages']} pages extracted")

    async def _process_web_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process web content by scraping the URL."""
        if not asset.source_identifier:
            raise ValueError("Web asset has no URL to scrape")
        
        timeout = options.get('timeout', 30)
        max_images = options.get('max_images', 8)
        
        # Scrape the URL
        scraped_data = await self.scraper.scrape_url(
            asset.source_identifier,
            timeout=timeout
        )
        
        if not scraped_data or not scraped_data.get('text_content'):
            raise ValueError("No content could be scraped from URL")
        
        # Update main asset
        text_content = scraped_data.get('text_content', '').strip()
        title = scraped_data.get('title', '').strip()
        
        asset.text_content = text_content
        # Always use scraped title if available, otherwise keep existing title
        if title:
            asset.title = title
            logger.info(f"Updated asset {asset.id} title to scraped title: '{title}'")
        
        # Parse publication date
        if scraped_data.get('publication_date'):
            try:
                parsed_dt = dateutil.parser.parse(scraped_data['publication_date'])
                asset.event_timestamp = parsed_dt.replace(
                    tzinfo=parsed_dt.tzinfo or timezone.utc
                )
            except Exception as e:
                logger.warning(f"Could not parse publication date: {e}")
        
        # Update metadata
        asset.source_metadata.update({
            'scraped_at': datetime.now(timezone.utc).isoformat(),
            'scraped_title': scraped_data.get('title'),
            'top_image': scraped_data.get('top_image'),
            'summary': scraped_data.get('summary'),
            'publication_date': scraped_data.get('publication_date'),
            'content_length': len(text_content),
            'processing_options': options
        })
        
        # Create image child assets
        image_assets = []
        
        # Featured image (top_image) as index 0
        if scraped_data.get('top_image'):
            featured_asset = Asset(
                title=f"Featured: {asset.title}",
                kind=AssetKind.IMAGE,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                source_identifier=scraped_data['top_image'],
                part_index=0,
                processing_status=ProcessingStatus.READY,
                source_metadata={
                    'image_role': 'featured',
                    'image_url': scraped_data['top_image'],
                    'parent_article': {
                        'title': asset.title,
                        'url': asset.source_identifier,
                        'asset_id': asset.id
                    },
                    'scraped_at': asset.source_metadata['scraped_at'],
                    'is_hero_image': True
                }
            )
            image_assets.append(featured_asset)
        
        # Content images
        images = scraped_data.get('images', [])
        if images:
            content_images = self._filter_content_images(
                images, 
                scraped_data.get('top_image')
            )
            
            start_index = 1 if scraped_data.get('top_image') else 0
            for idx, img_url in enumerate(content_images[:max_images]):
                content_asset = Asset(
                    title=f"Image {start_index + idx + 1}: {asset.title}",
                    kind=AssetKind.IMAGE,
                    user_id=asset.user_id,
                    infospace_id=asset.infospace_id,
                    parent_asset_id=asset.id,
                    source_identifier=img_url,
                    part_index=start_index + idx,
                    processing_status=ProcessingStatus.READY,
                    source_metadata={
                        'image_role': 'content',
                        'image_url': img_url,
                        'parent_article': {
                            'title': asset.title,
                            'url': asset.source_identifier,
                            'asset_id': asset.id
                        },
                        'content_index': idx,
                        'scraped_at': asset.source_metadata['scraped_at']
                    }
                )
                image_assets.append(content_asset)
        
        # Create image assets
        if image_assets:
            self.session.add_all(image_assets)
            self.session.flush()
        
        logger.info(f"Processed web content: {len(image_assets)} images extracted")

    # ─────────────── Helper Methods ─────────────── #

    def _detect_content_kind(self, file_ext: str) -> AssetKind:
        """Detect content type from file extension."""
        ext_map = {
            '.pdf': AssetKind.PDF,
            '.csv': AssetKind.CSV,
            '.txt': AssetKind.TEXT,
            '.md': AssetKind.TEXT,
            '.json': AssetKind.TEXT,
            '.jpg': AssetKind.IMAGE,
            '.jpeg': AssetKind.IMAGE,
            '.png': AssetKind.IMAGE,
            '.gif': AssetKind.IMAGE,
            '.webp': AssetKind.IMAGE,
            '.mp4': AssetKind.VIDEO,
            '.avi': AssetKind.VIDEO,
            '.mov': AssetKind.VIDEO,
            '.mp3': AssetKind.AUDIO,
            '.wav': AssetKind.AUDIO,
            '.ogg': AssetKind.AUDIO,
            '.mbox': AssetKind.MBOX,
            '.eml': AssetKind.EMAIL
        }
        return ext_map.get(file_ext.lower(), AssetKind.FILE)

    def _needs_processing(self, kind: AssetKind) -> bool:
        """Check if content kind needs processing to extract child assets."""
        return kind in [AssetKind.CSV, AssetKind.PDF, AssetKind.WEB]

    def _detect_csv_delimiter(self, csv_text: str) -> str:
        """Auto-detect CSV delimiter with improved heuristics."""
        lines = [line for line in csv_text.split('\n')[:20] if line.strip()]
        
        if len(lines) < 2:
            return ','
        
        # Try CSV sniffer first
        try:
            sample = '\n'.join(lines[:10])
            sniffer = csv.Sniffer()
            dialect = sniffer.sniff(sample, delimiters=',;\t|')
            
            # Validate with more lines
            test_reader = csv.reader(lines[:5], delimiter=dialect.delimiter)
            field_counts = [len(row) for row in test_reader if row]
            
            if len(field_counts) >= 2:
                variance = max(field_counts) - min(field_counts)
                avg_fields = sum(field_counts) / len(field_counts)
                
                if avg_fields > 1 and variance <= max(2, avg_fields * 0.2):
                    return dialect.delimiter
        except:
            pass
        
        # Manual detection with scoring
        candidates = [',', ';', '\t', '|']
        best_delimiter = ','
        best_score = 0
        
        for delimiter in candidates:
            try:
                reader = csv.reader(lines[:10], delimiter=delimiter)
                field_counts = [len(row) for row in reader if row]
                
                if len(field_counts) >= 2:
                    avg_fields = sum(field_counts) / len(field_counts)
                    consistency = 1.0 / (1.0 + (max(field_counts) - min(field_counts)))
                    
                    score = consistency * 0.7 + min(avg_fields / 10.0, 1.0) * 0.3
                    
                    if score > best_score and avg_fields > 1:
                        best_score = score
                        best_delimiter = delimiter
            except:
                continue
        
        return best_delimiter

    def _filter_content_images(
        self, 
        images: List[str], 
        top_image: Optional[str]
    ) -> List[str]:
        """Filter out non-content images from scraped image list."""
        if not images:
            return []
        
        content_images = []
        seen_urls = {top_image} if top_image else set()
        
        skip_patterns = [
            'logo', 'icon', 'avatar', 'button', 'badge', 'banner',
            'header', 'footer', 'nav', 'menu', 'ad', 'advertisement',
            'twitter.gif', 'facebook.gif', 'pixel.gif', '1x1.gif',
            'sprite', 'tracking'
        ]
        
        for img_url in images:
            if img_url in seen_urls:
                continue
            
            img_lower = img_url.lower()
            if any(pattern in img_lower for pattern in skip_patterns):
                continue
            
            # Skip very small images (likely UI elements)
            if any(dim in img_url for dim in ['16x16', '32x32', '64x64']):
                continue
            
            content_images.append(img_url)
            seen_urls.add(img_url)
        
        return content_images

    def get_supported_content_types(self) -> Dict[str, List[str]]:
        """Get list of supported content types organized by category."""
        return {
            "documents": [".pdf", ".txt", ".md"],
            "data": [".csv", ".json"],
            "images": [".jpg", ".jpeg", ".png", ".gif", ".webp"],
            "audio": [".mp3", ".wav", ".ogg"],
            "video": [".mp4", ".avi", ".mov", ".webm"],
            "email": [".mbox", ".eml"],
            "web": ["http://", "https://"]
        } 