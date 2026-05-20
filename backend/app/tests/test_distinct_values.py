"""Tests for AnnotationQuery.distinct_values + ``POST /distinct_values`` route.

Exercises the server-side distinct-values primitive that backs the panel
Value Alias manager. Scans via GIN-index-friendly lateral where possible;
prefix ILIKE pushdown keeps 5M-scale scans bounded on keystroke.
"""
from __future__ import annotations

import json as _json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.core.filters import MergeMap, MergeMapEntry


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
            "VALUES (:email, 'x', true, false, true, 'T', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"dv_{suffix}@t.local"},
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


def _schema(db, iid: int, uid: int) -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES ('s', 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _run(db, iid: int, uid: int) -> int:
    result = db.execute(
        text(
            "INSERT INTO annotationrun (name, description, configuration, "
            "infospace_id, user_id, status, uuid, created_at, updated_at, "
            "include_parent_context, context_window, trigger_type, run_type, "
            "follow_on_version_change) "
            "VALUES ('r', 'd', '{}'::jsonb, :iid, :uid, 'PENDING', "
            "gen_random_uuid()::text, now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false) "
            "RETURNING id"
        ),
        {"iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _asset(db, iid: int, uid: int) -> int:
    result = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES ('a', 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"iid": iid, "uid": uid, "bids": []},
    )
    return int(result.scalar())


def _annotation(db, iid, uid, run_id, schema_id, asset_id, value):
    db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now())"
        ),
        {"r": run_id, "s": schema_id, "a": asset_id, "v": _json.dumps(value), "iid": iid, "uid": uid},
    )


@pytest.fixture
def dv_fixture(db):
    uid = _user(db, "x")
    iid = _infospace(db, uid, "dv")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid)
    r = _run(db, iid, uid)

    # Party values with deliberate aliasing candidates.
    parties = [
        "FDP", "FDP", "FDP",
        "Freie Partei Deutschlands",  # should alias to FDP
        "F.D.P.",                      # should alias to FDP
        "SPD", "SPD",
        "CDU",
    ]
    for p in parties:
        _annotation(db, iid, uid, r, sid, a, {"party": p})
    return {"iid": iid, "run": r}


# ─── core cases ─────────────────────────────────────────────────────────────


def test_distinct_values_returns_counts(db, dv_fixture):
    aq = AnnotationQuery(db, dv_fixture["iid"]).scope(None).runs([dv_fixture["run"]])
    items = aq.distinct_values("party", limit=100)
    values = {e.value: e.count for e in items}
    # Raw, un-aliased.
    assert values["FDP"] == 3
    assert values["SPD"] == 2
    assert values["CDU"] == 1
    assert values["Freie Partei Deutschlands"] == 1
    assert values["F.D.P."] == 1


def test_distinct_values_prefix_search(db, dv_fixture):
    aq = AnnotationQuery(db, dv_fixture["iid"]).scope(None).runs([dv_fixture["run"]])
    items = aq.distinct_values("party", search="F", limit=100)
    values = {e.value for e in items}
    # Only F-prefixed values.
    assert "FDP" in values
    assert "F.D.P." in values
    assert "Freie Partei Deutschlands" in values
    assert "SPD" not in values
    assert "CDU" not in values


def test_distinct_values_respects_limit(db, dv_fixture):
    aq = AnnotationQuery(db, dv_fixture["iid"]).scope(None).runs([dv_fixture["run"]])
    items = aq.distinct_values("party", limit=2)
    assert len(items) == 2  # top 2 by count


def test_distinct_values_applies_merge_map(db, dv_fixture):
    """With MergeMap configured, aliased variants collapse into the canonical bucket."""
    mm = MergeMap(
        field_path="party",
        entries=[
            MergeMapEntry(keep="FDP", names=["Freie Partei Deutschlands", "F.D.P."]),
        ],
    )
    aq = (
        AnnotationQuery(db, dv_fixture["iid"])
        .scope(None)
        .runs([dv_fixture["run"]])
        .merge(mm)
    )
    items = aq.distinct_values("party", limit=100)
    values = {e.value: e.count for e in items}
    # FDP bucket absorbs the 2 aliased values → 3 + 1 + 1 = 5
    assert values["FDP"] == 5
    # Raw variants should NOT appear separately.
    assert "Freie Partei Deutschlands" not in values
    assert "F.D.P." not in values


def test_distinct_values_caps_at_1000(db, dv_fixture):
    """The method clamps requested limit to 1000 to bound server load."""
    aq = AnnotationQuery(db, dv_fixture["iid"]).scope(None).runs([dv_fixture["run"]])
    # Silly over-limit — should still work, truncated internally to 1000.
    items = aq.distinct_values("party", limit=9999)
    # Our fixture has 5 distinct parties; the clamp doesn't fail.
    assert len(items) == 5


def test_distinct_values_skips_null_and_empty(db):
    """Values that are NULL or empty string don't appear in the result."""
    uid = _user(db, "skip")
    iid = _infospace(db, uid, "dv-skip")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid)
    r = _run(db, iid, uid)

    _annotation(db, iid, uid, r, sid, a, {"party": "FDP"})
    _annotation(db, iid, uid, r, sid, a, {"party": ""})
    _annotation(db, iid, uid, r, sid, a, {})  # party missing entirely

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    items = aq.distinct_values("party", limit=100)
    values = {e.value for e in items}
    assert values == {"FDP"}
