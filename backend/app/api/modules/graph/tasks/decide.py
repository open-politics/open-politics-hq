"""The live resolver's two tasks — find groups, then judge them one at a time.

    seed_entity_decisions    runs whose resolver is on and whose annotations
                             moved since the pairs were last found → build the
                             run's graph, file the candidate groups
    judge_entity_decisions   pending pairs of running resolvers, most-mentioned
                             first → each pulls in its group, one request to the
                             logic model, a verdict per member, applied, told

Both are ordinary `@task`s (MAP.md, "Calling logic from a task"): a check query
for the work left, a self-chain while there is more, the dispatcher's schedule
as the floor. Judging goes one group at a time on the `logic` queue — the
decision endpoint answers one request at a time anyway, and a reader watching
the network sees each group land. Pausing is the settings flag: the check stops
finding work, and a running batch re-reads it before every group.

Every step is told to the network on ``stream(iid, "resolution", run_id)``:

    seeding   {}                      the run's graph is being read for pairs
    judging   {group, decisions}      the group the model is looking at now
    decided   {decision}              one member's verdict, in effect (or parked)
    seeded    {added}                 new pairs were found
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
    """Runs with the resolver on whose annotations changed since the watermark
    their pairs were found at — new rows or values filled in place, both move
    ``seq``, the run's change clock."""
    return (
        select(AnnotationRun.id)
        .where(AnnotationRun.infospace_id == infospace_id)
        .where(text(_RUNNING))
        .where(text("""
            COALESCE((annotationrun.graph_config::jsonb -> 'resolution' ->> 'seeded_watermark')::bigint, 0)
            < COALESCE((SELECT max(a.seq) FROM annotation a WHERE a.run_id = annotationrun.id), 0)
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


def _group(session, row: EntityDecision) -> list[EntityDecision]:
    """The pending rows asked together with *row* — or *row* alone, for a
    pair filed before groups."""
    if row.group_key is None:
        return [row]
    return list(session.exec(
        select(EntityDecision)
        .where(EntityDecision.run_id == row.run_id, EntityDecision.group_key == row.group_key,
               EntityDecision.status == "pending")
        .order_by(EntityDecision.id)
    ).all())


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
        # Read everything fresh per group: a pause, a scope change or a manual
        # decision made while the previous group was being judged all count.
        # A batch's later ids are mostly the same group, already decided here.
        with ctx.session() as session:
            row = session.get(EntityDecision, decision_id)
            if row is None or row.status != "pending":
                continue
            run = session.get(AnnotationRun, row.run_id)
            settings = dec.settings_of(run)
            if not settings.running:
                return
            rows = _group(session, row)
            member_ids = [r.id for r in rows]
            questions = dec.questions_for(rows, dec.run_types(session, row.run_id))
            state, run_id = row.state, row.run_id
            ctx.send(TOPIC, run_id, "judging", {"group": row.group_key, "decisions": [dec.to_wire(r) for r in rows]})

        try:
            answers = run_async_in_celery(judge.judge, state, questions)
        except Exception as e:  # noqa: BLE001 — one group must not stop the line
            from app.api.modules.foundation_service_providers import ProviderError
            if isinstance(e, ProviderError):
                raise
            logger.warning("judge_entity_decisions: group of %s failed: %s", decision_id, e)
            ctx.item_failed(decision_id)
            continue

        with ctx.session() as session:
            # A member decided by hand meanwhile keeps that decision; the rest
            # take the model's.
            rows = [r for r in (session.get(EntityDecision, i) for i in member_ids)
                    if r is not None and r.status == "pending"]
            if not rows:
                continue
            run = session.get(AnnotationRun, run_id)
            settings = dec.settings_of(run)
            canon_id = dec.canon_for(run, session) if settings.scope == "canon" else None
            dec.decide(session, rows, answers, settings, canon_id)
            session.commit()
            for r in rows:
                ctx.send(TOPIC, run_id, "decided", dec.to_wire(r))
                ctx.stat(r.status)
