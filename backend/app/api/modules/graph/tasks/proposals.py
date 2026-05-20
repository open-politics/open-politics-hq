"""Resolution proposals — user-invocable scan task.

Scans entities (within a canon) and/or predicates (within a graph or
infospace) for similarity-based merge candidates. Streams proposals via
``ctx.send``; never writes to the DB.

This replaces the old auto-scheduled ``re_resolve_singletons`` task with a
user-invocable action: scans propose, the user reviews, the user confirms
via existing merge endpoints. No automatic resolution.

Both entities and predicates use embedding similarity (same provider).
Predicates are short-string targets — embeddings work, but the threshold
should typically be tighter than for entities (predicates collide on
synonyms, not transliterations).

Invocation: ``POST /infospaces/{iid}/action/propose-resolutions`` →
returns a watch URL → frontend subscribes and renders proposals as they
arrive. User accepts proposals one at a time (or in bulk) via the
existing canon merge / predicate rename routes.
"""

from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import text
from sqlmodel import select

from app.api.modules.graph.models import Entity, GraphEdge, KnowledgeGraph, Canon
from app.api.modules.graph.schemas import (
    ProposeResolutionsParams,
    ResolutionProposal,
)
from app.core.task_utils import run_async_in_celery
from app.core.tasks import TaskContext, task

logger = logging.getLogger(__name__)


def _embed_strings(session, infospace_id: int, strings: list[str]) -> Optional[list[list[float]]]:
    """Embed a batch of strings using the infospace's configured provider.

    Returns ``None`` if no embedding provider is configured or the call fails;
    the caller should skip embedding-based passes in that case.
    """
    try:
        from app.api.modules.embedding.embed import embed_texts
        from app.api.modules.foundation_service_providers import get_selection
        sel = get_selection(session, infospace_id, "embedding")
        if not sel or not sel.model_name:
            return None
        vectors, _em = run_async_in_celery(embed_texts, session, infospace_id, strings)
        return vectors if vectors else None
    except Exception as e:
        logger.warning("propose_resolutions: embedding failed: %s", e)
        return None


def _cosine(a: list[float], b: list[float]) -> float:
    """Quick cosine — bounded inputs already have similar magnitudes from
    embedding providers, so we don't normalize aggressively here.
    """
    import math
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


def _propose_entity_pairs(
    session,
    canon_id: int,
    infospace_id: int,
    threshold: float,
    entity_type_filter: Optional[list[str]],
    max_proposals: int,
) -> list[ResolutionProposal]:
    """Scan entities in the canon for embedding-similar pairs of the same type.

    The "keep" entity is the one with the longer canonical_name (more specific
    label tends to be the better canonical). Caller can override via the
    confirm step.
    """
    stmt = select(Entity).where(Entity.canon_id == canon_id)
    if entity_type_filter:
        stmt = stmt.where(Entity.entity_type.in_(entity_type_filter))
    entities = session.exec(stmt).all()
    if len(entities) < 2:
        return []

    # Group by entity_type — only same-type pairs are merge candidates.
    by_type: dict[str, list[Entity]] = {}
    for e in entities:
        by_type.setdefault(e.entity_type, []).append(e)

    proposals: list[ResolutionProposal] = []
    for etype, group in by_type.items():
        if len(group) < 2:
            continue

        # Use whichever embedding dim the entities have populated. We pick the
        # first non-null dim and only compare entities sharing that dim.
        dims = [384, 512, 768, 1024, 1536, 2048]
        for dim in dims:
            col = f"embedding_{dim}"
            with_emb = [e for e in group if getattr(e, col) is not None]
            if len(with_emb) < 2:
                continue
            for i in range(len(with_emb)):
                if len(proposals) >= max_proposals:
                    return proposals
                for j in range(i + 1, len(with_emb)):
                    a = with_emb[i]
                    b = with_emb[j]
                    sim = _cosine(getattr(a, col), getattr(b, col))
                    if sim < threshold:
                        continue
                    keep, cand = (a, b) if len(a.canonical_name) >= len(b.canonical_name) else (b, a)
                    proposals.append(ResolutionProposal(
                        kind="entity",
                        keep=keep.canonical_name,
                        keep_id=keep.id,
                        candidates=[cand.canonical_name],
                        candidate_ids=[cand.id],
                        similarity=round(sim, 4),
                        type=etype,
                    ))
            break  # processed the first available dim — don't double-emit
    return proposals


def _propose_predicate_pairs(
    session,
    infospace_id: int,
    graph_id: Optional[int],
    threshold: float,
    max_proposals: int,
) -> list[ResolutionProposal]:
    """Scan distinct predicate strings on GraphEdges for embedding-similar pairs.

    The "keep" predicate is the more frequent one; ties broken by string
    length (shorter name wins, on the assumption that shorter is more
    canonical — e.g. ``met`` over ``had_a_meeting_with``).
    """
    where_clause = "WHERE predicate IS NOT NULL"
    params: dict = {}
    if graph_id is not None:
        where_clause += " AND graph_id = :gid"
        params["gid"] = graph_id
    else:
        where_clause += " AND infospace_id = :iid"
        params["iid"] = infospace_id

    rows = session.execute(text(f"""
        SELECT predicate, count(*) AS cnt
          FROM graphedge
         {where_clause}
         GROUP BY predicate
         ORDER BY cnt DESC
    """), params).fetchall()
    predicates = [(r.predicate, r.cnt) for r in rows if r.predicate]
    if len(predicates) < 2:
        return []

    strings = [p for p, _ in predicates]
    embeddings = _embed_strings(session, infospace_id, strings)
    if not embeddings:
        return []

    proposals: list[ResolutionProposal] = []
    for i in range(len(predicates)):
        if len(proposals) >= max_proposals:
            break
        for j in range(i + 1, len(predicates)):
            sim = _cosine(embeddings[i], embeddings[j])
            if sim < threshold:
                continue
            a_pred, a_cnt = predicates[i]
            b_pred, b_cnt = predicates[j]
            # Keep = higher count; tiebreak by shorter string.
            if a_cnt > b_cnt or (a_cnt == b_cnt and len(a_pred) <= len(b_pred)):
                keep, cand = a_pred, b_pred
            else:
                keep, cand = b_pred, a_pred
            proposals.append(ResolutionProposal(
                kind="predicate",
                keep=keep,
                candidates=[cand],
                similarity=round(sim, 4),
            ))
            if len(proposals) >= max_proposals:
                break
    return proposals


@task(
    "propose_resolutions",
    queue="default",
    params_model=ProposeResolutionsParams,
    tags=frozenset({"graph", "resolution"}),
    schedule=None,
    max_concurrency=2,
    timeout=600,
)
def propose_resolutions(
    ctx: TaskContext,
    _ids: list[int],
    params: ProposeResolutionsParams,
):
    """Scan entities and/or predicates for similarity-based merge proposals.

    Streams ``ctx.send(topic="resolution.proposals", event="proposal", ...)``
    for each proposal. Never writes to DB. User reviews and confirms via
    existing merge / rename routes.
    """
    topic = "resolution.proposals"
    resource_id = f"{params.target}:{params.canon_id or '-'}:{params.graph_id or '-'}:{ctx.task_id or 'direct'}"

    if params.target in ("entities", "both") and params.canon_id is None:
        ctx.send(topic, resource_id, "error", {"detail": "canon_id required for entity target"})
        return
    if params.target in ("predicates", "both") and params.graph_id is None:
        # Predicates can scope to infospace globally; only warn, don't error.
        logger.info("propose_resolutions: scanning predicates infospace-wide (graph_id omitted)")

    proposals: list[ResolutionProposal] = []

    with ctx.session() as session:
        if params.target in ("entities", "both"):
            canon = session.get(Canon, params.canon_id)
            if not canon or canon.infospace_id != ctx.infospace_id:
                ctx.send(topic, resource_id, "error", {"detail": f"canon {params.canon_id} not in infospace"})
                return
            entity_proposals = _propose_entity_pairs(
                session,
                canon_id=params.canon_id,
                infospace_id=ctx.infospace_id,
                threshold=params.threshold,
                entity_type_filter=params.entity_type_filter,
                max_proposals=params.max_proposals,
            )
            proposals.extend(entity_proposals)
            for p in entity_proposals:
                ctx.send(topic, resource_id, "proposal", p.model_dump())

        if params.target in ("predicates", "both"):
            if params.graph_id is not None:
                graph = session.get(KnowledgeGraph, params.graph_id)
                if not graph or graph.infospace_id != ctx.infospace_id:
                    ctx.send(topic, resource_id, "error", {"detail": f"graph {params.graph_id} not in infospace"})
                    return
            remaining = max(0, params.max_proposals - len(proposals))
            if remaining > 0:
                predicate_proposals = _propose_predicate_pairs(
                    session,
                    infospace_id=ctx.infospace_id,
                    graph_id=params.graph_id,
                    threshold=params.threshold,
                    max_proposals=remaining,
                )
                proposals.extend(predicate_proposals)
                for p in predicate_proposals:
                    ctx.send(topic, resource_id, "proposal", p.model_dump())

    ctx.stat("entity_proposals", sum(1 for p in proposals if p.kind == "entity"))
    ctx.stat("predicate_proposals", sum(1 for p in proposals if p.kind == "predicate"))
    ctx.send(topic, resource_id, "done", {
        "total": len(proposals),
        "entities": sum(1 for p in proposals if p.kind == "entity"),
        "predicates": sum(1 for p in proposals if p.kind == "predicate"),
    })
