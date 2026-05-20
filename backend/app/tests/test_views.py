"""Tests for modules/content/views.py — render generators + collect drains.

Each render_X should emit a canonical StreamEvent sequence. collect_X is
implemented via drain(render_X, envelope_type) and must be event-for-event
equivalent to its render sibling.
"""
from __future__ import annotations

import asyncio

import pytest
from sqlalchemy import text, create_engine
from sqlmodel import Session

from app.api.modules.content.query import AssetQuery
from app.api.modules.content.schemas import (
    AssetFeed,
    AssetSearch,
    AssetTree,
    CountEvent,
    DoneEvent,
    NavEvent,
    SectionEvent,
    SkeletonEvent,
)
from app.api.modules.content.views import (
    collect_feed,
    collect_search,
    collect_tree,
    render_feed,
    render_search,
    render_tree,
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


def _user(db, email_suffix: str = "views") -> int:
    email = f"views_{email_suffix}@test.local"
    result = db.execute(
        text(
            "INSERT INTO \"user\" (email, hashed_password, is_active, is_superuser, email_verified, "
            "full_name, created_at, updated_at) "
            "VALUES (:email, 'x', true, false, true, 'Test', now(), now()) "
            "ON CONFLICT (email) DO UPDATE SET email=EXCLUDED.email RETURNING id"
        ),
        {"email": email},
    )
    return int(result.scalar())


def _infospace(db, user_id: int, name: str = "views-test") -> int:
    result = db.execute(
        text(
            "INSERT INTO infospace (name, owner_id, uuid, created_at) "
            "VALUES (:name, :uid, gen_random_uuid()::text, now()) RETURNING id"
        ),
        {"name": name, "uid": user_id},
    )
    return int(result.scalar())


def _bundle(db, infospace_id: int, user_id: int, name: str = "b") -> int:
    result = db.execute(
        text(
            "INSERT INTO bundle (name, infospace_id, user_id, parent_bundle_id, sealed, "
            "asset_count, child_bundle_count, version, uuid, tags, created_at, updated_at) "
            "VALUES (:name, :iid, :uid, 0, false, 0, 0, '1.0', "
            "gen_random_uuid()::text, '[]'::json, now(), now()) RETURNING id"
        ),
        {"name": name, "iid": infospace_id, "uid": user_id},
    )
    return int(result.scalar())


def _asset(db, infospace_id: int, user_id: int, title: str, bundle_ids: list[int] | None = None) -> int:
    bids = bundle_ids or []
    result = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:title, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"title": title, "iid": infospace_id, "uid": user_id, "bids": bids},
    )
    return int(result.scalar())


async def _collect_events(gen):
    return [ev async for ev in gen]


def test_render_tree_event_order(db):
    uid = _user(db, "tree")
    iid = _infospace(db, uid, "views-tree")
    _bundle(db, iid, uid, "bundle-a")
    _asset(db, iid, uid, "hello")
    db.commit()

    q = AssetQuery(db, iid).scope(None).top_level_only().paginate(limit=10)

    events = asyncio.run(_collect_events(render_tree(q)))
    names = [e.name for e in events]
    assert names[0] == "skeleton"
    assert names[1] == "nav"
    assert "section" in names
    assert "count" in names
    assert names[-1] == "done"

    # First section must be total=-1 sentinel
    section_evs = [e for e in events if isinstance(e, SectionEvent)]
    assert section_evs[0].section.total == -1
    # Count resolves
    count_evs = [e for e in events if isinstance(e, CountEvent)]
    assert count_evs[0].total >= 1


def test_collect_tree_equivalent_to_drain(db):
    uid = _user(db, "treec")
    iid = _infospace(db, uid, "views-treec")
    _asset(db, iid, uid, "a")
    _asset(db, iid, uid, "b")
    db.commit()

    q = AssetQuery(db, iid).scope(None).top_level_only().paginate(limit=10)
    envelope = asyncio.run(collect_tree(q))

    assert isinstance(envelope, AssetTree)
    assert envelope.section.total >= 2  # count resolved
    assert envelope.section.total != -1
    assert envelope.meta is not None
    assert envelope.meta.assets >= 2


def test_render_search_primary_role(db):
    uid = _user(db, "search")
    iid = _infospace(db, uid, "views-search")
    _asset(db, iid, uid, "climate policy report")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("climate").paginate(limit=10)

    events = asyncio.run(_collect_events(render_search(q, query_string="climate", mode="text")))
    section_evs = [e for e in events if isinstance(e, SectionEvent)]
    assert section_evs[0].role == "primary"
    assert section_evs[0].section.total == -1


def test_collect_search_envelope(db):
    uid = _user(db, "searchc")
    iid = _infospace(db, uid, "views-searchc")
    _asset(db, iid, uid, "alpha")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("alpha").paginate(limit=10)
    envelope = asyncio.run(collect_search(q, query_string="alpha", mode="text"))

    assert isinstance(envelope, AssetSearch)
    assert envelope.meta.query == "alpha"
    assert envelope.meta.mode == "text"
    assert envelope.primary.total >= 1


def test_render_feed_event_order(db):
    uid = _user(db, "feed")
    iid = _infospace(db, uid, "views-feed")
    _asset(db, iid, uid, "feed-item")
    db.commit()

    q = AssetQuery(db, iid).scope(None).top_level_only().paginate(limit=10)
    events = asyncio.run(_collect_events(render_feed(q)))
    names = [e.name for e in events]
    assert names[0] == "skeleton"
    assert names[-1] == "done"


def test_collect_feed_envelope(db):
    uid = _user(db, "feedc")
    iid = _infospace(db, uid, "views-feedc")
    _asset(db, iid, uid, "one")
    db.commit()

    q = AssetQuery(db, iid).scope(None).top_level_only().paginate(limit=10)
    envelope = asyncio.run(collect_feed(q))
    assert isinstance(envelope, AssetFeed)
    assert envelope.section.total >= 1
