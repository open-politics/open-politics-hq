"""Schema revisions — a contract annotations were made under is never rewritten.

.. code-block:: text

    revise(session, schema, changes)        the one way a contract changes:
                                            keep the head it replaces, bump
    contract_at(session, schema, rev)       (contract, instructions) at any rev
    revision_for(session, run, schema)      the rev a run reads through

The schema row is its head: ``output_contract`` and ``instructions`` at
``revision``. ``AnnotationSchemaRevision`` holds only the past — every head a
schema has been revised away from — so every revision an annotation names
(``Annotation.schema_rev``) stays readable, and a field the schema did not have
yet can be told from a field the model left empty.

A run reads through its link's ``rev``: NULL follows the head, a number pins it
there while the head moves on.
"""
from __future__ import annotations

from typing import Any, Mapping, Optional

from sqlalchemy import delete
from sqlmodel import Session, select

from app.api.modules.annotation.models import (
    Annotation, AnnotationRun, AnnotationSchema, AnnotationSchemaRevision, RunSchemaLink, RunStatus,
)

#: The fields that make up a contract — the ones a revision keeps.
CONTRACT_FIELDS = ("output_contract", "instructions")


def revise(session: Session, schema: AnnotationSchema, changes: Mapping[str, Any]) -> bool:
    """Apply *changes* to the schema's contract fields. A real change keeps the
    head it replaces and becomes the next revision; the same contract written
    again is no revision at all. Other keys in *changes* are ignored — they are
    the caller's to set. Returns whether the contract changed.

    A draft (``drafts.py``) has no past: it changes in place, and what its
    trial run read under what it was goes with it — a trial read always
    answers the draft as it stands."""
    new = {
        k: changes[k] for k in CONTRACT_FIELDS
        if k in changes and changes[k] != getattr(schema, k)
    }
    if not new:
        return False
    if schema.draft_of is not None:
        trial_reading(session, schema)
        for k, v in new.items():
            setattr(schema, k, v)
        session.add(schema)
        session.execute(delete(Annotation).where(Annotation.schema_id == schema.id))
        return True
    session.add(AnnotationSchemaRevision(
        schema_id=schema.id, rev=schema.revision,
        output_contract=schema.output_contract, instructions=schema.instructions,
    ))
    for k, v in new.items():
        setattr(schema, k, v)
    schema.revision += 1
    session.add(schema)
    return True


def trial_reading(session: Session, draft: AnnotationSchema) -> None:
    """Refuse while the draft's trial run is reading through it: what it reads
    must answer one draft, not two."""
    reading = session.exec(
        select(AnnotationRun.id).where(
            AnnotationRun.trial_of == draft.draft_in,
            AnnotationRun.status.in_([RunStatus.PENDING, RunStatus.RUNNING]),
        )
    ).first()
    if reading is not None:
        raise ValueError("The trial is still reading through this draft. Wait for it, or discard the draft.")


def contract_at(session: Session, schema: AnnotationSchema, rev: int) -> tuple[dict, Optional[str]]:
    """The contract and instructions *schema* had at revision *rev*."""
    if rev == schema.revision:
        return schema.output_contract, schema.instructions
    past = session.exec(
        select(AnnotationSchemaRevision).where(
            AnnotationSchemaRevision.schema_id == schema.id,
            AnnotationSchemaRevision.rev == rev,
        )
    ).first()
    # Revisions are only ever appended, and a link or an annotation can only
    # name one that existed: a miss means the model of the data is wrong.
    assert past is not None, f"schema {schema.id} has no revision {rev}"
    return past.output_contract, past.instructions


def revision_for(session: Session, run: AnnotationRun, schema: AnnotationSchema) -> int:
    """The revision *run* reads *schema* through: its pin, else the head."""
    pin = session.exec(
        select(RunSchemaLink.rev).where(
            RunSchemaLink.run_id == run.id, RunSchemaLink.schema_id == schema.id,
        )
    ).first()
    return pin if pin is not None else schema.revision
