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
from app.api.modules.graph.candidates import Entity, MAX_MEMBERS, candidate_groups, candidate_pairs, fold, pair_key
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
    assert [(c.reason, c.priority) for c in pairs] == [("type", 12.0)]


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


def test_pairs_are_order_free_and_most_prominent_first():
    a, b = Entity("US", "State", 1), Entity("United States", "State", 1)
    assert pair_key(a, b) == pair_key(b, a)
    pairs = candidate_pairs([
        Entity("UK", "State", 2), Entity("United Kingdom", "State", 50),
        Entity("US", "State", 30), Entity("United States", "State", 40),
        # A hub under a second type: asked first, however few the stray mentions.
        Entity("Germany", "Location", 1500), Entity("Germany", "Person", 3),
    ])
    assert [c.a.name for c in pairs] == ["Germany", "US", "UK"]


def _trumps():
    """The family the rarity rule never paired: "trump" is in dozens of labels."""
    return [
        Entity("Donald Trump", "Person", 7000), Entity("Trump", "Person", 417),
        Entity("President Trump", "Person", 110), Entity("Donald Trump Jr.", "Person", 60),
        *(Entity(f"Trump {x} policy", "Policy", 1) for x in range(40)),
    ]


def test_the_most_mentioned_names_pair_through_a_common_word():
    got = _reasons(_trumps())
    assert {("Trump", "Donald Trump"), ("President Trump", "Donald Trump"), ("Trump", "President Trump")} \
        <= {(a, b) for a, b, _ in got} | {(b, a) for a, b, _ in got}
    # … and only them: a label seen once is no hub, whatever word it carries.
    assert not any(r == "head" and "policy" in a + b for a, b, r in got)


def test_groups_hang_every_pair_on_its_more_mentioned_label():
    groups = candidate_groups(_trumps())
    first = groups[0]
    assert first.head.name == "Donald Trump"
    assert [c.b.name for c in first.members] == ["Trump", "President Trump", "Donald Trump Jr."]
    assert all(c.a == first.head for c in first.members)
    assert first.priority == 7000 + 417 + 110 + 60
    pairs = [c.key for g in groups for c in g.members]
    assert len(pairs) == len(set(pairs)) == len(candidate_pairs(_trumps()))     # each pair asked once


def test_a_crowded_head_is_asked_in_parts():
    names = [Entity("Germany", "Location", 900), *(Entity("Germany", t, 2) for t in
             ["Person", "State", "Organization", "Group", "Event", "Office", "Policy", "Party", "Team", "Ship",
              "Brand", "Film", "Album", "Book"])]
    groups = candidate_groups(names)
    assert [len(g.members) for g in groups if g.head.name == "Germany" and g.head.type == "Location"] == [MAX_MEMBERS, 2]


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


def _same(p: float) -> Answer:
    return Answer(kind="noul", probabilities={"true": p, "false": 1 - p}, value=p,
                  confidence=abs(p - 0.5) * 2, model="m", wire="raw")


def _answers(rows, p_same, name="United States", type_="State") -> dict[str, Answer]:
    """The model's answers about a group: one `same` per member — *p_same* for
    all, or a list, one each — then the label and the type."""
    ps = p_same if isinstance(p_same, list) else [p_same] * len(rows)
    out = {f"same:{r.id}": _same(p) for r, p in zip(rows, ps)}
    out["name"] = Answer(kind="choice", probabilities={name: 0.9, "other": 0.1}, value=name, confidence=0.8)
    out["type"] = Answer(kind="choice", probabilities={type_: 0.7, "Location": 0.3}, value=type_, confidence=0.4)
    return out


def test_seeding_writes_each_pair_once_with_what_the_model_will_see(world):
    w = world
    assert w.added == 1
    assert (w.row.a_name, w.row.b_name, w.row.reason) == ("United States", "US", "acronym")    # the head on `a`
    assert w.row.group_key and w.row.priority == 17.0
    assert 'Head: "United States" — Location, mentioned 9 times. Appears with: Iran.' in w.row.state
    assert '1. "US" — State, mentioned 8 times. Appears with: Iran. In the same document as the head 1 times.' in w.row.state
    assert dec.seed(w.db, w.run, w.graph) == 0                        # never twice


def test_a_group_is_one_request(world):
    qs = dec.questions_for([world.row], ["State", "Person"])
    assert set(qs) == {f"same:{world.row.id}", "name", "type"}
    assert list(qs["type"].criteria) == ["Location", "State", "Person"]     # the group's own first, no repeats
    assert list(qs["name"].criteria) == ["United States", "US"]


def test_one_name_under_several_types_asks_no_name(world):
    row = world.row
    row.b_name = "united states"
    assert "name" not in dec.questions_for([row], [])


@pytest.mark.parametrize("p,status", [(0.93, "merged"), (0.08, "separate"), (0.6, "unsure")])
def test_the_threshold_decides_what_takes_effect(world, p, status):
    s = dec.ResolverSettings(running=True, threshold=0.8)
    [row] = dec.decide(world.db, [world.row], _answers([world.row], p), s, canon_id=None)
    assert row.status == status
    assert (row.keep, row.name, row.type, row.decided_by) == ("a", "United States", "State", None)
    assert row.canon_effect is None                                     # run scope writes nothing else


def test_a_canon_scoped_merge_is_written_and_taken_back(world):
    w = world
    s = dec.ResolverSettings(running=True, scope="canon")
    [row] = dec.decide(w.db, [w.row], _answers([w.row], 0.95), s, canon_id=w.canon.id)
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
    [row] = dec.decide(w.db, [w.row], _answers([w.row], 0.95, type_="State"), dec.ResolverSettings(scope="canon"), w.canon.id)
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
    [row] = dec.decide(w.db, [w.row], _answers([w.row], 0.95), dec.ResolverSettings(scope="canon"), w.canon.id)
    assert "skipped" in row.canon_effect
    assert row.status == "merged"                                       # the run layer still carries it


def test_a_person_overrides_the_model_and_the_trail_keeps_both(world):
    w = world
    dec.decide(w.db, [w.row], _answers([w.row], 0.6), dec.ResolverSettings(), None)        # unsure
    row = dec.change(w.db, w.row, w.uid, verdict="merged", keep="b", type="State")
    assert (row.status, row.keep, row.name, row.confidence, row.decided_by) == ("merged", "b", None, 1.0, w.uid)
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
        assert {"name", "type"} <= set(questions) and state
        if self.during:
            self.during()
        out = {k: _same(self.p_same) for k in questions if k.startswith("same:")}
        return {**out, **{k: v for k, v in _answers([], 0).items() if k in questions}}


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
    assert w.row.status == "merged" and w.row.name == "United States" and w.row.model == "m"
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


def test_a_waiting_pair_moves_with_its_labels_mentions(db):
    uid = _user(db, "resolver-rank")
    iid = _infospace(db, uid, "resolver-rank")
    run = db.get(AnnotationRun, _run(db, iid, uid, "r"))
    graph = lambda f: types.SimpleNamespace(  # noqa: E731
        nodes=[_node("US", "State", f, [1]), _node("United States", "State", 4, [2])], edges=[])
    dec.seed(db, run, graph(2))
    row = db.exec(select(EntityDecision).where(EntityDecision.run_id == run.id)).one()
    assert row.priority == 6.0
    assert dec.seed(db, run, graph(900)) == 0                       # not filed twice …
    db.flush()
    db.refresh(row)
    assert row.priority == 904.0 and "mentioned 900 times" in row.state   # … but re-ranked


def test_a_hand_merge_reuses_the_pairs_row_and_files_new_ones(world):
    w = world
    rows = dec.merge_by_hand(
        w.db, w.run, Entity("United States", "Location"),
        [Entity("US", "State"), Entity("USA", "Location")], w.uid, type="Location",
    )
    w.db.flush()
    assert [r.id == w.row.id for r in rows] == [True, False]        # the filed pair, then a new one
    assert [(r.status, r.decided_by, r.type) for r in rows] == [("merged", w.uid, "Location")] * 2
    assert rows[0].keep == "a" and rows[1].keep == "a" and rows[1].reason == "manual"
    dec.rollback(w.db, rows[1], w.uid)
    assert rows[1].status == "rolled_back"


def test_a_group_lands_member_by_member(db):
    """One request about a head and three labels: each member's own answer
    decides it, the group's label and type go on all of them, and a member
    named by the group keeps its own side."""
    uid = _user(db, "resolver-group")
    iid = _infospace(db, uid, "resolver-group")
    run = db.get(AnnotationRun, _run(db, iid, uid, "r"))
    nodes = [_node("Trump", "Person", 417, [1]), _node("Donald Trump", "Person", 7000, [1, 2]),
             _node("President Trump", "Person", 110, [2]), _node("Donald Trump Jr.", "Person", 60, [3]),
             *(_node(f"Trump {x} policy", "Policy", 1, [4]) for x in range(40))]
    dec.seed(db, run, types.SimpleNamespace(nodes=nodes, edges=[]))
    db.flush()
    head = db.exec(select(EntityDecision).where(EntityDecision.run_id == run.id, EntityDecision.a_name == "Donald Trump")
                   .order_by(EntityDecision.id)).all()
    assert [r.b_name for r in head] == ["Trump", "President Trump", "Donald Trump Jr."]
    assert len({r.group_key for r in head}) == 1 and len({r.state for r in head}) == 1

    rows = dec.decide(db, head, _answers(head, [0.95, 0.91, 0.06], name="Donald Trump", type_="Person"),
                      dec.ResolverSettings(), None)
    assert [r.status for r in rows] == ["merged", "merged", "separate"]
    assert {(r.name, r.type, r.keep) for r in rows} == {("Donald Trump", "Person", "a")}

    rows = dec.decide(db, head, _answers(head, [0.95, 0.6, 0.06], name="President Trump", type_="Person"),
                      dec.ResolverSettings(), None)
    assert [r.status for r in rows] == ["merged", "unsure", "separate"]
    assert [r.keep for r in rows] == ["a", "b", "a"]                   # the member the group is named after
