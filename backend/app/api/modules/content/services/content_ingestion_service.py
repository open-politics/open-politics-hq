"""
Content Ingestion Service
==========================

Thin compatibility layer for legacy ingestion code. New code should use Handlers
and specialized services directly.

Architecture:
-------------
    Routes → Handlers → AssetBuilder → Processors
    Routes → SearchService (text/semantic search)
    Routes → RSSHandler (preview, discovery, ingest_from_awesome_repo)
    Celery → ProcessingService (batch_process_pending, batch_enrich)

What this service provides (compatibility only):
-----------------------------------------------
- ingest_content(): Router for celery tasks and scheduled source processing.
  Delegates to FileHandler, WebHandler, RSSHandler, TextHandler, ArchiveHandler.
- _process_content(), reprocess_content(): Delegate to ProcessingService.
- _add_assets_to_bundle(): Helper for bundle assignment after ingestion.
- compose_article(), create_report(): Article/report creation (routes).
- get_supported_content_types(): UI support (from ContentTypeRegistry).

Extracted to dedicated modules:
-------------------------------
- ProcessingService: Phase 1–3 pipeline, reprocess, CSV utilities.
- SearchService: search_assets_text, search_assets_semantic.
- RSSHandler: preview_rss_feed, discover_rss_feeds_from_awesome_repo,
  ingest_from_awesome_repo.
"""

import logging
import asyncio
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Union

from sqlmodel import Session, select
from fastapi import UploadFile

from app.models import Asset, AssetKind, ProcessingStatus
from app.schemas import SearchResult
from app.api.modules.foundation_service_providers.base import WebSearchProvider, ScrapingProvider, StorageProvider
from app.api.modules.foundation_service_providers.factory import create_web_search_provider, create_scraping_provider, create_storage_provider
from app.api.modules.content.services.asset_service import AssetService
from app.api.global_utils import validate_infospace_access
from app.core.config import settings

logger = logging.getLogger(__name__)


class ContentIngestionService:
    """
    Compatibility layer for legacy ingestion code.

    Use Handlers and specialized services for new code:
    - Ingestion: app.api.modules.handlers (FileHandler, WebHandler, RSSHandler, etc.)
    - Search: app.api.modules.services.search_service.SearchService
    - Processing: app.api.modules.services.processing_service.ProcessingService
    - RSS preview/discovery: app.api.modules.handlers.RSSHandler.preview_rss_feed, etc.

    Retained for: celery tasks, process_source, ingest_content route shim,
    compose_article, create_report, get_supported_content_types.
    """
    
    def __init__(self, session: Session, search_provider: Optional[WebSearchProvider] = None):
        self.session = session
        
        # Initialize providers
        if not search_provider:
            try:
                self.search_provider = create_web_search_provider(settings)
            except Exception as e:
                logger.error(f"Failed to create search provider: {e}")

        self.scraping_provider = create_scraping_provider(settings)
        self.storage_provider = create_storage_provider(settings)
        
        # Initialize core asset service
        self.asset_service = AssetService(session, self.storage_provider)
        
        logger.info("ContentIngestionService initialized (compatibility layer)")

    def _get_processing_service(self) -> "ProcessingService":
        """Lazy-create ProcessingService for processing operations."""
        from app.api.modules.content.services.processing_service import ProcessingService
        return ProcessingService(
            session=self.session,
            storage_provider=self.storage_provider,
            scraping_provider=self.scraping_provider,
            asset_service=self.asset_service,
        )

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
            from app.api.modules.content.handlers import FileHandler, WebHandler
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
        
        # Single-dispatch: resolve handler from locator type
        from app.api.modules.content.handlers import IngestionContext
        from app.api.modules.content.handlers.resolve import resolve_handler
        from app.api.modules.content.services.bundle_service import BundleService
        
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
        
        resolved = resolve_handler(locator, context, title=title, options=options)
        handler = resolved.handler_cls(context)
        method = getattr(handler, resolved.method)
        assets = await method(**resolved.kwargs)
        
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
        # Bulk fetch all assets
        assets_list = self.session.exec(select(Asset).where(Asset.id.in_(asset_ids))).all()
        assets_by_id = {a.id: a for a in assets_list}
        # Bulk fetch all children for non-container assets
        non_container_ids = [a.id for a in assets_list if not a.is_container]
        children_by_parent: Dict[int, List[Asset]] = {}
        if non_container_ids:
            child_assets = self.session.exec(
                select(Asset).where(Asset.parent_asset_id.in_(non_container_ids))
            ).all()
            for child in child_assets:
                if child.parent_asset_id:
                    children_by_parent.setdefault(child.parent_asset_id, []).append(child)
        for asset_id in asset_ids:
            try:
                asset = assets_by_id.get(asset_id)
                if not asset:
                    logger.warning(f"Asset {asset_id} not found")
                    continue
                if asset.bundle_id != bundle_id:
                    asset.bundle_id = bundle_id
                    assets_added += 1
                    self.session.add(asset)
                    logger.info(f"Added asset {asset_id} to bundle {bundle_id}")
                if not asset.is_container:
                    for child_asset in children_by_parent.get(asset_id, []):
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
        """Delegate to ProcessingService. Used by celery content_tasks."""
        svc = self._get_processing_service()
        await svc.process_content(asset, options)

    async def reprocess_content(
        self,
        asset: Asset,
        options: Optional[Dict[str, Any]] = None
    ) -> None:
        """Delegate to ProcessingService. Used by reprocess route and celery task."""
        svc = self._get_processing_service()
        await svc.reprocess_content(asset, options)
    # ═══════════════════════════════════════════════════════════════
    # SPECIALIZED METHODS: compose_article, create_report (route needs)
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
        from app.api.modules.content.services.asset_builder import AssetBuilder
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
        """Get supported content types (for UI). Derived from ContentTypeRegistry."""
        from app.api.modules.content.types import get_content_type_registry

        registry = get_content_type_registry()
        result: Dict[str, List[str]] = {}
        for desc in registry._by_kind.values():
            if desc.extensions:
                exts = (
                    desc.importable_extensions
                    if desc.importable_extensions is not None
                    else desc.extensions
                )
                result.setdefault(desc.category, []).extend(sorted(exts))
        result["web"] = ["http://", "https://"]
        return {k: sorted(set(v)) for k, v in result.items()}
    
    # ═══════════════════════════════════════════════════════════════
    # MIGRATION REFERENCE (methods moved or removed)
    # ═══════════════════════════════════════════════════════════════
    #
    # Ingestion: _handle_* → FileHandler, WebHandler, RSSHandler, TextHandler,
    #   ArchiveHandler, SearchHandler (app.api.modules.handlers)
    # Search: search_assets_text, search_assets_semantic → SearchService
    # Processing: _process_content, reprocess_content → ProcessingService
    # RSS discovery: preview_rss_feed, discover_rss_feeds_from_awesome_repo,
    #   ingest_rss_feeds_from_awesome_repo → RSSHandler (static/class methods)
    # ═══════════════════════════════════════════════════════════════
