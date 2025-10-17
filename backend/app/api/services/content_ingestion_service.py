"""
Content Ingestion Service
==========================

REFACTORED: This service is now a thin compatibility layer for existing code.
New code should use Handlers directly.

Architecture (Post-Refactoring):
--------------------------------
    Routes → Handlers → AssetBuilder → Processors

This service provides:
1. Backwards compatibility for celery tasks and scheduled source processing
2. Processing helpers for transforming existing assets
3. Search operations for ConversationService MCP tools
4. RSS feed discovery utilities

For new ingestion code, USE HANDLERS DIRECTLY:
- FileHandler: File uploads
- WebHandler: URL scraping, bulk URLs
- SearchHandler: Search result ingestion
- RSSHandler: RSS feed parsing
- TextHandler: Direct text content

This service will eventually be split into:
- ProcessingService: Asset processing operations
- SearchService: Search operations (text, semantic, hybrid)
- Specialized handlers keeping their domain logic
"""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from sqlmodel import Session, select, and_, or_
from fastapi import UploadFile

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import SearchResult
from app.api.providers.base import SearchProvider, ScrapingProvider, StorageProvider
from app.api.providers.factory import create_search_provider, create_scraping_provider, create_storage_provider
from app.api.services.asset_service import AssetService
from app.api.services.service_utils import validate_infospace_access
from app.core.config import settings

logger = logging.getLogger(__name__)


class ContentIngestionService:
    """
    Compatibility layer for legacy ingestion code.
    
    DEPRECATED PATTERN: This service as a unified ingestion interface
    NEW PATTERN: Use Handlers directly (FileHandler, WebHandler, etc.)
    
    This service now provides:
    - Backwards compatibility for celery bulk tasks
    - Processing helpers for existing assets (used by celery content_tasks)
    - Search operations (used by ConversationService)
    - RSS discovery utilities
    
    For new routes and features, use Handlers directly from app.api.handlers.
    """
    
    def __init__(self, session: Session, search_provider: Optional[SearchProvider] = None):
        self.session = session
        
        # Initialize providers
        self.search_provider = search_provider or create_search_provider(settings)
        self.scraping_provider = create_scraping_provider(settings)
        self.storage_provider = create_storage_provider(settings)
        
        # Initialize core asset service
        self.asset_service = AssetService(session, self.storage_provider)
        
        logger.info("ContentIngestionService initialized (compatibility layer)")
    
    # ═══════════════════════════════════════════════════════════════
    # BACKWARDS COMPATIBILITY: Used by celery tasks and routes
    # ═══════════════════════════════════════════════════════════════
    
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
        COMPATIBILITY METHOD: Route to appropriate handler.
        
        This method exists for backwards compatibility with:
        - Celery bulk ingestion tasks (ingest_bulk_urls, ingest_bulk_files)
        - Scheduled source processing (process_source task)
        
        NEW CODE SHOULD USE HANDLERS DIRECTLY:
            from app.api.handlers import FileHandler, WebHandler
            handler = FileHandler(context)
            assets = await handler.handle(file, options)
        
        Args:
            locator: File, URL, or text content
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
        
        # Validate bundle exists BEFORE creating any assets (prevents orphaned assets)
        if bundle_id:
            from app.models import Bundle
            bundle = self.session.get(Bundle, bundle_id)
            if not bundle:
                raise ValueError(f"Bundle {bundle_id} not found. Cannot ingest content into non-existent bundle.")
            logger.info(f"Validated bundle {bundle_id} exists for ingestion")
        
        # Route to appropriate handler based on input type
        from app.api.handlers import (
            FileHandler, WebHandler, TextHandler,
            IngestionContext
        )
        from app.api.services.bundle_service import BundleService
        
        # Detect type and delegate
        if isinstance(locator, UploadFile):
            # FileHandler needs full context (for processing decisions)
            context = IngestionContext(
                session=self.session,
                storage_provider=self.storage_provider,
                scraping_provider=self.scraping_provider,
                search_provider=self.search_provider,
                asset_service=self.asset_service,
                bundle_service=BundleService(self.session),
                user_id=user_id,
                infospace_id=infospace_id,
                settings=settings,
                options=options
            )
            handler = FileHandler(context)
            assets = await handler.handle(locator, title, options)
            
        elif isinstance(locator, list):
            # Bulk URL ingestion - WebHandler takes just session
            handler = WebHandler(self.session)
            assets = await handler.handle_bulk(
                urls=locator,
                infospace_id=infospace_id,
                user_id=user_id,
                base_title=title or "Bulk URL Collection",
                options=options
            )
            
        elif isinstance(locator, str):
            if locator.startswith(('http://', 'https://')):
                # Check if it's an RSS feed using centralized detection
                from app.api.processors import is_rss_feed_url
                
                if is_rss_feed_url(locator):
                    # Route to RSSHandler
                    from app.api.handlers import RSSHandler
                    handler = RSSHandler(self.session)
                    assets = await handler.handle(
                        feed_url=locator,
                        infospace_id=infospace_id,
                        user_id=user_id,
                        options=options
                    )
                else:
                    # Single URL - WebHandler takes just session
                    handler = WebHandler(self.session)
                    assets = [await handler.handle(
                        url=locator,
                        infospace_id=infospace_id,
                        user_id=user_id,
                        title=title,
                        options=options
                    )]
            else:
                # Plain text content - TextHandler takes just session
                handler = TextHandler(self.session)
                assets = [await handler.handle(
                    text=locator,
                    infospace_id=infospace_id,
                    user_id=user_id,
                    title=title,
                    event_timestamp=options.get('event_timestamp'),
                    options=options
                )]
        else:
            raise ValueError(f"Unsupported locator type: {type(locator)}")
        
        # Add to bundle if specified
        if bundle_id and assets:
            await self._add_assets_to_bundle(
                [asset.id for asset in assets if asset.parent_asset_id is None],
                bundle_id
            )
        
        return assets
    
    async def _add_assets_to_bundle(self, asset_ids: List[int], bundle_id: int) -> None:
        """Add assets to bundle by directly setting bundle_id (no user validation needed)."""
        from app.models import Bundle, Asset
        
        bundle = self.session.get(Bundle, bundle_id)
        
        if not bundle:
            error_msg = f"Bundle {bundle_id} not found - it may have been deleted. Assets will not be added to any bundle."
            logger.error(error_msg)
            raise ValueError(error_msg)
        
        assets_added = 0
        
        for asset_id in asset_ids:
            try:
                asset = self.session.get(Asset, asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    continue
                    
                # Directly set bundle_id (no user validation needed in system context)
                if asset.bundle_id != bundle_id:
                    asset.bundle_id = bundle_id
                    assets_added += 1
                    self.session.add(asset)
                    logger.info(f"Added asset {asset_id} to bundle {bundle_id}")
                    
                # Add child assets if not a container (same logic as BundleService)
                if not asset.is_container:
                    child_assets = self.session.exec(
                        select(Asset).where(Asset.parent_asset_id == asset_id)
                    ).all()
                    
                    for child_asset in child_assets:
                        if child_asset.bundle_id != bundle_id:
                            child_asset.bundle_id = bundle_id
                            assets_added += 1
                            self.session.add(child_asset)
                            
            except Exception as e:
                logger.error(f"Failed to add asset {asset_id} to bundle: {e}")
                continue
        
        # Update bundle asset count
        if assets_added > 0:
            bundle.asset_count = (bundle.asset_count or 0) + assets_added
            bundle.updated_at = datetime.now(timezone.utc)
            self.session.add(bundle)
            logger.info(f"Added {assets_added} assets to bundle {bundle_id}, new count: {bundle.asset_count}")
        
        # Commit all changes to persist bundle_id assignments
        self.session.commit()
        logger.info(f"Committed bundle assignments for {len(asset_ids)} assets to bundle {bundle_id}")
    
    # ═══════════════════════════════════════════════════════════════
    # PROCESSING OPERATIONS: Used by celery content_tasks
    # ═══════════════════════════════════════════════════════════════
    
    async def _process_content(self, asset: Asset, options: Dict[str, Any]) -> None:
        """
        Process asset content using ProcessorRegistry.
        
        Used by:
        - celery task: process_content
        - celery task: reprocess_content
        - celery task: retry_failed_content_processing
        
        Flow:
        1. Get processor from registry based on asset.kind
        2. Create ProcessingContext with dependencies
        3. Execute processor.process(asset)
        4. Update asset.processing_status
        
        Args:
            asset: Asset to process
            options: Processing options (encoding, delimiter, max_rows, etc.)
        """
        # Skip container assets
        if asset.kind == AssetKind.RSS_FEED:
            logger.info(f"Skipping processing for RSS_FEED asset {asset.id} - children already extracted")
            return
        
        if asset.processing_status == ProcessingStatus.PROCESSING:
            return
        
        # Get processor from registry
        from app.api.processors.registry import get_registry
        from app.api.processors.base import ProcessingContext
        from app.api.services.bundle_service import BundleService
        
        processor_class = get_registry().get_processor_class(asset)
        if not processor_class:
            logger.warning(f"No processor for asset kind {asset.kind}, marking READY")
            asset.processing_status = ProcessingStatus.READY
            self.session.add(asset)
            self.session.commit()
            return
        
        # Mark as processing
        asset.processing_status = ProcessingStatus.PROCESSING
        self.session.add(asset)
        self.session.commit()
        
        try:
            # Create processor context
            context = ProcessingContext(
                session=self.session,
                storage_provider=self.storage_provider,
                scraping_provider=self.scraping_provider,
                asset_service=self.asset_service,
                bundle_service=BundleService(self.session),
                user_id=asset.user_id,
                infospace_id=asset.infospace_id,
                options=options
            )
            
            # Process
            processor = processor_class(context)
            child_assets = await processor.process(asset)
            
            # Mark as ready
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
        self,
        asset: Asset,
        options: Optional[Dict[str, Any]] = None
    ) -> None:
        """
        Reprocess existing content with new options.
        
        IMPORTANT: For CSV assets, this preserves existing row assets by updating them in-place
        rather than deleting and recreating. This preserves annotations, fragments, and other
        relationships that reference these assets.
        
        Used by:
        - celery task: reprocess_content
        - Route: POST /assets/{asset_id}/reprocess
        
        Args:
            asset: Asset to reprocess
            options: New processing options
        """
        # For CSV assets, use smart update instead of delete+recreate
        if asset.kind == AssetKind.CSV:
            await self._reprocess_csv_preserving_children(asset, options or {})
        else:
            # For other asset types, use the old behavior (delete + recreate)
            children = self.session.exec(
                select(Asset).where(Asset.parent_asset_id == asset.id)
            ).all()
            
            if children:
                for child in children:
                    self.session.delete(child)
                self.session.flush()
                logger.info(f"Deleted {len(children)} existing child assets")
            
            # Reprocess
            await self._process_content(asset, options or {})
    
    async def _reprocess_csv_preserving_children(
        self,
        asset: Asset,
        options: Dict[str, Any]
    ) -> None:
        """
        Reprocess CSV by updating existing row assets in-place.
        This preserves annotations, fragments, and other relationships.
        """
        from app.models import AssetKind
        from app.api.processors import get_processor, ProcessingContext
        
        # Get existing children sorted by part_index
        existing_children = self.session.exec(
            select(Asset)
            .where(Asset.parent_asset_id == asset.id)
            .order_by(Asset.part_index)
        ).all()
        
        logger.info(f"Reprocessing CSV asset {asset.id} with {len(existing_children)} existing children (will update in-place)")
        
        # Create processing context
        from app.api.services.bundle_service import BundleService
        
        context = ProcessingContext(
            session=self.session,
            storage_provider=self.storage_provider,
            scraping_provider=self.scraping_provider,
            asset_service=self.asset_service,
            bundle_service=BundleService(self.session),
            user_id=asset.user_id,
            infospace_id=asset.infospace_id,
            options=options
        )
        
        # Get processor and process to get new row data
        processor = get_processor(asset, context)
        if not processor:
            raise ValueError(f"No processor found for asset kind: {asset.kind}")
        
        # Process returns list of AssetCreate objects
        new_row_creates = await processor.process(asset)
        
        logger.info(f"CSV processing generated {len(new_row_creates)} new rows")
        
        # Match and update existing assets
        children_to_keep = []
        for i, row_create in enumerate(new_row_creates):
            if i < len(existing_children):
                # Update existing asset in-place
                existing_asset = existing_children[i]
                existing_asset.title = row_create.title
                existing_asset.text_content = row_create.text_content
                existing_asset.source_metadata = row_create.source_metadata
                existing_asset.part_index = row_create.part_index
                existing_asset.updated_at = datetime.now(timezone.utc)
                
                self.session.add(existing_asset)
                children_to_keep.append(existing_asset)
                logger.debug(f"Updated existing row asset {existing_asset.id} at index {i}")
            else:
                # Create new asset for added rows
                new_asset = self.asset_service.create_asset(row_create)
                children_to_keep.append(new_asset)
                logger.debug(f"Created new row asset {new_asset.id} at index {i}")
        
        # Delete assets for removed rows (if CSV got smaller)
        if len(existing_children) > len(new_row_creates):
            for old_asset in existing_children[len(new_row_creates):]:
                logger.info(f"Deleting removed row asset {old_asset.id}")
                self.session.delete(old_asset)
        
        self.session.flush()
        logger.info(
            f"CSV reprocessing complete: "
            f"{min(len(existing_children), len(new_row_creates))} updated, "
            f"{max(0, len(new_row_creates) - len(existing_children))} created, "
            f"{max(0, len(existing_children) - len(new_row_creates))} deleted"
        )
    
    # ═══════════════════════════════════════════════════════════════
    # SEARCH OPERATIONS: Used by ConversationService MCP tools
    # ═══════════════════════════════════════════════════════════════
    
    async def search_assets_text(
        self,
        query: str,
        infospace_id: int,
        limit: int,
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Text-based search in existing assets.

        Used by: ConversationService MCP search_assets tool
        """
        asset_kinds = options.get('asset_kinds', [])
        parent_asset_id = options.get('parent_asset_id')
        bundle_id = options.get('bundle_id')

        query_conditions = [Asset.infospace_id == infospace_id]

        if query:
            search_condition = or_(
                Asset.title.ilike(f"%{query}%"),
                Asset.text_content.ilike(f"%{query}%")
            )
            query_conditions.append(search_condition)

        if asset_kinds:
            kind_conditions = [
                Asset.kind == AssetKind(kind)
                for kind in asset_kinds
                if kind in AssetKind.__members__
            ]
            if kind_conditions:
                query_conditions.append(or_(*kind_conditions))

        if parent_asset_id:
            # Filter by parent_asset_id (for searching within specific parent assets like CSV rows)
            query_conditions.append(Asset.parent_asset_id == parent_asset_id)

        if bundle_id:
            # Filter by bundle_id (for searching within specific bundles)
            query_conditions.append(Asset.bundle_id == bundle_id)

        assets = self.session.exec(
            select(Asset)
            .where(and_(*query_conditions))
            .order_by(Asset.created_at.desc())
            .limit(limit)
        ).all()

        return list(assets)
    
    async def search_assets_semantic(
        self, 
        query: str, 
        infospace_id: int, 
        limit: int, 
        options: Dict[str, Any]
    ) -> List[Asset]:
        """
        Semantic search using embeddings.
        
        Used by: AssetService search_assets method for semantic/hybrid search
        """
        try:
            from app.api.services.vector_search_service import VectorSearchService
            
            # Extract runtime API keys from options (passed from MCP server via AssetService)
            runtime_api_keys = options.get('runtime_api_keys')
            
            # Use VectorSearchService for semantic search
            search_service = VectorSearchService(self.session, runtime_api_keys=runtime_api_keys)
            search_results = await search_service.semantic_search(
                query_text=query,
                infospace_id=infospace_id,
                limit=limit,
                asset_kinds=options.get('asset_kinds'),
                distance_threshold=options.get('distance_threshold', 0.8)
            )
            
            # Get unique assets from search results
            asset_ids = list(set(result.asset_id for result in search_results))
            
            if not asset_ids:
                return []
            
            assets = self.session.exec(
                select(Asset)
                .where(Asset.id.in_(asset_ids))
                .where(Asset.infospace_id == infospace_id)
            ).all()
            
            return list(assets)
            
        except Exception as e:
            logger.warning(f"Semantic search failed, falling back to text: {e}")
            return await self.search_assets_text(query, infospace_id, limit, options)
    
    # ═══════════════════════════════════════════════════════════════
    # RSS DISCOVERY: Used by RSS ingestion routes
    # ═══════════════════════════════════════════════════════════════
    
    async def preview_rss_feed(self, feed_url: str, max_items: int = 20) -> Dict[str, Any]:
        """
        Preview RSS feed without creating assets.
        
        Used by: GET /assets/preview-rss-feed route
        """
        try:
            import feedparser
            from fastapi import HTTPException
            from starlette import status
            
            feed = feedparser.parse(feed_url)
            
            if feed.bozo:
                raise ValueError(f"Feed parsing error: {feed.bozo_exception}")
            
            feed_info = {
                "title": feed.feed.get("title", "Unknown Feed"),
                "description": feed.feed.get("description", ""),
                "link": feed.feed.get("link", ""),
                "language": feed.feed.get("language", ""),
                "updated": feed.feed.get("updated", ""),
                "total_items": len(feed.entries),
            }
            
            items = []
            for i, entry in enumerate(feed.entries[:max_items]):
                item = {
                    "index": i,
                    "title": entry.get("title", ""),
                    "link": entry.get("link", ""),
                    "summary": entry.get("summary", ""),
                    "published": entry.get("published", ""),
                    "author": entry.get("author", ""),
                    "tags": [tag.get("term", "") for tag in entry.get("tags", [])],
                    "id": entry.get("id", ""),
                    "content": (
                        entry.get("content", [{}])[0].get("value", "")
                        if entry.get("content")
                        else ""
                    ),
                }
                items.append(item)
            
            return {
                "feed_info": feed_info,
                "items": items,
                "feed_url": feed_url,
                "previewed_at": datetime.now(timezone.utc).isoformat(),
            }
        except Exception as e:
            logger.error(f"Failed to preview RSS feed {feed_url}: {e}", exc_info=True)
            from fastapi import HTTPException
            from starlette import status
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Could not preview RSS feed: {e}",
            )
    
    async def discover_rss_feeds_from_awesome_repo(
        self, 
        country: Optional[str] = None, 
        category: Optional[str] = None,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Discover RSS feeds from awesome-rss-feeds GitHub repository.
        
        Used by: GET /assets/discover-rss-feeds route
        """
        import xml.etree.ElementTree as ET
        import aiohttp
        
        try:
            base_url = "https://raw.githubusercontent.com/plenaryapp/awesome-rss-feeds/master"
            
            if country:
                opml_url = f"{base_url}/countries/with_category/{country}.opml"
                feeds = await self._fetch_and_parse_opml(opml_url, country)
            else:
                feeds = await self._fetch_all_country_feeds(base_url, category, limit)
            
            if category:
                feeds = [
                    feed for feed in feeds 
                    if category.lower() in feed.get('title', '').lower() or 
                       category.lower() in feed.get('description', '').lower()
                ]
            
            return feeds[:limit]
            
        except Exception as e:
            logger.error(f"Failed to discover RSS feeds: {e}")
            return []
    
    async def _fetch_and_parse_opml(self, opml_url: str, country: str) -> List[Dict[str, Any]]:
        """Fetch and parse OPML file."""
        import aiohttp
        import xml.etree.ElementTree as ET
        
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(opml_url) as response:
                    if response.status == 200:
                        opml_content = await response.text()
                        return self._parse_opml_content(opml_content, country)
                    else:
                        logger.warning(f"Failed to fetch OPML for {country}: HTTP {response.status}")
                        return []
        except Exception as e:
            logger.error(f"Error fetching OPML for {country}: {e}")
            return []
    
    async def _fetch_all_country_feeds(
        self, 
        base_url: str, 
        category: Optional[str], 
        limit: int
    ) -> List[Dict[str, Any]]:
        """Fetch feeds from all countries."""
        countries = [
            "Australia", "Bangladesh", "Brazil", "Canada", "Germany", "Spain", "France",
            "United Kingdom", "Hong Kong SAR China", "Indonesia", "Ireland", "India",
            "Iran", "Italy", "Japan", "Myanmar (Burma)", "Mexico", "Nigeria",
            "Philippines", "Pakistan", "Poland", "Russia", "Ukraine", "United States",
            "South Africa"
        ]
        
        all_feeds = []
        semaphore = asyncio.Semaphore(5)
        
        async def fetch_country_feeds(country_name):
            async with semaphore:
                opml_url = f"{base_url}/countries/with_category/{country_name}.opml"
                return await self._fetch_and_parse_opml(opml_url, country_name)
        
        tasks = [fetch_country_feeds(country) for country in countries]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        
        for result in results:
            if isinstance(result, list):
                all_feeds.extend(result)
            elif isinstance(result, Exception):
                logger.error(f"Error fetching country feeds: {result}")
        
        return all_feeds
    
    def _parse_opml_content(self, opml_content: str, country: str) -> List[Dict[str, Any]]:
        """Parse OPML and extract feed info."""
        import xml.etree.ElementTree as ET
        
        try:
            root = ET.fromstring(opml_content)
            feeds = []
            
            for outline in root.iter():
                if outline.get('xmlUrl'):
                    feed_info = {
                        'title': outline.get('title', ''),
                        'description': outline.get('description', ''),
                        'url': outline.get('xmlUrl', ''),
                        'text': outline.get('text', ''),
                        'country': country,
                        'source': 'awesome-rss-feeds',
                        'discovered_at': datetime.now(timezone.utc).isoformat()
                    }
                    feeds.append(feed_info)
            
            logger.info(f"Parsed {len(feeds)} RSS feeds from {country}")
            return feeds
            
        except ET.ParseError as e:
            logger.error(f"Failed to parse OPML for {country}: {e}")
            return []
        except Exception as e:
            logger.error(f"Error parsing OPML for {country}: {e}")
            return []
    
    async def ingest_rss_feeds_from_awesome_repo(
        self,
        country: str,
        infospace_id: int,
        user_id: int,
        category_filter: Optional[str] = None,
        max_feeds: int = 10,
        max_items_per_feed: int = 20,
        bundle_id: Optional[int] = None,
        options: Optional[Dict[str, Any]] = None
    ) -> List[Asset]:
        """
        Discover and ingest RSS feeds from awesome-rss-feeds repository.
        
        Used by: POST /assets/ingest-rss-feeds-from-awesome route
        
        Args:
            country: Country name (e.g., "Australia", "United States")
            infospace_id: Target infospace ID
            user_id: User ID creating the assets
            category_filter: Optional category filter (e.g., "News", "Technology")
            max_feeds: Maximum number of feeds to ingest
            max_items_per_feed: Maximum items per feed
            bundle_id: Optional bundle ID to add assets to
            options: Additional processing options
            
        Returns:
            List of created assets
        """
        from app.api.handlers import RSSHandler
        
        try:
            # Discover RSS feeds
            discovered_feeds = await self.discover_rss_feeds_from_awesome_repo(
                country=country,
                category=category_filter,
                limit=max_feeds
            )
            
            if not discovered_feeds:
                logger.warning(f"No RSS feeds found for country: {country}")
                return []
            
            logger.info(f"Discovered {len(discovered_feeds)} RSS feeds for {country}")
            
            # Ingest each discovered feed
            handler = RSSHandler(self.session)
            all_assets = []
            
            for i, feed_info in enumerate(discovered_feeds):
                try:
                    feed_url = feed_info['url']
                    feed_title = feed_info['title']
                    
                    logger.info(f"Processing RSS feed {i+1}/{len(discovered_feeds)}: {feed_title}")
                    
                    feed_options = {
                        'max_items': max_items_per_feed,
                        **(options or {})
                    }
                    
                    feed_assets = await handler.handle(
                        feed_url=feed_url,
                        infospace_id=infospace_id,
                        user_id=user_id,
                        options=feed_options
                    )
                    
                    # Add discovery metadata
                    for asset in feed_assets:
                        if asset.source_metadata:
                            asset.source_metadata.update({
                                'discovery_source': 'awesome-rss-feeds',
                                'discovery_country': country,
                                'discovery_category': category_filter,
                                'feed_description': feed_info.get('description', ''),
                                'feed_text': feed_info.get('text', '')
                            })
                    
                    all_assets.extend(feed_assets)
                    
                    # Add to bundle if specified
                    if bundle_id and feed_assets:
                        await self._add_assets_to_bundle(
                            [asset.id for asset in feed_assets],
                            bundle_id
                        )
                    
                except Exception as e:
                    logger.error(f"Failed to process RSS feed {feed_info.get('title', 'Unknown')}: {e}")
                    continue
            
            self.session.commit()
            logger.info(f"RSS feed ingestion completed: {len(all_assets)} assets created from {len(discovered_feeds)} feeds")
            
            return all_assets
            
        except Exception as e:
            logger.error(f"RSS feed ingestion from awesome repo failed: {e}")
            return []
    
    # ═══════════════════════════════════════════════════════════════
    # SPECIALIZED METHODS: Keep for specific route needs
    # ═══════════════════════════════════════════════════════════════
    
    async def compose_article(
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
        Compose article with embedded assets (uses AssetBuilder).
        
        Used by: POST /assets/compose-article route
        """
        from app.api.services.asset_builder import AssetBuilder
        validate_infospace_access(self.session, infospace_id, user_id)
        
        builder = AssetBuilder(self.session, user_id, infospace_id) \
            .from_article(title, content, summary, embedded_assets)
        
        if referenced_bundles:
            builder.with_metadata(
                referenced_bundles=referenced_bundles,
                bundle_references=len(referenced_bundles)
            )
        
        if metadata:
            builder.with_metadata(**metadata)
        
        if event_timestamp:
            builder.with_timestamp(event_timestamp)
        
        article = await builder.build()
        logger.info(f"Composed article {article.id}")
        return article
    
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
        """
        Create report asset (used by ConversationService).
        
        Used by: ConversationService create_report MCP tool
        """
        from app.schemas import AssetCreate
        validate_infospace_access(self.session, infospace_id, user_id)
        
        source_metadata = {
            "composition_type": "report",
            "created_by": "user_action",
            "source_asset_ids": source_asset_ids or [],
            "source_bundle_ids": source_bundle_ids or [],
            "source_run_ids": source_run_ids or [],
            "generation_config": generation_config or {},
        }
        
        report_create = AssetCreate(
            title=title,
            kind=AssetKind.ARTICLE,
            text_content=content,
            user_id=user_id,
            infospace_id=infospace_id,
            source_metadata=source_metadata,
        )
        
        report = self.asset_service.create_asset(report_create)
        logger.info(f"Report '{title}' (Asset ID: {report.id}) created")
        return report
    
    def get_supported_content_types(self) -> Dict[str, List[str]]:
        """Get supported content types (for UI)."""
        return {
            "documents": [".pdf", ".txt", ".md"],
            "data": [".csv", ".json"],
            "images": [".jpg", ".jpeg", ".png", ".gif", ".webp"],
            "audio": [".mp3", ".wav", ".ogg"],
            "video": [".mp4", ".avi", ".mov", ".webm"],
            "email": [".mbox", ".eml"],
            "web": ["http://", "https://"]
        }
    
    # ═══════════════════════════════════════════════════════════════
    # DEPRECATED: For reference only (will be removed)
    # ═══════════════════════════════════════════════════════════════
    # 
    # These methods were removed in refactoring. Their functionality moved to:
    #
    # _handle_file_upload() → FileHandler.handle()
    # _handle_web_page() → WebHandler.handle()
    # _handle_search_query() → SearchHandler + external search
    # _handle_rss_feed() → RSSHandler.handle()
    # _handle_text_content() → TextHandler.handle()
    # _handle_url_list() → WebHandler.handle_bulk()
    # _handle_site_discovery() → WebHandler (future SiteDiscoveryHandler)
    # _handle_direct_file_url() → WebHandler
    #
    # See app/api/handlers/ for the new implementation
    # ═══════════════════════════════════════════════════════════════
