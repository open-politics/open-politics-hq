"""
Stream Source Service
====================

Service for managing source streaming behavior - polling, state tracking,
and pipeline triggering for continuous data ingestion.
"""

import logging
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
from sqlmodel import Session, select

from app.models import (
    Source,
    SourceStatus,
    SourcePollHistory,
    Asset,
    Bundle,
    Flow,
    FlowStatus,
)
from app.api.services.service_utils import validate_infospace_access
from app.api.handlers import RSSHandler, SearchHandler
from app.api.services.bundle_service import BundleService

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
        self.bundle_service = bundle_service
        
        logger.info("StreamSourceService initialized")
    
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
    
    async def execute_poll(self, source_id: int, user_id: Optional[int] = None, runtime_api_keys: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
        """
        Execute a single poll of a source.
        
        Flow:
        1. Set status = PROCESSING
        2. Load cursor_state for incremental fetch
        3. Call appropriate handler with cursor
        4. Create assets, set asset.source_id and asset.bundle_id
        5. Update cursor_state
        6. Record SourcePollHistory
        7. Set status = ACTIVE or ERROR
        
        Note: Flow triggering is handled by check_on_arrival_flows Celery task.
        
        Args:
            source_id: Source to poll
            
        Returns:
            Poll result with statistics
        """
        source = self.session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        
        # Create poll history record
        poll_history = SourcePollHistory(
            source_id=source_id,
            started_at=datetime.now(timezone.utc),
            status="processing",
            cursor_before=source.cursor_state.copy(),
        )
        self.session.add(poll_history)
        
        # Set status to processing
        source.status = SourceStatus.PROCESSING
        source.updated_at = datetime.now(timezone.utc)
        self.session.add(source)
        self.session.commit()
        
        try:
            # Prepare options with cursor state
            options = source.details.get('processing_options', {}).copy()
            options['cursor_state'] = source.cursor_state
            
            # Route to appropriate handler based on source kind
            assets: List[Asset] = []
            
            if source.kind == 'rss':
                feed_url = source.details.get('feed_url')
                if not feed_url:
                    raise ValueError("RSS source missing feed_url")
                
                handler = RSSHandler(self.session)
                assets = await handler.handle(
                    feed_url=feed_url,
                    infospace_id=source.infospace_id,
                    user_id=source.user_id,
                    options=options
                )
                
                # Update cursor state for RSS (store last seen GUID)
                if assets:
                    # Use the last entry's GUID or link as cursor
                    last_entry = assets[-1]
                    source.cursor_state['last_guid'] = last_entry.source_metadata.get('guid') or last_entry.source_identifier
                    source.cursor_state['last_poll_timestamp'] = datetime.now(timezone.utc).isoformat()
            
            elif source.kind == 'search':
                search_config = source.details.get('search_config', {})
                if not search_config:
                    raise ValueError("Search source missing search_config")
                
                query = search_config.get('query')
                if not query:
                    raise ValueError("Search config missing query")
                
                provider = search_config.get('provider', 'tavily')
                max_results = search_config.get('max_results', 10)
                
                # For search, use timestamp-based cursor to avoid duplicates
                cursor_timestamp = source.cursor_state.get('last_query_timestamp')
                
                # Import search provider registry
                from app.api.providers.search_registry import SearchProviderRegistryService
                from app.api.services.content_ingestion_service import ContentIngestionService
                from app.api.handlers.search_handler import SearchHandler
                
                # Create search provider
                search_registry = SearchProviderRegistryService()
                
                # Get API key from multiple sources (priority order):
                # 1. Runtime API keys passed to method (from user credentials)
                # 2. Source config API key (if stored directly)
                # 3. Environment variable (fallback)
                api_key = None
                if runtime_api_keys:
                    # Try provider name first (e.g., 'tavily')
                    api_key = runtime_api_keys.get(provider)
                    # Try uppercase version (e.g., 'TAVILY_API_KEY')
                    if not api_key:
                        api_key = runtime_api_keys.get(f'{provider.upper()}_API_KEY') or runtime_api_keys.get(f'TAVILY_API_KEY')
                
                # Fall back to source config
                if not api_key:
                    api_key = search_config.get('api_key')
                
                # Fall back to environment variable
                if not api_key and provider == 'tavily':
                    from app.core.config import settings
                    api_key = settings.TAVILY_API_KEY
                
                search_provider = search_registry.create_provider(provider, api_key)
                
                # Execute search query
                logger.info(f"Executing search query: '{query}' with provider {provider}")
                search_results_raw = await search_provider.search(
                    query=query,
                    limit=max_results,
                    **search_config.get('provider_params', {})
                )
                
                # Get seen URLs from cursor to avoid duplicates
                seen_urls = set(source.cursor_state.get('seen_urls', []))
                
                # Convert raw search results to SearchResult objects and filter duplicates
                from app.schemas import SearchResult
                search_results: List[SearchResult] = []
                new_urls = []
                
                for result_dict in search_results_raw:
                    url = result_dict.get('url') or result_dict.get('link') or result_dict.get('href')
                    if not url:
                        continue
                    
                    # Skip if we've already seen this URL
                    if url in seen_urls:
                        logger.debug(f"Skipping duplicate URL: {url}")
                        continue
                    
                    # Create SearchResult object
                    search_result = SearchResult(
                        title=result_dict.get('title', 'Untitled'),
                        url=url,
                        content=result_dict.get('content') or result_dict.get('snippet') or result_dict.get('description') or '',
                        score=result_dict.get('score') or result_dict.get('relevance_score'),
                        provider=provider,
                        raw_data=result_dict
                    )
                    search_results.append(search_result)
                    new_urls.append(url)
                
                # Update seen URLs
                seen_urls.update(new_urls)
                source.cursor_state['seen_urls'] = list(seen_urls)  # Store as list for JSON serialization
                
                # Convert search results to assets using SearchHandler
                if search_results:
                    search_handler = SearchHandler(self.session)
                    assets = await search_handler.handle_bulk(
                        results=search_results,
                        query=query,
                        infospace_id=source.infospace_id,
                        user_id=source.user_id,
                        options={
                            'scrape_content': search_config.get('scrape_content', True),
                            'cursor_state': source.cursor_state,
                        }
                    )
                else:
                    assets = []
                    logger.info(f"No new search results found for query '{query}'")
                
                # Update cursor timestamp
                source.cursor_state['last_query_timestamp'] = datetime.now(timezone.utc).isoformat()
                source.cursor_state['last_query'] = query
            
            else:
                raise ValueError(f"Source kind '{source.kind}' does not support streaming")
            
            # Link assets to source and output bundle
            ingested_count = 0
            for asset in assets:
                asset.source_id = source.id
                
                # Add to output bundle if configured
                if source.output_bundle_id:
                    asset.bundle_id = source.output_bundle_id
                    # Update bundle asset count
                    bundle = self.session.get(Bundle, source.output_bundle_id)
                    if bundle:
                        bundle.asset_count = (bundle.asset_count or 0) + 1
                        bundle.updated_at = datetime.now(timezone.utc)
                        self.session.add(bundle)
                
                self.session.add(asset)
                ingested_count += 1
            
            # Update source statistics
            source.items_last_poll = len(assets)
            source.total_items_ingested += ingested_count
            source.last_poll_at = datetime.now(timezone.utc)
            
            # Calculate next poll time
            if source.poll_interval_seconds:
                source.next_poll_at = datetime.now(timezone.utc) + timedelta(
                    seconds=source.poll_interval_seconds
                )
            
            # Reset failure count on success
            source.consecutive_failures = 0
            # Use PENDING status until migration adds ACTIVE to database enum
            # The is_active flag indicates the stream is actually active
            source.status = SourceStatus.PENDING
            
            # Update poll history
            poll_history.completed_at = datetime.now(timezone.utc)
            poll_history.status = "success"
            poll_history.items_found = len(assets)
            poll_history.items_ingested = ingested_count
            poll_history.cursor_after = source.cursor_state.copy()
            
            # Note: Flow triggering is handled by check_on_arrival_flows Celery task
            # which runs every minute and triggers any Flows watching this source's output bundle.
            
            self.session.add(source)
            self.session.add(poll_history)
            self.session.commit()
            
            logger.info(
                f"Source {source_id} poll completed: {ingested_count} items ingested"
            )
            
            return {
                "status": "success",
                "items_found": len(assets),
                "items_ingested": ingested_count,
            }
            
        except Exception as e:
            # Handle error - use FAILED since ERROR doesn't exist in DB enum yet
            source.status = SourceStatus.FAILED
            source.consecutive_failures += 1
            source.last_error_at = datetime.now(timezone.utc)
            source.error_message = str(e)
            
            poll_history.completed_at = datetime.now(timezone.utc)
            poll_history.status = "failed"
            poll_history.error_message = str(e)
            
            self.session.add(source)
            self.session.add(poll_history)
            self.session.commit()
            
            logger.error(f"Source {source_id} poll failed: {e}")
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
        from sqlmodel import select
        from app.models import FlowInputType
        from app.api.services.flow_service import FlowService
        
        # Find active Flows watching this source
        flows = self.session.exec(
            select(Flow).where(
                Flow.input_type == FlowInputType.STREAM,
                Flow.input_source_id == source.id,
                Flow.status == FlowStatus.ACTIVE,
            )
        ).all()
        
        if not flows:
            return []
        
        execution_ids = []
        flow_service = FlowService(self.session)
        
        for flow in flows:
            try:
                execution = flow_service.trigger_execution(
                    flow_id=flow.id,
                    user_id=flow.user_id,
                    infospace_id=flow.infospace_id,
                    triggered_by="source_poll",
                    triggered_by_source_id=source.id,
                )
                execution_ids.append(execution.id)
                logger.info(f"Triggered Flow {flow.id} for source {source.id}")
            except Exception as e:
                logger.error(f"Failed to trigger Flow {flow.id}: {e}")
        
        return execution_ids
    
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


