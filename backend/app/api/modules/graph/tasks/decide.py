"""The live resolver's two tasks — find pairs, then judge them one at a time.

    seed_entity_decisions    runs whose resolver is on and whose annotations
                             moved since the pairs were last found → build the
                             run's graph, add the new candidate pairs
    judge_entity_decisions   pending pairs of running resolvers, most-mentioned
                             first → ask the logic model, decide, apply, tell
                             the network

Both are ordinary `@task`s (MAP.md, "Calling logic from a task"): a check query
for the work left, a self-chain while there is more, the dispatcher's schedule
as the floor. Judging goes one pair at a time on the `logic` queue — the decision
endpoint answers one request at a time anyway, and a reader watching the network
sees each decision land. Pausing is the settings flag: the check stops finding
work, and a running batch re-reads it before every pair.

Every step is told to the network on ``stream(iid, "resolution", run_id)``:

    seeding   {}            the run's graph is being read for pairs
    judging   {decision}    the pair the model is looking at now
    decided   {decision}    the verdict, in effect (or parked as unsure)
    seeded    {added}       new pairs were found
"""
from __future__ import annotations

import logging
import types

from sqlalchemy import text
from sqlmodel import select

from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.graph import decisions as dec
from app.api.modules.graph.models import EntityDecision
from app.core.task_utils import run_async_in_celery
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)

TOPIC = "resolution"
_RUNNING = "(annotationrun.graph_config::jsonb -> 'resolution' ->> 'running')::boolean IS TRUE"


def _runs_to_seed(infospace_id: int):
    """Runs with the resolver on whose newest annotation is newer than the
    watermark their pairs were found at."""
    return (
        select(AnnotationRun.id)
        .where(AnnotationRun.infospace_id == infospace_id)
        .where(text(_RUNNING))
        .where(text("""
            COALESCE((annotationrun.graph_config::jsonb -> 'resolution' ->> 'seeded_watermark')::bigint, 0)
            < COALESCE((SELECT max(a.id) FROM annotation a WHERE a.run_id = annotationrun.id), 0)
        """))
    )


def _pending(infospace_id: int):
    return (
        select(EntityDecision.id)
        .join(AnnotationRun, AnnotationRun.id == EntityDecision.run_id)
        .where(EntityDecision.infospace_id == infospace_id)
        .where(EntityDecision.status == "pending")
        .where(text(_RUNNING))
        .order_by(EntityDecision.priority.desc(), EntityDecision.id)
    )


@task(
    "seed_entity_decisions",
    check=_runs_to_seed,
    batch=1,
    queue="default",
    max_concurrency=1,
    timeout=1800,
    schedule=300,
    tags=frozenset({"graph", "resolver"}),
)
def seed_entity_decisions(ctx: TaskContext, run_ids: list[int]):
    from app.api.modules.annotation import overview as ov
    from app.api.modules.graph.reading import collect, configure
    from app.core.dispatch import kick_tasks

    def judge_now(_added: int) -> None:
        kick_tasks(ctx.infospace_id, tags=frozenset({"resolver-judge"}))

    for run_id in run_ids:
        ctx.send(TOPIC, run_id, "seeding", {})
        with ctx.session() as session:
            # The run's own scope — this is the system reading its own run, not
            # a reader with a package grant.
            access = types.SimpleNamespace(infospace_id=ctx.infospace_id, scope=None)
            scope = ov.open_scope(session, access, run_id)
            watermark = ov.frame(scope)["watermark"]
            aq = scope.query()
            source, parsed = configure(aq)
            graph = collect(aq, source, parsed)
            run = session.get(AnnotationRun, run_id)
            added = dec.seed(session, run, graph, on_first=judge_now)
            dec.save_settings(session, run, seeded_watermark=watermark)
            session.commit()
        logger.info("seed_entity_decisions: run %s — %s new pairs", run_id, added)
        ctx.send(TOPIC, run_id, "seeded", {"added": added})
        if added:
            judge_now(added)


@task(
    "judge_entity_decisions",
    check=_pending,
    batch=5,
    queue="logic",
    max_concurrency=1,
    self_chain=True,
    capability="logic",
    timeout=900,
    schedule=60,
    tags=frozenset({"graph", "resolver", "resolver-judge"}),
)
def judge_entity_decisions(ctx: TaskContext, ids: list[int]):
    judge = ctx.provider("logic")
    for decision_id in ids:
        # Read everything fresh per pair: a pause, a scope change or a manual
        # decision made while the previous pair was being judged all count.
        with ctx.session() as session:
            row = session.get(EntityDecision, decision_id)
            if row is None or row.status != "pending":
                continue
            run = session.get(AnnotationRun, row.run_id)
            settings = dec.settings_of(run)
            if not settings.running:
                return
            questions = dec.questions_for(row, dec.run_types(session, row.run_id))
            state = row.state
            ctx.send(TOPIC, row.run_id, "judging", dec.to_wire(row))

        try:
            answers = run_async_in_celery(judge.judge, state, questions)
        except Exception as e:  # noqa: BLE001 — one pair must not stop the line
            from app.api.modules.foundation_service_providers import ProviderError
            if isinstance(e, ProviderError):
                raise
            logger.warning("judge_entity_decisions: pair %s failed: %s", decision_id, e)
            ctx.item_failed(decision_id)
            continue

        with ctx.session() as session:
            row = session.get(EntityDecision, decision_id)
            if row is None or row.status != "pending":
                continue                       # decided by hand meanwhile
            run = session.get(AnnotationRun, row.run_id)
            settings = dec.settings_of(run)
            canon_id = dec.canon_for(run, session) if settings.scope == "canon" else None
            dec.decide(session, row, answers, settings, canon_id)
            session.commit()
            ctx.send(TOPIC, row.run_id, "decided", dec.to_wire(row))
            ctx.stat(row.status)
