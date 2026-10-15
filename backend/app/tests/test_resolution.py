"""The live resolver — `graph/candidates.py`, `graph/decisions.py`.

Candidate rules are pure; the decision log runs on real Postgres, rolled back per
test. The model is never called: answers are built by hand, which is the point —
what a verdict *does* must not depend on which endpoint produced it.
"""
from __future__ import annotations

import types

import pytest
from sqlmodel import select

import app.models  # noqa: F401 — every mapper
from app.api.modules.annotation.models import AnnotationRun
from app.api.modules.foundation_service_providers.logic import Answer
from app.api.modules.graph import decisions as dec
from app.api.modules.graph.candidates import Entity, candidate_pairs, fold, pair_key
from app.api.modules.graph.models import Canon, CanonEntry, EntityDecision
from app.tests.test_graph_stream import (  # noqa: F401 — fixtures
    _infospace, _run, _user, db, pg_engine,
)


# ─── Candidates ──────────────────────────────────────────────────────────────


def _reasons(entities):
    return {(c.a.name, c.b.name, c.reason) for c in candidate_pairs(entities)}


def test_fold_is_a_comparison_key():
    assert fold("Al-Jazeera") == fold("al jazeera")
    assert fold("Zelenskyy ") == "zelenskyy"
    assert fold("Côte d’Ivoire") == fold("Cote d Ivoire")


def test_the_same_name_under_two_types_is_a_type_question():
    pairs = candidate_pairs([Entity("Al Jazeera", "Organization", 9), Entity("Al Jazeera", "Person", 3)])
    assert [(c.reason, c.priority) for c in pairs] == [("type", 3.0)]


def test_spelling_acronym_and_containment():
    got = _reasons([
        Entity("Volodymyr Zelensky", "Person", 5), Entity("Volodymyr Zelenskyy", "Person", 3),
        Entity("US", "State", 8), Entity("United States", "Location", 9),
        Entity("Trump", "Person", 4), Entity("Donald Trump", "Person", 20),
        Entity("Trump administration", "Organization", 6),
        Entity("Al-Jazeera", "Organization", 2), Entity("Al Jazeera", "Organization", 7),
    ])
    assert ("Volodymyr Zelensky", "Volodymyr Zelenskyy", "spelling") in got
    assert ("US", "United States", "acronym") in got
    assert ("Trump", "Donald Trump", "contains") in got
    assert ("Al-Jazeera", "Al Jazeera", "spelling") in got
    # Containment stays within a type: an administration is not its president.
    assert not any("Trump administration" in (a, b) and r == "contains" for a, b, r in got)


def test_a_word_many_names_share_pairs_nothing():
    names = [Entity(f"United {x}", "Organization", 1) for x in "ABCDEFGHIJKLMNOPQRSTUVWXYZ"]
    assert not any(c.reason == "contains" for c in candidate_pairs([Entity("United", "Organization", 5), *names]))


def test_pairs_are_order_free_and_most_mentioned_first():
    a, b = Entity("US", "State", 1), Entity("United States", "State", 1)
    assert pair_key(a, b) == pair_key(b, a)
    pairs = candidate_pairs([
        Entity("UK", "State", 2), Entity("United Kingdom", "State", 50),
        Entity("US", "State", 30), Entity("United States", "State", 40),
    ])
    assert [c.a.name for c in pairs][:1] == ["US"]


# ─── The log ─────────────────────────────────────────────────────────────────


def _node(name, type_, freq, anns, id_=None):
    return types.SimpleNamespace(id=id_ or f"{name}|{type_}", name=name, type=type_, kind="entity",
                                 frequency=freq, source_annotation_ids=anns)


@pytest.fixture
def world(db):
    uid = _user(db, "resolver")
    iid = _infospace(db, uid, "resolver")
    run = db.get(AnnotationRun, _run(db, iid, uid, "r"))
    canon = Canon(infospace_id=iid, name="run canon")
    db.add(canon)
    db.flush()
    run.canon_ids = [canon.id]
    db.add(run)
    us, usa, iran = _node("US", "State", 8, [1, 2]), _node("United States", "Location", 9, [2, 3]), _node("Iran", "State", 4, [2])
    graph = types.SimpleNamespace(
        nodes=[us, usa, iran],
        edges=[types.SimpleNamespace(source=us.id, target=iran.id), types.SimpleNamespace(source=usa.id, target=iran.id)],
    )
    added = dec.seed(db, run, graph)
    db.flush()
    row = db.exec(select(EntityDecision).where(EntityDecision.run_id == run.id)).one()
    return types.SimpleNamespace(db=db, uid=uid, run=run, canon=canon, row=row, added=added, graph=graph)


def _answers(p_same: float, keep="b", type_="State") -> dict[str, Answer]:
    return {
        "same": Answer(kind="noul", probabilities={"true": p_same, "false": 1 - p_same}, value=p_same,
                       confidence=abs(p_same - 0.5) * 2, model="m", wire="raw"),
        "name": Answer(kind="choice", probabilities={keep: 0.9, "a" if keep == "b" else "b": 0.1}, value=keep, confidence=0.8),
        "type": Answer(kind="choice", probabilities={type_: 0.7, "Location": 0.3}, value=type_, confidence=0.4),
    }


def test_seeding_writes_each_pair_once_with_what_the_model_will_see(world):
    w = world
    assert w.added == 1
    assert (w.row.a_name, w.row.b_name, w.row.reason) == ("US", "United States", "acronym")
    assert 'A: "US" — State, mentioned 8 times. Appears with: Iran.' in w.row.state
    assert "same document 1 times" in w.row.state
    assert dec.seed(w.db, w.run, w.graph) == 0                        # never twice


def test_three_questions_one_state(world):
    qs = dec.questions_for(world.row, ["State", "Person"])
    assert set(qs) == {"same", "name", "type"}
    assert list(qs["type"].criteria) == ["State", "Location", "Person"]     # the pair's own first, no repeats
    assert qs["name"].criteria == {"a": '"US"', "b": '"United States"'}


@pytest.mark.parametrize("p,status", [(0.93, "merged"), (0.08, "separate"), (0.6, "unsure")])
def test_the_threshold_decides_what_takes_effect(world, p, status):
    s = dec.ResolverSettings(running=True, threshold=0.8)
    row = dec.decide(world.db, world.row, _answers(p), s, canon_id=None)
    assert row.status == status
    assert (row.keep, row.type, row.decided_by) == ("b", "State", None)
    assert row.canon_effect is None                                     # run scope writes nothing else


def test_a_canon_scoped_merge_is_written_and_taken_back(world):
    w = world
    s = dec.ResolverSettings(running=True, scope="canon")
    row = dec.decide(w.db, w.row, _answers(0.95), s, canon_id=w.canon.id)
    w.db.flush()
    entry = w.db.get(CanonEntry, row.canon_effect["entry_id"])
    assert (entry.canonical, entry.type, entry.aliases) == ("United States", "State", ["US"])
    assert row.canon_effect["created"] is True

    dec.rollback(w.db, row, w.uid)
    w.db.flush()
    assert w.db.get(CanonEntry, entry.id) is None                       # created by the decision, gone with it
    assert row.status == "rolled_back" and row.decided_by == w.uid
    assert [t["status"] for t in row.trail] == ["merged"]


def test_an_existing_entry_gains_an_alias_and_gets_it_back(world):
    w = world
    entry = CanonEntry(infospace_id=w.run.infospace_id, canon_id=w.canon.id, canonical="United States",
                       type="Location", aliases=["USA"])
    w.db.add(entry)
    w.db.flush()
    row = dec.decide(w.db, w.row, _answers(0.95, type_="State"), dec.ResolverSettings(scope="canon"), w.canon.id)
    w.db.flush()
    w.db.refresh(entry)
    assert entry.aliases == ["USA", "US"] and entry.type == "State"
    assert row.canon_effect == {"entry_id": entry.id, "created": False, "alias_added": "US", "type_before": "Location"}
    dec.rollback(w.db, row, w.uid)
    w.db.flush()
    w.db.refresh(entry)
    assert entry.aliases == ["USA"] and entry.type == "Location"


def test_two_curated_entries_are_left_to_the_canon_view(world):
    w = world
    for name in ("US", "United States"):
        w.db.add(CanonEntry(infospace_id=w.run.infospace_id, canon_id=w.canon.id, canonical=name, type="State", aliases=[]))
    w.db.flush()
    row = dec.decide(w.db, w.row, _answers(0.95), dec.ResolverSettings(scope="canon"), w.canon.id)
    assert "skipped" in row.canon_effect
    assert row.status == "merged"                                       # the run layer still carries it


def test_a_person_overrides_the_model_and_the_trail_keeps_both(world):
    w = world
    dec.decide(w.db, w.row, _answers(0.6), dec.ResolverSettings(), None)        # unsure
    row = dec.change(w.db, w.row, w.uid, verdict="merged", keep="a", type="State")
    assert (row.status, row.keep, row.confidence, row.decided_by) == ("merged", "a", 1.0, w.uid)
    row = dec.change(w.db, row, w.uid, verdict="separate")
    assert [t["status"] for t in row.trail] == ["unsure", "merged"]
    assert row.trail[0]["by"] is None and row.trail[1]["by"] == w.uid


def test_settings_live_on_the_run(world):
    w = world
    assert dec.settings_of(w.run).running is False
    s = dec.save_settings(w.db, w.run, running=True, scope="canon")
    assert (s.running, s.scope, s.threshold) == (True, "canon", 0.8)
    assert w.run.graph_config["resolution"]["scope"] == "canon"
    assert dec.canon_for(w.run, w.db) == w.canon.id


# ─── The task ────────────────────────────────────────────────────────────────

from contextlib import contextmanager  # noqa: E402

from app.api.modules.graph.tasks.decide import judge_entity_decisions  # noqa: E402


class FakeJudge:
    def __init__(self, p_same, during=None):
        self.p_same, self.during, self.calls = p_same, during, 0

    async def judge(self, state, questions, model_name=None):
        self.calls += 1
        assert set(questions) == {"same", "name", "type"} and state
        if self.during:
            self.during()
        return _answers(self.p_same)


class FakeCtx:
    def __init__(self, db, infospace_id, judge):
        self.db, self.infospace_id, self.judge = db, infospace_id, judge
        self.events, self.failed = [], []

    @contextmanager
    def session(self):
        yield self.db

    def provider(self, capability):
        assert capability == "logic"
        return self.judge

    def send(self, topic, resource_id, event, data=None):
        self.events.append((topic, resource_id, event, data))
        return True

    def stat(self, key, count=1):
        pass

    def item_failed(self, item_id):
        self.failed.append(item_id)


def test_the_task_judges_tells_and_applies(world):
    w = world
    dec.save_settings(w.db, w.run, running=True)
    w.db.flush()
    ctx = FakeCtx(w.db, w.run.infospace_id, FakeJudge(0.97))
    judge_entity_decisions(ctx, [w.row.id])
    w.db.refresh(w.row)
    assert w.row.status == "merged" and w.row.keep == "b" and w.row.model == "m"
    assert [(t, r, e) for t, r, e, _ in ctx.events] == [
        ("resolution", w.run.id, "judging"), ("resolution", w.run.id, "decided"),
    ]
    assert ctx.events[1][3]["status"] == "merged"


def test_a_paused_resolver_decides_nothing(world):
    w = world
    judge = FakeJudge(0.97)
    judge_entity_decisions(FakeCtx(w.db, w.run.infospace_id, judge), [w.row.id])
    assert judge.calls == 0 and w.row.status == "pending"


def test_a_person_deciding_meanwhile_wins(world):
    w = world
    dec.save_settings(w.db, w.run, running=True)
    w.db.flush()

    def a_person_decides():
        dec.change(w.db, w.row, w.uid, verdict="separate")
        w.db.flush()

    ctx = FakeCtx(w.db, w.run.infospace_id, FakeJudge(0.97, during=a_person_decides))
    judge_entity_decisions(ctx, [w.row.id])
    w.db.refresh(w.row)
    assert w.row.status == "separate" and w.row.decided_by == w.uid
    assert [e for _, _, e, _ in ctx.events] == ["judging"]          # the model's answer was dropped


def test_the_first_pairs_are_filed_first(db):
    uid = _user(db, "resolver-first")
    iid = _infospace(db, uid, "resolver-first")
    run = db.get(AnnotationRun, _run(db, iid, uid, "r"))
    nodes = [_node(n, "State", f, [f]) for n, f in (("US", 9), ("United States", 8), ("UK", 7), ("United Kingdom", 6))]
    told = []
    added = dec.seed(db, run, types.SimpleNamespace(nodes=nodes, edges=[]), first=1, on_first=told.append)
    assert added == 2 and told == [1]
