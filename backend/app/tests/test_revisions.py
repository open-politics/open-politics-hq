"""Schema revisions and the annotation change clock.

A contract annotations were made under is never rewritten: revising keeps the
head it replaces, a run reads through its pin (or the head), and what it makes
records the revision. ``annotation.seq`` moves for a value changed in place as
surely as for a new row — the watermark the overview and the resolver read.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation.models import AnnotationRun, AnnotationSchema, RunSchemaLink
from app.api.modules.annotation.plan import prepare
from app.api.modules.annotation.revisions import contract_at, revise, revision_for
from app.core.config import settings
from app.core.db import engine
from app.tests.test_live_runs import _asset, _infospace, _user  # noqa: F401 — helpers


def _doc(**props) -> dict:
    return {"type": "object", "properties": {"document": {"type": "object", "properties": props}}}


V1 = _doc(title={"type": "string"})
V2 = _doc(title={"type": "string"}, stance={"type": "string", "enum": ["for", "against"]})


@pytest.fixture
def db():
    connection = engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


@pytest.fixture
def world(db):
    uid = _user(db, "revisions")
    iid = _infospace(db, uid, "revisions")
    schema = AnnotationSchema(name="s", output_contract=V1, instructions="one",
                              infospace_id=iid, user_id=uid)
    run = AnnotationRun(name="r", infospace_id=iid, user_id=uid)
    db.add_all([schema, run])
    db.flush()
    db.add(RunSchemaLink(run_id=run.id, schema_id=schema.id))
    db.flush()
    return SimpleNamespace(uid=uid, iid=iid, schema=schema, run=run)


def test_revise_keeps_the_head_it_replaces(db, world):
    s = world.schema
    assert revise(db, s, {"output_contract": V1, "name": "ignored"}) is False, "same contract: no revision"
    assert s.revision == 1

    assert revise(db, s, {"output_contract": V2, "instructions": "two"}) is True
    db.flush()
    assert s.revision == 2
    assert contract_at(db, s, 2) == (V2, "two")
    assert contract_at(db, s, 1) == (V1, "one"), "the past stays readable"


def test_a_run_follows_the_head_unless_pinned(db, world):
    s, run = world.schema, world.run
    revise(db, s, {"output_contract": V2})
    db.flush()
    assert revision_for(db, run, s) == 2, "NULL rev follows the head"

    db.execute(text("UPDATE runschemalink SET rev = 1 WHERE run_id = :r"), {"r": run.id})
    assert revision_for(db, run, s) == 1

    plan = prepare(db, run, s, SimpleNamespace(provider_key="llamacpp", model="m"))
    assert plan.rev == 1
    assert "stance" not in plan.contract["properties"]["document"]["properties"], \
        "a pinned run reads its revision's contract, not the head's"


def _annotation(db, w, asset_id, value) -> int:
    return int(db.execute(text("""
        INSERT INTO annotation (run_id, schema_id, asset_id, value, status, infospace_id,
                                user_id, timestamp, uuid, created_at, updated_at)
        VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :i, :u, now(),
                gen_random_uuid()::text, now(), now())
        RETURNING id
    """), {"r": w.run.id, "s": w.schema.id, "a": asset_id, "v": value, "i": w.iid, "u": w.uid}).scalar())


def test_seq_moves_for_a_value_changed_in_place(db, world):
    """The regression: the watermark was ``max(id)``, so a fill in place never
    moved it — the resolver never re-seeded and open views never refreshed."""
    a = _asset(db, world.iid, world.uid, "a", [0])
    ann = _annotation(db, world, a, '{"title": "x"}')
    seq = lambda: db.execute(text("SELECT seq FROM annotation WHERE id = :i"), {"i": ann}).scalar()  # noqa: E731

    first = seq()
    assert first is not None
    db.execute(text("UPDATE annotation SET status = 'FAILED' WHERE id = :i"), {"i": ann})
    assert seq() == first, "only a changed value moves the clock"
    db.execute(text("UPDATE annotation SET value = '{\"title\": \"x\"}' WHERE id = :i"), {"i": ann})
    assert seq() == first, "the same value written again is no change"
    db.execute(text("UPDATE annotation SET value = '{\"title\": \"x\", \"stance\": \"for\"}' WHERE id = :i"),
               {"i": ann})
    assert seq() > first


def test_patch_makes_a_revision_and_leaves_the_rest_in_place(client, headers, user_id, infospace_factory):
    api = settings.API_V1_STR
    iid = infospace_factory("revisions-route", owner_id=user_id)
    r = client.post(f"{api}/infospaces/{iid}/annotation_schemas", headers=headers,
                    json={"name": "probe", "output_contract": V1, "instructions": "one"})
    assert r.status_code == 201, r.text
    sid = r.json()["id"]
    assert r.json()["revision"] == 1

    r = client.patch(f"{api}/infospaces/{iid}/annotation_schemas/{sid}", headers=headers,
                     json={"description": "renamed only"})
    assert r.json()["revision"] == 1, "a description is not a contract"

    r = client.patch(f"{api}/infospaces/{iid}/annotation_schemas/{sid}", headers=headers,
                     json={"output_contract": V2})
    body = r.json()
    assert body["revision"] == 2
    assert "stance" in body["output_contract"]["properties"]["document"]["properties"]
    assert body["description"] == "renamed only"

    with Session(engine) as s:
        schema = s.get(AnnotationSchema, sid)
        assert contract_at(s, schema, 1)[0] == V1
