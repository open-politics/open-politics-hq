"""The live resolver — merge and type decisions on a run's graph entities.

    seed(run, graph)        candidate groups (`candidates.py`) → pending rows,
                            a head and its members, with the state the model
                            will be shown
    questions_for(rows)     one request per group: each member, the head? —
                            then the group's label and its type
    decide(rows, answers)   answers → merged · separate · unsure per member, applied
    rollback(row) · change(row, verdict)     a person's word, over the model's
    merge_by_hand(keep, others)              a person's merge of labels they picked

Decisions are rows (`EntityDecision`) and the rows are the truth: the network
reads every decision in effect and folds the pair into one node, the history is
the rows and their trails, and promote can fold them into a canon later. With
the run's resolver scope set to ``canon`` a merge is *also* written into the
run's canon at once — reversibly: an alias added, an entry created, a type
changed, each recorded in ``canon_effect`` so rollback takes back exactly that.

Settings live on the run, beside the other graph hints:

    run.graph_config["resolution"] = {running, scope, threshold, seeded_watermark}

A group's questions, one state, one request (the logic domain's unit):

    same:{id}  Noul    is this member the head's entity?     one per member
    name       Choice  which label should it carry?          → name, keep
    type       Choice  what is it? (every type in the group, and the run's commonest)

Asked together, every member is weighed beside the others and against one head,
so a merge is never a chain of pairs nobody saw side by side. Answered apart, a
member the model is unsure of is parked alone and does not hold back the rest.
"""
from __future__ import annotations

import logging
from collections.abc import Callable, Iterable, Mapping, Sequence
from datetime import UTC, datetime
from typing import Any, Literal

from pydantic import BaseModel, Field
from sqlalchemy import text
from sqlalchemy.orm.attributes import flag_modified
from sqlmodel import Session, select

from app.api.modules.foundation_service_providers.logic import Answer, Choice, Noul
from app.api.modules.graph.candidates import Candidate, Entity, Group, candidate_groups, fold, pair_key
from app.api.modules.graph.models import CanonEntry, EntityDecision
from app.api.modules.graph.resolution import find_by_alias, norm_type

logger = logging.getLogger(__name__)

#: Statuses whose verdict is in effect.
IN_EFFECT = ("merged", "separate")
#: Types offered beyond the pair's own: the run's commonest.
EXTRA_TYPES = 4
#: Co-mentioned names shown per label.
COMPANY = 5
#: Options a choice may carry — the logic wire's ceiling.
MAX_OPTIONS = 16


# ─── Settings ────────────────────────────────────────────────────────────────


class ResolverSettings(BaseModel):
    running: bool = False
    #: Where a new decision takes effect: the run (the network, promote later)
    #: or the run's canon as well, at once.
    scope: Literal["run", "canon"] = "run"
    #: Below this the model's answer is parked as `unsure` for a person.
    threshold: float = Field(default=0.8, ge=0.5, le=0.99)
    #: The run's annotation watermark the candidates were last found at.
    seeded_watermark: int | None = None


def settings_of(run: Any) -> ResolverSettings:
    gc = run.graph_config if isinstance(run.graph_config, dict) else {}
    return ResolverSettings.model_validate(gc.get("resolution") or {})


def save_settings(session: Session, run: Any, **patch: Any) -> ResolverSettings:
    current = settings_of(run).model_copy(update=patch)
    gc = dict(run.graph_config) if isinstance(run.graph_config, dict) else {}
    gc["resolution"] = current.model_dump()
    run.graph_config = gc
    flag_modified(run, "graph_config")
    session.add(run)
    return ResolverSettings.model_validate(gc["resolution"])


# ─── Seeding ─────────────────────────────────────────────────────────────────


def _state(g: Group, company: Mapping[str, list[str]], shared: Mapping[str, int], documents: int) -> str:
    def line(tag: str, e: Entity) -> str:
        with_ = company.get(f"{e.name}|{e.type}") or []
        tail = f" Appears with: {', '.join(with_)}." if with_ else ""
        return f'{tag} "{e.name}" — {e.type}, mentioned {e.frequency} times.{tail}'

    def together(e: Entity) -> str:
        n = shared.get(f"{e.name}|{e.type}", 0)
        return f" In the same document as the head {n} times." if n else " Never in the same document as the head."

    return "\n".join([
        f"Labels extracted from the same collection of {documents} documents.",
        line("Head:", g.head),
        *(line(f"{k}.", c.b) + together(c.b) for k, c in enumerate(g.members, 1)),
    ])


def _file(row: EntityDecision, g: Group, c: Candidate, state: str) -> None:
    """A pair as its group asks it: the head on ``a``, the group's rank and state."""
    row.a_name, row.a_type, row.b_name, row.b_type = c.a.name, c.a.type, c.b.name, c.b.type
    row.group_key, row.priority, row.state, row.reason = g.key, g.priority, state, c.reason


def seed(
    session: Session, run: Any, graph: Any, *, limit: int = 5000,
    first: int = 200, on_first: Callable[[int], None] | None = None,
) -> int:
    """Find candidate groups in *graph* (the run's ``GraphResultData``) and add
    their new pairs as pending decisions, each with the state the model will
    see. A pair is filed once; one already decided is never asked again.
    Returns how many were added.

    Waiting pairs are regrouped and re-ranked by their labels' current mentions.

    The most prominent ``first`` are committed on their own and ``on_first`` is
    told, so judging starts on them while the long tail is still being written —
    the reader sees decisions in seconds, not after every pair is filed."""
    nodes = [n for n in graph.nodes if getattr(n, "kind", "entity") == "entity"]
    by_key = {f"{n.name}|{n.type}": n for n in nodes}
    groups = candidate_groups(
        (Entity(n.name, n.type, n.frequency) for n in nodes), limit=limit,
    )
    if not groups:
        return 0
    wanted = {f"{e.name}|{e.type}" for g in groups for c in g.members for e in (c.a, c.b)}

    # Who each label keeps company with — its most frequent linked entities.
    at = {n.id: n for n in nodes}
    links: dict[str, list[Any]] = {}
    for e in graph.edges:
        for here, there in ((e.source, e.target), (e.target, e.source)):
            n = at.get(here)
            if n is not None and f"{n.name}|{n.type}" in wanted and there in at:
                links.setdefault(f"{n.name}|{n.type}", []).append(at[there])
    company = {
        key: [m.name for m in sorted({id(x): x for x in ns}.values(), key=lambda m: -m.frequency)[:COMPANY]]
        for key, ns in links.items()
    }
    documents = len({a for n in graph.nodes for a in n.source_annotation_ids})

    def state_of(g: Group) -> str:
        head = by_key.get(f"{g.head.name}|{g.head.type}")
        anns = set(head.source_annotation_ids) if head else set()
        shared = {}
        for c in g.members:
            n = by_key.get(f"{c.b.name}|{c.b.type}")
            shared[f"{c.b.name}|{c.b.type}"] = len(anns & set(n.source_annotation_ids)) if n else 0
        return _state(g, company, shared, documents)

    # A live run's labels keep gathering mentions: a pair still waiting moves
    # with them — into the group it belongs to now, up (or down) the queue, and
    # shown its current counts.
    pending = {
        r.pair_key: r for r in session.exec(
            select(EntityDecision)
            .where(EntityDecision.run_id == run.id, EntityDecision.status == "pending")
        ).all()
    }
    existing = set(session.exec(
        select(EntityDecision.pair_key).where(EntityDecision.run_id == run.id)
    ).all())
    added = 0
    for g in groups:
        state = state_of(g)
        for c in g.members:
            row = pending.get(c.key)
            if row is not None:
                _file(row, g, c, state)
                session.add(row)
                continue
            if c.key in existing:
                continue
            row = EntityDecision(infospace_id=run.infospace_id, run_id=run.id, pair_key=c.key)
            _file(row, g, c, state)
            session.add(row)
            existing.add(c.key)
            added += 1
            if added == first and on_first is not None:
                session.commit()
                on_first(added)
    return added


def run_types(session: Session, run_id: int, n: int = EXTRA_TYPES) -> list[str]:
    """The run's commonest entity types among its candidate pairs — the
    vocabulary a type question offers beyond the pair's own two."""
    rows = session.execute(text("""
        SELECT kind, count(*) AS c FROM (
            SELECT a_type AS kind FROM entity_decision WHERE run_id = :r
            UNION ALL SELECT b_type FROM entity_decision WHERE run_id = :r
        ) x GROUP BY kind ORDER BY c DESC LIMIT :n
    """), {"r": run_id, "n": n}).all()
    return [r.kind for r in rows]


# ─── Asking ──────────────────────────────────────────────────────────────────


def questions_for(rows: Sequence[EntityDecision], common_types: Iterable[str]) -> dict[str, Any]:
    """The questions about one group, in one request: each member against the
    head, then the label and the type the entity carries. A choice with a single
    option is no question and is left out — a group of one name under several
    types asks no name. Option keys are the caller's; the model only ever reads
    the descriptions."""
    head = rows[0]
    names: dict[str, str] = {}
    for n in (head.a_name, *(r.b_name for r in rows)):
        if fold(n) not in {fold(k) for k in names}:
            names[n] = f'"{n}"'
    types: dict[str, str] = {}
    for t in (head.a_type, *(r.b_type for r in rows), *common_types):
        if t and norm_type(t) not in {norm_type(k) for k in types}:
            types[t] = t
    questions: dict[str, Any] = {
        f"same:{r.id}": Noul(
            f'Do "{r.a_name}" ({r.a_type}) and "{r.b_name}" ({r.b_type}) name the same real-world entity?',
            true="One entity, written two ways or typed two ways.",
            false="Two different entities that happen to look alike.",
        )
        for r in rows
    }
    if len(names) > 1:
        questions["name"] = Choice(f'If they are one entity with "{head.a_name}", which label should it carry?', names)
    if len(types) > 1:
        questions["type"] = Choice(f'What kind of thing is "{head.a_name}"?', dict(list(types.items())[:MAX_OPTIONS]))
    return questions


# ─── Deciding ────────────────────────────────────────────────────────────────


def _snapshot(row: EntityDecision) -> dict[str, Any]:
    return {
        "status": row.status, "keep": row.keep, "type": row.type, "p_same": row.p_same,
        "confidence": row.confidence, "scope": row.scope, "by": row.decided_by,
        "at": row.decided_at.isoformat() if row.decided_at else None,
    }


def _record(row: EntityDecision) -> None:
    """Push the row's current verdict onto its trail before it changes."""
    if row.status != "pending":
        row.trail = [*(row.trail or []), _snapshot(row)]
        flag_modified(row, "trail")


def decide(
    session: Session,
    rows: Sequence[EntityDecision],
    answers: Mapping[str, Answer],
    settings: ResolverSettings,
    canon_id: int | None,
) -> Sequence[EntityDecision]:
    """Turn the model's answers about a group into a verdict per member, and
    put each in effect. The label and the type are the group's, on every row;
    whether a member joins is its own answer against the run's threshold."""
    head = rows[0]
    name = answers["name"].pick if "name" in answers else head.a_name
    kind = answers["type"].pick if "type" in answers else head.a_type
    p_type = dict(answers["type"].probabilities) if "type" in answers else None
    now = datetime.now(UTC)
    for row in rows:
        same = answers[f"same:{row.id}"]
        p = float(same.value)
        row.p_same, row.name, row.type, row.p_type = p, name, kind, p_type
        row.keep = "b" if fold(name) == fold(row.b_name) else "a"
        row.model, row.wire = same.model, same.wire
        if p >= settings.threshold:
            row.status, row.confidence = "merged", p
        elif p <= 1 - settings.threshold:
            row.status, row.confidence = "separate", 1 - p
        else:
            row.status, row.confidence = "unsure", max(p, 1 - p)
        row.decided_by = None
        row.decided_at = now
        row.scope = settings.scope
        if row.status == "merged" and settings.scope == "canon" and canon_id:
            row.canon_effect = _canon_merge(session, canon_id, row)
        session.add(row)
    return rows


def rollback(session: Session, row: EntityDecision, user_id: int) -> EntityDecision:
    """Undo a verdict: out of effect, out of the canon, never asked again."""
    _record(row)
    _undo_canon(session, row)
    row.status = "rolled_back"
    row.decided_by = user_id
    row.decided_at = datetime.now(UTC)
    session.add(row)
    return row


def change(
    session: Session,
    row: EntityDecision,
    user_id: int,
    *,
    verdict: Literal["merged", "separate"],
    keep: Literal["a", "b"] | None = None,
    type: str | None = None,
    scope: Literal["run", "canon"] = "run",
    canon_id: int | None = None,
) -> EntityDecision:
    """A person decides the pair — over whatever the model said. Their ``keep``
    names it; the group's label no longer does."""
    _record(row)
    _undo_canon(session, row)
    row.status = verdict
    row.keep = keep or row.keep or "a"
    row.name = None
    row.type = type or row.type or row.a_type
    row.confidence = 1.0
    row.decided_by = user_id
    row.decided_at = datetime.now(UTC)
    row.scope = scope
    if verdict == "merged" and scope == "canon" and canon_id:
        row.canon_effect = _canon_merge(session, canon_id, row)
    session.add(row)
    return row


def merge_by_hand(
    session: Session,
    run: Any,
    keep: Entity,
    others: Iterable[Entity],
    user_id: int,
    *,
    type: str | None = None,
    scope: Literal["run", "canon"] = "run",
    canon_id: int | None = None,
) -> list[EntityDecision]:
    """A person picks labels and says "one thing, called *keep*". Each other
    label becomes a merged pair with *keep* — the pair's own row where the
    resolver already filed it (its trail keeps what the model said), a new one
    where it never did — so history, rollback and the network read hand merges
    exactly like the model's."""
    out: list[EntityDecision] = []
    for other in others:
        key = pair_key(keep, other)
        if key == pair_key(keep, keep):
            continue
        row = session.exec(
            select(EntityDecision).where(EntityDecision.run_id == run.id, EntityDecision.pair_key == key)
        ).first()
        if row is None:
            row = EntityDecision(
                infospace_id=run.infospace_id, run_id=run.id,
                a_name=keep.name, a_type=keep.type, b_name=other.name, b_type=other.type,
                pair_key=key, reason="manual", priority=float(keep.frequency + other.frequency),
                state="Merged by hand.",
            )
            session.add(row)
            session.flush()
        side: Literal["a", "b"] = (
            "a" if (row.a_name.strip().lower(), row.a_type.strip().lower())
            == (keep.name.strip().lower(), keep.type.strip().lower()) else "b"
        )
        out.append(change(
            session, row, user_id, verdict="merged", keep=side, type=type or keep.type,
            scope=scope, canon_id=canon_id,
        ))
    return out


# ─── The canon, reversibly ───────────────────────────────────────────────────


def _names(row: EntityDecision) -> tuple[str, str, str]:
    """(the label the merge carries, the label it takes in, the kept side's
    type). A group may carry a third label of its own; the row's other side is
    then still the one taken in, and the head joins it through its own row."""
    kept, other = (row.a_name, row.b_name) if row.keep != "b" else (row.b_name, row.a_name)
    kept_type = row.a_type if row.keep != "b" else row.b_type
    return row.name or kept, other, kept_type


def _canon_merge(session: Session, canon_id: int, row: EntityDecision) -> dict[str, Any]:
    """Write a merge into the canon — only writes that can be taken back."""
    kept, other, kept_type = _names(row)
    target_type = row.type or kept_type
    entry = find_by_alias(session, canon_id, kept, target_type) or find_by_alias(session, canon_id, kept, kept_type)
    rival = find_by_alias(session, canon_id, other, target_type, exclude_entry_id=entry.id if entry else None)
    if entry and rival:
        # Two curated entries: combining them rewires references and cannot be
        # undone from here. The run layer carries the merge; the canon view is
        # where two entries become one.
        return {"skipped": "both names are canon entries — combine them in the canon view"}
    created = False
    if entry is None:
        entry = CanonEntry(infospace_id=row.infospace_id, canon_id=canon_id,
                           canonical=kept, type=target_type, aliases=[])
        session.add(entry)
        session.flush()
        created = True
    effect: dict[str, Any] = {"entry_id": entry.id, "created": created}
    aliases = list(entry.aliases or [])
    if other.strip().lower() not in {a.strip().lower() for a in aliases} | {entry.canonical.strip().lower()}:
        entry.aliases = [*aliases, other]
        effect["alias_added"] = other
    if norm_type(entry.type) != norm_type(target_type):
        effect["type_before"] = entry.type
        entry.type = target_type
    session.add(entry)
    return effect


def _undo_canon(session: Session, row: EntityDecision) -> None:
    effect = row.canon_effect or {}
    entry = session.get(CanonEntry, effect["entry_id"]) if effect.get("entry_id") else None
    if entry is not None:
        if effect.get("created"):
            session.delete(entry)
        else:
            if effect.get("alias_added"):
                entry.aliases = [a for a in (entry.aliases or []) if a != effect["alias_added"]]
            if effect.get("type_before"):
                entry.type = effect["type_before"]
            session.add(entry)
    row.canon_effect = None


def canon_for(run: Any, session: Session) -> int | None:
    """The canon a ``canon``-scoped decision writes into: the run's first,
    else the infospace's default."""
    ids = [c for c in (run.canon_ids or []) if c]
    if ids:
        return ids[0]
    from app.models import Infospace
    infospace = session.get(Infospace, run.infospace_id)
    return getattr(infospace, "default_canon_id", None)


# ─── Wire shape ──────────────────────────────────────────────────────────────


def to_wire(row: EntityDecision) -> dict[str, Any]:
    return {
        "id": row.id, "status": row.status, "reason": row.reason, "priority": row.priority,
        "group": row.group_key,
        "a": {"name": row.a_name, "type": row.a_type},
        "b": {"name": row.b_name, "type": row.b_type},
        "keep": row.keep, "name": row.name, "type": row.type, "p_same": row.p_same, "p_type": row.p_type,
        "confidence": row.confidence, "model": row.model, "scope": row.scope,
        "canon_effect": row.canon_effect, "by": row.decided_by,
        "at": row.decided_at.isoformat() if row.decided_at else None,
        "state": row.state, "trail": row.trail or [],
    }
