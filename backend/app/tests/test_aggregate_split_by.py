"""AnnotationQuery.aggregate(split_by=...) — two-dimensional grouping.

Verifies that ``split_by`` pivots each ``(bucket, split_value)`` pair into a
separate row. The frontend consumes those rows to render N series on a
grouped timeline (or clustered bars, small-multiple pies, etc.).

Covers:
  - basic split: one field splits another
  - temporal × split: date buckets × categorical split
  - LATERAL elem: split path shares the primary group's explosion
  - root split over exploded group: split reads from annotation root
  - merge-map application on the split dimension
  - validation: split explosion without group explosion is rejected
"""
from __future__ import annotations

import json

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
    conn = pg_engine.connect()
    tx = conn.begin()
    s = Session(bind=conn)
    yield s
    s.close()
    tx.rollback()
    conn.close()


def _user(db, suffix: str) -> int:
    r = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:e, 'x', true, false, true, 't', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"e": f"split_{suffix}@t.local"},
    )
    return int(r.scalar())


def _infospace(db, uid: int, name: str) -> int:
    r = db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    )
    return int(r.scalar())


def _schema(db, iid: int, uid: int) -> int:
    r = db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES ('s', 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"iid": iid, "uid": uid},
    )
    return int(r.scalar())


def _run(db, iid: int, uid: int) -> int:
    r = db.execute(
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
    return int(r.scalar())


def _asset(db, iid: int, uid: int, title: str) -> int:
    r = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(:b AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"t": title, "iid": iid, "uid": uid, "b": []},
    )
    return int(r.scalar())


def _annotation(db, iid: int, uid: int, rid: int, sid: int, aid: int, value: dict) -> int:
    r = db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"r": rid, "s": sid, "a": aid, "v": json.dumps(value), "iid": iid, "uid": uid},
    )
    return int(r.scalar())


@pytest.fixture
def fx(db):
    uid = _user(db, "a")
    iid = _infospace(db, uid, "split-aggregate")
    sid = _schema(db, iid, uid)
    rid = _run(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    # Scalar group + scalar split; same party distribution across days
    _annotation(db, iid, uid, rid, sid, a, {
        "party": "A", "topic": "climate", "published": "2026-03-01T00:00:00Z"
    })
    _annotation(db, iid, uid, rid, sid, a, {
        "party": "A", "topic": "economy", "published": "2026-03-01T00:00:00Z"
    })
    _annotation(db, iid, uid, rid, sid, a, {
        "party": "B", "topic": "climate", "published": "2026-03-01T00:00:00Z"
    })
    _annotation(db, iid, uid, rid, sid, a, {
        "party": "A", "topic": "climate", "published": "2026-04-01T00:00:00Z"
    })
    _annotation(db, iid, uid, rid, sid, a, {
        "party": "B", "topic": "economy", "published": "2026-04-01T00:00:00Z"
    })
    # Exploded group fixtures: each annotation carries an events[*] array with
    # nested party / kind / score. Each event contributes one (bucket, split)
    # row. Score is used by ``test_value_field_exploded_group_root`` to verify
    # the symmetric-explosion path (value_field brings the LATERAL, group_by
    # reads from annotation root).
    _annotation(db, iid, uid, rid, sid, a, {
        "topic": "politics",
        "events": [
            {"kind": "speech", "party": "A", "score": 3},
            {"kind": "speech", "party": "B", "score": 5},
            {"kind": "vote",   "party": "A", "score": 7},
        ],
    })
    return {"iid": iid, "rid": rid, "sid": sid}


def test_split_by_pivots_second_dim(db, fx):
    """party grouped by topic — each (party, topic) becomes its own bucket."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate("party", split_by="topic")
    )
    assert agg.split_field_path == "topic"
    # Drop null-keyed buckets (the events[*] annotation has no root party).
    pairs = {
        (b.key, b.split_value): b.count
        for b in agg.buckets
        if b.key
    }
    assert pairs == {
        ("A", "climate"): 2,
        ("A", "economy"): 1,
        ("B", "climate"): 1,
        ("B", "economy"): 1,
    }


def test_temporal_split(db, fx):
    """date-bucketed group × party split — timeline by party."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate("published", interval="month", split_by="party")
    )
    assert agg.interval == "month"
    assert agg.split_field_path == "party"
    # Each month should appear twice (once per party that has data there).
    months = {b.key for b in agg.buckets}
    assert len(months) == 2  # March + April
    for b in agg.buckets:
        assert b.split_value in ("A", "B")


def test_split_without_primary_returns_single_dim(db, fx):
    """split_by=None — keeps the single-dim behavior; no regression."""
    agg = AnnotationQuery(db, fx["iid"]).scope(None).aggregate("party")
    assert agg.split_field_path is None
    assert all(b.split_value is None for b in agg.buckets)


def test_split_by_applies_merge_map(db, fx):
    """Alias A→Alpha so split values collapse through the merge map."""
    alias = MergeMap(
        field_path="party",
        entries=[MergeMapEntry(keep="Alpha", names=["A"])],
    )
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .merge(alias)
        .aggregate("topic", split_by="party")
    )
    split_vals = {b.split_value for b in agg.buckets}
    # Alpha should replace A; B is untouched.
    assert "Alpha" in split_vals
    assert "A" not in split_vals
    assert "B" in split_vals


def test_exploded_group_root_split(db, fx):
    """events[*].kind grouped, root-level non-exploded split. Since the
    only exploded annotation has no root `party`, split_value is None."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate("events[*].kind", split_by="party")
    )
    # 3 events: 2 speech, 1 vote. Root `party` is null for the exploded row.
    kinds = {b.key: b.count for b in agg.buckets}
    assert kinds.get("speech") == 2
    assert kinds.get("vote") == 1


def test_shared_explosion_split(db, fx):
    """Both group_by and split_by share the events[*] explosion — party on
    each event splits the kind bucket."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate("events[*].kind", split_by="events[*].party")
    )
    pairs = {(b.key, b.split_value): b.count for b in agg.buckets}
    assert pairs.get(("speech", "A")) == 1
    assert pairs.get(("speech", "B")) == 1
    assert pairs.get(("vote", "A")) == 1


def test_split_explosion_with_root_group(db, fx):
    """Root-level group_by + exploded split_by — the LATERAL binds to the
    split's array and the root group is read stably across each element.
    Annotations without the array contribute no rows (LATERAL is strict on
    NULL jsonb), which is the correct semantics when the user asks for
    per-element aggregation."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate("party", split_by="events[*].kind")
    )
    # Only the one annotation with `events` contributes. Its root `party` is
    # NULL (None key) so the group bucket is empty string.
    pairs = {(b.key, b.split_value): b.count for b in agg.buckets}
    assert pairs.get(("", "speech")) == 2
    assert pairs.get(("", "vote")) == 1


def test_value_field_exploded_group_root(db, fx):
    """Root-level group_by + exploded value_field: the LATERAL binds to the
    value_field's array so sum/avg/max of the exploded numeric works even
    when the time/group axis sits above the explosion. This is the core
    chart use case — x = asset-level date, y = sum(events[*].score)."""
    agg = (
        AnnotationQuery(db, fx["iid"])
        .scope(None)
        .aggregate(
            "topic",                      # root group
            function="sum",
            value_field="events[*].score",  # exploded measure
        )
    )
    # Only the events-carrying annotation has a non-null topic ("politics").
    # Sum of scores = 3 + 5 + 7 = 15. Count = 3 (one per event).
    matches = [b for b in agg.buckets if b.key == "politics"]
    assert len(matches) == 1
    b = matches[0]
    assert b.count == 3
    assert b.stats is not None
    assert b.stats["events[*].score"]["sum"] == 15.0


def test_cartesian_rejected_across_different_arrays(db, fx):
    """Two different arrays can't both be exploded in one aggregate — that
    would require two LATERAL joins and produce a cartesian product."""
    # Use events[*].kind as group and a hypothetical second-array split on
    # the same annotation (a non-existent path). Backend can't know two
    # arrays would be distinct at validation time, so we simulate it with
    # a value_field that names a different array. The explosion check fires
    # during path parsing before any row read.
    with pytest.raises(ValueError, match="cartesian product"):
        AnnotationQuery(db, fx["iid"]).scope(None).aggregate(
            "events[*].kind",
            split_by="other_array[*].name",
        )
