"""Label vectors — the *said* basis of meaning (``docs/plans/meaning/PLAN.md``).

    embed_labels   runs whose annotations moved since their labels were last
                   embedded → read what changed through the run's graph, embed
                   every node name not yet remembered

A node is embedded as it is shown: its name — an occurrence's display label —
alone, as canon entries are. ``embed_texts`` remembers per infospace and model
(``TextVector``), so a name shared by runs, or seen again, is embedded once, and
a reader wanting a label's vector later recalls it there. The run keeps only its
watermark: a vector belongs to the text, not to the graph.

Shaped like ``seed_entity_decisions``: a check query for runs whose change
clock (``annotation.seq``) passed ``graph_config.meaning.watermark``, one run
per call. After the first pass only the documents that changed are read. Gated
like the embedding enricher and on its queue, so labels fill in wherever
documents do and interleave with their batches. Names go out in slices, each
remembered as it lands: a timeout loses one slice, and the next pass recalls
the rest.

Told on ``stream(iid, "meaning", run_id)``: ``embedding {labels}``, then
``embedded {labels}``.
"""
from __future__ import annotations

import logging
import types

from sqlalchemy import text
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import select

from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.content.enrichers import enrichment_gate
from app.core.task_utils import run_async_in_celery
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)

TOPIC = "meaning"
#: Names per provider call — and per remembered step.
SLICE = 256


def watermark_of(run: AnnotationRun) -> int:
    gc = run.graph_config if isinstance(run.graph_config, dict) else {}
    return int((gc.get("meaning") or {}).get("watermark") or 0)


def _runs_to_embed(infospace_id: int):
    """Runs whose annotations changed since their labels were embedded — new
    rows and values filled in place both move ``seq``. Most recently worked
    first. A trial run is a draft's reading, not the run's: a reader reaching
    for it embeds on demand."""
    return (
        select(AnnotationRun.id)
        .where(AnnotationRun.infospace_id == infospace_id)
        .where(AnnotationRun.trial_of.is_(None))
        .where(text("""
            COALESCE((annotationrun.graph_config::jsonb -> 'meaning' ->> 'watermark')::bigint, 0)
            < COALESCE((SELECT max(a.seq) FROM annotation a WHERE a.run_id = annotationrun.id), 0)
        """))
        .order_by(AnnotationRun.updated_at.desc())
    )


def labels_of(ctx: TaskContext, run_id: int) -> tuple[list[str], int]:
    """The node names of what changed in the run since its watermark — all of
    it on the first pass — and the watermark they bring it to."""
    from app.api.modules.annotation import overview as ov
    from app.api.modules.graph.reading import collect, configure

    with ctx.session() as session:
        run = session.get(AnnotationRun, run_id)
        since = watermark_of(run)
        # The run's own scope — the system reading its own run, not a reader
        # with a package grant.
        access = types.SimpleNamespace(infospace_id=ctx.infospace_id, scope=None)
        scope = ov.open_scope(session, access, run_id)
        watermark = ov.frame(scope)["watermark"]
        aq = scope.query()
        if since:
            aq.assets(list(session.execute(
                text("SELECT DISTINCT asset_id FROM annotation WHERE run_id = :r AND seq > :since"),
                {"r": run_id, "since": since},
            ).scalars()))
        try:
            source, parsed = configure(aq)
        except ValueError:  # nothing graphable: a run with no labels
            return [], watermark
        graph = collect(aq, source, parsed)
    return sorted({n.name.strip() for n in graph.nodes if n.name and n.name.strip()}), watermark


@task(
    "embed_labels",
    check=_runs_to_embed,
    batch=1,
    queue="embedding",
    max_concurrency=1,
    capability="embedding",
    dispatch_filter=enrichment_gate("embedding", "embedding"),
    timeout=1800,
    schedule=300,
    tags=frozenset({"graph", "meaning"}),
)
def embed_labels(ctx: TaskContext, run_ids: list[int]):
    from app.api.modules.embedding.embed import embed_texts

    for run_id in run_ids:
        names, watermark = labels_of(ctx, run_id)
        ctx.send(TOPIC, run_id, "embedding", {"labels": len(names)})
        for start in range(0, len(names), SLICE):
            with ctx.session() as session:
                run_async_in_celery(embed_texts, session, ctx.infospace_id, names[start:start + SLICE])
        with ctx.session() as session:
            run = session.get(AnnotationRun, run_id)
            gc = dict(run.graph_config) if isinstance(run.graph_config, dict) else {}
            gc["meaning"] = {**(gc.get("meaning") or {}), "watermark": watermark}
            run.graph_config = gc
            flag_modified(run, "graph_config")
            session.add(run)
            session.commit()
        logger.info("embed_labels: run %s — %s labels", run_id, len(names))
        ctx.send(TOPIC, run_id, "embedded", {"labels": len(names)})
        ctx.stat("labels", len(names))
