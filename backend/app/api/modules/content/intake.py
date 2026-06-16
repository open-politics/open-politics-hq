"""Producer-side intake — mint PENDING IngestionJobs, one per source kind.

The single entry every producer calls. A producer field-dispatches its input into
``{source_kind: [spec, ...]}`` and hands it here; each job carries
``cursor_state.config.items = specs``; the ``ingest`` @task claims it and runs the
source's ``read → token-guard → fetch → detect_kind → AssetBuilder.decide → place``
spine, counting outcomes. A *spec* is whatever the kind's source ``read`` understands:

  web        {url} | {urls: [...]} | {title?}
  upload     {storage_path, filename?, title?, file_info?}
  text       {text, title?, event_timestamp?}
  web_search {query, max_results?}
  rss        {feed_url, max_items?}
  directory  {path, copy_mode?, inbox_mode?, ...}

One-shot intake mints a job with no Source row (``source_id`` NULL). Monitoring is a
Source minting these same jobs on a schedule — same job, same task, no extra feature.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlmodel import Session


def intake(
    session: Session,
    *,
    infospace_id: int,
    user_id: int,
    groups: Dict[str, List[dict]],
    dest_id: Optional[int] = None,
) -> List[Any]:
    """Mint one IngestionJob per kind in ``groups`` (``config.items = specs``), emit
    ``ingestion_job.created`` once, and return the committed+refreshed jobs.

    Empty kinds are skipped; an all-empty ``groups`` returns ``[]`` and emits nothing.
    The event (and the ``content``/``ingestion`` kick tag) make the ``ingest`` task
    reachable by both paths — producers emit; ``kick_tasks`` is the sweep."""
    from app.models import IngestionJob, IngestionStatus
    from app.core.events import emit

    jobs: List[Any] = []
    for kind, specs in groups.items():
        if not specs:
            continue
        job = IngestionJob(
            infospace_id=infospace_id,
            user_id=user_id,
            kind=kind,
            root_bundle_id=dest_id,
            status=IngestionStatus.PENDING,
            total_files=len(specs),
            source_locator=f"intake:{kind}:{len(specs)}",
            cursor_state={
                "stage": "pending",
                "progress_pct": 0,
                "message": f"Queued {len(specs)} {kind} item(s)",
                "config": {"items": specs},
                "cursor": {},
            },
        )
        session.add(job)
        jobs.append(job)

    if not jobs:
        return []

    session.commit()
    for j in jobs:
        session.refresh(j)
    emit("ingestion_job.created", {"infospace_id": infospace_id})
    return jobs


# ── Source-driven intake ────────────────────────────────────────────────────────

def run_source_ingestion(session: Session, source_id: int, *, dest_id: Optional[int] = None) -> Any:
    """Mint one PENDING IngestionJob from a Source row and return it — the Source-row
    analog of ``intake()``. A Source IS monitoring config: ``kind`` is a registered
    source kind and ``details`` is that source's read-config verbatim, so minting is
    copying them onto a job. A scheduled poll, a flow INGEST step, and a manual
    "process now" are all this same act. Carries ``source_id`` so the job's finalize
    updates the poll counters, and advances ``next_poll_at`` so the scheduler can't
    re-mint before this run finishes. Emits ``ingestion_job.created`` (the ``ingest``
    task also carries kick tags — both triggers reach it)."""
    from datetime import datetime, timedelta, timezone

    from app.models import IngestionJob, IngestionStatus, Source, SourceStatus
    from app.api.modules.content.sources import get_source_handler
    from app.core.events import emit

    source = session.get(Source, source_id)
    if source is None:
        raise ValueError(f"Source {source_id} not found")
    if get_source_handler(source.kind) is None:
        raise ValueError(f"Source {source_id} has unregistered kind {source.kind!r}")

    job = IngestionJob(
        infospace_id=source.infospace_id,
        user_id=source.user_id,
        kind=source.kind,
        source_id=source.id,
        root_bundle_id=dest_id or source.output_bundle_id,
        status=IngestionStatus.PENDING,
        source_locator=source.name or f"source:{source.id}",
        cursor_state={"config": {**dict(source.details or {}),
                                  **({"on_drift": source.on_drift} if source.on_drift else {})},
                      "cursor": dict(source.cursor_state or {})},
    )
    session.add(job)
    # Claim the source for this run so the poller can't re-mint until the job's
    # finalize resets it (status -> PENDING, counters, last_poll_at).
    source.status = SourceStatus.PROCESSING
    if source.poll_interval_seconds:
        source.next_poll_at = datetime.now(timezone.utc) + timedelta(seconds=source.poll_interval_seconds)
    source.updated_at = datetime.now(timezone.utc)
    session.add(source)
    session.commit()
    session.refresh(job)

    emit("ingestion_job.created", {"infospace_id": source.infospace_id})
    return job
