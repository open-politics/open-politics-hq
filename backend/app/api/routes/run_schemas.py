"""A run's schemas: the revision it reads, its drafts, their trial, adopting one.

    GET    /infospaces/{iid}/runs/{run_id}/schemas                         what the run reads, its drafts, its trial
    GET    /infospaces/{iid}/runs/{run_id}/schemas/{sid}/changes?to=…      draft | head against what the run reads
    POST   /infospaces/{iid}/runs/{run_id}/schemas/{sid}/draft             open the run's draft (edited as any schema)
    DELETE /infospaces/{iid}/runs/{run_id}/schemas/{sid}/draft             discard it, and what it read
    POST   /infospaces/{iid}/runs/{run_id}/schemas/{sid}/draft/adopt       the run reads it, as the next revision
    POST   /infospaces/{iid}/runs/{run_id}/schemas/{sid}/action/follow     a pinned run reads the head again
    POST   /infospaces/{iid}/runs/{run_id}/trial                           read assets through the drafts

The domain is ``annotation/drafts.py``; preview is ``annotation/changes.py``.
"""
from __future__ import annotations

import logging
from typing import Literal

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import text
from sqlmodel import Session

from app.api.dependency_injection import SessionDep
from app.api.modules.annotation import drafts
from app.api.modules.annotation.changes import SchemaChanges, changes
from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema, RunSchemaLink
from app.api.modules.annotation.revisions import revision_for
from app.api.modules.identity_infospace_user.access import Access, Capability, Requires
from app.api.routes.annotation_runs import run_reads
from app.api.routes.annotation_schemas import schema_read
from app.core.events import emit
from app.schemas import (
    AnnotationRunRead, DraftAdopted, RunSchemas, RunSchemaState, TrialRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/infospaces/{infospace_id}/runs", tags=["Runs"])


def _run(session: Session, access: Access, run_id: int) -> AnnotationRun:
    access.require_in_scope("run_ids", run_id)
    run = session.get(AnnotationRun, run_id)
    if run is None or run.infospace_id != access.infospace_id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Run not found")
    if run.trial_of is not None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "A trial run is worked through the run it tries drafts for")
    return run


def _schema(session: Session, run: AnnotationRun, schema_id: int) -> AnnotationSchema:
    schema = session.get(AnnotationSchema, schema_id)
    if schema is None or session.get(RunSchemaLink, (run.id, schema_id)) is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "The run does not read this schema")
    return schema


def _state(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> RunSchemaState:
    reads = revision_for(session, run, schema)
    outdated = session.execute(text(
        "SELECT count(*) FROM annotation WHERE run_id = :r AND schema_id = :s AND schema_rev <> :rev"
    ), {"r": run.id, "s": schema.id, "rev": reads}).scalar() or 0
    draft = drafts.draft_for(session, run, schema)
    return RunSchemaState(
        schema_id=schema.id, name=schema.name, reads=reads, head=schema.revision,
        pinned=session.get(RunSchemaLink, (run.id, schema.id)).rev is not None,
        outdated=outdated, draft=schema_read(draft) if draft else None,
    )


def _trial(session: Session, run: AnnotationRun) -> AnnotationRunRead | None:
    trial = drafts.trial_of(session, run)
    return run_reads(session, [trial], include_counts=True)[0] if trial else None


@router.get("/{run_id}/schemas", response_model=RunSchemas)
def run_schemas(*, run_id: int, access: Access = Requires(scope=None), session: SessionDep) -> RunSchemas:
    run = _run(session, access, run_id)
    return RunSchemas(
        schemas=[_state(session, run, s) for s in sorted(run.target_schemas, key=lambda s: s.id)],
        trial=_trial(session, run),
    )


@router.get("/{run_id}/schemas/{schema_id}/changes", response_model=SchemaChanges)
def schema_changes(
    *, run_id: int, schema_id: int, session: SessionDep,
    to: Literal["draft", "head"] = Query("draft", description="What to compare what the run reads against."),
    access: Access = Requires(scope=None),
) -> SchemaChanges:
    run = _run(session, access, run_id)
    try:
        return changes(session, run, _schema(session, run, schema_id), to)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e


@router.post("/{run_id}/schemas/{schema_id}/draft", response_model=RunSchemaState)
def open_draft(
    *, run_id: int, schema_id: int, session: SessionDep,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> RunSchemaState:
    run = _run(session, access, run_id)
    schema = _schema(session, run, schema_id)
    drafts.open_draft(session, run, schema, access.user_id)
    session.commit()
    return _state(session, run, schema)


@router.delete("/{run_id}/schemas/{schema_id}/draft", status_code=status.HTTP_204_NO_CONTENT)
def discard_draft(
    *, run_id: int, schema_id: int, session: SessionDep,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> None:
    run = _run(session, access, run_id)
    try:
        drafts.discard(session, run, _schema(session, run, schema_id))
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    session.commit()


@router.post("/{run_id}/schemas/{schema_id}/draft/adopt", response_model=DraftAdopted)
def adopt_draft(
    *, run_id: int, schema_id: int, session: SessionDep,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> DraftAdopted:
    run = _run(session, access, run_id)
    try:
        adopted = drafts.adopt(session, run, _schema(session, run, schema_id))
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    except ValueError as e:
        raise HTTPException(status.HTTP_409_CONFLICT, str(e)) from e
    session.commit()
    # Adopted reads are the run's now: curated as its own would have been.
    if adopted.annotation_ids and run.resolve_into_canon and run.canon_ids:
        from app.api.modules.graph.tasks.curation import curate_annotated
        curate_annotated.delay(adopted.annotation_ids, run.infospace_id)
    return DraftAdopted(rev=adopted.rev, annotations=len(adopted.annotation_ids), pinned=adopted.pinned)


@router.post("/{run_id}/schemas/{schema_id}/action/follow", response_model=RunSchemaState)
def follow_head(
    *, run_id: int, schema_id: int, session: SessionDep,
    access: Access = Requires(Capability.ORGANIZE, scope=None),
) -> RunSchemaState:
    run = _run(session, access, run_id)
    schema = _schema(session, run, schema_id)
    drafts.follow_head(session, run, schema)
    session.commit()
    return _state(session, run, schema)


@router.post("/{run_id}/trial", response_model=AnnotationRunRead)
def try_drafts(
    *, run_id: int, body: TrialRequest, session: SessionDep,
    access: Access = Requires(Capability.COMPUTE, scope=None),
) -> AnnotationRunRead:
    run = _run(session, access, run_id)
    try:
        trial = drafts.try_drafts(session, run, body.asset_ids, access.user_id)
    except LookupError as e:
        raise HTTPException(status.HTTP_404_NOT_FOUND, str(e)) from e
    session.commit()
    emit("annotation_run.created", {"infospace_id": run.infospace_id})
    return run_reads(session, [trial], include_counts=True)[0]
