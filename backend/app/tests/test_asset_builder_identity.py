"""
Tests for AssetBuilder identity + policy API (Phase 1.2).

Pure additions — these don't touch the existing build() behavior, only the
new dedup_on / no_dedup / on_match / supersedes / find_match / _do_supersede
surface area.

Phase 1.8 later flips build() to consume this framework; tests for that go
in a separate module.
"""
from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.services.asset_builder import AssetBuilder, _UNSET


# ─── Fixtures ────────────────────────────────────────────────────────────────
# client, auth, headers, user_id, infospace_factory — provided by conftest.py

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    """Dedicated infospace — auto-deleted on teardown."""
    return infospace_factory("AssetBuilder Identity Tests", user_id)


@pytest.fixture
def session():
    """Fresh session per test. Each test owns its transaction boundary."""
    with Session(engine) as s:
        yield s
        s.rollback()


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _make_asset(
    session: Session,
    user_id: int,
    workspace: int,
    *,
    title: str = "fixture",
    source_identifier: str | None = None,
    content_hash: str | None = None,
    kind: AssetKind = AssetKind.TEXT,
    parent_asset_id: int | None = None,
    is_superseded: bool = False,
) -> Asset:
    a = Asset(
        title=title,
        kind=kind,
        user_id=user_id,
        infospace_id=workspace,
        text_content=title,
        source_identifier=source_identifier,
        content_hash=content_hash,
        parent_asset_id=parent_asset_id,
        processing_status=ProcessingStatus.READY,
        is_superseded=is_superseded,
    )
    session.add(a)
    session.commit()
    session.refresh(a)
    return a


# ─── dedup_on / no_dedup ─────────────────────────────────────────────────────

def test_dedup_on_stores_identity_keys(session, user_id, workspace):
    b = (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier="https://example.com/a", content_hash="abc123")
    )
    assert b.blueprint.dedup_source_identifier == "https://example.com/a"
    assert b.blueprint.dedup_content_hash == "abc123"
    assert b.blueprint.dedup_title is _UNSET
    assert b.blueprint.dedup_disabled is False


def test_dedup_on_is_additive(session, user_id, workspace):
    """Calling dedup_on twice merges — last write wins per key, unset keys preserved."""
    b = (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier="X")
        .dedup_on(content_hash="Y")
    )
    assert b.blueprint.dedup_source_identifier == "X"
    assert b.blueprint.dedup_content_hash == "Y"


def test_no_dedup_clears_keys(session, user_id, workspace):
    b = (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier="X", content_hash="Y")
        .no_dedup()
    )
    assert b.blueprint.dedup_disabled is True
    assert b.blueprint.dedup_source_identifier is _UNSET
    assert b.blueprint.dedup_content_hash is _UNSET


def test_dedup_on_after_no_dedup_reenables(session, user_id, workspace):
    b = (
        AssetBuilder(session, user_id, workspace)
        .no_dedup()
        .dedup_on(source_identifier="X")
    )
    assert b.blueprint.dedup_disabled is False
    assert b.blueprint.dedup_source_identifier == "X"


# ─── on_match ────────────────────────────────────────────────────────────────

def test_on_match_default_is_skip(session, user_id, workspace):
    b = AssetBuilder(session, user_id, workspace)
    assert b.blueprint.match_policy == "skip"


def test_on_match_accepts_valid_policies(session, user_id, workspace):
    for policy in ("skip", "supersede", "update"):
        b = AssetBuilder(session, user_id, workspace).on_match(policy)
        assert b.blueprint.match_policy == policy


def test_on_match_rejects_invalid_policy(session, user_id, workspace):
    with pytest.raises(ValueError):
        AssetBuilder(session, user_id, workspace).on_match("replace")


# ─── supersedes (explicit target) ────────────────────────────────────────────

def test_supersedes_forces_policy_and_stores_target(session, user_id, workspace):
    old = _make_asset(session, user_id, workspace, title="old", source_identifier="s1")
    try:
        b = AssetBuilder(session, user_id, workspace).supersedes(old)
        assert b.blueprint.supersede_target is old
        assert b.blueprint.match_policy == "supersede"
    finally:
        session.delete(old)
        session.commit()


def test_supersedes_requires_non_none(session, user_id, workspace):
    with pytest.raises(ValueError):
        AssetBuilder(session, user_id, workspace).supersedes(None)


# ─── find_match ──────────────────────────────────────────────────────────────

async def test_find_match_returns_none_when_no_dedup(session, user_id, workspace):
    b = AssetBuilder(session, user_id, workspace).no_dedup()
    result = await b.find_match()
    assert result is None


async def test_find_match_by_source_identifier(session, user_id, workspace):
    existing = _make_asset(
        session, user_id, workspace,
        title="existing-src",
        source_identifier="https://example.com/unique-src-1",
    )
    try:
        b = AssetBuilder(session, user_id, workspace).dedup_on(
            source_identifier="https://example.com/unique-src-1"
        )
        result = await b.find_match()
        assert result is not None
        assert result.id == existing.id
    finally:
        session.delete(existing)
        session.commit()


async def test_find_match_by_content_hash(session, user_id, workspace):
    existing = _make_asset(
        session, user_id, workspace,
        title="existing-hash",
        content_hash="unique-hash-abc123",
    )
    try:
        b = AssetBuilder(session, user_id, workspace).dedup_on(
            content_hash="unique-hash-abc123"
        )
        result = await b.find_match()
        assert result is not None
        assert result.id == existing.id
    finally:
        session.delete(existing)
        session.commit()


async def test_find_match_composite_keys_are_anded(session, user_id, workspace):
    """When both source_identifier and content_hash are set, both must match."""
    a = _make_asset(
        session, user_id, workspace,
        title="only-src-matches",
        source_identifier="composite-src",
        content_hash="hash-a",
    )
    b = _make_asset(
        session, user_id, workspace,
        title="only-hash-matches",
        source_identifier="other-src",
        content_hash="composite-hash",
    )
    try:
        # Query with composite — neither row matches both keys
        builder = AssetBuilder(session, user_id, workspace).dedup_on(
            source_identifier="composite-src",
            content_hash="composite-hash",
        )
        result = await builder.find_match()
        assert result is None
    finally:
        session.delete(a)
        session.delete(b)
        session.commit()


async def test_find_match_excludes_superseded(session, user_id, workspace):
    """find_match must never return an already-superseded row."""
    superseded = _make_asset(
        session, user_id, workspace,
        title="superseded",
        source_identifier="supersede-test-src",
        is_superseded=True,
    )
    try:
        builder = AssetBuilder(session, user_id, workspace).dedup_on(
            source_identifier="supersede-test-src"
        )
        result = await builder.find_match()
        assert result is None, "find_match returned a superseded row"
    finally:
        session.delete(superseded)
        session.commit()


async def test_find_match_returns_most_recent_when_multiple(session, user_id, workspace):
    """When multiple non-superseded matches exist, return the most recent by created_at."""
    older = _make_asset(
        session, user_id, workspace,
        title="older",
        source_identifier="multi-match-src",
    )
    newer = _make_asset(
        session, user_id, workspace,
        title="newer",
        source_identifier="multi-match-src",
    )
    try:
        builder = AssetBuilder(session, user_id, workspace).dedup_on(
            source_identifier="multi-match-src"
        )
        result = await builder.find_match()
        assert result is not None
        assert result.id == newer.id
    finally:
        session.delete(older)
        session.delete(newer)
        session.commit()


async def test_find_match_with_supersedes_target_skips_query(session, user_id, workspace):
    """When .supersedes(old) is set, find_match returns old directly — no query."""
    old = _make_asset(session, user_id, workspace, title="explicit-old", source_identifier="xyz")
    try:
        builder = AssetBuilder(session, user_id, workspace).supersedes(old)
        # No dedup_on configured — find_match would normally return None
        result = await builder.find_match()
        assert result is old
    finally:
        session.delete(old)
        session.commit()


# ─── _do_supersede cascade ───────────────────────────────────────────────────

def test_do_supersede_marks_old_and_cascades_to_children(session, user_id, workspace):
    """_do_supersede flips is_superseded on the parent and parent_is_superseded
    on every direct child via bulk UPDATE. Does not commit — caller owns tx."""
    parent = _make_asset(session, user_id, workspace, title="parent", source_identifier="p1")
    child1 = _make_asset(session, user_id, workspace, title="child1", parent_asset_id=parent.id)
    child2 = _make_asset(session, user_id, workspace, title="child2", parent_asset_id=parent.id)

    try:
        builder = AssetBuilder(session, user_id, workspace)
        builder._do_supersede(parent)

        # After _do_supersede, flush has run but no commit. Re-read within session.
        session.refresh(parent)
        session.refresh(child1)
        session.refresh(child2)

        assert parent.is_superseded is True, "parent should be superseded"
        assert child1.parent_is_superseded is True, "child1 cascade missed"
        assert child2.parent_is_superseded is True, "child2 cascade missed"

        # is_superseded on children should NOT be touched — only parent_is_superseded cascades.
        assert child1.is_superseded is False
        assert child2.is_superseded is False
    finally:
        session.delete(child1)
        session.delete(child2)
        session.delete(parent)
        session.commit()


def test_do_supersede_does_not_commit(session, user_id, workspace):
    """_do_supersede flushes but must not commit — verify by rollback after."""
    parent = _make_asset(session, user_id, workspace, title="parent-rb", source_identifier="prb")
    parent_id = parent.id

    builder = AssetBuilder(session, user_id, workspace)
    builder._do_supersede(parent)
    # Confirm flush happened: the change is visible within this session
    assert parent.is_superseded is True

    # Rollback — change must NOT persist (proves caller-owned transaction)
    session.rollback()

    # Fresh session to verify rollback took effect
    with Session(engine) as s2:
        reloaded = s2.get(Asset, parent_id)
        try:
            assert reloaded is not None
            assert reloaded.is_superseded is False, (
                "_do_supersede must not commit — rolled-back change leaked"
            )
        finally:
            s2.delete(reloaded)
            s2.commit()


# ─── build_batch + build_children ────────────────────────────────────────────

async def test_build_batch_inserts_pre_constructed_assets(session, user_id, workspace):
    """build_batch takes a list of Asset rows and bulk-inserts. No dedup."""
    builder = AssetBuilder(session, user_id, workspace)
    rows = [
        Asset(
            title=f"batch-{i}",
            kind=AssetKind.TEXT,
            user_id=user_id,
            infospace_id=workspace,
            text_content=f"row {i}",
            processing_status=ProcessingStatus.READY,
        )
        for i in range(5)
    ]
    result = await builder.build_batch(rows)
    assert len(result) == 5
    for a in result:
        assert a.id is not None, "flush should assign primary keys"

    session.commit()
    try:
        # All persisted
        ids = [a.id for a in result]
        found = session.exec(select(Asset).where(Asset.id.in_(ids))).all()
        assert len(found) == 5
    finally:
        for a in result:
            session.delete(a)
        session.commit()


async def test_build_batch_auto_sets_user_and_infospace(session, user_id, workspace):
    """build_batch fills in user_id and infospace_id from builder context if missing."""
    builder = AssetBuilder(session, user_id, workspace)
    rows = [
        Asset(title="a", kind=AssetKind.TEXT, text_content="x"),
    ]
    await builder.build_batch(rows)
    session.commit()
    try:
        assert rows[0].user_id == user_id
        assert rows[0].infospace_id == workspace
    finally:
        session.delete(rows[0])
        session.commit()


async def test_build_batch_rejects_cross_infospace(session, user_id, workspace):
    """Caller bug: infospace_id on the row doesn't match the builder's. Fail loudly."""
    builder = AssetBuilder(session, user_id, workspace)
    wrong = Asset(
        title="wrong",
        kind=AssetKind.TEXT,
        text_content="x",
        user_id=user_id,
        infospace_id=workspace + 9999,  # deliberate mismatch
    )
    with pytest.raises(ValueError, match="infospace_id"):
        await builder.build_batch([wrong])
    session.rollback()


async def test_build_children_assigns_parent_and_part_index(session, user_id, workspace):
    """build_children auto-sets parent_asset_id and part_index (0..N-1)."""
    parent = _make_asset(
        session, user_id, workspace,
        title="bc-parent",
        kind=AssetKind.CSV,
    )
    try:
        builder = AssetBuilder(session, user_id, workspace)
        children = [
            Asset(title=f"row-{i}", kind=AssetKind.CSV_ROW, text_content=f"c{i}",
                  user_id=user_id, infospace_id=workspace)
            for i in range(3)
        ]
        result = await builder.build_children(parent.id, children)
        session.commit()

        assert len(result) == 3
        for i, child in enumerate(result):
            assert child.parent_asset_id == parent.id
            assert child.part_index == i
    finally:
        for child in children:
            if child.id:
                session.delete(child)
        session.delete(parent)
        session.commit()


async def test_load_flushes_new_asset_when_no_match(session, user_id, workspace):
    """load() on a fresh asset with no dedup_on → just flushes."""
    builder = AssetBuilder(session, user_id, workspace).no_dedup()
    fresh = Asset(
        title="load-fresh",
        kind=AssetKind.TEXT,
        text_content="x",
        user_id=user_id,
        infospace_id=workspace,
    )
    result = await builder.load(fresh)
    session.commit()
    try:
        assert result.id is not None
        assert result is fresh
    finally:
        session.delete(result)
        session.commit()


async def test_load_with_skip_policy_returns_match(session, user_id, workspace):
    """dedup_on + on_match=skip: load returns the existing row unchanged."""
    existing = _make_asset(
        session, user_id, workspace,
        title="existing-load-skip",
        source_identifier="load-skip-src",
    )
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .dedup_on(source_identifier="load-skip-src")
            .on_match("skip")
        )
        newer = Asset(
            title="would-be-dupe",
            kind=AssetKind.TEXT,
            text_content="y",
            source_identifier="load-skip-src",
            user_id=user_id,
            infospace_id=workspace,
        )
        result = await builder.load(newer)
        assert result.id == existing.id
        assert result.title == "existing-load-skip"
    finally:
        session.delete(existing)
        session.commit()


async def test_load_with_supersede_policy_chains_versions(session, user_id, workspace):
    """load + supersede: old gets is_superseded=True, new gets previous_asset_id=old.id."""
    old = _make_asset(
        session, user_id, workspace,
        title="old-version",
        source_identifier="version-chain-src",
    )
    old_id = old.id
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .dedup_on(source_identifier="version-chain-src")
            .on_match("supersede")
        )
        newer = Asset(
            title="new-version",
            kind=AssetKind.TEXT,
            text_content="updated",
            source_identifier="version-chain-src",
            user_id=user_id,
            infospace_id=workspace,
        )
        result = await builder.load(newer)
        session.commit()

        session.refresh(old)
        assert old.is_superseded is True
        assert result is newer
        assert result.previous_asset_id == old_id
    finally:
        session.delete(newer)
        session.delete(old)
        session.commit()


async def test_supersede_skips_when_content_hash_identical(session, user_id, workspace):
    """on_match('supersede') with identical content_hash returns existing — no new row, no cascade.

    This is the Phase 2.1 behavior that makes RSS's supersede-on-content-change
    sane: same GUID + same content on a re-poll must be a no-op, not a version bump.
    """
    existing = _make_asset(
        session, user_id, workspace,
        title="first-poll",
        source_identifier="rss-guid-stable",
        content_hash="hash-stable",
    )
    existing_id = existing.id
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .as_kind(AssetKind.ARTICLE)
            .with_title("second-poll-same-content")
            .with_source("rss-guid-stable")
            .with_content_hash("hash-stable")
            .dedup_on(source_identifier="rss-guid-stable")
            .on_match("supersede")
        )
        result = await builder.build()
        session.commit()

        session.refresh(existing)
        assert result.id == existing_id, "should return the existing row, not a new one"
        assert existing.is_superseded is False, "supersede must not fire on identical content"
    finally:
        session.delete(existing)
        session.commit()


async def test_supersede_fires_when_content_hash_differs(session, user_id, workspace):
    """on_match('supersede') with different content_hash supersedes normally."""
    existing = _make_asset(
        session, user_id, workspace,
        title="first-poll",
        source_identifier="rss-guid-drift",
        content_hash="hash-v1",
    )
    existing_id = existing.id
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .as_kind(AssetKind.ARTICLE)
            .with_title("second-poll-new-content")
            .with_source("rss-guid-drift")
            .with_content_hash("hash-v2")
            .dedup_on(source_identifier="rss-guid-drift")
            .on_match("supersede")
        )
        result = await builder.build()
        session.commit()

        session.refresh(existing)
        assert result.id != existing_id
        assert existing.is_superseded is True
        assert result.previous_asset_id == existing_id
    finally:
        # result first (FK points at existing)
        session.delete(result)
        session.delete(existing)
        session.commit()


async def test_load_with_update_policy_mutates_match_in_place(session, user_id, workspace):
    """load + update: merges non-None fields from the provided asset into the match."""
    existing = _make_asset(
        session, user_id, workspace,
        title="original-title",
        source_identifier="update-src",
    )
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .dedup_on(source_identifier="update-src")
            .on_match("update")
        )
        updates = Asset(
            title="updated-title",
            kind=AssetKind.TEXT,
            text_content="updated-text",
            source_identifier="update-src",
            user_id=user_id,
            infospace_id=workspace,
        )
        result = await builder.load(updates)
        session.commit()

        session.refresh(existing)
        assert result.id == existing.id
        assert existing.title == "updated-title"
        assert existing.text_content == "updated-text"
        # is_superseded untouched — update is in-place, not versioning
        assert existing.is_superseded is False
    finally:
        session.delete(existing)
        session.commit()


async def test_build_children_rejects_conflicting_parent(session, user_id, workspace):
    """If a child already has a different parent_asset_id, surface the bug."""
    parent = _make_asset(session, user_id, workspace, title="bc-parent2", kind=AssetKind.CSV)
    other = _make_asset(session, user_id, workspace, title="other", kind=AssetKind.CSV)
    try:
        builder = AssetBuilder(session, user_id, workspace)
        child = Asset(
            title="wrong-parent",
            kind=AssetKind.CSV_ROW,
            text_content="x",
            user_id=user_id,
            infospace_id=workspace,
            parent_asset_id=other.id,
        )
        with pytest.raises(ValueError, match="parent_asset_id"):
            await builder.build_children(parent.id, [child])
        session.rollback()
    finally:
        session.delete(parent)
        session.delete(other)
        session.commit()


# ─── Flush-never-commit invariant (HQ v2 enforcement) ────────────────────────

async def test_build_does_not_commit_internally(
    session, user_id, workspace, builder_must_not_commit,
):
    """HQ v2 invariant #1: AssetBuilder.build() flushes but never commits.

    The caller owns the transaction boundary. This test uses the
    `builder_must_not_commit` fixture to wrap session.commit and fail the
    test if build() invokes it.
    """
    builder = (
        AssetBuilder(session, user_id, workspace)
        .as_kind(AssetKind.TEXT)
        .with_title("flush-only-test")
        .with_text("hello")
        .no_dedup()
    )
    asset = await builder.build()
    # We, the caller, commit. Fixture allows this — the wrap only guards the
    # duration of the build() call itself.
    session.commit()
    try:
        assert asset.id is not None
    finally:
        session.delete(asset)
        session.commit()


async def test_load_does_not_commit_internally(
    session, user_id, workspace, builder_must_not_commit,
):
    """Same invariant for .load(asset) — accepts a pre-built Asset, never commits."""
    builder = AssetBuilder(session, user_id, workspace).no_dedup()
    pre_built = Asset(
        title="load-no-commit",
        kind=AssetKind.TEXT,
        text_content="x",
        user_id=user_id,
        infospace_id=workspace,
    )
    result = await builder.load(pre_built)
    session.commit()
    try:
        assert result.id is not None
    finally:
        session.delete(result)
        session.commit()


async def test_build_batch_does_not_commit_internally(
    session, user_id, workspace, builder_must_not_commit,
):
    """Bulk insert path must also flush-only."""
    builder = AssetBuilder(session, user_id, workspace)
    rows = [
        Asset(
            title=f"bulk-{i}",
            kind=AssetKind.TEXT,
            text_content=f"row {i}",
            user_id=user_id,
            infospace_id=workspace,
        )
        for i in range(3)
    ]
    result = await builder.build_batch(rows)
    session.commit()
    try:
        assert len(result) == 3
        assert all(a.id is not None for a in result)
    finally:
        for a in result:
            session.delete(a)
        session.commit()
