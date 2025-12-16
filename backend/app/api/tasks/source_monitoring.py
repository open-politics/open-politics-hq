"""
Source monitoring and polling tasks.

This module provides Celery tasks for monitoring sources (RSS, search, etc.)
using the StreamSourceService for actual polling operations.
"""

import logging
import asyncio
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from sqlmodel import Session, select

from app.core.celery_app import celery_app
from app.core.db import engine
from app.models import Source, SourceStatus
from app.api.services.stream_source_service import StreamSourceService

logger = logging.getLogger(__name__)


def run_async(coro):
    """Run an async coroutine in a sync context."""
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


@celery_app.task(bind=True, max_retries=3)
def execute_source_poll(self, source_id: int, runtime_api_keys: Optional[Dict[str, str]] = None):
    """
    Execute a poll for a source.
    
    This is the primary task for polling sources. It delegates to
    StreamSourceService.execute_poll() which handles:
    - RSS feeds
    - Search queries
    - Cursor state management
    - Asset creation
    
    Args:
        source_id: ID of the source to poll
        runtime_api_keys: Optional API keys for search providers
    """
    logger.info(f"Executing poll for source {source_id}")
    
    with Session(engine) as session:
        try:
            # Verify source exists and is active
            source = session.get(Source, source_id)
            if not source:
                logger.error(f"Source {source_id} not found")
                return {"error": f"Source {source_id} not found", "status": "failed"}
            
            if not source.is_active:
                logger.info(f"Source {source_id} is not active, skipping poll")
                return {"status": "skipped", "reason": "source_inactive"}
            
            # Use StreamSourceService for polling
            stream_service = StreamSourceService(session)
            
            # Execute poll (async method, run synchronously)
            result = run_async(
                stream_service.execute_poll(
                    source_id=source_id,
                    user_id=source.user_id,
                    runtime_api_keys=runtime_api_keys
                )
            )
            
            logger.info(f"Poll completed for source {source_id}: {result}")
            return result
            
        except Exception as e:
            logger.error(f"Poll failed for source {source_id}: {e}", exc_info=True)
            
            # Update source with error status
            try:
                source = session.get(Source, source_id)
                if source:
                    source.status = SourceStatus.FAILED
                    source.error_message = str(e)
                    source.consecutive_failures = (source.consecutive_failures or 0) + 1
                    source.last_error_at = datetime.now(timezone.utc)
                    session.add(source)
                    session.commit()
            except Exception as update_error:
                logger.error(f"Failed to update source status: {update_error}")
            
            # Retry with exponential backoff
            if self.request.retries < self.max_retries:
                retry_delay = 60 * (2 ** self.request.retries)
                logger.info(f"Retrying poll for source {source_id} in {retry_delay}s")
                raise self.retry(countdown=retry_delay, exc=e)
            
            return {"error": str(e), "status": "failed"}


@celery_app.task
def poll_active_sources():
    """
    Check for sources that are due for polling and queue poll tasks.
    
    This task runs on a schedule (e.g., every minute) to check
    which sources need polling based on their next_poll_at time.
    """
    logger.info("Checking for sources due for polling")
    
    with Session(engine) as session:
        now = datetime.now(timezone.utc)
        
        # Find active sources where next_poll_at <= now
        stmt = select(Source).where(
            Source.is_active == True,
            Source.next_poll_at <= now
        )
        sources = session.exec(stmt).all()
        
        if not sources:
            logger.debug("No sources due for polling")
            return {"status": "ok", "sources_queued": 0}
        
        queued = 0
        for source in sources:
            try:
                execute_source_poll.delay(source.id)
                queued += 1
                logger.info(f"Queued poll for source {source.id}")
            except Exception as e:
                logger.error(f"Failed to queue poll for source {source.id}: {e}")
        
        logger.info(f"Queued {queued} source polls")
        return {"status": "ok", "sources_queued": queued}


@celery_app.task
def bulk_poll_sources(source_ids: List[int], runtime_api_keys: Optional[Dict[str, str]] = None):
    """
    Queue poll tasks for multiple sources.
    
    Args:
        source_ids: List of source IDs to poll
        runtime_api_keys: Optional API keys for search providers
    """
    logger.info(f"Bulk polling {len(source_ids)} sources")
    
    results = []
    for source_id in source_ids:
        try:
            task = execute_source_poll.delay(source_id, runtime_api_keys)
            results.append({
                "source_id": source_id,
                "task_id": task.id,
                "status": "queued"
            })
        except Exception as e:
            logger.error(f"Failed to queue poll for source {source_id}: {e}")
            results.append({
                "source_id": source_id,
                "error": str(e),
                "status": "failed"
            })
    
    return {
        "total": len(source_ids),
        "queued": len([r for r in results if r["status"] == "queued"]),
        "failed": len([r for r in results if r["status"] == "failed"]),
        "results": results
    }
