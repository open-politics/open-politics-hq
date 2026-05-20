"""LLM-emitted JSONB ``null`` must not crash array-explosion queries.

The annotation task happily stores ``"orte": null`` (or any optional array
field) when the model leaves it unfilled — JSONB ``null`` is a value, not SQL
NULL, so ``COALESCE(..., '[]'::jsonb)`` does NOT strip it. Every call-site
that wraps a user-defined array in ``jsonb_array_elements`` must use
``safe_array_elements`` (jsonb_typeof guard).

Covers all four AnnotationQuery materializations that walk arrays:
    results() / aggregate() / graph() / distinct_values()

Plus the cooccurs operator on a same-level group (filters.py:_cooccurs_sql).
"""
from __future__ import annotations

import json as _json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.core.filters import FieldCondition, FilterSet


@pytest.fixture(scope="module")
def pg_engine():
    from app.core.config import settings
    return create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)


@pytest.fixture
def db(pg_engine):
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


def _user(db) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
                "email_verified, full_name, created_at, updated_at) "
                "VALUES ('jsonbnull@t.local', 'x', true, false, true, 'T', now(), now()) "
                "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
            )
        ).scalar()
    )


def _infospace(db, uid: int) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO infospace (name, owner_id, uuid, created_at) "
                "VALUES ('jsonb-null-safety', :u, gen_random_uuid()::text, now()) RETURNING id"
            ),
            {"u": uid},
        ).scalar()
    )


def _schema(db, iid: int, uid: int) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO annotationschema (name, description, output_contract, instructions, "
                "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
                "VALUES ('s', 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
                "gen_random_uuid()::text, now(), now()) RETURNING id"
            ),
            {"iid": iid, "uid": uid},
        ).scalar()
    )


def _run(db, iid: int, uid: int) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO annotationrun (name, description, configuration, infospace_id, "
                "user_id, status, uuid, created_at, updated_at, include_parent_context, "
                "context_window, trigger_type, run_type, follow_on_version_change) "
                "VALUES ('r', 'd', '{}'::jsonb, :iid, :uid, 'COMPLETED', "
                "gen_random_uuid()::text, now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false) "
                "RETURNING id"
            ),
            {"iid": iid, "uid": uid},
        ).scalar()
    )


def _asset(db, iid: int, uid: int, title: str) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, uuid, "
                "processing_status, stub, created_at, updated_at) "
                "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
                "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
            ),
            {"t": title, "iid": iid, "uid": uid, "bids": []},
        ).scalar()
    )


def _annotation(db, iid: int, uid: int, run_id: int, schema_id: int, asset_id: int, value: dict) -> int:
    return int(
        db.execute(
            text(
                "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, infospace_id, "
                "user_id, timestamp, uuid, created_at, updated_at) "
                "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
                "gen_random_uuid()::text, now(), now()) RETURNING id"
            ),
            {"r": run_id, "s": schema_id, "a": asset_id, "v": _json.dumps(value), "iid": iid, "uid": uid},
        ).scalar()
    )


@pytest.fixture
def fixture_mixed_nulls(db):
    """Three rows mirroring the GGL run shape: one with a real array, one with
    JSONB null, one with the key missing entirely."""
    uid = _user(db)
    iid = _infospace(db, uid)
    sid = _schema(db, iid, uid)
    rid = _run(db, iid, uid)
    a1 = _asset(db, iid, uid, "with-array")
    a2 = _asset(db, iid, uid, "jsonb-null")
    a3 = _asset(db, iid, uid, "key-missing")
    _annotation(db, iid, uid, rid, sid, a1, {
        "orte": [{"name": "Berlin", "type": "Ort"}, {"name": "Hamburg", "type": "Ort"}],
        "score": 5,
    })
    _annotation(db, iid, uid, rid, sid, a2, {"orte": None, "score": 3})  # the crash row
    _annotation(db, iid, uid, rid, sid, a3, {"score": 1})
    return {"iid": iid, "rid": rid, "sid": sid}


def test_results_with_element_eq_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """The original crash: clicking a map marker emits an ``eq`` condition on
    ``orte[*].name``. With one row carrying ``"orte": null``, the
    ``_element_exists_condition`` builder must guard against the JSONB null."""
    f = fixture_mixed_nulls
    cond = FieldCondition(path="orte[*].name", operator="eq", value="Berlin")
    aq = (
        AnnotationQuery(db, f["iid"])
        .runs([f["rid"]])
        .filter(FilterSet(logic="and", conditions=[cond]))
    )
    page = aq.results()
    assert page.total == 1, "Should match the row whose orte contains Berlin"
    assert all(row.run_id == f["rid"] for row in page.items)


def test_aggregate_explosion_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """``aggregate()`` with a LATERAL on an exploded array must skip rows
    whose array field is JSONB null instead of erroring."""
    f = fixture_mixed_nulls
    result = (
        AnnotationQuery(db, f["iid"]).runs([f["rid"]])
        .aggregate("orte[*].name")
    )
    seen = {b.key for b in result.buckets if b.key}
    assert "Berlin" in seen and "Hamburg" in seen


def test_distinct_values_explosion_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """``distinct_values`` is the third LATERAL site — keep it covered."""
    f = fixture_mixed_nulls
    entries = AnnotationQuery(db, f["iid"]).runs([f["rid"]]).distinct_values("orte[*].name")
    values = {e.value for e in entries}
    assert {"Berlin", "Hamburg"}.issubset(values)


def test_graph_triplet_explosion_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """``graph()`` walks ``a.value->'<triplet_field>'`` directly. If that
    field is JSONB null on any row, the LATERAL must not crash."""
    f = fixture_mixed_nulls
    uid_extra = _user(db)
    a4 = _asset(db, f["iid"], uid_extra, "with-triplets")
    _annotation(db, f["iid"], uid_extra, f["rid"], f["sid"], a4, {"netzwerk": [
        {"subject_name": "X", "subject_type": "Person",
         "predicate": "knows", "object_name": "Y", "object_type": "Person"}
    ]})
    a5 = _asset(db, f["iid"], uid_extra, "triplets-null")
    _annotation(db, f["iid"], uid_extra, f["rid"], f["sid"], a5, {"netzwerk": None})
    g = AnnotationQuery(db, f["iid"]).runs([f["rid"]]).graph(triplet_field="netzwerk")
    names = {n.name for n in g.nodes}
    assert {"X", "Y"}.issubset(names)


@pytest.mark.asyncio
async def test_stream_graph_explosion_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """The ``/view`` graph phase routes through ``collect_graph`` →
    ``stream_graph`` (a separate LATERAL from ``AnnotationQuery.graph()``).
    Same JSONB-null hazard applied — verify the streaming path is also safe."""
    from app.api.modules.graph.stream import AnnotationGraphSource, collect_graph

    f = fixture_mixed_nulls
    uid_extra = _user(db)
    a4 = _asset(db, f["iid"], uid_extra, "stream-with-triplets")
    _annotation(db, f["iid"], uid_extra, f["rid"], f["sid"], a4, {"netzwerk": [
        {"subject_name": "P", "subject_type": "Person",
         "predicate": "knows", "object_name": "Q", "object_type": "Person"}
    ]})
    a5 = _asset(db, f["iid"], uid_extra, "stream-triplets-null")
    _annotation(db, f["iid"], uid_extra, f["rid"], f["sid"], a5, {"netzwerk": None})

    aq = AnnotationQuery(db, f["iid"]).runs([f["rid"]])
    source = AnnotationGraphSource(query=aq, triplet_field="netzwerk", dedup="exact")
    result = await collect_graph(db, f["iid"], source, top_n_nodes=100, top_n_edges=100)
    names = {n.name for n in result.nodes}
    assert {"P", "Q"}.issubset(names)


def test_cooccurs_same_level_on_jsonb_null_does_not_crash(db, fixture_mixed_nulls):
    """``relational.cooccurs`` reach=same_level walks an array's elements via
    LATERAL. The fixture row with ``orte: null`` must not crash the query."""
    f = fixture_mixed_nulls
    cond = FieldCondition(
        path="$",
        operator="relational.cooccurs",
        value={
            "entities": ["Berlin", "Hamburg"],
            "reach": "same_level",
            "paths": ["orte[*]"],
        },
    )
    page = (
        AnnotationQuery(db, f["iid"])
        .runs([f["rid"]])
        .filter(FilterSet(logic="and", conditions=[cond]))
        .results()
    )
    # ``orte[*]`` has each element be a single entity — same_level can't hold
    # both names in one element, so the returned page is empty. The point of
    # this test is "doesn't crash on the JSONB null row," not the cooccurs
    # semantics (those are tested in test_cooccurs_operator.py).
    assert page.total == 0
