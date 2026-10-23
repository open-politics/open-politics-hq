"""Drafts, their trial run, and adopting one (``annotation/drafts.py``), and
what a revision would change (``annotation/changes.py``).

A draft changes nothing the run has made until it is adopted; its trial reads
are a run of their own, so nothing scoped to the run or the schema sees them;
adopting moves only this run onto the new revision.
"""
from __future__ import annotations

from types import SimpleNamespace

import pytest
from sqlalchemy import text
from sqlmodel import Session

from app.api.modules.annotation import drafts
from app.api.modules.annotation.changes import changes
from app.api.modules.annotation.models import (
    AnnotationRun, AnnotationSchema, RunSchemaLink, RunStatus,
)
from app.api.modules.annotation.revisions import contract_at, revise, revision_for
from app.api.modules.annotation.tasks.annotate import _delta_query
from app.core.config import settings
from app.core.db import engine
from app.tests.test_live_runs import _asset, _infospace, _user  # noqa: F401 — helpers


def _doc(**props) -> dict:
    return {"type": "object", "properties": {"document": {"type": "object", "properties": props}}}


STANCE = {"type": "string", "enum": ["for", "against", "neutral"]}
V1 = _doc(title={"type": "string"}, stance=STANCE)
# Adds a field, closes `stance` to two values, drops `title`.
V2 = _doc(stance={"type": "string", "enum": ["for", "against"]}, actor={"type": "string"})


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
    uid = _user(db, "drafts")
    iid = _infospace(db, uid, "drafts")
    schema = AnnotationSchema(name="s", output_contract=V1, instructions="one", infospace_id=iid, user_id=uid)
    run = AnnotationRun(name="r", infospace_id=iid, user_id=uid, status=RunStatus.COMPLETED,
                        configuration={"model": "m", "target_asset_ids": [1, 2]},
                        views_config=[{"panels": [{"name": "Titles", "formula": {"group": [{"path": "document.title"}]}}]}])
    other = AnnotationRun(name="o", infospace_id=iid, user_id=uid)
    db.add_all([schema, run, other])
    db.flush()
    db.add_all([RunSchemaLink(run_id=run.id, schema_id=schema.id), RunSchemaLink(run_id=other.id, schema_id=schema.id)])
    db.flush()
    assets = [_asset(db, iid, uid, f"a{i}", [0]) for i in range(3)]
    return SimpleNamespace(uid=uid, iid=iid, schema=schema, run=run, other=other, assets=assets)


def _annotation(db, w, run_id, schema_id, asset_id, value, status="SUCCESS") -> int:
    return int(db.execute(text("""
        INSERT INTO annotation (run_id, schema_id, asset_id, value, status, infospace_id,
                                user_id, timestamp, uuid, created_at, updated_at)
        VALUES (:r, :s, :a, CAST(:v AS jsonb), CAST(:st AS resultstatus), :i, :u, now(),
                gen_random_uuid()::text, now(), now())
        RETURNING id
    """), {"r": run_id, "s": schema_id, "a": asset_id, "v": value, "st": status,
           "i": w.iid, "u": w.uid}).scalar())


def test_a_draft_copies_what_the_run_reads_and_has_a_trial_run(db, world):
    s, run = world.schema, world.run
    draft = drafts.open_draft(db, run, s, world.uid)
    assert (draft.output_contract, draft.instructions) == (V1, "one")
    assert (draft.draft_of, draft.draft_in) == (s.id, run.id)
    assert drafts.open_draft(db, run, s, world.uid).id == draft.id, "one draft per run and schema"

    trial = drafts.trial_of(db, run)
    assert trial.trial_of == run.id and trial.status == RunStatus.COMPLETED
    assert "target_asset_ids" not in trial.configuration, "a trial reads only what it is handed"
    assert trial.configuration["model"] == "m", "and reads the way the run does"
    assert db.get(RunSchemaLink, (trial.id, draft.id)) is not None


def test_editing_a_draft_is_in_place_and_drops_its_trial_reads(db, world):
    s, run = world.schema, world.run
    draft = drafts.open_draft(db, run, s, world.uid)
    trial = drafts.trial_of(db, run)
    _annotation(db, world, trial.id, draft.id, world.assets[0], '{"stance": "for"}')

    drafts.try_drafts(db, run, [world.assets[1]], world.uid)
    with pytest.raises(ValueError, match="still reading"):
        revise(db, draft, {"output_contract": V2})

    trial.status = RunStatus.COMPLETED
    assert revise(db, draft, {"output_contract": V2}) is True
    db.flush()
    assert draft.revision == 1 and draft.output_contract == V2, "a draft has no past"
    assert db.execute(text("SELECT count(*) FROM annotation WHERE schema_id = :d"), {"d": draft.id}).scalar() == 0
    assert s.output_contract == V1, "the schema is untouched until adopted"


def test_trying_hands_the_trial_run_its_assets(db, world):
    drafts.open_draft(db, world.run, world.schema, world.uid)
    trial = drafts.try_drafts(db, world.run, [world.assets[0], world.assets[1]], world.uid)
    trial = drafts.try_drafts(db, world.run, [world.assets[1], world.assets[2]], world.uid)
    assert trial.configuration["target_asset_ids"] == world.assets
    assert trial.status == RunStatus.PENDING
    db.flush()
    assert list(db.exec(_delta_query(db, trial, 0)).all()) == world.assets, \
        "the engine reads the trial run's scope like any run's"


def test_adopting_moves_this_run_alone(db, world):
    s, run, other = world.schema, world.run, world.other
    a, b, c = world.assets
    old = _annotation(db, world, run.id, s.id, a, '{"title": "x", "stance": "neutral"}')
    untouched = _annotation(db, world, run.id, s.id, c, '{"title": "z", "stance": "for"}')
    seq_before = db.execute(text("SELECT max(seq) FROM annotation WHERE run_id = :r"), {"r": run.id}).scalar()

    draft = drafts.open_draft(db, run, s, world.uid)
    revise(db, draft, {"output_contract": V2, "instructions": "two"})
    trial = drafts.trial_of(db, run)
    _annotation(db, world, trial.id, draft.id, a, '{"stance": "for", "actor": "A"}')
    _annotation(db, world, trial.id, draft.id, b, '{"stance": "against", "actor": "B"}')
    _annotation(db, world, trial.id, draft.id, c, '{}', status="FAILED")
    trial_id = trial.id

    adopted = drafts.adopt(db, run, s, )
    db.flush()
    db.expire_all()

    assert adopted.rev == 2 and s.revision == 2
    assert contract_at(db, s, 2) == (V2, "two") and contract_at(db, s, 1) == (V1, "one")
    assert revision_for(db, run, s) == 2 and db.get(RunSchemaLink, (run.id, s.id)).rev is None
    assert revision_for(db, other, s) == 1, "the other run keeps what it read"
    assert adopted.pinned == 1

    rows = {r.asset_id: r for r in db.execute(text(
        "SELECT id, asset_id, value, schema_rev, seq FROM annotation WHERE run_id = :r AND schema_id = :s"
    ), {"r": run.id, "s": s.id}).all()}
    assert rows[a].id == old, "the run's own read is replaced in place, keeping its id"
    assert rows[a].value == {"stance": "for", "actor": "A"} and rows[a].schema_rev == 2
    assert rows[b].schema_rev == 2 and rows[b].seq > seq_before, "a moved read is new to the run's clock"
    assert rows[c].id == untouched and rows[c].schema_rev == 1, "a failed trial read is not adopted"
    assert sorted(adopted.annotation_ids) == sorted([old, rows[b].id])

    assert db.get(AnnotationSchema, draft.id) is None
    assert db.get(AnnotationRun, trial_id) is None, "the trial run goes with the last draft"


def test_discarding_leaves_nothing_behind(db, world):
    draft = drafts.open_draft(db, world.run, world.schema, world.uid)
    trial = drafts.trial_of(db, world.run)
    _annotation(db, world, trial.id, draft.id, world.assets[0], '{"stance": "for"}')
    draft_id, trial_id = draft.id, trial.id
    drafts.discard(db, world.run, world.schema)
    db.flush()
    db.expire_all()
    assert db.get(AnnotationSchema, draft_id) is None and db.get(AnnotationRun, trial_id) is None
    assert world.schema.revision == 1


def test_a_run_takes_its_drafts_and_trial_with_it(db, world):
    draft = drafts.open_draft(db, world.run, world.schema, world.uid)
    trial = drafts.trial_of(db, world.run)
    _annotation(db, world, trial.id, draft.id, world.assets[0], '{"stance": "for"}')
    draft_id, trial_id = draft.id, trial.id
    db.execute(text("DELETE FROM annotationrun WHERE id = :r"), {"r": world.run.id})
    db.expire_all()
    assert db.get(AnnotationSchema, draft_id) is None and db.get(AnnotationRun, trial_id) is None
    assert db.get(AnnotationSchema, world.schema.id) is not None


def test_changes_are_scored_against_the_run(db, world):
    s, run = world.schema, world.run
    a, b, c = world.assets
    _annotation(db, world, run.id, s.id, a, '{"title": "x", "stance": "neutral"}')
    _annotation(db, world, run.id, s.id, b, '{"title": "y", "stance": "for"}')
    _annotation(db, world, run.id, s.id, c, '{"stance": "against"}')
    draft = drafts.open_draft(db, run, s, world.uid)
    assert changes(db, run, s, "draft").verdict == "same"

    revise(db, draft, {"output_contract": V2})
    out = changes(db, run, s, "draft")
    by = {ch.path: ch for ch in out.changes}
    assert out.verdict == "breaking" and out.annotations == 3 and out.looked_at == 3
    assert by["document.actor"].kind == "added" and by["document.actor"].affected == 3
    assert by["document.stance"].kind == "narrowed" and by["document.stance"].affected == 1
    assert by["document.title"].kind == "removed" and by["document.title"].affected == 2
    assert by["document.title"].read_by == ["Titles"], "the panel grouping by it is named"

    assert changes(db, run, s, "head").verdict == "same", "the head is what the run reads"


def test_drafts_and_trial_runs_stay_out_of_lists(client, headers, user_id, infospace_factory):
    api = settings.API_V1_STR
    iid = infospace_factory("drafts-route", owner_id=user_id)
    sid = client.post(f"{api}/infospaces/{iid}/annotation_schemas", headers=headers,
                      json={"name": "probe", "output_contract": V1}).json()["id"]
    with Session(engine) as s:
        run = AnnotationRun(name="probe run", infospace_id=iid, user_id=user_id, status=RunStatus.COMPLETED)
        s.add(run)
        s.flush()
        s.add(RunSchemaLink(run_id=run.id, schema_id=sid))
        s.commit()
        rid = run.id

    r = client.post(f"{api}/infospaces/{iid}/runs/{rid}/schemas/{sid}/draft", headers=headers)
    assert r.status_code == 200, r.text
    state = r.json()
    assert state["draft"]["output_contract"] == V1 and state["reads"] == state["head"] == 1

    names = [x["id"] for x in client.get(f"{api}/infospaces/{iid}/annotation_schemas", headers=headers).json()["data"]]
    assert names == [sid], "the draft is the run's, not the infospace's"
    runs = client.get(f"{api}/infospaces/{iid}/runs", headers=headers).json()
    assert [x["id"] for x in runs["data"]] == [rid] and runs["count"] == 1

    body = client.get(f"{api}/infospaces/{iid}/runs/{rid}/schemas", headers=headers).json()
    assert body["trial"]["status"] == "completed" and body["schemas"][0]["draft"]["id"] == state["draft"]["id"]

    draft_id = state["draft"]["id"]
    r = client.patch(f"{api}/infospaces/{iid}/annotation_schemas/{draft_id}", headers=headers, json={"output_contract": V2})
    assert r.json()["revision"] == 1, "a draft is edited in place"
    r = client.post(f"{api}/infospaces/{iid}/runs/{rid}/schemas/{sid}/draft/adopt", headers=headers)
    assert r.json() == {"rev": 2, "annotations": 0, "pinned": 0}
    assert client.get(f"{api}/infospaces/{iid}/runs/{rid}/schemas", headers=headers).json()["trial"] is None
