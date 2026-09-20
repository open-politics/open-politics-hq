"""Global Live — a standing world-politics monitor, annotated by a local model.

    docker compose exec -T backend python -m app.cli.global_live seed
    docker compose exec -T backend python -m app.cli.global_live kick
    docker compose exec -T backend python -m app.cli.global_live watch
    docker compose exec -T backend python -m app.cli.global_live report

**Nothing here is a feature.** Every line below composes primitives that already
exist; the module is a *composition*, which is why it lives in ``app/cli`` —
outside the layer hierarchy, like routes, so it may reach into content,
annotation and providers at once.

.. code-block:: text

    6 Source rows  ──poll──▶  IngestionJob ──▶ ingest ──▶ ARTICLE assets
      is_active                                             │
      poll_interval_seconds                                 │ into child bundles
                                                            ▼
                                            Global Live  (parent bundle)
                                                            │
                                     AnnotationRun(live=True, source_bundle_id=↑)
                                                            │
                          live_runs (120s) re-pends ──▶ process_annotation_run
                                                            │
                                            resolve("language", "llamacpp")
                                                            ▼
                                           Annotation rows → the graph

Monitoring is the ``Source`` rows. Liveness is one boolean on the run. The
dashboard is the run's ``views_config``. Nothing higher-order is built.

**It lives in the user's default infospace**, beside their own work — a monitor
you have to go somewhere else to look at is a demo. That makes "everything in
this infospace" useless as a scope, so every Source carries ``TAG`` and every
verb that writes resolves it first. See :data:`TAG`.

─────────────────────────────────────────────────────────────────────────────

**The sourcing is the method.** Four registers of evidence, not four websites —
which is the only part of this a political scientist would actually argue
about:

    multilateral     what the IGO system announces about itself
    executive        primary releases and speeches from a governing body
    press (Atlantic) how the European press frames it
    press (other)    the same events from outside that frame
    standing query   what no subscribed feed carries

A monitor fed only from one register measures that register, not the world.
Framing varies by where you stand, and a corpus that cannot show the variance
cannot be used to argue about it.

**The lens is the observation model.** ``templates.build_contract("full", …)``
— rosters linked to claim rows by ``x-ref``, every section carrying its own
``x-graph`` declaration. See ``docs/plans/observation-model/README.md``.

NOT IN THIS FILE
    templates.py     the contract this seeds; the lens is not ours to invent.
    reconcile.py     ``live_runs`` — the heartbeat that re-pends the run.
    source_monitoring.py  ``source_polling`` — the heartbeat that polls feeds.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import text as sql_text
from sqlmodel import Session, select

from app.core.db import engine

# Register every mapper before any ORM use — this module is an entrypoint, so
# nothing has imported the re-export hub for it.
import app.models  # noqa: F401,E402


BUNDLE = "Global Live"
SCHEMA = "Global Live lens"
RUN = "Global Live"

#: Stamped on every Source this module owns, and the ONLY thing that says a row
#: is ours.
#:
#: Global Live lives in the user's **default infospace**, beside forty thousand
#: assets and twenty other sources that are not ours. "Everything in this
#: infospace" is therefore no longer a usable scope for anything — not for
#: pausing, and emphatically not for deleting. Every destructive or
#: state-changing verb below resolves this tag first and acts on nothing else.
#:
#: The rule that prevents an accident here is not care, it is the predicate:
#: touch only what this module created, never everything it did not.
TAG = "global-live"

#: The lens. Not a tier × archetype combination — reading coverage needs three
#: things the general model has no slot for: WHO published it and under which
#: frame, WHICH policy area an act belongs to (separately from the goal it
#: serves), and HOW HARD it was. See ``templates.build_news_contract``.
LENS = "news"


# ─── The sources ─────────────────────────────────────────────────────────────
#
# `details` IS the source's read-config, verbatim — there is no translation
# layer, and a poll is these fields copied onto an IngestionJob.
#
# `register` is ours, not the system's: it names the child bundle, so the
# corpus stays separable by where it came from. That separation is the whole
# reason for sourcing this way — a finding that only appears in one register is
# a finding *about* that register until a second one carries it.

SOURCES: list[dict[str, Any]] = [
    {
        "register": "Multilateral",
        "name": "UN News",
        "kind": "rss",
        "details": {"feed_url": "https://news.un.org/feed/subscribe/en/news/all/rss.xml",
                    "max_items": 40},
        "poll_interval_seconds": 900,
    },
    {
        "register": "Executive",
        "name": "European Commission — press corner",
        "kind": "rss",
        "details": {"feed_url": "https://ec.europa.eu/commission/presscorner/api/rss"
                                "?language=en&pagesize=30",
                    "max_items": 30},
        "poll_interval_seconds": 900,
    },
    {
        "register": "Press · Atlantic",
        "name": "Deutsche Welle — World",
        "kind": "rss",
        "details": {"feed_url": "https://rss.dw.com/rdf/rss-en-world", "max_items": 30},
        "poll_interval_seconds": 600,
    },
    {
        "register": "Press · Atlantic",
        "name": "France 24 — International",
        "kind": "rss",
        "details": {"feed_url": "https://www.france24.com/en/rss", "max_items": 30},
        "poll_interval_seconds": 600,
    },
    {
        "register": "Press · non-Atlantic",
        "name": "Al Jazeera — All",
        "kind": "rss",
        "details": {"feed_url": "https://www.aljazeera.com/xml/rss/all.xml", "max_items": 30},
        "poll_interval_seconds": 600,
    },
    {
        # A different KIND, not just a different outlet: a standing query reaches
        # what nobody publishes a feed for. Rides `ctx.search_provider` —
        # SearXNG here, self-hosted, so the query costs nothing outbound.
        "register": "Standing query",
        "name": "Standing query — multilateral negotiations",
        "kind": "web_search",
        "details": {"query": "sanctions OR ceasefire OR summit OR treaty negotiation",
                    "max_results": 20},
        "poll_interval_seconds": 1800,
    },
]


# ─── Seeding ─────────────────────────────────────────────────────────────────


def _owner(session: Session, email: Optional[str]) -> tuple[int, str]:
    """This deployment's superuser unless told otherwise.

    Same rule as ``annotation/scenario.py``: a fixture owned by a fixture
    account exists, assembles, passes every test and is invisible in the UI.
    """
    if email:
        uid = session.execute(
            sql_text('SELECT id FROM "user" WHERE email = :e'), {"e": email}
        ).scalar()
        if uid is None:
            raise SystemExit(f"no user {email!r} — create one first")
        return uid, email
    row = session.execute(sql_text(
        'SELECT id, email FROM "user" WHERE is_superuser ORDER BY id LIMIT 1'
    )).first()
    if row is None:
        raise SystemExit("no superuser to own Global Live — create one first")
    return row[0], row[1]


def _infospace(session: Session, uid: int):
    """The user's default infospace — where their own work already is.

    Global Live used to mint its own infospace. A monitor you have to go
    somewhere else to look at is a demo; one that sits in the space you already
    work in is infrastructure, and its corpus can be queried, bundled and
    annotated alongside everything else without an export.

    ``ensure_default_infospace`` is the resolver (the user's oldest infospace),
    so this agrees with every other caller about which one that is.

    **Nothing here is configured.** Setting ``enrichment_config`` on an
    infospace we did not create would overwrite whatever the user chose — the
    default infospace on this deployment already declares an ollama embedding
    model, and a helpful three-line default would have silently switched it off.
    The enrichers Global Live wants are the ones that need no provider, and an
    infospace with no config at all already runs those.
    """
    from app.core.config import settings
    from app.api.modules.identity_infospace_user.services.infospace_service import (
        InfospaceService,
    )

    return InfospaceService(session=session, settings=settings).ensure_default_infospace(uid)


def gl_sources(session: Session, infospace_id: int) -> list[Any]:
    """Every Source this module owns, and no others. THE scope for anything
    that writes."""
    from app.api.modules.content.models import Source

    rows = session.exec(
        select(Source).where(Source.infospace_id == infospace_id)
    ).all()
    return [s for s in rows if TAG in (s.tags or [])]


def _bundle(session: Session, *, infospace_id: int, uid: int, name: str,
            parent_id: Optional[int] = None, description: str = ""):
    """Find-or-create one bundle. Bundles are unique on (infospace, parent, name)."""
    from app.api.modules.content.models import Bundle
    from app.api.modules.content.tree import ROOT, create_bundle

    parent = ROOT if parent_id is None else parent_id
    found = session.exec(
        select(Bundle).where(
            Bundle.infospace_id == infospace_id,
            Bundle.parent_bundle_id == parent,
            Bundle.name == name,
        )
    ).first()
    if found:
        return found
    b = create_bundle(session, infospace_id=infospace_id, user_id=uid,
                      name=name, description=description, parent_bundle_id=parent)
    session.commit()
    session.refresh(b)
    return b


def _sources(session: Session, *, infospace_id: int, uid: int, parent_bundle_id: int,
             activate: bool = True) -> list[Any]:
    """One Source row per feed, each writing into its register's child bundle.

    Re-running rewrites ``details`` and the poll interval in place rather than
    minting a second row: the Source row IS the monitoring config, so editing it
    is the whole update path.
    """
    from app.api.modules.content.models import Source, SourceStatus
    from app.api.modules.content.services.source_service import create_source
    from app.schemas import SourceCreate

    now = datetime.now(timezone.utc)
    out = []
    registers: dict[str, int] = {}

    for spec in SOURCES:
        register = spec["register"]
        if register not in registers:
            registers[register] = _bundle(
                session, infospace_id=infospace_id, uid=uid, name=register,
                parent_id=parent_bundle_id,
                description=f"{register} register.",
            ).id
        dest = registers[register]

        src = session.exec(
            select(Source).where(
                Source.infospace_id == infospace_id, Source.name == spec["name"]
            )
        ).first()
        if src is None:
            src = create_source(session, uid, infospace_id, SourceCreate(
                name=spec["name"], kind=spec["kind"], details=spec["details"],
                is_active=activate,
                poll_interval_seconds=spec["poll_interval_seconds"],
                output_bundle_id=dest,
            ))
        else:
            src.details = spec["details"]
            src.poll_interval_seconds = spec["poll_interval_seconds"]
            src.output_bundle_id = dest

        src.is_active = activate
        # The ownership stamp. Everything destructive below resolves this.
        src.tags = sorted({*(src.tags or []), TAG})
        # Due now. `source_polling` selects on `next_poll_at <= now()`, so an
        # unset one would never be picked up and a far-future one would stall
        # the first cycle behind a full poll interval.
        src.next_poll_at = now
        # A source that failed while we were not looking must not stay tripped
        # by its own circuit breaker across a re-seed.
        src.consecutive_failures = 0
        src.status = SourceStatus.PENDING
        session.add(src)
        out.append(src)

    session.commit()
    return out


def _schema(session: Session, *, infospace_id: int, uid: int):
    """The lens. Reused when the contract is byte-identical, versioned when not.

    An older run keeps the schema it was actually annotated against — comparing
    two runs is only meaningful if each one's contract is still readable.
    """
    from app.api.modules.annotation.models import AnnotationSchema
    from app.api.modules.annotation.templates import list_templates

    template = next(t for t in list_templates() if t.id == LENS)
    built = template.contract()
    existing = list(session.exec(
        select(AnnotationSchema)
        .where(AnnotationSchema.infospace_id == infospace_id,
               AnnotationSchema.name == SCHEMA)
    ).all())
    match = next((s for s in existing if s.output_contract == built), None)
    if match:
        return match

    versions = {str(s.version) for s in existing}
    version, n = "1.0", 1
    while version in versions:
        n += 1
        version = f"{n}.0"

    schema = AnnotationSchema(
        name=SCHEMA, version=version, infospace_id=infospace_id, user_id=uid,
        description=(
            "Twelve linked sections for reading coverage. Five rosters are the "
            "vocabulary; named events are the referent; acts, movements, stances, "
            "properties and standing links are the claims; named grounds are what "
            "they rest on. Every claim carries a 1–10 rank and a quoted "
            "justification, and the document rung records who published it, in "
            "what register and under which frame — so a finding can always be "
            "read back to the source that produced it."),
        output_contract=built,
    )
    session.add(schema)
    session.commit()
    session.refresh(schema)
    return schema


def _dashboard(schema_id: int, anchors: dict[str, Any]) -> list[dict[str, Any]]:
    """The run's ``views_config`` — one graph panel, deliberately unconfigured.

    ``projections`` is left empty and ``source`` absent on purpose: a contract
    written in the observation model **graphs itself**. ``derive_projections``
    reads the ``x-graph`` declaration off every section, so the panel arrives
    showing all twelve layers because nothing told it not to. Hand-wiring here
    would only prove that the hand-wiring works.

    Three things ARE set, because none is derivable from a row:

    ``doc_place`` / ``doc_time`` — the document rung. Annotation-scoped, not a
    property of any array, so it cannot live on a projection. It is what makes
    a story with no stated site still sit somewhere, weakly, and a row that has
    its own place never loses it to the document's.

    ``node_group_by`` — the why-axis, computed from the assembled edge set.
    Signed, so an actor who *opposes* an interest reads as an adversary rather
    than as a stranger.

    ``edge_group_by`` — panel-wide, so it needs the FULL path. A bare key
    resolves at the annotation root and every edge comes back ungrouped,
    silently, which paints a denial exactly like an assertion.
    """
    fid = "global-live-graph"
    return [{
        "name": RUN,
        "description": "Four registers of evidence, one graph.",
        "layout": {"type": "grid", "columns": 24, "rowHeight": 75},
        "panels": [{
            "id": fid,
            "name": "The graph",
            "type": "graph",
            "description": "Twelve layers — five rosters, named events, acts, "
                           "movements, stances, properties, standing links and "
                           "grounds — derived from the contract's own section "
                           "declarations.",
            "fields": [],
            "formula": {
                "id": f"{fid}-f", "name": "The graph", "version": 1,
                "group": [], "measures": [], "derives": [], "merge_maps": [],
                "output_keys": [], "filter": {"logic": "and", "conditions": []},
                "weight": None, "snippet": None, "order_by": None,
                "explosion": None, "schema_id": schema_id,
            },
            "panel_config": {
                "kind": "graph",
                "edge_weight_mode": "count",
                "forward_properties": [],
                "null_policy": "skip",
                "layout": {"kind": "force_directed", "params": {}},
                "dim_unmatched": True,
                "node_group_by": "neighbours:Interest",
                "edge_group_by": "document.observations[*].modality",
                "axes": {"plane": "geo", "up": "time", "pin": True},
                **anchors,
            },
            "grid_position": {"x": 0, "y": 0, "w": 24, "h": 14},
            "settings": {},
            "collapsed": False,
            "scopes_in": [],
            "merge_maps": [],
            "local_filters": {},
            "time_source": "event_timestamp",
        }],
    }]


def _run(session: Session, *, infospace_id: int, uid: int, schema_id: int,
         bundle_id: int, provider: str, model: str, anchors: dict[str, Any],
         run_id: Optional[int] = None):
    """The live run. One per infospace by name — liveness is a property of the
    run, not a new kind of object.

    ``source_bundle_id`` is the parent bundle, and the scope is its **subtree**,
    so every register's child bundle is watched by the one run and adding a
    seventh source needs no change here.
    """
    from app.api.modules.annotation.models import AnnotationRun, RunStatus
    from app.api.modules.annotation.services.annotation_service import AnnotationService
    from app.schemas import AnnotationRunCreate

    config = {
        # The provider fabric reads exactly these two keys off the run.
        "provider": provider,
        "model": model,
        # Low but not zero: an extraction that never varies also never recovers
        # from one bad parse, and the retry path re-asks the same question.
        "temperature": 0.2,
        "max_tokens": 8192,
        # Every row carries the document's own words for what supports it.
        "justifications_enabled": True,
    }

    existing = session.exec(
        select(AnnotationRun).where(
            AnnotationRun.infospace_id == infospace_id, AnnotationRun.name == RUN
        ).order_by(AnnotationRun.id.desc())
    ).first() if run_id is None else session.get(AnnotationRun, run_id)

    if existing is not None:
        existing.configuration = {**(existing.configuration or {}), **config}
        existing.source_bundle_id = bundle_id
        existing.live = True
        existing.views_config = _dashboard(schema_id, anchors)
        # A caught-up run is left alone; anything else is re-pended so a re-seed
        # is also a resume. The pair-level skip makes that idempotent.
        if existing.status not in (RunStatus.COMPLETED, RunStatus.COMPLETED_WITH_ERRORS):
            existing.status = RunStatus.PENDING
        session.add(existing)
        session.commit()
        session.refresh(existing)
        _link_schema(session, existing.id, schema_id)
        return existing

    run = AnnotationService(session=session).create_run(
        user_id=uid, infospace_id=infospace_id,
        run_in=AnnotationRunCreate(
            name=RUN,
            description="Live: annotates whatever lands in the Global Live subtree.",
            schema_ids=[schema_id],
            source_bundle_id=bundle_id,
            live=True,
            configuration=config,
            views_config=_dashboard(schema_id, anchors),
            trigger_type="source_poll",
            tags=["global-live"],
        ),
        queue_task=True,
    )
    return run


def _link_schema(session: Session, run_id: int, schema_id: int) -> None:
    """Declare that this run's lens is EXACTLY this schema.

    A run must declare its schemas or the dashboard has no contract to read —
    annotations carry a ``schema_id`` each, so a graph assembles perfectly from
    the CLI with the link row missing, which is exactly how that goes unnoticed.

    Exactly, not additionally: Global Live has one lens, and editing the lens
    mints a new schema *version* (an active schema is unique on name+version).
    An insert-only link would leave the run pointed at both, so every asset
    would be annotated twice, against two contracts, and the panel would offer
    a field picker over a union that no single annotation satisfies.
    """
    session.execute(sql_text(
        "DELETE FROM runschemalink WHERE run_id = :r AND schema_id <> :s"
    ), {"r": run_id, "s": schema_id})
    session.execute(sql_text(
        "INSERT INTO runschemalink (run_id, schema_id) VALUES (:r, :s) "
        "ON CONFLICT DO NOTHING"
    ), {"r": run_id, "s": schema_id})
    session.commit()


def seed(session: Session, *, owner_email: Optional[str] = None,
         provider: str = "llamacpp", model: Optional[str] = None,
         activate: bool = True) -> dict[str, Any]:
    """Compose Global Live. Idempotent — run it as often as you like."""
    from app.api.modules.annotation.templates import list_templates

    uid, email = _owner(session, owner_email)
    space = _infospace(session, uid)
    root = _bundle(session, infospace_id=space.id, uid=uid, name=BUNDLE,
                   description="Everything the monitor has seen.")
    sources = _sources(session, infospace_id=space.id, uid=uid,
                       parent_bundle_id=root.id, activate=activate)
    schema = _schema(session, infospace_id=space.id, uid=uid)

    model = model or _first_model(provider, space.id, session)
    template = next(t for t in list_templates() if t.id == LENS)
    run = _run(session, infospace_id=space.id, uid=uid, schema_id=schema.id,
               bundle_id=root.id, provider=provider, model=model,
               anchors=template.doc_anchors())
    _link_schema(session, run.id, schema.id)

    return {
        "owner": email, "user": uid,
        "infospace": space.id, "infospace_name": space.name, "bundle": root.id,
        "sources": {s.name: s.id for s in sources},
        "schema": schema.id, "schema_version": schema.version,
        "run": run.id, "provider": provider, "model": model,
    }


def _first_model(provider: str, infospace_id: int, session: Session) -> str:
    """Ask the endpoint what it is serving right now.

    A local llama-server serves exactly one GGUF, and its name is a file path
    nobody wants to type. ``list_models`` is the door for runtime discovery —
    declared specs first, then whatever the endpoint reports.
    """
    import asyncio
    from app.api.modules.foundation_service_providers import list_models

    specs = asyncio.run(list_models("language", provider,
                                    infospace_id=infospace_id, session=session))
    if not specs:
        raise SystemExit(
            f"{provider} reports no models — is the server up? "
            f"Pass --model to name one explicitly."
        )
    return specs[0].name


# ─── Kick ────────────────────────────────────────────────────────────────────


def kick(infospace_id: int) -> None:
    """Run the beat's work now instead of waiting for it.

    Two fan-outs, in the order the cascade runs: poll the due sources, then
    reconcile the live run over whatever landed. Both are the *same* dispatch
    the scheduler performs — there is no manual path being tested here.

    ``load_task_modules()`` first, and it is not optional. ``kick_tasks`` walks
    *this process's* @task registry, which is populated by the decorators as
    their modules import. A CLI entrypoint imports none of them, so a kick from
    here silently dispatched only the handful of tasks something else had
    happened to pull in — the same contract the web process satisfies at
    startup, and a third process kind has to satisfy it too.
    """
    from app.core.celery_app import load_task_modules
    from app.core.dispatch import kick_tasks

    load_task_modules()
    kick_tasks(infospace_id, frozenset({"content", "source"}))
    kick_tasks(infospace_id, frozenset({"annotation"}))


# ─── Reset ───────────────────────────────────────────────────────────────────


def reset(infospace_id: int, run_id: int) -> dict[str, int]:
    """Empty Global Live's corpus and its run — and nothing else in the infospace.

    Used when the acquisition path itself changed: a re-poll alone cannot help,
    because tier-1 dedup recognises every identifier already ingested and never
    reaches ``fetch``.

    **Scoped by what Global Live created, never by the infospace.** This runs in
    the user's default infospace, which on this deployment holds forty thousand
    assets and twenty-two other active sources. An earlier version of this
    function deleted by ``infospace_id``, which was survivable only for as long
    as Global Live owned an infospace of its own. It does not any more.

    Three predicates carry the whole safety property:

    .. code-block:: text

        annotations   run_id = ours
        assets        source_id ∈ our sources  AND  nothing still annotates it
        jobs          source_id ∈ our sources

    The second clause is the conservative half and it is deliberate: an asset
    someone else has annotated — from their own run, over content we happened to
    ingest — is no longer only ours to remove. It stays, and the re-poll simply
    recognises it. Same rule as ``annotation/scenario.py:_clear_run``, which
    exists because a cleanup that filtered on "everything that is not mine"
    once destroyed four rows that were not its.
    """
    from app.api.modules.annotation.models import AnnotationRun, RunStatus
    from app.api.modules.annotation.tasks.annotate import WATERMARK_KEY

    removed: dict[str, int] = {}
    with Session(engine) as session:
        sources = gl_sources(session, infospace_id)
        source_ids = [s.id for s in sources]
        if not source_ids:
            raise SystemExit("no Global Live sources found — nothing this module owns")

        # The run's own annotations go first, which is what makes its assets
        # eligible for removal in the next step.
        removed["annotations"] = session.execute(sql_text(
            "DELETE FROM annotation WHERE run_id = :r"
        ), {"r": run_id}).rowcount

        victims = session.execute(sql_text("""
            SELECT a.id FROM asset a
             WHERE (a.source_id = ANY(:src)
                    OR a.parent_asset_id IN (
                         SELECT id FROM asset WHERE source_id = ANY(:src)))
               AND NOT EXISTS (SELECT 1 FROM annotation n WHERE n.asset_id = a.id)
        """), {"src": source_ids}).scalars().all()

        if victims:
            removed["chunks"] = session.execute(sql_text(
                "DELETE FROM assetchunk WHERE asset_id = ANY(:ids)"
            ), {"ids": list(victims)}).rowcount
            removed["assets"] = session.execute(sql_text(
                "DELETE FROM asset WHERE id = ANY(:ids)"
            ), {"ids": list(victims)}).rowcount
        else:
            removed["chunks"] = removed["assets"] = 0

        removed["jobs"] = session.execute(sql_text(
            "DELETE FROM ingestionjob WHERE source_id = ANY(:src)"
        ), {"src": source_ids}).rowcount
        session.commit()

        now = datetime.now(timezone.utc)
        for src in gl_sources(session, infospace_id):
            # The cursor is what a source remembers about what it has already
            # yielded (web_search keeps `seen_urls`). Clearing the corpus without
            # clearing the cursor leaves a source convinced it already delivered.
            src.cursor_state = {}
            src.next_poll_at = now
            src.items_last_poll = 0
            src.total_items_ingested = 0
            src.consecutive_failures = 0
            src.error_message = None
            session.add(src)

        run = session.get(AnnotationRun, run_id)
        if run:
            cfg = dict(run.configuration or {})
            cfg.pop(WATERMARK_KEY, None)   # the stream cursor, now pointing past nothing
            run.configuration = cfg
            run.status = RunStatus.COMPLETED   # caught up; live_runs re-pends on arrival
            run.progress_total = None
            run.progress_current = 0
            session.add(run)
        session.commit()
    return removed


# ─── The dashboard ───────────────────────────────────────────────────────────

_BAR = "─" * 78


def _fetch(session: Session, infospace_id: int, run_id: int) -> dict[str, Any]:
    """One read of everything the dashboard shows. Read-only, no ORM loading."""
    from app.api.modules.annotation.models import AnnotationRun
    from app.api.modules.content.tree import subtree_ids

    run = session.get(AnnotationRun, run_id)
    bundle_id = run.source_bundle_id if run else None
    bids = list(subtree_ids(session, {bundle_id})) if bundle_id else []

    # Ours only — the infospace holds the user's own feeds too.
    source_ids = [s.id for s in gl_sources(session, infospace_id)]
    sources = session.execute(sql_text("""
        SELECT s.id, s.name, s.kind, s.status, s.is_active, s.poll_interval_seconds,
               s.last_poll_at, s.next_poll_at, s.items_last_poll,
               s.total_items_ingested, s.consecutive_failures, s.error_message,
               b.name AS register
          FROM source s LEFT JOIN bundle b ON b.id = s.output_bundle_id
         WHERE s.id = ANY(:src)
         ORDER BY b.name, s.name
    """), {"src": source_ids or [0]}).mappings().all()

    jobs = session.execute(sql_text("""
        SELECT status, count(*) AS n FROM ingestionjob
         WHERE source_id = ANY(:src) GROUP BY status
    """), {"src": source_ids or [0]}).mappings().all()

    assets = session.execute(sql_text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE created_at > now() - interval '1 hour') AS last_hour,
               avg(length(coalesce(text_content, ''))) AS avg_chars
          FROM asset
         WHERE infospace_id = :i AND parent_asset_id IS NULL
           AND bundle_ids && CAST(:b AS int[])
    """), {"i": infospace_id, "b": bids or [0]}).mappings().first()

    anns = session.execute(sql_text("""
        SELECT count(*) AS total,
               count(*) FILTER (WHERE status = 'FAILED') AS failed,
               max(created_at) AS latest
          FROM annotation WHERE run_id = :r
    """), {"r": run_id}).mappings().first()

    # The one number that says whether the monitor is keeping up: assets in
    # scope that this run has no annotation for.
    backlog = session.execute(sql_text("""
        SELECT count(*) FROM asset a
         WHERE a.infospace_id = :i AND a.parent_asset_id IS NULL
           AND a.bundle_ids && CAST(:b AS int[])
           AND NOT EXISTS (SELECT 1 FROM annotation n
                            WHERE n.asset_id = a.id AND n.run_id = :r)
    """), {"i": infospace_id, "b": bids or [0], "r": run_id}).scalar()

    return {"run": run, "sources": sources, "jobs": jobs, "assets": assets,
            "anns": anns, "backlog": backlog, "bundles": bids}


def _fill(session: Session, run_id: int, limit: int = 400) -> dict[str, Any]:
    """How much of the lens the model is actually filling.

    The single most useful thing to learn from a live run, and invisible from
    any canvas: an unfilled binding renders as *nothing*, not as an error.

    Sections come from the run's own contract, never from a list here. A
    hardcoded one silently stops reporting the moment the lens gains a section —
    which is exactly the failure mode this function exists to catch.
    """
    from app.api.modules.annotation.schema_map import schema_map_for

    contract = session.execute(sql_text("""
        SELECT s.output_contract FROM annotationschema s
          JOIN runschemalink l ON l.schema_id = s.id
         WHERE l.run_id = :r LIMIT 1
    """), {"r": run_id}).scalar() or {}
    smap = schema_map_for(contract)
    sections = [p.removeprefix("document.").removesuffix("[*]")
                for p in smap.section_decls]

    rows = session.execute(sql_text("""
        SELECT value FROM annotation
         WHERE run_id = :r AND status != 'FAILED'
         ORDER BY id DESC LIMIT :n
    """), {"r": run_id, "n": limit}).scalars().all()

    counts: dict[str, int] = {}
    names: dict[str, set] = {}
    tally: dict[str, dict[str, int]] = {}
    scores: dict[str, list[int]] = {}

    def _note(bag: str, value: Any) -> None:
        if isinstance(value, str) and value:
            tally.setdefault(bag, {})
            tally[bag][value] = tally[bag].get(value, 0) + 1
        elif isinstance(value, int) and not isinstance(value, bool):
            scores.setdefault(bag, []).append(value)

    for value in rows:
        doc = (value or {}).get("document")
        doc = doc if isinstance(doc, dict) else (value or {})
        # Document rung — the register fields. What makes a multi-source corpus
        # comparable rather than merely large.
        for key in ("source_kind", "frame", "salience", "uncertainty"):
            _note(key, doc.get(key))
        for section in sections:
            items = doc.get(section)
            if not isinstance(items, list) or not items:
                continue
            counts[section] = counts.get(section, 0) + len(items)
            for it in items:
                if not isinstance(it, dict):
                    continue
                if it.get("name"):
                    names.setdefault(section, set()).add(it["name"])
                for key in ("kind", "modality", "position", "category"):
                    _note(key, it.get(key))
                for key in ("intensity", "consequence", "certainty", "strength",
                            "confidence", "credibility", "scale", "publicity"):
                    _note(key, it.get(key))

    return {"n": len(rows), "sections": sections, "counts": counts,
            "names": {k: len(v) for k, v in names.items()},
            "tally": tally,
            "scores": {k: (sum(v) / len(v), len(v)) for k, v in scores.items() if v}}


def _ago(ts: Optional[datetime]) -> str:
    if ts is None:
        return "—"
    if ts.tzinfo is None:
        ts = ts.replace(tzinfo=timezone.utc)
    delta = (datetime.now(timezone.utc) - ts).total_seconds()
    if delta < 0:
        return f"in {int(-delta)//60}m" if -delta > 90 else f"in {int(-delta)}s"
    if delta < 90:
        return f"{int(delta)}s ago"
    if delta < 5400:
        return f"{int(delta)//60}m ago"
    return f"{int(delta)//3600}h ago"


def render(session: Session, infospace_id: int, run_id: int) -> str:
    """The whole dashboard, as text."""
    d = _fetch(session, infospace_id, run_id)
    run = d["run"]
    out: list[str] = []
    w = out.append

    cfg = (run.configuration or {}) if run else {}
    w(f"\033[1m{RUN}\033[0m   infospace {infospace_id} · run {run_id} · "
      f"{cfg.get('provider')}/{str(cfg.get('model'))[:46]}")
    w(f"{datetime.now().strftime('%H:%M:%S')}   {_BAR[:60]}")

    w("")
    w(f"  {'REGISTER':22} {'SOURCE':34} {'LAST':>9} {'NEXT':>9} {'NEW':>4} {'TOTAL':>6}")
    for s in d["sources"]:
        flag = "" if s["is_active"] else " (paused)"
        fail = f"  !{s['consecutive_failures']}" if s["consecutive_failures"] else ""
        w(f"  {str(s['register'] or '—')[:22]:22} {(s['name'] + flag)[:34]:34} "
          f"{_ago(s['last_poll_at']):>9} {_ago(s['next_poll_at']):>9} "
          f"{s['items_last_poll']:>4} {s['total_items_ingested']:>6}{fail}")
        if s["error_message"]:
            w(f"  {'':22} \033[31m{s['error_message'][:70]}\033[0m")

    jobs = ", ".join(f"{j['status']} {j['n']}" for j in d["jobs"]) or "none"
    a = d["assets"] or {}
    w("")
    w(f"  corpus     {a.get('total') or 0} assets "
      f"(+{a.get('last_hour') or 0} last hour), "
      f"mean {int(a.get('avg_chars') or 0)} chars   ·   jobs: {jobs}")

    n = d["anns"] or {}
    status = run.status.value if run and run.status else "?"
    live = "live" if (run and run.live) else "NOT LIVE"
    prog = (f"{run.progress_current or 0}/{run.progress_total}"
            if run and run.progress_total else "—")
    w(f"  run        {status} · {live} · progress {prog} · "
      f"{n.get('total') or 0} annotations "
      f"({n.get('failed') or 0} failed, latest {_ago(n.get('latest'))}) · "
      f"backlog {d['backlog']}")

    f = _fill(session, run_id)
    if f["n"]:
        out.append("")
        out.append(f"  \033[1mfill\033[0m over the last {f['n']} annotations")
        cells = [f"{s_}:{f['counts'].get(s_, 0)}" for s_ in f["sections"]]
        # Two lines — twelve sections do not fit on one at any sane width.
        out.append("    rows       " + "  ".join(cells[:6]))
        out.append("               " + "  ".join(cells[6:]))
        if f["names"]:
            out.append("    distinct   " + "  ".join(
                f"{k}:{v}" for k, v in sorted(f["names"].items())))
        for bag in ("kind", "modality", "position", "frame", "source_kind"):
            if bag in f["tally"]:
                top = sorted(f["tally"][bag].items(), key=lambda kv: -kv[1])[:7]
                out.append(f"    {bag + ' ' * max(1, 11 - len(bag))}" + "  ".join(f"{k}:{v}" for k, v in top))
        if f["scores"]:
            out.append("    scores     " + "  ".join(
                f"{k} μ{avg:.1f}/{n}" for k, (avg, n) in sorted(f["scores"].items())))
        if "modality" not in f["tally"]:
            out.append("    \033[33mmodality empty — every edge paints as asserted\033[0m")
    else:
        out.append("")
        out.append("  fill       no annotations yet")

    return "\n".join(out)


def watch(infospace_id: int, run_id: int, interval: int, cycles: Optional[int],
          do_kick: bool) -> None:
    """Redraw until interrupted. Optionally kicks the beat each cycle."""
    i = 0
    try:
        while cycles is None or i < cycles:
            if do_kick:
                kick(infospace_id)
            with Session(engine) as s:
                frame = render(s, infospace_id, run_id)
            sys.stdout.write("\033[2J\033[H" + frame + "\n")
            sys.stdout.flush()
            i += 1
            if cycles is not None and i >= cycles:
                break
            time.sleep(interval)
    except KeyboardInterrupt:
        print()


# ─── Entry ───────────────────────────────────────────────────────────────────


def _locate(session: Session, owner_email: Optional[str]) -> tuple[int, int]:
    """(infospace_id, run_id) for an already-seeded Global Live."""
    from app.api.modules.annotation.models import AnnotationRun

    uid, _ = _owner(session, owner_email)
    space = _infospace(session, uid)
    run = session.exec(
        select(AnnotationRun)
        .where(AnnotationRun.infospace_id == space.id, AnnotationRun.name == RUN)
        .order_by(AnnotationRun.id.desc())
    ).first()
    if run is None:
        raise SystemExit(
            f"no run named {RUN!r} in infospace {space.id} ({space.name!r}) — "
            f"run `seed` first")
    return space.id, run.id


def main() -> None:
    # This is a reader, not a server: the service chatter that is useful in a
    # worker log is noise above a dashboard. Warnings and errors still show.
    import logging
    for noisy in ("app.api.modules.identity_infospace_user.services.infospace_service",
                  "app.api.modules.content.services.source_service"):
        logging.getLogger(noisy).setLevel(logging.WARNING)

    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command",
                    choices=["seed", "kick", "watch", "status", "report", "reset",
                             "pause", "resume"])
    ap.add_argument("--owner", default=None,
                    help="email of the owner (default: this deployment's superuser)")
    ap.add_argument("--provider", default="llamacpp")
    ap.add_argument("--model", default=None,
                    help="default: whatever the endpoint reports first")
    ap.add_argument("--interval", type=int, default=20, help="watch redraw seconds")
    ap.add_argument("--cycles", type=int, default=None, help="watch: stop after N")
    ap.add_argument("--kick", action="store_true",
                    help="watch: dispatch the beat's work each cycle")
    args = ap.parse_args()

    if args.command == "seed":
        with Session(engine) as s:
            ids = seed(s, owner_email=args.owner, provider=args.provider,
                       model=args.model)
        print(json.dumps(ids, indent=2))
        print(f"\n  kick:    python -m app.cli.global_live kick")
        print(f"  watch:   python -m app.cli.global_live watch --kick")
        print(f"  inspect: python -m app.api.modules.annotation.inspect_run {ids['run']}")
        return

    with Session(engine) as s:
        iid, rid = _locate(s, args.owner)

    if args.command == "kick":
        kick(iid)
        print(f"dispatched content+annotation work for infospace {iid}")
    elif args.command == "reset":
        print(json.dumps(reset(iid, rid), indent=2))
    elif args.command == "watch":
        watch(iid, rid, args.interval, args.cycles, args.kick)
    elif args.command == "status":
        with Session(engine) as s:
            print(render(s, iid, rid))
    elif args.command == "report":
        from app.api.modules.annotation.inspect_run import inspect
        inspect(rid)
    elif args.command in ("pause", "resume"):
        from app.api.modules.annotation.models import AnnotationRun
        live = args.command == "resume"
        with Session(engine) as s:
            # OUR sources. This once read every Source in the infospace, which
            # in the default infospace is twenty-two feeds the user is running
            # for their own reasons.
            ours = gl_sources(s, iid)
            for src in ours:
                src.is_active = live
                s.add(src)
            run = s.get(AnnotationRun, rid)
            run.live = live
            s.add(run)
            s.commit()
        print(f"Global Live {'resumed' if live else 'paused'} "
              f"({len(ours)} sources, run {rid})")


if __name__ == "__main__":
    main()
