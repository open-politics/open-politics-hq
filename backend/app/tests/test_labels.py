"""Meaning, step 2 (docs/plans/meaning/PLAN.md): ``embed_labels`` fills the
*said* basis — the names of a run's graph — and keeps up with its change clock.

Real Postgres, rolled back per test. ``embed_texts`` is replaced by a recorder:
remembering is step 1's (``test_meaning.py``); this pins *which* names are
asked for, and when a run is offered at all.
"""
from __future__ import annotations

import json
from contextlib import contextmanager

import pytest
from sqlalchemy import text

import app.models  # noqa: F401 — every mapper
from app.api.modules.graph.tasks import labels as lb
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine,
)
from app.tests.test_network import CONTRACT, doc


class Ctx:
    """What a task body reads from its context: the test's session, and a
    record of what it told."""

    def __init__(self, db, infospace_id: int):
        self.db, self.infospace_id, self.sent = db, infospace_id, []

    @contextmanager
    def session(self):
        yield self.db

    def send(self, topic, key, kind, payload):
        self.sent.append((kind, payload))

    def stat(self, *_):
        pass


@pytest.fixture
def asked(monkeypatch):
    calls: list[list[str]] = []

    async def record(session, infospace_id, texts, **kw):
        calls.append(list(texts))
        return [[0.0] for _ in texts], None

    monkeypatch.setattr("app.api.modules.embedding.embed.embed_texts", record)
    return calls


@pytest.fixture
def world(db):
    uid = _user(db, "labels")
    iid = _infospace(db, uid, "labels")
    sid = _schema_with(db, iid, uid, CONTRACT)
    run, other = _run(db, iid, uid, "r"), _run(db, iid, uid, "other")
    assets = {}
    for name, value in {
        "A1": doc(["Ann", "Bob"], ["Rome"]),
        "A2": doc(["Cy"], ["Oslo"]),
    }.items():
        assets[name] = _asset(db, iid, uid, name)
        _annotation(db, iid, uid, run, sid, assets[name], value)
    _annotation(db, iid, uid, other, sid, assets["A1"], doc(["Zoe"], []))
    db.flush()
    return type("World", (), dict(db=db, iid=iid, uid=uid, sid=sid, run=run, other=other,
                                  assets=assets, ctx=Ctx(db, iid)))


def offered(w) -> set[int]:
    return set(w.db.exec(lb._runs_to_embed(w.iid)).all())


def clock(w, run: int) -> int:
    return w.db.execute(text("SELECT max(seq) FROM annotation WHERE run_id = :r"), {"r": run}).scalar()


def flat(calls) -> set[str]:
    return {t for c in calls for t in c}


def test_a_first_pass_embeds_every_name_and_keeps_the_clock(world, asked):
    w = world
    assert offered(w) == {w.run, w.other}

    lb.embed_labels(w.ctx, [w.run])

    assert {"Ann", "Bob", "Cy", "Rome", "Oslo"} <= flat(asked)
    assert "Zoe" not in flat(asked)                       # the other run's
    run = w.db.get(lb.AnnotationRun, w.run)
    assert lb.watermark_of(run) == clock(w, w.run)
    assert offered(w) == {w.other}
    assert [k for k, _ in w.ctx.sent] == ["embedding", "embedded"]


def test_names_go_out_in_slices(world, asked, monkeypatch):
    monkeypatch.setattr(lb, "SLICE", 2)
    lb.embed_labels(world.ctx, [world.run])
    assert all(len(c) <= 2 for c in asked) and len(asked) > 1


def test_a_later_pass_reads_only_what_changed(world, asked):
    w = world
    lb.embed_labels(w.ctx, [w.run])

    # A new document, and a value filled in place: both move the clock.
    a3 = _asset(w.db, w.iid, w.uid, "A3")
    _annotation(w.db, w.iid, w.uid, w.run, w.sid, a3, doc(["Eve"], ["Kyiv"]))
    w.db.execute(text("UPDATE annotation SET value = CAST(:v AS jsonb) WHERE run_id = :r AND asset_id = :a"),
                 {"v": json.dumps(doc(["Cy", "Dan"], ["Oslo"])), "r": w.run, "a": w.assets["A2"]})
    w.db.flush()
    assert w.run in offered(w)

    names, watermark = lb.labels_of(w.ctx, w.run)
    assert {"Eve", "Kyiv", "Dan", "Cy"} <= set(names)
    assert "Ann" not in names and "Rome" not in names     # A1 did not change
    assert watermark == clock(w, w.run)


def test_a_trial_run_is_not_offered(world):
    w = world
    w.db.execute(text("UPDATE annotationrun SET trial_of = :r WHERE id = :o"), {"r": w.run, "o": w.other})
    w.db.flush()
    assert offered(w) == {w.run}


def test_a_run_with_nothing_to_graph_has_no_labels(world, asked):
    w = world
    w.db.execute(text("UPDATE annotationschema SET name = 'graphable' WHERE id = :s"), {"s": w.sid})
    sid = _schema_with(w.db, w.iid, w.uid, {"type": "object", "properties": {"note": {"type": "string"}}})
    run = _run(w.db, w.iid, w.uid, "plain")
    _annotation(w.db, w.iid, w.uid, run, sid, w.assets["A1"], {"note": "nothing to graph"})
    w.db.flush()

    lb.embed_labels(w.ctx, [run])

    assert asked == []
    assert lb.watermark_of(w.db.get(lb.AnnotationRun, run)) == clock(w, run)
    assert run not in offered(w)


def test_the_enricher_embeds_what_a_run_read_first(world):
    """Documents a run annotated, then their parts, then the rest — whatever
    order they were made in."""
    from app.core.tasks import get_task_registry
    w = world
    w.db.execute(text("UPDATE asset SET text_content = 'body' WHERE infospace_id = :i"), {"i": w.iid})
    loose = [_asset(w.db, w.iid, w.uid, f"loose {k}") for k in range(3)]
    part = _asset(w.db, w.iid, w.uid, "page of A2")
    w.db.execute(text("UPDATE asset SET text_content = 'body', parent_asset_id = :p WHERE id = ANY(:ids)"),
                 {"p": w.assets["A2"], "ids": [*loose, part]})
    w.db.execute(text("UPDATE asset SET parent_asset_id = NULL WHERE id = ANY(:ids)"), {"ids": loose})
    w.db.flush()

    check = get_task_registry()["embedding"].check
    ids = list(dict.fromkeys(r[0] for r in w.db.execute(check(w.iid).limit(20)).all()))

    assert set(ids[:2]) == {w.assets["A1"], w.assets["A2"]}
    assert ids[2] == part
    assert set(ids[3:]) == set(loose)
