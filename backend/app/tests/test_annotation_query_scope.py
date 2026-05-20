"""AnnotationQuery.scope() — 9-case matrix (3 materializations × 3 scope states).

The scope predicate lives in ``_base_where`` so ``results()``, ``aggregate()``,
and ``graph()`` all pick it up. These tests enforce that invariant: if the
predicate ever stops running through ``_base_where`` (or if some
materialization builds its own WHERE without calling it), the matrix catches
the regression.
"""
from __future__ import annotations

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.identity_infospace_user.access import PackageScope


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


def _user(db, suffix: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'Test', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"scope_{suffix}@t.local"},
    )
    return int(result.scalar())


def _infospace(db, uid: int, name: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    )
    return int(result.scalar())


def _schema(db, iid: int, uid: int, name: str = "s") -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES (:n, 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _run(db, iid: int, uid: int, name: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationrun (name, description, configuration, "
            "infospace_id, user_id, status, uuid, created_at, updated_at, "
            "include_parent_context, context_window, trigger_type, run_type, "
            "follow_on_version_change) "
            "VALUES (:n, 'd', '{}'::jsonb, :iid, :uid, 'PENDING', "
            "gen_random_uuid()::text, now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false) "
            "RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _asset(db, iid: int, uid: int, title: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"t": title, "iid": iid, "uid": uid, "bids": []},
    )
    return int(result.scalar())


def _annotation(
    db,
    iid: int,
    uid: int,
    run_id: int,
    schema_id: int,
    asset_id: int,
    value: dict,
) -> int:
    import json as _json
    result = db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"r": run_id, "s": schema_id, "a": asset_id, "v": _json.dumps(value), "iid": iid, "uid": uid},
    )
    return int(result.scalar())


@pytest.fixture
def fixture_three_runs(db):
    """Two runs with rows; a third empty-scope case handled per-test."""
    uid = _user(db, "m")
    iid = _infospace(db, uid, "scope-matrix")
    sid = _schema(db, iid, uid)
    a1 = _asset(db, iid, uid, "asset-a")
    a2 = _asset(db, iid, uid, "asset-b")
    r1 = _run(db, iid, uid, "run-1")
    r2 = _run(db, iid, uid, "run-2")
    _annotation(db, iid, uid, r1, sid, a1, {"sentiment": "positive", "triplets": [
        {"subject_name": "A", "predicate": "mentions", "object_name": "B",
         "subject_type": "person", "object_type": "org"}
    ]})
    _annotation(db, iid, uid, r1, sid, a1, {"sentiment": "negative", "triplets": [
        {"subject_name": "C", "predicate": "mentions", "object_name": "D",
         "subject_type": "person", "object_type": "org"}
    ]})
    _annotation(db, iid, uid, r2, sid, a2, {"sentiment": "neutral", "triplets": [
        {"subject_name": "E", "predicate": "mentions", "object_name": "F",
         "subject_type": "person", "object_type": "org"}
    ]})
    return {"iid": iid, "uid": uid, "sid": sid, "run1": r1, "run2": r2}


# ─── results() × 3 scope states ─────────────────────────────────────────────


def test_results_scope_none_returns_all(db, fixture_three_runs):
    f = fixture_three_runs
    page = AnnotationQuery(db, f["iid"]).scope(None).results()
    assert page.total == 3


def test_results_scope_populated_restricts_to_grants(db, fixture_three_runs):
    f = fixture_three_runs
    scope = PackageScope(run_ids=(f["run1"],))
    page = AnnotationQuery(db, f["iid"]).scope(scope).results()
    assert page.total == 2
    assert all(row.run_id == f["run1"] for row in page.items)


def test_results_scope_empty_returns_nothing(db, fixture_three_runs):
    f = fixture_three_runs
    page = AnnotationQuery(db, f["iid"]).scope(PackageScope()).results()
    assert page.total == 0
    assert page.items == []


# ─── aggregate() × 3 scope states ───────────────────────────────────────────


def test_aggregate_scope_none_returns_all(db, fixture_three_runs):
    f = fixture_three_runs
    agg = AnnotationQuery(db, f["iid"]).scope(None).aggregate("sentiment")
    keys = {b.key for b in agg.buckets}
    assert keys == {"positive", "negative", "neutral"}


def test_aggregate_scope_populated_restricts(db, fixture_three_runs):
    f = fixture_three_runs
    scope = PackageScope(run_ids=(f["run1"],))
    agg = AnnotationQuery(db, f["iid"]).scope(scope).aggregate("sentiment")
    keys = {b.key for b in agg.buckets}
    assert keys == {"positive", "negative"}


def test_aggregate_scope_empty_returns_nothing(db, fixture_three_runs):
    f = fixture_three_runs
    agg = AnnotationQuery(db, f["iid"]).scope(PackageScope()).aggregate("sentiment")
    assert agg.buckets == []
    assert agg.total_count == 0


# ─── graph() × 3 scope states ───────────────────────────────────────────────


def test_graph_scope_none_returns_all(db, fixture_three_runs):
    f = fixture_three_runs
    g = AnnotationQuery(db, f["iid"]).scope(None).graph("triplets")
    names = {n.name for n in g.nodes}
    # All six entities from three annotations
    assert names == {"A", "B", "C", "D", "E", "F"}


def test_graph_scope_populated_restricts(db, fixture_three_runs):
    f = fixture_three_runs
    scope = PackageScope(run_ids=(f["run1"],))
    g = AnnotationQuery(db, f["iid"]).scope(scope).graph("triplets")
    names = {n.name for n in g.nodes}
    assert names == {"A", "B", "C", "D"}


def test_graph_scope_empty_returns_nothing(db, fixture_three_runs):
    f = fixture_three_runs
    g = AnnotationQuery(db, f["iid"]).scope(PackageScope()).graph("triplets")
    assert g.nodes == []
    assert g.edges == []
