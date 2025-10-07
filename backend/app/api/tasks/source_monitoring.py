"""
Enhanced source monitoring and RSS ingestion tasks.

This module provides Celery tasks for regular monitoring of news sources,
RSS feeds, and automated content ingestion using the newspaper4k-enhanced
scraping capabilities.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone, timedelta
from celery import current_app as celery_app

from app.core.celery_app import celery_app
from app.core.db import SessionLocal
from app.models import Source, Asset, SourceStatus, AssetKind
from app.api.services.content_ingestion_service import ContentIngestionService
from app.api.services.source_service import SourceService
from app.api.providers.factory import create_scraping_provider, create_storage_provider
from app.core.config import settings

logger = logging.getLogger(__name__)


@celery_app.task(bind=True, max_retries=3)
def monitor_rss_source(self, source_id: int, override_options: Optional[Dict[str, Any]] = None):
    """
    Monitor an RSS source for new content and ingest new items.
    
    Args:
        source_id: ID of the RSS source to monitor
        override_options: Optional configuration overrides
    """
    logger.info(f"Starting RSS source monitoring for source {source_id}")
    
    with SessionLocal() as session:
        try:
            # Get source
            source = session.get(Source, source_id)
            if not source:
                logger.error(f"Source {source_id} not found")
                return {"error": f"Source {source_id} not found"}
            
            if source.kind != "rss_feed":
                logger.error(f"Source {source_id} is not an RSS feed (kind: {source.kind})")
                return {"error": f"Source {source_id} is not an RSS feed"}
            
            # Initialize services
            content_ingestion_service = ContentIngestionService(session)
            
            # Get RSS feed URL from source details
            feed_url = source.details.get('feed_url')
            if not feed_url:
                logger.error(f"RSS source {source_id} has no feed_url in details")
                return {"error": "No feed_url found in source details"}
            
            # Determine lookback period for new content
            lookback_hours = override_options.get('lookback_hours', 24) if override_options else 24
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
            
            # Check when we last processed this source
            last_processed = source.source_metadata.get('last_processed_at')
            if last_processed:
                try:
                    last_processed_dt = datetime.fromisoformat(last_processed.replace('Z', '+00:00'))
                    cutoff_time = max(cutoff_time, last_processed_dt)
                except Exception as e:
                    logger.warning(f"Could not parse last_processed_at for source {source_id}: {e}")
            
            # Configure ingestion options
            # NOTE: scrape_full_content defaults to False because RSS feeds include
            # full content in <content:encoded> - no need to scrape!
            ingestion_options = {
                'max_items': override_options.get('max_items', 50) if override_options else 50,
                'scrape_full_content': override_options.get('scrape_full_content', False) if override_options else False,
                'use_bulk_scraping': override_options.get('use_bulk_scraping', True) if override_options else True,
                'create_image_assets': override_options.get('create_image_assets', True) if override_options else True,
                'max_threads': override_options.get('max_threads', 4) if override_options else 4,
                'cutoff_time': cutoff_time.isoformat(),
                'monitoring_run': True
            }
            
            # Update source status
            source.status = SourceStatus.PROCESSING
            source.source_metadata = source.source_metadata or {}
            source.source_metadata.update({
                'monitoring_started_at': datetime.now(timezone.utc).isoformat(),
                'monitoring_task_id': self.request.id
            })
            session.add(source)
            session.commit()
            
            # Process RSS feed
            assets = await content_ingestion_service._handle_rss_feed(
                feed_url=feed_url,
                infospace_id=source.infospace_id,
                user_id=source.user_id,
                options=ingestion_options
            )
            
            # Filter for new assets only (those created after cutoff_time)
            new_assets = []
            for asset in assets:
                if asset.created_at >= cutoff_time:
                    new_assets.append(asset)
                    # Link asset to source
                    asset.source_id = source.id
                    session.add(asset)
            
            # Update source metadata
            source.status = SourceStatus.COMPLETE
            source.source_metadata.update({
                'last_processed_at': datetime.now(timezone.utc).isoformat(),
                'last_monitoring_result': {
                    'total_assets_found': len(assets),
                    'new_assets_created': len(new_assets),
                    'cutoff_time': cutoff_time.isoformat(),
                    'processing_options': ingestion_options
                },
                'monitoring_completed_at': datetime.now(timezone.utc).isoformat()
            })
            source.updated_at = datetime.now(timezone.utc)
            session.add(source)
            session.commit()
            
            logger.info(f"RSS monitoring completed for source {source_id}: {len(new_assets)} new assets created")
            
            return {
                'source_id': source_id,
                'feed_url': feed_url,
                'total_assets_found': len(assets),
                'new_assets_created': len(new_assets),
                'new_asset_ids': [asset.id for asset in new_assets],
                'cutoff_time': cutoff_time.isoformat(),
                'completed_at': datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"RSS monitoring failed for source {source_id}: {e}", exc_info=True)
            
            # Update source with error status
            try:
                source = session.get(Source, source_id)
                if source:
                    source.status = SourceStatus.FAILED
                    source.error_message = str(e)
                    source.source_metadata = source.source_metadata or {}
                    source.source_metadata.update({
                        'monitoring_failed_at': datetime.now(timezone.utc).isoformat(),
                        'monitoring_error': str(e)
                    })
                    session.add(source)
                    session.commit()
            except Exception as update_error:
                logger.error(f"Failed to update source status after error: {update_error}")
            
            # Retry with exponential backoff
            if self.request.retries < self.max_retries:
                retry_delay = 60 * (2 ** self.request.retries)  # 60s, 120s, 240s
                logger.info(f"Retrying RSS monitoring for source {source_id} in {retry_delay} seconds")
                raise self.retry(countdown=retry_delay, exc=e)
            
            return {"error": str(e), "source_id": source_id}


@celery_app.task(bind=True, max_retries=3)
def monitor_news_source(self, source_id: int, override_options: Optional[Dict[str, Any]] = None):
    """
    Monitor a news source for new articles using enhanced source analysis.
    
    Args:
        source_id: ID of the news source to monitor
        override_options: Optional configuration overrides
    """
    logger.info(f"Starting news source monitoring for source {source_id}")
    
    with SessionLocal() as session:
        try:
            # Get source
            source = session.get(Source, source_id)
            if not source:
                logger.error(f"Source {source_id} not found")
                return {"error": f"Source {source_id} not found"}
            
            if source.kind not in ["news_source_monitor", "site_discovery"]:
                logger.error(f"Source {source_id} is not a news source monitor (kind: {source.kind})")
                return {"error": f"Source {source_id} is not a news source monitor"}
            
            # Initialize services
            content_ingestion_service = ContentIngestionService(session)
            
            # Get base URL from source details
            base_url = source.details.get('base_url')
            if not base_url:
                logger.error(f"News source {source_id} has no base_url in details")
                return {"error": "No base_url found in source details"}
            
            # Configure monitoring options
            monitoring_options = {
                'max_urls': override_options.get('max_urls', 20) if override_options else 20,
                'use_source_analysis': override_options.get('use_source_analysis', True) if override_options else True,
                'process_rss_feeds': override_options.get('process_rss_feeds', True) if override_options else True,
                'use_bulk_scraping': override_options.get('use_bulk_scraping', True) if override_options else True,
                'create_image_assets': override_options.get('create_image_assets', True) if override_options else True,
                'max_threads': override_options.get('max_threads', 4) if override_options else 4,
                'monitoring_run': True
            }
            
            # Update source status
            source.status = SourceStatus.PROCESSING
            source.source_metadata = source.source_metadata or {}
            source.source_metadata.update({
                'monitoring_started_at': datetime.now(timezone.utc).isoformat(),
                'monitoring_task_id': self.request.id
            })
            session.add(source)
            session.commit()
            
            # Perform site discovery with enhanced analysis
            assets = await content_ingestion_service._handle_site_discovery(
                base_url=base_url,
                infospace_id=source.infospace_id,
                user_id=source.user_id,
                options=monitoring_options
            )
            
            # Link only top-level assets to source (not child assets)
            for asset in assets:
                if asset.parent_asset_id is None:
                    asset.source_id = source.id
                session.add(asset)
            
            # Update source metadata
            source.status = SourceStatus.COMPLETE
            source.source_metadata.update({
                'last_processed_at': datetime.now(timezone.utc).isoformat(),
                'last_monitoring_result': {
                    'total_assets_created': len(assets),
                    'processing_options': monitoring_options
                },
                'monitoring_completed_at': datetime.now(timezone.utc).isoformat()
            })
            source.updated_at = datetime.now(timezone.utc)
            session.add(source)
            session.commit()
            
            logger.info(f"News source monitoring completed for source {source_id}: {len(assets)} assets created")
            
            return {
                'source_id': source_id,
                'base_url': base_url,
                'total_assets_created': len(assets),
                'asset_ids': [asset.id for asset in assets],
                'completed_at': datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"News source monitoring failed for source {source_id}: {e}", exc_info=True)
            
            # Update source with error status
            try:
                source = session.get(Source, source_id)
                if source:
                    source.status = SourceStatus.FAILED
                    source.error_message = str(e)
                    source.source_metadata = source.source_metadata or {}
                    source.source_metadata.update({
                        'monitoring_failed_at': datetime.now(timezone.utc).isoformat(),
                        'monitoring_error': str(e)
                    })
                    session.add(source)
                    session.commit()
            except Exception as update_error:
                logger.error(f"Failed to update source status after error: {update_error}")
            
            # Retry with exponential backoff
            if self.request.retries < self.max_retries:
                retry_delay = 60 * (2 ** self.request.retries)  # 60s, 120s, 240s
                logger.info(f"Retrying news source monitoring for source {source_id} in {retry_delay} seconds")
                raise self.retry(countdown=retry_delay, exc=e)
            
            return {"error": str(e), "source_id": source_id}


@celery_app.task
def discover_and_create_rss_sources(base_url: str, infospace_id: int, user_id: int, 
                                   source_name_prefix: Optional[str] = None):
    """
    Discover RSS feeds from a base URL and create RSS sources for each feed.
    
    Args:
        base_url: Base URL to analyze for RSS feeds
        infospace_id: Target infospace ID
        user_id: User ID creating the sources
        source_name_prefix: Optional prefix for source names
    """
    logger.info(f"Discovering RSS feeds from {base_url}")
    
    with SessionLocal() as session:
        try:
            # Initialize scraping provider
            scraping_provider = create_scraping_provider(settings)
            
            # Discover RSS feeds
            rss_feeds = await scraping_provider.discover_rss_feeds(base_url)
            
            if not rss_feeds:
                logger.info(f"No RSS feeds found at {base_url}")
                return {"base_url": base_url, "rss_feeds_found": 0, "sources_created": 0}
            
            # Initialize source service
            source_service = SourceService(session)
            
            # Create RSS sources for each discovered feed
            created_sources = []
            for i, feed_url in enumerate(rss_feeds):
                try:
                    source_name = f"{source_name_prefix or 'RSS'} - Feed {i+1}" if len(rss_feeds) > 1 else f"{source_name_prefix or 'RSS'} - {base_url}"
                    
                    from app.schemas import SourceCreate
                    source_create = SourceCreate(
                        name=source_name,
                        kind="rss_feed",
                        details={
                            "feed_url": feed_url,
                            "discovered_from": base_url,
                            "auto_created": True,
                            "discovery_method": "enhanced_rss_discovery"
                        }
                    )
                    
                    source = source_service.create_source(
                        user_id=user_id,
                        infospace_id=infospace_id,
                        source_in=source_create
                    )
                    
                    created_sources.append(source)
                    logger.info(f"Created RSS source {source.id} for feed {feed_url}")
                    
                except Exception as e:
                    logger.error(f"Failed to create RSS source for feed {feed_url}: {e}")
                    continue
            
            logger.info(f"RSS discovery completed: {len(created_sources)} sources created from {len(rss_feeds)} feeds")
            
            return {
                "base_url": base_url,
                "rss_feeds_found": len(rss_feeds),
                "sources_created": len(created_sources),
                "source_ids": [source.id for source in created_sources],
                "feed_urls": rss_feeds
            }
            
        except Exception as e:
            logger.error(f"RSS discovery failed for {base_url}: {e}", exc_info=True)
            return {"error": str(e), "base_url": base_url}


@celery_app.task
def bulk_monitor_sources(source_ids: List[int], override_options: Optional[Dict[str, Any]] = None):
    """
    Monitor multiple sources in parallel.
    
    Args:
        source_ids: List of source IDs to monitor
        override_options: Optional configuration overrides
    """
    logger.info(f"Starting bulk monitoring for {len(source_ids)} sources")
    
    results = []
    
    # Group sources by type for optimal processing
    with SessionLocal() as session:
        sources = session.query(Source).filter(Source.id.in_(source_ids)).all()
        
        rss_sources = [s for s in sources if s.kind == "rss_feed"]
        search_sources = [s for s in sources if s.kind == "search"]
        news_sources = [s for s in sources if s.kind in ["news_source_monitor", "site_discovery"]]
    
    # Process RSS sources
    for source in rss_sources:
        try:
            result = monitor_rss_source.delay(source.id, override_options)
            results.append({
                "source_id": source.id,
                "source_type": "rss_feed",
                "task_id": result.id,
                "status": "queued"
            })
        except Exception as e:
            logger.error(f"Failed to queue RSS monitoring for source {source.id}: {e}")
            results.append({
                "source_id": source.id,
                "source_type": "rss_feed",
                "error": str(e),
                "status": "failed"
            })
    
    # Process search sources
    for source in search_sources:
        try:
            result = monitor_search_source.delay(source.id, override_options)
            results.append({
                "source_id": source.id,
                "source_type": "search",
                "task_id": result.id,
                "status": "queued"
            })
        except Exception as e:
            logger.error(f"Failed to queue search monitoring for source {source.id}: {e}")
            results.append({
                "source_id": source.id,
                "source_type": "search",
                "error": str(e),
                "status": "failed"
            })
    
    # Process news sources
    for source in news_sources:
        try:
            result = monitor_news_source.delay(source.id, override_options)
            results.append({
                "source_id": source.id,
                "source_type": "news_source",
                "task_id": result.id,
                "status": "queued"
            })
        except Exception as e:
            logger.error(f"Failed to queue news source monitoring for source {source.id}: {e}")
            results.append({
                "source_id": source.id,
                "source_type": "news_source",
                "error": str(e),
                "status": "failed"
            })
    
    logger.info(f"Bulk monitoring queued: {len(results)} tasks")
    
    return {
        "total_sources": len(source_ids),
        "tasks_queued": len([r for r in results if r.get("status") == "queued"]),
        "tasks_failed": len([r for r in results if r.get("status") == "failed"]),
        "results": results
    }


@celery_app.task(bind=True, max_retries=3)
def monitor_search_source(self, source_id: int, override_options: Optional[Dict[str, Any]] = None):
    """
    Monitor a search source for new content and ingest new items.
    
    Args:
        source_id: ID of the search source to monitor
        override_options: Optional configuration overrides
    """
    logger.info(f"Starting search source monitoring for source {source_id}")
    
    with SessionLocal() as session:
        try:
            # Get source
            source = session.get(Source, source_id)
            if not source:
                logger.error(f"Source {source_id} not found")
                return {"error": f"Source {source_id} not found"}
            
            if source.kind != "search":
                logger.error(f"Source {source_id} is not a search source (kind: {source.kind})")
                return {"error": f"Source {source_id} is not a search source"}
            
            # Initialize services
            content_ingestion_service = ContentIngestionService(session)
            
            # Get search configuration from source details
            search_config = source.details.get('search_config')
            if not search_config:
                logger.error(f"Search source {source_id} has no search_config in details")
                return {"error": "No search_config found in source details"}
            
            query = search_config.get('query')
            if not query:
                logger.error(f"Search source {source_id} has no query in search_config")
                return {"error": "No query found in search_config"}
            
            # Determine lookback period for new content
            lookback_hours = override_options.get('lookback_hours', 24) if override_options else 24
            cutoff_time = datetime.now(timezone.utc) - timedelta(hours=lookback_hours)
            
            # Check when we last processed this source
            last_processed = source.source_metadata.get('last_processed_at')
            if last_processed:
                try:
                    last_processed_dt = datetime.fromisoformat(last_processed.replace('Z', '+00:00'))
                    cutoff_time = max(cutoff_time, last_processed_dt)
                except Exception as e:
                    logger.warning(f"Could not parse last_processed_at for source {source_id}: {e}")
            
            # Configure search options
            search_options = {
                'limit': override_options.get('max_results', 10) if override_options else search_config.get('max_results', 10),
                'scrape_content': override_options.get('scrape_content', True) if override_options else True,
                'provider_params': {
                    'search_depth': search_config.get('search_depth', 'basic'),
                    'include_domains': search_config.get('include_domains'),
                    'exclude_domains': search_config.get('exclude_domains'),
                    'date_range': search_config.get('date_range'),
                    **(override_options.get('provider_params', {}) if override_options else {})
                },
                'cutoff_time': cutoff_time.isoformat(),
                'monitoring_run': True
            }
            
            # Update source status
            source.status = SourceStatus.PROCESSING
            source.source_metadata = source.source_metadata or {}
            source.source_metadata.update({
                'monitoring_started_at': datetime.now(timezone.utc).isoformat(),
                'monitoring_task_id': self.request.id
            })
            session.add(source)
            session.commit()
            
            # Perform search and create assets
            assets = await content_ingestion_service._handle_search_query(
                query=query,
                infospace_id=source.infospace_id,
                user_id=source.user_id,
                options=search_options
            )
            
            # Filter for new assets only (those created after cutoff_time)
            new_assets = []
            for asset in assets:
                if asset.created_at >= cutoff_time:
                    new_assets.append(asset)
                    # Link asset to source
                    asset.source_id = source.id
                    session.add(asset)
            
            # Update source metadata
            source.status = SourceStatus.COMPLETE
            source.source_metadata.update({
                'last_processed_at': datetime.now(timezone.utc).isoformat(),
                'last_monitoring_result': {
                    'total_assets_found': len(assets),
                    'new_assets_created': len(new_assets),
                    'cutoff_time': cutoff_time.isoformat(),
                    'search_query': query,
                    'processing_options': search_options
                },
                'monitoring_completed_at': datetime.now(timezone.utc).isoformat()
            })
            source.updated_at = datetime.now(timezone.utc)
            session.add(source)
            session.commit()
            
            logger.info(f"Search monitoring completed for source {source_id}: {len(new_assets)} new assets created")
            
            return {
                'source_id': source_id,
                'search_query': query,
                'total_assets_found': len(assets),
                'new_assets_created': len(new_assets),
                'new_asset_ids': [asset.id for asset in new_assets],
                'cutoff_time': cutoff_time.isoformat(),
                'completed_at': datetime.now(timezone.utc).isoformat()
            }
            
        except Exception as e:
            logger.error(f"Search monitoring failed for source {source_id}: {e}", exc_info=True)
            
            # Update source with error status
            try:
                source = session.get(Source, source_id)
                if source:
                    source.status = SourceStatus.FAILED
                    source.error_message = str(e)
                    source.source_metadata = source.source_metadata or {}
                    source.source_metadata.update({
                        'monitoring_failed_at': datetime.now(timezone.utc).isoformat(),
                        'monitoring_error': str(e)
                    })
                    session.add(source)
                    session.commit()
            except Exception as update_error:
                logger.error(f"Failed to update source status after error: {update_error}")
            
            # Retry with exponential backoff
            if self.request.retries < self.max_retries:
                retry_delay = 60 * (2 ** self.request.retries)  # 60s, 120s, 240s
                logger.info(f"Retrying search monitoring for source {source_id} in {retry_delay} seconds")
                raise self.retry(countdown=retry_delay, exc=e)
            
            return {"error": str(e), "source_id": source_id}

