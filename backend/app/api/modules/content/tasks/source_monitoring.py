"""
Source monitoring and polling tasks.

This module provides Celery tasks for monitoring sources (RSS, search, etc.)
using SourceService.execute_poll() for actual polling operations.
"""

import logging
from typing import Dict, Any, List, Optional
from datetime import datetime, timezone

from sqlalchemy import or_
from sqlmodel import Session, select

from app.core.celery_app import celery_app
from app.core.db import engine
from app.core.task_utils import run_async_in_celery
from app.models import Source, SourceStatus
from app.api.modules.content.services.source_service import SourceService

logger = logging.getLogger(__name__)

# Circuit breaker: skip sources with this many consecutive failures to prevent retry storms
POLL_CIRCUIT_BREAKER_THRESHOLD = 5


async def _execute_poll_async(source_id: int, runtime_api_keys: Optional[Dict[str, str]] = None):
    """Async helper that creates its own session for execute_poll."""
    with Session(engine) as session:
        source = session.get(Source, source_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")
        source_service = SourceService(session)
        return await source_service.execute_poll(
            source_id=source_id,
            user_id=source.user_id,
            runtime_api_keys=runtime_api_keys,
        )


@celery_app.task(bind=True, max_retries=3)
def execute_source_poll(self, source_id: int, runtime_api_keys: Optional[Dict[str, str]] = None):
    """
    Execute a poll for a source.
    
    This is the primary task for polling sources. It delegates to
    SourceService.execute_poll() which handles:
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

            result = run_async_in_celery(_execute_poll_async, source_id, runtime_api_keys)
            
            # Event bus: source.polled for on-arrival flow triggers
            if isinstance(result, dict) and result.get("status") == "success":
                from app.core.events import emit
                emit("source.polled", {
                    "source_id": source_id,
                    "new_asset_ids": result.get("new_asset_ids", []),
                })
            
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
        # Circuit breaker: skip sources with too many consecutive failures
        stmt = select(Source).where(
            Source.is_active == True,
            Source.next_poll_at <= now,
            or_(
                Source.consecutive_failures.is_(None),
                Source.consecutive_failures <= POLL_CIRCUIT_BREAKER_THRESHOLD,
            ),
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
