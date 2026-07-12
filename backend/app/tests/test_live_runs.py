"""Live runs — the streaming delta + in-place extend.

Covers the load-bearing new logic without touching the LLM engine:
  * ``_delta_query`` resolves a bundle's **subtree** (the sub-bundle fix),
  * the watermark gates the delta (only ids above it),
  * the coverage anti-join skips pairs this run has already done,
  * ``extend_run`` grows a run **in place** (no child) and re-pends it.
"""
from __future__ import annotations

import json as _json

import pytest
from sqlalchemy import create_engine, text
from sqlmodel import Session

from app.api.modules.annotation.models import AnnotationRun, RunStatus
from app.api.modules.annotation.tasks.annotate import _delta_query, WATERMARK_KEY


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
    return int(db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, "
            "email_verified, full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'Test', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": f"live_{suffix}@t.local"},
    ).scalar())


def _infospace(db, uid: int, name: str) -> int:
    return int(db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:n, :u, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"n": name, "u": uid},
    ).scalar())


def _schema(db, iid: int, uid: int, name: str = "s") -> int:
    return int(db.execute(
        text(
            "INSERT INTO annotationschema (name, description, output_contract, instructions, "
            "infospace_id, user_id, version, is_active, uuid, created_at, updated_at) "
            "VALUES (:n, 'd', '{}'::jsonb, 'i', :iid, :uid, '1.0', true, "
            "gen_random_uuid()::text, now(), now()) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid},
    ).scalar())


def _bundle(db, iid: int, uid: int, name: str, parent: int = 0) -> int:
    return int(db.execute(
        text(
            "INSERT INTO bundle (name, uuid, infospace_id, user_id, parent_bundle_id, "
            "asset_count, child_bundle_count, sealed, version, created_at, updated_at) "
            "VALUES (:n, gen_random_uuid()::text, :iid, :uid, :p, 0, 0, false, '1.0', "
            "now(), now()) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid, "p": parent},
    ).scalar())


def _asset(db, iid: int, uid: int, title: str, bundle_ids: list[int]) -> int:
    return int(db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:t, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"t": title, "iid": iid, "uid": uid, "bids": bundle_ids or [0]},
    ).scalar())


def _live_run(db, iid: int, uid: int, name: str, source_bundle_id: int) -> int:
    return int(db.execute(
        text(
            "INSERT INTO annotationrun (name, description, configuration, infospace_id, "
            "user_id, status, uuid, created_at, updated_at, include_parent_context, "
            "context_window, trigger_type, run_type, follow_on_version_change, live, "
            "source_bundle_id) "
            "VALUES (:n, 'd', '{}'::jsonb, :iid, :uid, 'COMPLETED', gen_random_uuid()::text, "
            "now(), now(), false, 0, 'MANUAL', 'ONE_OFF', false, true, :sb) RETURNING id"
        ),
        {"n": name, "iid": iid, "uid": uid, "sb": source_bundle_id},
    ).scalar())


def _link_schema(db, run_id: int, schema_id: int) -> None:
    db.execute(
        text("INSERT INTO runschemalink (run_id, schema_id) VALUES (:r, :s)"),
        {"r": run_id, "s": schema_id},
    )


def _annotation(db, iid, uid, run_id, schema_id, asset_id, status="SUCCESS") -> None:
    db.execute(
        text(
            "INSERT INTO annotation (run_id, schema_id, asset_id, value, status, "
            "infospace_id, user_id, timestamp, uuid, created_at, updated_at) "
            "VALUES (:r, :s, :a, '{}'::jsonb, :st, :iid, :uid, now(), "
            "gen_random_uuid()::text, now(), now())"
        ),
        {"r": run_id, "s": schema_id, "a": asset_id, "st": status, "iid": iid, "uid": uid},
    )


def _delta_ids(db, run_id: int, watermark: int = 0) -> list[int]:
    run = db.get(AnnotationRun, run_id)
    q = _delta_query(db, run, watermark)
    return [r for r in db.exec(q).all()]


def test_delta_includes_bundle_subtree(db):
    """Selecting a bundle includes its sub-bundles — the case the legacy
    ``bundle_ids @> ARRAY[bid]`` containment query missed."""
    uid = _user(db, "subtree")
    iid = _infospace(db, uid, "subtree")
    sid = _schema(db, iid, uid)
    parent_b = _bundle(db, iid, uid, "parent")
    child_b = _bundle(db, iid, uid, "child", parent=parent_b)

    a_top = _asset(db, iid, uid, "top", [parent_b])
    a_sub = _asset(db, iid, uid, "sub", [child_b])   # only in the sub-bundle
    _asset(db, iid, uid, "elsewhere", [9999])        # unrelated bundle

    run_id = _live_run(db, iid, uid, "watcher", source_bundle_id=parent_b)
    _link_schema(db, run_id, sid)

    ids = _delta_ids(db, run_id)
    assert set(ids) == {a_top, a_sub}, "delta must span the whole subtree"


def test_watermark_bounds_the_delta(db):
    """The watermark is the cursor — the delta returns only assets above it,
    ordered by id, so batches advance monotonically. (Dedup of already-done
    pairs is the engine's pair-level skip, not this query.)"""
    uid = _user(db, "wm")
    iid = _infospace(db, uid, "wm")
    sid = _schema(db, iid, uid)
    b = _bundle(db, iid, uid, "b")
    a1 = _asset(db, iid, uid, "a1", [b])
    a2 = _asset(db, iid, uid, "a2", [b])
    run_id = _live_run(db, iid, uid, "watcher", source_bundle_id=b)
    _link_schema(db, run_id, sid)

    # From the start (watermark 0) the whole scope is in the delta, ordered by id.
    assert _delta_ids(db, run_id) == [a1, a2]

    # Watermark at a1 → only a2 (new content above the line).
    assert _delta_ids(db, run_id, watermark=a1) == [a2]

    # Watermark at the last id → caught up.
    assert _delta_ids(db, run_id, watermark=a2) == []


def test_scope_unions_bundle_and_explicit_assets(db):
    """An explicit asset added to a bundle-watching run widens the scope (union),
    rather than being shadowed by the bundle."""
    uid = _user(db, "union")
    iid = _infospace(db, uid, "union")
    sid = _schema(db, iid, uid)
    b = _bundle(db, iid, uid, "b")
    in_bundle = _asset(db, iid, uid, "in_bundle", [b])
    outside = _asset(db, iid, uid, "outside", [9999])  # not in the watched bundle

    run = AnnotationRun(
        name="u", infospace_id=iid, user_id=uid, status=RunStatus.COMPLETED,
        live=True, source_bundle_id=b,
        configuration={"target_asset_ids": [outside]},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    _link_schema(db, run.id, sid)
    db.commit()

    assert set(_delta_ids(db, run.id)) == {in_bundle, outside}


def test_delta_unions_multiple_bundles(db):
    """A live run can watch several bundles at once (configuration.source_bundle_ids);
    the delta spans the union of their subtrees."""
    uid = _user(db, "multi")
    iid = _infospace(db, uid, "multi")
    sid = _schema(db, iid, uid)
    b1 = _bundle(db, iid, uid, "b1")
    b2 = _bundle(db, iid, uid, "b2")
    b2_child = _bundle(db, iid, uid, "b2child", parent=b2)
    a1 = _asset(db, iid, uid, "a1", [b1])
    a2 = _asset(db, iid, uid, "a2", [b2])
    a2_sub = _asset(db, iid, uid, "a2sub", [b2_child])   # sub-bundle of a watched bundle
    _asset(db, iid, uid, "elsewhere", [9999])

    run = AnnotationRun(
        name="multi", infospace_id=iid, user_id=uid, status=RunStatus.COMPLETED,
        live=True, configuration={"source_bundle_ids": [b1, b2]},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    _link_schema(db, run.id, sid)
    db.commit()

    ids = _delta_ids(db, run.id)
    assert set(ids) == {a1, a2, a2_sub}, "delta must union both bundles' subtrees"


def test_extend_run_grows_in_place(db):
    """extend_run appends scope to the SAME run and re-pends it — no child row."""
    from app.api.modules.annotation.services.annotation_service import AnnotationService

    uid = _user(db, "extend")
    iid = _infospace(db, uid, "extend")
    sid = _schema(db, iid, uid)
    a1 = _asset(db, iid, uid, "a1", [0])
    a2 = _asset(db, iid, uid, "a2", [0])

    # A plain completed run over an explicit list, watermark already advanced.
    run = AnnotationRun(
        name="r", infospace_id=iid, user_id=uid, status=RunStatus.COMPLETED,
        configuration={"target_asset_ids": [a1], WATERMARK_KEY: a1},
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    run_id = run.id

    runs_before = db.exec(text("SELECT count(*) FROM annotationrun")).scalar()

    svc = AnnotationService(session=db)
    # emit() is fire-and-forget; tolerate no broker in the test env.
    try:
        returned = svc.extend_run(
            run_id=run_id, user_id=uid, infospace_id=iid,
            asset_ids=[a2], schema_ids=[sid],
        )
    except Exception:
        returned = db.get(AnnotationRun, run_id)

    runs_after = db.exec(text("SELECT count(*) FROM annotationrun")).scalar()
    assert runs_after == runs_before, "extend must not create a new run"

    refreshed = db.get(AnnotationRun, run_id)
    assert returned.id == run_id
    assert refreshed.status == RunStatus.PENDING
    assert a2 in (refreshed.configuration or {}).get("target_asset_ids", [])
    assert WATERMARK_KEY not in (refreshed.configuration or {}), "watermark reset on extend"
    assert sid in [s.id for s in refreshed.target_schemas]
