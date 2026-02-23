"""
Stream Source Service
====================

Service for managing source streaming behavior - polling, state tracking,
and pipeline triggering for continuous data ingestion.

Polling is dispatched via the PollHandler registry (see poll_handlers/).
Each Source kind has a registered handler; execute_poll() is generic.
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select

from app.models import (
    Source,
    SourceStatus,
    SourcePollHistory,
    IngestionJob,
    IngestionStatus,
    Asset,
    Bundle,
)
from app.api.global_utils import validate_infospace_access
from app.api.modules.content.handlers.base import IngestionContext
from app.api.modules.content.services.bundle_service import BundleService
from app.api.modules.content.services.asset_service import AssetService
from app.api.modules.content.services.poll_handlers import (
    get_poll_handler,
    registered_poll_kinds,
    PollResult,
)
from app.api.modules.foundation_service_providers.factory import (
    create_storage_provider,
    create_scraping_provider,
    create_web_search_provider,
)
from app.core.config import settings

logger = logging.getLogger(__name__)


class StreamSourceService:
    """
    Service for managing source streaming operations.
    
    Handles:
    - Stream activation/pausing
    - Polling with cursor state management
    - Asset creation and bundle routing
    - Pipeline triggering
    - Statistics tracking
    """
    
    def __init__(
        self,
        session: Session,
        bundle_service: Optional[BundleService] = None,
    ):
        self.session = session
        self.bundle_service = bundle_service or BundleService(session)
        self.storage_provider = create_storage_provider(settings)
        self.scraping_provider = create_scraping_provider(settings)
        try:
            self.search_provider = create_web_search_provider(settings)
        except Exception as e:
            logger.warning(f"Search provider init failed: {e}")
            self.search_provider = None
        self.asset_service = AssetService(session, self.storage_provider)

        logger.info("StreamSourceService initialized")

    def _make_ingestion_context(
        self, user_id: int, infospace_id: int, options: Optional[Dict] = None
    ) -> IngestionContext:
        return IngestionContext(
            session=self.session,
            storage_provider=self.storage_provider,
            scraping_provider=self.scraping_provider,
            search_provider=self.search_provider,
            asset_service=self.asset_service,
            bundle_service=self.bundle_service,
            user_id=user_id,
            infospace_id=infospace_id,
            settings=settings,
            options=options or {},
        )
    
    def activate_stream(self, source_id: int, user_id: int) -> Source:
        """
        Activate a source stream - enable polling.
        
        Args:
            source_id: Source to activate
            user_id: User performing action
            
        Returns:
            Updated Source
        """
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        validate_infospace_access(self.session, source.infospace_id, user_id)
        
        source.is_active = True
        # Use PENDING status until migration adds ACTIVE to database enum
        # The is_active flag indicates the stream is actually active
        source.status = SourceStatus.PENDING
        
        # Calculate next poll time
        if source.poll_interval_seconds:
            source.next_poll_at = datetime.now(timezone.utc) + timedelta(
                seconds=source.poll_interval_seconds
            )
        
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} activated")
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
        # Use PENDING status until migration adds PAUSED to database enum
        # The is_active=False flag indicates the stream is paused
        source.status = SourceStatus.PENDING
        source.next_poll_at = None
        source.updated_at = datetime.now(timezone.utc)
        
        self.session.add(source)
        self.session.commit()
        self.session.refresh(source)
        
        logger.info(f"Source {source_id} paused")
        return source
    
    async def execute_poll(
        self,
        source_id: int,
        user_id: Optional[int] = None,
        runtime_api_keys: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """
        Execute a single poll of a source.

        Routing is handled by the PollHandler registry (poll_handlers/).
        This method is generic — it never needs to change when new source
        kinds are added.

        Flow:
        1. Look up registered PollHandler for source.kind
        2. Set status = PROCESSING, create IngestionJob as execution log
        3. Delegate to handler.poll()
        4. Link returned assets to source and bundle
        5. Update cursor_state, statistics, IngestionJob
        6. Record SourcePollHistory (kept for backward compat; IngestionJob
           is the canonical execution log going forward)

        Note: Flow triggering is handled by check_on_arrival_flows Celery task.
        """
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")

        handler_cls = get_poll_handler(source.kind)
        if handler_cls is None:
            raise ValueError(
                f"No poll handler registered for source kind '{source.kind}'. "
                f"Registered kinds: {registered_poll_kinds()}"
            )

        # --- execution log (IngestionJob) ---
        job = IngestionJob(
            infospace_id=source.infospace_id,
            user_id=source.user_id,
            source_locator=source.details.get("feed_url")
                or source.details.get("search_config", {}).get("query")
                or source.details.get("inbox_path")
                or source.details.get("source_path")
                or str(source.id),
            kind=f"source_poll:{source.kind}",
            source_id=source.id,
            status=IngestionStatus.PROCESSING,
            started_at=datetime.now(timezone.utc),
        )
        self.session.add(job)

        # --- legacy poll history (backward compat) ---
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
            # Build context and delegate to handler
            options = source.details.get("processing_options", {}).copy()
            options["cursor_state"] = source.cursor_state
            context = self._make_ingestion_context(
                source.user_id, source.infospace_id, options
            )

            handler = handler_cls()
            result: PollResult = await handler.poll(
                source=source,
                context=context,
                runtime_options={"runtime_api_keys": runtime_api_keys or {}},
            )

            # --- link assets to source & bundle ---
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

            # --- update source ---
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

            # --- update IngestionJob ---
            job.status = IngestionStatus.COMPLETED
            job.processed_files = ingested_count
            job.completed_at = datetime.now(timezone.utc)
            job.cursor_state = {
                "summary": result.summary,
                "stage": "completed",
                "progress_pct": 100,
            }

            # --- update legacy poll history ---
            poll_history.completed_at = datetime.now(timezone.utc)
            poll_history.status = "success"
            poll_history.items_found = len(result.assets)
            poll_history.items_ingested = ingested_count
            poll_history.cursor_after = source.cursor_state.copy()

            self.session.add(source)
            self.session.add(job)
            self.session.add(poll_history)
            self.session.commit()

            # Run post-commit actions (e.g. move inbox files to _processed).
            # These run AFTER the DB commit so that on failure the files remain
            # in the inbox for rediscovery on the next poll.
            for action in result.post_commit_actions:
                try:
                    action()
                except Exception as post_err:
                    logger.warning("Post-commit action failed: %s", post_err)

            logger.info(
                "Source %s poll completed: %d items ingested (%s)",
                source_id,
                ingested_count,
                result.summary,
            )

            return {
                "status": "success",
                "items_found": len(result.assets),
                "items_ingested": ingested_count,
                "job_id": job.id,
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
    
    async def _trigger_linked_flows(
        self, source: Source, asset_ids: List[int]
    ) -> List[int]:
        """
        Trigger any Flows watching this source.
        
        Note: This is a legacy helper. The preferred approach is to use
        Flow.trigger_mode=on_arrival which is handled by check_on_arrival_flows.
        
        Args:
            source: Source that was polled
            asset_ids: Asset IDs from the poll
            
        Returns:
            List of FlowExecution IDs created
        """
        from app.core.celery_app import celery

        # Dispatch to flow domain via Celery task to avoid Content -> Flow layer violation
        celery.send_task(
            "trigger_flows_for_source_poll",
            args=[source.id, asset_ids],
        )
        return []
    
    def get_stream_stats(self, source_id: int) -> Dict[str, Any]:
        """
        Get stream statistics for a source.
        
        Args:
            source_id: Source ID
            
        Returns:
            Statistics dictionary
        """
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        # Get recent poll history
        recent_polls = self.session.exec(
            select(SourcePollHistory)
            .where(SourcePollHistory.source_id == source_id)
            .order_by(SourcePollHistory.started_at.desc())
            .limit(24)  # Last 24 polls
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
            "status": source.status.value,
            "total_items_ingested": source.total_items_ingested,
            "items_last_poll": source.items_last_poll,
            "items_per_hour_24h": recent_items,  # Simplified - would calculate properly
            "last_poll_at": source.last_poll_at.isoformat() if source.last_poll_at else None,
            "next_poll_at": source.next_poll_at.isoformat() if source.next_poll_at else None,
            "consecutive_failures": source.consecutive_failures,
            "stream_health": "failing" if source.consecutive_failures >= 3 else (
                "degraded" if source.consecutive_failures >= 1 else "healthy"
            ),
        }


