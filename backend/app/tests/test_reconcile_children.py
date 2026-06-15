"""Reconcile / persist_children — the #8 container-reprocess path.

A container reprocess (re-extract a PDF/CSV's children) must KEEP the annotations
attached to those children. Annotations FK to ``asset.id``, so the load-bearing
guarantee is **row-id stability** across a re-extract: a matched child is updated
IN PLACE (same id), never superseded-and-recreated. These tests assert that, plus
the diff behaviour — vanished children orphaned (kept + tagged), new ones inserted,
unchanged ones left untouched.

(We assert id-stability rather than build a real Annotation graph: an unchanged
``asset.id`` is exactly what keeps annotations/chunks attached, by FK.)
"""
from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.api.modules.content.models import Asset, AssetKind, ProcessingStatus
from app.api.modules.content.asset_builder import persist_children, reconcile_children


# ─── Fixtures (client/auth/user_id/infospace_factory come from conftest) ───────

@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory("Reconcile Children Tests", user_id)


@pytest.fixture
def session():
    with Session(engine) as s:
        yield s
        s.rollback()


# ─── Helpers ───────────────────────────────────────────────────────────────────

def _parent(session: Session, user_id: int, workspace: int) -> Asset:
    p = Asset(title="container", kind=AssetKind.PDF, user_id=user_id,
              infospace_id=workspace, processing_status=ProcessingStatus.READY)
    session.add(p)
    session.commit()
    session.refresh(p)
    return p


def _pages(user_id: int, workspace: int, parent_id: int, texts: list[str]) -> list[Asset]:
    """PDF_PAGE blueprints (un-persisted), part_index 0..N-1 — what a processor extracts."""
    return [
        Asset(title=f"Page {i + 1}", kind=AssetKind.PDF_PAGE, user_id=user_id,
              infospace_id=workspace, parent_asset_id=parent_id, part_index=i,
              text_content=text, processing_status=ProcessingStatus.READY)
        for i, text in enumerate(texts)
    ]


def _live_by_index(session: Session, parent_id: int) -> dict[int, Asset]:
    rows = session.exec(
        select(Asset).where(Asset.parent_asset_id == parent_id, Asset.is_superseded == False)  # noqa: E712
    ).all()
    return {r.part_index: r for r in rows}


# ─── Tests ───────────────────────────────────────────────────────────────────

async def test_first_persist_builds_then_reprocess_updates_in_place(session, user_id, workspace):
    """First persist builds the pages; a reprocess with one CHANGED page updates it in
    place — every page row id is unchanged (so its annotations survive), and only the
    changed page's content is refreshed."""
    parent = _parent(session, user_id, workspace)

    # First process → build (no existing children yet).
    built = await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b", "c"]),
                                   user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()
    assert len(built) == 3
    ids_before = {p.part_index: p.id for p in _live_by_index(session, parent.id).values()}

    # Reprocess → page 1's content changed; pages 0 and 2 identical.
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "B-CHANGED", "c"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()

    live = _live_by_index(session, parent.id)
    assert len(live) == 3
    # Row ids are STABLE across the reprocess — this is what preserves annotations.
    assert {idx: a.id for idx, a in live.items()} == ids_before
    assert live[1].text_content == "B-CHANGED"        # changed page refreshed
    assert live[0].text_content == "a" and live[2].text_content == "c"


async def test_reprocess_orphans_vanished_child(session, user_id, workspace):
    """A child gone from the re-extract is marked orphaned (kept + tagged), NOT deleted —
    so its annotations are never silently destroyed."""
    parent = _parent(session, user_id, workspace)
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b", "c"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()
    gone_id = _live_by_index(session, parent.id)[2].id

    # Reprocess yields only pages 0 and 1.
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()

    gone = session.get(Asset, gone_id)
    assert gone is not None, "orphaned child must NOT be deleted"
    assert (gone.file_info or {}).get("orphaned") is True
    # persist_children hands back only the live, non-orphaned children.
    live = await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b"]),
                                  user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()
    assert gone_id not in {c.id for c in live}


async def test_reprocess_inserts_new_child(session, user_id, workspace):
    """A page the re-extract added (new part_index) is inserted."""
    parent = _parent(session, user_id, workspace)
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()

    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b", "c"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()
    live = _live_by_index(session, parent.id)
    assert set(live) == {0, 1, 2}
    assert live[2].text_content == "c"


async def test_reconcile_unchanged_keeps_all(session, user_id, workspace):
    """Re-extracting identical content touches nothing: all kept, no update/orphan/insert."""
    parent = _parent(session, user_id, workspace)
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b", "c"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()

    stats = await reconcile_children(
        session, parent.id, _pages(user_id, workspace, parent.id, ["a", "b", "c"]),
        user_id=user_id, infospace_id=workspace, match_key="part_index", on_change="update",
    )
    session.commit()
    assert stats == {"inserted": 0, "kept": 3, "updated": 0, "superseded": 0, "orphaned": 0}


async def test_supersede_mode_makes_new_version(session, user_id, workspace):
    """on_change='supersede' (the non-reprocess default): a changed child is superseded —
    old row flagged is_superseded, a new row inserted. (Reprocess uses update, not this.)"""
    parent = _parent(session, user_id, workspace)
    await persist_children(session, parent.id, _pages(user_id, workspace, parent.id, ["a"]),
                           user_id=user_id, infospace_id=workspace, match_key="part_index")
    session.commit()
    old_id = _live_by_index(session, parent.id)[0].id

    stats = await reconcile_children(
        session, parent.id, _pages(user_id, workspace, parent.id, ["a-CHANGED"]),
        user_id=user_id, infospace_id=workspace, match_key="part_index", on_change="supersede",
    )
    session.commit()
    assert stats["superseded"] == 1
    assert session.get(Asset, old_id).is_superseded is True
    live = _live_by_index(session, parent.id)
    assert live[0].id != old_id and live[0].text_content == "a-CHANGED"
