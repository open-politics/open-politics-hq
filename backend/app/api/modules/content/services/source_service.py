"""
Source Service
=============

Service for managing Source model operations and bridging the unified AssetDiscoveryService
with existing Source-based workflows. This service handles:
- Source CRUD operations
- Integration with AssetDiscoveryService for content discovery
- Source status management and monitoring
- Legacy Source model compatibility
"""

import logging
import json
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple, Union
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select, func
from fastapi import HTTPException

from app.models import (
    Source, 
    SourceStatus, 
    Asset,
    AssetKind,
    ProcessingStatus
)
from app.schemas import SourceCreate, SourceUpdate, SourceRead
from app.api.global_utils import validate_infospace_access
from app.api.modules.content.handlers import IngestionContext
from app.api.modules.content.ingest import ingest
from app.core.config import settings

logger = logging.getLogger(__name__)

class SourceService:
    """
    Service for managing Source operations and integration with unified asset discovery.
    
    This service provides:
    - Source CRUD operations
    - Integration with AssetDiscoveryService for modern content discovery
    - Legacy Source model support for existing workflows
    - Source status tracking and monitoring
    """
    
    def __init__(self, session: Session):
        self.session = session
        logger.info("SourceService initialized")
    
    # ─────────────── SOURCE CRUD OPERATIONS ─────────────── #
    
    def create_source(
        self,
        user_id: int,
        infospace_id: int,
        source_in: SourceCreate
    ) -> Source:
        """
        Create a new Source.
        
        Args:
            user_id: User creating the source
            infospace_id: Target infospace
            source_in: Source creation data
            
        Returns:
            Created Source object
        """
        logger.info(f"Creating source '{source_in.name}' in infospace {infospace_id}")
        
        # Validate access
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Create source
        source_data = source_in.model_dump()
        source = Source(
            **source_data,
            infospace_id=infospace_id,
            user_id=user_id,
            status=SourceStatus.PENDING,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source '{source.name}' (ID: {source.id}) created successfully")
        return source

    def ensure_inbox_source(
        self,
        infospace_id: int,
        user_id: int,
        bundle_id: int,
        source_path: str,
        interval_seconds: int = 900,
    ) -> Tuple[Optional[Source], Optional[str], int]:
        """
        Ensure an inbox Source exists for the given directory.
        Creates _inbox/ and README if needed, creates/updates Source record.

        Returns:
            (inbox_source, inbox_path_str, inbox_files_pending)
        """
        from app.api.modules.content.handlers.directory_import_handler import (
            _get_dataset_name_from_path,
        )
        from app.api.modules.content.services.poll_handlers.inbox_poll_handler import (
            prepare_inbox_directory,
            count_inbox_pending_files,
        )

        inbox_dir = prepare_inbox_directory(Path(source_path))
        inbox_path_str = str(inbox_dir)
        dataset_name = _get_dataset_name_from_path(
            source_path, settings.LOCAL_STORAGE_BASE_PATH
        )

        inbox_source = self.session.exec(
            select(Source).where(
                Source.infospace_id == infospace_id,
                Source.kind == "directory_inbox",
                Source.output_bundle_id == bundle_id,
            )
        ).first()

        if not inbox_source:
            inbox_source = Source(
                name=f"Inbox: {dataset_name}",
                kind="directory_inbox",
                details={
                    "inbox_path": inbox_path_str,
                    "dataset_name": dataset_name,
                    "source_path": source_path,
                },
                infospace_id=infospace_id,
                user_id=user_id,
                is_active=True,
                poll_interval_seconds=interval_seconds,
                output_bundle_id=bundle_id,
                next_poll_at=datetime.now(timezone.utc) + timedelta(seconds=interval_seconds),
            )
            self.session.add(inbox_source)
        else:
            inbox_source.is_active = True
            inbox_source.poll_interval_seconds = interval_seconds
            self.session.add(inbox_source)

        # Update details in case source_path changed
        details = dict(inbox_source.details or {})
        details["inbox_path"] = inbox_path_str
        details["dataset_name"] = dataset_name
        details["source_path"] = source_path
        inbox_source.details = details

        inbox_files_pending = count_inbox_pending_files(inbox_dir)
        self.session.commit()
        self.session.refresh(inbox_source)

        return inbox_source, inbox_path_str, inbox_files_pending

    def get_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int
    ) -> Optional[Source]:
        """Get a source by ID with access validation."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        source = self.session.get(Source, source_id)
        if source and source.infospace_id == infospace_id:
            return source
        return None
    
    def list_sources(
        self,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100,
        status_filter: Optional[SourceStatus] = None,
        kind_filter: Optional[str] = None
    ) -> Tuple[List[Source], int]:
        """List sources with optional filtering."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        query = select(Source).where(
            Source.infospace_id == infospace_id,
            Source.user_id == user_id
        )
        
        if status_filter:
            query = query.where(Source.status == status_filter)
        if kind_filter:
            query = query.where(Source.kind == kind_filter)
        
        # Get total count
        count_query = select(func.count(Source.id)).where(
            Source.infospace_id == infospace_id,
            Source.user_id == user_id
        )
        if status_filter:
            count_query = count_query.where(Source.status == status_filter)
        if kind_filter:
            count_query = count_query.where(Source.kind == kind_filter)
        
        total_count = self.session.exec(count_query).one()
        
        # Get paginated results
        query = query.order_by(Source.created_at.desc()).offset(skip).limit(limit)
        sources = list(self.session.exec(query))
        
        return sources, total_count
    
    def update_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        source_update: SourceUpdate
    ) -> Optional[Source]:
        """Update a source."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return None
        
        update_data = source_update.model_dump(exclude_unset=True)
        for field, value in update_data.items():
            setattr(source, field, value)
        
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} updated successfully")
        return source
    
    def delete_source(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int
    ) -> bool:
        """Delete a source and optionally its assets."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False
        
        # Delete associated assets
        assets = self.session.exec(
            select(Asset).where(Asset.source_id == source_id)
        ).all()
        
        for asset in assets:
            self.session.delete(asset)
        
        # Delete source
        self.session.delete(source)
        self.session.commit()
        
        logger.info(f"Source {source_id} and {len(assets)} associated assets deleted")
        return True
    
    # ─────────────── UNIFIED DISCOVERY INTEGRATION ─────────────── #
    
    async def create_source_and_discover_assets(
        self,
        user_id: int,
        infospace_id: int,
        source_in: SourceCreate,
        discovery_options: Optional[Dict[str, Any]] = None,
        processing_options: Optional[Dict[str, Any]] = None,
        bundle_id: Optional[int] = None
    ) -> Tuple[Source, List[Asset]]:
        """
        Create a source and immediately discover assets using the unified discovery service.
        
        This bridges the old Source model with the new unified discovery system.
        """
        logger.info(f"Creating source and discovering assets for '{source_in.name}'")
        
        # Create the source first
        source = self.create_source(user_id, infospace_id, source_in)
        
        try:
            locator = self._extract_locator_from_source(source)
            opts = {**(discovery_options or {}), **(processing_options or {})}

            from app.api.modules.foundation_service_providers.registry import (
                get_storage_provider, get_scraping_provider, get_web_search_provider,
            )
            from app.api.modules.content.services.asset_service import AssetService
            from app.api.modules.content.services.bundle_service import BundleService
            storage = get_storage_provider(settings)
            context = IngestionContext(
                session=self.session,
                storage_provider=storage,
                scraping_provider=get_scraping_provider(settings),
                search_provider=get_web_search_provider(settings),
                asset_service=AssetService(self.session, storage),
                bundle_service=BundleService(self.session),
                user_id=user_id,
                infospace_id=infospace_id,
                settings=settings,
                options=opts,
            )
            assets = await ingest(context, locator, bundle_id=bundle_id, options=opts)
            
            # Link assets to the source
            for asset in assets:
                asset.source_id = source.id
                self.session.add(asset)
            
            # Update source status
            source.status = SourceStatus.COMPLETE
            source.updated_at = datetime.now(timezone.utc)
            
            # Add discovery metadata to source
            if source.source_metadata is None:
                source.source_metadata = {}
            source.source_metadata.update({
                'assets_discovered': len(assets),
                'discovery_method': 'unified_asset_discovery',
                'completed_at': datetime.now(timezone.utc).isoformat()
            })
            
            self.session.add(source)
            self.session.commit()
            
            logger.info(f"Source {source.id} created with {len(assets)} discovered assets")
            return source, assets
            
        except Exception as e:
            logger.error(f"Failed to discover assets for source {source.id}: {e}")
            # Mark source as failed
            source.status = SourceStatus.FAILED
            source.error_message = str(e)
            self.session.add(source)
            self.session.commit()
            raise
    
    def _extract_locator_from_source(self, source: Source) -> Union[str, List[str]]:
        """
        Extracts the primary content locator (e.g., URL, search query) from a Source's details.
        This is the bridge between a stored Source configuration and the AssetDiscoveryService.

        Args:
            source: The Source object.

        Returns:
            A string or list of strings that can be used by the AssetDiscoveryService.

        Raises:
            ValueError: If a suitable locator cannot be found for the source kind.
        """
        details = source.details or {}
        kind = source.kind

        # Define a mapping from source kind to the expected key in the details dict.
        # The order can imply priority if multiple keys could exist.
        KIND_TO_LOCATOR_KEY_MAP = {
            "rss_feed": "feed_url",
            "rss": "feed_url",  # Alternative RSS source kind
            "url_monitor": "urls",
            "site_discovery": "base_url",
            "url_list": "urls",
            "url_list_scrape": "urls", # Legacy compatibility
            "upload_csv": "storage_path",
            "upload_pdf": "storage_path",
            "text_block_ingest": "text_content",
            "search": "search_config", # Special case, returns a dict
            "search_monitor": "search_config" # Special case, returns a dict
        }

        locator_key = KIND_TO_LOCATOR_KEY_MAP.get(kind)

        if not locator_key:
            raise ValueError(f"Unknown or unhandled source kind '{kind}' for locator extraction.")

        locator = details.get(locator_key)

        if kind in ["search", "search_monitor"]:
            if isinstance(locator, dict) and "query" in locator:
                # For search kinds, the locator is the query string itself.
                return locator["query"]
            else:
                raise ValueError(f"Source kind '{kind}' requires a 'search_config' dict with a 'query' key in details.")

        if locator is None:
            # Fallback for legacy or misconfigured sources
            for fallback_key in ["url", "urls", "query", "feed_url", "base_url", "text_content"]:
                if fallback_key in details:
                    logger.warning(f"Source {source.id} (kind: {kind}) is missing primary locator key '{locator_key}'. Using fallback '{fallback_key}'.")
                    return details[fallback_key]
            raise ValueError(f"Could not find a valid locator for source {source.id} (kind: {kind}) using key '{locator_key}'. Details are missing the required field.")

        # Basic type validation
        if kind in ["url_list", "url_monitor", "url_list_scrape"] and not isinstance(locator, list):
            raise ValueError(f"Source kind '{kind}' expects the locator '{locator_key}' to be a list of strings.")
        if kind in ["rss_feed", "site_discovery", "upload_csv", "upload_pdf", "text_block_ingest"] and not isinstance(locator, str):
            raise ValueError(f"Source kind '{kind}' expects the locator '{locator_key}' to be a string.")

        return locator
    
    # ─────────────── LEGACY PROCESSING SUPPORT ─────────────── #
    
    def trigger_source_processing(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        override_details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """
        Trigger legacy source processing via Celery task.
        
        This maintains compatibility with existing Source-based workflows.
        """
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False
        
        try:
            # Store overrides in source.details before dispatching
            if override_details:
                source.details = {**(source.details or {}), **override_details}

            source.status = SourceStatus.PENDING
            source.updated_at = datetime.now(timezone.utc)
            self.session.add(source)
            self.session.commit()

            from app.api.modules.content.tasks.ingest import process_source
            process_source.delay([source.id], source.infospace_id)

            logger.info(f"Triggered source processing for source {source_id}")
            return True

        except Exception as e:
            logger.error(f"Failed to trigger processing for source {source_id}: {e}")
            return False
    
    # ─────────────── SOURCE ANALYTICS ─────────────── #
    
    def get_source_stats(
        self,
        user_id: int,
        infospace_id: int
    ) -> Dict[str, Any]:
        """Get statistics about sources in an infospace."""
        validate_infospace_access(self.session, infospace_id, user_id)
        
        # Total sources
        total_sources = self.session.exec(
            select(func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            )
        ).one()
        
        # Sources by status
        status_counts = self.session.exec(
            select(Source.status, func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            ).group_by(Source.status)
        ).all()
        
        # Sources by kind
        kind_counts = self.session.exec(
            select(Source.kind, func.count(Source.id)).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            ).group_by(Source.kind)
        ).all()
        
        # Total assets from sources
        total_assets = self.session.exec(
            select(func.count(Asset.id)).join(Source).where(
                Source.infospace_id == infospace_id,
                Source.user_id == user_id
            )
        ).one()
        
        return {
            "total_sources": total_sources,
            "total_assets_from_sources": total_assets,
            "status_counts": dict(status_counts),
            "kind_counts": dict(kind_counts)
        }
    
    def get_source_assets(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        skip: int = 0,
        limit: int = 100
    ) -> List[Asset]:
        """Get assets associated with a source."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return []
        
        query = (
            select(Asset)
            .where(Asset.source_id == source_id)
            .order_by(Asset.created_at.desc())
            .offset(skip)
            .limit(limit)
        )
        
        return list(self.session.exec(query))
    
    # ─────────────── UTILITY METHODS ─────────────── #
    
    def get_supported_source_kinds(self) -> List[str]:
        """Get list of supported source kinds from PollHandler registry."""
        from app.api.modules.content.services.poll_handlers import registered_poll_kinds
        return list(registered_poll_kinds())
    
    def validate_source_details(self, kind: str, details: Dict[str, Any]) -> bool:
        """Validate source details for a given kind."""
        try:
            if kind == "url_list":
                return "urls" in details and isinstance(details["urls"], list)
            elif kind in ["rss_feed", "rss"]:
                return "feed_url" in details and isinstance(details["feed_url"], str)
            elif kind == "search":
                return "search_config" in details and "query" in details["search_config"]
            elif kind == "url_monitor":
                return "urls" in details and isinstance(details["urls"], list)
            elif kind == "site_discovery":
                return "base_url" in details and isinstance(details["base_url"], str)
            elif kind == "text_block_ingest":
                return "text_content" in details and isinstance(details["text_content"], str)
            elif kind in ["upload_csv", "upload_pdf"]:
                return "storage_path" in details and isinstance(details["storage_path"], str)
            else:
                return False
        except Exception:
            return False
    
    # ─────────────── STREAMING OPERATIONS ─────────────── #
    # Merged from StreamSourceService for unified source management
    
    def activate_stream(self, source_id: int, user_id: int) -> Source:
        """
        Activate a source stream - enable polling.
        
        Args:
            source_id: Source to activate
            user_id: User performing action
            
        Returns:
            Updated Source
        """
        from datetime import timedelta
        
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        validate_infospace_access(self.session, source.infospace_id, user_id)
        
        source.is_active = True
        source.status = SourceStatus.PENDING  # Will be ACTIVE after first poll
        
        # Calculate next poll time
        if source.poll_interval_seconds:
            source.next_poll_at = datetime.now(timezone.utc) + timedelta(
                seconds=source.poll_interval_seconds
            )
        
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} stream activated")
        return source
    
    def pause_stream(self, source_id: int, user_id: int) -> Source:
        """
        Pause a source stream - disable polling.
        
        Args:
            source_id: Source to pause
            user_id: User performing action
            
        Returns:
            Updated Source
        """
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        validate_infospace_access(self.session, source.infospace_id, user_id)
        
        source.is_active = False
        source.status = SourceStatus.PAUSED
        source.next_poll_at = None
        source.updated_at = datetime.now(timezone.utc)
        
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} stream paused")
        return source
    
    async def execute_poll(
        self,
        source_id: int,
        user_id: Optional[int] = None,
        runtime_api_keys: Optional[Dict[str, str]] = None
    ) -> Dict[str, Any]:
        """
        Execute a single poll of a source.
        
        Polling is dispatched via the PollHandler registry (poll_handlers/).
        This method is generic — it never branches on source.kind.
        """
        from app.models import (
            SourcePollHistory,
            IngestionJob,
            IngestionStatus,
            Bundle,
        )
        from app.api.modules.content.services.bundle_service import BundleService
        from app.api.modules.content.services.asset_service import AssetService
        from app.api.modules.content.services.poll_handlers import (
            get_poll_handler,
            registered_poll_kinds,
            PollResult,
        )
        from app.api.modules.foundation_service_providers.registry import (
            get_storage_provider,
            get_scraping_provider,
            get_web_search_provider,
        )

        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")

        handler_cls = get_poll_handler(source.kind)
        if handler_cls is None:
            raise ValueError(
                f"No poll handler registered for source kind '{source.kind}'. "
                f"Registered kinds: {list(registered_poll_kinds())}"
            )

        storage_provider = get_storage_provider(settings)
        scraping_provider = get_scraping_provider(settings)
        try:
            search_provider = get_web_search_provider(settings)
        except Exception as e:
            logger.warning("Search provider init failed: %s", e)
            search_provider = None
        bundle_service = BundleService(self.session)
        asset_service = AssetService(self.session, storage_provider)
        context = IngestionContext(
            session=self.session,
            storage_provider=storage_provider,
            scraping_provider=scraping_provider,
            search_provider=search_provider,
            asset_service=asset_service,
            bundle_service=bundle_service,
            user_id=source.user_id,
            infospace_id=source.infospace_id,
            settings=settings,
            options=source.details.get("processing_options", {}).copy(),
        )
        context.options["cursor_state"] = source.cursor_state

        job = IngestionJob(
            infospace_id=source.infospace_id,
            user_id=source.user_id,
            source_locator=(
                source.details.get("feed_url")
                or (source.details.get("search_config") or {}).get("query")
                or source.details.get("inbox_path")
                or source.details.get("source_path")
                or str(source.id)
            ),
            kind=f"source_poll:{source.kind}",
            source_id=source.id,
            status=IngestionStatus.PROCESSING,
            started_at=datetime.now(timezone.utc),
        )
        self.session.add(job)
        poll_history = SourcePollHistory(
            source_id=source_id,
            started_at=datetime.now(timezone.utc),
            status="processing",
            cursor_before=source.cursor_state.copy(),
        )
        self.session.add(poll_history)
        source.status = SourceStatus.PROCESSING
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()

        try:
            handler = handler_cls()
            result: PollResult = await handler.poll(
                source=source,
                context=context,
                runtime_options={"runtime_api_keys": runtime_api_keys or {}},
            )
            ingested_count = 0
            for asset in result.assets:
                asset.source_id = source.id
                if source.output_bundle_id:
                    asset.bundle_id = source.output_bundle_id
                    bundle = self.session.get(Bundle, source.output_bundle_id)
                    if bundle:
                        bundle.asset_count = (bundle.asset_count or 0) + 1
                        bundle.updated_at = datetime.now(timezone.utc)
                        self.session.add(bundle)
                self.session.add(asset)
                ingested_count += 1

            source.cursor_state.update(result.cursor_update)
            source.items_last_poll = len(result.assets)
            source.total_items_ingested += ingested_count
            source.last_poll_at = datetime.now(timezone.utc)
            if source.poll_interval_seconds:
                source.next_poll_at = datetime.now(timezone.utc) + timedelta(
                    seconds=source.poll_interval_seconds
                )
            source.consecutive_failures = 0
            source.status = SourceStatus.PENDING
            job.status = IngestionStatus.COMPLETED
            job.processed_files = ingested_count
            job.completed_at = datetime.now(timezone.utc)
            job.cursor_state = {
                "summary": result.summary,
                "stage": "completed",
                "progress_pct": 100,
            }
            poll_history.completed_at = datetime.now(timezone.utc)
            poll_history.status = "success"
            poll_history.items_found = len(result.assets)
            poll_history.items_ingested = ingested_count
            poll_history.cursor_after = source.cursor_state.copy()
            self.session.add(source)
            self.session.add(job)
            self.session.add(poll_history)
            self.session.commit()

            for action in result.post_commit_actions:
                try:
                    action()
                except Exception as post_err:
                    logger.warning("Post-commit action failed: %s", post_err)
            logger.info(
                "Source %s poll completed: %d items ingested (%s)",
                source_id, ingested_count, result.summary,
            )
            new_asset_ids = [a.id for a in result.assets]
            return {
                "status": "success",
                "items_found": len(result.assets),
                "items_ingested": ingested_count,
                "job_id": job.id,
                "new_asset_ids": new_asset_ids,
            }
        except Exception as e:
            source.status = SourceStatus.FAILED
            source.consecutive_failures += 1
            source.last_error_at = datetime.now(timezone.utc)
            source.error_message = str(e)
            job.status = IngestionStatus.FAILED
            job.error_message = str(e)[:500]
            job.completed_at = datetime.now(timezone.utc)
            poll_history.completed_at = datetime.now(timezone.utc)
            poll_history.status = "failed"
            poll_history.error_message = str(e)
            self.session.add(source)
            self.session.add(job)
            self.session.add(poll_history)
            self.session.commit()
            logger.error("Source %s poll failed: %s", source_id, e)
            raise
    
    def get_stream_stats(self, source_id: int, user_id: int, infospace_id: int) -> Dict[str, Any]:
        """
        Get streaming statistics for a source.
        
        Args:
            source_id: Source ID
            user_id: User requesting stats
            infospace_id: Infospace context
            
        Returns:
            Statistics dictionary
        """
        from datetime import timedelta
        from app.models import SourcePollHistory
        
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        # Get recent poll history
        recent_polls = self.session.exec(
            select(SourcePollHistory)
            .where(SourcePollHistory.source_id == source_id)
            .order_by(SourcePollHistory.started_at.desc())
            .limit(24)
        ).all()
        
        # Calculate items per hour (last 24 hours)
        now = datetime.now(timezone.utc)
        last_24h = now - timedelta(hours=24)
        
        recent_items = sum(
            poll.items_ingested
            for poll in recent_polls
            if poll.started_at >= last_24h and poll.status == "success"
        )
        
        return {
            "source_id": source_id,
            "is_active": source.is_active,
            "status": source.status.value if source.status else None,
            "total_items_ingested": source.total_items_ingested,
            "items_last_poll": source.items_last_poll,
            "items_per_hour_24h": recent_items,
            "last_poll_at": source.last_poll_at.isoformat() if source.last_poll_at else None,
            "next_poll_at": source.next_poll_at.isoformat() if source.next_poll_at else None,
            "consecutive_failures": source.consecutive_failures,
            "stream_health": "failing" if source.consecutive_failures >= 3 else (
                "degraded" if source.consecutive_failures >= 1 else "healthy"
            ),
        }
    
    def get_poll_history(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        limit: int = 50
    ) -> List[Dict[str, Any]]:
        """
        Get poll history for a source.
        
        Args:
            source_id: Source ID
            user_id: User requesting history
            infospace_id: Infospace context
            limit: Max records to return
            
        Returns:
            List of poll history records
        """
        from app.models import SourcePollHistory
        
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        polls = self.session.exec(
            select(SourcePollHistory)
            .where(SourcePollHistory.source_id == source_id)
            .order_by(SourcePollHistory.started_at.desc())
            .limit(limit)
        ).all()
        
        return [
            {
                "id": poll.id,
                "started_at": poll.started_at.isoformat() if poll.started_at else None,
                "completed_at": poll.completed_at.isoformat() if poll.completed_at else None,
                "status": poll.status,
                "items_found": poll.items_found,
                "items_ingested": poll.items_ingested,
                "error_message": poll.error_message,
                "triggered_pipeline": poll.triggered_pipeline,
            }
            for poll in polls
        ]