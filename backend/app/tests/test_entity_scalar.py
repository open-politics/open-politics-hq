"""One rule for reading an entity value, asserted across every materialisation.

An entity-typed field stores ``{name, type, additional_types}``. Six places
turned a JSONB value into a scalar — the relation engine's dimensions, the
legacy aggregate's group/split, ``distinct_values``, the FilterSet compiler and
GQL's row conditions — and every one of them extracted the object as text, so a
chart grouped by "who paid" produced ``{"name": "Merkel", "type": "Person"}`` as
a bucket label and no filter could ever match it back.

``core.filters.scalar_of`` is now that rule, in one function. This file is
modelled on ``test_jsonb_null_safety.py``: one cross-cutting SQL behaviour,
pinned at every site that must share it.

**The symmetry test is the important one.** A dimension and a filter disagreeing
is not a cosmetic bug — it is the click-to-filter gesture silently returning
nothing, which reads as "no data" rather than as a defect.
"""

from __future__ import annotations

import json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.formula import Dimension, Formula, Measure
from app.api.modules.annotation.query import AnnotationQuery
from app.core.filters import (
    FieldCondition,
    FilterSet,
    condition_sql,
    jsonb_scalar_accessor,
    scalar_of,
)

from app.tests.test_relation_engine import (  # noqa: F401  (fixtures)
    _annotation,
    _asset,
    _infospace,
    _run,
    _schema,
    _user,
    db,
    pg_engine,
)


# ─── Layer 1: pure — the rule, and the symmetry it exists to guarantee ──────


def test_scalar_of_reads_the_name_of_an_entity_and_passes_everything_else():
    sql = scalar_of("x")
    # The name first, the raw leaf as the fallback — in that order, or an
    # entity would render as JSON again.
    assert sql.index("->>'name'") < sql.index("#>>")


@pytest.mark.parametrize("path", ["by", "document.observations.by", "at"])
def test_a_dimension_and_a_filter_read_the_same_expression(path):
    """The contract this whole change exists to hold.

    A dimension groups on ``scalar_of``; a gesture turns that group key into an
    ``eq``. If the two sides derive the value differently, the filter cannot
    match the label the user just clicked.
    """
    dim_acc, _ = jsonb_scalar_accessor("elem", path, param_name="c_fp")
    frag, _ = condition_sql(
        FieldCondition(path=path, operator="eq", value="X"), "elem", param_prefix="c",
    )
    assert dim_acc in frag


def test_exists_still_tests_key_presence_not_value():
    """``exists`` asks whether the key is there. Routing it through the value
    rule would make a present-but-null field look absent."""
    frag, _ = condition_sql(
        FieldCondition(path="by", operator="exists", value=None), "elem",
    )
    assert "?" in frag and "->>'name'" not in frag


def test_a_path_may_now_carry_more_than_one_explosion():
    """``_valid_path`` capped explosions at one, so the dimension side could
    group by a path the filter side rejected outright."""
    FieldCondition(path="document.observations[*].by[*]", operator="eq", value="X")


# ─── Layer 2: DB-backed ─────────────────────────────────────────────────────


@pytest.fixture
def ents(db):
    """Observations whose participants are entity objects — the real shape.

    ``by`` is an array of entities (the common case), ``at`` a scalar entity,
    and one row mixes an entity object with a bare string in the same array
    because that is what a model actually emits when a contract says entity.
    """
    uid = _user(db, "ent")
    iid = _infospace(db, uid, "entity_scalar_test")
    sid = _schema(db, iid, uid, "s")
    rid = _run(db, iid, uid, "r")

    def obs(by, at, amount):
        return {"observations": [{
            "by": by, "at": at, "amount": amount, "kind": "payment",
        }]}

    king = {"name": "King of Saudi Arabia", "type": "Person"}
    olivier = {"name": "Olivier Colom", "type": "Person"}
    berlin = {"name": "Berlin", "type": "Location"}

    rows = [
        obs([king], berlin, 10.0),
        obs([king], berlin, 20.0),
        obs([olivier], berlin, 30.0),
        # An entity object and a bare string sharing one array.
        obs([king, "Unnamed foundation"], berlin, 40.0),
    ]
    for i, value in enumerate(rows):
        aid = _asset(db, iid, uid, f"doc{i}")
        _annotation(db, iid, uid, rid, sid, aid, value)

    return {"iid": iid, "uid": uid, "sid": sid, "rid": rid}


def _q(db, ents):
    return AnnotationQuery(db, ents["iid"]).runs([ents["rid"]])


def _group_by(db, ents, path, name="who"):
    f = Formula(
        id="f", name="f",
        group=[Dimension(name=name, kind="entity", path=path)],
        measures=[Measure(name="n", agg="count")],
    )
    return _q(db, ents).relation(f)


def test_grouping_an_entity_array_yields_names_not_json(db, ents):
    """The reported bug: a bar chart split by "who acted"."""
    rel = _group_by(db, ents, "observations[*].by[*]")
    keys = {r.keys["who"] for r in rel.rows}
    assert keys == {"King of Saudi Arabia", "Olivier Colom", "Unnamed foundation"}
    assert not any(k.startswith("{") for k in keys)


def test_grouping_a_scalar_entity_yields_its_name(db, ents):
    """The `chain.leaf` branch — an entity reached as a field of an element,
    which nobody notices is broken because it renders plausibly as JSON."""
    rel = _group_by(db, ents, "observations[*].at", name="where")
    assert {r.keys["where"] for r in rel.rows} == {"Berlin"}


def test_a_bare_string_beside_an_entity_object_groups_correctly(db, ents):
    """Why the rule reads the VALUE and not the contract: a model emits a bare
    string where the schema declares an entity, and both must still group."""
    rel = _group_by(db, ents, "observations[*].by[*]")
    by_key = {r.keys["who"]: r.measures["n"] for r in rel.rows}
    assert by_key["Unnamed foundation"] == 1
    assert by_key["King of Saudi Arabia"] == 3


def test_group_then_filter_round_trips(db, ents):
    """**The regression test for click-to-filter.**

    Take a group key exactly as the UI would, turn it into the ``eq`` the
    gesture emits, and re-run: the clicked bucket's count must come back
    unchanged. This failed two ways before — the key was raw JSON, and the path
    carried two ``[*]`` so the condition was rejected before reaching SQL.

    A co-participant surviving the filter is correct and is asserted, not
    filtered away: the condition selects **annotations that contain** a
    matching element, so a payment with two payers stays whole and its other
    payer is still counted. For this corpus that is the feature — narrowing to
    one actor and seeing who else was on the same manifest is the question.
    Losing it would mean filtering array elements rather than rows.
    """
    path = "observations[*].by[*]"
    rel = _group_by(db, ents, path)
    bucket = next(r for r in rel.rows if r.keys["who"] == "King of Saudi Arabia")

    narrowed = _q(db, ents).filter(FilterSet(
        logic="and",
        conditions=[FieldCondition(path=path, operator="eq", value=bucket.keys["who"])],
    )).relation(Formula(
        id="f2", name="f2",
        group=[Dimension(name="who", kind="entity", path=path)],
        measures=[Measure(name="n", agg="count")],
    ))
    got = {r.keys["who"]: r.measures["n"] for r in narrowed.rows}

    assert got["King of Saudi Arabia"] == bucket.measures["n"]
    # Olivier never shares a row with the King, so he is gone.
    assert "Olivier Colom" not in got
    # The co-payer on row 4 remains — same row, not a separate one.
    assert got["Unnamed foundation"] == 1


def test_filtering_a_nested_entity_path_narrows_rows(db, ents):
    """The nested-EXISTS ladder, from the outside: two explosions, no active
    lateral. One `jsonb_array_elements` would reach the observations and stop."""
    aq = _q(db, ents).filter(FilterSet(
        logic="and",
        conditions=[FieldCondition(
            path="observations[*].by[*]", operator="eq", value="Olivier Colom",
        )],
    ))
    rel = aq.relation(Formula(
        id="f3", name="f3",
        group=[Dimension(name="kind", kind="field", path="observations[*].kind")],
        measures=[Measure(name="n", agg="count")],
    ))
    assert sum(r.measures["n"] for r in rel.rows) == 1


def test_distinct_values_offers_names_an_alias_can_be_written_against(db, ents):
    """The value-alias manager listed `{"name": …, "type": …}` — a value the
    user could not alias and a search term that could not match."""
    vals = _q(db, ents).distinct_values("observations[*].by[*]")
    got = {v.value: v.count for v in vals}
    assert got["King of Saudi Arabia"] == 3
    assert not any(k.startswith("{") for k in got)

    # …and the ILIKE prefix search now hits, which is the manager's actual UX.
    hits = _q(db, ents).distinct_values("observations[*].by[*]", search="King")
    assert [v.value for v in hits] == ["King of Saudi Arabia"]


def test_a_measure_over_a_numeric_field_is_unaffected(db, ents):
    """Non-regression: the rule passes numbers through untouched."""
    rel = _group_by(db, ents, "observations[*].kind", name="kind")
    assert [r.keys["kind"] for r in rel.rows] == ["payment"]

    f = Formula(
        id="f4", name="f4",
        group=[Dimension(name="kind", kind="field", path="observations[*].kind")],
        measures=[Measure(name="total", agg="sum", path="observations[*].amount")],
    )
    rel = _q(db, ents).relation(f)
    assert rel.rows[0].measures["total"] == pytest.approx(100.0)
