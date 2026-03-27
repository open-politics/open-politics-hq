"""
Tests for core/tree.py — Layer 0 tree operations.

All tests require PostgreSQL (array ops, CTEs, triggers).
Run via: ./test.sh app/tests/test_tree.py
"""
import pytest
from sqlalchemy import Column, Integer, String, Boolean, MetaData, Table, text, create_engine
from sqlalchemy.dialects.postgresql import ARRAY as PG_ARRAY
from sqlmodel import Session

from app.core.tree import (
    ROOT,
    TreeResult,
    copy,
    move,
    delete,
    subtree_ids,
    seal_subtree,
    unseal_subtree,
    _would_cycle,
    _array_append,
    _array_remove,
    _fork_subtree,
)


# ─── Fixtures ───

@pytest.fixture(scope="module")
def pg_engine():
    """Connect to the test database (same PG as the app)."""
    from app.core.config import settings
    engine = create_engine(str(settings.SQLALCHEMY_DATABASE_URI), echo=False)
    return engine


@pytest.fixture
def db(pg_engine):
    """Transactional session — rolls back after each test."""
    connection = pg_engine.connect()
    transaction = connection.begin()
    session = Session(bind=connection)
    yield session
    session.close()
    transaction.rollback()
    connection.close()


def _bundle(db, name="test", infospace_id=1, user_id=1, parent=ROOT, sealed=False):
    """Helper: insert a bundle and return its id."""
    result = db.execute(
        text(
            "INSERT INTO bundle (name, infospace_id, user_id, parent_bundle_id, sealed, "
            "asset_count, child_bundle_count, version, uuid, tags, created_at, updated_at) "
            "VALUES (:name, :iid, :uid, :parent, :sealed, 0, 0, '1.0', "
            "gen_random_uuid()::text, '[]'::json, now(), now()) RETURNING id"
        ),
        {"name": name, "iid": infospace_id, "uid": user_id, "parent": parent, "sealed": sealed},
    )
    return result.scalar()


def _asset(db, title="test asset", infospace_id=1, user_id=1, bundle_ids=None):
    """Helper: insert an asset and return its id."""
    bids = bundle_ids or [ROOT]
    result = db.execute(
        text(
            "INSERT INTO asset (title, kind, infospace_id, user_id, bundle_ids, "
            "uuid, processing_status, stub, created_at, updated_at) "
            "VALUES (:title, 'ARTICLE', :iid, :uid, CAST(:bids AS int[]), "
            "gen_random_uuid()::text, 'READY', false, now(), now()) RETURNING id"
        ),
        {"title": title, "iid": infospace_id, "uid": user_id, "bids": bids},
    )
    return result.scalar()


def _get_bundle_ids(db, asset_id):
    """Helper: read current bundle_ids for an asset."""
    return db.execute(
        text("SELECT bundle_ids FROM asset WHERE id = :aid"),
        {"aid": asset_id},
    ).scalar()


# ─── ROOT semantics ───

class TestRootSemantics:

    def test_root_is_zero(self):
        assert ROOT == 0

    def test_root_asset_has_explicit_membership(self, db):
        aid = _asset(db)
        bids = _get_bundle_ids(db, aid)
        assert bids == [0]

    def test_root_bundle_has_parent_zero(self, db):
        bid = _bundle(db)
        parent = db.execute(
            text("SELECT parent_bundle_id FROM bundle WHERE id = :bid"),
            {"bid": bid},
        ).scalar()
        assert parent == 0


# ─── Copy ───

class TestCopy:

    def test_copy_asset_to_bundle(self, db):
        bid = _bundle(db, "dest")
        aid = _asset(db)

        result = copy(db, asset_ids=[aid], to=bid)

        assert result.executed
        assert result.assets == 1
        bids = _get_bundle_ids(db, aid)
        assert ROOT in bids
        assert bid in bids

    def test_copy_asset_idempotent(self, db):
        bid = _bundle(db, "dest")
        aid = _asset(db, bundle_ids=[bid])

        result = copy(db, asset_ids=[aid], to=bid)
        assert result.assets == 0  # no-op

    def test_copy_bundle_forks_structure(self, db):
        parent = _bundle(db, "parent")
        child = _bundle(db, "child", parent=parent)
        aid = _asset(db, bundle_ids=[child])

        result = copy(db, bundle_ids=[parent], to=ROOT)

        assert result.bundles == 2  # parent + child forked
        assert result.assets >= 1  # asset gained membership in forked child

    def test_copy_empty_is_noop(self, db):
        result = copy(db, to=ROOT)
        assert result.executed
        assert result.message == "Nothing to copy."

    def test_copy_to_nonexistent_raises(self, db):
        with pytest.raises(ValueError, match="does not exist"):
            copy(db, asset_ids=[1], to=999999)

    def test_copy_to_sealed_raises(self, db):
        bid = _bundle(db, "sealed", sealed=True)
        aid = _asset(db)
        with pytest.raises(ValueError, match="sealed"):
            copy(db, asset_ids=[aid], to=bid)


# ─── Move ───

class TestMove:

    def test_move_asset_between_bundles(self, db):
        src = _bundle(db, "src")
        dst = _bundle(db, "dst")
        aid = _asset(db, bundle_ids=[src])

        result = move(db, asset_ids=[aid], out_of=src, to=dst)

        assert result.assets == 1
        bids = _get_bundle_ids(db, aid)
        assert dst in bids
        assert src not in bids

    def test_move_asset_to_root(self, db):
        bid = _bundle(db, "src")
        aid = _asset(db, bundle_ids=[bid])

        move(db, asset_ids=[aid], out_of=bid, to=ROOT)

        bids = _get_bundle_ids(db, aid)
        assert ROOT in bids
        assert bid not in bids

    def test_move_bundle_changes_parent(self, db):
        old_parent = _bundle(db, "old")
        new_parent = _bundle(db, "new")
        child = _bundle(db, "child", parent=old_parent)

        move(db, bundle_ids=[child], out_of=old_parent, to=new_parent)

        actual = db.execute(
            text("SELECT parent_bundle_id FROM bundle WHERE id = :bid"),
            {"bid": child},
        ).scalar()
        assert actual == new_parent

    def test_move_bundle_wrong_out_of_raises(self, db):
        b1 = _bundle(db, "b1")
        b2 = _bundle(db, "b2")
        child = _bundle(db, "child", parent=b1)

        with pytest.raises(ValueError, match="out_of must match"):
            move(db, bundle_ids=[child], out_of=b2, to=ROOT)

    def test_move_bundle_cycle_raises(self, db):
        parent = _bundle(db, "parent")
        child = _bundle(db, "child", parent=parent)

        with pytest.raises(ValueError, match="cycle"):
            move(db, bundle_ids=[parent], out_of=ROOT, to=child)

    def test_move_from_sealed_raises(self, db):
        sealed = _bundle(db, "sealed", sealed=True)
        aid = _asset(db, bundle_ids=[sealed])
        dst = _bundle(db, "dst")
        with pytest.raises(ValueError, match="sealed"):
            move(db, asset_ids=[aid], out_of=sealed, to=dst)


# ─── Delete ───

class TestDelete:

    def test_delete_preview_does_not_execute(self, db):
        bid = _bundle(db, "doomed")
        aid = _asset(db, bundle_ids=[bid])

        result = delete(db, bundle_ids=[bid], out_of=ROOT, confirm=False)

        assert not result.executed
        assert result.bundles >= 1
        # Bundle still exists
        assert db.execute(text("SELECT 1 FROM bundle WHERE id = :bid"), {"bid": bid}).first()

    def test_delete_confirm_destroys_bundle(self, db):
        bid = _bundle(db, "doomed")
        result = delete(db, bundle_ids=[bid], out_of=ROOT, confirm=True)

        assert result.executed
        assert result.destroyed_bundles >= 1
        assert not db.execute(text("SELECT 1 FROM bundle WHERE id = :bid"), {"bid": bid}).first()

    def test_delete_exclusive_asset_destroyed(self, db):
        bid = _bundle(db, "only-home")
        aid = _asset(db, bundle_ids=[bid])

        delete(db, bundle_ids=[bid], out_of=ROOT, confirm=True)

        assert not db.execute(text("SELECT 1 FROM asset WHERE id = :aid"), {"aid": aid}).first()

    def test_delete_shared_asset_survives(self, db):
        bid = _bundle(db, "one-home")
        other = _bundle(db, "other-home")
        aid = _asset(db, bundle_ids=[bid, other])

        delete(db, bundle_ids=[bid], out_of=ROOT, confirm=True)

        row = db.execute(text("SELECT bundle_ids FROM asset WHERE id = :aid"), {"aid": aid}).first()
        assert row is not None
        assert bid not in row[0]
        assert other in row[0]

    def test_delete_asset_from_bundle_last_membership_destroys(self, db):
        bid = _bundle(db, "home")
        aid = _asset(db, bundle_ids=[bid])

        result = delete(db, asset_ids=[aid], out_of=bid, confirm=True)

        assert result.destroyed_assets >= 1
        assert not db.execute(text("SELECT 1 FROM asset WHERE id = :aid"), {"aid": aid}).first()

    def test_delete_asset_from_bundle_other_membership_survives(self, db):
        bid = _bundle(db, "home")
        other = _bundle(db, "other")
        aid = _asset(db, bundle_ids=[bid, other])

        result = delete(db, asset_ids=[aid], out_of=bid, confirm=True)

        assert result.unlinked == 1
        bids = _get_bundle_ids(db, aid)
        assert bid not in bids
        assert other in bids

    def test_delete_cascade_subtree(self, db):
        parent = _bundle(db, "parent")
        child = _bundle(db, "child", parent=parent)
        aid = _asset(db, bundle_ids=[child])

        result = delete(db, bundle_ids=[parent], out_of=ROOT, confirm=True)

        assert result.destroyed_bundles >= 2
        assert not db.execute(text("SELECT 1 FROM bundle WHERE id = :bid"), {"bid": parent}).first()
        assert not db.execute(text("SELECT 1 FROM bundle WHERE id = :bid"), {"bid": child}).first()

    def test_delete_sealed_raises(self, db):
        sealed = _bundle(db, "sealed", sealed=True)
        with pytest.raises(ValueError, match="sealed"):
            delete(db, bundle_ids=[sealed], out_of=ROOT, confirm=True)


# ─── Subtree ───

class TestSubtree:

    def test_subtree_includes_root(self, db):
        bid = _bundle(db, "root")
        ids = subtree_ids(db, {bid})
        assert bid in ids

    def test_subtree_includes_descendants(self, db):
        root = _bundle(db, "root")
        child = _bundle(db, "child", parent=root)
        grandchild = _bundle(db, "grandchild", parent=child)

        ids = subtree_ids(db, {root})

        assert root in ids
        assert child in ids
        assert grandchild in ids

    def test_subtree_empty_input(self, db):
        assert subtree_ids(db, set()) == set()


# ─── Sealed ───

class TestSealed:

    def test_seal_and_unseal(self, db):
        bid = _bundle(db, "target")
        child = _bundle(db, "child", parent=bid)

        sealed_count = seal_subtree(db, bid)
        assert sealed_count == 2

        unsealed_count = unseal_subtree(db, bid)
        assert unsealed_count == 2

    def test_copy_from_sealed_allowed(self, db):
        sealed = _bundle(db, "sealed", sealed=True)
        aid = _asset(db, bundle_ids=[sealed])
        dest = _bundle(db, "dest")

        # Copy FROM sealed works (doesn't modify sealed bundle)
        result = copy(db, asset_ids=[aid], to=dest)
        assert result.assets == 1


# ─── Cycle detection ───

class TestCycleDetection:

    def test_no_cycle_to_root(self, db):
        bid = _bundle(db, "b")
        assert not _would_cycle(db, bid, ROOT)

    def test_cycle_self_reference(self, db):
        bid = _bundle(db, "b")
        assert _would_cycle(db, bid, bid)

    def test_cycle_through_descendant(self, db):
        parent = _bundle(db, "parent")
        child = _bundle(db, "child", parent=parent)
        grandchild = _bundle(db, "grandchild", parent=child)
        assert _would_cycle(db, parent, grandchild)

    def test_no_cycle_sibling(self, db):
        parent = _bundle(db, "parent")
        child_a = _bundle(db, "a", parent=parent)
        child_b = _bundle(db, "b", parent=parent)
        assert not _would_cycle(db, child_a, child_b)


# ─── Array helpers ───

class TestArrayHelpers:

    def test_array_append_adds_membership(self, db):
        aid = _asset(db)
        bid = _bundle(db, "dest")

        count = _array_append(db, [aid], bid)

        assert count == 1
        bids = _get_bundle_ids(db, aid)
        assert bid in bids

    def test_array_remove_normalizes_to_root(self, db):
        bid = _bundle(db, "only")
        aid = _asset(db, bundle_ids=[bid])

        _array_remove(db, [aid], bid)

        bids = _get_bundle_ids(db, aid)
        assert bids == [ROOT]


# ─── Edge cases ───

class TestEdgeCases:

    def test_move_empty_is_noop(self, db):
        result = move(db, out_of=ROOT, to=ROOT)
        assert result.message == "Nothing to move."

    def test_delete_empty_is_noop(self, db):
        result = delete(db, out_of=ROOT, confirm=True)
        assert result.message == "Nothing to delete."

    def test_root_parent_not_falsy(self, db):
        """Regression: 0 must not be treated as falsy."""
        bid = _bundle(db, "at-root")
        parent = db.execute(
            text("SELECT parent_bundle_id FROM bundle WHERE id = :bid"),
            {"bid": bid},
        ).scalar()
        # This is the critical check: parent_bundle_id is 0, not None
        assert parent == 0
        assert parent is not None
        # And it must NOT be falsy in conditional checks
        assert (parent != ROOT) is False  # it IS root

    def test_copy_bundle_recount_new_bundles(self, db):
        """Forked bundles must have correct asset_count, not 0."""
        parent = _bundle(db, "src")
        aid1 = _asset(db, title="a1", bundle_ids=[parent])
        aid2 = _asset(db, title="a2", bundle_ids=[parent])

        result = copy(db, bundle_ids=[parent], to=ROOT)

        # Find the new forked bundle
        new_bundles = db.execute(
            text(
                "SELECT id, asset_count FROM bundle "
                "WHERE name LIKE :name AND id != :orig"
            ),
            {"name": "src%", "orig": parent},
        ).fetchall()
        assert len(new_bundles) == 1
        new_id, new_count = new_bundles[0]
        assert new_count == 2  # both assets should be counted


# ─── Fork subtree ───

class TestForkSubtree:

    def test_partial_selection_excludes_branch(self, db):
        """Excluding a sub-bundle from fork should skip that branch entirely."""
        root = _bundle(db, "root")
        keep = _bundle(db, "keep", parent=root)
        skip = _bundle(db, "skip", parent=root)
        aid_keep = _asset(db, title="kept", bundle_ids=[keep])
        aid_skip = _asset(db, title="skipped", bundle_ids=[skip])

        mapping = _fork_subtree(db, root, ROOT, exclude={skip})

        # Only root + keep should be forked, not skip
        assert root in mapping
        assert keep in mapping
        assert skip not in mapping

    def test_fork_name_dedup(self, db):
        """Forking to same parent generates unique name."""
        src = _bundle(db, "data")
        copy(db, bundle_ids=[src], to=ROOT)

        # Second copy should get "(copy)" suffix
        copy(db, bundle_ids=[src], to=ROOT)

        names = [
            r[0] for r in db.execute(
                text("SELECT name FROM bundle WHERE parent_bundle_id = 0 AND name LIKE 'data%'")
            ).fetchall()
        ]
        assert "data" in names
        assert "data (copy)" in names
