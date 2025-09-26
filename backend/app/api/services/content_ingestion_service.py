"""
Unified Content Ingestion Service
=================================

Consolidates functionality from:
- ContentService (file uploads, URL ingestion, content processing)
- AssetDiscoveryService (unified content discovery patterns)
- SearchIntelligenceService (search-to-asset workflows)

This service provides the single interface for all content ingestion needs:
- File uploads (CSV, PDF, images, documents)
- Web content (URLs, scraping, articles)
- Search-based discovery
- RSS feeds and site crawling
- Bulk operations
- Content processing (CSV parsing, PDF extraction, web scraping)
"""

import logging
import asyncio
import hashlib
import os
import uuid
import csv
import io
import fitz
import dateutil.parser
import feedparser
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union, AsyncGenerator
from dataclasses import dataclass
from enum import Enum
from urllib.parse import urlparse, urljoin
import re

from fastapi import UploadFile
from sqlmodel import Session, select, and_, or_

from app.models import Asset, AssetKind, Source, ProcessingStatus, Bundle, SourceType
from app.schemas import AssetCreate, SearchResult, SearchFilter
from app.api.providers.base import SearchProvider, ScrapingProvider, StorageProvider
from app.api.providers.factory import create_search_provider, create_scraping_provider, create_storage_provider
from app.api.services.asset_service import AssetService
from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings

logger = logging.getLogger(__name__)


class ContentIngestionService:
    """
    Unified service for all content ingestion and discovery operations.
    
    This service consolidates:
    - File uploads and processing
    - Web content scraping
    - Search-based content discovery
    - RSS feed processing
    - Site crawling and discovery
    - Bulk operations
    
    Single interface for all content ingestion needs.
    """
    
    def __init__(self, session: Session):
        self.session = session
        
        # Initialize providers
        self.search_provider = create_search_provider(settings)
        self.scraping_provider = create_scraping_provider(settings)
        self.storage_provider = create_storage_provider(settings)
        
        # Initialize core asset service
        self.asset_service = AssetService(session, self.storage_provider)
        
        logger.info("ContentIngestionService initialized - unified ingestion interface ready")
    
    # ─────────────── UNIFIED INGESTION INTERFACE ─────────────── #
    
    async def ingest_content(
        self,
        locator: Union[str, List[str], UploadFile],
        infospace_id: int,
        user_id: int,
        title: Optional[str] = None,
        bundle_id: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Unified content ingestion interface.
        
        Args:
            locator: File, URL, search query, or list of URLs
            infospace_id: Target infospace
            user_id: User performing operation
            title: Optional custom title
            bundle_id: Optional bundle to add assets to
            options: Processing and discovery options
            
        Returns:
            List of created assets
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        options = options or {}
        
        # Auto-detect content type
        source_type = self._detect_source_type(locator)
        logger.info(f"Detected source type: {source_type} for locator type: {type(locator)}")
        
        # Route to appropriate handler
        if source_type == SourceType.FILE_UPLOAD:
            assets = [await self._handle_file_upload(locator, infospace_id, user_id, title, options)]
        elif source_type == SourceType.TEXT_CONTENT:
            assets = [await self._handle_text_content(locator, infospace_id, user_id, title, options)]
        elif source_type == SourceType.SEARCH_QUERY:
            assets = await self._handle_search_query(locator, infospace_id, user_id, options)
        elif source_type == SourceType.RSS_FEED:
            assets = await self._handle_rss_feed(locator, infospace_id, user_id, options)
        elif source_type == SourceType.DIRECT_FILE:
            assets = [await self._handle_direct_file_url(locator, infospace_id, user_id, title, options)]
        elif source_type == SourceType.WEB_PAGE:
            assets = [await self._handle_web_page(locator, infospace_id, user_id, title, options)]
        elif source_type == SourceType.URL_LIST:
            assets = await self._handle_url_list(locator, infospace_id, user_id, options)
        elif source_type == SourceType.SITE_DISCOVERY:
            assets = await self._handle_site_discovery(locator, infospace_id, user_id, options)
        else:
            raise ValueError(f"Unsupported source type: {source_type}")
        
        # Add to bundle if specified
        if bundle_id and assets:
            await self._add_assets_to_bundle([asset.id for asset in assets], bundle_id)
        
        return assets
    
    # ─────────────── SEARCH-BASED INGESTION ─────────────── #
    
    async def search_and_ingest(
        self,
        query: str,
        infospace_id: int,
        user_id: int,
        search_method: str = "hybrid",  # text, semantic, hybrid
        limit: int = 10,
        bundle_id: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Search for content and create assets (used by chat tools).
        
        Args:
            query: Search query
            infospace_id: Target infospace
            user_id: User performing search
            search_method: Search method (text, semantic, hybrid)
            limit: Maximum results
            bundle_id: Optional bundle to add to
            options: Search and processing options
        
        Returns:
            List of created assets
        """
        if search_method == "text":
            return await self._search_assets_text(query, infospace_id, limit, options or {})
        elif search_method == "semantic":
            return await self._search_assets_semantic(query, infospace_id, limit, options or {})
        elif search_method == "hybrid":
            # Combine both methods
            text_assets = await self._search_assets_text(query, infospace_id, limit//2, options or {})
            semantic_assets = await self._search_assets_semantic(query, infospace_id, limit//2, options or {})
            
            # Deduplicate and merge
            all_assets = {asset.id: asset for asset in text_assets}
            for asset in semantic_assets:
                if asset.id not in all_assets:
                    all_assets[asset.id] = asset
            
            return list(all_assets.values())[:limit]
        else:
            raise ValueError(f"Unknown search method: {search_method}")
    
    # ─────────────── CONTENT TYPE HANDLERS ─────────────── #
    
    async def _handle_file_upload(self, file: UploadFile, infospace_id: int, user_id: int, 
                                 title: Optional[str], options: Dict[str, Any]) -> Asset:
        """Handle file upload ingestion"""
        # Detect content type and generate storage path
        file_ext = os.path.splitext(file.filename or "")[1].lower()
        content_kind = self._detect_content_kind(file_ext)
        storage_path = f"user_{user_id}/{uuid.uuid4()}{file_ext}"
        
        # Upload to storage
        await self.storage_provider.upload_file(file, storage_path)
        
        # Create asset
        asset_title = title or file.filename or f"Uploaded {content_kind.value}"
        asset_create = AssetCreate(
            title=asset_title,
            kind=content_kind,
            user_id=user_id,
            infospace_id=infospace_id,
            blob_path=storage_path,
            source_metadata={
                "original_filename": file.filename,
                "file_size": getattr(file, 'size', None),
                "mime_type": getattr(file, 'content_type', None),
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "file_upload"
            }
        )
        
        asset = self.asset_service.create_asset(asset_create)
        
        # Process immediately if needed
        if options.get('process_immediately', True) and self._needs_processing(content_kind):
            await self._process_content(asset, options)
        
        return asset
    
    async def _handle_web_page(self, url: str, infospace_id: int, user_id: int,
                              title: Optional[str], options: Dict[str, Any]) -> Asset:
        """Handle single web page ingestion"""
        asset_title = title or f"Article: {url}"
        asset_create = AssetCreate(
            title=asset_title,
            kind=AssetKind.WEB,
            user_id=user_id,
            infospace_id=infospace_id,
            source_identifier=url,
            source_metadata={
                "original_url": url,
                "ingested_at": datetime.now(timezone.utc).isoformat(),
                "ingestion_method": "web_scraping"
            }
        )
        
        asset = self.asset_service.create_asset(asset_create)
        
        # Scrape content if requested
        if options.get('scrape_immediately', True):
            await self._process_content(asset, options)
        
        return asset
    
    async def _handle_search_query(self, query: str, infospace_id: int, user_id: int, 
                                  options: Dict[str, Any]) -> List[Asset]:
        """Handle search query to create assets from results"""
        limit = options.get('limit', 10)
        scrape_content = options.get('scrape_content', True)
        
        # Perform search
        search_results = await self._search_with_provider(query, limit, options)
        
        # Create assets from results
        assets = []
        for i, result in enumerate(search_results):
            try:
                asset_title = f"{result.title} (Search: {query})"
                asset = await self._handle_web_page(
                    result.url, infospace_id, user_id, asset_title, 
                    {"scrape_immediately": scrape_content}
                )
                
                # Add search metadata
                if asset.source_metadata:
                    asset.source_metadata.update({
                        "search_query": query,
                        "search_provider": result.provider,
                        "search_score": result.score,
                        "search_rank": i + 1
                    })
                    self.session.add(asset)
                
                assets.append(asset)
                
            except Exception as e:
                logger.error(f"Failed to create asset from search result {result.url}: {e}")
                continue
        
        self.session.commit()
        return assets
    
    async def _handle_rss_feed(self, feed_url: str, infospace_id: int, user_id: int, 
                              options: Dict[str, Any]) -> List[Asset]:
        """Handle RSS feed processing"""
        max_items = options.get('max_items', 50)
        scrape_full_content = options.get('scrape_full_content', True)
        
        try:
            feed = feedparser.parse(feed_url)
            
            # Create parent RSS asset
            feed_title = feed.feed.get('title', 'RSS Feed')
            parent_asset = self.asset_service.create_asset(AssetCreate(
                title=f"RSS Feed: {feed_title}",
                kind=AssetKind.WEB,  # Changed from RSS_FEED which doesn't exist
                user_id=user_id,
                infospace_id=infospace_id,
                source_identifier=feed_url,
                text_content=feed.feed.get('description', ''),
                source_metadata={
                    'feed_title': feed_title,
                    'feed_url': feed_url,
                    'total_entries': len(feed.entries),
                    'ingestion_method': 'rss_processing'
                }
            ))
            
            # Process RSS items as child assets
            child_assets = []
            for i, entry in enumerate(feed.entries[:max_items]):
                try:
                    item_url = entry.get('link', '')
                    item_title = entry.get('title', 'RSS Item')
                    
                    # Create child asset
                    child_asset = await self._handle_web_page(
                        item_url, infospace_id, user_id, item_title,
                        {"scrape_immediately": scrape_full_content}
                    )
                    
                    # Set parent relationship
                    child_asset.parent_asset_id = parent_asset.id
                    child_asset.part_index = i
                    
                    # Add RSS metadata
                    if child_asset.source_metadata:
                        child_asset.source_metadata.update({
                            'rss_feed_url': feed_url,
                            'rss_item_id': entry.get('id', ''),
                            'rss_published_date': entry.get('published', ''),
                            'content_source': 'rss_item'
                        })
                    
                    self.session.add(child_asset)
                    child_assets.append(child_asset)
                    
                except Exception as e:
                    logger.error(f"Failed to process RSS item: {e}")
                    continue
            
            self.session.commit()
            return [parent_asset] + child_assets
            
        except ImportError:
            raise ValueError("feedparser library not installed. Install with: pip install feedparser")
        except Exception as e:
            raise ValueError(f"RSS feed processing failed: {e}")
    
    # ─────────────── SEARCH OPERATIONS ─────────────── #
    
    async def search_assets_text(self, query: str, infospace_id: int, limit: int, options: Dict[str, Any]) -> List[Asset]:
        """Text-based search in existing assets"""
        asset_kinds = options.get('asset_kinds', [])
        
        # Build query conditions
        query_conditions = [Asset.infospace_id == infospace_id]
        
        if query:
            search_condition = or_(
                Asset.title.ilike(f"%{query}%"),
                Asset.text_content.ilike(f"%{query}%")
            )
            query_conditions.append(search_condition)
        
        if asset_kinds:
            kind_conditions = [Asset.kind == AssetKind(kind) for kind in asset_kinds if kind in AssetKind.__members__]
            if kind_conditions:
                query_conditions.append(or_(*kind_conditions))
        
        # Execute query
        assets = self.session.exec(
            select(Asset)
            .where(and_(*query_conditions))
            .order_by(Asset.created_at.desc())
            .limit(limit)
        ).all()
        
        return list(assets)
    
    async def search_assets_semantic(self, query: str, infospace_id: int, limit: int, options: Dict[str, Any]) -> List[Asset]:
        """Semantic search using embeddings"""
        try:
            from app.api.services.embedding_service import EmbeddingService
            from app.api.providers.factory import create_embedding_provider
            
            embedding_provider = create_embedding_provider(settings)
            embedding_service = EmbeddingService(self.session, embedding_provider)
            
            # Perform semantic search
            search_results = await embedding_service.search_similar_chunks(
                query_text=query,
                infospace_id=infospace_id,
                limit=limit,
                distance_threshold=options.get('distance_threshold', 0.8)
            )
            
            # Get unique assets from chunks
            asset_ids = list(set(result["asset_id"] for result in search_results))
            
            # Get assets
            assets = self.session.exec(
                select(Asset)
                .where(Asset.id.in_(asset_ids))
                .where(Asset.infospace_id == infospace_id)
                .limit(limit)
            ).all()
            
            return list(assets)
            
        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to text search: {e}")
            return await self.search_assets_text(query, infospace_id, limit, options)
    
    async def _search_with_provider(self, query: str, limit: int, options: Dict[str, Any]) -> List[SearchResult]:
        """Search using external search provider"""
        try:
            raw_results = await self.search_provider.search(
                query=query,
                limit=limit,
                **options.get('provider_params', {})
            )
            
            return [
                SearchResult(
                    title=result.get("title", ""),
                    url=result.get("url", ""),
                    content=result.get("content", ""),
                    score=result.get("score"),
                    provider="default",
                    raw_data=result
                )
                for result in raw_results
            ]
            
        except Exception as e:
            logger.error(f"External search failed: {e}")
            return []
    
    # ─────────────── CONTENT PROCESSING ─────────────── #
    
    async def _process_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process content based on asset type"""
        if asset.processing_status == ProcessingStatus.PROCESSING:
            return
        
        asset.processing_status = ProcessingStatus.PROCESSING
        self.session.add(asset)
        self.session.commit()
        
        try:
            if asset.kind == AssetKind.CSV:
                await self._process_csv(asset, options)
            elif asset.kind == AssetKind.PDF:
                await self._process_pdf(asset, options)
            elif asset.kind == AssetKind.WEB:
                await self._process_web_content(asset, options)
            
            asset.processing_status = ProcessingStatus.READY
            self.session.add(asset)
            self.session.commit()
            
        except Exception as e:
            asset.processing_status = ProcessingStatus.FAILED
            asset.processing_error = str(e)
            self.session.add(asset)
            self.session.commit()
            raise
    
    # ─────────────── UTILITY METHODS ─────────────── #
    
    def _detect_source_type(self, locator: Union[str, List[str], UploadFile]) -> SourceType:
        """Auto-detect source type from locator"""
        if isinstance(locator, UploadFile):
            return SourceType.FILE_UPLOAD
        
        if isinstance(locator, list):
            return SourceType.URL_LIST
        
        if not isinstance(locator, str):
            raise ValueError("Invalid locator type")
        
        # Check if it's a URL
        if locator.startswith(('http://', 'https://')):
            parsed = urlparse(locator)
            path = parsed.path.lower()
            
            # RSS feed patterns
            if any(pattern in path for pattern in ['.rss', '.xml', '/feed/', '/feeds/']):
                return SourceType.RSS_FEED
            
            # Direct file patterns
            file_extensions = ['.pdf', '.doc', '.docx', '.zip', '.tar', '.gz', '.csv', '.xlsx']
            if any(path.endswith(ext) for ext in file_extensions):
                return SourceType.DIRECT_FILE
            
            # Site discovery patterns
            if path == '/' or path == '' or 'discover' in locator.lower():
                return SourceType.SITE_DISCOVERY
            
            # Default to web page
            return SourceType.WEB_PAGE
        
        # If not a URL, treat as search query
        return SourceType.SEARCH_QUERY
    
    def _detect_content_kind(self, file_ext: str) -> AssetKind:
        """Detect content type from file extension"""
        ext_map = {
            '.pdf': AssetKind.PDF,
            '.csv': AssetKind.CSV,
            '.txt': AssetKind.TEXT,
            '.md': AssetKind.TEXT,
            '.jpg': AssetKind.IMAGE,
            '.jpeg': AssetKind.IMAGE,
            '.png': AssetKind.IMAGE,
            '.mp4': AssetKind.VIDEO,
            '.mp3': AssetKind.AUDIO,
            '.mbox': AssetKind.MBOX,
            '.eml': AssetKind.EMAIL
        }
        return ext_map.get(file_ext.lower(), AssetKind.FILE)
    
    def _needs_processing(self, kind: AssetKind) -> bool:
        """Check if content kind needs processing"""
        return kind in [AssetKind.CSV, AssetKind.PDF, AssetKind.WEB]
    
    async def _add_assets_to_bundle(self, asset_ids: List[int], bundle_id: int) -> None:
        """Add multiple assets to a bundle"""
        try:
            from app.models import AssetBundleLink
            
            for asset_id in asset_ids:
                # Check if link already exists
                existing = self.session.exec(
                    select(AssetBundleLink).where(
                        AssetBundleLink.asset_id == asset_id,
                        AssetBundleLink.bundle_id == bundle_id
                    )
                ).first()
                
                if not existing:
                    link = AssetBundleLink(asset_id=asset_id, bundle_id=bundle_id)
                    self.session.add(link)
            
            self.session.commit()
            
        except Exception as e:
            logger.error(f"Failed to add assets to bundle {bundle_id}: {e}")
    
    async def _process_csv(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process CSV file - implementation from ContentService"""
        if not asset.blob_path:
            raise ValueError("CSV asset has no file content")
        
        delimiter = options.get('delimiter')
        encoding = options.get('encoding', 'utf-8')
        skip_rows = options.get('skip_rows', 0)
        max_rows = options.get('max_rows', 50000)
        
        file_stream = await self.storage_provider.get_file(asset.blob_path)
        csv_bytes = await asyncio.to_thread(file_stream.read)
        
        try:
            csv_text = csv_bytes.decode(encoding, errors='replace')
        except UnicodeDecodeError:
            for fallback in ['utf-8', 'latin1', 'cp1252']:
                try:
                    csv_text = csv_bytes.decode(fallback, errors='replace')
                    encoding = fallback
                    break
                except UnicodeDecodeError:
                    continue
            else:
                raise ValueError("Could not decode CSV file with any common encoding")
        
        if not delimiter:
            delimiter = self._detect_csv_delimiter(csv_text)
        
        csv_lines = csv_text.split('\n')
        csv_reader = csv.reader(csv_lines, delimiter=delimiter)
        
        for _ in range(skip_rows):
            try:
                next(csv_reader)
            except StopIteration:
                raise ValueError(f"CSV has fewer rows than skip_rows={skip_rows}")
        
        try:
            header = [h.strip() for h in next(csv_reader) if h.strip()]
        except StopIteration:
            raise ValueError("CSV is empty or has no header row")
        
        if not header:
            raise ValueError("CSV header row is empty")
        
        child_assets_to_create: List[AssetCreate] = []
        full_text_parts = [f"CSV Headers: {' | '.join(header)}"]
        rows_processed = 0
        
        for idx, row in enumerate(csv_reader):
            if rows_processed >= max_rows:
                logger.warning(f"CSV processing stopped at {max_rows} rows limit")
                break
            if not any(cell.strip() for cell in row if cell):
                continue
            
            while len(row) < len(header):
                row.append('')
            if len(row) > len(header):
                row = row[:len(header)]
            
            cleaned_row = [cell.replace('\x00', '').strip() for cell in row]
            row_data = {header[j]: cleaned_row[j] for j in range(len(header))}
            row_text = f"| {' | '.join(cleaned_row)} |"
            full_text_parts.append(row_text)
            
            child_asset_create = AssetCreate(
                title=f"Row {rows_processed + 1}",
                kind=AssetKind.CSV_ROW,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                part_index=rows_processed,
                text_content=row_text,
                source_metadata={
                    'row_number': skip_rows + rows_processed + 2,
                    'data_row_index': rows_processed,
                    'original_row_data': row_data
                }
            )
            child_assets_to_create.append(child_asset_create)
            rows_processed += 1
            
            if rows_processed % 1000 == 0:
                await asyncio.sleep(0.01)
        
        asset.text_content = "\n".join(full_text_parts)
        asset.source_metadata.update({
            'columns': header,
            'delimiter_used': delimiter,
            'encoding_used': encoding,
            'rows_processed': rows_processed,
            'column_count': len(header),
            'processing_options': options
        })
        
        if child_assets_to_create:
            for child_create in child_assets_to_create:
                self.asset_service.create_asset(child_create)
        
        logger.info(f"Processed CSV: {rows_processed} rows, {len(header)} columns")

    def _detect_csv_delimiter(self, csv_text: str) -> str:
        """Auto-detect CSV delimiter with improved heuristics."""
        lines = [line for line in csv_text.split('\n')[:20] if line.strip()]
        
        if len(lines) < 2:
            return ','
        
        try:
            sample = '\n'.join(lines[:10])
            sniffer = csv.Sniffer()
            dialect = sniffer.sniff(sample, delimiters=',;\t|')
            
            test_reader = csv.reader(lines[:5], delimiter=dialect.delimiter)
            field_counts = [len(row) for row in test_reader if row]
            
            if len(field_counts) >= 2:
                variance = max(field_counts) - min(field_counts)
                avg_fields = sum(field_counts) / len(field_counts)
                
                if avg_fields > 1 and variance <= max(2, avg_fields * 0.2):
                    return dialect.delimiter
        except:
            pass
        
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
    
    async def _process_pdf(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process PDF file - implementation from ContentService"""
        if not asset.blob_path:
            raise ValueError("PDF asset has no file content")
        
        max_pages = options.get('max_pages', 1000)
        
        file_stream = await self.storage_provider.get_file(asset.blob_path)
        pdf_bytes = await asyncio.to_thread(file_stream.read)
        
        def process_pdf_sync():
            full_text = ""
            child_assets_to_create: List[AssetCreate] = []
            
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
                            child_assets_to_create.append(child_asset_create)
                            
                    except Exception as e:
                        logger.error(f"Error processing PDF page {page_num + 1}: {e}")
                        continue
                
                return full_text.strip(), child_assets_to_create, {
                    'page_count': page_count,
                    'processed_pages': len(child_assets_to_create),
                    'extracted_title': pdf_title,
                    'processing_options': options
                }
        
        full_text, child_assets_to_create, metadata = await asyncio.to_thread(process_pdf_sync)
        
        asset.text_content = full_text
        if metadata.get('extracted_title') and not asset.title.startswith('Uploaded'):
            asset.title = metadata['extracted_title']
        asset.source_metadata.update(metadata)
        
        if child_assets_to_create:
            for child_create in child_assets_to_create:
                self.asset_service.create_asset(child_create)
        
        logger.info(f"Processed PDF: {metadata['processed_pages']} pages extracted")
    
    async def _process_web_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """Process web content - implementation from ContentService"""
        if not asset.source_identifier:
            raise ValueError("Web asset has no URL to scrape")
        
        timeout = options.get('timeout', 30)
        max_images = options.get('max_images', 8)
        
        scraped_data = await self.scraping_provider.scrape_url(
            asset.source_identifier,
            timeout=timeout
        )
        
        if not scraped_data or not scraped_data.get('text_content'):
            raise ValueError("No content could be scraped from URL")
        
        text_content = scraped_data.get('text_content', '').strip()
        title = scraped_data.get('title', '').strip()
        
        asset.text_content = text_content
        if title:
            asset.title = title
            logger.info(f"Updated asset {asset.id} title to scraped title: '{title}'")
        
        if scraped_data.get('publication_date'):
            try:
                parsed_dt = dateutil.parser.parse(scraped_data['publication_date'])
                asset.event_timestamp = parsed_dt.replace(
                    tzinfo=parsed_dt.tzinfo or timezone.utc
                )
            except Exception as e:
                logger.warning(f"Could not parse publication date: {e}")
        
        asset.source_metadata.update({
            'scraped_at': datetime.now(timezone.utc).isoformat(),
            'scraped_title': scraped_data.get('title'),
            'top_image': scraped_data.get('top_image'),
            'summary': scraped_data.get('summary'),
            'publication_date': scraped_data.get('publication_date'),
            'content_length': len(text_content),
            'processing_options': options
        })
        
        child_assets_to_create: List[AssetCreate] = []
        
        if scraped_data.get('top_image'):
            featured_asset_create = AssetCreate(
                title=f"Featured: {asset.title}",
                kind=AssetKind.IMAGE,
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                parent_asset_id=asset.id,
                source_identifier=scraped_data['top_image'],
                part_index=0,
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
            child_assets_to_create.append(featured_asset_create)
        
        images = scraped_data.get('images', [])
        if images:
            content_images = self._filter_content_images(
                images, 
                scraped_data.get('top_image')
            )
            
            start_index = 1 if scraped_data.get('top_image') else 0
            for idx, img_url in enumerate(content_images[:max_images]):
                content_asset_create = AssetCreate(
                    title=f"Image {start_index + idx + 1}: {asset.title}",
                    kind=AssetKind.IMAGE,
                    user_id=asset.user_id,
                    infospace_id=asset.infospace_id,
                    parent_asset_id=asset.id,
                    source_identifier=img_url,
                    part_index=start_index + idx,
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
                child_assets_to_create.append(content_asset_create)
        
        if child_assets_to_create:
            for child_create in child_assets_to_create:
                self.asset_service.create_asset(child_create)
        
        logger.info(f"Processed web content: {len(child_assets_to_create)} images extracted")

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
            
            if any(dim in img_url for dim in ['16x16', '32x32', '64x64']):
                continue
            
            content_images.append(img_url)
            seen_urls.add(img_url)
        
        return content_images

    async def _handle_text_content(self, text: str, infospace_id: int, user_id: int,
                                  title: Optional[str], options: Dict[str, Any]) -> Asset:
        """Handle direct text content ingestion"""
        asset_title = title or f"Text Content ({len(text)} chars)"
        source_metadata = {
            "content_length": len(text),
            "ingested_at": datetime.now(timezone.utc).isoformat(),
            "ingestion_method": "direct_text"
        }
        
        if options.get('metadata'):
            source_metadata.update(options['metadata'])
        
        asset_create = AssetCreate(
            title=asset_title,
            kind=AssetKind.TEXT,
            user_id=user_id,
            infospace_id=infospace_id,
            text_content=text,
            event_timestamp=options.get('event_timestamp'),
            source_metadata=source_metadata
        )
        
        return self.asset_service.create_asset(asset_create)
    
    async def _handle_direct_file_url(self, url: str, infospace_id: int, user_id: int,
                                     title: Optional[str], options: Dict[str, Any]) -> Asset:
        """Handle direct file URL download"""
        import httpx
        async with httpx.AsyncClient() as client:
            response = await client.get(url, follow_redirects=True)
            response.raise_for_status()
            content = response.content
        
        file_ext = os.path.splitext(urlparse(url).path)[1].lower()
        content_kind = self._detect_content_kind(file_ext)
        storage_path = f"user_{user_id}/{uuid.uuid4()}{file_ext}"
        
        await self.storage_provider.upload_from_bytes(content, storage_path, filename=os.path.basename(urlparse(url).path))
        
        asset_title = title or os.path.basename(urlparse(url).path) or f"Downloaded file from {urlparse(url).netloc}"
        
        asset_create = AssetCreate(
            title=asset_title,
            kind=content_kind,
            user_id=user_id,
            infospace_id=infospace_id,
            blob_path=storage_path,
            source_identifier=url,
            source_metadata={
                "original_download_url": url,
                "download_method": "direct_file_url",
                "downloaded_at": datetime.now(timezone.utc).isoformat()
            }
        )
        
        asset = self.asset_service.create_asset(asset_create)
        
        if options.get('process_immediately', True) and self._needs_processing(content_kind):
            await self._process_content(asset, options)
        
        return asset
    
    async def _handle_url_list(self, urls: List[str], infospace_id: int, user_id: int,
                              options: Dict[str, Any]) -> List[Asset]:
        """Handle bulk URL processing"""
        assets = []
        base_title = options.get('base_title', "Bulk URL Collection")
        scrape_immediately = options.get('scrape_immediately', True)
        
        for i, url in enumerate(urls):
            try:
                url_title = f"{base_title} #{i+1}" if base_title else None
                url_options = options.copy()
                url_options.update({
                    "batch_index": i,
                    "batch_total": len(urls)
                })
                
                asset = await self._handle_web_page(
                    url=url,
                    infospace_id=infospace_id,
                    user_id=user_id,
                    title=url_title,
                    options=url_options
                )
                assets.append(asset)
                
                if scrape_immediately:
                    await asyncio.sleep(0.5)
                
            except Exception as e:
                logger.error(f"Failed to ingest URL {url} in bulk operation: {e}")
                continue
        
        logger.info(f"Bulk URL ingestion completed: {len(assets)}/{len(urls)} successful")
        return assets
    
    async def _handle_site_discovery(self, base_url: str, infospace_id: int, user_id: int,
                                    options: Dict[str, Any]) -> List[Asset]:
        """Handle site discovery and crawling"""
        max_depth = options.get('max_depth', 2)
        max_urls = options.get('max_urls', 50)
        
        discovered_urls = await self._discover_site_urls(
            base_url=base_url,
            max_depth=max_depth,
            max_urls=max_urls,
            url_filter_config=options.get('url_filters', {})
        )
        
        created_assets = await self._handle_url_list(
            urls=discovered_urls,
            infospace_id=infospace_id,
            user_id=user_id,
            options=options
        )
        
        discovery_metadata = {
            "discovery_base_url": base_url,
            "discovery_depth": max_depth,
            "discovered_at": datetime.now(timezone.utc).isoformat(),
            "discovery_method": "site_crawl"
        }
        
        for asset in created_assets:
            if asset.source_metadata:
                asset.source_metadata.update(discovery_metadata)
            else:
                asset.source_metadata = discovery_metadata
            self.session.add(asset)
        
        self.session.commit()
        logger.info(f"Created {len(created_assets)} assets from site discovery of {base_url}")
        return created_assets

    async def _discover_site_urls(self, base_url: str, max_depth: int, max_urls: int, url_filter_config: Dict[str, Any]) -> List[str]:
        """Discover URLs from a base site by crawling links."""
        url_filter = self._create_search_filter_from_config(url_filter_config)

        discovered_urls = set()
        urls_to_crawl = [(base_url, 0)]
        crawled_urls = set()
        
        while urls_to_crawl and len(discovered_urls) < max_urls:
            current_url, depth = urls_to_crawl.pop(0)
            
            if current_url in crawled_urls or depth > max_depth:
                continue
                
            crawled_urls.add(current_url)
            
            try:
                scraped_data = await self.scraping_provider.scrape_url(current_url)
                if not scraped_data:
                    continue
                    
                links = self._extract_links_from_content(
                    scraped_data.get("text_content", ""),
                    base_url=current_url
                )
                
                for link in links:
                    if link not in discovered_urls and link not in crawled_urls:
                        if url_filter:
                            dummy_result = SearchResult(
                                title="", url=link, content="", provider="crawler"
                            )
                            if not url_filter.matches(dummy_result):
                                continue
                                
                        discovered_urls.add(link)
                        
                        if depth < max_depth:
                            urls_to_crawl.append((link, depth + 1))
                            
            except Exception as e:
                logger.warning(f"Failed to crawl {current_url}: {e}")
                continue
                
        logger.info(f"Site discovery for {base_url}: found {len(discovered_urls)} URLs")
        return list(discovered_urls)

    def _extract_links_from_content(self, content: str, base_url: str) -> List[str]:
        """Extract and normalize links from content."""
        links = []
        
        url_pattern = re.compile(r'https?://[^\s<>"\']+')
        found_urls = url_pattern.findall(content)
        
        for url in found_urls:
            try:
                normalized_url = urljoin(base_url, url)
                if self._is_valid_url(normalized_url):
                    links.append(normalized_url)
            except Exception:
                continue
                
        return links
    
    def _is_valid_url(self, url: str) -> bool:
        """Check if URL is valid and accessible."""
        try:
            parsed = urlparse(url)
            return parsed.scheme in ('http', 'https') and parsed.netloc
        except Exception:
            return False

    def _create_search_filter_from_config(self, filter_config: Dict[str, Any]) -> Optional[SearchFilter]:
        """Create a SearchFilter from configuration dictionary."""
        if not filter_config:
            return None
        
        search_filter = SearchFilter()
        
        if "allowed_domains" in filter_config:
            search_filter.allowed_domains = set(filter_config["allowed_domains"])
        if "blocked_domains" in filter_config:
            search_filter.blocked_domains = set(filter_config["blocked_domains"])
        if "required_keywords" in filter_config:
            search_filter.required_keywords = filter_config["required_keywords"]
        if "blocked_keywords" in filter_config:
            search_filter.blocked_keywords = filter_config["blocked_keywords"]
        if "min_content_length" in filter_config:
            search_filter.min_content_length = filter_config["min_content_length"]
        if "max_content_length" in filter_config:
            search_filter.max_content_length = filter_config["max_content_length"]
        if "min_score" in filter_config:
            search_filter.min_score = filter_config["min_score"]
        if "url_patterns" in filter_config:
            search_filter.url_patterns = filter_config["url_patterns"]
        if "content_patterns" in filter_config:
            search_filter.content_patterns = filter_config["content_patterns"]
            
        return search_filter

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
        await self._process_content(asset, options or {})

    def compose_article(
        self,
        title: str,
        content: str,
        infospace_id: int,
        user_id: int,
        summary: Optional[str] = None,
        embedded_assets: Optional[List[Dict[str, Any]]] = None,
        referenced_bundles: Optional[List[int]] = None,
        metadata: Optional[Dict[str, Any]] = None,
        event_timestamp: Optional[datetime] = None
    ) -> Asset:
        """
        Compose a free-form article with embedded assets and bundle references.
        
        Args:
            title: Article title
            content: Main article content (can include embed markers)
            infospace_id: Target infospace ID
            user_id: User creating the article
            summary: Optional article summary
            embedded_assets: List of asset embedding configurations
            referenced_bundles: List of bundle IDs to reference
            metadata: Additional article metadata (author, tags, etc.)
            event_timestamp: Optional event timestamp
            
        Returns:
            The created article asset
        """
        validate_infospace_access(self.session, infospace_id, user_id)
        
        composition_metadata = {
            'composition_type': 'free_form_article',
            'embedded_assets': embedded_assets or [],
            'referenced_bundles': referenced_bundles or [],
            'metadata': metadata or {},
            'composed_at': datetime.now(timezone.utc).isoformat(),
            'embed_count': len(embedded_assets) if embedded_assets else 0,
            'bundle_references': len(referenced_bundles) if referenced_bundles else 0
        }
        
        if summary:
            composition_metadata['summary'] = summary
        
        asset_create = AssetCreate(
            title=title,
            kind=AssetKind.ARTICLE,
            user_id=user_id,
            infospace_id=infospace_id,
            text_content=content,
            event_timestamp=event_timestamp,
            source_metadata=composition_metadata
        )
        
        article = self.asset_service.create_asset(asset_create)
        
        if embedded_assets:
            for i, embed_config in enumerate(embedded_assets):
                try:
                    referenced_asset = self.session.get(Asset, embed_config['asset_id'])
                    if referenced_asset and referenced_asset.infospace_id == infospace_id:
                        embed_create = AssetCreate(
                            title=f"Embed: {embed_config.get('caption', referenced_asset.title)}",
                            kind=AssetKind.TEXT,
                            user_id=user_id,
                            infospace_id=infospace_id,
                            parent_asset_id=article.id,
                            part_index=i,
                            source_metadata={
                                'embed_type': 'asset_reference',
                                'target_asset_id': embed_config['asset_id'],
                                'embed_mode': embed_config.get('mode', 'card'),
                                'embed_size': embed_config.get('size', 'medium'),
                                'caption': embed_config.get('caption'),
                                'position': embed_config.get('position', i)
                            }
                        )
                        self.asset_service.create_asset(embed_create)
                except Exception as e:
                    logger.warning(f"Failed to create embed reference for asset {embed_config.get('asset_id')}: {e}")
                    continue
        
        logger.info(f"Composed article created: {article.id} with {len(embedded_assets) if embedded_assets else 0} embeds")
        return article

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

    def create_report(
        self,
        user_id: int,
        infospace_id: int,
        title: str,
        content: str,
        source_asset_ids: Optional[List[int]] = None,
        source_bundle_ids: Optional[List[int]] = None,
        source_run_ids: Optional[List[int]] = None,
        generation_config: Optional[Dict[str, Any]] = None,
    ) -> Asset:
        """Creates a new Asset of kind ARTICLE to represent a report."""
        validate_infospace_access(self.session, infospace_id, user_id)

        source_metadata = {
            "composition_type": "report",
            "created_by": "user_action",  # Could be enhanced to show "chat" or "pipeline"
            "source_asset_ids": source_asset_ids or [],
            "source_bundle_ids": source_bundle_ids or [],
            "source_run_ids": source_run_ids or [],
            "generation_config": generation_config or {},
        }

        report_asset_create = AssetCreate(
            title=title,
            kind=AssetKind.ARTICLE,
            text_content=content,
            user_id=user_id,
            infospace_id=infospace_id,
            source_metadata=source_metadata,
        )

        report_asset = self.asset_service.create_asset(report_asset_create)
        logger.info(f"Report '{title}' (Asset ID: {report_asset.id}) created successfully.")
        return report_asset
