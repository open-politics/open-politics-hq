"""Drafts — revising a run's schema without touching what the run has made.

.. code-block:: text

    open_draft(session, run, schema, user_id)    the run's draft of a schema: a copy
                                                 of the contract the run reads
    draft_for(session, run, schema)              that draft, or None
    try_drafts(session, run, asset_ids, user_id) read assets through the run's drafts
    adopt(session, run, schema) -> Adopted       the draft becomes the run's revision
    discard(session, run, schema)                the draft, and what it read, go
    follow_head(session, run, schema)            a pinned run reads the head again

A draft is a schema row (``draft_of`` the schema, ``draft_in`` the run), so
the editor, the schema map and everything that reads a contract read it as
they read any schema — and every list of schemas leaves it out. It is edited
through ``revisions.revise`` like any schema, which for a draft writes in
place and drops what was read under it.

**A trial is a run.** The run's trial run (``trial_of``) links its drafts and
reads the assets it is handed through them — claimed, leased, reconciled and
reported by the engine like any run, and graphed by the network panel like any
run. Because its reads are its own, nothing scoped to the run or to the schema
sees them: no exclusion clause anywhere. It copies the run's reading (model,
flags, canon for the type vocabulary) and none of its consequences — not live,
not resolving into the canon, no resolver.

Adopting pins the schema's other runs to what they read, revises the schema
from the draft, and makes this run read the head. The trial's reads become the
run's: over the run's own read of the same asset, in place — its id, and so
whatever was curated from it, stays — or moved in where the run had none.
"""
from __future__ import annotations

import copy
from dataclasses import dataclass
from typing import Optional

from sqlalchemy import text
from sqlmodel import Session, select

from app.api.modules.annotation.models import (
    AnnotationRun, AnnotationSchema, RunSchemaLink, RunStatus,
)
from app.api.modules.annotation.revisions import contract_at, revise, revision_for, trial_reading

#: Configuration that says what a run reads, rather than how: a trial run
#: reads only what it is handed.
_SCOPE_KEYS = frozenset({"target_asset_ids", "target_bundle_id", "source_bundle_ids", "_watermark", "api_keys"})


@dataclass(frozen=True)
class Adopted:
    rev: int
    """The revision the run now reads."""
    annotation_ids: list[int]
    """The run's annotations the trial read, now under ``rev``."""
    pinned: int
    """Other runs of the schema kept on the revision they read."""


def _linked(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> None:
    if session.get(RunSchemaLink, (run.id, schema.id)) is None:
        raise LookupError(f"run {run.id} does not read schema {schema.id}")


def draft_for(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> Optional[AnnotationSchema]:
    return session.exec(
        select(AnnotationSchema).where(
            AnnotationSchema.draft_in == run.id, AnnotationSchema.draft_of == schema.id,
        )
    ).first()


def drafts_in(session: Session, run: AnnotationRun) -> list[AnnotationSchema]:
    return list(session.exec(
        select(AnnotationSchema).where(AnnotationSchema.draft_in == run.id).order_by(AnnotationSchema.id)
    ).all())


def trial_of(session: Session, run: AnnotationRun) -> Optional[AnnotationRun]:
    return session.exec(select(AnnotationRun).where(AnnotationRun.trial_of == run.id)).first()


def _trial_run(session: Session, run: AnnotationRun, user_id: int) -> AnnotationRun:
    trial = trial_of(session, run)
    if trial is not None:
        return trial
    trial = AnnotationRun(
        name=f"{run.name} · trial",
        configuration={k: v for k, v in (run.configuration or {}).items() if k not in _SCOPE_KEYS},
        status=RunStatus.COMPLETED,
        include_parent_context=run.include_parent_context,
        context_window=run.context_window,
        canon_ids=list(run.canon_ids or []),
        infospace_id=run.infospace_id,
        user_id=user_id,
        trial_of=run.id,
    )
    session.add(trial)
    session.flush()
    return trial


def open_draft(session: Session, run: AnnotationRun, schema: AnnotationSchema, user_id: int) -> AnnotationSchema:
    """The run's draft of *schema*, opened on the contract the run reads."""
    _linked(session, run, schema)
    draft = draft_for(session, run, schema)
    if draft is not None:
        return draft
    contract, instructions = contract_at(session, schema, revision_for(session, run, schema))
    draft = AnnotationSchema(
        name=schema.name, description=schema.description, version=schema.version,
        output_contract=copy.deepcopy(contract), instructions=instructions, tags=list(schema.tags or []),
        infospace_id=schema.infospace_id, user_id=user_id,
        draft_of=schema.id, draft_in=run.id,
    )
    session.add(draft)
    session.flush()
    session.add(RunSchemaLink(run_id=_trial_run(session, run, user_id).id, schema_id=draft.id))
    return draft


def try_drafts(session: Session, run: AnnotationRun, asset_ids: list[int], user_id: int) -> AnnotationRun:
    """Hand the trial run *asset_ids* to read through every draft of the run.
    An asset already read under the draft as it stands is not read again."""
    trial = trial_of(session, run)
    if trial is None:
        raise LookupError(f"run {run.id} has no draft to try")
    cfg = dict(trial.configuration or {})
    cfg["target_asset_ids"] = list(dict.fromkeys([*(cfg.get("target_asset_ids") or []), *asset_ids]))
    cfg.pop("_watermark", None)
    trial.configuration = cfg
    trial.status = RunStatus.PENDING
    trial.error_message = None
    trial.completed_at = None
    trial.progress_total = None
    trial.progress_current = 0
    trial.user_id = user_id
    session.add(trial)
    return trial


def _close(session: Session, run: AnnotationRun, draft: AnnotationSchema) -> None:
    """The draft goes, with what it read; the trial run with its last draft."""
    session.delete(draft)
    session.flush()
    if not drafts_in(session, run):
        trial = trial_of(session, run)
        if trial is not None:
            session.delete(trial)


def discard(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> None:
    draft = draft_for(session, run, schema)
    if draft is None:
        raise LookupError(f"run {run.id} has no draft of schema {schema.id}")
    _close(session, run, draft)


def adopt(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> Adopted:
    draft = draft_for(session, run, schema)
    if draft is None:
        raise LookupError(f"run {run.id} has no draft of schema {schema.id}")
    trial_reading(session, draft)

    # Every other run reading the head keeps reading what it read; each is
    # offered the new revision instead of being moved onto it.
    pinned = session.execute(text("""
        UPDATE runschemalink SET rev = :head
        WHERE schema_id = :s AND rev IS NULL AND run_id <> :r
    """), {"head": schema.revision, "s": schema.id, "r": run.id}).rowcount
    revise(session, schema, {"output_contract": draft.output_contract, "instructions": draft.instructions})
    session.flush()
    session.execute(text("UPDATE runschemalink SET rev = NULL WHERE run_id = :r AND schema_id = :s"),
                    {"r": run.id, "s": schema.id})

    args = {"r": run.id, "s": schema.id, "d": draft.id, "rev": schema.revision}
    # Over the run's own read of an asset, in place: the id stays, and with it
    # whatever was curated from it.
    replaced = session.execute(text("""
        WITH t AS (
            SELECT DISTINCT ON (asset_id) asset_id, value, region, links, event_timestamp, timestamp
            FROM annotation WHERE schema_id = :d AND status = 'SUCCESS'
            ORDER BY asset_id, id DESC
        ), o AS (
            SELECT DISTINCT ON (asset_id) id, asset_id
            FROM annotation WHERE run_id = :r AND schema_id = :s
            ORDER BY asset_id, id DESC
        )
        UPDATE annotation a
        SET value = t.value, status = 'SUCCESS', schema_rev = :rev, region = t.region, links = t.links,
            event_timestamp = t.event_timestamp, timestamp = t.timestamp, updated_at = now()
        FROM t JOIN o USING (asset_id)
        WHERE a.id = o.id
        RETURNING a.id
    """), args).scalars().all()
    # Where the run had not read the asset, the trial's read moves in — on the
    # run's change clock now, as anything new to it is.
    moved = session.execute(text("""
        UPDATE annotation a
        SET run_id = :r, schema_id = :s, schema_rev = :rev, seq = nextval('annotation_seq'), updated_at = now()
        WHERE a.schema_id = :d AND a.status = 'SUCCESS'
          AND NOT EXISTS (SELECT 1 FROM annotation o
                          WHERE o.run_id = :r AND o.schema_id = :s AND o.asset_id = a.asset_id)
        RETURNING a.id
    """), args).scalars().all()

    _close(session, run, draft)
    return Adopted(rev=schema.revision, annotation_ids=[*replaced, *moved], pinned=pinned)


def follow_head(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> None:
    _linked(session, run, schema)
    session.execute(text("UPDATE runschemalink SET rev = NULL WHERE run_id = :r AND schema_id = :s"),
                    {"r": run.id, "s": schema.id})
