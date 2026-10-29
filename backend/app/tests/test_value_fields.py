"""Numbers read per array element — an actor's score as the actor's own."""
from __future__ import annotations

from app.tests.test_network import (  # noqa: F401 — fixtures
    _annotation, _asset, _infospace, _run, _schema_with, _user, db, pg_engine, scored,
)


def test_each_element_keeps_its_own_number_and_the_entity_it_names(scored):
    rows = scored.scope.query().number_elements("document.actors[*].stance", "name")
    names = {v: k for k, v in scored.anns.items()}
    got = sorted((names[a], who, v) for a, who, v in rows)
    assert got == [
        ("high", "d", 9.0), ("low", "a", 2.0), ("low", "b", 4.0), ("mid", "c", 1.0), ("odd", "e", 3.0),
    ]


import types

import pytest

from app.api.modules.annotation import overview as ov
from app.api.modules.graph import network as net
from app.tests.test_network import entity

ACTORS = {"type": "object", "properties": {"document": {"type": "object", "properties": {
    "actors": {"type": "array", "items": {"type": "object", "properties": {
        "actor": entity("person"),
        "stance": {"type": "integer", "minimum": 1, "maximum": 10},
    }}},
}}}}


@pytest.fixture
def actors(db):
    from app.api.modules.annotation.models import RunSchemaLink

    uid = _user(db, "actors")
    iid = _infospace(db, uid, "actors")
    sid = _schema_with(db, iid, uid, ACTORS)
    run = _run(db, iid, uid, "actors")
    db.add(RunSchemaLink(run_id=run, schema_id=sid))
    who = lambda n, s: {"actor": {"name": n, "type": "person"}, "stance": s}  # noqa: E731
    anns = {
        "one": _annotation(db, iid, uid, run, sid, _asset(db, iid, uid, "one"),
                           {"document": {"actors": [who("Ann", 10), who("Bob", 1)]}}),
        "two": _annotation(db, iid, uid, run, sid, _asset(db, iid, uid, "two"),
                           {"document": {"actors": [who("Ann", 4), who("Ann", 6)]}}),
    }
    db.flush()
    scope = ov.open_scope(db, types.SimpleNamespace(infospace_id=iid, scope=None), run)
    return types.SimpleNamespace(scope=scope, anns=anns)


def test_a_score_inside_an_array_of_actors_is_weighed_per_actor(actors):
    out = net.weigh(actors.scope, "document.actors[*].stance", "value")
    names = {v: k for k, v in actors.anns.items()}
    el = out["element"]
    got = sorted((names[a], n, round(w, 4)) for a, n, w in zip(el["annotation"], el["name"], el["weights"]))
    # On the declared 1–10 scale: Ann 10 and Bob 1 in one; Ann's two rows (4, 6) as one mean 5 in two.
    assert got == [("one", "Ann", 1.0), ("one", "Bob", 0.0), ("two", "Ann", 0.4444)]
    assert el["scale"]["by"] == "declared"
    # The document reading stands beside it: each annotation's mean.
    assert sorted(round(w, 4) for w in out["annotation"]["weights"]) == [0.4444, 0.5]


def test_a_document_level_number_has_no_element_reading(scored):
    assert "element" not in net.weigh(scored.scope, "document.severity", "value")


def test_numbers_read_signs_fractions_and_exponents_and_never_overflow(db):
    uid = _user(db, "nums")
    iid = _infospace(db, uid, "nums")
    sid = _schema_with(db, iid, uid, {"type": "object", "properties": {"v": {"type": "string"}}})
    run = _run(db, iid, uid, "nums")
    vals = {"plus": "+3", "frac": ".5", "exp": "1e2", "huge": "9" * 400, "far": "1e400", "spaced": " 7 ", "word": "high"}
    anns = {k: _annotation(db, iid, uid, run, sid, _asset(db, iid, uid, k), {"v": v}) for k, v in vals.items()}
    db.flush()
    scope = ov.open_scope(db, types.SimpleNamespace(infospace_id=iid, scope=None), run)
    got = {k: v for a, v in scope.query().numbers("v") for k, i in anns.items() if i == a}
    assert got == {"plus": 3.0, "frac": 0.5, "exp": 100.0, "spaced": 7.0}
    # A threshold judges the same numbers, and a value too large to read is
    # absent there too — never an error.
    out = net.weigh(scope, "v", "ge", 3)
    assert sorted(out["annotation"]["weights"]) == [0.0, 1.0, 1.0, 1.0]


def test_a_bad_threshold_is_refused_before_anything_is_read(scored):
    for op, value in (("between", "12"), ("between", [5, 1]), ("ge", "x"), ("ge", True)):
        with pytest.raises(ValueError):
            net.weigh(scored.scope, "document.severity", op, value)
    with pytest.raises(ValueError):
        scored.scope.query().numbers("document.a[*].b[*].c")
