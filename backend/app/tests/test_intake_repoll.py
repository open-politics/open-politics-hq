"""Re-poll an unchanged corpus → ZERO writes (the supersede / re-update storm regression).

The acquire spine (``content.tasks.ingestion.intake_items``) runs the stage-1 source_token
guard, then ``build_outcome`` → ``decide`` for the survivors. Polling a source whose items
haven't changed must produce NO creates / supersedes / updates — and must not even touch the
existing rows (no ``updated_at`` churn). This is the integration gate for the identity layer;
``decide()`` itself is unit-tested in ``test_decide.py``.

Run with the celery worker STOPPED — a running worker would process the new assets and race
the snapshot.
"""
from __future__ import annotations

import pytest
from sqlmodel import Session, select

from app.core.db import engine
from app.core.config import settings
from app.api.modules.content.contexts import SourceContext
from app.api.modules.content.models import Asset, AssetKind
from app.api.modules.content.sources import RawItem, FetchedContent
from app.api.modules.content.tasks.ingestion import intake_items


@pytest.fixture(scope="module")
def workspace(infospace_factory, user_id):
    return infospace_factory("Intake Re-poll Tests", user_id)


@pytest.fixture
def session():
    with Session(engine) as s:
        yield s
        s.rollback()


class _StableSource:
    """A source whose ``fetch`` returns the item's inline text — content is byte-identical
    across polls. ``intake_items`` takes the items directly, so only ``fetch`` is exercised."""

    async def fetch(self, item: RawItem, sctx: SourceContext) -> FetchedContent:
        return FetchedContent(text_content=item.text)


def _items(n: int) -> list[RawItem]:
    return [
        RawItem(source_identifier=f"stable://doc/{i}", kind=AssetKind.TEXT,
                title=f"doc {i}", source_token="v1", text=f"body of doc {i}")
        for i in range(n)
    ]


def _live(session: Session, infospace_id: int) -> list[Asset]:
    return list(session.exec(
        select(Asset).where(Asset.infospace_id == infospace_id,
                            Asset.is_superseded == False)  # noqa: E712
    ).all())


async def test_repoll_unchanged_corpus_writes_nothing(session, user_id, workspace):
    src = _StableSource()
    sctx = SourceContext(session=session, user_id=user_id, infospace_id=workspace, settings=settings)
    items = _items(5)

    # First poll → all created.
    first = await intake_items(items, src, sctx)
    session.commit()
    assert first == {"created": 5, "skipped": 0, "superseded": 0, "updated": 0}
    assert len(_live(session, workspace)) == 5

    # Snapshot — nothing about these rows may change on a re-poll.
    updated_before = {a.id: a.updated_at for a in _live(session, workspace)}

    # Re-poll the SAME unchanged corpus → ZERO writes (the storm regression).
    second = await intake_items(items, src, sctx)
    session.commit()
    assert second == {"created": 0, "skipped": 5, "superseded": 0, "updated": 0}, \
        f"re-poll of an unchanged corpus must write nothing, got {second}"
    assert len(_live(session, workspace)) == 5, "no new rows on re-poll"
    assert {a.id: a.updated_at for a in _live(session, workspace)} == updated_before, \
        "re-poll must not touch existing rows (no updated_at churn)"
