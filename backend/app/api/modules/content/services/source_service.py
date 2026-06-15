"""
Source Service
==============

Source rows are monitoring config: ``kind`` is a registered source kind and
``details`` is that source's read-config. This service owns their CRUD +
stream lifecycle (activate/pause) + poll analytics. Ingestion itself lives on
the one spine — ``run_source_ingestion`` mints a job; the ``ingest`` task runs it.
"""

import logging
from pathlib import Path
from typing import Optional, List, Dict, Any, Tuple
from datetime import datetime, timezone, timedelta
from sqlalchemy import text
from sqlmodel import Session, select, func

from app.models import Source, SourceStatus, Asset
from app.schemas import SourceCreate, SourceUpdate
from app.core.config import settings

logger = logging.getLogger(__name__)

class SourceService:
    """Source CRUD + stream lifecycle + poll analytics."""

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
        from app.api.modules.content.sources import registered_source_kinds

        if source_in.kind not in registered_source_kinds():
            raise ValueError(
                f"Unknown source kind {source_in.kind!r}; registered kinds: "
                f"{sorted(registered_source_kinds())}"
            )
        logger.info(f"Creating source '{source_in.name}' in infospace {infospace_id}")

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
        from app.api.modules.content.sources.directory import (
            count_inbox_pending_files, dataset_name_from_path, prepare_inbox_directory,
        )

        inbox_dir = prepare_inbox_directory(Path(source_path))
        inbox_path_str = str(inbox_dir)
        dataset_name = dataset_name_from_path(source_path, settings.LOCAL_STORAGE_BASE_PATH)

        inbox_source = self.session.exec(
            select(Source).where(
                Source.infospace_id == infospace_id,
                Source.kind == "directory",
                Source.output_bundle_id == bundle_id,
            )
        ).first()

        if not inbox_source:
            inbox_source = Source(
                name=f"Inbox: {dataset_name}",
                kind="directory",
                details={},
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

        # details IS the directory source's read-config.
        inbox_source.details = {
            "path": inbox_path_str,
            "dataset_name": dataset_name,
            "inbox_mode": True,
        }

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
        """Delete a source. Its assets are DETACHED (kept), never destroyed.

        Clearing ``source_id`` lets ingested content outlive the source — deleting
        a source must not take its data with it. Detaching also satisfies the
        asset→source FK before the source row is removed.
        """
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False

        detached = self.session.execute(
            text("UPDATE asset SET source_id = NULL WHERE source_id = :sid"),
            {"sid": source_id},
        ).rowcount

        self.session.delete(source)
        self.session.commit()

        logger.info(f"Source {source_id} deleted; {detached} assets detached (kept)")
        return True
    
    # ─────────────── ONE-OFF INGEST ─────────────── #

    def trigger_source_processing(
        self,
        source_id: int,
        user_id: int,
        infospace_id: int,
        override_details: Optional[Dict[str, Any]] = None
    ) -> bool:
        """Trigger a one-off ingest of a Source on the one spine: merge any override
        into details, then mint an IngestionJob via ``run_source_ingestion`` (the same
        path a poll takes). Returns False if the source is missing or unregistered."""
        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            return False
        try:
            if override_details:
                source.details = {**(source.details or {}), **override_details}
                self.session.add(source)
                self.session.commit()
            from app.api.modules.content.intake import run_source_ingestion
            job = run_source_ingestion(self.session, source_id)
            logger.info("Triggered source %s ingest as job %s", source_id, job.id)
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
        runtime_api_keys: Optional[Dict[str, str]] = None,
    ) -> Dict[str, Any]:
        """Enqueue a poll: mint a PENDING IngestionJob for the source via the shared
        ``run_source_ingestion`` and let the ``ingest`` task run the spine
        (read -> guard -> fetch -> build -> count -> finalize). Monitoring is then just
        a Source minting a job each cycle on the one ingest primitive. ``runtime_api_keys``
        is kept for signature compatibility (providers resolve at the task boundary)."""
        from app.api.modules.content.intake import run_source_ingestion

        job = run_source_ingestion(self.session, source_id)
        logger.info("Source %s poll enqueued as ingestion job %s (kind=%s)",
                    source_id, job.id, job.kind)
        return {"status": "queued", "job_id": job.id, "kind": job.kind}

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
        from app.models import IngestionJob, IngestionStatus

        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")

        # Recent poll jobs (a poll IS an IngestionJob with source_id set).
        recent_jobs = self.session.exec(
            select(IngestionJob)
            .where(IngestionJob.source_id == source_id)
            .order_by(IngestionJob.created_at.desc())
            .limit(24)
        ).all()

        # Calculate items per hour (last 24 hours)
        now = datetime.now(timezone.utc)
        last_24h = now - timedelta(hours=24)

        recent_items = sum(
            (job.processed_files or 0)
            for job in recent_jobs
            if job.created_at and job.created_at >= last_24h and job.status == IngestionStatus.COMPLETED
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
        from app.models import IngestionJob, IngestionStatus

        source = self.get_source(source_id, user_id, infospace_id)
        if not source:
            raise ValueError(f"Source {source_id} not found")

        # A poll IS an IngestionJob with source_id set (SourcePollHistory retired).
        jobs = self.session.exec(
            select(IngestionJob)
            .where(IngestionJob.source_id == source_id)
            .order_by(IngestionJob.created_at.desc())
            .limit(limit)
        ).all()

        records = []
        for job in jobs:
            counts = (job.cursor_state or {}).get("counts", {})
            ingested = job.processed_files or 0
            started = job.started_at or job.created_at
            records.append({
                "id": job.id,
                "started_at": started.isoformat() if started else None,
                "completed_at": job.completed_at.isoformat() if job.completed_at else None,
                "status": ("success" if job.status == IngestionStatus.COMPLETED
                           else "failed" if job.status == IngestionStatus.FAILED
                           else job.status.value),
                "items_found": sum(counts.values()) if counts else ingested,
                "items_ingested": ingested,
                "error_message": job.error_message,
                "triggered_pipeline": None,
            })
        return records