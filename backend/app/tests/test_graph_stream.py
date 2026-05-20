"""Tests for modules/graph/stream.py — chunked graph streaming."""
from __future__ import annotations

import asyncio
import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.graph.stream import (
    AnnotationGraphSource,
    collect_graph,
    stream_graph,
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


def _user(db, suffix: str) -> int:
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'T', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"gs_{suffix}@t.local"},
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
def fixture_annotations(db):
    uid = _user(db, "stream")
    iid = _infospace(db, uid, "graph-stream")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Create 6 annotations each with 1 triplet — 12 unique entities
    for i in range(6):
        _annotation(db, iid, uid, r, sid, a, {
            "triplets": [
                {"subject_name": f"S{i}", "subject_type": "person",
                 "predicate": "knows",
                 "object_name": f"O{i}", "object_type": "org"},
            ]
        })
    return {"iid": iid, "uid": uid, "run": r}


async def _drain(it):
    return [c async for c in it]


def test_annotation_source_yields_chunks_progressively(db, fixture_annotations):
    f = fixture_annotations
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    chunks = asyncio.run(_drain(
        stream_graph(db, f["iid"], source, top_n_nodes=None, top_n_edges=None, chunk_size=3)
    ))

    assert len(chunks) >= 2  # 6 rows / chunk_size=3 → 2+ chunks
    total_nodes = sum(len(c.nodes) for c in chunks)
    total_edges = sum(len(c.edges) for c in chunks)
    assert total_nodes == 12  # 6 subjects + 6 objects, all unique
    assert total_edges == 6


def test_top_n_nodes_caps_stream(db, fixture_annotations):
    f = fixture_annotations
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    chunks = asyncio.run(_drain(
        stream_graph(db, f["iid"], source, top_n_nodes=4, top_n_edges=None, chunk_size=3)
    ))
    total_nodes = sum(len(c.nodes) for c in chunks)
    assert total_nodes <= 6  # First chunk carries ~6 nodes, cap stops emission


def test_collect_graph_drains_stream(db, fixture_annotations):
    f = fixture_annotations
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    result = asyncio.run(collect_graph(
        db, f["iid"], source, top_n_nodes=None, top_n_edges=None, chunk_size=3,
    ))
    assert len(result.nodes) == 12
    assert len(result.edges) == 6


def test_scope_empty_yields_nothing(db, fixture_annotations):
    f = fixture_annotations
    from app.api.modules.identity_infospace_user.access import PackageScope
    aq = AnnotationQuery(db, f["iid"]).scope(PackageScope())  # empty scope
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    chunks = asyncio.run(_drain(
        stream_graph(db, f["iid"], source, top_n_nodes=None, chunk_size=3)
    ))
    assert chunks == []


def test_annotation_query_graph_stream_delegates(db, fixture_annotations):
    """AnnotationQuery.graph_stream() exposes stream_graph via delegation."""
    f = fixture_annotations
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    chunks = asyncio.run(_drain(aq.graph_stream("triplets", chunk_size=3)))
    assert len(chunks) >= 2


# ─── regression: cross-window edge dedup + cursor over multi-triplet rows ──


def test_cross_window_edges_dedup(db):
    """Repeated triplets across windows count as ONE edge.

    Earlier per-window slotting emitted N edges for the same (subj, pred,
    obj) seen in N windows, inflating ``edge_count`` and tripping the
    ``top_n_edges`` cap on duplicates rather than unique edges.
    """
    uid = _user(db, "rep")
    iid = _infospace(db, uid, "graph-rep")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # 10 annotations, every one carrying the SAME single triplet. With
    # chunk_size=3 the source yields 4 windows; the buggy implementation
    # produced 10 edges (one per row, deduped only within a window),
    # whereas the right answer is one edge with weight=10.
    for _ in range(10):
        _annotation(db, iid, uid, r, sid, a, {
            "triplets": [
                {"subject_name": "X", "subject_type": "person",
                 "predicate": "likes",
                 "object_name": "Y", "object_type": "org"},
            ]
        })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=None, chunk_size=3,
    ))
    assert len(result.nodes) == 2  # X and Y
    assert len(result.edges) == 1
    assert result.edges[0].weight == 10  # aggregated across all windows


def test_cap_counts_unique_edges_not_emissions(db):
    """``top_n_edges`` caps unique edges, not emission rows.

    Regression: with heavy duplication, the old implementation hit the cap
    via duplicate emissions and returned far fewer than ``top_n_edges`` of
    actual unique edges. This test seeds 9 unique triplets, each repeated 3x
    across 3 annotations (27 rows total). With ``top_n_edges=5`` the engine
    must cap at 5 *unique* edges — 5 distinct (subj, pred, obj) keys.
    """
    uid = _user(db, "uniq")
    iid = _infospace(db, uid, "graph-uniq")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    for _ in range(3):
        for i in range(9):
            _annotation(db, iid, uid, r, sid, a, {
                "triplets": [
                    {"subject_name": f"S{i}", "subject_type": "person",
                     "predicate": "knows",
                     "object_name": f"O{i}", "object_type": "org"},
                ]
            })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=5, chunk_size=4,
    ))
    # Cap is exactly 5 unique edges (not 5 emissions of dupes).
    edge_keys = {(e.source, e.predicate, e.target) for e in result.edges}
    assert len(edge_keys) == 5


def test_normalized_dedup_preserves_display_casing(db):
    """``dedup='normalized'`` merges casing variants but renders them in
    the first-seen original case.

    Regression: the old code lowercased names in ``windows()`` before they
    reached the slot, so even though dedup correctly merged "Apple Inc."
    and "apple inc." into one edge, both came back to the wire as
    ``apple inc.``. Display strings should respect the source data.
    """
    uid = _user(db, "case")
    iid = _infospace(db, uid, "graph-case")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # The newer annotation (higher a.id) is read first under
    # ORDER BY a.id DESC, so insert the original-case row LAST — it wins
    # first-seen and drives the display.
    _annotation(db, iid, uid, r, sid, a, {
        "triplets": [
            {"subject_name": "karyna shuliak", "subject_type": "person",
             "predicate": "associated_with",
             "object_name": "jeffrey epstein", "object_type": "person"},
        ],
    })
    _annotation(db, iid, uid, r, sid, a, {
        "triplets": [
            {"subject_name": "Karyna Shuliak", "subject_type": "PERSON",
             "predicate": "ASSOCIATED_WITH",
             "object_name": "Jeffrey Epstein", "object_type": "PERSON"},
        ],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(
        query=aq, triplet_field="triplets", dedup="normalized",
    )
    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=None, chunk_size=10,
    ))

    assert len(result.edges) == 1, "casing variants must collapse into one edge"
    edge = result.edges[0]
    assert edge.weight == 2, "edge accumulates weight across both rows"
    # Predicate and node names render in original casing (first-seen by
    # a.id DESC = the newer annotation).
    assert edge.predicate == "ASSOCIATED_WITH"
    names = {n.name for n in result.nodes}
    assert names == {"Karyna Shuliak", "Jeffrey Epstein"}


def test_lateral_resolves_unwrapped_document_envelope(db):
    """``triplet_field='document.triplets[*]'`` works when data is stored at root.

    The annotation runner merges ``document.{...}`` fields into the
    annotation root before persisting, so a schema declared with
    ``document.triplets`` lands in storage as top-level ``triplets``.
    The LATERAL must COALESCE across (a) literal-dotted-key, (b) nested,
    AND (c) unwrapped-root forms — the third case is the one that bit
    real runs (see Run 1597 / epstein_network_schema). Regression for
    that fix.
    """
    uid = _user(db, "unw")
    iid = _infospace(db, uid, "graph-unw")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # Schema declares document.triplets; runner unwraps into root.
    _annotation(db, iid, uid, r, sid, a, {
        "summary": "x",
        "triplets": [
            {"subject_name": "P", "subject_type": "person",
             "predicate": "knows",
             "object_name": "Q", "object_type": "org"},
        ],
    })

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(query=aq, triplet_field="document.triplets")

    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=None, chunk_size=10,
    ))
    assert len(result.edges) == 1
    assert len(result.nodes) == 2


def test_windows_cursor_handles_overflowing_annotation(db):
    """An annotation whose triplet array exceeds ``chunk_size`` doesn't lose tail rows.

    The old cursor advanced on ``a.id`` alone — when LATERAL produced more
    rows for one annotation than the LIMIT, the next iteration's
    ``a.id < cursor`` clause skipped the rest of that annotation. The
    ordinality cursor advances on ``(a.id, ord)`` so every triplet is
    emitted exactly once.
    """
    uid = _user(db, "ovr")
    iid = _infospace(db, uid, "graph-ovr")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")

    # ONE annotation with 7 distinct triplets. chunk_size=3 forces the
    # cursor to straddle the array — the buggy code returned only the
    # first 3 (one window) before skipping past the annotation.
    triplets = [
        {"subject_name": f"S{i}", "subject_type": "person",
         "predicate": "knows",
         "object_name": f"O{i}", "object_type": "org"}
        for i in range(7)
    ]
    _annotation(db, iid, uid, r, sid, a, {"triplets": triplets})

    aq = AnnotationQuery(db, iid).scope(None).runs([r])
    source = AnnotationGraphSource(query=aq, triplet_field="triplets")

    result = asyncio.run(collect_graph(
        db, iid, source, top_n_nodes=None, top_n_edges=None, chunk_size=3,
    ))
    assert len(result.edges) == 7  # all 7 triplets visible across windows
    assert len(result.nodes) == 14
