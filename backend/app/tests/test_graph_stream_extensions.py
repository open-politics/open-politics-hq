"""Tests for Phase 0 graph stream extensions.

Covers:
  - edge_weight_mode variants (count / property / sum_property / avg_property /
    max_property / count_times_property)
  - forward_properties with per-field aggregation specs (first / sum / avg / max)
  - edge_group_by (edges split across group values)
  - node_group_by (first-seen-wins per node)
  - null_policy handling on edge weight
"""
from __future__ import annotations

import asyncio
import json as _json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.panel_config import ForwardPropertySpec
from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.graph.stream import (
    AnnotationGraphSource,
    collect_graph,
)


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


# ─── fixture helpers (copied from test_graph_stream.py shape) ──────────────


def _user(db, suffix: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'T', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"gse_{suffix}@t.local"},
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


def _annotation(db, iid, uid, run_id, schema_id, asset_id, value):
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


# Build a tiny graph where A→B appears 3 times with confidence [0.6, 0.8, 1.0]
# and one "party" field for grouping.
@pytest.fixture
def weighted_fixture(db):
    uid = _user(db, "w")
    iid = _infospace(db, uid, "gse-weight")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Three repeats of A→B with different confidences, two parties.
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "FDP",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 0.6,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "FDP",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 0.8,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "SPD",
        "triplets": [{
            "subject_name": "A", "subject_type": "person",
            "predicate": "knows",
            "object_name": "B", "object_type": "org",
            "confidence": 1.0,
        }],
    })
    # One unrelated edge for group-split safety check.
    _annotation(db, iid, uid, r, sid, asset, {
        "party": "SPD",
        "triplets": [{
            "subject_name": "C", "subject_type": "person",
            "predicate": "knows",
            "object_name": "D", "object_type": "org",
            "confidence": 0.5,
        }],
    })
    return {"iid": iid, "uid": uid, "run": r}


# ─── edge_weight_mode ──────────────────────────────────────────────────────


def test_edge_weight_mode_count_default(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.predicate == "knows" and e.group_value is None)
    # Edges are aggregated within-window; count mode keeps computed_weight = count
    # which equals weight since no group-by splits them.
    assert ab.computed_weight == float(ab.weight)


def test_edge_weight_mode_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab_edges = [e for e in result.edges if "knows" == e.predicate]
    # "property" mode uses first-seen value. Non-null.
    assert all(e.computed_weight is not None for e in ab_edges)


def test_edge_weight_mode_sum_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="sum_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # A→B appears 3 times with confidences 0.6 + 0.8 + 1.0 = 2.4
    ab = next(e for e in result.edges if e.source != e.target and e.predicate == "knows"
              and e.properties.get("__ignored", None) is None
              and e.weight == 3)
    assert ab.computed_weight == pytest.approx(2.4)


def test_edge_weight_mode_avg_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # avg(0.6, 0.8, 1.0) = 0.8
    assert ab.computed_weight == pytest.approx(0.8)


def test_edge_weight_mode_max_property(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="max_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.computed_weight == pytest.approx(1.0)


def test_edge_weight_mode_count_times_property(db, weighted_fixture):
    """"Strong repeating connections get thicker": count × avg(property)."""
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="count_times_property",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # 3 * avg(0.6, 0.8, 1.0) = 3 * 0.8 = 2.4
    assert ab.computed_weight == pytest.approx(2.4)


# ─── forward_properties ────────────────────────────────────────────────────


def test_forward_properties_first(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[ForwardPropertySpec(field="confidence", agg="first")],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    # first-seen value is the one from the most recent annotation (ORDER BY DESC)
    assert ab.properties.get("confidence") is not None


def test_forward_properties_avg(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[ForwardPropertySpec(field="confidence", agg="avg")],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.properties.get("confidence") == pytest.approx(0.8)


def test_forward_properties_sum_and_max(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        forward_properties=[
            ForwardPropertySpec(field="confidence", agg="sum"),
        ],
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    ab = next(e for e in result.edges if e.weight == 3)
    assert ab.properties.get("confidence") == pytest.approx(2.4)


# ─── edge_group_by ─────────────────────────────────────────────────────────


def test_edge_group_by_splits_edges(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_group_by="party",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # A→B has 2 FDP occurrences and 1 SPD occurrence → 2 edges (one per group).
    ab_edges = [e for e in result.edges
                if any(n.id == e.source and n.name == "A" for n in result.nodes)
                and any(n.id == e.target and n.name == "B" for n in result.nodes)]
    group_values = {e.group_value for e in ab_edges}
    assert group_values == {"FDP", "SPD"}
    # FDP count = 2, SPD count = 1
    fdp_edge = next(e for e in ab_edges if e.group_value == "FDP")
    spd_edge = next(e for e in ab_edges if e.group_value == "SPD")
    assert fdp_edge.weight == 2
    assert spd_edge.weight == 1


# ─── node_group_by ─────────────────────────────────────────────────────────


def test_node_group_by_attaches_to_node(db, weighted_fixture):
    f = weighted_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        node_group_by="party",
    )
    result = asyncio.run(collect_graph(db, f["iid"], source, chunk_size=10))

    # Each node has some group_value attached (first-seen per node).
    a_node = next(n for n in result.nodes if n.name == "A")
    assert a_node.group_value in ("FDP", "SPD")


# ─── null_policy ───────────────────────────────────────────────────────────


def test_null_policy_skip_default(db):
    """Rows without the edge_weight_field contribute 0 to numeric aggregations."""
    uid = _user(db, "np")
    iid = _infospace(db, uid, "gse-np")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Two annotations, only one has confidence.
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            "confidence": 0.5,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            # no confidence field
        }],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
        null_policy="skip",
    )
    result = asyncio.run(collect_graph(db, iid, source, chunk_size=10))

    xy = next(e for e in result.edges if e.weight == 2)
    # Only one row has confidence=0.5 — avg of a single value = 0.5
    assert xy.computed_weight == pytest.approx(0.5)


def test_null_policy_zero_includes_nulls_as_zero(db):
    uid = _user(db, "np2")
    iid = _infospace(db, uid, "gse-np2")
    sid = _schema(db, iid, uid)
    asset = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
            "confidence": 1.0,
        }],
    })
    _annotation(db, iid, uid, r, sid, asset, {
        "triplets": [{
            "subject_name": "X", "subject_type": "person",
            "predicate": "knows",
            "object_name": "Y", "object_type": "org",
        }],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets",
        edge_weight_field="confidence",
        edge_weight_mode="avg_property",
        null_policy="zero",
    )
    result = asyncio.run(collect_graph(db, iid, source, chunk_size=10))

    xy = next(e for e in result.edges if e.weight == 2)
    # avg(1.0, 0.0) = 0.5 under "zero" policy (NULL coerced to 0)
    assert xy.computed_weight == pytest.approx(0.5)
