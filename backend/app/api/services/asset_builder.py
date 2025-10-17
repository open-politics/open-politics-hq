"""
Asset Builder - Unified Asset Construction System
=================================================

This module provides a fluent, declarative interface for building assets from any source.
All asset creation should flow through the AssetBuilder to ensure consistency and 
reduce code duplication.

Usage:
    # Tavily search result → Article
    asset = await (AssetBuilder(session, user_id, infospace_id)
        .from_search_result(result, "query")
        .with_depth(0)
        .build())
    
    # URL → Scraped web asset
    asset = await (AssetBuilder(session, user_id, infospace_id)
        .from_url("https://example.com")
        .with_depth(1)
        .build())
    
    # File upload → PDF with pages
    asset = await (AssetBuilder(session, user_id, infospace_id)
        .from_file(pdf_file)
        .build())
"""

import logging
import os
import uuid
import re
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Callable, Union
from urllib.parse import urlparse

import dateutil.parser
from fastapi import UploadFile
from sqlmodel import Session, select

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import AssetCreate, SearchResult
from app.api.providers.base import SearchProvider, ScrapingProvider, StorageProvider
from app.api.providers.factory import create_search_provider, create_scraping_provider, create_storage_provider
from app.api.services.asset_service import AssetService
from app.api.processors import detect_asset_kind_from_extension
from app.core.config import settings

logger = logging.getLogger(__name__)


@dataclass
class AssetBlueprint:
    """
    Intermediate representation of an asset being built.
    
    This is the "recipe" that gets progressively refined by builder methods
    before being converted to an Asset.
    """
    
    # Required context
    user_id: int
    infospace_id: int
    
    # Identity
    kind: Optional[AssetKind] = None
    title: Optional[str] = None
    stub: bool = False
    
    # Content (one of these will be populated)
    text_content: Optional[str] = None
    blob_path: Optional[str] = None
    source_identifier: Optional[str] = None
    
    # Hierarchy
    parent_asset_id: Optional[int] = None
    part_index: Optional[int] = None
    
    # Metadata
    source_metadata: Dict[str, Any] = field(default_factory=dict)
    event_timestamp: Optional[datetime] = None
    processing_status: Optional[ProcessingStatus] = None
    
    # Ingestion behavior
    ingestion_depth: int = 0
    process_immediately: bool = True
    
    # Enrichment pipeline (callables that modify the blueprint)
    _enrichers: List[Callable] = field(default_factory=list)
    _child_builders: List['AssetBuilder'] = field(default_factory=list)


class AssetBuilder:
    """
    Fluent builder for creating assets from any source.
    
    Responsibilities:
    - Content discovery and classification
    - Metadata enrichment
    - Child asset extraction (depth-based)
    - Deduplication (delegates to AssetService)
    - Batch operations
    """
    
    def __init__(self, session: Session, user_id: int, infospace_id: int):
        """
        Initialize builder with context.
        
        Args:
            session: Database session
            user_id: User performing the ingestion
            infospace_id: Target infospace
        """
        self.session = session
        self.blueprint = AssetBlueprint(
            user_id=user_id,
            infospace_id=infospace_id
        )
        
        # Lazy-initialize providers (only create if needed)
        self._storage_provider: Optional[StorageProvider] = None
        self._scraping_provider: Optional[ScrapingProvider] = None
        self._search_provider: Optional[SearchProvider] = None
        self._asset_service: Optional[AssetService] = None
    
    # ═══════════════════════════════════════════════════════════════
    # PROVIDER ACCESS (lazy initialization)
    # ═══════════════════════════════════════════════════════════════
    
    @property
    def storage_provider(self) -> StorageProvider:
        if self._storage_provider is None:
            self._storage_provider = create_storage_provider(settings)
        return self._storage_provider
    
    @property
    def scraping_provider(self) -> ScrapingProvider:
        if self._scraping_provider is None:
            self._scraping_provider = create_scraping_provider(settings)
        return self._scraping_provider
    
    @property
    def search_provider(self) -> SearchProvider:
        if self._search_provider is None:
            self._search_provider = create_search_provider(settings)
        return self._search_provider
    
    @property
    def asset_service(self) -> AssetService:
        if self._asset_service is None:
            self._asset_service = AssetService(self.session, self.storage_provider)
        return self._asset_service
    
    # ═══════════════════════════════════════════════════════════════
    # SOURCE METHODS (entry points)
    # ═══════════════════════════════════════════════════════════════
    
    def from_search_result(self, result: SearchResult, query: str) -> 'AssetBuilder':
        """
        Build from search result (Tavily, etc.).
        
        Creates an ARTICLE asset with markdown content.
        """
        self.blueprint.kind = AssetKind.ARTICLE
        self.blueprint.stub = False
        self.blueprint.title = result.title
        
        # Prefer raw_content (markdown) over summary
        content = ""
        if result.raw_data and "raw_content" in result.raw_data and result.raw_data["raw_content"]:
            content = result.raw_data["raw_content"]
        else:
            content = result.content
        
        self.blueprint.text_content = content
        self.blueprint.source_identifier = result.url
        
        # Enrich with search context
        self.blueprint.source_metadata.update({
            "content_format": "markdown",  # Search results are markdown
            "content_source": "search_result",
            "search_query": query,
            "search_provider": result.provider,
            "search_score": result.score,
            "ingestion_method": "search_result"
        })
        
        # Add provider enrichment
        if result.raw_data:
            if "favicon" in result.raw_data:
                self.blueprint.source_metadata["favicon"] = result.raw_data["favicon"]
            if "tavily_answer" in result.raw_data:
                self.blueprint.source_metadata["ai_summary"] = result.raw_data["tavily_answer"]
            if "published_date" in result.raw_data:
                self.blueprint.source_metadata["published_date"] = result.raw_data["published_date"]
                # Parse to event_timestamp
                try:
                    self.blueprint.event_timestamp = dateutil.parser.parse(result.raw_data["published_date"])
                except Exception as e:
                    logger.warning(f"Could not parse publication date: {e}")
        
        # Mark as ready (no processing needed for articles)
        self.blueprint.processing_status = ProcessingStatus.READY
        
        return self
    
    def from_url(self, url: str, title: Optional[str] = None) -> 'AssetBuilder':
        """
        Build from URL (will scrape content).
        
        Creates a WEB asset that needs scraping.
        """
        self.blueprint.kind = AssetKind.WEB
        self.blueprint.stub = False
        self.blueprint.title = title or f"Web: {url}"
        self.blueprint.source_identifier = url
        self.blueprint.source_metadata["ingestion_method"] = "url_scraping"
        
        # Add scraping enricher
        self.blueprint._enrichers.append(self._enrich_scrape_url)
        
        return self
    
    def from_url_stub(self, url: str, title: Optional[str] = None) -> 'AssetBuilder':
        """
        Build stub reference to URL (no scraping).
        
        Creates a WEB asset that's just a bookmark.
        """
        self.blueprint.kind = AssetKind.WEB
        self.blueprint.stub = True  # Just a reference!
        self.blueprint.title = title or url
        self.blueprint.source_identifier = url
        self.blueprint.source_metadata["ingestion_method"] = "url_bookmark"
        self.blueprint.processing_status = ProcessingStatus.READY
        
        return self
    
    def from_file(self, file: UploadFile, title: Optional[str] = None) -> 'AssetBuilder':
        """
        Build from uploaded file.
        
        Detects file type and stores content.
        """
        file_ext = os.path.splitext(file.filename or "")[1].lower()
        self.blueprint.kind = detect_asset_kind_from_extension(file_ext)
        self.blueprint.stub = False
        self.blueprint.title = title or file.filename or f"Uploaded {self.blueprint.kind.value}"
        
        self.blueprint.source_metadata.update({
            "original_filename": file.filename,
            "file_size": getattr(file, 'size', None),
            "mime_type": getattr(file, 'content_type', None),
            "ingestion_method": "file_upload"
        })
        
        # Store file enricher
        self.blueprint._enrichers.append(lambda: self._enrich_store_file(file))
        
        return self
    
    def from_text(self, text: str, title: Optional[str] = None) -> 'AssetBuilder':
        """
        Build from plain text content.
        """
        self.blueprint.kind = AssetKind.TEXT
        self.blueprint.stub = False
        self.blueprint.title = title or f"Text: {text[:30]}..."
        self.blueprint.text_content = text
        self.blueprint.source_metadata["ingestion_method"] = "direct_text"
        self.blueprint.processing_status = ProcessingStatus.READY
        
        return self
    
    def from_article(
        self, 
        title: str, 
        content: str,
        summary: Optional[str] = None,
        embedded_assets: Optional[List[Dict[str, Any]]] = None
    ) -> 'AssetBuilder':
        """
        Build user-composed article.
        
        Args:
            title: Article title
            content: Article content (markdown)
            summary: Optional summary
            embedded_assets: Optional list of embedded asset references
        """
        self.blueprint.kind = AssetKind.ARTICLE
        self.blueprint.stub = False
        self.blueprint.title = title
        self.blueprint.text_content = content
        
        self.blueprint.source_metadata.update({
            "content_format": "markdown",  # Composed articles use markdown with embeds
            "content_source": "user",
            "composition_type": "free_form_article",  # Mark as composed article
            "ingestion_method": "article_composition"
        })
        
        if summary:
            self.blueprint.source_metadata["summary"] = summary
        
        if embedded_assets:
            self.blueprint.source_metadata["embedded_assets"] = embedded_assets
            # Add enricher to create child assets for embeds
            self.blueprint._enrichers.append(
                lambda: self._enrich_embedded_assets(embedded_assets)
            )
        
        self.blueprint.processing_status = ProcessingStatus.READY
        
        return self
    
    def for_csv_row(
        self,
        row_data: Dict[str, Any],
        column_headers: Optional[List[str]] = None,
        schema_validation: Optional[Dict[str, Any]] = None
    ) -> 'AssetBuilder':
        """
        Build a CSV row asset from structured data.

        Args:
            row_data: Dictionary of column_name -> value
            column_headers: Optional list of expected column names for validation
            schema_validation: Optional schema for data validation (lenient by default)
        """
        self.blueprint.kind = AssetKind.CSV_ROW
        self.blueprint.stub = False

        # Generate title in CSV format: {index} | {first_non_empty_cols[:25]}
        # Calculate the next available part_index based on existing children
        if self.blueprint.parent_asset_id:
            # Count existing children to determine the next part_index
            existing_children = self.session.exec(
                select(Asset).where(Asset.parent_asset_id == self.blueprint.parent_asset_id)
            ).all()
            next_part_index = len(existing_children)
            title_parts = [str(next_part_index + 1)]
        else:
            title_parts = ["1"]

        for key, value in list(row_data.items())[:3]:
            if value and str(value).strip():
                title_parts.append(f"{key}: {str(value)[:25]}")
        self.blueprint.title = " | ".join(title_parts) if len(title_parts) > 1 else f"Row {len(row_data)} columns"

        # Create pipe-separated text content from row data
        if column_headers:
            # Use provided headers for consistent ordering
            self.blueprint.text_content = " | ".join(
                str(row_data.get(header, "")) for header in column_headers
            )
        else:
            # Use row keys as headers
            sorted_keys = sorted(row_data.keys())
            self.blueprint.text_content = " | ".join(
                str(row_data.get(key, "")) for key in sorted_keys
            )

        # Store original structured data in source_metadata
        self.blueprint.source_metadata.update({
            "original_row_data": row_data,
            "column_headers": column_headers or list(row_data.keys()),
            "ingestion_method": "csv_row_construction",
            "row_length": len(row_data)
        })

        # Basic schema validation (lenient - just check required fields exist)
        if schema_validation:
            for field_name, field_config in schema_validation.items():
                if field_config.get("required", False) and field_name not in row_data:
                    logger.warning(f"Missing required field '{field_name}' in CSV row data")

        self.blueprint.processing_status = ProcessingStatus.READY
        return self

    def update_csv_row(
        self,
        existing_asset_id: int,
        updates: Dict[str, Any],
        merge_strategy: str = "overwrite"
    ) -> 'AssetBuilder':
        """
        Update an existing CSV row asset with new data.

        Args:
            existing_asset_id: ID of the CSV row asset to update
            updates: Dictionary of fields to update
            merge_strategy: "overwrite" (replace), "merge" (combine with existing)
        """
        self.blueprint.kind = AssetKind.CSV_ROW
        self.blueprint.stub = False

        # Mark this as an update operation
        self.blueprint.source_metadata.update({
            "update_operation": True,
            "existing_asset_id": existing_asset_id,
            "merge_strategy": merge_strategy,
            "ingestion_method": "csv_row_update"
        })

        # Queue the update enricher
        self.blueprint._enrichers.append(
            lambda: self._enrich_csv_row_update(existing_asset_id, updates, merge_strategy)
        )

        return self

    def from_rss_entry(
        self,
        entry: Any,
        feed_url: str,
        part_index: int = 0
    ) -> 'AssetBuilder':
        """
        Build from RSS feed entry with proper content extraction.
        
        Properly extracts full content from <content:encoded> via feedparser's
        entry.content field. Only falls back to summary if no content available.
        
        Args:
            entry: Feedparser entry object
            feed_url: URL of the RSS feed
            part_index: Position in feed
        """
        # Extract title
        title = entry.get('title', 'RSS Item')
        
        # Extract full content from entry.content (handles <content:encoded>)
        # Feedparser stores content in entry.content as a list of dicts with 'value' and 'type'
        content_text = ''
        if hasattr(entry, 'content') and entry.content:
            # entry.content is a list of content dicts with 'value' and 'type'
            content_text = entry.content[0].get('value', '')
        
        # Fallback to summary or description if no content
        if not content_text:
            content_text = entry.get('summary', '') or entry.get('description', '')
        
        # Set up blueprint for ARTICLE kind (RSS items are curated content)
        self.blueprint.kind = AssetKind.ARTICLE
        self.blueprint.stub = False  # We have content from RSS
        self.blueprint.title = title
        self.blueprint.text_content = content_text
        self.blueprint.source_identifier = entry.get('link', '')
        self.blueprint.part_index = part_index
        
        # Parse publication date
        pub_date = entry.get('published') or entry.get('updated')
        if pub_date:
            try:
                import dateutil.parser
                self.blueprint.event_timestamp = dateutil.parser.parse(pub_date)
            except Exception:
                pass
        
        # Extract images from media:content elements
        image_urls = []
        if hasattr(entry, 'media_content'):
            for idx, media in enumerate(entry.media_content):
                media_type = media.get('type', '')
                image_url = media.get('url')
                
                if not image_url:
                    continue
                
                # Detect if this is an image by:
                # 1. MIME type starts with 'image'
                # 2. Type is 'application/octet-stream' (generic binary, often used for images)
                # 3. URL ends with image extension
                is_image = (
                    (media_type and media_type.startswith('image')) or
                    media_type == 'application/octet-stream' or
                    any(image_url.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'])
                )
                
                if is_image:
                    # Extract media:title - feedparser stores it directly in the media dict
                    image_title = None
                    
                    # Try different ways feedparser might store media:title
                    if 'media_title' in media:
                        image_title = media.get('media_title')
                    elif hasattr(media, 'title'):
                        image_title = media.title
                    
                    # If still no title, check if entry has indexed media_title
                    if not image_title and hasattr(entry, 'media_title'):
                        image_title = entry.media_title
                    
                    # Store image data for later creation as child assets
                    image_urls.append({
                        'url': image_url,
                        'title': image_title,
                        'role': 'featured' if idx == 0 else 'content',
                        'media_credit': media.get('media_credit') or media.get('credit'),
                        'part_index': idx
                    })
        
        # Build comprehensive metadata
        self.blueprint.source_metadata = {
            'content_format': 'html',  # RSS content is HTML
            'content_source': 'rss_feed',
            'ingestion_method': 'rss_content_extraction',
            'author': entry.get('author', ''),  # Canonical author field
            'publication_date': entry.get('published', ''),  # Canonical date field
            'summary': entry.get('summary', ''),  # Canonical summary field
            'top_image': image_urls[0]['url'] if image_urls else None,  # Featured image URL
            'rss_feed_url': feed_url,
            'rss_item_id': entry.get('id', ''),
            'rss_published_date': entry.get('published', ''),
            'rss_updated_date': entry.get('updated', ''),
            'rss_author': entry.get('author', ''),
            'rss_summary': entry.get('summary', ''),
            'rss_tags': [tag.get('term', '') for tag in entry.get('tags', [])],
            'rss_link': entry.get('link', ''),
            'has_full_content': bool(hasattr(entry, 'content') and entry.content),
            'content_length': len(content_text),
            'rss_images': image_urls  # Store for later processing
        }
        
        # Add enricher to create child image assets if we found images
        if image_urls:
            self.blueprint._enrichers.append(
                lambda: self._enrich_rss_images(image_urls)
            )
        
        self.blueprint.processing_status = ProcessingStatus.READY
        
        return self
    
    # ═══════════════════════════════════════════════════════════════
    # CONFIGURATION METHODS (modify blueprint)
    # ═══════════════════════════════════════════════════════════════
    
    def with_title(self, title: str) -> 'AssetBuilder':
        """Override detected title."""
        self.blueprint.title = title
        return self
    
    def as_kind(self, kind: AssetKind) -> 'AssetBuilder':
        """Override detected kind."""
        self.blueprint.kind = kind
        return self
    
    def as_stub(self, stub: bool = True) -> 'AssetBuilder':
        """Mark as stub (reference only) or full asset."""
        self.blueprint.stub = stub
        if stub:
            # Stubs don't need processing
            self.blueprint.processing_status = ProcessingStatus.READY
        return self
    
    def with_depth(self, depth: int) -> 'AssetBuilder':
        """
        Set ingestion depth for link extraction.
        
        Args:
            depth: 0 = no extraction, 1 = extract as stubs, 2 = recursive ingestion
        """
        self.blueprint.ingestion_depth = depth
        return self
    
    def as_child_of(self, parent_id: int, part_index: Optional[int] = None) -> 'AssetBuilder':
        """Make this a child asset."""
        self.blueprint.parent_asset_id = parent_id
        self.blueprint.part_index = part_index
        return self
    
    def with_metadata(self, **kwargs) -> 'AssetBuilder':
        """Add arbitrary metadata."""
        self.blueprint.source_metadata.update(kwargs)
        return self
    
    def with_timestamp(self, timestamp: datetime) -> 'AssetBuilder':
        """Set event timestamp."""
        self.blueprint.event_timestamp = timestamp
        return self
    
    def with_processing_status(self, status: ProcessingStatus) -> 'AssetBuilder':
        """Manually set processing status."""
        self.blueprint.processing_status = status
        return self
    
    # ═══════════════════════════════════════════════════════════════
    # EXECUTION METHODS
    # ═══════════════════════════════════════════════════════════════
    
    async def build(self) -> Asset:
        """
        Execute the build: enrich, create, extract children.
        
        Returns:
            Created asset
        """
        # 1. Validate blueprint
        if not self.blueprint.kind:
            raise ValueError("Asset kind must be specified")
        if not self.blueprint.title:
            raise ValueError("Asset title must be specified")
        
        # 2. Run enrichers (scraping, file upload, etc.)
        for enricher in self.blueprint._enrichers:
            await enricher()
        
        # 3. Add ingestion timestamp
        self.blueprint.source_metadata["ingested_at"] = datetime.now(timezone.utc).isoformat()
        
        # 4. Handle CSV row updates vs creation
        if self.blueprint.source_metadata.get("update_operation"):
            # For CSV row updates, we need to return the updated asset directly
            # The enricher already handled the update
            existing_asset_id = self.blueprint.source_metadata.get("existing_asset_id")
            asset = self.session.get(Asset, existing_asset_id)
            if not asset:
                raise ValueError(f"Failed to find updated asset {existing_asset_id}")
            logger.info(f"Updated asset: {asset.id} ({asset.kind.value}) - {asset.title}")
        else:
            # Create the asset via AssetService (handles deduplication)
            asset_create = self._blueprint_to_asset_create()
            asset = self.asset_service.create_asset(asset_create)
            logger.info(f"Created asset: {asset.id} ({asset.kind.value}) - {asset.title}")
        
        # 5. Extract children based on ingestion_depth
        if self.blueprint.ingestion_depth > 0:
            await self._extract_children(asset)
        
        # 6. Build any child builders that were queued
        for child_builder in self.blueprint._child_builders:
            await child_builder.as_child_of(asset.id).build()
        
        return asset
    
    async def build_batch(self, count: int = 1) -> List[Asset]:
        """
        Build multiple identical assets (useful for testing).
        
        For building from multiple different sources, see build_from_list.
        """
        assets = []
        for i in range(count):
            # Clone the blueprint
            builder = self._clone()
            if "{i}" in self.blueprint.title:
                builder.blueprint.title = self.blueprint.title.replace("{i}", str(i))
            asset = await builder.build()
            assets.append(asset)
        return assets
    
    # ═══════════════════════════════════════════════════════════════
    # INTERNAL HELPERS
    # ═══════════════════════════════════════════════════════════════
    
    def _blueprint_to_asset_create(self) -> AssetCreate:
        """Convert blueprint to AssetCreate schema."""
        return AssetCreate(
            title=self.blueprint.title,
            kind=self.blueprint.kind,
            stub=self.blueprint.stub,
            user_id=self.blueprint.user_id,
            infospace_id=self.blueprint.infospace_id,
            text_content=self.blueprint.text_content,
            blob_path=self.blueprint.blob_path,
            source_identifier=self.blueprint.source_identifier,
            source_metadata=self.blueprint.source_metadata,
            event_timestamp=self.blueprint.event_timestamp,
            parent_asset_id=self.blueprint.parent_asset_id,
            part_index=self.blueprint.part_index,
            processing_status=self.blueprint.processing_status
        )
    
    def _clone(self) -> 'AssetBuilder':
        """Clone this builder (shallow copy of blueprint)."""
        new_builder = AssetBuilder(self.session, self.blueprint.user_id, self.blueprint.infospace_id)
        # Copy blueprint fields (shallow copy)
        import copy
        new_builder.blueprint = copy.copy(self.blueprint)
        new_builder.blueprint.source_metadata = self.blueprint.source_metadata.copy()
        new_builder.blueprint._enrichers = self.blueprint._enrichers.copy()
        new_builder.blueprint._child_builders = []
        return new_builder
    
    # NOTE: Content type detection moved to app.api.processors.registry
    # Use detect_asset_kind_from_extension() instead
    
    # ═══════════════════════════════════════════════════════════════
    # ENRICHERS (modify blueprint during build)
    # ═══════════════════════════════════════════════════════════════
    
    async def _enrich_scrape_url(self):
        """Enricher: Scrape URL content."""
        url = self.blueprint.source_identifier
        if not url:
            raise ValueError("Cannot scrape without source_identifier")
        
        try:
            scraped = await self.scraping_provider.scrape_url(url, timeout=30)
            
            if scraped and scraped.get('text_content'):
                self.blueprint.text_content = scraped['text_content']
                
                if scraped.get('title') and not self.blueprint.title.startswith("Web:"):
                    self.blueprint.title = scraped['title']
                
                self.blueprint.source_metadata.update({
                    "content_format": "markdown",  # Web scraping produces markdown
                    "content_source": "web_scrape",
                    "scraped_at": datetime.now(timezone.utc).isoformat(),
                    "scraped_title": scraped.get('title'),
                    "top_image": scraped.get('top_image'),
                    "summary": scraped.get('summary'),
                    "publication_date": scraped.get('publication_date'),
                    "author": scraped.get('author'),  # Canonical author field if available
                    "content_length": len(scraped['text_content'])
                })
                
                # Parse publication date
                if scraped.get('publication_date'):
                    try:
                        self.blueprint.event_timestamp = dateutil.parser.parse(scraped['publication_date'])
                    except: pass
                
                logger.info(f"Scraped {len(scraped['text_content'])} characters from {url}")
            else:
                logger.warning(f"No content scraped from {url}")
                
        except Exception as e:
            logger.error(f"Error scraping URL {url}: {e}")
            # Don't fail the build, just mark it
            self.blueprint.source_metadata["scraping_error"] = str(e)
    
    async def _enrich_store_file(self, file: UploadFile):
        """Enricher: Upload file to storage."""
        file_ext = os.path.splitext(file.filename or "")[1]
        storage_path = f"user_{self.blueprint.user_id}/{uuid.uuid4()}{file_ext}"
        
        try:
            await self.storage_provider.upload_file(file, storage_path)
            self.blueprint.blob_path = storage_path
            logger.info(f"Stored file at {storage_path}")
        except Exception as e:
            logger.error(f"Error storing file: {e}")
            raise
    
    async def _enrich_embedded_assets(self, embedded_assets: List[Dict[str, Any]]):
        """Enricher: Create child assets for embedded references."""
        # This enricher queues child builders to run after parent is created
        for i, embed_config in enumerate(embedded_assets):
            try:
                asset_id = embed_config.get('asset_id')
                if not asset_id:
                    continue
                
                # Verify the referenced asset exists and belongs to same infospace
                referenced_asset = self.session.get(Asset, asset_id)
                if not referenced_asset or referenced_asset.infospace_id != self.blueprint.infospace_id:
                    logger.warning(f"Embedded asset {asset_id} not found or not accessible")
                    continue
                
                # Create a child builder for the embed reference
                child_builder = AssetBuilder(self.session, self.blueprint.user_id, self.blueprint.infospace_id)
                child_builder.from_text(
                    text=f"Reference to: {referenced_asset.title}",
                    title=f"Embed: {embed_config.get('caption', referenced_asset.title)}"
                )
                child_builder.blueprint.part_index = i
                child_builder.with_metadata(
                    embed_type='asset_reference',
                    target_asset_id=asset_id,
                    embed_mode=embed_config.get('mode', 'card'),
                    embed_size=embed_config.get('size', 'medium'),
                    caption=embed_config.get('caption'),
                    position=embed_config.get('position', i)
                )
                
                self.blueprint._child_builders.append(child_builder)
                
            except Exception as e:
                logger.warning(f"Failed to create embed reference for asset {embed_config.get('asset_id')}: {e}")
                continue
    
    async def _enrich_csv_row_update(self, existing_asset_id: int, updates: Dict[str, Any], merge_strategy: str):
        """Enricher: Update existing CSV row asset with new data."""
        # Get the existing asset
        existing_asset = self.session.get(Asset, existing_asset_id)
        if not existing_asset:
            raise ValueError(f"CSV row asset {existing_asset_id} not found")

        if existing_asset.infospace_id != self.blueprint.infospace_id:
            raise ValueError(f"CSV row asset {existing_asset_id} does not belong to this infospace")

        # Get existing row data
        existing_row_data = existing_asset.source_metadata.get("original_row_data", {})

        # Apply merge strategy
        if merge_strategy == "merge":
            # Merge updates with existing data
            merged_data = {**existing_row_data, **updates}
        elif merge_strategy == "overwrite":
            # Use updates, but preserve non-updated fields from existing
            merged_data = {**existing_row_data, **updates}
        else:
            raise ValueError(f"Unknown merge strategy: {merge_strategy}")

        # Update the asset
        column_headers = existing_asset.source_metadata.get("column_headers", list(merged_data.keys()))

        # Generate new title from first few columns
        title_parts = []
        for key, value in list(merged_data.items())[:3]:
            if value and str(value).strip():
                title_parts.append(f"{key}: {str(value)[:25]}")
        new_title = " | ".join(title_parts) if title_parts else f"Row {len(merged_data)} columns"

        # Create pipe-separated text content
        existing_asset.text_content = " | ".join(
            str(merged_data.get(header, "")) for header in column_headers
        )

        # Update metadata
        existing_asset.title = new_title
        existing_asset.source_metadata.update({
            "original_row_data": merged_data,
            "column_headers": column_headers,
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "merge_strategy": merge_strategy,
            "updated_fields": list(updates.keys())
        })

        # Update timestamp
        existing_asset.updated_at = datetime.now(timezone.utc)

        # Mark as ready
        existing_asset.processing_status = ProcessingStatus.READY

        self.session.add(existing_asset)

        logger.info(f"Updated CSV row asset {existing_asset_id} with {len(updates)} fields")

    async def _enrich_rss_images(self, image_urls: List[Dict[str, Any]]):
        """Enricher: Create child image assets from RSS media:content."""
        # This enricher queues child builders to run after parent is created
        for idx, img_data in enumerate(image_urls):
            try:
                image_url = img_data.get('url')
                if not image_url:
                    continue

                # Determine if this is the featured/hero image (first one)
                is_featured = (idx == 0)
                role = img_data.get('role', 'featured' if is_featured else 'content')

                # Create a child builder for the image as a stub (don't download)
                child_builder = AssetBuilder(self.session, self.blueprint.user_id, self.blueprint.infospace_id)

                # Use URL stub pattern - creates reference without downloading
                if is_featured:
                    image_title = img_data.get('title') or "Featured image"
                else:
                    image_title = img_data.get('title') or f"Image {idx + 1}"

                child_builder.from_url_stub(image_url, image_title)
                child_builder.blueprint.kind = AssetKind.IMAGE
                child_builder.blueprint.part_index = img_data.get('part_index', idx)

                # Add rich metadata from RSS feed (following WebProcessor pattern)
                child_builder.with_metadata(
                    source='rss_media_content',
                    image_role=role,  # 'featured' or 'content'
                    is_hero_image=is_featured,  # Mark first image as hero
                    image_url=image_url,
                    media_credit=img_data.get('media_credit'),
                    extracted_from_rss=True
                )

                self.blueprint._child_builders.append(child_builder)

            except Exception as e:
                logger.warning(f"Failed to create image asset for {img_data.get('url')}: {e}")
                continue
    
    async def _extract_children(self, parent: Asset):
        """Extract children based on ingestion_depth and asset kind."""
        if self.blueprint.kind == AssetKind.ARTICLE and parent.text_content:
            await self._extract_article_links(parent)
        # Future: Add other extraction types (PDF pages, CSV rows, etc.)
    
    async def _extract_article_links(self, article: Asset):
        """Extract links from markdown article based on depth."""
        markdown = article.text_content
        if not markdown:
            return
        
        # Extract image URLs from markdown
        image_urls = self._extract_markdown_images(markdown)
        
        logger.info(f"Extracting {len(image_urls)} images from article {article.id} at depth {self.blueprint.ingestion_depth}")
        
        for idx, img_url in enumerate(image_urls):
            try:
                child_builder = AssetBuilder(self.session, article.user_id, article.infospace_id)
                
                if self.blueprint.ingestion_depth == 1:
                    # Depth 1: Create stub reference
                    child_builder.from_url_stub(img_url, f"Image {idx+1} from {article.title[:30]}...")
                else:  # depth >= 2
                    # Depth 2+: Actually fetch the image
                    child_builder.from_url(img_url, f"Image {idx+1} from {article.title[:30]}...")
                
                await child_builder \
                    .as_kind(AssetKind.IMAGE) \
                    .as_child_of(article.id, idx) \
                    .with_metadata(extracted_from_markdown=True) \
                    .build()
                    
            except Exception as e:
                logger.error(f"Failed to extract image {img_url} from article {article.id}: {e}")
                continue
    
    def _extract_markdown_images(self, markdown: str) -> List[str]:
        """Extract image URLs from markdown."""
        # Match both ![alt](url) and ![alt](url "title")
        pattern = r'!\[(?:[^\]]*)\]\(([^)]+?)(?:\s+"[^"]*")?\)'
        matches = re.findall(pattern, markdown)
        
        # Filter to only http/https URLs
        urls = [url.strip() for url in matches if url.strip().startswith(('http://', 'https://'))]
        
        return urls

