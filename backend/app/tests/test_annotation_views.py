"""Tests for modules/annotation/views.py — render generators + collect drains."""
from __future__ import annotations

import asyncio
import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.query import AnnotationQuery
from app.api.modules.annotation.views import (
    AggregateViewConfig,
    GraphViewConfig,
    collect_aggregate,
    collect_graph,
    collect_rows,
    render_aggregate,
    render_graph,
    render_rows,
)
from app.api.modules.content.schemas import (
    AggregateSectionEvent,
    DoneEvent,
    GraphChunkEvent,
    GraphSectionEvent,
    SectionEvent,
    SkeletonEvent,
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


def _user(db, suffix):
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'T', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"av_{suffix}@t.local"},
    )
    return int(result.scalar())


def _infospace(db, uid, name):
    result = db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    )
    return int(result.scalar())


def _schema(db, iid, uid):
    result = db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES (:n, 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"n": "s", "iid": iid, "uid": uid},
    )
    return int(result.scalar())


def _run(db, iid, uid, name):
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


def _asset(db, iid, uid, title):
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


def _ann(db, iid, uid, run, schema, asset, value):
    import json as _json
    result = db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, CAST(:v AS jsonb), 'SUCCESS', :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"r": run, "s": schema, "a": asset, "v": _json.dumps(value), "iid": iid, "uid": uid},
    )
    return int(result.scalar())


@pytest.fixture
def annotation_fixture(db):
    uid = _user(db, "x")
    iid = _infospace(db, uid, "av")
    sid = _schema(db, iid, uid)
    a = _asset(db, iid, uid, "a")
    r = _run(db, iid, uid, "r")
    for i in range(3):
        _ann(db, iid, uid, r, sid, a, {
            "sentiment": "positive" if i % 2 == 0 else "negative",
            "triplets": [
                {"subject_name": f"S{i}", "subject_type": "person",
                 "predicate": "acts", "object_name": f"O{i}", "object_type": "thing"},
            ],
        })
    return {"iid": iid, "run": r}


async def _drain(agen):
    return [e async for e in agen]


def test_render_rows_event_order(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    events = asyncio.run(_drain(render_rows(aq)))
    names = [e.name for e in events]
    assert names[0] == "skeleton"
    assert "section" in names
    assert "count" in names
    assert names[-1] == "done"
    section_evs = [e for e in events if isinstance(e, SectionEvent)]
    assert section_evs[0].role == "primary"


def test_render_aggregate(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    cfg = AggregateViewConfig(group_by="sentiment")
    events = asyncio.run(_drain(render_aggregate(aq, cfg)))
    agg_evs = [e for e in events if isinstance(e, AggregateSectionEvent)]
    assert len(agg_evs) == 1
    assert {b.key for b in agg_evs[0].buckets} == {"positive", "negative"}


def test_render_graph_stream(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    cfg = GraphViewConfig(triplet_field="triplets", chunk_size=2, stream=True)
    events = asyncio.run(_drain(render_graph(aq, cfg)))
    chunk_evs = [e for e in events if isinstance(e, GraphChunkEvent)]
    # 3 annotations / chunk_size=2 → 2 chunks worth of data
    assert len(chunk_evs) >= 1
    # Blocking variant NOT present in stream mode
    blocking = [e for e in events if isinstance(e, GraphSectionEvent)]
    assert blocking == []


def test_render_graph_blocking(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    cfg = GraphViewConfig(triplet_field="triplets", stream=False)
    events = asyncio.run(_drain(render_graph(aq, cfg)))
    blocking = [e for e in events if isinstance(e, GraphSectionEvent)]
    assert len(blocking) == 1
    assert len(blocking[0].nodes) == 6
    assert len(blocking[0].edges) == 3


def test_collect_rows_equivalent_to_render(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    page = asyncio.run(collect_rows(aq))
    assert page.total == 3


def test_collect_aggregate(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    cfg = AggregateViewConfig(group_by="sentiment")
    agg = asyncio.run(collect_aggregate(aq, cfg))
    assert {b.key for b in agg.buckets} == {"positive", "negative"}


def test_collect_graph(db, annotation_fixture):
    f = annotation_fixture
    aq = AnnotationQuery(db, f["iid"]).scope(None).runs([f["run"]])
    cfg = GraphViewConfig(triplet_field="triplets")
    gr = asyncio.run(collect_graph(aq, cfg))
    assert len(gr.nodes) == 6
    assert len(gr.edges) == 3
