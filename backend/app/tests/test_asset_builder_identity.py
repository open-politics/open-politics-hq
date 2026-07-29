"""
Tests for AssetBuilder identity + policy API (Phase 1.2).

Pure additions — these don't touch the existing build() behavior, only the
new dedup_on / no_dedup / on_match / supersedes / find_match / _do_supersede
surface area.

Phase 1.8 later flips build() to consume this framework; tests for that go
in a separate module.
"""
from __future__ import annotations

import hashlib
import os

import pytest
from sqlalchemy import text
from sqlmodel import Session, select

from app.core.config import settings
from app.core.db import engine
from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.asset_builder import AssetBuilder, content_hash


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
    text_content: str | None = None,
    kind: AssetKind = AssetKind.TEXT,
    parent_asset_id: int | None = None,
    is_superseded: bool = False,
) -> Asset:
    a = Asset(
        title=title,
        kind=kind,
        user_id=user_id,
        infospace_id=workspace,
        text_content=title if text_content is None else text_content,
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
    assert b._keys == {"source_identifier": "https://example.com/a",
                       "content_hash": "abc123"}
    assert "title" not in b._keys      # presence IS declaration; no sentinel
    assert b._dedup_disabled is False


def test_dedup_on_is_additive(session, user_id, workspace):
    """Calling dedup_on twice merges — last write wins per key, unset keys preserved."""
    b = (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier="X")
        .dedup_on(content_hash="Y")
    )
    assert b._keys == {"source_identifier": "X", "content_hash": "Y"}


def test_no_dedup_clears_keys(session, user_id, workspace):
    b = (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier="X", content_hash="Y")
        .no_dedup()
    )
    assert b._dedup_disabled is True
    assert b._keys == {}


def test_dedup_on_after_no_dedup_reenables(session, user_id, workspace):
    b = (
        AssetBuilder(session, user_id, workspace)
        .no_dedup()
        .dedup_on(source_identifier="X")
    )
    assert b._dedup_disabled is False
    assert b._keys == {"source_identifier": "X"}


# ─── on_match ────────────────────────────────────────────────────────────────

def test_on_match_default_is_skip(session, user_id, workspace):
    b = AssetBuilder(session, user_id, workspace)
    assert b._policy == "skip"


def test_on_match_accepts_valid_policies(session, user_id, workspace):
    for policy in ("skip", "supersede", "update"):
        b = AssetBuilder(session, user_id, workspace).on_match(policy)
        assert b._policy == policy


def test_on_match_rejects_invalid_policy(session, user_id, workspace):
    with pytest.raises(ValueError):
        AssetBuilder(session, user_id, workspace).on_match("replace")


# ─── supersedes (explicit target) ────────────────────────────────────────────

def test_supersedes_forces_policy_and_stores_target(session, user_id, workspace):
    old = _make_asset(session, user_id, workspace, title="old", source_identifier="s1")
    try:
        b = AssetBuilder(session, user_id, workspace).supersedes(old)
        assert b._supersede_target is old
        assert b._policy == "supersede"
    finally:
        session.delete(old)
        session.commit()


def test_supersedes_requires_non_none(session, user_id, workspace):
    with pytest.raises(ValueError):
        AssetBuilder(session, user_id, workspace).supersedes(None)


# ─── find_match ──────────────────────────────────────────────────────────────

async def test_find_match_returns_none_when_no_dedup(session, user_id, workspace):
    b = AssetBuilder(session, user_id, workspace).no_dedup()
    result = b.find_match()
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
        result = b.find_match()
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
        result = b.find_match()
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
        result = builder.find_match()
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
        result = builder.find_match()
        assert result is None, "find_match returned a superseded row"
    finally:
        session.delete(superseded)
        session.commit()


async def test_find_match_returns_the_live_version_not_an_older_one(session, user_id, workspace):
    """Several versions of one identity, one live → find_match returns the live one.

    Two LIVE roots sharing an identifier is no longer a reachable state — that is what
    ``ux_asset_live_identity`` enforces. What an identifier CAN have is a version chain:
    unlimited superseded rows behind exactly one live row. This is the case the
    ``is_superseded`` filter exists for.
    """
    old_v1 = _make_asset(
        session, user_id, workspace,
        title="v1", source_identifier="versioned-src", is_superseded=True,
    )
    old_v2 = _make_asset(
        session, user_id, workspace,
        title="v2", source_identifier="versioned-src", is_superseded=True,
    )
    live = _make_asset(
        session, user_id, workspace,
        title="v3-live", source_identifier="versioned-src",
    )
    try:
        result = AssetBuilder(session, user_id, workspace).dedup_on(
            source_identifier="versioned-src"
        ).find_match()
        assert result is not None
        assert result.id == live.id, "must return the live version, not a superseded one"
    finally:
        for a in (old_v1, old_v2, live):
            session.delete(a)
        session.commit()


async def test_find_match_returns_most_recent_for_a_non_unique_key(session, user_id, workspace):
    """content_hash is NOT unique, so several live roots can match — newest wins.

    The unique index covers source_identifier only. Two distinct URLs serving identical
    bytes legitimately share a content_hash, which is why find_match still orders by
    created_at DESC rather than assuming at most one row.
    """
    shared = content_hash("identical bytes at two different urls")
    older = _make_asset(
        session, user_id, workspace,
        title="older", source_identifier="url-a", content_hash=shared,
    )
    newer = _make_asset(
        session, user_id, workspace,
        title="newer", source_identifier="url-b", content_hash=shared,
    )
    try:
        result = AssetBuilder(session, user_id, workspace).dedup_on(
            content_hash=shared
        ).find_match()
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
        result = builder.find_match()
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
    result = (await builder.persist(fresh)).asset
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
        result = (await builder.persist(newer)).asset
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
        result = (await builder.persist(newer)).asset
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
    body = "the article body, unchanged between polls"
    existing = _make_asset(
        session, user_id, workspace,
        title="first-poll",
        source_identifier="rss-guid-stable",
        text_content=body,
        content_hash=content_hash(body),
    )
    existing_id = existing.id
    try:
        # Hand over the content, not a hash — the builder derives it. Feeding a literal
        # hash here is what let six copies of the formula drift apart unnoticed.
        builder = (
            AssetBuilder(session, user_id, workspace)
            .as_kind(AssetKind.ARTICLE)
            .with_title("second-poll-same-content")
            .with_source("rss-guid-stable")
            .with_text(body)
            .dedup_on(source_identifier="rss-guid-stable")
            .on_match("supersede")
        )
        result = (await builder.build()).asset
        session.commit()

        session.refresh(existing)
        assert result.id == existing_id, "should return the existing row, not a new one"
        assert existing.is_superseded is False, "supersede must not fire on identical content"
    finally:
        session.delete(existing)
        session.commit()


async def test_supersede_fires_when_content_hash_differs(session, user_id, workspace):
    """on_match('supersede') with different content_hash supersedes normally."""
    v1, v2 = "the original body", "the body, revised after publication"
    existing = _make_asset(
        session, user_id, workspace,
        title="first-poll",
        source_identifier="rss-guid-drift",
        text_content=v1,
        content_hash=content_hash(v1),
    )
    existing_id = existing.id
    result = None
    try:
        builder = (
            AssetBuilder(session, user_id, workspace)
            .as_kind(AssetKind.ARTICLE)
            .with_title("second-poll-new-content")
            .with_source("rss-guid-drift")
            .with_text(v2)
            .dedup_on(source_identifier="rss-guid-drift")
            .on_match("supersede")
        )
        result = (await builder.build()).asset
        session.commit()

        session.refresh(existing)
        assert result.id != existing_id
        assert existing.is_superseded is True
        assert result.previous_asset_id == existing_id
        assert result.content_hash == content_hash(v2), "the new version carries the derived hash"
    finally:
        # result first (FK points at existing); may be unbound if the build raised
        if result is not None:
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
        result = (await builder.persist(updates)).asset
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
    asset = (await builder.build()).asset
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
    """Same invariant for .persist(asset) — accepts a pre-built Asset, never commits."""
    builder = AssetBuilder(session, user_id, workspace).no_dedup()
    pre_built = Asset(
        title="load-no-commit",
        kind=AssetKind.TEXT,
        text_content="x",
        user_id=user_id,
        infospace_id=workspace,
    )
    result = (await builder.persist(pre_built)).asset
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


# ─── the one derivation ───────────────────────────────────────────────────────
# content_hash used to have SEVEN implementations across four semantics and two
# algorithms, all writing one column — and not a single test called any of them
# (every hash in this file was a literal string like "hash-v1"), which is exactly
# how they drifted apart unnoticed. These pin it.


def test_content_hash_is_md5_of_the_content_itself():
    """Fixed vectors. Not "some hash" — THIS hash, forever."""
    assert content_hash("hello") == "5d41402abc4b2a76b9719d911017c592"
    assert content_hash(b"hello") == "5d41402abc4b2a76b9719d911017c592"
    assert content_hash("hello") == hashlib.md5(b"hello").hexdigest()


def test_content_hash_agrees_across_input_shapes(tmp_path):
    """str / bytes / Path must land on the same digest — the Path branch streams in
    1 MiB chunks, so this also covers the multi-chunk boundary."""
    blob = os.urandom(3 * 1024 * 1024)
    p = tmp_path / "blob.bin"
    p.write_bytes(blob)
    assert content_hash(p) == content_hash(blob) == hashlib.md5(blob).hexdigest()

    text = "some article body"
    assert content_hash(text) == content_hash(text.encode("utf-8"))


def test_content_hash_is_none_for_absent_content():
    """None, not the digest of "". decide() must never read "no content" as
    "unchanged" — see test_decide.py::test_unknown_hash_cannot_prove_identity."""
    assert content_hash(None) is None
    assert content_hash("") is None
    assert content_hash(b"") is None


def test_content_hash_is_not_truncated():
    """The old derivation hashed text[:1000], so an edit past character 1000 read as
    'unchanged' and a revised article was never re-versioned."""
    base = "x" * 5000
    assert content_hash(base) != content_hash(base[:4999] + "y")


def test_content_hash_matches_postgres_md5(session):
    """The cleanup backfills with PG's md5(text_content) rather than a Python loop.
    That is only sound while the two agree — including on multibyte input."""
    for sample in ("plain ascii", "ümlauts and — dashes", "日本語のテキスト", "x" * 3000):
        pg = session.execute(
            text("SELECT md5(:s)"), {"s": sample}
        ).scalar()
        assert content_hash(sample) == pg, f"diverged on {sample[:20]!r}"


async def test_every_source_hands_over_content_not_a_hash():
    """The builder derives; sources supply content. A source that stamps its own hash
    for text is re-implementing identity — the drift this whole invariant exists to
    catch — so only blob-realizing sources may set FetchedContent.content_hash."""
    import inspect

    from app.api.modules.content.sources import registered_source_kinds, get_source_handler

    offenders = []
    for kind in registered_source_kinds():
        src = inspect.getsource(get_source_handler(kind))
        # crude but exact: the only legal content_hash= in a fetch() is on a blob path
        for line in src.splitlines():
            if "content_hash=" in line and "blob_path" not in src.split(line)[0][-400:]:
                offenders.append((kind, line.strip()))
    assert not offenders, (
        f"sources stamping their own text hash: {offenders}. "
        f"Return the content and let AssetBuilder derive it."
    )


# ─── the race ─────────────────────────────────────────────────────────────────

async def test_concurrent_builds_of_one_identity_yield_one_row(user_id, workspace):
    """Two overlapping transactions racing the same identity produce ONE asset.

    This is the defect that motivated ux_asset_live_identity, reproduced exactly:
    jobs 105375/105376 (two Sources on newsfeed.zeit.de) interleaved inserts of the
    same guids 4-9ms apart, because dedup was a SELECT and an INSERT with nothing in
    between. B's find_match legitimately sees nothing — A has not committed — so B
    decides "create", collides with the index, and must re-decide rather than duplicate.
    """
    url = "https://example.com/concurrently-ingested"

    def builder(sess):
        return (
            AssetBuilder(sess, user_id, workspace)
            .as_kind(AssetKind.ARTICLE).with_title("racer")
            .with_source(url).with_text("body")
            .dedup_on(source_identifier=url).on_match("skip")
        )

    with Session(engine) as sa, Session(engine) as sb:
        a = await builder(sa).build()

        b_builder = builder(sb)
        assert b_builder.find_match() is None, (
            "B must not see A's uncommitted row — otherwise this test proves nothing"
        )
        sa.commit()

        b = await b_builder.build()
        sb.commit()
        # Capture before the sessions close; the ORM rows detach with them.
        a_status, a_id = a.status, a.asset.id
        b_status, b_id = b.status, b.asset.id

    try:
        assert a_status == "created"
        assert b_status == "skipped", "the loser re-decides instead of inserting"
        assert b_id == a_id, "both callers get the same asset back"
        with Session(engine) as s:
            rows = s.exec(
                select(Asset).where(
                    Asset.infospace_id == workspace, Asset.source_identifier == url
                )
            ).all()
            assert len(rows) == 1, f"expected exactly one row, got {len(rows)}"
    finally:
        with Session(engine) as s:
            from app.api.modules.content.tree import purge
            purge(s, {a_id})
            s.commit()


async def test_conflict_resolves_by_index_key_not_by_dedup_key(session, user_id, workspace):
    """A caller may dedup on content_hash while still carrying a source_identifier —
    POST /assets does exactly that. When the identifier is already taken, the conflict
    must resolve against the INDEX's key. Resolving it by re-running find_match (which
    is looking for a hash) finds nothing and used to blow up with an AssertionError.
    """
    url = "https://example.com/dedup-key-mismatch"
    existing = _make_asset(
        session, user_id, workspace,
        title="existing", source_identifier=url, content_hash="hash-of-v1",
    )
    try:
        outcome = await (
            AssetBuilder(session, user_id, workspace)
            .as_kind(AssetKind.ARTICLE).with_title("incoming")
            .with_source(url)
            .with_blob("blob/path", "hash-of-v2")   # a digest rides with its bytes
            .dedup_on(content_hash="hash-of-v2")  # ← different key than the index uses
            .on_match("skip")
        ).build()
        session.commit()
        assert outcome.status == "skipped"
        assert outcome.asset.id == existing.id, "must return the identity's actual owner"
    finally:
        session.delete(existing)
        session.commit()


async def test_load_absorbs_the_race_instead_of_poisoning_the_transaction(user_id, workspace):
    """load() is reachable from POST /assets/batch. An unguarded insert there would
    raise IntegrityError and poison the whole request transaction, losing every other
    row in the batch — so it takes the same savepoint path as build."""
    url = "https://example.com/load-race"

    with Session(engine) as sa, Session(engine) as sb:
        a = Asset(title="A", kind=AssetKind.ARTICLE, user_id=user_id,
                  infospace_id=workspace, source_identifier=url, text_content="a")
        first = (await AssetBuilder(sa, user_id, workspace).dedup_on(
            source_identifier=url).on_match("skip").persist(a)).asset
        first_id = first.id

        builder = AssetBuilder(sb, user_id, workspace).dedup_on(
            source_identifier=url).on_match("skip")
        assert builder.find_match() is None, "B must not see A's uncommitted row"
        sa.commit()

        b = Asset(title="B", kind=AssetKind.ARTICLE, user_id=user_id,
                  infospace_id=workspace, source_identifier=url, text_content="b")
        second = (await builder.persist(b)).asset
        # The transaction must still be usable — this is the property that matters.
        sb.add(Asset(title="unrelated", kind=AssetKind.TEXT, user_id=user_id,
                     infospace_id=workspace, text_content="survivor"))
        sb.commit()
        second_id = second.id

    try:
        assert second_id == first_id, "the loser gets the existing row back"
        with Session(engine) as s:
            rows = s.exec(select(Asset).where(
                Asset.infospace_id == workspace, Asset.source_identifier == url)).all()
            assert len(rows) == 1
            survivors = s.exec(select(Asset).where(
                Asset.infospace_id == workspace, Asset.title == "unrelated")).all()
            assert len(survivors) == 1, "the rest of the batch survived the collision"
    finally:
        with Session(engine) as s:
            from app.api.modules.content.tree import purge
            ids = {r.id for r in s.exec(select(Asset).where(
                Asset.infospace_id == workspace,
                Asset.title.in_(["A", "B", "unrelated"]))).all()}
            purge(s, ids)
            s.commit()


# ─── one pipeline: persist() and build() must behave identically ──────────────

async def test_persist_matched_row_gains_placement_and_refreshes_token(session, user_id, workspace):
    """A directly-persisted row takes the SAME matched path as a fluent build.

    Before the fold these were two pipelines and the loaded one had drifted: it never
    called _place (so a matched asset never joined its bundle) and never refreshed
    source_token on unchanged content (so every poll re-fetched — the exact storm the
    'unchanged' verdict exists to kill).
    """
    from app.api.modules.content.tree import create_bundle

    body = "identical across both polls"
    url = "https://example.com/persist-parity"
    bundle = create_bundle(session, infospace_id=workspace, user_id=user_id, name="Persist Target")
    session.commit()

    existing = _make_asset(
        session, user_id, workspace, title="v1", source_identifier=url,
        text_content=body, content_hash=content_hash(body),
    )
    existing.source_token = "token-v1"
    session.add(existing)
    session.commit()

    try:
        row = Asset(
            title="v2", kind=AssetKind.ARTICLE, user_id=user_id, infospace_id=workspace,
            source_identifier=url, text_content=body, content_hash=content_hash(body),
            source_token="token-v2",          # drift moved…
        )
        outcome = await (
            AssetBuilder(session, user_id, workspace)
            .dedup_on(source_identifier=url)
            .on_match("supersede")
            .into_bundle(bundle.id)
        ).persist(row)
        session.commit()
        session.refresh(existing)

        assert outcome.status == "skipped", "…but the bytes did not — must not version"
        assert outcome.asset.id == existing.id
        assert existing.is_superseded is False
        assert existing.source_token == "token-v2", "token must advance, else re-fetch forever"
        assert bundle.id in existing.bundle_ids, "a matched row must still gain its bundle"
    finally:
        from app.api.modules.content.tree import purge
        purge(session, {existing.id})
        session.commit()


async def test_persist_reports_an_outcome_like_build_does(session, user_id, workspace):
    """persist() returns a BuildOutcome, so a caller can count created vs skipped.
    load() used to return a bare Asset, which is why POST /assets/batch could not report."""
    url = "https://example.com/persist-outcome"
    row = Asset(title="fresh", kind=AssetKind.ARTICLE, user_id=user_id,
                infospace_id=workspace, source_identifier=url, text_content="x")
    created = await (
        AssetBuilder(session, user_id, workspace)
        .dedup_on(source_identifier=url).on_match("skip")
    ).persist(row)
    session.commit()
    try:
        assert created.status == "created"
        again = await (
            AssetBuilder(session, user_id, workspace)
            .dedup_on(source_identifier=url).on_match("skip")
        ).persist(Asset(title="dup", kind=AssetKind.ARTICLE, user_id=user_id,
                        infospace_id=workspace, source_identifier=url, text_content="y"))
        session.commit()
        assert again.status == "skipped"
        assert again.asset.id == created.asset.id
    finally:
        from app.api.modules.content.tree import purge
        purge(session, {created.asset.id})
        session.commit()
