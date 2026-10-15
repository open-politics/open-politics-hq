"""The live resolver of a run — its switch, its log, and a person's word over it.

    GET    …/runs/{run_id}/resolution                    settings + counts
    PATCH  …/runs/{run_id}/resolution                    run · pause · scope · threshold
    GET    …/runs/{run_id}/resolution/decisions          the history, newest first
    GET    …/runs/{run_id}/resolution/effect             what the network folds
    POST   …/runs/{run_id}/resolution/decisions/{id}/rollback
    PUT    …/runs/{run_id}/resolution/decisions/{id}     decide it by hand
    POST   …/runs/{run_id}/resolution/merge              merge labels a person picked

The model's side lives in ``graph/tasks/decide.py``; what a decision *is* and
how it takes effect, in ``graph/decisions.py``. A person's change goes out on
the same stream as the model's (``resolution`` · run id · ``decided``), so every
open network sees it land the same way.
"""
from __future__ import annotations

from typing import Any, Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import func
from sqlmodel import Session, select

from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.graph import decisions as dec
from app.api.modules.graph.candidates import Entity
from app.api.modules.graph.models import EntityDecision
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.core.db import engine
from app.core.stream import StreamWriter, stream_key

router = APIRouter(prefix="/infospaces/{infospace_id}/runs", tags=["Resolution"])

TOPIC = "resolution"


class ResolverState(BaseModel):
    running: bool
    scope: Literal["run", "canon"]
    threshold: float
    #: Where a ``canon``-scoped decision writes; null = no canon to write into.
    canon_id: int | None
    counts: dict[str, int] = Field(description="Decisions per status.")


class ResolverPatch(BaseModel):
    running: bool | None = None
    scope: Literal["run", "canon"] | None = None
    threshold: float | None = Field(default=None, ge=0.5, le=0.99)


class Side(BaseModel):
    name: str
    type: str


class EntityDecisionOut(BaseModel):
    id: int
    status: str
    reason: str
    priority: float
    a: Side
    b: Side
    keep: str | None = None
    type: str | None = None
    p_same: float | None = None
    p_type: dict[str, float] | None = None
    confidence: float | None = None
    model: str | None = None
    scope: str
    canon_effect: dict[str, Any] | None = None
    by: int | None = Field(default=None, description="Who decided; null = the model.")
    at: str | None = None
    state: str = Field(description="What the model was shown.")
    trail: list[dict[str, Any]] = Field(default_factory=list, description="Every earlier verdict, oldest first.")


class EntityDecisionPage(BaseModel):
    items: list[EntityDecisionOut]
    total: int
    offset: int


class ManualMerge(BaseModel):
    keep: Side = Field(description="The label the merged entity carries.")
    others: list[Side] = Field(min_length=1, max_length=200)
    type: str | None = Field(default=None, description="Its type; omitted = keep's.")


class ManualDecision(BaseModel):
    verdict: Literal["merged", "separate"]
    keep: Literal["a", "b"] | None = None
    type: str | None = None


def _run(session: Session, access: Access, run_id: int) -> AnnotationRun:
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if run is None or run.infospace_id != access.infospace_id:
        raise HTTPException(status_code=404, detail="run not found")
    return run


def _state(session: Session, run: AnnotationRun) -> ResolverState:
    s = dec.settings_of(run)
    counts = dict(session.exec(
        select(EntityDecision.status, func.count())
        .where(EntityDecision.run_id == run.id)
        .group_by(EntityDecision.status)
    ).all())
    return ResolverState(
        running=s.running, scope=s.scope, threshold=s.threshold,
        canon_id=dec.canon_for(run, session), counts=counts,
    )


def _announce(access: Access, run_id: int, event: str, data: Any) -> None:
    StreamWriter(stream_key(access.infospace_id, TOPIC, run_id)).send(event, data)


@router.get("/{run_id}/resolution", response_model=ResolverState)
def get_resolver(*, run_id: int, access: Access = Requires(scope=None)) -> Any:
    with Session(engine) as session:
        return _state(session, _run(session, access, run_id))


@router.patch("/{run_id}/resolution", response_model=ResolverState)
def patch_resolver(
    *, run_id: int, body: ResolverPatch, access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> Any:
    with Session(engine) as session:
        run = _run(session, access, run_id)
        patch = body.model_dump(exclude_none=True)
        if patch.get("scope") == "canon" and dec.canon_for(run, session) is None:
            raise HTTPException(status_code=422, detail="This run has no canon to write decisions into.")
        if body.running and not dec.settings_of(run).running:
            # Switched on: read the graph afresh, so the queue is ranked by the
            # labels' mentions as they are now, not when it was last read.
            patch["seeded_watermark"] = None
        dec.save_settings(session, run, **patch)
        session.commit()
        session.refresh(run)
        state = _state(session, run)
    _announce(access, run_id, "state", state.model_dump())
    if body.running:
        from app.core.dispatch import kick_tasks
        kick_tasks(access.infospace_id, tags=frozenset({"resolver"}))
    return state


@router.get("/{run_id}/resolution/decisions", response_model=EntityDecisionPage)
def list_entity_decisions(
    *,
    run_id: int,
    status: str | None = Query(default=None, description="One status; omitted = everything decided."),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    access: Access = Requires(scope=None),
) -> Any:
    with Session(engine) as session:
        _run(session, access, run_id)
        where = [EntityDecision.run_id == run_id]
        where.append(EntityDecision.status == status if status else EntityDecision.status != "pending")
        total = session.exec(select(func.count()).select_from(EntityDecision).where(*where)).one()
        order = (EntityDecision.priority.desc(),) if status == "pending" else (
            EntityDecision.decided_at.desc().nulls_last(), EntityDecision.id.desc())
        rows = session.exec(
            select(EntityDecision).where(*where).order_by(*order).offset(offset).limit(limit)
        ).all()
        return {"items": [dec.to_wire(r) for r in rows], "total": total, "offset": offset}


@router.get("/{run_id}/resolution/effect", response_model=list[EntityDecisionOut])
def entity_decisions_in_effect(*, run_id: int, access: Access = Requires(scope=None)) -> Any:
    """Every merge in effect — what the network folds into single nodes."""
    with Session(engine) as session:
        _run(session, access, run_id)
        rows = session.exec(
            select(EntityDecision)
            .where(EntityDecision.run_id == run_id, EntityDecision.status == "merged")
            .order_by(EntityDecision.decided_at)
        ).all()
        return [dec.to_wire(r) for r in rows]


def _decision(session: Session, run: AnnotationRun, decision_id: int) -> EntityDecision:
    row = session.get(EntityDecision, decision_id)
    if row is None or row.run_id != run.id:
        raise HTTPException(status_code=404, detail="decision not found")
    return row


@router.post("/{run_id}/resolution/decisions/{decision_id}/rollback", response_model=EntityDecisionOut)
def rollback_entity_decision(
    *, run_id: int, decision_id: int, access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> Any:
    with Session(engine) as session:
        run = _run(session, access, run_id)
        row = dec.rollback(session, _decision(session, run, decision_id), access.user_id)
        session.commit()
        out = dec.to_wire(row)
    _announce(access, run_id, "decided", out)
    return out


@router.put("/{run_id}/resolution/decisions/{decision_id}", response_model=EntityDecisionOut)
def change_entity_decision(
    *, run_id: int, decision_id: int, body: ManualDecision,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> Any:
    with Session(engine) as session:
        run = _run(session, access, run_id)
        settings = dec.settings_of(run)
        canon_id = dec.canon_for(run, session) if settings.scope == "canon" else None
        row = dec.change(
            session, _decision(session, run, decision_id), access.user_id,
            verdict=body.verdict, keep=body.keep, type=body.type,
            scope=settings.scope, canon_id=canon_id,
        )
        session.commit()
        out = dec.to_wire(row)
    _announce(access, run_id, "decided", out)
    return out


@router.post("/{run_id}/resolution/merge", response_model=list[EntityDecisionOut])
def merge_labels(
    *, run_id: int, body: ManualMerge, access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> Any:
    """Labels a person picked, merged into one — each a decision like the
    model's, in the history and rolled back the same way."""
    with Session(engine) as session:
        run = _run(session, access, run_id)
        settings = dec.settings_of(run)
        canon_id = dec.canon_for(run, session) if settings.scope == "canon" else None
        rows = dec.merge_by_hand(
            session, run,
            Entity(body.keep.name, body.keep.type),
            [Entity(o.name, o.type) for o in body.others],
            access.user_id, type=body.type, scope=settings.scope, canon_id=canon_id,
        )
        session.commit()
        out = [dec.to_wire(r) for r in rows]
    for item in out:
        _announce(access, run_id, "decided", item)
    return out
