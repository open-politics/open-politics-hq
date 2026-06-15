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


def _asset_with_content(db, infospace_id: int, user_id: int, title: str, content: str,
                        kind: str = "ARTICLE", parent_asset_id: int | None = None) -> int:
    result = db.execute(
        text(
            "INSERT INTO asset (title, text_content, kind, infospace_id, user_id, bundle_ids, "
            "parent_asset_id, uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:title, :content, :kind, :iid, :uid, ARRAY[]::int[], "
            ":pid, gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"title": title, "content": content, "kind": kind, "iid": infospace_id,
         "uid": user_id, "pid": parent_asset_id},
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
    # More than one stream batch (PRIMARY_BATCH_SIZE=5) so the JSON collect path
    # must concatenate batches, not keep only the last.
    for i in range(8):
        _asset_with_content(db, iid, uid, f"alpha doc {i}", "alpha body text")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("alpha").sort("relevance").paginate(limit=20)
    envelope = asyncio.run(collect_search(q, query_string="alpha", mode="text"))

    assert isinstance(envelope, AssetSearch)
    assert envelope.meta.query == "alpha"
    assert envelope.meta.mode == "text"
    assert envelope.primary.total >= 8
    assert len(envelope.primary.items) == 8, "collect must concatenate all streamed batches"


def test_search_ranks_title_match_above_content_match(db):
    # text_search_vector is generated from text_content only, so a direct title
    # match would otherwise rank below content hits. _relevance_rank fixes that.
    uid = _user(db, "rank")
    iid = _infospace(db, uid, "views-rank")
    # Title carries the query; content says nothing about it.
    title_hit = _asset_with_content(db, iid, uid, "Quarterly Budget Report", "lorem ipsum dolor sit amet")
    # Title unrelated; content mentions the query repeatedly.
    content_hit = _asset_with_content(db, iid, uid, "Misc Notes", "the budget report budget report budget report figures")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("budget report").sort("relevance").paginate(limit=10)
    scored = q.execute_scored()
    ids = [a.id for a, _rank, _hl in scored]

    assert title_hit in ids and content_hit in ids
    assert ids.index(title_hit) < ids.index(content_hit), "direct title match must rank first"


def test_aql_kind_filter_compiles_from_query_string(db):
    # #1: filters in the query string (kind:) must actually filter, not become FTS noise.
    from app.api.modules.content.query import parse as parse_aql
    uid = _user(db, "aql"); iid = _infospace(db, uid, "views-aql")
    art = _asset_with_content(db, iid, uid, "budget article", "budget text", kind="ARTICLE")
    csv = _asset_with_content(db, iid, uid, "budget sheet", "budget text", kind="CSV")
    db.commit()

    q = AssetQuery.from_aql(db, iid, parse_aql("budget kind:article"))
    ids = [a.id for a in q.execute()]

    assert art in ids
    assert csv not in ids


def test_search_streams_primary_in_batches(db):
    # #3: many results arrive as several primary batches, not one dump.
    from app.api.modules.content.query import parse as parse_aql
    uid = _user(db, "stream"); iid = _infospace(db, uid, "views-stream")
    for i in range(12):
        _asset_with_content(db, iid, uid, f"budget doc {i}", "budget content body")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("budget").sort("relevance").paginate(limit=50)
    events = asyncio.run(_collect_events(
        render_search(q, query_string="budget", mode="text", parsed=parse_aql("budget"))
    ))
    primary = [e for e in events if isinstance(e, SectionEvent) and e.role == "primary"]

    assert len(primary) >= 2, "12 hits should stream as multiple primary batches"
    assert sum(len(e.section.items) for e in primary) == 12
    # Only the final batch carries pagination state.
    assert primary[-1].section.has_more is False


def test_search_emits_real_child_matches(db):
    # #2: a container hit whose children also match must emit grouped sections
    # carrying the actual child rows — not an empty items list.
    from app.api.modules.content.query import parse as parse_aql
    uid = _user(db, "kids"); iid = _infospace(db, uid, "views-kids")
    parent = _asset_with_content(db, iid, uid, "Budget Report", "annual budget overview", kind="ARTICLE")
    hit = _asset_with_content(db, iid, uid, "Budget page", "detailed budget figures", kind="TEXT", parent_asset_id=parent)
    _asset_with_content(db, iid, uid, "Intro page", "table of contents", kind="TEXT", parent_asset_id=parent)
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("budget").sort("relevance").paginate(limit=10)
    events = asyncio.run(_collect_events(
        render_search(q, query_string="budget", mode="text", parsed=parse_aql("budget"))
    ))
    grouped = [e for e in events if isinstance(e, SectionEvent) and e.role == "grouped"]

    assert grouped, "container hit should emit a grouped section"
    items = grouped[0].section.items
    assert items, "grouped section must carry real child items, not []"
    assert any(it.id == f"asset-{hit}" for it in items)


def test_search_tags_title_vs_content_hits(db):
    # AssetSelector tiers + "no % on title hits": title hits tag field=title with
    # no score; content hits tag field=body and keep their score.
    from app.api.modules.content.query import parse as parse_aql
    uid = _user(db, "tier"); iid = _infospace(db, uid, "views-tier")
    title_hit = _asset_with_content(db, iid, uid, "Budget Report", "lorem ipsum dolor")
    content_hit = _asset_with_content(db, iid, uid, "Misc Notes", "the budget figures here")
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("budget").sort("relevance").paginate(limit=10)
    events = asyncio.run(_collect_events(
        render_search(q, query_string="budget", mode="text", parsed=parse_aql("budget"))
    ))
    nodes = {}
    for e in events:
        if isinstance(e, SectionEvent) and e.role == "primary":
            for it in e.section.items:
                nodes[it.id] = it

    th = nodes[f"asset-{title_hit}"]
    ch = nodes[f"asset-{content_hit}"]
    assert th.matches[0].field == "title"
    assert th.score is None, "title hit must carry no score/%"
    assert ch.matches[0].field == "body"
    assert ch.score is not None


def test_search_children_none_suppresses_grouping(db):
    from app.api.modules.content.query import parse as parse_aql
    uid = _user(db, "nokids"); iid = _infospace(db, uid, "views-nokids")
    parent = _asset_with_content(db, iid, uid, "Budget Report", "annual budget overview", kind="ARTICLE")
    _asset_with_content(db, iid, uid, "Budget page", "detailed budget figures", kind="TEXT", parent_asset_id=parent)
    db.commit()

    q = AssetQuery(db, iid).scope(None).text("budget").sort("relevance").paginate(limit=10)
    events = asyncio.run(_collect_events(
        render_search(q, query_string="budget children:none", mode="text",
                      parsed=parse_aql("budget children:none"))
    ))
    grouped = [e for e in events if isinstance(e, SectionEvent) and e.role == "grouped"]
    assert not grouped, "children:none must suppress grouped sections"


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
