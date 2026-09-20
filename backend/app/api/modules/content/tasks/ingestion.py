"""
Content ingestion — the unified, source-driven ``ingest`` @task.

A producer mints a PENDING IngestionJob (``kind`` ∈ ``registered_source_kinds()``,
``cursor_state.config.items``); ``ingest`` claims it and runs the whole spine:

    read(config, cursor) → identity/drift guard → fetch → detect_kind →
    AssetBuilder.decide → place-in-bundle → count → emit/kick

One-shot = a job with no ``source_id``; a poll = a job with ``source_id`` set
(monitoring is then just a Source minting these jobs on a schedule). Counters come
from ``BuildOutcome.status``, never ``len()``. schedule=None: dispatched via the
``ingestion_job.created`` event or ``kick_tasks()``, never beat-polled.
"""

import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy import update, func
from sqlmodel import Session, select

from app.core.tasks import TaskContext, task
from app.core.task_utils import run_async_in_celery
from app.models import IngestionJob, IngestionStatus
from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import Asset, ProcessingStatus, Source, SourceStatus
from app.api.modules.content.sources import (
    get_source_handler, registered_source_kinds, RawItem,
)

logger = logging.getLogger(__name__)


# ── The spine ─────────────────────────────────────────────────────────────────
# read → identity/drift guard → fetch → detect_kind → AssetBuilder.decide → place.
# Counters from BuildOutcome.status, never len().
#
# Three tiers of dedup, each cheaper than the next and each opt-in beyond the first:
#   1  identity      source_identifier already live here?  — always on, DB-enforced
#   2  drift token   did the cheap change signal move?      — when the source emits one
#   3  content hash  did the bytes actually change?         — only when the Source
#                                                             declares on_drift
# Tiers 1+2 are `_bulk_guard` + the loop below (one query per 200 items, no network).
# Tier 3 is `decide()` inside the builder. With tier 3 off — the default — a known
# identifier never reaches `fetch()`, so a re-poll costs one query per chunk and writes
# nothing. That is what makes monitoring emergent rather than a feature.
#
# Cross-poll cursor *resume* (avoid re-enumerating a 150k-file directory) is deferred.

_INGEST_CHUNK = 200            # items per commit — streams huge sources, bounded txn

# A job whose worker died stays PROCESSING forever: the claim below matches only
# PENDING, celery's redelivery then no-ops, and nothing else resets it. (Three such jobs
# were sitting in this state for 59-151 days.) Past twice the task timeout the worker is
# certainly gone — celery kills at `timeout` — so the job is reclaimable.
_STALE_AFTER_SECONDS = 7200    # 2 × the ingest task timeout


def _claimable(job_col_status, job_col_started):
    """PENDING, or PROCESSING but abandoned by a dead worker."""
    from datetime import timedelta

    from sqlalchemy import and_, or_

    return or_(
        job_col_status == IngestionStatus.PENDING,
        and_(
            job_col_status == IngestionStatus.PROCESSING,
            job_col_started.isnot(None),
            job_col_started < func.now() - timedelta(seconds=_STALE_AFTER_SECONDS),
        ),
    )


def _bulk_guard(
    session: Session, infospace_id: int, identifiers: List[str],
) -> Dict[str, tuple[int, Optional[str]]]:
    """One query → ``{source_identifier: (asset_id, source_token)}`` for live roots this
    infospace already holds. Lets the loop skip unchanged items before fetch; the builder's
    verdict stays the authority for the create/skip/supersede decision.

    It carries the id, not just the token, because a tier-1 skip still has placement to do
    — see ``intake_items``. Absence from this dict IS "never ingested", which is why there
    is no sentinel for it any more: a row that exists but carries no drift signal is
    ``(id, None)``, and that is a different shape from missing.
    """
    ids = [i for i in identifiers if i]
    if not ids:
        return {}
    rows = session.exec(
        select(Asset.id, Asset.source_identifier, Asset.source_token).where(
            Asset.infospace_id == infospace_id,
            Asset.source_identifier.in_(ids),
            Asset.is_superseded.is_(False),
            # Roots only — the same population ux_asset_live_identity covers. Children
            # legitimately reuse identifiers (a page's images, archive members), and an
            # unscoped guard would let one of those mask a genuine root ingest of the
            # same URL as "already seen".
            Asset.parent_asset_id.is_(None),
        )
    ).all()
    return {sid: (aid, tok) for aid, sid, tok in rows}


def _destination(
    item: RawItem, sctx: SourceContext, *,
    dest_id: Optional[int], path_memo: Optional[Dict[str, int]],
) -> Optional[int]:
    """The bundle this item belongs in. Folders become bundles: with a dest the path nests
    under it, without one the path forms top-level bundles (a dropped folder keeps its
    shape). No path + no dest → ROOT, i.e. no membership.

    Lifted out of ``intake_item`` because an item skipped at tier 1 never gets there and
    still needs placing — the destination is a property of the item and the job, not of
    the act of building.
    """
    from app.api.modules.content.tree import ensure_path_bundles

    if not (dest_id or item.path):
        return None
    return ensure_path_bundles(
        sctx.session, dest_id, item.path,
        user_id=sctx.user_id, infospace_id=sctx.infospace_id,
        memo=path_memo if path_memo is not None else {},
    )


async def intake_item(
    item: RawItem, source, sctx: SourceContext, *,
    on_drift: str = "skip", source_id: Optional[int] = None,
    bundle_id: Optional[int] = None,
) -> "BuildOutcome":
    """Acquire ONE item that already passed the stage-1 guard: fetch → detect_kind →
    build. The per-item half of the acquire spine; ``intake_items`` adds the bulk guard.

    Takes a RESOLVED ``bundle_id``, not a dest + path to resolve: the caller has to know
    the destination anyway (a tier-1 skip never reaches here and still needs placing), so
    resolving it twice from two places is how the two would drift apart.

    Dedup strategy is a DECLARED knob (``on_drift``: skip|update|supersede), and its
    DEFAULT IS ``skip`` — i.e. content monitoring is opt-in. A known ``source_identifier``
    is the same asset, full stop: not re-ingested, not versioned. Only a Source that
    declares ``on_drift`` opts into tier 3 (compare content, then update or version it).

    This default used to be ``update``, which meant every re-poll of a drifted item
    rewrote the row whether or not the bytes had changed."""
    from app.api.modules.content.asset_builder import AssetBuilder
    from app.api.modules.content.types import needs_processing, detect_kind

    session = sctx.session
    fetched = await source.fetch(item, sctx)
    # Kind: trust the source if it named one at read (filename/assertion); else classify
    # from the fetched bytes via the one detect_kind seam (mimetype → sniff → ext → FILE).
    kind = item.kind or detect_kind(fetched.mimetype, fetched.head, item.title)
    b = (
        AssetBuilder(session, sctx.user_id, sctx.infospace_id)
        .as_kind(kind).with_title(item.title)
        .with_source(item.source_identifier)
        .dedup_on(source_identifier=item.source_identifier)
        .on_match(on_drift)
        .with_metadata(**{**(item.metadata or {}), **(fetched.metadata or {})})
    )
    if item.source_token: b.with_source_token(item.source_token)
    if source_id: b.with_source_id(source_id)
    if bundle_id: b.into_bundle(bundle_id)
    if fetched.text_content: b.with_text(fetched.text_content)
    # A digest can only reach the builder alongside the bytes it describes; only
    # blob-realizing sources produce one (audited: directory is the sole site).
    if fetched.blob_path: b.with_blob(fetched.blob_path, fetched.content_hash)
    ts = item.event_timestamp or fetched.event_timestamp
    if ts: b.with_timestamp(ts)
    if needs_processing(kind):
        b.with_processing_status(ProcessingStatus.PENDING)
    return await b.build()


async def intake_items(
    items: List[RawItem], source, sctx: SourceContext, *,
    on_drift: str = "skip", source_id: Optional[int] = None,
    dest_id: Optional[int] = None, path_memo: Optional[Dict[str, int]] = None,
) -> Dict[str, int]:
    """Acquire a batch — tiers 1 and 2 of the dedup ladder, then ``intake_item`` for the
    survivors, counting outcomes. The acquire spine: driven by the ``ingest`` @task over a
    job, but pure enough to call directly (the zero-write re-poll test does exactly that).
    Flush-never-commit; caller commits."""
    counts = {"created": 0, "skipped": 0, "superseded": 0, "updated": 0}
    if not items:
        return counts
    from app.api.modules.content.tree import place, recount

    # Tier 3 is opt-in. Off (the default) means a known identifier is the same asset and
    # we never look at content at all — so the drift token has nothing to decide either.
    monitoring = on_drift != "skip"
    guard = _bulk_guard(sctx.session, sctx.infospace_id, [it.source_identifier for it in items])
    # Assets this chunk RECOGNIZED rather than created, grouped by where they belong.
    # Applied once per bundle at the end — placement is additive and idempotent, so it
    # batches; there is no reason to pay a statement per item for it.
    recognized: Dict[int, List[int]] = {}
    filled: set = set()   # bundles that gained rows via INSERT (membership already written)
    for it in items:
        # Resolved once, for both outcomes — where an item belongs is a property of the
        # item and the job, not of whether we happened to build it.
        bundle = _destination(it, sctx, dest_id=dest_id, path_memo=path_memo)
        seen = guard.get(it.source_identifier)
        if seen is not None:
            asset_id, prior = seen
            # TIER 1 — known identifier. With monitoring off this ends it: no fetch, no
            # network, no hash, no write.
            # TIER 2 — with monitoring on, only a present and CHANGED token is worth
            # re-fetching to compare content. A None token means "no drift signal", so
            # re-seeing the identifier stays a no-op. NOT a content hash: feed bodies
            # wiggle (ads, relative timestamps) and would re-ingest everything every poll.
            if not monitoring or it.source_token is None or prior == it.source_token:
                counts["skipped"] += 1
                # Identity is content; placement is membership — so a skip is a decision
                # about the ROW, never about where it belongs. Two Sources on one feed
                # feeding different bundles hit this branch for every item after the first
                # Source's poll, and without placing here the second bundle would stay
                # empty forever: exactly the starvation enforcing identity uniqueness
                # would otherwise cause. The builder does the same on ITS match paths
                # (tiers 2/3); this is the same rule at the tier that skips earliest.
                if bundle:
                    recognized.setdefault(bundle, []).append(asset_id)
                continue
        outcome = await intake_item(
            it, source, sctx, on_drift=on_drift, source_id=source_id, bundle_id=bundle,
        )
        counts[outcome.status] += 1
        if bundle and outcome.status == "created":
            filled.add(bundle)
    for bundle_id, asset_ids in recognized.items():
        place(sctx.session, asset_ids, [bundle_id])
    # Rows this chunk CREATED carried their membership in the INSERT, so no attach is
    # owed — but the denormalized Bundle.asset_count still is, and nothing was refreshing
    # it (a folder filled purely by ingestion read 0 forever; tree_renderer worked around
    # it by computing counts live). Once per bundle per chunk, never per item: on a
    # 60k-asset folder that aggregate is not free.
    if filled:
        recount(sctx.session, filled)
    return counts


async def _run_ingestion_job(ctx: TaskContext, job_id: int) -> Dict[str, int]:
    """Stream a job's source: read → guard → fetch → build → count, committed in
    chunks (memory-safe for huge sources). One enumeration per job; the @task
    self-chains to the next PENDING job."""
    from app.api.modules.foundation_service_providers import resolve
    from app.core.config import settings

    counts = {"created": 0, "skipped": 0, "superseded": 0, "updated": 0}

    with ctx.session() as session:
        job = session.get(IngestionJob, job_id)
        source_cls = get_source_handler(job.kind)
        if source_cls is None:
            raise ValueError(f"No source handler registered for kind {job.kind!r}")
        source = source_cls()
        cs = dict(job.cursor_state or {})
        config = cs.get("config", {})
        cursor = cs.get("cursor", {})
        dest_id = job.root_bundle_id
        source_id = job.source_id
        # Content monitoring is opt-in: a Source declares on_drift to enable tier 3.
        # Absent (the default, and NULL on every Source row today) → identity only.
        on_drift = (config or {}).get("on_drift") or "skip"

        try:
            search = resolve("web_search", infospace_id=job.infospace_id)
        except Exception:
            search = None
        sctx = SourceContext(
            session=session, user_id=job.user_id, infospace_id=job.infospace_id,
            settings=settings, storage_provider=resolve("storage"),
            scraping_provider=resolve("scraping"), search_provider=search,
            options=dict(config or {}),
        )

        total = job.total_files or 0     # known for intake jobs; 0 for streaming polls
        chunk: List[RawItem] = []
        path_memo: Dict[str, int] = {}   # folder-path → bundle id, per job (find-or-create once)

        async def _flush():
            if not chunk:
                return
            # Remember where this chunk ended BEFORE clearing it — a reclaimed job
            # resumes from here instead of re-enumerating a 150k-file directory. The
            # spine records it generically; a source that can resume reads it (see
            # directory.py), one that re-enumerates cheaply just ignores it.
            last_item = chunk[-1].locator or chunk[-1].source_identifier
            c = await intake_items(
                chunk, source, sctx, on_drift=on_drift, source_id=source_id,
                dest_id=dest_id, path_memo=path_memo,
            )
            for k, v in c.items():
                counts[k] += v
            session.commit()
            chunk.clear()
            # Live progress per chunk — ctx.job_progress writes the job row (polled
            # by the frontend) AND pushes the SSE stream event, in one call.
            handled = sum(counts.values())
            ctx.job_progress(
                job_id, stage="acquiring",
                cursor={**cursor, "last_item": last_item},
                processed=counts["created"] + counts["superseded"] + counts["updated"],
                progress_pct=min(99, round(100 * handled / total)) if total else None,
                message=f"{handled}/{total} items" if total else f"{handled} items",
            )

        async for item in source.read(config, cursor, sctx):
            chunk.append(item)
            if len(chunk) >= _INGEST_CHUNK:
                await _flush()
        await _flush()

    # Finalize: the job half rides the substrate primitive (COMPLETED + pct 100 +
    # counts into cursor_state + stream event); the Source counters are domain state.
    ctx.job_progress(
        job_id, status="completed", stage="completed", progress_pct=100,
        processed=counts["created"] + counts["superseded"] + counts["updated"],
        counts=counts,
        message=f"{counts['created']} new · {counts['superseded']} updated · {counts['skipped']} unchanged",
    )
    if source_id:
        with ctx.session() as session:
            src = session.get(Source, source_id)
            if src:
                fresh = counts["created"] + counts["superseded"]
                src.last_poll_at = datetime.now(timezone.utc)
                src.items_last_poll = fresh
                src.total_items_ingested = (src.total_items_ingested or 0) + fresh
                src.consecutive_failures = 0          # poll succeeded → reset breaker
                src.status = SourceStatus.PENDING      # back to idle/ready (mint set PROCESSING)
                # …and the evidence of the failure, or a source that recovered
                # still reads as broken. The breaker and the status were reset
                # here from the start; `error_message` was not, so every surface
                # that shows it kept painting a fixed feed red indefinitely.
                src.error_message = None
                src.last_error_at = None
                session.add(src)
                session.commit()

    if counts["created"] or counts["superseded"]:
        from app.core.dispatch import kick_tasks
        from app.core.events import emit
        # Both paths reach item_processing: the event (it's subscribed to asset.ingested)
        # and the kick (it's tagged "content"). Producers emit; kick is the sweep.
        emit("asset.ingested", {"infospace_id": ctx.infospace_id})
        kick_tasks(ctx.infospace_id, tags=frozenset({"content"}))
    return counts


@task("ingest",
      check=lambda iid: (
          select(IngestionJob.id)
          .where(IngestionJob.infospace_id == iid,
                 _claimable(IngestionJob.status, IngestionJob.started_at),
                 IngestionJob.kind.in_(list(registered_source_kinds())))
          .order_by(IngestionJob.created_at)
      ),
      schedule=None,
      triggers=["ingestion_job.created"],
      batch=1,
      self_chain=True,
      queue="processing",
      timeout=3600,
      tags=frozenset({"content", "ingestion"}))
def ingest(ctx: TaskContext, job_ids: list[int]):
    """Unified source-driven ingestion. Claim a PENDING IngestionJob, dispatch to its
    Source handler via the registry, run read→guard→fetch→build→count, write accurate
    counters."""
    for job_id in job_ids:
        with ctx.session() as session:
            claimed = session.execute(
                update(IngestionJob)
                .where(IngestionJob.id == job_id,
                       _claimable(IngestionJob.status, IngestionJob.started_at))
                .values(status=IngestionStatus.PROCESSING, started_at=func.now())
            )
            session.commit()
            if claimed.rowcount == 0:
                continue
        try:
            run_async_in_celery(_run_ingestion_job, ctx, job_id)
            ctx.stat("done")
        except Exception as e:
            logger.exception("ingest failed for job %d: %s", job_id, e)
            ctx.job_progress(job_id, status="failed", stage="failed", message=str(e))
            with ctx.session() as session:
                # If this was a Source poll, advance its circuit-breaker so a run of
                # failures eventually trips the source_polling threshold.
                failed_job = session.get(IngestionJob, job_id)
                if failed_job and failed_job.source_id:
                    src = session.get(Source, failed_job.source_id)
                    if src:
                        src.consecutive_failures = (src.consecutive_failures or 0) + 1
                        src.status = SourceStatus.FAILED
                        src.last_error_at = datetime.now(timezone.utc)
                        src.error_message = str(e)[:500]
                        session.add(src)
                        session.commit()
            ctx.item_failed(job_id)
            ctx.stat("failed")
